/**
 * 会话栏右键菜单（浏览器侧覆盖层，不改官方代码）。
 *
 * 官方 ui-workspace 的会话行右键菜单是通过改官方文件实现的；本模块把它
 * 搬进 dsh-liuli-ui-enhance 插件：document 级 contextmenu 委托，右键会话行弹出自绘
 * 菜单（标记 / 重命名 / 分叉 / 归档）。标记复用 session-markers.ts 的
 * localStorage store，重命名复用 session-rename.ts 的内联输入框，分叉/归档
 * 经 ctx.sessions.fork / ctx.workspaces.archiveSession。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSessionId, readRowTitle, locateTitleSpan, mountEditor } from './session-rename.ts'
import { getSessionMarker, setSessionMarker, MARKER_LABEL, type SessionMarker } from './session-markers.ts'
import { ICONS } from './menu-icons.ts'

const MARKERS: readonly SessionMarker[] = ['in-progress', 'todo', 'done']

const MARKER_ICON: Record<SessionMarker, string> = {
  'in-progress': ICONS.loading,
  'todo': ICONS.checklist,
  'done': ICONS.check,
}

type Ctx = Pick<ClientContext, 'sessions' | 'workspaces'>

/** 弹出一个固定定位的自绘菜单；返回 close 用于外部清理。 */
function renderMenu(ctx: Ctx, row: HTMLElement, id: SessionId, title: string, x: number, y: number): void {
  // 先清掉可能残留的旧菜单
  document.querySelectorAll('[data-liuli-context-menu]').forEach(el => el.remove())

  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('data-liuli-context-menu', '')
  Object.assign(menu.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    visibility: 'hidden',
    zIndex: '1200',
  } as Partial<CSSStyleDeclaration>)
  document.body.appendChild(menu)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('keydown', onDocKey, true)
    menu.remove()
  }

  const runAction = (action: string): void => {
    if (action.startsWith('marker:')) {
      setSessionMarker(id, action.slice('marker:'.length) as SessionMarker)
      return
    }
    if (action === 'rename') {
      const span = locateTitleSpan(row, title)
      if (span === null) return
      const session = ctx.sessions.binding(id)?.session
      if (session === undefined) return
      mountEditor(span, title, (t) => session.rename(t))
      return
    }
    if (action === 'fork') {
      ctx.sessions.fork({ sessionId: id }).catch((reason: unknown) => { console.warn('liuli fork failed:', reason) })
      return
    }
    if (action === 'archive') {
      ctx.workspaces.archiveSession(id).catch((reason: unknown) => { console.warn('liuli archive failed:', reason) })
    }
  }

  const currentMarker = getSessionMarker(id)

  const appendItem = (label: string, action: string, icon: string, opts: { danger?: boolean; active?: boolean } = {}): void => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.className = 'liuli-menu-item'
    if (opts.danger === true) btn.classList.add('liuli-menu-danger')
    if (opts.active === true) btn.classList.add('liuli-menu-active')
    const iconEl = document.createElement('span')
    iconEl.className = 'liuli-menu-icon'
    iconEl.innerHTML = icon
    btn.appendChild(iconEl)
    const labelEl = document.createElement('span')
    labelEl.className = 'liuli-menu-label'
    labelEl.textContent = (opts.active === true ? '✓ ' : '') + label
    btn.appendChild(labelEl)
    btn.addEventListener('click', (e) => { e.stopPropagation(); close(); runAction(action) })
    menu.appendChild(btn)
  }

  const group = document.createElement('div')
  group.className = 'liuli-menu-group'
  group.textContent = '添加标记'
  menu.appendChild(group)
  for (const m of MARKERS) appendItem(MARKER_LABEL[m], 'marker:' + m, MARKER_ICON[m], { active: currentMarker === m })

  const sep = document.createElement('div')
  sep.className = 'liuli-menu-sep'
  menu.appendChild(sep)

  appendItem('重命名', 'rename', ICONS.edit)
  appendItem('分叉会话', 'fork', ICONS.branch)
  appendItem('归档会话', 'archive', ICONS.archive, { danger: true })

  // 定位：夹紧视口（先 visibility:hidden 测量真实尺寸）
  const r = menu.getBoundingClientRect()
  const left = Math.min(Math.max(x, 8), window.innerWidth - r.width - 8)
  const top = Math.min(Math.max(y, 8), window.innerHeight - r.height - 8)
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
  menu.style.visibility = 'visible'

  const onDocMouseDown = (e: MouseEvent): void => {
    if (menu.contains(e.target as Node)) return
    close()
  }
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  document.addEventListener('mousedown', onDocMouseDown, true)
  document.addEventListener('keydown', onDocKey, true)
}

/**
 * 启动会话栏右键菜单：document 级 contextmenu 委托。
 * @param ctx - 客户端 cordis 上下文（sessions + workspaces 面）。
 * @returns dispose。
 */
export function startSessionContextMenu(ctx: Ctx): () => void {
  let disposed = false
  const onContextMenu = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target as Element | null
    if (target === null) return
    if (target.closest('[data-liuli-context-menu], [data-liuli-rename]') !== null) return
    // 会话行：role=treeitem 且带 aria-selected（工作区行用 aria-expanded）
    const row = target.closest<HTMLElement>('[role="treeitem"][aria-selected]')
    if (row === null) return
    const id = resolveSessionId(ctx, row)
    if (id === undefined) return
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    const title = summary?.displayTitle ?? readRowTitle(row) ?? ''
    e.preventDefault()
    e.stopPropagation()
    renderMenu(ctx, row, id, title, e.clientX, e.clientY)
  }
  document.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    disposed = true
    document.removeEventListener('contextmenu', onContextMenu, true)
  }
}
