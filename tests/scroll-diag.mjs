/**
 * 诊断工具：桌面端对话区能不能向下滚动
 * 量 scrollHeight/clientHeight + 实际设置 scrollTop，定位「滚动链断了」这类问题。
 * 用法：起 headless Chrome（9222）后 node scroll-diag.mjs
 */
const SITE = process.env.AUDIT_SITE || 'https://code-tutor-site.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9222/json/list')).json(); const t = l.find(x => x.type === 'page'); if (t) return t; } catch {} await sleep(250); }
  throw new Error('CDP 不可用');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return 'EXC:' + String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0];
  return r.result?.result?.value;
};
await send('Page.enable'); await send('Runtime.enable');

// 用桩塞一段长对话（不需要真 Key）
const STUB = `(function(){
  var long = '';
  for (var i = 1; i <= 14; i++) long += '### 第 ' + i + ' 段\\n这是用来测试滚动的长回复内容，第 ' + i + ' 行。\\n\\n- 要点一\\n- 要点二\\n- 要点三\\n\\n';
  window.fetch = function(url, init){
    if (!init || init.method === 'GET') return Promise.resolve(new Response(JSON.stringify({ok:true,service:'codelearn-proxy',version:'1.1.0'}), {status:200,headers:{'Content-Type':'application/json'}}));
    var b = JSON.parse(init.body||'{}');
    var stream = new ReadableStream({ start: function(c){ c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:long}}]})+'\\n\\n')); c.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n')); c.close(); }});
    return Promise.resolve(new Response(stream, {status:200, headers:{'Content-Type':'text/event-stream'}}));
  };
})();`;
const add = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await send('Page.navigate', { url: SITE + '/?diag=' + Date.now() });
await sleep(3500);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// 填 key + 发一条消息，制造长内容
await ev("(function(){var k=document.getElementById('apiKeyInput');k.value='sk-diag';k.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('chatInput').value='给我一段很长的讲解';})()");
await ev("document.getElementById('chatSendBtn').click()");
await sleep(1500);

const report = await ev(`(function(){
  function info(sel){
    var e = document.querySelector(sel);
    if (!e) return { sel: sel, missing: true };
    var cs = getComputedStyle(e);
    var r = e.getBoundingClientRect();
    return { sel: sel,
      cls: e.className,
      h: Math.round(r.height), w: Math.round(r.width),
      clientH: e.clientHeight, scrollH: e.scrollHeight,
      overflowY: cs.overflowY, minHeight: cs.minHeight, flex: cs.flex, display: cs.display,
      position: cs.position, height: cs.height,
      canScroll: e.scrollHeight > e.clientHeight + 2
    };
  }
  var body = document.getElementById('chatBody');
  var before = body.scrollTop;
  body.scrollTop = 99999;
  var after = body.scrollTop;
  return JSON.stringify({
    viewportH: window.innerHeight,
    docScrollable: document.documentElement.scrollHeight > window.innerHeight + 2,
    bodyScrollTest: { before: before, after: after, max: body.scrollHeight - body.clientHeight },
    chain: ['#panel-chat', '.chat-shell', '.chat-main', '.chat-body-wrap', '#chatBody', '.chat-compose'].map(info),
    msgCount: document.querySelectorAll('#chatBody .msg').length,
    lastMsgBottom: (function(){ var m = document.querySelectorAll('#chatBody .msg'); if(!m.length) return null; var r = m[m.length-1].getBoundingClientRect(); var b = document.getElementById('chatBody').getBoundingClientRect(); return { msgBottom: Math.round(r.bottom), bodyBottom: Math.round(b.bottom), clipped: Math.round(r.bottom - b.bottom) }; })()
  }, null, 1);
})()`);
console.log(report);
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: add.result.identifier });
process.exit(0);
