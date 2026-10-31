/**
 * 体重趋势图：近 12 周的周均折线，叠上每天的当日值散点。
 *
 * 自绘 SVG，不引图表库：图里只有两组数据与三条参考线，库带来的体积与样式适配
 * 成本都不划算。几何全部来自 `chartGeometry`，本组件只做坐标换算与描边。
 *
 * 颜色只用既有设计令牌，深浅色随 `light-dark()` 切换。图带文字替代：读屏读到的是
 * 图表范围与本周状态；数据的完整文本形态是图表下方的明细。
 *
 * 纵向比例里 0 在下方、1 在上方，与 SVG 的坐标方向相反，换算时取 `1 - y`。
 */
import { useId } from 'react'

import { kgToJin } from '@/domain'
import type { ChartGeometry } from './chartGeometry.ts'
import type { WeightUnit } from './unit.ts'

/**
 * 画布的逻辑尺寸。显示宽度撑满容器，高度按 CSS 里的比例缩放；`preserveAspectRatio`
 * 保持默认的等比缩放，刻度文字才不会随容器宽度被横向拉长。
 */
const VIEW_WIDTH = 320
const VIEW_HEIGHT = 160

/** 四周留给刻度文字与留白的边距 */
const MARGIN = { top: 12, right: 12, bottom: 20, left: 36 }

const PLOT_WIDTH = VIEW_WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = VIEW_HEIGHT - MARGIN.top - MARGIN.bottom

export interface WeightChartProps {
  /** 几何：散点、折线段、孤立点与参考线 */
  readonly geometry: ChartGeometry
  /** 当前显示单位，决定刻度与说明里的单位后缀 */
  readonly unit: WeightUnit
  /** 本周周均，单位 kg；不足 3 天时为 null */
  readonly thisWeekKg: number | null
  /** 本周已记录的天数，用于「数据不足」时的说明 */
  readonly thisWeekDays: number
}

function xOf(value: number): number {
  return MARGIN.left + value * PLOT_WIDTH
}

function yOf(value: number): number {
  return MARGIN.top + (1 - value) * PLOT_HEIGHT
}

/** 刻度值按当前单位显示一位小数 */
function tickLabel(value: number, unit: WeightUnit): string {
  return `${value.toFixed(1)} ${unit === 'jin' ? '斤' : 'kg'}`
}

export function WeightChart({ geometry, unit, thisWeekKg, thisWeekDays }: WeightChartProps) {
  const titleId = useId()

  const summary =
    thisWeekKg === null
      ? `近 12 周体重趋势。本周数据太少，已记录 ${thisWeekDays} 天。`
      : `近 12 周体重趋势。本周周均 ${tickLabel(
          unit === 'jin' ? kgToJin(thisWeekKg) : thisWeekKg,
          unit,
        )}。`

  return (
    <figure className="chart">
      <figcaption className="visually-hidden" id={titleId}>
        {summary}
      </figcaption>
      <svg
        className="chart__svg"
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick.y}>
            <line
              className="chart__grid"
              x1={MARGIN.left}
              x2={VIEW_WIDTH - MARGIN.right}
              y1={yOf(tick.y)}
              y2={yOf(tick.y)}
            />
            <text className="chart__tick" x={MARGIN.left - 6} y={yOf(tick.y)} textAnchor="end">
              {tick.value.toFixed(1)}
            </text>
            {/* 只在下界标出单位，三条都带会让纵轴显得拥挤 */}
            {tick.y === 0 ? (
              <text className="chart__tick" x={MARGIN.left - 6} y={yOf(tick.y) + 12} textAnchor="end">
                {unit === 'jin' ? '斤' : 'kg'}
              </text>
            ) : null}
          </g>
        ))}

        {geometry.segments.map((segment, index) => (
          <line
            key={`segment-${index}`}
            className="chart__line"
            x1={xOf(segment.from.x)}
            y1={yOf(segment.from.y)}
            x2={xOf(segment.to.x)}
            y2={yOf(segment.to.y)}
          />
        ))}

        {geometry.isolated.map((point, index) => (
          <circle
            key={`week-${index}`}
            className="chart__week"
            cx={xOf(point.x)}
            cy={yOf(point.y)}
            r={3.5}
          />
        ))}

        {geometry.days.map((point, index) => (
          <circle
            key={`day-${index}`}
            className="chart__day"
            cx={xOf(point.x)}
            cy={yOf(point.y)}
            r={2}
          />
        ))}
      </svg>
    </figure>
  )
}
