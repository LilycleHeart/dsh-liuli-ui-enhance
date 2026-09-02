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

interface RemoteResultLike<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { message?: string }
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
