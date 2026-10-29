/**
 * 整库替换：清空全部表并写入一批记录。
 *
 * 只在两处使用：从导出文件导入，以及清空全部数据。两者都是整库级操作，与逐条
 * 增删改走的不是同一条路径——它们必须在一个事务内完成，中途失败时库要么是原样，
 * 要么是新样，不存在第三种。
 *
 * 与业务记录的软删除不同，这里的清空是物理删除。软删除的目的是让删除能被同步、
 * 多端不出现复活，而整库替换表达的是「这份数据整体被另一份取代」，留下墓碑只会
 * 让下一份数据与旧残留混在一起。
 */
import type { StoreName } from '@/entities'
import type { IDBPDatabase } from 'idb'
import type { WriteTx } from '@/storage/repositories/types.ts'
import type { AppDb } from './schema.ts'
import { assertValidRecord } from './write.ts'

/**
 * 读写事务里的 store 句柄。
 *
 * 只用整库替换需要的三个能力。事务句柄对上层不透明，这里是唯一还原它的地方。
 */
interface ReplaceStore {
  clear(): Promise<unknown>
  put(value: unknown): Promise<unknown>
}

function storeFor(tx: WriteTx, name: StoreName): ReplaceStore {
  return (tx as unknown as { objectStore(n: string): ReplaceStore }).objectStore(name)
}

/**
 * 清空全部表并按 `records` 写入。
 *
 * `records` 以表名索引，未出现的表被清空但不写入。记录在写入前逐条按字段规格
 * 校验：导入路径此前已做过全量校验，但这层不能假设调用方验过，而一次失败的写入
 * 会让整个事务回滚，代价是用户的整次导入白做。
 */
export async function replaceAllInTransaction(
  db: IDBPDatabase<AppDb>,
  tx: WriteTx,
  records: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): Promise<void> {
  for (const name of [...db.objectStoreNames] as StoreName[]) {
    const store = storeFor(tx, name)
    await store.clear()

    for (const row of records[name] ?? []) {
      assertValidRecord(name, row)
      await store.put(row)
    }
  }
}

/**
 * 清空全部表，不写入任何记录。
 *
 * 清空之后应用回到首次使用状态：同意记录一并消失，界面会重新要求用户同意。
 */
export async function clearAllInTransaction(
  db: IDBPDatabase<AppDb>,
  tx: WriteTx,
): Promise<void> {
  for (const name of [...db.objectStoreNames] as StoreName[]) {
    await storeFor(tx, name).clear()
  }
}
