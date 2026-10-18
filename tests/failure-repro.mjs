/**
 * 故障现场复现：用本地 mock 精确模拟用户线上那个 Worker 的响应
 *   （实测到的原始行为：GET/POST 一律 401 + 纯文本 "Authentication Fails (governor)"，OPTIONS 200 空 body，无 X-Proxy 头）
 * 然后驱动新版前端点「测试连接」，验证自检能否准确定位问题，并截图取证。
 *
 * 为什么用 mock：本机沙箱里的 headless Chrome 连不上 workers.dev（ERR_CONNECTION_TIMED_OUT），
 * 对真实地址的行为结论由 Node 直连探针给出（_diag*.mjs）。
 *
 * 用法：node failure-repro.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT_PAGE = 8899;   // 静态页服务
const PORT_MOCK = 8898;   // 模拟"装错脚本的 Worker"

/* ---------- 1) 模拟用户线上 Worker 的行为（照实测复刻）---------- */
const mock = http.createServer((req, res) => {
  const h = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(200, h); return res.end(); }
  // GET / POST 一律 401 + 纯文本，且不带任何身份头
  res.writeHead(401, Object.assign({ 'Content-Type': 'text/plain' }, h));
  res.end('Authentication Fails (governor)');
});
await new Promise(r => mock.listen(PORT_MOCK, '127.0.0.1', r));

/* ---------- 2) 静态页服务（模拟 Pages 的 http 源）---------- */
const page = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(ROOT + '/index.html'));
  }
  res.writeHead(404); res.end('not found');
});
await new Promise(r => page.listen(PORT_PAGE, '127.0.0.1', r));

/* ---------- 3) CDP 驱动浏览器 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const t = l.find(x => x.type === 'page');
      if (t) return t;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 不可用');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } else if (x.method) events.push(x); };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 1000, deviceScaleFactor: 2, mobile: false });
const loaded = new Promise(res => { const iv = setInterval(() => { if (events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(iv); res(); } }, 100); setTimeout(() => { clearInterval(iv); res(); }, 20000); });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_PAGE}/index.html` });
await loaded;
await sleep(2500);
await ev(`(function(){var st=document.createElement('style');st.textContent='.topbar{position:static !important}';document.head.appendChild(st);})()`);

// 填入"用户那套配置"：地址指向模拟的坏 Worker，Key 填一个格式正确的值
await ev(`(function(){
  function set(id,v){var e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
  document.querySelector('.tab[data-panel="api"]').click();
  set('proxyInput','http://127.0.0.1:${PORT_MOCK}');
  set('apiKeyInput','sk-1234567890abcdef1234567890abcdef');
})()`);
await sleep(200);
await ev(`document.getElementById('testApiBtn').click()`);
await sleep(3500);

const text = await ev(`document.getElementById('apiTestResult').textContent`);
const checks = [
  ['自检识别出「不是本项目的 Worker」', text.includes('跑的不是本项目的 Worker')],
  ['原样展示了代理返回的内容供定位', text.includes('Authentication Fails (governor)')],
  ['给出了"是否粘贴了 cloudflare-proxy.js"的指引', text.includes('cloudflare-proxy.js')],
  ['给出了"地址是否与控制台一致"的指引', text.includes('完全一致')],
  ['第 2 步失败信息也指向非本项目 Worker', text.includes('模型调用失败') && text.includes('cloudflare-proxy.js')],
  ['没有把锅甩给用户的 Key（不再只说 401 认证失败）', !/^认证失败（401）/.test(text)]
];

console.log('\n======= 新版「测试连接」在故障现场的实际输出 =======');
console.log(text.replace(/\s*\n\s*/g, '\n'));
console.log('\n======= 判定 =======');
checks.forEach(([n, ok]) => console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + n));

const errs = events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
console.log('  页面错误: ' + (errs.length ? errs.map(e => (e.params.exceptionDetails?.exception?.description || e.params.entry?.text || '').split('\n')[0]).join(' | ') : '无'));

const m = await send('Page.getLayoutMetrics');
const clip = { x: 0, y: 0, width: Math.ceil(m.result.cssContentSize.width), height: Math.min(Math.ceil(m.result.cssContentSize.height), 2400), scale: 1 };
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
fs.writeFileSync(ROOT + '/preview-5-proxy-check.png', Buffer.from(shot.result.data, 'base64'));
console.log('\n截图: preview-5-proxy-check.png = ' + fs.statSync(ROOT + '/preview-5-proxy-check.png').size + 'B');

ws.close(); mock.close(); page.close();
process.exit(checks.every(c => c[1]) && errs.length === 0 ? 0 : 1);
