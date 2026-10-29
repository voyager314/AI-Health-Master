/**
 * app —— 应用外壳
 *
 * 路由、PWA 注册、首次使用的告知同意门禁、免责声明常驻展示。
 *
 * ⚠️ 禁止导入 storage/indexeddb/**：`indexedDB` 与 `db.` 只允许出现在该目录内，
 * 其余代码一律经 Repository 取数，换掉存储实现时业务逻辑不必跟着改。
 * 禁止导入 storage/internal：写能力只对 commands/** 开放，越过后就绕开了统一的
 * 命令入口，写入日志与审计字段注入随之失效。
 *
 * 读数据经 storage/（只读视图），写数据经 commands/。
 *
 * 允许导入：entities/、features/、commands/、storage/、domain/、stats/、telemetry/、shared/
 */

export { AppShell } from './AppShell.tsx'
export { isNavActive, navItems, routeElements } from './routes.tsx'
export type { NavItem, RouteEntry } from './routes.tsx'
