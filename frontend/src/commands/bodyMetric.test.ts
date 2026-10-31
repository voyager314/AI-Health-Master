/**
 * 体重记录三条命令的行为验证。
 *
 * 与运动命令同一套口径：载荷不合规时不碰数据库、合法载荷落库并留下恰一条写操作
 * 日志、幂等与「测量时刻不可改」这类规则在命令层确实生效。
 *
 * 时刻用固定时钟注入：`measured_at` 与 `updated_at` 的断言都依赖今天是哪一天。
 */
import type { BodyMetric } from '@/entities'
import { RecordValidationError } from '@/storage/internal'
import { COMMANDS, CommandPayloadError, createCommandBus, type CommandBus } from '@/commands'
import {
  recordBodyMetric,
  removeBodyMetric,
  updateBodyMetric,
} from '@/commands/bodyMetric.ts'
import { createTestDb, readPendingOps, snapshotOf, type TestDb } from '@/test/db.ts'
import { fixedDate, someId } from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let testDb: TestDb

/** 东八区的 2026-10-30 18:00 */
const TODAY = '2026-10-30T10:00:00.000Z'
const CST = 480

function busWith(clock: string = TODAY): CommandBus {
  return createCommandBus({
    definitions: [recordBodyMetric, updateBodyMetric, removeBodyMetric] as never,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate(clock, CST),
  })
}

/** 一条合法的新建载荷 */
function aDraft(weightKg = 72.4) {
  return { client_id: someId(), weight_kg: weightKg }
}

async function rows(includeDeleted = true): Promise<BodyMetric[]> {
  return testDb.repos.body_metric.list({ includeDeleted })
}

beforeEach(async () => {
  testDb = await createTestDb('body-metric-cmd')
})

afterEach(() => testDb.close())

describe('命令登记', () => {
  it('三条命令都登记在册，且命令类型唯一', () => {
    const types = COMMANDS.map((c) => c.type)
    for (const type of ['body_metric/record', 'body_metric/update', 'body_metric/remove']) {
      expect(types).toContain(type)
    }
    expect(new Set(types).size).toBe(types.length)
  })
})

describe('记录', () => {
  it('合法载荷落库，测量时刻取总线时刻，备注为空', async () => {
    const result = await busWith().apply('body_metric/record', aDraft(72.4))

    const [record] = await rows()
    expect(record).toMatchObject({
      weight_kg: 72.4,
      measured_at: TODAY,
      note: null,
      tz_offset_minutes: CST,
      version: 1,
      deleted_at: null,
    })
    expect(result).toBe(record!.id)
    expect(await readPendingOps(testDb)).toHaveLength(1)
  })

  it('离网格的载荷被拒，数据库与写操作日志都不动', async () => {
    await expect(busWith().apply('body_metric/record', aDraft(72.45))).rejects.toThrow(
      CommandPayloadError,
    )

    expect(await rows()).toEqual([])
    expect(await readPendingOps(testDb)).toEqual([])
  })

  it('超出范围的载荷被拒', async () => {
    for (const weight of [0.5, 500.1]) {
      await expect(busWith().apply('body_metric/record', aDraft(weight))).rejects.toThrow(
        CommandPayloadError,
      )
    }
    expect(await rows()).toEqual([])
  })

  it('幂等键不合法的载荷被拒', async () => {
    await expect(
      busWith().apply('body_metric/record', { client_id: 'abc', weight_kg: 72.4 }),
    ).rejects.toThrow(CommandPayloadError)
  })

  it('同一幂等键提交两次只产生一条记录', async () => {
    const draft = aDraft(72.4)
    const bus = busWith()

    const first = await bus.apply('body_metric/record', draft)
    const second = await bus.apply('body_metric/record', draft)

    expect(second).toBe(first)
    expect(await rows()).toHaveLength(1)
  })

  it('幂等键已被软删除时也不复活、不复制', async () => {
    const draft = aDraft(72.4)
    const bus = busWith()

    const id = await bus.apply('body_metric/record', draft)
    await bus.apply('body_metric/remove', { client_id: draft.client_id })
    await bus.apply('body_metric/record', draft)

    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.id).toBe(id)
    expect(stored[0]?.deleted_at).not.toBeNull()
  })

  it('载荷里带的测量时刻与备注不会进入写入路径', async () => {
    await busWith().apply('body_metric/record', {
      ...aDraft(72.4),
      measured_at: '2020-01-01T00:00:00.000Z',
      note: '早上空腹',
    } as never)

    const [record] = await rows()
    expect(record?.measured_at).toBe(TODAY)
    expect(record?.note).toBeNull()
  })
})

describe('修改', () => {
  async function seedRecord(): Promise<{ client_id: string; id: string }> {
    const draft = aDraft(72.4)
    const id = (await busWith().apply('body_metric/record', draft)) as string
    return { client_id: draft.client_id, id }
  }

  it('只改数值，测量时刻与创建时刻不变', async () => {
    const { client_id, id } = await seedRecord()

    const changed = await busWith('2026-10-30T11:00:00.000Z').apply('body_metric/update', {
      client_id,
      weight_kg: 72.6,
    })

    const [record] = await rows()
    expect(changed).toBe(true)
    expect(record?.weight_kg).toBe(72.6)
    expect(record?.id).toBe(id)
    expect(record?.measured_at).toBe(TODAY)
    expect(record?.created_at).toBe(TODAY)
    expect(record?.updated_at).toBe('2026-10-30T11:00:00.000Z')
    expect(record?.version).toBe(1)
  })

  it('载荷里的测量时刻被忽略', async () => {
    const { client_id } = await seedRecord()

    await busWith().apply('body_metric/update', {
      client_id,
      weight_kg: 72.6,
      measured_at: '2020-01-01T00:00:00.000Z',
    } as never)

    expect((await rows())[0]?.measured_at).toBe(TODAY)
  })

  it('离网格的数值被拒，记录保持原值', async () => {
    const { client_id } = await seedRecord()

    await expect(
      busWith().apply('body_metric/update', { client_id, weight_kg: 72.45 }),
    ).rejects.toThrow(CommandPayloadError)

    expect((await rows())[0]?.weight_kg).toBe(72.4)
  })

  it('记录不存在时返回 false，不新建', async () => {
    const result = await busWith().apply('body_metric/update', aDraft(72.6))

    expect(result).toBe(false)
    expect(await rows()).toEqual([])
  })

  it('记录已删除时返回 false，墓碑保持原样', async () => {
    const { client_id } = await seedRecord()
    const bus = busWith()
    await bus.apply('body_metric/remove', { client_id })
    const before = (await rows())[0]

    expect(await bus.apply('body_metric/update', { client_id, weight_kg: 72.6 })).toBe(false)
    expect((await rows())[0]).toEqual(before)
  })
})

describe('删除', () => {
  it('写 deleted_at，常规查询与导出都不再包含它', async () => {
    const draft = aDraft(72.4)
    const bus = busWith()
    await bus.apply('body_metric/record', draft)

    expect(await bus.apply('body_metric/remove', { client_id: draft.client_id })).toBe(true)

    const [tombstone] = await rows()
    expect(tombstone?.deleted_at).toBe(TODAY)
    expect(await rows(false)).toEqual([])
    expect((await snapshotOf(testDb, TODAY)).records.body_metric).toEqual([])
  })

  it('记录不存在时返回 false，业务数据不变', async () => {
    expect(await busWith().apply('body_metric/remove', { client_id: someId() })).toBe(false)
    expect(await rows()).toEqual([])
  })
})

describe('落库前的记录校验', () => {
  it('写入离网格的值会被存储层拒绝', async () => {
    const record = {
      id: someId(),
      client_id: someId(),
      user_id: 'local',
      version: 1,
      created_at: TODAY,
      updated_at: TODAY,
      deleted_at: null,
      tz_offset_minutes: CST,
      measured_at: TODAY,
      weight_kg: 72.45,
      note: null,
    } as BodyMetric

    await expect(testDb.repos.body_metric.put(record)).rejects.toThrow(RecordValidationError)
  })
})
