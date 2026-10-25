/**
 * 设置页「窗口顶栏」下方的补丁修复块：显示当前状态 + 一个「立即打补丁」按钮。
 *
 * 背景：无边框补丁写在客户端安装文件里，DSH Desktop 每次自动更新都会用官方
 * 文件覆盖，顶栏随之失效。以前只能在终端跑脚本；这里给一个按钮，点了就地
 * 写盘（只改 asar 头 + unpacked 文件），重启客户端后恢复。
 */
import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import css from './LiuliAppearance.module.css'
import { applyTopbarPatch, describeTopbarPatch, fetchTopbarPatchStatus } from './topbar-patch.ts'
import type { TopbarPatchResult, TopbarPatchStatus } from './topbar-patch.ts'

export function TopbarPatchNotice(): ReactElement | null {
  const [status, setStatus] = useState<TopbarPatchStatus | undefined>(undefined)
  const [result, setResult] = useState<TopbarPatchResult | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchTopbarPatchStatus().then((next) => {
      if (alive) setStatus(next)
    })
    return () => { alive = false }
  }, [])

  if (status === undefined) return null

  const patched = status.state === 'patched'
  const disabled = busy || !status.canApply
  const buttonLabel = busy ? '正在写入…' : patched ? '已应用' : '立即打补丁'

  const run = async (): Promise<void> => {
    if (disabled) return
    setBusy(true)
    try {
      const applied = await applyTopbarPatch()
      setResult(applied)
      const next = await fetchTopbarPatchStatus()
      if (next !== undefined) setStatus(next)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.patchNotice} role="status">
      <div className={css.patchNoticeHead}>
        <span>{describeTopbarPatch(status)}</span>
        <button
          type="button"
          className={css.patchNoticeBtn}
          disabled={disabled}
          onClick={() => { void run() }}
        >
          {buttonLabel}
        </button>
      </div>
      {status.state === 'needs-exit' && (
        <code>退出客户端后：node scripts/patch-official-window-controls.mjs --apply</code>
      )}
      {result !== undefined && (
        <span data-tone={result.ok ? 'ok' : 'warn'}>
          {result.message}{result.ok && result.requiresRestart ? '（重启客户端后生效）' : ''}
        </span>
      )}
      {status.version !== undefined && (
        <code>客户端 {status.version} · asar 完整性校验 fuse：{status.fuse === 'off' ? '未启用' : status.fuse === 'on' ? '已启用' : '未知'}</code>
      )}
    </div>
  )
}
