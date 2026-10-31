/**
 * 体重趋势图的几何计算。
 *
 * 与绘制分开：这里只回答「每个点画在归一化坐标的哪里、折线在哪断开」，不产生
 * 任何 SVG 元素。规则因此可以脱离渲染单测，改版式时也不容易把断线与刻度顺手改坏。
 *
 * 坐标为 0–1 的比例，横向自窗口首日到末日，纵向自纵轴下界到上界。像素换算由
 * 组件负责，本文件不碰尺寸。
 *
 * 本文件不做日期运算：日与周的位置都由调用方给出的相对天数决定，那个天数来自
 * `stats/timeWindow`。
 */
/** 图上一个点 */
export interface ChartPoint {
  /** 横向位置，0–1 */
  readonly x: number
  /** 纵向位置，0–1，越大越靠上 */
  readonly y: number
}

/** 折线的一段：两个相邻且都有周均的周 */
export interface ChartSegment {
  readonly from: ChartPoint
  readonly to: ChartPoint
}

/** 一条纵轴参考线 */
export interface ChartTick {
  /** 纵向位置，0–1 */
  readonly y: number
  /** 刻度值，单位与调用方给出的换算一致 */
  readonly value: number
}

export interface ChartGeometry {
  /** 当日值散点 */
  readonly days: readonly ChartPoint[]
  /** 相邻周之间的连线，缺口处不出现 */
  readonly segments: readonly ChartSegment[]
  /** 孤立周均的点：两侧都没有周均，连线无从画起 */
  readonly isolated: readonly ChartPoint[]
  /** 三条参考线，自下而上 */
  readonly ticks: readonly ChartTick[]
  /** 纵轴下界，已规整到换算后的一位小数 */
  readonly min: number
  /** 纵轴上界 */
  readonly max: number
}

/** 绘制所需的全部输入 */
export interface ChartInput {
  /** 窗口内的当日值，按日正序 */
  readonly days: readonly { readonly day: string; readonly kg: number }[]
  /**
   * 逐周顺序的周均，单位 kg；没有到达门槛的周为 null，折线在该处断开。
   * 序列长度即窗口的周数，缺口必须保留位置，否则两侧会被连成一条跨过空缺的线。
   */
  readonly weeks: readonly (number | null)[]
  /**
   * 每一天在窗口里的第几天，0 起算。由调用方用 `stats` 的天数换算得到，
   * 本文件不碰日期。落在窗口外的日不画。
   */
  readonly dayOffsets: readonly { readonly day: string; readonly offset: number }[]
  /** kg 换成当前显示单位；斤显示下乘 2 */
  readonly toDisplay: (kg: number) => number
}

/** 纵轴的最小跨度，单位同显示单位。一条平稳的序列不该被拉伸成剧烈起伏 */
const MIN_SPAN = 1

/** 上下留白占跨度的比例 */
const PADDING_RATIO = 0.15

/** 一周按七天算，图上每周的周均画在周中 */
const DAYS_PER_WEEK = 7

/** 四舍五入到换算单位的一位小数，返回整数十分位 */
function toTenths(value: number): number {
  return Math.round(value * 10)
}

/**
 * 求纵轴范围与刻度。
 *
 * 范围包住全部绘制值并上下留白；跨度不足 `MIN_SPAN` 时补足，避免平稳序列被放大
 * 成锯齿。三条参考线均分上下界，因此刻度标签就是下界、中值、上界本身。
 */
export function yAxis(values: readonly number[]): { min: number; max: number; ticks: ChartTick[] } {
  if (values.length === 0) return { min: 0, max: MIN_SPAN, ticks: [] }

  const lowest = Math.min(...values)
  const highest = Math.max(...values)
  const span = highest - lowest
  const pad = span < MIN_SPAN ? (MIN_SPAN - span) / 2 + span * PADDING_RATIO : span * PADDING_RATIO

  const minTenths = toTenths(lowest - pad)
  const maxTenths = Math.max(toTenths(highest + pad), minTenths + toTenths(MIN_SPAN))
  const midTenths = Math.round((minTenths + maxTenths) / 2)

  const min = minTenths / 10
  const max = maxTenths / 10
  const ticks = [minTenths, midTenths, maxTenths].map((tenths) => ({
    y: (tenths - minTenths) / (maxTenths - minTenths),
    value: tenths / 10,
  }))

  return { min, max, ticks }
}

/**
 * 算出整张图的几何。
 *
 * 日的位置取它在窗口里的第几天，周均取该周周中。纵坐标按 `yAxis` 的范围归一化。
 */
export function buildChartGeometry(input: ChartInput): ChartGeometry {
  const totalDays = input.weeks.length * DAYS_PER_WEEK
  const offsets = new Map(input.dayOffsets.map((entry) => [entry.day, entry.offset]))

  const days = input.days.flatMap((entry) => {
    const offset = offsets.get(entry.day)
    if (offset === undefined || offset < 0 || offset >= totalDays) return []
    return [{ x: (offset + 0.5) / totalDays, value: input.toDisplay(entry.kg) }]
  })

  const weekPoints = input.weeks.map((kg, index) => {
    if (kg === null) return null
    const middleDay = index * DAYS_PER_WEEK + DAYS_PER_WEEK / 2
    return { x: middleDay / totalDays, value: input.toDisplay(kg) }
  })

  const drawn = [
    ...days.map((d) => d.value),
    ...weekPoints.flatMap((p) => (p === null ? [] : [p.value])),
  ]
  const { min, max, ticks } = yAxis(drawn)

  const place = (x: number, value: number): ChartPoint => ({
    x,
    y: (value - min) / (max - min || MIN_SPAN),
  })

  const segments: ChartSegment[] = []
  const isolated: ChartPoint[] = []
  weekPoints.forEach((point, index) => {
    if (point === null) return
    const previous = index > 0 ? weekPoints[index - 1] : null
    const next = index < weekPoints.length - 1 ? weekPoints[index + 1] : null

    if (previous) {
      segments.push({
        from: place(previous.x, previous.value),
        to: place(point.x, point.value),
      })
    } else if (!next) {
      isolated.push(place(point.x, point.value))
    }
  })

  return {
    days: days.map((d) => place(d.x, d.value)),
    segments,
    isolated,
    ticks,
    min,
    max,
  }
}
