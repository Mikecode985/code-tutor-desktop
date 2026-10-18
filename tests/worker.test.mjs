/**
 * cloudflare-proxy.js 单元测试
 * 用桩替换全局 fetch 来捕获"转发给上游的请求"，验证：
 *   1. GET 健康检查带 service/version 身份标识
 *   2. body.apiKey 会被放进 Authorization: Bearer 头转发
 *   3. Authorization 头里的 key 也能被接受（兼容另一种客户端写法）
 *   4. 缺 Key → 401 且 stage=proxy
 *   5. 上游 401 → 原样透传状态码，并带 stage=upstream / key_source / hint
 *   6. Origin 白名单拦截、OPTIONS 预检、非法 provider、非法 JSON
 * 用法：node worker.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT_DIR, 'cloudflare-proxy.js'), 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'));
const worker = mod.default;

const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }

let captured = null;
function stubFetch(response) {
  captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: init && init.body ? JSON.parse(init.body) : null };
    return response;
  };
}
const req = (method, body, headers) => new Request('https://p.example.com/api/chat', {
  method,
  headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
});
const ENV = { ALLOWED_ORIGINS: 'https://site.pages.dev' };
const ORIGIN = { Origin: 'https://site.pages.dev' };

/* 1. 健康检查 */
stubFetch(new Response('{}'));
let r = await worker.fetch(req('GET'), ENV);
let j = await r.json();
check('GET 健康检查返回 200 + service 标识', r.status === 200 && j.service === 'codelearn-proxy', r.status + ' ' + j.service);
check('健康检查带版本号（前端自检要比对它）', j.version === '1.1.0', j.version);
check('响应带 X-Proxy 指纹头', r.headers.get('X-Proxy') === 'codelearn-proxy', r.headers.get('X-Proxy'));
check('GET 不消耗任何上游请求', captured === null, captured ? '有上游请求' : '无');

/* 2. 密钥来自 body → 放进 Authorization 头 */
stubFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
r = await worker.fetch(req('POST', { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'sk-from-body-123', messages: [{ role: 'user', content: 'hi' }] }, ORIGIN), ENV);
check('body.apiKey 被转发为 Authorization: Bearer（旧版 Worker 的致命缺陷）',
  captured && captured.init.headers.Authorization === 'Bearer sk-from-body-123', captured && captured.init.headers.Authorization);
check('转发到 DeepSeek 官方 endpoint', captured && captured.url === 'https://api.deepseek.com/v1/chat/completions', captured && captured.url);
check('成功响应原样回吐 200', r.status === 200, r.status);

/* 3. 密钥来自 Authorization 头（兼容写法） */
stubFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
await worker.fetch(req('POST', { provider: 'qwen', messages: [{ role: 'user', content: 'hi' }] },
  Object.assign({ Authorization: 'Bearer sk-from-header-456' }, ORIGIN)), ENV);
check('Authorization 头里的 Key 也能被接受（key_source=header）',
  captured && captured.init.headers.Authorization === 'Bearer sk-from-header-456', captured && captured.init.headers.Authorization);
check('qwen 转发到 DashScope endpoint',
  captured && captured.url.indexOf('dashscope.aliyuncs.com') >= 0, captured && captured.url);

/* 4. 缺 Key */
stubFetch(new Response('{}'));
r = await worker.fetch(req('POST', { provider: 'deepseek', messages: [{ role: 'user', content: 'hi' }] }), ENV);
j = await r.json();
check('缺 Key 时由代理自己返回 401 且 stage=proxy',
  r.status === 401 && j.error && j.error.stage === 'proxy', r.status + ' ' + (j.error && j.error.stage));

/* 5. 上游 401 → 透传 + 诊断信息 */
stubFetch(new Response('Authentication Fails (governor)', { status: 401 }));
r = await worker.fetch(req('POST', { provider: 'deepseek', apiKey: 'sk-bad', messages: [{ role: 'user', content: 'hi' }] }), ENV);
j = await r.json();
check('上游 401 原样透传状态码', r.status === 401, r.status);
check('上游错误带 stage=upstream（能区分"代理坏"还是"Key 被拒"）',
  j.error && j.error.stage === 'upstream', j.error && j.error.stage);
check('上游错误带 key_source 与排查 hint',
  j.error && j.error.key_source === 'body' && /匹配|过期|权限/.test(j.error.hint || ''), j.error && j.error.key_source);
check('纯文本上游错误也被包成 JSON（前端才能解析）',
  typeof j.error.message === 'string' && j.error.message.indexOf('Authentication Fails') >= 0, j.error.message);

/* 6. 其它边界 */
stubFetch(new Response('{}'));
r = await worker.fetch(req('OPTIONS', undefined, Object.assign({ 'Access-Control-Request-Method': 'POST' }, ORIGIN)), ENV);
check('OPTIONS 预检返回 204 且带允许方法', r.status === 204 && /POST/.test(r.headers.get('Access-Control-Allow-Methods')), r.status);

r = await worker.fetch(req('POST', { provider: 'nope', apiKey: 'x', messages: [{ role: 'user', content: 'hi' }] }, ORIGIN), ENV);
j = await r.json();
check('未知 provider 返回 400', r.status === 400 && /不支持的服务商/.test(j.error.message), r.status);

r = await worker.fetch(req('POST', 'not-json{{{', ORIGIN), ENV);
j = await r.json();
check('非法 JSON 返回 400', r.status === 400 && /不是合法 JSON/.test(j.error.message), r.status);

r = await worker.fetch(req('POST', { provider: 'deepseek', apiKey: 'k', messages: [] }, ORIGIN), ENV);
check('空 messages 返回 400', r.status === 400, r.status);

r = await worker.fetch(req('POST', { provider: 'deepseek', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }] }, { Origin: 'https://evil.com' }), ENV);
j = await r.json();
check('非白名单 Origin 被 403 拦截', r.status === 403 && /白名单/.test(j.error.message), r.status);

r = await worker.fetch(req('GET'), {});
j = await r.json();
check('未配置 ALLOWED_ORIGINS 时默认放行（*）', r.status === 200, r.status);

/* 7. max_tokens 上限保护 */
stubFetch(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
await worker.fetch(req('POST', { provider: 'deepseek', apiKey: 'k', messages: [{ role: 'user', content: 'hi' }], max_tokens: 999999 }, ORIGIN), { ALLOWED_ORIGINS: 'https://site.pages.dev', MAX_TOKENS_CAP: '8192' });
check('max_tokens 被压到 MAX_TOKENS_CAP 以内', captured && captured.body.max_tokens === 8192, captured && captured.body.max_tokens);

/* 8. 前端字段白名单：apiKey 不会被转发到上游 body */
check('apiKey 不会被塞进上游请求体（只进请求头）',
  captured && captured.body.apiKey === undefined, captured && JSON.stringify(captured.body).slice(0, 80));

const failed = results.filter(r => !r.pass);
console.log('\n============== cloudflare-proxy.js 单元测试 ==============');
results.forEach((r, i) => console.log(String(i + 1).padStart(3) + '. ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   → ' + JSON.stringify(r.detail))));
console.log('\n结论: ' + (failed.length === 0 ? '全部 ' + results.length + ' 项通过 ✅' : failed.length + ' 项失败 ❌'));
process.exit(failed.length === 0 ? 0 : 1);
