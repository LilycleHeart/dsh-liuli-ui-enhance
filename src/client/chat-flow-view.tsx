/**
 * 复刻官方信息流的会话节点渲染器（供 /btw 回答卡片与侧边栏辅助对话复用）。
 *
 * 官方信息流（dsh-client-ui-conversation 的 ChatView）对每个会话节点的渲染：
 *  - user / steering：右对齐气泡（官方 MessageItem 的 userRow→userStack→bubble，
 *    `--dsw-specific-bubble` 背景、22px 圆角、16px/24px 正文）；
 *  - assistant：无气泡文本流（官方 AssistantMarkdown root 16px/28px，块间 gap 16），
 *    按 blocks 逐块——reasoning 折叠成 Think 行、text 用官方 MarkdownText、
 *    image 渲染图片组、tool-call 跳过、其他块回退 JsonBlock；
 *  - tool-result：官方 ToolRow 外壳（状态点 + 工具名 + 摘要 + 折叠展开），
 *    按 render intent（resultView.card）分派到官方 primitives 块组件——
 *    terminal / read / diff / search / web / generic(JsonBlock)；
 *  - context / command / turn-error / model-retry 等：以低调行呈现。
 *
 * 全部视觉组件取自 @deepseek-ai/dsh-client-ui-primitives（平台模块，运行时由
 *  loader 模块表提供，与宿主同一实例），样式参数逐项对照官方 bundle。
 *
 * 级联接入：assistant 消息容器是子列（data-liuli-chat-flow），其内部每个块
 * （text / reasoning / image / 未知块）各自挂 data-liuli-chat-anchor-key 锚点；
 * 文本块额外标记 data-liuli-cascade-text，观察器（liuli-transition.ts）收集其
 * markdown 块级元素（段落、代码块、列表等）逐段入场，文本不再整块一次动画。
 *
 * from：起始节点下标（可选）。/btw 回答卡只渲染本轮问答——跳过子会话
 * 继承的上轮对话历史，从下标 from 开始渲染；缺省渲染全部节点。
 */

import { useId, useMemo, useState, type ReactNode } from 'react'
import {
  MarkdownText, JsonBlock, TerminalBlock, ReadBlock, DiffBlock,
  SearchBlock, WebBlock, DisclosureRow, StateDot,
  IconThinkOutline14, IconApiOutline14, IconBrowseOutline16, IconEditOutline16, IconSearchOutline16, IconSparkle16,
  type DiffBlockLabels, type MarkdownLabels, type ReadBlockLabels,
  type SearchBlockLabels, type TerminalBlockLabels, type WebBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
// 2.0.4：旧 runtime ConversationSnapshot 的对话内容面（nodes/partial/running）
// 由 ui-chat 的 ChatSnapshot 承担 —— nodes/partial 在 .legacy 兼容投影上，
// running 语义属于会话生命周期（SessionSnapshot），调用方从 SessionFace 取。
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import css from './chat-flow-view.module.css'

/* ── 2.0.4 文案适配：primitives 变成 cordis-free，labels 由消费方传入 ──
 *    （官方 ui-tool 的 primitive-labels.ts 同构；琉璃是中文界面，直接内置中文）。 */
const MD_LABELS: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}
const TERMINAL_LABELS: TerminalBlockLabels = {
  signal: s => `信号 ${s}`,
  exitCode: c => `退出码 ${c}`,
  running: '运行中',
  failed: '失败',
  done: '完成',
  copy: '复制',
  copied: '已复制',
  noOutput: '（无输出）',
  collapseAria: '折叠',
  collapse: '收起',
  expandAria: n => `展开 ${n} 行`,
  expand: n => `展开 ${n} 行`,
}
const READ_LABELS: ReadBlockLabels = {
  window: (shown, total) => `第 ${shown}/${total} 行`,
  copy: '复制',
  copied: '已复制',
  collapseAria: '折叠',
  expandAria: n => `展开 ${n} 行`,
  collapse: '收起',
  expand: n => `展开其余 ${n} 行`,
}
const DIFF_LABELS: DiffBlockLabels = {
  copy: '复制',
  copied: '已复制',
  collapseAria: '折叠',
  expandAria: n => `展开 ${n} 行`,
  collapse: '收起',
  expand: n => `展开其余 ${n} 行`,
  files: count => count === 1 ? '1 个文件' : `${count} 个文件`,
}
const SEARCH_LABELS: SearchBlockLabels = {
  pathsSummary: (shown, total, truncated) => truncated ? `前 ${shown}/${total} 条路径（截断）` : `${shown}/${total} 条路径`,
  matchesSummary: (shown, total, files, truncated) => truncated ? `前 ${shown}/${total} 处匹配（截断）` : `${files} 个文件 · ${total} 处匹配`,
  copy: '复制',
  copied: '已复制',
  noResults: '无结果',
  collapseAria: '折叠',
  expandAria: n => `展开 ${n} 条`,
  collapse: '收起',
  expand: n => `展开其余 ${n} 条`,
}
const WEB_LABELS: WebBlockLabels = {
  noResults: '无结果',
  sourcesTruncated: '来源已截断',
  http: 'HTTP',
  contentTruncated: '内容已截断',
  markdown: MD_LABELS,
}
/** JsonBlock 截断脚注。 */
const truncatedLabel = (total: number): string => `… 共 ${total} 字符（截断）`

/** 文本块（content 数组 → 拼接纯文本）。 */
export function contentText(content: readonly unknown[]): string {
  let text = ''
  for (const block of content) {
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && typeof b.text === 'string') text += b.text
  }
  return text
}

/** 复刻官方 ReasoningRow：Think 折叠行（running 时跟随末尾行）。 */
function ThinkRow({ text, running }: { text: string; running: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const firstLine = text.indexOf('\n') === -1 ? text : text.slice(0, text.indexOf('\n'))
  const visible = text.trimEnd()
  const latestLine = visible.lastIndexOf('\n') === -1 ? visible : visible.slice(visible.lastIndexOf('\n') + 1)
  const summary = running ? latestLine : firstLine
  return (
    <div className={css.thinkRow} data-state={running ? 'running' : 'ok'}>
      <DisclosureRow
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(v => !v) }}
        collapsedContent={<span className={css.thinkSummary}>{summary}</span>}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}

/** 工具执行卡片的 leading 图标：与官方 dsh-client-ui-tool 的 VARIANT_ICONS
 *  同款（ok/运行态用变体图标；error 态由 StateDot 接管，见 ToolRow.leadingFor）。 */
const TOOL_VARIANT_ICONS: Record<string, ReactNode> = {
  terminal: <IconApiOutline14 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  diff: <IconEditOutline16 size={14} />,
  search: <IconSearchOutline16 size={14} />,
  web: <IconSparkle16 size={14} />,
  default: <IconSparkle16 size={14} />,
}

/** assistant 节点的 blocks 渲染（复刻 AssistantMarkdown 分派）。
 *  每个块包一层级联锚点（text / reasoning / image / 未知块）；文本块额外
 *  标记 data-liuli-cascade-text：观察器收集其内部 markdown 块级元素
 *  （段落、代码块、列表、引用、表格、标题）逐段入场，而不是整块一次动画。 */
function AssistantBlocks({ blocks, streaming, prefix }: {
  blocks: readonly unknown[]
  streaming: boolean
  prefix: string
}): ReactNode {
  const last = blocks.length - 1
  if (!streaming && !blocks.some(b => (b as { kind?: string }).kind !== 'tool-call')) return null
  const out: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] as { kind?: string } & Record<string, unknown>
    const blockKey = `${prefix}:b${i}`
    switch (block.kind) {
      case 'text':
        out.push(
          <div key={i} className={css.textBlock} data-liuli-chat-anchor-key={blockKey} data-liuli-cascade-text="">
            <MarkdownText text={typeof block.text === 'string' ? block.text : ''} streaming={streaming} labels={MD_LABELS} />
          </div>,
        )
        break
      case 'reasoning':
        out.push(
          <div key={i} className={css.thinkBlock} data-liuli-chat-anchor-key={blockKey}>
            <ThinkRow text={typeof block.text === 'string' ? block.text : ''} running={streaming && i === last} />
          </div>,
        )
        break
      case 'image':
        out.push(
          <div key={i} className={css.imageBlock} data-liuli-chat-anchor-key={blockKey}>（图片）</div>,
        )
        break
      case 'tool-call':
        // 工具执行由独立 tool-result 节点呈现（与官方一致：AssistantMarkdown 跳过）
        break
      default:
        out.push(
          <div key={i} className={css.jsonBlock} data-liuli-chat-anchor-key={blockKey}>
            <JsonBlock label="未知内容块" payload={block} truncatedLabel={truncatedLabel} />
          </div>,
        )
    }
  }
  return <>{out}</>
}

/** 工具摘要：running / 错误码 / 首行输出。 */
function toolSummary(node: { isError: boolean; error?: { name: string; code: string } | undefined; content: readonly unknown[] }, view: string | undefined, text: string): string {
  if (node.isError && node.error !== undefined) return node.error.code
  if (view === 'terminal') {
    const rv = node as unknown as { resultView?: { output?: string; exitCode?: number; signal?: string } | null }
    const output = rv.resultView?.output
    if (output !== undefined && output.trim() !== '') {
      const line = output.trim().split('\n')[0] ?? ''
      return line.slice(0, 60)
    }
  }
  const line = text.trim().split('\n')[0] ?? ''
  return line.slice(0, 60)
}

/** tool-result 节点的卡片渲染（复刻官方 ToolRow：状态点 + 标题 + 折叠 body）。 */
function ToolResultCard({ anchorKey, node }: { anchorKey: string; node: { kind: string; callId: string; call: { name: string; argsRaw: string } | null; content: readonly unknown[]; isError: boolean; error?: { name: string; code: string } | undefined; callView?: { card?: string } | null; resultView?: { card?: string } | null; subCalls?: readonly unknown[] } }) {
  const [expanded, setExpanded] = useState(false)
  const title = node.call?.name ?? node.callId.slice(0, 8)
  const view = node.resultView?.card ?? node.callView?.card
  const content = node.content ?? []
  const text = contentText(content)
  const summary = toolSummary(node, view, text)
  const state = node.isError ? 'error' : 'ok'

  let body: ReactNode = null
  switch (view) {
    case 'terminal': {
      const rv = node.resultView as { title?: string; output?: string; exitCode?: number; signal?: string } | null
      const cv = node.callView as { title?: string; cwd?: string } | null
      body = (
        <TerminalBlock
          command={rv?.title ?? cv?.title ?? title}
          cwd={cv?.cwd}
          output={rv?.output ?? text}
          exitCode={rv?.exitCode}
          signal={rv?.signal}
          labels={TERMINAL_LABELS}
        />
      )
      break
    }
    case 'read': {
      const rv = node.resultView as { title?: string; path?: string; offset?: number; lines?: Array<{ number: number; text: string }>; totalLines?: number; lang?: string } | null
      if (rv?.lines !== undefined) {
        body = (
          <ReadBlock
            label={rv.title ?? rv.path}
            lines={rv.lines}
            totalLines={rv.totalLines ?? rv.lines.length}
            lang={rv.lang}
            labels={READ_LABELS}
          />
        )
      } else {
        body = <JsonBlock label="read" payload={rv ?? text} truncatedLabel={truncatedLabel} />
      }
      break
    }
    case 'diff': {
      const rv = node.resultView as { diffs?: Array<{ path: string; oldText: string | null; newText: string }> } | null
      body = <DiffBlock diffs={rv?.diffs ?? []} labels={DIFF_LABELS} />
      break
    }
    case 'search': {
      const rv = node.resultView as { shape?: 'matches' | 'paths'; files?: Array<{ path: string; matches: Array<{ lineNumber: number; line: string }> }>; paths?: string[]; truncated?: boolean; total?: number } | null
      if (rv?.shape === 'matches') {
        body = <SearchBlock kind="matches" files={rv.files ?? []} truncated={rv.truncated ?? false} total={rv.total ?? 0} labels={SEARCH_LABELS} />
      } else if (rv?.shape === 'paths') {
        body = <SearchBlock kind="paths" paths={rv.paths ?? []} truncated={rv.truncated ?? false} total={rv.total ?? 0} labels={SEARCH_LABELS} />
      } else {
        body = <JsonBlock label="search" payload={rv ?? text} truncatedLabel={truncatedLabel} />
      }
      break
    }
    case 'web': {
      const rv = node.resultView as { kind?: 'search' | 'fetch'; answer?: string; sources?: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>; truncated?: boolean; url?: string; statusCode?: number } | null
      if (rv?.kind === 'fetch') {
        body = <WebBlock kind="fetch" url={rv.url ?? ''} statusCode={rv.statusCode ?? 0} truncated={rv.truncated ?? false} labels={WEB_LABELS} />
      } else {
        body = <WebBlock kind="search" answer={rv?.answer} sources={rv?.sources ?? []} truncated={rv?.truncated ?? false} labels={WEB_LABELS} />
      }
      break
    }
    default:
      // generic / 未知：等宽正文（官方 generic card 语义）
      body = <div className={css.toolOutput}>{text || '（空输出）'}</div>
  }

  return (
    <div className={css.toolCard} data-state={state} data-liuli-chat-anchor-key={anchorKey}>
      <button
        type="button"
        className={css.toolRowBtn}
        data-open={expanded ? '' : undefined}
        aria-expanded={expanded}
        onClick={() => { setExpanded(v => !v) }}
      >
        <span className={css.toolLeading}>
          {node.isError
            ? <StateDot state="error" />
            : (TOOL_VARIANT_ICONS[view ?? ''] ?? TOOL_VARIANT_ICONS.default)}
        </span>
        <span className={css.toolTitle}>{title}</span>
        {summary !== '' && (
          <>
            <span className={css.toolSep} aria-hidden="true" />
            <span className={css.toolSummary}>{summary}</span>
          </>
        )}
        <span className={css.toolChevron} aria-hidden="true">›</span>
      </button>
      {expanded && (
        <div className={css.toolBody}>
          {node.isError && node.error !== undefined
            ? <div className={css.toolError}>{node.error.name}: {node.error.code}</div>
            : body}
        </div>
      )}
    </div>
  )
}

/** user 消息：官方三层结构（userRow → userStack → bubble）。 */
function UserBubble({ anchorKey, text }: { anchorKey: string; text: string }) {
  return (
    <div className={css.userRow} data-liuli-chat-anchor-key={anchorKey}>
      <div className={css.userStack}>
        <div className={css.bubble}>{text}</div>
      </div>
    </div>
  )
}

/** 完整信息流节点渲染：按顺序输出 user / assistant / tool-result 等。
 *  外层列挂 data-liuli-chat-flow、行根节点挂 data-liuli-chat-anchor-key
 *  （useId 前缀保证跨实例唯一），即可接入 liuli 级联入场动画（观察器要求
 *  锚点须为列的直接子元素，见 liuli-transition.ts）。assistant 消息再套一层
 *  子列：消息内各块（文本/Think/图片/未知块）各自锚定，文本块经
 *  data-liuli-cascade-text 按 markdown 块级元素逐段级联。 */
export function ChatFlowView({ snap, from = 0 }: { snap: ChatSnapshot | undefined; from?: number }): ReactNode {
  const surfaceId = useId()
  return useMemo(() => {
    if (snap === undefined) return null
    const out: ReactNode[] = []
    const allNodes = snap.legacy.nodes
    const nodes = from > 0 ? allNodes.slice(from) : allNodes
    for (const node of nodes) {
      const n = node as { kind: string; seq: number } & Record<string, unknown>
      const anchorKey = `${surfaceId}:${n.seq}`
      switch (n.kind) {
        case 'user':
        case 'steering': {
          const text = contentText((n.content as readonly unknown[]) ?? [])
          if (text.trim() !== '') out.push(<UserBubble key={n.seq} anchorKey={anchorKey} text={text} />)
          break
        }
        case 'assistant': {
          const blocks = (n.blocks as readonly unknown[]) ?? []
          if (blocks.length > 0) {
            out.push(
              <div key={n.seq} className={css.assistantMsg} data-liuli-chat-flow="">
                <AssistantBlocks blocks={blocks} streaming={false} prefix={`${surfaceId}:${n.seq}`} />
              </div>,
            )
          }
          break
        }
        case 'tool-result':
          out.push(<ToolResultCard key={n.seq} anchorKey={anchorKey} node={n as never} />)
          break
        case 'context': {
          const text = contentText((n.content as readonly unknown[]) ?? [])
          if (text.trim() !== '') out.push(<div key={n.seq} className={css.contextRow} data-liuli-chat-anchor-key={anchorKey}>{text.slice(0, 200)}</div>)
          break
        }
        case 'turn-error': {
          out.push(<div key={n.seq} className={css.errorRow} data-liuli-chat-anchor-key={anchorKey}>⚠ {(n.message as string) ?? '错误'}</div>)
          break
        }
        case 'command': {
          const text = contentText((n.content as readonly unknown[]) ?? [])
          out.push(<div key={n.seq} className={css.commandRow} data-liuli-chat-anchor-key={anchorKey}>/ {(text || '命令').slice(0, 120)}</div>)
          break
        }
        default:
          break
      }
    }
    return <div className={css.flow} data-liuli-chat-flow="">{out}</div>
  }, [snap, surfaceId, from])
}

/** 流式 partial（运行中的回答尾巴）：只渲染 assistant blocks。 */
export function ChatFlowPartial({ partial, running }: {
  partial: { blocks?: readonly unknown[] } | null | undefined
  running: boolean
}): ReactNode {
  const surfaceId = useId()
  if (partial === null || partial === undefined) return null
  const blocks = partial.blocks ?? []
  if (blocks.length === 0) return null
  return (
    <div className={css.assistantMsg} data-streaming="" data-liuli-chat-flow="">
      <AssistantBlocks blocks={blocks} streaming={running} prefix={`${surfaceId}:partial`} />
    </div>
  )
}
