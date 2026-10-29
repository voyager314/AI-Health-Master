/**
 * 空状态。
 *
 * 只放一句话说明与一个主行动，不放图表或列表框架：画的是一张长不出数据的空图，
 * 用户看到的是「坏了」而不是「还没有」。
 */
import type { ReactNode } from 'react'

import { Button } from './Button.tsx'

export interface EmptyStateProps {
  /** 一句话说明当前为什么是空的 */
  readonly message: string
  /** 主行动按钮的文案 */
  readonly actionLabel?: string
  readonly onAction?: () => void
  readonly children?: ReactNode
}

export function EmptyState({
  message,
  actionLabel,
  onAction,
  children,
}: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty__message">{message}</p>
      {actionLabel && onAction ? (
        <Button tone="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {children}
    </div>
  )
}
