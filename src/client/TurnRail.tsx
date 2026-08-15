/**
 * 琉璃主题 · 对话轮次刻度侧边栏（DenpaPush 时间线风格）。
 *
 * 挂在 `conversation.session.header.tabs` slot（仅作挂载点），随后把真正的
 * 时间线 rail portal 到会话根 `[data-phase]`：
 * - 左侧一条竖向刻度线，每轮对话一个刻度；
 * - 刻度上的胶囊会沿竖线滑动：悬停/选中时定位到对应刻度，滚动时跟随视口
 *   中心最近的对话轮次；
 * - 胶囊内横向三栏：时间 | commit号 | 简单摘要。
 *
 * commit / 摘要从对话内容自动提取：
 * - commit：扫描该轮 tool-call 子树及结果的 commit 短哈希；
 * - 摘要：取该轮 assistant 文本块的第一段非空文本。
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

type TurnRailProps = PropsRuntime<'conversation.session.header.tabs'>

interface TurnInfo {
  readonly commit: string
  readonly summary: string
  readonly time: string
}

/** 把 turn/start 或 turn/end 时间格式化为 `MM-DD HH:mm`。 */
function formatTurnTime(time: number | undefined): string {
  if (time === undefined) return ''
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
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

/** 提取一轮对话的 commit 与摘要。 */
function extractTurnInfo(
  turn: number,
  nodes: ChatNodeStore,
  locations: ChatLocationNodeIndex,
): TurnInfo {
  const commits: string[] = []
  const summaries: string[] = []
  for (const key of locations.getTurn(turn)) {
    const node = nodes.get(key)
    if (node === undefined) continue
    if (node.kind === 'tool-call') {
      const root = (node.data as { readonly root?: ToolCallBlock }).root
      if (root !== undefined) collectToolCommits(root, commits)
    } else {
      summaries.push(...assistantTexts(node as ChatNode))
    }
  }
  return {
    commit: [...new Set(commits.filter(Boolean))].join(' '),
    summary: summaries.find(text => text !== '') ?? '',
    time: '',
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
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [chatMounted, setChatMounted] = useState(false)
  const [selectedTurn, setSelectedTurn] = useState<number | null>(null)
  const [hoveredTurn, setHoveredTurn] = useState<number | null>(null)
  const [followTurn, setFollowTurn] = useState<number | null>(null)
  const [pillTop, setPillTop] = useState(0)

  const timeline = useSession(s => s.chat.timeline)
  const locations = useSession(s => s.chat.locations)
  const nodes = useSession(s => s.chat.nodes)
  const nodeValues = useSession(s => s.chat.nodes.values())
  const order = useSession(s => s.chat.order)

  useLayoutEffect(() => {
    setHost(anchorRef.current?.closest<HTMLElement>('[data-phase]') ?? null)
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

  const turnItems = useMemo(
    () => timeline.turnOrder
      .filter(turn => locations.getTurn(turn).some(key => order.includes(key)))
      .map((turn, index) => {
        const base = extractTurnInfo(turn, nodes, locations)
        const location = timeline.turns.get(turn)
        return {
          turn,
          index,
          info: {
            ...base,
            time: formatTurnTime(location?.start?.time ?? location?.end?.time),
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

  const relativeTop = (current: HTMLElement): number => {
    if (host === null) return 0
    return current.getBoundingClientRect().top - host.getBoundingClientRect().top
  }

  const tickCenterTop = (tick: HTMLElement): number => relativeTop(tick) + tick.offsetHeight / 2

  const movePillToTick = (tick: HTMLElement): void => {
    setPillTop(tickCenterTop(tick))
  }

  // 滚动时跟随视口中心最近的对话轮次（无 hover/选中时）。
  useEffect(() => {
    if (host === null || turnItems.length === 0) return
    const scrollport = host.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (scrollport === null) return
    const update = (): void => {
      if (hoveredTurn !== null || selectedTurn !== null) return
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
        const tick = host.querySelector<HTMLElement>(`[data-turn="${best.turn}"]`)
        if (tick !== null) {
          setFollowTurn(best.turn)
          movePillToTick(tick)
        }
      }
    }
    update()
    scrollport.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(scrollport)
    return () => {
      scrollport.removeEventListener('scroll', update)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, turnItems, hoveredTurn, selectedTurn, locations])

  const onTickClick = (e: ReactMouseEvent<HTMLButtonElement>, turn: number): void => {
    movePillToTick(e.currentTarget)
    setSelectedTurn(previous => previous === turn ? null : turn)
    setHoveredTurn(null)
    jumpToTurn(turn)
  }

  const onTickHover = (e: { currentTarget: HTMLButtonElement }, turn: number): void => {
    movePillToTick(e.currentTarget)
    setHoveredTurn(turn)
  }

  const pillTurn = selectedTurn ?? hoveredTurn ?? followTurn
  const pillItem = pillTurn === null ? undefined : turnItems.find(item => item.turn === pillTurn)
  const pillClass = selectedTurn === pillTurn
    ? css.capsuleSelected
    : hoveredTurn === pillTurn
      ? css.capsuleHover
      : css.capsuleFollow

  return (
    <>
      <div ref={anchorRef} style={{ display: 'none' }} />
      {host !== null && chatMounted && turnItems.length > 0 && createPortal(
        <>
          <nav className={css.rail} aria-label="对话轮次导航">
            <div className={css.line} aria-hidden="true" />
            {turnItems.map(({ turn, index }) => (
              <button
                key={turn}
                type="button"
                data-turn={turn}
                className={css.tick
                  + (selectedTurn === turn ? ' ' + css.tickSelected : '')
                  + (hoveredTurn === turn ? ' ' + css.tickHover : '')
                  + (followTurn === turn && selectedTurn !== turn && hoveredTurn !== turn ? ' ' + css.tickFollow : '')
                  + (turn === turnItems[turnItems.length - 1]?.turn ? ' ' + css.tickActive : '')}
                title={`第 ${index + 1} 轮`}
                aria-label={`跳到第 ${index + 1} 轮`}
                aria-expanded={selectedTurn === turn || undefined}
                onClick={(e) => { onTickClick(e, turn) }}
                onMouseEnter={(e) => { onTickHover(e, turn) }}
                onMouseLeave={() => { setHoveredTurn(null) }}
                onFocus={(e) => { onTickHover(e, turn) }}
                onBlur={() => { setHoveredTurn(null) }}
              />
            ))}
          </nav>

          {pillItem !== undefined && (
            <div
              className={css.capsule + ' ' + pillClass}
              style={{ left: 44, top: pillTop }}
              role={selectedTurn === pillTurn ? 'region' : 'tooltip'}
              aria-label={selectedTurn === pillTurn ? `第 ${pillItem.index + 1} 轮详情` : undefined}
            >
              <span className={css.capsuleTime}>{pillItem.info.time !== '' ? pillItem.info.time : '--'}</span>
              <span className={css.capsuleCommit}>{pillItem.info.commit !== '' ? pillItem.info.commit : '无'}</span>
              <span className={css.capsuleSummary}>{pillItem.info.summary !== '' ? pillItem.info.summary : '无摘要'}</span>
            </div>
          )}
        </>,
        host,
      )}
    </>
  )
}
