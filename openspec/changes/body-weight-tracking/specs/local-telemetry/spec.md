## ADDED Requirements

### Requirement: 体重记录的埋点事件

一条体重记录保存成功后，体重模块必须（SHALL）记录一条 `weight_add` 事件。修改与删除不产生该事件。

| 属性 | 取值 | 含义 |
| --- | --- | --- |
| `prefill` | `none` / `kept` / `changed` | 保存时有没有预填值，以及保存值是否等于预填值。`none` 表示此前没有任何记录可供预填 |
| `unit` | `kg` / `jin` | 保存时的显示单位 |

「是否修改预填值」以保存值是否等于预填值为准，不看中途按过几次加减：加一次再减一次后保存，仍算未改。

属性禁止（MUST NOT）含体重数值、与预填值的差值，或任何能反推出体重的量。埋点失败不得影响记录：记录写入与否只由业务结果决定。

#### Scenario: 未改预填值直接记录
- **GIVEN** 记录入口预填 72.4 kg
- **WHEN** 用户直接点「记录」
- **THEN** 产生一条 `weight_add` 事件，`prefill` 为 `kept`，`unit` 为 `kg`

#### Scenario: 改了预填值后记录
- **GIVEN** 记录入口预填 72.4 kg
- **WHEN** 用户改为 72.6 后记录
- **THEN** `weight_add` 的 `prefill` 为 `changed`

#### Scenario: 首次记录没有预填值
- **GIVEN** 本地没有任何体重记录
- **WHEN** 用户输入 70 后记录
- **THEN** `weight_add` 的 `prefill` 为 `none`

#### Scenario: 改了又改回仍算未改
- **GIVEN** 记录入口预填 72.4 kg
- **WHEN** 用户按一次加、再按一次减后记录
- **THEN** `weight_add` 的 `prefill` 为 `kept`

#### Scenario: 记下保存时的显示单位
- **GIVEN** 用户切换为斤
- **WHEN** 记录一条体重
- **THEN** `weight_add` 的 `unit` 为 `jin`

#### Scenario: 属性不含体重数值
- **GIVEN** 用户记录了 72.6 kg
- **WHEN** 检查这次产生的事件属性
- **THEN** 属性只有 `prefill` 与 `unit`，不含 72.6、145.2，也不含与预填值的差值

#### Scenario: 修改与删除不产生事件
- **GIVEN** 一条已保存的体重记录
- **WHEN** 用户修改它的数值，随后删除它
- **THEN** 不产生任何 `weight_add` 事件

#### Scenario: 埋点失败不影响记录
- **GIVEN** 埋点写入失败
- **WHEN** 用户记录一条体重
- **THEN** 记录正常保存
- **AND** 界面不出现任何错误提示
