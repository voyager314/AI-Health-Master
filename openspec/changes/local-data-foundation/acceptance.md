# 出口验收记录

本文件记录这个 change 的出口标准逐项结论。三条硬性一票否决的约束若有一条不通过，
整个 change 不算完成；因此结论必须逐条写明依据，不能只写「已通过」。

检查日期：2026-10-29
检查方式：自动化测试（`npm run check`）+ 源码扫描断言（`src/test/constraints.test.ts`）

---

## 出口标准一：导出 → 清空 → 导入 数据完全一致

**结论：通过。**

依据：`src/features/data/roundTrip.test.ts` 的 9 条用例，断言覆盖 9 张业务表的
整条记录逐一相等，而不是挑字段比对。

| 用例 | 结果 |
| --- | --- |
| 导出、清空、导入后逐表逐字段相等 | 通过 |
| 主键与审计字段（`user_id`、`version`）原样保留 | 通过 |
| 时间字符串与 `tz_offset_minutes` 不漂移（东西半球偏移混排） | 通过 |
| 外键关系成立（训练单→动作→组、餐食→条目） | 通过 |
| 重复往返结果稳定 | 通过 |
| 已软删除记录不参与往返、不复活 | 通过 |
| 缺失 blob 的引用往返后解析为「已清理」，记录完好 | 通过 |
| 空库往返得到空库 | 通过 |
| 导出后清空、再导入仍可用 | 通过 |

---

## 出口标准二：断网可打开

**结论：部分验证，真机待实测。**

已确认：service worker 以 generateSW 模式生成，预缓存 13 条产物，包含 `index.html`、
应用脚本与样式、manifest、favicon 与全部四个图标；`navigateFallback` 指向外壳，
任意应用内路径在离线时都落到同一份外壳并由前端路由接管。

已确认：`deleteDatabase` 在全仓库零命中，`dist/sw.js` 中不含任何数据库调用——
更新与缓存清理不会触及本地数据。

**未完成**：真机飞行模式冷启动的实际表现，需要在 iOS Safari 16+ 与 Android Chrome 110+
各测一次。这一项无法在 Node 环境断言。

---

## 出口标准三：12 条约束自检

**结论：12 条全部通过，其中 1 / 3 / 9 三条一票否决项各自有独立断言。**

| # | 约束 | 落地方式 | 自检 |
| --- | --- | --- | --- |
| 1 | 存储访问收敛到 Repository | `storage/indexeddb/**` 是唯一数据库实现目录 | `constraints.test.ts` 扫描全仓源码（去注释后）断言 `indexedDB`、`IDBKeyRange`、`deleteDatabase` 只在该目录出现；另有 ESLint 规则含 `globalThis/window/self` 成员表达式形式 |
| 2 | UUID v7 + `client_id`，禁自增 | 写入层统一用 `uuid` 的 `v7()` | 源码断言不出现 `crypto.randomUUID(` 调用；字段规格的 `uuidV7` 在落库前再拒一次 v4；单测断言主键版本位为 7 且字典序递增 |
| 3 | 每条记录带 `user_id` | 写入包装层注入 `'local'` | 源码断言 `'local'` 字面量只在 `storage/**` 出现、业务代码不给 `user_id` 赋值；单测断言 9 张表均有 `user_id` 字段与索引 |
| 4 | 每条记录带 `version` | 同上，恒为 1 | 单测断言 9 张表记录均含 `version`，重复导出不改变 `created_at` |
| 5 | 软删除 | `remove` 写 `deleted_at` | 单测断言 `remove` 后按主键仍可取到记录、`list` 不返回它；两处例外（清空全部数据、blob 清理）在 design 中留痕 |
| 6 | 时间 UTC + 独立 offset，周界单点实现 | `stats/timeWindow.ts` 为唯一实现 | 源码断言日界/周界算术只在该文件出现；`timeWindow` 单测穷举跨零点、跨周界、跨时区；字段规格拒绝带偏移的时间字符串 |
| 7 | 图片存独立 blob，记录只存 ref | 业务记录只存 `local://<uuid>` | 单测断言 9 张业务表无 blob 字段；三态解析各有测试 |
| 8 | 查询只用单字段索引 + 内存过滤 | `QuerySpec` 只允许一个索引取数 + 内存过滤 | API 形状使复合游标无法表达；单测覆盖等值、区间、内存过滤三种形态 |
| 9 | 写操作走统一 Command 层 | `applyCommand` 是唯一写入口 | 源码断言 `storage/internal` 只被 `commands/**` 导入、页面不调用写方法；TypeScript 层面页面拿到的只读视图没有写方法（已有编译期验证）；单测断言每次命令产生恰一条 `pending_ops` |
| 10 | `schema_version` + 顺序迁移 + 迁移前备份 | 先以旧版本打开取快照、关闭、再以新版本升级 | 迁移链单测断言执行顺序；断言升级路径必产生备份；注入抛错迁移断言数据库回到原版本与内容 |
| 11 | 导出 JSON = 内部结构，可反向导入 | 导出不做字段转换；快照与导出共用一份实现 | 往返一致性测试；`pending_ops` 与 `blob` 不导出的理由在 design 留痕 |
| 12 | 领域计算为纯函数 | `domain/**` 与 `stats/**` 不导入存储 | 源码断言与 ESLint 规则双重覆盖；领域单测在不初始化数据库的情况下通过 |

---

## 自动化检查结果

| 项 | 结果 |
| --- | --- |
| `npm run lint` | 通过，无告警 |
| `npm run test` | 23 个文件、288 个测试全部通过 |
| `npm run build` | 通过，service worker 与 manifest 已产出 |
| `openspec validate --strict` | `Change 'local-data-foundation' is valid` |

---

## 遗留项

| 项 | 原因 | 归属 |
| --- | --- | --- |
| 真机飞行模式冷启动 | 需要实际设备 | 上线前手动验收 |
| 4G + 中端安卓首屏可交互 < 1.5s | 需要实际设备与网络 | 上线前手动验收 |
| 主屏安装、独立窗口启动 | 需要实际设备 | 上线前手动验收 |
| `app_meta.schema_version` 镜像 | 已决定删除该字段，数据库自身 version 是唯一权威 | 已完成，见 design 中的决策记录 |
