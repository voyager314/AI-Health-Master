/**
 * 写入失败的提示与两个固定出口。
 *
 * 提示按原因分派，出口固定为「导出数据」与「重试」：导出留一条后路，重试留在当前页
 * 再提交一次。调用方负责把错误归类成原因，本组件不导入命令层——失败原因的定义在
 * 契约层，界面取到原因即可。
 *
 * 调用方还负责一件事：失败时不清空已填写的内容、也不跳转。用户刚输入的东西比
 * 任何提示都重要，本组件只渲染提示与出口。
 */
import type { WriteFailureReason } from '@/entities'
import { Button } from './Button.tsx'
import { saveFailureMessage } from './saveFailure.ts'

export interface SaveFailureNoticeProps {
  /** 失败原因，决定提示语 */
  readonly reason: WriteFailureReason
  /** 重试这一次提交。组件在重试期间自行禁用按钮，调用方不必管 */
  readonly onRetry: () => void
  /** 是否正在重试。为真时重试按钮不可用，免得连点产生第二次提交 */
  readonly retrying?: boolean
}

export function SaveFailureNotice({
  reason,
  onRetry,
  retrying = false,
}: SaveFailureNoticeProps) {
  return (
    <div className="stack">
      <p className="feedback feedback--error" role="alert">
        {saveFailureMessage(reason)}
      </p>
      <a className="btn btn--block btn--secondary" href="/settings/data">
        导出数据
      </a>
      <Button tone="primary" block disabled={retrying} onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
