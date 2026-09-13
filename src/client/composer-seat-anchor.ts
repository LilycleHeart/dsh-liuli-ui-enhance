/**
 * 琉璃 · composer 贴底校正（实测裁切溢出量）。
 *
 * 背景：琉璃为「正文卡片下缘贴窗口底边」给 `[data-conversation-scroll]` 加了
 * `margin-bottom:-16px`，让滚动容器比会话根高 16px、下缘越过裁切边界。官方
 * composer（`[data-composer-seat]`）是 `position:sticky; bottom:0`，钉在滚动
 * 容器底边上，于是跟着悬进裁切区：DSH 2.0.9 起 composer 底部多了统计胶囊行
 * （`[data-composer-stats]`），正好被裁掉一半。
 *
 * 为什么不写死 16px：实际悬出的像素数 = 「滚动容器底边 − 最近裁切祖先的底边」，
 * 受 dock 留白（--liuli-dock-padding）、面板/边框等因素影响，并不恒等于那个
 * 16px；写死会多提、在底部留缝（或不足、仍被裁）。这里实测该差值，写成
 * composer 的 sticky `bottom`，使其恰好贴住可见底边。
 *
 * 观察式：React 重渲染/尺寸变化后重新测量；测量与写入都是幂等的（值没变不写）。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 被校正的元素与宿主属性（官方标记，跨构建稳定）。 */
const SCROLL_ATTR = 'data-conversation-scroll'
const SEAT_ATTR = 'data-composer-seat'

/** 可裁切判定：任一方向非 visible 即为裁切祖先。 */
function clips(el: HTMLElement): boolean {
  const cs = getComputedStyle(el)
  return cs.overflowX !== 'visible' || cs.overflowY !== 'visible'
}

/**
 * 最近裁切边界：所有**与滚动区纵向重叠**的裁切祖先矩形底边的最小值
 * （可见区 = 它们的交集）。找不到裁切祖先时返回 undefined（不校正）。
 *
 * 「纵向重叠」这层过滤很关键：页面里存在高度为 0 或远在滚动区上方的
 * `overflow:hidden` 容器，它们并不裁切滚动区底部，若一并取 min 会把
 * composer 提飞到页面中部。
 */
function clipBottomOf(el: HTMLElement): number | undefined {
  const top = el.getBoundingClientRect().top
  let bottom = Number.POSITIVE_INFINITY
  for (let parent = el.parentElement; parent !== null; parent = parent.parentElement) {
    if (!clips(parent)) continue
    const parentBottom = parent.getBoundingClientRect().bottom
    // 底边必须落在滚动区顶边之下，才算裁到了滚动区。
    if (parentBottom > top) bottom = Math.min(bottom, parentBottom)
  }
  return Number.isFinite(bottom) ? bottom : undefined
}

/** 溢出量上限：正常只会有个位数～十几像素；超过则说明测量异常，不校正。 */
const MAX_OVERFLOW_PX = 64

/** 校正一个滚动容器内的 composer seat。 */
function applySeat(scroll: HTMLElement): void {
  const seat = scroll.querySelector<HTMLElement>(`[${SEAT_ATTR}]`)
  if (seat === null) return
  const clip = clipBottomOf(scroll)
  if (clip === undefined) return
  // 滚动容器底边超出裁切边界的像素数：>=0，取整避免亚像素抖动。
  const overflow = Math.round(scroll.getBoundingClientRect().bottom - clip)
  if (overflow < 0 || overflow > MAX_OVERFLOW_PX) return
  const want = overflow === 0 ? '' : `${overflow}px`
  if (seat.style.bottom === want) return
  if (want === '') seat.style.removeProperty('bottom')
  else seat.style.setProperty('bottom', want)
}

let observer: MutationObserver | null = null
let ro: ResizeObserver | null = null
let raf = 0
let started = false

function scan(): void {
  for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`))) applySeat(node)
}

function schedule(): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    scan()
  })
}

/**
 * 启动 composer 贴底校正。
 * @param ctx - 客户端 cordis 上下文（仅用于 effect 生命周期；未直接读取服务）。
 * @returns dispose（移除观察器与写入的内联样式）。
 */
export function startComposerSeatAnchor(ctx: Context): () => void {
  if (started) return () => {}
  started = true
  void ctx
  observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(schedule)
    // 只观察滚动容器自身：内容高度变化不影响「底边 − 裁切边」这个差值，
    // 但容器尺寸/面板留白变化会影响，故需要它。
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${SCROLL_ATTR}]`))) ro.observe(node)
  }
  window.addEventListener('resize', schedule)
  schedule()
  return () => {
    started = false
    observer?.disconnect()
    observer = null
    ro?.disconnect()
    ro = null
    window.removeEventListener('resize', schedule)
    if (raf !== 0) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    for (const seat of Array.from(document.querySelectorAll<HTMLElement>(`[${SEAT_ATTR}]`))) {
      seat.style.removeProperty('bottom')
    }
  }
}
