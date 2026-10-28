import react from '@vitejs/plugin-react'
// 从 vitest/config 而不是 vite 导入 defineConfig：它同时带上 test 字段的类型，
// 不需要额外的 triple-slash reference。
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // `@/` → `src/`。见 design.md D14：别名把导入写法收敛成唯一形式，
    // 否则 ESLint 的分层边界规则会随文件深度变化而漏判。
    // vitest 自动继承这里的 alias，测试不需要重复声明。
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    // 默认 node 环境：数据层、Command 层与领域纯函数都不需要 DOM。
    // fake-indexeddb 在 setup 里装成全局，让 Repository 测试跑真实的 IndexedDB 语义。
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
