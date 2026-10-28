# AGENTS.md

Instructions for AI coding agents working in this repository. Read this before
your first commit.

## What this repository is

AI Health Master helps people in a muscle-gain phase keep their training and
nutrition on track. The product exists for one reason: logging a set should cost
one spoken sentence rather than a form. Everything else is in service of that.

## Where the rules live

- `openspec/config.yaml` — product scope, the 12 portability constraints, and
  per-artifact rules for proposal / specs / design / tasks. Authoritative. Read
  it before proposing or implementing a change.
- `openspec/changes/<change>/` — the change in flight: `proposal.md`,
  `design.md`, `tasks.md`.
- `.agents/skills/`, `.claude/`, `.codex/`, `.github/` — the same openspec
  skills mirrored per tool. If you edit one copy, update the others.

Those documents already state the architecture rules. Do not restate them here
and do not paraphrase them in commit messages. This file only covers what is
not written down elsewhere.

## Commit messages

A commit message has two jobs: let `git log --oneline` read as a changelog, and
give `git blame` a reason that the code cannot. Nothing else belongs in it.

### Title

```
<type>(<scope>): <what changed>
```

- `type`: `feat` `fix` `refactor` `perf` `test` `docs` `build` `chore` `ci` `style`
- `scope`: the module you touched — `entities` `storage` `command` `stats` `ui`
  `app` `pwa` `frontend` `backend` `openspec`
- `<what changed>`: one concrete clause. Required — never `fix`, `update`,
  `chore`, or `wip` on its own.
- 50 characters max (a Chinese character counts as one). No trailing period.
- One logical change per commit. If the title needs "and", split the commit.

### Body

Omit it by default. Write one only when the diff cannot answer either question:

- **Trade-off** — you chose A over B, and the reason is not recoverable from the
  code.
- **Impact** — migration, compatibility, or a downstream change the reader must
  know about.

Then: 6 lines maximum, 3 bullets maximum, one line each. Anything longer is a
design document wearing a commit message's clothes.

### Never put in a commit message

| Content                                                                | Where it belongs                       |
| ---------------------------------------------------------------------- | -------------------------------------- |
| Task numbers, acceptance criteria, checklists                          | `openspec/changes/<change>/tasks.md`   |
| Recapping `design.md` sections, cited by number                        | One pointer line: `详见 design.md D15` |
| File lists, "added X, modified Y"                                      | The diff                               |
| Dependency versions, what was not introduced                           | `package.json` / `uv.lock`             |
| Verification logs ("tested with 8 violation files, then deleted them") | The PR description                     |
| Restating what the code now does                                       | Nowhere — the code says it             |

No `Co-authored-by` trailers for tools, no "generated with" footers.

### Self-check before committing

1. Delete the body. Does the title still tell a reviewer what changed? If yes,
   the body was too long.
2. Does any body line already exist in `design.md` or `proposal.md`? Replace it
   with a pointer.
3. Does any body line describe *what* the code does rather than *why*? Cut it.

### Example

Too long — 26 lines restating `design.md` D15/D16, IndexedDB index limits, and a
timezone sign convention:

```
feat(storage): 12 个 store 的数据契约、版本策略与写入包装层

新增 entities/ 数据契约层（design.md D16）：9 张业务表 + 3 个非业务 store 的
类型、枚举取值、字段规格与校验纯函数，零依赖。校验被两处复用……（下略 20 余行）
```

Same commit, right size:

```
feat(storage): 12 个 store 的数据契约与写入包装层

- 迁移链现在就写，全新安装与旧库升级走同一条代码路径。
- 本地版本高于应用期望版本时拒绝启动，否则旧迁移会改写新结构。
- 详见 openspec/changes/local-data-foundation/design.md D15/D16。
```

Too short — a title with no information:

```
project init              ->  chore: 初始化前后端工程骨架与 openspec 目录
add MIT LICENSE           ->  docs: 添加 MIT 许可证
```

