/**
 * 侧边面板扩展标签：终端 / 开发者工具 / 辅助对话。
 * DSH 实现面板在 DSH 内的可行实现：
 * - 终端：插件 node 半 /liuli-terminal WebSocket 升级路由 + piped shell（行模式）；
 * - 开发者工具：会话/投影(contextPressure/contextBreakdown/plan)/后台作业/存储诊断；
 * - 辅助对话：fork 当前会话生成子会话，面板内轻量对话（session.prompt 发送）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconSendOutline14, IconPlusOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ObservableSnapshot, SessionFace, SessionId, SessionListState,
} from './compat.ts'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ChatFlowView, ChatFlowPartial } from './chat-flow-view.tsx'
import { LIULI_LS_KEY, liuliSettingsOf } from '../liuli-settings.ts'
import css from './SidePaneExtraPanels.module.css'

/** 面板可用的宿主数据面（由 index.ts 注入）。 */
export interface SidePaneHostAccess {
  /** 会话列表标准 feed。 */
  sessionList: ObservableSnapshot<SessionListState>
  /** 解析会话的对外面（prompt + 生命周期快照 + projections）。 */
  getSessionFace: (id: string) => SessionFace | undefined
  /** 2.0.4：会话的 Chat 内容快照源（legacy.nodes/partial 兼容投影）。 */
  getChatSnapshot: (id: string) => ObservableSnapshot<ChatSnapshot> | undefined
  /** fork 一个会话，返回子会话 id。 */
  forkSession: (id: string) => Promise<string>
  /** 在主视图打开会话。 */
  openSession: (id: string) => void
  /** 归档一个会话（隐藏于会话列表；辅助对话 fork 后归档，只存在于标签页）。 */
  archiveSession: (id: string) => Promise<void>
  /** 归档会话 id 集合（子智能体目录据此过滤归档子会话）。 */
  archivedSessionIds: ObservableSnapshot<readonly string[]>
}

/** 订阅一个 ObservableSnapshot（源可缺省）。 */
function useSnapshot<T>(source: ObservableSnapshot<T> | undefined): T | undefined {
  const [snap, setSnap] = useState<T | undefined>(() => source?.getSnapshot())
  useEffect(() => {
    if (source === undefined) {
      setSnap(undefined)
      return
    }
    setSnap(source.getSnapshot())
    return source.subscribe(() => { setSnap(source.getSnapshot()) })
  }, [source])
  return snap
}

/** 未知投影值的安全序列化。 */
function fmt(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) ?? String(v) } catch { return String(v) }
}

/** 相对时间（与侧边面板概览一致）。 */
function relTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/* ── 终端 ── */

export interface TerminalPanelProps {
  sessionId?: string | undefined
}

/** 读取「侧边栏默认终端」设置值（功能设置页配置；'' = 宿主默认）。
 *  旧版终端面板把选择记在 liuli:terminal-shell，这里作一次性迁移兜底。 */
function terminalShellSetting(): string {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (raw !== null && raw !== '') {
      const s = liuliSettingsOf(JSON.parse(raw))
      if (s.terminal_shell !== '') return s.terminal_shell
    }
    return localStorage.getItem('liuli:terminal-shell') ?? ''
  } catch { return '' }
}

/** WebSocket 终端：行模式 piped shell（DSH 终端面板的 DSH 实现）。 */
export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [input, setInput] = useState('')
  const [epoch, setEpoch] = useState(0)
  const [shell] = useState<string>(terminalShellSetting)
  const wsRef = useRef<WebSocket | null>(null)
  const outRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const historyRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)
  // Windows 上 cmd/PowerShell 的提示符以 > 结尾；bash 保持 $。
  const prompt = shell === 'bash' ? '$' : '>'

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const params = new URLSearchParams()
    if (sessionId !== undefined) params.set('sessionId', sessionId)
    if (shell !== '') params.set('shell', shell)
    const qs = params.toString()
    const ws = new WebSocket(`${proto}://${window.location.host}/liuli-terminal${qs === '' ? '' : `?${qs}`}`)
    wsRef.current = ws
    setStatus('connecting')
    ws.onopen = () => { setStatus('open') }
    ws.onmessage = (e) => {
      setOutput(prev => (prev + String(e.data)).slice(-200000))
    }
    ws.onclose = () => { setStatus(s => s === 'error' ? s : 'closed') }
    ws.onerror = () => { setStatus('error') }
    return () => {
      ws.onclose = null
      ws.onerror = null
      try { ws.close() } catch { /* ignore */ }
    }
  }, [sessionId, epoch, shell])

  useEffect(() => {
    const el = outRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [output])

  // 意外断开自动重连（最多 3 次，3s 间隔），替代已移除工具条里的「重连」按钮。
  const [reconnectTries, setReconnectTries] = useState(0)
  useEffect(() => {
    if (status !== 'closed' || reconnectTries >= 3) return
    const t = setTimeout(() => {
      setReconnectTries(n => n + 1)
      setEpoch(n => n + 1)
    }, 3000)
    return () => { clearTimeout(t) }
  }, [status, reconnectTries])

  const send = (): void => {
    const ws = wsRef.current
    const line = input
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    ws.send(line)
    // 行模式 shell 不会回显输入，这里本地回显命令，让终端呈现常见终端的“提示符 + 命令 + 输出”效果。
    setOutput(prev => (prev + `${prompt} ${line}\r\n`).slice(-200000))
    if (line.trim() !== '') {
      historyRef.current = [...historyRef.current.slice(-49), line]
    }
    histIdxRef.current = -1
    setInput('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const h = historyRef.current
      if (h.length === 0) return
      histIdxRef.current = histIdxRef.current < 0 ? h.length - 1 : Math.max(0, histIdxRef.current - 1)
      setInput(h[histIdxRef.current] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const h = historyRef.current
      if (histIdxRef.current < 0) return
      histIdxRef.current += 1
      if (histIdxRef.current >= h.length) {
        histIdxRef.current = -1
        setInput('')
      } else {
        setInput(h[histIdxRef.current] ?? '')
      }
    }
  }

  return (
    <div className={css.termRoot}>
      <div
        ref={outRef}
        className={css.termOut}
        onClick={() => {
          const selection = window.getSelection()
          if (selection === null || selection.isCollapsed) inputRef.current?.focus()
        }}
      >
        <pre className={css.termPre}>{output}</pre>
        <div className={css.termCmdLine} aria-hidden="true">
          <span className={css.termPrompt}>{prompt}</span>
          <span className={css.termInputText}>{input}</span>
          <span className={css.termCursor} />
        </div>
        <input
          ref={inputRef}
          className={css.termHiddenInput}
          value={input}
          onChange={(e) => { setInput(e.target.value) }}
          onKeyDown={onKeyDown}
          disabled={status !== 'open'}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="终端命令输入"
        />
      </div>
    </div>
  )
}

/* ── 开发者工具 ── */

export interface DeveloperToolsPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
}

/** 开发者工具：会话/投影/作业/存储诊断（DSH developer-tools 的 DSH 实现）。 */
export function DeveloperToolsPanel({ sessionId, host }: DeveloperToolsPanelProps) {
  const list = useSnapshot(host.sessionList)
  const face = sessionId === undefined ? undefined : host.getSessionFace(sessionId)
  const pressure = useSnapshot(face?.projections.faceOf('contextPressure'))
  const breakdown = useSnapshot(face?.projections.faceOf('contextBreakdown'))
  const plan = useSnapshot(face?.projections.faceOf('plan'))
  const todos = useSnapshot(face?.projections.faceOf('todos'))
  const stats = useSnapshot(face?.projections.faceOf('sessionStats'))

  const summary = sessionId === undefined ? undefined : list?.byId[sessionId as SessionId]
  const jobs = sessionId === undefined ? undefined : list?.jobsBySession[sessionId as SessionId]

  const storage = useMemo(() => {
    const rows: Array<{ key: string; bytes: number }> = []
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key === null) continue
        if (!key.startsWith('liuli:')) continue
        rows.push({ key, bytes: (localStorage.getItem(key) ?? '').length * 2 })
      }
    } catch { /* ignore */ }
    rows.sort((a, b) => b.bytes - a.bytes)
    return rows
  }, [])

  return (
    <div className={css.devRoot}>
      <Section title="会话">
        <Row k="sessionId" v={sessionId ?? '—'} />
        <Row k="标题" v={summary?.displayTitle ?? '—'} />
        <Row k="cwd" v={summary?.cwd ?? '—'} />
        {/* 2.0.4：SessionSummary 移除 agentPreset 字段（会话摘要瘦身）。 */}
        <Row k="状态" v={summary === undefined ? '—' : summary.running ? '运行中' : summary.completed === true ? '已完成' : '空闲'} />
        <Row k="更新于" v={summary === undefined ? '—' : relTime(summary.updatedAt)} />
      </Section>
      <Section title="模型请求统计">
        {stats == null && <div className={css.devEmpty}>暂无数据</div>}
        {stats != null && <pre className={css.devJson}>{fmt(stats)}</pre>}
      </Section>
      <Section title="上下文压力">
        <Row k="pressure" v={fmt(pressure)} />
        <Row k="breakdown" v={fmt(breakdown)} />
      </Section>
      <Section title="计划模式">
        <Row k="plan" v={fmt(plan)} />
        <Row k="todos" v={Array.isArray(todos) ? `${todos.length} 项` : fmt(todos)} />
      </Section>
      <Section title="后台作业">
        {jobs === undefined || jobs.length === 0
          ? <div className={css.devEmpty}>没有后台作业</div>
          : jobs.map((job, i) => (
            <Row key={i} k={fmt((job as { label?: unknown }).label ?? i)} v={fmt((job as { status?: unknown }).status ?? '')} />
          ))}
      </Section>
      <Section title="本地存储（插件）">
        {storage.length === 0 && <div className={css.devEmpty}>无插件键</div>}
        {storage.map(row => (
          <Row key={row.key} k={row.key} v={`${(row.bytes / 1024).toFixed(1)} KB`} />
        ))}
      </Section>
      <Section title="运行时">
        <Row k="页面" v={window.location.href} />
        <Row k="视口" v={`${window.innerWidth}×${window.innerHeight}`} />
        <Row k="UA" v={navigator.userAgent.slice(0, 80)} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.devSection}>
      <div className={css.devSectionTitle}>{title}</div>
      <div className={css.devSectionBody}>{children}</div>
    </section>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className={css.devRow}>
      <span className={css.devKey}>{k}</span>
      <span className={css.devVal}>{v}</span>
    </div>
  )
}

/* ── 辅助对话 ── */

export interface SideChatPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
  /** 已 fork 出的子会话 id（持久化在标签上）。 */
  childSessionId?: string | undefined
  /** fork 成功后回写标签。 */
  onChildCreated: (childId: string) => void
  /** 首次打开时自动发送给子会话的问题（/btw 指令带出）。 */
  initialPrompt?: string | undefined
  /** initialPrompt 已被消费（面板回写标签清除，避免重开重复发送）。 */
  onPromptConsumed?: (() => void) | undefined
  /** 「本轮侧边对话」起点：fork 继承的上一轮对话历史不渲染（持久化在标签上）。 */
  baselineNodes?: number | undefined
  /** 起点已捕获 → 回写标签持久化：重开仍生效，上轮对话历史永远不显示。 */
  onBaselineCaptured?: ((baseline: number) => void) | undefined
}

/** fork 出的子会话默认未 open：客户端没有事件窗口、不订阅 mux 流，
 * 快照 nodes 恒空。open()（Session 类公开方法，但刻意不在 ISession 面上）
 * 拉取历史窗口并订阅流——幂等、不切换当前会话。 */
function openSessionFace(face: SessionFace): Promise<void> {
  const withOpen = face as SessionFace & { open: () => Promise<void> }
  return typeof withOpen.open === 'function' ? withOpen.open() : Promise.resolve()
}

/** 上下文占用计量（复刻官方 ContextMeter）：环钮 + 点击展开明细面板。 */
const METER_RADIUS = 6.2
const METER_CIRCUMFERENCE = 2 * Math.PI * METER_RADIUS
const METER_ROWS = [
  { key: 'systemTokens', label: '系统', color: 'ctxSystem' },
  { key: 'toolsTokens', label: '工具', color: 'ctxTools' },
  { key: 'messageTokens', label: '消息', color: 'ctxMessages' },
] as const

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function ContextMeter({ face }: { face: SessionFace }) {
  const pressureSnap = useSnapshot(face.projections.faceOf('contextPressure')) as
    { projectedTokens?: number; pressureTokens?: number; contextWindow?: number } | undefined
  const breakdownSnap = useSnapshot(face.projections.faceOf('contextBreakdown')) as
    { systemTokens?: number; toolsTokens?: number; messageTokens?: number } | undefined
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  // hooks 必须无条件执行（React 规则）；不可用时的提前 return 放在所有 hooks 之后
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const usedTokens = pressureSnap?.projectedTokens ?? pressureSnap?.pressureTokens
  if (usedTokens === undefined || pressureSnap?.contextWindow === undefined) return null
  const percent = Math.min(100, Math.round(usedTokens / pressureSnap.contextWindow * 100))
  const breakdownTotal = breakdownSnap === undefined
    ? 0
    : (breakdownSnap.systemTokens ?? 0) + (breakdownSnap.toolsTokens ?? 0) + (breakdownSnap.messageTokens ?? 0)
  const segments = breakdownSnap === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: '', width: percent }]
    : METER_ROWS.map(row => ({
        key: row.key,
        color: row.color,
        width: percent * ((breakdownSnap[row.key] as number | undefined) ?? 0) / breakdownTotal,
      })).filter(seg => seg.width > 0)

  return (
    <span ref={rootRef} className={css.ctxRoot}>
      <button
        type="button"
        className={css.ctxTrigger}
        aria-label={`上下文占用 ${percent}%`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(v => !v) }}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle className={css.ctxTrack} cx="7" cy="7" r={METER_RADIUS} />
          <circle
            className={css.ctxFill}
            cx="7" cy="7" r={METER_RADIUS}
            strokeDasharray={`${METER_CIRCUMFERENCE * percent / 100} ${METER_CIRCUMFERENCE}`}
            transform="rotate(-90 7 7)"
          />
        </svg>
      </button>
      {open && (
        <div className={css.ctxPanel} role="dialog" aria-label="已用上下文">
          <div className={css.ctxHeader}>
            <span className={css.ctxHeadline}>已用上下文</span>
            <span className={css.ctxPercent}>{percent}%</span>
            <span className={css.ctxFigures}>~{formatTokens(usedTokens)} / {formatTokens(pressureSnap.contextWindow)}</span>
          </div>
          <div className={css.ctxBar}>
            {segments.map(seg => (
              <div
                key={seg.key}
                className={css.ctxSegment + (seg.color !== '' ? ' ' + css[seg.color] : '')}
                style={{ width: `${seg.width}%` }}
              />
            ))}
          </div>
          {breakdownSnap !== undefined && (
            <dl className={css.ctxRows}>
              {METER_ROWS.map(row => (
                <div key={row.key} className={css.ctxRow}>
                  <dt>
                    <span className={css.ctxSwatch + ' ' + css[row.color]} aria-hidden="true" />
                    {row.label}
                  </dt>
                  <dd>{formatTokens((breakdownSnap[row.key] as number | undefined) ?? 0)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </span>
  )
}

/** 辅助对话：fork 当前会话生成子会话，面板内收发消息（DSH selection-side-chat 的 DSH 实现）。 */
export function SideChatPanel({ sessionId, host, childSessionId, onChildCreated, initialPrompt, onPromptConsumed, baselineNodes, onBaselineCaptured }: SideChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const composerRef = useRef<HTMLFormElement | null>(null)
  const forkingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const initialPromptSent = useRef(false)

  // 「本轮侧边对话」起点：fork 继承的上一轮对话历史只作模型上下文输入，
  // 面板只渲染起点之后的节点（面板自己发的消息与回答）。标签持久化优先，
  // 未持久化时在 fork/open 完成后、首次发送前捕获一次，之后不再覆盖。
  const [baseline, setBaseline] = useState<number | undefined>(baselineNodes)
  useEffect(() => {
    if (baselineNodes !== undefined && baselineNodes !== baseline) setBaseline(baselineNodes)
  }, [baselineNodes, baseline])
  const captureBaseline = useCallback((_face: SessionFace | undefined): number | undefined => {
    if (baseline !== undefined) return baseline
    // 2.0.4：节点数从 Chat 内容快照读（legacy.nodes 兼容投影）。
    const chat = childSessionId === undefined ? undefined : host.getChatSnapshot(childSessionId)
    const n = chat?.getSnapshot()?.legacy.nodes.length
    if (n === undefined) return undefined
    setBaseline(n)
    onBaselineCaptured?.(n)
    return n
  }, [baseline, onBaselineCaptured, childSessionId, host])

  // 辅助对话可用命令（琉璃注册的 /side /btw；命令菜单点击后把命令文本填入 draft）
  const commands = useMemo(() => [
    { name: '/side', description: '在当前会话侧边栏新建一个辅助对话' },
    { name: '/btw <问题>', description: '把问题交给辅助对话并发回答，不改变当前会话上下文' },
  ], [])

  // 首次打开：fork 当前会话得到子会话。
  useEffect(() => {
    if (childSessionId !== undefined || sessionId === undefined) return
    if (forkingRef.current) return
    forkingRef.current = true
    host.forkSession(sessionId)
      .then((childId) => {
        // fork 出的子会话默认未 open：客户端没有事件窗口、不订阅流，
        // 快照 nodes 恒空。立即 open（幂等，不切换当前会话）让历史窗口
        // 与 mux 事件流就绪，发送后回答才能显示。
        const face = host.getSessionFace(childId)
        if (face !== undefined) {
          void openSessionFace(face)
            .then(() => { captureBaseline(face) })
            .catch(() => { /* open 失败不阻塞面板 */ })
        }
        onChildCreated(childId)
      })
      .catch((err: unknown) => { setForkError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { forkingRef.current = false })
  }, [childSessionId, sessionId, host, onChildCreated, captureBaseline])

  // 辅助对话的 fork 只存在于标签页：子会话（含旧标签持久化的）始终归档，
  // 不出现在会话列表（幂等；归档后 binding 仍可寻址，prompt 照常工作）。
  useEffect(() => {
    if (childSessionId === undefined) return
    void host.archiveSession(childSessionId).catch(() => { /* 归档失败不影响使用 */ })
  }, [childSessionId, host])

  // /btw 带出的初始问题：挂载即从标签清除（刷新不重发），值留在 ref，
  // 子会话就绪后自动发送一次（问题只进辅助对话，不改变主会话上下文）。
  const initialPromptRef = useRef(initialPrompt)
  useEffect(() => {
    if (initialPrompt === undefined || initialPrompt === '') return
    initialPromptRef.current = initialPrompt
    onPromptConsumed?.()
  }, [initialPrompt, onPromptConsumed])

  const childFace = childSessionId === undefined ? undefined : host.getSessionFace(childSessionId)
  // 2.0.4：内容(nodes/partial)与生命周期(running)分家 —— 分别订阅两个源。
  const chatSnap = useSnapshot(childSessionId === undefined ? undefined : host.getChatSnapshot(childSessionId))
  const snap = useSnapshot(childFace)
  const nodes = chatSnap?.legacy.nodes
  const partial = chatSnap?.legacy.partial

  useEffect(() => {
    const text = initialPromptRef.current?.trim()
    if (text === undefined || text === '') return
    if (childFace === undefined) return
    if (initialPromptSent.current) return
    initialPromptSent.current = true
    initialPromptRef.current = undefined
    const content = [{ type: 'text', text }] as Parameters<SessionFace['prompt']>[0]
    // open 确保事件窗口/订阅就绪后发送（幂等；fork 时已触发过一次）。
    void openSessionFace(childFace)
      .then(() => { captureBaseline(childFace); childFace.prompt(content, 'queue') })
      .catch(() => childFace.prompt(content, 'queue'))
  }, [childFace, captureBaseline])

  // 可见节点数：起点（继承历史边界）之后的节点；面板只显示本轮侧边对话。
  const fromIdx = baseline ?? 0
  const visibleCount = nodes === undefined ? 0 : Math.max(0, nodes.length - fromIdx)

  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [visibleCount, snap?.running])

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || childFace === undefined) return
    const content = [{ type: 'text', text }] as Parameters<SessionFace['prompt']>[0]
    void openSessionFace(childFace)
      .then(() => { captureBaseline(childFace); childFace.prompt(content, 'queue') })
      .catch(() => childFace.prompt(content, 'queue'))
    setDraft('')
  }

  // 官方 InputBar：运行中发送按钮变停止方块（primaryStops = running）
  const running = snap?.running === true
  const stop = (): void => {
    if (childFace === undefined) return
    void childFace.cancel().catch(() => { /* 取消失败不阻塞 */ })
  }
  const onPrimary = (): void => {
    if (running) { stop(); return }
    send()
  }

  return (
    <div className={css.chatRoot}>
      {/* .chatScroll 是侧边栏助手自绘信息流的外层列：ChatFlowView 的 .flow 与
          流式尾巴都直接挂在它下面（.flow 自身也是列），挂 data-liuli-chat-flow
          让级联观察器识别本列（锚点须为列直接子元素，见 liuli-transition.ts）。 */}
      <div ref={scrollRef} className={css.chatScroll} data-liuli-chat-flow="">
        {visibleCount === 0 && partial === undefined && (
          <div className={css.devEmpty}>
            {childSessionId === undefined ? '准备中…' : '从下面输入消息，开始这段辅助对话（它带着当前会话的上下文 fork，继承的上一轮对话不显示）'}
          </div>
        )}
        <ChatFlowView snap={chatSnap} from={fromIdx} />
        <ChatFlowPartial partial={partial} running={snap?.running === true} />
      </div>
      <form ref={composerRef} className={css.chatComposer} onSubmit={(e) => { e.preventDefault(); send() }} data-composer-card="true">
        <div className={css.composerScroll}>
          <div className={css.composerGrow}>
            <textarea
              className={css.chatInput}
              value={draft}
              rows={2}
              onChange={(e) => { setDraft(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
                if (e.key === 'Escape') setCommandMenuOpen(false)
              }}
              placeholder={childFace === undefined
                ? (forkError === null ? '子会话准备中…' : `创建失败：${forkError}`)
                : '输入消息，Enter 发送（Shift+Enter 换行）'}
              disabled={childFace === undefined}
            />
            <div className={css.composerMirror} aria-hidden="true">{`${draft}\n`}</div>
          </div>
        </div>
        <div className={css.composerRow}>
          <div className={css.composerTools}>
            <button
              type="button"
              className={css.composerAdd}
              disabled={childFace === undefined}
              aria-label="命令"
              aria-haspopup="listbox"
              aria-expanded={commandMenuOpen}
              title="命令"
              onClick={() => { setCommandMenuOpen(v => !v) }}
            >
              <IconPlusOutline16 size={14} />
            </button>
            {commandMenuOpen && (
              <div className={css.commandMenu} role="listbox" data-testid="sidechat-command-menu">
                <div className={css.commandMenuViewport}>
                  {commands.map(cmd => (
                    <button
                      key={cmd.name}
                      type="button"
                      role="option"
                      className={css.commandRow}
                      onClick={() => {
                        setDraft(cmd.name + ' ')
                        setCommandMenuOpen(false)
                        const ta = composerRef.current?.querySelector('textarea')
                        ta?.focus()
                      }}
                    >
                      <span className={css.commandLabel}>{cmd.name}</span>
                      <span className={css.commandDetail}>{cmd.description}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className={css.composerTrailing}>
            {childFace !== undefined && <ContextMeter face={childFace} />}
            <button
              type="button"
              className={css.chatSend}
              disabled={childFace === undefined || (!running && draft.trim() === '')}
              aria-label={running ? '停止' : '发送'}
              onClick={onPrimary}
            >
              {running
                ? <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="3" fill="currentColor" /></svg>
                : <IconSendOutline14 size={16} />}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
