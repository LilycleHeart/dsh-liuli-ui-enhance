#!/usr/bin/env node
// DSH Desktop CDP 深度调试 · 一键体检 / 常用动作（零依赖，Node >= 22）
//
// 用法：
//   node demo/cdp-dsh.mjs                     体检主窗口（默认端口 9222）
//   node demo/cdp-dsh.mjs <port>              指定端口（9229 = 主进程 inspector）
//   node demo/cdp-dsh.mjs shot <out.png>      主窗口截图
//   node demo/cdp-dsh.mjs console <sec>       收集 N 秒 console / 异常
//   node demo/cdp-dsh.mjs network <sec>       抓 N 秒网络请求（去重）
//   node demo/cdp-dsh.mjs eval <expr>         在主窗口执行 JS
//   node demo/cdp-dsh.mjs raw <method> [json] 任意 CDP 命令
//
// 主窗口识别：type=page 且标题含 "DeepSeek Harness" 优先，否则取第一个 page。

const PORT = Number(process.argv[process.argv.length - 1]) || 9222;

function fail(msg) {
  console.error(`[cdp-dsh] ${msg}`);
  process.exit(1);
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.pending = new Map();
    this.seq = 0;
    this.events = new Set();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)); } catch { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.events) fn(msg.method, msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  onEvent(fn) { this.events.add(fn); }
  close() { try { this.ws.close(); } catch { } }
}

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) fail(`/json/list HTTP ${res.status}（DSH Desktop 是否已带调试端口启动？）`);
  return res.json();
}

function pickMainWindow(targets) {
  const pages = targets.filter(t => t.type === 'page');
  if (pages.length === 0) fail('没有 page 类型目标（这是 Node inspector？请确认端口）');
  return pages.find(t => /deepseek|harness|dsh/i.test((t.title || '') + ' ' + (t.url || '')))
    ?? pages.find(t => !/^devtools:\/\//.test(t.url ?? ''))
    ?? pages[0];
}

async function withMain(fn) {
  const targets = await listTargets();
  const t = pickMainWindow(targets);
  console.log(`[目标] ${t.title || '(无标题)'}\n       ${t.url}`);
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  try { return await fn(cdp, t); } finally { cdp.close(); }
}

const HEALTH_EXPR = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const css = document.getElementById('liuli-theme-css');
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    liuliCssInjected: !!css,
    liuliCssBytes: css ? css.textContent.length : 0,
    dshDesktopMode: document.body.dataset.dshDesktopMode ?? null,
    theme: (document.documentElement.dataset.theme ?? document.body.dataset.theme) || null,
    dockNodes: q('[data-dock-node]'),
    regionPanes: q('[data-region-pane]'),
    sidePane: q('[data-liuli-side-pane]'),
    floatBall: q('[data-liuli-float-ball]'),
    chatFlows: q('[data-chat-flow]'),
    webviews: q('webview'),
    convCount: q('[data-conversation-scroll]'),
    navType: performance.getEntriesByType('navigation')[0]?.type ?? null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
})()`;

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'shot': {
      if (!a) fail('用法：shot <out.png> [port]');
      await withMain(async (cdp) => {
        await cdp.send('Page.enable');
        const r = await cdp.send('Page.captureScreenshot', {
          format: /\.jpe?g$/i.test(a) ? 'jpeg' : 'png',
          ...(/\.jpe?g$/i.test(a) ? { quality: 82 } : {}),
          captureBeyondViewport: false,
        });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(a, Buffer.from(r.data, 'base64'));
        console.log(`[截图] 已保存 ${a}`);
      });
      break;
    }
    case 'console': {
      const sec = Number(a ?? 10);
      await withMain(async (cdp) => {
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        const out = [];
        cdp.onEvent((method, p) => {
          if (method === 'Runtime.consoleAPICalled') {
            out.push(`[console.${p.type}] ` + (p.args ?? []).map(x => x.value !== undefined ? JSON.stringify(x.value) : x.description ?? x.type).join(' '));
          } else if (method === 'Log.entryAdded') {
            out.push(`[log.${p.entry.level}] ${p.entry.text}`);
          } else if (method === 'Runtime.exceptionThrown') {
            out.push(`[exception] ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
          }
        });
        console.log(`[console] 收集 ${sec} 秒…`);
        await new Promise(r => setTimeout(r, sec * 1000));
        console.log(out.length ? out.join('\n') : '（无 console 输出）');
      });
      break;
    }
    case 'network': {
      const sec = Number(a ?? 10);
      await withMain(async (cdp) => {
        await cdp.send('Network.enable');
        const reqs = new Map();
        cdp.onEvent((method, p) => {
          if (method === 'Network.requestWillBeSent') {
            const url = p.request?.url ?? '';
            if (/^(data:|blob:)/.test(url)) return;
            reqs.set(p.requestId, { url, method: p.request?.method, type: p.type, status: null });
          } else if (method === 'Network.responseReceived') {
            const r = reqs.get(p.requestId);
            if (r) r.status = p.response?.status;
          }
        });
        console.log(`[network] 抓取 ${sec} 秒…`);
        await new Promise(r => setTimeout(r, sec * 1000));
        const rows = [...reqs.values()].sort((x, y) => (x.status ?? 0) - (y.status ?? 0));
        for (const r of rows) {
          console.log(`  ${String(r.status ?? '…').padStart(3)} ${r.method?.padEnd(6)} ${r.type?.padEnd(12)} ${r.url.slice(0, 140)}`);
        }
        console.log(`[network] 共 ${rows.length} 个请求`);
      });
      break;
    }
    case 'eval': {
      if (!a) fail('用法：eval <expr> [port]');
      await withMain(async (cdp) => {
        const r = await cdp.send('Runtime.evaluate', { expression: a, returnByValue: true, awaitPromise: true, userGesture: true });
        if (r.exceptionDetails) fail('执行出错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
        console.log(JSON.stringify(r.result?.value, null, 2));
      });
      break;
    }
    case 'raw': {
      if (!a) fail('用法：raw <method> [jsonParams] [port]');
      await withMain(async (cdp) => {
        const params = b ? JSON.parse(b) : {};
        console.log(JSON.stringify(await cdp.send(a, params), null, 2));
      });
      break;
    }
    default: {
      // 体检
      const targets = await listTargets();
      console.log(`端口 ${PORT} 共 ${targets.length} 个目标：`);
      for (const [i, t] of targets.entries()) {
        console.log(`  [${i}] ${t.type.padEnd(6)} ${(t.title || '').slice(0, 60)}  ${(t.url || '').slice(0, 80)}`);
      }
      await withMain(async (cdp) => {
        const r = await cdp.send('Runtime.evaluate', { expression: HEALTH_EXPR, returnByValue: true });
        if (r.exceptionDetails) fail('体检脚本执行出错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
        const h = r.result.value;
        console.log('\n=== 主窗口体检 ===');
        console.log(`标题      : ${h.title}`);
        console.log(`URL       : ${h.url}`);
        console.log(`readyState: ${h.readyState}  导航: ${h.navType}  heap: ${h.heapMB ?? '?'}MB`);
        console.log(`--- 琉璃客户端 ---`);
        console.log(`liuli CSS 注入: ${h.liuliCssInjected} (${h.liuliCssBytes} bytes)`);
        console.log(`desktop mode  : ${h.dshDesktopMode ?? '（非 advanced）'}`);
        console.log(`theme         : ${h.theme ?? '（未知）'}`);
        console.log(`dock 节点     : ${h.dockNodes}   region pane: ${h.regionPanes}`);
        console.log(`侧栏/悬浮球   : ${h.sidePane} / ${h.floatBall}`);
        console.log(`会话流/正文   : ${h.chatFlows} / ${h.convCount}`);
        console.log(`webview 标签  : ${h.webviews}`);
        const problems = [];
        if (!h.liuliCssInjected) problems.push('琉璃 client bundle 未注入 —— 检查安装/刷新');
        if (h.dockNodes === 0) problems.push('advanced dock 模式未启用 —— 属正常（普通模式）');
        if (h.readyState !== 'complete') problems.push('页面未加载完成');
        console.log(problems.length ? `\n[提示] ${problems.join('；')}` : '\n[提示] 未发现明显异常');
      });
    }
  }
}

main().catch((e) => fail(e.message));
