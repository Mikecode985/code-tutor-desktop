/**
 * 用真实 Chrome 从【公网 https 页面】请求【本机 http://127.0.0.1:8787】，
 * 复现用户的 "Failed to fetch"，并把浏览器的原始报错抓出来
 * （重点：是否命中 Chrome 的 Private Network Access 策略）
 */
import fs from 'node:fs';
const SITE = 'https://code-tutor-site.pages.dev';
const PROXY = 'http://127.0.0.1:8787';
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

// 用更精确的 Browser.setPermission 授予"本地网络访问"（等价于用户点「允许」）
let granted = '不支持';
for (const name of ['localNetworkAccess', 'local-network-access', 'private-network-access']) {
  const r = await send('Browser.setPermission', { origin: SITE, permission: { name }, setting: 'granted' });
  if (!r.error) { granted = name; break; }
}
console.log('Browser.setPermission 授予结果: ' + granted);

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

console.log('加载线上站点: ' + SITE);
const loaded = new Promise(res => { const iv = setInterval(() => { if (events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(iv); res(); } }, 100); setTimeout(() => { clearInterval(iv); res(); }, 25000); });
await send('Page.navigate', { url: SITE });
await loaded;
await sleep(3000);

const title = await ev('document.title + " | 代码行数=" + document.documentElement.innerHTML.length');
console.log('页面已加载: ' + title);

// 直接在该页面的上下文里做一次 fetch，拿到浏览器层面的真实错误
const direct = await ev(`(async function(){
  try {
    var t0 = Date.now();
    var r = await fetch(${JSON.stringify(PROXY)}, { method: 'GET' });
    var txt = await r.text();
    return 'OK status=' + r.status + ' 耗时=' + (Date.now()-t0) + 'ms body=' + txt.slice(0,80);
  } catch (e) { return 'THROW ' + e.name + ': ' + e.message; }
})()`);
console.log('\n[页面内 direct fetch 结果] ' + direct);

// 再走一遍用户的操作路径
await ev(`(function(){
  function set(id,v){var e=document.getElementById(id); if(!e) return; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
  var tab=document.querySelector('.tab[data-panel="api"]'); if(tab) tab.click();
  set('proxyInput', ${JSON.stringify(PROXY)});
  set('apiKeyInput','sk-dummy-for-diagnosis');
})()`);
await sleep(200);
await ev(`document.getElementById('testApiBtn').click()`);
await sleep(4000);
const uiMsg = await ev(`document.getElementById('apiTestResult') ? document.getElementById('apiTestResult').textContent : '(无结果区)'`);
console.log('[页面上显示的报错]\n  ' + String(uiMsg).replace(/\s*\n\s*/g, '\n  '));

// 抓浏览器控制台里与网络/安全策略相关的信息
console.log('\n[浏览器控制台 / 网络错误]');
const NET = events.filter(e => e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown' ||
  (e.method === 'Network.loadingFailed'));
let n = 0;
for (const e of NET) {
  const txt = e.method === 'Network.loadingFailed'
    ? 'loadingFailed: ' + (e.params.errorText || '') + (e.params.corsErrorStatus ? ' | CORS: ' + JSON.stringify(e.params.corsErrorStatus) : '')
    : (e.params.entry ? e.params.entry.text : (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text || ''));
  if (!txt) continue;
  if (/127\.0\.0\.1|Private Network|private network|CORS|cors|Failed to fetch|ERR_/.test(txt)) {
    console.log('  · ' + txt.replace(/\s*\n\s*/g, ' ').slice(0, 400));
    n++;
  }
}
if (!n) console.log('  (无相关记录)');

// 抓 127.0.0.1 相关请求的完整生命史
console.log('\n[对 127.0.0.1 的请求流水]');
for (const e of events) {
  if (e.method === 'Network.requestWillBeSent' && String(e.params.request.url).indexOf('127.0.0.1') >= 0) {
    console.log('  → ' + e.params.request.method + ' ' + e.params.request.url +
      (e.params.request.headers['Access-Control-Request-Private-Network'] ? '  [带 PNA 预检头]' : ''));
  }
  if (e.method === 'Network.responseReceived' && String(e.params.response.url).indexOf('127.0.0.1') >= 0) {
    console.log('  ← ' + e.params.response.status + ' ' + e.params.response.url);
  }
  if (e.method === 'Network.loadingFailed' && events.some(x => x.method === 'Network.requestWillBeSent' && x.params.requestId === e.params.requestId && String(x.params.request.url).indexOf('127.0.0.1') >= 0)) {
    console.log('  ✗ 失败: ' + e.params.errorText + '  blockedReason=' + (e.params.blockedReason || '-') + '  corsError=' + JSON.stringify(e.params.corsErrorStatus || null));
  }
}

ws.close();
process.exit(0);
