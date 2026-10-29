/**
 * 埋点机制的验证。
 *
 * 三件事必须成立：事件真的落库、失败时不影响业务、属性没有越过隐私边界。
 * 第三条尤其重要——埋点是最容易在「顺手多记一个字段」中慢慢越界的地方，
 * 等到发现时历史数据已经收完了。
 */
import { trackAppOpen, trackClearData, trackExport } from '@/telemetry'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { fixedDate } from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const AT = '2026-10-29T02:00:00.000Z'

let testDb: TestDb

beforeEach(async () => {
  testDb = await createTestDb('telemetry')
})

afterEach(() => testDb.close())

function deps() {
  return { clock: () => fixedDate(AT, 480), getDb: testDb.getDb }
}

async function events() {
  return testDb.db.getAll('analytics_event')
}

describe('事件落库', () => {
  it('应用打开写入一条事件，含时刻与时区偏移', async () => {
    await trackAppOpen({ pwa: false, ...deps() })

    const [event] = await events()
    expect(event?.name).toBe('app_open')
    expect(event?.occurred_at).toBe(AT)
    expect(event?.tz_offset_minutes).toBe(480)
  })

  it('首次打开标记为 first，再次打开标记为否', async () => {
    await trackAppOpen({ pwa: false, ...deps() })
    await trackAppOpen({ pwa: true, ...deps() })

    const all = await events()
    expect(all[0]?.props.first).toBe(true)
    expect(all[1]?.props.first).toBe(false)
  })

  it('以独立窗口启动时记录 pwa 为真', async () => {
    await trackAppOpen({ pwa: true, ...deps() })

    expect((await events())[0]?.props.pwa).toBe(true)
  })

  it('导出事件记录格式与文件数', async () => {
    await trackExport({ format: 'csv', files: 3, ...deps() })

    const [event] = await events()
    expect(event?.name).toBe('export')
    expect(event?.props.format).toBe('csv')
    expect(event?.props.files).toBe(3)
  })

  it('清空事件记录清空前的记录条数', async () => {
    await trackClearData({ records: 128, ...deps() })

    const [event] = await events()
    expect(event?.name).toBe('clear_data')
    expect(event?.props.records).toBe(128)
  })

  it('每条事件有独立主键', async () => {
    await trackAppOpen({ pwa: false, ...deps() })
    await trackAppOpen({ pwa: false, ...deps() })

    const all = await events()
    expect(all[0]?.id).not.toBe(all[1]?.id)
  })
})

describe('失败不影响业务', () => {
  it('写入失败时不抛错', async () => {
    const failing = {
      clock: () => fixedDate(AT, 480),
      getDb: async () => {
        throw new Error('数据库不可用')
      },
    }

    await expect(trackAppOpen({ pwa: false, ...failing })).resolves.toBeUndefined()
    await expect(trackExport({ format: 'json', files: 1, ...failing })).resolves.toBeUndefined()
    await expect(trackClearData({ records: 0, ...failing })).resolves.toBeUndefined()
  })

  it('写入失败后数据库未被改动，可继续正常使用', async () => {
    await trackAppOpen({
      pwa: false,
      clock: () => fixedDate(AT, 480),
      getDb: async () => {
        throw new Error('数据库不可用')
      },
    })

    await trackExport({ format: 'json', files: 1, ...deps() })

    expect(await events()).toHaveLength(1)
  })
})

describe('隐私边界', () => {
  it('属性只含标量，没有嵌套结构', async () => {
    await trackAppOpen({ pwa: true, ...deps() })
    await trackExport({ format: 'json', files: 2, ...deps() })
    await trackClearData({ records: 5, ...deps() })

    for (const event of await events()) {
      for (const value of Object.values(event.props)) {
        expect(['string', 'number', 'boolean'].includes(typeof value)).toBe(true)
      }
    }
  })

  it('属性名不含自由文本、图片、位置与设备标识', async () => {
    await trackAppOpen({ pwa: true, ...deps() })
    await trackExport({ format: 'json', files: 2, ...deps() })
    await trackClearData({ records: 5, ...deps() })

    const banned = ['text', 'note', 'photo', 'image', 'transcript', 'device', 'lat', 'lon']
    for (const event of await events()) {
      const keys = Object.keys(event.props).map((k) => k.toLowerCase())
      for (const word of banned) {
        expect(keys.some((k) => k.includes(word)), `${event.name}.${word}`).toBe(false)
      }
    }
  })

  it('身体数据不记录精确值', async () => {
    // 清空事件只带条数，不带任何体重、容量之类的身体数值
    await trackClearData({ records: 3, ...deps() })

    const [event] = await events()
    const keys = Object.keys(event!.props).map((k) => k.toLowerCase())
    expect(keys.some((k) => /weight|kg|tonnage|protein/.test(k))).toBe(false)
  })
})

describe('不上报', () => {
  it('埋点源文件里没有任何网络调用', async () => {
    const { telemetrySources } = await import('@/test/sources.ts')
    for (const source of telemetrySources) {
      expect(source).not.toMatch(/\bfetch\s*\(/)
      expect(source).not.toMatch(/XMLHttpRequest/)
      expect(source).not.toMatch(/sendBeacon/)
      expect(source).not.toMatch(/new\s+WebSocket/)
    }
  })
})
