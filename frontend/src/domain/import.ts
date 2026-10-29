/**
 * 导入文件的解析与校验。
 *
 * 全程不碰数据库：导入的语义是整库替换，一旦先清空再发现文件有问题，用户原有的
 * 数据就没了。备份是第二道防线，不是第一道。
 *
 * 校验一次报出全部问题而不是遇到第一个就停：用户要的是修好文件再导一次，
 * 逐个试错会让他反复来回。
 */
import {
  EXPORTED_STORE_NAMES,
  ISO_UTC,
  RECORD_SPECS,
  validateRecord,
  type ExportedStoreName,
  type ValidationIssue,
} from '@/entities'

/** 一条需要补跑的记录级迁移，把某个旧版本的文件内容升级到下一个版本 */
export interface RecordUpgrade {
  /** 从哪个版本升级 */
  readonly from: number
  /** 把该版本的记录集合升级到下一版本，纯函数，不修改入参 */
  readonly up: (
    records: Readonly<Record<string, readonly Record<string, unknown>[]>>,
  ) => Record<string, readonly Record<string, unknown>[]>
}

export interface ImportOptions {
  /** 当前应用支持的结构版本。文件版本高于它意味着文件来自更新的应用 */
  readonly targetVersion: number
  /** 记录级迁移链，按 `from` 升序。为空表示尚无更早的版本需要升级 */
  readonly upgrades?: readonly RecordUpgrade[]
}

export interface ParsedImport {
  /** 升级到当前版本之后的记录集合 */
  readonly records: Readonly<Record<ExportedStoreName, readonly Record<string, unknown>[]>>
  /** 文件原本的结构版本 */
  readonly sourceVersion: number
  /** 文件记录的导出时刻 */
  readonly exportedAt: string
}

/** 校验失败。`issues` 一次带出全部问题，定位到具体记录与字段 */
export class ImportValidationError extends Error {
  readonly issues: readonly ValidationIssue[]

  constructor(issues: readonly ValidationIssue[]) {
    super(
      `导入文件校验未通过，共 ${issues.length} 处问题：\n${issues
        .slice(0, 10)
        .map((i) => `  ${i.field}: ${i.message}`)
        .join('\n')}${issues.length > 10 ? `\n  …另有 ${issues.length - 10} 处` : ''}`,
    )
    this.name = 'ImportValidationError'
    this.issues = issues
  }
}

function fail(issues: ValidationIssue[]): never {
  throw new ImportValidationError(issues)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 解析并校验导入文件。
 *
 * `text` 为文件完整内容。成功时返回升级到当前版本的记录集合；失败时抛
 * `ImportValidationError`，调用方据此在动数据库之前中止。
 *
 * 未在表清单中出现的 store 一律拒绝：文件被改过或来自不兼容的版本，猜测其意图
 * 比拒绝更危险。
 */
export function parseImportFile(text: string, options: ImportOptions): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    fail([{ field: '(file)', message: '文件不是合法的 JSON，可能已损坏或选错了文件' }])
  }

  if (!isPlainObject(raw)) {
    fail([{ field: '(file)', message: '文件顶层应为对象' }])
  }

  const { schema_version: sourceVersion, exported_at: exportedAt, records } = raw
  const issues: ValidationIssue[] = []

  if (typeof sourceVersion !== 'number' || !Number.isInteger(sourceVersion) || sourceVersion < 1) {
    issues.push({ field: 'schema_version', message: '缺少结构版本，或不是正整数' })
  } else if (sourceVersion > options.targetVersion) {
    issues.push({
      field: 'schema_version',
      message: `文件来自更新版本的应用（${sourceVersion}），当前应用支持到 ${options.targetVersion}，请升级应用后再导入`,
    })
  }

  if (typeof exportedAt !== 'string' || !ISO_UTC.test(exportedAt)) {
    issues.push({ field: 'exported_at', message: '缺少导出时刻，或不是 UTC ISO 8601 格式' })
  }

  if (!isPlainObject(records)) {
    issues.push({ field: 'records', message: '缺少记录集合' })
    fail(issues)
  }

  const knownStores = new Set<string>(EXPORTED_STORE_NAMES)
  for (const name of Object.keys(records)) {
    if (!knownStores.has(name)) {
      issues.push({ field: `records.${name}`, message: '不是可导入的表' })
    }
  }

  // 校验逐条进行，问题定位到「哪张表第几条的哪个字段」
  for (const store of EXPORTED_STORE_NAMES) {
    const rows = records[store]
    if (rows === undefined) continue
    if (!Array.isArray(rows)) {
      issues.push({ field: `records.${store}`, message: '应为记录数组' })
      continue
    }

    rows.forEach((row: unknown, index: number) => {
      for (const issue of validateRecord(RECORD_SPECS[store], row)) {
        issues.push({ field: `records.${store}[${index}].${issue.field}`, message: issue.message })
      }
    })
  }

  if (issues.length > 0) fail(issues)

  const migrated = applyRecordUpgrades(
    records as Record<string, readonly Record<string, unknown>[]>,
    sourceVersion as number,
    options,
  )

  const filled = {} as Record<ExportedStoreName, readonly Record<string, unknown>[]>
  for (const store of EXPORTED_STORE_NAMES) filled[store] = migrated[store] ?? []

  return { records: filled, sourceVersion: sourceVersion as number, exportedAt: exportedAt as string }
}

/**
 * 把记录集合沿迁移链升级到当前版本。
 *
 * 文件版本与当前版本相同时原样返回，不做任何转换。缺少对应迁移时拒绝，
 * 而不是按当前结构猜测旧数据的含义。
 */
function applyRecordUpgrades(
  records: Record<string, readonly Record<string, unknown>[]>,
  sourceVersion: number,
  options: ImportOptions,
): Record<string, readonly Record<string, unknown>[]> {
  let current = records

  for (let version = sourceVersion; version < options.targetVersion; version += 1) {
    const upgrade = options.upgrades?.find((u) => u.from === version)
    if (!upgrade) {
      fail([
        {
          field: 'schema_version',
          message: `缺少从版本 ${version} 到 ${version + 1} 的升级规则，无法导入`,
        },
      ])
    }
    current = { ...upgrade.up(current) }
  }

  return current
}
