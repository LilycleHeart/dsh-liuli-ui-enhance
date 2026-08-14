/**
 * 琉璃主题 · 会话 header 效果包。
 *
 * 通过 `conversation.session.header.*` slots 注入四件 chrome：
 *   - header.actions   → DenpaHeaderVoiceprint：声纹 canvas 铺满 header 卡片背景；
 *   - header.utilities → DenpaHeaderChrome：系统音频监听按钮 + 日/夜主题切换；
 *   - header.tabs      → DenpaHeaderResizer：header 垂直拉伸手柄（布局记忆）。
 *
 * 声纹 canvas 与监听按钮分属不同 slot 渲染树（无法共享 React context），
 * 二者经模块级单例引擎 VoiceprintEngine 协作：canvas 的 rAF 循环直接读取
 * 引擎快照，按钮通过 useSyncExternalStore 订阅 listening/error 状态。
 *
 * 复刻自 denpa_echo Waveform：品牌色单源派生、暗/亮差异化着色、shadowBlur
 * 泛光、IntersectionObserver 视口外暂停、ResizeObserver + dpr 自适应。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import css from './HeaderEffects.module.css'

/* ── 模块级单例引擎 ─────────────────────────────────────────────── */

interface VpState {
  listening: boolean
  /** 捕获来源：system（屏幕共享音频）/ mic（麦克风降级）。 */
  mode: 'system' | 'mic' | null
  error: string
  analyser: AnalyserNode | null
  audioCtx: AudioContext | null
  source: MediaStreamAudioSourceNode | null
  stream: MediaStream | null
  freqBuf: Uint8Array<ArrayBuffer> | null
  audioMix: number
}

const vpState: VpState = {
  listening: false,
  mode: null,
  error: '',
  analyser: null,
  audioCtx: null,
  source: null,
  stream: null,
  freqBuf: null,
  audioMix: 0,
}

const vpListeners = new Set<() => void>()

function vpEmit(): void {
  for (const listener of vpListeners) listener()
}

function vpSubscribe(listener: () => void): () => void {
  vpListeners.add(listener)
  return () => { vpListeners.delete(listener) }
}

function vpGetState(): VpState {
  return vpState
}

/** 停止捕获（内部实现，供卸载与按钮共用）。 */
function vpStopCapture(): void {
  vpState.audioMix = 0
  if (vpState.source !== null) { try { vpState.source.disconnect() } catch (_) {} vpState.source = null }
  if (vpState.stream !== null) { vpState.stream.getTracks().forEach(t => t.stop()); vpState.stream = null }
  if (vpState.analyser !== null) vpState.analyser = null
  if (vpState.audioCtx !== null) { try { void vpState.audioCtx.close() } catch (_) {} vpState.audioCtx = null }
}

async function vpToggle(): Promise<void> {
  if (vpState.listening) {
    vpStopCapture()
    vpState.listening = false
    vpState.mode = null
    vpEmit()
    return
  }
  vpState.error = ''
  vpEmit()
  /** 启动分析器（共用引擎）；成功返回 true。 */
  const startAnalyser = (stream: MediaStream, mode: 'system' | 'mic'): boolean => {
    const audioTrack = stream.getAudioTracks()[0]
    if (audioTrack === undefined) {
      stream.getTracks().forEach(tr => tr.stop())
      return false
    }
    const audioCtx = new AudioContext()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
    vpState.audioCtx = audioCtx
    vpState.analyser = analyser
    vpState.source = source
    vpState.stream = stream
    vpState.mode = mode
    audioTrack.addEventListener('ended', () => {
      vpStopCapture()
      vpState.listening = false
      vpState.mode = null
      vpEmit()
    })
    vpState.listening = true
    vpEmit()
    return true
  }

  // 非安全上下文：mediaDevices 整体不可用，给出精确诊断（含当前地址）。
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      vpState.error = '音频捕获需要安全上下文：请用 https:// 或 http://localhost/127.0.0.1 访问本页面（当前 ' + window.location.protocol + '//' + window.location.host + '）'
    } else {
      vpState.error = '当前浏览器不支持音频捕获（mediaDevices 不可用）'
    }
    vpEmit()
    return
  }

  // 1) 系统音频：屏幕共享（getDisplayMedia）。
  if (typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true })
      if (startAnalyser(stream, 'system')) return
      // 未勾选「分享标签页音频」时轨道为空 → 继续降级麦克风
    } catch (err) {
      const name = (err as DOMException | undefined)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        vpState.error = '屏幕共享不可用：' + (name === 'NotAllowedError' ? '已拒绝授权' : '浏览器策略限制')
        vpEmit()
        return
      }
      // 其他失败（无音频轨道、设备不可用等）→ 降级麦克风
    }
  }

  // 2) 降级：麦克风（getUserMedia）——无需屏幕共享，可监听系统播放音量。
  if (typeof navigator.mediaDevices.getUserMedia === 'function') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (startAnalyser(stream, 'mic')) return
    } catch (_) { /* 拒绝或不可用：落到最终提示 */ }
  }

  vpState.error = '音频捕获不可用：请用 https://localhost 访问（当前 ' + window.location.protocol + '//' + window.location.host + '），并允许麦克风/屏幕共享权限'
  vpEmit()
}

/* ── 绘制工具（与 denpa_echo Waveform 同曲线） ─────────────────── */

type RGB = [number, number, number]

/** 品牌色缓存读取（--dsw-alias-brand-primary），主题切换后失效。 */
function brandRGB(): RGB {
  const v = getComputedStyle(document.body)
    .getPropertyValue('--dsw-alias-brand-primary').trim() || '#8ecdf8'
  const m = v.match(/^#?([0-9a-f]{6})$/i)
  if (!m) return [142, 205, 248]
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`
}

function lighten(c: RGB, amt: number): RGB {
  return [
    Math.round(c[0] + (255 - c[0]) * amt),
    Math.round(c[1] + (255 - c[1]) * amt),
    Math.round(c[2] + (255 - c[2]) * amt),
  ]
}

/* DenpaPush ECG 式水平渐变：波形在绘制层面淡出 —— 左端透明快速浮现、
   主段全亮；右端从 80% 处开始渐隐（覆盖工具区至 session log 按钮宽度），
   到右缘完全消失（alpha 0）。 */
function edgeGradient(ctx: CanvasRenderingContext2D, w: number, C: RGB, alpha: number): CanvasGradient {
  const lg = ctx.createLinearGradient(0, 0, w, 0)
  lg.addColorStop(0, rgba(C, 0))
  lg.addColorStop(0.12, rgba(C, alpha * 0.4))
  lg.addColorStop(0.8, rgba(C, alpha))
  lg.addColorStop(1, rgba(C, 0))
  return lg
}

/* ── 声纹背景 canvas ────────────────────────────────────────────── */

/**
 * 背景层：声纹 canvas 铺满 header。注入 `conversation.session.header.actions`
 * （slot 树在 titleRow 内，而 titleRow 是 relative 包含块），所以先渲染一个
 * 隐藏锚点找到 <header>，再把背景层 portal 到 header 直接子节点：
 * 包含块回到 header 卡片（inset:0 铺满全高），z-index:0 低于标题行/标签行。
 */
export function DenpaHeaderVoiceprint() {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setHost(anchorRef.current?.closest('header') ?? null)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    let w = 0, h = 0
    let raf = 0
    let visible = true
    let io: IntersectionObserver | null = null
    let ro: ResizeObserver | null = null

    const resize = (): void => {
      let cw = canvas.clientWidth, ch = canvas.clientHeight
      if (cw < 2 || ch < 2) {
        const r = canvas.getBoundingClientRect()
        cw = r.width; ch = r.height
      }
      if (cw < 2 || ch < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = cw; h = ch
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
    }

    let energy = 1
    let idlePhase = 0

    const draw = (): void => {
      ctx.clearRect(0, 0, w, h)
      const C = brandRGB()
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      ctx.shadowBlur = 0

      const binCount = vpState.analyser !== null ? vpState.analyser.frequencyBinCount : 128
      if (vpState.freqBuf === null || vpState.freqBuf.length !== binCount) vpState.freqBuf = new Uint8Array(binCount)
      if (vpState.analyser !== null) vpState.analyser.getByteFrequencyData(vpState.freqBuf)
      const freqData = vpState.freqBuf

      const hasSignal = freqData.some(v => v > 12)

      let target = 1
      if (hasSignal) {
        let sum = 0
        for (let i = 0; i < freqData.length; i++) sum += freqData[i] ?? 0
        target = 1 + (sum / freqData.length / 255) * 2.5
      }
      energy += (target - energy) * 0.08

      if (hasSignal) vpState.audioMix += (1 - vpState.audioMix) * 0.035
      else {
        vpState.audioMix -= 1 / 600
        if (vpState.audioMix < 0) vpState.audioMix = 0
      }

      drawWave(freqData, C, dark)
    }

    /* 流动波形（空闲态 ↔ 音频驱动态平滑过渡） */
    const drawWave = (freqData: Uint8Array, C: RGB, dark: boolean): void => {
      const lineC = dark ? lighten(C, 0.35) : C
      // 波形绘制区跟随 header 高度（拉伸时波形随之缩放），中心始终
      // 垂直居中于 header（cy = h/2，上下对称）。
      const cy = h * 0.5
      const lineCount = Math.max(3, Math.min(16, Math.round(h / 6)))
      const mix = vpState.audioMix

      idlePhase += 0.008 * (1 + mix * 2)

      ctx.shadowBlur = 0
      for (let li = 0; li < lineCount; li++) {
        const t = li / lineCount - 0.5
        const baseY = cy + t * (h * 0.8)
        const idleAmp = (h * 0.08 + (li % 3) * 1.2) * (1 - Math.abs(t) * 1.4) * (1 - mix * 0.8)
        const binIdx = Math.min(freqData.length - 1, Math.floor((li / lineCount) * freqData.length))
        const binVal = (freqData[binIdx] ?? 0) / 255
        const amp = idleAmp + mix * binVal * h * 0.35 * (1 - Math.abs(t) * 0.6)

        const freq = 0.007 + li * 0.00055
        const alpha = (dark ? 0.18 : 0.16) + (1 - Math.abs(t)) * (dark ? 0.42 : 0.32) + mix * binVal * 0.2

        ctx.beginPath()
        ctx.strokeStyle = edgeGradient(ctx, w, lineC, Math.min(1, alpha))
        ctx.lineWidth = 1 + mix * binVal * 0.8
        for (let x = 0; x <= w; x += 3) {
          const n = Math.sin(freq * x + idlePhase + li * 0.75)
            + 0.33 * Math.sin(freq * 2.4 * x + idlePhase * 1.35 + li * 1.15)
          const y = Math.max(1, Math.min(h - 1, baseY + amp * n))
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // 中央主波（辉光焦点）
      ctx.shadowColor = rgba(lineC, dark ? 0.9 : 0.45)
      ctx.shadowBlur = dark ? 16 : 6
      ctx.beginPath()
      ctx.strokeStyle = edgeGradient(ctx, w, lineC, dark ? 1 : 0.7)
      const mainBin = Math.floor(freqData.length * 0.25)
      const mainVal = (freqData[mainBin] ?? 0) / 255
      ctx.lineWidth = 2 + mix * mainVal * 1.5
      const mainAmp = h * 0.34 * (1 - mix * 0.8) + mix * mainVal * h * 0.25
      for (let x = 0; x <= w; x += 2) {
        const n = Math.sin(0.011 * x + idlePhase)
          + 0.33 * Math.sin(0.0264 * x + idlePhase * 1.35)
        const y = Math.max(1, Math.min(h - 1, cy + mainAmp * n))
        if (x === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      draw()
    }

    resize()
    ro = new ResizeObserver(resize)
    ro.observe(canvas)
    window.addEventListener('resize', resize)
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        const nowVisible = entries[0]?.isIntersecting ?? false
        if (nowVisible === visible) return
        visible = nowVisible
        if (visible) loop()
        else {
          cancelAnimationFrame(raf)
          raf = 0
        }
      }, { rootMargin: '150px 0px' })
      io.observe(canvas)
    }
    loop()

    return () => {
      cancelAnimationFrame(raf)
      io?.disconnect()
      ro?.disconnect()
      window.removeEventListener('resize', resize)
      if (vpState.listening) {
        vpStopCapture()
        vpState.listening = false
        vpEmit()
      }
    }
    // 依赖 host：绘制循环必须在 portal canvas 挂载后启动（首次渲染 host 为
    // null，canvas 尚不存在，[] 依赖会让循环永不启动 —— 元素在但画面透明）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host])

  return (
    <>
      {/* 锚点（display:none 不占位）：定位 slot 树所属的会话 header */}
      <div ref={anchorRef} style={{ display: 'none' }} />
      {host !== null && createPortal(
        <div className={css.wrap} aria-hidden="true">
          <canvas ref={canvasRef} className={css.canvas} />
        </div>,
        host,
      )}
    </>
  )
}

/* ── 监听按钮 ───────────────────────────────────────────────────── */

/** 监听按钮：渲染在 titleRow 工具区（主题切换一侧），与背景 canvas 共享引擎。 */
export function DenpaHeaderAudioButton() {
  const { listening, mode, error } = useSyncExternalStore(vpSubscribe, vpGetState)
  return (
    <span className={css.btnWrap} title={listening ? (mode === 'mic' ? '正在监听（麦克风）' : '正在监听系统音频') : '点击监听系统音频'}>
      <button
        type="button"
        className={css.toggle}
        aria-label={listening ? '停止监听系统音频' : '监听系统音频'}
        aria-pressed={listening}
        onClick={() => { void vpToggle() }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path d="M8 1.5a3 3 0 0 0-3 3v3.5a3 3 0 0 0 6 0V4.5a3 3 0 0 0-3-3zM2.5 8v.5a5.5 5.5 0 0 0 11 0V8h1.5v.5a7 7 0 0 1-6.25 6.97V16h-1.5v-.53A7 7 0 0 1 1 8.5V8h1.5z" fill="currentColor" />
        </svg>
      </button>
      {error !== '' && <span className={css.error}>{error}</span>}
    </span>
  )
}

/* ── 日/夜主题切换 ──────────────────────────────────────────────── */

function isDarkNow(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

/**
 * 主题切换按钮。点击 dispatch `denpa:toggle-theme`（带点击坐标），插件事件桥
 * 经 theme 服务走正式路径（持久化 + presenter），配 startViewTransition 圆形遮罩。
 */
export function DenpaHeaderThemeToggle() {
  const dark = useSyncExternalStore(
    (listener) => {
      const mo = new MutationObserver(listener)
      mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      return () => { mo.disconnect() }
    },
    isDarkNow,
  )

  const toggle = (e: React.MouseEvent<HTMLButtonElement>): void => {
    window.dispatchEvent(new CustomEvent('denpa:toggle-theme', {
      detail: { x: e.clientX, y: e.clientY },
    }))
  }

  return (
    <button
      type="button"
      className={css.toggle}
      aria-label={dark ? '切换日间主题' : '切换夜间主题'}
      title={dark ? '切换日间主题' : '切换夜间主题'}
      onClick={toggle}
    >
      {dark ? (
        /* 日间（当前夜间 → 点去日间）：太阳 */
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
          </g>
        </svg>
      ) : (
        /* 夜间（当前日间 → 点去夜间）：月亮 */
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M13.4 10.2A5.8 5.8 0 0 1 5.8 2.6a5.8 5.8 0 1 0 7.6 7.6z" fill="currentColor" />
        </svg>
      )}
    </button>
  )
}

/** 工具区组合：监听按钮 + 主题切换（注入 header.utilities 一个 slot 位）。 */
export function DenpaHeaderChrome() {
  return (
    <>
      <DenpaHeaderAudioButton />
      <DenpaHeaderThemeToggle />
    </>
  )
}

/* ── 垂直拉伸手柄 ───────────────────────────────────────────────── */

/** 布局记忆键（localStorage，随浏览器持久化）。 */
const LS_KEY = 'denpa:header-height'
const MIN_H = 52
const MAX_H = 320

/**
 * 拉伸手柄。注入 `conversation.session.header.tabs`，但手柄层经 portal 挂到
 * header 直接子节点：tabs 行是 relative 包含块，absolute bottom 会钉在
 * tabs 底部（header 中部）而非 header 底部 —— 之前拉伸失效的根因。
 * 垂直拖拽改变 header 高度（min-height，内容自然高度为下限，声纹 canvas
 * 随高度铺满）；松开后高度持久化到 localStorage，刷新/切换会话自动恢复。
 */
export function DenpaHeaderResizer() {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    setHost(anchorRef.current?.closest('header') ?? null)
  }, [])

  useEffect(() => {
    const el = handleRef.current
    if (el === null) return
    const header = el.closest('header')
    if (header === null) return

    // 布局记忆：恢复上次拖拽高度
    try {
      const saved = Number.parseFloat(localStorage.getItem(LS_KEY) ?? '')
      if (Number.isFinite(saved) && saved >= MIN_H && saved <= MAX_H) {
        header.style.minHeight = saved + 'px'
      }
    } catch (_) { /* 存储不可用则跳过 */ }

    let drag: { startY: number; startH: number } | null = null
    const onMove = (e: PointerEvent): void => {
      if (drag === null) return
      const h = Math.max(MIN_H, Math.min(MAX_H, drag.startH + (e.clientY - drag.startY)))
      header.style.minHeight = h + 'px'
    }
    const onUp = (e: PointerEvent): void => {
      if (drag === null) return
      drag = null
      // 存纯数字（恢复端 parseFloat，避免 "145px" 被 Number() 解析为 NaN）
      try { localStorage.setItem(LS_KEY, String(Number.parseFloat(header.style.minHeight) || '')) } catch (_) {}
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      el.releasePointerCapture?.(e.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    const onDown = (e: PointerEvent): void => {
      e.preventDefault()
      drag = { startY: e.clientY, startH: header.getBoundingClientRect().height }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'ns-resize'
      try { el.setPointerCapture(e.pointerId) } catch (_) {}
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }
    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // 依赖 host：手柄 portal 挂载后（同声纹 canvas 时序）再绑定拖拽
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host])

  return (
    <>
      {/* 锚点（display:none 不占位）：定位 slot 树所属的会话 header */}
      <div ref={anchorRef} style={{ display: 'none' }} />
      {host !== null && createPortal(
        <div ref={handleRef} className={css.resizer} aria-hidden="true" />,
        host,
      )}
    </>
  )
}
