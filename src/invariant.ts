/**
 * 琉璃主题包级 invariant 伴生插件。
 * @module @deepseek-ai/liuli-theme/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/liuli-theme'

/** Cordis 伴生插件名。 */
export const name = 'liuli-theme-invariant'
/** 注册前所需服务。 */
export const inject = ['invariants']

/**
 * 无运行时 invariant：主题为纯展示插件，不发 cordis 事件、
 * 不持有跨插件可变状态。
 */
const install: InvariantInstaller = () => {}

/**
 * 注册本包 invariant 伴生。
 * @param ctx - 携带 invariant 服务的 Cordis 上下文。
 * @returns 安装注册的 disposer。
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
