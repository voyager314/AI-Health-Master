/**
 * 往默认数据库写入示例数据。
 *
 * 界面组件读的是应用的默认数据库，因此要验证「有数据时显示什么」，就得先让那个库
 * 里有数据。写操作本应经命令层，但这里只是为测试准备前置状态，直接写更直白。
 *
 * 放在测试层：业务层与界面层的代码都不允许够到存储实现，测试的准备工作集中在此，
 * 那条边界才不必为测试开口子。
 */
import { closeDatabase } from '@/storage/indexeddb/db.ts'
import { createRepositories } from '@/storage/repositories/index.ts'
import type { RepositorySet } from '@/storage/repositories/types.ts'

import { aBodyMetric, aWorkout } from './fixtures.ts'
import { makeRecord, momentAt } from './records.ts'

const AT = '2026-10-29T02:00:00.000Z'

/** 使用应用默认数据库的 Repository 集合 */
export function defaultRepositories(): RepositorySet {
  return createRepositories()
}

/**
 * 往默认数据库写入一条体重记录与一次训练。
 *
 * 保持最小：界面断言只关心「有没有数据」，灌入更多只会让失败信息更难读。
 */
export async function seedDefaultDatabase(): Promise<void> {
  const repos = defaultRepositories()
  const now = momentAt(AT, 480)

  await repos.body_metric.put(makeRecord('body_metric', aBodyMetric(), now))
  await repos.workout.put(makeRecord('workout', aWorkout({ status: 'saved' }), now))
}

/** 清空默认数据库并释放连接，供用例之间互不干扰 */
export async function resetDefaultDatabase(): Promise<void> {
  const repos = defaultRepositories()
  for (const name of Object.keys(repos) as (keyof RepositorySet)[]) {
    await repos[name].clear()
  }
  closeDatabase()
}
