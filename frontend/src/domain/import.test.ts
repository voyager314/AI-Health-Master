/**
 * 导入文件的解析与校验。
 *
 * 这一层不碰数据库，因此可以直接断言「什么样的文件会被接受、被拒绝、以及拒绝时
 * 能不能定位到具体位置」——而这几件事恰恰决定了用户在导入失败时能否自己修好文件。
 */
import { parseImportFile, ImportValidationError } from '@/domain'
import { sampleExercise, sampleWeight } from '@/test/records.ts'
import { describe, expect, it } from 'vitest'

function validFile(records: Record<string, readonly unknown[]> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    exported_at: '2026-10-29T02:15:30.000Z',
    records,
  })
}

const oneExercise = sampleExercise
const oneWeight = sampleWeight

describe('合法文件', () => {
  it('接受并返回记录集合', () => {
    const parsed = parseImportFile(validFile({ exercise: [oneExercise] }), {
      targetVersion: 1,
    })

    expect(parsed.records.exercise).toEqual([oneExercise])
    expect(parsed.sourceVersion).toBe(1)
    expect(parsed.exportedAt).toBe('2026-10-29T02:15:30.000Z')
  })

  it('表缺席时补为空数组，调用方不必判空', () => {
    const parsed = parseImportFile(validFile({ exercise: [oneExercise] }), {
      targetVersion: 1,
    })

    expect(parsed.records.body_metric).toEqual([])
    expect(parsed.records.analytics_event).toEqual([])
  })

  it('空记录集合被接受', () => {
    expect(() =>
      parseImportFile(validFile({ exercise: [], body_metric: [] }), { targetVersion: 1 }),
    ).not.toThrow()
  })
})

describe('文件级拒绝', () => {
  it('不是 JSON', () => {
    const error = (() => {
      try {
        parseImportFile('这不是 json', { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect(error).toBeInstanceOf(ImportValidationError)
    expect((error as ImportValidationError).issues[0]?.field).toBe('(file)')
  })

  it('顶层不是对象', () => {
    expect(() => parseImportFile('[1,2,3]', { targetVersion: 1 })).toThrow(
      ImportValidationError,
    )
  })

  it('缺少记录集合', () => {
    const error = (() => {
      try {
        parseImportFile(JSON.stringify({ schema_version: 1, exported_at: '2026-10-29T02:15:30.000Z' }), {
          targetVersion: 1,
        })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues.map((i) => i.field)).toContain('records')
  })
})

describe('版本', () => {
  it('文件版本高于应用支持时拒绝，并说明要升级应用', () => {
    const file = JSON.stringify({
      schema_version: 2,
      exported_at: '2026-10-29T02:15:30.000Z',
      records: {},
    })

    const error = (() => {
      try {
        parseImportFile(file, { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues[0]?.field).toBe('schema_version')
    expect((error as ImportValidationError).issues[0]?.message).toContain('升级应用')
  })

  it('缺少版本号或不是正整数时拒绝', () => {
    for (const schema_version of [undefined, 0, -1, 1.5, 'one']) {
      const file = JSON.stringify({
        ...(schema_version === undefined ? {} : { schema_version }),
        exported_at: '2026-10-29T02:15:30.000Z',
        records: {},
      })
      expect(() => parseImportFile(file, { targetVersion: 1 })).toThrow(ImportValidationError)
    }
  })

  it('旧版本文件按迁移链升级后接受', () => {
    const file = JSON.stringify({
      schema_version: 1,
      exported_at: '2026-10-29T02:15:30.000Z',
      records: { exercise: [oneExercise] },
    })

    const parsed = parseImportFile(file, {
      targetVersion: 2,
      upgrades: [
        {
          from: 1,
          // 人造的版本 2：给每条动作补一个字段
          up: (records) => ({
            ...records,
            exercise: (records.exercise ?? []).map((row) => ({ ...row, level: 2 })),
          }),
        },
      ],
    })

    expect(parsed.records.exercise[0]?.level).toBe(2)
  })

  it('缺少对应迁移时拒绝，而不是按新结构猜测旧数据', () => {
    const file = JSON.stringify({
      schema_version: 1,
      exported_at: '2026-10-29T02:15:30.000Z',
      records: {},
    })

    expect(() => parseImportFile(file, { targetVersion: 2 })).toThrow(/缺少从版本 1/)
  })
})

describe('记录级拒绝', () => {
  it('定位到具体表、第几条、哪个字段', () => {
    const broken = { ...oneWeight, weight_kg: '七十二' }
    const error = (() => {
      try {
        parseImportFile(validFile({ body_metric: [oneWeight, broken] }), { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues).toEqual([
      { field: 'records.body_metric[1].weight_kg', message: '应为有限数值' },
    ])
  })

  it('一次报出全部问题，不是遇到第一个就停', () => {
    const bad = [
      { ...oneWeight, weight_kg: 'x' },
      { ...oneWeight, measured_at: '2026-10-29 02:00' },
    ]
    const error = (() => {
      try {
        parseImportFile(validFile({ body_metric: bad }), { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues).toHaveLength(2)
  })

  it('文件里出现不可导入的表时拒绝', () => {
    const file = validFile({ pending_ops: [oneWeight] })
    const error = (() => {
      try {
        parseImportFile(file, { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues[0]?.field).toBe('records.pending_ops')
  })

  it('某张表的取值不是数组时拒绝', () => {
    const file = validFile({ exercise: {} as never })
    expect(() => parseImportFile(file, { targetVersion: 1 })).toThrow(ImportValidationError)
  })

  it('缺少导出时刻时拒绝', () => {
    const file = JSON.stringify({ schema_version: 1, records: {} })
    const error = (() => {
      try {
        parseImportFile(file, { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })()

    expect((error as ImportValidationError).issues[0]?.field).toBe('exported_at')
  })
})

describe('错误信息', () => {
  it('简要列出前若干处问题，其余给出总数', () => {
    const broken = Array.from({ length: 15 }, () => ({ ...oneWeight, weight_kg: 'x' }))
    const error = (() => {
      try {
        parseImportFile(validFile({ body_metric: broken }), { targetVersion: 1 })
      } catch (e) {
        return e
      }
    })() as ImportValidationError

    expect(error.message).toContain('共 15 处')
    expect(error.message).toContain('另有 5 处')
  })
})
