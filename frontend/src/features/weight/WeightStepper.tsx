/**
 * 体重数值的加减、输入与单位切换。
 *
 * 快速记录与编辑页共用：两处的规则完全相同，差别只在提交调用哪条命令。
 *
 * 对外的值是 kg 且在 0.1 kg 网格上；组件内部按「当前显示单位的文本」保存草稿，
 * 这样用户输入到一半的半成品（`72.`、空串）能原样留在输入框里，不被中途改写。
 * 离开输入框时按显示单位规整并回显，因此提交的就是界面显示的值。
 *
 * 输入框用文本框加 `inputmode="decimal"`，而不是 `type="number"`：后者接受 `1e2`
 * 这种写法，并且在输入未完成时把值报成空串，规整与回显都无从可靠实现。
 */
import { BODY_WEIGHT_MAX_KG, BODY_WEIGHT_MIN_KG } from '@/entities'
import { jinToKg, normalizeKg, stepKg } from '@/domain'

import type { WeightUnit } from './unit.ts'
import { formatDisplay } from './weightFormat.ts'

/** 显示单位下允许的取值区间，提示里用它说话 */
const RANGE: Record<WeightUnit, { readonly min: number; readonly max: number; readonly step: number }> =
  {
    kg: { min: BODY_WEIGHT_MIN_KG, max: BODY_WEIGHT_MAX_KG, step: 0.1 },
    // 1 斤 = 0.5 kg，存储网格 0.1 kg 正好是 0.2 斤
    jin: { min: BODY_WEIGHT_MIN_KG * 2, max: BODY_WEIGHT_MAX_KG * 2, step: 0.2 },
  }

/** 显示单位的值换成 kg 并规整；不在可解析范围内时返回 null */
function toKilograms(raw: number, unit: WeightUnit): number | null {
  const kg = unit === 'jin' ? jinToKg(raw) : normalizeKg(raw)
  return kg < BODY_WEIGHT_MIN_KG || kg > BODY_WEIGHT_MAX_KG ? null : kg
}

/** 草稿文本转成显示单位的数值；空串或无法解析时返回 null */
function parseDraft(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

export interface WeightStepperProps {
  /** 当前值，单位 kg，已在网格上；为 null 表示还没有值 */
  readonly value: number | null
  /** 显示单位 */
  readonly unit: WeightUnit
  /** 切换单位。单位不落库，由调用方决定放在哪里 */
  readonly onUnitChange: (unit: WeightUnit) => void
  /** 值变化。`kg` 已在网格上，`null` 表示输入为空或不合法 */
  readonly onChange: (kg: number | null) => void
  /** 输入了超出范围的值，就地提示，不替用户截断成边界值 */
  readonly invalid?: boolean
  /** 正在写入时禁用加减与单位切换，免得一次提交被改两次 */
  readonly disabled?: boolean
}

export function WeightStepper({
  value,
  unit,
  onUnitChange,
  onChange,
  invalid = false,
  disabled = false,
}: WeightStepperProps) {
  const range = RANGE[unit]
  const shown = value === null ? '' : formatDisplay(value, unit)

  function step(direction: 1 | -1) {
    if (value === null) return
    const next = stepKg(value, direction)
    // 到边界就停住，不把值推出合法范围
    if (next < BODY_WEIGHT_MIN_KG || next > BODY_WEIGHT_MAX_KG) return
    onChange(next)
  }

  /** 离开输入框时规整并回显；空串表示用户清空了值 */
  function commit(text: string) {
    const raw = parseDraft(text)
    if (raw === null) {
      onChange(null)
      return
    }

    const snapped = unit === 'jin' ? Math.round(raw * 10) / 10 : normalizeKg(raw)
    onChange(toKilograms(snapped, unit))
  }

  return (
    <div className="stepper">
      <div className="stepper__units" role="group" aria-label="单位">
        {(['kg', 'jin'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className={`stepper__unit${option === unit ? ' stepper__unit--active' : ''}`}
            aria-pressed={option === unit}
            disabled={disabled}
            onClick={() => onUnitChange(option)}
          >
            {option === 'kg' ? 'kg' : '斤'}
          </button>
        ))}
      </div>

      <div className="stepper__row">
        <button
          type="button"
          className="stepper__button"
          aria-label="减"
          disabled={disabled || value === null}
          onClick={() => step(-1)}
        >
          −
        </button>

        <label className="stepper__field">
          <input
            className="stepper__input"
            type="text"
            inputMode="decimal"
            aria-label="体重"
            autoComplete="off"
            aria-invalid={invalid || undefined}
            disabled={disabled}
            value={shown}
            onChange={(event) => {
              // 输入过程中不打断：只把可解析的值同步上去，半成品留在框里
              const raw = parseDraft(event.target.value)
              onChange(
                raw === null
                  ? null
                  : toKilograms(
                      unit === 'jin' ? Math.round(raw * 10) / 10 : normalizeKg(raw),
                      unit,
                    ),
              )
            }}
            onBlur={(event) => commit(event.target.value)}
          />
          <span className="stepper__suffix">{unit === 'jin' ? '斤' : 'kg'}</span>
        </label>

        <button
          type="button"
          className="stepper__button"
          aria-label="加"
          disabled={disabled || value === null}
          onClick={() => step(1)}
        >
          +
        </button>
      </div>

      {invalid ? (
        <p className="field__error" role="alert">
          取值范围为 {range.min}–{range.max} {unit === 'jin' ? '斤' : 'kg'}
        </p>
      ) : null}
    </div>
  )
}
