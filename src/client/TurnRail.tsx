/**
 * 琉璃主题 · 对话轮次刻度侧边栏（琉璃 时间线风格）。
 *
 * 挂在 `conversation.session.header.utilities` slot（仅作挂载点，官方版本
 * 没有 header.tabs），随后把真正的
 * 时间线 rail portal 到会话根 `[data-phase]`：
 * - 左侧一条竖向刻度线，每轮对话一个刻度；
 * - 刻度上的胶囊会沿竖线滑动：悬停/选中时定位到对应刻度，滚动时跟随视口
 *   中心最近的对话轮次；
 * - 胶囊分两栏：上栏 轮数+摘要；下栏单开一行（commit 左，时间 日期 X月X日 右）。
 *
 * commit / 摘要从对话内容自动提取：
 * - commit：扫描该轮 tool-call 子树及结果的 commit 短哈希；
 * - 摘要：取该轮用户消息的第一段非空文本（无用户文本时回退 assistant 文本）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, ChatLocationNodeIndex, ChatNodeStore, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the runtime's SessionStandardProps merge (useSession/sessionId).
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import css from './TurnRail.module.css'

type TurnRailProps = PropsRuntime<'conversation.session.header.utilities'>

interface TurnInfo {
  readonly commit: string
  readonly summary: string
  readonly time: string
  readonly date: string
}

/** 由插件 apply 注入：把 commit 号作为引用卡片送回当前会话输入框。 */
type CommitReturnHandler = (commit: string) => void
let commitReturnHandler: CommitReturnHandler | null = null

export function setTurnRailCommitHandler(handler: CommitReturnHandler | null): void {
  commitReturnHandler = handler
}

/** 把 turn/start 或 turn/end 时间拆成 `HH:mm` 与 `MM-DD`。 */
function formatTurnDateTime(time: number | undefined): { time: string; date: string } {
  if (time === undefined) return { time: '', date: '' }
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return {
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
  }
}

/** 从一段文本里提取 git commit 号（短哈希，7-40 位 hex）。 */
function extractCommitHashes(raw: string): string[] {
  const hashes: string[] = []
  const push = (hash: string | undefined): void => {
    if (hash !== undefined && /^[0-9a-f]{7,40}$/i.test(hash)) hashes.push(hash.toLowerCase())
  }
  const field = raw.match(/"(?:commitHash|commit_id|sha|hash)"\s*:\s*"([0-9a-f]{7,40})"/i)
  push(field?.[1])
  const commit = raw.match(/\bcommit\s+([0-9a-f]{7,40})/i)
  push(commit?.[1])
  const bracket = raw.match(/\[[^\]]*?\b([0-9a-f]{7,40})\b[^\]]*\]/i)
  push(bracket?.[1])
  const contextual = raw.match(/(?:^|\n)[^\n]*?(?:commit|HEAD|master|main)[^\n]*?\b([0-9a-f]{7,40})\b/i)
  push(contextual?.[1])
  return hashes
}

/** 把工具结果 content 块拼成纯文本，用于提取 commit 号。 */
function contentText(content: readonly { type?: string; text?: string }[] | undefined): string {
  if (content === undefined) return ''
  return content
    .map(block => block.type === 'text' && typeof block.text === 'string' ? block.text : '')
    .join('\n')
}

/** 递归收集一个 tool 子树里的 git commit 号。 */
function collectToolCommits(block: ToolCallBlock, hashes: string[]): void {
  const name = 'name' in block ? block.name : block.call?.name
  const argsRaw = 'argsRaw' in block ? block.argsRaw : block.call?.argsRaw
  const haystack = `${name ?? ''} ${argsRaw ?? ''}`
  const isGitTool = name?.toLowerCase() === 'git' || /git/i.test(name ?? '')
  const looksLikeCommit = /git commit\b/i.test(haystack)
    || (isGitTool && /"commit"|commit/i.test(argsRaw ?? ''))
  if (looksLikeCommit) hashes.push(...extractCommitHashes(argsRaw ?? ''))
  if ('content' in block && block.content !== undefined) {
    const text = contentText(block.content)
    if (looksLikeCommit || /git commit|commit\b/i.test(text)) {
      hashes.push(...extractCommitHashes(text))
    }
  }
  for (const child of block.subCalls ?? []) collectToolCommits(child, hashes)
}

/** 从单个 Chat 节点提取用户消息文本块（user/steering 节点，结构与 contentText 同）。 */
function userMessageTexts(node: ChatNode): readonly string[] {
  const texts: string[] = []
  if (node.kind === 'user' || node.kind === 'steering') {
    const data = node.data as {
      readonly content?: readonly { type?: string; text?: string }[]
    }
    for (const block of data.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
        texts.push(block.text.trim())
      }
    }
  }
  return texts
}

/** 从单个 Chat 节点提取 assistant 文本块（优先 finalized 消息）。 */
function assistantTexts(node: ChatNode): readonly string[] {
  const texts: string[] = []
  if (node.kind === 'assistant-step') {
    const data = node.data as {
      readonly blocks?: readonly AssistantBlock[]
      readonly finalNode?: { readonly blocks?: readonly AssistantBlock[] }
    }
    const blocks = data.finalNode?.blocks ?? data.blocks ?? []
    for (const block of blocks) {
      if (block.kind === 'text' && block.text.trim() !== '') texts.push(block.text.trim())
    }
  } else if (node.kind === 'turn-tail') {
    const data = node.data as {
      readonly closing?: { readonly finalNode?: { readonly blocks?: readonly AssistantBlock[] } }
    }
    for (const block of data.closing?.finalNode?.blocks ?? []) {
      if (block.kind === 'text' && block.text.trim() !== '') texts.push(block.text.trim())
    }
  }
  return texts
}

/** 提取一轮对话的 commit 与摘要（摘要优先取用户文本，无则回退 assistant 文本）。 */
function extractTurnInfo(
  turn: number,
  nodes: ChatNodeStore,
  locations: ChatLocationNodeIndex,
): TurnInfo {
  const commits: string[] = []
  const userTexts: string[] = []
  const summaries: string[] = []
  for (const key of locations.getTurn(turn)) {
    const node = nodes.get(key)
    if (node === undefined) continue
    if (node.kind === 'tool-call') {
      const root = (node.data as { readonly root?: ToolCallBlock }).root
      if (root !== undefined) collectToolCommits(root, commits)
    } else if (node.kind === 'user' || node.kind === 'steering') {
      userTexts.push(...userMessageTexts(node as ChatNode))
    } else {
      summaries.push(...assistantTexts(node as ChatNode))
    }
  }
  return {
    commit: [...new Set(commits.filter(Boolean).map(hash => hash.slice(0, 7)))].join(' '),
    summary: userTexts.find(text => text !== '')
      ?? summaries.find(text => text !== '')
      ?? '',
    time: '',
    date: '',
  }
}

/** 在会话根内查找某一轮第一条“可见”的已渲染消息锚点行。 */
function findTurnRow(root: HTMLElement, keys: readonly string[]): HTMLElement | null {
  const scrollport = root.querySelector<HTMLElement>('[data-conversation-scroll]')
  const scope = scrollport ?? root
  const wanted = new Set(keys)
  let first: HTMLElement | null = null
  for (const row of scope.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (!wanted.has(row.dataset.chatAnchorKey ?? '')) continue
    if (first === null) first = row
    if (row.getClientRects().length > 0) return row
  }
  return first
}

export function TurnRail({ useSession, sessionId }: TurnRailProps) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  // host = portal 目标（正文卡片 [data-conversation-scroll]，用户要求 rail
  // 的 DOM 父容器是卡片）；phaseRoot = 会话列根 [data-phase]，是 rail/pill
  // 的 absolute 定位上下文（根不滚动 → rail 固定在卡片区域，不随消息滚动）。
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [phaseRoot, setPhaseRoot] = useState<HTMLElement | null>(null)
  const [chatMounted, setChatMounted] = useState(false)
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null)
  const [followTurn, setFollowTurn] = useState<number | null>(null)
  const [pillTop, setPillTop] = useState(0)
  const hoverTimer = useRef<number | null>(null)

  const timeline = useSession(s => s.chat.timeline)
  const locations = useSession(s => s.chat.locations)
  const nodes = useSession(s => s.chat.nodes)
  const nodeValues = useSession(s => s.chat.nodes.values())
  const order = useSession(s => s.chat.order)

  useLayoutEffect(() => {
    // anchorRef 挂在 header 内（header.utilities slot），与正文卡片是兄弟，
    // 先经 [data-phase] 根再向下找卡片作为 portal 目标。
    const root = anchorRef.current?.closest<HTMLElement>('[data-phase]') ?? null
    setPhaseRoot(root)
    setHost(root?.querySelector<HTMLElement>('[data-conversation-scroll]') ?? null)
  }, [sessionId])

  // 只在 Chat 视图挂载时显示。
  useEffect(() => {
    if (host === null) return
    const update = (): void => {
      setChatMounted(host.querySelector('[data-chat-flow]') !== null)
    }
    update()
    const mo = new MutationObserver(update)
    mo.observe(host, { childList: true, subtree: true })
    return () => { mo.disconnect() }
  }, [host])

  useEffect(() => () => {
    if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
  }, [])

  const turnItems = useMemo(
    () => timeline.turnOrder
      .filter(turn => locations.getTurn(turn).some(key => order.includes(key)))
      .map((turn, index) => {
        const base = extractTurnInfo(turn, nodes, locations)
        const location = timeline.turns.get(turn)
        const { time, date } = formatTurnDateTime(location?.start?.time ?? location?.end?.time)
        return {
          turn,
          index,
          info: {
            ...base,
            time,
            date,
          },
        }
      }),
    [timeline, locations, nodes, nodeValues, order],
  )

  const jumpToTurn = (turn: number): void => {
    if (host === null) return
    const keys = locations.getTurn(turn)
    if (keys.length === 0) return
    const row = findTurnRow(host, keys)
    if (row === null) return
    const scrollport = row.closest<HTMLElement>('[data-conversation-scroll]')
    if (scrollport === null) {
      row.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    const top = row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
      + scrollport.scrollTop - 16
    scrollport.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  const relativeTop = (current: Element): number => {
    // pill 定位上下文是 [data-phase] 根（rail/pill absolute 相对它），
    // 因此偏移也按根计算（相对 scrollBody 会差根与卡片的顶部差）。
    const base = phaseRoot ?? host
    if (base === null) return 0
    return current.getBoundingClientRect().top - base.getBoundingClientRect().top
  }

  const tickCenterTop = (tick: Element): number => relativeTop(tick) + tick.getBoundingClientRect().height / 2

  const movePillToTick = (tick: Element): void => {
    setPillTop(tickCenterTop(tick))
  }

  // 滚动时跟随视口中心最近的对话轮次（无 hover 时）。
  useEffect(() => {
    if (host === null || turnItems.length === 0) return
    // host 即正文卡片（[data-conversation-scroll]），自身就是滚动容器。
    const scrollport = host
    if (scrollport === null) return
    const update = (): void => {
      // hover 胶囊时跟随暂停（胶囊展示 hover 轮）。
      if (hoveredTurn !== null) return
      const rect = scrollport.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      let best: { turn: number; dist: number } | null = null
      for (const item of turnItems) {
        const row = findTurnRow(host, locations.getTurn(item.turn))
        if (row === null) continue
        const rowRect = row.getBoundingClientRect()
        const dist = Math.abs(rowRect.top + rowRect.height / 2 - centerY)
        if (best === null || dist < best.dist) best = { turn: item.turn, dist }
      }
      if (best !== null) {
        const tick = host.querySelector<Element>(`[data-turn="${best.turn}"]`)
        if (tick !== null) setFollowTurn(best.turn)
      }
    }
    let raf = 0
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        update()
      })
    }
    update()
    scrollport.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(schedule)
    ro.observe(scrollport)
    // 冷启动/切换会话时消息行可能晚于组件挂载才渲染，
    // 监听 DOM 变化补一次跟随，避免“当前轮”直到滚动才变大。
    const mo = new MutationObserver(schedule)
    mo.observe(scrollport, { childList: true, subtree: true })
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      scrollport.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, turnItems, hoveredTurn, locations])

  /** 点击 commit 后把 commit 号送回对话窗口（由插件注入处理函数）。 */
  const onCommitClick = (turn: number): void => {
    const item = turnItems.find(candidate => candidate.turn === turn)
    const commit = item?.info.commit ?? ''
    if (commit !== '' && commitReturnHandler !== null) commitReturnHandler(commit)
  }

  const onTickClick = (_e: ReactMouseEvent<SVGSVGElement>, turn: number): void => {
    // 点击只负责跳转，不做持久选中。
    setHoveredTurn(null)
    jumpToTurn(turn)
  }

  const clearHoverTimer = (): void => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }

  const scheduleHoverClear = (): void => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null
      setHoveredTurn(null)
    }, 300)
  }

  const onTickHover = (e: { currentTarget: SVGSVGElement }, turn: number): void => {
    clearHoverTimer()
    movePillToTick(e.currentTarget)
    setHoveredTurn(turn)
  }

  // 胶囊只在指针悬浮时出现；跟随只影响刻度样式，不展开胶囊。
  const pillItem = hoveredTurn === null ? undefined : turnItems.find(item => item.turn === hoveredTurn)
  const pillClass = css.capsuleHover

  return (
    <>
      <div ref={anchorRef} style={{ display: 'none' }} />
      {host !== null && chatMounted && turnItems.length > 0 && createPortal(
        <>
          <nav className={css.rail} aria-label="对话轮次导航">
            {turnItems.map(({ turn, index }) => (
              <svg
                key={turn}
                data-turn={turn}
                className={css.tick
                  + (hoveredTurn === turn ? ' ' + css.tickHover : '')
                  + (followTurn === turn ? ' ' + css.tickFollow : '')
                  + (turn === turnItems[turnItems.length - 1]?.turn ? ' ' + css.tickActive : '')}
                viewBox="0 0 24 24"
                role="button"
                tabIndex={0}
                aria-label={`跳到第 ${index + 1} 轮`}
                onClick={(e) => { onTickClick(e, turn) }}
                onMouseEnter={(e) => { onTickHover(e, turn) }}
                onMouseLeave={() => { scheduleHoverClear() }}
                onFocus={(e) => { onTickHover(e, turn) }}
                onBlur={() => { clearHoverTimer(); setHoveredTurn(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onTickClick(e as unknown as ReactMouseEvent<SVGSVGElement>, turn)
                  }
                }}
              >
                <rect x="2" y="10" width="20" height="4" rx="2" fill="currentColor" />
              </svg>
            ))}
          </nav>

          {pillItem !== undefined && (
            <div
              className={css.capsule + ' ' + pillClass}
              style={{ left: 56, top: pillTop }}
              role="tooltip"
              onMouseEnter={() => { clearHoverTimer(); setHoveredTurn(pillItem.turn) }}
              onMouseLeave={() => { clearHoverTimer(); setHoveredTurn(null) }}
            >
              <div className={css.capsuleHeader}>
                <span className={css.capsuleTurnSummary}>
                  <span className={css.capsuleTurn}>第 {pillItem.index + 1} 轮</span>
                  <span className={css.capsuleSummary}>{pillItem.info.summary !== '' ? pillItem.info.summary : '无摘要'}</span>
                </span>
              </div>
              <div className={css.capsuleMetaRow}>
                {pillItem.info.commit !== '' && (
                  <button
                    type="button"
                    className={css.capsuleCommitButton}
                    title="点击回到对话并高亮该轮"
                    onClick={() => { onCommitClick(pillItem.turn) }}
                  >
                    {pillItem.info.commit}
                  </button>
                )}
                <span className={css.capsuleMetaTime}>
                  <span className={css.capsuleTime}>{pillItem.info.time !== '' ? pillItem.info.time : '--'}</span>
                  <span className={css.capsuleDate}>{pillItem.info.date !== '' ? pillItem.info.date : '--'}</span>
                </span>
              </div>
            </div>
          )}
        </>,
        host,
      )}
    </>
  )
}