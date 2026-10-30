## 1. 实体契约

- [x] 1.1 删 `Exercise` / `Workout` / `WorkoutExercise` / `SetEntry` 四个类型与 `EXERCISE_PATTERNS` / `METRIC_TYPES` / `WORKOUT_STATUSES` 三个枚举；`BUSINESS_STORE_NAMES` 改为 6 张表的清单。完成判据：`tsc -b` 报出的引用点全部是本 change 要改的位置，没有多余错
- [x] 1.2 新增 `WorkoutItem`（`name` / `sets` / `reps` / `weight_kg` / `note`）与 `WorkoutLog`（`logged_at` / `input_source` / `items`），字段逐个带含义、单位、取值域的注释。完成判据：`BusinessRecordMap` 覆盖 6 张表，`EXPORTED_STORE_NAMES` 为 7 项
- [x] 1.3 `FieldRule` 新增 `itemList`，实现项目卡片的逐项校验：数组非空、只接受五个键、`name` 非空且不超过 40 字、`sets` / `reps` 为正整数或 `null`、`weight_kg` 落在 0.5 网格且不小于 0 或 `null`、`note` 不超过 200 字或 `null`。完成判据：单测覆盖每个字段的正反例，错误定位到「第几张卡片的哪个字段」
- [x] 1.4 删四张废弃表的字段规格，新增 `workout_log` 的规格。完成判据：`RECORD_SPECS` 的键集合与 `ALL_STORE_NAMES` 完全一致

## 2. 存储结构

- [x] 2.1 `STORES` 收敛到 9 项：`workout_log` 建 `user_id` 与 `logged_at` 两个单字段索引，其余按既有定义保留。完成判据：`schema.ts` 里的 `StoreDef.kind` 计数为 6 业务 + 3 非业务
- [x] 2.2 `AppDb` 的类型化 schema 同步。完成判据：`tsc -b` 通过
- [x] 2.3 version 1 迁移的内容随 `STORES` 自动变化，不新增版本号。完成判据：`schema.test.ts` 断言全新安装建出 9 个 store 且每张业务表有 `user_id` 索引
- [x] 2.4 只读视图改为 `workoutLogRepo`，删四个已失效的导出。完成判据：`storage/index.ts` 导出的 repo 数量为 6

## 3. 导出与导入

- [x] 3.1 导出清单随 `EXPORTED_STORE_NAMES` 收敛到 7 项，CSV 的列顺序取自 `RECORD_SPECS`，嵌套的 `items` 以 JSON 文本表达。完成判据：`export.test.ts` 断言清单不含旧表名
- [x] 3.2 导入拒绝清单之外的 store 名，错误信息指出具体表名。完成判据：新增用例断言含 `set_entry` 的文件被拒且数据库未改动
- [x] 3.3 往返一致性用例在 6 张业务表上重写，运动记录覆盖「多张卡片、部分指标为 `null`、跨东西半球偏移」。完成判据：`roundTrip.test.ts` 通过，逐表逐字段相等

## 4. 界面与测试夹具

- [x] 4.1 首页改为读 `workoutLogRepo`，导航文案「训练」改为「运动」。完成判据：`shell.test.tsx` 通过，首页在无数据与有数据两种状态下都正常
- [x] 4.2 `test/fixtures.ts` 删四个构造器，新增 `aWorkoutLog`；`test/seed.ts` 改为写入 `workout_log`。完成判据：全仓库不再引用已删掉的构造器
- [x] 4.3 其余受影响的测试（`bus.test.ts`、`data.test.ts`、`repository.test.ts`、`write.test.ts`、`schema.test.ts`）改用 `workout_log` 或 `body_metric` 作为样本表。完成判据：`npm test` 全绿

## 5. 注释与收尾

- [x] 5.1 注释去掉对设计章节号、需求编号、`openspec/` 路径的引用，改为直接陈述规则。完成判据：`grep -rn "design\.md\|openspec/\|PRD §\|FR-\|约束 [0-9]" frontend/src` 零命中
- [x] 5.2 `eslint.config.js` 与 `commands/index.ts` 等处的说明同步去掉文档引用。完成判据：同上
- [x] 5.3 更新 `openspec/config.yaml` 的数据模型、版本切分与保留期例外。完成判据：配置里不再出现动作库、训练模板与 9 张业务表
- [x] 5.4 约束 1 / 3 / 9 复核，迁移链与往返一致性通过。完成判据：`npm run lint` 与 `npm test` 全绿，结论写入本 change 的收尾说明
