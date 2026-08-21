/** 琉璃 运行时：把界面设置应用到 DOM（品牌取色/壁纸/材质/字体/圆角/泛光阴影）。 */

/* applyLiuliSettings 竞态保护：async 链（壁纸取色 await）与主题切换/滑条
   高频写入并发时，只有最后一次调用允许落地 —— 旧调用捕获的 isDark 与最新
   主题不一致时会整份覆盖调色板（界面变暗/变亮错配）。令牌在 await 之后、
   任何 DOM 写入之前校验，被淘汰的调用不写任何变量。 */
let liuliApplySeq = 0

/** 当前壁纸图片的原始宽高比，用于窗口尺寸变化时保持裁切不拉伸。 */
let currentImageRatio: number | null = null
/** currentImageRatio 对应的壁纸 src：更换壁纸后必须重算比例，否则选区归一化会错位。 */
let currentImageSrc: string | null = null

import { hexFromArgb, sourceColorFromImage } from '../vendor/material-color-utilities.js'
import {
  LIULI_DEFAULT_SOURCE, liuliApplyBrand, liuliDerivePalette,
} from './liuli-palette.ts'
import { LIULI_SETTINGS_DEFAULTS, type LiuliBgArea, type LiuliBgFit, type LiuliSettings } from '../liuli-settings.ts'

/** 壁纸持久化键（localStorage，dataURL）。 */
const WALLPAPER_KEY = 'liuli:wallpaper'
/** 壁纸大小上限（dataURL 长度）。 */
export const WALLPAPER_MAX_LENGTH = 3.5 * 1024 * 1024

export function loadWallpaper(): string | null {
  try {
    const raw = localStorage.getItem(WALLPAPER_KEY)
    return raw && raw.length > 0 ? raw : null
  } catch (_) { return null }
}

export function saveWallpaper(dataUrl: string): void {
  try { localStorage.setItem(WALLPAPER_KEY, dataUrl) } catch (_) {}
}

export function clearWallpaper(): void {
  try { localStorage.removeItem(WALLPAPER_KEY) } catch (_) {}
}

export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/**
 * 压缩图片为 JPEG dataURL：长边限制 + 质量档位，让本地存储能容纳照片级图片。
 * 透明图会以白色底合成（壁纸场景可接受）。
 */
export async function compressImage(file: File, maxDim = 1920, quality = 0.85): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('图片解码失败'))
      i.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (ctx === null) throw new Error('canvas 不可用')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    let dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length > WALLPAPER_MAX_LENGTH) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.6)
    }
    if (dataUrl.length > WALLPAPER_MAX_LENGTH) {
      throw new Error('图片过大（压缩后仍超过存储上限）')
    }
    return dataUrl
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 加载一张图片（跨域放行）。 */
export function loadImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('背景图加载失败'))
    img.src = imageSrc
  })
}

/** 从 RGB 拼 hex。 */
function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** 计算颜色的彩度（chroma = max - min），用于避开 MCU 可能选出的中性色。 */
function chromaOfHex(hex: string): number {
  const h = hex.replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(h)) return 0
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/** 从 64x64 缩略图里挑一个“最鲜艳且不太暗/太亮”的颜色，作为动态取色源。 */
function chromaticSourceFromCanvas(c: CanvasRenderingContext2D): string {
  const data = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data
  let best = { r: 29, g: 155, b: 240, score: -1 }
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const a = data[i + 3] ?? 0
    if (a < 128) continue
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const l = (max + min) / 2
    if (l < 35 || l > 220) continue
    const score = chroma - Math.abs(l - 128) * 0.4
    if (score > best.score) best = { r, g, b, score }
  }
  return rgbToHex(best.r, best.g, best.b)
}

/** 动态取色结果缓存：同一张壁纸只提取一次源色，避免主题切换/重复 apply 时反复解码图片。 */
const dynamicSourceCache = new Map<string, Promise<string>>()

/**
 * 从背景图提取 Material 源色 —— 照搬原项目逻辑：
 * 1. 缩小到 64x64（避免全分辨率量化卡顿）
 * 2. sourceColorFromImage 是 async（MCU 0.4），必须 await 它的 ARGB 结果
 * 3. 如果 MCU 给出的源色太中性，则改用缩略图里最鲜艳的颜色；两者都太灰时回退默认蓝。
 * 结果按壁纸 src 缓存，主题切换时不再重复解码/取色。
 */
export function dynamicSourceFromImage(imageSrc: string): Promise<string> {
  const cached = dynamicSourceCache.get(imageSrc)
  if (cached !== undefined) return cached
  const promise = extractDynamicSource(imageSrc)
  dynamicSourceCache.set(imageSrc, promise)
  promise.catch(() => {
    if (dynamicSourceCache.get(imageSrc) === promise) dynamicSourceCache.delete(imageSrc)
  })
  return promise
}

async function extractDynamicSource(imageSrc: string): Promise<string> {
  const img = await loadImage(imageSrc)
  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
    currentImageRatio = img.naturalWidth / img.naturalHeight
    currentImageSrc = imageSrc
  }
  const size = 64
  const cvs = document.createElement('canvas')
  cvs.width = size
  cvs.height = size
  const c = cvs.getContext('2d')
  if (c === null) throw new Error('canvas 不可用')
  c.drawImage(img, 0, 0, size, size)
  const small = new Image()
  small.src = cvs.toDataURL('image/png')
  await new Promise<void>((res, rej) => {
    small.onload = () => res()
    small.onerror = () => rej(new Error('取色图生成失败'))
  })
  const srcArgb = await sourceColorFromImage(small)
  const mcuHex = hexFromArgb(srcArgb)
  const chromaticHex = chromaticSourceFromCanvas(c)
  const source = chromaOfHex(chromaticHex) > chromaOfHex(mcuHex) + 10 ? chromaticHex : mcuHex
  return chromaOfHex(source) >= 24 ? source : LIULI_DEFAULT_SOURCE
}

/** 当前是否暗色（presenter 写在 body 上）。 */
export function currentIsDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

/**
 * 壁纸承载层（原项目 #bg-layer 架构）：fixed 全屏层挂在 body 下，
 * 壁纸与 scrim 在这里渲染。壁纸原图保持清晰，磨砂由各半透明表面的
 * backdrop-filter 承担：对话页壁纸磨砂在 ConversationRoot 的
 * .wallpaperBlur 独立背景层上（与 composer 卡互不为祖先，两层磨砂
 * 才能同时工作）；侧栏/输入卡等表面直接使用 --liuli-material-blur。
 * 放在 body 直下而非任何列内，天然避开 fixed 后代包含块陷阱。
 */
let bgLayerEl: HTMLDivElement | null = null
function ensureBgLayer(): HTMLDivElement {
  if (bgLayerEl !== null && document.body.contains(bgLayerEl)) return bgLayerEl
  const div = document.createElement('div')
  div.dataset.liuliBg = ''
  div.style.cssText =
    'position:fixed;inset:0;z-index:-1;background-size:cover;background-position:center;background-repeat:no-repeat;pointer-events:none;'
  document.body.appendChild(div)
  bgLayerEl = div
  return div
}

/** 把选区按指定比例（窗口宽高比 / 图片宽高比）归一化，保留面积与中心。 */
export function normalizeAreaToRatio(area: LiuliBgArea, ratio: number): LiuliBgArea {
  const safeRatio = Math.max(0.05, Math.min(20, ratio))
  const areaSize = Math.max(area.w * area.h, 0.04 * 0.04)
  let w = Math.sqrt(areaSize * safeRatio)
  let h = Math.sqrt(areaSize / safeRatio)
  const scale = Math.min(1, 1 / w, 1 / h)
  w *= scale
  h *= scale
  const cx = area.x + area.w / 2
  const cy = area.y + area.h / 2
  return {
    x: Math.min(1 - w, Math.max(0, cx - w / 2)),
    y: Math.min(1 - h, Math.max(0, cy - h / 2)),
    w,
    h,
  }
}

/** 由适应模式 + 选区推导 background-size/position（cover 选区放大公式：
    size = 100%/w 100%/h；position = x/(1-w) y/(1-h) 百分比）。
    传入图片宽高比时，会按当前窗口比例动态归一化选区，避免窗口尺寸变化后拉伸。 */
export function bgGeometry(
  fit: LiuliBgFit,
  area: LiuliBgArea | null,
  imageRatio?: number | null,
  viewportRatio?: number,
): { size: string; position: string } {
  if (fit === 'contain') return { size: 'contain', position: 'center' }
  if (fit === 'stretch') return { size: '100% 100%', position: 'center' }
  if (area !== null && area.w > 0.04 && area.h > 0.04 && area.w < 0.999 && area.h < 0.999) {
    const vRatio = viewportRatio && viewportRatio > 0 ? viewportRatio : window.innerWidth / window.innerHeight
    const iRatio = imageRatio && imageRatio > 0 ? imageRatio : currentImageRatio
    const n = iRatio !== null && iRatio > 0
      ? normalizeAreaToRatio(area, vRatio / iRatio)
      : {
        x: area.x,
        y: area.y,
        w: Math.min(1, Math.max(0.05, area.w)),
        h: Math.min(1, Math.max(0.05, area.h)),
      }
    const px = Math.min(1, Math.max(0, n.x / (1 - n.w)))
    const py = Math.min(1, Math.max(0, n.y / (1 - n.h)))
    return {
      size: `calc(100% / ${n.w}) calc(100% / ${n.h})`,
      position: `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`,
    }
  }
  return { size: 'cover', position: 'center' }
}

function applyBgLayer(wallpaperSrc: string, _blur: number, fit: LiuliBgFit, area: LiuliBgArea | null): void {
  const layer = ensureBgLayer()
  layer.style.display = ''
  // 壁纸本身不带遮罩：暗色遮罩由 CSS [data-ds-dark-theme] 选择器叠加（原项目同构），
  // 主题切换即时响应，无 JS 时序问题。
  // 壁纸不应用 filter：原图保持清晰（磨砂由表面 backdrop-filter 与
  // 对话页 .wallpaperBlur 独立背景层承担）。
  layer.style.backgroundImage = `url("${wallpaperSrc}")`
  layer.style.filter = 'none'
  const g = bgGeometry(fit, area, currentImageRatio)
  layer.style.backgroundSize = g.size
  layer.style.backgroundPosition = g.position
  layer.style.backgroundRepeat = 'no-repeat'
}

function clearBgLayer(): void {
  if (bgLayerEl !== null && document.body.contains(bgLayerEl)) {
    bgLayerEl.style.display = 'none'
  }
}

/** 只更新壁纸背景层（同步、轻量），用于窗口 resize 时避免重新跑动态取色造成延迟。 */
export function applyLiuliWallpaper(settings: LiuliSettings): void {
  const cfg = { ...LIULI_SETTINGS_DEFAULTS, ...(settings ?? {}) }
  const wallpaper = loadWallpaper()
  const wallpaperSrc = cfg.background_mode === 'image' ? wallpaper : null
  if (wallpaperSrc) {
    const blurPx = cfg.acrylic_enabled === false ? 0
      : cfg.material_type === 'mica' ? 4 : Math.max(0, Math.min(100, cfg.material_blur ?? 5))
    applyBgLayer(wallpaperSrc, blurPx, cfg.bg_fit, cfg.bg_area)
  } else {
    clearBgLayer()
  }
}

const FONT_MISANS = '"MiSans", "Inter", "Space Grotesk", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
const FONT_BUILTIN = '"Inter", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

/**
 * 应用一份 琉璃 设置。动态取色是异步的（壁纸解码），品牌映射分两步：
 * 先同步应用静态部分，壁纸取色完成后回填品牌色。
 */
export async function applyLiuliSettings(settings: LiuliSettings): Promise<void> {
  const seq = ++liuliApplySeq
  const cfg = { ...LIULI_SETTINGS_DEFAULTS, ...(settings ?? {}) }
  const wallpaper = loadWallpaper()
  const body = document.body
  const set = (k: string, v: string): void => { body.style.setProperty(k, v) }
  const unset = (k: string): void => { body.style.removeProperty(k) }

  // ── 源色 ──
  const dynamic = cfg.color_mode === 'dynamic'
  const wallpaperSrc = cfg.background_mode === 'image' ? wallpaper : null
  const fallbackSource = dynamic ? LIULI_DEFAULT_SOURCE : (cfg.brand_color || LIULI_DEFAULT_SOURCE)
  let source = fallbackSource
  if (dynamic && wallpaperSrc) {
    try {
      source = await dynamicSourceFromImage(wallpaperSrc)
    } catch (_) { source = LIULI_DEFAULT_SOURCE }
  }
  // 记录当前壁纸的图片比例（按 src 缓存）：更换壁纸后必须重算，
  // 否则选区归一化沿用旧图片比例，壁纸放大出来的区域会与框选区域不一致。
  if (wallpaperSrc && wallpaperSrc !== currentImageSrc) {
    try {
      const img = await loadImage(wallpaperSrc)
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        currentImageRatio = img.naturalWidth / img.naturalHeight
        currentImageSrc = wallpaperSrc
      }
    } catch (_) { /* 忽略取图失败 */ }
  }
  // 竞态保护：期间有更新的 apply 启动（主题切换/后续滑条），本调用作废。
  if (seq !== liuliApplySeq) return
  // ★ isDark 必须在 await 之后、写入之前读取：async 取色期间主题可能已切换
  //   （presenter 先/后于本调用执行），用旧值会把错配明暗的调色板落地 ——
  //   这正是"拖动滑条时主题颜色变暗"的根因。
  const isDark = currentIsDark()
  const pal = liuliDerivePalette(source, isDark)
  liuliApplyBrand(pal, isDark, source)

  // ── 字体 ──
  set('--dsw-font-family', cfg.font_mode === 'builtin' ? FONT_BUILTIN : FONT_MISANS)

  // ── 宽边模式（宽屏下对话信息区撑满可用宽度） ──
  if (cfg.wide_mode === true) body.dataset.liuliWide = '1'
  else delete body.dataset.liuliWide

  // ── 圆角 / 泛光 / 阴影 / 面板留白 ──
  const radius = Math.max(0, Math.min(40, Number(cfg.corner_radius ?? 14)))
  const dockPadding = Math.max(0, Math.min(16, Number(cfg.dock_padding ?? 8)))
  set('--liuli-dock-padding', dockPadding + 'px')
  set('--liuli-radius', radius + 'px')
  set('--liuli-radius-sm', Math.min(radius, 10) + 'px')
  set('--liuli-glow-strength', (cfg.glow_enabled ? (cfg.glow_intensity ?? 15) : 0) / 100 + '')
  set('--liuli-shadow-strength', (cfg.shadow_enabled ? (cfg.shadow_intensity ?? 60) : 0) / 100 + '')

  // ── 材质 ──
  if (cfg.acrylic_enabled !== false) {
    const opacity = Math.max(0.2, Math.min(1, (cfg.material_opacity ?? 45) / 100))
    set('--liuli-material-opacity', opacity + '')
    const blur = Math.max(0, Math.min(100, cfg.material_blur ?? 5))
    if (cfg.material_type === 'mica') {
      set('--liuli-material-blur', 'blur(4px) saturate(1.25)')
      set('--liuli-material-blur-px', '4')
    } else {
      // 模糊强度直接映射为壁纸层 blur（原项目 material_blur 单位 px）
      set('--liuli-material-blur', `blur(${blur}px) saturate(1.6)`)
      set('--liuli-material-blur-px', blur + '')
    }
    // 强磨砂（对话框）：滑条值 x4 —— 背后滚动文字需明显不可读
    const strong = Math.min(100, Math.round(blur * 4))
    set('--liuli-material-blur-strong', `blur(${strong}px) saturate(1.6)`)
    set('--liuli-surface-opacity', opacity + '')
  } else {
    set('--liuli-material-opacity', '1')
    set('--liuli-material-blur', 'none')
    set('--liuli-material-blur-px', '0')
    set('--liuli-surface-opacity', '1')
  }

  // ── 背景 / 壁纸 ──
  const frameBg = cfg.background_mode === 'custom'
    ? (isDark ? cfg.custom_background_dark || '#0C0E13' : cfg.custom_background || '#F5F6F8')
    : ''
  const scrim = Math.max(0, Math.min(80, cfg.bg_scrim ?? 40)) / 100
  if (cfg.background_mode === 'image' && wallpaperSrc) {
    // 壁纸移交 bg-layer（承载模糊）；frame 转透明让层透出。
    // 暗色遮罩值写入 --liuli-scrim，由 CSS 在暗色主题下叠加（亮色不遮）。
    const blurPx = cfg.acrylic_enabled === false ? 0
      : cfg.material_type === 'mica' ? 4 : Math.max(0, Math.min(100, cfg.material_blur ?? 5))
    set('--liuli-scrim', scrim + '')
    applyBgLayer(wallpaperSrc, blurPx, cfg.bg_fit, cfg.bg_area)
    set('--liuli-frame-bg', 'transparent')
    unset('--liuli-frame-bg-image')
    unset('--liuli-frame-bg-size')
  } else {
    clearBgLayer()
    if (cfg.background_mode === 'brand_gradient') {
      set('--liuli-frame-bg', pal.appBg)
      set('--liuli-frame-bg-image',
        `radial-gradient(120% 90% at 82% -10%, color-mix(in srgb, ${pal.brand} 24%, transparent), transparent 60%),
         radial-gradient(90% 70% at -10% 110%, color-mix(in srgb, ${pal.brand} 15%, transparent), transparent 55%)`)
      set('--liuli-frame-bg-size', 'auto')
    } else if (cfg.background_mode === 'custom') {
      set('--liuli-frame-bg', frameBg)
      unset('--liuli-frame-bg-image')
      unset('--liuli-frame-bg-size')
    } else {
      // theme：回到 liuli.css 的默认渐变
      unset('--liuli-frame-bg')
      unset('--liuli-frame-bg-image')
      unset('--liuli-frame-bg-size')
    }
  }
}

/** 出厂默认应用（scope 快照到达前调用）。 */
export async function applyLiuliDefaults(): Promise<void> {
  await applyLiuliSettings(LIULI_SETTINGS_DEFAULTS)
}
