/**
 * 数据库快照。
 *
 * 一份快照就是全库数据的纯数据表示，不涉及文件、下载或编码。升级前的自动备份与
 * 用户主动导出取的是同一份东西，分歧只会出现在「备份能恢复、导出不能」这类
 * 最坏的地方，所以两者共用这一处实现。
 *
 * 快照按连接当时实际存在的 store 遍历，而不是按当前代码里的表清单：备份发生在
 * 升级之前，那时库里的结构属于旧版本，可能比现在少几张表。
 */
import type { ExportableSnapshot } from '@/domain'
import type { IDBPDatabase } from 'idb'
import { getDatabase, type DbProvider } from './db.ts'
import type { AppDb } from './schema.ts'

/**
 * 不进入快照的 store。
 *
 * `pending_ops` 是写操作日志而非数据状态，重放它会把已经发生的写入再做一遍。
 * `blob` 是二进制，混进纯数据快照会让文件膨胀到无法传输。
 */
const EXCLUDED_STORES = new Set(['pending_ops', 'blob'])

/**
 * 全库快照。
 *
 * 形状由领域层定义——它同时描述导出文件的结构，两者是同一个东西：升级前的备份
 * 与用户主动导出取的必须是同一份数据，否则会出现「备份能恢复、导出不能」。
 * 存储层只负责产出它，不另外定义一遍。
 */
export type DatabaseSnapshot = ExportableSnapshot

/** 已软删除的记录不进快照；没有这个字段的 store 全部保留 */
function isLive(record: Record<string, unknown>): boolean {
  return !('deleted_at' in record) || record.deleted_at === null
}

/**
 * 读出全库快照。
 *
 * `takenAt` 为 UTC ISO 8601 时刻，由调用方给出而非在此刻取，使同一批操作中的
 * 多个时间戳保持一致。
 */
export async function dumpDatabase(
  db: IDBPDatabase<AppDb>,
  takenAt: string,
): Promise<DatabaseSnapshot> {
  const records: Record<string, Record<string, unknown>[]> = {}

  for (const name of db.objectStoreNames) {
    if (EXCLUDED_STORES.has(name)) continue
    const rows = (await db.getAll(name)) as unknown as Record<string, unknown>[]
    records[name] = rows.filter(isLive)
  }

  return { schema_version: db.version, exported_at: takenAt, records }
}

/**
 * 用默认连接取快照。
 *
 * `getDb` 可注入：测试据此指向自己那个库，不必碰共享连接的状态。
 */
export async function snapshotDatabase(
  takenAt: string,
  getDb: DbProvider = () => getDatabase(),
): Promise<DatabaseSnapshot> {
  return dumpDatabase(await getDb(), takenAt)
}
