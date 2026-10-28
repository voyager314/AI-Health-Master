/**
 * schema 顺序迁移脚本（约束 10）。
 *
 * 一个版本恰一条迁移，按版本号升序执行。`LATEST_SCHEMA_VERSION` 从数组长度推导，
 * 不单独声明——否则「声明的版本号」与「迁移条数」会漂移。
 *
 * 全新安装与旧库升级走**同一条链**：IndexedDB 对不存在的库给出 `oldVersion === 0`，
 * 于是从头跑全部迁移。这避免了「建表代码」与「迁移代码」产出不同 schema 的经典问题
 * ——那种 bug 只在老用户升级时才暴露，而开发者本地永远是全新安装。
 */
import { STORES } from '../schema.ts'

/**
 * 迁移只需要建表与建索引的能力。
 *
 * 用这个最小接口而不是 idb 的 `IDBPDatabase<AppDb>`：后者的 `createObjectStore`
 * 签名要求 store 名是 AppDb 的字面量 key，而迁移是遍历 STORES 动态建表的。
 * 类型收窄到实际需要的能力，把唯一一次 cast 收在 db.ts 的 upgrade 回调里。
 */
export interface SchemaWriter {
  readonly objectStoreNames: DOMStringList
  createObjectStore(
    name: string,
    options?: IDBObjectStoreParameters,
  ): {
    createIndex(name: string, keyPath: string, options?: IDBIndexParameters): unknown
  }
  deleteObjectStore(name: string): void
}

export interface Migration {
  readonly version: number
  /** 必须同步执行——IndexedDB 的升级事务不能跨 await（见 design.md Context） */
  readonly up: (db: SchemaWriter) => void
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    up: (db) => {
      for (const store of STORES) {
        const os = db.createObjectStore(store.name, { keyPath: store.keyPath })
        for (const index of store.indexes) {
          // 索引名与被索引字段同名：约束 8 只允许单字段索引，不存在需要另起名字的复合索引
          os.createIndex(index, index)
        }
      }
    },
  },
]

/**
 * 校验迁移链是「一版一条、从 1 开始、无空缺无重复」。
 *
 * 导出成函数而非只在模块加载时跑，是为了让任务 7.1 的测试能直接断言这条规则，
 * 而不是靠「import 时没抛错」来间接验证。
 */
export function validateMigrationChain(
  migrations: readonly Migration[] = MIGRATIONS,
): string[] {
  const issues: string[] = []
  if (migrations.length === 0) issues.push('迁移链不能为空，至少要有 version 1')
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      issues.push(`第 ${i + 1} 条迁移的 version 是 ${m.version}，应为 ${i + 1}（约束 10：一版一条、按序排列）`)
    }
  })
  return issues
}

const chainIssues = validateMigrationChain()
if (chainIssues.length > 0) {
  // 这是编码错误而非运行时异常：迁移链排错会让用户数据在升级时损坏，
  // 因此在模块加载阶段就失败，不给它跑起来的机会。
  throw new Error(`迁移链定义有误：\n${chainIssues.join('\n')}`)
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length
