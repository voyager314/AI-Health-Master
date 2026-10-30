/**
 * stats —— 时间窗口计算
 *
 * 自然日与自然周的边界只在本目录的 `timeWindow` 模块内实现，其余任何位置
 * 禁止自行推算日界或周界。
 *
 * 本层禁止导入存储、命令与埋点：计算必须是纯函数，入参即全部输入。
 * 这样它既能脱离数据库单测，将来也能被等价的 SQL 聚合替换并做双实现对照。
 */

export {
  clockTimeOf,
  dayKeyOf,
  isSameWeek,
  recentDayInterval,
  retentionCutoff,
  weekInterval,
  weekKeyOf,
} from './timeWindow.ts'
export type { DayKey, Interval } from './timeWindow.ts'
