/**
 * 写入失败原因的提示语。
 *
 * 文案按原因分派，单独成文件而不是与组件同处一处：组件文件只导出组件，热更新
 * 才不会在改动文案时把整个组件树重建一遍。
 */
import type { WriteFailureReason } from '@/entities'

/** 按失败原因给出可操作的下一步 */
export function saveFailureMessage(reason: WriteFailureReason): string {
  switch (reason) {
    case 'quota_exceeded':
      return '本地存储空间不足，这次没有保存成功。建议先导出数据，再清理历史图片后重试。'
    case 'constraint':
      return '数据不符合约束，这次没有保存成功。请检查填写的内容后重试。'
    case 'unknown':
      return '写入本地数据库失败，这次没有保存成功。可以重试，或先导出数据以免丢失。'
  }
}
