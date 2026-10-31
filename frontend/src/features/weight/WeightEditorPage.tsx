/**
 * 单条体重记录的编辑页。
 *
 * 复用体重页的步进组件：数值的加减、输入与单位规则两处完全相同，差别只在提交
 * 调用哪条命令。单位沿用它进入时的选择——从斤显示的明细点进来，页面仍是斤。
 *
 * 只能改数值。测量日期与时刻按记录自带的偏移换算后只读展示：它们记录的是这次
 * 称重的时刻，允许改就能让记录跨日、跨周移动，悄悄改写用户已经看过的周均。
 *
 * 删除是软删除，二次确认里写明后果：明细与趋势图不再显示，导出文件也不含这条。
 */
import type { BodyMetric, WriteFailureReason } from '@/entities'
import { applyCommand, StorageWriteError } from '@/commands'
import { dayValues } from '@/domain'
import { EmptyState, SaveFailureNotice, Skeleton, dayLabel } from '@/shared'
import { clockTimeOf } from '@/stats'
import { bodyMetricRepo } from '@/storage'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { WeightStepper } from './WeightStepper.tsx'
import { useWeightUnit } from './useWeightUnit.ts'
import { formatDisplay } from './weightFormat.ts'

type Load =
  | { status: 'loading' }
  | { status: 'ready'; record: BodyMetric }
  | { status: 'missing' }
  | { status: 'error' }

export function WeightEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { unit, setUnit } = useWeightUnit()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [draft, setDraft] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<WriteFailureReason | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true

    bodyMetricRepo.get(id).then(
      (record) => {
        if (!alive) return
        // 墓碑按「没有这条记录」处理：打开一条已删除的记录没有可用操作
        if (!record || record.deleted_at !== null) {
          setLoad({ status: 'missing' })
          return
        }
        setLoad({ status: 'ready', record })
        setDraft(record.weight_kg)
      },
      () => {
        if (alive) setLoad({ status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [id])

  if (load.status === 'loading') {
    return (
      <EditorShell>
        <Skeleton lines={3} label="正在读取这条记录" />
      </EditorShell>
    )
  }

  if (load.status === 'error') {
    return (
      <EditorShell>
        <EmptyState message="本地数据读取失败，请重新打开应用。" />
      </EditorShell>
    )
  }

  if (load.status === 'missing') {
    return (
      <EditorShell>
        <EmptyState message="这条记录不存在，可能已经被删除。" />
      </EditorShell>
    )
  }

  const { record } = load
  const day = dayValues([record])[0]!.day

  function save() {
    if (draft === null || saving) return
    setSaving(true)
    setFailure(null)

    void applyCommand('body_metric/update', {
      client_id: record.client_id,
      weight_kg: draft,
    }).then(
      () => navigate(`/weight?unit=${unit}`),
      (error: unknown) => {
        setSaving(false)
        setFailure(error instanceof StorageWriteError ? error.reason : 'unknown')
      },
    )
  }

  return (
    <EditorShell>
      <dl className="meta">
        <div className="meta__item">
          <dt>测量时间</dt>
          <dd>
            {dayLabel(day)} {clockTimeOf(record.measured_at, record.tz_offset_minutes)}
          </dd>
        </div>
        <div className="meta__item">
          <dt>当前数值</dt>
          <dd>
            {formatDisplay(record.weight_kg, unit)} {unit === 'jin' ? '斤' : 'kg'}
          </dd>
        </div>
      </dl>

      <WeightStepper
        value={draft}
        unit={unit}
        disabled={saving}
        onUnitChange={setUnit}
        onChange={setDraft}
        invalid={draft === null}
      />

      {failure ? (
        <SaveFailureNotice reason={failure} retrying={saving} onRetry={save} />
      ) : null}

      <button
        type="button"
        className="btn btn--block btn--primary"
        disabled={saving || draft === null}
        onClick={save}
      >
        {saving ? '正在保存…' : '保存修改'}
      </button>

      {confirmingDelete ? (
        <div className="stack">
          <p className="feedback" role="alert">
            删除后这条记录不再出现在明细与趋势图里，导出文件也不含它。此操作无法撤销。
          </p>
          <button
            type="button"
            className="btn btn--block btn--primary"
            onClick={() => {
              void applyCommand('body_metric/remove', { client_id: record.client_id }).then(
                () => navigate(`/weight?unit=${unit}`),
                () => setConfirmingDelete(false),
              )
            }}
          >
            确认删除
          </button>
          <button
            type="button"
            className="btn btn--block btn--quiet"
            onClick={() => setConfirmingDelete(false)}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--block btn--secondary"
          onClick={() => setConfirmingDelete(true)}
        >
          删除这条记录
        </button>
      )}
    </EditorShell>
  )
}

/** 页面外壳：标题与返回入口 */
function EditorShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="page">
      <header className="page__header">
        <Link className="page__back" to="/weight">
          ‹ 体重
        </Link>
        <h1>编辑体重</h1>
      </header>
      {children}
    </main>
  )
}
