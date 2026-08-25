/**
 * /btw 指令的正文回答卡片：
 *  - 命令在 node 半注册（控制面，不进模型历史），客户端桥收到 command/executed
 *    后派发 BTW_ANSWER_EVENT（带问题文本）；
 *  - 本组件 fork 当前会话得到子会话（立即归档，隐藏于会话列表），把问题
 *    prompt 给子会话（只进子会话，不改变主会话上下文），回答实时渲染成
 *    正文消息流末尾的卡片（容器挂在 [data-chat-flow] 内，与消息同列）；
 *  - 会话切换自动清除卡片；回答不写主会话 graph，刷新即消失。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  ObservableSnapshot, SessionFace, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SidePaneHostAccess } from './SidePaneExtraPanels.tsx'
import { ChatFlowView, ChatFlowPartial } from './chat-flow-view.tsx'
import css from './BtwAnswer.module.css'

/** /btw 桥事件名（detail: { question: string }）。 */
export const BTW_ANSWER_EVENT = 'liuli:btw-answer'

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

/** fork 出的子会话默认未 open：客户端没有事件窗口、不订阅 mux 流，
 * 快照 nodes 恒空。open()（Session 类公开方法，但刻意不在 ISession 面上）
 * 拉取历史窗口并订阅流——幂等、不切换当前会话。 */
function openSessionFace(face: SessionFace): Promise<void> {
  const withOpen = face as SessionFace & { open: () => Promise<void> }
  return typeof withOpen.open === 'function' ? withOpen.open() : Promise.resolve()
}

interface BtwCard {
  /** 自增 id（同一会话多次 /btw 各自一张卡）。 */
  id: number
  question: string
  /** fork 出的子会话 id；未就绪时为 undefined。 */
  childId?: string
  error?: string
}

interface BtwAnswerHostProps {
  host: SidePaneHostAccess
  sessionList: ObservableSnapshot<SessionListState>
}

/** /btw 正文回答宿主：监听事件、fork、prompt、渲染卡片。 */
export function BtwAnswerHost({ host, sessionList }: BtwAnswerHostProps) {
  const [cards, setCards] = useState<BtwCard[]>([])
  const [flowHost, setFlowHost] = useState<HTMLElement | null>(null)
  const listHostRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(1)
  const current = useSnapshot(sessionList)?.current

  // 会话切换：清掉旧会话的回答卡片。
  const lastSession = useRef(current)
  useEffect(() => {
    if (current !== lastSession.current) {
      lastSession.current = current
      setCards([])
    }
  }, [current])

  // 定位正文消息列（[data-chat-flow]）——普通三列与 advanced dock 模式都
  // 挂在当前激活的 phase 下；取可见的那个（隐藏会话的 phase 不可见）。
  useEffect(() => {
    const find = (): HTMLElement | null => {
      const flows = document.querySelectorAll<HTMLElement>('[data-chat-flow]')
      for (const flow of flows) {
        if (flow.offsetParent !== null) return flow
      }
      return flows[0] ?? null
    }
    const update = (): void => { setFlowHost(find()) }
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.body, { childList: true, subtree: true })
    return () => { mo.disconnect() }
  }, [])

  // 监听 /btw 事件：fork 当前会话 → prompt 问题 → 更新卡片。
  useEffect(() => {
    const onBtw = (e: Event): void => {
      const detail = (e as CustomEvent<{ question?: string }>).detail
      const question = detail?.question?.trim()
      if (question === undefined || question === '') return
      const sessionId = sessionList.getSnapshot().current
      if (sessionId === undefined) return
      const id = nextId.current++
      setCards(prev => [...prev, { id, question }])
      void (async () => {
        try {
          const childId = await host.forkSession(sessionId)
          setCards(prev => prev.map(c => (c.id === id ? { ...c, childId } : c)))
          const face = host.getSessionFace(childId)
          if (face === undefined) throw new Error('子会话未就绪（binding 不可寻址）')
          // 关键：fork 出的子会话默认未 open —— 客户端没有事件窗口、不订阅
          // mux 事件流，快照 nodes 恒空。open() 拉取历史窗口并订阅流，
          // prompt 后的回答才能出现在快照里（open 是幂等的，不切换当前会话）。
          await openSessionFace(face)
          const content = [{ type: 'text', text: question }] as Parameters<SessionFace['prompt']>[0]
          await face.prompt(content, 'queue')
        } catch (err) {
          setCards(prev => prev.map(c => (c.id === id ? { ...c, error: err instanceof Error ? err.message : String(err) } : c)))
        }
      })()
    }
    window.addEventListener(BTW_ANSWER_EVENT, onBtw)
    return () => { window.removeEventListener(BTW_ANSWER_EVENT, onBtw) }
  }, [host, sessionList])

  // 卡片容器挂进消息列末尾：宿主 rerender 消息流会清掉外来节点，
  // MutationObserver 检测容器不在列内且仍有卡片时重新 append。
  const listHost = listHostRef.current ?? (listHostRef.current = document.createElement('div'))
  listHost.className = css.btwList ?? ''
  listHost.setAttribute('data-liuli-btw-answer-list', '')
  useLayoutEffect(() => {
    if (flowHost === null) return
    if (cards.length === 0) {
      if (listHost.parentElement === flowHost) flowHost.removeChild(listHost)
      return
    }
    if (listHost.parentElement !== flowHost) flowHost.appendChild(listHost)
  }, [flowHost, listHost, cards.length])
  useEffect(() => {
    if (flowHost === null) return
    const mo = new MutationObserver(() => {
      if (cards.length > 0 && listHost.parentElement !== flowHost) flowHost.appendChild(listHost)
    })
    mo.observe(flowHost, { childList: true })
    return () => { mo.disconnect() }
  }, [flowHost, listHost, cards.length])

  const content: ReactNode = cards.map(card => (
    <BtwAnswerCard key={card.id} card={card} host={host} onClose={() => { setCards(prev => prev.filter(c => c.id !== card.id)) }} />
  ))

  if (cards.length === 0 || flowHost === null) return null
  return createPortal(content, listHost)
}

function BtwAnswerCard({ card, host, onClose }: { card: BtwCard; host: SidePaneHostAccess; onClose: () => void }) {
  const face = card.childId === undefined ? undefined : host.getSessionFace(card.childId)
  const snap = useSnapshot(face)
  const running = snap?.running === true
  const hasNodes = snap !== undefined && snap.nodes.length > 0

  return (
    <div className={css.card} data-liuli-btw-answer="" data-child-id={card.childId ?? ''}>
      <div className={css.cardHead}>
        <span className={css.badge}>⚡ 辅助回答</span>
        {card.childId === undefined
          ? <span className={css.status} data-state="pending">{card.error !== undefined ? `创建失败：${card.error}` : '正在创建子会话…'}</span>
          : running
            ? <span className={css.status} data-state="running">回答中…</span>
            : hasNodes ? <span className={css.status} data-state="done">已完成</span> : null}
        <button type="button" className={css.close} onClick={onClose} aria-label="关闭辅助回答">×</button>
      </div>
      {card.question !== '' && <div className={css.question}>{card.question}</div>}
      {card.error !== undefined && card.childId === undefined && (
        <div className={css.error}>{card.error}</div>
      )}
      <div className={css.answer} data-empty={!hasNodes && !running ? '' : undefined}>
        {hasNodes
          ? <ChatFlowView snap={snap} />
          : running ? '…' : '（回答为空）'}
        <ChatFlowPartial partial={snap?.partial} running={running} />
      </div>
    </div>
  )
}
