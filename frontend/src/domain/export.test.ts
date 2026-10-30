/**
 * 导出序列化的验证。
 *
 * 序列化是纯函数，因此正确性可以直接断言，不必先下载文件再读回来。重点是两件
 * 容易出错的事：JSON 必须能原样还原成记录（它是迁移载体），CSV 必须让表格软件
 * 正确分列（含逗号、引号、换行的字段是常态而不是例外）。
 */
import { toCsvFiles, toJsonFile, type ExportableSnapshot } from '@/domain'
import { describe, expect, it } from 'vitest'

const AT = '2026-10-29T02:15:30.000Z'

function snapshotWith(
  records: Record<string, readonly Record<string, unknown>[]>,
): ExportableSnapshot {
  return { schema_version: 1, exported_at: AT, records }
}

describe('JSON 导出', () => {
  const rows = [
    { id: 'a', weight_kg: 72.4, note: null, deleted_at: null },
    { id: 'b', weight_kg: 72.6, note: '早上称的', deleted_at: null },
  ]

  it('顶层携带结构版本与导出时刻', () => {
    const file = toJsonFile(snapshotWith({ body_metric: rows }))
    const parsed = JSON.parse(file.text)

    expect(parsed.schema_version).toBe(1)
    expect(parsed.exported_at).toBe(AT)
  })

  it('记录字段与库中完全一致，不做转换', () => {
    const file = toJsonFile(snapshotWith({ body_metric: rows }))
    const parsed = JSON.parse(file.text)

    expect(parsed.records.body_metric).toEqual(rows)
  })

  it('空库也能导出，各表为空数组', () => {
    const file = toJsonFile(snapshotWith({ body_metric: [], workout_log: [] }))
    const parsed = JSON.parse(file.text)

    expect(parsed.records.body_metric).toEqual([])
    expect(parsed.records.workout_log).toEqual([])
  })

  it('文件名含导出时刻，且不含会被文件系统拒绝的字符', () => {
    const file = toJsonFile(snapshotWith({}))

    expect(file.filename).toContain('2026-10-29')
    expect(file.filename).not.toContain(':')
    expect(file.filename.endsWith('.json')).toBe(true)
  })

  it('声明 JSON 类型', () => {
    expect(toJsonFile(snapshotWith({})).mime).toBe('application/json')
  })
})

describe('CSV 导出', () => {
  function csvFor(records: Record<string, readonly Record<string, unknown>[]>) {
    const files = toCsvFiles(snapshotWith(records))
    return files[0]!.text
  }

  it('每张非空表一个文件，空表不产出文件', () => {
    const files = toCsvFiles(
      snapshotWith({
        body_metric: [{ id: 'a', weight_kg: 72.4 }],
        workout_log: [],
      }),
    )

    expect(files).toHaveLength(1)
    expect(files[0]?.filename).toContain('body_metric')
    expect(files[0]?.mime).toBe('text/csv')
  })

  it('首行是列名，列序取自字段规格而非记录键序', () => {
    const csv = csvFor({ body_metric: [{ note: null, weight_kg: 72.4, id: 'a' }] })
    const header = csv.split('\r\n')[0]!

    // 规格里 id 在 note 之前，与记录里的键顺序无关
    expect(header.indexOf('id')).toBeLessThan(header.indexOf('note'))
    expect(header).toContain('weight_kg')
  })

  it('含逗号的字段整体加引号', () => {
    const csv = csvFor({ body_metric: [{ id: 'a', note: '早饭,午饭,晚饭' }] })

    expect(csv).toContain('"早饭,午饭,晚饭"')
  })

  it('含双引号的字段加引号并把内部引号重复', () => {
    const csv = csvFor({ body_metric: [{ id: 'a', note: '他说"再吃一碗"' }] })

    expect(csv).toContain('"他说""再吃一碗"""')
  })

  it('含换行的字段整体加引号，不把一条记录拆成两行', () => {
    const csv = csvFor({ body_metric: [{ id: 'a', note: '第一行\n第二行' }] })

    expect(csv).toContain('"第一行\n第二行"')
  })

  it('null 落为空单元格，而不是字符串 null', () => {
    const csv = csvFor({ body_metric: [{ id: 'a', note: null }] })
    const dataRow = csv.split('\r\n')[1]!

    expect(csv).not.toContain('null')
    // id 按字段规格排在第一列，note 为空
    expect(dataRow.startsWith('a,')).toBe(true)
    expect(dataRow.endsWith(',')).toBe(true)
  })

  it('嵌套值以 JSON 文本表达，不丢信息也不撑破列', () => {
    const csv = csvFor({ analytics_event: [{ id: 'a', props: { pwa: true, first: false } }] })

    // 键值对的序列化结果里含双引号，因此整个单元格被引号包住并做了转义
    expect(csv).toContain('""pwa"":true')
  })

  it('行以 CRLF 分隔并保留末尾换行', () => {
    const csv = csvFor({ body_metric: [{ id: 'a' }, { id: 'b' }] })

    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(3)
  })
})
