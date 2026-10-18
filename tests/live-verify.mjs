/**
 * 线上端到端验证（稳健版）
 * 真实 Chrome 打开 https://code-tutor-site.pages.dev，等 JS 完全就绪后，
 * 走「测试连接（含代理自检）」两步流程，证明"任何人访问都能用"。
 */
const SITE = 'https://code-tutor-site.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9222/json/list')).json(); const t = l.find(x => x.type === 'page'); if (t) return t; } catch {} await sleep(250); }
  throw new Error('CDP 不可用');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } else if (x.method) events.push(x); };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return 'EXC:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0]; return r.result?.result?.value; };

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
const loaded = new Promise(res => { const iv = setInterval(() => { if (events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(iv); res(); } }, 100); setTimeout(() => { clearInterval(iv); res(); }, 25000); });
await send('Page.navigate', { url: SITE });
await loaded;

// 显式等待内联 JS 跑完（两个编辑器都建好）
let ready = false;
for (let i = 0; i < 60; i++) {
  const n = await ev("document.querySelectorAll('.CodeMirror').length");
  if (n === 2) { ready = true; break; }
  await sleep(250);
}
const results = [];
const check = (n, ok, d) => results.push({ n, ok: !!ok, d });
check('内联 JS 已执行（两个 CodeMirror 编辑器就绪）', ready, '');
check('线上前端是新版（同源支持 + 代理自检按钮）',
  await ev("document.documentElement.innerHTML.indexOf('\u540c\u6e90') >= 0 && document.getElementById('testApiBtn').textContent.indexOf('\u4ee3\u7406\u81ea\u68c0') >= 0"), '');

// 访客零配置：不手动填代理，等页面自动探测（此前已确认初始为空）
let auto = false;
for (let i = 0; i < 20; i++) {
  const v = await ev("document.getElementById('proxyInput').value");
  if (v === '/api/chat') { auto = true; break; }
  await sleep(300);
}
check('访客零配置 · 打开页面即自动启用同源代理 /api/chat', auto, String(await ev("document.getElementById('proxyInput').value")));

// 只填一个假 Key，然后点测试
const filled = await ev(`(function(){
  function set(id,v){ var e=document.getElementById(id); if(!e) return 'missing '+id; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return 'ok'; }
  document.querySelector('.tab[data-panel="api"]').click();
  var b = set('apiKeyInput','sk-production-verification-fake');
  return 'skip-proxy,' + b;
})()`);
check('仅填入测试 Key（代理由自动探测提供）', filled === 'skip-proxy,ok', String(filled));

await ev("document.getElementById('testApiBtn').click()");
// 轮询等待两步都出结果
let txt = '';
for (let i = 0; i < 40; i++) {
  txt = String(await ev("document.getElementById('apiTestResult').textContent"));
  if (txt.indexOf('\u6a21\u578b') >= 0 || txt.indexOf('\u5931\u8d25') >= 0) break;   // 出现"模型"或"失败"
  await sleep(500);
}
console.log('\n============ 线上「测试连接（含代理自检）」实际输出 ============');
console.log(txt.replace(/\s{2,}/g, '\n'));

check('第 1 步 · 代理自检通过', txt.indexOf('\u4ee3\u7406\u81ea\u68c0\u901a\u8fc7') >= 0, '');
check('第 1 步 · 识别为 pages-function 且同源', txt.indexOf('pages-function') >= 0 && txt.indexOf('\u540c\u6e90') >= 0, '');
check('第 1 步 · 版本号 1.1.0', txt.indexOf('1.1.0') >= 0, '');
check('第 2 步 · 请求真的到了 DeepSeek（假 Key 得 401，非网络/CORS 错误）',
  txt.indexOf('401') >= 0 && txt.indexOf('Authentication Fails') >= 0, '');
check('全程没有 Failed to fetch / 无法连接代理', txt.indexOf('Failed to fetch') < 0 && txt.indexOf('\u65e0\u6cd5\u8fde\u63a5') < 0, '');

const badWords = ['CORS', 'loopback', 'private network', 'Failed to fetch', 'ERR_BLOCKED'];
const errs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  .map(e => e.params.entry.text)
  .filter(x => badWords.some(w => x.indexOf(w) >= 0))
  // 直连模式下「测试连接」会故意向服务商发 CORS 预检；这类探测噪音已在界面上转成明确提示，
  // 属于预期行为，不算"应用的 CORS 错误"（其余 CORS 错误仍然算失败）
  .filter(x => !/dashscope|deepseek\.com|api\.openai|generativelanguage/i.test(x));
check('控制台无 CORS / LNA(loopback) 相关错误（排除直连预检噪音）', errs.length === 0, errs.join(' | ').slice(0, 200));

// ---- 新功能：对话页 ----
check('线上已包含「对话」/「学习进度」/「练习」/「学习知识」/「实用工具」五个板块',
  await ev("!!document.getElementById('chatBody') && !!document.getElementById('statGrid') && !!document.getElementById('panel-practice') && !!document.getElementById('panel-knowledge') && !!document.getElementById('panel-tools') && document.querySelectorAll('.tab').length === 7"), '');

// 用假 Key 发一条消息：预期拿到 DeepSeek 的 401，说明线上链路真的通了
await ev("document.querySelector('.tab[data-panel=\"chat\"]').click()");
await ev(`(function(){ var k=document.getElementById('apiKeyInput'); k.value='sk-live-chat-fake'; k.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await ev("document.getElementById('chatInput').value = '\u4f60\u597d'");
await ev("document.getElementById('chatSendBtn').click()");
let chatDone = false;
for (let i = 0; i < 50; i++) {
  const n = await ev("document.querySelectorAll('#chatBody .msg').length");
  const t = String(await ev("(document.querySelector('#chatBody .msg.ai') || {}).textContent || ''"));
  // 流式会先插一个空气泡，必须等到它真的有内容（这里用长度 > 20 判断）
  if (n >= 2 && t.length > 20) { chatDone = true; break; }
  await sleep(500);
}
const aiTxt = String(await ev("(document.querySelector('#chatBody .msg.ai') || {}).textContent || ''"));
check('线上对话消息已发出并收到回复气泡（用户+AI 两条）', chatDone, String(await ev("document.querySelectorAll('#chatBody .msg').length")));
check('线上对话走通了整条链路（假 Key 得到 DeepSeek 401，而非网络/CORS 错误）',
  aiTxt.indexOf('401') >= 0 && aiTxt.indexOf('Authentication Fails') >= 0, aiTxt.slice(0, 90));
check('线上对话历史已保存到浏览器本地',
  String(await ev("localStorage.getItem('codetutor.chat.v1') || ''")).indexOf('\u4f60\u597d') >= 0, '');
check('线上学习进度已记录对话轮数',
  String(await ev("localStorage.getItem('codetutor.progress.v1') || ''")).indexOf('"chat"') >= 0, '');

// ---- 彩蛋栏 ----
check('线上彩蛋栏存在且文案正确',
  await ev("(function(){var b=document.getElementById('eggBar');return !!b && b.textContent.indexOf('代码写累了')>=0 && b.textContent.indexOf('贵州发展吧')>=0 && b.textContent.indexOf('休息一下吧')>=0;})()"), '');
check('线上彩蛋栏按钮指向贵州发展吧（新窗口 + noopener）',
  await ev("(function(){var a=document.getElementById('eggGo');return a.getAttribute('href')==='https://tieba.baidu.com/f?kw=%E8%B4%B5%E5%B7%9E%E5%8F%91%E5%B1%95&fr=personalize_page' && a.getAttribute('target')==='_blank' && (a.getAttribute('rel')||'').indexOf('noopener')>=0;})()"), '');
check('线上皮肤系统可用（9 套 + 当前皮肤已应用）',
  await ev("(function(){return !!(window.__gySkin && window.__gySkin.SKINS.length===9 && document.documentElement.getAttribute('data-skin'));})()"), '');
await ev("document.getElementById('eggClose').click()");
await sleep(200);
check('线上彩蛋栏可收起并记住状态',
  await ev("document.getElementById('eggBar').classList.contains('hide') && localStorage.getItem('codetutor.eggbar.v1')==='0'"), '');
await ev("document.getElementById('eggRestore').click()");
await sleep(200);
check('线上页脚可重新显示彩蛋栏', await ev("!document.getElementById('eggBar').classList.contains('hide')"), '');

// ---- 练习板块（离线题库路径，不依赖真实 Key）----
check('线上练习板块已合并（7 个标签，无独立「代码批改」）',
  await ev("(function(){return document.querySelectorAll('.tab').length===7 && !!document.getElementById('panel-practice') && !document.getElementById('panel-grade') && !document.getElementById('panel-quiz');})()"), '');
check('线上练习：题库出题后进入「作答」步骤',
  await ev("(function(){document.querySelector('.tab[data-panel=\"practice\"]').click();var l=document.getElementById('langSelect');l.value='c';l.dispatchEvent(new Event('change',{bubbles:true}));var v=document.getElementById('quizLevel');v.value='mid';v.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('bankBtn').click();return document.getElementById('stepAnswer').style.display!=='none' && document.getElementById('stepGen').style.display==='none' && document.querySelectorAll('#practiceOutput .q-card').length===1;})()"), '');
check('线上练习：题面代码（含空位标记）已注入答题编辑器',
  await ev("(function(){var v=document.querySelectorAll('.CodeMirror')[1].CodeMirror.getValue();return v.indexOf('int main')>=0 && v.indexOf('____(1)____')>=0;})()"), '');
check('线上练习：出题阶段不泄露答案（题面无「答案 / 解析」）',
  await ev("(function(){var t=document.getElementById('practiceOutput').textContent;return t.indexOf('答案')<0 && t.indexOf('解析')<0;})()"), '');
check('线上练习：难度档位规范提示可切换（二级 / 蓝桥杯级）',
  await ev("(function(){var v=document.getElementById('quizLevel');v.value='king';v.dispatchEvent(new Event('change',{bubbles:true}));var ok=document.getElementById('levelSpec').textContent.indexOf('蓝桥杯')>=0;v.value='mid';v.dispatchEvent(new Event('change',{bubbles:true}));return ok && document.getElementById('levelSpec').textContent.indexOf('计算机等级考试二级')>=0;})()"), '');

// ---- 学习知识 ----
check('线上学习知识：四档难度都能渲染出知识点模块',
  await ev("(function(){document.querySelector('.tab[data-panel=\"knowledge\"]').click();var s=document.getElementById('kbLevel'),o=[];['basic','mid','adv','king'].forEach(function(k){s.value=k;s.dispatchEvent(new Event('change',{bubbles:true}));o.push(document.querySelectorAll('#kbList .kb-card').length);});s.value='basic';s.dispatchEvent(new Event('change',{bubbles:true}));return o.join(',');})()") === '6,7,6,6', '');
check('线上学习知识：模块含要点/易错点/考法/语言提示',
  await ev("(function(){var t=document.getElementById('kbList').textContent;return (t.indexOf('要点')>=0)&&(t.indexOf('易错点')>=0)&&(t.indexOf('典型考法')>=0)&&/Python \u63d0\u793a|C \u63d0\u793a|C\\+\\+ \u63d0\u793a/.test(t);})()"), '');
check('线上学习知识：标记掌握会写入本地并更新进度',
  await ev("(function(){document.querySelectorAll('#kbList [data-kb-done]')[0].click();return !!document.querySelector('#kbList .kb-done-badge') && String(localStorage.getItem('codetutor.kb.v1')).indexOf('basic:')>=0;})()"), '');
check('线上学习知识：「练这个知识点」能带到练习板块',
  await ev("(function(){document.querySelectorAll('#kbList [data-kb-practice]')[0].click();return document.getElementById('panel-practice').classList.contains('active') && document.getElementById('quizTopic').value.length>0;})()"), '');

// ---- 实用工具 · 文档阅读器 ----
check('线上文档阅读器：拖拽区与多格式支持到位',
  await ev("(function(){var a=document.getElementById('frFile').getAttribute('accept')||'';return !!document.getElementById('frDrop') && a.indexOf('.pdf')>0 && a.indexOf('.epub')>0 && a.indexOf('.docx')>0;})()"), '');
await ev("(function(){document.querySelector('.tab[data-panel=\"tools\"]').click();var dt=new DataTransfer();dt.items.add(new File(['# 标题\\n\\n正文内容\\n\\n- 一\\n- 二'],'线上.md',{type:'text/markdown'}));document.getElementById('frDrop').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));return true;})()");
await sleep(900);
check('线上文档阅读器：能真的拖入并渲染 Markdown',
  (await ev("document.querySelectorAll('#frFiles .fr-file').length")) === 1, String(await ev("document.querySelectorAll('#frFiles .fr-file').length")));
check('线上文档阅读器：Markdown 正确渲染且显示字数',
  await ev("(function(){return document.querySelectorAll('#frBody .md li').length===2 && document.getElementById('frStats').textContent.indexOf('字')>0;})()"), '');
check('线上文档阅读器：正文不写入 localStorage（隐私）',
  await ev("(function(){var s=JSON.stringify(localStorage);return s.indexOf('正文内容')<0;})()"), '');

// ---- 通义千问连通性（浏览器直连能力）----
check('线上：浏览器能直连通义千问（CORS 预检通过）',
  await ev(`(async function(){
    try {
      var r = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'OPTIONS',
        headers: { 'Origin': location.origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' }
      });
      var acao = r.headers.get('access-control-allow-origin') || '';
      return r.ok && !!acao;
    } catch (e) { return 'ERR:' + e.message; }
  })()`), '');
check('线上：API 设置里有「经代理 / 直连」切换',
  await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();return document.querySelectorAll('#proxyModeSeg button').length;})()") === 2, '');
check('线上：切到直连后输入框变成服务商官方端点',
  await ev("(function(){var b=document.querySelectorAll('#proxyModeSeg button');b[1].click();return /^(https:\\/\\/)/.test(document.getElementById('proxyInput').value) && /dashscope|deepseek/.test(document.getElementById('proxyInput').value);})()"), '');
check('线上：直连模式无需代理地址即可判定为已配置',
  await ev("(function(){var k=document.getElementById('apiKeyInput');k.value='sk-live-probe';k.dispatchEvent(new Event('input',{bubbles:true}));return document.getElementById('apiStatus').textContent.indexOf('直连')>=0;})()"), '');
check('线上：代理回来的诊断头默认存在（X-Upstream-*）',
  await ev(`(async function(){
    try {
      var r = await fetch('https://code-tutor-site.pages.dev/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'qwen', model: 'qwen-plus', apiKey: 'sk-live-probe', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
      });
      return String(!!r.headers.get('x-upstream-status')) + '/' + String(!!r.headers.get('x-upstream-ms'));
    } catch (e) { return 'ERR:' + e.message; }
  })()`), '');
check('线上：多模态请求被正确识别（X-Images=1）',
  await ev(`(async function(){
    try {
      var r = await fetch('https://code-tutor-site.pages.dev/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'qwen', model: 'qwen-vl-max', apiKey: 'sk-live-probe',
          messages: [{ role: 'user', content: [ { type: 'text', text: '读图' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } } ] }] })
      });
      return r.headers.get('x-images');
    } catch (e) { return 'ERR:' + e.message; }
  })()`), '');
await ev("(function(){var b=document.querySelectorAll('#proxyModeSeg button');if(b[0])b[0].click();})()");

console.log('\n================ 判定 ================');
results.forEach(r => console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.n + (r.ok ? '' : '   → ' + r.d)));
const bad = results.filter(r => !r.ok);
console.log('\n' + (bad.length === 0 ? '全部通过 ✅ —— 线上同源代理已对【所有人】可用' : bad.length + ' 项失败 ❌'));
ws.close();
process.exit(bad.length === 0 ? 0 : 1);
