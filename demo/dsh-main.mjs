#!/usr/bin/env node
// DSH Desktop 深度调试 · 主进程 inspector 桥（零依赖，Node >= 22）
// 走 9229 主进程 inspector（--inspect=9229），经 process.mainModule.require('electron')
// 在主进程执行：executeJavaScript（页面执行）/ webContents.debugger（CDP 事件桥）。
// 不依赖 9222 渲染进程 CDP 端口（可能被其它服务占用）。
//
// 用法：
//   node demo/dsh-main.mjs main                 枚举窗口 / webContents
//   node demo/dsh-main.mjs eval  <expr>         主进程执行 JS
//   node demo/dsh-main.mjs page  <expr>         主窗口页面执行 JS（debugger 附着后走 CDP，否则 executeJavaScript）
//   node demo/dsh-main.mjs health               主窗口一键体检
//   node demo/dsh-main.mjs attach [wcId]        附着 debugger 并开启 Runtime/Log/Network 事件收集
//   node demo/dsh-main.mjs detach [wcId]        分离 debugger
//   node demo/dsh-main.mjs events [n]           读取已收集的 CDP 事件（最近 n 条，默认全部）
//   node demo/dsh-main.mjs console <sec>        收集 N 秒 console / 异常（自动 attach）
//   node demo/dsh-main.mjs net <sec>            收集 N 秒网络请求（自动 attach）
//   node demo/dsh-main.mjs shot  <file.png>     主窗口截图（wc.capturePage）
//
// 端口可用环境变量 DSH_INSPECT_PORT 覆盖，默认 9229。

const PORT = Number(process.env.DSH_INSPECT_PORT) || 9229;
const ELECTRON = "process.mainModule.require('electron')";

function fail(msg) {
  console.error(`[dsh-main] ${msg}`);
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
      this.ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败（DSH 是否带 --inspect=9229 启动？）')), { once: true });
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
  close() { try { this.ws.close(); } catch { } }
}

async function mainEval(expr, { awaitPromise = true } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!res.ok) fail(`/json/list HTTP ${res.status}`);
  const targets = await res.json();
  const t = targets.find(x => x.type === 'node');
  if (!t) fail('9229 上没有 node 目标（主进程 inspector 未开？）');
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  try {
    const r = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) {
      fail('主进程执行出错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    }
    return r.result?.value;
  } finally {
    cdp.close();
  }
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

async function wcId() {
  const v = await mainEval(`${ELECTRON}.webContents.getAllWebContents().find(w => w.getType() === 'window')?.id ?? 1`);
  return v;
}

function pageExpr(userExpr, id) {
  // 优先走 debugger（错误信息完整），否则 executeJavaScript 兜底
  return `(() => {
    const wc = ${ELECTRON}.webContents.fromId(${id});
    if (wc.debugger.isAttached()) {
      return wc.debugger.sendCommand('Runtime.evaluate', { expression: ${JSON.stringify(userExpr)}, returnByValue: true, awaitPromise: true })
        .then(r => r.exceptionDetails ? { __pageErr: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r.result?.value);
    }
    return wc.executeJavaScript(${JSON.stringify(userExpr)}).catch(e => ({ __pageErr: String(e?.stack ?? e) }));
  })()`;
}

function attachExpr(id) {
  return `(async () => {
    const wc = ${ELECTRON}.webContents.fromId(${id});
    if (!wc || wc.isDestroyed()) return { ok: false, err: 'webContents 不存在' };
    if (!globalThis.__dshCdp) globalThis.__dshCdp = [];
    if (!wc.debugger.isAttached()) {
      try { wc.debugger.attach('1.3'); } catch (e) { return { ok: false, err: 'attach 失败: ' + String(e) }; }
    }
    if (!globalThis.__dshCdpHook) {
      globalThis.__dshCdpHook = true;
      wc.debugger.on('message', (_e, method, params) => {
        globalThis.__dshCdp.push({ t: Date.now(), method, params });
        if (globalThis.__dshCdp.length > 5000) globalThis.__dshCdp.splice(0, globalThis.__dshCdp.length - 5000);
      });
      wc.debugger.on('detach', () => { globalThis.__dshCdpHook = false; });
    }
    await wc.debugger.sendCommand('Runtime.enable').catch(() => {});
    await wc.debugger.sendCommand('Log.enable').catch(() => {});
    await wc.debugger.sendCommand('Network.enable').catch(() => {});
    return { ok: true, wcId: ${id}, url: wc.getURL().slice(0, 80) };
  })()`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  switch (cmd) {
    case 'main': {
      const v = await mainEval(`(() => {
        const e = ${ELECTRON};
        return {
          appVersion: e.app.getVersion(),
          electron: process.versions.electron,
          windows: e.BrowserWindow.getAllWindows().map(w => ({ id: w.id, title: w.getTitle(), visible: w.isVisible(), maximized: w.isMaximized(), url: w.webContents.getURL().slice(0, 90) })),
          webContents: e.webContents.getAllWebContents().map(wc => ({ id: wc.id, type: wc.getType(), alive: !wc.isDestroyed(), attached: wc.debugger?.isAttached?.() ?? false, url: wc.getURL().slice(0, 90) })),
        };
      })()`);
      console.log(`DSH Desktop ${v.appVersion} / Electron ${v.electron}`);
      for (const w of v.windows) console.log(`  [窗口 ${w.id}] ${w.title}  visible=${w.visible} max=${w.maximized}\n       ${w.url}`);
      for (const wc of v.webContents) console.log(`  [wc ${wc.id}] ${wc.type}  debugger=${wc.attached}  ${wc.url}`);
      break;
    }
    case 'eval': {
      if (!a) fail('用法：eval <expr>');
      console.log(JSON.stringify(await mainEval(a), null, 2));
      break;
    }
    case 'page': {
      if (!a) fail('用法：page <expr>');
      const id = b ? Number(b) : await wcId();
      console.log(JSON.stringify(await mainEval(pageExpr(a, id)), null, 2));
      break;
    }
    case 'health': {
      const id = await wcId();
      const h = await mainEval(pageExpr(HEALTH_EXPR, id));
      if (h.__pageErr) fail('页面执行出错: ' + h.__pageErr);
      console.log('=== 主窗口体检 ===');
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
      if (!h.liuliCssInjected) problems.push('琉璃 client bundle 未注入');
      if (h.readyState !== 'complete') problems.push('页面未加载完成');
      console.log(problems.length ? `[提示] ${problems.join('；')}` : '[提示] 未发现明显异常');
      break;
    }
    case 'attach': {
      const id = a ? Number(a) : await wcId();
      console.log(JSON.stringify(await mainEval(attachExpr(id)), null, 2));
      break;
    }
    case 'detach': {
      const id = a ? Number(a) : await wcId();
      console.log(JSON.stringify(await mainEval(`(() => {
        const wc = ${ELECTRON}.webContents.fromId(${id});
        if (wc && wc.debugger.isAttached()) { wc.debugger.detach(); return { ok: true }; }
        return { ok: false, err: '未附着' };
      })()`), null, 2));
      break;
    }
    case 'events': {
      const n = a ? Number(a) : undefined;
      const v = await mainEval(`(() => {
        const arr = globalThis.__dshCdp ?? [];
        return ${n === undefined ? 'arr' : `arr.slice(-${n})`};
      })()`);
      for (const ev of v ?? []) {
        const p = ev.params ?? {};
        let line;
        if (ev.method === 'Runtime.consoleAPICalled') {
          line = `[console.${p.type}] ` + (p.args ?? []).map(x => x.value !== undefined ? JSON.stringify(x.value) : x.description ?? x.type).join(' ');
        } else if (ev.method === 'Log.entryAdded') {
          line = `[log.${p.entry?.level}] ${p.entry?.text}`;
        } else if (ev.method === 'Runtime.exceptionThrown') {
          line = `[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`;
        } else if (ev.method === 'Network.requestWillBeSent') {
          line = `[net] ${p.request?.method} ${String(p.request?.url).slice(0, 120)}`;
        } else if (ev.method === 'Network.responseReceived') {
          line = `[resp] ${p.response?.status} ${String(p.response?.url).slice(0, 120)}`;
        } else {
          line = `[${ev.method}] ${JSON.stringify(p).slice(0, 150)}`;
        }
        console.log(new Date(ev.t).toISOString().slice(11, 23) + '  ' + line);
      }
      console.log(`（共 ${v?.length ?? 0} 条事件）`);
      break;
    }
    case 'console': {
      const sec = Number(a ?? 10);
      const id = await wcId();
      await mainEval(attachExpr(id));
      console.log(`[console] 收集 ${sec} 秒…`);
      await sleep(sec * 1000);
      const v = await mainEval(`(globalThis.__dshCdp ?? []).filter(e => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown')`);
      for (const ev of v ?? []) {
        const p = ev.params ?? {};
        if (ev.method === 'Runtime.consoleAPICalled') {
          console.log(`[console.${p.type}] ` + (p.args ?? []).map(x => x.value !== undefined ? JSON.stringify(x.value) : x.description ?? x.type).join(' '));
        } else if (ev.method === 'Log.entryAdded') {
          console.log(`[log.${p.entry?.level}] ${p.entry?.text}`);
        } else {
          console.log(`[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`);
        }
      }
      console.log(v?.length ? `（共 ${v.length} 条）` : '（无 console 输出）');
      break;
    }
    case 'net': {
      const sec = Number(a ?? 10);
      const id = await wcId();
      await mainEval(attachExpr(id));
      console.log(`[net] 收集 ${sec} 秒…`);
      await sleep(sec * 1000);
      const v = await mainEval(`(() => {
        const map = new Map();
        for (const e of globalThis.__dshCdp ?? []) {
          const p = e.params ?? {};
          if (e.method === 'Network.requestWillBeSent') {
            const url = p.request?.url ?? '';
            if (/^(data:|blob:)/.test(url)) continue;
            map.set(p.requestId, { url, method: p.request?.method, type: p.type, status: null });
          } else if (e.method === 'Network.responseReceived') {
            const r = map.get(p.requestId);
            if (r) r.status = p.response?.status;
          }
        }
        return [...map.values()].sort((x, y) => (x.status ?? 0) - (y.status ?? 0));
      })()`);
      for (const r of v ?? []) console.log(`  ${String(r.status ?? '…').padStart(3)} ${r.method?.padEnd(6)} ${r.type?.padEnd(12)} ${r.url.slice(0, 140)}`);
      console.log(`（共 ${v?.length ?? 0} 个请求）`);
      break;
    }
    case 'shot': {
      if (!a) fail('用法：shot <file.png>');
      const id = await wcId();
      const b64 = await mainEval(`(async () => {
        const wc = ${ELECTRON}.webContents.fromId(${id});
        const img = await wc.capturePage();
        return img.toPNG().toString('base64');
      })()`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(a, Buffer.from(b64, 'base64'));
      console.log(`[shot] 已保存 ${a}`);
      break;
    }
    default:
      console.log(`用法：node demo/dsh-main.mjs <command> …
  main               枚举窗口 / webContents
  eval   <expr>      主进程执行 JS
  page   <expr>      主窗口页面执行 JS
  health             主窗口一键体检
  attach [wcId]      附着 debugger 并收集事件
  detach [wcId]      分离 debugger
  events [n]         读取收集的事件
  console <sec>      收集 N 秒 console / 异常
  net     <sec>      收集 N 秒网络请求
  shot    <file.png> 主窗口截图
端口默认 9229，可用环境变量 DSH_INSPECT_PORT 覆盖。`);
  }
}

main().catch((e) => fail(e.message));
