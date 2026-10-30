## Why

PRD 更新到 v0.5，数据模型与已交付的数据地基不再一致：v0.5 把业务表从 9 张砍到 6 张，运动模块只保留 `workout_log` 一张表，运动项目作为记录的嵌套数组存放（§10.1）。现存实现仍按旧模型定义 `exercise` / `workout` / `workout_exercise` / `set_entry` 四张表、动作模式与计量方式两个枚举，以及以它们为前提的 Repository、导出清单与测试夹具。

环境里没有任何写入过这四张表的代码路径（现存命令只有 `app_meta/mark_exported`、`app_meta/grant_consent`、`data/import`、`data/clear_all`），因此改名与删表不会迁移任何业务数据。越早对齐，后续功能实现就越不必在错误的数据形状上返工。

本 change 只修数据层与 PRD 的偏差，不实现任何业务功能。

## What Changes

对应 PRD v0.5 的 §10.1、§10.2、§10.5 与 FR-S01 / FR-S02 / FR-S07，纯前端，不碰 `backend/`。

- **业务表 9 → 6**：删 `exercise`、`workout`、`workout_exercise`、`set_entry`；新增 `workout_log`；保留 `body_metric`、`meal`、`meal_item`、`target`、`app_meta`。非业务 store 仍为 `pending_ops`、`blob`、`analytics_event`，store 总数 12 → 9。
- **`workout_log` 的记录形状**：`logged_at`（UTC，精确到秒）、`tz_offset_minutes`、`input_source`（`manual` / `voice`）与嵌套的 `items`。`items` 元素为 `{ name, sets, reps, weight_kg, note }`，顺序即数组下标；元素无主键、不被引用，因此作为值内嵌而不独立成表。
- **字段规格**：新增「项目卡片数组」规格——数组非空、每项只接受上述五个键、`name` 必填且不超过 40 字、`sets` / `reps` 为正整数或 `null`、`weight_kg` 落在 0.5 网格且不小于 0 或 `null`、`note` 不超过 200 字或 `null`。三项指标同时为 `null` 是合法状态。
- **枚举收敛**：删 `EXERCISE_PATTERNS`、`METRIC_TYPES`、`WORKOUT_STATUSES`；保留 `INPUT_SOURCES`、`CONFIDENCE_LEVELS`、`MEAL_ITEM_SOURCES`。
- **存储结构**：`workout_log` 建 `user_id` 与 `logged_at` 两个单字段索引；`schema_version` 保持 1。
- **导出清单**：业务表从 9 张改为 6 张，导出表总数 10 → 7。
- **代码同步**：Repository 集合、只读视图、测试夹具、往返一致性用例、架构自检随之收敛到 6 张表；首页读取改为 `workout_log`；底部导航的「训练」改称 PRD 所用的「运动」。
- **文件头注释去掉文档引用**：现存注释里有对设计章节号、需求编号与 `openspec/` 路径的引用，与仓库的注释规则冲突，一并改成直接陈述规则。

## Capabilities

### Modified Capabilities

- `local-data-store`：业务表清单从 9 张改为 6 张；`workout_log` 取代四张运动相关表，运动项目改为嵌套值；动作模式枚举消失；10.5 的软删除例外新增「超期记录的启动清理」一项（本 change 只登记规则，清理逻辑随运动记录功能实现）。
- `data-portability`：导出与导入的表清单从 10 张收敛到 7 张；往返一致性的覆盖表同步。

### New Capabilities

无。运动记录、体重、目标等功能的界面与命令不属于本 change。

## 不包含（含归属）

| 项 | 归属 |
|---|---|
| 手动记录页、项目卡片表单、30 天列表、「查看更早」 | 运动记录功能 change |
| 语音记录全链路（FR-T02 / T03 / T04） | v0.2 |
| 记录编辑与删除（FR-T07） | 运动记录功能 change |
| 180 天保留期的启动清理 | 运动记录功能 change |
| 体重记录页、周均趋势（FR-W01 / W02 / W04） | 体重功能 change |
| 目标设置（FR-S04） | 目标功能 change |
| 饮食（FR-D01~D06）、建议（FR-R01 / R02） | v0.3、v0.4 |

## 与 PRD 原文的差异（留痕）

| 项 | PRD 原文 | 本 change 的处理 | 依据 |
|---|---|---|---|
| `app_meta.schema_version` | §10.1 把 `schema_version` 列为 `app_meta` 的字段 | 不写入 `app_meta`，结构版本仍只由数据库自身的 `version` 承载，导出文件在信封顶层携带 | 两处各存一份就会出现不一致：导入时按信封决定迁移、再把记录原样写回，落库的那一份随即变成旧值。字段语义由信封承载，导入路径的判断依据也因此唯一 |
| 数据保留期的物理删除 | §10.5 约束 5 只允许「清空全部数据」物理删除，§10.2 又要求启动时清理超期记录 | 在约束 5 的例外清单中登记「超期记录清理」，明确 30 天展示窗口与 180 天保留期是两个参数 | 两条规则直接冲突，必须显式取一条，否则实现时只能二选一而没有依据 |
| 分模块保留期 | §14.2 OP-05 未定是否把 180 天统一到三模块 | 仅 `workout_log` 适用，`body_metric` / `meal` 暂不清理 | PRD 本版只对运动记录生效，提前统一会删掉体重趋势与饮食汇总看不到但用户可能还需要的数据 |
