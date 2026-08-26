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
 *  2. 磨砂渐隐/渐显：backdrop-filter 每帧重采样背景很昂贵，缩放期降为 none，
 *     但直接开关会「突然消失」，故用 ~140ms rAF 渐变过渡（blur 半径与 saturate
 *     同步归一到恒等滤镜，再交给 body[data-liuli-blur-off] 的 CSS none 覆盖；
 *     结束时摘标记再渐变回配置值）。prefers-reduced-motion 下跳过渐变。
 *  3. body 挂 data-liuli-resizing 标记，供 CSS（过渡关闭，见 liuli-css）与
 *     运行时（TurnRail 跟随让位等）识别缩放期。
 *  4. 窗口 resize 同样触发宿主 RO 风暴：监听 window resize，期间自动进入/退出
 *     护栏（防抖 300ms）。
 *  5. 全视口透明「指针护盾」（data-liuli-resize-shield）：普通 DOM 元素、
 *     pointer-events:auto、z-index 盖过一切 DOM 内容（含内嵌 <webview> 与
 *     iframe）。护盾先于内嵌 guest 命中测试——拖拽期间指针无论扫到哪里，
 *     事件都落在护盾上并冒泡回主窗口监听，内嵌 guest 收不到 pointerdown：
 *     不抢焦点、不吞 pointermove；护盾透明，内嵌页面保持完全可见
 *     （用户要求拖 sash 时浏览器画面不消失，见 liuli-css 注释）。
 *
 * begin/end 引用计数配对，多个拖拽源（dock-shell sash /
 * PreviewPanel 手柄 / 宿主原生手柄 / 窗口 resize）可安全重叠。
 */

/** 宿主产物行（ui-deliverables 插件的稳定 DOM 锚点，非 CSS hash）。 */
const ROW_SELECTOR = '[data-produced-files-row]'
/** body 上的缩放期标记（CSS/运行时共同识别）。 */
export const RESIZING_ATTR = 'data-liuli-resizing'
/** 磨砂关闭标记（渐变归一后挂上，CSS 以 none 覆盖，见 liuli-css）。 */
const BLUR_OFF_ATTR = 'data-liuli-blur-off'
/** 兜底：pointerup 丢失等异常下的单次缩放上限。 */
const FAILSAFE_MS = 15000
/** 窗口 resize 结束后多久退出护栏。 */
const WINDOW_SETTLE_MS = 300
/** 磨砂渐隐/渐显时长。 */
const BLUR_FADE_MS = 140
/** 解冻节流：总时长上限（ms），行多时拉长单次间隔而非堆大单帧。 */
const THAW_TOTAL_MS = 800
/** 解冻启动延迟：让松开后的提交渲染先完成。 */
const THAW_START_DELAY_MS = 60

let depth = 0
/** 护盾 z-index：盖过一切 DOM（菜单层 2147482500 / 内嵌 webview / 验证探针），
 *  但不能压过宿主原生 WebContentsView（窗口级图层，不受 DOM z-index 控制，
 *  由 reportGeometryLoop 的 isResizeInProgress 门控隐藏，机制互不冲突）。 */
const SHIELD_Z = 2147483100
let shieldEl: HTMLElement | null = null
/** 产物行 → 冻结前的原始内联 width（跨连续多次拖拽保持，解冻时还原）。 */
const originalWidths = new Map<HTMLElement, string>()
let failsafe: ReturnType<typeof setTimeout> | null = null
let windowWatcherInstalled = false
let windowSettle: ReturnType<typeof setTimeout> | null = null
/** 窗口 resize 护栏是否已进入：resize 事件会突发连发，begin/end 必须幂等配对，
 *  否则 depth 只增不减、data-liuli-resizing 卡住不放（过渡被杀、级联动画消失）。 */
let windowResizeActive = false
/** 解冻分批令牌：新一轮冻结使进行中的解冻作废。 */
let thawToken = 0
/** 磨砂渐变状态：拖拽前捕获的原始值（内联值 + 生效值）。 */
let savedBlur: { blurInline: string; strongInline: string; blur: string; strong: string } | null = null
let blurRaf = 0
let blurOffActive = false

/** 当前是否处于缩放护栏内（拖拽/窗口 resize 期间）。 */
export function isResizeInProgress(): boolean {
  return typeof document !== 'undefined' && document.body.hasAttribute(RESIZING_ATTR)
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 读 body 上自定义属性的生效值（内联优先，回落继承/:root 的计算值）。 */
function readBodyVar(name: string): string {
  const inline = document.body.style.getPropertyValue(name).trim()
  if (inline !== '') return inline
  return getComputedStyle(document.body).getPropertyValue(name).trim()
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

function writeBlurVars(blur: string, strong: string): void {
  document.body.style.setProperty('--liuli-material-blur', blur)
  document.body.style.setProperty('--liuli-material-blur-strong', strong)
}

/** 还原磨砂变量到拖拽前的内联状态（无内联值则移除，交还 :root/运行时）。 */
function restoreBlurVars(): void {
  if (savedBlur === null) return
  if (savedBlur.blurInline !== '') document.body.style.setProperty('--liuli-material-blur', savedBlur.blurInline)
  else document.body.style.removeProperty('--liuli-material-blur')
  if (savedBlur.strongInline !== '') document.body.style.setProperty('--liuli-material-blur-strong', savedBlur.strongInline)
  else document.body.style.removeProperty('--liuli-material-blur-strong')
  savedBlur = null
}

/** 从当前生效值渐变到恒等滤镜，完成后挂 BLUR_OFF_ATTR（CSS none 无缝接管）。 */
function fadeBlurOut(): void {
  if (blurRaf !== 0) {
    cancelAnimationFrame(blurRaf)
    blurRaf = 0
  }
  if (savedBlur === null) {
    savedBlur = {
      blurInline: document.body.style.getPropertyValue('--liuli-material-blur'),
      strongInline: document.body.style.getPropertyValue('--liuli-material-blur-strong'),
      blur: readBodyVar('--liuli-material-blur'),
      strong: readBodyVar('--liuli-material-blur-strong'),
    }
  }
  const from = parseFilter(readBodyVar('--liuli-material-blur'))
  const fromStrong = parseFilter(readBodyVar('--liuli-material-blur-strong'))
  const finish = (): void => {
    document.body.setAttribute(BLUR_OFF_ATTR, '')
    blurOffActive = true
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
    writeBlurVars(
      `blur(${(from.px * inv).toFixed(2)}px) saturate(${(1 + (from.sat - 1) * inv).toFixed(3)})`,
      `blur(${(fromStrong.px * inv).toFixed(2)}px) saturate(${(1 + (fromStrong.sat - 1) * inv).toFixed(3)})`,
    )
    if (t < 1) {
      blurRaf = requestAnimationFrame(tick)
    } else {
      blurRaf = 0
      finish()
    }
  }
  blurRaf = requestAnimationFrame(tick)
}

/** 摘 BLUR_OFF_ATTR 后从恒等滤镜渐变回拖拽前的磨砂值。 */
function fadeBlurIn(): void {
  if (blurRaf !== 0) {
    cancelAnimationFrame(blurRaf)
    blurRaf = 0
  }
  if (blurOffActive) {
    document.body.removeAttribute(BLUR_OFF_ATTR)
    blurOffActive = false
  }
  if (savedBlur === null) return
  const to = parseFilter(savedBlur.blur)
  const toStrong = parseFilter(savedBlur.strong)
  if ((to.px <= 0 && toStrong.px <= 0) || prefersReducedMotion()) {
    restoreBlurVars()
    return
  }
  const t0 = performance.now()
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - t0) / BLUR_FADE_MS)
    const e = 1 - (1 - t) * (1 - t)
    writeBlurVars(
      `blur(${(to.px * e).toFixed(2)}px) saturate(${(1 + (to.sat - 1) * e).toFixed(3)})`,
      `blur(${(toStrong.px * e).toFixed(2)}px) saturate(${(1 + (toStrong.sat - 1) * e).toFixed(3)})`,
    )
    if (t < 1) {
      blurRaf = requestAnimationFrame(tick)
    } else {
      blurRaf = 0
      restoreBlurVars()
    }
  }
  blurRaf = requestAnimationFrame(tick)
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

/** 进入缩放护栏（引用计数 +1；首次进入时冻结产物行并挂标记）。 */
export function beginResizePerf(): void {
  if (typeof window === 'undefined') return
  depth += 1
  if (depth !== 1) return
  thawToken += 1 // 打断上一轮尚未完成的分批解冻
  document.body.setAttribute(RESIZING_ATTR, '')
  ensureResizeShield()
  // 冻结产物行：先批量读宽（一次回流），再批量写内联 width，避免读写交替。
  const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  const widths = rows.map(el => el.getBoundingClientRect().width)
  rows.forEach((el, i) => {
    const w = widths[i] ?? 0
    if (!Number.isFinite(w) || w <= 0) return
    if (!originalWidths.has(el)) originalWidths.set(el, el.style.width)
    el.style.width = `${Math.round(w)}px`
  })
  fadeBlurOut()
  failsafe = setTimeout(() => {
    failsafe = null
    depth = 1
    endResizePerf()
  }, FAILSAFE_MS)
}

/** 退出缩放护栏（引用计数 -1；归零时分批解冻产物行、渐显磨砂并摘标记）。 */
export function endResizePerf(): void {
  if (depth <= 0) return
  depth -= 1
  if (depth !== 0) return
  if (failsafe !== null) {
    clearTimeout(failsafe)
    failsafe = null
  }
  document.body.removeAttribute(RESIZING_ATTR)
  removeResizeShield()
  fadeBlurIn()
  // 节流解冻：宽度还原会触发宿主 RO 的一次性 measure（每行百毫秒级），
  // 全部同帧还原会堆出大尖峰；按定时器分批摊平（总时长 ≤ THAW_TOTAL_MS）。
  const pending = Array.from(originalWidths.entries())
  if (pending.length === 0) return
  const token = ++thawToken
  const batchSize = pending.length > 8 ? 2 : 1
  const batches = Math.ceil(pending.length / batchSize)
  const interval = Math.max(40, Math.min(140, Math.round(THAW_TOTAL_MS / batches)))
  let cursor = 0
  const step = (): void => {
    if (token !== thawToken) return // 被新一轮冻结打断
    const slice = pending.slice(cursor, cursor + batchSize)
    cursor += batchSize
    for (const [el, width] of slice) {
      el.style.width = width
      originalWidths.delete(el)
    }
    if (cursor < pending.length) setTimeout(step, interval)
  }
  setTimeout(step, THAW_START_DELAY_MS)
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
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest('.dshDesktopResizeHandle') === null) return
    beginResizePerf()
    const release = (): void => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      endResizePerf()
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
  }, true)
}
