/**
 * 项目卡片编辑器。
 *
 * 录入页与编辑页共用：两者字段相同、校验相同、布局相同，差别只在提交调哪条命令。
 *
 * 卡片数组由本组件管理，不引入表单库。校验在提交时一次性跑完并把问题定位到卡片与
 * 字段，不在输入过程中实时打断——训练间隙输入，实时报错会把「还没填完」误判成
 * 「填错了」。
 *
 * 写入失败时不清空已填写的内容、也不跳转：用户刚输入的东西比任何提示都重要。
 */
import type { WorkoutItem, ValidationIssue } from '@/entities'
import { validateWorkoutItems } from '@/entities'
import { filledMetricKinds } from '@/domain'
import { Button } from '@/shared'
import { StorageWriteError } from '@/commands'
import { trackItemChange, trackRecordSave } from '@/telemetry'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { v7 as uuidv7 } from 'uuid'

/** 一张卡片的编辑态。数值字段保持字符串，提交时才换算成数值或 null */
interface CardDraft {
  /** 渲染用的稳定键，不进入记录 */
  readonly key: string
  readonly name: string
  readonly sets: string
  readonly reps: string
  readonly weight: string
  readonly note: string
}

function emptyDraft(): CardDraft {
  return { key: uuidv7(), name: '', sets: '', reps: '', weight: '', note: '' }
}

/** 空串代表未填，返回 null 而不是 0：0 组与「没记组数」是两件事 */
function toNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : Number(trimmed)
}

function toItem(draft: CardDraft): WorkoutItem {
  const note = draft.note.trim()
  return {
    name: draft.name.trim(),
    sets: toNumberOrNull(draft.sets),
    reps: toNumberOrNull(draft.reps),
    weight_kg: toNumberOrNull(draft.weight),
    note: note === '' ? null : note,
  }
}

/** 写入失败的提示语。配额满要指明下一步动作，其余给通用原因 */
function failureMessage(error: unknown): string {
  if (error instanceof StorageWriteError && error.reason === 'quota_exceeded') {
    return '本地存储空间不足，这次没有保存成功。建议先导出数据，再清理历史图片后重试。'
  }
  if (error instanceof StorageWriteError && error.reason === 'constraint') {
    return '数据不符合约束，这次没有保存成功。请检查填写的内容后重试。'
  }
  return '写入本地数据库失败，这次没有保存成功。可以重试，或先导出数据以免丢失。'
}

/** 把校验问题按卡片下标分组，供就地提示 */
function issuesByCard(issues: readonly ValidationIssue[]): Map<number, ValidationIssue[]> {
  const grouped = new Map<number, ValidationIssue[]>()
  for (const issue of issues) {
    const match = /^items\[(\d+)\]/.exec(issue.field)
    const index = match ? Number(match[1]) : 0
    const bucket = grouped.get(index)
    if (bucket) bucket.push(issue)
    else grouped.set(index, [issue])
  }
  return grouped
}

export interface WorkoutCardFormProps {
  /** 初始卡片。新建时传一张空卡片，编辑时传记录里的卡片 */
  readonly initialItems: readonly WorkoutItem[]
  /** 提交按钮文案 */
  readonly saveLabel: string
  /**
   * 提交一组已换算好的卡片。失败时抛错，由本组件呈现失败提示与两个出口。
   */
  readonly onSave: (items: WorkoutItem[]) => Promise<void>
  /**
   * 这条记录的录入来源，只用于埋点。编辑页传入记录自身的来源：
   * 改一条语音记录时它仍然是语音记录，按编辑页的「手动」上报会让语音占比失真。
   */
  readonly inputSource?: 'manual' | 'voice'
}

export function WorkoutCardForm({
  initialItems,
  saveLabel,
  onSave,
  inputSource = 'manual',
}: WorkoutCardFormProps) {
  const [drafts, setDrafts] = useState<CardDraft[]>(() => toDrafts(initialItems))
  const [saving, setSaving] = useState(false)
  const [issues, setIssues] = useState<Map<number, ValidationIssue[]>>(new Map())
  const [failure, setFailure] = useState<string | null>(null)
  // 表单挂载的时刻：耗时从用户看到这张表单算起，而不是从点击保存算起。
  // 必须在渲染之后取——渲染期间读时钟会让同一次渲染的结果不可重现
  const openedAt = useRef<number | null>(null)
  useEffect(() => {
    openedAt.current = Date.now()
  }, [])

  function update(index: number, patch: Partial<CardDraft>) {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)),
    )
  }

  function removeCard(index: number) {
    const next = drafts.filter((_, i) => i !== index)
    setDrafts(next)
    setIssues(new Map())
    // 埋点的结果与业务无关，连失败都不该冒泡成一个未处理的拒绝
    void trackItemChange({ action: 'remove', items: next.length }).catch(() => undefined)
  }

  function addCard() {
    const next = [...drafts, emptyDraft()]
    setDrafts(next)
    void trackItemChange({ action: 'add', items: next.length }).catch(() => undefined)
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return

    const items = drafts.map(toItem)
    const found = validateWorkoutItems(items)
    if (found.length > 0) {
      setIssues(issuesByCard(found))
      setFailure(null)
      return
    }

    setIssues(new Map())
    setFailure(null)
    setSaving(true)
    try {
      await onSave(items)
    } catch (error) {
      setFailure(failureMessage(error))
      return
    } finally {
      setSaving(false)
    }

    // 埋在成功之后：失败的提交没有保存任何东西，记一条只会让「保存了几次」这个数虚高。
    // 结果不参与任何判断，失败也不能冒泡到界面
    void trackRecordSave({
      input_source: inputSource,
      items: items.length,
      metric_kinds: filledMetricKinds({ items }),
      duration_ms: openedAt.current === null ? 0 : Date.now() - openedAt.current,
    }).catch(() => undefined)
  }

  return (
    <form
      className="stack"
      aria-label="运动项目"
      onSubmit={(event) => void submit(event)}
    >
      {drafts.map((draft, index) => (
        <fieldset key={draft.key} className="card">
          <legend className="card__legend">第 {index + 1} 项</legend>

          <label className="field">
            <span className="field__label">项目名</span>
            <input
              className="field__input"
              value={draft.name}
              maxLength={40}
              onChange={(event) => update(index, { name: event.target.value })}
            />
          </label>
          {messageFor(issues, index, 'name') ? (
            <p className="field__error" role="alert">
              项目名必填
            </p>
          ) : null}

          <div className="field-row">
            <label className="field">
              <span className="field__label">组数</span>
              <input
                className="field__input"
                inputMode="numeric"
                value={draft.sets}
                onChange={(event) => update(index, { sets: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">每组次数</span>
              <input
                className="field__input"
                inputMode="numeric"
                value={draft.reps}
                onChange={(event) => update(index, { reps: event.target.value })}
              />
            </label>
            <label className="field">
              <span className="field__label">重量（kg）</span>
              <input
                className="field__input"
                inputMode="decimal"
                step="0.5"
                type="number"
                value={draft.weight}
                onChange={(event) => update(index, { weight: event.target.value })}
              />
            </label>
          </div>
          {messageFor(issues, index, 'sets') ? (
            <p className="field__error" role="alert">
              组数应为正整数
            </p>
          ) : null}
          {messageFor(issues, index, 'reps') ? (
            <p className="field__error" role="alert">
              每组次数应为正整数
            </p>
          ) : null}
          {messageFor(issues, index, 'weight_kg') ? (
            <p className="field__error" role="alert">
              重量应为不小于 0 的数值，步进 0.5 kg
            </p>
          ) : null}

          <label className="field">
            <span className="field__label">描述</span>
            <textarea
              className="field__input"
              rows={2}
              maxLength={200}
              value={draft.note}
              onChange={(event) => update(index, { note: event.target.value })}
            />
          </label>

          <Button tone="quiet" onClick={() => removeCard(index)}>
            删除这一项
          </Button>
        </fieldset>
      ))}

      <Button onClick={addCard}>添加一项</Button>

      {failure ? (
        <div className="stack">
          <p className="feedback feedback--error" role="alert">
            {failure}
          </p>
          {/* 两个出口固定：导出留一条后路，重试留在当前页再提交一次 */}
          <a className="btn btn--block btn--secondary" href="/settings/data">
            导出数据
          </a>
          <Button tone="primary" block disabled={saving} onClick={() => void submit()}>
            重试
          </Button>
        </div>
      ) : null}

      <Button type="submit" tone="primary" block disabled={saving || drafts.length === 0}>
        {saving ? '正在保存…' : saveLabel}
      </Button>
    </form>
  )
}

function toDrafts(items: readonly WorkoutItem[]): CardDraft[] {
  if (items.length === 0) return [emptyDraft()]
  return items.map((item) => ({
    key: uuidv7(),
    name: item.name,
    sets: item.sets === null ? '' : String(item.sets),
    reps: item.reps === null ? '' : String(item.reps),
    weight: item.weight_kg === null ? '' : String(item.weight_kg),
    note: item.note ?? '',
  }))
}

function messageFor(
  issues: Map<number, ValidationIssue[]>,
  index: number,
  field: string,
): string | undefined {
  return issues.get(index)?.find((issue) => issue.field.endsWith(`.${field}`))?.message
}
