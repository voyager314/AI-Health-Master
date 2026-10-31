/**
 * 趋势图几何的验证。
 *
 * 几何与绘制分开，所以这里不需要渲染任何东西：只断言点的位置、折线在哪里断开、
 * 纵轴刻度是什么。本文件不初始化数据库，几何是纯函数。
 */
import { buildChartGeometry, yAxis } from './chartGeometry.ts'

import { describe, expect, it } from 'vitest'

/** 12 周 × 7 天 = 84 个自然日的窗口，这里只用序号，日期由调用方换算 */
const WEEKS = Array.from({ length: 12 }, () => null as number | null)

function geometry(
  days: { day: string; kg: number }[],
  weeks: (number | null)[],
  toDisplay: (kg: number) => number = (kg) => kg,
) {
  // 用例里的日期只是标识，位置由序号决定；日期与序号的换算归 stats/
  const dayOffsets = days.map((entry, index) => ({ day: entry.day, offset: index + 1 }))
  return buildChartGeometry({ days, weeks, dayOffsets, toDisplay })
}

describe('纵轴', () => {
  it('平稳序列的跨度补足到 1', () => {
    const axis = yAxis([72.4, 72.4, 72.4])

    expect(axis.max - axis.min).toBeGreaterThanOrEqual(1)
    expect(axis.min).toBeLessThan(72.4)
    expect(axis.max).toBeGreaterThan(72.4)
  })

  it('三条参考线自下而上，取值就是上下界与中值', () => {
    const axis = yAxis([70, 74])

    expect(axis.ticks).toHaveLength(3)
    expect(axis.ticks[0]?.value).toBe(axis.min)
    expect(axis.ticks[2]?.value).toBe(axis.max)
    expect(axis.ticks[1]?.value).toBeGreaterThan(axis.min)
    expect(axis.ticks[1]?.value).toBeLessThan(axis.max)
    expect(axis.ticks.map((t) => t.y)).toEqual([0, 0.5, 1])
  })

  it('刻度值都落在一位小数上', () => {
    for (const tick of yAxis([71.23, 73.87]).ticks) {
      expect(Number.isInteger(tick.value * 10)).toBe(true)
    }
  })
})

describe('散点与折线', () => {
  it('没有周均时不产生线段', () => {
    const chart = geometry([{ day: '2026-08-03', kg: 72.4 }], [null, null, null])

    expect(chart.days).toHaveLength(1)
    expect(chart.segments).toEqual([])
    expect(chart.isolated).toEqual([])
  })

  it('两个相邻的周均连成一段', () => {
    const chart = geometry([], [72.0, 72.4, null])

    expect(chart.segments).toHaveLength(1)
    expect(chart.segments[0]?.from.x).toBeLessThan(chart.segments[0]!.to.x)
  })

  it('缺一周均时折线在缺口处断开，不跨过它连线', () => {
    const chart = geometry([], [72.0, null, 73.0])

    expect(chart.segments).toEqual([])
    // 两侧都是孤立点，各自成点
    expect(chart.isolated).toHaveLength(2)
  })

  it('孤立周均只出点，不与隔周相连', () => {
    const chart = geometry([], [null, null, 72.0, null])

    expect(chart.segments).toEqual([])
    expect(chart.isolated).toHaveLength(1)
  })

  it('三周连续时有两段，中间那一周各连一次', () => {
    const chart = geometry([], [72.0, 72.4, 72.6])

    expect(chart.segments).toHaveLength(2)
    expect(chart.segments[1]?.from).toEqual(chart.segments[0]?.to)
  })

  it('周均点在周中，散点在当天', () => {
    const chart = buildChartGeometry({
      days: [{ day: '2026-08-01', kg: 72.0 }],
      weeks: [72.0, ...Array.from({ length: 11 }, () => null)],
      dayOffsets: [{ day: '2026-08-01', offset: 0 }],
      toDisplay: (kg) => kg,
    })

    // 第一天的散点在窗口的最左，宽度的 1/84 处
    expect(chart.days[0]?.x).toBeCloseTo(0.5 / 84, 6)
    // 第一周的周均画在这一周的周中
    expect(chart.isolated[0]?.x).toBeCloseTo(3.5 / 84, 6)
  })

  it('窗口外的当日值不画', () => {
    const chart = buildChartGeometry({
      days: [
        { day: '2026-08-01', kg: 72 },
        { day: '2026-08-02', kg: 73 },
      ],
      weeks: WEEKS,
      // 只有第一天在窗口里
      dayOffsets: [{ day: '2026-08-01', offset: 0 }],
      toDisplay: (kg) => kg,
    })

    expect(chart.days).toHaveLength(1)
  })

  it('纵坐标随上下界归一化，较高的值更靠上', () => {
    const chart = geometry([], [72.0, 73.0])

    expect(chart.segments[0]!.to.y).toBeGreaterThan(chart.segments[0]!.from.y)
  })

  it('斤显示下纵轴按换算后的值取范围', () => {
    const chart = geometry([], [72.0, 72.4], (kg) => kg * 2)

    expect(chart.min).toBeLessThan(144)
    expect(chart.max).toBeGreaterThanOrEqual(144.8)
  })

  it('没有任何数据时仍返回可用的空几何', () => {
    const chart = geometry([], [])

    expect(chart.days).toEqual([])
    expect(chart.segments).toEqual([])
    expect(chart.max).toBeGreaterThan(chart.min)
  })
})
