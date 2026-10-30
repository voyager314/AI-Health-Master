/**
 * 运动记录展示派生的验证。
 *
 * 三个函数都是纯函数，因此本文件不初始化数据库——这也正是「计算能脱离存储单测」
 * 这条约束的可执行证据。
 *
 * 重点在边缘样本：跨零点的两条记录分属两日、同一时刻的确定性排序、跨时区偏移
 * 的同日判定。日常样本即使排序有误也看不出来，出问题的永远是这些边界。
 */
import type { WorkoutItem, WorkoutLog } from '@/entities'
import { daySummary, filledMetricKinds, groupByDay, SUMMARY_NAME_MAX_LENGTH } from '@/domain'
import { describe, expect, it } from 'vitest'

/** 北京时间 UTC+8 */
const CST = 480
/** 美东夏令时 UTC-4 */
const EDT = -240

/** 一张只有项目名的卡片 */
function aCard(name: string, overrides: Partial<WorkoutItem> = {}): WorkoutItem {
  return { name, sets: null, reps: null, weight_kg: null, note: null, ...overrides }
}

/**
 * 构造一条记录。
 *
 * 只需要展示派生用到的字段，审计字段按最小合规填写——这些函数不读它们，
 * 但类型要求齐全，写全比断言时被类型挡住更省事。
 */
function aLog(partial: {
  id: string
  logged_at: string
  tz_offset_minutes?: number
  items?: WorkoutItem[]
}): WorkoutLog {
  return {
    id: partial.id,
    client_id: partial.id,
    user_id: 'local',
    version: 1,
    created_at: partial.logged_at,
    updated_at: partial.logged_at,
    deleted_at: null,
    tz_offset_minutes: partial.tz_offset_minutes ?? CST,
    logged_at: partial.logged_at,
    input_source: 'manual',
    items: partial.items ?? [aCard('卧推')],
  }
}

/** 东八区 2026-10-30 07:30 */
const MORNING = '2026-10-29T23:30:00.000Z'
/** 东八区 2026-10-30 20:14 */
const EVENING = '2026-10-30T12:14:00.000Z'

describe('按自然日分组', () => {
  it('同日的多条记录归到同一组', () => {
    const groups = groupByDay([
      aLog({ id: 'a', logged_at: MORNING }),
      aLog({ id: 'b', logged_at: EVENING }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.day).toBe('2026-10-30')
    expect(groups[0]?.logs).toHaveLength(2)
  })

  it('组内按时刻倒序', () => {
    const groups = groupByDay([
      aLog({ id: 'a', logged_at: MORNING }),
      aLog({ id: 'b', logged_at: EVENING }),
    ])

    expect(groups[0]?.logs.map((l) => l.id)).toEqual(['b', 'a'])
  })

  it('跨零点的两条记录分属两日，日序也是倒序', () => {
    // 东八区 23:55 与次日 00:05
    const groups = groupByDay([
      aLog({ id: 'late', logged_at: '2026-10-30T15:55:00.000Z' }),
      aLog({ id: 'next', logged_at: '2026-10-30T16:05:00.000Z' }),
    ])

    expect(groups.map((g) => g.day)).toEqual(['2026-10-31', '2026-10-30'])
    expect(groups[0]?.logs[0]?.id).toBe('next')
    expect(groups[1]?.logs[0]?.id).toBe('late')
  })

  it('同一 UTC 时刻在不同偏移下属于不同的自然日', () => {
    const instant = '2026-10-30T03:00:00.000Z'
    const groups = groupByDay([
      aLog({ id: 'east', logged_at: instant, tz_offset_minutes: CST }),
      aLog({ id: 'west', logged_at: instant, tz_offset_minutes: EDT }),
    ])

    expect(groups.map((g) => g.day)).toEqual(['2026-10-30', '2026-10-29'])
  })

  it('跨时区的两条记录仍可能同属一日', () => {
    // 东八区 10-30 10:00 与西四区 10-30 00:00：绝对时刻相差十二小时，
    // 各自本地的自然日却是同一天
    const groups = groupByDay([
      aLog({ id: 'east', logged_at: '2026-10-30T02:00:00.000Z', tz_offset_minutes: CST }),
      aLog({ id: 'west', logged_at: '2026-10-30T04:00:00.000Z', tz_offset_minutes: EDT }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.day).toBe('2026-10-30')
  })

  it('同一时刻的排序由主键决定，与输入顺序无关', () => {
    const at = EVENING
    const ascending = groupByDay([
      aLog({ id: '01a182ae-25f7-7661-b587-84998ff6f6d1', logged_at: at }),
      aLog({ id: '01a182ae-25f7-7661-b587-84998ff6f6d2', logged_at: at }),
    ])
    const descending = groupByDay([
      aLog({ id: '01a182ae-25f7-7661-b587-84998ff6f6d2', logged_at: at }),
      aLog({ id: '01a182ae-25f7-7661-b587-84998ff6f6d1', logged_at: at }),
    ])

    expect(ascending).toEqual(descending)
    // 同一时刻按主键倒序：较大的主键排在前面
    expect(ascending[0]?.logs.map((l) => l.id)).toEqual([
      '01a182ae-25f7-7661-b587-84998ff6f6d2',
      '01a182ae-25f7-7661-b587-84998ff6f6d1',
    ])
  })

  it('空数组返回空结果', () => {
    expect(groupByDay([])).toEqual([])
  })

  it('不修改入参数组的顺序', () => {
    const input = [
      aLog({ id: 'a', logged_at: MORNING }),
      aLog({ id: 'b', logged_at: EVENING }),
    ]
    groupByDay(input)

    expect(input.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('每日摘要', () => {
  it('单条记录给出条数与项目名', () => {
    const summary = daySummary([aLog({ id: 'a', logged_at: MORNING, items: [aCard('卧推')] })])

    expect(summary.count).toBe(1)
    expect(summary.itemNames).toEqual(['卧推'])
  })

  it('多条记录合并项目名，按首次出现顺序去重', () => {
    const summary = daySummary([
      aLog({ id: 'a', logged_at: MORNING, items: [aCard('卧推'), aCard('划船')] }),
      aLog({ id: 'b', logged_at: EVENING, items: [aCard('划船'), aCard('深蹲')] }),
    ])

    expect(summary.count).toBe(2)
    expect(summary.itemNames).toEqual(['卧推', '划船', '深蹲'])
  })

  it('同一条记录内重复的项目名也只出现一次', () => {
    const summary = daySummary([
      aLog({ id: 'a', logged_at: MORNING, items: [aCard('卧推'), aCard('卧推')] }),
    ])

    expect(summary.itemNames).toEqual(['卧推'])
  })

  it('超长的项目名截断到上限并留下省略号', () => {
    const long = '右肩不舒服所以降低了重量的宽握上斜卧推'
    const summary = daySummary([aLog({ id: 'a', logged_at: MORNING, items: [aCard(long)] })])

    expect(summary.itemNames[0]).toBe(`${long.slice(0, SUMMARY_NAME_MAX_LENGTH)}…`)
    expect(summary.itemNames[0]?.length).toBe(SUMMARY_NAME_MAX_LENGTH + 1)
  })

  it('恰好等于上限的项目名不截断', () => {
    const exact = 'x'.repeat(SUMMARY_NAME_MAX_LENGTH)
    const summary = daySummary([aLog({ id: 'a', logged_at: MORNING, items: [aCard(exact)] })])

    expect(summary.itemNames[0]).toBe(exact)
  })

  it('没有记录时条数为 0、项目名为空', () => {
    expect(daySummary([])).toEqual({ count: 0, itemNames: [] })
  })
})

describe('已填指标种类数', () => {
  /** 构造只填了指定指标的记录 */
  function withMetrics(filled: Partial<Pick<WorkoutItem, 'sets' | 'reps' | 'weight_kg'>>) {
    const card: WorkoutItem = { name: '卧推', sets: null, reps: null, weight_kg: null, note: null }
    return aLog({ id: 'a', logged_at: MORNING, items: [{ ...card, ...filled }] })
  }

  it('三项全空时为 0', () => {
    expect(filledMetricKinds(withMetrics({}))).toBe(0)
  })

  it('三项全满时为 3', () => {
    expect(filledMetricKinds(withMetrics({ sets: 4, reps: 8, weight_kg: 80 }))).toBe(3)
  })

  it('只填重量为 1', () => {
    expect(filledMetricKinds(withMetrics({ weight_kg: 80 }))).toBe(1)
  })

  it('不随卡片数量增长：4 张卡片都填重量仍为 1', () => {
    const card = (): WorkoutItem => ({
      name: '卧推',
      sets: null,
      reps: null,
      weight_kg: 80,
      note: null,
    })
    const log = aLog({ id: 'a', logged_at: MORNING, items: [card(), card(), card(), card()] })

    expect(filledMetricKinds(log)).toBe(1)
  })

  it('不同卡片各填一项，合计为 3', () => {
    const log = aLog({
      id: 'a',
      logged_at: MORNING,
      items: [
        { name: '卧推', sets: 4, reps: null, weight_kg: null, note: null },
        { name: '划船', sets: null, reps: 8, weight_kg: null, note: null },
        { name: '深蹲', sets: null, reps: null, weight_kg: 80, note: null },
      ],
    })

    expect(filledMetricKinds(log)).toBe(3)
  })

  it('只有描述不算指标', () => {
    expect(filledMetricKinds(withMetrics({}))).toBe(0)
  })
})
