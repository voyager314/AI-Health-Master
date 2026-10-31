# 出口验收记录

本文件记录这个 change 的出口标准逐项结论。三条硬性一票否决的约束若有一条不通过，
整个 change 不算完成；因此结论必须逐条写明依据，不能只写「已通过」。

检查日期：2026-10-30
检查方式：自动化测试（`npm run check`）+ 源码扫描（`src/test/constraints.test.ts`、
`src/test/architecture.test.ts`）+ 手工源码检索

---

## 出口标准一：`npm run check` 全绿

**结论：通过。**

| 项 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 error 0 warning |
| `npm run test` | 28 个文件、393 个测试全部通过 |
| `npm run build` | 通过，service worker 与 manifest 已产出 |
| `openspec validate workout-log-recording --strict` | `Change 'workout-log-recording' is valid` |

---

## 出口标准二：断网可记录

**结论：通过（Node 环境内的等价验证）。**

依据：`src/features/workout/workout.test.tsx` 的「断网」用例把 `navigator.onLine`
置为 false 后完整走了一遍录入 → 保存 → 落库，记录成功写入。

运动模块没有任何网络调用：读经 `@/storage` 的 IndexedDB 只读视图，写经
`@/commands` 的本地事务，界面层不引入 `fetch` 或任何请求客户端。

**未完成**：真机飞行模式下的冷启动与录入，需要在 iOS Safari 16+ 与 Android
Chrome 110+ 各实测一次。这一项无法在 Node 环境断言。

---

## 出口标准三：导出 → 清空 → 导入，数据完全一致

**结论：通过。**

依据：`src/features/data/roundTrip.test.ts`（10 条用例）覆盖 7 张导出表的整条记录
逐一相等。运动记录这一侧具体覆盖：

| 用例 | 结果 |
| --- | --- |
| 含 3 张卡片的记录往返后仍是 3 张，字段逐一相等 | 通过 |
| 三项指标为 `null` 的卡片往返后仍为 `null`，不被补成 0 | 通过 |
| 主键与审计字段原样保留 | 通过 |
| 时刻与时区偏移不漂移 | 通过 |
| 已软删除的记录不参与往返、不复活 | 通过 |

---

## 出口标准四：保留期清理不误删

**结论：通过。**

依据分两层，覆盖「算得对」与「删得准」：

| 层 | 用例 | 结果 |
| --- | --- | --- |
| 日界算术 | `retentionCutoff` 恰是往前第 180 个自然日的本地零点 | 通过 |
| 日界算术 | 181 天前的时刻早于截止时刻，179 天前的晚于它 | 通过 |
| 命令层 | 181 天前的记录被删、179 天前的保留 | 通过 |
| 命令层 | 截止时刻当天的记录保留，前一毫秒仍算超期 | 通过 |
| 命令层 | 无超期记录时不产生写入，也不新增写操作日志 | 通过 |
| 命令层 | 软删除的墓碑一并清理，其他表不受影响 | 通过 |
| 启动路径 | 清理失败时应用照常进入主界面，超期记录仍在库中 | 通过 |

---

## 12 条可迁移性约束自检

**结论：12 条全部通过，其中 1 / 3 / 9 三条一票否决项各自有独立断言。**

| # | 约束 | 本 change 的落地 | 自检 |
| --- | --- | --- | --- |
| 1 | 存储访问收敛到 Repository | 新增页面只经 `@/storage` 读、经 `@/commands` 写 | `constraints.test.ts` 扫描通过；`features/workout/`、`routes.tsx`、`StartupMaintenance.tsx` 检索 `storage/indexeddb` 零命中 |
| 2 | 主键 UUID v7 | 主键仍由写入包装层生成 | 既有断言继续通过 |
| 3 | 每条记录带 `user_id` | 仍由写入包装层注入 | `constraints.test.ts` 通过；业务代码检索 `user_id` 赋值只命中测试文件与 `entities/` 的说明注释 |
| 4 | `version` 恒 1，编辑走 `withAuditForUpdate` | 编辑只经 `withAuditForUpdate` | 单测断言 `created_at` 不变、`updated_at` 刷新 |
| 5 | 软删除，物理删除仅三处例外 | 新增保留期清理为第三个例外 | `repository.test.ts` 断言 `remove` 写 `deleted_at`；新增 7 条 `purge` 用例 |
| 6 | 日界算术只在 `timeWindow` | 新增 `recentDayInterval`、`retentionCutoff`、`clockTimeOf` 三处实现都落在该文件 | `constraints.test.ts` 与 `architecture.test.ts` 通过；`domain/`、`features/` 检索日期算术零命中 |
| 7 | 图片只存引用 | 不涉及 | 既有断言继续通过 |
| 8 | 查询只用单字段索引 + 内存过滤 | 列表按 `logged_at` 区间取数，幂等键与超期判定都在内存中过滤 | `repository.test.ts` 的区间与内存过滤用例通过 |
| 9 | 写操作走统一 Command 层 | 四条命令登记进 `COMMANDS`，页面只调 `applyCommand` | `constraints.test.ts` 通过；单测断言每种命令执行后 `pending_ops` 恰增一条 |
| 10 | 不改迁移链 | `schema_version` 保持 1，未写迁移 | `db.test.ts`、迁移链测试继续通过 |
| 11 | 导出的 `items` 为嵌套数组，往返一致 | 结构未变 | 往返用例通过 |
| 12 | 领域计算为纯函数 | 分组、摘要、指标计数在 `domain/workoutLog.ts` | `architecture.test.ts` 通过；域函数单测在不初始化数据库的情况下通过 |

---

## 注释与文案收尾

| 检查 | 结果 |
| --- | --- |
| 新注释不引用文档路径、章节号与需求编号 | 检索 `openspec/`、`design.md`、`FR-`、`D1x`、`§` 零命中 |
| 界面文案不含疗效承诺与绝对化用语 | 检索零命中；免责声明由既有用例持续覆盖 |

---

## 遗留项

| 项 | 原因 | 归属 |
| --- | --- | --- |
| 真机飞行模式下的录入 | 需要实际设备 | 上线前手动验收 |
| 语音记录与录音失败兜底 | 本 change 只做手动记录 | v0.2 |
| 指标看板（填充率、周记录达标率） | 本 change 只备好纯函数与埋点 | 只读概况 change |
