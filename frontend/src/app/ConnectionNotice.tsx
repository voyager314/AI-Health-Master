/**
 * 断网提示。
 *
 * 断网不是错误：训练与体重照常可记，只是需要联网的功能用不了。提示要把这层意思
 * 说清楚，否则用户会以为整个应用不可用而离开。
 */
import { useOnline } from '@/shared'

export function ConnectionNotice() {
  const online = useOnline()

  if (online) return null

  return (
    <div className="notice notice--muted" role="status">
      <p className="notice__text">当前没有网络。训练与体重仍可记录，需要联网的功能暂时不可用。</p>
    </div>
  )
}
