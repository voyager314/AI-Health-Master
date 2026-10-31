/**
 * 体重展示派生的验证。
 *
 * 全部是纯函数，因此本文件不初始化数据库——这也是「计算能脱离存储单测」这条
 * 约束的可执行证据。
 *
 * 重点在边缘样本：连续步进的浮点误差、斤的奇数十分位、同日多条取最后一条、
 * 有效日不足 3 天时不计算周均、跨零点的归日与归周。日常样本即使算错也看不出来。
 */
import type { BodyMetric } from '@/entities'
import {
  MIN_VALID_DAYS_PER_WEEK,
  dayValues,
  jinToKg,
  kgToJin,
  normalizeKg,
  stepKg,
  weeklyAverages,
} from '@/domain'
import { describe, expect, it } from 'vitest'

/** 北京时间 UTC+8 */
const CST = 480
/** 美东夏令时 UTC-4 */
const EDT = -240

/** 一条体重记录，只需派生动作用到的字段 */
function aMetric(
  id: string,
  measuredAt: string,
  weightKg: number,
  overrides: Partial<BodyMetric> = {},
): BodyMetric {
  return {
    id,
    client_id: id,
    user_id: 'local',
    version: 1,
    created_at: measuredAt,
    updated_at: measuredAt,
    deleted_at: null,
    tz_offset_minutes: CST,
    measured_at: measuredAt,
    weight_kg: weightKg,
    note: null,
    ...overrides,
  }
}

describe('网格规整', () => {
  it('四舍五入到一位小数', () => {
    expect(normalizeKg(72.46)).toBe(72.5)
    expect(normalizeKg(72.45)).toBe(72.5)
    expect(normalizeKg(72.44)).toBe(72.4)
    expect(normalizeKg(72)).toBe(72)
  })

  it('规整后的值都乘得出整数十分位', () => {
    for (const kg of [72.46, 72.45, 72.44, 70.19999999999999, 145.3 / 2]) {
      expect(Number.isInteger(normalizeKg(kg) * 10), `${kg}`).toBe(true)
    }
  })
})

describe('步进', () => {
  it('加一个十分位减一个十分位', () => {
    expect(stepKg(72.4, 1)).toBe(72.5)
    expect(stepKg(72.4, -1)).toBe(72.3)
  })

  it('连续步进不累积误差', () => {
    let kg = 70.0
    for (let i = 0; i < 20; i += 1) kg = stepKg(kg, 1)

    expect(kg).toBe(72.0)
    expect(Number.isInteger(kg * 10)).toBe(true)
  })

  it('从漂移后的值出发也能回到网格上', () => {
    expect(Number.isInteger(stepKg(70.19999999999999, 1) * 10)).toBe(true)
  })
})

describe('斤换算', () => {
  it('kg 换斤是乘以 2', () => {
    expect(kgToJin(72.4)).toBe(144.8)
    expect(kgToJin(72.5)).toBe(145)
  })

  it('奇数十分位的斤规整到 0.1 kg 网格', () => {
    expect(jinToKg(145.3)).toBe(72.7)
    expect(jinToKg(144.9)).toBe(72.5)
    expect(jinToKg(144.8)).toBe(72.4)
  })

  it('斤换回 kg 再换回斤，误差不超过一个十分位', () => {
    for (let tenths = 20; tenths <= 1000; tenths += 1) {
      const kg = jinToKg(tenths / 10)
      // 容差只为吸收浮点减法本身的误差，半个网格的差距仍会被这条断言抓住
      expect(Math.abs(kgToJin(kg) - tenths / 10), `${tenths / 10} 斤`).toBeLessThanOrEqual(
        0.1 + 1e-9,
      )
    }
  })
})

describe('当日取值', () => {
  it('同日多条取测量时刻最晚的一条', () => {
    const values = dayValues([
      aMetric('a', '2026-10-30T00:10:00.000Z', 72.0),
      aMetric('b', '2026-10-30T12:00:00.000Z', 72.5),
    ])

    expect(values).toHaveLength(1)
    expect(values[0]?.kg).toBe(72.5)
    expect(values[0]?.source.id).toBe('b')
  })

  it('同一时刻取主键较大的一条', () => {
    const at = '2026-10-30T12:00:00.000Z'
    const small = '01a182ae-25f7-7661-b587-84998ff6f6d1'
    const large = '01a182ae-25f7-7661-b587-84998ff6f6d2'

    for (const records of [
      [aMetric(small, at, 72.0), aMetric(large, at, 72.5)],
      [aMetric(large, at, 72.5), aMetric(small, at, 72.0)],
    ]) {
      expect(dayValues(records)[0]?.source.id, '结果与输入顺序无关').toBe(large)
    }
  })

  it('已删除的记录不参与，当日值回落到前一条', () => {
    const kept = aMetric('a', '2026-10-30T00:10:00.000Z', 72.0)
    const removed = aMetric('b', '2026-10-30T12:00:00.000Z', 72.5, {
      deleted_at: '2026-10-30T13:00:00.000Z',
    })

    const values = dayValues([kept, removed])
    expect(values[0]?.kg).toBe(72.0)
    expect(values[0]?.source.id).toBe('a')
  })

  it('每天只有一条当日值，日序倒序', () => {
    const values = dayValues([
      aMetric('d1', '2026-10-29T00:10:00.000Z', 72.0),
      aMetric('d2', '2026-10-30T00:10:00.000Z', 72.4),
      aMetric('d2b', '2026-10-30T12:10:00.000Z', 72.6),
    ])

    expect(values.map((v) => v.day)).toEqual(['2026-10-30', '2026-10-29'])
    expect(values.map((v) => v.kg)).toEqual([72.6, 72.0])
  })

  it('跨零点按记录自带的偏移归日', () => {
    // 东八区 10-30 23:55 与 10-31 00:05，后者在 UTC 里仍是 30 日下午
    const values = dayValues([
      aMetric('late', '2026-10-30T15:55:00.000Z', 72.0),
      aMetric('next', '2026-10-30T16:05:00.000Z', 72.5),
    ])

    expect(values.map((v) => v.day)).toEqual(['2026-10-31', '2026-10-30'])
  })

  it('同一 UTC 时刻在东西半球分属不同的自然日', () => {
    const at = '2026-10-30T03:00:00.000Z'
    const values = dayValues([
      aMetric('east', at, 72.0, { tz_offset_minutes: CST }),
      aMetric('west', at, 72.4, { tz_offset_minutes: EDT }),
    ])

    expect(values.map((v) => v.day)).toEqual(['2026-10-30', '2026-10-29'])
  })

  it('不修改入参数组', () => {
    const input = [
      aMetric('a', '2026-10-30T00:10:00.000Z', 72.0),
      aMetric('b', '2026-10-30T12:00:00.000Z', 72.5),
    ]
    dayValues(input)

    expect(input.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('没有记录时返回空数组', () => {
    expect(dayValues([])).toEqual([])
  })
})

describe('周均', () => {
  // 东八区各条记录的 08:00。10-26 是周一，11-02 是下一周的周一
  const MONDAY = '2026-10-26T00:00:00.000Z'
  const TUESDAY = '2026-10-27T00:00:00.000Z'
  const WEDNESDAY = '2026-10-28T00:00:00.000Z'
  const NEXT_MONDAY = '2026-11-02T00:00:00.000Z'

  it('三个有效日计算周均', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 72.0),
      aMetric('b', WEDNESDAY, 72.4),
      aMetric('c', '2026-10-30T00:00:00.000Z', 72.6),
    ])

    expect(weeks).toHaveLength(1)
    expect(weeks[0]?.week).toBe('2026-10-26')
    expect(weeks[0]?.validDays).toBe(3)
    expect(weeks[0]?.kg).toBe(72.3)
  })

  it('有效日不足三天时不计算周均', () => {
    const weeks = weeklyAverages([aMetric('a', MONDAY, 72.0), aMetric('b', TUESDAY, 72.4)])

    expect(weeks[0]?.validDays).toBe(2)
    expect(weeks[0]?.kg).toBeNull()
  })

  it('同一天的多条只算一个有效日', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 72.0),
      aMetric('b', '2026-10-26T04:00:00.000Z', 72.2),
      aMetric('c', '2026-10-26T08:00:00.000Z', 72.4),
    ])

    expect(weeks[0]?.validDays).toBe(1)
    expect(weeks[0]?.kg).toBeNull()
  })

  it('以当日值为单位求平均，而不是把记录直接平均', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 70.0),
      aMetric('b', '2026-10-26T04:00:00.000Z', 72.0),
      aMetric('c', TUESDAY, 72.0),
      aMetric('d', WEDNESDAY, 72.0),
    ])

    // 四条记录直接平均是 71.5；当日值 72.0 / 72.0 / 72.0 的周均是 72.0
    expect(weeks[0]?.kg).toBe(72.0)
  })

  it('周日与次日周一分属两周', () => {
    // 东八区周日 23:50 与周一 00:10
    const weeks = weeklyAverages([
      aMetric('sunday', '2026-11-01T15:50:00.000Z', 72.0),
      aMetric('monday', '2026-11-01T16:10:00.000Z', 72.4),
    ])

    expect(weeks.map((w) => w.week)).toEqual(['2026-10-26', '2026-11-02'])
    expect(weeks.every((w) => w.kg === null)).toBe(true)
  })

  it('多周按时间正序，缺周均的周保留为 null 而不是被略过', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 72.0),
      aMetric('b', TUESDAY, 72.0),
      aMetric('c', WEDNESDAY, 72.0),
      aMetric('d', NEXT_MONDAY, 73.0),
    ])

    expect(weeks.map((w) => w.week)).toEqual(['2026-10-26', '2026-11-02'])
    expect(weeks[0]?.kg).toBe(72.0)
    expect(weeks[1]?.validDays).toBe(1)
    expect(weeks[1]?.kg).toBeNull()
  })

  it('周均规整到 0.1 kg', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 72.0),
      aMetric('b', TUESDAY, 72.1),
      aMetric('c', WEDNESDAY, 72.1),
    ])

    expect(weeks[0]?.kg).toBe(72.1)
    expect(Number.isInteger((weeks[0]!.kg as number) * 10)).toBe(true)
  })

  it('已删除的记录不算有效日', () => {
    const weeks = weeklyAverages([
      aMetric('a', MONDAY, 72.0),
      aMetric('b', TUESDAY, 72.0),
      aMetric('c', WEDNESDAY, 72.0, { deleted_at: '2026-10-28T01:00:00.000Z' }),
    ])

    expect(weeks[0]?.validDays).toBe(2)
    expect(weeks[0]?.kg).toBeNull()
  })

  it('计算周均的门槛就是每周三个有效日', () => {
    expect(MIN_VALID_DAYS_PER_WEEK).toBe(3)
  })

  it('没有记录时返回空数组', () => {
    expect(weeklyAverages([])).toEqual([])
  })
})
