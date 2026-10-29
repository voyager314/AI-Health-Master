/**
 * Command 层的契约。
 *
 * 一条命令声明三件事：它叫什么、会写哪些表、怎么写。除此之外它拿不到别的能力——
 * 开不了自己的事务、跳不过 `pending_ops` 日志、看不到 `user_id`。写操作只能经由
 * 这一条统一入口，`user_id` 由存储层统一注入、业务代码不传——API 的形状本身保证
 * 了这两点无法被绕过。
 */
import type { StoreName, ValidationIssue } from '@/entities'
import type { BulkOperations, Now, RepositorySet, WriteTx } from '@/storage/internal'

/**
 * handler 能用的全部能力。
 *
 * 只有事务句柄、已算好的时刻、Repository 集合与整库替换能力——没有任何可能触发
 * 外部异步的东西。这是「事务内禁止 await 非数据库 Promise」在签名上的体现：
 * 不是靠约定，而是手里没有能违反它的工具。
 */
export interface CommandContext {
  readonly tx: WriteTx
  /** 由总线在开事务**之前**算好，handler 不要再取当前时间 */
  readonly now: Now
  readonly repos: RepositorySet
  /** 整库级操作。清空与导入之外，命令不应该用到它 */
  readonly bulk: BulkOperations
}

export interface CommandDefinition<P = unknown, R = void> {
  /** 全局唯一。建议 `<实体>/<动作>` 形式，如 `body_metric/record` */
  readonly type: string

  /**
   * 这条命令会用到哪些表。事务按此开。
   *
   * 少声明一张表，handler 访问它时会抛 NotFoundError；多声明则会无谓地扩大锁范围。
   * 整库替换类命令声明全部表——那是它确实需要的锁范围。
   */
  readonly stores: readonly StoreName[]

  /**
   * 跳过写操作日志。
   *
   * 整库替换时载荷就是整个数据集，把它再复制一份进日志既无意义也浪费配额；
   * 这类命令也不需要跨设备重放。只有「整库替换」该用它。
   */
  readonly skipOpLog?: boolean

  /**
   * 校验载荷。返回非空问题列表则拒绝执行，且不碰数据库。
   *
   * 这里校验的是**命令载荷**，与落库前的记录校验是两回事：载荷是用户意图
   * （「把体重记成 72.6」），记录是存储形态（带审计字段）。
   */
  readonly validate?: (payload: unknown) => ValidationIssue[]

  readonly handler: (ctx: CommandContext, payload: P) => Promise<R>
}

/** 仅用于保留类型信息，运行时就是恒等函数 */
export function defineCommand<P, R>(
  definition: CommandDefinition<P, R>,
): CommandDefinition<P, R> {
  return definition
}

export class UnknownCommandError extends Error {
  readonly commandType: string

  constructor(commandType: string, known: readonly string[]) {
    super(
      `未注册的命令类型 ${commandType}。已注册的有：${known.length > 0 ? known.join('、') : '（无）'}`,
    )
    this.name = 'UnknownCommandError'
    this.commandType = commandType
  }
}

export class CommandPayloadError extends Error {
  readonly commandType: string
  readonly issues: readonly ValidationIssue[]

  constructor(commandType: string, issues: readonly ValidationIssue[]) {
    super(
      `命令 ${commandType} 的载荷不合法：\n${issues.map((i) => `  ${i.field}: ${i.message}`).join('\n')}`,
    )
    this.name = 'CommandPayloadError'
    this.commandType = commandType
    this.issues = issues
  }
}

export class DuplicateCommandError extends Error {
  constructor(commandType: string) {
    super(`命令类型 ${commandType} 被注册了多次，后一条会静默覆盖前一条`)
    this.name = 'DuplicateCommandError'
  }
}
