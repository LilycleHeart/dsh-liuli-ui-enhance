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

  if (state.data === null || state.data.kind === 'unavailable') return null

  if (state.data.kind === 'balance') {
    return (
      <span
        className={css.quota}
        title={`${state.data.provider} 余额`}
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
      title={`${state.data.provider} 套餐额度`}
    >
      {state.data.items.map(item => (
        <span key={item.key} className={css.quotaItem}>
          <span className={css.quotaLabel}>{item.label}</span>
          <span className={css.quotaValue}>{item.value}</span>
        </span>
      ))}
    </span>
  )
}
