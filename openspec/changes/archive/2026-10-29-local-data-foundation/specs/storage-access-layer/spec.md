## Purpose

定义应用的分层边界与跨层禁令，使业务逻辑与具体存储实现解耦：页面只调用 Command、写操作单一入口、每实体一个 Repository、领域计算为不读存储的纯函数、时间窗口计算全局唯一实现。本能力是后续每个 change 的准入闸门——将来从 IndexedDB 换到服务端数据库时，只替换存储实现而不重写业务逻辑，全部依赖于此。

## ADDED Requirements

### Requirement: FR-S06.1 存储访问收敛到 Repository 层

页面与组件禁止直接调用本地数据库 API。数据库 API 的调用必须（SHALL）全部收敛在存储实现目录内；该目录之外的任何文件禁止出现本地数据库的 API 调用或数据库实例引用。

此需求为本 change 的硬性一票否决项（对应 PRD §10.5 约束 1）：不通过则本 change 不算完成。

#### Scenario: 业务页面不含数据库调用
- **GIVEN** 应用中任取 3 个业务页面文件
- **WHEN** 检查其源码与依赖
- **THEN** 不含任何本地数据库 API 调用
- **AND** 不含任何数据库实例引用

#### Scenario: 数据库调用只出现在存储实现目录
- **GIVEN** 全仓库搜索本地数据库 API 的使用
- **WHEN** 列出所有命中位置
- **THEN** 命中文件全部位于存储实现目录内

#### Scenario: 违反时构建失败
- **GIVEN** 存储实现目录之外的某个文件引入了数据库 API
- **WHEN** 运行代码检查
- **THEN** 检查失败并指出违规文件与行号

### Requirement: FR-S06.2 Repository 统一接口与可翻译查询

每个业务实体必须（SHALL）有且仅有一个 Repository，对外暴露统一接口：`list`、`get`、`put`、`remove`、`query`、`clear`。`remove` 必须执行软删除（写 `deleted_at`），禁止物理删除。

查询必须只使用「按主键或单字段索引取数 + 内存过滤」的方式。禁止依赖复合游标或多字段联合游标承载业务逻辑——每个 Repository 的查询都必须能等价表达为一条单表 `SELECT ... WHERE` 语句。

#### Scenario: 每实体一个 Repository 且接口一致
- **GIVEN** 9 张业务表
- **WHEN** 检查其 Repository
- **THEN** 每张表恰有一个 Repository
- **AND** 每个 Repository 暴露上述 6 个方法，签名形状一致

#### Scenario: remove 是软删除
- **GIVEN** 任意 Repository 的 `remove` 方法
- **WHEN** 对一条记录调用它
- **THEN** 该记录的 `deleted_at` 被写入
- **AND** 记录未被物理移除

#### Scenario: 查询可翻译为单表 SQL
- **GIVEN** 任意 Repository 的任意查询方法
- **WHEN** 审查其取数方式
- **THEN** 取数只用主键或单字段索引，其余筛选在内存中完成
- **AND** 不使用复合游标

### Requirement: FR-S06.3 写操作单一入口

全部写操作必须（SHALL）经统一的 Command 层入口 `applyCommand(type, payload)`。该入口本地同步执行，并把这次写操作记入 `pending_ops`。页面与组件禁止直接调用 Repository 的写方法（`put` / `remove` / `clear`），只允许调用 Command。页面读取数据可直接经 Repository。

此需求为本 change 的硬性一票否决项（对应 PRD §10.5 约束 9）：不通过则本 change 不算完成。

#### Scenario: 页面只调用 Command 写入
- **GIVEN** 任意业务页面或组件
- **WHEN** 检查其发起的写操作
- **THEN** 只出现 Command 调用
- **AND** 不出现 Repository 的 `put` / `remove` / `clear` 调用

#### Scenario: 每次写入都记入 pending_ops
- **GIVEN** 一次成功的 Command 执行
- **WHEN** 检查 `pending_ops`
- **THEN** 新增一条含命令类型、载荷与时刻的记录

#### Scenario: 未知命令类型被拒绝
- **GIVEN** 一个未注册的命令类型
- **WHEN** 调用 `applyCommand`
- **THEN** 调用失败并说明命令类型未知
- **AND** 数据库未发生任何变更，`pending_ops` 未新增记录

#### Scenario: 写入失败不留日志
- **GIVEN** 一次 Command 执行因存储写入失败而中止
- **WHEN** 失败发生
- **THEN** 业务数据未变更
- **AND** `pending_ops` 中不留下这条已失败的命令

### Requirement: FR-S06.4 领域计算为纯函数

领域计算（训练容量、周均体重、蛋白达成率等）必须（SHALL）实现为纯函数：入参为实体数组，返回计算结果，不读取存储、不触发副作用、不依赖当前时间之外的隐式输入。所有领域计算必须可在不启动数据库的情况下单元测试。

#### Scenario: 领域计算零存储依赖
- **GIVEN** 领域计算模块
- **WHEN** 检查其导入
- **THEN** 不导入任何 Repository、Command 或存储实现

#### Scenario: 领域计算可脱离数据库单测
- **GIVEN** 一个领域计算函数
- **WHEN** 在不初始化本地数据库的测试中传入实体数组调用它
- **THEN** 返回确定结果，测试通过

#### Scenario: 相同输入恒得相同输出
- **GIVEN** 同一个实体数组
- **WHEN** 多次调用同一领域计算函数
- **THEN** 每次返回完全相同的结果

### Requirement: FR-S06.5 时间窗口计算全局唯一实现

「自然日」与「自然周」的边界计算必须（SHALL）只在一个时间窗口模块内实现，全仓库仅此一处。其余任何位置禁止自行推算日界或周界。自然周定义为周一至周日，归属按记录时刻的设备本地时区判定。

#### Scenario: 周边界计算只有一处实现
- **GIVEN** 全仓库搜索自然日与自然周的边界计算
- **WHEN** 列出所有实现位置
- **THEN** 只有时间窗口模块一处

#### Scenario: 自然周为周一至周日
- **GIVEN** 一个落在周日的时刻
- **WHEN** 求它所属的自然周
- **THEN** 该周的起点为其前一个周一的本地零点，终点为该周日的本地日终

#### Scenario: 归属按记录时刻的本地时区
- **GIVEN** 一条记录的时间字段为 UTC、`tz_offset_minutes` 为 480
- **WHEN** 判定其所属自然日
- **THEN** 按 UTC+8 的本地日界判定，而非按设备当前时区或 UTC 判定

### Requirement: FR-S06.6 新增实体的准入顺序

新增任何业务实体时，必须（SHALL）先实现其 Repository 与对应 Command，再接入页面。禁止先把页面接到存储实现上、事后再补抽象层。

#### Scenario: 实体缺少抽象层即不合规
- **GIVEN** 一个新增实体已被页面使用
- **WHEN** 检查该实体是否有 Repository 与 Command
- **THEN** 两者都存在；若缺任一，则该实体视为不符合本需求

### Requirement: FR-S06.7 user_id 由存储层统一注入

写入业务记录时，`user_id` 必须（SHALL）由存储层统一注入为 `'local'`，禁止由页面、组件或业务逻辑传入或拼接。将来上云时只替换注入来源为真实用户 ID，业务代码与表结构不变。

此需求为本 change 的硬性一票否决项（对应 PRD §10.5 约束 3）：不通过则本 change 不算完成。

#### Scenario: 业务代码不出现 user_id 字面量
- **GIVEN** 存储实现目录之外的全部源码
- **WHEN** 搜索 `user_id` 的赋值与 `'local'` 字面量
- **THEN** 不出现任何命中

#### Scenario: 写入的记录自动带 user_id
- **GIVEN** 一条未显式携带 `user_id` 的写入载荷
- **WHEN** 经 Command 写入
- **THEN** 落库记录的 `user_id` 为 `'local'`
