import { useId, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronUpIcon, ChevronDownIcon, CloseIcon, ResetIcon, PlusIcon, FileCodeCornerIcon, SquareTerminalIcon } from './SidePaneIcons.tsx'
import { FONT_ROLES, fontFamilies, fontFamilyList, fontStack, moveFont, type FontRole, type FontFamilies } from './font-priority.ts'
import css from './FontPriorityEditor.module.css'

interface Labels {
  add: string; up: string; down: string; remove: string; empty: string; reset: string; preview: string
  priority?: string; first?: string; next?: string; choose?: string; placeholder?: string; fallback?: string; default?: string
}
interface Props {
  role: FontRole; title: string; value: string; fontMode?: 'misans' | 'builtin'
  onChange: (value: string) => void; labels: Labels
}
const suggestions = ['MiSans', 'Inter', 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans SC',
  'LXGW WenKai', 'Arial', 'Georgia', 'JetBrains Mono', 'Cascadia Code', 'Consolas', 'system-ui', 'sans-serif', 'monospace']

export function FontPriorityEditor({ role, title, value, onChange, labels, fontMode = 'misans' }: Props) {
  const names = fontFamilies(value)
  const [draft, setDraft] = useState(''), [menuOpen, setMenuOpen] = useState(false)
  const add = (input = draft): void => {
    const next = fontFamilyList([...names, ...fontFamilies(input)])
    if (next !== value) onChange(next)
    setDraft('')
    setMenuOpen(false)
  }
  return <fieldset className={css.editor}>
    <legend className={css.srOnly}>{title}</legend>
    <div className={css.listHeading}>
      <span>{labels.priority ?? '字体顺序'}</span>
      <button type="button" className={css.reset} disabled={names.length === 0} onClick={() => { onChange('') }}>
        <ResetIcon size={14} />{labels.reset}
      </button>
    </div>
    {names.length === 0 ? <div className={css.empty}>
      <span className={css.emptyGlyph} aria-hidden="true">Aa</span>
      <div><strong>{labels.default ?? '默认字体栈'}</strong><p>{labels.empty}</p></div>
    </div> : <ol className={css.list} aria-label={title}>
      {names.map((name, index) => <li className={css.item} key={name.toLowerCase()} data-first={index === 0 || undefined}>
        <span className={css.order} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <span className={css.fontGlyph} style={{ fontFamily: fontStack(name, role, fontMode) }} aria-hidden="true">Ag</span>
        <div className={css.fontInfo}>
          <span className={css.name} style={{ fontFamily: fontStack(name, role, fontMode) }}>{name}</span>
          <span className={css.priorityLabel}>{index === 0 ? labels.first ?? '优先使用' : labels.next ?? '后备字体'}</span>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.iconButton} disabled={index === 0} aria-label={`${title}：${labels.up} ${name}`}
            onClick={() => { onChange(fontFamilyList(moveFont(names, index, -1))) }}><ChevronUpIcon size={17} /></button>
          <button type="button" className={css.iconButton} disabled={index === names.length - 1} aria-label={`${title}：${labels.down} ${name}`}
            onClick={() => { onChange(fontFamilyList(moveFont(names, index, 1))) }}><ChevronDownIcon size={17} /></button>
          <button type="button" className={`${css.iconButton} ${css.remove}`} aria-label={`${title}：${labels.remove} ${name}`}
            onClick={() => { onChange(fontFamilyList(names.filter((_, at) => at !== index))) }}><CloseIcon size={14} /></button>
        </div>
      </li>)}
    </ol>}
    <div className={css.addRow}>
      <div className={css.inputShell}>
        <PlusIcon size={16} />
        <input value={draft} aria-label={`${title}：${labels.add}`} placeholder={labels.placeholder ?? '输入字体名称…'}
          onChange={event => { setDraft(event.target.value) }} onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add() }
          }} />
        <Menu open={menuOpen} onClose={() => { setMenuOpen(false) }} portal align="end"
          items={suggestions.map(name => ({ id: name, label: <span style={{ fontFamily: fontStack(name, role, fontMode) }}>{name}</span>, disabled: names.some(current => current.toLowerCase() === name.toLowerCase()) }))}
          onSelect={name => { add(name) }}
          anchor={<button type="button" className={css.picker} aria-label={`${title}：${labels.choose ?? '选择常用字体'}`} aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={() => { setMenuOpen(open => !open) }}><ChevronDownIcon size={16} /></button>} />
      </div>
      <button type="button" className={css.addButton} disabled={fontFamilies(draft).length === 0} onClick={() => { add() }}>
        <PlusIcon size={15} />{labels.add}
      </button>
    </div>
    <div className={css.sampleBox}>
      <div className={css.sampleHeading}><span>{labels.preview}</span><span aria-hidden="true">Aa · 123 · 汉字</span></div>
      <p className={css.sample} aria-label={`${title}：${labels.preview}`} style={{ fontFamily: fontStack(value, role, fontMode) }}>
        {role === 'text' ? '琉璃字体预览' : role === 'code' ? 'const hello = "你好，琉璃";' : '› echo "你好，琉璃"'}
      </p>
      <span className={css.sampleLatin} style={{ fontFamily: fontStack(value, role, fontMode) }}>The quick brown fox · 0123456789</span>
    </div>
    <div className={css.fallback}><span aria-hidden="true">↳</span>{labels.fallback ?? '缺失字体与字形时，自动回退到默认字体'}</div>
  </fieldset>
}

interface PanelProps {
  title: string; hint: string; live: string
  titles: Record<FontRole, string>; families: FontFamilies
  fontMode: 'misans' | 'builtin'; onChange: (role: FontRole, value: string) => void; labels: Labels
}
export function FontPriorityPanel({ title, hint, live, titles, families, fontMode, onChange, labels }: PanelProps) {
  const [role, setRole] = useState<FontRole>('text'), id = useId()
  const select = (index: number): void => { setRole(FONT_ROLES[index]!); document.getElementById(`${id}-${index}`)?.focus() }
  return <section className={css.panel} aria-label={title}>
    <div className={css.panelHead}>
      <span className={css.panelGlyph} aria-hidden="true">Aa</span>
      <div><h3>{title}</h3><p>{hint}</p></div>
      <span className={css.live}><i />{live}</span>
    </div>
    <div className={css.tabs} role="tablist" aria-label={title} onKeyDown={event => {
      const at = FONT_ROLES.indexOf(role)
      const next = event.key === 'ArrowRight' ? (at + 1) % 3 : event.key === 'ArrowLeft' ? (at + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null
      if (next !== null) { event.preventDefault(); select(next) }
    }}>
      {FONT_ROLES.map((kind, index) => <button key={kind} type="button" role="tab" id={`${id}-${index}`} aria-selected={role === kind}
        aria-controls={`${id}-panel`} tabIndex={role === kind ? 0 : -1} onClick={() => { setRole(kind) }}>
        {kind === 'code' ? <FileCodeCornerIcon size={17} /> : kind === 'terminal' ? <SquareTerminalIcon size={17} /> : <span className={css.textIcon}>Aa</span>}
        {titles[kind]}<span className={css.count}>{fontFamilies(families[kind]).length || '—'}</span>
      </button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${FONT_ROLES.indexOf(role)}`}>
      <FontPriorityEditor key={role} role={role} title={titles[role]} value={families[role]} fontMode={fontMode} labels={labels}
        onChange={value => { onChange(role, value) }} />
    </div>
  </section>
}
