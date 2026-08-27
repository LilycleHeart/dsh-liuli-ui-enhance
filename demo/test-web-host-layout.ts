// Web 宿主布局状态机（web-host-layout.ts）纯逻辑单测：Node 直接跑，无需浏览器。
// 逐条对齐官方 dsh-client-ui-layout createLayoutStore 的语义（初值 / clamp /
// toggle 与 narrow 语义 / open-close 幂等），防止两套 store 漂移。
import assert from 'node:assert/strict'
import { initialWebLayoutState, SIDEBAR_AUTO_COLLAPSE, webLayoutActions } from '../src/client/web-host-layout.ts'

let passed = 0
function check(name: string, pass: boolean, detail: unknown = ''): void {
  if (pass) { passed += 1; console.log('PASS ' + name) } else {
    console.log('FAIL ' + name + ' :: ' + String(detail))
    process.exitCode = 1
  }
}

const s = initialWebLayoutState()
check('T1 init state (280/0/narrow false)', s.sidebar === 280 && s.details === 0 && s.narrow === false && s.narrowExpanded === false, s)

// T2 toggleSidebar（非 narrow）：0 ↔ 280
webLayoutActions.toggleSidebar(s)
check('T2a toggle closes sidebar (0)', s.sidebar === 0, s)
webLayoutActions.toggleSidebar(s)
check('T2b toggle reopens sidebar (280)', s.sidebar === 280, s)

// T3 setSidebar clamp 到官方契约 264..420（round）
webLayoutActions.setSidebar(s, 100)
check('T3a setSidebar low clamp 264', s.sidebar === 264, s)
webLayoutActions.setSidebar(s, 9999)
check('T3b setSidebar high clamp 420', s.sidebar === 420, s)
webLayoutActions.setSidebar(s, 299.6)
check('T3c setSidebar rounds', s.sidebar === 300, s)

// T4 详情开合：openDetails 0→360 幂等；closeDetails → 0
webLayoutActions.openDetails(s)
check('T4a openDetails 360', s.details === 360, s)
webLayoutActions.openDetails(s)
check('T4b openDetails idempotent', s.details === 360, s)
webLayoutActions.closeDetails(s)
check('T4c closeDetails 0', s.details === 0, s)
webLayoutActions.closeDetails(s)
check('T4d closeDetails idempotent', s.details === 0, s)
webLayoutActions.setDetails(s, 100)
check('T4e setDetails clamp 300 (official contract)', s.details === 300, s)
webLayoutActions.setDetails(s, 400.4)
check('T4f setDetails rounds', s.details === 400, s)
webLayoutActions.closeDetails(s)

// T5 narrow 语义（与官方 AppFrame/setNarrow 一致）
check('T5 SIDEBAR_AUTO_COLLAPSE is 1024', SIDEBAR_AUTO_COLLAPSE === 1024)
webLayoutActions.setSidebar(s, 300)
webLayoutActions.setNarrow(s, true)
check('T5a narrow set', s.narrow === true, s)
webLayoutActions.toggleSidebar(s)
check('T5b narrow toggle flips narrowExpanded (width untouched)', s.narrowExpanded === true && s.sidebar === 300, s)
webLayoutActions.toggleSidebar(s)
check('T5c narrow toggle flips back', s.narrowExpanded === false, s)
webLayoutActions.setNarrow(s, false)
check('T5d widen resets narrowExpanded', s.narrow === false && s.narrowExpanded === false, s)

// T6 setNarrow 同值幂等
webLayoutActions.setNarrow(s, false)
check('T6 setNarrow same value no-op', s.narrow === false && s.narrowExpanded === false, s)

console.log(`SUMMARY: ${passed}/18 passed`)
assert.equal(passed, 18)
