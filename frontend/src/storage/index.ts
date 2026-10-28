/**
 * storage —— 应用层可见的存储入口（只读）
 *
 * 本文件只导出各 Repository 的**只读视图**（list / get / query）。
 * 写方法（put / remove / clear）只从 storage/internal.ts 导出，且仅 commands/** 可导入。
 *
 * 这是约束 9 的强制手段：页面写 `xxxRepo.put(...)` 会是 TypeScript 编译错误，
 * 而不是一条需要人去发现的 lint 警告。详见 design.md D4。
 *
 * 允许导入：entities/、storage/repositories/、storage/indexeddb/
 * 可被导入：任何层
 */

export {}
