/**
 * stats —— 时间窗口计算
 *
 * timeWindow.ts 是全仓库**唯一**允许出现自然日 / 自然周边界算术的位置（约束 6）。
 * 其余任何地方禁止自行推算日界或周界。
 *
 * 归属按记录自身的 `tz_offset_minutes` 判定，不是按设备当前时区——
 * 否则用户跨时区后周统计会错位。自然周为周一至周日。详见 design.md D5。
 *
 * ⚠️ 禁止导入 storage/**、commands/**、telemetry/**（由 ESLint 强制）。
 *
 * 允许导入：entities/
 * 可被导入：任何层
 */

export {}
