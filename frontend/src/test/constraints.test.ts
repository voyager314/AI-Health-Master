/**
 * 可迁移性约束的自检。
 *
 * 这些约束服务于一个目标：把本地数据库换成服务端数据库时，只替换存储实现，不重写
 * 业务逻辑。它们无法靠类型系统表达，只能靠对源码事实的断言。
 *
 * 三条硬性一票否决的约束各有独立断言：它们一旦被违反，将来的迁移会退化成重写，
 * 而重写成本在事后来看通常无法挽回。
 */
import { describe, expect, it } from 'vitest'

import sourceText, { sourcePaths } from './sources.ts'

/** 取某一层下的全部源文件路径（不含测试） */
function pathsUnder(prefix: string): string[] {
  return sourcePaths.filter((p) => p.startsWith(prefix) && !p.includes('.test.'))
}

/**
 * 去掉注释后的源码文本。
 *
 * 断言的是源码事实而非文字：说明里提到被禁用的 API 名称，本身就是对规则的解释，
 * 不应算作使用。块注释与行注释两种写法都要去掉，否则放在文档注释里的禁词会被误判。
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('约束 1（一票否决）：存储访问收敛', () => {
  it('只有数据库实现目录可以直接使用 IndexedDB API', () => {
    const offenders = pathsUnder('')
      .filter((p) => !p.startsWith('storage/indexeddb/'))
      .filter((p) => {
        const code = stripComments(sourceText(p))
        return /\bindexedDB\b|\bIDBKeyRange\b|\bdeleteDatabase\b/.test(code)
      })

    expect(offenders).toEqual([])
  })

  it('业务页面不导入数据库实现', () => {
    const offenders = [
      ...pathsUnder('app/'),
      ...pathsUnder('features/'),
      ...pathsUnder('shared/'),
    ].filter((p) => /from\s+['"][^'"]*storage\/indexeddb/.test(sourceText(p)))

    expect(offenders).toEqual([])
  })

  it('没有任何一处删除数据库', () => {
    const offenders = pathsUnder('').filter((p) =>
      /\.deleteDatabase\s*\(|\bdeleteDatabase\s*:/.test(sourceText(p)),
    )

    expect(offenders).toEqual([])
  })
})

describe('约束 3（一票否决）：user_id 由存储层注入', () => {
  it('用户标识字面量只出现在存储实现里', () => {
    const offenders = pathsUnder('')
      .filter((p) => !p.startsWith('storage/'))
      .filter((p) => {
        const code = stripComments(sourceText(p))
        return /['"]local['"]/.test(code)
      })

    expect(offenders).toEqual([])
  })

  it('业务代码不给 user_id 赋值', () => {
    const offenders = pathsUnder('')
      .filter((p) => !p.startsWith('storage/') && !p.startsWith('entities/'))
      .filter((p) => /user_id\s*[:=]/.test(sourceText(p)))

    expect(offenders).toEqual([])
  })
})

describe('约束 9（一票否决）：写操作走统一入口', () => {
  it('含写方法的内部入口只被命令层导入', () => {
    const offenders = pathsUnder('')
      .filter((p) => !p.startsWith('commands/'))
      .filter((p) => /from\s+['"][^'"]*storage\/internal/.test(sourceText(p)))

    expect(offenders).toEqual([])
  })

  it('页面与组件不直接调用写方法', () => {
    const offenders = [...pathsUnder('app/'), ...pathsUnder('features/')].filter((p) => {
      const code = sourceText(p)
      // 只读视图上没有写方法，这里守的是「不通过其他途径拿到它们」
      return /Repo\.(put|remove|clear)\s*\(|repos\[[^\]]+\]\.(put|remove|clear)\s*\(/.test(code)
    })

    expect(offenders).toEqual([])
  })
})

describe('约束 2/6/12：可在源码层验证的部分', () => {
  it('约束 2：不出现返回 v4 的主键生成调用', () => {
    // 断言的是调用而不是名字：报错文案里点出 v4 生成器属于解释规则，不生成主键
    const offenders = pathsUnder('').filter((p) =>
      /\bcrypto\.randomUUID\s*\(/.test(stripComments(sourceText(p))),
    )

    expect(offenders).toEqual([])
  })

  it('约束 6：日界与周界算术只在一个文件里', () => {
    const arithmetic = [/getUTCDay\s*\(/, /\bgetDay\s*\(/, /86_?400_?000/]
    // 测试拿同一批常量做期望值是断言而非第二份实现，因此只看生产代码
    const offenders = pathsUnder('')
      .filter((p) => p !== 'stats/timeWindow.ts')
      .filter((p) => arithmetic.some((pattern) => pattern.test(stripComments(sourceText(p)))))

    expect(offenders).toEqual([])
  })

  it('约束 12：领域与统计层不导入存储、命令与埋点', () => {
    const offenders = [...pathsUnder('domain/'), ...pathsUnder('stats/')].filter((p) =>
      /from\s+['"][^'"]*(@\/storage|@\/commands|@\/telemetry|storage\/|idb['"])/.test(
        sourceText(p),
      ),
    )

    expect(offenders).toEqual([])
  })
})

describe('约束 7：图片只存引用', () => {
  it('业务实体中没有二进制字段', () => {
    const offenders = pathsUnder('entities/').filter((p) =>
      /:\s*Blob\b|:\s*ArrayBuffer\b|base64/i.test(sourceText(p)),
    )

    // blob 记录本身允许持有二进制，业务实体的字段类型不允许
    const entityFiles = offenders.filter((p) => !p.includes('records.ts'))
    expect(entityFiles).toEqual([])
  })
})
