/**
 * 埋点的写入入口。
 *
 * 只追加，不改写：埋点是发生过的事实，修一条旧事件没有意义。
 *
 * 埋点不经过命令层。命令层的职责是把业务写入与写操作日志绑成一次原子提交，而埋点是
 * 诊断数据、不是业务状态——让它走那条路会把每条事件都复制一份进写操作日志，
 * 将来重放时还会被当作待同步的业务操作。
 *
 * 因此这个入口只导出追加函数，且只允许 telemetry/ 导入：它绕过了「写操作统一入口」
 * 这条边界，就必须把口子开得尽量窄。
 */
import type { AnalyticsEvent, AnalyticsProps } from '@/entities'
import { v7 as uuidv7 } from 'uuid'

import { getDatabase, type DbProvider } from './indexeddb/db.ts'
import { assertValidRecord, createNow, LOCAL_USER_ID, type Now } from './indexeddb/write.ts'

/** 事件名。新增事件时在此处登记，便于审阅它们的属性是否越过隐私边界 */
export type TelemetryEventName =
  | 'app_open'
  | 'export'
  | 'clear_data'
  | 'record_save'
  | 'item_add'
  | 'item_remove'
  | 'history_expand'
  | 'weight_add'

/**
 * 追加一条事件。
 *
 * 失败时抛错，由调用方决定是否吞掉——埋点失败不该影响业务，但也不该被写进这里
 * 假装没发生。
 */
export async function appendAnalyticsEvent(
  name: TelemetryEventName,
  props: AnalyticsProps,
  moment: Now,
  getDb: DbProvider = () => getDatabase(),
): Promise<void> {
  const event: AnalyticsEvent = {
    id: uuidv7(),
    name,
    occurred_at: moment.iso,
    tz_offset_minutes: moment.tzOffsetMinutes,
    props,
    user_id: LOCAL_USER_ID,
  }
  // 属性只允许标量值：自由文本、嵌套结构与图片引用在这一步就被拒掉
  assertValidRecord('analytics_event', event)

  const db = await getDb()
  await db.put('analytics_event', event)
}

/**
 * 取当前时刻与时区偏移。
 *
 * 从这里转出而不是让埋点层直接引用数据库实现：埋点只被允许碰这一个窄入口，
 * 取时刻的方式随之一起收在此处。
 */
export { createNow }

/**
 * 该事件是否已经出现过。
 *
 * 用于区分「首次使用」与「再次打开」：判断依据是历史上有没有记录过打开事件，
 * 而不是本地有没有数据——用户可能同意之后什么都没记就关掉了。
 */
export async function hasAnalyticsEvent(
  name: TelemetryEventName,
  getDb: DbProvider = () => getDatabase(),
): Promise<boolean> {
  const db = await getDb()
  const found = await db.getAllFromIndex('analytics_event', 'name', name)
  return found.length > 0
}

/** 取连接的方式。埋点层用它注入测试库，与 Repository 的注入方式一致 */
export type { DbProvider }
