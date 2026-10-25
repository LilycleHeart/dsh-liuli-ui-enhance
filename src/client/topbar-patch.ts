/**
 * 顶栏补丁修复：客户端侧调用约定（与 src/host-topbar-patch.ts 的 /liuli-topbar-patch 对应）。
 *
 * 悬浮球与设置页共用：GET 查状态（patched / missing / needs-exit / unsupported），
 * POST 就地打补丁。补丁只写 app.asar 头与 unpacked 文件，重启客户端后生效。
 */
export interface TopbarPatchStatus {
  state: 'patched' | 'missing' | 'needs-exit' | 'unsupported'
  version?: string
  fuse: 'on' | 'off' | 'unknown'
  canApply: boolean
  message?: string
}

export interface TopbarPatchResult {
  ok: boolean
  state: TopbarPatchStatus['state']
  requiresRestart: boolean
  message: string
}

/** 读当前客户端的补丁状态；路由不可达（纯 Web）时返回 undefined。 */
export async function fetchTopbarPatchStatus(): Promise<TopbarPatchStatus | undefined> {
  try {
    const res = await fetch('/liuli-topbar-patch', { headers: { accept: 'application/json' } })
    if (!res.ok) return undefined
    const data = await res.json() as TopbarPatchStatus
    return typeof data?.state === 'string' ? data : undefined
  } catch {
    return undefined
  }
}

/** 触发就地补丁；结果为 undefined 表示宿主路由不可达。 */
export async function applyTopbarPatch(): Promise<TopbarPatchResult | undefined> {
  try {
    const res = await fetch('/liuli-topbar-patch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    })
    if (!res.ok) return undefined
    return await res.json() as TopbarPatchResult
  } catch {
    return undefined
  }
}

/** 状态 → 用户可读的一句话。 */
export function describeTopbarPatch(status: TopbarPatchStatus): string {
  switch (status.state) {
    case 'patched':
      return '无边框补丁已应用：窗口顶栏由琉璃接管。'
    case 'missing':
      return '检测到无边框补丁未应用（客户端更新后常见）：原生标题栏会保留，“窗口顶栏”设置不生效。'
    case 'needs-exit':
      return status.message ?? '该客户端需要在完全退出后补丁：运行时无法写 exe 内嵌校验值。'
    case 'unsupported':
    default:
      return status.message ?? '当前客户端版本不在补丁支持范围内。'
  }
}
