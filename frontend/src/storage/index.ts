/**
 * storage —— 应用层可见的存储入口（只读）
 *
 * 这里只导出 Repository 的**只读视图**：`list` / `get` / `query`。
 * 写方法（`put` / `remove` / `clear`）只在 `./internal.ts`，且仅 `commands/**` 可导入。
 *
 * 页面写 `exerciseRepo.put(...)` 是 TypeScript 编译错误，而不是一条需要人去
 * 发现的 lint 警告：写能力在类型上就不存在，不靠人工审计保证。
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

// 图片引用解析是只读的：界面显示一张图片只需要解析，不需要存图的能力。
export { createBlobReader } from './indexeddb/blob.ts'
export type { BlobReader, BlobResolution } from './indexeddb/blob.ts'

// 快照是只读的：它把全库读成纯数据，不改变任何状态。导出与升级前备份共用它。
// 结构版本同源：导入时据此判断文件要不要先补跑迁移。
export { LATEST_SCHEMA_VERSION } from './indexeddb/migrations/index.ts'
export { snapshotDatabase } from './indexeddb/dump.ts'
export type { DatabaseSnapshot } from './indexeddb/dump.ts'
