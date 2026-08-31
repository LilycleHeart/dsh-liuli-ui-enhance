/**
 * 会话内联重命名（浏览器侧覆盖层）。
 *
 * 官方侧栏重命名走「省略号菜单 / 右键 → 重命名对话框」。本模块不改官方代码，
 * 用 document 级 dblclick 委托：双击会话标题进入内联编辑——一个 fixed 定位
 * 的 <input> 覆盖在标题 span 之上（不改动 React 受控的行 DOM 树，零冲突），
 * 回车/失焦提交、Esc 取消，提交经 ctx.sessions.binding(id).session.rename(title)。
 *
 * 双击前首次 click 已同步触发 ctx.sessions.open(id)，故 dblclick 时
 * list 快照的 current 即为目标会话，无需反查行级 sessionId。
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { sanitizeSessionTitle } from './session-title-filter.ts'

/** 行内标题文本：第一个非空、无子元素、不在按钮内的叶子 span（状态点/标记都是 SVG，无文本）。 */
export function readRowTitle(row: HTMLElement): string | undefined {
  const leaf = Array.from(row.querySelectorAll<HTMLElement>('span'))
    .find(s => s.children.length === 0 && (s.textContent?.trim().length ?? 0) > 0 && s.closest('button') === null)
  return leaf?.textContent?.trim()
}

/**
 * 从会话行 DOM 反查 sessionId（官方行不暴露 data-session-id）。
 * 优先用 current（行 aria-selected=true）；否则按 displayTitle 文本匹配
 * （标题唯一时可靠，插件覆盖方案的已知折中）。
 * 标题匹配经 sanitizeSessionTitle 归一化：session-title-filter 会把命中元素块的
 * 行内标题改写为清洗文本，两侧都清洗后仍能对上（常规标题清洗为恒等，零影响）。
 */
export function resolveSessionId(ctx: Pick<ClientContext, 'sessions'>, row: HTMLElement): SessionId | undefined {
  const snap = ctx.sessions.list.getSnapshot()
  if (row.getAttribute('aria-selected') === 'true') return snap.current
  // 收集行内所有非空叶子 span 文本（状态/标题/时间等），看哪个 displayTitle 命中。
  // 不能用"第一个非空叶子"——会话行第一个非空文本往往是状态标签（如"进行中"），
  // 而非标题。
  const texts = new Set(
    Array.from(row.querySelectorAll<HTMLElement>('span'))
      .filter(s => s.children.length === 0 && (s.textContent?.trim().length ?? 0) > 0 && s.closest('button') === null)
      .map(s => sanitizeSessionTitle((s.textContent ?? '').trim())),
  )
  for (const id of snap.ids) {
    const s = snap.byId[id]
    if (s !== undefined && texts.has(sanitizeSessionTitle(s.displayTitle.trim()))) return id
  }
  return undefined
}

/** 行内标题 span 定位：文本等于 displayTitle 的叶子 span（两侧都经标题清洗归一化）。 */
export function locateTitleSpan(row: HTMLElement, title: string): HTMLElement | null {
  const wanted = sanitizeSessionTitle(title.trim())
  const spans = Array.from(row.querySelectorAll<HTMLElement>('span'))
  const leaf = spans.filter(s => s.children.length === 0)
  // 优先精确匹配标题文本
  let hit = leaf.find(s => sanitizeSessionTitle((s.textContent?.trim() ?? '')) === wanted)
  if (hit === undefined && wanted === '') {
    // 空标题（新会话）：取第一个不在按钮内的非空叶子 span
    hit = leaf.find(s => (s.textContent?.trim().length ?? 0) > 0 && s.closest('button') === null)
  }
  if (hit === undefined) {
    // 回退：任意非空叶子文本 span（排除时间/状态槽靠后的）
    hit = leaf.find(s => (s.textContent?.trim().length ?? 0) > 0 && s.closest('button') === null)
  }
  return hit ?? null
}

/** 把一个 fixed <input> 覆盖到标题 span 上，进入内联编辑；提交经 commit 回调。 */
export function mountEditor(span: HTMLElement, title: string, commit: (title: string) => Promise<unknown>): void {
  const rect = span.getBoundingClientRect()
  const style = getComputedStyle(span)
  const input = document.createElement('input')
  input.type = 'text'
  input.value = title
  input.setAttribute('data-liuli-rename', '')
  input.setAttribute('aria-label', '重命名会话')
  Object.assign(input.style, {
    position: 'fixed',
    left: rect.left + 'px',
    top: rect.top + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    boxSizing: 'border-box',
    padding: '0',
    margin: '0',
    border: '1px solid var(--dsw-alias-brand-primary, currentColor)',
    borderRadius: '4px',
    background: 'var(--dsw-alias-bg-overlay, #fff)',
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    outline: 'none',
    zIndex: '9999',
  } as Partial<CSSStyleDeclaration>)
  document.body.appendChild(input)
  input.focus()
  input.select()
  // 编辑期间阻止点 input 冒泡到行（避免触发 open 切会话打断编辑）
  input.addEventListener('click', (e) => { e.stopPropagation() })
  input.addEventListener('mousedown', (e) => { e.stopPropagation() })

  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    input.removeEventListener('keydown', onKey)
    input.removeEventListener('blur', onBlur)
    input.remove()
  }
  const doCommit = (): void => {
    if (done) return
    const trimmed = input.value.trim()
    if (trimmed === '' || trimmed === title.trim()) { finish(); return }
    input.disabled = true
    commit(trimmed).then(() => {
      // 成功：宿主 list 更新触发 React 重渲染，标题 span 文本自动更新
      finish()
    }).catch((reason: unknown) => {
      console.warn('liuli rename failed:', reason)
      finish()
    })
  }
  const cancel = (): void => { finish() }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); doCommit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancel() }
  }
  const onBlur = (): void => { doCommit() }
  input.addEventListener('keydown', onKey)
  input.addEventListener('blur', onBlur)
}

/**
 * 启动会话内联重命名：document 级 dblclick 委托。
 * @param ctx - 客户端 cordis 上下文（只需 sessions 面）。
 * @returns dispose，移除委托监听。
 */
export function startSessionRename(ctx: Pick<ClientContext, 'sessions'>): () => void {
  let disposed = false
  const onDblClick = (e: MouseEvent): void => {
    if (disposed) return
    const target = e.target as Element | null
    if (target === null) return
    // 排除按钮 / 菜单项 / 链接：这些双击不应触发重命名
    if (target.closest('button, [role="menuitem"], [role="menu"], a, input') !== null) return
    const row = target.closest<HTMLElement>('[role="treeitem"]')
    if (row === null) return
    e.preventDefault()
    e.stopPropagation()
    // 双击前首次 click 已 open：list 快照 current 即目标会话
    const snap = ctx.sessions.list.getSnapshot()
    const id = snap.current
    if (id === undefined) return
    const summary = snap.byId[id]
    if (summary === undefined) return
    const span = locateTitleSpan(row, summary.displayTitle)
    if (span === null) return
    const session = ctx.sessions.binding(id)?.session
    if (session === undefined) return
    mountEditor(span, summary.displayTitle, (t) => session.rename(t))
  }
  document.addEventListener('dblclick', onDblClick, true)
  return () => {
    disposed = true
    document.removeEventListener('dblclick', onDblClick, true)
  }
}
