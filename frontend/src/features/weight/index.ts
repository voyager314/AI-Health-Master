/**
 * weight —— 体重的记录、趋势与明细
 *
 * 读经 `@/storage` 的只读视图，写经 `@/commands` 的 `applyCommand`，不直接触碰
 * 数据库实现。页面不自己算日期与平均：窗口来自 `stats/`，当日值与周均来自 `domain/`。
 *
 * 允许导入：entities/、domain/、stats/、commands/、telemetry/、shared/
 * 可被导入：app/
 */
export { WeightPage } from './WeightPage.tsx'
export { WeightEditorPage } from './WeightEditorPage.tsx'
