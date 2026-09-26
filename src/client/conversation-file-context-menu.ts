/**
 * 对话页文件行右键菜单（浏览器侧覆盖层，不改官方代码）。
 *
 * document 级 contextmenu 委托，命中对话页里可点击的文件元素弹出自绘菜单
 * （在侧边栏预览 / 在资源管理器中打开 / 审查 / 复制路径）：
 * - 琉璃轮次卡片文件行（[data-liuli-turn-file]：path / cwd / sessionId 由
 *   TurnFileCard 直接以 data 属性携带，无需反查）；
 * - 官方 Markdown 文件链接、内联代码文件引用、@文件引用；
 * - 官方交付文件卡片与本轮修改卡片；
 * - 官方工具行里的文件元素：按元素命中，不依赖动态的 data-tool 工具名；
 * - 兜底：data-tool="edit"/"write" 的行上从行内摘要提取路径。
 * 会话/cwd 兜底取 sessions 快照当前会话。
 * 挂在「非官方增强 → DOM 观察增强」开关组下，关闭时完全不挂载。
 */
import type { ClientContext, SessionId } from './compat.ts'
import { selectedSessionId } from './compat.ts'
import { requestReviewFile } from './review-bus.ts'
import { revealSidebarPath, revealToast } from './right-sidebar-api.ts'
import { absOf, relOf } from './TurnFileCard.tsx'
import { ICONS } from './menu-icons.ts'
import { dismissLiuliContextMenu } from './context-menu-presence.ts'
import { getOfficialSidebarController } from './sidebar-right-tabs.ts'

type Ctx = Pick<ClientContext, 'sessions' | 'sidebarRight'>

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
  const sessionId = selectedSessionId(snap)
  return {
    path,
    cwd: sessionId === undefined ? undefined : snap.byId[sessionId]?.cwd,
    sessionId,
  }
}

/** Official file-resource addresses preserve path segments rather than using URL path normalization. */
function fileFromOfficialAddress(ctx: Ctx, address: string): FileTarget | null {
  const prefix = 'dsh-resource://file/session/'
  if (!address.startsWith(prefix)) return null
  const end = address.search(/[?#]/)
  const rest = address.slice(prefix.length, end === -1 ? undefined : end).split('/')
  if (rest.length < 2 || rest[0] === '') return null
  try {
    const sessionId = decodeURIComponent(rest[0]!) as SessionId
    const path = rest.slice(1).map(decodeURIComponent).join('/')
    if (path === '') return null
    return { path, sessionId, cwd: ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd }
  } catch {
    return null
  }
}

/** The mounted official document header does not expose its path in DOM. */
function activeOfficialFile(ctx: Ctx): FileTarget | null {
  const active = getOfficialSidebarController()?.active?.() as { contentId?: unknown } | undefined
  return typeof active?.contentId === 'string' ? fileFromOfficialAddress(ctx, active.contentId) : null
}

/** Official changed-file cards put the full path in an aria-describedby element. */
function describedPath(element: HTMLElement): string | null {
  const id = element.getAttribute('aria-describedby')
  if (id === null || id === '') return null
  const path = element.ownerDocument.getElementById(id)?.textContent?.trim()
  return path === undefined || path === '' ? null : path
}

function cleanMentionPath(raw: string): string {
  const text = raw.trim().replace(/^@/, '')
  return text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text
}

/** The Liuli Host reveal route deliberately accepts only files inside the Session cwd. */
function revealablePath(file: FileTarget): string | null {
  if (file.sessionId === undefined) return null
  const full = file.path.replace(/\\/g, '/')
  const root = file.cwd?.replace(/\\/g, '/').replace(/\/+$/, '')
  // Windows paths are case-insensitive, while relOf is deliberately platform-neutral.
  const candidate = root !== undefined && full.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? full.slice(root.length + 1)
    : relOf(file.path, file.cwd).replace(/\\/g, '/')
  if (candidate === '' || candidate.startsWith('/') || /^[A-Za-z]:\//.test(candidate)) return null
  return candidate
}

function isRevealLabel(label: string): boolean {
  return /^(?:显示文件位置|Show file location)(?:\s|$|（|\()/u.test(label.trim())
}

/**
 * 解析右键命中的文件行（与工具名无关，直接命中文件元素本身）：
 * 1. 琉璃轮次卡片行（[data-liuli-turn-file]，path/cwd/sessionId 数据属性直读）；
 * 2. 官方交付物和本轮修改卡片（组件带稳定 data 属性）；
 * 3. Markdown 文件链接、内联代码文件引用及 @文件 chip（共用 fileMention 类）；
 * 4. 工具行「打开 <path>」按钮，最后兜底 edit/write 摘要。
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
  // 官方交付卡片：透明预览按钮的 title 是 resolveWorkspacePath 后的完整路径。
  const presented = target.closest<HTMLElement>('[data-presented-file]')
  if (presented !== null) {
    const preview = presented.querySelector<HTMLElement>('button[class*="cardPreview"]')
    const path = preview?.title?.trim() ?? ''
    if (path !== '') return withCurrentSession(ctx, path)
  }
  // 官方本轮修改卡：单文件头与多文件行均用 aria-describedby 指向绝对路径。
  const changed = target.closest<HTMLElement>('[data-changed-files]')
  if (changed !== null) {
    const row = target.closest<HTMLElement>('button[aria-describedby]')
    if (row !== null && changed.contains(row)) {
      const path = describedPath(row)
      if (path !== null) return withCurrentSession(ctx, path)
    }
  }
  // Markdown fileLink、内联代码 fileMention 与用户 @文件 chip 共用这一稳定类名。
  const fileLink = target.closest<HTMLElement>('button[class*="fileMention"]')
  if (fileLink !== null) {
    const title = fileLink.title.trim()
    const label = (fileLink.textContent ?? '').trim()
    const path = fileLink.className.includes('fileLink')
      // Markdown links may display arbitrary prose; their title is the destination.
      ? title || label
      : fileLink.hasAttribute('data-ref-chip')
        // User @file chips render a shortened display label; title carries @path.
        ? cleanMentionPath(title || label)
        // Inline-code mention titles can be localized action prose. The visible
        // token is the only path value that is safe to infer from this DOM.
        : label
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
function renderMenu(ctx: Ctx, file: FileTarget, x: number, y: number): void {
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
    dismissLiuliContextMenu(menu)
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

  appendItem('在侧边栏预览', ICONS.folderOpen, () => {
    if (file.sessionId === undefined || ctx.sidebarRight?.openResource === undefined) {
      revealToast('侧边栏预览暂不可用', 'error')
      return
    }
    const encoded = rel.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/')
    try {
      ctx.sidebarRight.openResource(`dsh-resource://file/session/${encodeURIComponent(file.sessionId)}/${encoded}`)
    } catch (error) {
      console.warn('[liuli] file preview failed:', error)
      revealToast('侧边栏预览打开失败', 'error')
    }
  })
  appendItem('在资源管理器中打开', ICONS.folderOpen, () => {
    const path = revealablePath(file)
    if (path === null || file.sessionId === undefined) {
      revealToast('该文件不在当前会话工作区内，无法定位', 'error')
    } else {
      void revealSidebarPath(file.sessionId, path)
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
  let nativeRevealMenu: { file: FileTarget; trigger: HTMLButtonElement } | null = null
  const onContextMenu = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target as Element | null
    if (target === null) return
    if (target.closest('[data-liuli-context-menu], [data-liuli-rename]') !== null) return
    const file = resolveFileTarget(ctx, target)
    if (file === null) return
    e.preventDefault()
    e.stopPropagation()
    renderMenu(ctx, file, e.clientX, e.clientY)
  }
  /** The official action currently acknowledges some Windows reveals without opening Explorer.
   * For Session-local paths, use the existing Host reveal route from the same native control. */
  const onClick = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target instanceof Element ? e.target : null
    const button = target?.closest<HTMLButtonElement>('button')
    if (button === undefined || button === null || button.closest('[data-liuli-context-menu]') !== null) return
    const split = button.closest<HTMLElement>('[data-open-target="file"]')
    if (split !== null) {
      const file = resolveFileTarget(ctx, split)
        ?? (split.closest('[data-liuli-official-rightbar-host]') === null ? null : activeOfficialFile(ctx))
      if (button.matches('[aria-haspopup="menu"]')) {
        nativeRevealMenu = file === null ? null : { file, trigger: button }
        return
      }
      const label = button.getAttribute('aria-label') ?? button.textContent ?? ''
      if (button.matches('[data-open-path-open], [data-open-path-unpreviewable]') && isRevealLabel(label)) {
        const path = file === null ? null : revealablePath(file)
        if (file?.sessionId === undefined || path === null) return
        e.preventDefault()
        e.stopImmediatePropagation()
        void revealSidebarPath(file.sessionId, path)
      }
      return
    }
    if (nativeRevealMenu === null || button.getAttribute('role') !== 'menuitem') return
    const source = nativeRevealMenu
    nativeRevealMenu = null
    if (!isRevealLabel(button.textContent ?? '')) return
    const path = revealablePath(source.file)
    if (source.file.sessionId === undefined || path === null) return
    e.preventDefault()
    e.stopImmediatePropagation()
    // The menu is portaled into document.body. Escape closes the upstream menu
    // without invoking its broken reveal action and restores trigger focus.
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    void revealSidebarPath(source.file.sessionId, path)
  }
  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('click', onClick, true)
  return () => {
    disposed = true
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('click', onClick, true)
  }
}
