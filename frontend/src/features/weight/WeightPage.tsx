/**
 * 体重页：本周状态、近 12 周趋势、明细，以及吸附在底部的快速记录。
 *
 * 读经 `@/storage` 的只读视图，写经 `@/commands`，不直接触碰数据库实现。窗口与
 * 周标识来自 `stats/`，当日值与周均来自 `domain/`，本页不做日期算术，也不做平均。
 *
 * 记录入口吸附在屏幕下三分之一：图表与明细一长，放在页面顶部就要先滚回去才够得到，
 * 而单手可达是可用性基线。页面内容底部因此留出与入口等高的空白。
 */
import type { BodyMetric } from '@/entities'
import { applyCommand, StorageWriteError } from '@/commands'
import {
  dayValues,
  groupByDayBy,
  kgToJin,
  latestRecord,
  weeklyAverages,
  type WeekAverage,
} from '@/domain'
import { EmptyState, Skeleton, dayLabel } from '@/shared'
import { clockTimeOf, daysBetween, recentWeekInterval, recentWeekKeys } from '@/stats'
import { bodyMetricRepo, createNow, type Now } from '@/storage'
import { trackWeightAdd } from '@/telemetry'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { v7 as uuidv7 } from 'uuid'

import { WeightChart } from './WeightChart.tsx'
import { WeightStepper } from './WeightStepper.tsx'
import { buildChartGeometry } from './chartGeometry.ts'
import type { WeightUnit } from './unit.ts'
import { useWeightUnit } from './useWeightUnit.ts'
import { formatDisplay, toDisplay } from './weightFormat.ts'

/** 趋势窗口：含本周在内的 12 个自然周 */
const WEEKS = 12

type Load =
  | { status: 'loading' }
  | { status: 'ready'; records: readonly BodyMetric[] }
  | { status: 'error' }

/** 一次记录尝试的失败原因 */
type RecordFailure = 'quota_exceeded' | 'constraint' | 'unknown'

export function WeightPage() {
  const navigate = useNavigate()
  const window = useWeightUnit()
  // 取一次「现在」并固定：每次渲染重取会让窗口在同一页面里悄悄移动
  const now = useRef<Now>(createNow()).current
  /** 上一条记录的值，用于判断这次记录有没有改预填值 */
  const prefillRef = useRef<number | null>(null)
  // 幂等键在挂载时生成一次，失败重试沿用；成功后换新，否则同页第二次记录会被当成重复提交
  const [clientId, setClientId] = useState(() => uuidv7())
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [draft, setDraft] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<RecordFailure | null>(null)

  const read = useCallback(async () => {
    const span = recentWeekInterval(now.iso, now.tzOffsetMinutes, WEEKS)
    const inWindow = await bodyMetricRepo.query({
      index: 'measured_at',
      range: { from: span.from, to: span.to },
    })

    // 窗口为空时光表读一次：用户隔了几个月再来，也要拿得到预填值
    const records =
      inWindow.length > 0
        ? inWindow
        : await bodyMetricRepo.list({ includeDeleted: false })
    return records
  }, [now])

  const reload = useCallback(() => {
    let alive = true
    read().then(
      (records) => {
        if (!alive) return
        setLoad({ status: 'ready', records })
        const latest = latestRecord(records)
        prefillRef.current = latest?.weight_kg ?? null
        setDraft(latest?.weight_kg ?? null)
      },
      () => {
        if (alive) setLoad({ status: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [read])

  useEffect(() => reload(), [reload])

  const records = load.status === 'ready' ? load.records : []
  const hasRecords = records.some((record) => record.deleted_at === null)
  const current = draft === null ? prefillRef.current : draft
  const invalid = draft === null && prefillRef.current === null ? false : current === null

  function record() {
    if (current === null || current < 1 || current > 500 || saving) return

    const prefill = prefillRef.current
    setSaving(true)
    setFailure(null)

    void applyCommand('body_metric/record', { client_id: clientId, weight_kg: current }).then(
      () => {
        setSaving(false)
        setClientId(uuidv7())
        void trackWeightAdd({
          prefill: prefill === null ? 'none' : prefill === current ? 'kept' : 'changed',
          unit: window.unit,
        })
        reload()
      },
      (error: unknown) => {
        setSaving(false)
        setFailure(error instanceof StorageWriteError ? error.reason : 'unknown')
      },
    )
  }

  return (
    <main className="page page--with-entry">
      <header className="page__header">
        <h1>体重</h1>
      </header>

      {load.status === 'loading' ? <Skeleton lines={4} label="正在读取体重记录" /> : null}

      {load.status === 'error' ? (
        <EmptyState message="本地数据读取失败，请重新打开应用。" />
      ) : null}

      {load.status === 'ready' && !hasRecords ? (
        <EmptyState message="还没有体重记录。称完点一次记录，就能开始看周均趋势。" />
      ) : null}

      {load.status === 'ready' && hasRecords ? (
        <WeightOverview
          records={records}
          now={now}
          unit={window.unit}
          onOpen={(record) => navigate(`/weight/${record.id}?unit=${window.unit}`)}
        />
      ) : null}

      <section className="entry" aria-label="记录体重">
        <p className="entry__note">{prefillNote(records, window.unit)}</p>
        <WeightStepper
          value={load.status === 'ready' ? current : null}
          unit={window.unit}
          invalid={invalid}
          disabled={saving || load.status !== 'ready'}
          onUnitChange={window.setUnit}
          onChange={setDraft}
        />
        {failure ? (
          <p className="feedback feedback--error" role="alert">
            这次没有保存成功。
            <a href="/settings/data">导出数据</a>
            <button type="button" onClick={record} disabled={saving}>
              重试
            </button>
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn--block btn--primary"
          disabled={saving || load.status !== 'ready' || current === null || invalid}
          onClick={record}
        >
          {saving ? '正在保存…' : '记录'}
        </button>
      </section>
    </main>
  )
}

/**
 * 记录入口上方的一行说明：上一条记录的日期时刻与数值。
 *
 * 记录成功后它随之更新，这就是那次保存的反馈——图表与明细可能都在屏幕下方，
 * 用户未必正看着它们。
 */
function prefillNote(records: readonly BodyMetric[], unit: WeightUnit): string {
  const latest = latestRecord(records)
  if (!latest) return '第一次记录，输入今天的体重。'

  const day = dayValues([latest])[0]!.day
  const at = `${dayLabel(day)} ${clockTimeOf(latest.measured_at, latest.tz_offset_minutes)}`
  return `上一条记录：${at} · ${formatDisplay(latest.weight_kg, unit)} ${unit === 'jin' ? '斤' : 'kg'}`
}

/** 本周状态、趋势图与明细 */
function WeightOverview({
  records,
  now,
  unit,
  onOpen,
}: {
  readonly records: readonly BodyMetric[]
  readonly now: Now
  readonly unit: WeightUnit
  readonly onOpen: (record: BodyMetric) => void
}) {
  const averages = useMemo(() => weeklyAverages(records), [records])
  const values = useMemo(() => dayValues(records), [records])
  const weekKeys = useMemo(
    () => recentWeekKeys(now.iso, now.tzOffsetMinutes, WEEKS),
    [now],
  )
  const windowDays = useMemo(
    () =>
      values.map((value) => ({ day: value.day, offset: daysBetween(weekKeys[0]!, value.day) })),
    [values, weekKeys],
  )

  const byWeek = new Map(averages.map((entry) => [entry.week, entry]))
  const thisWeek = byWeek.get(weekKeys[weekKeys.length - 1]!)

  const geometry = buildChartGeometry({
    days: values.map((value) => ({ day: value.day, kg: value.kg })),
    weeks: weekKeys.map((week) => byWeek.get(week)?.kg ?? null),
    dayOffsets: windowDays,
    toDisplay: (kg) => (unit === 'jin' ? kgToJin(kg) : kg),
  })

  return (
    <>
      <p className="stats__item">
        <WeekStatus week={thisWeek} unit={unit} />
      </p>

      <WeightChart
        geometry={geometry}
        unit={unit}
        thisWeekKg={thisWeek?.kg ?? null}
        thisWeekDays={thisWeek?.validDays ?? 0}
      />

      <WeightDetail records={records} values={values} unit={unit} onOpen={onOpen} />
    </>
  )
}

/** 本周周均，或「本周数据太少」与已记录的天数 */
function WeekStatus({ week, unit }: { readonly week: WeekAverage | undefined; readonly unit: WeightUnit }) {
  if (!week || week.kg === null) {
    const days = week?.validDays ?? 0
    return <>本周数据太少，已记录 {days} 天</>
  }

  const shown = toDisplay(week.kg, unit).toFixed(1)
  return (
    <>
      本周周均 {shown} {unit === 'jin' ? '斤' : 'kg'} · {week.validDays} 天
    </>
  )
}

/** 按日分组的明细：组内按时刻倒序，同日多条时标出当日取值 */
function WeightDetail({
  records,
  values,
  unit,
  onOpen,
}: {
  readonly records: readonly BodyMetric[]
  readonly values: ReturnType<typeof dayValues>
  readonly unit: WeightUnit
  readonly onOpen: (record: BodyMetric) => void
}) {
  const valueByDay = new Map(values.map((value) => [value.day, value.source.id]))
  const groups = groupByDayBy(
    records.filter((record) => record.deleted_at === null),
    (record) => ({ instant: record.measured_at, tzOffsetMinutes: record.tz_offset_minutes }),
  )

  return (
    <div className="list">
      {groups.map((group) => (
        <section key={group.day} className="group">
          <h2 className="group__title">{dayLabel(group.day)}</h2>
          {group.logs.map((record) => {
            const isDayValue = valueByDay.get(group.day) === record.id
            const multi = group.logs.length > 1
            return (
              <button
                key={record.id}
                className="list__row list__row--action"
                type="button"
                onClick={() => onOpen(record)}
              >
                <span className="list__time">
                  {clockTimeOf(record.measured_at, record.tz_offset_minutes)}
                </span>
                <span>
                  {formatDisplay(record.weight_kg, unit)} {unit === 'jin' ? '斤' : 'kg'}
                  {multi && isDayValue ? ' · 当日值' : ''}
                </span>
              </button>
            )
          })}
        </section>
      ))}
    </div>
  )
}

