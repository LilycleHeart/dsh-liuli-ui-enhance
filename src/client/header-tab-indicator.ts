/**
 * 会话 header 视图标签（对话/轨迹）滑动激活指示条。
 *
 * 官方 ConversationSessionHeader 的 tabs 行里，每个 [class*="_tab"]
 * 按钮用自己的 ::after 伪元素画底部激活横条：切换视图时横条在旧 tab
 * 瞬间消失、在新 tab 瞬间出现，没有位移动画。
 *
 * 本模块在 tabs 容器内注入一个独立指示条元素 [data-liuli-tab-indicator]
 * （absolute 定位，见 denpa.css），用 MutationObserver 监听激活 tab
 * 变化（aria-selected / class），测量激活 tab 相对容器的 left 与宽度，
 * 通过 transform + width 过渡实现横条平滑滑动到新 tab 下方。
 *
 * 覆盖两种宿主形态：
 * - 普通会话页：div[data-phase] > header（或 > div > header）；
 * - Dockable Workspace 标题面板：region:conversation-header 内的 header。
 *
 * 动画关闭：prefers-reduced-motion 时 CSS 已禁用 transition（denpa.css）。
 */
const TABS_SELECTOR = '[class*="_tabs"]'
const TAB_ACTIVE_SELECTOR = '[class*="_tabActive"], [aria-selected="true"]'
const INDICATOR_ATTR = 'data-liuli-tab-indicator'

/** header 选择器：会话列直下 header 或标题面板内 header。 */
const HEADER_SELECTORS = [
  'div[data-phase] > header',
  'div[data-phase] > div > header',
  '[data-region-pane="region:conversation-header"] header',
]

/**
 * 启动滑动指示条：
 * - body 级 MutationObserver 发现新增 tabs 容器（会话切换/标题面板挂载）即注入指示条；
 * - 每个 tabs 容器单独观察 aria-selected/class 变化，rAF 节流重测位置；
 * - 首次注入不带动画（直接定位，避免从 0 位置滑入）。
 * @returns disposer（插件 fiber 卸载时断开观察器并移除注入元素）。
 */
export function startHeaderTabIndicator(): () => void {
  // tabs 容器 -> { 指示条, 容器观察器 }
  const states = new Map<HTMLElement, { bar: HTMLElement; observer: MutationObserver }>()

  /** 计算激活 tab 相对 tabs 容器的位移（left/width），写入指示条。 */
  const position = (tabs: HTMLElement, bar: HTMLElement, animate: boolean): void => {
    const active = tabs.querySelector<HTMLElement>(TAB_ACTIVE_SELECTOR)
    if (active === null) return
    if (!animate) bar.style.transition = 'none'
    bar.style.transform = `translateX(${active.offsetLeft}px)`
    bar.style.width = `${active.offsetWidth}px`
    if (!animate) {
      // 强制回流使定位立即生效，再恢复过渡（后续切换才有滑动动画）
      void bar.offsetWidth
      bar.style.transition = ''
    }
  }

  /** 为一个 tabs 容器注入指示条并挂容器级观察。 */
  const setup = (tabs: HTMLElement): void => {
    if (states.has(tabs)) return
    const bar = document.createElement('span')
    bar.setAttribute(INDICATOR_ATTR, '')
    tabs.appendChild(bar)
    // 首次定位不动画（直接落在激活 tab 下方）
    position(tabs, bar, false)
    let raf = 0
    const observer = new MutationObserver(() => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!tabs.isConnected) return
        position(tabs, bar, true)
      })
    })
    observer.observe(tabs, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-selected'],
    })
    states.set(tabs, { bar, observer })
  }

  /** 扫描当前 DOM：为所有会话 header 的 tabs 行补注入。 */
  const scan = (): void => {
    for (const headerSelector of HEADER_SELECTORS) {
      for (const header of document.querySelectorAll<HTMLElement>(headerSelector)) {
        const tabs = header.querySelector<HTMLElement>(TABS_SELECTOR)
        if (tabs !== null) setup(tabs)
      }
    }
  }

  // body 级观察：新增节点里可能带有会话 header / tabs 容器
  const bodyObserver = new MutationObserver((mutations) => {
    let touched = false
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue
        if (added.matches(HEADER_SELECTORS.join(',')) || added.querySelector(TABS_SELECTOR) !== null) {
          touched = true
          break
        }
      }
      if (touched) break
    }
    if (touched) scan()
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })

  // 初始扫描 + 窗口尺寸变化（header 拉伸/字体加载改 tab 宽度时重定位）
  scan()
  let resizeRaf = 0
  const onResize = (): void => {
    if (resizeRaf !== 0) return
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0
      for (const [tabs, { bar }] of states) {
        if (tabs.isConnected) position(tabs, bar, false)
      }
    })
  }
  window.addEventListener('resize', onResize)

  return () => {
    bodyObserver.disconnect()
    window.removeEventListener('resize', onResize)
    for (const [, { bar, observer }] of states) {
      observer.disconnect()
      bar.remove()
    }
    states.clear()
  }
}
