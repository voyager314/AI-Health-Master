/**
 * 导入、导出与清空的顺序验证。
 *
 * 这层没有独立的业务规则，它的正确性全在顺序上：校验先于改动、备份先于覆盖、
 * 未确认则一切不动。因此断言集中在调用次序与数据库最终状态。
 */
import { createCommandBus } from '@/commands'
import { COMMANDS } from '@/commands/index.ts'
import { ImportValidationError } from '@/domain'
import { createDataTransfer, type DataTransfer } from '@/features/data'
import type { FileSink } from '@/shared'
import { LATEST_SCHEMA_VERSION, snapshotDatabase } from '@/storage'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { fixedDate } from '@/test/fixtures.ts'
import { sampleWeight, sampleWorkoutLog } from '@/test/records.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const AT = '2026-10-29T02:15:30.000Z'

let testDb: TestDb
let saved: { filename: string; text: string }[]
let sink: FileSink
let transfer: DataTransfer

beforeEach(async () => {
  testDb = await createTestDb('transfer')
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

/** 构造一个结构合法的导出文件 */
function fileWith(records: Record<string, readonly unknown[]>): string {
  return JSON.stringify({
    schema_version: LATEST_SCHEMA_VERSION,
    exported_at: AT,
    records,
  })
}

async function seedTwoRecords() {
  await testDb.repos.workout_log.put(sampleWorkoutLog)
  await testDb.repos.body_metric.put(sampleWeight)
}

describe('导出', () => {
  it('保存一个 JSON 文件，内容是当前全库', async () => {
    await seedTwoRecords()
    await transfer.exportAll({ sink })

    expect(saved).toHaveLength(1)
    const parsed = JSON.parse(saved[0]!.text)
    expect(parsed.records.workout_log).toHaveLength(1)
    expect(parsed.records.body_metric).toHaveLength(1)
  })

  it('导出成功后记录导出时刻', async () => {
    await seedTwoRecords()
    await transfer.exportAll({ sink })

    const [meta] = await testDb.repos.app_meta.list()
    expect(meta?.last_export_at).toBe(AT)
  })

  it('保存失败时不记录导出时刻——它只表示真正落过盘', async () => {
    await seedTwoRecords()
    const failing: FileSink = {
      async save() {
        throw new Error('用户取消了保存')
      },
    }

    await expect(transfer.exportAll({ sink: failing })).rejects.toThrow('用户取消了保存')

    expect(await testDb.repos.app_meta.list()).toEqual([])
  })

  it('CSV 按表拆成多个文件', async () => {
    await seedTwoRecords()
    await transfer.exportAll({ sink, format: 'csv' })

    const names = saved.map((f) => f.filename)
    expect(names.some((n) => n.includes('workout_log'))).toBe(true)
    expect(names.some((n) => n.includes('body_metric'))).toBe(true)
  })
})

describe('导入预览', () => {
  it('解析成功就能给出条数，不必动数据库', async () => {
    const parsed = transfer.previewImport(fileWith({ workout_log: [sampleWorkoutLog] }))

    expect(parsed.records.workout_log).toHaveLength(1)
    expect(await testDb.repos.workout_log.list()).toEqual([])
  })

  it('文件有问题时抛错并定位到具体位置', () => {
    const broken = fileWith({ body_metric: [{ ...sampleWeight, weight_kg: 'x' }] })

    expect(() => transfer.previewImport(broken)).toThrow(ImportValidationError)
  })
})

describe('导入', () => {
  it('未确认时不写库、不产生备份文件', async () => {
    await seedTwoRecords()

    const result = await transfer.importAll({
      text: fileWith({ workout_log: [] }),
      confirmed: false,
      sink,
    })

    expect(result.imported).toBe(false)
    expect(result.backup).toBeUndefined()
    expect(saved).toEqual([])
    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
  })

  it('未确认时仍返回解析结果，供界面展示将要发生什么', async () => {
    const result = await transfer.importAll({
      text: fileWith({ workout_log: [sampleWorkoutLog] }),
      confirmed: false,
      sink,
    })

    expect(result.parsed.records.workout_log).toHaveLength(1)
  })

  it('确认后替换全库', async () => {
    await seedTwoRecords()
    const incoming = {
      ...sampleWorkoutLog,
      input_source: 'voice' as const,
    }

    const result = await transfer.importAll({
      text: fileWith({ workout_log: [incoming] }),
      confirmed: true,
      sink,
    })

    expect(result.imported).toBe(true)
    expect((await testDb.repos.workout_log.list()).map((log) => log.input_source)).toEqual(['voice'])
    expect(await testDb.repos.body_metric.list()).toEqual([])
  })

  it('覆盖之前先备份当前数据，备份内容就是导入前的全库', async () => {
    await seedTwoRecords()

    const result = await transfer.importAll({
      text: fileWith({ workout_log: [] }),
      confirmed: true,
      sink,
    })

    expect(saved).toHaveLength(1)
    expect(saved[0]!.filename).toContain('import-backup')

    const backup = JSON.parse(saved[0]!.text)
    expect(backup.records.workout_log).toHaveLength(1)
    expect(backup.records.body_metric).toHaveLength(1)
    expect(result.backup?.filename).toBe(saved[0]!.filename)
  })

  it('备份保存失败时中止，原有数据完好', async () => {
    await seedTwoRecords()
    const failing: FileSink = {
      async save() {
        throw new Error('磁盘已满')
      },
    }

    await expect(
      transfer.importAll({
        text: fileWith({ workout_log: [] }),
        confirmed: true,
        sink: failing,
      }),
    ).rejects.toThrow('磁盘已满')

    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
  })

  it('校验失败时既不改库也不产生备份', async () => {
    await seedTwoRecords()
    const broken = fileWith({ body_metric: [{ ...sampleWeight, weight_kg: 'x' }] })

    await expect(
      transfer.importAll({ text: broken, confirmed: true, sink }),
    ).rejects.toThrow(ImportValidationError)

    expect(saved).toEqual([])
    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
  })

  it('文件版本高于应用时拒绝，且不产生备份', async () => {
    await seedTwoRecords()
    const ahead = JSON.stringify({
      schema_version: LATEST_SCHEMA_VERSION + 1,
      exported_at: AT,
      records: {},
    })

    await expect(
      transfer.importAll({ text: ahead, confirmed: true, sink }),
    ).rejects.toThrow(/升级应用/)

    expect(saved).toEqual([])
    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
  })
})

describe('清空', () => {
  it('未确认时数据原样', async () => {
    await seedTwoRecords()

    const result = await transfer.clearAll({ confirmed: false })

    expect(result.cleared).toBe(false)
    expect(await testDb.repos.workout_log.list()).toHaveLength(1)
    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
  })

  it('确认后清空全部数据，同意记录一并消失', async () => {
    await seedTwoRecords()

    const result = await transfer.clearAll({ confirmed: true })

    expect(result.cleared).toBe(true)
    expect(await testDb.repos.workout_log.list()).toEqual([])
    expect(await testDb.repos.body_metric.list()).toEqual([])
    expect(await testDb.repos.app_meta.list()).toEqual([])
  })

  it('清空后可重新开始记录，不残留任何表的旧数据', async () => {
    await seedTwoRecords()
    await transfer.clearAll({ confirmed: true })

    const fresh = { ...sampleWeight, id: '01a182ae-2600-7661-b587-84998ff6f6df' }
    await testDb.repos.body_metric.put(fresh)

    expect(await testDb.repos.body_metric.list()).toHaveLength(1)
    expect(await testDb.repos.workout_log.list()).toEqual([])
  })
})

describe('导出的文件能再导入回来', () => {
  it('导出内容作为导入输入被接受', async () => {
    await seedTwoRecords()
    await transfer.exportAll({ sink })
    const exported = saved[0]!.text

    await transfer.clearAll({ confirmed: true })
    const result = await transfer.importAll({ text: exported, confirmed: true, sink })

    expect(result.imported).toBe(true)
    expect((await testDb.repos.workout_log.list())[0]?.id).toBe(sampleWorkoutLog.id)
    expect((await testDb.repos.body_metric.list())[0]?.id).toBe(sampleWeight.id)
  })
})
