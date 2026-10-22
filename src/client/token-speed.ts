/**
 * 琉璃 · 实时输出速度（tok/s）计量。
 *
 * 官方统计胶囊里的 `53 tok/s` 是**整会话历史均值**（decodeTokens / decodeMs，
 * 由 sessionStats 投影在一步结束后结算）。用户要的是**流式过程中当下有多快**，
 * 那个数只有从正在累积的流式内容里自采才能得到：
 *
 * - 数据源：ChatSnapshot.legacy.partial（`assistant/live-chunk` 折叠出的当前
 *   步骤累积块）。宿主对 live-chunk 的发布策略是 animation-frame，所以它随
 *   流式输出逐帧变化，天然就是采样时钟；
 * - token 口径：宿主 token-meter 用「字符数 / 4 + 每块结构开销」的固定密度启发式
 *   估算（estimate.ts 的 CHARS_PER_TOKEN）。这里只关心**增量**，故取纯字符密度
 *   （不含结构开销）即可与宿主读数同量级；
 * - 速度：最近 WINDOW_MS 窗口内「最新采样 − 最旧采样」的差分，而不是逐帧瞬时值
 *   —— 逐帧差分会被流式分块粒度抖成锯齿。窗口跨度不足 MIN_SPAN_MS 时不给读数
 *   （刚开口那一瞬），由调用方显示占位。
 *
 * 纯函数/纯状态机，无 React、无 DOM，便于单测（tests/token-speed.test.mjs）。
 */

/** 采样窗口时长（ms）：最近这段时间的平均速度即「实时速度」。 */
export const SPEED_WINDOW_MS = 2000
/** 窗口最短跨度（ms）：不足则认为样本还不够判定，返回 undefined。 */
export const MIN_SPAN_MS = 300
/** 事件内最多保留的采样点（防长时间流式把数组撑大）。 */
const MAX_SAMPLES = 64

/** 一次采样：时刻（ms，调用方时钟）+ 当时累计的估算输出 token 数。 */
export interface SpeedSample {
  readonly at: number
  readonly tokens: number
}

/** 宿主 token-meter 的固定密度启发式（estimate.ts：CHARS_PER_TOKEN）。 */
const CHARS_PER_TOKEN = 4

/**
 * 估算一块流式内容已产生的字符量。
 * 只统计真正随生成增长的部分：正文、思考、工具调用的名称与参数。
 * @param blocks - 当前步骤的累积块（ChatSnapshot.legacy.partial.blocks）。
 * @returns 字符总数。
 */
export function partialChars(blocks: readonly { kind: string; text?: string; name?: string; argsRaw?: string }[]): number {
  let chars = 0
  for (const block of blocks) {
    if (block.kind === 'text' || block.kind === 'reasoning') chars += block.text?.length ?? 0
    else if (block.kind === 'tool-call') chars += (block.name?.length ?? 0) + (block.argsRaw?.length ?? 0)
  }
  return chars
}

/**
 * 把字符量换算成估算 token 数（与宿主同一条固定密度启发式）。
 * @param chars - 字符总数。
 * @returns 估算 token 数（非负整数）。
 */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.ceil(chars / CHARS_PER_TOKEN))
}

/**
 * 显示用速度格式：与官方 `formatTokensPerSecond` 一致 —— ≥10 取整、其余一位小数，
 * 让插件读数与官方胶囊读起来的精度习惯相同。
 * @param tps - tokens/s。
 * @returns 不带单位的显示串。
 */
export function formatSpeed(tps: number): string {
  const clamped = Math.max(0, Number.isFinite(tps) ? tps : 0)
  if (clamped >= 10) return String(Math.round(clamped))
  if (clamped <= 0) return '0'
  return clamped.toFixed(1)
}

/**
 * 实时速度滑动窗口。
 *
 * 生命周期与一条流式步骤对齐：`push` 记采样，`speed` 读窗口差分；
 * token 计数回退（新一轮/重试/切会话）时自动开新窗口。
 */
export class TokenSpeedMeter {
  private samples: SpeedSample[] = []
  /** 最近一次算出的有效读数（流式结束后供调用方短暂显示）。 */
  private last: number | undefined

  /** 最近一次有效读数；undefined 表示本条会话还没有任何速度样本。 */
  get lastSpeed(): number | undefined {
    return this.last
  }

  /** 清空窗口与记忆值（切换会话、停止/重启流式时调用）。 */
  reset(): void {
    this.samples = []
    this.last = undefined
  }

  /**
   * 记一次采样。
   * @param at - 采样时刻（ms，同一单调时钟）。
   * @param tokens - 当时累计的估算输出 token 数。
   * @returns 是否真的入窗（计数未变或倒退被丢弃）。
   */
  push(at: number, tokens: number): boolean {
    const previous = this.samples[this.samples.length - 1]
    // 计数倒退 = 换了新的一步（或重试），旧窗口不再可比。
    if (previous !== undefined && tokens < previous.tokens) this.samples = []
    const last = this.samples[this.samples.length - 1]
    // 同一时刻/同一计数重复采样没有信息量，直接跳过（渲染次数通常多于增长次数）。
    if (last !== undefined && (last.tokens === tokens || at <= last.at)) return false
    this.samples.push({ at, tokens })
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    return true
  }

  /**
   * 读当前窗口的实时速度。
   * @param at - 当前时刻（ms），用于剪掉窗口外的旧采样。
   * @returns tokens/s；样本不足（跨度 < MIN_SPAN_MS、或窗口内没有增量）时 undefined。
   */
  speed(at: number): number | undefined {
    // 先按当前时刻剪掉窗口外的点：长时间停顿后窗口自然空掉，读数随之消失。
    while (this.samples.length > 0 && at - this.samples[0]!.at > SPEED_WINDOW_MS) this.samples.shift()
    const oldest = this.samples[0]
    const newest = this.samples[this.samples.length - 1]
    if (oldest === undefined || newest === undefined || oldest === newest) return undefined
    const span = newest.at - oldest.at
    if (span < MIN_SPAN_MS) return undefined
    const delta = newest.tokens - oldest.tokens
    if (delta <= 0) return undefined
    const speed = delta / span * 1000
    this.last = speed
    return speed
  }
}
