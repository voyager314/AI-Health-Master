/**
 * 运动记录四条命令的行为验证。
 *
 * 命令是应用层唯一的写入口，因此这里的断言覆盖三件事：载荷不合规时不碰数据库、
 * 合法载荷落库并留下恰一条写操作日志、幂等与保留期这类规则在命令层确实生效。
 *
 * 时刻全部用固定时钟注入：保留期与提交时刻的断言都依赖「今天是哪一天」。
 */
import type { WorkoutItem, WorkoutLog } from '@/entities'
import {
  COMMANDS,
  CommandPayloadError,
  createCommandBus,
  type CommandBus,
} from '@/commands'
import {
  createWorkoutLog,
  purgeExpiredWorkoutLogs,
  removeWorkoutLog,
  updateWorkoutLog,
} from '@/commands/workoutLog.ts'
import { createTestDb, readPendingOps, snapshotOf, type TestDb } from '@/test/db.ts'
import { aBodyMetric, fixedDate, someId } from '@/test/fixtures.ts'
import { makeRecord, momentAt } from '@/test/records.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let testDb: TestDb

/** 东八区的 2026-10-30 18:00 */
const TODAY = '2026-10-30T10:00:00.000Z'
const CST = 480

function busWith(clock: string = TODAY): CommandBus {
  return createCommandBus({
    definitions: [
      createWorkoutLog,
      updateWorkoutLog,
      removeWorkoutLog,
      purgeExpiredWorkoutLogs,
    ] as never,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate(clock, CST),
  })
}

/** 一张只有项目名与组数的卡片 */
function aCard(name: string, sets: number | null = 4): WorkoutItem {
  return { name, sets, reps: null, weight_kg: null, note: null }
}

/** 一次合法的新建载荷 */
function aDraft(items: WorkoutItem[] = [aCard('卧推')]) {
  return { client_id: someId(), items }
}

async function logsInStore(): Promise<WorkoutLog[]> {
  return (await testDb.repos.workout_log.list({ includeDeleted: true })) as WorkoutLog[]
}

/** 用应用真实的命令表装配总线，验证登记本身 */
function registeredBus(clock: string = TODAY): CommandBus {
  return createCommandBus({
    definitions: COMMANDS,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate(clock, CST),
  })
}

beforeEach(async () => {
  testDb = await createTestDb('workout-cmd')
})

afterEach(() => testDb.close())

describe('命令登记', () => {
  it('四条命令都登记在册，且命令类型唯一', async () => {
    const types = COMMANDS.map((c) => c.type)

    expect(new Set(types).size).toBe(types.length)
    for (const expected of [
      'workout_log/create',
      'workout_log/update',
      'workout_log/remove',
      'workout_log/purge_expired',
    ]) {
      expect(types).toContain(expected)
    }
  })

  it('每种命令执行后写操作日志恰增一条', async () => {
    const bus = registeredBus()
    const draft = aDraft()

    const steps: readonly [string, unknown][] = [
      ['workout_log/create', draft],
      ['workout_log/update', { client_id: draft.client_id, items: [aCard('卧推', 5)] }],
      ['workout_log/remove', { client_id: draft.client_id }],
      ['app_meta/grant_consent', null],
    ]

    for (const [type, payload] of steps) {
      const before = (await readPendingOps(testDb)).length
      await bus.apply(type, payload)
      const after = await readPendingOps(testDb)

      expect(after, type).toHaveLength(before + 1)
      expect(after.at(-1)?.command_type, type).toBe(type)
    }
  })
})

describe('新建', () => {
  it('空卡片数组被拒绝，数据库未被触碰', async () => {
    const bus = busWith()

    await expect(bus.apply('workout_log/create', aDraft([]))).rejects.toThrow(
      CommandPayloadError,
    )
    expect(await logsInStore()).toEqual([])
    expect(await readPendingOps(testDb)).toEqual([])
  })

  it('缺项目名的卡片被拒绝', async () => {
    const bus = busWith()
    const draft = { client_id: someId(), items: [{ ...aCard(''), name: '' }] }

    const error = (await bus
      .apply('workout_log/create', draft)
      .catch((e: unknown) => e)) as CommandPayloadError

    expect(error).toBeInstanceOf(CommandPayloadError)
    expect(error.issues[0]?.field).toBe('items[0].name')
    expect(await logsInStore()).toEqual([])
  })

  it('合法载荷落库，时刻与来源由命令写入', async () => {
    const bus = busWith()
    const draft = aDraft([aCard('卧推'), aCard('划船', null)])

    const id = (await bus.apply('workout_log/create', draft)) as string
    const [record] = await logsInStore()

    expect(record?.id).toBe(id)
    expect(record?.client_id).toBe(draft.client_id)
    expect(record?.logged_at).toBe(TODAY)
    expect(record?.input_source).toBe('manual')
    expect(record?.items).toHaveLength(2)
    expect(record?.deleted_at).toBeNull()
  })

  it('恰增一条写操作日志', async () => {
    const bus = busWith()
    await bus.apply('workout_log/create', aDraft())

    const ops = await readPendingOps(testDb)
    expect(ops).toHaveLength(1)
    expect(ops[0]?.command_type).toBe('workout_log/create')
  })

  it('同一 client_id 再次提交不产生第二条记录', async () => {
    const bus = busWith()
    const draft = aDraft()

    const first = (await bus.apply('workout_log/create', draft)) as string
    const second = (await bus.apply('workout_log/create', draft)) as string

    expect(second).toBe(first)
    expect(await logsInStore()).toHaveLength(1)
  })

  it('载荷里的时刻与来源不被采纳', async () => {
    const bus = busWith()
    const id = (await bus.apply('workout_log/create', {
      ...aDraft(),
      logged_at: '2020-01-01T00:00:00.000Z',
      input_source: 'voice',
    })) as string

    const record = (await testDb.repos.workout_log.get(id)) as WorkoutLog
    expect(record.logged_at).toBe(TODAY)
    expect(record.input_source).toBe('manual')
  })
})

describe('编辑', () => {
  it('卡片被替换，created_at 不变，updated_at 刷新', async () => {
    const draft = aDraft([aCard('卧推', 3)])
    await busWith().apply('workout_log/create', draft)
    const [before] = await logsInStore()

    // 换一个更晚的时刻执行编辑
    const later = '2026-10-30T11:00:00.000Z'
    await busWith(later).apply('workout_log/update', {
      client_id: draft.client_id,
      items: [aCard('卧推', 4)],
    })

    const [after] = await logsInStore()
    expect(after?.items[0]?.sets).toBe(4)
    expect(after?.id).toBe(before?.id)
    expect(after?.created_at).toBe(before?.created_at)
    expect(after?.updated_at).toBe(later)
  })

  it('传入的时刻与来源被忽略', async () => {
    const draft = aDraft()
    await busWith().apply('workout_log/create', draft)

    await busWith('2026-10-30T11:00:00.000Z').apply('workout_log/update', {
      client_id: draft.client_id,
      items: [aCard('卧推', 5)],
      logged_at: '2020-01-01T00:00:00.000Z',
      input_source: 'voice',
    })

    const [record] = await logsInStore()
    expect(record?.logged_at).toBe(TODAY)
    expect(record?.input_source).toBe('manual')
  })

  it('记录不存在时返回 false，不新建也不报错', async () => {
    const bus = busWith()

    const changed = await bus.apply('workout_log/update', aDraft())

    expect(changed).toBe(false)
    expect(await logsInStore()).toEqual([])
  })
})

describe('删除', () => {
  it('写 deleted_at，list 不再返回，导出不含它', async () => {
    const draft = aDraft()
    await busWith().apply('workout_log/create', draft)

    const removed = await busWith().apply('workout_log/remove', {
      client_id: draft.client_id,
    })

    expect(removed).toBe(true)
    expect(await testDb.repos.workout_log.list()).toEqual([])

    const [tombstone] = await logsInStore()
    expect(tombstone?.deleted_at).toBe(TODAY)
    // 记录本身还在，不是物理删除
    expect(tombstone?.items).toHaveLength(1)

    const snapshot = await snapshotOf(testDb, TODAY)
    expect(snapshot.records.workout_log).toEqual([])
  })

  it('已删除的记录不因再次新建同一 client_id 而复活或复制', async () => {
    const draft = aDraft()
    await busWith().apply('workout_log/create', draft)
    await busWith().apply('workout_log/remove', { client_id: draft.client_id })

    await busWith().apply('workout_log/create', draft)

    const all = await logsInStore()
    expect(all).toHaveLength(1)
    expect(all[0]?.deleted_at).not.toBeNull()
  })
})

describe('保留期清理', () => {
  /**
   * 往前 `days` 个自然日的东八区中午。
   *
   * 借 `Date` 的日历运算而不是自己乘一天的毫秒数：日界算术只允许出现在
   * `stats/timeWindow`，测试里另写一份同样会绕过那条约束。
   */
  function daysAgo(days: number): string {
    const at = new Date(TODAY)
    at.setUTCDate(at.getUTCDate() - (days - 1))
    return at.toISOString()
  }

  /** 直接写入一条指定时刻的记录，绕过命令以控制时刻 */
  async function seedAt(loggedAt: string): Promise<string> {
    const bus = busWith(loggedAt)
    return (await bus.apply('workout_log/create', aDraft())) as string
  }

  it('181 天前的记录被删除，179 天前的保留', async () => {
    const expired = await seedAt(daysAgo(181))
    const kept = await seedAt(daysAgo(179))

    const removed = await busWith().apply('workout_log/purge_expired')

    expect(removed).toBe(1)
    expect(await testDb.repos.workout_log.get(expired)).toBeUndefined()
    expect(await testDb.repos.workout_log.get(kept)).toBeDefined()
  })

  it('截止时刻当天的记录属于保留期第一天，因此保留', async () => {
    const firstKeptDay = await seedAt('2026-05-04T04:00:00.000Z')

    await busWith().apply('workout_log/purge_expired')

    expect(await testDb.repos.workout_log.get(firstKeptDay)).toBeDefined()
  })

  it('截止时刻的前一毫秒仍算超期', async () => {
    const justExpired = await seedAt('2026-05-03T15:59:59.999Z')

    await busWith().apply('workout_log/purge_expired')

    expect(await testDb.repos.workout_log.get(justExpired)).toBeUndefined()
  })

  it('没有超期记录时不新增写操作日志', async () => {
    await seedAt(daysAgo(10))
    const before = await readPendingOps(testDb)

    const removed = await busWith().apply('workout_log/purge_expired')

    expect(removed).toBe(0)
    expect(await readPendingOps(testDb)).toHaveLength(before.length)
    expect(await logsInStore()).toHaveLength(1)
  })

  it('有超期记录时留下恰一条日志', async () => {
    await seedAt(daysAgo(200))
    const before = await readPendingOps(testDb)

    await busWith().apply('workout_log/purge_expired')

    const ops = await readPendingOps(testDb)
    expect(ops).toHaveLength(before.length + 1)
    expect(ops.at(-1)?.command_type).toBe('workout_log/purge_expired')
  })

  it('软删除的墓碑也一并清理', async () => {
    const draft = aDraft()
    await busWith(daysAgo(200)).apply('workout_log/create', draft)
    await busWith().apply('workout_log/remove', { client_id: draft.client_id })

    await busWith().apply('workout_log/purge_expired')

    expect(await logsInStore()).toEqual([])
  })

  it('只清理运动记录，不碰其他表', async () => {
    const metric = makeRecord(
      'body_metric',
      aBodyMetric({ measured_at: daysAgo(200) }),
      momentAt(daysAgo(200), CST),
    )
    await testDb.repos.body_metric.put(metric)

    await busWith().apply('workout_log/purge_expired')

    expect(await testDb.repos.body_metric.get(metric.id)).toBeDefined()
  })
})
