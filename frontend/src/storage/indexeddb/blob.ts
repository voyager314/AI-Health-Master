/**
 * 图片二进制的存取。
 *
 * 二进制单独存一个 store，业务记录只持有引用字符串。把图片以 base64 塞进记录会
 * 让导出文件膨胀到用户无法传输，也会让每次读取一条记录都顺带搬运几百 KB。
 *
 * 引用的目标可能不存在：清理策略会物理删除过期图片，从不含二进制的备份导入也会
 * 留下悬空引用。这是预期状态而非异常——解析返回三态，调用方据此区分「图片已被
 * 清理」与「这条引用有问题」，两者对用户要说的话完全不同。
 *
 * 二进制的删除是物理删除，与业务记录的软删除不同。软删除不释放空间，对大二进制
 * 而言正好会造成它本该防止的问题：存储配额被占满。
 */
import type { BlobRecord } from '@/entities'
import { formatStorageRef, parseStorageRef } from '@/entities'
import { v7 as uuidv7 } from 'uuid'
import { getDatabase, type DbProvider } from './db.ts'
import { assertValidRecord, type Now } from './write.ts'

/**
 * 解析一个引用的结果。
 *
 * - `hit`：二进制存在，`record` 为完整记录
 * - `cleared`：引用合法但目标已不在库中，业务记录本身完好
 * - `malformed`：引用字符串不符合格式，说明数据有问题而非图片被清理
 */
export type BlobResolution =
  | { readonly state: 'hit'; readonly record: BlobRecord }
  | { readonly state: 'cleared' }
  | { readonly state: 'malformed' }

/** 只读视图：应用层经 `@/storage` 拿到的就是这个形状 */
export interface BlobReader {
  /**
   * 解析引用，三态返回。
   *
   * 不抛错也不返回空值：目标二进制可能已被清理，那是预期状态而非异常，
   * 调用方据此决定显示占位还是报告数据有问题。
   */
  resolve(ref: string): Promise<BlobResolution>
}

/** 完整能力：写方法只经 `@/storage/internal` 暴露给命令层 */
export interface BlobStore extends BlobReader {
  /**
   * 存入二进制，返回业务记录中应当存放的引用字符串。
   *
   * `bytes` 的内容与 MIME 类型都取自入参；类型缺失时落为通用二进制类型，
   * 以免记录因为一个空字符串而写不进去。
   */
  put(bytes: Blob, now: Now): Promise<string>
}

/** Blob 未携带类型时的落值 */
const DEFAULT_MIME = 'application/octet-stream'

async function resolveRef(getDb: DbProvider, ref: string): Promise<BlobResolution> {
  const id = parseStorageRef(ref)
  if (id === null) return { state: 'malformed' }

  const db = await getDb()
  const record = await db.get('blob', id)
  return record ? { state: 'hit', record } : { state: 'cleared' }
}

/** 只读解析器。界面显示一张图片只需要它，不需要存图的能力 */
export function createBlobReader(getDb: DbProvider = () => getDatabase()): BlobReader {
  return { resolve: (ref) => resolveRef(getDb, ref) }
}

export function createBlobStore(getDb: DbProvider = () => getDatabase()): BlobStore {
  return {
    async put(bytes, now) {
      const id = uuidv7()
      const record: BlobRecord = {
        id,
        mime: bytes.type === '' ? DEFAULT_MIME : bytes.type,
        bytes,
        byte_size: bytes.size,
        created_at: now.iso,
      }
      assertValidRecord('blob', record)

      const db = await getDb()
      await db.put('blob', record)
      return formatStorageRef(id)
    },

    resolve: (ref) => resolveRef(getDb, ref),
  }
}
