/**
 * 琉璃 · 实时输出速度胶囊（挂在 composer 下方官方统计条里）。
 *
 * 官方 `conversation.composer.dock` 只有两枚胶囊：activity（轮次/步数 +
 * **整会话历史均值** tok/s）与 usage（总 token + 缓存命中）。那个均值是
 * sessionStats 投影在每步结束后结算出来的，模型正在喷字时看不出「当下多快」。
 * 本组件补一枚**实时**读数：
 *
 * - 数据全部来自 `useChat`：`legacy.partial` 是当前步骤的流式累积块，宿主按
 *   animation-frame 发布 live-chunk，因此它逐帧变化 —— 天然的采样时钟；
 * - 速度算法在 token-speed.ts（纯逻辑 + 单测）：最近 2s 窗口的差分均值，
 *   而不是逐帧瞬时值（后者被分块粒度抖成锯齿）；
 * - 三种状态：流式中给实时读数；流式刚停保留最后读数 2.5s 再淡出；空闲不渲染
 *   （不占位，观感与官方胶囊一致）。
 *
 * 走官方 slot 扩展点，不改宿主源码，也不观察 DOM。
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { LIULI_LS_KEY, liuliSettingsOf } from '../liuli-settings.ts'
import { STATS_ICONS } from './stats-icons.ts'
import { TokenSpeedMeter, estimateTokens, formatSpeed, partialChars } from './token-speed.ts'
import css from './TokenSpeedPill.module.css'

/** 设置保存后统一广播的事件（与 liuli-dock-surface 等模块同一约定）。 */
const SETTINGS_EVENT = 'liuli:sidebar-controls-changed'

/** 挂载点：官方 composer 下方统计条（与 activity / usage 胶囊同处）。 */
export type TokenSpeedPillProps = PropsRuntime<'conversation.composer.dock'>

/** 停流后保留最后读数的时长（ms）：给读数一个收尾落点，不瞬间闪没。 */
const HOLD_AFTER_SETTLE_MS = 2500

/** 单调时钟（performance.now 优先，退化到 Date.now）。 */
function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
}

/** 读「常驻显示」开关（localStorage 同源；损坏/不可读时按关闭处理）。 */
export function readPersistent(): boolean {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (raw === null) return false
    return liuliSettingsOf(JSON.parse(raw) as unknown).token_speed_persistent
  } catch (_) { return false }
}

/** 订阅「常驻显示」开关：初次读取 + 每次设置保存后重读。 */
function usePersistent(): boolean {
  const [persistent, setPersistent] = useState(readPersistent)
  useEffect(() => {
    const reload = (): void => { setPersistent(readPersistent()) }
    // 设置保存广播；跨标签页改动用 storage 事件补一封（同一页面不触发）。
    window.addEventListener(SETTINGS_EVENT, reload)
    window.addEventListener('storage', reload)
    return () => {
      window.removeEventListener(SETTINGS_EVENT, reload)
      window.removeEventListener('storage', reload)
    }
  }, [])
  return persistent
}

export function TokenSpeedPill({ useChat }: TokenSpeedPillProps) {
  // 只选 partial：它是流式的逐帧信号，别的快照字段变化不该带动本组件重渲染。
  const partial = useChat(state => state.legacy.partial)

  const meterRef = useRef<TokenSpeedMeter | null>(null)
  if (meterRef.current === null) meterRef.current = new TokenSpeedMeter()
  const meter = meterRef.current
  /** 上一帧所属的流式步骤（turn:step），变化即换窗口。 */
  const stepRef = useRef<string | null>(null)
  /** 停流后保留读数的截止时刻（ms）；null = 不在保留期。 */
  const [holdUntil, setHoldUntil] = useState<number | null>(null)

  const at = nowMs()
  const active = partial !== null
  const step = active ? `${partial.turn}:${partial.step}` : null

  if (active) {
    if (stepRef.current !== step) {
      // 换新的一步（上一轮结算、重试、切会话）：旧窗口不再可比。
      stepRef.current = step
      meter.reset()
    }
    meter.push(at, estimateTokens(partialChars(partial.blocks)))
  }
  const speed = active ? meter.speed(at) : undefined
  const held = !active ? meter.lastSpeed : undefined

  // 流式结束的一瞬记下保留截止时刻（只在「从流式变空闲」时进入）。
  useEffect(() => {
    if (active) { setHoldUntil(null); return }
    if (meter.lastSpeed === undefined) return
    const until = nowMs() + HOLD_AFTER_SETTLE_MS
    setHoldUntil(until)
    const timer = setTimeout(() => { setHoldUntil(null) }, HOLD_AFTER_SETTLE_MS)
    return () => { clearTimeout(timer) }
  }, [active, meter])

  // 「常驻显示」开关：开启后空闲也保留上一次读数；设置保存时经事件热更新。
  const persistent = usePersistent()

  // 保留期读数：常驻时一直可见，否则只在停流后的 2.5s 内显示。
  const holding = !active && held !== undefined && (persistent || (holdUntil !== null && at < holdUntil))
  const shown = speed ?? (holding ? held : undefined)
  // 常驻但还没有过任何一次输出（新开会话）时，显示占位而不是空白，避免位置跳动。
  if (shown === undefined && persistent && !active) {
    return (
      <span className={css.anchor} data-composer-stat="liuli-speed">
        <span className={css.pill} data-liuli-speed-idle="true" title="实时输出速度：本次会话还没有输出">
          <span
            className={css.icon}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: STATS_ICONS.speed.replace('width="16" height="16"', 'width="14" height="14"') }}
          />
          <span className={css.label}>— tok/s</span>
        </span>
      </span>
    )
  }
  if (shown === undefined) return null

  return (
    <span className={css.anchor} data-composer-stat="liuli-speed">
      <span
        className={css.pill}
        data-liuli-speed-live={speed !== undefined ? 'true' : undefined}
        title={speed !== undefined ? '实时输出速度（最近 2 秒）' : '上一次输出速度'}
      >
        <span
          className={css.icon}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: STATS_ICONS.speed.replace('width="16" height="16"', 'width="14" height="14"') }}
        />
        <span className={css.label} aria-label={`实时输出速度 ${formatSpeed(shown)} tok/s`}>
          {formatSpeed(shown)} tok/s
        </span>
      </span>
    </span>
  )
}
