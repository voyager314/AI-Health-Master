/**
 * storage/internal —— 含写方法的完整 Repository 接口
 *
 * ⚠️ 仅 commands/** 可导入本文件（由 ESLint 强制）。
 *
 * 应用层（app/、features/、shared/）要写数据只能经 applyCommand，
 * 这是约束 9「所有写操作走统一 Command 层」的落地点。详见 design.md D3/D4。
 *
 * 允许导入：entities/、storage/repositories/、storage/indexeddb/
 * 可被导入：仅 commands/**
 */

export {}
