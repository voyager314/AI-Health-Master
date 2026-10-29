/**
 * 整库级写入命令：导入与清空。
 *
 * 两者都声明全部表并使用 `skipOpLog`：载荷就是整个数据集，把它再复制一份进
 * 写操作日志既无意义也浪费配额，而这类命令本身也无法跨设备重放——「把这份快照
 * 替换进去」在另一台设备上没有相同的前置状态。
 */
import { ALL_STORE_NAMES } from '@/entities'
import { defineCommand } from './types.ts'

/** 导入时携带的记录集合，键为表名 */
export interface ImportPayload {
  readonly records: Readonly<Record<string, readonly Record<string, unknown>[]>>
}

/**
 * 用一份已校验的记录集合替换全库。
 *
 * 校验不在这里做：解析与校验需要在动数据库之前完成（否则整库替换语义下，清空后
 * 才发现文件有问题就会丢掉用户原有数据），因此那个步骤在命令之外、事务之前。
 * 写入时仍会逐条校验，作为这层不假设调用方已验过的兜底。
 */
export const importSnapshot = defineCommand<ImportPayload, void>({
  type: 'data/import',
  stores: ALL_STORE_NAMES,
  skipOpLog: true,
  validate: (payload) => {
    const p = payload as Partial<ImportPayload> | null
    return p && typeof p === 'object' && 'records' in p && typeof p.records === 'object'
      ? []
      : [{ field: 'records', message: '缺少记录集合' }]
  },
  handler: async (ctx, payload) => {
    await ctx.bulk.replaceAll(payload.records)
  },
})

/**
 * 清空全部数据。
 *
 * 清空之后应用回到首次使用状态：同意记录一并消失，界面须重新要求用户同意。
 * 二次确认在调用方，因为命令层不该知道用户是怎么确认的。
 */
export const clearAllData = defineCommand<null, void>({
  type: 'data/clear_all',
  stores: ALL_STORE_NAMES,
  skipOpLog: true,
  handler: async (ctx) => {
    await ctx.bulk.clearAll()
  },
})
