/**
 * 任务 4.1 / 4.2 / 4.3 的验收：Command 层的单一写入口、事务原子性与失败可感知。
 *
 * 覆盖约束 9（写操作走统一 Command 层、每次写入记 pending_ops）与 FR-S01.6
 * （写入失败必须可感知、禁止静默丢数据、多记录写入全有或全无）。
 */
import type { BodyMetric } from '@/entities'
import {
  CommandPayloadError,
  DuplicateCommandError,
  UnknownCommandError,
  createCommandBus,
  defineCommand,
  type CommandBus,
} from '@/commands'
import { StorageWriteError, withAuditForCreate } from '@/storage/internal'
import { createTestDb, readPendingOps, type TestDb } from '@/test/db.ts'
import { aBodyMetric, anExercise, fixedDate } from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let testDb: TestDb

/** 正常写一条体重记录 */
const recordWeight = defineCommand<{ weightKg: number }, string>({
  type: 'body_metric/record',
  stores: ['body_metric'],
  validate: (payload) => {
    const p = payload as { weightKg?: unknown }
    return typeof p?.weightKg === 'number' && p.weightKg > 0
      ? []
      : [{ field: 'weightKg', message: '应为正数' }]
  },
  handler: async (ctx, payload) => {
    const record = withAuditForCreate(
      'body_metric',
      aBodyMetric({ weight_kg: payload.weightKg }),
      ctx.now,
    )
    await ctx.repos.body_metric.put(record, ctx.tx)
    return record.id
  },
})

/** 跨两张表写入，用于验证多记录的全有或全无 */
const recordTwoTables = defineCommand<{ fail: boolean }, void>({
  type: 'test/two_tables',
  stores: ['body_metric', 'exercise'],
  handler: async (ctx, payload) => {
    await ctx.repos.body_metric.put(
      withAuditForCreate('body_metric', aBodyMetric(), ctx.now),
      ctx.tx,
    )
    if (payload.fail) throw new Error('第二张表写入前失败')
    await ctx.repos.exercise.put(
      withAuditForCreate('exercise', anExercise(), ctx.now),
      ctx.tx,
    )
  },
})

/** 模拟配额满：浏览器在空间不足时抛的就是这个 name */
const quotaFull = defineCommand<null, void>({
  type: 'test/quota_full',
  stores: ['body_metric'],
  handler: async () => {
    const error = new Error('存储空间不足')
    error.name = 'QuotaExceededError'
    throw error
  },
})

function busWith(...definitions: Parameters<typeof createCommandBus>[0]['definitions']): CommandBus {
  return createCommandBus({
    definitions,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate('2026-10-28T04:00:00.000Z', 480),
  })
}

beforeEach(async () => {
  testDb = await createTestDb('cmd')
})

afterEach(() => testDb.close())

describe('注册表', () => {
  it('未注册的命令类型被拒绝，且不碰数据库', async () => {
    const bus = busWith(recordWeight)

    await expect(bus.apply('nope/at_all', {})).rejects.toThrow(UnknownCommandError)

    expect(await testDb.repos.body_metric.list()).toEqual([])
    expect(await readPendingOps(testDb)).toEqual([])
  })

  it('错误信息里列出已注册的类型，便于排查拼写错误', async () => {
    const bus = busWith(recordWeight)
    await expect(bus.apply('body_metric/recrod', {})).rejects.toThrow(/body_metric\/record/)
  })

  it('同一类型注册两次在装配时就失败，而不是静默覆盖', () => {
    expect(() => busWith(recordWeight, recordWeight)).toThrow(DuplicateCommandError)
  })
})

describe('载荷校验', () => {
  it('载荷不合法时拒绝执行，且不碰数据库', async () => {
    const bus = busWith(recordWeight)

    await expect(bus.apply('body_metric/record', { weightKg: -1 })).rejects.toThrow(
      CommandPayloadError,
    )

    expect(await testDb.repos.body_metric.list()).toEqual([])
    expect(await readPendingOps(testDb)).toEqual([])
  })

  it('校验失败的错误带上字段与原因', async () => {
    const bus = busWith(recordWeight)
    const error = await bus.apply('body_metric/record', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CommandPayloadError)
    expect((error as CommandPayloadError).issues[0]?.field).toBe('weightKg')
  })
})

describe('成功路径', () => {
  it('一次成功的命令产生恰一条 pending_ops', async () => {
    const bus = busWith(recordWeight)
    await bus.apply('body_metric/record', { weightKg: 72.6 })

    const ops = await readPendingOps(testDb)
    expect(ops).toHaveLength(1)
    expect(ops[0]?.command_type).toBe('body_metric/record')
    expect(ops[0]?.payload).toEqual({ weightKg: 72.6 })
    expect(ops[0]?.applied_at).toBe('2026-10-28T04:00:00.000Z')
    expect(ops[0]?.tz_offset_minutes).toBe(480)
  })

  it('业务数据落库，且与日志用同一个时刻', async () => {
    const bus = busWith(recordWeight)
    const id = (await bus.apply('body_metric/record', { weightKg: 72.6 })) as string

    const record = (await testDb.repos.body_metric.get(id)) as BodyMetric
    expect(record.weight_kg).toBe(72.6)
    expect(record.created_at).toBe('2026-10-28T04:00:00.000Z')

    const ops = await readPendingOps(testDb)
    expect(ops[0]?.applied_at).toBe(record.created_at)
  })

  it('handler 的返回值透传给调用方', async () => {
    const bus = busWith(recordWeight)
    const id = await bus.apply('body_metric/record', { weightKg: 70 })
    expect(typeof id).toBe('string')
  })

  it('连续两条命令产生两条日志', async () => {
    const bus = busWith(recordWeight)
    await bus.apply('body_metric/record', { weightKg: 72.0 })
    await bus.apply('body_metric/record', { weightKg: 72.4 })

    expect(await readPendingOps(testDb)).toHaveLength(2)
    expect(await testDb.repos.body_metric.list()).toHaveLength(2)
  })
})

describe('失败回滚（FR-S06.3 / FR-S01.6）', () => {
  it('handler 抛错时业务数据未变更，且 pending_ops 不留这条失败的命令', async () => {
    const bus = busWith(recordTwoTables)

    await expect(bus.apply('test/two_tables', { fail: true })).rejects.toThrow(
      StorageWriteError,
    )

    // 第一张表在抛错前已经写过了，但事务整体回滚，不应留下半条数据
    expect(await testDb.repos.body_metric.list()).toEqual([])
    expect(await readPendingOps(testDb)).toEqual([])
  })

  it('多记录写入是全有或全无', async () => {
    const bus = busWith(recordTwoTables)

    await bus.apply('test/two_tables', { fail: false })
    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
    expect(await testDb.repos.exercise.list()).toHaveLength(1)

    await expect(bus.apply('test/two_tables', { fail: true })).rejects.toThrow()
    // 失败那次没有增加任何记录
    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
    expect(await testDb.repos.exercise.list()).toHaveLength(1)
  })

  it('配额满被识别为可重试，并带上可提示用户的原因', async () => {
    const bus = busWith(quotaFull)
    const error = (await bus.apply('test/quota_full', null).catch((e: unknown) => e)) as
      StorageWriteError

    expect(error).toBeInstanceOf(StorageWriteError)
    expect(error.reason).toBe('quota_exceeded')
    expect(error.retryable).toBe(true)
    // FR-S01.6 要求提示「先导出数据、再清理历史图片」
    expect(error.message).toContain('导出')
    expect(error.message).toContain('清理')
    // 禁止表现为「已保存」：抛错即未保存
    expect(error.message).toContain('没有保存成功')
  })

  it('失败错误保留原始异常，便于排查', async () => {
    const bus = busWith(quotaFull)
    const error = (await bus.apply('test/quota_full', null).catch((e: unknown) => e)) as
      StorageWriteError

    expect((error.cause as Error).name).toBe('QuotaExceededError')
    expect(error.commandType).toBe('test/quota_full')
  })

  it('失败后数据库仍可用，重试能成功', async () => {
    const bus = busWith(quotaFull, recordWeight)

    await expect(bus.apply('test/quota_full', null)).rejects.toThrow()
    await bus.apply('body_metric/record', { weightKg: 72.6 })

    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
    expect(await readPendingOps(testDb)).toHaveLength(1)
  })
})

describe('事务边界', () => {
  it('handler 里 await 非 IndexedDB 的 Promise 会失败，而不是静默丢数据', async () => {
    const awaitsExternal = defineCommand<null, void>({
      type: 'test/awaits_external',
      stores: ['body_metric'],
      handler: async (ctx) => {
        // 把控制权交回事件循环，IndexedDB 事务会在此自动提交
        await new Promise((resolve) => setTimeout(resolve, 0))
        await ctx.repos.body_metric.put(
          withAuditForCreate('body_metric', aBodyMetric(), ctx.now),
          ctx.tx,
        )
      },
    })

    const bus = busWith(awaitsExternal)
    await expect(bus.apply('test/awaits_external', null)).rejects.toThrow(StorageWriteError)
    expect(await testDb.repos.body_metric.list()).toEqual([])
  })

  it('未声明的 store 写不进去，不会悄悄扩大事务范围', async () => {
    const undeclared = defineCommand<null, void>({
      type: 'test/undeclared_store',
      stores: ['body_metric'],
      handler: async (ctx) => {
        await ctx.repos.exercise.put(
          withAuditForCreate('exercise', anExercise(), ctx.now),
          ctx.tx,
        )
      },
    })

    const bus = busWith(undeclared)
    await expect(bus.apply('test/undeclared_store', null)).rejects.toThrow(StorageWriteError)
    expect(await testDb.repos.exercise.list()).toEqual([])
  })
})
