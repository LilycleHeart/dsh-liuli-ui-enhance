/** Normalize host paths for browser-side comparisons without depending on OS path APIs. */
function slashPath(input: string): string {
  const slash = input.replace(/\\/g, '/')
  const lead = slash.startsWith('//') ? '//' : slash.startsWith('/') ? '/' : ''
  return lead + slash.slice(lead.length).replace(/\/+/g, '/').replace(/\/+$/, '')
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function isWindowsRoot(root: string): boolean {
  return /^[A-Za-z]:(?:\/|$)/.test(root) || root.startsWith('//')
}

/** Convert a server entry's absolute path to a safe, slash-separated root relative path. */
export function relativeSidebarPath(root: string, path: string): string | null {
  const base = slashPath(root)
  const full = slashPath(path)
  if (base === '' || full === '') return null
  const fold = isWindowsRoot(base) ? (s: string): string => s.toLowerCase() : (s: string): string => s
  const prefix = base === '/' ? '/' : base + '/'
  if (fold(full) === fold(base)) return ''
  if (!fold(full).startsWith(fold(prefix))) return null
  const segments = full.slice(prefix.length).split('/').filter(part => part !== '' && part !== '.')
  if (segments.some(part => part === '..')) return null
  return segments.join('/')
}

/** Canonical key shared by absolute tree entries and root relative Git status rows. */
export function sidebarPathKey(root: string, path: string): string {
  const base = slashPath(root)
  const value = slashPath(path)
  const absolute = isAbsolute(value) ? value : (base === '/' ? '/' + value : base + '/' + value)
  return isWindowsRoot(base) ? absolute.toLowerCase() : absolute
}
