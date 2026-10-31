/**
 * 自然日与自然周边界的穷举验证。
 *
 * 重点在边缘样本：跨零点、跨周界、跨月界、东西半球偏移。日常样本即使算错也
 * 看不出来，出问题的永远是这些边界。
 *
 * 本文件不初始化数据库——时间窗口计算是纯函数，脱离存储即可验证。
 */
import {
  dayKeyOf,
  daysBetween,
  isSameWeek,
  recentDayInterval,
  recentWeekInterval,
  recentWeekKeys,
  retentionCutoff,
  weekInterval,
  weekKeyOf,
} from '@/stats'
import { describe, expect, it } from 'vitest'

/** 北京时间 UTC+8 */
const CST = 480
/** 美东夏令时 UTC-4 */
const EDT = -240
/** 美中标准时 UTC-6 */
const CDT = -300

describe('自然日归属', () => {
  it('按记录自身的偏移判定，而不是 UTC 日界', () => {
    // UTC 时间仍是 27 号晚上，但 UTC+8 的本地挂钟已经是 28 号凌晨
    const instant = '2026-10-27T16:30:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-10-28')
    expect(dayKeyOf(instant, 0)).toBe('2026-10-27')
  })

  it('同一时刻在东西半球分属不同的自然日', () => {
    const instant = '2026-10-28T03:00:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-10-28')
    expect(dayKeyOf(instant, CDT)).toBe('2026-10-27')
  })

  it('本地零点整归入当天，而不是前一天', () => {
    // UTC+8 的 10-28 00:00:00 对应 UTC 的 10-27 16:00:00
    expect(dayKeyOf('2026-10-27T16:00:00.000Z', CST)).toBe('2026-10-28')
  })

  it('本地当天的最后一毫秒仍归入当天', () => {
    expect(dayKeyOf('2026-10-28T15:59:59.999Z', CST)).toBe('2026-10-28')
    expect(dayKeyOf('2026-10-28T16:00:00.000Z', CST)).toBe('2026-10-29')
  })

  it('跨月界与跨年界', () => {
    expect(dayKeyOf('2026-10-31T16:00:00.000Z', CST)).toBe('2026-11-01')
    expect(dayKeyOf('2026-12-31T16:00:00.000Z', CST)).toBe('2027-01-01')
  })

  it('月与日补零到两位', () => {
    expect(dayKeyOf('2026-01-05T00:00:00.000Z', 0)).toBe('2026-01-05')
  })

  it('时刻不可解析时抛错，不返回兜底值', () => {
    expect(() => dayKeyOf('not-a-time', CST)).toThrow(RangeError)
  })
})

describe('自然周区间', () => {
  // 2026-10-28 是星期三
  const wednesday = '2026-10-28T03:00:00.000Z'

  it('起点是本地时间上一个周一的零点', () => {
    const week = weekInterval(wednesday, CST)
    // UTC+8 的 10-26（周一）00:00 对应 UTC 的 10-25 16:00
    expect(week.from).toBe('2026-10-25T16:00:00.000Z')
    expect(dayKeyOf(week.from, CST)).toBe('2026-10-26')
  })

  it('终点是下一个周一的本地零点，不含', () => {
    const week = weekInterval(wednesday, CST)
    expect(week.to).toBe('2026-11-01T16:00:00.000Z')
    expect(dayKeyOf(week.to, CST)).toBe('2026-11-02')
  })

  it('覆盖整个周日，直到它的最后一毫秒', () => {
    const week = weekInterval(wednesday, CST)
    const sundayLastMs = '2026-11-01T15:59:59.999Z'

    expect(dayKeyOf(sundayLastMs, CST)).toBe('2026-11-01')
    expect(sundayLastMs >= week.from && sundayLastMs < week.to).toBe(true)
  })

  it('周一零点整归入该周，而不是上一周', () => {
    const mondayMidnight = '2026-10-25T16:00:00.000Z'
    expect(weekInterval(mondayMidnight, CST).from).toBe(mondayMidnight)
  })

  it('周日与紧随其后的周一分属相邻两周', () => {
    const sunday = '2026-11-01T10:00:00.000Z'
    const monday = '2026-11-02T10:00:00.000Z'

    expect(weekInterval(sunday, CST).to).toBe(weekInterval(monday, CST).from)
  })

  it('一周恰好七天', () => {
    const week = weekInterval(wednesday, CST)
    const span = Date.parse(week.to) - Date.parse(week.from)
    expect(span).toBe(7 * 86_400_000)
  })

  it('同一时刻在不同偏移下可能分属不同的周', () => {
    // UTC+8 已是周一凌晨，UTC-5 还停在上周日傍晚
    const instant = '2026-11-01T17:00:00.000Z'
    expect(dayKeyOf(instant, CST)).toBe('2026-11-02')
    expect(dayKeyOf(instant, CDT)).toBe('2026-11-01')
    expect(weekInterval(instant, CST).from).not.toBe(weekInterval(instant, CDT).from)
  })

  it('跨月的周不被月界切断', () => {
    const week = weekInterval('2026-10-30T03:00:00.000Z', CST)
    expect(dayKeyOf(week.from, CST)).toBe('2026-10-26')
    expect(dayKeyOf(week.to, CST)).toBe('2026-11-02')
  })
})

describe('自然日窗口', () => {
  // UTC+8 的 2026-10-30 18:00
  const now = '2026-10-30T10:00:00.000Z'

  it('days = 1 就是 now 所在的那一个自然日', () => {
    const day = recentDayInterval(now, CST, 1)
    expect(day.from).toBe('2026-10-29T16:00:00.000Z')
    expect(day.to).toBe('2026-10-30T16:00:00.000Z')
    expect(dayKeyOf(day.from, CST)).toBe('2026-10-30')
  })

  it('起点是首个自然日的本地零点，不是 now 往前推 N×24 小时', () => {
    const month = recentDayInterval(now, CST, 30)
    expect(dayKeyOf(month.from, CST)).toBe('2026-10-01')
    expect(month.from).toBe('2026-09-30T16:00:00.000Z')
    expect(month.to).toBe('2026-10-30T16:00:00.000Z')
  })

  it('窗口恰好含 days 个自然日，终点不含', () => {
    for (const days of [1, 30, 180]) {
      const window = recentDayInterval(now, CST, days)
      expect(dayKeyOf(window.to, CST), `days = ${days}`).toBe('2026-10-31')
    }
    expect(dayKeyOf(recentDayInterval(now, CST, 180).from, CST)).toBe('2026-05-04')
  })

  it('窗口随 now 在一天里的位置保持不变，只有归属的那一天决定边界', () => {
    const earlyMorning = recentDayInterval('2026-10-29T17:00:00.000Z', CST, 30)
    const lateNight = recentDayInterval('2026-10-30T15:59:59.999Z', CST, 30)
    expect(earlyMorning).toEqual(lateNight)
  })

  it('跨月界与跨年界', () => {
    const acrossYear = recentDayInterval('2027-01-05T10:00:00.000Z', CST, 30)
    expect(dayKeyOf(acrossYear.from, CST)).toBe('2026-12-07')
    expect(acrossYear.to).toBe('2027-01-05T16:00:00.000Z')
    expect(dayKeyOf(acrossYear.to, CST)).toBe('2027-01-06')
  })

  it('西五区的零点比东八区晚十三个小时', () => {
    // UTC-4 的 2026-10-29 22:00，此时在东八区已是 30 日上午
    const nowInEast = '2026-10-30T02:00:00.000Z'
    expect(recentDayInterval(nowInEast, CST, 1).from).toBe('2026-10-29T16:00:00.000Z')
    expect(recentDayInterval(nowInEast, EDT, 1).from).toBe('2026-10-29T04:00:00.000Z')
    expect(recentDayInterval(nowInEast, EDT, 1).to).toBe('2026-10-30T04:00:00.000Z')
  })

  it('跨度不是正整数时抛错，不返回一个空窗口', () => {
    expect(() => recentDayInterval(now, CST, 0)).toThrow(RangeError)
    expect(() => recentDayInterval(now, CST, -1)).toThrow(RangeError)
    expect(() => recentDayInterval(now, CST, 1.5)).toThrow(RangeError)
  })
})

describe('保留期截止时刻', () => {
  const now = '2026-10-30T10:00:00.000Z'

  it('恰是往前第 N 个自然日的本地零点', () => {
    expect(retentionCutoff(now, CST, 180)).toBe('2026-05-03T16:00:00.000Z')
    expect(dayKeyOf(retentionCutoff(now, CST, 180), CST)).toBe('2026-05-04')
  })

  it('与同跨度的窗口共用同一套边界', () => {
    for (const days of [30, 180]) {
      expect(retentionCutoff(now, CST, days)).toBe(recentDayInterval(now, CST, days).from)
    }
  })

  it('181 天前的记录落在截止时刻之前，179 天前的落在之后', () => {
    const cutoff = Date.parse(retentionCutoff(now, CST, 180))
    // 东八区 2026-05-02 12:00（181 天前）与 2026-05-04 12:00（179 天前）
    expect(Date.parse('2026-05-02T04:00:00.000Z')).toBeLessThan(cutoff)
    expect(Date.parse('2026-05-04T04:00:00.000Z')).toBeGreaterThanOrEqual(cutoff)
  })

  it('截止时刻当天的记录仍保留', () => {
    const cutoff = retentionCutoff(now, CST, 180)
    expect(dayKeyOf(cutoff, CST)).toBe(dayKeyOf('2026-05-04T04:00:00.000Z', CST))
  })

  it('跨年界的截止时刻', () => {
    const cutoff = retentionCutoff('2027-01-05T10:00:00.000Z', CST, 180)
    expect(dayKeyOf(cutoff, CST)).toBe('2026-07-10')
  })
})

describe('同周判定', () => {
  it('周三与同周周日属于同一周', () => {
    expect(isSameWeek('2026-10-28T03:00:00.000Z', CST, '2026-11-01T03:00:00.000Z', CST)).toBe(
      true,
    )
  })

  it('周日与次日周一不属于同一周', () => {
    expect(isSameWeek('2026-11-01T03:00:00.000Z', CST, '2026-11-02T03:00:00.000Z', CST)).toBe(
      false,
    )
  })

  it('周标识取该周周一的自然日', () => {
    expect(weekKeyOf('2026-10-28T03:00:00.000Z', CST)).toBe('2026-10-26')
    expect(weekKeyOf('2026-11-01T03:00:00.000Z', CST)).toBe('2026-10-26')
  })

  it('按本地周标签判定，不按绝对时刻区间', () => {
    // 用户周五在北京记一条，当天飞到纽约又记一条。对他这是同一周，
    // 但两地的「本周一零点」相差 12 小时，比较周区间起点会判成两周。
    const inBeijing = '2026-10-30T02:00:00.000Z'
    const inNewYork = '2026-10-30T20:00:00.000Z'

    expect(weekKeyOf(inBeijing, CST)).toBe('2026-10-26')
    expect(weekKeyOf(inNewYork, EDT)).toBe('2026-10-26')
    expect(isSameWeek(inBeijing, CST, inNewYork, EDT)).toBe(true)

    expect(weekInterval(inBeijing, CST).from).not.toBe(weekInterval(inNewYork, EDT).from)
  })
})

describe('自然周窗口', () => {
  // UTC+8 的 2026-10-28（周三）11:00
  const wednesday = '2026-10-28T03:00:00.000Z'

  it('weeks = 1 就是 now 所在的那一周', () => {
    const one = recentWeekInterval(wednesday, CST, 1)
    expect(one).toEqual(weekInterval(wednesday, CST))
  })

  it('weeks = 12 的首周周一恰在往前第 11 周', () => {
    const twelve = recentWeekInterval(wednesday, CST, 12)
    expect(dayKeyOf(twelve.from, CST)).toBe('2026-08-10')
    expect(dayKeyOf(twelve.to, CST)).toBe('2026-11-02')
    expect(twelve.to).toBe(weekInterval(wednesday, CST).to)
  })

  it('now 恰在周一零点时窗口从当天起算', () => {
    const mondayMidnight = '2026-10-25T16:00:00.000Z'
    const twelve = recentWeekInterval(mondayMidnight, CST, 12)
    expect(dayKeyOf(twelve.from, CST)).toBe('2026-08-10')
    expect(dayKeyOf(twelve.to, CST)).toBe('2026-11-02')
  })

  it('now 在周日最后一毫秒时窗口不变', () => {
    const sundayLastMs = '2026-11-01T15:59:59.999Z'
    expect(recentWeekInterval(sundayLastMs, CST, 12)).toEqual(
      recentWeekInterval(wednesday, CST, 12),
    )
  })

  it('跨年不改变窗口长度', () => {
    const acrossYear = recentWeekInterval('2027-01-06T03:00:00.000Z', CST, 12)
    expect(dayKeyOf(acrossYear.from, CST)).toBe('2026-10-19')
    expect(
      (Date.parse(acrossYear.to) - Date.parse(acrossYear.from)) / 86_400_000,
    ).toBe(84)
  })

  it('西五区的窗口起点比东八区晚十三个小时', () => {
    const instant = '2026-10-28T03:00:00.000Z'
    expect(recentWeekInterval(instant, CST, 12).from).toBe('2026-08-09T16:00:00.000Z')
    expect(recentWeekInterval(instant, CDT, 12).from).toBe('2026-08-10T05:00:00.000Z')
  })

  it('跨度不是正整数时抛错', () => {
    for (const weeks of [0, -1, 1.5]) {
      expect(() => recentWeekInterval(wednesday, CST, weeks)).toThrow(RangeError)
      expect(() => recentWeekKeys(wednesday, CST, weeks)).toThrow(RangeError)
    }
  })
})

describe('自然周标识序列', () => {
  const wednesday = '2026-10-28T03:00:00.000Z'

  it('返回 12 项，时间正序，末项是本週', () => {
    const keys = recentWeekKeys(wednesday, CST, 12)

    expect(keys).toHaveLength(12)
    expect([...keys].sort()).toEqual(keys)
    expect(keys.at(-1)).toBe(weekKeyOf(wednesday, CST))
  })

  it('首项是窗口起点所在的那一天', () => {
    const keys = recentWeekKeys(wednesday, CST, 12)
    expect(keys[0]).toBe(dayKeyOf(recentWeekInterval(wednesday, CST, 12).from, CST))
  })

  it('相邻两项相差恰好七天', () => {
    const keys = recentWeekKeys(wednesday, CST, 12)
    for (let i = 1; i < keys.length; i += 1) {
      expect(daysBetween(keys[i - 1]!, keys[i]!), `第 ${i} 项`).toBe(7)
    }
  })

  it('周日仍算在本周，不滑到下一周', () => {
    const sunday = '2026-11-01T10:00:00.000Z'
    expect(recentWeekKeys(sunday, CST, 1)[0]).toBe('2026-10-26')
  })
})

describe('两个自然日相差的天数', () => {
  it('同一天为 0', () => {
    expect(daysBetween('2026-10-30', '2026-10-30')).toBe(0)
  })

  it('跨月与跨年', () => {
    expect(daysBetween('2026-10-01', '2026-10-30')).toBe(29)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2026-12-07', '2027-01-05')).toBe(29)
  })

  it('闰年的二月', () => {
    expect(daysBetween('2028-02-01', '2028-03-01')).toBe(29)
    expect(daysBetween('2027-02-01', '2027-03-01')).toBe(28)
  })

  it('to 早于 from 时为负数', () => {
    expect(daysBetween('2026-10-30', '2026-10-01')).toBe(-29)
  })

  it('标识不合法时抛错，不返回兜底值', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2026-1-1', 'not-a-day']) {
      expect(() => daysBetween(bad, '2026-10-30'), bad).toThrow(RangeError)
      expect(() => daysBetween('2026-10-30', bad), bad).toThrow(RangeError)
    }
  })
})
