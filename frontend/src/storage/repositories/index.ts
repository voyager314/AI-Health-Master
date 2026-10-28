/**
 * storage/repositories —— 每实体一个 Repository
 *
 * 每个 Repository 统一暴露 6 个方法：list / get / put / remove / query / clear。
 * `remove` 写 `deleted_at` 做软删除，禁止物理删除（约束 5）。
 *
 * 查询只允许「按主键或单字段索引取数 + 内存过滤」，禁止复合游标——
 * 每个查询都必须能等价表达为一条单表 `SELECT ... WHERE`（约束 8）。
 *
 * 允许导入：entities/、storage/indexeddb/
 * 可被导入：仅 storage/**
 */

export {}
