/**
 * 对话页文件行右键菜单（浏览器侧覆盖层，不改官方代码）。
 *
 * document 级 contextmenu 委托，命中对话页里可点击的文件元素弹出自绘菜单
 * （在资源管理器中打开 / 审查 / 复制绝对路径 / 复制相对路径）：
 * - 琉璃轮次卡片文件行（[data-liuli-turn-file]：path / cwd / sessionId 由
 *   TurnFileCard 直接以 data 属性携带，无需反查）；
 * - 官方工具行里的文件元素：fileLink 按钮（文本即路径）与「打开 <path>」按钮
 *   （aria-label/title 即路径）——按元素命中，不依赖动态的 data-tool 工具名；
 * - 兜底：data-tool="edit"/"write" 的行上从行内摘要提取路径。
 * 会话/cwd 兜底取 sessions 快照当前会话。
 * 挂在「非官方增强 → DOM 观察增强」开关组下，关闭时完全不挂载。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { requestReviewFile } from './review-bus.ts'
import { revealSidebarPath, revealToast } from './right-sidebar-api.ts'
import { absOf, relOf } from './TurnFileCard.tsx'
import { ICONS } from './menu-icons.ts'

type Ctx = Pick<ClientContext, 'sessions'>

/** 右键命中的文件行解析结果。 */
interface FileTarget {
  path: string
  cwd: string | undefined
  sessionId: SessionId | undefined
}

/** 从官方 edit/write 工具行的摘要里取文件路径（与 edit-diff-autoplay 同源逻辑）。 */
function toolRowPath(row: HTMLElement): string | null {
  const link = row.querySelector<HTMLElement>('[class*="fileLink"], [class*="summary"]')
  const text = link?.textContent?.trim() ?? ''
  return text === '' ? null : text
}

/** 当前会话兜底（官方工具行没有自带 path/sessionId 数据属性时用）。 */
function withCurrentSession(ctx: Ctx, path: string): FileTarget {
  const snap = ctx.sessions.list.getSnapshot()
  const sessionId = snap.current
  return {
    path,
    cwd: sessionId === undefined ? undefined : snap.byId[sessionId]?.cwd,
    sessionId,
  }
}

/**
 * 解析右键命中的文件行（与工具名无关，直接命中文件元素本身）：
 * 1. 琉璃轮次卡片行（[data-liuli-turn-file]，path/cwd/sessionId 数据属性直读）；
 * 2. 官方工具行里的文件元素：fileLink 按钮（文本即路径）或「打开 <path>」按钮
 *    （aria-label/title 即路径）——这些元素所在 ToolRow 的 data-tool 是动态工具名
 *    （edit/write/str_replace_editor/run_code 子调用等），不能按工具名匹配；
 * 3. 兜底：仍在 data-tool="edit"/"write" 的行上（行内摘要文本提取路径）。
 */
function resolveFileTarget(ctx: Ctx, target: Element): FileTarget | null {
  const turnRow = target.closest<HTMLElement>('[data-liuli-turn-file]')
  if (turnRow !== null) {
    const path = turnRow.dataset.liuliFilePath ?? ''
    if (path === '') return null
    return {
      path,
      cwd: turnRow.dataset.liuliFileCwd === '' ? undefined : turnRow.dataset.liuliFileCwd,
      sessionId: turnRow.dataset.liuliSessionId === '' ? undefined : turnRow.dataset.liuliSessionId as SessionId | undefined,
    }
  }
  // 官方 fileLink 按钮：文本即文件路径（如 docs\features.md）。
  const fileLink = target.closest<HTMLElement>('button[class*="fileLink"]')
  if (fileLink !== null) {
    const path = (fileLink.textContent ?? '').trim()
    if (path !== '') return withCurrentSession(ctx, path)
  }
  // 官方「打开 <path>」按钮：aria-label / title 即路径（绝对或相对）。
  const openBtn = target.closest<HTMLElement>('button[aria-label^="打开 "], button[aria-label^="Open "]')
  if (openBtn !== null) {
    const label = openBtn.getAttribute('aria-label') ?? ''
    const path = label.replace(/^(打开|Open)\s+/, '').trim()
      || (openBtn.title ?? '').trim()
    if (path !== '') return withCurrentSession(ctx, path)
  }
  // 兜底：edit/write 工具行（行内摘要文本提取路径）。
  const toolRow = target.closest<HTMLElement>('[data-tool="edit"], [data-tool="write"]')
  if (toolRow !== null) {
    const path = toolRowPath(toolRow)
    if (path !== null) return withCurrentSession(ctx, path)
  }
  return null
}

/** 复制文本到剪贴板（带降级；与 TurnFileCard 同语义）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文）时静默失败。
  }
}

/** 弹出一个固定定位的自绘菜单（复用 [data-liuli-context-menu] 全局样式）。 */
function renderMenu(file: FileTarget, x: number, y: number): void {
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

  const rel = relOf(file.path, file.cwd)
  const abs = absOf(file.path, file.cwd)

  const appendItem = (label: string, icon: string, run: () => void): void => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('role', 'menuitem')
    btn.className = 'liuli-menu-item'
    const iconEl = document.createElement('span')
    iconEl.className = 'liuli-menu-icon'
    iconEl.innerHTML = icon
    btn.appendChild(iconEl)
    const labelEl = document.createElement('span')
    labelEl.className = 'liuli-menu-label'
    labelEl.textContent = label
    btn.appendChild(labelEl)
    btn.addEventListener('click', (e) => { e.stopPropagation(); close(); run() })
    menu.appendChild(btn)
  }

  appendItem('在资源管理器中打开', ICONS.folderOpen, () => {
    if (file.sessionId === undefined) {
      revealToast('无会话上下文，无法定位文件', 'error')
    } else {
      void revealSidebarPath(file.sessionId, rel)
    }
  })
  appendItem('审查', ICONS.diff, () => {
    requestReviewFile(file.sessionId === undefined ? { path: rel } : { sessionId: file.sessionId, path: rel })
  })
  appendItem('复制绝对路径', ICONS.copy, () => { void copyText(abs) })
  appendItem('复制相对路径', ICONS.copy, () => { void copyText(rel) })

  // 定位：先 visibility:hidden 测量真实尺寸，再夹紧视口。
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
 * 启动对话页文件行右键菜单：document 级 contextmenu 委托。
 * @param ctx - 客户端 cordis 上下文（sessions 面，工具行会话/cwd 兜底）。
 * @returns dispose。
 */
export function startConversationFileContextMenu(ctx: Ctx): () => void {
  let disposed = false
  const onContextMenu = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target as Element | null
    if (target === null) return
    if (target.closest('[data-liuli-context-menu], [data-liuli-rename]') !== null) return
    const file = resolveFileTarget(ctx, target)
    if (file === null) return
    e.preventDefault()
    e.stopPropagation()
    renderMenu(file, e.clientX, e.clientY)
  }
  document.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    disposed = true
    document.removeEventListener('contextmenu', onContextMenu, true)
  }
}
