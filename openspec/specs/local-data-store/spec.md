## Purpose

定义 AI Health Master 全部业务数据在用户设备上的持久化契约：实体结构、记录标识与审计字段、时间表示、软删除语义、schema 版本与迁移、图片二进制的存放方式，以及写入失败时的行为。本能力是「本地优先」架构的地基，也是将来替换为服务端数据库时唯一需要改动的层。

## Requirements

### Requirement: FR-S01 业务数据本地持久化

业务数据必须（SHALL）存于用户设备的本地数据库（IndexedDB），禁止上传服务端。数据必须在页面刷新、浏览器重启、应用从主屏冷启动后依然存在。

本能力覆盖 12 个 store，分两类：

**9 张业务表**（`user_id` / `version` / 审计字段契约适用于这 9 张）：
`exercise`、`workout`、`workout_exercise`、`set_entry`、`body_metric`、`meal`、`meal_item`、`target`、`app_meta`

**3 个非业务 store**（不适用业务表字段契约）：
`pending_ops`（写入日志）、`blob`（图片二进制）、`analytics_event`（本地埋点）

12 个 store 的结构由存储层统一定义；表中业务数据的写入由使用它们的各项功能分别实现。

#### Scenario: 数据跨会话存活
- **GIVEN** 用户已在本地产生业务记录
- **WHEN** 用户刷新页面或完全关闭浏览器后重新打开应用
- **THEN** 该记录仍可读出，内容与写入时完全一致

#### Scenario: 业务数据不出设备
- **GIVEN** 应用处于任意业务操作过程中
- **WHEN** 检查应用发出的全部网络请求
- **THEN** 请求中不含任何业务记录内容

#### Scenario: 动作模式枚举
- **GIVEN** `exercise` 表的 `pattern` 字段
- **WHEN** 校验其取值范围
- **THEN** 合法值恰为 9 类：水平推、垂直推、水平拉、垂直拉、蹲、髋铰链、单腿、核心、孤立
- **AND** 「负重行走」不是合法值

### Requirement: FR-S01.1 记录标识与审计字段契约

9 张业务表的每条记录必须（SHALL）含下列字段，缺任一字段即视为不符合本需求：

| 字段 | 规则 |
| --- | --- |
| `id` | UUID v7，时间有序。禁止自增 ID，禁止退化为 UUID v4 |
| `client_id` | 客户端生成的幂等键，可与 `id` 同值 |
| `user_id` | 本期固定为字符串 `'local'`，且必须建索引 |
| `version` | 整数，本期恒为 `1` |
| `created_at` / `updated_at` | 写入与每次更新时刷新 |
| `deleted_at` | 未删除时为空 |

#### Scenario: 主键为时间有序 UUID
- **GIVEN** 连续创建的两条业务记录 A 与 B（A 先于 B）
- **WHEN** 比较两者的 `id` 字符串
- **THEN** A 的 `id` 字典序小于 B 的 `id`
- **AND** `id` 符合 UUID v7 的版本位

#### Scenario: 审计字段齐备
- **GIVEN** 任意一张业务表
- **WHEN** 检查其记录结构与索引
- **THEN** 上表 7 个字段全部存在，且 `user_id` 有索引

#### Scenario: 更新刷新时间戳
- **GIVEN** 一条 `created_at` 与 `updated_at` 相同的记录
- **WHEN** 该记录被更新
- **THEN** `updated_at` 变为更新时刻，`created_at` 保持不变

### Requirement: FR-S01.2 时间表示统一为 UTC

所有时间字段必须（SHALL）存为 UTC ISO 8601 字符串；用户当时的时区偏移必须另存于独立字段 `tz_offset_minutes`。禁止存储带时区偏移的时间字符串，禁止存储本地时间字符串，禁止存储时间戳数字。

#### Scenario: 时间字段格式
- **GIVEN** 任意一条带时间字段的记录
- **WHEN** 读出其时间字段
- **THEN** 取值为以 `Z` 结尾的 UTC ISO 8601 字符串
- **AND** 同一记录上存在独立的 `tz_offset_minutes` 整数字段

#### Scenario: 跨时区写入保留原时区
- **GIVEN** 设备时区为 UTC+8
- **WHEN** 写入一条记录
- **THEN** 时间字段为 UTC 表示
- **AND** `tz_offset_minutes` 为 `480`

### Requirement: FR-S01.3 软删除

删除业务记录必须（SHALL）写 `deleted_at` 而非物理移除。已软删除的记录在所有常规查询与导出中必须被排除，但在数据库中必须依然存在。唯一允许物理删除的情形是「清空全部数据」（见 `data-portability`）与图片 blob 的清理（见 FR-S01.5）。

#### Scenario: 删除后记录仍在库中
- **GIVEN** 一条已存在的业务记录
- **WHEN** 用户删除它
- **THEN** 该记录的 `deleted_at` 被写入删除时刻
- **AND** 数据库中仍能按主键取到这条记录

#### Scenario: 已删除记录不出现在查询与导出中
- **GIVEN** 一条已软删除的记录
- **WHEN** 列出该表记录或导出全量数据
- **THEN** 结果中不含这条记录

### Requirement: FR-S01.4 schema 版本与顺序迁移

本地数据库必须（SHALL）记录 `schema_version`。应用启动时必须按版本顺序执行迁移脚本，每个版本对应且仅对应一条迁移。执行任何迁移之前，必须先自动导出一份当前数据的备份文件。迁移失败时禁止让数据库停留在中间状态。

#### Scenario: 迁移前自动备份
- **GIVEN** 本地 `schema_version` 低于应用期望版本
- **WHEN** 应用启动
- **THEN** 先产生一份当前数据的备份文件，再执行迁移

#### Scenario: 按版本顺序迁移
- **GIVEN** 本地 `schema_version` 为 1，应用期望版本为 3
- **WHEN** 应用启动
- **THEN** 依次执行 1→2 与 2→3 两条迁移，顺序不可颠倒
- **AND** 完成后 `schema_version` 为 3

#### Scenario: 迁移失败不留中间状态
- **GIVEN** 一条迁移脚本在执行中抛错
- **WHEN** 迁移中断
- **THEN** 数据库回到迁移前的版本与内容
- **AND** 向用户说明失败原因并指出备份文件位置

#### Scenario: 版本相同时不迁移
- **GIVEN** 本地 `schema_version` 等于应用期望版本
- **WHEN** 应用启动
- **THEN** 不执行迁移，不产生备份文件

### Requirement: FR-S01.5 图片二进制独立存放

图片必须（SHALL）以二进制形式存于独立的 `blob` store；业务记录中只允许存字符串引用 `storage_ref`，本地格式为 `local://<uuid>`。禁止把图片以 base64 或二进制形式嵌入业务记录。

引用的目标 blob 可能已不存在（被清理策略移除，或从不含 blob 的备份导入）。解析一个 `storage_ref` 必须返回三态之一：命中、**已清理**、格式非法。禁止因 blob 缺失而抛错或让调用方得到空值歧义。

#### Scenario: 业务记录只存引用
- **GIVEN** 一条关联图片的业务记录
- **WHEN** 检查该记录的字段
- **THEN** 图片字段为 `local://<uuid>` 形式的字符串
- **AND** 记录中不含任何 base64 字符串或二进制字段

#### Scenario: 引用的 blob 已不存在
- **GIVEN** 一条业务记录的 `storage_ref` 指向一个已不在 `blob` store 中的 uuid
- **WHEN** 解析该引用
- **THEN** 返回「已清理」状态
- **AND** 业务记录本身保持完好、可正常读写

#### Scenario: 引用格式非法
- **GIVEN** 一个不符合 `local://<uuid>` 格式的 `storage_ref`
- **WHEN** 解析该引用
- **THEN** 返回「格式非法」状态，与「已清理」可区分

### Requirement: FR-S01.6 写入失败必须可感知

本地存储写入失败（最常见为存储配额已满）时，必须（SHALL）向用户明确提示失败原因与可操作的下一步（先导出数据、再清理历史图片），并提供重试入口。禁止静默丢弃用户数据，禁止在界面上表现为「已保存」。

#### Scenario: 配额满时提示而非静默失败
- **GIVEN** 本地存储配额已满
- **WHEN** 用户的一次写操作被拒绝
- **THEN** 界面提示写入失败与原因
- **AND** 给出「导出数据」与「重试」两个入口
- **AND** 该操作不被标记为已保存

#### Scenario: 失败后数据不残缺
- **GIVEN** 一次涉及多条记录的写操作中途失败
- **WHEN** 失败发生
- **THEN** 这批记录要么全部写入、要么全部未写入
