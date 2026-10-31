// @vitest-environment jsdom
/**
 * 步进组件的行为：加减、输入规整、单位切换、边界与空值。
 *
 * 组件是受控的，因此用例里包一层最小的状态，模拟调用方怎么接它。断言打在可交互性
 * 与输入框的可见值上——用户感知的就是这两件事。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WeightUnit } from './unit.ts'
import { WeightStepper } from './WeightStepper.tsx'

afterEach(cleanup)

/** 受控的最小宿主：值由用例读回，单位由用例指定 */
function Harness({
  initial,
  unit = 'kg',
  onChange,
}: {
  initial: number | null
  unit?: WeightUnit
  onChange?: (kg: number | null) => void
}) {
  const [value, setValue] = useState<number | null>(initial)

  return (
    <>
      <WeightStepper
        value={value}
        unit={unit}
        onUnitChange={() => {}}
        onChange={(next) => {
          setValue(next)
          onChange?.(next)
        }}
        invalid={value === null && false}
      />
      <output data-testid="kg">{value === null ? 'null' : String(value)}</output>
    </>
  )
}

function input(): HTMLInputElement {
  return screen.getByLabelText('体重') as HTMLInputElement
}

describe('步进', () => {
  it('预填值按一位小数显示', () => {
    render(<Harness initial={72.4} />)
    expect(input().value).toBe('72.4')
  })

  it('kg 下加减各走 0.1', () => {
    const seen: (number | null)[] = []
    render(<Harness initial={72.4} onChange={(kg) => seen.push(kg)} />)

    fireEvent.click(screen.getByRole('button', { name: '加' }))
    fireEvent.click(screen.getByRole('button', { name: '减' }))

    expect(seen).toEqual([72.5, 72.4])
  })

  it('连续加 20 次不累积浮点误差', () => {
    render(<Harness initial={70} />)

    const plus = screen.getByRole('button', { name: '加' })
    for (let i = 0; i < 20; i += 1) fireEvent.click(plus)

    expect(input().value).toBe('72.0')
    expect(screen.getByTestId('kg').textContent).toBe('72')
  })

  it('到上界后不再增加', () => {
    render(<Harness initial={500} />)

    fireEvent.click(screen.getByRole('button', { name: '加' }))

    expect(input().value).toBe('500.0')
  })
})

describe('斤显示', () => {
  it('切换单位为斤后显示两倍的值', () => {
    render(<Harness initial={72.4} unit="jin" />)
    expect(input().value).toBe('144.8')
  })

  it('斤下按一次加是 0.2 斤', () => {
    const seen: (number | null)[] = []
    render(<Harness initial={72.4} unit="jin" onChange={(kg) => seen.push(kg)} />)

    fireEvent.click(screen.getByRole('button', { name: '加' }))

    expect(seen).toEqual([72.5])
    expect(input().value).toBe('145.0')
  })

  it('斤下输入 145.3，离开输入框后回显 145.4', () => {
    render(<Harness initial={72.4} unit="jin" />)

    fireEvent.change(input(), { target: { value: '145.3' } })
    fireEvent.blur(input())

    expect(input().value).toBe('145.4')
    expect(screen.getByTestId('kg').textContent).toBe('72.7')
  })
})

describe('输入', () => {
  it('kg 下输入 72.46，离开输入框后回显 72.5', () => {
    render(<Harness initial={72.4} />)

    fireEvent.change(input(), { target: { value: '72.46' } })
    fireEvent.blur(input())

    expect(input().value).toBe('72.5')
    expect(screen.getByTestId('kg').textContent).toBe('72.5')
  })

  it('清空输入表示没有值，加减不可用', () => {
    render(<Harness initial={72.4} />)

    fireEvent.change(input(), { target: { value: '' } })
    fireEvent.blur(input())

    expect(screen.getByTestId('kg').textContent).toBe('null')
    expect((screen.getByRole('button', { name: '加' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '减' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('空值时加与减都不可用', () => {
    render(<Harness initial={null} />)

    expect((screen.getByRole('button', { name: '加' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '减' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('单位切换', () => {
  it('点单位按钮把选择交给调用方', () => {
    const onUnitChange = vi.fn()
    render(
      <WeightStepper
        value={72.4}
        unit="kg"
        onUnitChange={onUnitChange}
        onChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '斤' }))

    expect(onUnitChange).toHaveBeenCalledWith('jin')
  })
})
