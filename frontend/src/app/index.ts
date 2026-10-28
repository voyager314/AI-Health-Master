/**
 * app —— 应用外壳
 *
 * 路由、PWA 注册、首次使用的告知同意门禁、免责声明常驻展示。
 *
 * ⚠️ 禁止导入 storage/indexeddb/**（约束 1）与 storage/internal（约束 9）。
 * 读数据经 storage/（只读视图），写数据经 commands/。
 *
 * 允许导入：entities/、features/、commands/、storage/、domain/、stats/、telemetry/、shared/
 */

export {}
