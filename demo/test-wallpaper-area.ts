// 壁纸选区归一化/几何 纯逻辑单元测试（node 直接跑 TS：类型剥离，无构建）。
// 运行：node demo/test-wallpaper-area.ts
// 覆盖问题：选区与实际不对应 + 选区怎么选都不应用。
// 历史根因：normalizeAreaToRatio 会产出 w 或 h = 1.0（面积 ≥ 比例阈值时），
// bgGeometry 的 0.999 门槛把这类选区当"无选区"静默忽略（回退 cover）；
// 一旦保存再进编辑是归一化不动点，选区永远 ≥0.999 → 壁纸永远不跟随。
import { bgGeometry, normalizeAreaToRatio } from '../src/client/liuli-runtime.ts'
import type { LiuliBgArea } from '../src/liuli-settings.ts'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; failures.push(name + (detail !== '' ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail !== '' ? ' :: ' + detail : '')) }
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

// 模拟编辑器的 cropRatio = 窗口宽高比 / 图片宽高比
function cropRatio(winRatio: number, imgRatio: number): number { return winRatio / imgRatio }

// 模拟 windowArea()：与当前窗口同比例的最大居中区域（每维预留 0.002 边距）
function windowAreaLike(winRatio: number, imgRatio: number): LiuliBgArea {
  const maxW = Math.min(0.998, imgRatio > winRatio ? winRatio / imgRatio : 1)
  const maxH = Math.min(0.998, imgRatio > winRatio ? 1 : imgRatio / winRatio)
  return { x: (1 - maxW) / 2, y: (1 - maxH) / 2, w: maxW, h: maxH }
}

// bgGeometry 是否按"选区放大"渲染（size 以 calc(100%/w) 开头），而不是被当成无选区回退 cover
function selectionApplies(area: LiuliBgArea, imgRatio: number, winRatio: number): boolean {
  const g = bgGeometry('cover', area, imgRatio, winRatio)
  return g.size.startsWith('calc(100% / ')
}

// 全宽/全高（铺满图片一维）的选区曾经是重灾区：归一化后 w 或 h 恰好 = 1.0，
// 被 0.999 门槛静默忽略，且保存后成为不动点（怎么重选都回退 cover）。
const fullHeightWide = { x: 0.2333, y: 0, w: 0.5333, h: 1 }        // 宽图，满高
const fullWidthTall = { x: 0, y: 0.25, w: 1, h: 0.5 }              // 高图，满宽
const fullFrame = { x: 0, y: 0, w: 1, h: 1 }                       // 整图
const dirtyPersisted = { x: 0, y: 0, w: 1, h: 0.5 }               // 旧版本持久化的脏选区

// t1：普通"窗口视图"默认选区 —— 保存后必须稳稳低于 0.999，且能被应用到壁纸
{
  for (const [name, winRatio, imgRatio] of [
    ['宽图 3:1 @ 16:10 窗口', 1.6, 3],
    ['高图 4:5 @ 16:10 窗口', 1.6, 0.8],
    ['近方形图 @ 16:10 窗口', 1.6, 1.4],
    ['方形图 @ 16:10 窗口', 1.6, 1],
  ] as const) {
    const box = windowAreaLike(winRatio, imgRatio)
    const saved = normalizeAreaToRatio(box, cropRatio(winRatio, imgRatio))
    check(`t1 ${name}：保存选区两维 ≤ 0.998（不贴 0.999 门槛）`, saved.w <= 0.998 && saved.h <= 0.998,
      `w=${saved.w} h=${saved.h}`)
    check(`t1 ${name}：保存后仍能应用（不被回退 cover）`, selectionApplies(saved, imgRatio, winRatio),
      JSON.stringify(bgGeometry('cover', saved, imgRatio, winRatio)))
  }
}

// t2：铺满图片一维/整图的选区（旧版必现 w 或 h = 1.0 被门槛拒绝）
{
  const cases: Array<[string, LiuliBgArea, number]> = [
    ['宽图满高', fullHeightWide, 3],
    ['高图满宽', fullWidthTall, 0.8],
    ['整图', fullFrame, 1.5],
  ]
  for (const [name, area, imgRatio] of cases) {
    const saved = normalizeAreaToRatio(area, cropRatio(1.6, imgRatio))
    check(`t2 ${name}：归一化后不再产出 1.0`, saved.w < 0.999 && saved.h < 0.999,
      `w=${saved.w} h=${saved.h}（旧版会得 1.0）`)
    check(`t2 ${name}：保存后能应用`, selectionApplies(saved, imgRatio, 1.6))
    // 归一化不动点：保存后再归一化必须保持原值（编辑重入/窗口 resize 不漂移）
    const again = normalizeAreaToRatio(saved, cropRatio(1.6, imgRatio))
    check(`t2 ${name}：归一化不动点（重入编辑选区不漂移）`,
      near(again.w, saved.w) && near(again.h, saved.h), `再次 w=${again.w} h=${again.h}`)
  }
}

// t3：旧版本已持久化的脏选区（w/h ≥ 0.999 或 =1）—— 修复前被门槛永久拒绝，
//     触发"怎么选都不应用"；修复后按当前比例归一化并正常应用（自愈）
{
  const g = bgGeometry('cover', dirtyPersisted, 0.8, 1.6)
  check('t3 持久化脏选区 {w:1,h:0.5} 能应用（不再永久 cover）', g.size.startsWith('calc(100% / '), g.size)
  const n = normalizeAreaToRatio(dirtyPersisted, cropRatio(1.6, 0.8))
  check('t3 脏选区归一化后两维有效且不除零', n.w > 0 && n.w < 1 && n.h > 0 && n.h < 1,
    `w=${n.w} h=${n.h}`)
  // 各比例遍历：任意合法选区归一化后任一维都 < 0.999（不会触发门槛）
  let minMargin = Infinity
  let worst = ''
  for (const winRatio of [1.2, 1.6, 2.1]) {
    for (const imgRatio of [0.6, 0.9, 1.3, 2, 3.2]) {
      for (const box of [windowAreaLike(winRatio, imgRatio), fullFrame, fullWidthTall]) {
        if (box.w <= 0.04 || box.h <= 0.04) continue
        const n2 = normalizeAreaToRatio(box, cropRatio(winRatio, imgRatio))
        const margin = Math.min(0.999 - n2.w, 0.999 - n2.h)
        if (margin < minMargin) { minMargin = margin; worst = `win=${winRatio} img=${imgRatio} → w=${n2.w} h=${n2.h}` }
        check('t3 扫描：归一化后两维 < 0.999（对门槛留有余量）', n2.w < 0.999 && n2.h < 0.999,
          `${worst}`)
      }
    }
  }
  check('t3 扫描最坏余量 ≥ 0.001（0.998 封顶的固有裕度）', minMargin >= 0.001, `worst=${worst}`)
}

// t4：预览与运行时使用同一函数 → 同一(area, ratio, winRatio) 产出完全一致的几何
{
  const area = normalizeAreaToRatio(fullHeightWide, cropRatio(1.6, 3))
  const g1 = bgGeometry('cover', area, 3, 1.6) // 预览：imgRatio 由设置页 new Image() 得出
  const g2 = bgGeometry('cover', area, 3, 1.6) // 运行时：按 src 缓存的同一比例
  check('t4 预览几何 == 运行时几何', g1.size === g2.size && g1.position === g2.position,
    `${g1.size} / ${g1.position}`)
}

// t5：位置公式在极限选区（0.998 贴边）下不产生 NaN/Infinity
{
  const edge = normalizeAreaToRatio({ x: 0, y: 0.5 - 0.499, w: 0.05, h: 0.998 }, 1.6 / 1.4)
  const g = bgGeometry('cover', { ...edge, x: 0, y: 1 - edge.h }, 1.4, 1.6)
  check('t5 极限选区 position 为有限值', !g.position.includes('NaN') && !g.position.includes('Infinity'), g.position)
}

console.log(`\n壁纸选区逻辑测试：${pass} 通过 / ${fail} 失败`)
if (fail > 0) {
  console.log('失败项：\n' + failures.join('\n'))
  process.exit(1)
}