export const FONT_ROLES = ['text', 'code', 'terminal'] as const
export type FontRole = (typeof FONT_ROLES)[number]
export type FontFamilies = Readonly<Record<FontRole, string>>

const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong'])
const TEXT_FALLBACK = ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif']
const CODE_FALLBACK = ['JetBrains Mono', 'SF Mono', 'Fira Code', 'Consolas', 'Liberation Mono', 'Menlo', 'PingFang SC', 'Microsoft YaHei', 'monospace']

/** Match the host's comma-separated family input; never treat it as raw CSS. */
export function fontFamilies(value: string): string[] {
  const seen = new Set<string>()
  return value.split(',').map(name => name.replace(/["'\\<>\u0000-\u001f\u007f]/g, '').trim())
    .filter(name => {
      const key = name.toLowerCase()
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function fontFamilyList(names: readonly string[]): string {
  return fontFamilies(names.join(',')).map(name => generic.has(name.toLowerCase()) || name === '-apple-system'
    ? name.toLowerCase() : JSON.stringify(name)).join(', ')
}

export function moveFont(names: readonly string[], index: number, step: -1 | 1): string[] {
  const result = [...names], target = index + step
  if (index < 0 || index >= result.length || target < 0 || target >= result.length) return result
  ;[result[index], result[target]] = [result[target]!, result[index]!]
  return result
}

/** Append the role's defaults so a missing font or missing glyph still has a fallback. */
export function fontStack(value: string, role: FontRole, mode: 'misans' | 'builtin' = 'misans'): string {
  const fallback = role === 'text'
    ? [...(mode === 'misans' ? ['MiSans', 'Inter', 'Space Grotesk'] : []), ...TEXT_FALLBACK]
    : [...CODE_FALLBACK]
  return fontFamilyList([...fontFamilies(value), ...fallback])
}
