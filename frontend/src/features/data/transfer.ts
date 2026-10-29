/**
 * 导入、导出与清空的流程编排。
 *
 * 本层只负责顺序，不负责存取：快照由依赖提供，序列化是纯函数，落盘经文件接口，
 * 写入经命令层。每一步因此都能单独替换与断言。
 *
 * 三条顺序性规则在这里固定下来，它们是这些操作的实质：
 *
 * - 导入必须在动数据库**之前**完成全量校验。整库替换语义下，清空后才发现文件有
 *   问题，用户原有的数据就没了。
 * - 导入必须在覆盖之前先导出当前数据作为备份。校验能挡住格式问题，挡不住「导错了
 *   文件」——那是备份唯一的用处。
 * - 未确认的导入与清空不产生任何写入，也不产生备份文件。
 */
import { applyCommand as defaultApplyCommand } from '@/commands'
import {
  parseImportFile,
  toCsvFiles,
  toJsonFile,
  type ExportFile,
  type ParsedImport,
} from '@/domain'
import { LATEST_SCHEMA_VERSION, snapshotDatabase, type DatabaseSnapshot } from '@/storage'
import type { FileSink } from '@/shared'
import { trackClearData, trackExport } from '@/telemetry'

/** 导出格式。JSON 可反向导入，CSV 只供查看 */
export type ExportFormat = 'json' | 'csv'

/** 编排层依赖的外部能力，注入以便替换实现与断言顺序 */
export interface DataTransferDeps {
  /** 执行一条命令。写操作只经它落地 */
  readonly applyCommand: (type: string, payload?: unknown) => Promise<unknown>
  /** 取全库快照 */
  readonly snapshot: (takenAt: string) => Promise<DatabaseSnapshot>
  /** 当前时刻，供时间戳与文件名使用 */
  readonly now: () => Date
  /** 当前应用支持的库结构版本，导入时据此判断要不要补跑迁移 */
  readonly schemaVersion: number
  /** 埋点。默认为真实的本地记录；测试注入以便断言事件属性 */
  readonly telemetry?: {
    readonly exportDone?: typeof trackExport
    readonly clearDone?: typeof trackClearData
  }
}

export interface ExportOptions {
  readonly sink: FileSink
  /** 默认为 JSON：它是迁移载体，也是最常用的选择 */
  readonly format?: ExportFormat
}

export interface ExportResult {
  /** 实际保存的文件。CSV 会按业务表拆成多个，空表不产出文件 */
  readonly files: readonly ExportFile[]
}

export interface ImportOptions {
  /** 导入文件的完整内容 */
  readonly text: string
  /** 用户是否已确认「这将替换当前全部数据」 */
  readonly confirmed: boolean
  /** 备份落盘。确认之后、覆盖之前调用 */
  readonly sink: FileSink
}

export interface ImportResult {
  /** 未确认时为空，表示没有写入任何东西，也没有生成备份 */
  readonly imported: boolean
  /** 校验后的记录集合，未确认时同样可用，便于界面展示将要发生什么 */
  readonly parsed: ParsedImport
  /** 备份文件，未确认时不存在 */
  readonly backup?: ExportFile
}

export interface ClearOptions {
  /** 用户是否已确认「这将删除全部数据」 */
  readonly confirmed: boolean
}

export interface DataTransfer {
  /**
   * 导出全库并记录导出时刻。
   *
   * 导出时刻只在文件全部保存成功之后写入：它的唯一用途是提醒用户「多久没导出了」，
   * 记在一个没真正落盘的时刻上，这条提醒就失去意义。
   */
  exportAll(options: ExportOptions): Promise<ExportResult>

  /**
   * 解析并校验导入文件，不碰数据库。
   *
   * 供界面在用户选好文件后立即预览：能导入什么、有多少条，还是哪里有问题。
   * 失败时抛 `ImportValidationError`，问题定位到具体表与记录序号。
   */
  previewImport(text: string): ParsedImport

  /**
   * 用导入文件替换全库。
   *
   * 顺序固定为：校验 → 检查确认 → 备份 → 覆盖。校验失败时抛错且不产生任何副作用；
   * 未确认时原样返回解析结果，供界面展示摘要后再请求确认。
   */
  importAll(options: ImportOptions): Promise<ImportResult>

  /**
   * 清空全部数据。
   *
   * 未确认时什么都不做。清空之后应用回到首次使用状态：同意记录一并消失，
   * 界面须重新要求用户同意。
   */
  clearAll(options: ClearOptions): Promise<{ cleared: boolean }>
}

function stampFor(iso: string): string {
  return iso.replace(/[:.]/g, '-')
}

export function createDataTransfer(deps: DataTransferDeps): DataTransfer {
  const takenAt = () => deps.now().toISOString()

  return {
    async exportAll(options) {
      const snapshot = await deps.snapshot(takenAt())
      const files =
        options.format === 'csv' ? toCsvFiles(snapshot) : [toJsonFile(snapshot)]

      for (const file of files) {
        await options.sink.save(file)
      }

      await deps.applyCommand('app_meta/mark_exported')
      // 记录格式与文件数，不记任何内容：统计用途止于「导出了没有、导出了几个」
      await (deps.telemetry?.exportDone ?? trackExport)({
        format: options.format === 'csv' ? 'csv' : 'json',
        files: files.length,
      })
      return { files }
    },

    previewImport(text) {
      return parseImportFile(text, { targetVersion: deps.schemaVersion })
    },

    async importAll(options) {
      const parsed = parseImportFile(options.text, { targetVersion: deps.schemaVersion })

      if (!options.confirmed) return { imported: false, parsed }

      const at = takenAt()
      const snapshot = await deps.snapshot(at)
      const base = toJsonFile(snapshot)
      const backup: ExportFile = {
        ...base,
        filename: `import-backup-${stampFor(at)}.json`,
      }
      await options.sink.save(backup)

      await deps.applyCommand('data/import', { records: parsed.records })
      return { imported: true, parsed, backup }
    },

    async clearAll(options) {
      if (!options.confirmed) return { cleared: false }

      // 先数一遍：清空之后这些数字就没了，而「清了个空库」与「删掉多年积累」
      // 是两件不同的事
      const before = await deps.snapshot(takenAt())
      const records = Object.values(before.records).reduce((sum, rows) => sum + rows.length, 0)

      await deps.applyCommand('data/clear_all')

      // 必须在清空写完之后记录：写晚了会被这次清空一并删掉，写早了则清空失败时
      // 留下一条没发生过的记录
      await (deps.telemetry?.clearDone ?? trackClearData)({ records })
      return { cleared: true }
    },
  }
}

/** 应用运行时使用的编排实例，绑定真实的命令层与存储层 */
export const dataTransfer: DataTransfer = createDataTransfer({
  applyCommand: defaultApplyCommand,
  snapshot: (takenAt) => snapshotDatabase(takenAt),
  now: () => new Date(),
  schemaVersion: LATEST_SCHEMA_VERSION,
})
