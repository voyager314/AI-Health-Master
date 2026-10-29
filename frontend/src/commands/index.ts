/**
 * commands —— 唯一写入口
 *
 * 全部写操作都经 `applyCommand(type, payload)`。它在单个事务内完成业务写入
 * 并追加一条 pending_ops 记录，两者原子（约束 9）。
 *
 * ⚠️ 命令 handler 禁止 `await` 非 IndexedDB 的 Promise——IndexedDB 事务会在控制权
 * 交回事件循环时自动提交，后续写入会抛 TransactionInactiveError。所有异步准备
 * （生成 id、取当前时刻与 tz offset）由总线在开事务前完成（见 design.md D3）。
 *
 * 允许导入：entities/、storage/internal、storage/、domain/、stats/
 * 可被导入：app/、features/
 */
import { markExported } from './appMeta.ts'
import { createCommandBus } from './bus.ts'
import type { CommandDefinition } from './types.ts'

/**
 * 应用的全部命令定义。
 *
 * 用显式数组而不是让各模块自行注册：漏登记不会在启动时报错，而要等用户走到
 * 那条路径才变成「未注册的命令类型」。放进这个数组后，漏登记就是一处未使用的导出。
 */
export const COMMANDS: readonly CommandDefinition<never, unknown>[] = [
  markExported as CommandDefinition<never, unknown>,
]

const bus = createCommandBus({ definitions: COMMANDS })

/**
 * 执行一条命令。这是应用层唯一的写入口。
 *
 * 失败时抛：
 * - `UnknownCommandError` —— 命令类型未注册，数据库未被触碰
 * - `CommandPayloadError` —— 载荷不合法，数据库未被触碰
 * - `StorageWriteError` —— 写入失败（如配额满），业务数据与日志均已回滚
 */
export function applyCommand(type: string, payload?: unknown): Promise<unknown> {
  return bus.apply(type, payload)
}

export { createCommandBus } from './bus.ts'
export type { CommandBus, CommandBusOptions } from './bus.ts'

export { defineCommand } from './types.ts'
export {
  CommandPayloadError,
  DuplicateCommandError,
  UnknownCommandError,
} from './types.ts'
export type { CommandContext, CommandDefinition } from './types.ts'
