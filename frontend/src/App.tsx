/**
 * 应用根组件。
 *
 * 本 change（local-data-foundation）只交付数据层地基，真正的应用外壳——
 * 路由骨架、PWA 注册、首次使用的告知同意门禁、免责声明——在任务组 11 与 12 落地。
 * 这里先保持最小可启动状态，用于验证构建链路通畅。
 */
export default function App() {
  return (
    <main className="boot">
      <h1>AI Health Master</h1>
      <p>本地数据地基正在搭建中。</p>
    </main>
  )
}
