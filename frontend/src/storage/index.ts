/**
 * storage —— 应用层可见的存储入口（只读）
 *
 * 这里只导出 Repository 的**只读视图**：`list` / `get` / `query`。
 * 写方法（`put` / `remove` / `clear`）只在 `./internal.ts`，且仅 `commands/**` 可导入。
 *
 * 这是约束 9 的强制手段（design.md D4）：页面写 `exerciseRepo.put(...)` 是
 * TypeScript 编译错误，而不是一条需要人去发现的 lint 警告。
 *
 * 允许导入：entities/、storage/repositories/、storage/indexeddb/
 * 可被导入：任何层
 */
import { readableRepositories } from './repositories/index.ts'

export const exerciseRepo = readableRepositories.exercise
export const workoutRepo = readableRepositories.workout
export const workoutExerciseRepo = readableRepositories.workout_exercise
export const setEntryRepo = readableRepositories.set_entry
export const bodyMetricRepo = readableRepositories.body_metric
export const mealRepo = readableRepositories.meal
export const mealItemRepo = readableRepositories.meal_item
export const targetRepo = readableRepositories.target
export const appMetaRepo = readableRepositories.app_meta

/** 全部只读 Repository，按 store 名索引。供需要遍历 9 张表的读取场景使用 */
export const repos = readableRepositories

export type {
  IndexName,
  ListOptions,
  QuerySpec,
  ReadableRepository,
  ReadableRepositorySet,
  Row,
} from './repositories/types.ts'
