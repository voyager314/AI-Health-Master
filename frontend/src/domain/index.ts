/**
 * domain —— 领域纯函数
 *
 * 训练容量、周均体重、蛋白达成率这类计算都放在本层。约定是：入参为实体数组，
 * 返回计算结果，不读存储、无副作用、相同输入恒得相同输出。
 *
 * 本层两个约定同样严格：
 *
 * - 禁止导入存储、命令与埋点。计算能脱离数据库单测，将来把聚合挪到服务端时
 *   也能用等价的 SQL 实现做双向对照验证。
 * - 只放纯函数，不放跨层的编排。文件导出这类需要触碰下载与文件系统的工作
 *   留在上层，这里只负责把数据序列化成文本。
 */

export { toCsvFiles, toJsonFile } from './export.ts'
export type { ExportableSnapshot, ExportFile } from './export.ts'

