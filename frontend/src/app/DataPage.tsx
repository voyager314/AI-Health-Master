/**
 * 导出、导入与清空。
 *
 * 三件事的风险不对称，确认方式因此不同：导出没有风险，直接执行；导入会替换当前
 * 全部数据，先展示文件概况再让用户确认；清空不可恢复，二次确认并明确说明后果。
 *
 * 导入前的一次自动备份由流程编排负责，本页只负责把结果如实呈现。
 */
import { useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router'

import { dataTransfer } from '@/features/data'
import { Button, createDownloadSink } from '@/shared'

type Feedback =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

/** 已通过校验、等待用户确认的导入文件 */
interface PendingImport {
  readonly text: string
  readonly total: number
}

export function DataPage() {
  const sink = useRef(createDownloadSink()).current
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' })
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [confirmingClear, setConfirmingClear] = useState(false)

  async function run(message: string, action: () => Promise<string>) {
    setFeedback({ kind: 'busy', message })
    try {
      setFeedback({ kind: 'done', message: await action() })
    } catch (error) {
      setFeedback({ kind: 'error', message: describe(error, '操作失败。') })
    }
  }

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清空选择，使同一个文件连续选两次也能触发变更事件
    event.target.value = ''
    if (!file) return

    setPending(null)

    if (!file.name.toLowerCase().endsWith('.json')) {
      setFeedback({
        kind: 'error',
        message: '只能导入 JSON 文件。CSV 仅供查看，不能作为导入来源。',
      })
      return
    }

    const text = await file.text()
    try {
      const parsed = dataTransfer.previewImport(text)
      const total = Object.values(parsed.records).reduce((sum, rows) => sum + rows.length, 0)
      setPending({ text, total })
      setFeedback({
        kind: 'done',
        message: `文件可导入，共 ${total} 条记录。确认后将替换当前全部数据。`,
      })
    } catch (error) {
      setFeedback({ kind: 'error', message: describe(error, '文件无法解析。') })
    }
  }

  async function onConfirmImport() {
    if (!pending) return
    const text = pending.text
    setPending(null)

    await run('正在导入…', async () => {
      const result = await dataTransfer.importAll({ text, confirmed: true, sink })
      return result.backup
        ? '导入完成。导入前的数据已备份为一个文件。'
        : '导入完成。'
    })
  }

  return (
    <main className="page">
      <header className="page__header">
        <Link className="page__back" to="/settings">
          ‹ 设置
        </Link>
        <h1>导出与导入</h1>
      </header>

      <section className="group">
        <h2 className="group__title">导出</h2>
        <p className="group__note">
          数据只存在这台设备的浏览器里。清理缓存或换设备都会丢失，建议每周导出一次。
        </p>
        <div className="stack">
          <Button
            block
            tone="primary"
            onClick={() =>
              void run('正在导出…', async () => {
                const { files } = await dataTransfer.exportAll({ sink })
                return `已导出 ${files.length} 个文件。`
              })
            }
          >
            导出 JSON（可再导入）
          </Button>
          <Button
            block
            onClick={() =>
              void run('正在导出…', async () => {
                const { files } = await dataTransfer.exportAll({ sink, format: 'csv' })
                return `已导出 ${files.length} 个 CSV 文件，仅供查看。`
              })
            }
          >
            导出 CSV（仅供查看）
          </Button>
        </div>
      </section>

      <section className="group">
        <h2 className="group__title">导入</h2>
        <p className="group__note">
          导入会替换当前全部数据，导入前会自动把当前数据备份成一个文件。
        </p>

        <label className="btn btn--block btn--secondary" htmlFor="import-file">
          选择 JSON 文件
        </label>
        <input
          id="import-file"
          className="visually-hidden"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void onFileChosen(event)}
        />

        {pending ? (
          <div className="stack">
            <p className="group__note">
              共 {pending.total} 条记录，将替换当前全部数据。
            </p>
            <Button block tone="primary" onClick={() => void onConfirmImport()}>
              确认替换全部数据
            </Button>
            <Button block tone="quiet" onClick={() => setPending(null)}>
              取消
            </Button>
          </div>
        ) : null}
      </section>

      <section className="group">
        <h2 className="group__title">清空</h2>
        <p className="group__note">删除本机全部数据，包括同意记录。此操作无法撤销。</p>

        {confirmingClear ? (
          <div className="stack">
            <Button
              block
              tone="primary"
              onClick={() =>
                void run('正在清空…', async () => {
                  await dataTransfer.clearAll({ confirmed: true })
                  setConfirmingClear(false)
                  return '已清空全部数据。'
                })
              }
            >
              确认清空，无法恢复
            </Button>
            <Button block tone="quiet" onClick={() => setConfirmingClear(false)}>
              取消
            </Button>
          </div>
        ) : (
          <Button block onClick={() => setConfirmingClear(true)}>
            清空全部数据
          </Button>
        )}
      </section>

      {feedback.kind !== 'idle' ? (
        <p
          className={`feedback feedback--${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      ) : null}
    </main>
  )
}

function describe(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
