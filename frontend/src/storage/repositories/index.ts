/**
 * 9 张业务表的 Repository 装配。
 *
 * 这是**唯一的存储实现装配点**：整个应用里只有这个文件知道当前用的是 IndexedDB。
 * 换 MySQL 时新增 `storage/mysql/repository.ts`，把下面的工厂换掉即可，
 * 契约（./types.ts）与全部调用方都不动（约束 1）。
 *
 * 每张表恰有一个 Repository，接口形状由 `RepositorySet` 在编译期钉住——
 * 漏掉一张表或多出一张表都过不了类型检查。
 */
import { BUSINESS_STORE_NAMES } from '@/entities'
import {
  createIndexedDbRepository,
  type DbProvider,
} from '@/storage/indexeddb/repository.ts'
import type { ReadableRepositorySet, RepositorySet } from './types.ts'

/**
 * 按当前存储实现装配出全部 9 个 Repository。
 *
 * `getDb` 可注入：测试据此把每个用例指向独立的数据库名，不必重置 indexedDB 全局。
 */
export function createRepositories(getDb?: DbProvider): RepositorySet {
  const entries = BUSINESS_STORE_NAMES.map((name) => [
    name,
    createIndexedDbRepository(name, getDb),
  ])
  // 键集合与 BUSINESS_STORE_NAMES 完全一致，恰好构成 RepositorySet；
  // 动态构造无法让 TypeScript 自行推出这一点，故在此断言。
  return Object.fromEntries(entries) as RepositorySet
}

/** 应用运行时使用的 Repository 集合，指向默认数据库 */
export const repositories: RepositorySet = createRepositories()

/** 同一批实例的只读视图。类型收窄，运行时不额外包装 */
export const readableRepositories: ReadableRepositorySet = repositories

export type { DbProvider }
export * from './types.ts'
