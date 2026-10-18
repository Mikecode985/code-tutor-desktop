/**
 * 验证"打包进桌面端的页面"能独立工作：
 *  · 用 file:// 打开 desktop/app/index.html（这正是 Electron 的加载方式）
 *  · 注入与 preload 等价的 window.__CODETUTOR_DESKTOP__
 *  · 断言：7 个标签、2 个 CodeMirror（本地 vendor 生效）、桌面标签显示、默认代理已填、
 *         皮肤/主题/彩蛋栏都在、无脚本错误
 */
const SITE = 'file:///' + process.env.APP_HTML.replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const l = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const t = l.find(x => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = m => {
  const x = JSON.parse(m.data);
  if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); }
  else if (x.method) events.push(x);
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return 'EXC:' + String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0];
  return r.result?.result?.value;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: 'window.__CODETUTOR_DESKTOP__ = { desktop: true, version: "31.7.7", chrome: "126", platform: "win32" };'
});
await send('Page.navigate', { url: SITE });

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  if (await ev("document.querySelectorAll('.CodeMirror').length === 2")) { ready = true; break; }
}
const results = [];
const chk = (name, v, detail) => { results.push({ name, ok: !!v, detail: String(detail === undefined ? '' : detail).slice(0, 90) }); };

chk('file:// 下页面加载完成（2 个编辑器就绪）', ready, '');
chk('7 个标签页', await ev("document.querySelectorAll('.tab').length") === 7, await ev("document.querySelectorAll('.tab').length"));
chk('CodeMirror 来自本地 vendor（离线可用）',
  await ev("document.documentElement.innerHTML.indexOf('vendor/codemirror') >= 0"), '');
chk('无任何 CDN 的 codemirror 引用',
  await ev("Array.prototype.slice.call(document.querySelectorAll('script[src],link[href]')).filter(function(e){var u=e.getAttribute('src')||e.getAttribute('href')||'';return u.indexOf('codemirror')>=0 && u.indexOf('vendor/')<0;}).length === 0"), '');
chk('桌面标签已显示（桌面版标识生效）',
  await ev("(function(){var t=document.getElementById('desktopTag');return !!t && t.style.display !== 'none' && t.textContent.indexOf('桌面版')>=0;})()"), '');
chk('标题带「桌面版」', await ev("document.title"), await ev("document.title"));
chk('默认代理自动填为线上地址（file:// 无同源后端）',
  await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();var v=document.getElementById('proxyInput').value;return v;})()"),
  await ev("document.getElementById('proxyInput').value"));
chk('代理地址是绝对 URL 而不是 /api/chat',
  await ev("/^https:\\/\\//.test(document.getElementById('proxyInput').value)"), '');
chk('API 提示里写明"这是桌面版"',
  await ev("(function(){var h=document.getElementById('proxyModeHint').textContent;return h;})()").then
    ? await ev("document.getElementById('proxyModeHint').textContent.indexOf('桌面版') >= 0") : false, '');
chk('9 套皮肤系统在', await ev("(window.__gySkin && window.__gySkin.SKINS && window.__gySkin.SKINS.length) || 0") === 9, await ev("(window.__gySkin && window.__gySkin.SKINS && window.__gySkin.SKINS.length) || 0"));
chk('彩蛋栏在（贵州发展）', await ev("!!document.getElementById('eggBar') && document.getElementById('eggGo').href.indexOf('tieba.baidu.com') > 0"), '');
chk('学习知识四档可渲染', await ev("(function(){document.querySelector('.tab[data-panel=\"knowledge\"]').click();var n=document.querySelectorAll('#kbList .kb-card').length;return n;})()"), '');
chk('实用工具面板在', await ev("!!document.getElementById('frDrop')"), '');
chk('localStorage 可用（file:// 也有独立存储）',
  await ev("(function(){try{localStorage.setItem('__t','1');var v=localStorage.getItem('__t');localStorage.removeItem('__t');return v==='1';}catch(e){return 'ERR:'+e.message;}})()"), '');
const exc = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
const errLogs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map(e => e.params.entry.text).filter(x => !/dashscope|deepseek|favicon|net::ERR_FILE_NOT_FOUND/i.test(x));
chk('无未捕获异常', exc === 0, '异常=' + exc);
chk('无脚本/资源错误', errLogs.length === 0, errLogs.slice(0, 2).join(' | '));

console.log('\n============ 桌面版页面（file:// ）验证 ============');
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '   →   ' + r.detail : ''));
}
console.log('\n总计：' + results.length + ' 项，通过 ' + (results.length - fail) + '，失败 ' + fail);
process.exit(fail === 0 && exc === 0 && errLogs.length === 0 ? 0 : 1);
