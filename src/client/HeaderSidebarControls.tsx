import { useEffect, useState } from 'react'
import { getOfficialSidebarController } from './sidebar-right-tabs.ts'

export function HeaderSidebarControls({ toggleLeft }: { toggleLeft: () => void }) {
  const [leftClosed, setLeftClosed] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  useEffect(() => {
    const sync = () => {
      setLeftClosed(document.querySelector('[data-testid="dock-shell"]')?.getAttribute('data-sidebar-collapsed') === 'true')
      try { setRightOpen(getOfficialSidebarController()?.isExpanded?.() === true) } catch { /* seat changing */ }
    }
    sync()
    const timer = window.setInterval(sync, 300)
    return () => { clearInterval(timer) }
  }, [])
  return <span data-liuli-header-sidebar-controls="" style={{ display: 'inline-flex', gap: 4, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    <button type="button" title={leftClosed ? '展开左侧栏' : '收起左侧栏'} aria-label={leftClosed ? '展开左侧栏' : '收起左侧栏'} onClick={toggleLeft}>◧</button>
    <button type="button" title={rightOpen ? '收起右侧栏' : '展开右侧栏'} aria-label={rightOpen ? '收起右侧栏' : '展开右侧栏'} onClick={() => { getOfficialSidebarController()?.toggleExpanded?.() }}>◨</button>
  </span>
}
