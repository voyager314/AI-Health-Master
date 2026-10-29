/**
 * 任务 2.2 的验收：数据库打开与版本策略。
 */
import {
  FutureSchemaError,
  NO_DATABASE,
  SCHEMA_VERSION,
  closeDatabase,
  openDatabase,
  probeSchemaVersion,
} from '@/storage/indexeddb/db.ts'
import { LATEST_SCHEMA_VERSION, validateMigrationChain } from '@/storage/indexeddb/migrations/index.ts'
import { uniqueDbName } from '@/test/fixtures.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => closeDatabase())

describe('版本探测', () => {
  it('库不存在时返回 NO_DATABASE，且不会凭空创建出一个空库', async () => {
    const name = uniqueDbName('absent')

    expect(await probeSchemaVersion(name)).toBe(NO_DATABASE)

    // 探测本身不得有副作用：这正是不用「无版本号打开」做回退的原因——
    // 那种写法会把不存在的库创建成一个没有 store 的 v1 空库
    const listed = (await indexedDB.databases()).map((d) => d.name)
    expect(listed).not.toContain(name)
  })

  it('库存在时返回其当前版本', async () => {
    const name = uniqueDbName('present')
    const db = await openDatabase({ dbName: name })
    db.close()
    closeDatabase()

    expect(await probeSchemaVersion(name)).toBe(SCHEMA_VERSION)
  })
})

describe('打开与迁移策略', () => {
  it('schema_version 由迁移链长度推导，迁移链是一版一条', () => {
    expect(validateMigrationChain()).toEqual([])
    expect(SCHEMA_VERSION).toBe(LATEST_SCHEMA_VERSION)
  })

  it('全新安装直接建到期望版本，且不触发备份钩子（没有数据可备份）', async () => {
    const onBackup = vi.fn(async () => {})
    const db = await openDatabase({
      dbName: uniqueDbName('fresh'),
      onBackup,
    })

    expect(db.version).toBe(SCHEMA_VERSION)
    expect(onBackup).not.toHaveBeenCalled()
    db.close()
  })

  it('版本相同时不迁移、不备份', async () => {
    const name = uniqueDbName('same-version')
    const first = await openDatabase({ dbName: name })
    first.close()
    closeDatabase()

    const onBackup = vi.fn(async () => {})
    const second = await openDatabase({ dbName: name, onBackup })

    expect(second.version).toBe(SCHEMA_VERSION)
    expect(onBackup).not.toHaveBeenCalled()
    second.close()
  })

  it('本地版本高于期望版本时拒绝启动，抛 FutureSchemaError', async () => {
    const name = uniqueDbName('future')

    // 先造一个版本比应用期望值更高的库，模拟「另一处用新版应用写过数据」
    const ahead = await openDatabase({
      dbName: name,
      expectedVersion: SCHEMA_VERSION + 1,
    })
    expect(ahead.version).toBe(SCHEMA_VERSION + 1)
    ahead.close()
    closeDatabase()

    await expect(
      openDatabase({ dbName: name, expectedVersion: SCHEMA_VERSION }),
    ).rejects.toThrow(FutureSchemaError)

    // 拒绝启动必须是无副作用的：旧版应用不能把新结构改回去
    expect(await probeSchemaVersion(name)).toBe(SCHEMA_VERSION + 1)
  })

  it('FutureSchemaError 带上两边的版本号，便于提示用户升级', async () => {
    const name = uniqueDbName('future-detail')
    const ahead = await openDatabase({ dbName: name, expectedVersion: 3 })
    ahead.close()
    closeDatabase()

    const error = await openDatabase({ dbName: name, expectedVersion: 1 }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(FutureSchemaError)
    expect((error as FutureSchemaError).localVersion).toBe(3)
    expect((error as FutureSchemaError).expectedVersion).toBe(1)
  })
})
