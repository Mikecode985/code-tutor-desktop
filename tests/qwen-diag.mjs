/**
 * 通义千问（DashScope）连通性探测
 *  · 直连国内 / 国际站端点，多轮测延迟与状态码稳定性
 *  · 走我们部署的 Pages Function 代理，验证转发、诊断头与视觉载荷
 * 用无效 Key（sk-probe-invalid），预期都是 401 —— 401 说明"网络与端点都通、只是 Key 不对"
 */
const PROXY = 'https://code-tutor-site.pages.dev/api/chat';
const ROUNDS = 5;

async function probe(url, opt, label) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opt));
    const ms = Date.now() - t0;
    const txt = await r.text();
    let msg = txt.slice(0, 120).replace(/\s+/g, ' ');
    try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) {}
    return { ok: true, status: r.status, ms, msg, hdrs: r.headers };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, msg: (e && e.message) || String(e) };
  }
}

const bodyText = JSON.stringify({ model: 'qwen-plus', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
const bodyVision = JSON.stringify({
  model: 'qwen-vl-max',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '这张图里有什么字？' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==' } }
    ]
  }],
  max_tokens: 16
});

const targets = [
  { label: '直连 DashScope 国内站', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', opt: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-probe-invalid' }, body: bodyText } },
  { label: '直连 DashScope 国际站', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', opt: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-probe-invalid' }, body: bodyText } },
  { label: '经我们的代理（纯文本）', url: PROXY, opt: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'qwen', model: 'qwen-plus', apiKey: 'sk-probe-invalid', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }) } },
  { label: '经我们的代理（视觉载荷）', url: PROXY, opt: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'qwen', model: 'qwen-vl-max', apiKey: 'sk-probe-invalid', messages: JSON.parse(bodyVision).messages, max_tokens: 16 }) } }
];

for (const t of targets) {
  const rows = [];
  for (let i = 0; i < ROUNDS; i++) {
    const r = await probe(t.url, t.opt, t.label);
    rows.push(r);
    await new Promise(x => setTimeout(x, 250));
  }
  const okCount = rows.filter(r => r.ok).length;
  const statuses = [...new Set(rows.map(r => r.status))].join('/');
  const ms = rows.map(r => r.ms);
  const avg = Math.round(ms.reduce((a, b) => a + b, 0) / ms.length);
  const max = Math.max(...ms);
  console.log('\n=== ' + t.label + ' ===');
  console.log('  成功 ' + okCount + '/' + ROUNDS + ' | 状态码集合 ' + statuses + ' | 平均 ' + avg + 'ms | 最慢 ' + max + 'ms');
  console.log('  延迟序列 ' + ms.join(', ') + ' ms');
  const first = rows.find(r => r.ok);
  if (first) {
    console.log('  首次响应: HTTP ' + first.status + ' | ' + first.msg.slice(0, 100));
    const diag = ['x-upstream-status', 'x-upstream-attempts', 'x-upstream-ms', 'x-images']
      .map(k => k + '=' + (first.hdrs.get(k) || '-')).join(' ');
    console.log('  诊断头: ' + diag);
  }
  const fail = rows.find(r => !r.ok);
  if (fail) console.log('  失败样例: ' + fail.msg.slice(0, 120));
}
console.log('\n（注：用无效 Key，401 表示「网络+端点正常，仅 Key 不符」）');
