/**
 * 迁移链的按序执行、升级前备份，以及迁移失败后数据保持原状。
 *
 * 用人造的多版本迁移链而不是应用自带的那条：自带的链只有一个版本，覆盖不到
 * 「按顺序跑、跑到目标版本为止」这条真正容易出错的逻辑，而它第一次出错的时机
 * 恰好是老用户升级——开发者本地永远是全新安装，看不到。
 */
import {
  MigrationFailedError,
  closeDatabase,
  openDatabase,
  probeSchemaVersion,
} from '@/storage/indexeddb/db.ts'
import type { DatabaseSnapshot } from '@/storage/indexeddb/dump.ts'
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  validateMigrationChain,
  type Migration,
} from '@/storage/indexeddb/migrations/index.ts'
import { uniqueDbName } from '@/test/fixtures.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => closeDatabase())

/** 每条迁移建一张以自己版本号命名的表，执行顺序因此可以从结果读出来 */
function chainOf(versions: readonly number[], order: number[] = []): Migration[] {
  return versions.map((version) => ({
    version,
    up: (db) => {
      order.push(version)
      db.createObjectStore(`v${version}`, { keyPath: 'id' })
    },
  }))
}

describe('迁移链的形状', () => {
  it('应用自带的链是一版一条、从 1 开始、无空缺', () => {
    expect(validateMigrationChain()).toEqual([])
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length)
  })

  it('版本号错位时报出位置', () => {
    expect(validateMigrationChain(chainOf([1, 3]))).toHaveLength(1)
    expect(validateMigrationChain(chainOf([1, 3]))[0]).toContain('应为 2')
  })

  it('空链不被接受', () => {
    expect(validateMigrationChain([])).toHaveLength(1)
  })
})

describe('按序执行', () => {
  it('全新安装从 0 跑完整条链，顺序不颠倒', async () => {
    const order: number[] = []
    const db = await openDatabase({
      dbName: uniqueDbName('chain-fresh'),
      migrations: chainOf([1, 2, 3], order),
    })

    expect(order).toEqual([1, 2, 3])
    expect(db.version).toBe(3)
    expect([...db.objectStoreNames].sort()).toEqual(['v1', 'v2', 'v3'])
    db.close()
  })

  it('旧库只补跑缺的那几条', async () => {
    const name = uniqueDbName('chain-upgrade')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    atV1.close()
    closeDatabase()

    const order: number[] = []
    const atV3 = await openDatabase({
      dbName: name,
      migrations: chainOf([1, 2, 3], order),
    })

    // 版本 1 已经跑过，不应重复执行
    expect(order).toEqual([2, 3])
    expect(atV3.version).toBe(3)
    atV3.close()
  })

  it('期望版本低于链长时只跑到该版本为止', async () => {
    const order: number[] = []
    const db = await openDatabase({
      dbName: uniqueDbName('chain-partial'),
      migrations: chainOf([1, 2, 3], order),
      expectedVersion: 2,
    })

    expect(order).toEqual([1, 2])
    expect(db.version).toBe(2)
    expect([...db.objectStoreNames].sort()).toEqual(['v1', 'v2'])
    db.close()
  })
})

describe('升级前备份', () => {
  it('升级路径必产生备份，内容是升级前的数据', async () => {
    const name = uniqueDbName('backup')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    await atV1.put('v1' as never, { id: 'row-1', note: '升级前就存在' } as never)
    atV1.close()
    closeDatabase()

    const snapshots: DatabaseSnapshot[] = []
    const upgraded = await openDatabase({
      dbName: name,
      migrations: chainOf([1, 2]),
      onBackup: async (snapshot) => {
        snapshots.push(snapshot)
      },
    })

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.schema_version).toBe(1)
    expect(snapshots[0]?.records.v1).toEqual([{ id: 'row-1', note: '升级前就存在' }])
    // 备份反映的是旧结构：升级后才出现的表不该在里面
    expect(snapshots[0]?.records.v2).toBeUndefined()

    expect(upgraded.version).toBe(2)
    upgraded.close()
  })

  it('备份连接在升级开始前关闭，不阻塞升级', async () => {
    const name = uniqueDbName('backup-no-block')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    atV1.close()
    closeDatabase()

    // 备份若不关闭连接，升级会卡在 blocked 上而不是正常完成
    const upgraded = await openDatabase({
      dbName: name,
      migrations: chainOf([1, 2]),
      onBackup: async () => {},
    })

    expect(upgraded.version).toBe(2)
    upgraded.close()
  })

  it('备份钩子抛错则中止升级，不留下半升级的库', async () => {
    const name = uniqueDbName('backup-fails')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    atV1.close()
    closeDatabase()

    await expect(
      openDatabase({
        dbName: name,
        migrations: chainOf([1, 2]),
        onBackup: async () => {
          throw new Error('写备份文件失败')
        },
      }),
    ).rejects.toThrow('写备份文件失败')

    expect(await probeSchemaVersion(name)).toBe(1)
  })
})

describe('迁移失败', () => {
  function failingChain(order: number[]): Migration[] {
    return [
      ...chainOf([1], order),
      {
        version: 2,
        up: () => {
          order.push(2)
          throw new Error('这条迁移写坏了')
        },
      },
    ]
  }

  it('数据库停留在升级前的版本与内容上', async () => {
    const name = uniqueDbName('migration-fails')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    await atV1.put('v1' as never, { id: 'row-1', note: '必须完好' } as never)
    atV1.close()
    closeDatabase()

    await expect(
      openDatabase({ dbName: name, migrations: failingChain([]) }),
    ).rejects.toThrow(MigrationFailedError)

    expect(await probeSchemaVersion(name)).toBe(1)

    const reopened = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    expect([...reopened.objectStoreNames]).toEqual(['v1'])
    expect(await reopened.get('v1' as never, 'row-1' as never)).toEqual({
      id: 'row-1',
      note: '必须完好',
    })
    reopened.close()
  })

  it('错误带上版本区间与备份是否已生成', async () => {
    const name = uniqueDbName('migration-fails-detail')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    atV1.close()
    closeDatabase()

    const onBackup = vi.fn(async () => {})
    const error = (await openDatabase({
      dbName: name,
      migrations: failingChain([]),
      onBackup,
    }).catch((e: unknown) => e)) as MigrationFailedError

    expect(error).toBeInstanceOf(MigrationFailedError)
    expect(error.fromVersion).toBe(1)
    expect(error.toVersion).toBe(2)
    expect(error.backupTaken).toBe(true)
    expect(onBackup).toHaveBeenCalledOnce()
    expect(error.message).toContain('备份')
  })

  it('没有备份时不声称有备份', async () => {
    const name = uniqueDbName('migration-fails-nobackup')

    const atV1 = await openDatabase({ dbName: name, migrations: chainOf([1]) })
    atV1.close()
    closeDatabase()

    const error = (await openDatabase({
      dbName: name,
      migrations: failingChain([]),
    }).catch((e: unknown) => e)) as MigrationFailedError

    expect(error.backupTaken).toBe(false)
    expect(error.message).not.toContain('备份')
  })
})
