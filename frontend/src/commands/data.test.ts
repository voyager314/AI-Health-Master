/**
 * 导入与清空的执行验证。
 *
 * 重点在原子性：整库替换中途失败时，库要么是原样、要么是新样。留下「旧数据没了、
 * 新数据只写了一半」的中间状态，在本地优先架构下等于直接丢数据。
 */
import { createCommandBus } from '@/commands'
import { COMMANDS } from '@/commands/index.ts'
import { ALL_STORE_NAMES } from '@/entities'
import { StorageWriteError, createNow, withAuditForCreate } from '@/storage/internal'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { aBodyMetric, anExercise, fixedDate } from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let testDb: TestDb

const now = createNow(() => fixedDate('2026-10-29T02:00:00.000Z', 480))

beforeEach(async () => {
  testDb = await createTestDb('data-commands')
})

afterEach(() => testDb.close())

function bus() {
  return createCommandBus({
    definitions: COMMANDS,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate('2026-10-29T02:00:00.000Z', 480),
  })
}

async function seed() {
  const exercise = withAuditForCreate('exercise', anExercise({ name: '旧动作' }), now)
  const weight = withAuditForCreate('body_metric', aBodyMetric({ weight_kg: 70 }), now)
  await testDb.repos.exercise.put(exercise)
  await testDb.repos.body_metric.put(weight)
  return { exercise, weight }
}

describe('导入', () => {
  it('用文件内容替换全库', async () => {
    await seed()

    const incoming = withAuditForCreate('exercise', anExercise({ name: '新动作' }), now)
    await bus().apply('data/import', { records: { exercise: [incoming] } })

    const exercises = await testDb.repos.exercise.list()
    expect(exercises.map((e) => e.name)).toEqual(['新动作'])
    // 文件里没有的表被清空
    expect(await testDb.repos.body_metric.list()).toEqual([])
  })

  it('记录逐字段保留，含审计字段', async () => {
    const incoming = withAuditForCreate('body_metric', aBodyMetric({ weight_kg: 72.6 }), now)
    await bus().apply('data/import', { records: { body_metric: [incoming] } })

    expect(await testDb.repos.body_metric.get(incoming.id)).toEqual(incoming)
  })

  it('整库替换不写操作日志——载荷就是整个数据集', async () => {
    await bus().apply('data/import', { records: {} })

    expect(await testDb.db.getAll('pending_ops')).toEqual([])
  })

  it('中途有记录不合规时整体回滚，原数据完好', async () => {
    const original = await seed()

    const good = withAuditForCreate('exercise', anExercise({ name: '合法' }), now)
    const bad = { ...good, weight_kg: 'totally-wrong', id: 'not-a-uuid' }

    await expect(
      // 绕开解析层的校验，直接喂进命令，验证写入层自己的兜底
      bus().apply('data/import', { records: { exercise: [good, bad] } }),
    ).rejects.toThrow(StorageWriteError)

    const exercises = await testDb.repos.exercise.list()
    expect(exercises.map((e) => e.name)).toEqual(['旧动作'])
    expect(exercises[0]?.id).toBe(original.exercise.id)
    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
  })

  it('记录不是数组时拒绝，且不碰数据库', async () => {
    await seed()

    await expect(
      bus().apply('data/import', { records: { exercise: 'not-an-array' } }),
    ).rejects.toThrow(StorageWriteError)

    expect(await testDb.repos.exercise.list()).toHaveLength(1)
  })

  it('缺少记录集合时拒绝执行', async () => {
    await seed()

    await expect(bus().apply('data/import', {})).rejects.toThrow(/records/)

    expect(await testDb.repos.exercise.list()).toHaveLength(1)
  })
})

describe('清空', () => {
  it('清空全部 12 张表', async () => {
    await seed()
    await testDb.repos.app_meta.put(
      withAuditForCreate(
        'app_meta',
        { consent_at: '2026-10-01T00:00:00.000Z', last_export_at: null },
        now,
      ),
    )
    await testDb.db.put('blob', {
      id: '01a182ae-25f7-7661-b587-84998ff6f6df',
      mime: 'image/png',
      bytes: new Blob(['x']),
      byte_size: 1,
      created_at: now.iso,
    })
    await testDb.db.put('analytics_event', {
      id: '01a182ae-25f8-7661-b587-84998ff6f6df',
      name: 'app_open',
      occurred_at: now.iso,
      tz_offset_minutes: 480,
      props: { pwa: true },
      user_id: 'local',
    })

    await bus().apply('data/clear_all')

    for (const name of ALL_STORE_NAMES) {
      expect(await testDb.db.getAll(name), name).toEqual([])
    }
  })

  it('清空后同意记录消失，应用回到首次使用状态', async () => {
    await testDb.repos.app_meta.put(
      withAuditForCreate(
        'app_meta',
        { consent_at: '2026-10-01T00:00:00.000Z', last_export_at: null },
        now,
      ),
    )

    await bus().apply('data/clear_all')

    expect(await testDb.repos.app_meta.list()).toEqual([])
  })

  it('清空不写操作日志', async () => {
    await seed()
    await bus().apply('data/clear_all')

    expect(await testDb.db.getAll('pending_ops')).toEqual([])
  })

  it('空库上清空不报错', async () => {
    await expect(bus().apply('data/clear_all')).resolves.toBeUndefined()
  })
})
