/**
 * 右侧边栏面板：文件树 / Wiki / 命令中心。（Git 图谱已由 FileReviewPanel 取代）
 * 组件全部为自包含 React 面板，通过 /liuli-sidebar/* 读取 Host 数据；
 * 样式走 RightSidebarPanels.module.css（CSS Modules）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  fetchSidebarGit, fetchSidebarTree, fetchSidebarWiki,
  type SidebarGitPayload, type SidebarGitStatusRow, type SidebarTreeEntry, type SidebarTreePayload,
} from './right-sidebar-api.ts'
import css from './RightSidebarPanels.module.css'

/* ── 公共 Material 图标（16px，fill currentColor） ── */

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.3 10.59 10.59 16.89 4.3z" />
    </svg>
  )
}

/* ── 命令中心 ── */

export interface CommandPaletteCommand {
  id: string
  label: string
  hint?: string
  shortcut?: string
  run: () => void
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  commands: CommandPaletteCommand[]
}

/** Ctrl/Cmd+K 命令面板：仿 DSH 命令中心，按输入过滤命令。 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    const t = window.setTimeout(() => { inputRef.current?.focus() }, 0)
    return () => { window.clearTimeout(t) }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q === '') return commands
    return commands.filter(c => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    setIndex(0)
  }, [query])

  const run = (command: CommandPaletteCommand): void => {
    onClose()
    command.run()
  }

  if (!open) return null

  return (
    <div className={css.commandOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.commandCard}>
        <div className={css.commandInputRow}>
          <SearchIcon />
          <input
            ref={inputRef}
            className={css.commandInput}
            value={query}
            onChange={(e) => { setQuery(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); const hit = filtered[index]; if (hit !== undefined) run(hit) }
              else if (e.key === 'Escape') { e.preventDefault(); onClose() }
            }}
            placeholder="输入命令…"
          />
          <button type="button" className={css.commandClose} aria-label="关闭命令中心" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className={css.commandList}>
          {filtered.length === 0 && <div className={css.commandEmpty}>没有匹配的命令</div>}
          {filtered.map((command, i) => (
            <button
              type="button"
              key={command.id}
              className={css.commandItem + (i === index ? ' ' + css.commandActive : '')}
              onMouseEnter={() => { setIndex(i) }}
              onClick={() => { run(command) }}
            >
              <span className={css.commandLabel}>{command.label}</span>
              {command.hint !== undefined && <span className={css.commandHint}>{command.hint}</span>}
              {command.shortcut !== undefined && <kbd className={css.commandShortcut}>{command.shortcut}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 文件树面板 ── */

export interface FileTreePanelProps {
  sessionId?: string | undefined
  onOpenFile?: ((path: string, rel: string) => void) | undefined
  onAddFileToChat?: ((path: string) => void) | undefined
  onOpenPath?: ((path: string) => void) | undefined
}

/** 会话工作区文件树：搜索、仅变更文件、右键菜单。 */
export function FileTreePanel({ sessionId, onOpenFile, onAddFileToChat, onOpenPath }: FileTreePanelProps) {
  const [tree, setTree] = useState<SidebarTreePayload | null>(null)
  const [git, setGit] = useState<SidebarGitPayload | null>(null)
  const [rel, setRel] = useState('')
  const [filter, setFilter] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; kind: 'file' | 'dir' } | null>(null)

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    fetchSidebarTree(sessionId, rel, controller.signal)
      .then((payload) => { setTree(payload); setError(payload.ok ? null : (payload.error ?? '加载失败')) })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { controller.abort() }
  }, [sessionId, rel])

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    fetchSidebarGit(sessionId, controller.signal)
      .then((payload) => { setGit(payload) })
      .catch(() => { setGit(null) })
    return () => { controller.abort() }
  }, [sessionId])

  const root = tree?.root ?? git?.root ?? ''
  const rootBase = root.replace(/[\\/]+$/, '')
  const toAbsolute = (path: string): string => {
    if (path === '') return ''
    if (rootBase !== '' && path.startsWith(rootBase)) return path
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
    return `${rootBase}/${path}`
  }
  const statusByPath = useMemo(() => {
    const map = new Map<string, SidebarGitStatusRow>()
    for (const row of git?.status ?? []) {
      map.set(toAbsolute(row.path), row)
      if (row.oldPath !== undefined) map.set(toAbsolute(row.oldPath), row)
    }
    return map
  }, [git, rootBase, toAbsolute])
  const entries = useMemo(() => {
    const all = tree?.entries ?? []
    const q = filter.trim().toLowerCase()
    return all.filter((entry) => {
      if (q !== '' && !entry.name.toLowerCase().includes(q)) return false
      if (onlyChanged) {
        const key = entry.path
        if (entry.kind === 'dir') {
          const prefix = key.endsWith('/') ? key : key + '/'
          return Array.from(statusByPath.keys()).some(p => p.startsWith(prefix))
        }
        return statusByPath.has(key)
      }
      return true
    })
  }, [tree, filter, onlyChanged, statusByPath])

  const relOf = (path: string): string => root === '' ? path : path.slice(root.length).replace(/^\//, '')

  const openEntry = (entry: SidebarTreeEntry): void => {
    if (entry.kind === 'dir') {
      setRel(relOf(entry.path))
    } else {
      onOpenFile?.(entry.path, relOf(entry.path))
    }
  }

  const openMenu = (e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }, entry: SidebarTreeEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, path: entry.path, kind: entry.kind })
  }

  const closeMenu = (): void => { setMenu(null) }

  // 拖拽文件到输入框：捕获阶段放行并写入引用。
  useEffect(() => {
    if (onAddFileToChat === undefined) return
    const onDragOver = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('application/x-liuli-file') === true) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }
    const onDrop = (e: DragEvent): void => {
      const path = e.dataTransfer?.getData('application/x-liuli-file') ?? ''
      if (path === '') return
      const target = e.target as Element | null
      const composer = target?.closest?.('[data-composer-card], [data-input-scroll], textarea')
      if (composer === null || composer === undefined) return
      e.preventDefault()
      e.stopPropagation()
      onAddFileToChat(path)
    }
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, [onAddFileToChat])

  useEffect(() => {
    if (menu === null) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeMenu() }
    const onMouse = (e: MouseEvent): void => {
      const host = document.querySelector('[data-liuli-file-menu]')
      if (host !== null && host.contains(e.target as Node)) return
      closeMenu()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onMouse, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onMouse, true)
    }
  }, [menu])

  const renderMenu = (): ReactNode => {
    if (menu === null) return null
    const items: Array<{ label: string; action: string; danger?: boolean }> = []
    if (menu.kind === 'file') {
      items.push({ label: '预览', action: 'preview' })
      items.push({ label: '添加到聊天', action: 'chat' })
      items.push({ label: '复制路径', action: 'copy' })
      items.push({ label: '用默认编辑器打开', action: 'open' })
    } else {
      items.push({ label: '打开目录', action: 'open' })
      items.push({ label: '复制路径', action: 'copy' })
    }
    const run = (action: string): void => {
      if (action === 'preview') onOpenFile?.(menu.path, relOf(menu.path))
      if (action === 'chat') onAddFileToChat?.(menu.path)
      if (action === 'open') onOpenPath?.(menu.path)
      if (action === 'copy') void navigator.clipboard?.writeText(menu.path).catch(() => {})
      closeMenu()
    }
    return (
      <div
        role="menu"
        data-liuli-file-menu=""
        style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1300 }}
      >
        {items.map((item) => (
          <button
            type="button"
            role="menuitem"
            key={item.action}
            className={'liuli-menu-item' + (item.danger === true ? ' liuli-menu-danger' : '')}
            onClick={() => { run(item.action) }}
          >
            <span className="liuli-menu-label">{item.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={css.panelBody}>
      <div className={css.panelToolbar}>
        <div className={css.searchBox}>
          <SearchIcon />
          <input
            className={css.searchInput}
            data-liuli-file-search=""
            value={filter}
            onChange={(e) => { setFilter(e.target.value) }}
            placeholder="按文件名 / 路径筛选"
            spellCheck={false}
          />
        </div>
        <label className={css.onlyChanged}>
          <input
            type="checkbox"
            checked={onlyChanged}
            onChange={(e) => { setOnlyChanged(e.target.checked) }}
          />
          <span>仅变更</span>
        </label>
      </div>
      <div className={css.crumbRow}>
        <button type="button" className={css.crumbBtn} onClick={() => { setRel('') }}>~/</button>
        {rel !== '' && <span className={css.crumbSep}>/</span>}
        {rel !== '' && <span className={css.crumbText}>{rel}</span>}
      </div>
      <div className={css.fileList}>
        {error !== null && <div className={css.panelEmpty}>{error}</div>}
        {error === null && entries.length === 0 && <div className={css.panelEmpty}>没有文件</div>}
        {entries.map((entry) => {
          const status = statusByPath.get(entry.path)
          return (
            <button
              type="button"
              key={entry.path}
              className={css.fileRow}
              draggable={entry.kind === 'file'}
              onClick={() => { openEntry(entry) }}
              onDoubleClick={(e) => {
                if (entry.kind === 'file') {
                  e.preventDefault()
                  onOpenPath?.(entry.path)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && entry.kind === 'file') {
                  e.preventDefault()
                  onOpenPath?.(entry.path)
                }
              }}
              onContextMenu={(e) => { openMenu(e, entry) }}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-liuli-file', entry.path)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={entry.path + (status?.oldPath !== undefined ? ` (重命名自 ${status.oldPath})` : '')}
            >
              <span className={css.fileIcon}>{entry.kind === 'dir' ? <FolderIcon /> : <FileIcon />}</span>
              <span className={css.fileName}>{entry.name}</span>
              {entry.hidden && <span className={css.fileHidden}>hidden</span>}
              {status !== undefined && (
                <span className={css.gitStatus} data-status={status.x + status.y}>
                  {status.x + status.y}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {renderMenu()}
    </div>
  )
}

/* ── Git 图谱已由 FileReviewPanel（审查文件：全文 + diff）取代 ── */

/* ── Wiki 面板 ── */

export interface WikiPanelProps {
  sessionId?: string | undefined
  onOpenFile?: ((path: string, rel: string) => void) | undefined
}

/** 生成式架构导读：README 摘录 + 顶层模块地图（文件可点回源码）。 */
export function WikiPanel({ sessionId, onOpenFile }: WikiPanelProps) {
  const [payload, setPayload] = useState<Awaited<ReturnType<typeof fetchSidebarWiki>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    fetchSidebarWiki(sessionId, controller.signal)
      .then((p) => { setPayload(p); setError(p.ok ? null : (p.error ?? '加载失败')) })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { controller.abort() }
  }, [sessionId])

  const root = payload?.root ?? ''
  const relOf = (path: string): string => root === '' ? path : path.slice(root.length).replace(/^\//, '')

  return (
    <div className={css.panelBody}>
      <div className={css.panelToolbar}>
        <span className={css.panelTitle}>仓库 Wiki</span>
        {payload?.title !== undefined && <span className={css.branchBadge}>{payload.title}</span>}
        {payload?.readmePath !== undefined && (
          <button
            type="button"
            className={css.wikiFileLink}
            onClick={() => { onOpenFile?.(payload.readmePath ?? '', relOf(payload.readmePath ?? '')) }}
          >
            README 源码
          </button>
        )}
      </div>
      <div className={css.wikiReadme}>
        {error !== null && <div className={css.panelEmpty}>{error}</div>}
        {(payload?.readme ?? []).map((line, index) => <p key={index} className={css.wikiLine}>{line}</p>)}
        {payload?.readme !== undefined && payload.readme.length === 0 && (
          <div className={css.panelEmpty}>没有 README 文件</div>
        )}
      </div>
      <div className={css.wikiModules}>
        {(payload?.modules ?? []).map((module) => {
          return (
            <div key={module.name} className={css.wikiModule}>
              <div className={css.wikiModuleName}>{module.name}</div>
              <div className={css.wikiModuleFiles}>
                {module.files.length === 0 && '（无文件）'}
                {module.files.slice(0, 6).map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className={css.wikiFileLink}
                    onClick={() => { onOpenFile?.(file.path, relOf(file.path)) }}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
