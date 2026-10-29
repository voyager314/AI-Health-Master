/**
 * 导出文件的序列化。
 *
 * 纯函数：快照进、文本出，不碰数据库也不碰文件系统。导出结果的正确性因此可以
 * 直接断言，不必先把文件下载下来再读回来。
 *
 * JSON 是迁移载体，字段与库中完全一致、不做转换——它是把数据搬到另一台设备或
 * 另一个数据库实现时唯一的依据。CSV 只供查看，嵌套关系以外键列平铺表达，
 * 信息有损，因此不作为导入格式。
 */
import { RECORD_SPECS, type StoreName } from '@/entities'

/** 快照的形状，与存储层取出的快照一致；此处只依赖纯数据，不依赖存储实现 */
export interface ExportableSnapshot {
  /** 取快照时数据库的结构版本 */
  readonly schema_version: number
  /** 取快照的 UTC 时刻 */
  readonly exported_at: string
  /** store 名到该表全部记录的映射 */
  readonly records: Readonly<Record<string, readonly Record<string, unknown>[]>>
}

/**
 * 导出文件的内容。
 *
 * `filename` 已含扩展名，`text` 为完整文件内容，`mime` 供下载时声明类型。
 */
export interface ExportFile {
  readonly filename: string
  readonly mime: string
  readonly text: string
}

/** 文件名里出现冒号在部分系统上会被拒绝，故用连字符代替时刻分隔符 */
function stampFor(iso: string): string {
  return iso.replace(/[:.]/g, '-')
}

function fileStem(exportedAt: string): string {
  return `ai-health-master-${stampFor(exportedAt)}`
}

/**
 * 序列化为 JSON。
 *
 * 顶层携带 `schema_version` 与导出时刻：导入方据此判断要不要先补跑迁移，
 * 而该信息不能只存在于记录里——记录会被原样写回，届时版本号就成了旧值。
 */
export function toJsonFile(snapshot: ExportableSnapshot): ExportFile {
  return {
    filename: `${fileStem(snapshot.exported_at)}.json`,
    mime: 'application/json',
    text: JSON.stringify(
      {
        schema_version: snapshot.schema_version,
        exported_at: snapshot.exported_at,
        records: snapshot.records,
      },
      null,
      2,
    ),
  }
}

/**
 * 按 RFC 4180 转义一个字段。
 *
 * 含逗号、双引号或换行的字段整体加引号，内部的双引号重复一次。不转义的后果不是
 * 排版难看，而是用户用表格软件打开时列会错位，且多半会当成数据本身有问题。
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return ''
  const raw =
    typeof value === 'object' ? JSON.stringify(value) : String(value)

  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

/**
 * 列顺序取自字段规格，而不是第一条记录的键顺序。
 *
 * 规格里的顺序是稳定的；按记录取的话，同一次导出的不同表可能排出不同的列序，
 * 两次导出之间也会因为某条记录多了一个字段而变化。
 */
function columnsOf(store: string, rows: readonly Record<string, unknown>[]): string[] {
  const spec = RECORD_SPECS[store as StoreName]
  const declared = spec ? Object.keys(spec) : []
  const extras = new Set<string>()

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!declared.includes(key)) extras.add(key)
    }
  }

  return [...declared, ...extras].sort((a, b) =>
    declared.includes(a) && declared.includes(b) ? 0 : a.localeCompare(b),
  )
}

function toCsvText(columns: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCsvField(row[column])).join(','))
  }
  // 末尾保留换行：部分表格软件会把没有终止换行的最后一行连同前一列吞掉
  return `${lines.join('\r\n')}\r\n`
}

/**
 * 每张表一个 CSV。
 *
 * 只有记录非空的表才产出文件——空表对应一个只有表头的文件，对查看数据没有用处。
 * 嵌套关系（训练单里的动作、餐食里的条目、埋点属性）以外键列与 JSON 文本表达，
 * 因此 CSV 不能反向还原成记录。
 */
export function toCsvFiles(snapshot: ExportableSnapshot): ExportFile[] {
  const stem = fileStem(snapshot.exported_at)

  return Object.entries(snapshot.records)
    .filter(([, rows]) => rows.length > 0)
    .map(([store, rows]) => ({
      filename: `${stem}-${store}.csv`,
      mime: 'text/csv',
      text: toCsvText(columnsOf(store, rows), rows),
    }))
}
