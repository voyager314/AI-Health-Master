/**
 * 基础标量类型与 9 张业务表共有的字段契约。
 */

/**
 * UTC ISO 8601 字符串，必须以 `Z` 结尾。
 *
 * 时刻一律以此格式落库。禁止带时区偏移的时间字符串（如 `2026-10-28T12:00:00+08:00`），
 * 也禁止时间戳数字——同一时刻有多种表示会让跨设备比较与排序出错。
 * 用户当时的时区偏移另存于 `tz_offset_minutes`。
 */
export type IsoUtc = string

/**
 * UUID v7 字符串。
 *
 * 必须是 v7 而非 v4：v7 时间有序，主键天然可近似按时间排序，
 * 上云后也不会让 B 树索引随机分裂。校验见 validation.ts 的 `uuidV7` 规格。
 */
export type Uuid = string

/** 本期固定为 `'local'`，上云时只回填真实用户 ID、不改表结构。 */
export type UserId = string

/**
 * 图片引用，格式为 `local://<uuid>`。
 *
 * 业务记录只存这个字符串，二进制在独立的 `blob` store 里。
 * 目标 blob 可能已被清理，解析必须返回三态而非抛错——「格式不合法」与
 * 「目标不存在」是两回事，界面要能分开提示。
 */
export type StorageRef = string

/**
 * 9 张业务表共有的字段。
 *
 * ⚠️ 全部由存储层的写入包装层注入，业务代码不得传入任何一项。
 * `user_id` 尤其如此：它由存储层统一注入，业务代码不传，也看不到这个字段的存在。
 */
export interface AuditFields {
  /** UUID v7 主键 */
  id: Uuid
  /** 客户端生成的幂等键。本期与 `id` 同值，上云后服务端靠它为离线重放去重 */
  client_id: Uuid
  /** 本期恒为 `'local'` */
  user_id: UserId
  /** 整数版本号，本期恒为 `1`，上云后作为乐观锁 */
  version: number
  created_at: IsoUtc
  updated_at: IsoUtc
  /** 软删除标记。未删除时为 `null`，删除时写入删除时刻，记录本身保留 */
  deleted_at: IsoUtc | null
  /**
   * 记录写入时设备时区相对 UTC 的偏移，单位分钟，东为正。
   *
   * 注意与 `Date.prototype.getTimezoneOffset()` 符号相反：UTC+8 在这里是 `480`，
   * 而 `getTimezoneOffset()` 返回 `-480`。自然日/周归属按本字段判定，不按设备当前时区。
   */
  tz_offset_minutes: number
}
