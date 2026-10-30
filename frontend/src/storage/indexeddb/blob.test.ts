/**
 * 图片引用契约的验证：格式解析、三态解析，以及「业务记录只存引用」这条结构约束。
 */
import { BUSINESS_STORE_NAMES, RECORD_SPECS, formatStorageRef, parseStorageRef } from '@/entities'
import { createBlobStore } from '@/storage/indexeddb/blob.ts'
import { createNow } from '@/storage/indexeddb/write.ts'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let testDb: TestDb
let blobs: ReturnType<typeof createBlobStore>

beforeEach(async () => {
  testDb = await createTestDb('blob')
  blobs = createBlobStore(testDb.getDb)
})

afterEach(() => testDb.close())

describe('引用格式', () => {
  const id = '01a182ae-25f7-7661-b587-84998ff6f6df'

  it('构造与解析互为逆运算', () => {
    expect(parseStorageRef(formatStorageRef(id))).toBe(id)
  })

  it('接受大小写混排的标识', () => {
    expect(parseStorageRef(`local://${id.toUpperCase()}`)).toBe(id.toUpperCase())
  })

  it.each([
    ['缺少协议前缀', id],
    ['协议不对', `https://${id}`],
    ['标识不是 UUID', 'local://not-a-uuid'],
    ['UUID v4 而非 v7', 'local://9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'],
    ['空字符串', ''],
    ['只有前缀', 'local://'],
    ['尾部有多余内容', `local://${id}?w=100`],
  ])('拒绝不合法的引用：%s', (_label, ref) => {
    expect(parseStorageRef(ref)).toBeNull()
  })
})

describe('三态解析', () => {
  it('二进制存在时返回命中，内容可原样取回', async () => {
    const ref = await blobs.put(new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' }), createNow())

    const resolved = await blobs.resolve(ref)
    expect(resolved.state).toBe('hit')
    if (resolved.state !== 'hit') return

    expect(resolved.record.mime).toBe('image/jpeg')
    expect(resolved.record.byte_size).toBe(15)
    expect(await resolved.record.bytes.text()).toBe('fake-jpeg-bytes')
  })

  it('引用合法但目标不在库中时返回已清理', async () => {
    const ref = formatStorageRef('01a182ae-25f7-7661-b587-84998ff6f6df')
    expect(await blobs.resolve(ref)).toEqual({ state: 'cleared' })
  })

  it('引用格式不合法时返回格式非法，与已清理可区分', async () => {
    expect(await blobs.resolve('local://whatever')).toEqual({ state: 'malformed' })
    expect(await blobs.resolve('')).toEqual({ state: 'malformed' })
  })

  it('解析不存在的目标不抛错', async () => {
    await expect(
      blobs.resolve(formatStorageRef('01a182ae-25f7-7661-b587-84998ff6f6df')),
    ).resolves.toBeDefined()
  })

  it('未携带类型的二进制落为通用类型，而不是写不进去', async () => {
    const ref = await blobs.put(new Blob(['bytes']), createNow())

    const resolved = await blobs.resolve(ref)
    expect(resolved.state).toBe('hit')
    if (resolved.state !== 'hit') return
    expect(resolved.record.mime).toBe('application/octet-stream')
  })

  it('两次存入得到互不相同的引用', async () => {
    const now = createNow()
    const first = await blobs.put(new Blob(['a']), now)
    const second = await blobs.put(new Blob(['b']), now)

    expect(first).not.toBe(second)
    expect(await blobs.resolve(first)).not.toEqual(await blobs.resolve(second))
  })
})

describe('业务记录只持有引用', () => {
  it('6 张业务表没有任何字段存放二进制', () => {
    const offenders: string[] = []

    for (const store of BUSINESS_STORE_NAMES) {
      for (const [field, spec] of Object.entries(RECORD_SPECS[store])) {
        if (spec.rule.type === 'blob') offenders.push(`${store}.${field}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('图片字段按引用格式校验，塞进 base64 会被拒绝', () => {
    const photo = RECORD_SPECS.meal.photo_ref
    expect(photo?.rule.type).toBe('storageRef')

    expect(parseStorageRef('data:image/png;base64,iVBORw0KGgo=')).toBeNull()
  })
})
