/**
 * 琉璃主题 · 轮次结束文件变更卡片（适配 step 化事件模型的版本）。
 *
 * 当前 DSH 会话转写里没有 turn/start / turn/end 事件（agent loop 走
 * step/start · step/end · tool/call · tool/result，坐标在 data.turn/step 上），
 * 因此官方 turnTail 槽在此版本不渲染。本模块改为：
 * - conversationEvents Definition（key `liuli-file-changes`）按 step 累计
 *   文件修改与 diff hunks（优先取 call/result 的 `card:'diff'` 视图；
 *   当前版本 result 视图/ meta 缺失，回落 edit/write/str_replace_editor 参数合成）；
 * - 每个有变更的 step 发布一个 `liuli-round-summary` chat 节点（锚在 step/end）；
 * - 节点渲染器只在该 step 是本轮最后节点时渲染卡片，并从会话快照聚合整轮文件；
 * - 卡片：文件名 + DIFF 数量（+加 −删），按钮 审查 / 打开 /
 *   展开图标（打开方式：在资源管理器中打开 · 复制绝对路径 · 复制相对路径）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationLocation, ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SessionEvent augmentation that adds the code-dispatch
// child-call lifecycle events (tool/code-dispatch-start / tool/code-dispatch).
import type {} from '@deepseek-ai/dsh-tools/types'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { requestReviewFile } from './review-bus.ts'
import { revealSidebarPath } from './right-sidebar-api.ts'
import css from './TurnFileCard.module.css'

/** 一个 diff hunk（与宿主 FileDiff 同构：path/oldText/newText）。 */
export interface FileDiffHunk {
  path: string
  oldText: string | null
  newText: string
}

/** 一轮内单个文件的变更记录。 */
export interface TurnFileRecord {
  /** 最近一次变更的日志 seq。 */
  seq: number
  path: string
  hunks: FileDiffHunk[]
}

/** `card:'diff'` 渲染意图的结构窄化面。 */
interface DiffCardView {
  card: 'diff'
  title?: string
  diffs?: unknown
  locations?: Array<{ path: string }>
}

/** 结构窄化：只有 `card:'diff'` 的视图才参与。 */
function asDiffView(view: unknown): DiffCardView | null {
  if (typeof view !== 'object' || view === null) return null
  if ((view as { card?: unknown }).card !== 'diff') return null
  return view as DiffCardView
}

/** 校验并窄化 diffs 数组（宿主 FileDiff 形状）。 */
function narrowHunks(diffs: unknown): FileDiffHunk[] | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  const out: FileDiffHunk[] = []
  for (const entry of diffs) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as { path?: unknown; oldText?: unknown; newText?: unknown }
    if (typeof record.path !== 'string') continue
    if (record.oldText !== null && typeof record.oldText !== 'string') continue
    if (typeof record.newText !== 'string') continue
    out.push({ path: record.path, oldText: record.oldText ?? null, newText: record.newText })
  }
  return out.length === 0 ? null : out
}

/** 已知文件变更工具的 diff 参数合成兜底（视图缺失时）。 */
function synthesizeHunks(name: string, argsRaw: string): FileDiffHunk[] | null {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsRaw) as Record<string, unknown>
  } catch {
    return null
  }
  switch (name) {
    case 'edit': {
      const filePath = args.file_path
      const newString = args.new_string
      if (typeof filePath !== 'string' || typeof newString !== 'string') return null
      const oldString = args.old_string
      return [{
        path: filePath,
        oldText: typeof oldString === 'string' ? oldString : null,
        newText: newString,
      }]
    }
    case 'write': {
      const filePath = args.file_path
      const content = args.content
      if (typeof filePath !== 'string' || typeof content !== 'string') return null
      return [{ path: filePath, oldText: null, newText: content }]
    }
    case 'str_replace_editor': {
      const path = args.path
      const command = args.command
      if (typeof path !== 'string' || typeof command !== 'string') return null
      if (command === 'create') {
        const fileText = args.file_text
        if (typeof fileText !== 'string') return null
        return [{ path, oldText: null, newText: fileText }]
      }
      if (command === 'str_replace') {
        const newStr = args.new_str
        if (typeof newStr !== 'string') return null
        const oldStr = args.old_str
        return [{ path, oldText: typeof oldStr === 'string' ? oldStr : null, newText: newStr }]
      }
      return null
    }
    default:
      return null
  }
}

/** 从 result 视图（权威）或 call 视图（运行中）/ 参数兜底导出 hunks。 */
function deriveHunks(
  name: string,
  argsRaw: string,
  callView: DiffCardView | null,
  resultView: DiffCardView | null,
): FileDiffHunk[] | null {
  const fromView = (view: DiffCardView | null): FileDiffHunk[] | null => {
    if (view === null) return null
    return narrowHunks(view.diffs)
  }
  return fromView(resultView) ?? fromView(callView) ?? synthesizeHunks(name, argsRaw)
}

/** 行级 diff 注入用的 path → hunks 缓存（DOM 装饰器读取；latest wins）。 */
const diffCache = new Map<string, readonly FileDiffHunk[]>()
declare global {
  interface Window { __liuliDiffCache?: typeof diffCache }
}
window.__liuliDiffCache = diffCache

/**
 * 本地 Chat 节点构造器（等价于 ui-conversation 的 chatNode；该函数未从
 * 应用 bundle 导出，这里按同构形状内联，避免运行时 undefined 导入）。
 */
function localChatNode(
  context: ConversationNodeContext,
  kind: string,
  anchorSeq: number,
  data: unknown,
): {
  key: string
  kind: string
  id: string
  target: 'chat'
  anchorSeq: number
  location: ConversationNodeContext['start'] extends infer S ? (S extends { location: infer L } ? L : never) : never
  visibility: 'visible' | 'hidden'
  data: unknown
} {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' } as never,
    visibility: 'visible',
    data,
  }
}

/** 单个 tool 调用（root 或 code-dispatch 子调用）的累计状态。 */
interface StepFileState {
  readonly turn: number
  readonly step: number
  readonly call: { name: string; argsRaw: string; view: DiffCardView | null } | null
  readonly files: readonly TurnFileRecord[]
  readonly anchorSeq: number | undefined
}

/**
 * 每轮文件变更的 Definition（适配 code-dispatch 子调用的版本）：
 * 当前 DSH 的 edit/write 以 code-dispatch 子调用形式执行（root tool/call 是
 * run_code，子调用走 tool/code-dispatch-start / tool/code-dispatch）：
 * - match：子调用起（id = c:<subCallId>，start 于 code-dispatch-start）；
 *   也兼容 root tool/call + tool/result（id = r:<callId>）；
 * - update：从 name + arguments（对象→JSON）合成 hunks，刷新行级缓存；
 * - buildViewNode：有变更的调用在结果 seq 锚点发布 `liuli-round-summary` 节点。
 */
function locationTurnOf(location: ConversationLocation): number {
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : -1
}
function locationStepOf(location: ConversationLocation): number {
  return location.kind === 'step' ? location.step.step : -1
}

/** 把子调用 arguments（可能是对象或 JSON 字符串）规整成 JSON 字符串。 */
function argsToJson(raw: unknown): string {
  if (typeof raw === 'string') return raw
  try {
    return JSON.stringify(raw ?? {})
  } catch {
    return '{}'
  }
}

export const fileChangesDefinition: ConversationNodeDefinition<StepFileState> = {
  kind: 'liuli-file-changes',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool/code-dispatch-start') {
      return { id: 'c:' + String(event.data.subCallId), role: 'start' }
    }
    if (event.type === 'tool/code-dispatch') {
      return { id: 'c:' + String(event.data.subCallId), role: 'update' }
    }
    if (event.type === 'tool/call') {
      return { id: 'r:' + String(event.data.callId), role: 'start' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: 'r:' + String(event.data.message.source.callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type === 'tool/code-dispatch-start') {
      return {
        turn: locationTurnOf(match.location),
        step: locationStepOf(match.location),
        call: {
          name: match.event.data.name,
          argsRaw: argsToJson(match.event.data.arguments),
          view: null,
        },
        files: [],
        anchorSeq: undefined,
      }
    }
    if (match.event.type !== 'tool/call') throw new Error('liuli-file-changes start requires a tool/call or code-dispatch-start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      call: {
        name: match.event.data.name,
        argsRaw: match.event.data.arguments,
        view: match.view?.for === 'call' ? asDiffView(match.view.view) : null,
      },
      files: [],
      anchorSeq: undefined,
    }
  },
  update: (context, match) => {
    // 子调用结果：从 name + arguments 合成 hunks。
    if (match.event.type === 'tool/code-dispatch') {
      if (match.event.data.isError === true) return context.state
      const call = context.state.call
      if (call === null) return context.state
      const hunks = deriveHunks(call.name, call.argsRaw, call.view, null)
      if (hunks === null || hunks.length === 0) return context.state
      return mergeHunks(context, hunks, match.event.seq)
    }
    if (match.event.type !== 'tool/result' || !isAppendSurfaceEvent(match.event)) return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const call = context.state.call
    if (call === null) return context.state
    const resultView = match.view?.for === 'result' ? asDiffView(match.view.view) : null
    const hunks = deriveHunks(call.name, call.argsRaw, call.view, resultView)
    if (hunks === null || hunks.length === 0) return context.state
    return mergeHunks(context, hunks, match.event.seq)
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined || state.files.length === 0 || state.anchorSeq === undefined) return null
    return localChatNode(context, 'liuli-round-summary', state.anchorSeq, {
      turn: state.turn,
      step: state.step,
      files: state.files,
    }) as ChatNode<'liuli-round-summary'>
  },
}

/** 把 hunks 并入状态 files（按 path 合并）+ 刷新行级注入缓存。 */
function mergeHunks(
  context: ConversationNodeContext<StepFileState> & { readonly state: StepFileState },
  hunks: readonly FileDiffHunk[],
  seq: number,
): StepFileState {
  const files = [...context.state.files]
  for (const hunk of hunks) {
    diffCache.set(hunk.path, [...(diffCache.get(hunk.path) ?? []), hunk])
    const index = files.findIndex(entry => entry.path === hunk.path)
    if (index >= 0) {
      const existing = files[index]!
      files[index] = {
        ...existing,
        seq,
        hunks: [...existing.hunks, hunk],
      }
    } else {
      files.push({ seq, path: hunk.path, hunks: [hunk] })
    }
  }
  return { ...context.state, files, anchorSeq: seq }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** 每轮文件变更摘要（琉璃）。 */
    'liuli-round-summary': { turn: number; step: number; files: readonly TurnFileRecord[] }
  }
}

type RoundSummaryProps = PropsRuntime<'conversation.chat.node'> & {
  node: ChatNode<'liuli-round-summary'>
}

/** 路径工具：绝对/相对路径换算（与宿主 resolveWorkspacePath 同语义）。 */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/[/\\]+$/, '')
}
function isAbsolute(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
}
function relOf(path: string, cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') return path
  const cwdNorm = normPath(cwd)
  const pathNorm = normPath(path)
  if (pathNorm.startsWith(cwdNorm + '/')) return pathNorm.slice(cwdNorm.length + 1)
  return pathNorm
}
function absOf(path: string, cwd: string | undefined): string {
  if (isAbsolute(path)) return path
  if (cwd === undefined || cwd === '') return path
  return cwd.replace(/[\\/]+$/, '') + '/' + relOf(path, cwd)
}
function basenameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
function dirnameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? '' : path.slice(0, at)
}

/** 单个文件的 diff 统计：hunk 数 + 增删行数。 */
function diffStats(hunks: readonly FileDiffHunk[]): { hunks: number; adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const hunk of hunks) {
    if (hunk.oldText !== null && hunk.oldText !== '') {
      dels += hunk.oldText.split('\n').length
    }
    if (hunk.newText !== '') {
      adds += hunk.newText.split('\n').length
    }
  }
  return { hunks: hunks.length, adds, dels }
}

/** 展开图标（chevron-down，Material 风格）。 */
function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
    </svg>
  )
}

/** 复制文本到剪贴板（带降级）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文）时静默失败。
  }
}

interface FileRowProps {
  file: TurnFileRecord
  sessionId?: string
  cwd: string | undefined
  openFile: (path: string) => void
}

/** 一行文件：名称 + 目录 + DIFF 数量 + 审查/打开/展开（打开方式）。 */
function FileRow({ file, sessionId, cwd, openFile }: FileRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ right: number; top: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const abs = absOf(file.path, cwd)
  const rel = relOf(file.path, cwd)
  const stats = useMemo(() => diffStats(file.hunks), [file.hunks])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (menuRef.current !== null && menuRef.current.contains(target)) return
      if (menuPanelRef.current !== null && menuPanelRef.current.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onResize = (): void => { setMenuOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  const run = (action: () => void): void => {
    setMenuOpen(false)
    action()
  }

  return (
    <div className={css.fileRow}>
      <div className={css.fileInfo} title={rel}>
        <span className={css.fileName}>{basenameOf(rel)}</span>
        {dirnameOf(rel) !== '' && <span className={css.fileDir}>{dirnameOf(rel)}</span>}
      </div>
      <span className={css.fileStats} title={"${'${stats.hunks}'} 处修改"}>
        {stats.adds > 0 && <span className={css.statAdd}>+{stats.adds}</span>}
        {stats.dels > 0 && <span className={css.statDel}>−{stats.dels}</span>}
        {stats.adds === 0 && stats.dels === 0 && <span className={css.statHunks}>{stats.hunks}</span>}
      </span>
      <button
        type="button"
        className={css.btn}
        title="在侧栏审查文件中打开（全文 + diff）"
        onClick={() => { requestReviewFile(sessionId === undefined ? { path: rel } : { sessionId, path: rel }) }}
      >
        审查
      </button>
      <button type="button" className={css.btn} title="用默认编辑器打开" onClick={() => { openFile(file.path) }}>
        打开
      </button>
      <div className={css.menuWrap} ref={menuRef}>
        <button
          type="button"
          className={css.iconBtn}
          title="打开方式"
          aria-label="打开方式"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen(v => {
              const next = !v
              if (next && menuRef.current !== null) {
                const r = menuRef.current.getBoundingClientRect()
                const top = r.bottom + 4 + 108 > window.innerHeight ? Math.max(8, r.top - 4 - 108) : r.bottom + 4
                setMenuPos({ right: Math.max(8, window.innerWidth - r.right), top })
              } else if (!next) {
                setMenuPos(null)
              }
              return next
            })
          }}
        >
          <ExpandIcon />
        </button>
        {menuOpen && createPortal(
          <div ref={menuPanelRef} className={css.menu} role="menu" style={{ right: menuPos?.right ?? 0, top: menuPos?.top ?? 0 }}>
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => { run(() => { if (sessionId !== undefined) revealSidebarPath(sessionId, rel) }) }}
            >
              在资源管理器中打开
            </button>
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => { run(() => { void copyText(abs) }) }}
            >
              复制绝对路径
            </button>
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => { run(() => { void copyText(rel) }) }}
            >
              复制相对路径
            </button>
          </div>,
          document.body,
        )}
      </div>
    </div>
  )
}

/** 合并一轮内各 step 发布的文件记录（同 path 累计 hunks）。 */
function mergeTurnFiles(records: readonly TurnFileRecord[]): TurnFileRecord[] {
  const merged = new Map<string, TurnFileRecord>()
  for (const record of records) {
    const existing = merged.get(record.path)
    if (existing === undefined) {
      merged.set(record.path, record)
    } else {
      merged.set(record.path, {
        ...existing,
        seq: Math.max(existing.seq, record.seq),
        hunks: [...existing.hunks, ...record.hunks],
      })
    }
  }
  return [...merged.values()]
}

/**
 * 轮次结束卡片渲染器：仅当本节点是该轮最后一个节点时渲染，
 * 并从会话快照聚合整轮（各 step）的文件变更。
 */
export function RoundSummaryCard({ node, openFile, useSession, useSessions, sessionId }: RoundSummaryProps) {
  const locations = useSession(state => state.chat.locations)
  const nodes = useSession(state => state.chat.nodes)
  const order = useSession(state => state.chat.order)
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)

  // 轮号：code-dispatch 子调用事件没有 data.turn，从节点 location 推导。
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn.turn
    : node.data.turn

  // 卡片只在本轮最后一个文件变更节点上渲染（聚合整轮）——不要求是整轮
  // 最后节点，因为收尾的 assistant 文本节点排在本卡之后仍属同一轮。
  const isLast = turn >= 0 && locations.getTurn(turn).filter(key => {
    const candidate = nodes.get(key)
    return candidate?.kind === 'liuli-round-summary'
  }).at(-1) === node.key

  const files = useMemo(() => {
    if (!isLast || turn < 0) return []
    const records: TurnFileRecord[] = []
    for (const key of locations.getTurn(turn)) {
      if (!order.includes(key)) continue
      const candidate = nodes.get(key)
      if (candidate?.kind === 'liuli-round-summary') {
        records.push(...(candidate as ChatNode<'liuli-round-summary'>).data.files)
      }
    }
    return mergeTurnFiles(records)
  }, [isLast, locations, nodes, order, turn])

  if (!isLast || files.length === 0) return null

  return (
    <div className={css.root} data-liuli-turn-files="">
      <div className={css.head}>
        <span className={css.title}>本轮修改</span>
        <span className={css.count}>{files.length} 个文件</span>
      </div>
      <div className={css.list}>
        {files.map(file => (
          <FileRow key={file.path} file={file} sessionId={sessionId} cwd={cwd} openFile={openFile} />
        ))}
      </div>
    </div>
  )
}
