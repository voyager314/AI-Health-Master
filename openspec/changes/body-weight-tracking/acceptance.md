# 出口验收记录

本文件记录这个 change 的出口标准逐项结论。三条硬性一票否决的约束若有一条不通过，
整个 change 不算完成；因此结论必须逐条写明依据，不能只写「已通过」。

检查日期：2026-10-31
检查方式：自动化测试（`npm run check`）+ 源码扫描（`src/test/constraints.test.ts`、
`src/test/architecture.test.ts`）+ 手工源码检索

---

## 出口标准一：`npm run check` 全绿

**结论：通过。**

| 项 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 error 0 warning |
| `npm run test` | 35 个文件、521 个测试全部通过 |
| `npm run build` | 通过，service worker 与 manifest 已产出 |
| `openspec validate body-weight-tracking --strict` | `Change 'body-weight-tracking' is valid` |

---

## 出口标准二：断网可记录体重

**结论：通过（Node 环境内的等价验证）。**

依据：

- `src/features/weight/weight.test.tsx` 的「断网时照常记录」用例把 `navigator.onLine`
  置为 false 后完整走了一遍预填 → 调值 → 保存 → 落库，记录成功写入。
- 同文件的「断网时可以修改与删除」用例覆盖了编辑页的两种写操作。
- 体重模块不发起任何网络请求：它只经 `@/storage` 读、经 `@/commands` 写，两者都是
  本地 IndexedDB。语音与图片这类需要联网的入口本 change 没有接入。

**遗留项**：真机飞行模式下的手工点按未执行，Node 环境的断言替代不了真机行为。

---

## 出口标准三：导出 → 清空 → 导入后数据完全一致

**结论：通过。**

`src/features/data/roundTrip.test.ts` 新增的「体重记录往返后逐字段一致，网格值不被改写」
用例：写一条 `weight_kg` 为 72.6、带备注、西半球偏移的体重记录，导出 JSON、清空全库、
再导入，断言取回的记录与原记录逐字段相等，且体重仍在 0.1 kg 网格上。

---

## 出口标准四：约束 1 / 3 / 9 自检

**约束 1（存储访问收敛到 Repository）**

- `constraints.test.ts` 的「只有数据库实现目录可以直接使用 IndexedDB API」与
  「业务页面不导入数据库实现」通过。
- 手工抽查 `features/weight/` 三个文件（体重页、编辑页、趋势图）：没有 `indexedDB`、
  `IDBKeyRange`、`storage/indexeddb` 的引用。
- 体重页的两种读取都经 `bodyMetricRepo`：`query`（`measured_at` 区间）与 `list`
  （窗口为空时的兜底）。两者都能写成一条 `SELECT ... WHERE`。

**约束 3（`user_id` 由存储层注入）**

- `constraints.test.ts` 的「用户标识字面量只出现在存储实现里」与「业务代码不给
  `user_id` 赋值」通过。
- 手工扫描 `features/weight/`、`commands/bodyMetric.ts`、`commands/records.ts`、
  `domain/bodyMetric.ts`、`domain/dayGroups.ts`：`'local'` 与 `user_id` 赋值零命中。

**约束 9（写操作单一入口）**

- `constraints.test.ts` 的「含写方法的内部入口只被命令层导入」与「页面与组件不直接
  调用写方法」通过。
- `commands/bodyMetric.test.ts` 断言三条命令执行后 `pending_ops` 各新增一条；载荷
  不合法时不产生任何日志。
- 页面只调用 `applyCommand`：`body_metric/record`、`body_metric/update`、
  `body_metric/remove`。

---

## 出口标准五：约束 6 / 8 / 12 自检

**约束 6（日界与周界算术只在 `timeWindow`）**

- `constraints.test.ts` 与 `architecture.test.ts` 的两处算术扫描通过。
- 本 change 在 `timeWindow` 内新增 `recentWeekInterval`、`recentWeekKeys`、
  `daysBetween`，界面与领域层都没有日期加减。趋势图的横坐标由 `daysBetween`
  算出的天数换算，图表本身不碰日期。

**约束 8（单字段索引取数 + 内存过滤）**

- 体重页的窗口读取一次 `measured_at` 区间取数，之后在内存里按记录自身的周标识过滤；
  预填兜底读 `user_id` 全量后在内存里取最新一条。
- 按日分组、当日取值、周均都在内存中完成。

**约束 12（领域计算为纯函数）**

- `domain/bodyMetric.ts` 与 `domain/dayGroups.ts` 的测试不初始化数据库；
  `architecture.test.ts` 的分层断言覆盖这两个文件。
- `features/weight/chartGeometry.ts` 同样是纯函数，13 条用例覆盖纵轴范围、折线断口、
  横坐标换算。

---

## 埋点隐私核查（weight_add）

**结论：通过。**

| 属性 | 取值 | 是否含身体数据 |
| --- | --- | --- |
| `prefill` | `none` / `kept` / `changed` | 否。只说明预填值有没有被改，不含量值，也不含差值 |
| `unit` | `kg` / `jin` | 否。只说明当时的显示单位 |

- `telemetry/telemetry.test.ts` 的「属性清单」断言 `weight_add` 只带这两个键。
- 同文件的「属性里没有体重数值与差值」显式断言键集合。
- 修改与删除不产生该事件，用例「修改与删除不产生事件」覆盖。
- 埋点失败不影响记录：`features/weight/telemetryFailure.test.tsx` 把整个埋点模块
  换成直接拒绝，记录照常保存且界面没有错误提示。

---

## 与规划文档的差异

| 项 | 计划 | 实际 | 依据 |
| --- | --- | --- | --- |
| 体重页的「上一条」说明 | 计划中的步进组件只管数值 | 说明放在页面层，内容是最近一条记录的日期时刻与数值 | 记录成功后它就是保存的反馈：图表与明细可能都在屏幕下方 |
| 失败提示的复用 | 计划把提示提成共享组件，含文案映射 | 组件与文案映射分成两个文件 | 组件文件只导出组件，改文案不会重建整棵组件树（`react-refresh` 规则） |
| 按日分组的字段名 | 计划改名为 `records` | 保留 `logs` | 通用化的意义在于规则共用，不在字段改名；保留原名让运动模块的 20 条断言一行不动 |
| 图表横轴的输入 | 计划传入窗口内的全部日期 | 传入「日期 → 第几天」的换算结果 | 日期换算归 `stats`，几何模块只认序号，约束 6 的边界因此更干净 |

---

## 遗留项

1. **真机飞行模式**：未手工验证，Node 环境的断言替代不了。
2. **图表在真机上的观感**：高度、刻度密度与小屏上的散点可辨程度，发布前需要在
   中端安卓上看一次。
3. **`tsconfig.app.json` 与 `vite.config.ts` 的改动**：工作区里原有的两处改动，与
   本 change 无关，未纳入任何提交。
