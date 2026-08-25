#!/usr/bin/env node
// 零依赖 CDP 客户端（Node >= 22，用内置 WebSocket/fetch）
//
// 用法：
//   node demo/cdp.mjs targets [port]                      列出所有调试目标
//   node demo/cdp.mjs eval  <target> <expression> [port]  在目标页面里执行 JS 并打印返回值
//   node demo/cdp.mjs tree  <target> [port]               打印页面 DOM 概要（tag#id.class [attrs]）
//   node demo/cdp.mjs shot  <target> <out.png> [port]     页面截图（.png/.jpg）
//   node demo/cdp.mjs console <target> [port]             持续打印 console / Log 事件（Ctrl+C 退出）
//   node demo/cdp.mjs send  <target> <method> [jsonParams] 任意 CDP 命令透传
//
// <target> 匹配规则：完整/前缀 id，或 title/url 子串，或数字下标（targets 列表顺序）。
// 默认端口 9222（渲染进程 CDP）；传 9229 可连主进程 --inspect 的 Node inspector 目标。
//
// 示例：
//   node demo/cdp.mjs targets
//   node demo/cdp.mjs eval  0 "document.title"
//   node demo/cdp.mjs eval  "liuli" "document.querySelectorAll('[data-dock-node]').length"
//   node demo/cdp.mjs shot  0 /tmp/dsh.png

const PORT = Number(process.argv[process.argv.length - 1]) || 9222;

function fail(msg) {
  console.error(`[cdp] ${msg}`);
  process.exit(1);
}

async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) fail(`/json/list HTTP ${res.status}（DSH Desktop 是否已带调试端口启动？）`);
  return res.json();
}

/** 按 id / 子串 / 下标 解析目标。 */
function resolveTarget(targets, key) {
  if (/^\d+$/.test(key)) {
    const idx = Number(key);
    if (idx < targets.length) return targets[idx];
    fail(`下标 ${idx} 越界，共 ${targets.length} 个目标`);
  }
  const byId = targets.find(t => t.id === key || t.id.startsWith(key));
  if (byId) return byId;
  const needle = key.toLowerCase();
  const byText = targets.find(t =>
    (t.title || '').toLowerCase().includes(needle) ||
    (t.url || '').toLowerCase().includes(needle));
  if (byText) return byText;
  fail(`找不到目标 "${key}"；可用 targets 命令查看列表`);
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

async function withTarget(fn, { port = PORT, targetKey } = {}) {
  const targets = await listTargets(port);
  const t = resolveTarget(targets, targetKey);
  const cdp = new Cdp(t.webSocketDebuggerUrl);
  await cdp.open();
  try {
    return await fn(cdp, t);
  } finally {
    cdp.close();
  }
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  const port = PORT; // 已从末尾解析

  switch (cmd) {
    case 'targets': {
      const targets = await listTargets(port);
      console.log(`端口 ${port} 共 ${targets.length} 个目标:`);
      targets.forEach((t, i) => {
        console.log(`  [${i}] ${t.type}  id=${t.id}`);
        console.log(`       title=${(t.title || '').slice(0, 80)}`);
        console.log(`       url=${(t.url || '').slice(0, 110)}`);
      });
      break;
    }
    case 'eval': {
      if (!b) fail('用法：eval <target> <expression> [port]');
      await withTarget(async (cdp) => {
        const r = await cdp.send('Runtime.evaluate', {
          expression: b,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        });
        if (r.exceptionDetails) {
          console.error('[cdp] 执行出错:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text, null, 2));
          process.exitCode = 1;
        } else {
          console.log(JSON.stringify(r.result?.value, null, 2));
        }
      }, { port, targetKey: a });
      break;
    }
    case 'tree': {
      const expr = `(() => {
        const out = [];
        const MAX = 2000;
        let count = 0;
        const walk = (el, depth) => {
          if (count >= MAX) return;
          count++;
          let s = '  '.repeat(Math.min(depth, 12)) + el.tagName.toLowerCase();
          if (el.id) s += '#' + el.id;
          const cls = [...el.classList].slice(0, 3).join('.');
          if (cls) s += '.' + cls;
          for (const attr of ['data-testid', 'data-dock-node', 'data-region-pane', 'data-side', 'role', 'aria-label', 'href', 'src', 'placeholder']) {
            const v = el.getAttribute(attr);
            if (v) s += ' [' + attr + '=' + (v.length > 40 ? v.slice(0, 40) + '…' : v) + ']';
          }
          out.push(s);
          for (const ch of el.children) walk(ch, depth + 1);
        };
        walk(document.body, 0);
        return out;
      })()`;
      await withTarget(async (cdp) => {
        const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
        if (r.exceptionDetails) fail('DOM 遍历出错: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
        console.log(r.result.value.join('\n'));
      }, { port, targetKey: a });
      break;
    }
    case 'shot': {
      if (!b) fail('用法：shot <target> <out.png|out.jpg> [port]');
      await withTarget(async (cdp) => {
        await cdp.send('Page.enable');
        const isJpg = /\.jpe?g$/i.test(b);
        const r = await cdp.send('Page.captureScreenshot', {
          format: isJpg ? 'jpeg' : 'png',
          ...(isJpg ? { quality: 82 } : {}),
          captureBeyondViewport: false,
        });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(b, Buffer.from(r.data, 'base64'));
        console.log(`已保存 ${b}`);
      }, { port, targetKey: a });
      break;
    }
    case 'console': {
      if (!a) fail('用法：console <target> [port]');
      await withTarget(async (cdp) => {
        await cdp.send('Runtime.enable');
        await cdp.send('Log.enable');
        const fmt = (p) => {
          const parts = (p.args ?? []).map(x => x.value !== undefined ? JSON.stringify(x.value) : x.description ?? x.type);
          return parts.join(' ');
        };
        cdp.onEvent((method, p) => {
          if (method === 'Runtime.consoleAPICalled') {
            console.log(`[console.${p.type}] ${fmt(p)}`);
          } else if (method === 'Log.entryAdded') {
            console.log(`[log.${p.entry.level}] ${p.entry.text}`);
          } else if (method === 'Runtime.exceptionThrown') {
            console.log(`[exception] ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
          }
        });
        console.log('监听 console / Log / exception，Ctrl+C 退出…');
        await new Promise(() => {});
      }, { port, targetKey: a });
      break;
    }
    case 'send': {
      if (!b) fail('用法：send <target> <method> [jsonParams] [port]');
      await withTarget(async (cdp) => {
        const params = c ? JSON.parse(c) : {};
        const r = await cdp.send(b, params);
        console.log(JSON.stringify(r, null, 2));
      }, { port, targetKey: a });
      break;
    }
    default:
      console.log(`用法：node demo/cdp.mjs <command> …
  targets                      列出目标（node demo/cdp.mjs targets 9229 看主进程 inspector）
  eval   <target> <expr>       执行 JS
  tree   <target>              打印 DOM 概要
  shot   <target> <out.png>    截图
  console <target>             监听 console 事件
  send   <target> <method> [params]   任意 CDP 命令`);
  }
}

main().catch((e) => fail(e.message));
