# 验收记录

## 范围确认

本 change 只修数据层与 PRD v0.5 的偏差，不实现任何业务功能。界面仅两处跟着改：首页读取 `workout_log`，导航文案改用「运动」。

## 自检结论

| 项 | 方式 | 结论 |
| --- | --- | --- |
| 业务表恰为 6 张 | `npm test`：`schema.test.ts` 断言全新安装建出 9 个 store、业务表 6 张、旧模型四张表不存在 | 通过 |
| 项目卡片字段规则 | `schema.test.ts` 覆盖只填项目名、0.5 步进、空数组、未知字段、超长项目名、同名重复六种情形 | 通过 |
| `logged_at` 单字段索引 | `schema.test.ts` 断言 `workout_log` 的索引恰为 `user_id` 与 `logged_at` | 通过 |
| 导出清单收敛到 7 张 | `export.test.ts` / round-trip 用例在 6 张业务表上逐字段相等 | 通过 |
| 旧模型表名被拒绝 | `import.test.ts` 断言清单外的表名（含 `pending_ops`）报错并定位到表名；`schema.test.ts` 断言库里不存在该四张表 | 通过 |
| 存储访问收敛 | `constraints.test.ts`：`indexedDB` 只出现在 `storage/indexeddb/**` | 通过 |
| `user_id` 统一注入 | `constraints.test.ts`：`'local'` 字面量只出现在 `storage/**` | 通过 |
| 写操作单一入口 | `constraints.test.ts`：`storage/internal` 只被 `commands/**` 导入 | 通过 |
| 迁移链 | `db.test.ts`：一版一条、版本号由链长推导 | 通过 |
| 注释不引用文档 | 全仓库搜索 `design.md`、`openspec/`、`PRD §`、`FR-`、`约束 N` 零命中 | 通过 |

`npm run lint`、`npx tsc -b`、`npx vitest run`（293 项）全部通过。

## 已知影响

- 导出文件的表清单变了，旧模型导出的文件不再被接受导入。环境中的数据从未发布，不存在需要兼容的真实旧文件。
- 结构版本仍为 1。开发机上已有的本地库不会触发升级，需要清除一次站点数据；版本 1 一经随正式版本发布即冻结。
- 保留期清理只登记为规则，执行代码随运动记录功能实现。

## 未覆盖

运动记录页、30 天列表、编辑删除、体重页、目标设置与语音链路均不在本 change 内，见提案的「不包含」表。
