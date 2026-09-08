/**
 * 琉璃主题 · Remote API 适配层（DSH 2.0.4 / @deepseek-ai 0.1.2-alpha.1）。
 *
 * 背景：2.0.4 移除了 `@deepseek-ai/dsh-client-runtime`，旧 `connection.api`
 * (IApiClient) 随之消失；能力分散到 `ctx.remote.*` 命名空间（Typert）与
 * `ctx.modelDirectories`（每会话模型目录）。本文件把这些新面收拢成旧形状的
 * 子集，让 supplier-quota / model-retry / thinking-fill 三个控制器最小改动：
 *
 * - `llm.providers({})`      → `remote.llm.listConfigurableProviders()`（返回
 *   RemoteResult；旧响应字段 `providers` 直接就是返回数组本身）。
 * - `settings.describe({})`  → `remote.settings.describe()`（返回
 *   `{writable, hasDocument, namespaces}`，与旧 `result.value` 同构）。
 * - `settings.mutate({ns,ops,expectedRevision})` → `remote.settings.mutate(ns, ops,
 *   expectedRevision)`（三参数形式；返回新 ns 视图，`revision` 在其上）。
 * - `sessions.models({sessionId})` → 经 `ctx.modelDirectories.directoryFor(id)
 *   .store.getSnapshot().current` 读取当前模型选择（无 RPC；快照驱动）。
 *
 * RemoteResult<T> = `{ok:true;value}` | `{ok:false;error}`，不是旧
 * `{result: ...}` 包装 —— 本层统一拆包成 `{ok, value}`，调用方语义不变。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ModelDirectoryResolver } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// Type-only: 触发 TypertRemoteNamespaceMap 的声明合并（ctx.remote.settings /
// ctx.remote.llm / ctx.remote.session 的方法签名来自这些生成面）。
import type {} from '@deepseek-ai/dsh-api-settings-controller/remote'
import type {} from '@deepseek-ai/dsh-llm/remote'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'

/** 适配层收敛后的结果：成功携带 value，失败携带 message。 */
export interface ApiResult<T> {
  readonly ok: boolean
  readonly value: T
  readonly error?: { readonly message: string }
}

/** 可配置供应商路由（llm.listConfigurableProviders 的条目，消费方只读这些字段）。 */
export interface ProviderRoute {
  readonly provider: string
  readonly settingsNs: string
  readonly settingsPath: readonly string[]
}

/** settings.describe 的 namespace 视图（消费方只读这些字段）。 */
export interface SettingsNamespace {
  readonly ns: string
  readonly value: unknown
  readonly revision: number
}

/** settings.describe 的整体视图。 */
export interface SettingsDescribeView {
  readonly namespaces: readonly SettingsNamespace[]
}

/** settings.mutate 的单条 path op（与旧 op 形状一致：set/… + path + value）。 */
export interface SettingsPathOp {
  readonly op: 'set' | 'remove'
  readonly path: readonly string[]
  readonly value?: unknown
}

/** 旧 IApiClient 面的收敛子集（三控制器用到的全部方法）。 */
export interface LiuliRemoteApi {
  llm: {
    providers(): Promise<ApiResult<{ providers: readonly ProviderRoute[] }>>
  }
  settings: {
    describe(): Promise<ApiResult<SettingsDescribeView>>
    mutate(input: {
      ns: string
      ops: readonly SettingsPathOp[]
      expectedRevision?: number
    }): Promise<ApiResult<SettingsNamespace>>
  }
}

/** 模型目录服务的最小面（supplier-quota 订阅 current 用）。 */
export interface ModelDirectoryLike {
  directoryFor(sessionId: string): { store: { subscribe(fn: () => void): () => void; getSnapshot(): { current: { provider: string; model: string } | null } } }
}

/**
 * 第三方 provider 插件贡献的 Remote 命名空间面。
 *
 * DSH 的 Remote 命名空间由插件在自己的 Client 半用 `ctx.remote.$mount()` 挂载，
 * 服务名是 `remote.<namespace>`（见 dsh-api-gateway 的 `remoteServiceKey`）。
 * 本插件既不能静态 import 它的类型（第三方包不是本插件的依赖），也不能把它写进
 * 包级 `inject`（插件缺席会让启动图死锁）。约定：这里只声明「消费方需要的结构
 * 面」，由 `liuliRemoteNamespace()` 在运行时按形状窄化；缺席时返回 null，消费方
 * 降级（额度显示隐藏，不报错）。
 */
export interface RemoteResultLike<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { message?: string }
}

/** 任意 Remote 命名空间服务：方法名 → 调用函数（方法由服务动态定义）。 */
export type RemoteNamespaceLike = Record<string, ((...args: never[]) => unknown) | undefined>

/**
 * 取 `remote.<namespace>` 命名空间服务（如 `commandcode`）。
 *
 * 两条等价路径，先走 traced 服务的 associate 转发（与插件自己用的
 * `namespaceCtx.remote.commandcode` 同一入口），再退回 `ctx.get()`：
 * 服务随贡献卸载时两处都会立即消失，因此调用方每次拿到的都是当下状态。
 * @param ctx - 已 `inject(['remote.<namespace>'])` 的上下文。
 * @param namespace - Remote 命名空间名（插件自定义）。
 * @returns 命名空间服务，未挂载时 null。
 */
export function liuliRemoteNamespace(ctx: Context, namespace: string): RemoteNamespaceLike | null {
  const remote = ctx.remote as unknown as Record<string, unknown> | undefined
  const forwarded = remote?.[namespace]
  if (typeof forwarded === 'object' && forwarded !== null) return forwarded as RemoteNamespaceLike
  const service = (ctx as unknown as { get(name: string): unknown }).get(`remote.${namespace}`)
  if (typeof service !== 'object' || service === null) return null
  return service as RemoteNamespaceLike
}

/** 把 Typert RemoteResult 拆包成 ApiResult；网络异常也收敛成 {ok:false}。 */
async function unwrap<T>(call: Promise<RemoteResultLike<T>>): Promise<ApiResult<T>> {
  try {
    const response = await call
    if (response.ok) return { ok: true, value: response.value as T }
    return { ok: false, value: undefined as unknown as T, error: { message: response.error?.message ?? 'remote call failed' } }
  } catch (error) {
    return { ok: false, value: undefined as unknown as T, error: { message: error instanceof Error ? error.message : String(error) } }
  }
}

/** 把 ctx.remote 收敛成旧 IApiClient 子集。 */
export function liuliRemoteApi(ctx: Context): LiuliRemoteApi {
  const remote: ClientRemote = ctx.remote
  return {
    llm: {
      async providers(): Promise<ApiResult<{ providers: readonly ProviderRoute[] }>> {
        const response = await unwrap(remote.llm.listConfigurableProviders())
        if (!response.ok) return { ok: false, value: { providers: [] }, error: response.error ?? { message: 'remote call failed' } }
        return { ok: true, value: { providers: response.value as readonly ProviderRoute[] } }
      },
    },
    settings: {
      async describe(): Promise<ApiResult<SettingsDescribeView>> {
        const response = await unwrap(remote.settings.describe())
        if (!response.ok) return { ok: false, value: { namespaces: [] }, error: response.error ?? { message: 'remote call failed' } }
        const view = response.value as { namespaces?: unknown } | undefined
        return { ok: true, value: { namespaces: Array.isArray(view?.namespaces) ? view.namespaces as readonly SettingsNamespace[] : [] } }
      },
      async mutate(input: {
        ns: string
        ops: readonly SettingsPathOp[]
        expectedRevision?: number
      }): Promise<ApiResult<SettingsNamespace>> {
        return unwrap(remote.settings.mutate(input.ns, input.ops as never[], input.expectedRevision))
      },
    },
  }
}

/** modelDirectories 服务的运行时窄化（拿不到时返回 null，消费方降级）。 */
export function liuliModelDirectory(ctx: Context): ModelDirectoryLike | null {
  const resolved = ctx.modelDirectories as ModelDirectoryResolver | undefined
  return resolved ?? null
}
