/**
 * 需联网功能的外壳。
 *
 * 断网时把内部内容置为不可交互，并说明原因；恢复网络后自动回到可用态，不需要
 * 用户刷新页面。拦截放在捕获阶段：内部若有链接或按钮，不拦的话点击照样会触发，
 * 用户看到的就是「说不能点，点了却有反应」。
 */
import type { ReactNode } from 'react'

import { useOnline } from './useOnline.ts'

export interface NetworkGateProps {
  readonly children: ReactNode
  /** 在线时的说明。默认不显示任何提示 */
  readonly onlineHint?: string
}

export function NetworkGate({ children, onlineHint }: NetworkGateProps) {
  const online = useOnline()

  if (online) {
    return (
      <div className="gate">
        {children}
        {onlineHint ? <p className="gate__hint">{onlineHint}</p> : null}
      </div>
    )
  }

  return (
    <div className="gate gate--offline" aria-disabled="true">
      <div
        className="gate__content"
        onClickCapture={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        {children}
      </div>
      <p className="gate__hint">需要联网</p>
    </div>
  )
}
