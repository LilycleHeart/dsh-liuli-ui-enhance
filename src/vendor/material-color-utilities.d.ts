/** material-color-utilities@0.4.0 的类型声明（vendored 文件伴生，仅声明本项目用到的 API）。 */

/** ARGB 整数值（0xAARRGGBB）。 */
export type Argb = number

/** 十六进制色串（#rrggbb）。 */
export function argbFromHex(hex: string): Argb
export function hexFromArgb(argb: Argb): string

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

export function themeFromSourceColor(source: Argb): MaterialTheme
