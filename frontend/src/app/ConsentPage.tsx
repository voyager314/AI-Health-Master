/**
 * 首次使用时的数据处理说明与同意。
 *
 * 同意必须是主动动作：勾选框默认不选，未勾选时确认按钮不可用。默认勾选或者用
 * 「继续使用即视为同意」代替主动确认，两者都不构成告知后同意。
 *
 * 说明内容与设置里的查阅页共用一个组件，两处说的必须是同一件事。
 */
import { useState } from 'react'

import { applyCommand } from '@/commands'
import { Button } from '@/shared'

import { DisclosureSections } from './DisclosureSections.tsx'

export interface ConsentPageProps {
  /** 同意写入成功后的回调，由门禁据此放行主功能 */
  readonly onAgreed: () => void
}

export function ConsentPage({ onAgreed }: ConsentPageProps) {
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setBusy(true)
    setError(null)
    try {
      await applyCommand('app_meta/grant_consent')
      onAgreed()
    } catch {
      setError('没能保存同意记录，请重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <header className="page__header">
        <h1>使用前请先了解</h1>
      </header>

      <DisclosureSections />

      <section className="group">
        <label className="consent">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
          />
          <span>我已阅读并理解上述说明，同意按此方式使用本产品。</span>
        </label>

        <Button
          block
          tone="primary"
          disabled={!checked || busy}
          onClick={() => void onConfirm()}
        >
          {busy ? '正在保存…' : '同意并开始使用'}
        </Button>

        {error ? (
          <p className="feedback feedback--error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  )
}
