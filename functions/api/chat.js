/**
 * ============================================================================
 * functions/api/chat.js — CodeTutor 代理的【同源版】(Cloudflare Pages Functions)
 * ============================================================================
 *
 * 【为什么要用它】
 * `*.workers.dev` 在国内网络经常被 DNS 污染 + SNI 阻断（实测会解析到 Facebook /
 * Twitter / Dropbox 的 IP，或 TLS 握手被 RST），表现就是前端报 "Failed to fetch"。
 * 而 Pages Functions 跑在**你自己的站点域名**下（例如 https://你的站点.pages.dev/api/chat）：
 *   · 同源请求 → 压根不涉及 CORS
 *   · 不依赖 workers.dev 域名 → 不受污染与阻断影响
 *   · 前端代理地址只需填 `/api/chat`
 *
 * 【目录结构】（放在 Pages 项目根目录，**不能**放进 dist/ 之类的静态输出目录）
 *   你的项目/
 *   ├── index.html
 *   └── functions/
 *       └── api/
 *           └── chat.js     ← 本文件，自动映射到路由 /api/chat
 *
 * 【怎么部署】（二选一，注意：控制台"拖拽上传"不支持 Functions！）
 *   方式 1：wrangler CLI（最快）
 *       npm i -g wrangler && wrangler login
 *       cd 你的项目            # 这个目录里同时有 index.html 和 functions/
 *       wrangler pages deploy . --project-name=code-tutor-site
 *       # ↑ project-name 必须与你现有的 Pages 项目名完全一致，否则会新建一个站点
 *
 *   方式 2：Git 集成
 *       把 index.html + functions/api/chat.js 推到 GitHub，在 Pages 里连仓库：
 *       构建命令留空，输出目录填 `.`，Pages 会自动把 functions/ 编译成 Functions。
 *
 *   官方文档：https://developers.cloudflare.com/pages/functions/get-started/
 *   （原文明确：functions 目录必须在 Pages 项目根目录；Dashboard 的 Direct Upload 不支持 Functions）
 *
 * 【部署后自测】
 *   浏览器打开 https://你的站点.pages.dev/api/chat
 *   应返回 {"ok":true,"service":"codelearn-proxy","deploy":"pages-function",...}
 *   然后在前端【API 设置】把代理地址填成：/api/chat
 *
 * 【安全说明】
 *   与前缀版本一致：不落盘、不写日志、不存密钥。apiKey 只在本次请求的内存中，
 *   用于拼一个 Authorization 头转发给上游，请求结束即释放。
 * ============================================================================
 */

/* 服务商注册表（OpenAI 兼容接口） */
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat'
  },
  qwen: {
    label: '通义千问（DashScope 兼容模式）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus'
  }
};

const PROXY_ID = 'codelearn-proxy';
const VERSION = '1.1.0';

/* 允许透传给上游的参数白名单 */
/**
 * 规范化一条消息的 content：
 *   · 字符串原样保留
 *   · 数组（多模态）逐项校验后保留 text / image_url，**不能 String() 强转**，
 *     否则图片会被变成 "[object Object]"（这是通义千问视觉调用失败的根因）
 */
function normalizeContent(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return c == null ? '' : String(c);
  const parts = [];
  let hasImage = false;
  c.forEach(function (p) {
    if (!p || typeof p !== 'object') return;
    if (p.type === 'text') {
      parts.push({ type: 'text', text: String(p.text == null ? '' : p.text) });
    } else if (p.type === 'image_url') {
      const raw = p.image_url;
      const url = typeof raw === 'string' ? raw : (raw && raw.url);
      if (!url) return;
      // 只放行 data:image/* 与 https 图片，避免被当成任意 URL 代理
      if (!/^(data:image\/|https:\/\/)/i.test(String(url))) return;
      hasImage = true;
      parts.push({ type: 'image_url', image_url: { url: String(url) } });
    }
  });
  if (hasImage) parts.push({ __hasImage: true });   // 内部标记，序列化前会删掉
  return parts.length ? parts : '';
}
function stripMarks(list) {
  return list.map(function (p) {
    if (p && p.__hasImage) return null;
    if (p && Array.isArray(p)) return null;
    return p;
  });
}
function countImages(messages) {
  let n = 0;
  (messages || []).forEach(function (m) {
    if (m && Array.isArray(m.content)) {
      m.content.forEach(function (p) { if (p && p.type === 'image_url') n++; });
    }
  });
  return n;
}
function cleanMessages(list) {
  return list.map(function (m) {
    const c = m.content;
    return {
      role: m.role,
      content: Array.isArray(c) ? c.filter(function (p) { return !(p && p.__hasImage); }) : c
    };
  });
}

const PASSTHROUGH_FIELDS = [
  'temperature', 'top_p', 'max_tokens', 'presence_penalty',
  'frequency_penalty', 'stop', 'seed', 'response_format', 'stream'
];

/* ---------------------------------------------------------------------------
 * 通用响应工具
 * ------------------------------------------------------------------------- */
function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'X-Proxy, X-Proxy-Version',
    'Vary': 'Origin',
    'X-Proxy': PROXY_ID,
    'X-Proxy-Version': VERSION
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, corsHeaders(request))
  });
}

/* ---------------------------------------------------------------------------
 * 健康检查（前端「测试连接」第 1 步会 GET 这里做身份自检）
 * ------------------------------------------------------------------------- */
export async function onRequestGet(context) {
  return json({
    ok: true,
    service: PROXY_ID,
    version: VERSION,
    deploy: 'pages-function',              // 与 Worker 版区分，便于排查
    message: '同源 Pages Function 代理在线。前端代理地址填 /api/chat 即可。',
    providers: Object.keys(PROVIDERS),
    acceptedUploads: ['JSON body 的 apiKey 字段', 'Authorization: Bearer <key> 请求头'],
    time: new Date().toISOString()
  }, 200, context.request);
}

/* ---------------------------------------------------------------------------
 * 预检
 * ------------------------------------------------------------------------- */
export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request) });
}

/* 其它方法一律 405 */
export async function onRequest(context) {
  return json({ error: { message: '仅支持 GET（健康检查）与 POST（对话请求）' } }, 405, context.request);
}

/* ---------------------------------------------------------------------------
 * 主逻辑：POST /api/chat
 * ------------------------------------------------------------------------- */
/** 上游配置 */
const UPSTREAM_TIMEOUT_MS = 75000;              // 单次尝试上限（Cloudflare 总时限 100s 内）
const RETRY_STATUS = [429, 500, 502, 503, 504]; // 这些状态码重试一次
/**
 * 带超时与一次重试的上游调用。
 * 通义千问偶发 429 / 5xx / 握手卡住，不重试就会表现为"连接不稳定"。
 */
async function fetchUpstream(url, init, timeoutMs) {
  const attempts = 2;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, init, { signal: ctrl.signal }));
      clearTimeout(timer);
      if (RETRY_STATUS.indexOf(res.status) >= 0 && i < attempts - 1) {
        try { await res.text(); } catch (e) { /* 丢弃 */ }
        await new Promise(function (r) { setTimeout(r, 400 + i * 700); });
        continue;
      }
      return { res: res, attempts: i + 1 };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise(function (r) { setTimeout(r, 400 + i * 700); });
        continue;
      }
      e.__attempts = i + 1;
      throw e;
    }
  }
  throw lastErr || new Error('上游无响应');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1) 请求体
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: { message: '请求体不是合法 JSON' } }, 400, request);
  }

  // 2) 参数校验
  const providerKey = String(body.provider || '').trim();
  const provider = PROVIDERS[providerKey];
  if (!provider) {
    return json({ error: { message: '不支持的服务商：' + providerKey + '（可选：' + Object.keys(PROVIDERS).join(' / ') + '）' } }, 400, request);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: { message: 'messages 不能为空' } }, 400, request);
  }
  if (body.messages.length > 60) {
    return json({ error: { message: 'messages 条数过多（上限 60）' } }, 400, request);
  }

  // 3) 取密钥：body.apiKey → Authorization 头 → 环境变量（需 ALLOW_SERVER_KEY=true）
  const allowServerKey = String(env.ALLOW_SERVER_KEY || '').toLowerCase() === 'true';
  let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  let keySource = 'body';
  if (!apiKey) {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim()) { apiKey = m[1].trim(); keySource = 'header'; }
  }
  const serverKeyEnv = providerKey === 'deepseek' ? 'SERVER_DEEPSEEK_KEY' : 'SERVER_QWEN_KEY';
  if (!apiKey && allowServerKey) {
    apiKey = String(env[serverKeyEnv] || '').trim();
    keySource = 'server';
  }
  if (!apiKey) {
    return json({
      error: {
        message: '缺少 API Key。请在网站【API 设置】页填写你自己的 Key。',
        stage: 'proxy',
        expects: 'JSON body 的 apiKey 字段，或 Authorization: Bearer <key> 请求头'
      }
    }, 401, request);
  }

  // 4) 组装上游请求（白名单字段）
  const maxCap = parseInt(env.MAX_TOKENS_CAP || '', 10) || 8192;
  const upstream = {
    model: String(body.model || provider.defaultModel).trim() || provider.defaultModel,
    messages: body.messages.map(function (m) {
      return {
        role: String((m && m.role) || 'user'),
        content: normalizeContent(m && m.content)   // ← 多模态数组必须原样保留
      };
    })
  };
  const imageCount = countImages(upstream.messages);
  upstream.messages = cleanMessages(upstream.messages);
  PASSTHROUGH_FIELDS.forEach(function (k) {
    if (body[k] !== undefined && body[k] !== null) upstream[k] = body[k];
  });
  if (upstream.max_tokens !== undefined) {
    const n = parseInt(upstream.max_tokens, 10);
    upstream.max_tokens = Math.max(1, Math.min(isNaN(n) ? maxCap : n, maxCap));
  }
  if (typeof upstream.stream !== 'boolean') upstream.stream = false;

  // 5) 转发上游
  let res;
  let attempts = 0;
  const t0 = Date.now();
  try {
    const r = await fetchUpstream(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Accept': upstream.stream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(upstream)
    }, parseInt(env.UPSTREAM_TIMEOUT_MS || '', 10) || UPSTREAM_TIMEOUT_MS);
    res = r.res;
    attempts = r.attempts;
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')));
    return json({
      error: {
        message: aborted
          ? '上游 ' + provider.label + ' 超过 ' + Math.round(UPSTREAM_TIMEOUT_MS / 1000) + ' 秒没有响应（已重试 ' + (e.__attempts || 1) + ' 次）。'
          : '无法连接上游接口 ' + provider.endpoint + '：' + ((e && e.message) || e) + '（已重试 ' + (e.__attempts || 1) + ' 次）',
        stage: 'upstream_network',
        provider: provider.label,
        images: imageCount,
        hint: aborted
          ? '通义千问在图片/长文本请求上偶尔会卡住。可以：① 改小页面图片（本地 OCR 或降低清晰度）；② 换 qwen-turbo / qwen-plus 处理纯文本；③ 稍后重试。'
          : '网络到上游不通或握手被重置，稍后重试；国内访问 DashScope 一般可用，若长期失败请检查网络。'
      }
    }, aborted ? 504 : 502, request);
  }

  const headers = new Headers(corsHeaders(request));
  headers.set('X-Upstream-Status', String(res.status));
  headers.set('X-Upstream-Attempts', String(attempts));
  headers.set('X-Upstream-Ms', String(Date.now() - t0));
  if (imageCount) headers.set('X-Images', String(imageCount));

  // 6) 上游报错：转成 JSON 交给前端，并标注 stage 便于区分"代理坏"还是"Key 被拒"
  if (!res.ok) {
    const text = await res.text().catch(function () { return ''; });
    let message = text.slice(0, 800);
    try {
      const j = JSON.parse(text);
      message = (j.error && (j.error.message || j.error.code)) || j.message || message;
    } catch (e2) { /* 保留原文 */ }
    const errResp = json({
      error: {
        message: message,
        stage: 'upstream',
        provider: provider.label,
        upstream_status: res.status,
        key_source: keySource,
        images: imageCount,
        attempts: attempts,
        hint: (function () {
          if (res.status === 401 || res.status === 403) {
            return '上游' + provider.label + '拒绝了这个 Key。请确认：① 服务商与 Key 是否匹配（通义千问要用阿里云百炼的 Key，不是 DeepSeek 的）；' +
              '② Key 是否过期或复制时带了空格换行；③ 该模型是否有权限；④ 国际站账号请用 dashscope-intl 端点。';
          }
          if (imageCount && res.status === 400) {
            return '这次带了 ' + imageCount + ' 张图片，但 ' + (upstream.model || '该模型') +
              ' 可能不支持图片输入。请改用 qwen-vl-max / qwen-vl-plus，或改用「本地 OCR」。';
          }
          if (res.status === 429) {
            return '触发了 ' + provider.label + ' 的限流（已自动重试 ' + attempts + ' 次）。稍等几秒再试，或把每页图片调小 / 减少并发。';
          }
          if (res.status >= 500) {
            return '上游 ' + provider.label + ' 服务端错误（已自动重试 ' + attempts + ' 次）。这是对方的问题，稍后再试。';
          }
          return '';
        })()
      }
    }, res.status, request);
    // 诊断头（错误也用得上：一眼看出耗时、重试次数、是否带图）
    errResp.headers.set('X-Upstream-Status', String(res.status));
    errResp.headers.set('X-Upstream-Attempts', String(attempts));
    errResp.headers.set('X-Upstream-Ms', String(Date.now() - t0));
    if (imageCount) errResp.headers.set('X-Images', String(imageCount));
    return errResp;
  }

  // 7) 流式：直接透传 ReadableStream（不缓冲、不落盘）
  if (upstream.stream) {
    headers.set('Content-Type', 'text/event-stream; charset=utf-8');
    headers.set('Cache-Control', 'no-cache, no-transform');
    headers.set('X-Accel-Buffering', 'no');
    return new Response(res.body, { status: 200, headers: headers });
  }

  // 8) 非流式
  const data = await res.json().catch(function () { return null; });
  if (data === null) return json({ error: { message: '上游返回了非 JSON 内容' } }, 502, request);
  return new Response(JSON.stringify(data), { status: 200, headers: headers });
}
