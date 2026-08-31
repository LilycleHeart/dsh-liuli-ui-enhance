/**
 * 工作区 / 目录行右键菜单（浏览器侧覆盖层，不改官方代码）。
 *
 * 官方 ui-workspace 的目录行右键菜单（重命名 / 删除工作区）是通过改官方
 * 文件实现的；本模块搬进 dsh-liuli-ui-enhance：document 级 contextmenu 委托，右键
 * 目录行弹出自绘菜单：在资源管理器中打开（Host /liuli-reveal-workspace 打开工作区
 * 根目录）/ 重命名（ctx.workspaces.rename）/ 删除（ctx.workspaces.delete）。
 * 未分组桶（ungrouped，无 workspaceId）在列表里匹配不到，自然不弹菜单。
 */
import type { ClientContext, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { readRowTitle, locateTitleSpan, mountEditor } from './session-rename.ts'
import { revealWorkspaceInExplorer } from './right-sidebar-api.ts'
import { ICONS } from './menu-icons.ts'

type Ctx = Pick<ClientContext, 'workspaces'>

/** 从目录行 DOM 反查工作区（标题匹配 items；未分组桶匹配不到 → undefined）。 */
function resolveWorkspace(ctx: Ctx, row: HTMLElement): { id: WorkspaceId; title: string; path: string } | undefined {
  const title = readRowTitle(row)
  if (title === undefined) return undefined
  const items = ctx.workspaces.list.getSnapshot().items
  const ws = items.find(w => w.title.trim() === title)
  if (ws === undefined) return undefined
  return { id: ws.workspaceId, title: ws.title, path: ws.path }
}

function renderMenu(ctx: Ctx, row: HTMLElement, id: WorkspaceId, title: string, path: string, x: number, y: number): void {
  document.querySelectorAll('[data-liuli-context-menu]').forEach(el => el.remove())
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('data-liuli-context-menu', '')
  Object.assign(menu.style, {
    position: 'fixed', left: '0', top: '0', visibility: 'hidden', zIndex: '1200',
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
    if (action === 'open') {
      // 在系统文件管理器中打开工作区根目录（Host /liuli-reveal-workspace 解析；
      // 同时带上已知注册路径，Host 注册表不可用时回退）。
      void revealWorkspaceInExplorer(id, path)
      return
    }
    if (action === 'rename') {
      const span = locateTitleSpan(row, title)
      if (span !== null) mountEditor(span, title, (t) => ctx.workspaces.rename(id, t))
      return
    }
    if (action === 'delete') {
      // 破坏性操作：原生确认兜底（工作区删除不可逆，官方也有确认对话框）
      if (window.confirm('确定要删除工作区 "' + title + '" 吗？')) {
        ctx.workspaces.delete(id).catch((reason: unknown) => { console.warn('liuli workspace delete failed:', reason) })
      }
      return
    }
  }

  const appendItem = (label: string, action: string, icon: string, opts: { danger?: boolean } = {}): void => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.className = 'liuli-menu-item'
    if (opts.danger === true) btn.classList.add('liuli-menu-danger')
    const iconEl = document.createElement('span')
    iconEl.className = 'liuli-menu-icon'
    iconEl.innerHTML = icon
    btn.appendChild(iconEl)
    const labelEl = document.createElement('span')
    labelEl.className = 'liuli-menu-label'
    labelEl.textContent = label
    btn.appendChild(labelEl)
    btn.addEventListener('click', (e) => { e.stopPropagation(); close(); runAction(action) })
    menu.appendChild(btn)
  }

  appendItem('在资源管理器中打开', 'open', ICONS.folderOpen)
  appendItem('重命名工作区', 'rename', ICONS.edit)
  appendItem('删除工作区', 'delete', ICONS.trash, { danger: true })

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
 * 启动工作区 / 目录行右键菜单：document 级 contextmenu 委托。
 * @param ctx - 客户端 cordis 上下文（workspaces 面）。
 * @returns dispose。
 */
export function startWorkspaceContextMenu(ctx: Ctx): () => void {
  let disposed = false
  const onContextMenu = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target as Element | null
    if (target === null) return
    if (target.closest('[data-liuli-context-menu], [data-liuli-rename], button') !== null) return
    // 目录 / 工作区行：role=treeitem 且带 aria-expanded（会话行用 aria-selected）
    const row = target.closest<HTMLElement>('[role="treeitem"][aria-expanded]')
    if (row === null) return
    const ws = resolveWorkspace(ctx, row)
    if (ws === undefined) return
    e.preventDefault()
    e.stopPropagation()
    renderMenu(ctx, row, ws.id, ws.title, ws.path, e.clientX, e.clientY)
  }
  document.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    disposed = true
    document.removeEventListener('contextmenu', onContextMenu, true)
  }
}
