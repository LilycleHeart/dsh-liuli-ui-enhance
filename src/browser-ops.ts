/**
 * 侧边栏浏览器 CDP 操作面(Host 半)。
 *
 * 参考实现源码 browser-replication/main(CDP-executor / PlaywrightLocatorEngine /
 * PlaywrightActions)复刻:把官方 Playwright InjectedScript 经 CDP
 * Page.createIsolatedWorld 注入引擎标签页,提供 aria 快照、元素信息、
 * 真实输入(按下/抬起)、键盘、滚动、下拉、勾选与 world 内求值,供
 * agent「可操作调试」侧边栏浏览器;aria 快照产出的 [ref=eN] 经同 world
 * 的 querySelector('aria-ref=…') 反查元素,跨请求存活(isolated world
 * 同名复用同一 executionContext,注入实例常驻)。
 *
 * 硬约束(实测,勿回退):
 * - Input.dispatchMouseEvent 的 mouseMoved / mouseWheel 在页面屏外加载、
 *   view 曾 setVisible(false) 或被遮挡时永久挂起——click 只发
 *   mousePressed+mouseReleased(即完整 click),滚动用 world 内 scrollBy,
 *   所有 CDP 命令包超时兜底;
 * - fill 返回 'needsinput' 时必须补 Input.insertText;
 * - selectOptions 的候选要对象数组({ value | label | valueOrLabel });
 * - ariaSnapshot 的 refPrefix 用缺省(传 'e' 会变成 eeN)。
 */
import { INJECTED_SCRIPT_SOURCE } from './vendor/playwright-injected-script.ts'

/* ── Electron 最小面(与 browser-engine 的结构化声明同风格) ─────────── */

export interface ElectronDebugger {
  attach(protocolVersion: string, callback?: () => void): void
  detach(): void
  isAttached(): boolean
  sendCommand(method: string, commandParams?: Record<string, unknown>, callback?: (error: unknown, result: unknown) => void): unknown
  on(event: string, listener: (...args: never[]) => void): void
}

export interface OpsWebContents {
  debugger: ElectronDebugger
  isDestroyed(): boolean
  getURL(): string
  isLoading(): boolean
}

export interface OpsWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
}

export interface BrowserOpsDeps {
  findWindow(): OpsWindow | undefined
  /**
   * 真实输入(Input.*)前把标签视图垫进窗口:屏外/隐藏视图没有合成帧,
   * mousePressed/Released 不挂死但 hit test 不命中(实测 click 不触发 onclick)。
   * 引擎实现为「垫 GUI 之下 + 1024×768」并等待合成器出帧——垫层后立即点击
   * 会命中旧空白帧,iframe 等延迟合成的内容全部 miss;restore 时按原几何复位。
   */
  prepareTabSurface(tabId: string): Promise<void> | void
  restoreTabSurface(tabId: string): void
}

/** 统一返回协议(对齐 参考实现 executeInScope)。 */
export type OpsResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

/** ops 路由支持的方法清单(CDP 操作面;导航/标签/截图/视口由引擎既有路由提供)。 */
export const OPS_METHODS = [
  'snapshot', 'elementInfo', 'click', 'type', 'fill', 'press', 'hover', 'scroll',
  'select', 'check', 'uncheck', 'evaluate', 'playwright',
  'waitFor', 'drag', 'cua', 'getDialog', 'handleDialog',
] as const

/** Playwright InjectedScript 构造参数(对齐 参考实现 PlaywrightLocatorEngine.inject)。 */
const INJECT_CONFIG = {
  browserName: 'chromium',
  customEngines: [] as unknown[],
  isUnderTest: false,
  sdkLanguage: 'javascript',
  stableRafCount: 1,
  testIdAttributeName: 'data-testid',
}

/** isolated world 固定名(同名复用同一 executionContext → aria-ref 跨请求存活)。 */
const WORLD_NAME = 'liuli-playwright-world'
/** 注入实例的全局变量名(注入幂等:已存在即跳过)。 */
const INJECTED_GLOBAL = '__liuliPlaywrightInjected'

const WORLD_ALIVE_PROBE = `Boolean(globalThis.${INJECTED_GLOBAL})`

/**
 * 解析 selector / aria-ref → 元素表达式(注入源 1.59 的 querySelector 只收
 * parseSelector 解析后的对象,对齐参考实现的 querySelectorAll(parseSelector(sel))[0])。
 */
const QUERY_ONE = (selector: string): string =>
  `(globalThis.${INJECTED_GLOBAL}.querySelectorAll(globalThis.${INJECTED_GLOBAL}.parseSelector(${JSON.stringify(selector)}), document)[0] ?? null)`

interface OpsSession {
  attached: boolean
  frameId: string | null
  contextId: number | null
  /** child frame → 其隔离 world contextId(iframe 支持;惰性构建,失效重建)。 */
  children: Map<string, { contextId: number | null }>
  /** 全局 ref → (frameId, world 内 localRef):snapshot 重编号时建立,ref 定位路由用。 */
  refMap: Map<string, { frameId: string | null; localRef: string }>
}

const ok = (value: unknown): OpsResult => ({ ok: true, value })
const fail = (code: string, message: string): OpsResult => ({ ok: false, error: { code, message } })


/** 精简按键映射(单字符自动推导;对齐 playwright usKeyboardLayout 常用子集)。 */
const KEY_DEFS: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  ' ': { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  Control: { key: 'Control', code: 'ControlLeft', vk: 17 },
  Alt: { key: 'Alt', code: 'AltLeft', vk: 18 },
  Shift: { key: 'Shift', code: 'ShiftLeft', vk: 16 },
  Meta: { key: 'Meta', code: 'MetaLeft', vk: 91 },
}

export function createBrowserOps(deps: BrowserOpsDeps) {
  const sessions = new WeakMap<OpsWebContents, OpsSession>()
  const detachHooked = new WeakSet<OpsWebContents>()

  /** 单条 CDP 命令,统一超时兜底(mouseMoved/mouseWheel 类挂死不拖死整个 op)。 */
  async function cdp(wc: OpsWebContents, method: string, params?: Record<string, unknown>, timeoutMs = 5000): Promise<any> {
    const sent = wc.debugger.sendCommand(method, params ?? {})
    const result = await Promise.race([
      Promise.resolve(sent) as Promise<unknown>,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`cdp ${method} timed out (${timeoutMs}ms)`)), timeoutMs)
      }),
    ])
    return result
  }

  /** CDP 异常 → OpsResult(超时/挂死给 timeout 码)。 */
  function toResult(cause: unknown, code = 'execution_error'): OpsResult {
    const message = cause instanceof Error ? cause.message : String(cause)
    return fail(message.includes('timed out') ? 'timeout' : code, message)
  }

  /** agent 输入前窗口必须前台可见(最小化/隐藏时 Chromium 挂起整窗输入)。 */
  function ensureWindowSurface(): void {
    const win = deps.findWindow()
    if (win === undefined || win.isDestroyed()) return
    if (!win.isVisible() || win.isMinimized()) {
      try { win.restore(); win.show() } catch { /* 已销毁等场景忽略 */ }
    }
  }

  async function ensureAttached(wc: OpsWebContents): Promise<OpsSession> {
    let session = sessions.get(wc)
    if (session === undefined) {
      session = { attached: false, frameId: null, contextId: null, children: new Map(), refMap: new Map() }
      sessions.set(wc, session)
    }
    if (!session.attached) {
      wc.debugger.attach('1.3')
      // 外部 detach(如用户打开 DevTools)后下次 op 自动重 attach;context 作废。
      if (!detachHooked.has(wc)) {
        detachHooked.add(wc)
        wc.debugger.on('detach', () => {
          const s = sessions.get(wc)
          if (s !== undefined) {
            s.attached = false
            s.frameId = null
            s.contextId = null
            s.children.clear()
            s.refMap.clear()
          }
        })
      }
      await Promise.all([
        cdp(wc, 'Page.enable', undefined, 8000),
        cdp(wc, 'Runtime.enable', undefined, 8000),
        cdp(wc, 'DOM.enable', undefined, 8000),
      ])
      session.attached = true
    }
    if (session.frameId === null) {
      const tree = await cdp(wc, 'Page.getFrameTree', undefined, 8000)
      session.frameId = (tree as { frameTree?: { frame?: { id?: string } } })?.frameTree?.frame?.id ?? null
      if (session.frameId === null) throw new Error('unable to resolve main frame id')
    }
    return session
  }

  /** 确保注入实例存活;导航后 world context 失效时重建(轻探针每 op 校验)。 */
  async function ensureWorld(wc: OpsWebContents, session: OpsSession): Promise<number> {
    if (session.contextId !== null) {
      try {
        const alive = await cdp(wc, 'Runtime.evaluate', { expression: WORLD_ALIVE_PROBE, contextId: session.contextId, returnByValue: true }, 3000)
        if ((alive as { result?: { value?: unknown } })?.result?.value === true) return session.contextId
      } catch { /* context 失效,重建 */ }
      session.contextId = null
    }
    const world = await cdp(wc, 'Page.createIsolatedWorld', { frameId: session.frameId, grantUniveralAccess: false, worldName: WORLD_NAME }, 8000)
    const contextId = (world as { executionContextId?: number }).executionContextId
    if (typeof contextId !== 'number') throw new Error('unable to create locator world')
    await injectIntoContext(wc, contextId)
    session.contextId = contextId
    return contextId
  }

  /**
   * 在指定 executionContext 注入 InjectedScript 实例(幂等)。
   * source 经 Runtime.callFunctionOn 以 JSON 参数传入(不经代码字符串形态):
   * tsdown/rolldown 会把「字符串常量拼接」折叠回模板字面量且不转义其中的
   * `${`/反引号(实测注入 26 项全挂的根因),参数传递彻底绕开该重写;
   * eval(src) 是直接 eval,在函数作用域内求值,module 变量可见。
   */
  async function injectIntoContext(wc: OpsWebContents, contextId: number): Promise<void> {
    const created = await cdp(wc, 'Runtime.callFunctionOn', {
      functionDeclaration: '(function (src, cfg, gname) {'
        + 'if (globalThis[gname]) return true;'
        + 'var module = { exports: {} };'
        + 'eval(src);'
        // 该 source 的 __export 是简化版(target[name] = all[name]):
        // InjectedScript 导出为箭头函数 getter,需先调用取得类再 new。
        + 'globalThis[gname] = new (module.exports.InjectedScript())(globalThis, cfg);'
        + 'return true'
        + '})',
      arguments: [{ value: INJECTED_SCRIPT_SOURCE }, { value: INJECT_CONFIG }, { value: INJECTED_GLOBAL }],
      executionContextId: contextId,
      returnByValue: true,
    }, 20000)
    if ((created as { result?: { value?: unknown } })?.result?.value !== true) throw new Error('unable to initialize playwright injected runtime')
  }

  /** world 内求值(returnByValue;exceptionDetails 转错误消息)。 */
  async function evalWorld(wc: OpsWebContents, session: OpsSession, expression: string, timeoutMs = 10000): Promise<any> {
    const contextId = await ensureWorld(wc, session)
    return evalInContext(wc, contextId, expression, timeoutMs)
  }

  /** 指定 executionContext 求值(returnByValue;exceptionDetails 转错误消息)。 */
  async function evalInContext(wc: OpsWebContents, contextId: number, expression: string, timeoutMs = 10000): Promise<any> {
    const response = await cdp(wc, 'Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, timeoutMs)
    const detail = (response as { exceptionDetails?: { exception?: { description?: string; value?: unknown }; text?: string } }).exceptionDetails
    if (detail !== undefined) {
      const message = detail.exception?.description ?? (typeof detail.exception?.value === 'string' ? detail.exception.value : undefined) ?? detail.text ?? 'world evaluation failed'
      throw new Error(message)
    }
    return (response as { result?: { value?: unknown } })?.result?.value
  }

  /** frameId null = 主 frame world;否则 child frame 的 world(惰性建,失效重建)。 */
  async function evalFrameWorld(wc: OpsWebContents, session: OpsSession, frameId: string | null, expression: string, timeoutMs = 10000): Promise<any> {
    if (frameId === null) return evalWorld(wc, session, expression, timeoutMs)
    let child = session.children.get(frameId)
    if (child === undefined) {
      child = { contextId: null }
      session.children.set(frameId, child)
    }
    if (child.contextId !== null) {
      try {
        const alive = await cdp(wc, 'Runtime.evaluate', { expression: WORLD_ALIVE_PROBE, contextId: child.contextId, returnByValue: true }, 3000)
        if ((alive as { result?: { value?: unknown } })?.result?.value === true) return evalInContext(wc, child.contextId, expression, timeoutMs)
      } catch { /* context 失效,重建 */ }
      child.contextId = null
    }
    const world = await cdp(wc, 'Page.createIsolatedWorld', { frameId, grantUniveralAccess: false, worldName: WORLD_NAME }, 8000)
    const contextId = (world as { executionContextId?: number }).executionContextId
    if (typeof contextId !== 'number') throw new Error(`unable to create locator world for frame ${frameId}`)
    await injectIntoContext(wc, contextId)
    child.contextId = contextId
    return evalInContext(wc, contextId, expression, timeoutMs)
  }

  /**
   * ref/selector → 目标 frame + world 内 selector。ref 优先查全局 refMap
   * (snapshot 重编号时建立)路由到所属 frame;params.frameId('f:<frameId>')
   * 可显式指定 frame;默认主 frame。
   */
  function targetFrom(session: OpsSession, params: Record<string, unknown>): { selector: string; frameId: string | null } {
    const ref = typeof params.ref === 'string' && params.ref !== '' ? params.ref : undefined
    if (ref !== undefined) {
      const mapped = session.refMap.get(ref)
      if (mapped !== undefined) return { selector: mapped.localRef.startsWith('aria-ref=') ? mapped.localRef : `aria-ref=${mapped.localRef}`, frameId: mapped.frameId }
      return { selector: ref.startsWith('aria-ref=') ? ref : `aria-ref=${ref}`, frameId: null }
    }
    const frameId = typeof params.frameId === 'string' && params.frameId.startsWith('f:') ? params.frameId.slice(2) : null
    const selector = typeof params.selector === 'string' && params.selector !== '' ? params.selector : undefined
    return { selector: selector ?? '', frameId }
  }

  /**
   * iframe 坐标换算:child frame 内元素的 getBoundingClientRect 相对该 frame
   * 视口,须叠加父 frame 中 <iframe> 元素的位置(DOM.getFrameOwner → resolveNode
   * → callFunctionOn 取 owner rect)。一层换算覆盖绝大多数场景。
   */
  async function offsetForFrame(wc: OpsWebContents, frameId: string | null): Promise<{ dx: number; dy: number }> {
    if (frameId === null) return { dx: 0, dy: 0 }
    try {
      const owner = await cdp(wc, 'DOM.getFrameOwner', { frameId }, 5000)
      const backendNodeId = (owner as { backendNodeId?: number })?.backendNodeId
      if (typeof backendNodeId !== 'number') return { dx: 0, dy: 0 }
      const node = await cdp(wc, 'DOM.resolveNode', { backendNodeId }, 5000)
      const objectId = (node as { object?: { objectId?: string } })?.object?.objectId
      if (objectId === undefined) return { dx: 0, dy: 0 }
      const rectResp = await cdp(wc, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: '(function () { const r = this.getBoundingClientRect(); return JSON.stringify({ left: r.left, top: r.top }) })',
        returnByValue: true,
      }, 5000)
      const rect = JSON.parse(String((rectResp as { result?: { value?: unknown } })?.result?.value ?? '{}')) as { left?: number; top?: number }
      return { dx: Math.round(rect.left ?? 0), dy: Math.round(rect.top ?? 0) }
    } catch {
      return { dx: 0, dy: 0 }
    }
  }

  /** 快照 YAML 重编号:各 frame 的 [ref=eN] 全局唯一化并记录路由映射。 */
  function renumberRefs(yaml: string, frameId: string | null, counter: { n: number }, map: Map<string, { frameId: string | null; localRef: string }>): string {
    return yaml.replace(/\[ref=(e\d+)\]/g, (_m, localRef: string) => {
      const globalRef = 'e' + counter.n
      counter.n += 1
      map.set(globalRef, { frameId, localRef })
      return `[ref=${globalRef}]`
    })
  }

  /**
   * child frame 内点击:OOPIF(跨源 iframe)是独立进程 target,主 frame 的
   * Input.dispatchMouseEvent 不转发进 iframe(实测坐标命中但不触发 onclick);
   * 用 world 内合成 click(DOM 层 mousedown/mouseup + el.click()),onclick 等
   * handler 可靠触发。scrollIntoView 先把元素滚进 iframe 视口。
   */
  async function frameClick(wc: OpsWebContents, session: OpsSession, frameId: string, selector: string): Promise<{ found: boolean; tag?: string }> {
    const r = await evalFrameWorld(wc, session, frameId, `(() => {
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, view: el.ownerDocument.defaultView }
      el.dispatchEvent(new MouseEvent('mousedown', opts))
      el.dispatchEvent(new MouseEvent('mouseup', opts))
      el.click()
      return { found: true, tag: el.tagName.toLowerCase() }
    })()`, 8000)
    return (r ?? { found: false }) as { found: boolean; tag?: string }
  }

  /** 解析 ref/selector → 校验可交互 → 返回元素中心与描述(click 前置共用;frame 感知)。 */
  async function resolveActionable(wc: OpsWebContents, session: OpsSession, selector: string, states: string[], frameId: string | null = null): Promise<{ x: number; y: number; tag: string; text: string }> {
    const probe = await evalFrameWorld(wc, session, frameId, `(async () => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      // 1.59 的 checkElementStates 返回 Promise,须 await(awaitPromise 会等最外层)。
      const problem = inj.checkElementStates ? await inj.checkElementStates(el, ${JSON.stringify(states)}) : null
      if (problem) return { found: true, problem: String(problem) }
      const r = el.getBoundingClientRect()
      return {
        found: true,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 120),
      }
    })()`, 10000)
    if (probe === null || typeof probe !== 'object') throw new Error('element probe failed')
    if (probe.found !== true) throw new Error(`element not found: ${selector}`)
    if (probe.problem) throw new Error(`element not actionable: ${probe.problem}`)
    // child frame 内坐标叠加父 iframe 元素偏移(Input 是页面级 hit test,须视口坐标)。
    const offset = await offsetForFrame(wc, frameId)
    return { x: Math.round(probe.x) + offset.dx, y: Math.round(probe.y) + offset.dy, tag: probe.tag, text: probe.text }
  }

  /** 真实按下/抬起(完整 click;绝不发 mouseMoved——挂死坑,见模块注释)。 */
  async function dispatchClick(wc: OpsWebContents, x: number, y: number, button = 'left', double = false): Promise<void> {
    const round = (clickCount: number): Promise<void> => (async () => {
      await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: 1, clickCount }, 5000)
      await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount }, 5000)
    })()
    await round(1)
    if (double) await round(2)
  }

  /** 键序:keydown(带 text,单字符靠它落字)→ keyup;keyDown 已插入字符,不再发 char(会双写)。 */
  async function dispatchKey(wc: OpsWebContents, key: string, modifiers = 0): Promise<void> {
    const upper = key.length === 1 ? key.toUpperCase() : ''
    const def = KEY_DEFS[key] ?? (key.length === 1 ? { key, code: upper === key ? '' : `Key${upper}`, vk: upper.charCodeAt(0), text: key } : undefined)
    if (def === undefined) throw new Error(`unsupported key: ${key}`)
    const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers }
    await cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(def.text !== undefined ? { text: def.text } : {}) }, 5000)
    await cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base }, 5000)
  }

  /* ── 各 op 实现 ────────────────────────────────────────────────── */

  async function opSnapshot(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const mode = params.mode === 'yaml' ? 'yaml' : 'ai'
    const ref = typeof params.ref === 'string' && params.ref !== '' ? params.ref : undefined
    // 局部快照(ref 定位到具体元素):在 ref 所属 frame 的 world 内执行。
    if (ref !== undefined) {
      const tgt = targetFrom(session, { ref })
      const yaml = await evalFrameWorld(wc, session, tgt.frameId, `(() => {
        const inj = globalThis.${INJECTED_GLOBAL}
        const target = ${QUERY_ONE(tgt.selector)} ?? document.body
        return inj.ariaSnapshot(target, { mode: ${JSON.stringify(mode)} })
      })()`, 20000)
      return ok({ mode, yaml: typeof yaml === 'string' ? yaml : String(yaml ?? '') })
    }
    // 全页快照:主 frame + 各 child frame(iframe)分段合并,[ref=eN] 全局唯一化,
    // 映射存 session.refMap 供后续 op 的 ref 路由(iframe 支持)。
    const counter = { n: 1 }
    const map = new Map<string, { frameId: string | null; localRef: string }>()
    const mainYaml = await evalFrameWorld(wc, session, null, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      return inj.ariaSnapshot(document.body, { mode: ${JSON.stringify(mode)} })
    })()`, 20000)
    let yaml = renumberRefs(typeof mainYaml === 'string' ? mainYaml : String(mainYaml ?? ''), null, counter, map)
    const childFrames: Array<{ frameId: string; url: string }> = []
    const collect = (node: unknown): void => {
      const n = node as { childFrames?: Array<{ frame?: { id?: string; url?: string }; childFrames?: unknown[] }> }
      for (const c of n?.childFrames ?? []) {
        if (c?.frame?.id !== undefined) childFrames.push({ frameId: c.frame.id, url: String(c.frame.url ?? '') })
        collect(c)
      }
    }
    const tree = await cdp(wc, 'Page.getFrameTree', undefined, 8000)
    collect((tree as { frameTree?: unknown }).frameTree)
    for (const cf of childFrames) {
      try {
        const childYaml = await evalFrameWorld(wc, session, cf.frameId, `(() => {
          const inj = globalThis.${INJECTED_GLOBAL}
          return inj.ariaSnapshot(document.body, { mode: ${JSON.stringify(mode)} })
        })()`, 20000)
        yaml += `\n\n[frame f:${cf.frameId} url=${cf.url}]\n` + renumberRefs(String(childYaml ?? ''), cf.frameId, counter, map)
      } catch (cause) {
        yaml += `\n\n[frame f:${cf.frameId} url=${cf.url}] 快照失败: ${cause instanceof Error ? cause.message : String(cause)}`
      }
    }
    session.refMap = map
    return ok({ mode, yaml, frames: childFrames.length })
  }

  async function opElementInfo(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const tgt = targetFrom(session, params)
    if (tgt.selector === '') return fail('bad_params', 'elementInfo 需要 ref 或 selector')
    const info = await evalFrameWorld(wc, session, tgt.frameId, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${QUERY_ONE(tgt.selector)}
      if (el === null) return null
      const r = el.getBoundingClientRect()
      const tag = el.tagName.toLowerCase()
      return {
        tag,
        id: el.id || undefined,
        classes: typeof el.className === 'string' ? el.className.split(/\\s+/).filter(Boolean) : undefined,
        role: el.getAttribute('role') || undefined,
        name: el.getAttribute('aria-label') || undefined,
        text: (el.textContent || '').trim().slice(0, 300) || undefined,
        value: 'value' in el ? String(el.value).slice(0, 300) : undefined,
        href: tag === 'a' ? el.getAttribute('href') || undefined : undefined,
        disabled: 'disabled' in el ? el.disabled === true : undefined,
        checked: 'checked' in el ? el.checked === true : undefined,
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        selector: inj.generateSelectorSimple ? inj.generateSelectorSimple(el) : undefined,
      }
    })()`, 10000)
    if (info === null || info === undefined) return fail('not_found', `element not found: ${tgt.selector}`)
    return ok(info)
  }

  async function opClick(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const { selector, frameId } = targetFrom(session, params)
    if (selector === '') return fail('bad_params', 'click 需要 ref 或 selector')
    ensureWindowSurface()
    // child frame(OOPIF):Input 不从主 frame 转发,用 world 内合成 click。
    if (frameId !== null) {
      await deps.prepareTabSurface(tabId)
      try {
        const r = await frameClick(wc, session, frameId, selector)
        if (r.found !== true) return fail('not_found', `element not found in frame: ${selector}`)
        return ok({ frame: frameId, clicked: true, tag: r.tag })
      } finally {
        deps.restoreTabSurface(tabId)
      }
    }
    // 不含 'stable':它需要 rAF 两帧,屏外/隐藏视图的 rAF 挂起会永不完成
    // (agent 无 carrier 标签常在屏外);visible/enabled 是同步检查。
    await deps.prepareTabSurface(tabId)
    try {
      const probe = await resolveActionable(wc, session, selector, ['visible', 'enabled'], frameId)
      await dispatchClick(wc, probe.x, probe.y, typeof params.button === 'string' ? params.button : 'left', params.double === true)
      return ok({ x: probe.x, y: probe.y, tag: probe.tag, text: probe.text })
    } finally {
      deps.restoreTabSurface(tabId)
    }
  }

  /** fill/type 共用:真实 click 聚焦 → injected.fill 设值 → 'needsinput' 补 insertText → 校验兜底。 */
  async function opFill(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const { selector, frameId } = targetFrom(session, params)
    const text = typeof params.text === 'string' ? params.text : typeof params.value === 'string' ? params.value : undefined
    if (selector === '' || text === undefined) return fail('bad_params', 'fill/type 需要 ref|selector 与 text')
    ensureWindowSurface()
    await deps.prepareTabSurface(tabId)
    try {
      // 先聚焦:主 frame 用真实 click(Input 管线);child frame 用 world 内
      // focusNode(OOPIF 的 Input 不转发,且 insertText 也到不了 child——
      // needsinput 时 child frame 直接靠末尾的 objectId 设值兜底)。
      if (frameId !== null) {
        await evalFrameWorld(wc, session, frameId, `(() => {
          const el = ${QUERY_ONE(selector)}
          if (el === null) return false
          el.scrollIntoView({ block: 'center' })
          el.focus()
          return true
        })()`, 8000)
      } else {
        const focusProbe = await resolveActionable(wc, session, selector, ['visible', 'enabled'], frameId)
        await dispatchClick(wc, focusProbe.x, focusProbe.y)
      }
      const fillResult = await evalFrameWorld(wc, session, frameId, `(() => {
        const inj = globalThis.${INJECTED_GLOBAL}
        const el = ${QUERY_ONE(selector)}
        if (el === null) return { found: false }
        return { found: true, result: inj.fill(el, ${JSON.stringify(text)}) }
      })()`, 10000)
      if (fillResult === null || typeof fillResult !== 'object' || fillResult.found !== true) return fail('not_found', `element not found: ${selector}`)
      if (typeof fillResult.result === 'string' && fillResult.result.startsWith('error:')) return fail('not_fillable', fillResult.result)
      if (fillResult.result === 'needsinput' && frameId === null) {
        await cdp(wc, 'Input.insertText', { text }, 5000)
      }
    } finally {
      deps.restoreTabSurface(tabId)
    }
    // 校验读回;insertText 因焦点链落空时,用 objectId + callFunctionOn 主世界设值兜底。
    const readBack = await evalFrameWorld(wc, session, frameId, `(() => {
      const el = ${QUERY_ONE(selector)}
      return el === null ? null : ('value' in el ? String(el.value).slice(0, 300) : (el.textContent || '').slice(0, 300))
    })()`, 5000)
    if (readBack !== text) {
      // objectId 兜底:元素须在所属 frame 的 world 里解析(child frame 时 contextId 不同)。
      const frameCtx = frameId === null
        ? session.contextId
        : session.children.get(frameId)?.contextId ?? null
      if (frameCtx === null) return fail('not_found', `element not found: ${selector}`)
      const holder = await cdp(wc, 'Runtime.evaluate', { expression: QUERY_ONE(selector), contextId: frameCtx, returnByValue: false }, 5000)
      const objectId = (holder as { result?: { objectId?: string } })?.result?.objectId
      if (objectId === undefined) return fail('not_found', `element not found: ${selector}`)
      await cdp(wc, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: '(function (text) {'
          + 'if (this.isContentEditable === true) { this.textContent = text }'
          + 'else { const proto = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;'
          + 'if (typeof Object.getOwnPropertyDescriptor(proto, "value")?.set !== "function") return "not-fillable";'
          + 'Object.getOwnPropertyDescriptor(proto, "value").set.call(this, text) }'
          + 'this.dispatchEvent(new Event("input", { bubbles: true }));'
          + 'this.dispatchEvent(new Event("change", { bubbles: true }));'
          + 'return "filled" })',
        arguments: [{ value: text }],
        returnByValue: true,
      }, 5000)
    }
    const value = await evalFrameWorld(wc, session, frameId, `(() => {
      const el = ${QUERY_ONE(selector)}
      return el === null ? null : ('value' in el ? String(el.value).slice(0, 300) : (el.textContent || '').slice(0, 300))
    })()`, 5000)
    return ok({ filled: true, value: value ?? null })
  }

  async function opPress(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const key = typeof params.key === 'string' ? params.key : undefined
    if (key === undefined) return fail('bad_params', 'press 需要 key')
    const { selector, frameId } = targetFrom(session, params)
    ensureWindowSurface()
    // 聚焦点击与按键必须同一表面唤醒周期:restore 会丢 Chromium 焦点,
    // 分开两个周期时按键落到无焦点视图被丢弃(实测)。
    deps.prepareTabSurface(tabId)
    try {
      const modifiers = typeof params.modifiers === 'number' ? params.modifiers : 0
      const keys = key.includes('+') ? key.split('+') : [key]
      if (frameId !== null) {
        // OOPIF:world 内聚焦 + 合成 KeyboardEvent(浏览器默认行为如表单提交不触发,
        // best-effort);真实 dispatchKey 只到主 frame。
        if (selector !== '') {
          await evalFrameWorld(wc, session, frameId, `(() => {
            const el = ${QUERY_ONE(selector)}
            if (el === null) return false
            el.scrollIntoView({ block: 'center' }); el.focus()
            return true
          })()`, 8000)
        }
        for (const single of keys) {
          await evalFrameWorld(wc, session, frameId, `(() => {
            const el = document.activeElement ?? document.body
            el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(single)}, bubbles: true, cancelable: true }))
            el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(single)}, bubbles: true }))
            return true
          })()`, 8000)
        }
      } else {
        if (selector !== '') {
          const probe = await resolveActionable(wc, session, selector, ['visible', 'enabled'], frameId)
          await dispatchClick(wc, probe.x, probe.y)
        }
        for (const single of keys) await dispatchKey(wc, single, modifiers)
      }
    } finally {
      deps.restoreTabSurface(tabId)
    }
    return ok({ pressed: key })
  }

  async function opHover(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const { selector, frameId } = targetFrom(session, params)
    if (selector === '') return fail('bad_params', 'hover 需要 ref 或 selector')
    // 真实 mouseMoved 在屏外/隐藏/遮挡视图上永久挂死(不可恢复),这里用合成
    // mouseover/mousemove/mouseenter best-effort(与 CLI 既有 hover 语义一致)。
    const result = await evalFrameWorld(wc, session, frameId, `(() => {
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      const r = el.getBoundingClientRect()
      const opts = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
      el.dispatchEvent(new MouseEvent('mouseover', opts))
      el.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }))
      el.dispatchEvent(new MouseEvent('mousemove', opts))
      return { found: true, tag: el.tagName.toLowerCase() }
    })()`, 5000)
    if (result === null || typeof result !== 'object' || result.found !== true) return fail('not_found', `element not found: ${selector}`)
    return ok(result)
  }

  async function opScroll(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const dx = typeof params.x === 'number' ? Math.round(params.x) : 0
    const dy = typeof params.y === 'number' ? Math.round(params.y) : 0
    if (dx === 0 && dy === 0) return fail('bad_params', 'scroll 需要 x 或 y')
    const { selector, frameId } = targetFrom(session, params)
    ensureWindowSurface()
    const result = await evalFrameWorld(wc, session, frameId, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${selector === '' ? 'null' : QUERY_ONE(selector)}
      const target = el ?? document.scrollingElement ?? document.documentElement
      if (target === null) return { ok: false, error: 'no scroll target' }
      target.scrollBy(${dx}, ${dy})
      return { ok: true, scrollTop: target.scrollTop, scrollLeft: target.scrollLeft }
    })()`, 5000)
    if (result === null || typeof result !== 'object' || result.ok !== true) return fail('scroll_failed', result?.error ?? 'scroll failed')
    return ok(result)
  }

  async function opSelect(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const { selector, frameId } = targetFrom(session, params)
    const values = Array.isArray(params.values) ? params.values.filter((v): v is string => typeof v === 'string') : undefined
    if (selector === '' || values === undefined || values.length === 0) return fail('bad_params', 'select 需要 ref|selector 与 values(字符串数组)')
    ensureWindowSurface()
    const result = await evalFrameWorld(wc, session, frameId, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      if (el.tagName.toLowerCase() !== 'select') return { found: true, error: 'element is not a <select>' }
      const picked = inj.selectOptions(el, ${JSON.stringify(values)}.map((v) => ({ valueOrLabel: v })))
      return { found: true, picked: Array.isArray(picked) ? picked.map((o) => String(o.value ?? o.label ?? '')) : [] }
    })()`, 10000)
    if (result === null || typeof result !== 'object' || result.found !== true) return fail('not_found', `element not found: ${selector}`)
    if (result.error) return fail('not_select', result.error)
    return ok(result)
  }

  /** check/uncheck:读状态,需要时走真实 click(checkbox/radio 原生切换)。 */
  async function opCheck(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>, desired: boolean): Promise<OpsResult> {
    const { selector, frameId } = targetFrom(session, params)
    if (selector === '') return fail('bad_params', `${desired ? 'check' : 'uncheck'} 需要 ref 或 selector`)
    ensureWindowSurface()
    const probe = await evalFrameWorld(wc, session, frameId, `(() => {
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      if (!('checked' in el)) return { found: true, error: 'element has no checked state' }
      if (el.disabled === true) return { found: true, error: 'element is disabled' }
      return { found: true, checked: el.checked === true }
    })()`, 5000)
    if (probe === null || typeof probe !== 'object' || probe.found !== true) return fail('not_found', `element not found: ${selector}`)
    if (probe.error) return fail('not_checkable', probe.error)
    if (probe.checked !== desired) {
      await deps.prepareTabSurface(tabId)
      try {
        if (frameId !== null) {
          // OOPIF:world 内合成 click(checkbox 原生切换由 click 触发)。
          await frameClick(wc, session, frameId, selector)
        } else {
          const actionable = await resolveActionable(wc, session, selector, ['visible', 'enabled'], frameId)
          await dispatchClick(wc, actionable.x, actionable.y)
        }
      } finally {
        deps.restoreTabSurface(tabId)
      }
    }
    return ok({ checked: desired })
  }

  async function opEvaluate(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const expression = typeof params.expression === 'string' ? params.expression : typeof params.code === 'string' ? params.code : undefined
    if (expression === undefined || expression.trim() === '') return fail('bad_params', 'evaluate 需要 expression')
    const isolated = params.isolated !== false
    const timeoutMs = typeof params.timeoutMs === 'number' ? Math.min(60000, Math.max(1000, params.timeoutMs)) : 25000
    // params.frameId('f:<frameId>') 可选:在指定 child frame 的 world 里求值。
    const frameId = typeof params.frameId === 'string' && params.frameId.startsWith('f:') ? params.frameId.slice(2) : null
    if (isolated) {
      try {
        return ok({ value: (await evalFrameWorld(wc, session, frameId, expression, timeoutMs)) ?? null })
      } catch (cause) {
        return toResult(cause)
      }
    }
    const response = await cdp(wc, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs).catch(cause => { throw new Error(cause instanceof Error ? cause.message : String(cause)) })
    const detail = (response as { exceptionDetails?: { exception?: { description?: string }; text?: string } }).exceptionDetails
    if (detail !== undefined) return fail('execution_error', detail.exception?.description ?? detail.text ?? 'evaluation failed')
    return ok({ value: (response as { result?: { value?: unknown } })?.result?.value ?? null })
  }

  /** playwright op(参考实现 语义薄转调):domSnapshot / elementInfo / evaluate / locator。 */
  async function opPlaywright(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const action = typeof params.action === 'string' ? params.action : ''
    switch (action) {
      case 'domSnapshot': return opSnapshot(wc, session, params)
      case 'elementInfo': return opElementInfo(wc, session, params)
      case 'evaluate': return opEvaluate(wc, session, params)
      case 'locator': {
        const inner = typeof params.locatorAction === 'string' ? params.locatorAction : ''
        switch (inner) {
          case 'click': return opClick(wc, session, tabId, params)
          case 'fill': case 'type': return opFill(wc, session, tabId, params)
          case 'press': return opPress(wc, session, tabId, params)
          case 'selectOption': return opSelect(wc, session, { ...params, values: params.values ?? params.options })
          case 'check': return opCheck(wc, session, tabId, params, true)
          case 'uncheck': return opCheck(wc, session, tabId, params, false)
          default: return fail('capability_unsupported', `playwright.locator.${inner || '?'} 不支持(可用 click/fill/type/press/selectOption/check/uncheck)`)
        }
      }
      default: return fail('capability_unsupported', `playwright.${action || '?'} 不支持(可用 domSnapshot/elementInfo/evaluate/locator)`)
    }
  }

  /* ── waitFor / drag / cua / 对话框 ────────────────────────────── */

  /** Host 侧轮询等待:selector 的可见性状态或表达式为真;不用 'stable'(rAF 挂死坑)。 */
  async function opWaitFor(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const timeoutMs = Math.min(60000, Math.max(500, typeof params.timeoutMs === 'number' ? params.timeoutMs : 10000))
    const pollMs = Math.min(1000, Math.max(150, typeof params.pollMs === 'number' ? params.pollMs : 300))
    const expression = typeof params.expression === 'string' && params.expression.trim() !== '' ? params.expression : undefined
    const { selector, frameId } = targetFrom(session, params)
    const state = typeof params.state === 'string' ? params.state : 'visible'
    if (expression === undefined && selector === '') return fail('bad_params', 'waitFor 需要 ref|selector 或 expression')
    if (expression === undefined && !['visible', 'hidden', 'attached', 'detached'].includes(state)) {
      return fail('bad_params', `waitFor state 不支持: ${state}(visible/hidden/attached/detached)`)
    }
    const deadline = Date.now() + timeoutMs
    const check = expression !== undefined
      ? `(() => { const v = (${expression}); return { hit: Boolean(v), detail: String(v).slice(0, 120) } })()`
      : `(() => {
        const el = ${QUERY_ONE(selector as string)}
        const attached = el !== null
        const visible = attached && el.getClientRects().length > 0
        return { hit: ${state === 'visible' ? 'visible' : state === 'hidden' ? '!visible' : state === 'attached' ? 'attached' : '!attached'}, detail: 'attached=' + attached + ' visible=' + visible }
      })()`
    for (;;) {
      try {
        const r = await evalFrameWorld(wc, session, frameId, check, 5000)
        if (r !== null && typeof r === 'object' && r.hit === true) return ok({ state: expression ? 'expression' : state, detail: r.detail })
      } catch { /* 单次轮询失败(导航中/世界重建)不算超时,继续 */ }
      if (Date.now() > deadline) return fail('timeout', `waitFor ${expression ? 'expression' : `${state} ${selector}`} 超时 (${timeoutMs}ms)`)
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  }

  /** ref/selector/坐标 → 屏幕点(drag 与 cua 共用;坐标即视口 CSS 像素)。 */
  async function resolvePoint(wc: OpsWebContents, session: OpsSession, spec: unknown): Promise<{ x: number; y: number }> {
    if (spec !== null && typeof spec === 'object') {
      const sx = (spec as Record<string, unknown>).x
      const sy = (spec as Record<string, unknown>).y
      if (typeof sx === 'number' && typeof sy === 'number') return { x: Math.round(sx), y: Math.round(sy) }
      const tgt = targetFrom(session, spec as Record<string, unknown>)
      if (tgt.selector !== '') {
        const probe = await resolveActionable(wc, session, tgt.selector, ['visible', 'enabled'], tgt.frameId)
        return { x: probe.x, y: probe.y }
      }
    }
    throw new Error('需要 {ref|selector} 或 {x,y} 坐标')
  }

  async function opDrag(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    ensureWindowSurface()
    await deps.prepareTabSurface(tabId)
    try {
      const from = await resolvePoint(wc, session, params.from)
      const to = await resolvePoint(wc, session, params.to)
      const steps = Math.min(30, Math.max(2, typeof params.steps === 'number' ? params.steps : 8))
      const button = typeof params.button === 'string' ? params.button : 'left'
      // 表面唤醒后视图可见,mouseMoved 序列可用(可见性是挂死条件的反面);
      // 单步 1.5s 超时兜底,挂死时快速失败而不是卡满整个 op。
      await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button, buttons: 1, clickCount: 1 }, 5000)
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + ((to.x - from.x) * i) / steps)
        const y = Math.round(from.y + ((to.y - from.y) * i) / steps)
        await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button, buttons: 1 }, 1500)
      }
      await cdp(wc, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button, buttons: 0, clickCount: 1 }, 5000)
      return ok({ from, to, steps })
    } finally {
      deps.restoreTabSurface(tabId)
    }
  }

  /** CUA 坐标模式(参考实现 cuaClick/cuaScroll/cuaKeypress/cuaDrag 对应):直接给视口坐标。 */
  async function opCua(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const action = typeof params.action === 'string' ? params.action : ''
    ensureWindowSurface()
    switch (action) {
      case 'click': {
        const x = Math.round(typeof params.x === 'number' ? params.x : NaN)
        const y = Math.round(typeof params.y === 'number' ? params.y : NaN)
        if (!Number.isFinite(x) || !Number.isFinite(y)) return fail('bad_params', 'cua click 需要 x/y 坐标')
        const double = params.double === true
        await deps.prepareTabSurface(tabId)
        try {
          await dispatchClick(wc, x, y, typeof params.button === 'string' ? params.button : 'left', double)
        } finally {
          deps.restoreTabSurface(tabId)
        }
        return ok({ action, x, y })
      }
      case 'scroll': {
        const dx = Math.round(typeof params.xDelta === 'number' ? params.xDelta : 0)
        const dy = Math.round(typeof params.yDelta === 'number' ? params.yDelta : 0)
        if (dx === 0 && dy === 0) return fail('bad_params', 'cua scroll 需要 xDelta/yDelta')
        // 视口滚动用主世界 scrollBy:mouseWheel 在垫层/屏外视图上实测静默无效,
        // scrollBy 是稳定等效路径(参考实现 domCuaScroll 同为 JS 滚动)。
        const resp = await cdp(wc, 'Runtime.evaluate', {
          expression: `window.scrollBy(${dx}, ${dy}); JSON.stringify({ scrollY: window.scrollY, scrollX: window.scrollX })`,
          returnByValue: true,
        }, 5000)
        const detail = (resp as { exceptionDetails?: { exception?: { description?: string } } }).exceptionDetails
        if (detail !== undefined) return fail('execution_error', detail.exception?.description ?? 'scroll failed')
        return ok({ action, dx, dy, detail: (resp as { result?: { value?: unknown } })?.result?.value })
      }
      case 'keypress': {
        const keys = typeof params.keys === 'string' ? params.keys.split('+') : Array.isArray(params.keys) ? params.keys.filter((k): k is string => typeof k === 'string') : []
        if (keys.length === 0) return fail('bad_params', 'cua keypress 需要 keys')
        const modifiers = typeof params.modifiers === 'number' ? params.modifiers : 0
        const focusTarget = targetFrom(session, params)
        await deps.prepareTabSurface(tabId)
        try {
          // 可选聚焦:restore 会丢 Chromium 焦点,聚焦点击与按键必须同一周期。
          if (focusTarget.selector !== '') {
            const probe = await resolveActionable(wc, session, focusTarget.selector, ['visible', 'enabled'], focusTarget.frameId)
            await dispatchClick(wc, probe.x, probe.y)
          }
          for (const single of keys) await dispatchKey(wc, single, modifiers)
        } finally {
          deps.restoreTabSurface(tabId)
        }
        return ok({ action, keys })
      }
      case 'drag': return opDrag(wc, session, tabId, params)
      default: return fail('capability_unsupported', `cua.${action || '?'} 不支持(可用 click/scroll/keypress/drag)`)
    }
  }

  /**
   * 对话框:JS 对话框由页面垫片自动应答(同步阻塞无法等 agent),agent 侧用
   * handleDialog 预设下一次对话框的应答(一次性消费),getDialog 读历史。
   */
  async function opGetDialog(wc: OpsWebContents, params: Record<string, unknown>): Promise<OpsResult> {
    const unreadOnly = params.unread === true
    const response = await cdp(wc, 'Runtime.evaluate', {
      expression: `(() => {
        const h = (globalThis.__liuliDialogHistory || []).slice()
        const lastRead = globalThis.__liuliDialogReadIndex || 0
        const unread = h.slice(lastRead)
        globalThis.__liuliDialogReadIndex = h.length
        return JSON.stringify({ history: ${unreadOnly ? 'unread' : 'h'}, unreadCount: unread.length })
      })()`,
      returnByValue: true,
    }, 5000)
    const detail = (response as { exceptionDetails?: { exception?: { description?: string } } }).exceptionDetails
    if (detail !== undefined) return fail('execution_error', detail.exception?.description ?? 'getDialog failed')
    try {
      return ok(JSON.parse(String((response as { result?: { value?: unknown } })?.result?.value ?? '{}')))
    } catch {
      return ok({ history: [], unreadCount: 0 })
    }
  }

  async function opHandleDialog(wc: OpsWebContents, params: Record<string, unknown>): Promise<OpsResult> {
    const policy: Record<string, unknown> = {}
    if (typeof params.accept === 'boolean') policy.accept = params.accept
    if (typeof params.promptText === 'string') policy.promptText = params.promptText
    if (Object.keys(policy).length === 0) return fail('bad_params', 'handleDialog 需要 accept 和/或 promptText')
    const response = await cdp(wc, 'Runtime.evaluate', {
      expression: `(() => { globalThis.__liuliDialogPolicy = ${JSON.stringify(policy)}; return true })()`,
      returnByValue: true,
    }, 5000)
    if ((response as { result?: { value?: unknown } })?.result?.value !== true) return fail('execution_error', 'handleDialog failed')
    return ok({ policy })
  }

  /** ops 路由入口:分发到各 op;engine 在路由层先消化导航/标签/截图/视口类。 */
  async function handle(wc: OpsWebContents, tabId: string, method: string, params: Record<string, unknown>): Promise<OpsResult> {
    if (!OPS_METHODS.includes(method as (typeof OPS_METHODS)[number])) {
      return fail('capability_unsupported', `unknown op method: ${method}(可用:${OPS_METHODS.join('/')})`)
    }
    try {
      const session = await ensureAttached(wc)
      switch (method) {
        case 'snapshot': return await opSnapshot(wc, session, params)
        case 'elementInfo': return await opElementInfo(wc, session, params)
        case 'click': return await opClick(wc, session, tabId, params)
        case 'type': case 'fill': return await opFill(wc, session, tabId, params)
        case 'press': return await opPress(wc, session, tabId, params)
        case 'hover': return await opHover(wc, session, params)
        case 'scroll': return await opScroll(wc, session, params)
        case 'select': return await opSelect(wc, session, params)
        case 'check': return await opCheck(wc, session, tabId, params, true)
        case 'uncheck': return await opCheck(wc, session, tabId, params, false)
        case 'evaluate': return await opEvaluate(wc, session, params)
        case 'playwright': return await opPlaywright(wc, session, tabId, params)
        case 'waitFor': return await opWaitFor(wc, session, params)
        case 'drag': return await opDrag(wc, session, tabId, params)
        case 'cua': return await opCua(wc, session, tabId, params)
        case 'getDialog': return await opGetDialog(wc, params)
        case 'handleDialog': return await opHandleDialog(wc, params)
        default: return fail('capability_unsupported', `unknown op method: ${method}`)
      }
    } catch (cause) {
      return toResult(cause)
    }
  }

  /** 引擎销毁时释放全部 debugger。 */
  function dispose(): void {
    // WeakMap 不可枚举:引擎在 destroyTab 时各自 detach(见 browser-engine)。
  }

  return { handle, dispose }
}

export type BrowserOps = ReturnType<typeof createBrowserOps>
