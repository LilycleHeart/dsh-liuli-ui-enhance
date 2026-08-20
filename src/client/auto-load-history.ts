/**
 * 对话页历史加载增强：
 *
 * 1. 切换会话默认预载：按通用设置里的“默认加载轮数”自动加载历史，直到消息列中
 *    的用户对话轮数达到目标值（一个用户对话算一轮，即 DOM 中
 *    `data-chat-flow-kind="user" / "steering"` 的消息锚点数量）。
 * 2. 上翻自动加载：把“手动点击加载更早消息”改为上翻到消息列顶部时自动触发。
 *
 * 宿主在消息列顶部渲染一个 older 按钮（新版 DOM 形如
 * `.Md3f7G_column > .Md3f7G_older > button`，class 带 CSS Module hash，
 * 这里用 `[class*="older"] button` 匹配）。本模块以 capture 方式监听
 * `[data-conversation-scroll]` / `.Md3f7G_scroll` 的滚动，并在 body 上观察
 * 新挂载的滚动容器/older 按钮以执行预载。
 *
 * 防重复策略：
 * - 每个滚动容器只预载一次（切换会话后宿主重建容器时才会再次预载）；
 * - 预载按用户轮数计数，达到目标立即停止，不再按“点击次数”盲目追加；
 * - 上翻自动触发只有“从非顶部区域进入顶部区域”或“顶部出现新的 older
 *   按钮”才触发，且带冷却，避免加载中连续点击把历史一次性全拉完。
 */
import { loadHistoryBatches } from './history-load-store.ts'

const SCROLL_SELECTOR = '[data-conversation-scroll], .Md3f7G_scroll'
const OLDER_BUTTON_SELECTOR = '[class*="older"] button'
/** 用户对话轮次对应的消息锚点（一个用户消息/steering 算一轮）。 */
const USER_TURN_SELECTOR = '[data-chat-anchor-key][data-chat-flow-kind="user"], [data-chat-anchor-key][data-chat-flow-kind="steering"]'
/** 距顶部多少 px 内视为“已到顶/接近顶”。 */
const TRIGGER_THRESHOLD = 96
/** 两次自动触发之间的最小间隔，避免加载中连续触发。 */
const TRIGGER_COOLDOWN_MS = 1200
/** 预载每次点击后的最小等待，给宿主进入加载态/替换按钮的时间。 */
const PRELOAD_MIN_WAIT_MS = 500
/** 预载等待一轮加载完成的最大时间。 */
const PRELOAD_MAX_WAIT_MS = 5000
/** 预载最大点击次数，防止宿主单次加载粒度异常导致无限循环。 */
const PRELOAD_MAX_CLICKS = 50

type ScrollState = {
  lastTop: number
  lastButton: Element | null
  lastTriggerAt: number
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function isScrollContainer(el: HTMLElement): boolean {
  return el.matches('[data-conversation-scroll]') || el.matches('.Md3f7G_scroll')
}

/** 统计消息列中已加载的用户对话轮数。 */
function countUserTurns(scroll: HTMLElement): number {
  return scroll.querySelectorAll(USER_TURN_SELECTOR).length
}

/** 查找可点击的 older 按钮（优先滚动容器内，再全局兜底）。 */
function findOlderButton(scroll: HTMLElement): HTMLButtonElement | null {
  const direct = scroll.querySelector<HTMLButtonElement>(OLDER_BUTTON_SELECTOR)
  if (direct !== null && !direct.disabled) return direct

  // 兜底：若 older 按钮不在滚动容器内（宿主结构调整），从文档中找最近的一个。
  let fallback: HTMLButtonElement | null = null
  for (const candidate of document.querySelectorAll<HTMLButtonElement>(OLDER_BUTTON_SELECTOR)) {
    if (candidate.disabled) continue
    if (scroll.contains(candidate) || candidate.closest(SCROLL_SELECTOR) === scroll) return candidate
    if (fallback === null) fallback = candidate
  }
  return fallback
}

/** 查找 older 按钮（含 disabled，供预载等待加载完成时轮询）。 */
function findAnyOlderButton(scroll: HTMLElement): HTMLButtonElement | null {
  return scroll.querySelector<HTMLButtonElement>(OLDER_BUTTON_SELECTOR)
}

/** 等待 older 按钮可点击；没有按钮或超时返回 null。 */
async function waitForClickableButton(scroll: HTMLElement, disposed: () => boolean): Promise<HTMLButtonElement | null> {
  const deadline = performance.now() + PRELOAD_MAX_WAIT_MS
  while (!disposed() && performance.now() < deadline) {
    const button = findOlderButton(scroll)
    if (button !== null) return button
    // 滚动容器里已没有 older 按钮：说明没有更多历史可加载。
    if (findAnyOlderButton(scroll) === null) return null
    await delay(120)
  }
  return null
}

/**
 * 自动加载历史直到用户对话轮数达到 target。
 * 宿主每次点击 older 按钮可能一次加载多轮，因此以 DOM 中实际用户轮数为准，
 * 达到目标立即停止；没有更多历史或点击后没有新增用户轮时也停止。
 */
async function preloadHistoryToTarget(scroll: HTMLElement, target: number, disposed: () => boolean): Promise<void> {
  const maxClicks = Math.max(10, Math.min(PRELOAD_MAX_CLICKS, target * 2 + 5))
  for (let i = 0; i < maxClicks; i++) {
    if (disposed()) return
    if (countUserTurns(scroll) >= target) return

    const button = await waitForClickableButton(scroll, disposed)
    if (button === null) return

    const before = countUserTurns(scroll)
    button.click()
    const clicked = button
    const deadline = performance.now() + PRELOAD_MAX_WAIT_MS
    // 至少给宿主一个进入加载态/替换按钮的时间，避免同一轮被重复点击。
    await delay(PRELOAD_MIN_WAIT_MS)

    let progressed = false
    while (!disposed() && performance.now() < deadline) {
      if (countUserTurns(scroll) >= target) return
      if (countUserTurns(scroll) > before) {
        progressed = true
        break
      }
      const current = findAnyOlderButton(scroll)
      if (current === null) return // 没有更多历史
      if (current !== clicked) break // 按钮已被替换，本轮完成
      await delay(120)
    }
    // 点击后用户轮数没有增加：说明没有更多用户历史可加载，停止空转。
    if (!progressed && countUserTurns(scroll) <= before) return
  }
}

/**
 * 启动对话页历史加载增强。
 * @returns disposer（插件 fiber 卸载时移除监听并停止预载）。
 */
export function startAutoLoadHistory(): () => void {
  const states = new WeakMap<HTMLElement, ScrollState>()
  const preloadedScrolls = new WeakSet<HTMLElement>()
  let disposed = false

  const onScroll = (event: Event): void => {
    const target = event.target
    if (!(target instanceof HTMLElement) || !isScrollContainer(target)) return

    const top = target.scrollTop
    const state = states.get(target) ?? { lastTop: top, lastButton: null, lastTriggerAt: 0 }
    states.set(target, state)

    const crossedUp = state.lastTop > TRIGGER_THRESHOLD && top <= TRIGGER_THRESHOLD
    state.lastTop = top
    if (top > TRIGGER_THRESHOLD) return

    const button = findOlderButton(target)
    if (button === null) return

    const now = performance.now()
    const buttonChanged = button !== state.lastButton
    const cooldownPassed = now - state.lastTriggerAt >= TRIGGER_COOLDOWN_MS
    if (!crossedUp && !buttonChanged) return
    if (!cooldownPassed) return

    state.lastButton = button
    state.lastTriggerAt = now
    button.click()
  }

  const maybePreload = (scroll: HTMLElement): void => {
    if (disposed || preloadedScrolls.has(scroll)) return
    // 等 older 按钮真正出现后再预载；若尚未出现，后续 MutationObserver
    // 会在按钮挂载时再次触发。
    if (findAnyOlderButton(scroll) === null) return
    const target = loadHistoryBatches()
    if (target <= 0) return
    preloadedScrolls.add(scroll)
    void preloadHistoryToTarget(scroll, target, () => disposed)
  }

  const collectScrollContainers = (root: ParentNode): HTMLElement[] => {
    const results: HTMLElement[] = []
    if (root instanceof HTMLElement && isScrollContainer(root)) results.push(root)
    for (const el of root.querySelectorAll<HTMLElement>(SCROLL_SELECTOR)) results.push(el)
    return results
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (!(added instanceof HTMLElement)) continue
        for (const scroll of collectScrollContainers(added)) maybePreload(scroll)
        if (added.matches(OLDER_BUTTON_SELECTOR)) {
          const scroll = added.closest<HTMLElement>(SCROLL_SELECTOR)
          if (scroll !== null) maybePreload(scroll)
        }
        for (const btn of added.querySelectorAll<HTMLElement>(OLDER_BUTTON_SELECTOR)) {
          const scroll = btn.closest<HTMLElement>(SCROLL_SELECTOR)
          if (scroll !== null) maybePreload(scroll)
        }
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 插件启动时页面上可能已有对话页/older 按钮，补一次初始预载。
  for (const scroll of document.querySelectorAll<HTMLElement>(SCROLL_SELECTOR)) maybePreload(scroll)
  for (const btn of document.querySelectorAll<HTMLElement>(OLDER_BUTTON_SELECTOR)) {
    const scroll = btn.closest<HTMLElement>(SCROLL_SELECTOR)
    if (scroll !== null) maybePreload(scroll)
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => {
    disposed = true
    document.removeEventListener('scroll', onScroll, { capture: true })
    observer.disconnect()
  }
}
