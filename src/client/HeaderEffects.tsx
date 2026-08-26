/**
 * 琉璃主题 · 会话 header 效果包。
 *
 * 通过 `conversation.session.header.*` slots 注入四件 chrome：
 *   - header.actions   → LiuliHeaderVoiceprint：声纹 canvas 铺满 header 卡片背景；
 *   - header.utilities → LiuliHeaderChrome：系统音频监听按钮 + 日/夜主题切换；
 *   - header.utilities → LiuliHeaderResizer：header 垂直拉伸手柄（布局记忆）。
 *
 * 声纹 canvas 与监听按钮分属不同 slot 渲染树（无法共享 React context），
 * 二者经模块级单例引擎 VoiceprintEngine 协作：canvas 的 rAF 循环直接读取
 * 引擎快照，按钮通过 useSyncExternalStore 订阅 listening/error 状态。
 *
 * 实现自 liuli_echo Waveform：品牌色单源派生、暗/亮差异化着色、shadowBlur
 * 泛光、IntersectionObserver 视口外暂停、ResizeObserver + dpr 自适应。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { LIULI_LS_KEY, LIULI_SETTINGS_DEFAULTS, type LiuliSettings } from '../liuli-settings.ts'
import css from './HeaderEffects.module.css'

/** 声纹响应运行时参数（设置页可调；每次保存经 liuli:vp-params 事件重载）。 */
const vpParams = {
  enabled: LIULI_SETTINGS_DEFAULTS.vp_enabled,          // 总开关（vp_enabled）
  sensitivity: LIULI_SETTINGS_DEFAULTS.vp_sensitivity, // 参考响度（越小越灵敏）
  beatGain: LIULI_SETTINGS_DEFAULTS.vp_beat_gain,      // 鼓点强度
  beatDecay: LIULI_SETTINGS_DEFAULTS.vp_beat_decay,    // 脉冲长度
  beatMult: LIULI_SETTINGS_DEFAULTS.vp_beat_mult,      // 节拍触发灵敏度
  pulseMult: LIULI_SETTINGS_DEFAULTS.vp_pulse_mult,    // 低频脉冲灵敏度
  weights: [0.4, 0.35, 0.25],                          // 低/中/高频段权重（0-1）
  beatCooldown: LIULI_SETTINGS_DEFAULTS.vp_beat_cooldown,
  pulseCooldown: LIULI_SETTINGS_DEFAULTS.vp_pulse_cooldown,
  envAttack: 0.3,                                      // 频段包络攻速（env_speed 映射）
  envRelease: 0.05,                                    // 频段包络释放（attack/6）
  specSmooth: LIULI_SETTINGS_DEFAULTS.vp_spec_smooth,  // 频谱平滑
  noiseGate: LIULI_SETTINGS_DEFAULTS.vp_noise_gate,    // 静音门限
  // ── 视觉/外观（绘制层，原硬编码，现开放）──
  lines: LIULI_SETTINGS_DEFAULTS.vp_lines,             // 波形线条数（官方 22）
  idleSpeed: LIULI_SETTINGS_DEFAULTS.vp_idle_speed,    // 空闲流动速度（0.008/帧）
  amplitude: LIULI_SETTINGS_DEFAULTS.vp_amplitude,     // 整体振幅倍率（1）
  mainAmp: LIULI_SETTINGS_DEFAULTS.vp_main_amp,        // 中央主波基准幅度（46）
  glow: LIULI_SETTINGS_DEFAULTS.vp_glow,               // 主波辉光强度（50 ≈ blur 20/6）
  lineAlpha: LIULI_SETTINGS_DEFAULTS.vp_line_alpha,    // 线条基础不透明度（50 ≈ 原档）
  edgeFade: LIULI_SETTINGS_DEFAULTS.vp_edge_fade,      // 右缘淡出位置（0.8）
  bassEvent: LIULI_SETTINGS_DEFAULTS.vp_bass_event,    // 低频冲击强度（×1）
  midEvent: LIULI_SETTINGS_DEFAULTS.vp_mid_event,      // 中频流速强度（×1）
  highEvent: LIULI_SETTINGS_DEFAULTS.vp_high_event,    // 高频星闪强度（×1）
  // ── 检测/响应细节 ──
  beatWindow: LIULI_SETTINGS_DEFAULTS.vp_beat_window,  // 节拍均值窗口（42 帧）
  pulseWindow: LIULI_SETTINGS_DEFAULTS.vp_pulse_window, // 脉冲均值窗口（170 帧）
  noiseRate: LIULI_SETTINGS_DEFAULTS.vp_noise_rate,    // 噪声底学习率（0.0005）
  driveSmooth: LIULI_SETTINGS_DEFAULTS.vp_drive_smooth, // 驱动平滑（0.3）
  presenceSpeed: LIULI_SETTINGS_DEFAULTS.vp_presence_speed, // 在场包络速度（50）
  // ── 自动节拍同步（vp_beat_sync 开启时生效）──
  beatSync: LIULI_SETTINGS_DEFAULTS.vp_beat_sync,      // 谱通量触发 + BPM 自适应
  fluxMult: LIULI_SETTINGS_DEFAULTS.vp_flux_mult,      // 谱通量触发阈值（标准差倍数）
}

/** 运行时安全范围（UI 数字框可越界输入，这里兜底防除零/NaN/反向衰减）。 */
function clampVp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
}

function loadVpParams(): void {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (!raw) return
    const s = JSON.parse(raw) as Partial<LiuliSettings>
    const num = (k: keyof LiuliSettings): number | undefined => (typeof s[k] === 'number' ? s[k] as number : undefined)
    const sens = num('vp_sensitivity')
    if (sens !== undefined) vpParams.sensitivity = clampVp(sens, 0.01, 1)
    const gain = num('vp_beat_gain')
    if (gain !== undefined) vpParams.beatGain = clampVp(gain, 0, 10)
    const decay = num('vp_beat_decay')
    if (decay !== undefined) vpParams.beatDecay = clampVp(decay, 0, 0.995)
    const bm = num('vp_beat_mult')
    if (bm !== undefined) vpParams.beatMult = clampVp(bm, 1.01, 10)
    const pm = num('vp_pulse_mult')
    if (pm !== undefined) vpParams.pulseMult = clampVp(pm, 0.1, 5)
    const bw = num('vp_bass_weight')
    const mw = num('vp_mid_weight')
    const hw = num('vp_high_weight')
    if (bw !== undefined || mw !== undefined || hw !== undefined) {
      const w = [
        // oxlint-disable-next-line typescript/no-non-null-assertion -- weights is a fixed 3-band array initialized at setup
        bw !== undefined ? clampVp(bw, 0, 100) : vpParams.weights[0]! * 100,
        // oxlint-disable-next-line typescript/no-non-null-assertion -- weights is a fixed 3-band array initialized at setup
        mw !== undefined ? clampVp(mw, 0, 100) : vpParams.weights[1]! * 100,
        // oxlint-disable-next-line typescript/no-non-null-assertion -- weights is a fixed 3-band array initialized at setup
        hw !== undefined ? clampVp(hw, 0, 100) : vpParams.weights[2]! * 100,
      ]
      // 全零时退回默认权重，避免驱动恒为零
      // oxlint-disable-next-line typescript/no-non-null-assertion -- w is a 3-element tuple built above
      if (w[0]! + w[1]! + w[2]! > 0) vpParams.weights = [w[0]! / 100, w[1]! / 100, w[2]! / 100]
    }
    const bc = num('vp_beat_cooldown')
    if (bc !== undefined) vpParams.beatCooldown = clampVp(bc, 20, 5000)
    const pc = num('vp_pulse_cooldown')
    if (pc !== undefined) vpParams.pulseCooldown = clampVp(pc, 20, 5000)
    const es = num('vp_env_speed')
    if (es !== undefined) {
      const speed = clampVp(es, 0, 100)
      vpParams.envAttack = 0.06 + (speed / 100) * 0.44 // 50 → 0.28 ≈ 原 0.3
      vpParams.envRelease = vpParams.envAttack / 6 // 保持原攻放比例（0.3:0.05）
    }
    const ss = num('vp_spec_smooth')
    if (ss !== undefined) vpParams.specSmooth = clampVp(ss, 0.01, 1)
    const ng = num('vp_noise_gate')
    if (ng !== undefined) vpParams.noiseGate = clampVp(ng, 0, 0.5)
    // ── 视觉/外观 ──
    const ln = num('vp_lines')
    if (ln !== undefined) vpParams.lines = Math.round(clampVp(ln, 8, 48))
    const isp = num('vp_idle_speed')
    if (isp !== undefined) vpParams.idleSpeed = clampVp(isp, 0, 0.05)
    const amp = num('vp_amplitude')
    if (amp !== undefined) vpParams.amplitude = clampVp(amp, 0.2, 2.5)
    const ma = num('vp_main_amp')
    if (ma !== undefined) vpParams.mainAmp = clampVp(ma, 10, 120)
    const gl = num('vp_glow')
    if (gl !== undefined) vpParams.glow = clampVp(gl, 0, 100)
    const la = num('vp_line_alpha')
    if (la !== undefined) vpParams.lineAlpha = clampVp(la, 0, 100)
    const ef = num('vp_edge_fade')
    if (ef !== undefined) vpParams.edgeFade = clampVp(ef, 0.5, 1)
    const be = num('vp_bass_event')
    if (be !== undefined) vpParams.bassEvent = clampVp(be, 0, 3)
    const me = num('vp_mid_event')
    if (me !== undefined) vpParams.midEvent = clampVp(me, 0, 3)
    const he = num('vp_high_event')
    if (he !== undefined) vpParams.highEvent = clampVp(he, 0, 3)
    // ── 检测/响应细节 ──
    const bw2 = num('vp_beat_window')
    if (bw2 !== undefined) vpParams.beatWindow = Math.round(clampVp(bw2, 10, 120))
    const pw = num('vp_pulse_window')
    if (pw !== undefined) vpParams.pulseWindow = Math.round(clampVp(pw, 40, 400))
    const nr = num('vp_noise_rate')
    if (nr !== undefined) vpParams.noiseRate = clampVp(nr, 0.0001, 0.01)
    const ds = num('vp_drive_smooth')
    if (ds !== undefined) vpParams.driveSmooth = clampVp(ds, 0.01, 0.9)
    const ps = num('vp_presence_speed')
    if (ps !== undefined) vpParams.presenceSpeed = clampVp(ps, 0, 100)
    const bsy = s.vp_beat_sync
    if (typeof bsy === 'boolean') vpParams.beatSync = bsy
    const fm = num('vp_flux_mult')
    if (fm !== undefined) vpParams.fluxMult = clampVp(fm, 0.5, 4)
    const en = s.vp_enabled
    if (typeof en === 'boolean') vpParams.enabled = en
  } catch (_) { /* 损坏则保持当前值 */ }
}

/** ── 自动节拍同步（vp_beat_sync = true 时启用）──
 *  谱通量触发：频谱变化量（正向差分和）超过「期望 + fluxMult×标准差」即重音；
 *  BPM 估算：对帧能量环形缓冲做自相关（滞后 250-1090ms 对应 55-240 BPM），
 *  均值窗口 / 冷却 / 脉冲窗口随 ratio = 120/BPM 伸缩（手动值视为 120 BPM 参考）。 */
const ENV_RING_LEN = 512 // 帧能量环形缓冲（~8.5s @60fps，覆盖 55 BPM 的整拍周期）
const BPM_EST_INTERVAL = 12 // 每 12 帧估算一次 BPM（≈5 次/秒）
const FLUX_GATE = 2 // 谱通量下限：单 bin 平均变化 < 2/255 视为噪声，直接不触发

/** 绘制状态（模块级单例，跨组件实例共享）：切换会话/进出会话页时
 *  header 组件卸载重挂载，波形相位/包络/检测器状态保留、无缝延续；
 *  仅停止监听时由 draw 循环按 analyser 为空复位。 */
const vpDraw = {
  idlePhase: 0,
  presence: 0,
  bandEnv: [0, 0, 0] as number[],
  /** 每频段噪声底估计（快降慢升的最小值跟随）：扣除捕获环/系统底噪的恒定成分。 */
  bandNoise: [0, 0, 0] as number[],
  specSmooth: null as Float32Array | null,
  beatAvgQueue: [] as number[],
  pulseAvgQueue: [] as number[],
  lastBeatAt: -1e9,
  lastPulseAt: -1e9,
  punch: 0,
  /** 帧能量噪声底（节拍检测用，同款快降慢升）。 */
  noiseE: 0,
  // ── 自动节拍同步状态（vpParams.beatSync 开启时生效，停止监听时一并复位）──
  frameMs: 1000 / 60, // 帧间隔 EMA（自适应窗口/冷却换算）
  lastFrameAt: 0, // 上一帧时间戳（performance.now()）
  envRing: new Float32Array(ENV_RING_LEN), // 帧能量环形缓冲（BPM 自相关输入）
  envIdx: 0, // 环形缓冲写指针
  envFilled: 0, // 已写入帧数（< ENV_RING_LEN 时不足以估算）
  bpmSmoothed: 0, // BPM 平滑估计（0 = 未锁定，ratio=1）
  estTick: 0, // 估算节流计数
  fluxQueue: [] as number[], // 谱通量历史（自适应阈值窗口）
  fluxPrevSpec: null as Float32Array | null, // 上一帧频谱（谱通量差分）
  fluxNoise: 0, // 谱通量噪声底（同款快降慢升最小值跟随）
}

/** BPM 估算（帧能量环形缓冲自相关）：滞后 250ms-1090ms 对应 55-240 BPM；
 *  减均值后归一化相关，最佳滞后相关 > 0.25 才接受（否则朝 120 衰减，ratio→1），
 *  结果 EMA 平滑（0.15）写回 vpDraw.bpmSmoothed（0 = 未锁定）。 */
function updateBpmEstimate(): void {
  const d = vpDraw
  if (d.envFilled < Math.ceil(ENV_RING_LEN * 0.25)) return // 数据不足（<~2s）
  const n = Math.min(d.envFilled, ENV_RING_LEN)
  const at = (i: number): number => d.envRing[(d.envIdx - n + i + ENV_RING_LEN) % ENV_RING_LEN] ?? 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += at(i)
  const mean = sum / n
  const frameS = d.frameMs / 1000
  const lo = Math.max(1, Math.round(0.25 / frameS))
  const hi = Math.min(n - 1, Math.round(1.09 / frameS))
  let bestLag = -1
  let bestCorr = 0
  for (let lag = lo; lag <= hi; lag++) {
    const n2 = n - lag
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
    for (let i = 0; i < n2; i++) {
      const a = at(i) - mean
      const b = at(lag + i) - mean
      sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b
    }
    const va = Math.max(0, saa - (sa * sa) / n2)
    const vb = Math.max(0, sbb - (sb * sb) / n2)
    const denom = Math.sqrt(va * vb)
    if (denom <= 1e-9) continue
    const corr = (sab - (sa * sb) / n2) / denom
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }
  if (bestLag <= 0) return
  const bpm = 60 / (bestLag * frameS) // frameS 秒 → 每拍秒数 → BPM
  if (bestCorr > 0.25 && bpm >= 55 && bpm <= 240) {
    const prev = d.bpmSmoothed
    d.bpmSmoothed = prev > 0 ? prev + (bpm - prev) * 0.15 : bpm
  } else {
    // 无稳定节奏 → 衰减回 120：所有手动窗口/冷却语义回到「120 BPM 参考」
    d.bpmSmoothed = Math.max(0, d.bpmSmoothed + (120 - d.bpmSmoothed) * 0.02)
  }
}

/** 连续响应：Nanoleaf 风格三频段能量驱动 —— bass/mid/high 各自攻击/释放包络，
 *  按参考响度归一（保留响度动态），加权求和为连续 drive；
 *  频段权重/攻放/参考响度/静音门限/频谱平滑等均为设置页可调参数（vpParams）。 */
const BAND_EDGES = [[0, 3], [4, 15], [16, 63]] as const // 128-bin FFT 分段
/** ── 官方 Nanoleaf Desktop 检测参数（从 Desktop 主进程 bundle 还原，原样移植）──
 *  节拍（能量包络对比）：E=Σx² vs 15 块滑动平均（块≈46ms → 0.7s ≈ 42 帧@60fps），
 *    超过 min(1.5×均值, 均值+Δ) + 200ms 冷却（防连击）+ 平均能量门槛；
 *  低频脉冲（50-350Hz）：频段能量 vs 0.8×60 块均值（≈2.8s ≈ 170 帧）+ 220ms 冷却；
 *  两级强度（RhythmicNorthernLights 官方示例）：节拍 100%、脉冲 30%。
 *  均值窗口（42/170 帧）与噪声学习率等已开放为设置页参数（vpParams）；
 *  自动节拍同步（vpParams.beatSync）开启时用谱通量触发替代能量包络对比，
 *  窗口/冷却按 ratio=120/BPM 伸缩（BPM 由帧能量自相关实时估算），见 vpDraw 上方常量。 */
const BEAT_ADD = 0.02 // 官方 +10（大尺度能量域）；归一化域等效值
const BEAT_MEAN_GATE = 0.002 // 平均能量门槛（官方 beatPowerThreshold 的"非静音"门）
const PULSE_FLOOR = 1
/** 用户可调参数见 vpParams（设置页「界面」→「声纹响应」，liuli:vp-params 事件热载）。 */

/* ── 模块级单例引擎 ─────────────────────────────────────────────── */

interface VpState {
  /** 总开关：由 vpParams.enabled 同步，关闭时停止捕获并隐藏监听入口。 */
  enabled: boolean
  listening: boolean
  /** 捕获来源：system（屏幕共享 · 系统扬声器输出）。不降级麦克风。 */
  mode: 'system' | null
  error: string
  analyser: AnalyserNode | null
  audioCtx: AudioContext | null
  source: MediaStreamAudioSourceNode | null
  stream: MediaStream | null
  freqBuf: Uint8Array<ArrayBuffer> | null
  audioMix: number
}

const vpState: VpState = {
  enabled: true,
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

/** 同步总开关到运行时：关闭时若正在监听则立即停止（参数保留，重新开启即恢复）。 */
function syncVpEnabled(): void {
  vpState.enabled = vpParams.enabled
  if (!vpParams.enabled && vpState.listening) {
    vpStopCapture()
    vpState.listening = false
    vpState.mode = null
  }
}

// 模块级初始化：先载入设置再同步开关；之后每次设置保存都经 liuli:vp-params 重载并广播。
if (typeof window !== 'undefined') {
  loadVpParams()
  syncVpEnabled()
  window.addEventListener('liuli:vp-params', () => {
    loadVpParams()
    syncVpEnabled()
    vpEmit()
  })
}

async function vpToggle(): Promise<void> {
  console.info('[liuli] voiceprint toggle', vpState.listening ? 'stop' : 'start')
  if (vpState.listening) {
    vpStopCapture()
    vpState.listening = false
    vpState.mode = null
    vpEmit()
    return
  }
  vpState.error = ''
  vpEmit()
  /** DSH Desktop（Electron）经宿主 /liuli-audio 提供系统回环音频能力：主进程
   *  setDisplayMediaRequestHandler 直接授予 audio:'loopback'（无选择器）；纯 Web
   *  部署返回 available:false，继续走浏览器屏幕共享流程。 */
  let desktopLoopback = false
  try {
    const probe = await fetch('/liuli-audio', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    if (probe.ok) {
      const body = await probe.json() as { available?: unknown }
      desktopLoopback = body.available === true
    }
  } catch { /* 探测失败按纯 Web 处理 */ }
  /** 启动分析器（共用引擎）；成功返回 true。 */
  const startAnalyser = (stream: MediaStream): boolean => {
    const audioTrack = stream.getAudioTracks()[0]
    if (audioTrack === undefined) {
      stream.getTracks().forEach(tr => tr.stop())
      return false
    }
    const audioCtx = new AudioContext()
    // 自动播放策略可能让 AudioContext 以 suspended 起步（频谱全零、波形不动，
    // 表现为"点击没反应"），此处尽力恢复。
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => { /* 恢复失败则按空闲态绘制 */ })
    }
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
    vpState.audioCtx = audioCtx
    vpState.analyser = analyser
    vpState.source = source
    vpState.stream = stream
    vpState.mode = 'system'
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
      vpState.error = '系统音频监听需要安全上下文：请用 https:// 或 http://localhost/127.0.0.1 访问本页面（当前 ' + window.location.protocol + '//' + window.location.host + '）'
    } else {
      vpState.error = '当前浏览器不支持音频捕获（mediaDevices 不可用）'
    }
    vpEmit()
    return
  }

  // 系统音频：仅经 getDisplayMedia 捕获扬声器输出，不降级麦克风。
  // 在共享选择器中分享「整个屏幕」并勾选「分享系统音频」，即可监听到
  // 系统正在播放的声音（音乐/视频等），而非麦克风输入。
  // 注：不设置 suppressLocalAudioPlayback —— 实测该约束会把系统主音量静音
  // （疑似其实现直接置零输出音量）；捕获环噪音由检测侧噪声底扣除压制。
  /** 最后一次 getDisplayMedia 失败的 DOMException name（兜底诊断用）。 */
  let captureError: string | undefined
  if (typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true })
      } catch (err) {
        const name = (err as DOMException | undefined)?.name
        if (name !== 'NotSupportedError' && name !== 'TypeError') throw err
        // 部分浏览器不接受纯音频共享（仅系统音频捕获的兼容性回退）：
        // 共享视频轨后立即丢弃，仍只监听系统音频。授权拒绝不会走到这里。
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        stream.getVideoTracks().forEach(t => t.stop())
      }
      if (startAnalyser(stream)) return
      // 未勾选「分享系统音频」时流中没有音频轨道 → 明确提示，不静默降级。
      vpState.error = '未捕获到系统音频：请共享「整个屏幕」并勾选「分享系统音频」后重试'
      vpEmit()
      return
    } catch (err) {
      const name = (err as DOMException | undefined)?.name
      captureError = name
      // 保留真实失败原因：兜底文案只显示统一诊断，具体 DOMException 打进 console
      // （重启后可用 demo/dsh-main.mjs console 抓取，区分 NotReadableError/TypeError 等）。
      console.warn('[liuli] voiceprint getDisplayMedia failed', name, err)
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        vpState.error = desktopLoopback
          ? '系统音频监听不可用：DSH Desktop 未启用系统音频捕获（请确认已安装最新版琉璃主题并重启应用）'
          : '系统音频监听需要授权：' + (name === 'NotAllowedError' ? '已拒绝屏幕共享' : '浏览器策略限制')
        vpEmit()
        return
      }
      // 其他失败（设备不可用等）→ 统一诊断
    }
  }

  vpState.error = desktopLoopback
    ? '系统音频监听不可用：DSH Desktop 未启用系统音频捕获（' + (captureError ?? '未知错误') + '，请重启应用后重试）'
    : '系统音频监听不可用：请用 Chrome/Edge 访问本页面（当前 ' + window.location.protocol + '//' + window.location.host + '）并允许屏幕共享'
  vpEmit()
}

/* ── 绘制工具（与 liuli_echo Waveform 同曲线） ─────────────────── */

type RGB = [number, number, number]

/** 品牌色缓存：按主题（data-ds-dark-theme）缓存解析结果，避免每帧 getComputedStyle。 */
let brandCache: { theme: string; rgb: RGB } | null = null

// 品牌色变化（换壁纸/取色模式/品牌色调整）时 liuliApplyBrand 会广播
// liuli:brand-changed；brandCache 只按主题失效，这里显式清空让声纹 canvas
// 下一帧重新读 --dsw-alias-brand-primary，否则换壁纸后波形颜色不跟随刷新。
if (typeof window !== 'undefined') {
  window.addEventListener('liuli:brand-changed', () => { brandCache = null })
}

/** 品牌色缓存读取（--dsw-alias-brand-primary），主题切换后失效。 */
function brandRGB(): RGB {
  const theme = document.body.getAttribute('data-ds-dark-theme') ?? ''
  if (brandCache !== null && brandCache.theme === theme) return brandCache.rgb
  const v = getComputedStyle(document.body)
    .getPropertyValue('--dsw-alias-brand-primary').trim() || '#8ecdf8'
  const m = v.match(/^#?([0-9a-f]{6})$/i)
  let rgb: RGB
  if (m !== null) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the match succeeded, so the single capture group exists
    const n = parseInt(m[1]!, 16)
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  } else {
    rgb = [142, 205, 248]
  }
  brandCache = { theme, rgb }
  return rgb
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

/* 琉璃 ECG 式水平渐变：波形在绘制层面淡出 —— 左端透明快速浮现、
   主段全亮；右端从 `fade` 处（默认 80%）开始渐隐（覆盖工具区至 session
   log 按钮宽度），到右缘完全消失（alpha 0）。fade 由设置 vp.edgeFade 控制。 */
function edgeGradient(ctx: CanvasRenderingContext2D, w: number, C: RGB, alpha: number, fade = 0.8): CanvasGradient {
  const lg = ctx.createLinearGradient(0, 0, w, 0)
  lg.addColorStop(0, rgba(C, 0))
  lg.addColorStop(0.12, rgba(C, alpha * 0.4))
  lg.addColorStop(fade, rgba(C, alpha))
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
export function LiuliHeaderVoiceprint() {
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

    // 绘制状态全部在模块级 vpDraw 单例（切换会话组件卸载不重置，波形无缝延续）。

    const draw = (): void => {
      ctx.clearRect(0, 0, w, h)
      // 总开关关闭：不绘制波形（canvas 保持透明，监听循环随之复位）。
      if (!vpParams.enabled) return
      const C = brandRGB()
      const dark = document.body.hasAttribute('data-ds-dark-theme')
      ctx.shadowBlur = 0

      const binCount = vpState.analyser !== null ? vpState.analyser.frequencyBinCount : 128
      if (vpState.freqBuf === null || vpState.freqBuf.length !== binCount) vpState.freqBuf = new Uint8Array(binCount)
      if (vpState.analyser !== null) vpState.analyser.getByteFrequencyData(vpState.freqBuf)
      const freqData = vpState.freqBuf

      // 平滑频谱（供绘制纹理采样，消除线条抖动）；未监听时清零
      if (vpDraw.specSmooth === null || vpDraw.specSmooth.length !== freqData.length) vpDraw.specSmooth = new Float32Array(freqData.length)
      if (vpState.analyser !== null) {
        for (let i = 0; i < freqData.length; i++) {
          const raw = freqData[i] ?? 0
          // oxlint-disable-next-line typescript/no-non-null-assertion -- specSmooth is sized to freqData above; i stays in bounds
          vpDraw.specSmooth[i] = vpDraw.specSmooth[i]! + (raw - vpDraw.specSmooth[i]!) * vpParams.specSmooth
        }
      } else {
        vpDraw.specSmooth.fill(0)
      }

      // 连续响应（Nanoleaf 风格）：三频段能量 → 攻击/释放包络 →
      // 参考响度归一 → 加权求和；未监听时复位状态、驱动归零（不读陈旧频谱）。
      let drive = 0
      if (vpState.analyser !== null) {
        for (let b = 0; b < BAND_EDGES.length; b++) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- b iterates BAND_EDGES.length
          const [from, to] = BAND_EDGES[b]!
          const n = Math.min(to, freqData.length - 1) - from + 1
          let sum = 0
          for (let i = from; i <= to && i < freqData.length; i++) sum += freqData[i] ?? 0
          const raw = n > 0 ? sum / (n * 255) : 0
          // 噪声底扣除：快降（紧跟最小值）慢升（约 30s 时间常数）——
          // 恒定的回放环/系统底噪被压掉，音乐的真实起伏保留。
          const nz = vpDraw.bandNoise[b] ?? 0
          if (raw < nz) vpDraw.bandNoise[b] = raw
          else vpDraw.bandNoise[b] = nz + (raw - nz) * vpParams.noiseRate
          const clean = Math.max(0, raw - (vpDraw.bandNoise[b] ?? 0))
          // oxlint-disable-next-line typescript/no-non-null-assertion -- bandEnv is a fixed 3-band array; b < 3
          vpDraw.bandEnv[b]! += (clean - vpDraw.bandEnv[b]!) * (clean > vpDraw.bandEnv[b]! ? vpParams.envAttack : vpParams.envRelease)
          // oxlint-disable-next-line typescript/no-non-null-assertion -- bandEnv is a fixed 3-band array; b < 3
          const v = vpDraw.bandEnv[b]! < vpParams.noiseGate ? 0 : Math.min(1, vpDraw.bandEnv[b]! / vpParams.sensitivity)
          // oxlint-disable-next-line typescript/no-non-null-assertion -- weights is a fixed 3-band array; b < 3
          drive += vpParams.weights[b]! * v
        }
        drive = Math.min(1, drive)
      } else {
        vpDraw.bandEnv[0] = 0
        vpDraw.bandEnv[1] = 0
        vpDraw.bandEnv[2] = 0
        vpDraw.bandNoise[0] = 0
        vpDraw.bandNoise[1] = 0
        vpDraw.bandNoise[2] = 0
        vpDraw.noiseE = 0
      }

      // 连续 mix：跟随 drive 平滑（快升慢落由频段包络自身承担）
      vpState.audioMix += (drive - vpState.audioMix) * vpParams.driveSmooth

      // ── 节拍/脉冲检测 ──
      //  vpParams.beatSync=true（默认）→ 自动节拍同步：
      //    谱通量触发（频谱正向变化和 > 期望 + fluxMult×标准差）+ 实时 BPM 估算
      //    （帧能量自相关），均值窗口/冷却随 ratio = 120/BPM 伸缩，
      //    手动窗口/冷却值语义为「120 BPM 参考」；
      //  vpParams.beatSync=false → 官方 Nanoleaf 能量包络对比原样保留。
      if (vpState.analyser !== null) {
        const now = performance.now()
        // 帧间隔 EMA（dt 夹 1..1000ms）：窗口/冷却按真实帧率换算
        if (vpDraw.lastFrameAt > 0) {
          const dt = Math.min(1000, Math.max(1, now - vpDraw.lastFrameAt))
          vpDraw.frameMs = vpDraw.frameMs * 0.9 + dt * 0.1
        }
        vpDraw.lastFrameAt = now
        // 帧能量 E = Σ(bin/255)²（对应官方 ei=Σx²）；扣除噪声底后用于节拍判断
        let rawE = 0
        for (let i = 0; i < freqData.length; i++) {
          const v = (freqData[i] ?? 0) / 255
          rawE += v * v
        }
        if (rawE < vpDraw.noiseE) vpDraw.noiseE = rawE
        else vpDraw.noiseE += (rawE - vpDraw.noiseE) * vpParams.noiseRate
        const E = Math.max(0, rawE - vpDraw.noiseE)
        // BPM 估算：E 入环形缓冲，每 BPM_EST_INTERVAL 帧自相关一次
        vpDraw.envRing[vpDraw.envIdx] = E
        vpDraw.envIdx = (vpDraw.envIdx + 1) % ENV_RING_LEN
        if (vpDraw.envFilled < ENV_RING_LEN) vpDraw.envFilled++
        vpDraw.estTick++
        if (vpDraw.estTick >= BPM_EST_INTERVAL) {
          vpDraw.estTick = 0
          updateBpmEstimate()
        }
        let isBeat = false
        let isPulse = false
        if (vpParams.beatSync) {
          // ── 自动节拍同步：谱通量触发 + BPM 自适应窗口/冷却 ──
          // 谱通量 = 本帧 vs 上一帧平滑频谱的正向差分和（复用 specSmooth）
          const spec = vpDraw.specSmooth
          if (vpDraw.fluxPrevSpec === null || vpDraw.fluxPrevSpec.length !== spec.length) {
            vpDraw.fluxPrevSpec = new Float32Array(spec.length)
          }
          const prev = vpDraw.fluxPrevSpec
          let flux = 0
          for (let i = 0; i < spec.length; i++) {
            const s = spec[i] ?? 0
            const d = s - (prev[i] ?? 0)
            if (d > 0) flux += d
            prev[i] = s
          }
          // 谱通量噪声底（快降慢升，同帧能量噪声底同款）
          if (flux < vpDraw.fluxNoise) vpDraw.fluxNoise = flux
          else vpDraw.fluxNoise += (flux - vpDraw.fluxNoise) * vpParams.noiseRate
          const fluxClean = Math.max(0, flux - vpDraw.fluxNoise)
          // ratio = 120/BPM：未锁定（bpmSmoothed=0）时为 1 → 手动值即 120 BPM 参考
          const ratio = vpDraw.bpmSmoothed > 0 ? 120 / vpDraw.bpmSmoothed : 1
          // 自适应窗口/冷却：以手动参数为基准随节拍周期伸缩（限幅防极端）
          const fluxWin = Math.round(clampVp(vpParams.beatWindow * ratio, 10, 120))
          const beatCd = clampVp(vpParams.beatCooldown * ratio, 30, 2000)
          const pulseWin = Math.round(clampVp(vpParams.pulseWindow * ratio, 40, 400))
          const pulseCd = clampVp(vpParams.pulseCooldown * ratio, 30, 2000)
          // 谱通量自适应阈值：期望 + fluxMult×标准差（窗口内），下限门防误触发
          vpDraw.fluxQueue.push(fluxClean)
          if (vpDraw.fluxQueue.length > fluxWin) vpDraw.fluxQueue.shift()
          let fm = 0, fv = 0
          for (const f of vpDraw.fluxQueue) { fm += f; fv += f * f }
          const fqLen = vpDraw.fluxQueue.length
          if (fqLen > 0) {
            fm /= fqLen
            fv = Math.max(0, fv / fqLen - fm * fm)
          }
          const fluxMean = fm
          const fluxStd = Math.sqrt(fv)
          const fluxGate = FLUX_GATE * spec.length
          // 低频脉冲（50-350Hz ≈ bins 0-1）：超 0.8×均值 && 下限 && 冷却（窗口自适应）
          const pulseE = ((freqData[0] ?? 0) + (freqData[1] ?? 0)) / 2
          vpDraw.pulseAvgQueue.push(pulseE)
          if (vpDraw.pulseAvgQueue.length > pulseWin) vpDraw.pulseAvgQueue.shift()
          let pulseAvg = 0
          for (const v of vpDraw.pulseAvgQueue) pulseAvg += v
          pulseAvg /= vpDraw.pulseAvgQueue.length
          isPulse = pulseE > PULSE_FLOOR
            && pulseE > vpParams.pulseMult * pulseAvg
            && now - vpDraw.lastPulseAt > pulseCd
          if (isPulse) vpDraw.lastPulseAt = now
          // 节拍：平均能量门槛 && 谱通量超阈值 && 冷却
          isBeat = E > BEAT_MEAN_GATE * freqData.length
            && fluxClean > Math.max(fluxMean + vpParams.fluxMult * fluxStd, fluxGate)
            && now - vpDraw.lastBeatAt > beatCd
          if (isBeat) vpDraw.lastBeatAt = now
        } else {
          // ── 官方能量包络路径（原样保留）──
          vpDraw.beatAvgQueue.push(E)
          if (vpDraw.beatAvgQueue.length > vpParams.beatWindow) vpDraw.beatAvgQueue.shift()
          let beatAvg = 0
          for (const v of vpDraw.beatAvgQueue) beatAvg += v
          beatAvg /= vpDraw.beatAvgQueue.length
          // 节拍：能量超均值 50%（或 +Δ）&& 平均能量门槛 && 冷却
          isBeat = E > BEAT_MEAN_GATE * freqData.length
            && E > Math.min(vpParams.beatMult * beatAvg, beatAvg + BEAT_ADD)
            && now - vpDraw.lastBeatAt > vpParams.beatCooldown
          if (isBeat) vpDraw.lastBeatAt = now
          // 低频脉冲（50-350Hz ≈ bins 0-1）：超 0.8×均值 && 下限 && 220ms 冷却
          const pulseE = ((freqData[0] ?? 0) + (freqData[1] ?? 0)) / 2
          vpDraw.pulseAvgQueue.push(pulseE)
          if (vpDraw.pulseAvgQueue.length > vpParams.pulseWindow) vpDraw.pulseAvgQueue.shift()
          let pulseAvg = 0
          for (const v of vpDraw.pulseAvgQueue) pulseAvg += v
          pulseAvg /= vpDraw.pulseAvgQueue.length
          isPulse = pulseE > PULSE_FLOOR
            && pulseE > vpParams.pulseMult * pulseAvg
            && now - vpDraw.lastPulseAt > vpParams.pulseCooldown
          if (isPulse) vpDraw.lastPulseAt = now
        }
        // 两级强度（官方）：节拍 100%、脉冲 30%，其余指数衰减
        if (isBeat) vpDraw.punch = 1
        else if (isPulse) vpDraw.punch = Math.max(vpDraw.punch, 0.3)
        else vpDraw.punch *= vpParams.beatDecay
      } else {
        // 停止监听：复位检测器与自动节拍同步状态（包括新增的动态范围追踪）
        vpDraw.beatAvgQueue.length = 0
        vpDraw.pulseAvgQueue.length = 0
        vpDraw.lastBeatAt = -1e9
        vpDraw.lastPulseAt = -1e9
        vpDraw.fluxQueue.length = 0
        vpDraw.frameMs = 1000 / 60
        vpDraw.lastFrameAt = 0
        vpDraw.envFilled = 0
        vpDraw.envIdx = 0
        vpDraw.bpmSmoothed = 0
        vpDraw.estTick = 0
        vpDraw.fluxPrevSpec = null
        vpDraw.fluxNoise = 0
        vpDraw.punch *= vpParams.beatDecay
      }

      // liuli_echo 式「音频在场」包络：进入响应（有信号）时快升，空闲时匀速归零，
      // 驱动空闲态幅度压制。攻速/衰减由 vpParams.presenceSpeed（0-100）映射：
      // attack = 0.005 + speed/100×0.06（50 → 0.035 ≈ 原参数），decay = attack/21（50 → 1/600）。
      const presenceAttack = 0.005 + (vpParams.presenceSpeed / 100) * 0.06
      const presenceDecay = presenceAttack / 21
      const hasSignal = vpState.analyser !== null && freqData.some(v => v > 12)
      if (hasSignal) vpDraw.presence += (1 - vpDraw.presence) * presenceAttack
      else {
        vpDraw.presence -= presenceDecay
        if (vpDraw.presence < 0) vpDraw.presence = 0
      }

      drawWave(freqData, C, dark)
    }

    /* 流动波形（空闲态 ↔ 响应态平滑过渡；绘制公式逐字参照 liuli_echo
       Waveform：vpParams.lines（默认 22）条线 + 逐线 binVal 频谱纹理
       + 三正弦主波（线条数与各视觉强度均可由 vp.* 参数调节）。
       空闲态幅度压制由 liuli_echo 式 presence 包络驱动（进入响应即压低
       空闲流动，×0.8 系数原样）；低/中/高频各自产生一种视觉事件叠加在
       整幅波形上（不按线条分组）：
         bass → 冲击：低频能量让波形整体膨胀、线条变粗
         mid  → 流速：旋律能量加快波形流动
         high → 星闪：镲片能量提升线条与主波亮度 */
    const drawWave = (freqData: Uint8Array, C: RGB, dark: boolean): void => {
      const lineC = dark ? lighten(C, 0.35) : C
      const cy = h / 2
      const lines = vpParams.lines
      const mix = vpState.audioMix

      // 振幅随 header 高度整体线性缩放：外层线与主波共用同一系数，比例不变。
      // 基准 160：在最小 header（52px→0.325）下仍留出约 17% 上下边距，主波 idle
      // 峰值（46 × 0.325 × 1.45 ≈ 21.6）远低于 cy（26），波形更内敛不贴边；
      // h ≥ 160 时 ampScale=1，保持原满幅效果。h 比例项已自适应，不受此缩放。
      const ampScale = Math.min(1, h / 160)

      // 频段驱动（与连续响应同款：参考响度 + 静音门限）
      const bandDrive = (b: number): number => {
        const env = vpDraw.bandEnv[b] ?? 0
        return env < vpParams.noiseGate ? 0 : Math.min(1, env / vpParams.sensitivity)
      }
      const bassDrive = bandDrive(0)
      const midDrive = bandDrive(1)
      const highDrive = bandDrive(2)

      // mid 事件：流速——旋律/人声能量让波形流动加快（强度 ×vpParams.midEvent）
      vpDraw.idlePhase += vpParams.idleSpeed * (1 + vpDraw.presence * 2) * (1 + midDrive * 1.2 * vpParams.midEvent)

      // 外层细线不设 shadowBlur：canvas 高斯模糊是每帧最大开销（同 liuli_echo）；
      // 辉光焦点保留给中央主波。
      ctx.shadowBlur = 0

      for (let li = 0; li < lines; li++) {
        const off = li / lines - 0.5
        const baseY = cy + off * (h * 0.38)

        // 基础振幅（空闲态）：进入响应时按 liuli_echo 的 ×0.8 系数压缩，
        // 为音频驱动振幅腾出空间
        const idleAmp = (14 + (li % 7)) * ampScale * (1 - Math.abs(off) * 1.4) * (1 - vpDraw.presence * 0.8)
        // 音频驱动：逐线取平滑频谱对应 bin 的能量映射为额外振幅
        const tex = vpDraw.specSmooth ?? freqData
        const binIdx = Math.min(tex.length - 1, Math.floor((li / lines) * tex.length))
        // oxlint-disable-next-line typescript/no-non-null-assertion -- binIdx is clamped to tex.length - 1
        const binVal = tex[binIdx]! / 255
        // bass 事件：冲击——低频能量让波形整体膨胀（节拍 punch 为爆发加成），
        // 强度 ×vpParams.bassEvent；vpParams.amplitude 为整体振幅倍率
        const amp = (idleAmp + mix * binVal * h * 0.3 * (1 - Math.abs(off) * 0.6)
          * (1 + vpParams.beatGain * vpDraw.punch + bassDrive * 0.4 * vpParams.bassEvent)) * vpParams.amplitude
        // high 事件：星闪——镲片/高频能量提升线条亮度（强度 ×vpParams.highEvent）；
        // lineAlpha 映射基础/边缘不透明度档位（dark 0.36/0.84，light 0.32/0.64）
        const alpha = (vpParams.lineAlpha / 100) * ((dark ? 0.36 : 0.32) + (1 - Math.abs(off)) * (dark ? 0.84 : 0.64))
          + mix * binVal * 0.2 + highDrive * 0.3 * vpParams.highEvent

        const freq = 0.007 + li * 0.00055

        ctx.beginPath()
        ctx.strokeStyle = edgeGradient(ctx, w, lineC, Math.min(1, alpha), vpParams.edgeFade)
        // bass 事件同时加粗线条（冲击感）
        ctx.lineWidth = 1 + mix * binVal * 0.8 + bassDrive * 0.6 * vpParams.bassEvent
        for (let x = 0; x <= w; x += 3) {
          const n = Math.sin(freq * x + vpDraw.idlePhase + li * 0.75)
            + 0.33 * Math.sin(freq * 2.4 * x + vpDraw.idlePhase * 1.35 + li * 1.15)
          const y = Math.max(1, Math.min(h - 1, baseY + amp * n))
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }

      // 中央主波（辉光焦点，同 liuli_echo 参数；high 事件提升辉光亮度）
      ctx.shadowColor = rgba(lineC, dark ? 0.9 : 0.45)
      // glow（0-100）映射辉光模糊半径：dark = 0.4×glow（50 → 20），light = 0.12×glow（50 → 6）
      ctx.shadowBlur = dark ? 0.4 * vpParams.glow : 0.12 * vpParams.glow
      ctx.beginPath()
      ctx.strokeStyle = edgeGradient(ctx, w, lineC, Math.min(1, (dark ? 1 : 0.7) + highDrive * 0.25 * vpParams.highEvent), vpParams.edgeFade)
      const tex = vpDraw.specSmooth ?? freqData
      const mainBin = Math.floor(tex.length * 0.25)
      // oxlint-disable-next-line typescript/no-non-null-assertion -- mainBin is a quarter of tex.length
      const mainVal = tex[mainBin]! / 255
      ctx.lineWidth = 2 + mix * mainVal * 1.5
      const mainAmp = (vpParams.mainAmp * ampScale * (1 - vpDraw.presence * 0.8) + mix * mainVal * h * 0.2)
        * (1 + vpParams.beatGain * vpDraw.punch) * vpParams.amplitude
      for (let x = 0; x <= w; x += 2) {
        const n = Math.sin(0.0105 * x + vpDraw.idlePhase * 0.58)
          + 0.3 * Math.sin(0.026 * x + vpDraw.idlePhase * 1.08)
          + 0.15 * Math.sin(0.052 * x + vpDraw.idlePhase * 1.85)
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

    // 尺寸变化会重设 canvas 位图尺寸（清空画布），必须同步补一帧，
    // 避免 ResizeObserver 清空后要等下一帧 rAF 才重绘的闪断。
    const onResize = (): void => {
      resize()
      draw()
    }

    resize()
    // 首帧同步绘制：组件在切换会话/进出会话页后会重挂载，canvas 刚创建时
    // 若只交给 rAF 会在下一帧才有内容，造成“空白一帧→看起来像重置/重绘”。
    // 这里基于模块级 vpDraw/vpState 立即恢复当前波形，切换页面不产生闪断。
    draw()
    ro = new ResizeObserver(onResize)
    ro.observe(canvas)
    window.addEventListener('resize', onResize)
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        const nowVisible = entries[0]?.isIntersecting ?? false
        if (nowVisible === visible) return
        visible = nowVisible
        if (visible) {
          draw()
          loop()
        } else {
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
      window.removeEventListener('resize', onResize)
      // 不在此停止捕获：监听状态是模块级单例，切换会话/进出会话页时
      // 本组件卸载再重挂载，不应中断系统音频监听；需要停止时由按钮显式触发。
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

/** 监听按钮：渲染在 titleRow 工具区（主题切换一侧），与背景 canvas 共享引擎。
 *  总开关（vp_enabled）关闭时直接不渲染（连同按钮一起隐藏）。 */
export function LiuliHeaderAudioButton() {
  const { listening, error, enabled } = useSyncExternalStore(vpSubscribe, vpGetState)
  if (!enabled) return null
  return (
    <span className={css.btnWrap} title={listening ? '正在监听系统音量' : '点击监听系统音量'}>
      <button
        type="button"
        className={css.toggle}
        aria-label={listening ? '停止监听系统音量' : '监听系统音量'}
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
 * 主题切换按钮。点击 dispatch `liuli:toggle-theme`（带点击坐标），插件事件桥
 * 经 theme 服务走正式路径（持久化 + presenter），配 startViewTransition 圆形遮罩。
 */
export function LiuliHeaderThemeToggle() {
  const dark = useSyncExternalStore(
    (listener) => {
      const mo = new MutationObserver(listener)
      mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      return () => { mo.disconnect() }
    },
    isDarkNow,
  )

  const toggle = (e: React.MouseEvent<HTMLButtonElement>): void => {
    window.dispatchEvent(new CustomEvent('liuli:toggle-theme', {
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
export function LiuliHeaderChrome() {
  return (
    <>
      <LiuliHeaderAudioButton />
      <LiuliHeaderThemeToggle />
    </>
  )
}

/* ── 全屏切换 ───────────────────────────────────────────────────── */

function isFullscreenNow(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null
}

function toggleFullscreen(): void {
  if (typeof document === 'undefined') return
  if (document.fullscreenElement !== null) {
    void document.exitFullscreen().catch(() => { /* 退出被拒则保持当前状态 */ })
    return
  }
  const el = document.documentElement
  if (typeof el.requestFullscreen === 'function') {
    void el.requestFullscreen().catch(() => { /* 无全屏权限/被拒则保持当前状态 */ })
  }
}

/**
 * 全屏按钮 + F11 快捷键。注入 `conversation.session.header.utilities`，
 * 以最高 order 排在工具区最右端（header 右上角）。图标用 Material
 * fullscreen / fullscreen_exit，随全屏状态切换；F11 拦截浏览器原生
 * 全屏行为统一走 Fullscreen API（纯 Web 与 DSH Desktop 一致）。
 */
export function LiuliHeaderFullscreen() {
  const isFullscreen = useSyncExternalStore(
    (listener) => {
      document.addEventListener('fullscreenchange', listener)
      return () => { document.removeEventListener('fullscreenchange', listener) }
    },
    isFullscreenNow,
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F11') return
      // 拦截浏览器原生 F11 全屏（否则与 Fullscreen API 双触发互相抵消）；
      // 按住连发时只切一次（repeat 事件仅 preventDefault，不重复 toggle）。
      e.preventDefault()
      if (!e.repeat) toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  return (
    <button
      type="button"
      className={css.toggle}
      aria-label={isFullscreen ? '退出全屏' : '进入全屏'}
      aria-pressed={isFullscreen}
      title={isFullscreen ? '退出全屏（F11）' : '进入全屏（F11）'}
      onClick={() => toggleFullscreen()}
    >
      {isFullscreen ? (
        /* Material fullscreen_exit */
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
        </svg>
      ) : (
        /* Material fullscreen */
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
        </svg>
      )}
    </button>
  )
}

/* ── 垂直拉伸手柄 ───────────────────────────────────────────────── */

/** 布局记忆键（localStorage，随浏览器持久化）。 */
export const HEADER_HEIGHT_LS_KEY = 'liuli:header-height'
export const HEADER_MIN_H = 52
export const HEADER_MAX_H = 320
const LS_KEY = HEADER_HEIGHT_LS_KEY
const MIN_H = HEADER_MIN_H
const MAX_H = HEADER_MAX_H

/**
 * 拉伸手柄。注入 `conversation.session.header.utilities`（官方没有 tabs
 * 挂载点），但手柄层经 portal 挂到
 * header 直接子节点：tabs 行是 relative 包含块，absolute bottom 会钉在
 * tabs 底部（header 中部）而非 header 底部 —— 之前拉伸失效的根因。
 * 垂直拖拽改变 header 高度（min-height，内容自然高度为下限，声纹 canvas
 * 随高度铺满）；松开后高度持久化到 localStorage，刷新/切换会话自动恢复。
 */
export function LiuliHeaderResizer() {
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
    // 把 header 实际高度同步到 root 的 --dsh-header-height，
    // 并生成跟随卡片圆角的 SVG mask（--dsh-wallpaper-mask），
    // 让壁纸模糊层只在 header / 正文两张圆角卡片范围内可见。
    // 页头拆成独立 dock 面板后 header 被搬到 region:conversation-header，已不在
    // 正文 [data-phase] 内；closest 会落空导致 mask 永不生成（正文顶部走 fallback
    // 的 12px 透明缝 → “顶上缺一段模糊”）。此时全局回退到正文面板的 phase，只为
    // 正文卡片生成 mask（headerSvg 由 sync 内的 inDockHeaderPanel 置空）。
    let root = header.closest<HTMLElement>('[data-phase]')
    if (root === null && header.closest('[data-region-pane="region:conversation-header"]') !== null) {
      root = document.querySelector<HTMLElement>('[data-region-pane="region:conversation"] div[data-phase]')
    }
    // mask 再生成本身不便宜（getComputedStyle + SVG 字符串 + data-URL 重新解码），
    // 拖拽缩放时 RO 每帧触发 sync：纵向几何（header/模糊层/正文卡高度、阶段）
    // 未变时跳过重建——mask 以 mask-size:100% 100% 拉伸，宽度变化自动适配，
    // 待宽度稳定后再补一次精确重建修正圆角；body 样式变化（圆角/材质设置）
    // 走 force 路径强制重建。
    let lastGeomKey = ''
    let lastMaskWidth = -1
    let maskSettle: ReturnType<typeof setTimeout> | null = null
    const sync = (force = false): void => {
      if (root === null) return
      const headerRect = header.getBoundingClientRect()
      // 页头拆成独立 dock 面板时 header 已不在 root 内：高度变量归零由
      // DockShellFrame 维护，这里不能写 header 高度，否则 TurnRail 会按
      // 错误偏移；mask 也只用正文卡片（headerSvg 置空）。
      const inDockHeaderPanel = header.closest('[data-region-pane="region:conversation-header"]') !== null
      // 先把 header 高度变量写入 —— TurnRail 的 top 依赖它跟随拉伸；
      // 必须在 mask 生成之前写入，即使后续 mask 计算因 root 尺寸为 0
      // 提前返回，高度变量也已落地（rail 拉伸不跟随的历史 bug 即因此）。
      // 仅在变化时写入，避免缩放期每帧 setProperty 触发样式失效。
      const hh = inDockHeaderPanel ? '0px' : `${headerRect.height}px`
      if (root.style.getPropertyValue('--dsh-header-height') !== hh) {
        root.style.setProperty('--dsh-header-height', hh)
      }
      // 模糊层由 liuli-css.ts 的 div[data-phase]::before 承载（inset:0 铺满 root，
      // active 态再 bottom:-16px 下探，覆盖 scrollBody 负 margin 延伸的 16px）；官方
      // DOM 已无 [aria-hidden="true"] 模糊层子元素（phase 下只有 header 槽位 +
      // scrollBody 两个 div），旧 querySelector 落空提前 return，mask 一直走 fallback
      // linear-gradient（无圆角 + 顶部按 --dsh-header-height 硬算），表现为“模糊没跟
      // 卡片一致、正文顶部有缺”。这里改用 root 自身作 mask 坐标参考。
      const rootRect = root.getBoundingClientRect()
      if (rootRect.height <= 0) return
      const overhang = root.dataset.phase === 'active' ? 16 : 0
      const blurRect = {
        left: rootRect.left,
        top: rootRect.top,
        width: rootRect.width,
        height: rootRect.height + overhang,
      }
      const body = root.querySelector<HTMLElement>('[data-conversation-scroll]')
      const bodyRect = body?.getBoundingClientRect()
      const geomKey = `${root.dataset.phase ?? ''}|${headerRect.height}|${blurRect.height}|${bodyRect?.height ?? -1}`
      if (!force && geomKey === lastGeomKey) {
        if (blurRect.width !== lastMaskWidth) {
          lastMaskWidth = blurRect.width
          if (maskSettle !== null) clearTimeout(maskSettle)
          maskSettle = setTimeout(() => { maskSettle = null; sync(true) }, 160)
        }
        return
      }
      lastGeomKey = geomKey
      lastMaskWidth = blurRect.width
      // 非 active 阶段（主页 hero / settling 等）不是 header + scrollBody 双卡，
      // 模糊层应按整个容器走，避免中间留缝和直角。
      if (root.dataset.phase !== 'active') {
        const w = blurRect.width
        const h = blurRect.height
        const radius = Number.parseFloat(getComputedStyle(root).borderTopLeftRadius) || 14
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}"/></svg>`
        root.style.setProperty('--dsh-wallpaper-mask', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
        return
      }
      const w = blurRect.width
      const h = blurRect.height
      const local = (r: DOMRect): { x: number; y: number; width: number; height: number } => ({
        x: r.left - blurRect.left,
        y: r.top - blurRect.top,
        width: r.width,
        height: r.height,
      })
      const headerRadius = Number.parseFloat(getComputedStyle(header).borderTopLeftRadius) || 14
      const headerSvg = !inDockHeaderPanel && headerRect.height > 0
        ? (() => {
          const r = local(headerRect)
          return `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${headerRadius}"/>`
        })()
        : ''
      let bodySvg = ''
      if (bodyRect !== undefined && bodyRect.height > 0) {
        const r = local(bodyRect)
        // oxlint-disable-next-line typescript/no-non-null-assertion -- bodyRect is defined only when body exists
        const bodyStyle = getComputedStyle(body!)
        const topRadius = Number.parseFloat(bodyStyle.borderTopLeftRadius) || 14
        const bottomRadius = Math.max(
          Number.parseFloat(bodyStyle.borderBottomLeftRadius) || 0,
          Number.parseFloat(bodyStyle.borderBottomRightRadius) || 0,
        )
        if (bottomRadius > 0) {
          bodySvg = `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="${topRadius}"/>`
        } else {
          bodySvg = `<path d="M${r.x} ${r.y + topRadius} L${r.x + topRadius} ${r.y} L${r.x + r.width - topRadius} ${r.y} Q${r.x + r.width} ${r.y} ${r.x + r.width} ${r.y + topRadius} L${r.x + r.width} ${r.y + r.height} L${r.x} ${r.y + r.height} Z"/>`
        }
      } else {
        // scrollBody 缺失/高度为 0（收起侧栏等布局重排的中间态）：退化为整卡 mask，
        // 覆盖整个 root 并带圆角，避免生成空 SVG 让壁纸模糊层完全消失（“模糊没了”）。
        const fallbackRadius = Number.parseFloat(getComputedStyle(root).borderTopLeftRadius) || 14
        bodySvg = `<rect x="0" y="0" width="${w}" height="${h}" rx="${fallbackRadius}"/>`
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${headerSvg}${bodySvg}</svg>`
      root.style.setProperty('--dsh-wallpaper-mask', `url("data:image/svg+xml,${encodeURIComponent(svg)}")`)
    }

    // 布局记忆：恢复上次拖拽高度。
    // 页头拆成独立 dock 面板时高度由 dock 布局（sash）控制，不能写内联
    // min-height，否则 header/声纹 canvas 被钉住不跟随面板缩放。
    if (header.closest('[data-region-pane="region:conversation-header"]') !== null) {
      header.style.removeProperty('min-height')
    } else {
      try {
        const saved = Number.parseFloat(localStorage.getItem(LS_KEY) ?? '')
        if (Number.isFinite(saved) && saved >= MIN_H && saved <= MAX_H) {
          header.style.minHeight = saved + 'px'
        }
      } catch (_) { /* 存储不可用则跳过 */ }
    }
    sync()
    const headerObserver = new ResizeObserver(() => sync())
    headerObserver.observe(header)
    const rootObserver = root !== null ? new ResizeObserver(() => sync()) : null
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the ternary above proves root exists
    rootObserver?.observe(root!)
    const scrollBody = root?.querySelector<HTMLElement>('[data-conversation-scroll]') ?? null
    const scrollBodyObserver = scrollBody !== null ? new ResizeObserver(() => sync()) : null
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the ternary above proves scrollBody exists
    scrollBodyObserver?.observe(scrollBody!)
    // 圆角/材质等设置会写 body 内联变量，变化时强制重新生成 mask。
    const bodyObserver = new MutationObserver(() => sync(true))
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] })

    let drag: { startY: number; startH: number } | null = null
    const onMove = (e: PointerEvent): void => {
      if (drag === null) return
      // 独立 dock 面板模式下手柄已隐藏；这里再兜底一次，避免旧逻辑改内联 min-height。
      if (header.closest('[data-region-pane="region:conversation-header"]') !== null) return
      const h = Math.max(MIN_H, Math.min(MAX_H, drag.startH + (e.clientY - drag.startY)))
      header.style.minHeight = h + 'px'
      // 页头独立 dock 面板模式：面板高度由 dock 布局控制，把拖拽高度广播给
      // DockShellFrame 实时调整 v split 比例；普通模式下无监听器，零开销。
      window.dispatchEvent(new CustomEvent('liuli:header-resize-drag', { detail: { height: h } }))
      sync()
    }
    const onUp = (e: PointerEvent): void => {
      if (drag === null) return
      drag = null
      const h = Number.parseFloat(header.style.minHeight)
      // 存纯数字（恢复端 parseFloat，避免 "145px" 被 Number() 解析为 NaN）
      try { localStorage.setItem(LS_KEY, String(Number.isFinite(h) ? h : '')) } catch (_) {}
      window.dispatchEvent(new CustomEvent('liuli:header-resize-end', { detail: { height: h } }))
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
      if (maskSettle !== null) clearTimeout(maskSettle)
      maskSettle = null
      headerObserver.disconnect()
      rootObserver?.disconnect()
      scrollBodyObserver?.disconnect()
      bodyObserver.disconnect()
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