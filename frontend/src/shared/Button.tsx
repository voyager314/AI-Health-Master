/**
 * 按钮。
 *
 * 触达区域不小于 44×44 px，单手可点中；禁用时保留在页面上而不是消失，用户才能
 * 看出「这个操作存在但现在不行」。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉权重。一个界面里至多一个 primary */
  readonly tone?: 'primary' | 'secondary' | 'quiet'
  /** 横跨整行，用于吸底的主操作 */
  readonly block?: boolean
  readonly children: ReactNode
}

export function Button({
  tone = 'secondary',
  block = false,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = ['btn', `btn--${tone}`, block ? 'btn--block' : '', className ?? '']
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
