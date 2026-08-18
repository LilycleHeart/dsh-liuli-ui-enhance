/**
 * 侧边面板扩展标签：终端 / 开发者工具 / 模型调用轨迹 / 画板 / 计划 / 子智能体 / 辅助对话。
 * ZCode 对应面板在 DSH 内的可行实现：
 * - 终端：插件 node 半 /liuli-terminal WebSocket 升级路由 + piped shell（行模式）；
 * - 开发者工具：会话/投影(contextPressure/contextBreakdown/plan)/后台作业/存储诊断；
 * - 模型调用轨迹：当前会话 ConversationSnapshot 的工具调用时间线（含子调用）；
 * - 画板：本地 canvas 涂鸦板，笔画持久化 localStorage；
 * - 计划：会话 plan/todo/goal 投影；
 * - 子智能体：会话列表中 parentId 指向当前会话的子会话目录；
 * - 辅助对话：fork 当前会话生成子会话，面板内轻量对话（session.prompt 发送）。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ConversationSnapshot, ObservableSnapshot, SessionFace, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import css from './SidePaneExtraPanels.module.css'

/** 面板可用的宿主数据面（由 index.ts 注入）。 */
export interface SidePaneHostAccess {
  /** 会话列表标准 feed。 */
  sessionList: ObservableSnapshot<SessionListState>
  /** 解析会话的对外面（读 ConversationSnapshot + prompt + projections）。 */
  getSessionFace: (id: string) => SessionFace | undefined
  /** fork 一个会话，返回子会话 id。 */
  forkSession: (id: string) => Promise<string>
  /** 在主视图打开会话。 */
  openSession: (id: string) => void
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
  title: string
}

/** WebSocket 终端：行模式 piped shell（ZCode 终端面板的 DSH 对应物）。 */
export function TerminalPanel({ sessionId, title }: TerminalPanelProps) {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('connecting')
  const [input, setInput] = useState('')
  const [epoch, setEpoch] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)
  const outRef = useRef<HTMLDivElement | null>(null)
  const historyRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const qs = sessionId === undefined ? '' : `?sessionId=${encodeURIComponent(sessionId)}`
    const ws = new WebSocket(`${proto}://${window.location.host}/liuli-terminal${qs}`)
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
  }, [sessionId, epoch])

  useEffect(() => {
    const el = outRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [output])

  const send = (): void => {
    const ws = wsRef.current
    const line = input
    if (ws === null || ws.readyState !== WebSocket.OPEN) return
    ws.send(line)
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
      <div className={css.termBar}>
        <span className={css.termTitle}>{title}</span>
        <span className={css.termStatus} data-status={status}>
          {status === 'connecting' ? '连接中' : status === 'open' ? '已连接' : status === 'error' ? '连接失败' : '已断开'}
        </span>
        <button type="button" className={css.termBtn} onClick={() => { setOutput('') }}>清屏</button>
        <button type="button" className={css.termBtn} onClick={() => { setEpoch(v => v + 1) }}>重连</button>
      </div>
      <div ref={outRef} className={css.termOut}>
        <pre className={css.termPre}>{output}</pre>
      </div>
      <form className={css.termInputRow} onSubmit={(e) => { e.preventDefault(); send() }}>
        <span className={css.termPrompt}>$</span>
        <input
          className={css.termInput}
          value={input}
          onChange={(e) => { setInput(e.target.value) }}
          onKeyDown={onKeyDown}
          placeholder={status === 'open' ? '输入命令后回车' : '等待连接…'}
          disabled={status !== 'open'}
          spellCheck={false}
        />
      </form>
    </div>
  )
}

/* ── 开发者工具 ── */

export interface DeveloperToolsPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
}

/** 开发者工具：会话/投影/作业/存储诊断（ZCode developer-tools 的 DSH 对应物）。 */
export function DeveloperToolsPanel({ sessionId, host }: DeveloperToolsPanelProps) {
  const list = useSnapshot(host.sessionList)
  const face = sessionId === undefined ? undefined : host.getSessionFace(sessionId)
  const pressure = useSnapshot(face?.projections.faceOf('contextPressure'))
  const breakdown = useSnapshot(face?.projections.faceOf('contextBreakdown'))
  const plan = useSnapshot(face?.projections.faceOf('plan'))
  const todos = useSnapshot(face?.projections.faceOf('todos'))
  const stats = useSnapshot(face?.projections.faceOf('sessionStats'))

  const summary = sessionId === undefined ? undefined : list?.byId[sessionId]
  const jobs = sessionId === undefined ? undefined : list?.jobsBySession[sessionId]

  const storage = useMemo(() => {
    const rows: Array<{ key: string; bytes: number }> = []
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (key === null) continue
        if (!key.startsWith('denpa:') && !key.startsWith('liuli:')) continue
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
        <Row k="agent preset" v={summary?.agentPreset ?? '—'} />
        <Row k="状态" v={summary === undefined ? '—' : summary.running ? '运行中' : summary.completed === true ? '已完成' : '空闲'} />
        <Row k="更新于" v={summary === undefined ? '—' : relTime(summary.updatedAt)} />
      </Section>
      <Section title="模型请求统计">
        {stats === undefined && <div className={css.devEmpty}>暂无数据</div>}
        {stats !== undefined && <pre className={css.devJson}>{fmt(stats)}</pre>}
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

/* ── 模型调用轨迹 ── */

export interface TrajectoryPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
}

interface TrajectoryRow {
  callId: string
  name: string
  argsRaw: string
  running: boolean
  isError: boolean
  time: number
  durationMs: number | null
  resultText: string | null
  depth: number
}

/** 收集会话快照里的全部工具调用（含子调用），时间升序。 */
function collectCalls(snap: ConversationSnapshot): TrajectoryRow[] {
  const rows: TrajectoryRow[] = []
  const pushSettled = (node: { callId: string; call: { name: string; argsRaw: string } | null; time: number; callTime: number | null; content: readonly unknown[]; isError: boolean; subCalls: readonly unknown[] }, depth: number): void => {
    let text = ''
    for (const block of node.content) {
      const b = block as { type?: string; text?: string }
      if (b.type === 'text' && typeof b.text === 'string') text += b.text
    }
    rows.push({
      callId: node.callId,
      name: node.call?.name ?? node.callId,
      argsRaw: node.call?.argsRaw ?? '',
      running: false,
      isError: node.isError,
      time: node.time,
      durationMs: node.callTime === null ? null : Math.max(0, node.time - node.callTime),
      resultText: text === '' ? null : text.slice(0, 4000),
      depth,
    })
    for (const sub of node.subCalls) pushBlock(sub, depth + 1)
  }
  const pushBlock = (block: unknown, depth: number): void => {
    const b = block as { kind?: string; callId?: string }
    if (b.kind === 'tool-result' && typeof b.callId === 'string') {
      pushSettled(block as Parameters<typeof pushSettled>[0], depth)
    } else if (typeof b.callId === 'string' && typeof (b as { name?: unknown }).name === 'string') {
      const running = block as { callId: string; name: string; argsRaw: string; time: number }
      rows.push({
        callId: running.callId,
        name: running.name,
        argsRaw: running.argsRaw ?? '',
        running: true,
        isError: false,
        time: running.time,
        durationMs: null,
        resultText: null,
        depth,
      })
    }
  }
  for (const node of snap.nodes) {
    const n = node as { kind: string }
    if (n.kind === 'tool-result') pushBlock(node, 0)
  }
  for (const running of snap.runningCalls) pushBlock(running, 0)
  rows.sort((a, b) => a.time - b.time)
  return rows
}

/** 模型调用轨迹：当前会话工具调用时间线（ZCode model-trajectory 的 DSH 对应物）。 */
export function TrajectoryPanel({ sessionId, host }: TrajectoryPanelProps) {
  const face = sessionId === undefined ? undefined : host.getSessionFace(sessionId)
  const snap = useSnapshot(face)
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo(() => snap === undefined ? [] : collectCalls(snap), [snap])
  const runningCount = rows.filter(r => r.running).length
  const errorCount = rows.filter(r => r.isError).length

  if (sessionId === undefined) return <div className={css.devEmpty}>没有活动会话</div>

  return (
    <div className={css.trajRoot}>
      <div className={css.trajHead}>
        <span>调用 {rows.length}</span>
        {runningCount > 0 && <span className={css.trajRunning}>运行中 {runningCount}</span>}
        {errorCount > 0 && <span className={css.trajError}>错误 {errorCount}</span>}
        {snap !== undefined && snap.running && <span className={css.trajRunning}>回合进行中</span>}
      </div>
      <div className={css.trajList}>
        {rows.length === 0 && <div className={css.devEmpty}>还没有工具调用</div>}
        {rows.map(row => (
          <div key={row.callId} className={css.trajRow} style={{ paddingLeft: 10 + row.depth * 14 }}>
            <button
              type="button"
              className={css.trajRowHead}
              onClick={() => { setExpanded(expanded === row.callId ? null : row.callId) }}
            >
              <span className={css.trajDot} data-state={row.running ? 'running' : row.isError ? 'error' : 'done'} />
              <span className={css.trajName}>{row.name}</span>
              {row.durationMs !== null && <span className={css.trajDur}>{row.durationMs < 1000 ? `${row.durationMs}ms` : `${(row.durationMs / 1000).toFixed(1)}s`}</span>}
              <span className={css.trajTime}>{relTime(row.time)}</span>
            </button>
            {expanded === row.callId && (
              <div className={css.trajDetail}>
                {row.argsRaw !== '' && (
                  <>
                    <div className={css.trajDetailLabel}>参数</div>
                    <pre className={css.trajPre}>{row.argsRaw.slice(0, 2000)}</pre>
                  </>
                )}
                {row.running && <div className={css.trajDetailLabel}>运行中…</div>}
                {row.resultText !== null && (
                  <>
                    <div className={css.trajDetailLabel}>结果{row.isError ? '（错误）' : ''}</div>
                    <pre className={css.trajPre}>{row.resultText}</pre>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── 画板 ── */

export interface WhiteboardPanelProps {
  boardId: string
}

interface Stroke {
  color: string
  size: number
  erase: boolean
  points: Array<[number, number]>
}

const BOARD_COLORS = ['#1f2937', '#dc2626', '#16a34a', '#2563eb', '#d97706', '#9333ea']
const BOARD_SIZES = [2, 4, 8]

function boardKey(boardId: string): string {
  return `liuli:whiteboard:${boardId}`
}

function loadStrokes(boardId: string): Stroke[] {
  try {
    const raw = localStorage.getItem(boardKey(boardId))
    if (raw === null || raw === '') return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveStrokes(boardId: string, strokes: Stroke[]): void {
  try { localStorage.setItem(boardKey(boardId), JSON.stringify(strokes.slice(-500))) } catch { /* ignore */ }
}

/** 画板：本地 canvas 涂鸦板（ZCode whiteboard 的 DSH 对应物）。 */
export function WhiteboardPanel({ boardId }: WhiteboardPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const strokesRef = useRef<Stroke[]>(loadStrokes(boardId))
  const liveRef = useRef<Stroke | null>(null)
  const [color, setColor] = useState(BOARD_COLORS[0] ?? '#1f2937')
  const [size, setSize] = useState(4)
  const [erase, setErase] = useState(false)

  const redraw = (): void => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas === null || canvas === undefined || ctx === null) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const all = liveRef.current === null ? strokesRef.current : [...strokesRef.current, liveRef.current]
    for (const stroke of all) drawStroke(ctx, stroke)
  }

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke): void => {
    if (stroke.points.length === 0) return
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = stroke.size
    if (stroke.erase) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
      ctx.lineWidth = stroke.size * 4
    } else {
      ctx.strokeStyle = stroke.color
    }
    ctx.beginPath()
    const first = stroke.points[0]
    if (first === undefined) return
    ctx.moveTo(first[0], first[1])
    for (let i = 1; i < stroke.points.length; i += 1) {
      const p = stroke.points[i]
      if (p === undefined) continue
      ctx.lineTo(p[0], p[1])
    }
    ctx.stroke()
    ctx.restore()
  }

  // 画布尺寸跟随容器（含 devicePixelRatio），重绘全部笔画。
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (wrap === null || canvas === null) return
    const resize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext('2d')
      if (ctx !== null) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      redraw()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => { ro.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  useEffect(() => { redraw() }, [color, size, erase]) // eslint-disable-line react-hooks/exhaustive-deps

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    liveRef.current = { color, size, erase, points: [pointOf(e)] }
    redraw()
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const live = liveRef.current
    if (live === null) return
    live.points.push(pointOf(e))
    redraw()
  }

  const onPointerUp = (): void => {
    const live = liveRef.current
    if (live === null) return
    liveRef.current = null
    strokesRef.current = [...strokesRef.current, live]
    saveStrokes(boardId, strokesRef.current)
    redraw()
  }

  const clearBoard = (): void => {
    strokesRef.current = []
    liveRef.current = null
    saveStrokes(boardId, [])
    redraw()
  }

  const downloadPng = (): void => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const flat = document.createElement('canvas')
    flat.width = canvas.width
    flat.height = canvas.height
    const ctx = flat.getContext('2d')
    if (ctx === null) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(canvas, 0, 0)
    const a = document.createElement('a')
    a.href = flat.toDataURL('image/png')
    a.download = `whiteboard-${boardId}.png`
    a.click()
  }

  return (
    <div className={css.boardRoot}>
      <div className={css.boardBar}>
        <span className={css.boardSwatches}>
          {BOARD_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={css.boardSwatch}
              style={{ background: c }}
              data-active={!erase && color === c ? '' : undefined}
              aria-label={`颜色 ${c}`}
              onClick={() => { setColor(c); setErase(false) }}
            />
          ))}
        </span>
        <span className={css.boardSizes}>
          {BOARD_SIZES.map(s => (
            <button
              key={s}
              type="button"
              className={css.boardSize}
              data-active={size === s ? '' : undefined}
              aria-label={`线宽 ${s}`}
              onClick={() => { setSize(s) }}
            >
              <span style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
        </span>
        <button type="button" className={css.termBtn} data-active={erase ? '' : undefined} onClick={() => { setErase(v => !v) }}>橡皮</button>
        <button type="button" className={css.termBtn} onClick={clearBoard}>清空</button>
        <button type="button" className={css.termBtn} onClick={downloadPng}>导出 PNG</button>
      </div>
      <div ref={wrapRef} className={css.boardWrap}>
        <canvas
          ref={canvasRef}
          className={css.boardCanvas}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  )
}

/* ── 计划 ── */

export interface PlanPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
}

/** 计划：会话 plan / todos / goal 投影（ZCode plan-detail 的 DSH 对应物）。 */
export function PlanPanel({ sessionId, host }: PlanPanelProps) {
  const face = sessionId === undefined ? undefined : host.getSessionFace(sessionId)
  const plan = useSnapshot(face?.projections.faceOf('plan')) as
    | { active?: boolean; pending?: boolean } | undefined
  const todos = useSnapshot(face?.projections.faceOf('todos')) as
    | Array<{ content?: string; status?: string }> | undefined
  const goal = useSnapshot(face?.projections.faceOf('goal')) as
    | { objective?: string; phase?: string } | undefined

  if (sessionId === undefined) return <div className={css.devEmpty}>没有活动会话</div>

  const planActive = plan !== undefined && (plan.pending === true ? plan.active !== false : plan.active === true)

  return (
    <div className={css.planRoot}>
      <Section title="计划模式">
        <Row k="状态" v={plan === undefined ? '未启用' : planActive ? '进行中' : plan.pending === true ? '待确认' : '未激活'} />
      </Section>
      <Section title="目标">
        {goal === undefined || goal.objective === undefined
          ? <div className={css.devEmpty}>没有活动目标</div>
          : (
            <div className={css.planGoal}>
              <div className={css.planGoalText}>{goal.objective}</div>
              {goal.phase !== undefined && <div className={css.planGoalPhase}>{goal.phase}</div>}
            </div>
          )}
      </Section>
      <Section title="任务清单">
        {todos === undefined || todos.length === 0
          ? <div className={css.devEmpty}>暂无任务项</div>
          : (
            <div className={css.planTodos}>
              {todos.map((todo, i) => {
                const status = todo.status ?? 'pending'
                return (
                  <div key={i} className={css.planTodo} data-status={status}>
                    <span className={css.planTodoMark}>
                      {status === 'completed' ? '✓' : status === 'in_progress' ? '▶' : '○'}
                    </span>
                    <span className={css.planTodoText}>{todo.content ?? ''}</span>
                  </div>
                )
              })}
            </div>
          )}
      </Section>
    </div>
  )
}

/* ── 子智能体目录 ── */

export interface SubagentPanelProps {
  sessionId?: string | undefined
  host: SidePaneHostAccess
}

/** 子智能体目录：当前会话派生的子会话列表（ZCode subagent-directory 的 DSH 对应物）。 */
export function SubagentPanel({ sessionId, host }: SubagentPanelProps) {
  const list = useSnapshot(host.sessionList)

  const children = useMemo(() => {
    if (list === undefined || sessionId === undefined) return []
    return list.ids
      .map(id => list.byId[id])
      .filter((s): s is NonNullable<typeof s> => s !== undefined && s.parentId === sessionId)
  }, [list, sessionId])

  if (sessionId === undefined) return <div className={css.devEmpty}>没有活动会话</div>

  return (
    <div className={css.subRoot}>
      <div className={css.trajHead}>
        <span>子智能体 {children.length}</span>
      </div>
      <div className={css.subList}>
        {children.length === 0 && <div className={css.devEmpty}>这个会话还没有派生子智能体</div>}
        {children.map(child => (
          <button
            key={child.id}
            type="button"
            className={css.subRow}
            onClick={() => { host.openSession(child.id) }}
          >
            <span className={css.trajDot} data-state={child.running ? 'running' : child.completed === true ? 'done' : 'idle'} />
            <span className={css.subTitle}>{child.displayTitle}</span>
            {child.agentPreset !== undefined && <span className={css.subPreset}>{child.agentPreset}</span>}
            <span className={css.trajTime}>{relTime(child.updatedAt)}</span>
          </button>
        ))}
      </div>
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
  title: string
}

/** 从会话节点里提取一段纯文本（内容块 text 拼接，限长）。 */
function nodeText(content: readonly unknown[], max: number): string {
  let text = ''
  for (const block of content) {
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') text += b.text
    if (text.length >= max) break
  }
  return text.slice(0, max)
}

/** 辅助对话：fork 当前会话生成子会话，面板内收发消息（ZCode selection-side-chat 的 DSH 对应物）。 */
export function SideChatPanel({ sessionId, host, childSessionId, onChildCreated, title }: SideChatPanelProps) {
  const [draft, setDraft] = useState('')
  const [forkError, setForkError] = useState<string | null>(null)
  const forkingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 首次打开：fork 当前会话得到子会话。
  useEffect(() => {
    if (childSessionId !== undefined || sessionId === undefined) return
    if (forkingRef.current) return
    forkingRef.current = true
    host.forkSession(sessionId)
      .then((childId) => { onChildCreated(childId) })
      .catch((err: unknown) => { setForkError(err instanceof Error ? err.message : String(err)) })
      .finally(() => { forkingRef.current = false })
  }, [childSessionId, sessionId, host, onChildCreated])

  const childFace = childSessionId === undefined ? undefined : host.getSessionFace(childSessionId)
  const snap = useSnapshot(childFace)

  const items = useMemo(() => {
    if (snap === undefined) return []
    const out: Array<{ key: string; role: 'user' | 'assistant' | 'system'; text: string }> = []
    const nodes = snap.nodes.slice(-80)
    for (const node of nodes) {
      const n = node as { kind: string; seq: number }
      if (n.kind === 'user') {
        const text = nodeText((node as { content: readonly unknown[] }).content, 600)
        if (text.trim() !== '') out.push({ key: `u${n.seq}`, role: 'user', text })
      } else if (n.kind === 'assistant') {
        const blocks = (node as { blocks: readonly Array<{ kind: string; text?: string }> }).blocks
        let text = ''
        for (const block of blocks) {
          if (block.kind === 'text' && typeof block.text === 'string') text += block.text
        }
        if (text.trim() !== '') out.push({ key: `a${n.seq}`, role: 'assistant', text: text.slice(0, 1200) })
      }
    }
    return out
  }, [snap])

  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [items.length, snap?.running])

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || childFace === undefined) return
    const content = [{ type: 'text', text }] as Parameters<SessionFace['prompt']>[0]
    void childFace.prompt(content, 'queue')
    setDraft('')
  }

  return (
    <div className={css.chatRoot}>
      <div className={css.chatHead}>
        <span>{title}</span>
        {childSessionId === undefined && <span className={css.termStatus} data-status="connecting">{forkError === null ? '正在创建子会话…' : `创建失败：${forkError}`}</span>}
        {snap !== undefined && snap.running && <span className={css.trajRunning}>运行中</span>}
      </div>
      <div ref={scrollRef} className={css.chatScroll}>
        {items.length === 0 && (
          <div className={css.devEmpty}>
            {childSessionId === undefined ? '准备中…' : '从下面输入消息，开始这段辅助对话（它带着当前会话的上下文 fork）'}
          </div>
        )}
        {items.map(item => (
          <div key={item.key} className={css.chatMsg} data-role={item.role}>
            <div className={css.chatMsgText}>{item.text}</div>
          </div>
        ))}
        {snap?.partial !== undefined && snap.partial !== null && (
          <div className={css.chatMsg} data-role="assistant">
            <div className={css.chatMsgText}>
              {snap.partial.blocks.filter(b => b.kind === 'text').map(b => (b as { text?: string }).text ?? '').join('').slice(0, 1200) || '…'}
            </div>
          </div>
        )}
      </div>
      <form className={css.chatComposer} onSubmit={(e) => { e.preventDefault(); send() }}>
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
          }}
          placeholder={childFace === undefined ? '子会话准备中…' : '输入消息，Enter 发送（Shift+Enter 换行）'}
          disabled={childFace === undefined}
        />
        <button type="submit" className={css.chatSend} disabled={childFace === undefined || draft.trim() === ''}>发送</button>
      </form>
    </div>
  )
}
