/**
 * 记录类命令共用的两项前置：校验幂等键格式，按幂等键定位记录。
 *
 * 运动记录与体重记录的新建、修改、删除都以 `client_id` 为入口——新建靠它去重，
 * 修改与删除靠它定位。这套定位逻辑只在这里写一遍，两个模块不会在「墓碑算不算
 * 存在」「冲突时取哪一条」这类细节上分叉。
 */
import type { BusinessRecordMap, BusinessStoreName, Uuid, ValidationIssue } from '@/entities'
import { UUID_V7 } from '@/entities'
import type { CommandContext } from './types.ts'

/** 幂等键不合法时的载荷问题；合法时返回空数组 */
export function checkClientId(value: unknown): ValidationIssue[] {
  return typeof value === 'string' && UUID_V7.test(value)
    ? []
    : [{ field: 'client_id', message: '应为 UUID v7' }]
}

/**
 * 按幂等键取记录，包含墓碑。
 *
 * 走整表列举后在内存中比对，而不是建专门索引：查询形态仍是「单字段索引取数 +
 * 内存过滤」，上云后对应一条按用户与幂等键取数的查询。
 * 包含墓碑是必须的——同一 `client_id` 若曾被删除，重新提交也不应该复活或复制它。
 *
 * 记录不存在时返回 `undefined`，由调用方决定是新建还是什么都不做。
 */
export async function findRowByClientId<N extends BusinessStoreName>(
  ctx: CommandContext,
  store: N,
  clientId: string,
): Promise<BusinessRecordMap[N] | undefined> {
  const rows = await ctx.repos[store].list({ includeDeleted: true }, ctx.tx)
  return (rows as BusinessRecordMap[N][]).find((row) => row.client_id === clientId)
}

/** 定位一条记录时需要的载荷形状：只有一个幂等键 */
export interface ClientKeyed {
  /** 客户端生成的幂等键。同一 `client_id` 重复提交不产生第二条记录 */
  readonly client_id: Uuid
}
