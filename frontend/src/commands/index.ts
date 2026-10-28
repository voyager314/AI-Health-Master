/**
 * commands —— 唯一写入口
 *
 * 全部写操作都经 `applyCommand(type, payload)`。它在单个事务内完成业务写入
 * 并追加一条 pending_ops 记录，两者原子（约束 9）。
 *
 * ⚠️ 命令 handler 禁止 `await` 非 IndexedDB 的 Promise——IndexedDB 事务会在控制权
 * 交回事件循环时自动提交，后续写入会抛 TransactionInactiveError。所有异步准备
 * （生成 id、取当前时刻与 tz offset）必须在开事务之前完成。详见 design.md D3。
 *
 * 允许导入：entities/、storage/internal、storage/、domain/、stats/
 * 可被导入：app/、features/
 */

export {}
