/**
 * workout —— 运动记录的列表、录入与编辑
 *
 * 读经 `@/storage` 的只读视图，写经 `@/commands` 的 `applyCommand`，不直接触碰
 * 数据库实现。页面本身不查日期边界：自然日窗口与分组都来自 `stats/` 与 `domain/`。
 *
 * 允许导入：entities/、domain/、stats/、commands/、shared/
 * 可被导入：app/
 */
export { WorkoutListPage } from './WorkoutListPage.tsx'
export { WorkoutEditorPage } from './WorkoutEditorPage.tsx'
export { itemTextOf } from './itemText.ts'
