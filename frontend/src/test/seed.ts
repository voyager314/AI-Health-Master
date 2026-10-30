/**
 * 往默认数据库写入示例数据。
 *
 * 界面组件读的是应用的默认数据库，因此要验证「有数据时显示什么」，就得先让那个库
 * 里有数据。写操作本应经命令层，但这里只是为测试准备前置状态，直接写更直白。
 *
 * 放在测试层：业务层与界面层的代码都不允许够到存储实现，测试的准备工作集中在此，
 * 那条边界才不必为测试开口子。
 */
import type { AnalyticsEvent, PendingOp } from '@/entities'
import { closeDatabase, openDatabase } from '@/storage/indexeddb/db.ts'
import { createRepositories } from '@/storage/repositories/index.ts'
import type { RepositorySet } from '@/storage/repositories/types.ts'

import { aBodyMetric, aWorkoutLog } from './fixtures.ts'
import { makeRecord, momentAt } from './records.ts'

const AT = '2026-10-29T02:00:00.000Z'

/** 使用应用默认数据库的 Repository 集合 */
export function defaultRepositories(): RepositorySet {
  return createRepositories()
}

/**
 * 往默认数据库写入一条体重记录与一条运动记录。
 *
 * 保持最小：界面断言只关心「有没有数据」，灌入更多只会让失败信息更难读。
 */
export async function seedDefaultDatabase(): Promise<void> {
  const repos = defaultRepositories()
  const now = momentAt(AT, 480)

  await repos.body_metric.put(makeRecord('body_metric', aBodyMetric(), now))
  await repos.workout_log.put(makeRecord('workout_log', aWorkoutLog(), now))
}

/**
 * 读默认数据库的写操作日志。
 *
 * 界面层的测试需要断言「这次操作经命令层落地了」，而 pending_ops 不在只读视图里；
 * 读它也属于「准备与观察测试前置状态」，因此和灌数据一样收在测试层。
 */
export async function readDefaultPendingOps(): Promise<readonly PendingOp[]> {
  const db = await openDatabase()
  return db.getAll('pending_ops')
}

/** 读默认数据库的埋点事件，供界面测试断言「操作之后产生了哪个事件、带了什么属性」 */
export async function readDefaultEvents(): Promise<readonly AnalyticsEvent[]> {
  const db = await openDatabase()
  return db.getAll('analytics_event')
}

/**
 * 清空默认数据库并释放连接，供用例之间互不干扰。
 *
 * 连非业务 store 一并清：写操作日志与埋点事件同样会累积，只清业务表会让
 * 「这次操作产生了几条日志/事件」这类断言读到上一个用例的残留。
 */
export async function resetDefaultDatabase(): Promise<void> {
  const repos = defaultRepositories()
  for (const name of Object.keys(repos) as (keyof RepositorySet)[]) {
    await repos[name].clear()
  }

  const db = await openDatabase()
  for (const name of db.objectStoreNames) {
    await db.clear(name)
  }

  closeDatabase()
}
