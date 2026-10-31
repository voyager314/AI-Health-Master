/**
 * shared —— UI 基元与通用工具
 *
 * 可用性基线在这里落地：主按钮可点击区域不小于 44×44 px、核心操作位于屏幕下
 * 三分之一、文本对比度不低于 4.5:1、深色模式冷启动不出现全白帧。
 *
 * ⚠️ 禁止导入 storage/indexeddb/**：存储访问一律经 Repository 层，将来替换存储实现
 * 时不必改动这一层。
 *
 * 允许导入：entities/、stats/、domain/
 * 可被导入：任何层
 */

export { Button } from './Button.tsx'
export { SaveFailureNotice } from './SaveFailureNotice.tsx'
export type { SaveFailureNoticeProps } from './SaveFailureNotice.tsx'
export { dayLabel } from './dayLabel.ts'
export type { ButtonProps } from './Button.tsx'
export { EmptyState } from './EmptyState.tsx'
export type { EmptyStateProps } from './EmptyState.tsx'
export { saveFailureMessage } from './saveFailure.ts'
export { Skeleton } from './Skeleton.tsx'
export type { SkeletonProps } from './Skeleton.tsx'
export { NetworkGate } from './NetworkGate.tsx'
export type { NetworkGateProps } from './NetworkGate.tsx'
export { useOnline } from './useOnline.ts'

export { createDownloadSink } from './fileSink.ts'
export type { FileSink } from './fileSink.ts'
