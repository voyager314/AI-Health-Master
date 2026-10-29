/**
 * 测试可读的源文件内容。
 *
 * 有些约束只能靠对源码事实的断言来守：触达区域写在样式里、分层边界写在导入语句里、
 * 时间算术只允许出现在一个文件里。这些都没有可断言的运行时行为，但改坏了要有东西
 * 立刻失败——而不是等到迁库时才发现全部业务逻辑都长在存储调用上。
 *
 * 用 glob 读取：样式不是模块，静态导入拿到的是处理后的产物，断言原文才看得出值有没有被改。
 */

const rawCss = import.meta.glob('../**/*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** 全局样式表的完整文本 */
export const indexCss: string =
  rawCss['../index.css'] ?? rawCss['/src/index.css'] ?? Object.values(rawCss)[0] ?? ''

const rawTs = import.meta.glob(['../telemetry/**/*.ts', '!../telemetry/**/*.test.ts'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/**
 * 埋点层的源文件内容。
 *
 * 用于断言这一层没有引入任何网络调用：埋点只写本地，一旦有人加了上报，
 * 这条断言会先失败，而不是等用户的数据被发出去才发现。
 */
export const telemetrySources: readonly string[] = Object.values(rawTs)

const rawAll = import.meta.glob('../**/*.{ts,tsx}', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/**
 * glob 的键形如 `../app/HomePage.tsx`，这里转成相对 `src/` 的路径，如 `app/HomePage.tsx`。
 *
 * 断言里用到的是相对路径：绝对路径会随机器变化，测试因此无法在另一台机器上成立。
 */
function toSourcePath(key: string): string {
  return key.replace(/^\.\.\//, '')
}

/** 全部源文件，按相对路径排序 */
export const allSources: readonly { readonly path: string; readonly text: string }[] =
  Object.entries(rawAll)
    .map(([key, text]) => ({ path: toSourcePath(key), text }))
    .sort((a, b) => a.path.localeCompare(b.path))

/** 全部源文件的相对路径 */
export const sourcePaths: readonly string[] = allSources.map((s) => s.path)

/**
 * 取某个相对路径的源码文本。
 *
 * 取不到时抛错而不是返回空串：空串会让「这个文件里没有违规写法」这类断言永远通过，
 * 路径写错时测试会静默失效。
 */
export function sourceText(path: string): string {
  const found = allSources.find((s) => s.path === path)
  if (!found) throw new Error(`找不到源文件：${path}`)
  return found.text
}

export default sourceText
