/**
 * telemetry —— 本地埋点
 *
 * 事件写入本地数据库的 analytics_event 表，只在本地记录，不上报到任何服务端。
 *
 * 两条硬约束：
 *
 * - 属性只允许结构化值与区间值。禁止采集自由文本、图片内容或引用、语音转写文本、
 *   设备标识与位置信息。身体数据（体重、训练容量）以区间记录。
 * - 埋点失败不得影响业务：这里的每个函数都吞掉错误，因为用户来记录训练，不是来
 *   贡献数据的，一次统计写失败不该让记录本身失败。这与「业务写入失败必须可感知」
 *   不矛盾——那条规则针对的是用户的数据。
 *
 * 允许导入：entities/、storage/
 * 可被导入：app/、features/
 */
import type { AnalyticsProps } from '@/entities'
import {
  appendAnalyticsEvent,
  createNow,
  hasAnalyticsEvent,
  type DbProvider,
  type TelemetryEventName,
} from '@/storage/telemetry.ts'

/**
 * 记录一条事件，失败静默。
 *
 * `clock` 与 `getDb` 供测试注入；应用代码不传。
 */
interface TrackDeps {
  /** 注入固定时钟，供断言时间戳使用 */
  readonly clock?: () => Date
  /** 注入指向测试库的连接 */
  readonly getDb?: DbProvider
}

async function track(
  name: TelemetryEventName,
  props: AnalyticsProps,
  deps: TrackDeps = {},
): Promise<void> {
  try {
    await appendAnalyticsEvent(name, props, createNow(deps.clock), deps.getDb)
  } catch {
    // 刻意吞掉：埋点失败不该打断任何业务流程，也不该弹错给用户
  }
}

/**
 * 应用打开。
 *
 * `priorOpen` 由调用方查得：本地是否已有打开记录，决定这次是不是首次使用。
 * 查询与写入分开，是因为写入失败要静默，查询失败同样不能阻断启动。
 */
export async function trackAppOpen(props: {
  readonly pwa: boolean
} & TrackDeps): Promise<void> {
  let first = true
  try {
    first = !(await hasAnalyticsEvent('app_open', props.getDb))
  } catch {
    // 查不到就按首次处理：这个属性只用于区分首次与日常，错一次不影响业务
  }
  await track('app_open', { pwa: props.pwa, first }, props)
}

/** 导出完成。`format` 为 json 或 csv，`files` 为实际保存的文件数 */
export function trackExport(props: {
  readonly format: 'json' | 'csv'
  readonly files: number
} & TrackDeps): Promise<void> {
  return track('export', { format: props.format, files: props.files }, props)
}

/**
 * 清空完成。
 *
 * `records` 是清空前的记录条数，用来判断用户是「清了个空库」还是「删掉了多年积累」。
 * 该事件必须在清空写完之后发出，否则它自己会被这次清空一起删掉。
 */
export function trackClearData(props: {
  readonly records: number
} & TrackDeps): Promise<void> {
  return track('clear_data', { records: props.records }, props)
}
