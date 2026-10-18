/**
 * ============================================================================
 * cloudflare-proxy.js — CodeTutor 的 AI 请求跨域代理（Cloudflare Worker）
 * ============================================================================
 *
 * 【它做什么】
 *   浏览器直连大模型官方接口会被 CORS 拦截（并且会把用户的 API Key 暴露在
 *   前端网络面板里、难以做统一限流）。本 Worker 做三件事：
 *     1. 接收前端 POST 的 { provider, model, apiKey, messages, ... }
 *     2. 按服务商拼出真实接口地址并在请求头里带上 Bearer Key，转发上游
 *     3. 把上游响应（含 SSE 流式）原样回吐，并补齐 CORS 响应头
 *
 * 【它不做什么（重要）】
 *   - 不写数据库、不落盘、不打印日志：用户传入的 apiKey 只存在于本次请求的内存变量中，
 *     请求结束即释放，Worker 不会记录任何密钥或用户代码。
 *   - 不校验、不改写提示词内容（只做长度与结构合法性检查）。
 *
 * ---------------------------------------------------------------------------
 * 【部署方式 A：Dashboard 粘贴（最快，推荐新手）】
 *   1. 打开 https://dash.cloudflare.com → 左侧「Workers & Pages」→「Create」→「Create Worker」
 *   2. 名称随便取，例如 codelearn-proxy → Deploy
 *   3. 点「Edit code」，把本文件全部内容粘进去覆盖模板 → Deploy
 *   4. 得到形如 https://codelearn-proxy.你的子域.workers.dev 的地址，填到网站的「代理地址」
 *   5. 如需限制来源域名：Settings → Variables and Secrets → 添加变量
 *        ALLOWED_ORIGINS = https://你的站点.pages.dev,http://localhost:8080
 *      （不设置则为 *，允许任意网站调用；正式站点建议一定要设置）
 *
 * 【部署方式 B：Wrangler CLI】
 *   1. npm i -g wrangler && wrangler login
 *   2. 新建目录，放入本文件并改名为 index.js（或 src/index.js），新建 wrangler.toml：
 *
 *        name = "codelearn-proxy"
 *        main = "index.js"
 *        compatibility_date = "2025-01-01"
 *
 *        [vars]
 *        ALLOWED_ORIGINS = "https://你的站点.pages.dev,http://localhost:8080"
 *
 *   3. wrangler deploy
 *
 * 【可选环境变量（Variables / Secrets）】
 *   ALLOWED_ORIGINS   逗号分隔的允许来源；默认 "*"（允许所有）。正式站点务必收紧。
 *   MAX_TOKENS_CAP    单次请求 max_tokens 上限，默认 8192，防止被刷额度。
 *   MAX_BODY_BYTES    请求体上限，默认 512 * 1024（512KB）。
 *   RATE_LIMIT_PER_MIN 每 IP 每分钟最大请求数，默认 60（尽力而为，见下方说明）。
 *   ALLOW_SERVER_KEY  设为 "true" 时，允许不带 apiKey 的请求使用服务端密钥（你自己付费）。
 *   SERVER_DEEPSEEK_KEY / SERVER_QWEN_KEY  服务端密钥（仅在 ALLOW_SERVER_KEY=true 时生效）
 *
 * 【限流说明】
 *   Cloudflare 免费版同一 isolate 内存不跨机房共享，因此这里的限流是「尽力而为」的
 *   第一道防线，只防手滑连点，不足以对抗恶意刷量。要真正防刷请用 Cloudflare 的
 *   Rate Limiting Rules（WAF）或 Durable Object 计数。更彻底的做法是：
 *   服务端密钥 + 仅允许白名单来源 + 每日预算告警。
 * ============================================================================
 */

/* 服务商注册表：新增服务商只要在这里加一行（必须是 OpenAI 兼容的 /chat/completions 接口） */
const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    defaultKeyEnv: 'SERVER_DEEPSEEK_KEY'
  },
  qwen: {
    label: '通义千问（DashScope 兼容模式）',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    defaultKeyEnv: 'SERVER_QWEN_KEY'
  }
};

/**
 * 代理身份标识（重要）
 * 前端「测试连接」会先 GET 本 Worker，校验返回 JSON 里的 service 字段；
 * 如果对不上，说明该地址上跑的不是本脚本，前端会直接提示你去检查部署。
 * 排查思路：任何响应都必须带 X-Proxy: codelearn-proxy 头。
 */
const PROXY_ID = 'codelearn-proxy';
const VERSION = '1.1.0';

/* 允许透传给上游的白名单字段，防止前端塞入意外参数 */
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

/* 本地限流表：{ ip: { count, resetAt } }（isolate 内存变量，重启即清空） */
const rateBucket = new Map();

export default {
  /**
   * Worker 入口
   * @param {Request} request
   * @param {Object} env 环境变量与 Secrets
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = buildCors(request, env, url);

    // 0) 来源校验：不在白名单直接拒绝（OPTIONS 也要拒绝，避免浏览器误判）
    if (cors.blocked) {
      const o = request.headers.get('Origin') || '(无 Origin)';
      return json({
        error: {
          message: '当前来源被 Worker 的 ALLOWED_ORIGINS 白名单拦截：' + o,
          stage: 'proxy',
          hint: '到 Cloudflare 控制台 → 该 Worker → Settings → Variables and Secrets，把 ' +
                o + ' 追加进 ALLOWED_ORIGINS（多个用英文逗号分隔、不要带结尾斜杠），或者先设为 * 验证连通性。'
        }
      }, 403, cors.headers);
    }

    // 1) 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors.headers });
    }

    // 2) 健康检查 / 浏览器直接访问
    //    前端「测试连接」会先打这里做代理身份自检，所以字段名不要随意改
    if (request.method === 'GET') {
      return json({
        ok: true,
        service: PROXY_ID,
        version: VERSION,
        message: '代理在线。请用 POST 发送 { provider, model, apiKey, messages }。',
        providers: Object.keys(PROVIDERS),
        acceptedUploads: ['JSON body 的 apiKey 字段', 'Authorization: Bearer <key> 请求头'],
        time: new Date().toISOString()
      }, 200, cors.headers);
    }

    if (request.method !== 'POST') {
      return json({ error: { message: '仅支持 POST 请求' } }, 405, cors.headers);
    }

    // 3) 请求体大小保护
    const maxBody = parseInt(env.MAX_BODY_BYTES || '', 10) || 512 * 1024;
    const lenHeader = parseInt(request.headers.get('content-length') || '0', 10);
    if (lenHeader && lenHeader > maxBody) {
      return json({ error: { message: '请求体过大（超过 ' + Math.round(maxBody / 1024) + 'KB）' } }, 413, cors.headers);
    }

    // 4) 解析请求体
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: { message: '请求体不是合法 JSON' } }, 400, cors.headers);
    }

    // 5) 参数校验
    const providerKey = String(body.provider || '').trim();
    const provider = PROVIDERS[providerKey];
    if (!provider) {
      return json({ error: { message: '不支持的服务商：' + providerKey + '（可选：' + Object.keys(PROVIDERS).join(' / ') + '）' } }, 400, cors.headers);
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: { message: 'messages 不能为空' } }, 400, cors.headers);
    }
    if (body.messages.length > 60) {
      return json({ error: { message: 'messages 条数过多（上限 60）' } }, 400, cors.headers);
    }

    // 6) 取密钥，三种来源依次尝试：
    //    ① JSON body 的 apiKey           ← 本项目前端的默认方式
    //    ② Authorization: Bearer <key>   ← 兼容"把 Key 放请求头"的前端/客户端写法
    //    ③ 服务端密钥（需显式开启 ALLOW_SERVER_KEY）
    const allowServerKey = String(env.ALLOW_SERVER_KEY || '').toLowerCase() === 'true';
    let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    let keySource = 'body';
    if (!apiKey) {
      const auth = request.headers.get('Authorization') || '';
      const m = auth.match(/^Bearer\s+(.+)$/i);
      if (m && m[1].trim()) { apiKey = m[1].trim(); keySource = 'header'; }
    }
    if (!apiKey && allowServerKey) {
      apiKey = String(env[provider.defaultKeyEnv] || '').trim();
      keySource = 'server';
    }
    if (!apiKey) {
      return json({
        error: {
          message: '缺少 API Key。请在网站【API 设置】页填写你自己的 Key。',
          stage: 'proxy',
          expects: 'JSON body 的 apiKey 字段，或 Authorization: Bearer <key> 请求头'
        }
      }, 401, cors.headers);
    }

    // 7) 限流（尽力而为）
    const limit = parseInt(env.RATE_LIMIT_PER_MIN || '', 10) || 60;
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    if (!checkRate(ip, limit)) {
      return json({ error: { message: '请求过于频繁（每 IP 每分钟上限 ' + limit + ' 次），请稍后再试。' } }, 429, cors.headers);
    }

    // 8) 组装上游请求体：白名单字段 + 归一化后的 model / messages
    const maxCap = parseInt(env.MAX_TOKENS_CAP || '', 10) || 8192;
    const upstream = {
      model: String(body.model || provider.defaultModel).trim() || provider.defaultModel,
      messages: (function () {
        const list = body.messages.map(function (m) {
          return { role: String(m && m.role || 'user'), content: normalizeContent(m && m.content) };
        });
        return cleanMessages(list);
      })()
    };
    PASSTHROUGH_FIELDS.forEach(function (k) {
      if (body[k] !== undefined && body[k] !== null) upstream[k] = body[k];
    });
    if (upstream.max_tokens !== undefined) {
      const n = parseInt(upstream.max_tokens, 10);
      upstream.max_tokens = Math.max(1, Math.min(isNaN(n) ? maxCap : n, maxCap));
    }
    if (typeof upstream.stream !== 'boolean') upstream.stream = false;
    if (upstream.temperature !== undefined && typeof upstream.temperature !== 'number') delete upstream.temperature;

    // 9) 转发上游
    let res;
    try {
      res = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'Accept': upstream.stream ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify(upstream)
      });
    } catch (e) {
      // 上游不可达（DNS / 网络 / 被墙），把原因回传给前端便于排查
      return json({ error: { message: '无法连接上游接口 ' + provider.endpoint + '：' + (e && e.message ? e.message : e) } }, 502, cors.headers);
    }

    const headers = new Headers(cors.headers);

    // 10) 上游报错：把错误体转成 JSON 交给前端（保留原始状态码语义）
    if (!res.ok) {
      const text = await res.text().catch(function () { return ''; });
      let message = text.slice(0, 800);
      try {
        const j = JSON.parse(text);
        message = (j.error && (j.error.message || j.error.code)) || j.message || message;
      } catch (e2) { /* 保留原文 */ }
      return json({
        error: {
          message: message,
          stage: 'upstream',                 // 关键：说明是"上游服务商"拒绝的，不是代理的问题
          provider: provider.label,
          upstream_status: res.status,
          key_source: keySource,             // body / header / server
          hint: res.status === 401
            ? '上游' + provider.label + '拒绝了这个 Key。请依次确认：① 服务商选择与 Key 是否匹配（DeepSeek 的 Key 不能用于通义千问，反之亦然）；② Key 是否已过期/被删除/复制时带了空格换行；③ 该模型是否有权限。'
            : ''
        }
      }, res.status, cors.headers);
    }

    // 11) 流式：直接把上游 ReadableStream 透传给浏览器（不缓冲，不落盘）
    if (upstream.stream) {
      headers.set('Content-Type', 'text/event-stream; charset=utf-8');
      headers.set('Cache-Control', 'no-cache, no-transform');
      headers.set('Connection', 'keep-alive');
      headers.set('X-Accel-Buffering', 'no');
      return new Response(res.body, { status: 200, headers: headers });
    }

    // 12) 非流式：透传 JSON
    const data = await res.json().catch(function () { return null; });
    if (data === null) {
      return json({ error: { message: '上游返回了非 JSON 内容' } }, 502, cors.headers);
    }
    return new Response(JSON.stringify(data), { status: 200, headers: headers });
  }
};

/* ---------------------------------------------------------------------------
 * 辅助函数
 * ------------------------------------------------------------------------- */

/**
 * 计算 CORS 响应头。
 * 思路：若配置了 ALLOWED_ORIGINS，则只在请求 Origin 命中白名单时放行；
 *       否则原样回显请求的 Origin（而不是留空）。
 *
 * 【为什么被拦截时也要回显 Origin】
 *   如果 403 响应里没有 Access-Control-Allow-Origin，浏览器会直接掐掉响应，
 *   前端只能看到一句毫无信息量的 "Failed to fetch"，根本不知道是白名单没配对。
 *   回显 Origin 只是让浏览器**能读到那句错误说明**，并不会泄露任何数据
 *   （被拦截的请求依然返回 403、不转发上游、不消耗任何额度）。
 */
function buildCors(request, env, url) {
  const origin = request.headers.get('Origin') || '';
  const allowedRaw = String(env.ALLOWED_ORIGINS || '*').trim();
  const list = allowedRaw.split(',').map(function (s) { return s.trim().replace(/\/+$/, ''); }).filter(Boolean);
  const allowAll = list.length === 0 || list.indexOf('*') >= 0;

  const headers = {
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    // 身份指纹：前端/运维可用它确认"这个地址上跑的到底是不是本脚本"
    'X-Proxy': PROXY_ID,
    'X-Proxy-Version': VERSION
  };

  let blocked = false;
  if (allowAll) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  } else if (origin && list.indexOf(origin.replace(/\/+$/, '')) >= 0) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (!origin) {
    // 无 Origin 的请求（curl / 服务端调用）不设 CORS 头，直接放行
    blocked = false;
  } else {
    // 白名单没命中：仍然回显 Origin，好让浏览器能把下面那句 403 说明显示给用户，
    // 否则前端只会看到无信息的 "Failed to fetch"，完全查不出是白名单配错了。
    headers['Access-Control-Allow-Origin'] = origin;
    blocked = true;
  }

  // 允许站点内部跳转/调试
  headers['Access-Control-Expose-Headers'] = 'X-Proxy, X-Proxy-Version';

  return { headers: headers, blocked: blocked, allowAll: allowAll };
}

/** 统一的 JSON 响应构造 */
function json(obj, status, headers) {
  const h = new Headers(headers || {});
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}

/**
 * 简易滑动窗口限流（每 IP 每分钟 limit 次）。
 * 注意：Map 只存在于当前 isolate 内存中，跨机房不共享，属于尽力而为。
 */
function checkRate(ip, limit) {
  const now = Date.now();
  const rec = rateBucket.get(ip);
  if (!rec || now > rec.resetAt) {
    rateBucket.set(ip, { count: 1, resetAt: now + 60000 });
    // 顺便做一次清理，避免 Map 无限增长
    if (rateBucket.size > 5000) {
      for (const [k, v] of rateBucket) {
        if (now > v.resetAt) rateBucket.delete(k);
      }
    }
    return true;
  }
  rec.count += 1;
  return rec.count <= limit;
}
