/**
 * 测试可读的源文件内容。
 *
 * 某些约束只能落在样式里（触达区域、对比度、深色启动底色），没有可断言的运行时
 * 行为。把它们读成文本再断言，至少能在被改坏时失败一次——而不是等到有人拿手指
 * 点不中按钮才发现。
 *
 * 用 glob 而非常规导入：样式文件不是模块，静态导入拿到的是处理后的产物而不是原文，
 * 断言原文才看得出这些值有没有被改。
 */
const rawCss = import.meta.glob('../**/*.css', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/** 全局样式表的完整文本 */
export const indexCss: string =
  rawCss['../index.css'] ?? rawCss['/src/index.css'] ?? Object.values(rawCss)[0] ?? ''
