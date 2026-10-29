/**
 * 命令总线：`applyCommand` 的实现。
 *
 * 执行顺序：
 *   1. 查注册表——未注册直接抛错，不碰数据库
 *   2. 校验载荷——不合法直接抛错，不碰数据库
 *   3. 取当前时刻与时区偏移——必须在开事务**之前**完成
 *   4. 在单个事务内跑 handler，并在同一事务追加 pending_ops
 *
 * 第 3 步的位置是关键：IndexedDB 事务会在控制权交回事件循环时自动提交，
 * 事务内任何非数据库的 await 都会让后续写入失败。
 */
import {
  createNow,
  repositories as defaultRepositories,
  runCommandTransaction,
  type DbProvider,
  type RepositorySet,
} from '@/storage/internal'
import {
  CommandPayloadError,
  DuplicateCommandError,
  UnknownCommandError,
  type CommandDefinition,
} from './types.ts'

export interface CommandBus {
  /** 执行一条命令。失败时抛 UnknownCommandError / CommandPayloadError / StorageWriteError */
  apply(type: string, payload?: unknown): Promise<unknown>
  /** 已注册的命令类型，供诊断与错误提示使用 */
  readonly types: readonly string[]
}

export interface CommandBusOptions {
  readonly definitions: readonly CommandDefinition<never, unknown>[]
  /** 默认用应用的 Repository 集合。测试注入指向独立库的集合 */
  readonly repos?: RepositorySet
  readonly getDb?: DbProvider
  /** 注入固定时钟，让时间相关的断言可重复 */
  readonly clock?: () => Date
}

/**
 * 用一组命令定义装配一条总线。
 *
 * 用显式的定义数组而不是全局可变的 `registerCommand`：后者的注册时机取决于模块
 * 被 import 的顺序，漏了一个 import 就会在运行时变成「未注册的命令类型」，
 * 而且只在走到那条路径时才暴露。
 */
export function createCommandBus(options: CommandBusOptions): CommandBus {
  const registry = new Map<string, CommandDefinition<never, unknown>>()
  for (const definition of options.definitions) {
    if (registry.has(definition.type)) throw new DuplicateCommandError(definition.type)
    registry.set(definition.type, definition)
  }

  const repos = options.repos ?? defaultRepositories

  async function apply(type: string, payload: unknown = null): Promise<unknown> {
    const definition = registry.get(type)
    if (!definition) throw new UnknownCommandError(type, [...registry.keys()])

    const issues = definition.validate?.(payload) ?? []
    if (issues.length > 0) throw new CommandPayloadError(type, issues)

    const now = createNow(options.clock)

    return runCommandTransaction(
      {
        commandType: type,
        stores: definition.stores,
        payload,
        now,
        skipOpLog: definition.skipOpLog,
        getDb: options.getDb,
      },
      (tx, bulk) => definition.handler({ tx, now, repos, bulk }, payload as never),
    )
  }

  return { apply, types: [...registry.keys()] }
}
