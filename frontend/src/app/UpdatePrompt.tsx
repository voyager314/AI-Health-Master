/**
 * 新版本提示。
 *
 * 新产物就绪后由用户决定何时刷新，不做自动接管。用户可能正处在记录的中途，
 * 此刻换掉页面会把未提交的输入一起丢掉。
 */
import { useRegisterSW } from 'virtual:pwa-register/react'

import { Button } from '@/shared'

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="notice" role="status">
      <p className="notice__text">有新版本了。</p>
      <div className="notice__actions">
        <Button tone="primary" onClick={() => void updateServiceWorker(true)}>
          刷新
        </Button>
        <Button tone="quiet" onClick={() => setNeedRefresh(false)}>
          稍后
        </Button>
      </div>
    </div>
  )
}
