/**
 * 首次使用的告知同意门禁。
 *
 * 未同意之前不渲染任何业务页面：健康记录属于敏感个人信息，先看说明再决定要不要用，
 * 这个顺序不能靠用户自己自觉。同意之后不再打断，数据被清空时同意记录一并消失，
 * 门禁因此会自动重新出现。
 *
 * 读取期间给占位而不是先放行再收回：先放行会有短暂的一屏业务界面，那本身就是在
 * 未同意的情况下使用了产品。
 */
import { useCallback, useEffect, useState } from 'react'

import { Skeleton } from '@/shared'
import { appMetaRepo } from '@/storage'

import { ConsentPage } from './ConsentPage.tsx'

type ConsentState = 'loading' | 'required' | 'granted' | 'failed'

export interface ConsentGateProps {
  /** 已同意后要展示的内容 */
  readonly children: React.ReactNode
}

export function ConsentGate({ children }: ConsentGateProps) {
  const [state, setState] = useState<ConsentState>('loading')

  const read = useCallback(async () => {
    const [meta] = await appMetaRepo.list()
    return meta?.consent_at ? 'granted' : 'required'
  }, [])

  useEffect(() => {
    let alive = true
    read().then(
      (next) => {
        if (alive) setState(next)
      },
      () => {
        if (alive) setState('failed')
      },
    )
    return () => {
      alive = false
    }
  }, [read])

  if (state === 'loading') return <Skeleton lines={4} label="正在检查使用须知" />

  if (state === 'failed') {
    return (
      <div className="empty">
        <p className="empty__message">无法读取本地数据，请重新打开应用。</p>
      </div>
    )
  }

  if (state === 'required') {
    return <ConsentPage onAgreed={() => setState('granted')} />
  }

  return <>{children}</>
}
