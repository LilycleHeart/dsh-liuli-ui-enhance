/**
 * 会话栏右键菜单（浏览器侧覆盖层，不改官方代码）。
 *
 * 官方 ui-workspace 的会话行右键菜单是通过改官方文件实现的；本模块把它
 * 搬进 dsh-liuli-ui-enhance 插件：document 级 contextmenu 委托，右键会话行弹出自绘
 * 菜单（标记 + 官方“更多”的置顶 / 重命名 / 分叉 / 归档）。标记复用
 * session-markers.ts 的 localStorage store；官方会话操作走 uiWorkspace，
 * 与原生菜单共享工作区列表、置顶排序和归档导航状态。
 */
import type { ClientContext, SessionId } from './compat.ts'
import { resolveSessionId, readRowTitle, locateTitleSpan, mountEditor } from './session-rename.ts'
import { getSessionMarker, setSessionMarker, MARKER_LABEL, MARKER_ICON, MARKER_COLOR, type SessionMarker } from './session-markers.ts'
import { ICONS } from './menu-icons.ts'
import { dismissLiuliContextMenu } from './context-menu-presence.ts'

const MARKERS: readonly SessionMarker[] = ['in-progress', 'todo', 'done']

type Ctx = Pick<ClientContext, 'sessions' | 'workspaces' | 'uiWorkspace'>

type ActiveArchiveItem = { readonly id: string; readonly label?: string }
type ActiveArchiveEntry = { readonly kind: string; readonly items?: readonly ActiveArchiveItem[] }

/** 官方 Host 以此错误报告仍在运行的任务；不要自动停止它们。 */
function activeArchiveActivity(reason: unknown): readonly ActiveArchiveEntry[] | undefined {
  if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
  const error = (reason as Error & { rpcError?: { code?: string; details?: { activity?: readonly ActiveArchiveEntry[] } } }).rpcError
  return error?.code === 'workspace/session-active' ? error.details?.activity : undefined
}

/** 与官方归档确认等价的显式“停止并归档”步骤，保留琉璃的材质。 */
function confirmActiveArchive(ctx: Ctx, id: SessionId, title: string, activity: readonly ActiveArchiveEntry[]): void {
  document.querySelector('[data-liuli-archive-dialog]')?.remove()
  const dialog = document.createElement('dialog')
  dialog.setAttribute('data-liuli-archive-dialog', '')
  dialog.setAttribute('aria-label', '归档会话确认')
  const heading = document.createElement('h2')
  heading.textContent = '停止任务并归档会话？'
  const description = document.createElement('p')
  description.textContent = `“${title}”还有正在进行的任务。归档前需要停止这些任务。`
  const list = document.createElement('ul')
  const kindLabel: Record<string, string> = { turn: '当前对话', subagent: '子任务', job: '后台任务', schedule: '计划任务' }
  for (const entry of activity) {
    const item = document.createElement('li')
    const names = entry.items?.map(value => value.label ?? value.id).filter(Boolean).join('、')
    item.textContent = `${kindLabel[entry.kind] ?? entry.kind}${names ? `：${names}` : ''}`
    list.appendChild(item)
  }
  const error = document.createElement('p')
  error.setAttribute('role', 'alert')
  error.hidden = true
  const footer = document.createElement('div')
  footer.className = 'liuli-archive-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = '取消'
  const confirm = document.createElement('button')
  confirm.type = 'button'
  confirm.className = 'liuli-archive-confirm'
  confirm.textContent = '停止并归档'
  footer.append(cancel, confirm)
  dialog.append(heading, description, list, error, footer)
  const close = (): void => { dialog.close(); dialog.remove() }
  cancel.addEventListener('click', close)
  dialog.addEventListener('cancel', (event) => {
    if (confirm.disabled) { event.preventDefault(); return }
    event.preventDefault()
    close()
  })
  confirm.addEventListener('click', () => {
    cancel.disabled = true
    confirm.disabled = true
    error.hidden = true
    ctx.uiWorkspace.archiveSession(id, { stopActivity: true }).then(close).catch((reason: unknown) => {
      cancel.disabled = false
      confirm.disabled = false
      error.textContent = reason instanceof Error ? reason.message : String(reason)
      error.hidden = false
    })
  })
  document.body.appendChild(dialog)
  dialog.showModal()
  cancel.focus()
}

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
    zIndex: '2147482500',
  } as Partial<CSSStyleDeclaration>)
  document.body.appendChild(menu)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    document.removeEventListener('mousedown', onDocMouseDown, true)
    document.removeEventListener('keydown', onDocKey, true)
    dismissLiuliContextMenu(menu)
  }

  const runAction = (action: string): void => {
    if (action.startsWith('marker:')) {
      setSessionMarker(id, action.slice('marker:'.length) as SessionMarker)
      return
    }
    if (action === 'rename') {
      const span = locateTitleSpan(row, title)
      if (span === null) return
      mountEditor(span, title, async (t) => {
        // 非当前会话不一定有 binding；按官方重命名流程临时持有会话。
        const result = await ctx.sessions.using(id, { source: 'workspaceOperation' }, reference => reference.binding.session.rename(t))
        if (!result.ok) throw new Error(result.error.message)
      })
      return
    }
    if (action === 'pin' || action === 'unpin') {
      const call = action === 'pin' ? ctx.uiWorkspace.pinSession(id) : ctx.uiWorkspace.unpinSession(id)
      call.catch((reason: unknown) => { console.warn('liuli session pin failed:', reason) })
      return
    }
    if (action === 'fork') {
      ctx.uiWorkspace.forkSession(id).catch((reason: unknown) => { console.warn('liuli fork failed:', reason) })
      return
    }
    if (action === 'archive') {
      ctx.uiWorkspace.archiveSession(id).catch((reason: unknown) => {
        const activity = activeArchiveActivity(reason)
        if (activity !== undefined) confirmActiveArchive(ctx, id, title, activity)
        else console.warn('liuli archive failed:', reason)
      })
      return
    }
    if (action === 'unarchive') {
      ctx.uiWorkspace.unarchiveSession(id).catch((reason: unknown) => { console.warn('liuli unarchive failed:', reason) })
    }
  }

  const currentMarker = getSessionMarker(id)
  const workspace = ctx.workspaces.list.getSnapshot()
  const archived = workspace.archivedSessionIds.includes(id)
  const pinned = workspace.pinnedSessionIds.includes(id)

  const appendItem = (label: string, action: string, icon: string, opts: { danger?: boolean; active?: boolean } = {}): void => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.className = 'liuli-menu-item'
    if (opts.danger === true) btn.classList.add('liuli-menu-danger')
    if (opts.active === true) btn.classList.add('liuli-menu-active')
    const iconEl = document.createElement('span')
    iconEl.className = 'liuli-menu-icon'
    if (action.startsWith('marker:')) {
      // 标记项颜色与行内实际标记一致，避免菜单预览和添加后颜色不一致。
      iconEl.style.color = MARKER_COLOR[action.slice('marker:'.length) as SessionMarker]
    }
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

  if (!archived) appendItem(pinned ? '取消置顶' : '置顶会话', pinned ? 'unpin' : 'pin', ICONS.pin)
  appendItem('重命名', 'rename', ICONS.edit)
  appendItem('分叉会话', 'fork', ICONS.branch)
  appendItem(archived ? '恢复会话' : '归档会话', archived ? 'unarchive' : 'archive', ICONS.archive, { danger: !archived })

  // 定位：夹紧视口（先 visibility:hidden 测量真实尺寸）
  // CSS entrance animation scales the box; offset metrics preserve its final
  // size so the menu never slips outside a narrow window while appearing.
  const left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))
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
    // 官方“更多”不会为未开始的空会话提供操作。
    if (summary?.blank === true) return
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
