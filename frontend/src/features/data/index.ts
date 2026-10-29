/**
 * features/data —— 导出 / 导入 / 清空的界面与流程
 *
 * 导出入口必须在设置页一级可见：用户因此不必翻找，导出是可被想到的动作，
 * 「怕丢数据」的心理门槛随之降低。
 *
 * ⚠️ 禁止导入 storage/indexeddb/** 与 storage/internal：前者让存储访问收敛到
 * Repository 层，后者保证写操作只能经由统一的命令入口。
 *
 * 允许导入：entities/、commands/、storage/、domain/、stats/、telemetry/、shared/
 */

export { createDataTransfer, dataTransfer } from './transfer.ts'
export type {
  ClearOptions,
  DataTransfer,
  DataTransferDeps,
  ExportFormat,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
} from './transfer.ts'
