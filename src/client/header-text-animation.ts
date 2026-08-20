/**
 * 会话 header 动态文本入场动画（标题名/模型/路由等）。
 *
 * 官方 ConversationSessionHeader 的标题名（crumbSeg）和右侧信息
 * （headerActions）会随会话切换/重命名/模型切换而更新文本，但宿主没有
 * 为这些文本变化提供动画。本模块用 MutationObserver 监听 header 内的
 * 动态文本容器，检测到文本变化时挂 .liuli-header-text-enter 类，
 * 动画定义在 liuli.css / liuli-css.ts（与侧边栏条目同风格的小幅上浮）。
 *
 * 覆盖两种宿主形态：
 * - 普通会话页：div[data-phase] > header（或 > div > header）；
 * - Dockable Workspace 标题面板：region:conversation-header 内的 header。
 */
const HEADER_SELECTORS = [
  'div[data-phase] > header',
  'div[data-phase] > div > header',
  '[data-region-pane="region:conversation-header"] header',
]

/** header 中会变动的文本容器：会话标题名、右侧模型/路由信息。 */
const TARGET_SELECTOR = [
  '[class*="_crumbSeg"]',
  '[class*="_headerActions"]',
].join(',')

const ANIM_CLASS = 'liuli-header-text-enter'

/**
 * 启动 header 动态文本动画观察器。
 * @returns disposer（插件 fiber 卸载时断开所有观察器）。
 */
export function startHeaderTextAnimation(): () => void {
  const states = new Map<HTMLElement, { observer: MutationObserver; texts: Map<HTMLElement, string> }>()

  /** 给元素重新播放一次入场动画（先移除类强制回流，再挂类）。 */
  const animate = (el: HTMLElement): void => {
    el.classList.remove(ANIM_CLASS)
    void el.offsetWidth
    el.classList.add(ANIM_CLASS)
    const finish = (event: AnimationEvent): void => {
      if (event.target !== el) return
      el.classList.remove(ANIM_CLASS)
      el.removeEventListener('animationend', finish)
      el.removeEventListener('animationcancel', finish)
    }
    el.addEventListener('animationend', finish)
    el.addEventListener('animationcancel', finish)
  }

  /** 为一个 header 建立文本变化观察；新挂载的 header 也立即播放一次动画，
   *  这样切换会话导致 header 重挂载时标题名/信息文本不会“干跳”。 */
  const setup = (header: HTMLElement): void => {
    if (states.has(header)) return
    const texts = new Map<HTMLElement, string>()
    for (const el of header.querySelectorAll<HTMLElement>(TARGET_SELECTOR)) {
      texts.set(el, el.textContent ?? '')
      animate(el)
    }
    const observer = new MutationObserver(() => {
      for (const el of header.querySelectorAll<HTMLElement>(TARGET_SELECTOR)) {
        if (!el.isConnected) continue
        const text = el.textContent ?? ''
        if (texts.get(el) === text) continue
        texts.set(el, text)
        animate(el)
      }
    })
    observer.observe(header, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    })
    states.set(header, { observer, texts })
  }

  /** 扫描当前 DOM：为所有会话 header 补挂观察器。 */
  const scan = (): void => {
    for (const selector of HEADER_SELECTORS) {
      for (const header of document.querySelectorAll<HTMLElement>(selector)) setup(header)
    }
  }

  // body 级观察：新增节点里可能带有会话 header / 标题面板。
  const bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue
        if (added.matches(HEADER_SELECTORS.join(',')) || added.querySelector(HEADER_SELECTORS.join(',')) !== null) {
          scan()
          return
        }
      }
    }
  })
  bodyObserver.observe(document.body, { childList: true, subtree: true })

  // 初始扫描：已有 header 也会播放入场动画（与侧边栏条目挂载动画一致）。
  scan()

  return () => {
    bodyObserver.disconnect()
    for (const { observer } of states.values()) observer.disconnect()
    states.clear()
  }
}
