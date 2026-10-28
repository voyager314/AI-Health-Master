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

## Code

Four rules govern the code itself: comments carry intent, types carry shape,
every definition is used, and functions are cut only where a cut earns its keep.
Each is a review criterion, not a preference.

### Comments

A comment explains what the code cannot say about itself. It never narrates what
the next line already says. Write in the register of a specification: no first
person, no hedging, no restating the obvious.

**Comments stand alone.** No comment may cite a document: no path under
`openspec/`, no change name, no design section (`D15`), no task number, no
requirement ID (`FR-T07`), no PRD section number. A comment states what the code
does in terms the file itself supplies, so a reader who has never opened a
planning document still understands it. A rule that came from a design decision
is stated as the rule; a requirement is stated as the behavior that satisfies
it.

The reason is not taste. Documents get rewritten, renumbered, and archived,
while the comment is read for as long as the code exists. A citation either
breaks or pulls the explanation out of the file into one the reader may not be
able to open.

**Modules, classes, interfaces.** The block comment states responsibility: what
the unit owns, what it guarantees to its callers, and what it must not do.
Describe the contract, never the implementation path. Use bullets when the unit
carries more than one independent guarantee; one clause is enough when it
carries one.

**Fields of a data model.** Every field of a persisted entity, and of any type
that crosses a layer boundary — command payloads, export JSON, repository query
specs — carries a comment giving its meaning, its unit, and its permitted
domain: enum membership, what `null` means, what a sentinel value means. A
field whose name and type look self-explanatory still needs it when a scale, a
sign convention, or a time zone is attached to the value.

**Functions.** Document a function when its signature does not state its
contract. That covers any function which takes more than one parameter, returns
a value whose meaning is not carried by its type, requires a precondition from
its caller, or contains a branch that encodes a business rule. State, in this
order:

- one clause for what the function does, phrased as a guarantee rather than a
  recipe;
- every parameter: meaning, unit, accepted domain, and whether it is mutated;
- the return value: meaning, and what an empty or failed result means.

A function whose contract is fully visible in its signature gets no doc comment.
Repeating `(id: string) => Exercise` in prose is noise.

### Types

**Nest values, not entities.** A model may embed another model only when the
nested value has no identity of its own: no primary key, no independent
lifecycle, no row of its own. A value that carries an ID is stored as a
reference and resolved by the caller. Nesting an entity duplicates rows, makes
the nested field unqueryable under single-field indexes, and turns one write
into several. A model inside a model inside a model is a view rather than a
record; flatten it, or resolve the references at read time.

**One model per concept.** Search the existing models before defining a type.
A type that differs from an existing one by an optional field, a narrowed union,
or a renamed field is a variation: widen the original, or derive it with `Pick`,
`Omit`, or `Partial`. Two definitions of one concept diverge, and every
consumer then pays for knowing which one to trust.

### Reuse

**Every definition is used.** A function, class, interface, or type with nothing
calling it and nothing referring to it is deleted, not parked for later. Dead
code is not free: it is read, trusted, and eventually edited by someone who
assumes it runs.

**Search before defining.** Before adding a helper, a type, or a component,
search for one that already does the job. A near-duplicate costs more than a
slightly general original: the two drift apart, and the reader has to diff them
to find out which one the rest of the code follows.

### Decomposition

**Do not extract what reads straight through.** A short block — a few
conditionals and assignments, read once, top to bottom — stays in its caller.
Splitting it sends the reader out of the function to learn what the function
already showed.

**Extract only for a reason.** Three reasons qualify: the block is called from
more than one place; it carries a rule that needs its own test; or the name says
more than the body does. Without one of them, the extraction adds a jump and
returns nothing.

**A single call site is not a defect.** A long block, or one that carries a
rule, still deserves a name. What does not is a helper that only forwards
arguments, renames a variable, or wraps a single call without adding a
condition.

**No step-per-line pipelines.** Do not split a function into one-line stages
whose only reader is the next stage. A sequence of transformations reads better
as one function than as five.

### Self-check before opening a PR

1. Does any comment cite a document — a path, a change name, a section number,
   a requirement ID?
2. Can every field of every exported model be explained without opening another
   file?
3. Is there a function, class, interface, or type that nothing calls or refers
   to?
4. Is there a helper that forwards its arguments without adding a rule?
5. Does a doc comment restate the signature instead of the contract?

## Commit messages

A commit message has two jobs: let `git log --oneline` read as a changelog, and
give `git blame` a reason that the code cannot. Nothing else belongs in it.

A message outlives the working notes around it. `openspec/changes/<change>/`
leaves the working tree once a change ships, so any path into it stops
resolving. Write from the diff, not from the plan: state what the commit does,
in a form that stays true after the artifacts are gone.

### Title

```
<type>(<scope>): <what changed>
```

- `type`: `feat` `fix` `refactor` `perf` `test` `docs` `build` `chore` `ci` `style`
- `scope`: the area the diff touches — `entities` `storage` `command` `stats`
  `ui` `app` `pwa` `frontend` `backend`. A diff that only edits planning
  artifacts takes `docs` and the scope of the area those artifacts describe.
- `<what changed>`: one concrete clause stating the result rather than the
  activity. Required — never `fix`, `update`, `chore`, or `wip` on its own.
- English takes the imperative (`add`, not `added`); Chinese takes a plain
  statement of the result. One language per message, identifiers stay verbatim.
- 50 characters max, prefix included (a Chinese character counts as one). No
  trailing period.
- One logical change per commit. If the title needs "and", split the commit.

### Body

Omit it by default. Write one only when the diff cannot answer either question:

- **Trade-off** — you chose A over B, and the reason is not recoverable from the
  code.
- **Impact** — migration, compatibility, or a downstream change the reader must
  know about.

Then: 6 lines maximum, 3 bullets maximum, one line each. Anything longer is a
design document wearing a commit message's clothes.

A body carries reasoning, never evidence. Which task a commit closes, how it was
verified, and what the plan called it are all recoverable elsewhere. A reason
that exists only in a design document does not fit in a message: restate it as
the invariant it protects, or leave it out.

### No timeline

A message describes one state of the code, not a sequence of events. Words that
place the change on a timeline — `now`, `previously`, `currently`, `originally`,
`no longer`, `现在`, `目前`, `之前`, `原先`, `曾经` — are banned. State the
property instead of the transition:

```
✗ 原先报错落在后续的 put 调用上，现在落在构造点。
✓ The type error surfaces where the record is built, not where it is written.
```

When a message genuinely needs a point in time, write it as ISO 8601
(`2026-10-29`), never as a relative expression.

### Never put in a commit message

| Content                                                                                          | Where it belongs           |
| ------------------------------------------------------------------------------------------------ | -------------------------- |
| Change names, task numbers (`2.1–2.3`), acceptance criteria, design sections (`D15`), FR numbers | Planning artifacts         |
| Paths under `openspec/`, or any pointer to a file archived with the change                       | Nowhere                    |
| File lists, "added X, modified Y"                                                                | The diff                   |
| Dependency versions, what was not introduced                                                     | `package.json` / `uv.lock` |
| Verification logs ("tested with 8 violation files, then deleted them")                           | The PR description         |
| Restating what the code does, line by line                                                       | Nowhere                    |

`Nowhere` means the content has no valid home in a message — delete it rather
than rephrase it. No `Co-authored-by` trailers for tools, no "generated with"
footers.

### Self-check before committing

1. Delete the body. Does the title still tell a reviewer what changed? If yes,
   the body was too long.
2. Delete every path and number the message cites. Does it still say something
   true? If not, the citation was carrying the message.
3. Does any line describe *what* the code does rather than *why*? Cut it.
4. Does any line place the change on a timeline? Rewrite it as a property.
5. Would the message still be correct once the change is archived? If not, it
   describes the plan rather than the commit.

### Example

Wrong — 26 lines, task numbers and design section numbers, a path that stops
resolving once the change ships, and a "now" that dates the commit:

```
feat(storage): 12 个 store 的数据契约、版本策略与写入包装层

新增 entities/ 数据契约层（design.md D16）：9 张业务表 + 3 个非业务 store 的
类型、枚举取值、字段规格与校验纯函数……（下略 20 余行）

- 迁移链现在就写，全新安装与旧库升级走同一条代码路径。
- 详见 openspec/changes/local-data-foundation/design.md D15/D16。
```

The same commit, written from the diff — one language, no pointers, no timeline.
The defects are language-independent; these examples happen to be English:

```
feat(storage): define contracts and write wrapper

- A single migration chain covers fresh installs and upgrades, so the two paths
  cannot diverge.
- Refuse to start when the stored schema is newer than the build, otherwise an
  outdated migration rewrites a newer structure.
```

A one-line fix with no trade-off gets a title and nothing else:

```
fix(storage): key audit injection by store name
```

A title that names the activity instead of the change, and the same commits
written as results:

```
project init        ->  chore: scaffold the Vite frontend and uv backend
add MIT LICENSE     ->  docs: add MIT license
```
