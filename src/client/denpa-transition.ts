/**
 * 会话切换/新消息入场动画：官方 harness 的挂类逻辑在 ChatNodeSeat /
 * AssistantMarkdown 组件内部（插件无法修改组件源码），本模块用
 * MutationObserver 在消息列（[data-chat-flow]）的新增节点
 * （[data-chat-anchor-key]）上挂入场类，动画定义在 denpa.css。
 *
 * - 切换会话：消息列整批重挂载 → 按 DOM 顺序分配级联延迟（stagger）；
 * - 流式输出：每条新消息各自入场（无延迟）；
 * - 效果与开关：读 localStorage 的 transition_effect 设置（与设置页同源）。
 */
import {
  DENPA_LS_KEY, DENPA_SETTINGS_DEFAULTS, denpaSettingsOf,
  type DenpaTransitionEffect,
} from '../denpa-settings.ts'

/** 入场基础类（denpa.css 定义 animation 属性）。 */
const ENTER_CLASS = 'denpa-enter'
/** 效果类前缀：denpa-enter-<effect>。 */
const ENTER_EFFECT_PREFIX = 'denpa-enter-'
/** 级联延迟步进与上限（批量挂载时逐条递增）。 */
const CASCADE_STEP_MS = 60
const CASCADE_CAP_MS = 600

/** 读取当前生效的过渡效果（与设置页同一持久化键）。 */
function currentEffect(): DenpaTransitionEffect {
  try {
    const raw = localStorage.getItem(DENPA_LS_KEY)
    if (raw !== null) return denpaSettingsOf(JSON.parse(raw)).transition_effect
  } catch (_) { /* 损坏则回落默认 */ }
  return DENPA_SETTINGS_DEFAULTS.transition_effect
}

/** 给一个消息锚点挂入场类；动画结束后移除（重挂载的新节点无标记，可再次入场）。 */
function applyEnter(el: HTMLElement, effect: DenpaTransitionEffect, delayMs: number): void {
  if (effect === 'none' || el.dataset.denpaEntered !== undefined) return
  el.dataset.denpaEntered = '1'
  el.classList.add(ENTER_CLASS, ENTER_EFFECT_PREFIX + effect)
  if (delayMs > 0) el.style.setProperty('--denpa-enter-delay', `${delayMs}ms`)
  const finish = (): void => {
    el.classList.remove(ENTER_CLASS, ENTER_EFFECT_PREFIX + effect)
    el.style.removeProperty('--denpa-enter-delay')
    el.removeEventListener('animationend', finish)
  }
  el.addEventListener('animationend', finish)
}

/**
 * 启动入场动画观察器：监听 body 子树新增节点，把消息锚点收集成批，
 * 按 DOM 顺序挂类（同批多条 → 级联延迟；单条 → 立即入场）。
 * @returns disposer（插件 fiber 卸载时断开观察器）。
 */
export function startDenpaTransition(): () => void {
  let scrollport: HTMLElement | null = null

  const findScrollport = (): HTMLElement | null => {
    if (scrollport !== null && scrollport.isConnected) return scrollport
    scrollport = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    return scrollport
  }

  const handleMutations = (): void => {
    const effect = currentEffect()
    if (effect === 'none') return
    const port = findScrollport()
    if (port === null) return
    const column = port.querySelector<HTMLElement>('[data-chat-flow]')
    if (column === null) return
    const pending = new Set<HTMLElement>()
    // 本次 mutation 的新增节点：直接是锚点（流式单条），或含锚点的容器
    // （列/视图整批重挂载）——统一收集后按 DOM 顺序处理。
    for (const node of mutationQueue) {
      if (!(node instanceof HTMLElement)) continue
      if (node.matches('[data-chat-anchor-key]')) {
        pending.add(node)
      } else {
        const anchors = node.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')
        if (anchors.length > 0) {
          for (const anchor of anchors) pending.add(anchor)
        }
      }
    }
    if (pending.size === 0) return
    const ordered = [...pending].sort((a, b) => {
      const pos = (el: HTMLElement): number => {
        let n = 0
        for (let cur: HTMLElement | null = el; cur !== null; cur = cur.parentElement) n += 1
        return n
      }
      return pos(a) - pos(b)
    })
    const batch = ordered.length > 1
    ordered.forEach((el, index) => {
      applyEnter(el, effect, batch ? Math.min(index * CASCADE_STEP_MS, CASCADE_CAP_MS) : 0)
    })
  }

  // MutationObserver 回调里收集本次新增节点（observe 在 body 上，subtree）。
  let mutationQueue: Node[] = []
  const observer = new MutationObserver((mutations) => {
    mutationQueue = []
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) mutationQueue.push(added)
    }
    if (mutationQueue.length > 0) handleMutations()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => { observer.disconnect() }
}
