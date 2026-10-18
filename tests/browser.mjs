/**
 * 真实浏览器验证 + 预览图生成（CDP）
 * 1) 加载 file:// 页面，确认 CodeMirror CDN 加载成功
 * 2) 注入伪 AI 响应，跑通「代码助手」与「代码批改」
 * 3) 检查桌面/手机视口是否横向溢出
 * 4) 输出 3 张 PNG 预览图
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE_URL = 'file:///' + ROOT_DIR.replace(/\\/g, '/') + '/index.html';
const OUT = ROOT_DIR;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
      const p = list.find(t => t.type === 'page');
      if (p) return p;
    } catch {}
    await sleep(250);
  }
  throw new Error('CDP 不可用');
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = m => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
};
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { err: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
  return { v: r.result?.result?.value };
}
async function shot(file, fullPage) {
  let params = { format: 'png' };
  if (fullPage) {
    const m = await send('Page.getLayoutMetrics');
    const w = Math.ceil(m.result.cssContentSize.width), h = Math.ceil(m.result.cssContentSize.height);
    params.clip = { x: 0, y: 0, width: w, height: Math.min(h, 4000), scale: 1 };
    params.captureBeyondViewport = true;
  }
  const r = await send('Page.captureScreenshot', params);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  return fs.statSync(file).size;
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
const loaded = new Promise(res => { const iv = setInterval(() => { if (events.some(e => e.method === 'Page.loadEventFired')) { clearInterval(iv); res(); } }, 100); setTimeout(() => { clearInterval(iv); res(); }, 20000); });
await send('Page.navigate', { url: FILE_URL });
await loaded;
await sleep(3000);   // 等 CDN 上的 CodeMirror

// 仅为截图：把 sticky 顶栏改为 static，避免全页截图时顶栏被绘制到页面中部（不影响真实布局）
await ev(`(function(){var st=document.createElement('style');st.textContent='.topbar{position:static !important}';document.head.appendChild(st);})()`);

const checks = [];
const chk = async (name, expr, pass) => { const r = await ev(expr); const v = r.err ? 'ERR:' + r.err : r.v; checks.push({ name, v, ok: pass(v) }); };

await chk('CodeMirror 从 CDN 加载成功', 'typeof window.CodeMirror', v => v === 'function');
await chk('真实 CodeMirror 实例数', 'document.querySelectorAll(".CodeMirror").length', v => v === 2);
await chk('CM 已应用语法高亮 class', 'document.querySelectorAll(".CodeMirror .cm-keyword, .CodeMirror .cm-variable").length', v => typeof v === 'number' && v > 0);
await chk('桌面 1440 无横向溢出', 'document.documentElement.scrollWidth - document.documentElement.clientWidth', v => v <= 2);

// 回归：桌面端长对话必须能在对话区内部滚动（曾经因为 .chat-main 缺 min-height:0 而无法滚动）
await chk('长对话可在对话区内部滚动到底（回归用例）', `(function(){
  var b = document.getElementById('chatBody');
  for (var i = 0; i < 14; i++) {
    var d = document.createElement('div');
    d.className = 'msg ai';
    d.innerHTML = '<div class="bubble"><div class="md"><p>滚动回归测试内容第 ' + i + ' 段</p></div></div>';
    b.appendChild(d);
  }
  var max = b.scrollHeight - b.clientHeight;
  b.scrollTop = 1e6;
  var shell = document.querySelector('.chat-shell').getBoundingClientRect().height;
  var main = document.querySelector('.chat-main').getBoundingClientRect().height;
  return (max > 200) + '/' + (Math.abs(b.scrollTop - max) < 4) + '/' + (main <= shell + 1);
})()`, v => v === 'true/true/true');
await ev(`(function(){var b=document.getElementById('chatBody');while(b.children.length>0)b.removeChild(b.firstChild);})()`);

// 注入伪 AI（流式 SSE + 批改 JSON）
await ev(`(function(){
  var GRADE = ['## 一、总分','**85 / 100**，核心思路正确。','','## 二、逐项得分表','| 评分项 | 分值 | 得分 | 扣分原因 |','| --- | --- | --- | --- |','| 语法与编译 | 20 | 20 | 编译通过 |','| 输入输出格式 | 20 | 16 | 第 12 行输出多了一个空格 |','| 核心算法 | 40 | 35 | 第 7 行循环边界少一次 |','| 边界处理 | 20 | 14 | 未处理 n=1 的情况 |','','## 五、参考标准代码','\`\`\`cpp','#include <bits/stdc++.h>','using namespace std;','int main(){','    int n; cin >> n;','    long long s = 0;','    for (int i = 1; i <= n; ++i) s += i;','    cout << s << endl;','    return 0;','}','\`\`\`','','## 六、学习总结','1. 注意循环边界；2. 注意输出格式；3. 注意 long long 溢出。','','\`\`\`json','{"score":85,"verdict":"通过","items":[{"name":"语法与编译","max":20,"got":20,"reason":"编译通过"},{"name":"输入输出格式","max":20,"got":16,"reason":"第 12 行输出多了一个空格"},{"name":"核心算法","max":40,"got":35,"reason":"第 7 行循环边界少一次"},{"name":"边界处理","max":20,"got":14,"reason":"未处理 n=1 的情况"}],"samplesPassed":true,"sampleNote":"2/2 组样例通过","bugs":["第 7 行循环边界少一次","未处理 n=1"],"summary":"基础扎实，注意边界与格式"}','\`\`\`'].join('\\n');
  var ASST = ['# 代码诊断报告','## 一、总体结论','这段代码**无法通过编译**，存在 2 处致命问题。','','- 第 4 行：\`printf\` 末尾缺少分号（语法错误）','- 第 6 行：数组下标 \`a[n]\` 越界（逻辑错误，UB）','','### 修正后的完整代码','\`\`\`cpp','#include <iostream>','using namespace std;','int main() {','    int n; cin >> n;','    int a[1005];','    for (int i = 0; i < n; ++i) cin >> a[i];','    for (int i = 0; i < n; ++i) cout << a[i] << " ";','    return 0;','}','\`\`\`','','| 问题 | 类型 | 严重程度 |','| --- | --- | --- |','| 缺分号 | 语法错误 | 致命 |','| 数组越界 | 逻辑错误 | 严重 |','','> 提交前务必检查每一行末尾的分号与循环边界。'].join('\\n');
  var enc = new TextEncoder();
  window.fetch = function(url, init){
    if (!init || !init.method || init.method === 'GET') {
      return Promise.resolve(new Response(JSON.stringify({ok:true,service:'codelearn-proxy',version:'1.1.0',providers:['deepseek','qwen']}), {status:200, headers:{'Content-Type':'application/json'}}));
    }
    var b = JSON.parse(init.body);
    var text = JSON.stringify(b.messages).indexOf('批改下面这份') >= 0 ? GRADE : ASST;
    if (!b.stream) return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:text}}]}), {status:200}));
    var stream = new ReadableStream({ start: function(c){
      for (var i=0;i<text.length;i+=40) c.enqueue(enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:text.slice(i,i+40)}}]}) + '\\n\\n'));
      c.enqueue(enc.encode('data: [DONE]\\n\\n')); c.close();
    }});
    return new Promise(function(r){ setTimeout(function(){ r(new Response(stream,{status:200})); }, 150); });
  };
})()`);

// 配置 + 载入代码 + 触发诊断
await ev(`(function(){
  function set(id,v){ var e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
  document.querySelector('.tab[data-panel="api"]').click();
  set('proxyInput','https://codelearn-proxy.demo.workers.dev');
  set('apiKeyInput','sk-demo-key-not-real');
  var s = document.getElementById('langSelect'); s.value='cpp'; s.dispatchEvent(new Event('change'));
  document.querySelector('.tab[data-panel="assistant"]').click();
})()`);
await sleep(200);
await ev(`document.querySelectorAll('.CodeMirror')[0].CodeMirror.setValue('#include <iostream>\\nusing namespace std;\\nint main(){\\n    int n; cin >> n;\\n    int a[1005];\\n    for (int i = 0; i < n; ++i) cin >> a[i];\\n    for (int i = 0; i < n; ++i) cout << a[i] << " ";\\n    return 0;\\n}')`);
await ev(`document.querySelector('#assistantActions .btn[data-mode="diagnose"]').click()`);
await ev(`new Promise(r=>setTimeout(r,1500))`);
await chk('代码助手：AI 结果渲染出代码块', 'document.querySelectorAll("#assistantOutput .code-block").length', v => v >= 1);
await chk('代码助手：Markdown 表格/列表/引用齐备',
  'document.querySelectorAll("#assistantOutput table").length + "/" + document.querySelectorAll("#assistantOutput ul li").length + "/" + document.querySelectorAll("#assistantOutput blockquote").length',
  v => v === '1/2/1');
const b1 = await shot(OUT + '/preview-1-assistant.png', true);

// 练习：从题库出题（离线，不依赖 API）→ 作答
await ev(`(function(){
  document.querySelector('.tab[data-panel="practice"]').click();
  var lv = document.getElementById('quizLevel');
  lv.value = 'adv';
  lv.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('bankBtn').click();
})()`);
await sleep(300);
await chk('练习：内置题库出题后进入「作答」步骤',
  '(function(){return document.getElementById("stepAnswer").style.display !== "none" && document.getElementById("stepGen").style.display === "none" && document.querySelectorAll("#practiceOutput .q-card").length;})()',
  v => v === 1);
await chk('练习：题面代码已注入答题区编辑器（可直接作答）',
  'document.querySelectorAll(".CodeMirror")[1].CodeMirror.getValue().indexOf("int main")',
  v => v >= 0);
await chk('练习：题面渲染了样例 / 数据范围 / 评分点',
  '(function(){var t=document.getElementById("practiceOutput").textContent;return (t.indexOf("样例")>=0)&&(t.indexOf("数据范围")>=0)&&(t.indexOf("评分点")>=0);})()',
  v => v === true);
await chk('练习：出题阶段不显示答案',
  'document.getElementById("practiceOutput").textContent.indexOf("答案")',
  v => v === -1);
await sleep(100);
await ev(`document.querySelectorAll('.CodeMirror')[1].CodeMirror.setValue('#include <bits/stdc++.h>\\nusing namespace std;\\nint main(){\\n    int n, q; cin >> n >> q;\\n    vector<int> a(n);\\n    for (auto &x : a) cin >> x;\\n    while (q--) {\\n        int l, r; cin >> l >> r;\\n        long long s = 0;\\n        for (int i = l; i < r; ++i) s += a[i];\\n        cout << s << "\\\\n";\\n    }\\n    return 0;\\n}')`);
await ev(`document.getElementById('submitAnswerBtn').click()`);
await ev(`new Promise(r=>setTimeout(r,1500))`);
await chk('练习批改：评分卡渲染', 'document.querySelectorAll("#gradeScoreArea .score-card").length', v => v === 1);
await chk('练习批改：总分 = 85', 'document.querySelector("#gradeScoreArea .score-ring .inner b").textContent', v => String(v) === '85');
await chk('练习批改：4 个评分项进度条', 'document.querySelectorAll("#gradeScoreArea .bar-row").length', v => v === 4);
await chk('评分条填充真实像素宽度 ≈ 得分比例（100/80/88/70%）',
  `(function(){var f=document.querySelectorAll('#gradeScoreArea .bar-fill'),t=document.querySelectorAll('#gradeScoreArea .bar-track'),o=[];for(var i=0;i<f.length;i++){o.push(Math.round(f[i].getBoundingClientRect().width/t[i].getBoundingClientRect().width*100));}return o.join(',');})()`,
  v => v === '100,80,88,70');
await chk('评分圆环中心的最顶层元素是分数文字（防被伪元素遮盖）',
  `new Promise(function(res){var s=document.querySelector('#gradeScoreArea .score-ring');s.scrollIntoView({block:'center'});requestAnimationFrame(function(){var r=s.getBoundingClientRect();var el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);res(el?(el.tagName+':'+el.className+':'+el.textContent):'null');});})`,
  v => typeof v === 'string' && v.indexOf('B:') === 0 && v.indexOf('85') >= 0);
await chk('练习批改报告不再包含裸 JSON', 'document.getElementById("gradeOutput").textContent.indexOf(String.fromCharCode(34)+"score"+String.fromCharCode(34))', v => v === -1);
const b2 = await shot(OUT + '/preview-2-grading.png', true);

// 评分卡特写（2 倍放大），用于人工确认圆环内分数可见
const rect = await ev(`(function(){var r=document.querySelector('#gradeScoreArea .score-card').getBoundingClientRect();return JSON.stringify({x:r.left+window.scrollX,y:r.top+window.scrollY,w:r.width,h:r.height});})()`);
const rc = JSON.parse(rect.v);
const sc = await send('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true, clip: { x: Math.floor(rc.x) - 8, y: Math.floor(rc.y) - 8, width: Math.ceil(rc.w) + 16, height: Math.ceil(rc.h) + 16, scale: 2 }
});
fs.writeFileSync(OUT + '/preview-4-scorecard.png', Buffer.from(sc.result.data, 'base64'));
const b4 = fs.statSync(OUT + '/preview-4-scorecard.png').size;

// ---- 代理自检：两步式「测试连接」----
await ev(`document.querySelector('.tab[data-panel="api"]').click()`);
await ev(`document.getElementById('testApiBtn').click()`);
await ev(`new Promise(r=>setTimeout(r,900))`);
await chk('测试连接 · 第 1 步代理自检通过（识别出本项目 Worker + 版本号）',
  `(function(){var t=document.getElementById('apiTestResult').textContent;return (t.indexOf('代理自检通过')>=0)+'|'+(t.indexOf('1.1.0')>=0);})()`,
  v => v === 'true|true');
await chk('测试连接 · 第 2 步模型连通性正常',
  `document.getElementById('apiTestResult').textContent.indexOf('模型连通性正常')>=0`, v => v === true);
await chk('测试面板提示了两步流程（代理自检 + 模型连通性）',
  `document.getElementById('apiTestResult').previousElementSibling.textContent.indexOf('代理自检')>=0`, v => v === true);

// 手机视口
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await ev(`document.querySelector('.tab[data-panel="assistant"]').click()`);
await ev('window.scrollTo(0,0)');
await sleep(600);
await chk('手机 390px 无横向溢出', 'document.documentElement.scrollWidth - document.documentElement.clientWidth', v => v <= 2);
await chk('手机端编辑器可用（CM 占满宽度）', 'Math.round(document.querySelector(".CodeMirror").getBoundingClientRect().width)', v => v > 200 && v <= 390);
const b3 = await shot(OUT + '/preview-3-mobile.png', false);
await send('Emulation.clearDeviceMetricsOverride');

// 收集真实控制台错误
const errs = events.filter(e => e.method === 'Runtime.exceptionThrown' ||
  (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
  .map(e => e.method === 'Log.entryAdded' ? e.params.entry.text.slice(0, 160) : (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).split('\n')[0]);

console.log('\n============ 真实浏览器（Chrome headless）验证 ============');
checks.forEach(c => console.log('  ' + (c.ok ? 'PASS' : 'FAIL') + '  ' + c.name + '   →   ' + JSON.stringify(c.v)));
console.log('\n控制台错误/异常 (' + errs.length + '):');
errs.forEach(e => console.log('  ' + e));
if (!errs.length) console.log('  无');
console.log('\n评分卡特写: preview-4-scorecard.png=' + b4 + 'B');
console.log('预览图: preview-1-assistant.png=' + b1 + 'B, preview-2-grading.png=' + b2 + 'B, preview-3-mobile.png=' + b3 + 'B');
const bad = checks.filter(c => !c.ok);
console.log('\n结论: ' + (bad.length === 0 && errs.length === 0 ? '全部通过 ✅' : bad.length + ' 项失败 ❌'));
ws.close();
process.exit(bad.length === 0 && errs.length === 0 ? 0 : 1);
