import { useEffect, useState } from 'react'
import { getOfficialSidebarController } from './sidebar-right-tabs.ts'

export function HeaderSidebarControls() {
  const [rightOpen, setRightOpen] = useState(false)
  useEffect(() => {
    const sync = () => {
      try { setRightOpen(getOfficialSidebarController()?.isExpanded?.() === true) } catch { /* seat changing */ }
    }
    sync()
    const timer = window.setInterval(sync, 300)
    return () => { clearInterval(timer) }
  }, [])
  return <span data-liuli-header-sidebar-controls="" style={{ display: 'inline-flex', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
    <button type="button" title={rightOpen ? '收起右侧栏' : '展开右侧栏'} aria-label={rightOpen ? '收起右侧栏' : '展开右侧栏'} onClick={() => { getOfficialSidebarController()?.toggleExpanded?.() }}>◨</button>
  </span>
}
