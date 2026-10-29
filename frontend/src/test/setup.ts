/**
 * vitest 全局 setup。
 *
 * `fake-indexeddb/auto` 把 indexedDB 与 IDBKeyRange 装到 globalThis 上，
 * 让 Repository 与 Command 的测试在 Node 里跑真实的 IndexedDB 语义
 * （包括「事务在控制权交回事件循环时自动提交」这条关键行为——需要异步取值准备的写入
 * 因此走不通，准备工作都得在开事务之前做完）。
 *
 * 用例之间的隔离靠 `uniqueDbName()` 给每个用例独立的库名，而不是重置 indexedDB 全局。
 * 存储访问只允许出现在 storage/indexeddb/**，源码扫描据此判定；测试代码不碰全局对象，
 * 因此不必为测试开豁免。
 */
import 'fake-indexeddb/auto'
