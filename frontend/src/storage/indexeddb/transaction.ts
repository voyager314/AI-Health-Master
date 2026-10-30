/**
 * 命令事务：业务写入与 `pending_ops` 日志的原子边界。
 *
 * 每条命令都必须留下 `pending_ops` 日志，且与业务写入同生共死。追加写在本文件里，
 * 而不是交给各个命令的 handler——否则「这条命令有没有记日志」会变成每个 handler
 * 的自觉，这条规则就退化成了口头约定。handler 拿到的只有一个事务句柄，
 * 它既跳不过日志，也开不了自己的事务。
 */
import type { PendingOp, StoreName } from '@/entities'
import type { BulkOperations, WriteTx } from '@/storage/repositories/types.ts'
import { v7 as uuidv7 } from 'uuid'
import { getDatabase, type DbProvider } from './db.ts'
import { clearAllInTransaction, replaceAllInTransaction } from './transfer.ts'
import { assertValidRecord, type Now } from './write.ts'

/** 写入失败的原因分类，决定界面提示什么、要不要给重试入口 */
export type WriteFailureReason = 'quota_exceeded' | 'constraint' | 'unknown'

/**
 * 本地存储写入失败。
 *
 * 携带足够界面用的信息：失败原因、是否可重试、原始错误。
 * 空间不足时要提示用户「先导出数据、再清理历史图片」并给出重试入口，
 * 文案由界面层按 `reason` 决定，这里只负责把原因如实分类传上去。
 */
export class StorageWriteError extends Error {
  readonly commandType: string
  readonly reason: WriteFailureReason
  readonly retryable: boolean

  constructor(
    commandType: string,
    reason: WriteFailureReason,
    options: { cause?: unknown } = {},
  ) {
    super(MESSAGES[reason], options)
    this.name = 'StorageWriteError'
    this.commandType = commandType
    this.reason = reason
    // 配额满在用户清理之后重试就能成功；约束冲突重试多少次都一样
    this.retryable = reason !== 'constraint'
  }
}

const MESSAGES: Record<WriteFailureReason, string> = {
  quota_exceeded: '本地存储空间不足，这次没有保存成功。建议先导出数据，再清理历史图片后重试。',
  constraint: '数据不符合约束，这次没有保存成功。',
  unknown: '写入本地数据库失败，这次没有保存成功。',
}

function classify(error: unknown): WriteFailureReason {
  if (error instanceof Error) {
    // Chrome / Safari 用 QuotaExceededError，Firefox 旧版用 NS_ERROR_DOM_QUOTA_REACHED
    if (error.name === 'QuotaExceededError') return 'quota_exceeded'
    if (error.name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota_exceeded'
    if (error.name === 'ConstraintError') return 'constraint'
  }
  return 'unknown'
}

export interface CommandTransactionOptions {
  readonly commandType: string
  /**
   * 这条命令会用到哪些表。少声明一个，handler 访问它时会抛 NotFoundError；
   * 多声明则无谓地扩大锁范围。
   *
   * 整库替换类命令会声明全部表，这是它需要的锁范围，不是越权。
   */
  readonly stores: readonly StoreName[]
  /** 原样记进 pending_ops，必须是可结构化克隆的纯数据 */
  readonly payload: unknown
  /** 必须在开事务之前算好（IndexedDB 事务不能跨非数据库的 await） */
  readonly now: Now
  /**
   * 跳过写操作日志。
   *
   * 整库替换时载荷就是整个数据集，再把它复制一份进日志既无意义也浪费配额；
   * 而这条命令本身也不需要在云端重放。只有「整库替换」这一类命令该用它。
   */
  readonly skipOpLog?: boolean
  /**
   * 处理器跑完之后决定这次要不要留下日志。省略则一律留下。
   *
   * 回调在业务写入完成之后、写日志之前调用，因此它能看到这次执行的真实结果，
   * 而不是凭载荷猜测。「成功但什么都没写」的命令靠它免掉一条凭空的操作历史。
   */
  shouldLog?(result: unknown): boolean
  readonly getDb?: DbProvider
}

/**
 * 在单个读写事务里跑完一条命令，并在同一事务内追加 `pending_ops`。
 *
 * 成功只有一种情形：handler 与日志都写成功且事务提交。任何一步失败都整体回滚，
 * 既不留下半条业务数据，也不留下这条已失败命令的日志。
 *
 * ⚠️ `run` 内禁止 `await` 任何非 IndexedDB 的 Promise。IndexedDB 事务会在控制权
 * 交回事件循环时自动提交，之后的写入会抛 `TransactionInactiveError`——这个限制
 * 无法用类型表达，但违反时会立刻以可见的方式失败，不会静默丢数据。
 */
export async function runCommandTransaction<T>(
  options: CommandTransactionOptions,
  run: (tx: WriteTx, bulk: BulkOperations) => Promise<T>,
): Promise<T> {
  const getDb = options.getDb ?? (() => getDatabase())
  const db = await getDb()

  const stores: StoreName[] = options.skipOpLog
    ? [...options.stores]
    : [...new Set([...options.stores, 'pending_ops' as const])]

  const op: PendingOp | null = options.skipOpLog
    ? null
    : {
        id: uuidv7(),
        command_type: options.commandType,
        payload: options.payload,
        applied_at: options.now.iso,
        tz_offset_minutes: options.now.tzOffsetMinutes,
      }

  if (op) {
    // 日志记录本身也要合规，否则一条坏日志会把整条命令连累回滚
    assertValidRecord('pending_ops', op)
  }

  const tx = db.transaction(stores, 'readwrite')
  const handle = tx as unknown as WriteTx

  const bulk: BulkOperations = {
    replaceAll: (records) => replaceAllInTransaction(db, handle, records),
    clearAll: () => clearAllInTransaction(db, handle),
  }

  try {
    const result = await run(handle, bulk)
    if (op && (options.shouldLog?.(result) ?? true)) {
      await tx.objectStore('pending_ops').put(op)
    }
    await tx.done
    return result
  } catch (error) {
    abortQuietly(tx)
    throw new StorageWriteError(options.commandType, classify(error), { cause: error })
  }
}

/**
 * 中止事务并吞掉随之而来的 `tx.done` 拒绝。
 *
 * 不吞的话每次命令失败都会多出一个未处理的 Promise 拒绝，在浏览器里表现为
 * 一条与真实错误无关的报错，掩盖真正的原因。
 */
function abortQuietly(tx: { abort: () => void; done: Promise<unknown> }): void {
  tx.done.catch(() => undefined)
  try {
    tx.abort()
  } catch {
    // 事务可能已因错误自动中止，再次 abort 会抛 InvalidStateError
  }
}
