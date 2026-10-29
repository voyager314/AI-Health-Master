import react from '@vitejs/plugin-react'
// 从 vitest/config 而不是 vite 导入 defineConfig：它同时带上 test 字段的类型，
// 不需要额外的 triple-slash reference。
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 新版本就绪后交给用户决定何时刷新，不自动接管。使用的场景是训练中途
      // 记录，此时换掉页面是最糟的打断时机。
      registerType: 'prompt',
      // 注册交给 virtual:pwa-register/react，否则插件会自动注入一份注册脚本，
      // 两处并存时更新提示拿不到状态。
      injectRegister: null,
      manifest: {
        name: 'AI Health Master',
        short_name: 'Health Master',
        description: '增肌期力量训练者的训练记录与体重趋势工具',
        lang: 'zh-CN',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // 与 index.css 的底色一致：启动瞬间不会闪一下白
        background_color: '#121316',
        theme_color: '#121316',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // 只预缓存应用外壳与静态资源。业务数据在本地数据库里，不需要任何运行时
        // 请求缓存策略——这是 PWA 里最不容易出错的用法。
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // 直接访问任意应用内路径都落到外壳，由前端路由接管
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // 开发时不启用 service worker：它缓存旧产物，会让改动看起来没生效
        enabled: false,
      },
    }),
  ],
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
    // 需要 DOM 的用例在文件头用 `@vitest-environment jsdom` 单独声明。
    environment: 'node',
    css: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    alias: {
      // 注册接口由插件在构建时生成，测试进程里没有对应文件。
      // 别名到本地替身，让依赖它的组件在测试中也能挂载。
      'virtual:pwa-register/react': new URL(
        './src/test/pwaRegisterStub.ts',
        import.meta.url,
      ).pathname,
    },
  },
})
