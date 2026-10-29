/**
 * Repository 契约的 IndexedDB 实现。
 *
 * 契约在 `storage/repositories/types.ts`，装配在 `storage/repositories/index.ts`。
 * 换 MySQL 时新增一份同名工厂、改一处装配即可，调用方不动（约束 1）。
 *
 * 本文件在 storage/indexeddb/ 下，是全仓库允许直接使用 IndexedDB API 的地方之一。
 */
import type { BusinessStoreName, Uuid } from '@/entities'
import type {
  ListOptions,
  QuerySpec,
  Repository,
  Row,
  WriteTx,
} from '@/storage/repositories/types.ts'
import { getDatabase, type DbProvider } from './db.ts'
import {
  LOCAL_USER_ID,
  assertValidRecord,
  withAuditForSoftDelete,
  type Now,
} from './write.ts'

export type { DbProvider }

/**
 * 把 QuerySpec 的取数条件翻成 IDBKeyRange。
 *
 * 只支持等值与闭区间——这两种恰好对应 SQL 的 `= ?` 与 `BETWEEN ? AND ?`，
 * 再复杂的条件一律落到内存过滤（约束 8）。
 */
function toKeyRange<N extends BusinessStoreName>(
  spec: QuerySpec<N>,
): IDBKeyRange | undefined {
  if (spec.equals !== undefined) return IDBKeyRange.only(spec.equals)
  if (!spec.range) return undefined

  const { from, to } = spec.range
  if (from !== undefined && to !== undefined) return IDBKeyRange.bound(from, to)
  if (from !== undefined) return IDBKeyRange.lowerBound(from)
  if (to !== undefined) return IDBKeyRange.upperBound(to)
  return undefined
}

/**
 * 事务句柄对契约层不透明（见 types.ts 的 WriteTx），这里是唯一一处还原它的地方。
 *
 * idb 的事务类型要求在泛型里列出参与的 store 名，而 Repository 是按单表泛型化的，
 * 两者对不上；收窄到实际用到的 `objectStore` 能力即可。
 */
interface TxLike {
  objectStore(name: string): {
    put(value: unknown): Promise<unknown>
    get(key: string): Promise<unknown>
    clear(): Promise<unknown>
  }
}

function storeFromTx<N extends BusinessStoreName>(tx: WriteTx, store: N) {
  return (tx as unknown as TxLike).objectStore(store)
}

export function createIndexedDbRepository<N extends BusinessStoreName>(
  store: N,
  getDb: DbProvider = () => getDatabase(),
): Repository<N> {
  type R = Row<N>

  async function query(spec: QuerySpec<N>): Promise<R[]> {
    const db = await getDb()

    // 取数：只用主键全表扫，或单个单字段索引。没有第三种形态（约束 8）
    const rows = (
      spec.index
        ? await db.getAllFromIndex(store, spec.index as never, toKeyRange(spec) as never)
        : await db.getAll(store)
    ) as R[]

    // 其余条件全部在内存里完成
    let out = spec.includeDeleted ? rows : rows.filter((r) => r.deleted_at === null)
    if (spec.filter) out = out.filter(spec.filter)
    if (spec.limit !== undefined) out = out.slice(0, spec.limit)
    return out
  }

  async function list(options: ListOptions = {}): Promise<R[]> {
    // 默认按 user_id 索引取数，而不是全表扫。本期 user_id 恒为 'local'，结果一样，
    // 但查询形状已经是上云后需要的那条：WHERE user_id = ? AND deleted_at IS NULL
    return query({
      index: 'user_id' as never,
      equals: LOCAL_USER_ID,
      includeDeleted: options.includeDeleted,
      limit: options.limit,
    })
  }

  async function get(id: Uuid): Promise<R | undefined> {
    const db = await getDb()
    // 不过滤 deleted_at：按主键取单条要能看到墓碑（见 types.ts 的说明）
    return (await db.get(store, id)) as R | undefined
  }

  async function put(record: R, tx?: WriteTx): Promise<R> {
    // 校验在写之前：字段拼错或类型不对若被写进去，要到上云建表时才暴露
    assertValidRecord(store, record)

    if (tx) {
      await storeFromTx(tx, store).put(record)
      return record
    }
    const db = await getDb()
    await db.put(store, record as never)
    return record
  }

  async function remove(id: Uuid, now: Now, tx?: WriteTx): Promise<R | undefined> {
    if (tx) {
      const os = storeFromTx(tx, store)
      const existing = (await os.get(id)) as R | undefined
      if (!existing) return undefined
      const removed = withAuditForSoftDelete(existing, now)
      await os.put(removed)
      return removed
    }

    const db = await getDb()
    const existing = (await db.get(store, id)) as R | undefined
    if (!existing) return undefined
    const removed = withAuditForSoftDelete(existing, now)
    await db.put(store, removed as never)
    return removed
  }

  async function clear(tx?: WriteTx): Promise<void> {
    if (tx) {
      await storeFromTx(tx, store).clear()
      return
    }
    const db = await getDb()
    await db.clear(store)
  }

  return { list, get, query, put, remove, clear }
}

