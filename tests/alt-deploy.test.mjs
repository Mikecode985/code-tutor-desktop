/**
 * 两个"绕开 workers.dev"的部署版本测试
 *   A. functions/api/chat.js   —— Cloudflare Pages Functions（同源，推荐）
 *   B. local-proxy.mjs         —— 本机 Node 代理（127.0.0.1:8791）
 * 用法：node alt-deploy.test.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================ A. Pages Function ============================ */
const mod = await import('file:///' + path.posix.join(ROOT, 'functions/api/chat.js').replace(/^\/?/, ''));
const fn = mod.default || mod;

const realFetch = globalThis.fetch;   // 保存真实 fetch，B 部分要还原（否则会劫持本机代理的请求）
let captured = null;
function stub(res) {
  captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: init && init.body ? JSON.parse(init.body) : null };
    return res;
  };
}
const ctx = (method, body, headers) => ({
  request: new Request('https://site.pages.dev/api/chat', {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'https://site.pages.dev' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  }),
  env: {}
});
const okJson = () => new Response(JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });

// A1 健康检查
let r = await fn.onRequestGet(ctx('GET'));
let j = await r.json();
check('[Pages Function] GET 健康检查带身份与服务类型', r.status === 200 && j.service === 'codelearn-proxy' && j.deploy === 'pages-function', r.status + ' ' + j.deploy);

// A2 body 里的 key → Authorization 头
stub(okJson());
r = await fn.onRequestPost(ctx('POST', { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-body-key', messages: [{ role: 'user', content: 'hi' }] }));
check('[Pages Function] body.apiKey 转发为 Authorization: Bearer', captured && captured.init.headers.Authorization === 'Bearer sk-body-key', captured && captured.init.headers.Authorization);
check('[Pages Function] 正确转发到 DeepSeek endpoint', captured && captured.url === 'https://api.deepseek.com/v1/chat/completions', captured && captured.url);
check('[Pages Function] 成功返回 200', r.status === 200, r.status);

// A3 同源响应：ACAO 回显来源
check('[Pages Function] 回显 Access-Control-Allow-Origin（同源也带上，便于跨域复用）', r.headers.get('access-control-allow-origin') === 'https://site.pages.dev', r.headers.get('access-control-allow-origin'));

// A4 缺 Key
stub(okJson());
r = await fn.onRequestPost(ctx('POST', { provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }] }));
j = await r.json();
check('[Pages Function] 缺 Key → 401 stage=proxy', r.status === 401 && j.error.stage === 'proxy', r.status);

// A5 上游 401
stub(new Response('Authentication Fails (governor)', { status: 401 }));
r = await fn.onRequestPost(ctx('POST', { provider: 'deepseek', apiKey: 'sk-bad', messages: [{ role: 'user', content: 'hi' }] }));
j = await r.json();
check('[Pages Function] 上游 401 → 透传状态码 + stage=upstream + hint', r.status === 401 && j.error.stage === 'upstream' && /匹配|过期|权限/.test(j.error.hint || ''), r.status + ' ' + j.error.stage);

// A6 未知 provider / 非法 JSON / 空 messages
stub(okJson());
r = await fn.onRequestPost(ctx('POST', { provider: 'zzz', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }] }));
check('[Pages Function] 未知 provider → 400', r.status === 400, r.status);
r = await fn.onRequestPost({ request: new Request('https://site.pages.dev/api/chat', { method: 'POST', body: 'not-json{{{' }), env: {} });
check('[Pages Function] 非法 JSON → 400', r.status === 400, r.status);
r = await fn.onRequestPost(ctx('POST', { provider: 'deepseek', apiKey: 'k', messages: [] }));
check('[Pages Function] 空 messages → 400', r.status === 400, r.status);

// A7 OPTIONS
r = await fn.onRequestOptions(ctx('OPTIONS'));
check('[Pages Function] OPTIONS → 204 + 允许方法', r.status === 204 && /POST/.test(r.headers.get('access-control-allow-methods')), r.status);

// A8 流式透传
const enc = new TextEncoder();
stub(new Response(new ReadableStream({
  start(c) {
    c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: '你' } }] }) + '\n\n'));
    c.enqueue(enc.encode('data: [DONE]\n\n'));
    c.close();
  }
}), { status: 200 }));
r = await fn.onRequestPost(ctx('POST', { provider: 'qwen', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }], stream: true }));
const streamed = await r.text();
check('[Pages Function] 流式请求原样透传 SSE', r.headers.get('content-type').indexOf('text/event-stream') >= 0 && streamed.indexOf('"你"') >= 0, r.headers.get('content-type'));

// A9 max_tokens 上限
stub(okJson());
await fn.onRequestPost({ request: ctx('POST', { provider: 'deepseek', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }], max_tokens: 999999 }).request, env: { MAX_TOKENS_CAP: '4096' } });
check('[Pages Function] max_tokens 被压到 MAX_TOKENS_CAP', captured && captured.body.max_tokens === 4096, captured && captured.body.max_tokens);


// A6 多模态：通了视觉的关键修复（以前 content 被 String() 变成 [object Object]）
stub(okJson());
r = await fn.onRequestPost(ctx('POST', {
  provider: 'qwen', model: 'qwen-vl-max', apiKey: 'sk-q', messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '识别这张图里的文字' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'http://evil.example/x.png' } }
    ]
  }]
}));
const mc = captured && captured.body && captured.body.messages[0].content;
check('[Pages Function] 多模态 content 原样转发（图片不再是 [object Object]）',
  Array.isArray(mc) && mc.length === 2 && mc[0].type === 'text' &&
  mc[1].type === 'image_url' && /^data:image\/jpeg;base64,/.test(mc[1].image_url.url),
  JSON.stringify(mc).slice(0, 90));
check('[Pages Function] 只放行 data:image / https 图片，其余被丢弃',
  JSON.stringify(captured.body.messages[0].content).indexOf('evil') < 0, '');
check('[Pages Function] 转发到通义千问 DashScope 兼容端点',
  captured.url === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', captured.url);
check('[Pages Function] 响应头带视觉诊断（X-Images）', r.headers.get('x-images') === '1', r.headers.get('x-images'));

// A7 429 自动重试一次
let calls = 0;
globalThis.fetch = async () => {
  calls++;
  return calls === 1
    ? new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'Content-Type': 'application/json' } })
    : okJson();
};
r = await fn.onRequestPost(ctx('POST', { provider: 'qwen', apiKey: 'sk-q', messages: [{ role: 'user', content: 'hi' }] }));
check('[Pages Function] 429 自动重试一次后成功', r.status === 200 && calls === 2, 'calls=' + calls + ' status=' + r.status);
check('[Pages Function] 尝试次数写进 X-Upstream-Attempts', r.headers.get('x-upstream-attempts') === '2', r.headers.get('x-upstream-attempts'));

// A8 上游卡住 → 超时 + 504 + 可操作提示
globalThis.fetch = (url, init) => new Promise((res, rej) => {
  const sig = init && init.signal;
  if (sig) sig.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});
r = await fn.onRequestPost({
  request: new Request('https://site.pages.dev/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'qwen', apiKey: 'sk-q', messages: [{ role: 'user', content: 'hi' }] })
  }),
  env: { UPSTREAM_TIMEOUT_MS: '120' }
});
j = await r.json();
check('[Pages Function] 上游卡住 → 504 超时并给出提示',
  r.status === 504 && String(j.error.message).indexOf('没有响应') >= 0 && String(j.error.hint).length > 10,
  r.status + ' | ' + String(j.error.message).slice(0, 46));

// A9 带图片但模型不支持 → 给出「换 qwen-vl / 用本地 OCR」的指引
stub(new Response(JSON.stringify({ error: { message: 'Model does not support image input' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
r = await fn.onRequestPost(ctx('POST', {
  provider: 'qwen', model: 'qwen-plus', apiKey: 'sk-q',
  messages: [{ role: 'user', content: [{ type: 'text', text: '读图' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }] }]
}));
j = await r.json();
check('[Pages Function] 非视觉模型带图 → 提示改用 qwen-vl 或本地 OCR',
  r.status === 400 && String(j.error.hint).indexOf('qwen-vl') >= 0, String(j.error.hint).slice(0, 60));

globalThis.fetch = realFetch;

/* ============================ B. 本机代理 ============================ */
globalThis.fetch = realFetch;   // 还原真实 fetch
const PORT = 8791;
const child = spawn(process.execPath, [path.join(ROOT, 'local-proxy.mjs')], {
  env: Object.assign({}, process.env, { PORT: String(PORT) }),
  stdio: 'ignore'
});

let up = false;
for (let i = 0; i < 40; i++) {
  try { const q = await fetch('http://127.0.0.1:' + PORT); if (q.ok) { up = true; break; } } catch (e) { /* 还没起来 */ }
  await sleep(250);
}
check('[本机代理] 进程启动并监听 127.0.0.1:' + PORT, up, up ? 'ok' : '未起来');

let h = null;
if (up) {
  const res = await fetch('http://127.0.0.1:' + PORT + '/', { headers: { Origin: 'https://code-tutor-site.pages.dev' } });
  h = await res.json();
  check('[本机代理] GET 健康检查带 deploy=local-node', h.service === 'codelearn-proxy' && h.deploy === 'local-node', h.deploy);
  check('[本机代理] 回显来源 CORS 头（https 页面才能读到响应）',
    res.headers.get('access-control-allow-origin') === 'https://code-tutor-site.pages.dev', res.headers.get('access-control-allow-origin'));

  const bad = await fetch('http://127.0.0.1:' + PORT + '/', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://code-tutor-site.pages.dev' },
    body: JSON.stringify({ provider: 'zzz', messages: [{ role: 'user', content: 'hi' }] })
  });
  check('[本机代理] 未知 provider → 400', bad.status === 400, bad.status);

  const nokey = await fetch('http://127.0.0.1:' + PORT + '/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }] })
  });
  const nk = await nokey.json();
  check('[本机代理] 缺 Key → 401 stage=proxy', nokey.status === 401 && nk.error.stage === 'proxy', nokey.status);

  const opt = await fetch('http://127.0.0.1:' + PORT + '/', { method: 'OPTIONS', headers: { Origin: 'https://x.dev' } });
  check('[本机代理] OPTIONS → 204', opt.status === 204, opt.status);

  // 真实验证：用一个明显无效的 Key 打 DeepSeek，确认端到端链路（应得到 401 而不是网络错误）
  const real = await fetch('http://127.0.0.1:' + PORT + '/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'deepseek', apiKey: 'sk-invalid-for-test', messages: [{ role: 'user', content: 'hi' }], stream: false })
  });
  const rt = await real.text();
  let rj = null; try { rj = JSON.parse(rt); } catch (e) {}
  const upstreamReached = real.status === 401 && rj && rj.error && rj.error.stage === 'upstream';
  check('[本机代理] 端到端连通 DeepSeek（假 Key 得到上游 401 而不是网络错误）', upstreamReached,
    real.status + ' ' + (rj && rj.error ? rj.error.message.slice(0, 90) : rt.slice(0, 90)));
  if (rj && rj.error) console.log('\n  ↳ 本机代理打到 DeepSeek 的真实回执: ' + JSON.stringify(rj.error.message.slice(0, 110)));
  console.log('  ↳ 说明本机网络可以直连 api.deepseek.com（这一点决定了"本机代理"方案可用）\n');
}

try { child.kill(); } catch (e) {}

/* ============================ 输出 ============================ */
const failed = results.filter(r => !r.pass);
console.log('\n========== 备选部署方式测试（Pages Function + 本机代理）==========');
results.forEach((r, i) => console.log(String(i + 1).padStart(3) + '. ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   → ' + JSON.stringify(r.detail))));
console.log('\n结论: ' + (failed.length === 0 ? '全部 ' + results.length + ' 项通过 ✅' : failed.length + ' 项失败 ❌'));
process.exit(failed.length === 0 ? 0 : 1);
