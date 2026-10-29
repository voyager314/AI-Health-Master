/**
 * shared —— UI 基元与通用工具
 *
 * 可用性基线在这里落地：主按钮可点击区域 ≥ 44×44 px、核心操作在屏幕下三分之一、
 * 文本对比度 ≥ 4.5:1、深色模式冷启动无全白帧。
 *
 * ⚠️ 禁止导入 storage/indexeddb/**（约束 1）。
 *
 * 允许导入：entities/、stats/、domain/
 * 可被导入：任何层
 */

export { createDownloadSink } from './fileSink.ts'
export type { FileSink } from './fileSink.ts'
