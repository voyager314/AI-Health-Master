/**
 * storage/internal —— 含写方法的完整 Repository 接口
 *
 * ⚠️ 仅 `commands/**` 可导入本文件（由 ESLint 强制）。
 *
 * 这是 Command 层的唯一一扇门：写能力与审计字段注入都从这里取。命令层因此
 * 不需要直接导入 `storage/indexeddb/**`，约束 1 的边界依然成立。
 *
 * 审计字段注入函数在这里转出，而不是让命令层自己拼 user_id / version：
 * 约束 3 要求 `user_id` 对业务代码不可见、不可传，所以 `'local'` 这个字面量
 * 只存在于 `storage/indexeddb/write.ts`，命令层连写的机会都没有。
 *
 * 允许导入：entities/、storage/repositories/、storage/indexeddb/
 * 可被导入：仅 commands/**
 */
export { repositories, repositoryFor, createRepositories } from './repositories/index.ts'

export {
  StorageWriteError,
  runCommandTransaction,
} from './indexeddb/transaction.ts'

export type {
  CommandTransactionOptions,
  WriteFailureReason,
} from './indexeddb/transaction.ts'

export type { DbProvider } from './indexeddb/db.ts'

export type {
  IndexName,
  ListOptions,
  QuerySpec,
  Repository,
  RepositorySet,
  Row,
  WriteTx,
} from './repositories/types.ts'

export {
  INITIAL_VERSION,
  LOCAL_USER_ID,
  RecordValidationError,
  assertValidRecord,
  createNow,
  withAuditForCreate,
  withAuditForRestore,
  withAuditForSoftDelete,
  withAuditForUpdate,
} from './indexeddb/write.ts'

export type { CreateInput, Now, UpdateInput } from './indexeddb/write.ts'
