/**
 * ============================================================================
 * local-proxy.mjs — CodeTutor 代理的【本机版】（无需任何云服务）
 * ============================================================================
 *
 * 【什么时候用它】
 * 当 `*.workers.dev` 被 DNS 污染 / SNI 阻断（前端报 "Failed to fetch"），
 * 而你只想自己赶紧用起来时：在**你自己的电脑上**跑这个脚本即可。
 *
 * 【用法】
 *   1. 确认电脑装了 Node 18+（本机已是 Node 24）：node -v
 *   2. 在本文件所在目录执行：
 *          node local-proxy.mjs
 *      看到 "本机代理已启动 http://127.0.0.1:8787" 即成功。保持这个窗口开着。
 *   3. 回到网站【API 设置】页，把「代理地址」填成：
 *          http://127.0.0.1:8787
 *      点「测试连接」应显示：代理自检通过（codelearn-proxy v1.1.0） + 模型连通性正常
 *
 * 【⚠️ 重要：新版 Chrome/Edge 需要"本地网络访问"授权】
 *   Chrome 147+ / Edge 147+ 引入了 Local Network Access 策略：**公网 https 页面**
 *   （如 https://xxx.pages.dev）访问 **本机 127.0.0.1** 时，必须由用户显式授权，
 *   否则浏览器会直接掐掉请求，前端只显示 "Failed to fetch"。
 *   浏览器控制台原文：
 *       Access to fetch at 'http://127.0.0.1:8787/' ... has been blocked by CORS policy:
 *       Permission was denied for this request to access the `loopback` address space.
 *       net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS  (LocalNetworkAccessPermissionDenied)
 *
 *   两种处理方式（二选一）：
 *     ① 授权：点「测试连接」时，地址栏附近会弹出"访问本地网络上的设备"提示 → 点【允许】；
 *        若没有弹窗或被误拒：点地址栏左侧的图标 → 网站设置 → 找到「本地网络访问 /
 *        Local network access」→ 改为【允许】→ 刷新页面重试。
 *        （本脚本已按规范返回 Access-Control-Allow-Private-Network: true，服务端无需再改）
 *     ② 绕开：直接改用同源方案 —— 把 functions/api/chat.js 用 `wrangler pages deploy`
 *        部署到你的 Pages 项目，代理地址填 /api/chat。同域请求不触发 LNA，也无需授权，
 *        更不需要本脚本常驻。**推荐**。
 *
 *   Firefox 未实施该策略，用它打开站点可直接使用本机代理。
 *
 * 【为什么 https 的网站能访问 http://127.0.0.1】
 *   浏览器把 127.0.0.1 / localhost 视为"潜在可信来源"，不受混合内容（Mixed Content）拦截；
 *   但受上面那条"本地网络访问"权限管辖。
 *
 * 【安全性】
 *   · 只监听 127.0.0.1，局域网内其它设备访问不到（不要改成 0.0.0.0，除非你清楚风险）。
 *   · 不写文件、不打印密钥、不记录请求内容；密钥只在内存里拼成 Authorization 头转发出去。
 *   · 默认只允许你的站点来源（见 ALLOW_ORIGINS 白名单），可用环境变量覆盖：
 *         set ALLOW_ORIGINS=https://code-tutor-site.pages.dev   (Windows CMD)
 *         $env:ALLOW_ORIGINS="https://code-tutor-site.pages.dev" (PowerShell)
 *     设为 * 表示不限制来源（本机自用也无妨，因为外部访问不到）。
 *
 * 【可选环境变量】
 *   PORT          监听端口，默认 8787
 *   ALLOW_ORIGINS 允许的来源，默认 *（逗号分隔）
 *   MAX_TOKENS_CAP 单次 max_tokens 上限，默认 8192
 * ============================================================================
 */
import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = parseInt(process.env.PORT || '8787', 10);
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const MAX_TOKENS_CAP = parseInt(process.env.MAX_TOKENS_CAP || '8192', 10);

const PROXY_ID = 'codelearn-proxy';
const VERSION = '1.1.0';

/* 服务商注册表（与 cloudflare-proxy.js / functions/api/chat.js 保持一致） */
const PROVIDERS = {
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1/chat/completions', defaultModel: 'deepseek-chat' },
  qwen: { label: '通义千问（DashScope 兼容模式）', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', defaultModel: 'qwen-plus' }
};
const PASSTHROUGH_FIELDS = ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty', 'stop', 'seed', 'response_format', 'stream'];

/** 计算 CORS 头：回显来源（本机版不拦白名单，仅做记录用途，可用 ALLOW_ORIGINS 收紧） */
function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  const allowed = ALLOW_ORIGINS.indexOf('*') >= 0 || ALLOW_ORIGINS.indexOf(origin) >= 0;
  return {
    'Access-Control-Allow-Origin': allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'X-Proxy, X-Proxy-Version',
    // ↓↓ 关键：公网 https 页面（如 *.pages.dev）要访问本机 127.0.0.1 时，
    //    Chrome 的 Local Network Access / Private Network Access 策略会先发一个
    //    「私有网络预检」，必须回这个头才允许跨进本机地址空间。
    //    没有它，浏览器只会报一句 "Failed to fetch"。
    'Access-Control-Allow-Private-Network': 'true',
    'Vary': 'Origin',
    'X-Proxy': PROXY_ID,
    'X-Proxy-Version': VERSION
  };
}
function sendJson(req, res, obj, status) {
  const body = JSON.stringify(obj);
  res.writeHead(status || 200, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, corsHeaders(req)));
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');

  // 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  // 健康检查（前端「测试连接」第 1 步）
  if (req.method === 'GET') {
    return sendJson(req, res, {
      ok: true, service: PROXY_ID, version: VERSION, deploy: 'local-node',
      message: '本机代理在线。前端代理地址填 http://127.0.0.1:' + PORT + ' 即可。',
      providers: Object.keys(PROVIDERS),
      acceptedUploads: ['JSON body 的 apiKey 字段', 'Authorization: Bearer <key> 请求头'],
      time: new Date().toISOString()
    }, 200);
  }

  if (req.method !== 'POST') return sendJson(req, res, { error: { message: '仅支持 GET 与 POST' } }, 405);

  // 读取请求体
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) return sendJson(req, res, { error: { message: '请求体过大（上限 512KB）' } }, 413);
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    return sendJson(req, res, { error: { message: '请求体不是合法 JSON' } }, 400);
  }

  // 校验
  const provider = PROVIDERS[String(body.provider || '').trim()];
  if (!provider) {
    return sendJson(req, res, { error: { message: '不支持的服务商（可选：' + Object.keys(PROVIDERS).join(' / ') + '）' } }, 400);
  }
  if (!Array.isArray(body.messages) || !body.messages.length) {
    return sendJson(req, res, { error: { message: 'messages 不能为空' } }, 400);
  }

  // 取密钥：body.apiKey → Authorization 头
  let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  let keySource = 'body';
  if (!apiKey) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (m) { apiKey = m[1].trim(); keySource = 'header'; }
  }
  if (!apiKey) {
    return sendJson(req, res, { error: { message: '缺少 API Key（请在网站【API 设置】页填写）', stage: 'proxy' } }, 401);
  }

  // 组装上游请求
  const upstream = {
    model: String(body.model || provider.defaultModel).trim() || provider.defaultModel,
    messages: body.messages.map(m => ({ role: String((m && m.role) || 'user'), content: String((m && m.content) || '') }))
  };
  PASSTHROUGH_FIELDS.forEach(k => { if (body[k] !== undefined && body[k] !== null) upstream[k] = body[k]; });
  if (upstream.max_tokens !== undefined) {
    const n = parseInt(upstream.max_tokens, 10);
    upstream.max_tokens = Math.max(1, Math.min(isNaN(n) ? MAX_TOKENS_CAP : n, MAX_TOKENS_CAP));
  }
  if (typeof upstream.stream !== 'boolean') upstream.stream = false;

  // 转发（支持流式透传）
  let up;
  try {
    up = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept': upstream.stream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(upstream)
    });
  } catch (e) {
    return sendJson(req, res, {
      error: { message: '无法连接上游 ' + provider.endpoint + '：' + ((e && e.message) || e) + '（检查本机能否直连该服务商）', stage: 'upstream' }
    }, 502);
  }

  const headers = Object.assign({}, corsHeaders(req));

  // 上游报错 → 包成 JSON，并标注 stage
  if (!up.ok) {
    const text = await up.text().catch(() => '');
    let message = text.slice(0, 800);
    try {
      const j = JSON.parse(text);
      message = (j.error && (j.error.message || j.error.code)) || j.message || message;
    } catch (e) { /* 保留原文 */ }
    return sendJson(req, res, {
      error: {
        message, stage: 'upstream', provider: provider.label, upstream_status: up.status, key_source: keySource,
        hint: up.status === 401 ? '上游' + provider.label + '拒绝了这个 Key：确认服务商与 Key 是否匹配、是否过期或带空格。' : ''
      }
    }, up.status);
  }

  // 流式：把上游 ReadableStream 直接管到响应
  if (upstream.stream) {
    res.writeHead(200, Object.assign({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    }, headers));
    Readable.fromWeb(up.body).pipe(res);
    return;
  }

  // 非流式
  const text = await up.text();
  res.writeHead(200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, headers));
  res.end(text);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('=====================================================');
  console.log(' CodeTutor 本机代理已启动  http://127.0.0.1:' + PORT);
  console.log(' service : ' + PROXY_ID + ' v' + VERSION + ' (local-node)');
  console.log(' 允许来源: ' + ALLOW_ORIGINS.join(', '));
  console.log('');
  console.log(' 下一步：网站【API 设置】→ 代理地址填  http://127.0.0.1:' + PORT);
  console.log(' 自测  ：浏览器打开  http://127.0.0.1:' + PORT + '  应看到 JSON 健康检查');
  console.log(' 停止  ：按 Ctrl + C');
  console.log('=====================================================');
});

process.on('SIGINT', () => { console.log('\n已停止本机代理。'); process.exit(0); });
