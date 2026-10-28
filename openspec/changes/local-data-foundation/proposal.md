## Why

PRD v0.3 选定「本地数据 + 后端 AI 网关」架构，用 IndexedDB 快速起步验证核心闭环，但明确要求将来能换 MySQL 上云。为此 PRD §10.5 立了 12 条可迁移性硬约束，其中约束 1（存储访问收敛到 Repository）、3（每条记录现在就带 `user_id`）、9（写操作走统一 Command 层）属「一旦违反就必须重写」——PRD 自己把它们列为 RK-09「演进断裂」风险，并规定为 v0.1 出口的一票否决项。

这些约束只有在**任何业务功能落地之前**先立起来才有意义。一旦动作库、训练记录、体重趋势先接上页面，再回头抽 Repository 与 Command 层就不是补骨架而是返工。同时 RK-02「本地数据丢失导致用户流失」是另一条 20 分高危风险，它的唯一兜底是导出与导入——而导出导入本身就是将来上云的存量迁移载体（PRD §5.4 第 5 步）。

所以本 change 的定位是**地基与闸门**：不交付任何用户可见的业务功能，但为后续每一个 change 立下不可绕过的分层边界与数据契约。

## What Changes

本 change 覆盖 PRD **v0.1 的上半部分**，对应 FR-S01、FR-S02、FR-S03、FR-S05、FR-S06，以及新增的 FR-S07。纯前端，完全不碰 `backend/`（AI 网关最早 v0.2 才需要）。

- **本地数据库落地**（FR-S01）：IndexedDB 建 9 张业务表与 3 个非业务 store；主键 UUID v7；每条业务记录带 `user_id` / `version` / `client_id` / `created_at` / `updated_at` / `deleted_at`；时间统一 UTC ISO 8601 + 独立 `tz_offset_minutes`；软删除；`schema_version` + 顺序迁移脚本，迁移前自动导出备份；写入失败（配额满）给出可操作提示而非静默丢数据。
- **存储访问抽象**（FR-S06）：每实体一个 Repository；所有写操作收敛到 `applyCommand(type, payload)` 并记入 `pending_ops`；页面与组件禁止出现任何 IndexedDB API 调用；领域计算约束为不读存储的纯函数，自然日/自然周边界计算全局仅 `stats/timeWindow` 一处实现。
- **数据导出与清空**（FR-S02）：全量 JSON 导出（结构 = 内部结构，带 `schema_version`，即迁移载体）；CSV 导出供用户查看；「清空全部数据」二次确认。
- **数据导入与恢复**（FR-S07，**新增需求**）：从导出的 JSON 恢复全部数据，支持「导出 → 清空 → 导入」往返后数据完全一致。
- **离线应用外壳**（FR-S03）：PWA manifest + service worker，可添加到主屏，断网可打开；路由骨架与空页面占位，首页内容由下一个 change 填充。
- **告知与同意**（FR-S05）：首次使用展示数据处理说明，主动确认后方可进入主功能，同意时间落 `app_meta.consent_at`；未成年人提示；免责声明常驻。
- **本地埋点机制**（PRD §10.3）：`analytics_event` store 与记录接口，带「只记结构化属性与区间值」的隐私约束；本 change 内先接 `app_open` / `export` / `clear_data` 三个事件，其余事件随对应功能落地。
- **工程地基**：引入路由、PWA 插件、vitest（PRD 约束 12 要求领域计算「可单测」，但 `frontend/` 当前没有测试框架）、UUID v7 实现、目录分层与 lint 约束。

### 与 PRD 原文的出入（留痕）

| 项 | PRD 原文 | 本 change 的处理 | 依据 |
|---|---|---|---|
| **新增 FR-S07 数据导入** | FR-S02 只定义了「导出」与「清空」，全文无导入需求 | 补为独立需求 | PRD §13.2 的 v0.1 出口标准写「导出→清空→**导入**后数据完全一致」，§10.2 与约束 11 同样要求导入闭环。出口标准依赖一个不存在的需求，无法验收 |
| **数据模型补 3 个 store** | §10.1 只列 9 张业务表 | 明确补 `pending_ops` / `blob` / `analytics_event`，并把约束 3「9 张表都要有 `user_id`」的口径限定为「9 张**业务**表」 | §10.2 要求 `pending_ops`、约束 7 要求独立 blob store、§10.3 要求埋点落地，三者都不在 §10.1 的清单里 |
| **UUID v7 需引入依赖** | 约束 2 只写「主键为 UUID v7」 | 引入 v7 实现库，不退化为 v4 | 浏览器原生 `crypto.randomUUID()` 返回的是 v4，无法满足约束 2「时间有序、索引友好」的本意 |
| **CSV 不要求可往返** | FR-S02 要求导出 JSON 与 CSV；约束 11 要求「导出即迁移载体，可反向导入」 | JSON 为迁移载体（必须可往返导入）；CSV 定为**只出不进** | 9 张表含 workout→workout_exercise→set_entry、meal→meal_item 的嵌套关系，CSV 表达嵌套必然有损。若要求 CSV 可往返，会迫使导出结构偏离内部结构，反而违反约束 11 |
| **动作模式保留 9 类** | §三「本期只保留前 8 类」，即砍掉「负重行走、孤立」 | 保留「孤立」，只砍「负重行走」 | FR-T04 的验收例子「飞鸟20公斤12个3组」用的正是孤立动作，与 §三 自相矛盾；且增肌主用户群离不开弯举/侧平举/飞鸟/臂屈伸。本 change 只定义 `exercise.pattern` 枚举值，动作库数据由下一个 change 填充 |
| **FR-T07/T08 归 v0.2** | §7.6 标为 v0.1，§13.2 与 §15.3 标为 v0.2 | 以 **v0.2** 为准 | 2:1 分歧，且「上次对比」最自然的展示位在语音确认页与动作卡片内，与 v0.2 一起做返工最少。不影响本 change，但据此界定了下一个 change 的范围 |

## Capabilities

### New Capabilities
- `local-data-store`: IndexedDB 本地数据库——实体 schema 与审计字段契约、UUID v7 主键、软删除、`schema_version` 与顺序迁移、写入失败处理
- `storage-access-layer`: 分层边界——Repository 层、Command 层与 `pending_ops`、纯函数领域计算、唯一的时间窗口模块；本 change 的一票否决闸门
- `data-portability`: 数据导出（JSON 迁移载体 + CSV 只出不进）、导入恢复、清空全部数据、往返一致性
- `offline-app-shell`: PWA 外壳——manifest、service worker、添加到主屏、断网可打开、路由骨架与加载态
- `consent-and-disclosure`: 首次使用的告知同意门禁、`consent_at` 落库、未成年人提示、免责声明常驻
- `local-telemetry`: 本地埋点机制——`analytics_event` store、记录接口、隐私约束（只记结构化属性与区间值）

### Modified Capabilities

无。`openspec/specs/` 当前为空，这是本项目的第一个 change。

## Impact

**代码范围**：只动 `frontend/`。`backend/`（uv + Python 3.13 空包）本 change 不触碰。

| 区域 | 影响 |
|---|---|
| `frontend/src/storage/indexeddb/**` | 新增。唯一允许出现 `indexedDB` 与 `db.` 调用的目录（约束 1 的自检靶点） |
| `frontend/src/storage/repositories/**` | 新增。每实体一个 repo，接口统一为 `list/get/put/remove/query/clear` |
| `frontend/src/commands/**` | 新增。`applyCommand(type, payload)` 单一写入口 |
| `frontend/src/stats/timeWindow.ts` | 新增。自然日/自然周边界计算的**唯一**实现处（约束 6） |
| `frontend/src/domain/**` | 新增。领域纯函数，零存储依赖（约束 12） |
| `frontend/src/features/data/**` | 新增。导出/导入/清空的界面与流程 |
| `frontend/src/app/**` | 新增。路由骨架、同意门禁、免责声明 |
| `frontend/src/App.tsx`、`main.tsx`、`index.css`、`App.css` | 改写。当前是 Vite 模板页 |
| `frontend/src/assets/`、`frontend/public/` | 清理模板资产（`react.svg`、`vite.svg`、`hero.png`），补 PWA 图标 |
| `frontend/package.json`、`vite.config.ts`、`eslint.config.js` | 改。新增依赖与 PWA 插件、vitest 配置、分层 lint 规则 |
| `openspec/config.yaml` | 已更新：技术栈与 12 条约束写入 `context`，供后续每个 change 继承 |

**新增依赖**（均为小体积、生态内选择）：PWA 插件、路由、IndexedDB 薄封装、UUID v7 实现、vitest 与 IndexedDB 测试替身。图表库不在本 change 引入——它只在下一个 change 的体重趋势图才需要。

**对后续 change 的影响**：本 change 立下的分层边界对 `training-log-and-weight`（v0.1 下半）及之后每个 change 都是强制约束——新增实体必须先写 repo 与 command 再接页面。

**风险对应**：直接应对 PRD 风险登记册的 RK-09（演进断裂，12 中）与 RK-02（本地数据丢失，20 高）。

**不包含**（含归属）：

| 项 | 归属 |
|---|---|
| 动作库、训练模板、手动记录组次重量、训练中/历史编辑（FR-T01/T02/T03/T09） | change `training-log-and-weight`（v0.1 下半） |
| 体重快速记录、周均趋势图、目标设置（FR-W01/W02、FR-S04） | change `training-log-and-weight`（v0.1 下半） |
| 语音记录全链路、上次对比、容量统计、组间计时（FR-T04/T05/T06/T07/T08/T10） | v0.2 |
| 饮食拍照与营养估算（FR-D01~D06） | v0.3 |
| 每周复盘建议、蛋白缺口提示、指标看板（FR-R01/R02、§10.4 看板） | v0.4。v0.1 的指标从导出的 JSON 离线算，不做独立看板页 |
| 后端 AI 网关（密钥托管、ASR/LLM 代理、限流） | v0.2 |
| 云同步与账号体系 | 触发条件见 PRD §5.3，本期不做 |
