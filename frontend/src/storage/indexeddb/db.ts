/**
 * 数据库连接与版本策略。
 *
 * 本文件与同目录下的 schema / migrations 是全仓库唯一允许触碰 IndexedDB API 的地方
 * （约束 1，由 ESLint 强制）。其余各层经 Repository 访问存储。
 */
import { openDB, type IDBPDatabase } from 'idb'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  type SchemaWriter,
} from './migrations/index.ts'
import { DB_NAME, type AppDb } from './schema.ts'

/** 应用当前期望的 schema 版本，由迁移链长度推导（见 migrations/index.ts） */
export const SCHEMA_VERSION = LATEST_SCHEMA_VERSION

/** 库不存在时 `probeSchemaVersion` 的返回值 */
export const NO_DATABASE = 0

export class UnsupportedBrowserError extends Error {
  constructor() {
    super(
      '浏览器不支持 indexedDB.databases()，无法在迁移前安全地探测数据库版本。请升级浏览器（iOS Safari 16+ / Android Chrome 110+）。',
    )
    this.name = 'UnsupportedBrowserError'
  }
}

/**
 * 本地数据的 schema 版本高于当前应用支持的版本。
 *
 * PRD 未提及这种情况，但本地优先 + PWA 缓存下它完全可能发生：用户在一台设备上
 * 用新版应用写了数据，另一处的应用壳还是旧缓存。此时若放行，旧版迁移逻辑会按
 * 自己的理解改写新结构，静默损坏数据——所以必须拒绝启动。
 */
export class FutureSchemaError extends Error {
  readonly localVersion: number
  readonly expectedVersion: number

  constructor(localVersion: number, expectedVersion: number) {
    super(
      `本地数据的 schema 版本是 ${localVersion}，高于当前应用支持的 ${expectedVersion}。请升级应用后再打开，不要用旧版应用写入新结构的数据。`,
    )
    this.name = 'FutureSchemaError'
    this.localVersion = localVersion
    this.expectedVersion = expectedVersion
  }
}

/** 另一个标签页正持有旧版本连接，升级被阻塞 */
export class UpgradeBlockedError extends Error {
  constructor() {
    super('另一个标签页正在使用本应用的旧版本，数据库升级被阻塞。请关闭其他标签页后重试。')
    this.name = 'UpgradeBlockedError'
  }
}

/**
 * 读出本地库当前的 schema 版本；库不存在时返回 `NO_DATABASE`。
 *
 * 必须在打开目标版本**之前**知道当前版本，才能决定是否先导出备份（约束 10）。
 *
 * 这里依赖 `indexedDB.databases()` 而不做回退：用「不指定版本」打开一个不存在的库
 * 会凭空把它创建成一个没有任何 store 的 v1 空库，清理它就得调 deleteDatabase——
 * 而 deleteDatabase 是本地优先架构下数据丢失的头号来源，design.md D9 把它的全局
 * 出现次数守在零。宁可对过旧的浏览器明确报错，也不引入这条路径。
 */
export async function probeSchemaVersion(dbName: string = DB_NAME): Promise<number> {
  if (typeof indexedDB.databases !== 'function') throw new UnsupportedBrowserError()
  const found = (await indexedDB.databases()).find((d) => d.name === dbName)
  return found?.version ?? NO_DATABASE
}

export interface OpenOptions {
  readonly dbName?: string
  /** 默认为 `SCHEMA_VERSION`。测试用它构造版本不匹配的场景 */
  readonly expectedVersion?: number
  /**
   * 升级前的钩子，在旧版本仍然完好时调用（约束 10 的「迁移前自动导出备份」）。
   *
   * 任务 7.2 在这里接入备份导出。放成钩子而不是直接调用导出模块，是为了让
   * db.ts 不依赖导出实现——否则 storage/indexeddb 会反向依赖上层。
   */
  readonly beforeUpgrade?: (fromVersion: number, toVersion: number) => Promise<void>
  /**
   * 本连接因为挡住了另一个标签页的升级而被主动关闭时调用。
   *
   * 共享连接的缓存需要据此失效，否则缓存里会留着一个已关闭的连接。
   */
  readonly onConnectionClosed?: () => void
}

/**
 * 打开数据库，必要时按序执行迁移。
 *
 * 启动序列见 design.md D6。关键点是备份必须发生在 `openDB` 之前：
 * 迁移只能在 `onupgradeneeded` 里做，而那时旧结构已经在被改写了。
 */
export async function openDatabase(
  options: OpenOptions = {},
): Promise<IDBPDatabase<AppDb>> {
  const dbName = options.dbName ?? DB_NAME
  const expectedVersion = options.expectedVersion ?? SCHEMA_VERSION

  const localVersion = await probeSchemaVersion(dbName)

  if (localVersion > expectedVersion) {
    throw new FutureSchemaError(localVersion, expectedVersion)
  }

  const needsUpgrade = localVersion < expectedVersion
  if (needsUpgrade && options.beforeUpgrade && localVersion !== NO_DATABASE) {
    // 全新安装（localVersion === NO_DATABASE）没有数据可备份，跳过
    await options.beforeUpgrade(localVersion, expectedVersion)
  }

  return openDB<AppDb>(dbName, expectedVersion, {
    upgrade(db, oldVersion, newVersion) {
      const target = newVersion ?? expectedVersion
      // 唯一一次 cast：迁移遍历 STORES 动态建表，与 idb 要求 store 名为字面量
      // key 的签名不兼容。收窄到 SchemaWriter 这个最小接口，见 migrations/index.ts
      const writer = db as unknown as SchemaWriter
      for (const migration of MIGRATIONS) {
        if (migration.version > oldVersion && migration.version <= target) {
          migration.up(writer)
        }
      }
    },
    blocked() {
      throw new UpgradeBlockedError()
    },
    blocking(_currentVersion, _blockedVersion, event) {
      // 本连接正挡着另一个标签页的升级：主动让路，由对方完成升级。
      // 不让路的话两个标签页会互相等到超时。连接从事件上取，不碰共享缓存——
      // openDatabase 必须保持无副作用，否则测试直接调用它就会污染 getDatabase 的缓存。
      const target = event.target as IDBDatabase | null
      target?.close()
      options.onConnectionClosed?.()
    },
  })
}

// ── 共享连接 ────────────────────────────────────────────────────────────────

let cached: Promise<IDBPDatabase<AppDb>> | null = null
let opened: IDBPDatabase<AppDb> | null = null

/**
 * 取共享连接。Repository 层用它，不要各自开连接——多连接会让升级互相阻塞。
 *
 * 缓存的是 Promise 而不是连接本身：并发调用只会触发一次打开。
 */
export function getDatabase(options: OpenOptions = {}): Promise<IDBPDatabase<AppDb>> {
  cached ??= openDatabase({
    ...options,
    onConnectionClosed: () => {
      cached = null
      opened = null
      options.onConnectionClosed?.()
    },
  }).then((db) => {
    opened = db
    return db
  })
  return cached
}

/** 关闭共享连接并清空缓存。测试在用例之间调用它。 */
export function closeDatabase(): void {
  opened?.close()
  opened = null
  cached = null
}

/**
 * 取连接的方式。
 *
 * Repository 与事务包装都接受它，测试据此把每个用例指向独立的数据库名，
 * 不必重置 indexedDB 全局——测试代码因此完全不需要碰 IndexedDB API。
 */
export type DbProvider = () => Promise<IDBPDatabase<AppDb>>
