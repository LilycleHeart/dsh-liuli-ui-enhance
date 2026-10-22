/** material-color-utilities@0.4.0 的类型声明（vendored 文件伴生，仅声明本项目用到的 API）。 */

/** ARGB 整数值（0xAARRGGBB）。 */
export type Argb = number

/** 十六进制色串（#rrggbb）。 */
export function argbFromHex(hex: string): Argb
export function hexFromArgb(argb: Argb): string

/** HCT 色彩空间：色相 / 彩度 / 明度（图表色板派生用）。 */
export interface HctColor {
  hue: number
  chroma: number
  tone: number
}
export const Hct: {
  from(argb: Argb): HctColor
  from(hue: number, chroma: number, tone: number): HctColor
}

/** CAM16：从 ARGB 取色相（Hct.from 单参在 0.4.0 bundle 里不可用，改走 Cam16）。 */
export interface Cam16Color {
  hue: number
  chroma: number
  j: number
}
export const Cam16: {
  fromInt(argb: Argb): Cam16Color
}

/** 色相归一化到 [0, 360)。 */
export function sanitizeDegreesDouble(degrees: number): number

/** 从图像提取主色（async：内部 canvas 量化 + Score）。 */
export function sourceColorFromImage(image: HTMLImageElement): Promise<Argb>

/** M3 主题（source → schemes/palettes）。 */
export interface MaterialTheme {
  source: Argb
  schemes: {
    light: MaterialScheme
    dark: MaterialScheme
  }
  palettes: {
    primary: TonalPalette
    secondary: TonalPalette
    tertiary: TonalPalette
    neutral: TonalPalette
    neutralVariant: TonalPalette
    error: TonalPalette
  }
}

export interface MaterialScheme {
  primary: Argb
  onPrimary: Argb
  primaryContainer: Argb
  onPrimaryContainer: Argb
  secondary: Argb
  onSecondary: Argb
  secondaryContainer: Argb
  onSecondaryContainer: Argb
  tertiary: Argb
  tertiaryContainer: Argb
  onTertiaryContainer: Argb
  onSurface: Argb
  onSurfaceVariant: Argb
  outline: Argb
  outlineVariant: Argb
  inverseSurface: Argb
  inverseOnSurface: Argb
  error: Argb
  errorContainer: Argb
  [key: string]: Argb
}

export interface TonalPalette {
  tone(tone: number): Argb
}
export const TonalPalette: {
  fromHueAndChroma(hue: number, chroma: number): TonalPalette
}

export function themeFromSourceColor(source: Argb): MaterialTheme
