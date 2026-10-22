/**
 * 琉璃主题 · 供应商额度显示（header 工具区右侧紧凑胶囊）。
 *
 * 订阅 supplier-quota 控制器；套餐供应商显示本月/本周/5小时三项，
 * 非套餐供应商显示余额，未识别时隐藏。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import {
  getSupplierQuotaSnapshot,
  setSupplierQuotaSession,
  subscribeSupplierQuota,
} from './supplier-quota.ts'
import css from './SupplierQuota.module.css'

export function SupplierQuota({ sessionId }: { sessionId: SessionId }) {
  const state = useSyncExternalStore(subscribeSupplierQuota, getSupplierQuotaSnapshot)

  // 会话切换后让控制器重新拉取当前供应商。
  useEffect(() => {
    setSupplierQuotaSession(sessionId)
  }, [sessionId])

  if (state.status === 'error') {
    return (
      <span className={css.quota + ' ' + css.quotaError} title={state.error}>
        额度不可用
      </span>
    )
  }

  if (state.status === 'loading' && state.data === null) {
    return (
      <span className={css.quota + ' ' + css.quotaLoading} title="正在读取供应商额度…">
        额度…
      </span>
    )
  }

  if (state.data === null || state.data.kind === 'unavailable') {
    // 诊断面：Command Code 的额度完全来自第三方插件的 Remote，出现「页头什么都没有」
    // 时无法区分是 remote 没挂载、目录没选模型还是字段为空。这里只在 commandcode
    // 供应商下把中断点以灰字显示出来；其它供应商维持原来的静默隐藏（不打扰）。
    if (state.provider === 'commandcode' && state.reason !== '') {
      return (
        <span className={css.quota + ' ' + css.quotaDiag} title={state.reason}>
          <span className={css.quotaLabel}>额度</span>
          <span className={css.quotaValue}>{state.reason}</span>
        </span>
      )
    }
    return null
  }

  if (state.data.kind === 'balance') {
    return (
      <span
        className={css.quota}
        title={state.data.title ?? `${state.data.provider} 余额`}
      >
        <span className={css.quotaLabel}>余额</span>
        <span className={css.quotaValue}>
          {state.data.currency !== undefined ? `${state.data.currency} ` : ''}
          {state.data.balance}
        </span>
      </span>
    )
  }

  return (
    <span
      className={css.quota}
      title={state.data.title ?? `${state.data.provider} 套餐额度`}
    >
      {state.data.items.map(item => (
        <span key={item.key} className={css.quotaItem} title={item.hint}>
          <span className={css.quotaLabel}>{item.label}</span>
          <span className={css.quotaValue}>{item.value}</span>
          {/* 有比例时补一条细进度条（Command Code 窗口额度用） */}
          {item.ratio === undefined ? null : (
            <span className={css.quotaTrack} aria-hidden="true">
              <span
                className={css.quotaFill}
                style={{ width: `${Math.round(item.ratio * 100)}%` }}
              />
            </span>
          )}
        </span>
      ))}
    </span>
  )
}


