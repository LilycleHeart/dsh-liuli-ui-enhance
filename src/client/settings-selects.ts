/**
 * 琉璃 · 设置页原生 select → 插件下拉组件
 *
 * 目标：DSH 设置「模型服务商」卡片里的原生 <select>（API 协议 / 新增提供商等，
 * 宿主 class 后缀 `_selectInput`）统一换成琉璃自有的下拉组件观感与交互：
 *   - 宿主 select 原位隐藏（opacity 0，保留布局、可聚焦性与键盘语义，是值的单一来源）；
 *   - 其上方覆盖插件触发器（坐标随 scroll/resize/折叠实时同步，
 *     滚动出可视区或 details 收起时隐藏，避免悬空按钮）；
 *   - 点击打开插件菜单（body portal + fixed，与终端 Shell 选择器同款观感：亚克力/
 *     圆角/勾选/分组头/禁用项，z-index 与其它浮层同档）；
 *   - 选择后经原生 value setter + change/input 事件回写宿主受控表单
 *     （React onChange → setState），不修改、不搬动宿主 DOM，不改宿主源码。
 *
 * 触发器挂载与层级（避免盖住其它菜单）：官方设置对话框（role=dialog）渲染在侧栏
 * 根（z-index:100 层叠单元）内，面板里的宿主菜单（如“重启”下拉，面板上下文内
 * z 2147483001）在根层级只占 z:100 单元；若触发器以 body portal + 2147482500 全局
 * 顶层挂载，会把设置面板里所有菜单都盖住。因此触发器挂进设置内容子树（select 所在
 * 字段容器，z-index 20，仅盖原 select），菜单仍是 body portal 顶层。宿主面板/卡片
 * 带 backdrop-filter 磨砂，会为 fixed 后代建立包含块，同步坐标按最近的包含块祖先
 * 原点换算；找不到设置容器时回退 body（保持原观感与顶层层级，z 2147482500）。
 *
 * 兼容性：只处理 class 后缀含 `_selectInput` 的 select（DSH ModelsSection），其余
 * 设置区下拉保持原生；随「非官方增强 → DOM 观察增强」开关挂载（index.ts 里
 * unofficial('dom') 关闭时不启动本模块）。
 */
import css from './SettingsSelects.module.css'

/** DSH 模型服务商卡片的原生下拉（CSS Module 后缀类名跨构建稳定）。 */
const SELECT_SELECTOR = 'select[class*="_selectInput"]'

const ICON_CHEVRON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>'
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>'

/**
 * CSS Modules 类名快照：`Record<string,string>` 在 noUncheckedIndexedAccess 下
 * 索引返回 `string | undefined`，这里一次性解析为确定字符串。
 */
const C = {
  trigger: css.trigger ?? '',
  triggerLabel: css.triggerLabel ?? '',
  triggerChevron: css.triggerChevron ?? '',
  triggerChevronOpen: css.triggerChevronOpen ?? '',
  menu: css.menu ?? '',
  menuItem: css.menuItem ?? '',
  menuItemActive: css.menuItemActive ?? '',
  menuItemDisabled: css.menuItemDisabled ?? '',
  menuItemLabel: css.menuItemLabel ?? '',
  menuCheck: css.menuCheck ?? '',
  menuGroup: css.menuGroup ?? '',
}

/** classList.add/remove 的空串守卫（classList 不允许空 token）。 */
function addCls(el: Element, name: string): void {
  if (name !== '') el.classList.add(name)
}

function removeCls(el: Element, name: string): void {
  if (name !== '') el.classList.remove(name)
}

interface SelectUpgrade {
  select: HTMLSelectElement
  trigger: HTMLButtonElement
  labelEl: HTMLSpanElement
  chev: HTMLSpanElement
  ro: ResizeObserver
  mo: MutationObserver
  details: HTMLDetailsElement | null
  scroller: HTMLElement | null
  /** 触发器挂载容器：设置内容子树内（select 所在字段），null 表示回退 body。 */
  zone: HTMLElement | null
}

interface OpenMenu {
  select: HTMLSelectElement
  el: HTMLDivElement
  up: SelectUpgrade
  /** 打开期间挂的全局监听（关闭时成对移除）。 */
  onDocDown: (e: MouseEvent) => void
  onResize: () => void
  onScroll: () => void
  onToggle: () => void
}

const upgrades = new Map<HTMLSelectElement, SelectUpgrade>()
let open: OpenMenu | null = null
let scanRaf = 0
let syncRaf = 0

/** 当前选中项的文本（宿主 select 的 option 文本即为展示文案）。 */
function currentLabel(select: HTMLSelectElement): string {
  const i = select.selectedIndex
  if (i < 0) return ''
  return select.options[i]?.text ?? ''
}

function refreshLabel(up: SelectUpgrade): void {
  up.labelEl.textContent = currentLabel(up.select)
}

/**
 * 最近的可滚动祖先（设置面板内容滚动容器）：计算出错/滚动裁切时把触发器与菜单
 * 限制在其可视矩形内，避免浮层悬到面板外。页面级滚动容器不算（视口检查已覆盖）。
 */
function findScroller(el: HTMLElement | null): HTMLElement | null {
  let cur = el
  while (cur !== null && cur !== document.body && cur !== document.scrollingElement) {
    const cs = getComputedStyle(cur)
    if (
      /(auto|scroll|hidden|clip)/.test(`${cs.overflowY} ${cs.overflowX}`)
      && (cur.scrollHeight > cur.clientHeight + 1 || cur.scrollWidth > cur.clientWidth + 1)
    ) return cur
    cur = cur.parentElement
  }
  return null
}

/**
 * 最近的 fixed 定位包含块原点。祖先链上的 transform/perspective/filter/
 * backdrop-filter/will-change/contain 会为 position:fixed 后代建立包含块
 * （宿主设置面板/卡片/编辑器都有 backdrop-filter 磨砂层）；触发器挂在设置
 * 内容子树内时，fixed 坐标须按该包含块原点换算，否则与 select 错位。
 * 返回包含块 padding 盒的视口坐标（body 直挂时无包含块，为视口原点 (0,0)）。
 */
function fixedOrigin(el: HTMLElement): { x: number; y: number } {
  let cur = el.parentElement
  while (cur !== null && cur !== document.documentElement) {
    const cs = getComputedStyle(cur)
    if (
      cs.transform !== 'none' ||
      cs.perspective !== 'none' ||
      cs.filter !== 'none' ||
      cs.backdropFilter !== 'none' ||
      cs.willChange.includes('transform') ||
      cs.willChange.includes('backdrop-filter') ||
      /(paint|layout|strict|content)/.test(cs.contain)
    ) {
      const r = cur.getBoundingClientRect()
      const bl = parseFloat(cs.borderLeftWidth) || 0
      const bt = parseFloat(cs.borderTopWidth) || 0
      return { x: r.left + bl, y: r.top + bt }
    }
    cur = cur.parentElement
  }
  return { x: 0, y: 0 }
}

/**
 * 挂载/重挂触发器。首选设置内容子树（zone = select 所在字段，z-index 20 盖住
 * 原 select 但不进入全局浮层级，避免盖住设置面板里的其它菜单）；zone 失效或
 * 不在设置容器内时回退 body + 类默认顶层 z（2147482500）。
 */
function mountTrigger(up: SelectUpgrade): void {
  const t = up.trigger
  const z = up.zone
  if (z !== null && z.isConnected) {
    z.appendChild(t)
    t.style.zIndex = '20'
  } else {
    document.body.appendChild(t)
    t.style.zIndex = ''
  }
}

/** 触发器坐标随宿主 select 同步；裁切/隐藏时只收不显。 */
function syncTrigger(up: SelectUpgrade): void {
  const s = up.select
  const t = up.trigger
  // React 重渲染可能摘掉挂在宿主子树里的外来触发器节点；select 还在就重挂
  if (!t.isConnected && s.isConnected) mountTrigger(up)
  const hide = (): void => { t.style.display = 'none' }
  if (!s.isConnected) { hide(); return }
  if (up.details !== null && !up.details.open) { hide(); return }
  let r = s.getBoundingClientRect()
  if (r.width < 2 || r.height < 2 || r.bottom < -8 || r.top > window.innerHeight + 8) { hide(); return }
  if (up.scroller !== null) {
    const c = up.scroller.getBoundingClientRect()
    const top = Math.max(r.top, c.top)
    const bottom = Math.min(r.bottom, c.bottom)
    const left = Math.max(r.left, c.left)
    const right = Math.min(r.right, c.right)
    if (top >= bottom - 1 || left >= right - 1) { hide(); return }
    r = new DOMRect(left, top, right - left, bottom - top)
  }
  // fixed 包含块补偿：视口矩形减去包含块原点（body 挂载时原点为 0）
  const origin = fixedOrigin(t)
  t.style.display = 'inline-flex'
  t.style.left = `${r.left - origin.x}px`
  t.style.top = `${r.top - origin.y}px`
  t.style.width = `${r.width}px`
  t.style.height = `${r.height}px`
  t.disabled = s.disabled
}

function upgrade(select: HTMLSelectElement): void {
  if (upgrades.has(select)) return

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = C.trigger
  trigger.dataset.liuliSettingsTrigger = 'true'
  trigger.setAttribute('aria-hidden', 'true') // 键盘/a11y 仍走宿主 select，避免双焦点点
  trigger.setAttribute('tabindex', '-1')
  trigger.setAttribute('aria-expanded', 'false')
  const labelEl = document.createElement('span')
  labelEl.className = C.triggerLabel
  const chev = document.createElement('span')
  chev.className = C.triggerChevron
  chev.innerHTML = ICON_CHEVRON
  trigger.append(labelEl, chev)

  const details = select.closest('details') as HTMLDetailsElement | null
  const scroller = findScroller(select.parentElement)
  // 触发器挂载点：宿主设置浮层（dialog/overlay）内的字段容器 —— 让触发器与设置
  // 内容同处一个层叠上下文，z-index 只取局部值；设置浮层外/找不到容器回退 body
  const surface = select.closest('[role="dialog"], [class*="_overlay"]')
  const zone = surface !== null && select.parentElement !== null
    ? (select.parentElement as HTMLElement)
    : null

  const up: SelectUpgrade = {
    select,
    trigger,
    labelEl,
    chev,
    ro: null as unknown as ResizeObserver,
    mo: null as unknown as MutationObserver,
    details,
    scroller,
    zone,
  }

  mountTrigger(up)

  const ro = new ResizeObserver(() => {
    syncTrigger(up)
    if (open !== null && open.select === select) syncMenu(up)
  })
  up.ro = ro
  ro.observe(select)
  if (details !== null) ro.observe(details)

  // 选项重建（模型列表/协议变化）/disabled/aria-label 变化 → 刷新触发器并关掉打开的菜单
  const mo = new MutationObserver(() => {
    refreshLabel(up)
    syncTrigger(up)
    if (open !== null && open.select === select) closeMenu(false)
  })
  up.mo = mo
  mo.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })

  // 原位隐藏宿主 select：保留布局与可聚焦性（键盘/值单一来源）
  select.dataset.liuliSettingsSelect = 'true'
  select.style.opacity = '0'
  // 滚轮滚动跳过隐藏的 select 需要 pointer-events 放行给触发器
  select.style.pointerEvents = 'none'

  // 键盘：Enter/空格/方向键打开插件菜单（拦截原生 popup / 值轮换）；焦点环映射到触发器
  select.addEventListener('keydown', onSelectKeydown)
  select.addEventListener('focus', onSelectFocus)
  select.addEventListener('blur', onSelectBlur)

  trigger.addEventListener('click', () => { toggleMenu(up) })

  refreshLabel(up)
  syncTrigger(up)
  upgrades.set(select, up)
}

function toggleMenu(up: SelectUpgrade): void {
  if (open !== null && open.select === up.select) {
    closeMenu(true)
    return
  }
  openMenu(up)
}

function openMenu(up: SelectUpgrade): void {
  closeMenu(false)
  const s = up.select
  if (s.disabled || !s.isConnected) return
  const rect = s.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return

  const el = document.createElement('div')
  el.className = C.menu
  el.setAttribute('role', 'listbox')
  el.setAttribute('aria-label', s.getAttribute('aria-label') ?? '')
  el.tabIndex = -1
  el.dataset.liuliSettingsMenu = 'true'

  /** 可选项（键盘导航只在可选项间移动）。 */
  const enabled: HTMLDivElement[] = []
  let activeIdx = 0
  let lastGroup: HTMLOptGroupElement | null = null
  for (const opt of Array.from(s.options)) {
    const group = opt.parentElement instanceof HTMLOptGroupElement ? opt.parentElement : null
    if (group !== null && group !== lastGroup) {
      const g = document.createElement('div')
      g.className = C.menuGroup
      g.textContent = group.label
      el.appendChild(g)
      lastGroup = group
    }
    if (group === null) lastGroup = null
    const item = document.createElement('div')
    item.className = C.menuItem
    item.setAttribute('role', 'option')
    item.setAttribute('aria-selected', opt.selected ? 'true' : 'false')
    item.dataset.value = opt.value
    item.tabIndex = -1
    const label = document.createElement('span')
    label.className = C.menuItemLabel
    label.textContent = opt.text
    item.appendChild(label)
    if (opt.disabled) {
      addCls(item, C.menuItemDisabled)
    } else {
      if (opt.selected) activeIdx = enabled.length
      item.addEventListener('click', () => { pick(up, opt.value) })
      enabled.push(item)
    }
    if (opt.selected) {
      addCls(item, C.menuItemActive)
      item.appendChild(checkIcon())
    }
    el.appendChild(item)
  }

  const setActive = (i: number): void => {
    if (enabled.length === 0) return
    const prev = enabled[activeIdx]
    if (prev === undefined) return
    removeCls(prev, C.menuItemActive)
    prev.setAttribute('aria-selected', 'false')
    prev.querySelector(':scope > [data-liuli-menu-check]')?.remove()
    activeIdx = (i + enabled.length) % enabled.length
    const cur = enabled[activeIdx]
    if (cur === undefined) return
    addCls(cur, C.menuItemActive)
    cur.setAttribute('aria-selected', 'true')
    cur.appendChild(checkIcon())
  }

  const onMenuKeydown = (e: KeyboardEvent): void => {
    if (enabled.length === 0) { e.preventDefault(); return }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(activeIdx + 1); break
      case 'ArrowUp': e.preventDefault(); setActive(activeIdx - 1); break
      case 'Home': e.preventDefault(); setActive(0); break
      case 'End': e.preventDefault(); setActive(enabled.length - 1); break
      case 'Enter':
      case ' ':
        e.preventDefault()
        const target = enabled[activeIdx]
        if (target !== undefined) pick(up, target.dataset.value ?? '')
        break
      case 'Escape':
        e.preventDefault()
        closeMenu(true)
        break
      case 'Tab':
        // 菜单是 body portal，不参与自然 Tab 序；关掉并把焦点还给宿主 select
        e.preventDefault()
        closeMenu(true)
        break
    }
  }

  const onDocDown = (e: MouseEvent): void => {
    const t = e.target as Node
    if (el.contains(t)) return
    if (t instanceof Element && t.closest('[data-liuli-settings-trigger]') !== null) return
    closeMenu(false)
  }
  const onScroll = (): void => { scheduleSync() }
  const onResize = (): void => { closeMenu(false) }
  const onToggle = (): void => { closeMenu(false) }

  document.body.appendChild(el)
  open = { select: s, el, up, onDocDown, onResize, onScroll, onToggle }

  up.trigger.setAttribute('aria-expanded', 'true')
  addCls(up.chev, C.triggerChevronOpen)

  positionMenu(up)
  el.focus({ preventScroll: true })

  document.addEventListener('mousedown', onDocDown, true)
  window.addEventListener('resize', onResize)
  document.addEventListener('scroll', onScroll, true)
  if (up.details !== null) up.details.addEventListener('toggle', onToggle)
  el.addEventListener('keydown', onMenuKeydown)
}

function checkIcon(): HTMLSpanElement {
  const c = document.createElement('span')
  c.className = C.menuCheck
  c.dataset.liuliMenuCheck = 'true'
  c.innerHTML = ICON_CHECK
  return c
}

/** 菜单/触发器浮层坐标：锚定 select 矩形，下方空间不足翻转到上方，视口内钳制。 */
function positionMenu(up: SelectUpgrade): void {
  if (open === null) return
  const r = up.select.getBoundingClientRect()
  const winW = window.innerWidth
  const winH = window.innerHeight
  const width = Math.min(Math.max(r.width, 200), 360)
  const el = open.el
  el.style.width = `${width}px`
  const menuH = el.getBoundingClientRect().height
  const left = Math.min(Math.max(8, r.left), Math.max(8, winW - width - 8))
  let top = r.bottom + 4
  if (top + menuH > winH - 8) top = Math.max(8, r.top - 4 - menuH)
  top = Math.max(8, Math.min(top, winH - 8 - menuH))
  el.style.left = `${left}px`
  el.style.top = `${top}px`
  el.style.maxHeight = `${Math.min(menuH, winH - 16)}px`
}

function syncMenu(up: SelectUpgrade): void {
  if (open === null || open.select !== up.select) return
  const r = up.select.getBoundingClientRect()
  if (!up.select.isConnected || r.width < 2 || r.height < 2 || r.bottom < -8 || r.top > window.innerHeight + 8) {
    closeMenu(false)
    return
  }
  positionMenu(up)
}

/** 把选中的值写回宿主 select（受控组件：原生 setter + change/input 事件）。 */
function pick(up: SelectUpgrade, value: string): void {
  const s = up.select
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  try {
    if (setter !== undefined) setter.call(s, value)
    else s.value = value
  } catch {
    s.value = value
  }
  s.dispatchEvent(new Event('change', { bubbles: true }))
  s.dispatchEvent(new Event('input', { bubbles: true }))
  refreshLabel(up)
  closeMenu(true)
}

function closeMenu(refocus: boolean): void {
  if (open === null) return
  const { select, el, up, onDocDown, onResize, onScroll, onToggle } = open
  open = null
  document.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('scroll', onScroll, true)
  if (up.details !== null) up.details.removeEventListener('toggle', onToggle)
  el.remove()
  up.trigger.setAttribute('aria-expanded', 'false')
  removeCls(up.chev, C.triggerChevronOpen)
  if (refocus && select.isConnected) select.focus({ preventScroll: true })
}

function teardown(up: SelectUpgrade): void {
  if (open !== null && open.select === up.select) closeMenu(false)
  up.ro.disconnect()
  up.mo.disconnect()
  up.select.removeEventListener('keydown', onSelectKeydown)
  up.select.removeEventListener('focus', onSelectFocus)
  up.select.removeEventListener('blur', onSelectBlur)
  delete up.select.dataset.liuliSettingsSelect
  up.select.style.opacity = ''
  up.select.style.pointerEvents = ''
  up.trigger.remove()
  upgrades.delete(up.select)
}

function scan(): void {
  scanRaf = 0
  for (const el of Array.from(document.querySelectorAll<HTMLSelectElement>(SELECT_SELECTOR))) {
    try { upgrade(el) } catch { /* 单点失败不影响其它下拉 */ }
  }
  for (const [select, up] of Array.from(upgrades)) {
    if (!select.isConnected || !select.matches(SELECT_SELECTOR)) teardown(up)
  }
}

function scheduleSync(): void {
  if (syncRaf !== 0) return
  syncRaf = requestAnimationFrame(() => {
    syncRaf = 0
    for (const up of upgrades.values()) syncTrigger(up)
    if (open !== null) syncMenu(open.up)
  })
}

function onSelectKeydown(e: KeyboardEvent): void {
  const select = e.currentTarget as HTMLSelectElement
  if (select.disabled) return
  const k = e.key
  if (k === ' ' || k === 'Enter' || k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    const up = upgrades.get(select)
    if (up !== undefined && (open === null || open.select !== select)) openMenu(up)
  }
}

function onSelectFocus(e: FocusEvent): void {
  const up = upgrades.get(e.currentTarget as HTMLSelectElement)
  if (up !== undefined) up.trigger.dataset.liuliFocused = 'true'
}

function onSelectBlur(e: FocusEvent): void {
  const up = upgrades.get(e.currentTarget as HTMLSelectElement)
  if (up !== undefined) delete up.trigger.dataset.liuliFocused
}

/** 启动设置页原生 select 升级；返回卸载函数（总开关关闭时调用）。 */
export function startSettingsSelectUpgrade(): () => void {
  const mo = new MutationObserver(() => {
    if (scanRaf !== 0) return
    scanRaf = requestAnimationFrame(scan)
  })
  mo.observe(document.body, { childList: true, subtree: true })
  scan()
  window.addEventListener('resize', scheduleSync)
  document.addEventListener('scroll', scheduleSync, true)
  return () => {
    if (scanRaf !== 0) cancelAnimationFrame(scanRaf)
    if (syncRaf !== 0) cancelAnimationFrame(syncRaf)
    mo.disconnect()
    window.removeEventListener('resize', scheduleSync)
    document.removeEventListener('scroll', scheduleSync, true)
    closeMenu(false)
    for (const up of Array.from(upgrades.values())) teardown(up)
  }
}