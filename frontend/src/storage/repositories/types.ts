/**
 * Repository 的接口契约。
 *
 * 本文件是**存储无关**的：它描述上层能对数据做什么，不描述怎么做。
 * IndexedDB 的实现在 `storage/indexeddb/repository.ts`，装配在 `./index.ts`。
 * 将来换 MySQL 时新增一份实现、改一处装配即可，本文件与全部调用方不动。
 *
 * 查询接口的形状本身就是查询规则的强制手段：`QuerySpec` 只允许「一个单字段索引
 * 取数 + 一个内存过滤函数」，复合游标在这个 API 里根本无法表达。这比「每次 review
 * 查询方法」可靠——写不出来，就不用检查。
 */
import type { BusinessRecordMap, BusinessStoreName, Uuid } from '@/entities'
import type { Now } from '@/storage/indexeddb/write.ts'
// 仅类型导入，编译后不留任何运行时依赖：索引名集合是 schema 的事实，
// 在这里重新声明一遍只会制造漂移。
import type { AppDb } from '@/storage/indexeddb/schema.ts'

/** store 名 → 记录类型 */
export type Row<N extends BusinessStoreName> = BusinessRecordMap[N]

/** 某张表上可用于取数的单字段索引名 */
export type IndexName<N extends BusinessStoreName> = keyof AppDb[N]['indexes'] & string

/**
 * 写事务句柄，对接口层不透明。
 *
 * 存在的理由：一条命令可能要原子地写多张表（例如新建训练单同时写 workout 与
 * workout_exercise），它们必须落在同一个事务里。不传则由实现自开事务。
 * 具体类型由存储实现决定，接口层只负责透传。
 */
export interface WriteTx {
  readonly __writeTx: unique symbol
}

/**
 * 取数条件。
 *
 * 对应的 SQL 形状固定为：
 *   SELECT * FROM <store>
 *   WHERE <index> = :equals            -- 或 BETWEEN :from AND :to
 *     AND deleted_at IS NULL           -- includeDeleted 为 false 时
 *   -- filter 对应其余的 AND 条件，在内存中完成
 */
export interface QuerySpec<N extends BusinessStoreName> {
  /** 用哪个单字段索引取数。省略则按主键全表取数 */
  readonly index?: IndexName<N>
  /** 索引等值取数。与 range 互斥 */
  readonly equals?: string
  /** 索引区间取数，闭区间。与 equals 互斥 */
  readonly range?: { readonly from?: string; readonly to?: string }
  /** 取数后的内存过滤 */
  readonly filter?: (row: Row<N>) => boolean
  /** 是否包含已软删除的记录。默认 false：常规查询把软删除的记录排除在外 */
  readonly includeDeleted?: boolean
  /** 取前 N 条。在过滤之后应用 */
  readonly limit?: number
}

export interface ListOptions {
  readonly includeDeleted?: boolean
  readonly limit?: number
}

/**
 * 整库替换能力。
 *
 * 单独抽出来而不是让调用方自己遍历各 Repository：清空与导入要落在一个事务里，
 * 而各 Repository 的写方法各自开事务，无法组合成一次原子操作。
 */
export interface BulkOperations {
  /** 清空全部表并按表名写入。未出现的表被清空但不写入 */
  replaceAll(
    records: Readonly<Record<string, readonly Record<string, unknown>[]>>,
  ): Promise<void>
  /** 清空全部表，不写入 */
  clearAll(): Promise<void>
}

/**
 * 只读视图：应用层经 `@/storage` 拿到的就是这个形状。
 *
 * 写方法不在这里，所以页面写 `exerciseRepo.put(...)` 是 TypeScript 编译错误
 * 而不是一条需要人去发现的 lint 警告。
 *
 * 读方法可选接受事务句柄。命令 handler 必须传它：在事务内 await 一个走独立
 * 连接的读取会把控制权交回事件循环，外层事务随即提交，后续写入就失败了。
 */
export interface ReadableRepository<N extends BusinessStoreName> {
  /** 列出本用户未软删除的记录。等价于 WHERE user_id = ? AND deleted_at IS NULL */
  list(options?: ListOptions, tx?: WriteTx): Promise<Row<N>[]>

  /**
   * 按主键取单条，**包含**已软删除的记录。
   *
   * 与 list 不同是有意的：历史纠错、导入去重、「这条到底删没删」都需要看到墓碑。
   * 要排除软删除的场景请用 list / query。
   */
  get(id: Uuid, tx?: WriteTx): Promise<Row<N> | undefined>

  query(spec: QuerySpec<N>, tx?: WriteTx): Promise<Row<N>[]>
}

/**
 * 完整接口，含写方法。只经 `@/storage/internal` 暴露给 `commands/**`。
 *
 * 写方法都接受可选的事务句柄，让一条命令能原子地写多张表。
 */
export interface Repository<N extends BusinessStoreName> extends ReadableRepository<N> {
  /**
   * 整条写入或覆盖。记录必须已带齐审计字段并通过字段规格校验，
   * 否则抛 RecordValidationError——脏数据不进库。
   */
  put(record: Row<N>, tx?: WriteTx): Promise<Row<N>>

  /**
   * 软删除：写 `deleted_at`，记录仍留在库中。
   * 记录不存在时返回 undefined；重复删除保持首次的删除时刻。
   */
  remove(id: Uuid, now: Now, tx?: WriteTx): Promise<Row<N> | undefined>

  /**
   * 按主键集合物理删除，返回实际删除的条数。
   *
   * 物理删除的例外之一，只服务于运动记录超过保留期的清理。不接受查询条件：
   * 「哪些记录超期」需要日界算术，那属于命令层；存储层只执行删除。
   *
   * 空集合是合法输入，返回 0 且不产生任何写入。主键不存在时跳过且不计入条数，
   * 因此返回值是真正被移除的记录数，而不是入参的长度。
   */
  purge(ids: readonly Uuid[], tx?: WriteTx): Promise<number>

  /**
   * 物理清空整张表。
   *
   * 物理删除的例外之一，只服务于「清空全部数据」与导入时的整库替换。
   * 常规删除一律走 remove。
   */
  clear(tx?: WriteTx): Promise<void>
}

/** 6 张业务表的 Repository 集合 */
export type RepositorySet = {
  readonly [N in BusinessStoreName]: Repository<N>
}

export type ReadableRepositorySet = {
  readonly [N in BusinessStoreName]: ReadableRepository<N>
}
