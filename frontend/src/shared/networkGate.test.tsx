// @vitest-environment jsdom
/**
 * 需联网功能在断网时的表现。
 *
 * 三条要求：置灰、不可交互、说清原因；恢复网络后不需要刷新页面就回到可用态。
 * 「说不能点但点了有反应」是这里最容易犯的错，因此断言打在点击是否真的被拦下。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NetworkGate } from './NetworkGate.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** 把浏览器的在线状态切到指定值，并触发对应事件 */
function setOnline(online: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online)
  act(() => {
    window.dispatchEvent(new Event(online ? 'online' : 'offline'))
  })
}

function renderGate(onClick: () => void) {
  return render(
    <NetworkGate>
      <button type="button" onClick={onClick}>
        录音
      </button>
    </NetworkGate>,
  )
}

describe('在线', () => {
  it('内容可点，且不显示断网说明', () => {
    const onClick = vi.fn()
    renderGate(onClick)

    expect(screen.queryByText('需要联网')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '录音' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('断网', () => {
  it('说明需要联网', () => {
    setOnline(false)
    renderGate(vi.fn())

    expect(screen.getByText('需要联网')).toBeTruthy()
  })

  it('点击被真正拦下，而不是只把外观置灰', () => {
    setOnline(false)
    const onClick = vi.fn()
    renderGate(onClick)

    fireEvent.click(screen.getByRole('button', { name: '录音' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('标记为不可用，辅助技术也能感知', () => {
    setOnline(false)
    renderGate(vi.fn())

    expect(document.querySelector('.gate--offline')?.getAttribute('aria-disabled')).toBe('true')
  })

  it('恢复网络后无需刷新即回到可用态', () => {
    setOnline(false)
    const onClick = vi.fn()
    renderGate(onClick)
    expect(screen.getByText('需要联网')).toBeTruthy()

    setOnline(true)

    expect(screen.queryByText('需要联网')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '录音' }))
    expect(onClick).toHaveBeenCalledOnce()
  })
})
