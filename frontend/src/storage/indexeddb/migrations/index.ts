/**
 * storage/indexeddb/migrations —— schema 顺序迁移脚本
 *
 * 一个版本恰一条迁移（约束 10）。启动时按版本号升序执行，迁移前自动导出备份。
 * 备份必须在升级之前完成，因此不能写在 onupgradeneeded 里——详见 design.md D6。
 *
 * 允许导入：entities/、storage/indexeddb/
 * 可被导入：仅 storage/indexeddb/**
 */

export {}
