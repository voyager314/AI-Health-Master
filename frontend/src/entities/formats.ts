/**
 * 持久化字段的格式定义。
 *
 * 模式只在这里写一遍。主键、时刻与图片引用的格式各自被校验、解析、构造三处用到，
 * 分散定义会让它们在边缘情形上渐渐对不上——比如校验接受的大小写与解析接受的不一致。
 */

/**
 * UUID v7 的主体部分，不含锚点。
 *
 * 版本位固定为 7、变体位限定在 8-b：纯随机的 v4 主键在合并与索引上都没有时间
 * 局部性，因此在格式层就把它挡住，而不是等到数据长大之后才发现。
 */
const UUID_V7_BODY = '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

/** 主键格式 */
export const UUID_V7 = new RegExp(`^${UUID_V7_BODY}$`, 'i')

/**
 * 时刻格式：以 `Z` 结尾的 UTC ISO 8601，秒以下最多三位。
 *
 * 带时区偏移的写法被排除在外。同一时刻若允许多种表示，跨设备的排序与比较
 * 就不再可靠，而偏移本身另有字段承载。
 */
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** 本地图片引用的协议前缀 */
export const STORAGE_REF_PREFIX = 'local://'

/** 图片引用格式 */
export const STORAGE_REF = new RegExp(`^${STORAGE_REF_PREFIX}${UUID_V7_BODY}$`, 'i')

/** 由二进制标识构造业务记录中存放的引用字符串 */
export function formatStorageRef(blobId: string): string {
  return `${STORAGE_REF_PREFIX}${blobId}`
}

/**
 * 从引用字符串取出二进制标识；格式不合法时返回 `null`。
 *
 * 返回 `null` 只表示「这不是一个合法引用」，不表示「目标不存在」——后者要查过
 * 存储才知道。把两者区分开，界面才能对「图片已被清理」和「数据有问题」给出
 * 不同的说法。
 */
export function parseStorageRef(ref: string): string | null {
  return STORAGE_REF.test(ref) ? ref.slice(STORAGE_REF_PREFIX.length) : null
}
