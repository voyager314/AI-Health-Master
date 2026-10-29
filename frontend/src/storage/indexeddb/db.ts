/**
 * 数据库连接与版本策略。
 *
 * 本文件与同目录下的 schema / migrations 是全仓库唯一允许触碰 IndexedDB API 的地方
 * （约束 1，由 ESLint 强制）。其余各层经 Repository 访问存储。
 */
import { openDB, type IDBPDatabase } from 'idb'
import { dumpDatabase, type DatabaseSnapshot } from './dump.ts'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  type Migration,
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
  /** 期望的结构版本。默认取迁移链的长度 */
  readonly expectedVersion?: number
  /** 要执行的迁移链。默认为应用自带的那条，测试用它构造多版本升级场景 */
  readonly migrations?: readonly Migration[]
  /**
   * 升级前拿到旧库快照，用于把备份落盘。
   *
   * 快照在旧结构仍然完好时取得，调用方负责持久化它。做成钩子而不是直接写文件，
   * 是为了让数据库层不关心文件、下载与编码——那些依赖属于上层。
   *
   * 全新安装不会触发：没有数据可备份。
   */
  readonly onBackup?: (snapshot: DatabaseSnapshot, fromVersion: number) => Promise<void>
  /**
   * 本连接因为挡住了另一个标签页的升级而被主动关闭时调用。
   *
   * 共享连接的缓存需要据此失效，否则缓存里会留着一个已关闭的连接。
   */
  readonly onConnectionClosed?: () => void
}

/**
 * 迁移失败。
 *
 * 升级事务被中止，数据库停留在原版本与原内容上。`backupTaken` 指出此前是否已经
 * 取到备份，界面据此决定要不要告诉用户去哪里找它。
 */
export class MigrationFailedError extends Error {
  readonly fromVersion: number
  readonly toVersion: number
  readonly backupTaken: boolean

  constructor(
    fromVersion: number,
    toVersion: number,
    backupTaken: boolean,
    options: { cause?: unknown } = {},
  ) {
    super(
      backupTaken
        ? `从版本 ${fromVersion} 升级到 ${toVersion} 失败。数据保持升级前的状态，升级前的备份已经生成。`
        : `从版本 ${fromVersion} 升级到 ${toVersion} 失败。数据保持升级前的状态。`,
      options,
    )
    this.name = 'MigrationFailedError'
    this.fromVersion = fromVersion
    this.toVersion = toVersion
    this.backupTaken = backupTaken
  }
}

/**
 * 打开数据库，必要时按序执行迁移。
 *
 * 升级前先取备份，而且必须在打开目标版本之前完成：结构改写发生在升级回调里，
 * 等到那时旧结构已经不在了，再想读出原样的数据就来不及。为此备份会用旧版本号
 * 单独开一次连接，读完立刻关闭——不关的话它会挡住接下来的升级。
 */
export async function openDatabase(
  options: OpenOptions = {},
): Promise<IDBPDatabase<AppDb>> {
  const dbName = options.dbName ?? DB_NAME
  const migrations = options.migrations ?? MIGRATIONS
  const expectedVersion = options.expectedVersion ?? migrations.length

  const localVersion = await probeSchemaVersion(dbName)

  if (localVersion > expectedVersion) {
    throw new FutureSchemaError(localVersion, expectedVersion)
  }

  const needsUpgrade = localVersion < expectedVersion
  const hasExistingData = localVersion !== NO_DATABASE

  let backupTaken = false
  if (needsUpgrade && hasExistingData && options.onBackup) {
    const previous = await openDB<AppDb>(dbName, localVersion)
    try {
      await options.onBackup(
        await dumpDatabase(previous, new Date().toISOString()),
        localVersion,
      )
      backupTaken = true
    } finally {
      previous.close()
    }
  }

  try {
    return await openDB<AppDb>(dbName, expectedVersion, {
      upgrade(db, oldVersion, newVersion, transaction) {
        // 迁移抛错会让升级事务被中止，而中止会让 transaction.done 拒绝。失败原因
        // 已经由 openDB 的 promise 带出，这条拒绝是同一件事的第二份信号；不接住
        // 它就会变成一个与真实原因无关的未处理拒绝，盖住真正该看的那条错误。
        transaction.done.catch(() => undefined)

        const target = newVersion ?? expectedVersion
        // 唯一一次 cast：迁移遍历表清单动态建表，与 idb 要求 store 名为字面量
        // key 的签名不兼容，收窄到建表所需的最小接口
        const writer = db as unknown as SchemaWriter
        for (const migration of migrations) {
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
        // openDatabase 必须保持无副作用，否则测试直接调用它就会污染共享连接的缓存。
        const target = event.target as IDBDatabase | null
        target?.close()
        options.onConnectionClosed?.()
      },
    })
  } catch (error) {
    if (error instanceof UpgradeBlockedError) throw error
    if (!needsUpgrade) throw error
    throw new MigrationFailedError(localVersion, expectedVersion, backupTaken, {
      cause: error,
    })
  }
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
