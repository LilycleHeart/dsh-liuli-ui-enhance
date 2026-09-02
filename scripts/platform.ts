/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 * @module @deepseek-ai/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table.
 *  2.0.4（0.1.2-alpha.1）：与上游 client/web/src/platform.ts 的 seed 列表对齐——
 *  dsh-client-store 进入种子表；web-react/attachment/schema-form 已不在上游
 *  基线里（本地保留只影响 noExternal 匹配，删掉以对齐）。
 *  注意：client bundle 只引用这些表内符号；实际加载面以宿主 module loader 为准。 */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
