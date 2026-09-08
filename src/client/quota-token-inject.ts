/**
 * 琉璃 · 设置页「模型服务商」余额令牌输入行。
 *
 * 目标：让 new-api 中转站的「系统访问令牌」直接在 DSH 设置页「模型服务商」
 * 的 provider 编辑表单里填写 —— 站点地址从表单已有的 baseURL 自动读取，
 * 用户不用重复输站点，插件也不用登记站点清单。
 *
 * 做法（与 settings-selects.ts 同款 DOM 增强，不改宿主源码）：
 * - MutationObserver 监听文档，找到 provider 编辑表单（`_editor`），从其中的
 *   baseURL 输入框读站点 host；Host 侧探一次 `/api/status`，确认是 new-api
 *   站点后，在 API Key 字段之后插入一行「余额令牌」输入框。插入位置刻意选在
 *   编辑表单顶部字段区：baseURL 本身在「自定义」折叠区里，挂那里默认看不到。
 *   注入行复用宿主的 `_field` / `_fieldLabel` / `_input` 类名，观感与原生字段一致；
 * - 挂载时 GET `/liuli-quota?probe=<host>` 只取「已配置 / 未配置」状态，
 *   宿主**从不回显令牌明文**，输入框永远从空白开始；
 * - 回车或失焦（仅当用户改过值）POST `/liuli-quota` 写入凭据，成功后刷新
 *   header 余额；留空并保存 = 清除该站点的令牌；
 * - React 重渲染可能移除注入节点，观察器按需重建；用户尚未保存的草稿值
 *   存在模块级 Map 里，重建后原样恢复。
 *
 * 随「非官方增强 → DOM 观察增强」开关挂载（index.ts 里 unofficial('dom')
 * 关闭时不启动本模块）。
 */
import { refreshSupplierQuota } from './supplier-quota.ts'

/** 注入节点标记（重建时用于判重与清理）。 */
const MARK = 'data-liuli-quota-token'
/** 宿主 provider 编辑表单容器（CSS Modules 类名后缀跨构建稳定）。 */
const EDITOR_SELECTOR = 'div[class*="_editor"]'
/** 宿主字段容器（`_fieldLabel` 是 span，故 div 限定足以区分两者）。 */
const FIELD_SELECTOR = 'div[class*="_field"]'

/**
 * 字段标签与提示：统一围绕「new-api 余额查询」表述，避免和调用密钥混淆。
 *
 * HINT 是常驻的「去哪拿令牌」说明。new-api 的「系统访问令牌」在各站点里
 * 位置一致：登录站点 → 个人设置 / 个人资料页 → 「系统访问令牌」→ 生成新令牌。
 * 新版 new-api（如 zero.cat）把这一页放在 `/profile`，老版放在
 * `/console/personal`，故文案只写菜单名不写路径，避免站点间版本差异导致指错。
 * 站点自己的文案是「您的系统访问令牌，用于 API 认证。请妥善保管」。
 */
const LABEL = 'new-api 余额查询令牌'
const HINT = '在站点「个人设置 → 系统访问令牌」点「生成新令牌」后复制粘贴到这里（不是 sk- 开头的调用密钥）'
const PLACEHOLDER = '粘贴系统访问令牌'
const STATUS_PROBING = '正在读取余额查询令牌配置…'
const STATUS_CONFIGURED = '已配置；输入新值后回车保存，留空保存则清除'
const STATUS_MISSING = '未配置；按上方说明取得令牌后粘贴，回车保存'
const STATUS_UNKNOWN = '无法读取余额查询配置（Host 路由不可用？）'
const STATUS_SAVING = '保存中…'
const STATUS_SAVED = '已保存，页头余额将刷新'
const STATUS_CLEARED = '已清除，页头余额不再显示本站'
const STATUS_FAILED = '保存失败'

/** 用户尚未保存的草稿值（按 host 记），用于 React 重建后恢复输入。 */
const drafts = new Map<string, string>()

/** host → 是否 new-api（会话级缓存；负结果同样缓存，避免反复探测）。 */
const detection = new Map<string, boolean>()
/** 正在探测中的 host，避免并发重复请求。 */
const probing = new Set<string>()

let observer: MutationObserver | null = null
let raf = 0
let started = false

/** 表单 baseURL 的 host；形状不合法（非 http(s)、无点分域名）返回 undefined。 */
function hostOfInput(input: HTMLInputElement): string | undefined {
  const raw = (input.value.trim() !== '' ? input.value : input.placeholder).trim()
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    const host = url.hostname.toLowerCase()
    return host.includes('.') ? host : undefined
  } catch {
    return undefined
  }
}

/** 让 Host 侧探测该 host 是否为 new-api 站点（/api/status 指纹）。 */
async function detectHost(host: string): Promise<boolean> {
  try {
    const response = await fetch(`/liuli-quota?detect=${encodeURIComponent(host)}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return false
    const data = await response.json() as { ok?: boolean; newApi?: boolean }
    return data.ok === true && data.newApi === true
  } catch {
    return false
  }
}

/** 在 provider 编辑表单里找 baseURL 输入框（值或占位符形如 http(s)://）。 */
function findBaseUrlInput(container: HTMLElement): HTMLInputElement | null {
  for (const node of container.querySelectorAll('input[type="text"]')) {
    if (!(node instanceof HTMLInputElement)) continue
    const raw = (node.value.trim() !== '' ? node.value : node.placeholder).trim()
    if (/^https?:\/\//iu.test(raw)) return node
  }
  return null
}

/** 查询某站点余额令牌是否已配置（不回显明文）。 */
async function probe(host: string): Promise<boolean | undefined> {
  try {
    const response = await fetch(`/liuli-quota?probe=${encodeURIComponent(host)}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return undefined
    const data = await response.json() as { ok?: boolean; configured?: boolean }
    if (data.ok !== true) return undefined
    return data.configured === true
  } catch {
    return undefined
  }
}

/** 写入（token 为空则清除）站点余额令牌；成功返回 undefined，失败返回错误文案。 */
async function saveToken(host: string, token: string): Promise<string | undefined> {
  try {
    const response = await fetch('/liuli-quota', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ host, token }),
    })
    const data = await response.json() as { ok?: boolean; error?: string }
    if (data.ok !== true) return data.error ?? `HTTP ${response.status}`
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

interface Injected {
  host: string
  box: HTMLInputElement
  note: HTMLElement
  /** 用户是否改过输入框（避免未改动时失焦就把已配置的令牌清掉）。 */
  dirty: boolean
}

async function commit(row: Injected): Promise<void> {
  const token = row.box.value.trim()
  row.note.textContent = STATUS_SAVING
  const error = await saveToken(row.host, token)
  if (!row.note.isConnected) return
  if (error !== undefined) {
    row.note.textContent = `${STATUS_FAILED}：${error}`
    return
  }
  row.dirty = false
  drafts.set(row.host, token)
  row.note.textContent = token === '' ? STATUS_CLEARED : STATUS_SAVED
  // 令牌变了 → header 余额立刻重算。
  void refreshSupplierQuota()
}

/** 在 provider 编辑表单里注入「余额令牌」行（已存在则跳过）。 */
function inject(container: HTMLElement, baseInput: HTMLInputElement, host: string): void {
  if (container.querySelector(`[${MARK}]`) !== null) return
  const firstField = container.querySelector(FIELD_SELECTOR)
  if (!(firstField instanceof HTMLElement)) return

  const row = document.createElement('div')
  row.className = firstField.className
  row.setAttribute(MARK, host)

  const label = document.createElement('span')
  label.className = firstField.querySelector('span')?.className ?? ''
  label.textContent = LABEL

  const box = document.createElement('input')
  box.className = baseInput.className
  box.type = 'password'
  box.autocomplete = 'off'
  box.spellcheck = false
  box.placeholder = PLACEHOLDER
  box.value = drafts.get(host) ?? ''

  // 常驻说明：告诉用户这个令牌去哪拿（状态行只讲状态，会被覆盖，故分开）。
  const hint = document.createElement('p')
  hint.className = label.className
  hint.textContent = HINT

  const note = document.createElement('p')
  note.className = label.className
  note.textContent = STATUS_PROBING

  row.append(label, box, hint, note)
  firstField.after(row)

  const state: Injected = { host, box, note, dirty: false }
  box.addEventListener('input', () => {
    state.dirty = true
    drafts.set(host, box.value)
  })
  box.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void commit(state)
  })
  box.addEventListener('blur', () => {
    if (state.dirty) void commit(state)
  })

  void probe(host).then((configured) => {
    if (!note.isConnected || state.dirty) return
    note.textContent = configured === true
      ? STATUS_CONFIGURED
      : configured === false ? STATUS_MISSING : STATUS_UNKNOWN
  })
}

/**
 * 判定该表单的站点是不是 new-api：命中缓存直接决定，未知则让 Host 探测一次。
 * 探测确认后重新扫描（rAF）再注入，避免同步流程里阻塞设置页渲染。
 */
function considerInject(container: HTMLElement, baseInput: HTMLInputElement, host: string): void {
  if (container.querySelector(`[${MARK}]`) !== null) return
  const known = detection.get(host)
  if (known === false) return
  if (known === true) {
    inject(container, baseInput, host)
    return
  }
  if (probing.has(host)) return
  probing.add(host)
  void detectHost(host).then((newApi) => {
    probing.delete(host)
    detection.set(host, newApi)
    if (newApi) schedule()
  })
}

function scan(): void {
  // 与 settings-selects.ts 同款：全文档按 CSS Modules 类名查询 + rAF 节流。
  // `_editor` 只在设置页 provider 编辑表单里出现；其它同名后缀的容器会被
  // findBaseUrlInput（必须是 http(s) 值的文本框）过滤掉，不会误注入。
  for (const node of document.querySelectorAll(EDITOR_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue
    const baseInput = findBaseUrlInput(node)
    if (baseInput === null) continue
    const host = hostOfInput(baseInput)
    if (host === undefined) continue
    considerInject(node, baseInput, host)
  }
}

function schedule(): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    scan()
  })
}

/** 启动设置页余额令牌注入；返回停止函数（移除观察器与已注入节点）。 */
export function startQuotaTokenInject(): () => void {
  if (started) return () => {}
  started = true
  observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  schedule()
  return () => {
    started = false
    observer?.disconnect()
    observer = null
    if (raf !== 0) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    for (const node of document.querySelectorAll(`[${MARK}]`)) node.remove()
  }
}
