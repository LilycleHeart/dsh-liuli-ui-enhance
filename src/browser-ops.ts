/**
 * 侧边栏浏览器 CDP 操作面(Host 半)。
 *
 * 参考 zcode-browser-replication/main(CDP-executor / PlaywrightLocatorEngine /
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
   * 引擎实现为「垫 GUI 之下 + 1024×768」,restore 时按原几何复位。
   */
  prepareTabSurface(tabId: string): void
  restoreTabSurface(tabId: string): void
}

/** 统一返回协议(对齐 zcode executeInScope)。 */
export type OpsResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

/** ops 路由支持的方法清单(CDP 操作面;导航/标签/截图/视口由引擎既有路由提供)。 */
export const OPS_METHODS = [
  'snapshot', 'elementInfo', 'click', 'type', 'fill', 'press', 'hover', 'scroll',
  'select', 'check', 'uncheck', 'evaluate', 'playwright',
] as const

/** Playwright InjectedScript 构造参数(对齐 zcode PlaywrightLocatorEngine.inject)。 */
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
 * parseSelector 解析后的对象,对齐 zcode:querySelectorAll(parseSelector(sel))[0])。
 */
const QUERY_ONE = (selector: string): string =>
  `(globalThis.${INJECTED_GLOBAL}.querySelectorAll(globalThis.${INJECTED_GLOBAL}.parseSelector(${JSON.stringify(selector)}), document)[0] ?? null)`

interface OpsSession {
  attached: boolean
  frameId: string | null
  contextId: number | null
}

const ok = (value: unknown): OpsResult => ({ ok: true, value })
const fail = (code: string, message: string): OpsResult => ({ ok: false, error: { code, message } })

/** ref 优先于 selector;都没有报错。 */
function selectorFrom(params: Record<string, unknown>): string | undefined {
  const ref = typeof params.ref === 'string' && params.ref !== '' ? params.ref : undefined
  if (ref !== undefined) return ref.startsWith('aria-ref=') ? ref : `aria-ref=${ref}`
  const selector = typeof params.selector === 'string' && params.selector !== '' ? params.selector : undefined
  return selector
}

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
      session = { attached: false, frameId: null, contextId: null }
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
    // source 经 Runtime.callFunctionOn 以 JSON 参数传入(不经代码字符串形态):
    // tsdown/rolldown 会把「字符串常量拼接」折叠回模板字面量且不转义其中的
    // `${`/反引号(实测注入 26 项全挂的根因),参数传递彻底绕开该重写;
    // eval(src) 是直接 eval,在函数作用域内求值,module 变量可见。
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
    session.contextId = contextId
    return contextId
  }

  /** world 内求值(returnByValue;exceptionDetails 转错误消息)。 */
  async function evalWorld(wc: OpsWebContents, session: OpsSession, expression: string, timeoutMs = 10000): Promise<any> {
    const contextId = await ensureWorld(wc, session)
    const response = await cdp(wc, 'Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, timeoutMs)
    const detail = (response as { exceptionDetails?: { exception?: { description?: string; value?: unknown }; text?: string } }).exceptionDetails
    if (detail !== undefined) {
      const message = detail.exception?.description ?? (typeof detail.exception?.value === 'string' ? detail.exception.value : undefined) ?? detail.text ?? 'world evaluation failed'
      throw new Error(message)
    }
    return (response as { result?: { value?: unknown } })?.result?.value
  }

  /** 解析 ref/selector → 校验可交互 → 返回元素中心与描述(click 前置共用)。 */
  async function resolveActionable(wc: OpsWebContents, session: OpsSession, selector: string, states: string[]): Promise<{ x: number; y: number; tag: string; text: string }> {
    const probe = await evalWorld(wc, session, `(async () => {
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
    return { x: Math.round(probe.x), y: Math.round(probe.y), tag: probe.tag, text: probe.text }
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

  /** 键序:keydown → char → keyup(可打印键带 text)。 */
  async function dispatchKey(wc: OpsWebContents, key: string, modifiers = 0): Promise<void> {
    const upper = key.length === 1 ? key.toUpperCase() : ''
    const def = KEY_DEFS[key] ?? (key.length === 1 ? { key, code: upper === key ? '' : `Key${upper}`, vk: upper.charCodeAt(0), text: key } : undefined)
    if (def === undefined) throw new Error(`unsupported key: ${key}`)
    const base = { key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers }
    await cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base }, 5000)
    if (def.text !== undefined) {
      await cdp(wc, 'Input.dispatchKeyEvent', { type: 'char', text: def.text, key: def.key, code: def.code, windowsVirtualKeyCode: def.vk, nativeVirtualKeyCode: def.vk, modifiers }, 5000)
    }
    await cdp(wc, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base }, 5000)
  }

  /* ── 各 op 实现 ────────────────────────────────────────────────── */

  async function opSnapshot(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const mode = params.mode === 'yaml' ? 'yaml' : 'ai'
    const ref = typeof params.ref === 'string' && params.ref !== '' ? params.ref : undefined
    const yaml = await evalWorld(wc, session, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const target = ${ref === undefined ? 'document.body' : `${QUERY_ONE(ref.startsWith('aria-ref=') ? ref : `aria-ref=${ref}`)} ?? document.body`}
      return inj.ariaSnapshot(target, { mode: ${JSON.stringify(mode)} })
    })()`, 20000)
    return ok({ mode, yaml: typeof yaml === 'string' ? yaml : String(yaml ?? '') })
  }

  async function opElementInfo(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const selector = selectorFrom(params)
    if (selector === undefined) return fail('bad_params', 'elementInfo 需要 ref 或 selector')
    const info = await evalWorld(wc, session, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${QUERY_ONE(selector)}
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
    if (info === null || info === undefined) return fail('not_found', `element not found: ${selector}`)
    return ok(info)
  }

  async function opClick(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const selector = selectorFrom(params)
    if (selector === undefined) return fail('bad_params', 'click 需要 ref 或 selector')
    ensureWindowSurface()
    // 不含 'stable':它需要 rAF 两帧,屏外/隐藏视图的 rAF 挂起会永不完成
    // (agent 无 carrier 标签常在屏外);visible/enabled 是同步检查。
    deps.prepareTabSurface(tabId)
    try {
      const probe = await resolveActionable(wc, session, selector, ['visible', 'enabled'])
      await dispatchClick(wc, probe.x, probe.y, typeof params.button === 'string' ? params.button : 'left', params.double === true)
      return ok({ x: probe.x, y: probe.y, tag: probe.tag, text: probe.text })
    } finally {
      deps.restoreTabSurface(tabId)
    }
  }

  /** fill/type 共用:真实 click 聚焦 → injected.fill 设值 → 'needsinput' 补 insertText → 校验兜底。 */
  async function opFill(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const selector = selectorFrom(params)
    const text = typeof params.text === 'string' ? params.text : typeof params.value === 'string' ? params.value : undefined
    if (selector === undefined || text === undefined) return fail('bad_params', 'fill/type 需要 ref|selector 与 text')
    ensureWindowSurface()
    deps.prepareTabSurface(tabId)
    try {
      // 先真实 click 聚焦:isolated world 的 focusNode 不建立输入管线焦点,
      // 直接 insertText 会落到空焦点(webview guest 实测落空)。
      const focusProbe = await resolveActionable(wc, session, selector, ['visible', 'enabled'])
      await dispatchClick(wc, focusProbe.x, focusProbe.y)
      const fillResult = await evalWorld(wc, session, `(() => {
        const inj = globalThis.${INJECTED_GLOBAL}
        const el = ${QUERY_ONE(selector)}
        if (el === null) return { found: false }
        return { found: true, result: inj.fill(el, ${JSON.stringify(text)}) }
      })()`, 10000)
      if (fillResult === null || typeof fillResult !== 'object' || fillResult.found !== true) return fail('not_found', `element not found: ${selector}`)
      if (typeof fillResult.result === 'string' && fillResult.result.startsWith('error:')) return fail('not_fillable', fillResult.result)
      if (fillResult.result === 'needsinput') {
        await cdp(wc, 'Input.insertText', { text }, 5000)
      }
    } finally {
      deps.restoreTabSurface(tabId)
    }
    // 校验读回;insertText 因焦点链落空时,用 objectId + callFunctionOn 主世界设值兜底。
    const readBack = await evalWorld(wc, session, `(() => {
      const el = ${QUERY_ONE(selector)}
      return el === null ? null : ('value' in el ? String(el.value).slice(0, 300) : (el.textContent || '').slice(0, 300))
    })()`, 5000)
    if (readBack !== text) {
      const holder = await cdp(wc, 'Runtime.evaluate', { expression: QUERY_ONE(selector), contextId: session.contextId, returnByValue: false }, 5000)
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
    const value = await evalWorld(wc, session, `(() => {
      const el = ${QUERY_ONE(selector)}
      return el === null ? null : ('value' in el ? String(el.value).slice(0, 300) : (el.textContent || '').slice(0, 300))
    })()`, 5000)
    return ok({ filled: true, value: value ?? null })
  }

  async function opPress(wc: OpsWebContents, session: OpsSession, tabId: string, params: Record<string, unknown>): Promise<OpsResult> {
    const key = typeof params.key === 'string' ? params.key : undefined
    if (key === undefined) return fail('bad_params', 'press 需要 key')
    const selector = selectorFrom(params)
    ensureWindowSurface()
    if (selector !== undefined) {
      // 聚焦点击走真实输入管线,同样需要可见表面。
      deps.prepareTabSurface(tabId)
      try {
        const probe = await resolveActionable(wc, session, selector, ['visible', 'enabled'])
        await dispatchClick(wc, probe.x, probe.y)
      } finally {
        deps.restoreTabSurface(tabId)
      }
    }
    const modifiers = typeof params.modifiers === 'number' ? params.modifiers : 0
    const keys = key.includes('+') ? key.split('+') : [key]
    for (const single of keys) await dispatchKey(wc, single, modifiers)
    return ok({ pressed: key })
  }

  async function opHover(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const selector = selectorFrom(params)
    if (selector === undefined) return fail('bad_params', 'hover 需要 ref 或 selector')
    // 真实 mouseMoved 在屏外/隐藏/遮挡视图上永久挂死(不可恢复),这里用合成
    // mouseover/mousemove/mouseenter best-effort(与 CLI 既有 hover 语义一致)。
    const result = await evalWorld(wc, session, `(() => {
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
    const selector = selectorFrom(params)
    ensureWindowSurface()
    const result = await evalWorld(wc, session, `(() => {
      const inj = globalThis.${INJECTED_GLOBAL}
      const el = ${selector === undefined ? 'null' : QUERY_ONE(selector)}
      const target = el ?? document.scrollingElement ?? document.documentElement
      if (target === null) return { ok: false, error: 'no scroll target' }
      target.scrollBy(${dx}, ${dy})
      return { ok: true, scrollTop: target.scrollTop, scrollLeft: target.scrollLeft }
    })()`, 5000)
    if (result === null || typeof result !== 'object' || result.ok !== true) return fail('scroll_failed', result?.error ?? 'scroll failed')
    return ok(result)
  }

  async function opSelect(wc: OpsWebContents, session: OpsSession, params: Record<string, unknown>): Promise<OpsResult> {
    const selector = selectorFrom(params)
    const values = Array.isArray(params.values) ? params.values.filter((v): v is string => typeof v === 'string') : undefined
    if (selector === undefined || values === undefined || values.length === 0) return fail('bad_params', 'select 需要 ref|selector 与 values(字符串数组)')
    ensureWindowSurface()
    const result = await evalWorld(wc, session, `(() => {
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
    const selector = selectorFrom(params)
    if (selector === undefined) return fail('bad_params', `${desired ? 'check' : 'uncheck'} 需要 ref 或 selector`)
    ensureWindowSurface()
    const probe = await evalWorld(wc, session, `(() => {
      const el = ${QUERY_ONE(selector)}
      if (el === null) return { found: false }
      if (!('checked' in el)) return { found: true, error: 'element has no checked state' }
      if (el.disabled === true) return { found: true, error: 'element is disabled' }
      return { found: true, checked: el.checked === true }
    })()`, 5000)
    if (probe === null || typeof probe !== 'object' || probe.found !== true) return fail('not_found', `element not found: ${selector}`)
    if (probe.error) return fail('not_checkable', probe.error)
    if (probe.checked !== desired) {
      deps.prepareTabSurface(tabId)
      try {
        const actionable = await resolveActionable(wc, session, selector, ['visible', 'enabled'])
        await dispatchClick(wc, actionable.x, actionable.y)
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
    if (isolated) {
      try {
        return ok({ value: (await evalWorld(wc, session, expression, timeoutMs)) ?? null })
      } catch (cause) {
        return toResult(cause)
      }
    }
    const response = await cdp(wc, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs).catch(cause => { throw new Error(cause instanceof Error ? cause.message : String(cause)) })
    const detail = (response as { exceptionDetails?: { exception?: { description?: string }; text?: string } }).exceptionDetails
    if (detail !== undefined) return fail('execution_error', detail.exception?.description ?? detail.text ?? 'evaluation failed')
    return ok({ value: (response as { result?: { value?: unknown } })?.result?.value ?? null })
  }

  /** playwright op(zcode 语义薄转调):domSnapshot / elementInfo / evaluate / locator。 */
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
