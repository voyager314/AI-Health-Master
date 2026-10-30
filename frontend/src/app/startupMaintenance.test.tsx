// @vitest-environment jsdom
/**
 * 启动维护的行为。
 *
 * 两件事必须同时成立：清理发生在业务页面渲染之前，且清理失败不阻止启动。
 * 前者决定用户会不会先看到超期记录再看着它们消失，后者决定一次维护失败会不会
 * 让整个应用打不开——两者的后果不对称，所以各自独立断言。
 */
import { applyCommand } from '@/commands'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { aWorkoutLog } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import { defaultRepositories, readDefaultPendingOps, resetDefaultDatabase } from '@/test/seed.ts'

import { StartupMaintenance } from './StartupMaintenance.tsx'

beforeEach(async () => {
  await resetDefaultDatabase()
})

afterEach(async () => {
  cleanup()
  await resetDefaultDatabase()
})

/** 写入一条 `days` 天前的运动记录，返回主键 */
async function seedOldLog(days: number): Promise<string> {
  const at = new Date()
  at.setDate(at.getDate() - days)
  const repos = defaultRepositories()
  const record = makeRecord(
    'workout_log',
    aWorkoutLog({ logged_at: at.toISOString() }),
    momentAt(at.toISOString(), -at.getTimezoneOffset()),
  )
  await repos.workout_log.put(record)
  return record.id
}

describe('清理时机', () => {
  it('业务内容渲染之前发出清理命令', async () => {
    const calls: string[] = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    render(
      <StartupMaintenance
        run={(type) => {
          calls.push(type)
          return gate
        }}
      >
        <p>业务页面</p>
      </StartupMaintenance>,
    )

    // 命令已发出，而业务内容尚未出现
    expect(calls).toEqual(['workout_log/purge_expired'])
    expect(screen.queryByText('业务页面')).toBeNull()

    release()

    expect(await screen.findByText('业务页面')).toBeTruthy()
  })

  it('等待期间展示准备占位而不是空白', () => {
    render(
      <StartupMaintenance run={() => new Promise(() => undefined)}>
        <p>业务页面</p>
      </StartupMaintenance>,
    )

    expect(screen.getByRole('status', { name: '正在准备本地数据' })).toBeTruthy()
  })
})

describe('清理失败', () => {
  it('应用照常进入主界面，超期记录仍在库中', async () => {
    const expired = await seedOldLog(200)

    render(
      <StartupMaintenance
        run={() => {
          // 清理失败不弹错、不拦截：维护动作没有用户可做的补救
          throw new Error('写入失败')
        }}
      >
        <p>主界面</p>
      </StartupMaintenance>,
    )

    expect(await screen.findByText('主界面')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await defaultRepositories().workout_log.get(expired)).toBeDefined()
  })
})

describe('真实命令', () => {
  it('默认走命令总线，超期记录被清掉', async () => {
    const expired = await seedOldLog(200)
    const kept = await seedOldLog(10)

    render(
      <StartupMaintenance>
        <p>主界面</p>
      </StartupMaintenance>,
    )

    expect(await screen.findByText('主界面')).toBeTruthy()
    await waitFor(async () => {
      expect(await defaultRepositories().workout_log.get(expired)).toBeUndefined()
    })
    expect(await defaultRepositories().workout_log.get(kept)).toBeDefined()
  })

  it('清理本身也走命令层，因此留下写操作日志', async () => {
    await seedOldLog(200)

    render(
      <StartupMaintenance>
        <p>主界面</p>
      </StartupMaintenance>,
    )

    await screen.findByText('主界面')
    await waitFor(async () => {
      const ops = await readDefaultPendingOps()
      expect(ops.map((op) => op.command_type)).toContain('workout_log/purge_expired')
    })
  })
})

describe('命令层可用性', () => {
  it('清理命令已登记，可直接执行', async () => {
    await expect(applyCommand('workout_log/purge_expired')).resolves.toBe(0)
  })
})
