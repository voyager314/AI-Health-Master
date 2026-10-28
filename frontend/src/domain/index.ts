/**
 * domain —— 领域纯函数
 *
 * 训练容量、周均体重、蛋白达成率等计算都在这里。约束 12 要求：
 * 入参为实体数组，不读存储、无副作用、相同输入恒得相同输出。
 *
 * ⚠️ 禁止导入 storage/**、commands/**、telemetry/**（由 ESLint 强制）。
 * 这条约束的目的是将来能换成 SQL 聚合，并且能做双实现对照验证。
 *
 * 允许导入：entities/、stats/
 * 可被导入：app/、features/、commands/
 */

export {}
