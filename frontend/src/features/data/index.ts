/**
 * features/data —— 导出 / 导入 / 清空的界面与流程
 *
 * 导出入口必须在设置页一级可见（FR-S05.3：降低「怕丢数据」的心理门槛）。
 *
 * ⚠️ 禁止导入 storage/indexeddb/**（约束 1）与 storage/internal（约束 9）。
 *
 * 允许导入：entities/、commands/、storage/、domain/、stats/、telemetry/、shared/
 */

export {}
