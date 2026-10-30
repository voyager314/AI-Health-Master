import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/*
 * 分层边界的机器化强制。
 *
 * 目的是让越层的代码在 `npm run lint` 就失败，而不是靠人记得：页面直接够到数据库、
 * 应用层绕过命令层写库、领域层导入存储——这三类违规一旦混进代码，将来换存储实现时
 * 只会变成静默的例外，不会被替换掉。
 *
 * 注意 ESLint flat config 的语义：同名规则在后面的配置块里会**替换**而非合并前面的。
 * 所以每个文件集必须只被一个 no-restricted-imports 块匹配，且该块列出它的完整禁止清单。
 */

/**
 * 把一个层路径展开成 pattern 组。
 *
 * no-restricted-imports 按导入字符串做 minimatch，所以要同时覆盖：
 *   - 别名写法：`@/storage/indexeddb`、`@/storage/indexeddb/db`
 *   - 相对路径写法：`../storage/indexeddb`、`../../storage/indexeddb/db`（绕过别名的第二道防线）
 */
const layer = (p) => [`@/${p}`, `@/${p}/**`, `**/${p}`, `**/${p}/**`]

/**
 * 单个文件（不是目录），如 storage/internal.ts。
 *
 * 必须同时覆盖带扩展名的写法：这个仓库的导入普遍写成 `@/storage/internal.ts`，
 * 只匹配不带后缀的形式会让这些导入整条绕过检查。
 */
const file = (p) => [`@/${p}`, `**/${p}`, `@/${p}.ts`, `**/${p}.ts`]

const DB_IMPL = layer('storage/indexeddb')
const STORAGE_ANY = layer('storage')
const STORAGE_INTERNAL = file('storage/internal')
const STORAGE_TELEMETRY = file('storage/telemetry')
const COMMANDS = layer('commands')
const TELEMETRY = layer('telemetry')
const UI_LAYERS = [...layer('app'), ...layer('features'), ...layer('shared')]

const MSG = {
  dbImpl:
    '数据库实现只允许被 storage/** 内部导入。读数据用 @/storage（只读视图），写数据用 @/commands。',
  internal:
    'storage/internal 含写方法，只允许 commands/** 导入。应用层写数据必须经 applyCommand。',
  telemetryEntry:
    'storage/telemetry 是埋点的专用窄入口，只允许 telemetry/** 导入。',
  pure:
    'domain/ 与 stats/ 必须是纯函数——入参为实体数组，不读存储、不触发副作用。',
  entities:
    'entities/ 是零依赖的类型层。它被所有层导入，自己不能导入任何层，否则会形成环。',
  noReachUp: '分层方向：下层不得反向导入上层。',
}

/** 主键必须是 UUID v7：crypto.randomUUID 返回的是 v4，纯随机、不时间有序 */
const RESTRICT_RANDOM_UUID = {
  selector: "MemberExpression[object.name='crypto'][property.name='randomUUID']",
  message:
    'crypto.randomUUID() 返回 UUID v4（纯随机）。主键必须用 uuid 包的 v7()，否则上云后索引会随机分裂。',
}

export default defineConfig([
  globalIgnores(['dist', 'dev-dist']),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },

  // ── 禁用 crypto.randomUUID（返回 v4，不满足「时间有序」）──────────────────────
  //
  // 下面两块按「是否在 storage/indexeddb/** 内」切开：flat config 里同名规则会
  // 替换而非合并，所以数据库实现目录那块要把 crypto 规则重复一遍。
  {
    files: ['src/storage/indexeddb/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', RESTRICT_RANDOM_UUID],
    },
  },

  // ── IndexedDB 只允许在 storage/indexeddb/** 内触碰 ────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/storage/indexeddb/**'],
    rules: {
      // 裸标识符 `indexedDB`
      'no-restricted-globals': [
        'error',
        {
          name: 'indexedDB',
          message:
            'IndexedDB API 只允许在 storage/indexeddb/** 内使用。其余各层经 Repository 访问存储。',
        },
        {
          name: 'IDBKeyRange',
          message: 'IndexedDB API 只允许在 storage/indexeddb/** 内使用。',
        },
        {
          name: 'IDBFactory',
          message: 'IndexedDB API 只允许在 storage/indexeddb/** 内使用。',
        },
      ],
      // no-restricted-globals 只认裸标识符，`globalThis.indexedDB` / `window.indexedDB`
      // 会从它下面绕过去，所以这里补上成员表达式的形式。
      'no-restricted-syntax': [
        'error',
        RESTRICT_RANDOM_UUID,
        ...['globalThis', 'window', 'self'].map((root) => ({
          selector: `MemberExpression[object.name='${root}'][property.name='indexedDB']`,
          message: `${root}.indexedDB 同样只允许在 storage/indexeddb/** 内使用，不要用它绕过边界检查。`,
        })),
      ],
    },
  },

  // ── 以下每块是一个文件集的完整导入禁止清单（不可拆开，见文件头注释）──────────

  // entities/：零依赖的类型层
  {
    files: ['src/entities/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                ...STORAGE_ANY,
                ...COMMANDS,
                ...TELEMETRY,
                ...UI_LAYERS,
                ...layer('domain'),
                ...layer('stats'),
              ],
              message: MSG.entities,
            },
          ],
        },
      ],
    },
  },

  // domain/ 与 stats/：纯函数，零存储依赖
  {
    files: ['src/domain/**/*.{ts,tsx}', 'src/stats/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...STORAGE_ANY, ...COMMANDS, ...TELEMETRY],
              message: MSG.pure,
            },
            { group: UI_LAYERS, message: MSG.noReachUp },
          ],
        },
      ],
    },
  },

  // app/、features/、shared/：读经 @/storage，写经 @/commands
  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
      'src/shared/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: DB_IMPL, message: MSG.dbImpl },
            { group: STORAGE_INTERNAL, message: MSG.internal },
            { group: STORAGE_TELEMETRY, message: MSG.telemetryEntry },
          ],
        },
      ],
    },
  },

  // commands/：唯一可导入 storage/internal 的层
  {
    files: ['src/commands/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: DB_IMPL, message: MSG.dbImpl },
            { group: STORAGE_TELEMETRY, message: MSG.telemetryEntry },
            { group: UI_LAYERS, message: MSG.noReachUp },
          ],
        },
      ],
    },
  },

  // telemetry/：唯一可导入 storage/telemetry 的层
  {
    files: ['src/telemetry/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: DB_IMPL, message: MSG.dbImpl },
            { group: STORAGE_INTERNAL, message: MSG.internal },
            { group: [...UI_LAYERS, ...COMMANDS], message: MSG.noReachUp },
          ],
        },
      ],
    },
  },

  // storage/：存储实现本身，只禁止反向导入上层
  {
    files: ['src/storage/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: [...UI_LAYERS, ...COMMANDS, ...TELEMETRY], message: MSG.noReachUp },
          ],
        },
      ],
    },
  },

  // test/：测试基础设施不受分层限制（它要能装配任意层）
  {
    files: ['src/test/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
])
