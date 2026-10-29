/**
 * storage/indexeddb —— 唯一允许出现 IndexedDB API 的目录
 *
 * ⚠️ 全仓库只有本目录下的文件可以引用 `indexedDB` 全局对象与数据库实例（由 ESLint 强制）。
 *
 * 存储访问一律收敛到 Repository 层，本目录就是那条边界。将来换 MySQL 时，
 * 被替换的就是这个目录——其余各层不应感知存储实现。
 *
 * 允许导入：entities/
 * 可被导入：仅 storage/**
 */

export {}
