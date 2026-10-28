/**
 * vitest 全局 setup。
 *
 * `fake-indexeddb/auto` 把 indexedDB 与 IDBKeyRange 装到 globalThis 上，
 * 让 Repository 与 Command 的测试在 Node 里跑真实的 IndexedDB 语义
 * （包括「事务在控制权交回事件循环时自动提交」这条关键行为，见 design.md D3）。
 *
 * 用例之间要拿到干净的数据库时，用 storage/indexeddb/testing.ts 的 reset helper——
 * 那是全仓库唯一允许直接碰 indexedDB 全局对象的地方（约束 1）。
 */
import 'fake-indexeddb/auto'
