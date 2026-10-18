/**
 * 新功能（对话 + 学习进度）视觉验证 + 预览图
 * 顺序很重要：先载入 → 预置 localStorage → 重新载入 → 再注入伪 fetch → 造对话 → 截图
 * （伪 fetch 必须放在最后一次 reload 之后，否则会被页面加载冲掉）
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8897;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const page = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/' || p === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(ROOT + '/index.html'));
  }
  if (p === '/api/chat') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'codelearn-proxy', version: '1.1.0', deploy: 'pages-function', providers: ['deepseek', 'qwen'] }));
  }
  res.writeHead(404); res.end('not found');
});
await new Promise(r => page.listen(PORT, '127.0.0.1', r));

async function target() {
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9222/json/list')).json(); const t = l.find(x => x.type === 'page'); if (t) return t; } catch {}
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
const ev = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.exceptionDetails ? 'EXC:' + (r.result.exceptionDetails.exception?.description || '').split('\n')[0] : r.result?.result?.value; };
const shot = async (file, full) => {
  const params = { format: 'png' };
  if (full) {
    const m = await send('Page.getLayoutMetrics');
    params.clip = { x: 0, y: 0, width: Math.ceil(m.result.cssContentSize.width), height: Math.min(Math.ceil(m.result.cssContentSize.height), 3200), scale: 1 };
    params.captureBeyondViewport = true;
  }
  const r = await send('Page.captureScreenshot', params);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  return fs.statSync(file).size;
};
async function load() {
  const done = new Promise(res => { const iv = setInterval(() => { if (events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(iv); res(); } }, 100); setTimeout(() => { clearInterval(iv); res(); }, 20000); });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
  await done;
  for (let i = 0; i < 60; i++) { if (await ev("document.querySelectorAll('.CodeMirror').length") === 2) break; await sleep(200); }
  await sleep(300);
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });

/* 预置一批批改记录（用于画趋势） */
const now = Date.now();
const days = {};
for (let i = 6; i >= 0; i--) { const d = new Date(now - i * 86400000); days[d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')] = 1; }
const mk = (offsetDays, lang, score, grade, problem) => ({ ts: now - offsetDays * 86400000, lang, score, grade, problem, code: 'int main(){ return 0; }', items: [], summary: '' });
const grades = [
  { ts: now - 5000, lang: 'cpp', score: 88, grade: '通过', problem: '题目：区间求和，输入 n 与 q 次询问，输出每组询问的区间和', code: '#include <bits/stdc++.h>\nint main(){ /* 前缀和 */ }', items: [{ name: '语法与编译', max: 20, got: 20, reason: '编译通过' }, { name: '核心算法', max: 40, got: 35, reason: '用了前缀和，复杂度合格' }, { name: '边界处理', max: 20, got: 15, reason: '未处理 n=1' }, { name: '代码规范', max: 20, got: 18, reason: '命名可以更好' }], summary: '思路正确，注意边界' },
  mk(1, 'python', 92, '通过', '题目：统计字符串中每个字符出现的次数'),
  mk(2, 'c', 76, '通过', '题目：读入 n 个整数，输出最大值与最小值'),
  mk(3, 'python', 58, '不通过', '题目：判断回文字符串'),
  mk(4, 'cpp', 81, '通过', '题目：冒泡排序并输出每一轮结果'),
  mk(6, 'c', 95, '通过', '题目：求两个整数的最大公约数')
];
const progress = { grades, quiz: 5, assist: 9, chat: 14, days };

await load();
await ev(`(function(){
  localStorage.setItem('codetutor.progress.v1', ${JSON.stringify(JSON.stringify(progress))});
  localStorage.setItem('codetutor.settings.v1', JSON.stringify({lang:'python',provider:'deepseek',model:'deepseek-chat',proxyUrl:'/api/chat'}));
  return 1;
})()`);
await load();   // 重新载入，让预置数据生效

/* 注入伪 AI（必须在这之后，reload 会清掉 window 上的补丁） */
await ev(`(function(){
  var enc = new TextEncoder();
  var lines = [
    '列表推导式就是把「循环 + 追加」压缩成一行：',
    '',
    '\u0060\u0060\u0060python',
    'squares = [x * x for x in range(5)]   # [0, 1, 4, 9, 16]',
    '\u0060\u0060\u0060',
    '',
    '还能带条件：',
    '',
    '- \u0060[x for x in nums if x > 0]\u0060 只保留正数',
    '- \u0060{k: v for k, v in d.items()}\u0060 是字典推导式',
    '',
    '**考试提醒**：推导式嵌套太多会牺牲可读性，容易看错缩进。'
  ];
  var REPLY = lines.join('\\n');
  window.fetch = function(url, init){
    if (!init || !init.method || init.method === 'GET') {
      return Promise.resolve(new Response('{"ok":true,"service":"codelearn-proxy","version":"1.1.0","deploy":"pages-function"}', {status:200}));
    }
    var stream = new ReadableStream({ start: function(c){
      for (var i=0;i<REPLY.length;i+=24) c.enqueue(enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:REPLY.slice(i,i+24)}}]}) + '\\n\\n'));
      c.enqueue(enc.encode('data: [DONE]\\n\\n')); c.close();
    }});
    return Promise.resolve(new Response(stream, {status:200}));
  };
  return 1;
})()`);

/* 造一段对话 */
await ev(`(function(){
  var k = document.getElementById('apiKeyInput');
  k.value = 'sk-demo-key-for-screenshot';
  k.dispatchEvent(new Event('input',{bubbles:true}));
  return 1;
})()`);
await ev("document.getElementById('chatNewBtn').click()");
await sleep(150);
await ev("document.getElementById('chatInput').value = 'Python 列表推导式是什么？能给个例子吗？'");
await ev("document.getElementById('chatSendBtn').click()");
await sleep(2000);
await ev(`(function(){
  document.getElementById('chatInput').value = '那字典推导式呢？和列表推导式有什么区别？';
  document.getElementById('chatSendBtn').click();
  return 1;
})()`);
await sleep(2200);

console.log('对话页：消息 ' + await ev("document.querySelectorAll('#chatBody .msg').length") + ' 条，会话 ' +
  await ev("document.querySelectorAll('#chatList .chat-item').length") + ' 个，代码块 ' +
  await ev("document.querySelectorAll('#chatBody .code-block').length") + ' 个');
const s1 = await shot(ROOT + '/preview-6-chat.png', true);

/* 学习进度页 */
await ev("document.querySelector('.tab[data-panel=\"progress\"]').click()");
await sleep(500);
console.log('进度页：统计卡 ' + await ev("document.querySelectorAll('#statGrid .stat-card').length") +
  ' 张，趋势点 ' + await ev("document.querySelectorAll('#trendBox svg circle').length") +
  ' 个，历史 ' + await ev("document.querySelectorAll('#gradeList .grade-item').length") + ' 条');
await ev("document.querySelector('#gradeList [data-act=\"toggle\"]').click()");
await sleep(300);
const s2 = await shot(ROOT + '/preview-7-progress.png', true);

/* 手机端对话页 */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await ev("document.querySelector('.tab[data-panel=\"chat\"]').click()");
await sleep(500);
console.log('手机端 390px 横向溢出: ' + await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth') + 'px');
const s3 = await shot(ROOT + '/preview-8-chat-mobile.png', false);
await send('Emulation.clearDeviceMetricsOverride');

/* 皮肤截图：直接调 window.__gySkin.apply 切皮 */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("document.documentElement.setAttribute('data-theme','light')");
const skinShots = [];
for (const pair of [['lin','light','preview-11-skin-lin.png'], ['shugu','dark','preview-12-skin-shugu-dark.png'], ['yinghua','light','preview-13-skin-yinghua.png'], ['jiubamen','dark','preview-14-skin-jiubamen-dark.png']]) {
  await ev("window.__gySkin.apply('" + pair[0] + "')");
  await ev("document.documentElement.setAttribute('data-theme','" + pair[1] + "')");
  await ev("document.querySelector('.tab[data-panel=\"progress\"]').click()");
  await sleep(500);
  const b = await shot(ROOT + '/' + pair[2], true);
  skinShots.push(pair[0] + '/' + pair[1] + '=' + b + 'B');
  console.log('  皮肤 ' + pair[0] + ' / ' + pair[1] + ' → ' + pair[2] + ' (' + b + 'B)');
}
await ev("window.__gySkin.apply('lin')");

/* 深色主题截图（配色对齐 DSH） */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("document.documentElement.setAttribute('data-theme','dark')");
await ev("document.querySelector('.tab[data-panel=\"chat\"]').click()");
await sleep(500);
const s4 = await shot(ROOT + '/preview-9-dark-chat.png', true);
await ev("document.querySelector('.tab[data-panel=\"progress\"]').click()");
await sleep(500);
await ev("document.querySelector('#gradeList [data-act=\"toggle\"]').click()");
await sleep(300);
const s5 = await shot(ROOT + '/preview-10-dark-progress.png', true);

/* 彩蛋栏特写（浅色 + 深色） */
async function clipOf(sel, file, scale) {
  const r = JSON.parse(await ev("(function(){var e=document.querySelector('" + sel + "');var b=e.getBoundingClientRect();return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,w:b.width,h:b.height});})()"));
  const sc = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
    clip: { x: Math.floor(r.x) - 6, y: Math.floor(r.y) - 6, width: Math.ceil(r.w) + 12, height: Math.ceil(r.h) + 12, scale: scale || 2 } });
  fs.writeFileSync(file, Buffer.from(sc.result.data, 'base64'));
  return fs.statSync(file).size;
}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("document.getElementById('eggBar').classList.remove('hide')");
await sleep(500);
const eggLight = await clipOf('#eggBar', ROOT + '/preview-16-eggbar-light.png', 2);
console.log('  彩蛋栏（林城晨雾·浅色）→ ' + eggLight + 'B');
await ev("document.documentElement.setAttribute('data-theme','dark')");
await ev("window.__gySkin.apply('jiubamen')");
await sleep(500);
const eggDark = await clipOf('#eggBar', ROOT + '/preview-17-eggbar-dark.png', 2);
console.log('  彩蛋栏（九门夜灯·深色）→ ' + eggDark + 'B');
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");

/* 练习板块：出题 / 作答（题面代码直接进答题区） */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("document.querySelector('.tab[data-panel=\"practice\"]').click()");
await sleep(400);
await ev("(function(){var l=document.getElementById('langSelect');l.value='c';l.dispatchEvent(new Event('change',{bubbles:true}));var v=document.getElementById('quizLevel');v.value='mid';v.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('bankBtn').click();})()");
await sleep(600);
const pGen = await shot(ROOT + '/preview-18-practice-gen.png', true);
const codeInEditor = await ev("document.querySelectorAll('.CodeMirror')[1].CodeMirror.getValue()");
console.log('  作答区编辑器里是否有题面代码(含空位标记): ' + (codeInEditor.indexOf('____(1)____') >= 0));
const pAns = await shot(ROOT + '/preview-19-practice-answer.png', true);
console.log('  练习-出题页=' + pGen + 'B  练习-作答页=' + pAns + 'B');

/* 对话空态（贵阳天际线 + 城市精神印章） */
await ev("localStorage.clear()");
await send('Page.reload', { ignoreCache: true });
await sleep(2200);
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("document.querySelector('.tab[data-panel=\"chat\"]').click()");
await sleep(500);
const sEmpty = await shot(ROOT + '/preview-20-chat-empty.png', false);
console.log('  空态英雄图存在: ' + await ev("!!document.querySelector('.chat-empty .gy-hero svg')") + ' | 印章: ' + await ev("(document.querySelector('.gy-seal')||{}).textContent"));

/* 实用工具 · 文档阅读器（真实拖入一个 Markdown 文件） */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("document.querySelector('.tab[data-panel=\"tools\"]').click()");
const mdBody = ['# 甲秀楼与南明河', '', '**甲秀楼**始建于明代，位于贵阳南明河鳌矶石上，是贵阳的地标。', '',
  '## 一、历史沿革', '', '- 明万历二十六年（1598）始建', '- 清代多次重修', '- 1982 年列为省级文物保护单位', '',
  '## 二、建筑特色', '', '| 部位 | 材质 |', '| --- | --- |', '| 楼身 | 木构 |', '| 桥墩 | 石砌 |', '',
  '> 三层三檐四角攒尖顶，高约 20 米。', '', '浮玉桥长 90 余米，贯通两岸。'].join('\n');
await ev("(function(){var dt=new DataTransfer();dt.items.add(new File([" + JSON.stringify(mdBody) + "], '甲秀楼.md', { type: 'text/markdown' }));dt.items.add(new File(['黔灵山有猕猴，山在城北。'], '黔灵山.txt', { type: 'text/plain' }));document.getElementById('frDrop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));return true;})()");
await sleep(900);
await ev("(document.querySelectorAll('#frFiles .fr-file')[0] || {click:function(){}}).click()");
await sleep(400);
const pReader = await shot(ROOT + '/preview-23-reader.png', false);
const frInfo = await ev("document.querySelectorAll('#frFiles .fr-file').length + '/' + document.querySelectorAll('#frBody .md h2').length");
console.log('  阅读器：文件数/正文标题数=' + frInfo + ' → ' + pReader + 'B');

/* 学习知识板块（基础档 + 竞赛档） */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("window.__gySkin.apply('lin')");
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("document.querySelector('.tab[data-panel=\"knowledge\"]').click()");
await sleep(500);
const pKb1 = await shot(ROOT + '/preview-21-knowledge-basic.png', true);
await ev("(function(){var s=document.getElementById('kbLevel');s.value='king';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelectorAll('#kbList .kb-head')[1].click();})()");
await sleep(500);
const pKb2 = await shot(ROOT + '/preview-22-knowledge-king.png', false);
console.log('  知识板块：基础档=' + pKb1 + 'B  王者档=' + pKb2 + 'B');

/* 皮肤选择面板：截图 + 真实点击验证 */
await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await ev("document.documentElement.setAttribute('data-theme','light')");
await ev("window.__gySkin.apply('lin')");
await sleep(400);
await ev("document.getElementById('skinBtn').click()");
await sleep(500);
console.log('  皮肤面板卡片数: ' + await ev("document.querySelectorAll('#skinGrid .skin-card').length"));
const s6 = await shot(ROOT + '/preview-15-skin-picker.png', false);
// 真实点击第 5 张（青岩古韵 #4f6a72）并核对令牌与按钮文案
await ev("document.querySelectorAll('#skinGrid .skin-card')[4].click()");
await sleep(500);
const after = await ev("document.documentElement.getAttribute('data-skin') + ' | ' + document.getElementById('skinLbl').textContent + ' | 令牌含主色=' + (document.getElementById('gySkinStyle').textContent.indexOf('--brand:#4f6a72') >= 0) + ' | 已存=' + localStorage.getItem('codetutor.skin.v1')");
console.log('  点击「青岩古韵」后: ' + after);
await ev("document.getElementById('skinCloseBtn').click()");
await sleep(200);
console.log('  面板已关闭: ' + await ev("!document.getElementById('skinMask').classList.contains('show')"));

const errs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error').map(e => e.params.entry.text);
console.log('控制台错误: ' + (errs.length ? errs.map(x => x.slice(0, 120)).join(' | ') : '无'));
console.log('阅读器=' + pReader + 'B');
console.log('练习-出题=' + pGen + 'B  练习-作答=' + pAns + 'B\n皮肤面板=' + s6 + 'B');
console.log('截图: 对话=' + s1 + 'B  进度=' + s2 + 'B  手机=' + s3 + 'B  深色对话=' + s4 + 'B  深色进度=' + s5 + 'B');

ws.close(); page.close();
process.exit(0);
