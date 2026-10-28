/**
 * vitest 全局 setup。
 *
 * `fake-indexeddb/auto` 把 indexedDB 与 IDBKeyRange 装到 globalThis 上，
 * 让 Repository 与 Command 的测试在 Node 里跑真实的 IndexedDB 语义
 * （包括「事务在控制权交回事件循环时自动提交」这条关键行为，见 design.md D3）。
 *
 * 用例之间的隔离靠 `uniqueDbName()` 给每个用例独立的库名，而不是重置 indexedDB 全局。
 * 这样测试代码不需要碰 indexedDB 全局对象，约束 1 的自检（搜 indexedDB 只应命中
 * storage/indexeddb/**）就不需要任何豁免。
 */
import 'fake-indexeddb/auto'
