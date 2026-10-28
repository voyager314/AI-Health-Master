## Context

见 `proposal.md` — Why。本节只记录影响技术方案的现状与约束。

`frontend/` 是未改动的 Vite + React 19.3 + TS 6 脚手架：`App.tsx` 仍是模板页，无路由、无存储封装、无 PWA、无测试框架。`backend/` 是零依赖的 uv Python 包，本 change 不触碰。

真正塑造方案的约束来自 PRD §10.5 的 12 条可迁移性约束。它们不是「最佳实践建议」，而是「将来换 MySQL 时只替换存储实现、不重写业务逻辑」这一目标的充分条件集合。本设计的大部分决策都是在回答同一个问题：**怎样让违反约束在编译期或检查期就失败，而不是靠人记得**。

两个必须提前认清的 IndexedDB 行为，它们直接决定了 Command 层与迁移的形状：

1. **事务会在控制权交回事件循环时自动提交。** 一个 IndexedDB 事务中途 `await` 任何非 IndexedDB 的 Promise，事务就会提前结束，后续写入抛 `TransactionInactiveError`。
2. **迁移只能在 `onupgradeneeded` 中进行，而它在 `open()` 时就已经触发。** 「迁移前自动导出备份」（约束 10）无法在升级回调里完成——那时旧结构已在被改写。

## Goals / Non-Goals

**Goals:**

- 让约束 1 / 3 / 9（硬性一票否决三条）由类型系统与 ESLint 强制，而非靠自觉
- 让「导出 → 清空 → 导入」的往返一致性成为一条可重复运行的自动化测试，而非一次性人工验收
- 让 12 条约束各有一个明确的自检手段，自检可在 CI 或本地一条命令内跑完
- 分层边界对后续每个 change 都是默认继承的，新增实体走不通「先接页面」这条路

**Non-Goals:**

- 不设计任何业务界面（动作库、训练记录、体重趋势属下一个 change）
- 不实现同步、冲突合并、离线队列重放。本期只把它们的承载结构（`pending_ops`、`version`、`client_id`）就位
- 不引入状态管理库。本 change 的页面状态简单，提前引入会在业务形态未明时固化错误的数据流
- 不引入图表库。它只在下一个 change 的体重趋势图才需要，现在装属于无用依赖

## Decisions

### D1 存储层用 `idb` 薄封装，不用 Dexie

`idb`（约 1KB 的 Promise 封装）而非 Dexie。

Dexie 的核心卖点是链式查询 DSL 与复合索引——而约束 8 恰恰禁止「依赖复合游标做业务逻辑」，要求每个查询都能等价表达为一条单表 `SELECT ... WHERE`。用 Dexie 会让团队（哪怕只有一个人）持续受到违反约束 8 的诱惑，且它的查询 DSL 深度耦合进 Repository 后，上云时「只替换存储实现」会变成「重写全部查询」。

`idb` 只把回调变成 Promise，不引入新的查询概念，Repository 因此被迫保持「取数 + 内存过滤」的形状。

**代价**：裸写索引取数比 Dexie 冗长。可接受——9 个 repo 的查询都很简单。

### D2 UUID v7 用 `uuid` 包，禁用 `crypto.randomUUID()`

浏览器原生 `crypto.randomUUID()` 返回 v4（纯随机），不满足约束 2「时间有序、索引友好」的本意：v4 主键在上云后会让 B 树索引随机分裂，也无法按主键近似排序。

用 `uuid` 包的 `v7()`。ESLint 禁止全仓库出现 `crypto.randomUUID`，避免有人图省事退回 v4。

`client_id` 本期与 `id` 同值（约束 2 允许）。它独立存在的意义在上云后才显现：离线队列重放时服务端靠它去重。

### D3 Command 层：同步 handler + 单事务 + 日志同事务

```
applyCommand(type, payload)
  ├─ 1. 查命令注册表，未注册则抛错（不碰数据库）
  ├─ 2. 校验 payload
  ├─ 3. 开一个覆盖「目标业务 store + pending_ops」的读写事务
  │      ├─ handler 用注入的 tx 完成全部业务写入
  │      └─ 同一 tx 内追加一条 pending_ops 记录
  └─ 4. 事务提交成功才返回；任一步失败则整体回滚
```

三个要点：

- **命令 handler 禁止 `await` 非 IndexedDB 的 Promise**（见 Context 第 1 点）。所有需要异步准备的数据（如生成的 id、当前时刻、tz offset）必须在开事务**之前**算好并传入。这条通过 handler 签名强制：handler 收到的是已经准备好的纯数据与一个 `tx`，拿不到任何可能触发外部异步的能力。
- **`pending_ops` 与业务写入同事务**。否则会出现「业务写了、日志没写」或反之，使 `pending_ops` 失去校验价值，上云后作为离线队列更会直接丢操作。这也兑现了 spec 中「写入失败不留日志」的要求。
- **`user_id` / `version` / 审计字段由事务包装层统一注入**，handler 与调用方都不碰（约束 3/4）。

考虑过让 handler 自行开事务——否决：那样「是否写 pending_ops」就成了每个 handler 的自觉，约束 9 退化为口头约定。

### D4 用模块可见性强制「页面不能写库」，而不是靠 lint 规则

约束 9 要求页面只调用 command、不直接调 repo 的写方法。单靠 ESLint 规则表达「可以 import 这个对象但不许调它的 put 方法」很脆弱。改用导出路径分层：

| 导出路径 | 内容 | 允许导入者 |
| --- | --- | --- |
| `storage/index.ts` | 各 repo 的**只读视图**（`list` / `get` / `query`） | 任何层 |
| `storage/internal.ts` | 各 repo 的**完整接口**（含 `put` / `remove` / `clear`） | 仅 `commands/**`（ESLint 强制） |

每个 Repository 内部仍完整实现 spec 要求的 6 个方法（满足约束 1 的统一形状与可替换性），只是写方法不出现在应用层可见的类型里。页面写 `exerciseRepo.put(...)` 会是 TypeScript 编译错误，而不是一条需要人去发现的 lint 警告。

### D5 `timeWindow` 自己实现，不引日期库

自然日/周边界计算必须按**记录自身的 `tz_offset_minutes`** 判定，而不是按设备当前时区。这恰恰是日期库最容易被误用的地方——`date-fns` / `dayjs` 的 `startOfWeek` 默认用运行时本地时区，用户跨时区旅行后周统计就会错位，而这类错误极难在测试中发现。

`timeWindow` 的全部计算是已知 offset 下的纯算术，自己实现约 60 行，且天然可被单测穷举。格式化用原生 `Intl.DateTimeFormat`。

自然周定义为周一至周日（PRD §12-12）。该模块是全仓库唯一允许出现日界/周界算术的位置（约束 6）。

### D6 迁移：先以旧版本打开并备份，再以新版本打开触发升级

针对 Context 第 2 点，启动序列为：

```
1. 以「不指定版本」打开数据库，读出当前 schema_version
2. 若 schema_version == 期望版本 → 直接进入应用（不备份、不迁移）
3. 若低于期望版本：
     a. 用当前版本号打开，导出全量数据为备份文件
     b. 关闭连接
     c. 用期望版本号打开，onupgradeneeded 中按序执行 migrations[]
     d. 任一迁移抛错 → 中止升级，保留旧库，向用户指出备份文件
4. 若高于期望版本（用户用旧版应用打开新数据）→ 拒绝启动并提示升级应用
```

`migrations` 是一个 `{ version, up }` 的有序数组，一个版本恰一条（约束 10）。第 4 种情况 PRD 未提及，但本地优先 + PWA 缓存下用户完全可能用到旧版应用壳，不处理会静默损坏数据。

### D7 导入：全量校验先行，备份兜底，单事务落库

```
1. 解析与全量校验（纯函数，完全不碰数据库）
     ├─ JSON 可解析
     ├─ schema_version 存在且 ≤ 期望版本（低于则先在内存中走迁移链升级）
     └─ 逐表逐条校验必需字段与类型
2. 二次确认「这将替换当前全部数据」
3. 自动导出当前数据为备份（复用 D6 的备份实现）
4. 单事务内：清空 → 写入
```

把校验完整地放在动数据库之前，是因为导入语义是整库替换：一旦清空后才发现文件第 300 条有问题，用户的原数据已经没了。备份是第二道防线，不是第一道。

考虑过「按 id 合并」而非整库替换——否决：合并需要冲突策略（哪边更新？字段级还是记录级？），而冲突裁决是 PRD §5.4 第 4 步上云时才要解决的问题。本期做一个简化的合并，上云时必然推翻重做。整库替换语义明确、可测、且正好满足 v0.1 的出口标准。

### D8 不引 CSV 库

CSV 只出不进（spec FR-S02.2），只需实现序列化与字段转义（逗号、引号、换行），约 30 行。引 papaparse 主要价值在解析，而我们明确不解析 CSV。

### D9 PWA 用 `vite-plugin-pwa`，只预缓存应用外壳

业务数据在 IndexedDB，不需要任何运行时请求缓存策略——这让 service worker 的职责收窄为「预缓存应用外壳与静态资源」，是 PWA 里最不容易出错的用法。

一条必须守住的红线：**service worker 更新与缓存清理禁止触及 IndexedDB**。Workbox 的缓存清理只管 Cache Storage，但自定义清理逻辑里误调 `indexedDB.deleteDatabase` 会直接造成 RK-02 的数据丢失，且表现为「更新后数据就没了」，极难归因。

### D10 测试：vitest + `fake-indexeddb`，往返一致性作为自动化测试

- 领域纯函数与 `timeWindow`：直接单测，零 mock（约束 12 的目的之一就是让这件事成立）
- Repository 与 Command：用 `fake-indexeddb` 在 Node 中跑真实的 IndexedDB 语义
- **FR-S07.2 往返一致性必须是一条自动化测试**：构造覆盖全部 9 张业务表的数据集 → 导出 → 清空 → 导入 → 逐表逐字段断言相等。它是本 change 的出口标准，必须能在每次改动后重复运行，而不是验收时手工点一遍
- 迁移链：对每个版本构造该版本的数据样本，断言升级后结构与内容正确

### D11 路由用 `react-router`

spec FR-S03.6 要求浏览器前进后退与直接 URL 访问都可用，自己实现得不到任何好处。

### D12 service worker 提示用户刷新，不自动更新

新版本就绪后展示一个「有新版本，点击刷新」的提示，由用户选择时机；不做自动接管。

自动更新体验更顺滑，但本产品的使用场景是「用户正在训练中途记录」——在用户准备记下一组时把页面换掉，是最糟的打断时机，且可能让正在填写的表单内容丢失。提示刷新多一步打扰，但打扰的时机由用户掌握。

将来若用户反馈提示太频繁，可改为「仅在应用空闲超过 N 分钟后自动更新」，改动局限在注册逻辑一处。

### D13 埋点不走 Command 层，经专用窄入口直写

`analytics_event` 的写入**不**经 `applyCommand`，而是经一个只导出追加函数的窄入口 `storage/telemetry.ts`，且该入口只允许 `telemetry/**` 导入。

约束 9 要求「所有写操作走统一 Command 层」，但它服务的目标是「将来能加离线队列 + 重放」。`analytics_event` 不在 9 张业务表之内，是只追加的本地诊断数据：让它走 Command 层会在 `pending_ops` 里为每条埋点产生一条记录，使队列体积翻倍，并且上云后这些分析事件会被当作待同步的业务操作重放——那是语义错误，不是优化问题。

因此写入能力按导入者分别收窄，形成三个 storage 出口：

| 出口 | 导出内容 | 允许导入者 |
| --- | --- | --- |
| `storage/index.ts` | 各 repo 的只读视图 | 任何层 |
| `storage/internal.ts` | 9 张业务表 repo 的完整接口（含写方法） | 仅 `commands/**` |
| `storage/telemetry.ts` | 仅 `analytics_event` 的追加函数 | 仅 `telemetry/**` |

上云补救成本：**零**。埋点上报走的是独立链路（PRD §10.3「本地记录，导出或后续上报」），与业务数据同步本就不共用通道。

### D14 用 `@/` 路径别名，不用深层相对路径

`@/` 指向 `src/`，由 `vite.config.ts` 的 `resolve.alias` 与 `tsconfig.app.json` 的 `paths` 同时声明（vitest 自动继承 vite 的 alias）。

除了可读性，它直接关系到边界规则是否可靠：ESLint 的 `no-restricted-imports` 按**导入字符串**做匹配，而相对路径写法随文件深度变化（`../storage`、`../../storage`、`../../../storage`）。别名把它们收敛成唯一写法 `@/storage`，规则不会因为文件挪了一层目录而漏判。

规则里仍同时保留相对路径的 pattern 作为第二道防线，防止有人绕过别名。

### D15 版本探测依赖 `indexedDB.databases()`，不做回退

约束 10 要求「迁移前自动导出备份」，这意味着必须在打开目标版本**之前**知道本地当前版本——否则无从判断要不要备份。实现上只用 `indexedDB.databases()`，不支持的浏览器直接抛 `UnsupportedBrowserError`。

考虑过用「不指定版本打开」来探测，否决：`indexedDB.open(name)` 对一个**不存在**的库会凭空把它创建成版本 1、且没有任何 store 的空库。要清掉这个幽灵库就得调 `deleteDatabase`，而 D9 把 `deleteDatabase` 的全局出现次数守在零——它是本地优先架构下数据丢失的头号来源，为一条极少走到的探测回退引入它不划算。

PRD §8 的兼容矩阵（iOS Safari 16+、Android Chrome 110+）都支持 `databases()`，且 §8 明确「不做 IE 与旧版兼容」。对过旧的浏览器给出明确报错，比静默地走一条会损坏数据的路径要好。

### D16 实体契约独立为 `entities/` 层，含校验

`entities/` 不只是类型，还包含枚举取值、字段规格与校验纯函数，零依赖。

原因有两条。其一是约束 12：`domain/` 与 `stats/` 以实体数组为入参却禁止导入 `storage/**`，契约若定义在存储实现里，约束 12 就无法成立。其二是校验要被两处复用——落库前的写入校验，以及任务 9.1 的导入校验。后者必须在清空数据库**之前**完成（D7），所以它只能是纯函数；把规格放在零依赖的契约层，这个性质自然成立，不需要额外约束去维持。

字段规格顺带承担了两条约束的运行时兜底：`uuidV7` 规格会拒绝 v4 主键（约束 2），`isoUtc` 规格会拒绝带时区偏移的时间字符串（约束 6）。未在规格中声明的字段一律视为错误——拼错的字段名若被静默写入，要到上云建表时才会暴露，那时数据已经脏了。

### D17 Repository 的契约与实现分开放，装配点只有一处

`storage/repositories/types.ts` 放契约（存储无关），`storage/indexeddb/repository.ts` 放 IndexedDB 实现，`storage/repositories/index.ts` 做装配。

原先把「每实体一个 repo」整体放在 `repositories/` 下，实现时才发现它站不住：repo 实现必然要调 `IDBKeyRange`、`getAllFromIndex`，而这些只允许出现在 `storage/indexeddb/**`。这个冲突暴露的不是规则太严，而是划分本身混淆了契约与实现——「换存储实现时只替换实现」要成立，前提就是两者本来是分开的。拆开之后替换点是单一文件：新增 `storage/mysql/repository.ts`，改 `repositories/index.ts` 一行装配，调用方与契约都不动。

查询接口的形状本身就是约束 8 的强制手段。`QuerySpec` 只能表达「一个单字段索引取数（等值或闭区间）+ 一个内存过滤函数」，复合游标在这个 API 里写不出来。这比「逐个 review 查询方法能否翻成单表 SQL」可靠——写不出来就不用检查。

### D18 审计注入按 store 名做泛型键，不靠实体类型推导

`withAuditForCreate('exercise', input, now)` 的第一个参数是 store 名。

更自然的写法是 `withAuditForCreate(input, now)` 靠入参推导实体类型，但 `CreateInput<T> = Omit<T, keyof AuditFields>` 不是可反推的推导位置：传对象字面量时 `T` 会退化成 `BusinessRecord` 联合类型，调用方必须记得写 `withAuditForCreate<Exercise>(...)`。忘了不会当场失败，而是在后面的 `put` 调用上报「BusinessRecord 不能赋值给 Exercise」——指错地方，且每个命令 handler 都要记一次。

改用 store 名这个字面量做泛型键后推导必然成功，且 store 名与字段形状不匹配时错误落在构造点。

### D19 命令用显式定义数组装配，不用全局 `registerCommand`

`createCommandBus({ definitions: COMMANDS })` 接收一个显式数组，而不是让各模块在加载时调用全局的 `registerCommand`。

全局注册的失效方式很隐蔽：注册时机取决于模块被 import 的顺序，漏掉一个 import 不会在启动时报错，而是等用户走到那条路径时才变成「未注册的命令类型」。显式数组把这个问题提前到编译期——命令没被列进 `COMMANDS` 就是一处未使用的导出，而重复的 type 在装配时直接抛 `DuplicateCommandError`，不会静默覆盖。

同一个理由决定了 `pending_ops` 的写入位置：它在事务包装函数内部，不是 handler 的一个步骤。否则「这条命令有没有记日志」会变成每个 handler 的自觉，约束 9 就退化成了口头约定。handler 手里只有一个事务句柄，既跳不过日志，也开不了自己的事务。

## 目录结构与分层边界

```
frontend/src/
├─ app/                      路由、应用外壳、同意门禁、免责声明
├─ entities/                 数据契约：类型、枚举取值、字段规格与校验（零依赖）
├─ features/
│   ├─ data/                 导出 / 导入 / 清空的界面与流程
│   └─ placeholder/          后续版本页面的占位页
├─ commands/                 applyCommand + 命令注册表     ← 唯一写入口
├─ domain/                   领域纯函数（零存储依赖）
├─ stats/
│   └─ timeWindow.ts         自然日/周边界的唯一实现
├─ storage/
│   ├─ indexeddb/            ← 唯一允许出现 IndexedDB API 的目录
│   │   ├─ db.ts
│   │   ├─ schema.ts
│   │   ├─ write.ts          审计字段注入与落库校验
│   │   ├─ repository.ts     Repository 契约的 IndexedDB 实现
│   │   └─ migrations/
│   ├─ repositories/
│   │   ├─ types.ts          Repository 契约（存储无关）
│   │   └─ index.ts          ← 装配点：整个应用只有这里知道用的是 IndexedDB
│   ├─ internal.ts           完整接口（含写方法）+ 审计注入，仅 commands/** 可导入
│   ├─ telemetry.ts          埋点追加的窄入口，仅 telemetry/** 可导入
│   └─ index.ts              只读视图，应用层用这个
├─ telemetry/                埋点记录接口
└─ shared/                   UI 基元与工具
```

`entities/` 独立成层是约束 12 的必要条件，详见 D16。`storage/indexeddb/schema.ts` 只定义 store 与索引，类型从 `entities/` 取。

允许的调用方向：

```
  app/ ─┬─▶ features/ ─┬─▶ commands/ ─▶ storage/internal.ts ─▶ storage/indexeddb/
        │              │
        │              ├─▶ storage/index.ts（只读）
        │              │
        │              └─▶ domain/ ─▶ stats/timeWindow.ts
        └─▶ telemetry/
```

禁止的跨层调用，全部由 ESLint 强制（违反即检查失败，指出文件与行号）：

| 位置 | 禁止 | 对应约束 |
| --- | --- | --- |
| `storage/indexeddb/**` 之外的任何文件 | 出现 `indexedDB` 全局标识符或数据库实例引用 | 1 |
| `app/**`、`features/**`、`shared/**`、`domain/**`、`stats/**` | 导入 `storage/indexeddb/**` | 1 |
| `commands/**` 之外的任何文件 | 导入 `storage/internal` | 9 |
| `domain/**`、`stats/**` | 导入 `storage/**`、`commands/**`、`telemetry/**` | 12 |
| `entities/**` | 导入任何其他层（类型层不依赖任何人） | 12 |
| 全仓库 | 出现 `crypto.randomUUID` | 2 |
| `stats/timeWindow.ts` 之外的任何文件 | 日界/周界算术（ESLint 无法表达，靠搜索自检 + review） | 6 |

## 12 条约束的落地与自检

| # | 约束 | 本 change 如何落地 | 自检手段 |
| --- | --- | --- | --- |
| 1 | 存储访问收敛到 Repository | `storage/indexeddb/**` 是唯一数据库实现目录；9 个 repo 统一 6 方法；跨层导入由 ESLint 禁止（D4） | ESLint 规则 + `npm run lint`。注意裸标识符 `indexedDB` 由 `no-restricted-globals` 挡，`globalThis/window/self.indexedDB` 这类成员表达式会从它下面绕过去，另由 `no-restricted-syntax` 补挡 |
| 2 | UUID v7 + `client_id`，禁自增 | 写入包装层统一用 `uuid` 的 `v7()` 生成；ESLint 禁 `crypto.randomUUID`（D2） | ESLint 规则 + 单测断言主键符合 v7 版本位且时间有序；字段规格的 `uuidV7` 在落库前再拒一次 v4（D16） |
| 3 | 每条记录带 `user_id` | 由事务包装层注入 `'local'`，业务代码不可见、不可传（D3） | ESLint 禁止 `storage/**` 之外出现 `user_id` 赋值与 `'local'` 字面量 + 单测断言 9 张表均有 `user_id` 字段与索引 |
| 4 | 每条记录带 `version` | 同上，包装层注入 `1`（D3） | 单测断言 9 张表记录均含 `version` |
| 5 | 软删除，禁物理删除 | `repo.remove` 写 `deleted_at`；常规查询与导出排除已删除 | 单测断言 `remove` 后按主键仍可取到记录；两处例外见「偏离留痕」 |
| 6 | 时间统一 UTC + 独立 offset，周界单点实现 | `timeWindow.ts` 为唯一实现（D5）；写入包装层统一生成 UTC ISO 与 `tz_offset_minutes` | 全局搜索日界/周界算术只应命中 `timeWindow.ts` + `timeWindow` 单测穷举跨时区与跨零点样本；字段规格的 `isoUtc` 在落库前拒绝带偏移的时间字符串 |
| 7 | 图片存独立 blob store，记录只存 ref | `blob` store 独立；业务记录只存 `local://<uuid>` 字符串；解析返回「命中/已清理/格式非法」三态 | 单测断言业务记录无 blob 与 base64 字段 + 三态解析各有测试 |
| 8 | 查询只用单字段索引 + 内存过滤 | `QuerySpec` 的形状让复合游标无法表达（D17）；选用 `idb` 而非 Dexie，避免链式查询 DSL 的诱惑（D1） | API 形状即强制：写不出复合游标。另有单测覆盖等值取数、区间取数与内存过滤三种形态 |
| 9 | 写操作走统一 Command 层 | `applyCommand` 是唯一写入口；写方法仅经 `storage/internal` 暴露给 `commands/**`（D3/D4） | TypeScript 编译错误（页面调 `put` 不通过类型检查）+ ESLint 限制 `storage/internal` 导入者 + 单测断言每次 command 产生一条 `pending_ops` |
| 10 | `schema_version` + 顺序迁移 + 迁移前备份 | 启动序列先备份再升级（D6）；`migrations` 为一版一条的有序数组 | 迁移链单测：对每个版本构造样本断言升级结果；断言升级路径必产生备份文件 |
| 11 | 导出 JSON = 内部结构，可反向导入 | 导出不做字段转换；导入先全量校验再单事务替换（D7） | **往返一致性自动化测试**（D10），覆盖 9 张业务表逐字段断言 |
| 12 | 领域计算为纯函数 | `domain/**` 与 `stats/**` 禁止导入存储与 command（ESLint） | ESLint 规则 + 领域单测在不初始化数据库的情况下通过 |

## 偏离留痕

两处偏离约束字面要求的决定，理由与上云补救成本如下。

**1. `blob` 的清理是物理删除（偏离约束 5）**

约束 5 规定禁止物理删除，例外只有「清空全部数据」。本设计增加一个例外：`blob` store 中的图片二进制可被物理删除。

理由：图片是大二进制，软删除不释放存储空间，而 PRD §11.5 要求自动清理以避免撑爆浏览器配额（§12-8 存储配额满是已登记的异常场景）。软删除在这里无法达成约束 5 的目的，反而直接导致它要防的问题。

上云补救成本：**接近零**。约束 5 的真实目的是「删除能同步，多端不出现复活」。上云后图片走对象存储，删除语义由对象存储与 `meal.photo_ref` 的软删除共同承担——业务记录（`meal`）仍然遵守软删除，被删除的是它引用的二进制。`storage_ref` 解析的三态设计（命中/已清理/格式非法）正是为此准备：blob 缺失是预期状态而非错误，这条路径在本期就已经被测试覆盖。

**2. `pending_ops` 不参与导出（偏离约束 11 的字面要求）**

约束 11 要求「导出 JSON 结构 = 内部结构」。内部有 12 个 store，导出含 10 个（9 张业务表 + `analytics_event`），不含 `pending_ops` 与 `blob`。

理由：`pending_ops` 是操作历史而非数据状态，重放会产生重复写入；约束 11 的目的是「导出即迁移载体」，而迁移载体需要的是状态快照。`blob` 的排除见下方 Open Questions。

上云补救成本：**零**。PRD §5.4 第 3 步明确 `pending_ops` 上云后的角色是「本地离线队列的载体」——它天然是客户端瞬态，跨设备搬运它在语义上就是错的。

## Migration Plan

本 change 是项目的第一次实质性改动，没有存量用户、没有需要迁移的数据，`schema_version` 从 1 起步。

需要清理的脚手架残留：`App.tsx`、`main.tsx`、`index.css`、`App.css` 改写；`src/assets/`（`react.svg`、`vite.svg`、`hero.png`）与 `public/` 中的模板资产删除并替换为 PWA 图标。

回滚策略：本 change 尚无生产部署，回滚即 `git revert`。

本 change 为 PRD §5.4 的上云六步预置了前置条件：第 1 步（字段与类型定型）、第 2 步（`user_id` 就位）、第 3 步（Command 层与 `client_id` 就位）、第 4 步（`version` 与 `updated_at` 就位）、第 5 步（导出结构即迁移载体）、第 6 步（领域计算为纯函数，可换 SQL 聚合）。

## Open Questions

以下问题不影响本 change 的 specs、方案与任务拆分，可在到达对应版本时再定。

- **v0.3 的餐食图片是否随导出一并带出？** 本期无图片功能，导出不含 `blob`。到 v0.3 需决定：导出改为 ZIP（`data.json` + `images/`），还是图片明确不可携带、换设备后统一解析为「已清理」。后者零成本且已被本期的三态解析覆盖；前者对用户更友好但要改导出格式。建议在 v0.3 按用户是否真的在意历史餐食照片来定。
- **CSV 的列集是逐表平铺还是额外提供一张宽表？** spec 只要求按表导出。若用户实际想在 Excel 里看「某次训练的全部组」，逐表 CSV 需要自己做 VLOOKUP。可等真的有人抱怨再加宽表导出。
