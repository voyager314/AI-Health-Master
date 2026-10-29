/**
 * 分层与纯度的源码级检查。
 *
 * ESLint 已经挡住跨层导入，但规则可以被 `eslint-disable` 就地关掉，而被关掉的
 * 那一行恰恰是最需要被看见的。这里直接扫源码作为第二道网，同时把两条原本只能
 * 靠人工 grep 的自检固化成可重复运行的断言。
 *
 * 源码经 Vite 的 glob 导入读取而不是 node 的文件接口：应用代码的类型环境里
 * 不含 node，加进来会让浏览器端误用 `process` 这类全局也能通过类型检查。
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** glob 的键形如 `../domain/index.ts`，转成以层名开头的相对路径 */
function layerPath(key: string): string {
  return key.replace(/^\.\.\//, '')
}

function entries(options: { layer?: string; includeTests: boolean }) {
  return Object.entries(SOURCES)
    .map(([key, source]) => [layerPath(key), source] as const)
    .filter(([path]) => (options.layer ? path.startsWith(`${options.layer}/`) : true))
    .filter(([path]) => options.includeTests || !path.includes('.test.'))
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
}

describe('领域计算的纯度', () => {
  // 计算必须能脱离数据库单测，将来也要能被等价的 SQL 聚合替换并做双实现对照。
  // 一旦这几层碰了存储，两件事都做不到。
  const impure = [/^@\/storage/, /^@\/commands/, /^@\/telemetry/, /storage\//, /^idb$/]

  for (const layer of ['domain', 'stats']) {
    it(`${layer}/ 不导入存储、命令与埋点`, () => {
      const offenders = entries({ layer, includeTests: false }).flatMap(([path, source]) =>
        importsOf(source)
          .filter((specifier) => impure.some((pattern) => pattern.test(specifier)))
          .map((specifier) => `${path} → ${specifier}`),
      )

      expect(offenders).toEqual([])
    })
  }
})

describe('日界与周界算术的唯一实现', () => {
  // 同一套边界规则在两处实现，分歧只会出现在跨零点、跨周界、跨时区这些样本上，
  // 而那类错误在日常使用中看不出来。
  const arithmetic = [/getUTCDay\s*\(/, /\bgetDay\s*\(/, /86_?400_?000/]

  it('只出现在 stats/timeWindow.ts 中', () => {
    const offenders = entries({ includeTests: true })
      .filter(([path]) => !path.startsWith('stats/timeWindow.'))
      .filter(([, source]) => arithmetic.some((pattern) => pattern.test(source)))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
