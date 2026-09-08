/**
 * 官方 TurnNavigator 隐藏兜底（JS 层）。
 *
 * 背景：官方 ChatView 自带的右侧竖刻轮次 rail（div[class$="_slot"] >
 * nav > div[class*="_marks"] > … > button[class*="_mark"]）与琉璃自绘的
 * TurnRail 功能重复，需整条隐藏。CSS 规则（liuli-css.ts 里
 * [class$="_slot"]:has(> nav:has([class*="_mark"])) { display:none }）
 * 已无条件注入 style[data-liuli-theme]，但存在不生效的可能（:has() 在宿主
 * CSSOM 里被丢弃 / 注入时序 / 覆盖优先级等），为避免被单一机制卡住，这里加
 * JS 兜底：MutationObserver 监听 DOM 变化，对命中的 _slot 容器直接置内联
 * display:none（内联样式优先级高于样式表，且不依赖 :has()，用原生遍历判定）。
 *
 * 触发条件：无条件（与 CSS 规则一致，不随 unofficial('dom') 门控）——
 * 官方 rail 与琉璃 rail 功能重复是常态，任何设置下都应隐藏。
 */

/** 官方 rail 槽位：class 以 _slot 结尾，直接子 nav 内含轮次刻度即判定为官方
 *  TurnNavigator（CSS Modules hash 前缀随构建变，故用后缀/包含匹配）。
 *  刻意**不依赖 nav 自身的类名**：DSH 2.0.5 起 nav 的局部类名从 `_rail`
 *  变成了 `_frame`（PvW7sq_slot > nav.PvW7sq_frame > div.PvW7sq_scroller >
 *  div.PvW7sq_marks > …），只认 nav 类名会让隐藏静默失效、同一会话出现
 *  左右两条轮次刻度。琉璃 TurnRail 是 portal 到正文卡片的无 _slot 包装 nav，
 *  不会命中。 */
function isNativeTurnNavigatorSlot(el: HTMLElement): boolean {
  const cls = typeof el.className === 'string' ? el.className : ''
  if (!cls.endsWith('_slot')) return false
  for (const child of el.children) {
    if (child.tagName !== 'NAV') continue
    if (child.querySelector('[class*="_mark"]') !== null) return true
  }
  return false
}

/** 隐藏当前所有官方 rail 槽位；返回命中数（诊断用）。 */
function hideMatches(): number {
  let hits = 0
  const nodes = document.querySelectorAll<HTMLElement>('[class$="_slot"]')
  for (const el of nodes) {
    if (!isNativeTurnNavigatorSlot(el)) continue
    if (el.style.display !== 'none') el.style.display = 'none'
    hits += 1
  }
  return hits
}

/** 启动隐藏（挂 observer 前先清一遍现存 DOM）。返回 cleanup。 */
export function startHideNativeTurnNavigator(): () => void {
  const onMutate = (): void => {
    hideMatches()
  }
  hideMatches()
  const observer = new MutationObserver(onMutate)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
  }
}
