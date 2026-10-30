/**
 * 导出与导入的往返一致性。
 *
 * 这是整条数据链路唯一的端到端断言：导出、清空、导入之后，库必须与导出前逐字段
 * 相等。任何一处字段在序列化或写入时被转换、丢弃或改写，都会在这里显形——包括
 * 时间字段被漂移成另一时区的等价时刻这种最难察觉的情形。
 *
 * 断言比对整条记录而不是挑几个字段：挑字段等于假定「没挑的就是没问题的」，
 * 而往返丢数据恰恰发生在没人挑的那些字段上。
 */
import { createCommandBus } from '@/commands'
import { COMMANDS } from '@/commands/index.ts'
import { BUSINESS_STORE_NAMES, type BusinessStoreName } from '@/entities'
import { createDataTransfer, type DataTransfer } from '@/features/data'
import type { FileSink } from '@/shared'
import { LATEST_SCHEMA_VERSION, createBlobReader, snapshotDatabase } from '@/storage'
import { makeRecord, momentAt } from '@/test/records.ts'
import { createTestDb, type TestDb } from '@/test/db.ts'
import {
  aBodyMetric,
  aMeal,
  aMealItem,
  aTarget,
  aWorkoutLog,
  anAppMeta,
  fixedDate,
} from '@/test/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const AT = '2026-10-29T02:15:30.000Z'
/** 西半球偏移：用来验证往返不会把时间悄悄换算到设备所在时区 */
const AT_WEST = '2026-10-28T21:40:00.000Z'

let testDb: TestDb
let saved: { filename: string; text: string }[]
let sink: FileSink
let transfer: DataTransfer

beforeEach(async () => {
  testDb = await createTestDb('roundtrip')
  saved = []
  sink = {
    async save(file) {
      saved.push({ filename: file.filename, text: file.text })
    },
  }

  const bus = createCommandBus({
    definitions: COMMANDS,
    repos: testDb.repos,
    getDb: testDb.getDb,
    clock: () => fixedDate(AT, 480),
  })

  transfer = createDataTransfer({
    applyCommand: (type, payload) => bus.apply(type, payload),
    snapshot: (takenAt) => snapshotDatabase(takenAt, testDb.getDb),
    now: () => fixedDate(AT, 480),
    schemaVersion: LATEST_SCHEMA_VERSION,
  })
})

afterEach(() => testDb.close())

/** 种子记录只需要主键：外键断言取的就是它 */
type Seeded = Record<BusinessStoreName, { id: string }>

/**
 * 往 6 张业务表各写一条记录，字段取值刻意互不相同。
 *
 * 取值相同的话，字段串位（把 A 的字段写进 B）在往返后依然「相等」，测不出来。
 * 外键指向本次真实构造出的记录，而不是各自随机的主键——指向不存在的记录时，
 * 往返后「相等」也不说明关系被保住了。偏移刻意东西半球混用，让时间字段的
 * 原样保留能被真正检验到。
 */
async function seedAllTables(): Promise<Seeded> {
  const east = momentAt(AT, 480)
  const west = momentAt(AT_WEST, -300)

  // 被引用的记录先建，后面的外键取它们的真实主键
  const meal = makeRecord(
    'meal',
    aMeal({
      eaten_at: AT,
      note: '训练后一餐',
      photo_ref: null,
      total_kcal: 780,
      protein_g: 52,
      carb_g: 90,
      fat_g: 22,
      ai_confidence: 'low',
    }),
    east,
  )

  const records: Seeded = {
    workout_log: makeRecord(
      'workout_log',
      aWorkoutLog({
        logged_at: AT,
        input_source: 'voice',
        items: [
          { name: '杠铃卧推', sets: 4, reps: 8, weight_kg: 82.5, note: '右肩有点紧' },
          // 只记得项目名：三项指标全为 null 是合法状态
          { name: '飞鸟', sets: null, reps: null, weight_kg: null, note: null },
          // 只有部分指标
          { name: '深蹲', sets: 5, reps: null, weight_kg: 100, note: null },
        ],
      }),
      west,
    ),
    body_metric: makeRecord(
      'body_metric',
      aBodyMetric({ measured_at: AT_WEST, weight_kg: 72.6, note: '睡前称的' }),
      west,
    ),
    meal,
    meal_item: makeRecord(
      'meal_item',
      aMealItem({
        meal_id: meal.id,
        name: '牛肉面',
        net_weight_g: 420,
        ratio: 0.7,
        kcal: 640,
        protein_g: 34,
        carb_g: 78,
        fat_g: 18,
        source: 'edit',
      }),
      east,
    ),
    target: makeRecord(
      'target',
      aTarget({
        protein_per_kg: 1.9,
        kcal_delta: 280,
        weight_gain_per_month: 0.35,
        weekly_workout_target: 4,
        effective_from: AT,
      }),
      east,
    ),
    app_meta: makeRecord(
      'app_meta',
      anAppMeta({ consent_at: '2026-10-01T00:00:00.000Z', last_export_at: null }),
      east,
    ),
  }

  for (const name of BUSINESS_STORE_NAMES) {
    await testDb.repos[name].put(records[name] as never)
  }

  return records
}

async function readAll(): Promise<Record<BusinessStoreName, unknown[]>> {
  const out = {} as Record<BusinessStoreName, unknown[]>
  for (const name of BUSINESS_STORE_NAMES) {
    out[name] = await testDb.repos[name].list({ includeDeleted: true })
  }
  return out
}

/** 导出、清空、再导入回来，返回使用的导出文件内容 */
async function roundTrip(): Promise<string> {
  await transfer.exportAll({ sink })
  const text = saved.at(-1)!.text
  await transfer.clearAll({ confirmed: true })
  await transfer.importAll({ text, confirmed: true, sink })
  return text
}

describe('全表往返', () => {
  it('导出、清空、导入之后逐表逐字段相等', async () => {
    await seedAllTables()
    const before = await readAll()

    await roundTrip()

    expect(await readAll()).toEqual(before)
  })

  it('每条记录的主键与审计字段原样保留', async () => {
    const seeded = await seedAllTables()
    await roundTrip()

    for (const name of BUSINESS_STORE_NAMES) {
      const original = seeded[name]
      const restored = await testDb.repos[name].get(original.id)

      expect(restored, name).toBeDefined()
      expect(restored?.user_id, name).toBe('local')
      expect(restored?.version, name).toBe(1)
    }
  })

  it('时间字段不因往返漂移——保留原字符串与原偏移', async () => {
    await seedAllTables()
    await roundTrip()

    const [weight] = await testDb.repos.body_metric.list()
    // 西半球偏移的记录必须仍然是西半球偏移，且时间字符串逐字符相同
    expect(weight?.tz_offset_minutes).toBe(-300)
    expect(weight?.measured_at).toBe(AT_WEST)
    expect(weight?.created_at).toBe(AT_WEST)

    const [log] = await testDb.repos.workout_log.list()
    expect(log?.tz_offset_minutes).toBe(-300)
    expect(log?.logged_at).toBe(AT)
  })

  it('项目卡片的数量、顺序与各字段值不因往返改变', async () => {
    const seeded = await seedAllTables()
    const exported = JSON.parse(await roundTrip())

    const [log] = await testDb.repos.workout_log.list()
    expect(log?.id).toBe(seeded.workout_log.id)
    expect(log?.items).toEqual([
      { name: '杠铃卧推', sets: 4, reps: 8, weight_kg: 82.5, note: '右肩有点紧' },
      { name: '飞鸟', sets: null, reps: null, weight_kg: null, note: null },
      { name: '深蹲', sets: 5, reps: null, weight_kg: 100, note: null },
    ])
    // 导出文件里同样是嵌套数组，没有被摊平
    expect(exported.records.workout_log[0].items).toHaveLength(3)
    expect(exported.records.workout_log[0].items[0].name).toBe('杠铃卧推')
  })

  it('外键关系在往返后依然成立', async () => {
    const seeded = await seedAllTables()
    await roundTrip()

    const [item] = await testDb.repos.meal_item.list()
    expect(item?.meal_id).toBe(seeded.meal.id)
  })

  it('往返可以重复执行，结果稳定', async () => {
    await seedAllTables()
    const before = await readAll()

    await roundTrip()
    await roundTrip()

    expect(await readAll()).toEqual(before)
  })
})

describe('边界', () => {
  it('已软删除的记录不参与往返，也不在导入后复活', async () => {
    const seeded = await seedAllTables()
    await testDb.repos.body_metric.remove(
      seeded.body_metric.id,
      momentAt(AT, 480),
    )

    await transfer.exportAll({ sink })
    expect(JSON.parse(saved.at(-1)!.text).records.body_metric).toEqual([])

    await transfer.clearAll({ confirmed: true })
    await transfer.importAll({ text: saved.at(-1)!.text, confirmed: true, sink })

    // 既不复活，也不留下墓碑——导出排除了它，导入也就没有它
    expect(await testDb.repos.body_metric.list({ includeDeleted: true })).toEqual([])
  })

  it('指向不存在图片的记录完好，引用在往返中原样保留', async () => {
    const now = momentAt(AT, 480)
    const danglingRef = 'local://01a182ae-25f7-7661-b587-84998ff6f6df'
    await testDb.repos.meal.put(
      makeRecord('meal', aMeal({ photo_ref: danglingRef }), now),
    )

    const exported = JSON.parse(await roundTrip())

    const [meal] = await testDb.repos.meal.list()
    expect(meal?.photo_ref).toBe(danglingRef)
    expect(exported.records.meal[0].photo_ref).toBe(danglingRef)

    // 二进制从不进导出文件，因此导入后这条引用必然解析为「已清理」。
    // 这是预期状态而非错误：界面据此显示占位图，记录本身仍然可读可改。
    const reader = createBlobReader(testDb.getDb)
    expect((await reader.resolve(meal!.photo_ref!)).state).toBe('cleared')
  })

  it('空库往返得到空库，不报错', async () => {
    await transfer.exportAll({ sink })
    expect(JSON.parse(saved.at(-1)!.text).records.body_metric).toEqual([])

    await transfer.importAll({ text: saved.at(-1)!.text, confirmed: true, sink })

    for (const name of BUSINESS_STORE_NAMES) {
      expect(await testDb.repos[name].list({ includeDeleted: true }), name).toEqual([])
    }
  })

  it('导出后清空缓存、重新打开再导入仍然可用', async () => {
    await seedAllTables()
    await transfer.exportAll({ sink })
    const text = saved.at(-1)!.text

    // 模拟浏览器清理缓存：库整个被清掉，只剩用户手里的导出文件
    await transfer.clearAll({ confirmed: true })
    const result = await transfer.importAll({ text, confirmed: true, sink })

    expect(result.imported).toBe(true)
    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
  })
})
