/**
 * 布局缩放性能护栏（sash / 窗口 resize 防掉帧）。
 *
 * 背景（实测归因，见 demo/inspect-sash-perf.mjs）：
 * 会话列里宿主 ui-deliverables 插件给每行「产物」文件行
 * （[data-produced-files-row]）注册 ResizeObserver，回调内做
 * getComputedStyle + 多次 getBoundingClientRect + textContent 写入——每次写入后
 * 的读取都强制整棵会话树回流。长对话产物行多，sash 缩放让会话列宽每帧变化 →
 * 全部产物行 RO 每帧触发 → 每帧 O(产物行数) 次全量强制回流，拖拽帧耗时可达
 * 600ms+（实测 48 步拖拽 10.6s → 护栏后 2.1s）。
 *
 * 手段（不改任何宿主源码）：
 *  1. 缩放开始时把每个产物行宽度冻结为当前像素值——行宽不再随列宽变化，宿主
 *     RO 便不再触发；缩放结束后分帧批量还原（避免宿主 measure 堆成单帧尖峰）。
 *  2. 恢复磨砂渐隐/渐显：交互开始时用约 140ms 渐变减弱，结束时渐变恢复。
 *     辉光、阴影及噪点保持原样。
 *  3. body 挂 data-liuli-resizing 标记，供 CSS（过渡关闭，见 liuli-css）与
 *     运行时（TurnRail 跟随让位等）识别缩放期。
 *  4. 窗口 resize 同样触发宿主 RO 风暴：监听 window resize，期间自动进入/退出
 *     护栏（防抖 300ms）。
 *  5. 指针拖拽专用的全视口透明「指针护盾」（data-liuli-resize-shield）：普通 DOM 元素、
 *     pointer-events:auto、z-index 盖过一切 DOM 内容（含内嵌 <webview> 与
 *     iframe）。护盾先于内嵌 guest 命中测试——拖拽期间指针无论扫到哪里，
 *     事件都落在护盾上并冒泡回主窗口监听，内嵌 guest 收不到 pointerdown：
 *     不抢焦点、不吞 pointermove；护盾透明，内嵌页面保持完全可见
 *     （用户要求拖 sash 时浏览器画面不消失，见 liuli-css 注释）。
 *
 * begin/end 引用计数配对，多个拖拽源（dock-shell sash /
 * PreviewPanel 手柄 / 宿主原生手柄 / 窗口 resize）可安全重叠。
 * 程序触发的侧栏开合冻结产物行、暂停辅助几何测量，并保留磨砂渐变，
 * 以固定尺寸做位移过渡，不挂拖拽标记或全屏指针护盾。
 */

/** 宿主产物行（ui-deliverables 插件的稳定 DOM 锚点，非 CSS hash）。 */
const ROW_SELECTOR = '[data-produced-files-row]'
/** body 上的缩放期标记（CSS/运行时共同识别）。 */
export const RESIZING_ATTR = 'data-liuli-resizing'
export const SIDEBAR_TRANSITION_ATTR = 'data-liuli-layout-transition'
export const LAYOUT_SETTLED_EVENT = 'liuli:layout-settled'
const BLUR_OFF_ATTR = 'data-liuli-blur-off'
const BLUR_FADE_MS = 140
/** 兜底：pointerup 丢失等异常下的单次缩放上限。 */
const FAILSAFE_MS = 15000
/** 窗口 resize 结束后多久退出护栏。 */
const WINDOW_SETTLE_MS = 300
/** 解冻节流：总时长上限（ms），行多时拉长单次间隔而非堆大单帧。 */
const THAW_TOTAL_MS = 800
/** 解冻启动延迟：让松开后的提交渲染先完成。 */
const THAW_START_DELAY_MS = 60

let depth = 0
/** Programmatic sidebar transitions only need the produced-file row freeze. */
let sidebarTransitionDepth = 0
/** Only pointer-driven resizes need the full-screen guest pointer shield. */
let shieldDepth = 0
/** 护盾 z-index：盖过一切 DOM（菜单层 2147482500 / 内嵌 webview / 验证探针），
 *  但不能压过宿主原生 WebContentsView（窗口级图层，不受 DOM z-index 控制，
 *  由 reportGeometryLoop 的 isResizeInProgress 门控隐藏，机制互不冲突）。 */
const SHIELD_Z = 2147483100
let shieldEl: HTMLElement | null = null
const WIDTH_PROPERTIES = ['width', 'min-width', 'max-width'] as const
/** Keep priorities too: a drag must not discard the host's inline constraints. */
const originalWidths = new Map<HTMLElement, Array<{ name: string; value: string; priority: string }>>()
let failsafe: ReturnType<typeof setTimeout> | null = null
let windowWatcherInstalled = false
let windowSettle: ReturnType<typeof setTimeout> | null = null
/** 窗口 resize 护栏是否已进入：resize 事件会突发连发，begin/end 必须幂等配对，
 *  否则 depth 只增不减、data-liuli-resizing 卡住不放（过渡被杀、级联动画消失）。 */
let windowResizeActive = false
/** 解冻分批令牌：新一轮冻结使进行中的解冻作废。 */
let thawToken = 0
type BlurSnapshot = { blurInline: string; strongInline: string; blur: string; strong: string }
type BlurFadeState = { target: HTMLElement | null; saved: BlurSnapshot | null; raf: number; offActive: boolean }
/** Drag/window resize changes the body; sidebar animation changes only the dock shell. */
const fullBlurFade: BlurFadeState = { target: null, saved: null, raf: 0, offActive: false }
const sidebarBlurFade: BlurFadeState = { target: null, saved: null, raf: 0, offActive: false }

let settledFrame = 0

/** Includes click-driven column animations. Readers
 * must not force offscreen conversation content to lay out during this phase. */
export function isLayoutInProgress(): boolean {
  return depth > 0 || sidebarTransitionDepth > 0 || fullBlurFade.raf !== 0 || sidebarBlurFade.raf !== 0
}

function notifyLayoutSettled(): void {
  if (typeof window === 'undefined' || settledFrame !== 0) return
  settledFrame = requestAnimationFrame(() => {
    settledFrame = 0
    if (isLayoutInProgress()) return
    document.body.removeAttribute(SIDEBAR_TRANSITION_ATTR)
    window.dispatchEvent(new Event(LAYOUT_SETTLED_EVENT))
  })
}

/** 当前是否处于缩放护栏内（拖拽/窗口 resize 期间）。 */
export function isResizeInProgress(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute(RESIZING_ATTR)
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 读指定表面的自定义属性（内联优先，回落继承/:root 的计算值）。 */
function readBlurVar(target: HTMLElement, name: string): string {
  const inline = target.style.getPropertyValue(name).trim()
  if (inline !== '') return inline
  return getComputedStyle(target).getPropertyValue(name).trim()
}

/** 解析 `blur(18px) saturate(1.6)` 形式的滤镜值。 */
function parseFilter(v: string): { px: number; sat: number } {
  const b = /blur\(\s*([0-9]*\.?[0-9]+)px/.exec(v)
  const s = /saturate\(\s*([0-9]*\.?[0-9]+)/.exec(v)
  return {
    px: b?.[1] !== undefined ? Number.parseFloat(b[1]) : 0,
    sat: s?.[1] !== undefined ? Number.parseFloat(s[1]) : 1,
  }
}

function writeBlurVars(target: HTMLElement, blur: string, strong: string): void {
  target.style.setProperty('--liuli-material-blur', blur)
  target.style.setProperty('--liuli-material-blur-strong', strong)
}

/** 还原磨砂变量到拖拽前的内联状态（无内联值则移除，交还 :root/运行时）。 */
function restoreBlurVars(state: BlurFadeState): void {
  const target = state.target
  const saved = state.saved
  if (target === null || saved === null) return
  if (saved.blurInline !== '') target.style.setProperty('--liuli-material-blur', saved.blurInline)
  else target.style.removeProperty('--liuli-material-blur')
  if (saved.strongInline !== '') target.style.setProperty('--liuli-material-blur-strong', saved.strongInline)
  else target.style.removeProperty('--liuli-material-blur-strong')
  state.saved = null
  state.target = null
  notifyLayoutSettled()
}

/** 从当前生效值渐变到恒等滤镜，完成后挂 BLUR_OFF_ATTR（CSS none 无缝接管）。 */
function fadeBlurOut(state: BlurFadeState, target: HTMLElement, baseline?: Pick<BlurSnapshot, 'blur' | 'strong'>): void {
  if (state.raf !== 0) {
    cancelAnimationFrame(state.raf)
    state.raf = 0
  }
  if (state.target !== null && state.target !== target) {
    state.target.removeAttribute(BLUR_OFF_ATTR)
    restoreBlurVars(state)
    state.offActive = false
  }
  state.target = target
  if (state.saved === null) {
    state.saved = {
      blurInline: target.style.getPropertyValue('--liuli-material-blur'),
      strongInline: target.style.getPropertyValue('--liuli-material-blur-strong'),
      blur: baseline?.blur ?? readBlurVar(target, '--liuli-material-blur'),
      strong: baseline?.strong ?? readBlurVar(target, '--liuli-material-blur-strong'),
    }
  }
  const from = parseFilter(readBlurVar(target, '--liuli-material-blur'))
  const fromStrong = parseFilter(readBlurVar(target, '--liuli-material-blur-strong'))
  const finish = (): void => {
    target.setAttribute(BLUR_OFF_ATTR, '')
    state.offActive = true
  }
  if ((from.px <= 0 && fromStrong.px <= 0) || prefersReducedMotion()) {
    finish()
    return
  }
  const t0 = performance.now()
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - t0) / BLUR_FADE_MS)
    const e = 1 - (1 - t) * (1 - t) // ease-out
    const inv = 1 - e
    writeBlurVars(target,
      `blur(${(from.px * inv).toFixed(2)}px) saturate(${(1 + (from.sat - 1) * inv).toFixed(3)})`,
      `blur(${(fromStrong.px * inv).toFixed(2)}px) saturate(${(1 + (fromStrong.sat - 1) * inv).toFixed(3)})`,
    )
    if (t < 1) {
      state.raf = requestAnimationFrame(tick)
    } else {
      state.raf = 0
      finish()
    }
  }
  state.raf = requestAnimationFrame(tick)
}

/** 摘 BLUR_OFF_ATTR 后从恒等滤镜渐变回拖拽前的磨砂值。 */
function fadeBlurIn(state: BlurFadeState): void {
  const target = state.target
  if (target === null) return
  if (state.raf !== 0) {
    cancelAnimationFrame(state.raf)
    state.raf = 0
  }
  if (state.offActive) {
    target.removeAttribute(BLUR_OFF_ATTR)
    state.offActive = false
  }
  if (state.saved === null) return
  const to = parseFilter(state.saved.blur)
  const toStrong = parseFilter(state.saved.strong)
  if ((to.px <= 0 && toStrong.px <= 0) || prefersReducedMotion()) {
    restoreBlurVars(state)
    return
  }
  const t0 = performance.now()
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - t0) / BLUR_FADE_MS)
    const e = 1 - (1 - t) * (1 - t)
    writeBlurVars(target,
      `blur(${(to.px * e).toFixed(2)}px) saturate(${(1 + (to.sat - 1) * e).toFixed(3)})`,
      `blur(${(toStrong.px * e).toFixed(2)}px) saturate(${(1 + (toStrong.sat - 1) * e).toFixed(3)})`,
    )
    if (t < 1) {
      state.raf = requestAnimationFrame(tick)
    } else {
      state.raf = 0
      restoreBlurVars(state)
    }
  }
  state.raf = requestAnimationFrame(tick)
}

/** 获取（或重建）缩放期的透明点击护盾。护盾是普通 DOM 元素且 pointer-events:auto
 *  ——盖住 <webview>/iframe 后命中测试先落到护盾（内嵌 guest 是 DOM 嵌入、遵守
 *  正常层叠与命中测试，见 PreviewPanel「更多」菜单能盖住 webview 的既有事实），
 *  guest 拿不到 pointerdown（不抢焦点、不吞 move），而护盾透明、页面全程可见。 */
function ensureResizeShield(): HTMLElement {
  if (shieldEl !== null && shieldEl.isConnected) return shieldEl
  const el = document.createElement('div')
  el.setAttribute('data-liuli-resize-shield', '')
  el.style.cssText = `position:fixed;inset:0;z-index:${SHIELD_Z};background:transparent;pointer-events:auto;`
  document.body.appendChild(el)
  shieldEl = el
  return el
}

function removeResizeShield(): void {
  shieldEl?.remove()
  shieldEl = null
}

/** Batch geometry reads before writes. Keep the first inline width as the restore target
 *  when another transition starts before the previous thaw finishes. */
function freezeProducedFileRows(): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  // Preserve fractional pixels and the row's own box-sizing so freezing does
  // not resize it and trigger its observer before the drag even starts.
  const widths = rows.map(el => getComputedStyle(el).width)
  rows.forEach((el, i) => {
    const width = widths[i] ?? ''
    const w = Number.parseFloat(width)
    if (!Number.isFinite(w) || w <= 0) return
    if (!originalWidths.has(el)) originalWidths.set(el, WIDTH_PROPERTIES.map(name => ({
      name, value: el.style.getPropertyValue(name), priority: el.style.getPropertyPriority(name),
    })))
    // Width alone is still limited by max-width:100% / flex-shrink.
    for (const name of WIDTH_PROPERTIES) el.style.setProperty(name, width, 'important')
  })
}

/** Both guards share one set of frozen rows. Restore only after the last guard ends. */
function scheduleProducedFileRowsThaw(): void {
  if (depth !== 0 || sidebarTransitionDepth !== 0) return
  const pending = Array.from(originalWidths.entries())
  if (pending.length === 0) return
  const token = ++thawToken
  const batchSize = pending.length > 8 ? 2 : 1
  const batches = Math.ceil(pending.length / batchSize)
  const interval = Math.max(40, Math.min(140, Math.round(THAW_TOTAL_MS / batches)))
  let cursor = 0
  const step = (): void => {
    if (token !== thawToken || depth !== 0 || sidebarTransitionDepth !== 0) return
    const slice = pending.slice(cursor, cursor + batchSize)
    cursor += batchSize
    for (const [el, properties] of slice) {
      for (const { name, value, priority } of properties) {
        if (value === '') el.style.removeProperty(name)
        else el.style.setProperty(name, value, priority)
      }
      originalWidths.delete(el)
    }
    if (cursor < pending.length) setTimeout(step, interval)
  }
  setTimeout(step, THAW_START_DELAY_MS)
}

/** Retain the original material fade while the sidebar content stays fixed. */
export function beginSidebarTransitionPerf(): () => void {
  if (typeof window === 'undefined') return () => {}
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    endSidebarTransitionPerf()
  }
  sidebarTransitionDepth += 1
  if (sidebarTransitionDepth !== 1) return release
  document.body.setAttribute(SIDEBAR_TRANSITION_ATTR, '')
  thawToken += 1
  if (depth === 0) freezeProducedFileRows()
  const shell = document.querySelector<HTMLElement>('[data-testid="dock-shell"]')
  if (shell !== null) {
    // If a drag already faded the body, capture its original material rather
    // than the temporary inherited blur so the sidebar can fade back smoothly.
    const bodyOriginal = fullBlurFade.saved
    const baseline = bodyOriginal !== null && shell.style.getPropertyValue('--liuli-material-blur') === ''
      ? { blur: bodyOriginal.blur, strong: bodyOriginal.strong }
      : undefined
    fadeBlurOut(sidebarBlurFade, shell, baseline)
  }
  return release
}

export function endSidebarTransitionPerf(): void {
  if (sidebarTransitionDepth <= 0) return
  sidebarTransitionDepth -= 1
  if (sidebarTransitionDepth !== 0) return
  if (depth === 0) fadeBlurIn(sidebarBlurFade)
  scheduleProducedFileRowsThaw()
  notifyLayoutSettled()
}

/** 进入缩放护栏（引用计数 +1；首次进入时冻结产物行并挂标记）。 */
export function beginResizePerf(options: { pointerShield?: boolean } = {}): void {
  if (typeof window === 'undefined') return
  depth += 1
  if (options.pointerShield !== false) {
    shieldDepth += 1
    if (shieldDepth === 1) ensureResizeShield()
  }
  if (depth !== 1) return
  thawToken += 1 // 打断上一轮尚未完成的分批解冻
  document.body.setAttribute(RESIZING_ATTR, '')
  if (sidebarTransitionDepth === 0) freezeProducedFileRows()
  fadeBlurOut(fullBlurFade, document.body)
  if (sidebarBlurFade.target !== null && sidebarTransitionDepth === 0) fadeBlurOut(sidebarBlurFade, sidebarBlurFade.target)
  failsafe = setTimeout(() => {
    failsafe = null
    depth = 1
    endResizePerf()
  }, FAILSAFE_MS)
}

/** 退出缩放护栏（引用计数 -1；归零时分批解冻产物行并摘标记）。 */
export function endResizePerf(options: { pointerShield?: boolean } = {}): void {
  if (depth <= 0) return
  if (options.pointerShield !== false && shieldDepth > 0) {
    shieldDepth -= 1
    if (shieldDepth === 0) removeResizeShield()
  }
  depth -= 1
  if (depth !== 0) return
  if (failsafe !== null) {
    clearTimeout(failsafe)
    failsafe = null
  }
  document.body.removeAttribute(RESIZING_ATTR)
  shieldDepth = 0
  removeResizeShield()
  fadeBlurIn(fullBlurFade)
  if (sidebarTransitionDepth === 0) fadeBlurIn(sidebarBlurFade)
  // 节流解冻：宽度还原会触发宿主 RO 的一次性 measure。若侧栏动画仍在
  // 进行，则交由它结束时恢复，避免两个护栏重叠时过早解冻。
  scheduleProducedFileRowsThaw()
  notifyLayoutSettled()
}

/**
 * 安装窗口 resize 监听：窗口尺寸变化同样让会话列宽逐帧变化、触发宿主 RO 风暴，
 * 期间进入护栏，停止变化 WINDOW_SETTLE_MS 后退出。由 index.ts 启动时调用一次。
 */
export function installResizePerfWatcher(): void {
  if (typeof window === 'undefined' || windowWatcherInstalled) return
  windowWatcherInstalled = true
  window.addEventListener('resize', () => {
    // resize 突发连发：只在首次进入时 begin 一次，settle 后 end 一次（幂等配对）。
    if (!windowResizeActive) {
      windowResizeActive = true
      beginResizePerf()
    }
    if (windowSettle !== null) clearTimeout(windowSettle)
    windowSettle = setTimeout(() => {
      windowSettle = null
      if (windowResizeActive) {
        windowResizeActive = false
        endResizePerf()
      }
    }, WINDOW_SETTLE_MS)
  })
  // 宿主桌面壳自带的缩放手柄（advanced 壳的 dshDesktopResizeHandle 等）：
  // capture 阶段识别按压即进入护栏，pointerup/cancel 退出。
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const target = e.target
    if (!(target instanceof Element)) return
    const handle = target.closest<HTMLElement>('.dshDesktopResizeHandle, [data-dockkit-divider], [data-dockkit-float-resize]')
    if (handle === null) return
    beginResizePerf()
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      window.removeEventListener('pointerup', onRelease, true)
      window.removeEventListener('pointercancel', onRelease, true)
      window.removeEventListener('blur', release)
      handle.removeEventListener('lostpointercapture', onRelease)
      endResizePerf()
    }
    const onRelease = (event: PointerEvent): void => {
      if (event.pointerId === e.pointerId) release()
    }
    window.addEventListener('pointerup', onRelease, true)
    window.addEventListener('pointercancel', onRelease, true)
    window.addEventListener('blur', release)
    handle.addEventListener('lostpointercapture', onRelease)
  }, true)
}
