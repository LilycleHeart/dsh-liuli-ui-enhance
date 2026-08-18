/**
 * Dockable Workspace 面板注册表：
 * 把插件既有的自包含面板（文件树/Git/Wiki/终端/白板/代码查看）与
 * 几个 dock 专用面板（产物预览/内嵌浏览/便签）统一成可拖拽面板类型。
 * 渲染全部复用现有组件，dock 层只负责装载与标题/状态转发。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { FileTreePanel, GitPanel, WikiPanel } from './RightSidebarPanels.tsx'
import { TerminalPanel, WhiteboardPanel } from './SidePaneExtraPanels.tsx'
import { CodeViewerPanel, normalizeBrowserUrl } from './PreviewPanel.tsx'
import type { PanelInstance } from './dock-model.ts'
import css from './dock-panels.module.css'

/** dock 面板渲染时可用的宿主能力（由 DockWorkspace 注入）。 */
export interface DockHostAccess {
  sessionId: string | undefined
  addFileToChat?: ((path: string) => void) | undefined
  openPath?: ((path: string) => void) | undefined
  /** 在 dock 工作区里打开一个文件（新建/聚焦代码查看面板）。 */
  openFileInDock?: ((path: string, rel: string) => void) | undefined
}

export interface DockPanelRenderProps {
  panel: PanelInstance
  host: DockHostAccess
  /** 面板把自身可持久化状态合并回布局（随 Workspace 保存/恢复）。 */
  onStatePatch: (patch: Record<string, unknown>) => void
}

export interface DockPanelDef {
  type: string
  label: string
  /** 新建面板的默认标题（可被实例 title 覆盖）。 */
  defaultTitle: string
  icon: ReactNode
  render: (props: DockPanelRenderProps) => ReactNode
}

/* ── 16px Material 风格线性图标 ── */

function Icon({ d, filled = true }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth="1.8" d={d} />
    </svg>
  )
}

const ICONS = {
  files: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  git: 'M12 2a3 3 0 0 1 3 3c0 1.3-.84 2.4-2 2.82v3.36a3.002 3.002 0 0 1 2 2.82 3 3 0 1 1-6 0c0-1.3.84-2.4 2-2.82V7.82A3.008 3.008 0 0 1 9 5a3 3 0 0 1 3-3zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  wiki: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 14H9v-2h6v2zm2-4H7v-2h10v2zm0-4H7V7h10v2z',
  terminal: 'M4 5h16c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V6c0-.55.45-1 1-1zm3.6 3.2-2.1 2.1 2.1 2.1-1.4 1.4L2.7 10.3l3.5-3.5 1.4 1.4zM21.3 10.3l-3.5 3.5-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 3.5 3.5z',
  whiteboard: 'M3 5h18v11H3V5zm2 2v7h14V7H5zm-2 12h18v2H3v-2z',
  code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  preview: 'M4 6h16v10H4V6zm0-2c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h6v2H8v2h8v-2h-2v-2h6c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4z',
  browser: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3.4a15.7 15.7 0 0 0-1.2-5.3A8.03 8.03 0 0 1 19.9 11zM12 4.1c.9 1.2 1.9 3.4 2.4 6.9H9.6c.5-3.5 1.5-5.7 2.4-6.9zM4.1 13h3.4c.2 2 .7 3.8 1.2 5.3A8.03 8.03 0 0 1 4.1 13zm3.4-2H4.1a8.03 8.03 0 0 1 4.6-5.3A15.7 15.7 0 0 0 7.5 11zm4.5 8.9c-.9-1.2-1.9-3.4-2.4-6.9h4.8c-.5 3.5-1.5 5.7-2.4 6.9zm3.3-1.6c.6-1.5 1-3.3 1.2-5.3h3.4a8.03 8.03 0 0 1-4.6 5.3z',
  notes: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
}

/* ── dock 专用面板 ── */

/** 产物预览：会话 cwd 的目录浏览 iframe（/preview?artifacts=1）。 */
function PreviewArtifactsPanel({ panel, host }: DockPanelRenderProps) {
  const sid = host.sessionId
  const src = sid === undefined ? 'about:blank' : '/preview/' + encodeURIComponent(sid) + '/?artifacts=1'
  return (
    <iframe
      className={css.frame}
      title={'产物预览 ' + panel.id}
      src={src}
    />
  )
}

/** 内嵌浏览：地址栏 + /liuli-proxy iframe（纯 Web 部署的降级浏览通道）。 */
function BrowserLitePanel({ panel, host, onStatePatch }: DockPanelRenderProps) {
  void host
  const [draft, setDraft] = useState(() => typeof panel.state?.url === 'string' ? panel.state.url : '')
  const [current, setCurrent] = useState(() => typeof panel.state?.url === 'string' ? panel.state.url : '')
  const [tick, setTick] = useState(0)
  const navigate = (raw: string): void => {
    const url = normalizeBrowserUrl(raw)
    if (url === undefined) return
    setCurrent(url)
    setDraft(url)
    onStatePatch({ url })
  }
  const src = current === '' ? 'about:blank' : '/liuli-proxy?url=' + encodeURIComponent(current)
  return (
    <div className={css.browserWrap}>
      <form
        className={css.browserBar}
        onSubmit={(e) => { e.preventDefault(); navigate(draft) }}
      >
        <button
          type="button"
          className={css.browserBtn}
          aria-label="重新加载"
          data-testid="dock-browser-reload"
          onClick={() => { setTick(t => t + 1) }}
        >
          ↻
        </button>
        <input
          className={css.browserInput}
          data-testid="dock-browser-address"
          value={draft}
          placeholder="输入网址，例如 example.com"
          onChange={(e) => { setDraft(e.target.value) }}
        />
        <button type="submit" className={css.browserBtn} aria-label="前往">→</button>
      </form>
      {current === ''
        ? <div className={css.browserEmpty}>输入任意 http/https 网址内嵌浏览（经 /liuli-proxy 代理）</div>
        : <iframe key={current + '#' + String(tick)} className={css.frame} title={'内嵌浏览 ' + panel.id} src={src} />}
    </div>
  )
}

/** 便签：随布局持久化的文本面板（Workspace 保存/恢复的最小演示面）。 */
function NotesPanel({ panel, onStatePatch }: DockPanelRenderProps) {
  const [text, setText] = useState(() => typeof panel.state?.text === 'string' ? panel.state.text : '')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  const onChange = (value: string): void => {
    setText(value)
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => { onStatePatch({ text: value }) }, 300)
  }
  return (
    <textarea
      className={css.notes}
      data-testid="dock-notes-textarea"
      value={text}
      placeholder="便签内容随 Workspace 布局一起保存…"
      onChange={(e) => { onChange(e.target.value) }}
    />
  )
}

/** 代码查看：包装导出的 CodeViewerPanel，rel/path 存在面板 state。 */
function CodePanel({ panel, host }: DockPanelRenderProps) {
  const rel = typeof panel.state?.rel === 'string' ? panel.state.rel : ''
  const path = typeof panel.state?.path === 'string' ? panel.state.path : ''
  return (
    <CodeViewerPanel
      sessionId={host.sessionId}
      rel={rel}
      path={path}
      onOpenPath={host.openPath}
    />
  )
}

/* ── 注册表 ── */

export const DOCK_PANEL_DEFS: DockPanelDef[] = [
  {
    type: 'files',
    label: '文件树',
    defaultTitle: '文件树',
    icon: <Icon d={ICONS.files} />,
    render: ({ host }) => (
      <FileTreePanel
        sessionId={host.sessionId}
        onOpenFile={(path, rel) => { host.openFileInDock?.(path, rel) }}
        onAddFileToChat={host.addFileToChat}
        onOpenPath={host.openPath}
      />
    ),
  },
  {
    type: 'git',
    label: 'Git 图谱',
    defaultTitle: 'Git',
    icon: <Icon d={ICONS.git} />,
    render: ({ host }) => <GitPanel sessionId={host.sessionId} />,
  },
  {
    type: 'wiki',
    label: '仓库 Wiki',
    defaultTitle: 'Wiki',
    icon: <Icon d={ICONS.wiki} />,
    render: ({ host }) => (
      <WikiPanel sessionId={host.sessionId} onOpenFile={(path, rel) => { host.openFileInDock?.(path, rel) }} />
    ),
  },
  {
    type: 'terminal',
    label: '终端',
    defaultTitle: '终端',
    icon: <Icon d={ICONS.terminal} />,
    render: ({ panel, host }) => <TerminalPanel sessionId={host.sessionId} title={panel.title ?? '终端'} />,
  },
  {
    type: 'whiteboard',
    label: '白板',
    defaultTitle: '白板',
    icon: <Icon d={ICONS.whiteboard} />,
    render: ({ panel }) => <WhiteboardPanel boardId={typeof panel.state?.boardId === 'string' ? panel.state.boardId : panel.id} />,
  },
  {
    type: 'code',
    label: '代码查看',
    defaultTitle: '代码',
    icon: <Icon d={ICONS.code} />,
    render: props => <CodePanel {...props} />,
  },
  {
    type: 'preview',
    label: '产物预览',
    defaultTitle: '产物',
    icon: <Icon d={ICONS.preview} />,
    render: props => <PreviewArtifactsPanel {...props} />,
  },
  {
    type: 'browser',
    label: '内嵌浏览',
    defaultTitle: '浏览',
    icon: <Icon d={ICONS.browser} />,
    render: props => <BrowserLitePanel {...props} />,
  },
  {
    type: 'notes',
    label: '便签',
    defaultTitle: '便签',
    icon: <Icon d={ICONS.notes} />,
    render: props => <NotesPanel {...props} />,
  },
]

export function panelDef(type: string): DockPanelDef | undefined {
  return DOCK_PANEL_DEFS.find(d => d.type === type)
}

/** 面板标题：实例 title > 注册表 defaultTitle。 */
export function panelTitle(panel: PanelInstance): string {
  const def = panelDef(panel.type)
  return panel.title ?? def?.defaultTitle ?? panel.type
}
