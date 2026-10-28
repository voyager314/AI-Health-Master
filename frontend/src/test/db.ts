/**
 * 测试用的数据库装配。
 *
 * 测试需要真实的连接与 Repository，但测试文件位于各业务层目录下，受分层边界约束
 * （`src/commands/**` 不得导入 `storage/indexeddb/**`）。把建库这件事收在
 * `src/test/` 里——测试基础设施不受分层限制，业务层的测试经这里取依赖即可。
 *
 * 每次调用用独立的库名，用例之间天然隔离，不必重置 indexedDB 全局。
 */
import { closeDatabase, openDatabase, type DbProvider } from '@/storage/indexeddb/db.ts'
import type { AppDb } from '@/storage/indexeddb/schema.ts'
import { createRepositories } from '@/storage/repositories/index.ts'
import type { RepositorySet } from '@/storage/repositories/types.ts'
import type { IDBPDatabase } from 'idb'
import { uniqueDbName } from './fixtures.ts'

export interface TestDb {
  readonly db: IDBPDatabase<AppDb>
  readonly repos: RepositorySet
  /** 传给 createCommandBus / createRepositories，让它们指向本用例的库 */
  readonly getDb: DbProvider
  close(): void
}

export async function createTestDb(label: string): Promise<TestDb> {
  const db = await openDatabase({ dbName: uniqueDbName(label) })
  const getDb: DbProvider = async () => db

  return {
    db,
    repos: createRepositories(getDb),
    getDb,
    close() {
      db.close()
      // 共享连接缓存也要清，否则下一个用例会拿到已关闭的连接
      closeDatabase()
    },
  }
}

/** 直接读 pending_ops，供断言「这次写入有没有记日志」使用 */
export async function readPendingOps(testDb: TestDb) {
  return testDb.db.getAll('pending_ops')
}
