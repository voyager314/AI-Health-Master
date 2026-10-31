/**
 * 体重的显示单位，存在地址栏的 `?unit=` 里，不落库。
 *
 * 放在地址里而不是组件状态里：从斤显示的明细点进编辑页时，编辑页要沿用同一个单位；
 * 浏览器后退回到体重页时，单位也不该莫名回到 kg。放进地址参数，两件事都自然成立。
 *
 * 底部导航链接到不带参数的地址，应用重新打开也落在根路径，因此「每次打开回到 kg」
 * 由链接本身保证，不需要额外的清理。参数缺失或取值不合法时按 kg 处理。
 */
import { useSearchParams } from 'react-router'

import type { WeightUnit } from './unit.ts'

const PARAM = 'unit'

/** 读出一个地址参数里的单位；无法识别时返回 kg */
export function unitFromParam(raw: string | null): WeightUnit {
  return raw === 'jin' ? 'jin' : 'kg'
}

export interface WeightUnitState {
  /** 当前显示单位 */
  readonly unit: WeightUnit
  /** 切换单位。替换当前浏览记录，不新增一条，后退因此不会在两种单位之间往返 */
  readonly setUnit: (unit: WeightUnit) => void
}

export function useWeightUnit(): WeightUnitState {
  const [params, setParams] = useSearchParams()
  const unit = unitFromParam(params.get(PARAM))

  function setUnit(next: WeightUnit) {
    const updated = new URLSearchParams(params)
    if (next === 'kg') updated.delete(PARAM)
    else updated.set(PARAM, next)
    setParams(updated, { replace: true })
  }

  return { unit, setUnit }
}
