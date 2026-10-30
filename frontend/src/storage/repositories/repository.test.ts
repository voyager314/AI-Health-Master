/**
 * Repository 的六个方法形状、软删除语义与可翻译查询。
 */
import { BUSINESS_STORE_NAMES } from '@/entities'
import { closeDatabase, openDatabase } from '@/storage/indexeddb/db.ts'
import type { AppDb } from '@/storage/indexeddb/schema.ts'
import { createNow, withAuditForCreate, withAuditForUpdate } from '@/storage/indexeddb/write.ts'
import { createRepositories } from '@/storage/repositories/index.ts'
import type { RepositorySet } from '@/storage/repositories/types.ts'
import {
  aBodyMetric,
  aWorkoutLog,
  fixedDate,
  uniqueDbName,
} from '@/test/fixtures.ts'
import type { IDBPDatabase } from 'idb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let db: IDBPDatabase<AppDb>
let repos: RepositorySet

beforeEach(async () => {
  const dbName = uniqueDbName('repo')
  db = await openDatabase({ dbName })
  // 注入指向本用例独立库的 provider，用例之间互不干扰
  repos = createRepositories(async () => db)
})

afterEach(() => {
  db.close()
  closeDatabase()
})

describe('接口形状', () => {
  it('6 张业务表各有且仅有一个 Repository', () => {
    expect(Object.keys(repos).sort()).toEqual([...BUSINESS_STORE_NAMES].sort())
    expect(Object.keys(repos)).toHaveLength(6)
  })

  it('每个 Repository 都暴露统一的 6 个方法', () => {
    const expected = ['list', 'get', 'put', 'remove', 'query', 'clear']
    for (const name of BUSINESS_STORE_NAMES) {
      const repo = repos[name] as unknown as Record<string, unknown>
      for (const method of expected) {
        expect(typeof repo[method], `${name}.${method}`).toBe('function')
      }
      expect(Object.keys(repo).sort()).toEqual([...expected].sort())
    }
  })
})

describe('写入与读取', () => {
  it('put 之后能按主键取回，字段逐一相等', async () => {
    const record = withAuditForCreate('workout_log', aWorkoutLog(), createNow())
    await repos.workout_log.put(record)

    expect(await repos.workout_log.get(record.id)).toEqual(record)
  })

  it('put 会校验记录，脏数据不进库', async () => {
    const record = {
      ...withAuditForCreate('workout_log', aWorkoutLog(), createNow()),
      items: [{ name: '卧推', sets: 0, reps: null, weight_kg: null, note: null }],
    }

    await expect(repos.workout_log.put(record)).rejects.toThrow(/items\[0\]\.sets/)
    expect(await repos.workout_log.list()).toEqual([])
  })

  it('list 默认按 user_id 索引取数，取到本用户的记录', async () => {
    const now = createNow()
    await repos.workout_log.put(withAuditForCreate('workout_log', aWorkoutLog(), now))
    await repos.workout_log.put(withAuditForCreate('workout_log', aWorkoutLog(), now))

    expect(await repos.workout_log.list()).toHaveLength(2)
  })

  it('空表的 list 返回空数组而不是报错', async () => {
    expect(await repos.workout_log.list()).toEqual([])
  })

  it('get 不存在的主键返回 undefined', async () => {
    expect(await repos.workout_log.get('01a182ae-25f7-7661-b587-84998ff6f6df')).toBeUndefined()
  })
})

describe('软删除', () => {
  it('remove 后按主键仍可取到记录，但 list 不返回它', async () => {
    const record = withAuditForCreate('body_metric', aBodyMetric(), createNow())
    await repos.body_metric.put(record)

    const at = createNow(() => fixedDate('2026-10-29T04:00:00.000Z', 480))
    await repos.body_metric.remove(record.id, at)

    const tombstone = await repos.body_metric.get(record.id)
    expect(tombstone).toBeDefined()
    expect(tombstone?.deleted_at).toBe('2026-10-29T04:00:00.000Z')
    // 记录内容保留，不是物理删除
    expect(tombstone?.weight_kg).toBe(record.weight_kg)

    expect(await repos.body_metric.list()).toEqual([])
  })

  it('includeDeleted 能把墓碑取回来', async () => {
    const record = withAuditForCreate('body_metric', aBodyMetric(), createNow())
    await repos.body_metric.put(record)
    await repos.body_metric.remove(record.id, createNow())

    const withTombstones = await repos.body_metric.list({ includeDeleted: true })
    expect(withTombstones).toHaveLength(1)
  })

  it('remove 不存在的主键返回 undefined，不抛错', async () => {
    const at = createNow()
    expect(
      await repos.workout_log.remove('01a182ae-25f7-7661-b587-84998ff6f6df', at),
    ).toBeUndefined()
  })

  it('重复 remove 保持首次的删除时刻', async () => {
    const record = withAuditForCreate('body_metric', aBodyMetric(), createNow())
    await repos.body_metric.put(record)

    await repos.body_metric.remove(
      record.id,
      createNow(() => fixedDate('2026-10-29T04:00:00.000Z', 480)),
    )
    await repos.body_metric.remove(
      record.id,
      createNow(() => fixedDate('2026-11-05T04:00:00.000Z', 480)),
    )

    expect((await repos.body_metric.get(record.id))?.deleted_at).toBe(
      '2026-10-29T04:00:00.000Z',
    )
  })
})

describe('查询', () => {
  beforeEach(async () => {
    const now = createNow()
    for (const [day, source] of [
      ['2026-10-01', 'manual'],
      ['2026-10-15', 'voice'],
      ['2026-11-01', 'manual'],
    ] as const) {
      await repos.workout_log.put(
        withAuditForCreate(
          'workout_log',
          aWorkoutLog({ logged_at: `${day}T10:00:00.000Z`, input_source: source }),
          now,
        ),
      )
    }
  })

  it('区间取数，对应 WHERE logged_at BETWEEN ? AND ?', async () => {
    const october = await repos.workout_log.query({
      index: 'logged_at',
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' },
    })
    expect(october).toHaveLength(2)
  })

  it('索引取数后的内存过滤，对应其余的 AND 条件', async () => {
    const voice = await repos.workout_log.query({
      index: 'logged_at',
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' },
      filter: (row) => row.input_source === 'voice',
    })
    expect(voice).toHaveLength(1)
  })

  it('查询默认排除软删除记录', async () => {
    const [first] = await repos.workout_log.query({
      index: 'logged_at',
      range: { from: '2026-10-01T00:00:00.000Z' },
    })
    await repos.workout_log.remove(first!.id, createNow())

    expect(
      await repos.workout_log.query({
        index: 'logged_at',
        range: { from: '2026-10-01T00:00:00.000Z' },
      }),
    ).toHaveLength(2)
    expect(
      await repos.workout_log.query({
        index: 'logged_at',
        range: { from: '2026-10-01T00:00:00.000Z' },
        includeDeleted: true,
      }),
    ).toHaveLength(3)
  })

  it('limit 在过滤之后应用', async () => {
    const limited = await repos.workout_log.query({ index: 'user_id', equals: 'local', limit: 2 })
    expect(limited).toHaveLength(2)
  })
})

describe('更新与清空', () => {
  it('put 同一主键是覆盖，不是新增', async () => {
    const record = withAuditForCreate('body_metric', aBodyMetric({ weight_kg: 72.4 }), createNow())
    await repos.body_metric.put(record)

    const updated = withAuditForUpdate(
      record,
      { weight_kg: 72.6 },
      createNow(() => fixedDate('2026-10-29T04:00:00.000Z', 480)),
    )
    await repos.body_metric.put(updated)

    const all = await repos.body_metric.list()
    expect(all).toHaveLength(1)
    expect(all[0]?.weight_kg).toBe(72.6)
    expect(all[0]?.created_at).toBe(record.created_at)
  })

  it('clear 物理清空整张表', async () => {
    await repos.workout_log.put(withAuditForCreate('workout_log', aWorkoutLog(), createNow()))
    await repos.workout_log.clear()

    expect(await repos.workout_log.list({ includeDeleted: true })).toEqual([])
  })
})
