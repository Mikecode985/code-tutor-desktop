/**
 * 全功能完整性审计（真实 Chrome · 线上生产站点）
 *
 *  A 阶段：不干预网络，验证「真实链路」能跑的功能
 *    结构/导航 · 语言联动 · 外观与皮肤 · 帮助 · 彩蛋栏 · 学习进度 · API 设置（真代理两步自检）· 安全 · 布局
 *  B 阶段：用 Page.addScriptToEvaluateOnNewDocument 注入确定性 AI 桩后重载，
 *    验证所有「需要模型」的功能：对话 / 代码助手 / 练习（AI 出题 → 作答 → 批改）/ 进度联动 / 持久化
 *
 * 用法：先起 headless Chrome（--remote-debugging-port=9222），再 node feature-audit.mjs
 */
const SITE = process.env.AUDIT_SITE || 'https://code-tutor-site.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- CDP 连接 ---------- */
async function target() {
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:9222/json/list')).json(); const t = l.find(x => x.type === 'page'); if (t) return t; } catch {}
    await sleep(250);
  }
  throw new Error('CDP 不可用（请先启动 headless Chrome 并开放 9222）');
}
const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = m => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } else if (x.method) events.push(x); };
const send = (method, params = {}) => new Promise(res => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return 'EXC:' + String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text).split('\n')[0];
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');

/* ---------- 结果收集 ---------- */
const results = [];
let area = '';
const setArea = a => { area = a; console.log('\n── ' + a + ' ──'); };
async function chk(name, expr, pred) {
  const v = await ev(expr);
  const bad = v === undefined || String(v).indexOf('EXC:') === 0;
  const ok = !bad && (pred ? pred(v) : !!v);
  results.push({ area, name, ok, v: bad ? String(v) : JSON.stringify(v).slice(0, 76) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '   →   ' + String(bad ? v : JSON.stringify(v)).slice(0, 76));
  return ok;
}
const chkRaw = (name, ok, v) => {
  results.push({ area, name, ok: !!ok, v: String(v).slice(0, 76) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '   →   ' + String(v).slice(0, 76));
  return !!ok;
};

async function ready() {
  for (let i = 0; i < 80; i++) {
    const n = await ev("document.readyState==='complete' && document.querySelectorAll('.CodeMirror').length");
    if (n === 2) return true;
    await sleep(250);
  }
  return false;
}
async function navigate(url) {
  const before = events.length;
  await send('Page.navigate', { url });
  for (let i = 0; i < 100; i++) {
    if (events.slice(before).some(e => e.method === 'Page.loadEventFired')) break;
    await sleep(200);
  }
  return await ready();
}
let navSeq = 0;
/** 关键：每次导航都用不同 URL 触发「真正的整页加载」。
 *  只改 hash 属于同文档跳转：内联脚本不会重跑，addScriptToEvaluateOnNewDocument 也不生效。 */
async function nav(hash) {
  await send('Page.navigate', { url: SITE + '/?audit=' + (++navSeq) + '&t=' + Date.now() + (hash || '') });
  return await ready();
}
const js = (fn, ...args) => '(' + fn.toString() + ')(' + args.map(a => JSON.stringify(a)).join(',') + ')';
const click = id => ev('document.getElementById(' + JSON.stringify(id) + ').click(), true');
const setV = (id, v) => ev(js(function (i, val) { var e = document.getElementById(i); e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return e.value; }, id, v));
const waitFor = async (expr, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { if (await ev(expr)) return true; await sleep(150); } return false; };

/* ============================================================
 * A 阶段：真实链路
 * ============================================================ */
console.log('\n================ A 阶段 · 真实链路（' + SITE + '）================');
let okReady = await nav('#chat');
if (!okReady) { console.log('页面未就绪，尝试再等一轮…'); okReady = await ready(); }
chkRaw('页面加载并完成初始化（两个 CodeMirror 就绪）', okReady, okReady);
await ev("localStorage.clear()");
await nav('#chat');

setArea('A1 · 全局结构与导航');
await chk('7 个标签页（对话/助手/练习/知识/工具/进度/设置）', "document.querySelectorAll('.tab').length", v => v === 7);
await chk('7 个面板，且不存在独立的 quiz/grade 面板', "document.querySelectorAll('.panel').length + (document.getElementById('panel-quiz')?1:0) + (document.getElementById('panel-grade')?1:0)", v => v === 7);
await chk('默认落在「对话」页', "document.getElementById('panel-chat').classList.contains('active')", v => v === true);
await chk('Alt+3 切到「练习」', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'3',altKey:true})), document.getElementById('panel-practice').classList.contains('active')", v => v === true);
await chk('Alt+7 切到「API 设置」', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'7',altKey:true})), document.getElementById('panel-api').classList.contains('active')", v => v === true);
await nav('#progress');
await chk('带 hash 打开时直达「学习进度」页', "document.getElementById('panel-progress').classList.contains('active')", v => v === true);
await ev("location.hash='#assistant'"); await sleep(400);
await chk('hash 变化时自动切页（前进/后退可用）', "document.getElementById('panel-assistant').classList.contains('active')", v => v === true);

setArea('A2 · 编程语言联动');
await chk('顶部语言渲染为分段控件（3 个按钮）', "document.querySelectorAll('.seg button').length", v => v >= 3);
await chk('切到 C 后四处语言徽标联动', js(function () {
  var s = document.getElementById('langSelect'); s.value = 'c'; s.dispatchEvent(new Event('change', { bubbles: true }));
  return ['assistantLangBadge', 'practiceLangBadge', 'gradeLangBadge', 'answerLangBadge'].map(function (i) { return document.getElementById(i).textContent; }).join('|');
}), v => v === 'C|C|C|C');
await chk('切到 C 后编辑器语法模式变为 C', "String(document.querySelectorAll('.CodeMirror')[0].CodeMirror.getOption('mode'))", v => String(v).indexOf('c') >= 0);
await chk('两个编辑器实例（助手 + 答题区）', "document.querySelectorAll('.CodeMirror').length", v => v === 2);
await setV('langSelect', 'python');

setArea('A3 · 外观（三态）与贵阳多彩皮肤');
const themeSeq = await ev(js(function () {
  var out = [];
  for (var i = 0; i < 3; i++) { document.getElementById('themeBtn').click(); out.push(document.documentElement.getAttribute('data-theme') + ':' + document.getElementById('themeLbl').textContent); }
  return out.join(' → ');
}));
chkRaw('主题按钮三态循环（跟随系统/浅色/深色）且 data-theme 同步', /dark|light/.test(String(themeSeq)) && String(themeSeq).split('→').length === 3, themeSeq);
await chk('CSS 令牌已由皮肤脚本注入（html:root 覆盖静态兜底）', "document.getElementById('gySkinStyle').textContent.indexOf('html:root{') === 0 && document.getElementById('gySkinStyle').textContent.indexOf('--brand:') > 0", v => v === true);
await chk('皮肤面板列出 9 套贵阳皮肤', "(document.getElementById('skinBtn').click(), document.querySelectorAll('#skinGrid .skin-card').length)", v => v === 9);
await chk('点击「数谷蓝调」后令牌换成该皮肤主色并落盘', js(function () {
  document.querySelectorAll('#skinGrid .skin-card')[2].click();
  var css = document.getElementById('gySkinStyle').textContent;
  return document.documentElement.getAttribute('data-skin') + '|' + (css.indexOf('--brand:#0a66c2') >= 0) + '|' + localStorage.getItem('codetutor.skin.v1') + '|' + document.getElementById('skinLbl').textContent;
}), v => v === 'shugu|true|shugu|数谷蓝调');
await click('skinCloseBtn');
await chk('皮肤面板可关闭', "document.getElementById('skinMask').classList.contains('show')", v => v === false);
await chk('主题色 meta 跟随皮肤', "!!document.querySelector('meta[name=\"theme-color\"]').getAttribute('content')", v => v === true);
await ev("window.__gySkin.apply('lin')");

setArea('A4 · 快捷键帮助弹窗');
await chk('按 ? 打开帮助弹窗', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'?'})), document.getElementById('helpMask').classList.contains('show')", v => v === true);
await chk('帮助弹窗列出 6 条快捷键', "document.querySelectorAll('#helpMask table tr').length", v => v === 6);
await chk('Esc 关闭帮助弹窗', "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})), document.getElementById('helpMask').classList.contains('show')", v => v === false);
await chk('点「知道了」也能关', "(document.getElementById('helpBtn').click(), document.getElementById('helpCloseBtn').click(), !document.getElementById('helpMask').classList.contains('show'))", v => v === true);

setArea('A5 · 彩蛋栏（贵州发展吧）');
await chk('文案与来源正确', js(function () {
  var t = document.getElementById('eggBar').textContent;
  return (t.indexOf('代码写累了') >= 0) + '|' + (t.indexOf('贵州发展吧') >= 0) + '|' + (t.indexOf('休息一下吧') >= 0);
}), v => v === 'true|true|true');
await chk('按钮指向贵州发展吧（新窗口 + noopener）', js(function () {
  var a = document.getElementById('eggGo');
  return a.getAttribute('href') + '|' + a.getAttribute('target') + '|' + (a.getAttribute('rel') || '').indexOf('noopener');
}), v => v === 'https://tieba.baidu.com/f?kw=%E8%B4%B5%E5%B7%9E%E5%8F%91%E5%B1%95&fr=personalize_page|_blank|0');
await chk('可收起并记住状态', "(document.getElementById('eggClose').click(), document.getElementById('eggBar').classList.contains('hide') && localStorage.getItem('codetutor.eggbar.v1') === '0')", v => v === true);
await chk('页脚可重新显示', "(document.getElementById('eggRestore').click(), !document.getElementById('eggBar').classList.contains('hide') && localStorage.getItem('codetutor.eggbar.v1') === '1')", v => v === true);

setArea('A6 · 学习进度（空态与组件）');
await ev("document.querySelector('.tab[data-panel=\"progress\"]').click()");
await chk('8 张统计卡', "document.querySelectorAll('#statGrid .stat-card').length", v => v === 8);
await chk('趋势区含范围切换与提示', "!!document.getElementById('trendRangeSeg') && !!document.getElementById('trendBox') && !!document.getElementById('trendTip')", v => v === true);
await chk('按语言统计容器存在', "!!document.getElementById('langStats')", v => v === true);
await chk('导出 / 导入 / 清空三个操作齐全', "!!document.getElementById('gradeExportBtn') && !!document.getElementById('gradeImportBtn') && !!document.getElementById('gradeImportFile') && !!document.getElementById('gradeClearBtn')", v => v === true);
await chk('批改历史空态给出引导文案', "document.getElementById('gradeList').textContent.trim().length", v => v > 0);


setArea('A6b · 学习知识（四档知识点总结）');
await ev("document.querySelector('.tab[data-panel=\"knowledge\"]').click()");
await chk('顶部出现「学习知识」板块（7 个标签页）', "document.querySelectorAll('.tab').length", v => v === 7);
await chk('四档难度可切换，且每档都有知识模块', js(function () {
  var out = [];
  var s = document.getElementById('kbLevel');
  ['basic', 'mid', 'adv', 'king'].forEach(function (k) {
    s.value = k; s.dispatchEvent(new Event('change', { bubbles: true }));
    out.push(document.querySelectorAll('#kbList .kb-card').length);
  });
  s.value = 'basic'; s.dispatchEvent(new Event('change', { bubbles: true }));
  return out.join(',');
}), v => v === '6,7,6,6');
await chk('模块包含要点 / 易错点 / 典型考法 / 当前语言提示', js(function () {
  var t = document.getElementById('kbList').textContent;
  return (t.indexOf('要点') >= 0) + '/' + (t.indexOf('易错点') >= 0) + '/' + (t.indexOf('典型考法') >= 0) + '/' + (/Python 提示|C 提示|C\+\+ 提示/.test(t));
}), v => v === 'true/true/true/true');
await chk('模块可折叠展开', js(function () {
  var n0 = document.querySelectorAll('#kbList .kb-card.open').length;
  document.querySelectorAll('#kbList .kb-head')[1].click();
  var n1 = document.querySelectorAll('#kbList .kb-card.open').length;
  return n0 + '→' + n1;
}), v => v === '1→2');
await chk('标记已掌握写入本地存储并更新进度条', js(function () {
  document.querySelectorAll('#kbList [data-kb-done]')[0].click();
  var w = document.getElementById('kbProgressFill').style.width;
  var ls = String(localStorage.getItem('codetutor.kb.v1'));
  return (document.querySelectorAll('#kbList .kb-done-badge').length === 1) + '|' + (w !== '' && w !== '0%') + '|' + (ls.indexOf('basic:') >= 0);
}), v => v === 'true|true|true');
await chk('「练这个知识点」带到练习并预设档位与知识点', js(function () {
  document.querySelectorAll('#kbList [data-kb-practice]')[0].click();
  return document.getElementById('panel-practice').classList.contains('active') + '|' + (document.getElementById('quizTopic').value.length > 0);
}), v => v === 'true|true');
await chk('知识点储备里不含任何密钥', "String(localStorage.getItem('codetutor.kb.v1')||'').indexOf('sk-')", v => v === -1);

setArea('A6c · 实用工具（文档阅读器）');
await ev("document.querySelector('.tab[data-panel=\"tools\"]').click()");
await chk('「实用工具」板块含拖拽区与文件选择', "!!document.getElementById('frDrop') && !!document.getElementById('frFile')", v => v === true);
await chk('支持 Markdown / TXT / PDF / EPUB / DOCX',
  "(function(){var a=document.getElementById('frFile').getAttribute('accept')||'';return ['.md','.txt','.pdf','.epub','.docx'].every(function(e){return a.indexOf(e)>=0;});})()", v => v === true);
await chk('声明了「文件不上传」的隐私说明', "document.getElementById('panel-tools').textContent.indexOf('不会上传') >= 0", v => v === true);
await chk('未打开文件时 AI / 导出按钮为禁用', "document.getElementById('frAiBtn').disabled && document.getElementById('frMdBtn').disabled", v => v === true);

setArea('A7 · API 设置 + 真实两步自检');
await ev("document.querySelector('.tab[data-panel=\"api\"]').click()");
await chk('四个配置项齐全（服务商/模型/Key/代理地址）', "!!document.getElementById('providerSelect') && !!document.getElementById('modelInput') && !!document.getElementById('apiKeyInput') && !!document.getElementById('proxyInput')", v => v === true);
await chk('服务商切换会更新模型列表与提示', js(function () {
  var p = document.getElementById('providerSelect');
  var a = document.getElementById('providerHint').textContent + '|' + document.getElementById('modelList').children.length;
  p.value = 'qwen'; p.dispatchEvent(new Event('change', { bubbles: true }));
  var b = document.getElementById('providerHint').textContent + '|' + document.getElementById('modelList').children.length;
  p.value = 'deepseek'; p.dispatchEvent(new Event('change', { bubbles: true }));
  return (a !== b);
}), v => v === true);
await chk('Key 可切换明文/密文显示', js(function () {
  var i = document.getElementById('apiKeyInput');
  i.value = 'sk-audit-fake-key';
  var before = i.type;
  document.getElementById('toggleKeyBtn').click();
  var after = i.type;
  document.getElementById('toggleKeyBtn').click();
  return before + '→' + after;
}), v => v === 'password→text');
await chk('免责声明可见', "document.getElementById('panel-api').textContent.indexOf('免责') >= 0", v => v === true);
await chk('访客零配置：自动探测到同源代理 /api/chat', "document.getElementById('proxyInput').value", v => v === '/api/chat');
await click('testApiBtn');
const twoStep = await waitFor("document.getElementById('apiTestResult').textContent.indexOf('第 2 步') >= 0 && document.getElementById('apiTestResult').textContent.length > 40", 20000);
chkRaw('两步自检跑完并给出第 1 步结论',
  twoStep && await ev("(document.getElementById('apiTestResult').textContent.indexOf('代理自检通过')>=0)"),
  twoStep + '|' + await ev("(document.getElementById('apiTestResult').textContent.indexOf('代理自检通过')>=0)"));
await chk('第 2 步如实报告上游结果（假 Key → 401）', "document.getElementById('apiTestResult').textContent.indexOf('401') >= 0 || document.getElementById('apiTestResult').textContent.indexOf('Authentication') >= 0", v => v === true);

setArea('A8 · 安全（Key 不落盘）');
await chk('本地存储里没有任何以 sk- 开头的值', js(function () {
  var bad = [];
  for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (String(localStorage.getItem(k)).indexOf('sk-') >= 0) bad.push(k); }
  return bad.length;
}), v => v === 0);
await nav('#api');
await chk('刷新后 Key 输入框为空（只在内存里）', "document.getElementById('apiKeyInput').value.length", v => v === 0);
await chk('刷新后代理地址仍自动探测到位', "document.getElementById('proxyInput').value", v => v === '/api/chat');

setArea('A9 · 布局与稳定性');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(300);
await chk('桌面 1440 无横向溢出', "document.documentElement.scrollWidth - document.documentElement.clientWidth", v => v <= 2);
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await chk('手机 390 无横向溢出', "document.documentElement.scrollWidth - document.documentElement.clientWidth", v => v <= 2);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const realErrors = events.filter(e => e.method === 'Runtime.exceptionThrown');
// 说明：直连模式下「测试连接」会故意向 dashscope / deepseek 发 CORS 预检，
// 这类请求被网络拦下时浏览器必然在控制台记一条 CORS 错误 —— app 里已经用 try/catch
// 把它变成界面上的明确提示，所以这里把这两家的探测噪音排除，其余 CORS 错误仍然算失败。
const PROBE_NOISE = /dashscope|deepseek\.com|generativelanguage|api\.openai/i;
const badLogs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' &&
  /Uncaught|CORS|ERR_BLOCKED|LocalNetworkAccess|is not defined|undefined is not/.test(e.params.entry.text || '') &&
  !PROBE_NOISE.test(e.params.entry.text || ''));
chkRaw('A 阶段无未捕获异常、无 CORS/脚本错误', realErrors.length === 0 && badLogs.length === 0,
  '异常=' + realErrors.length + ' 错误日志=' + badLogs.length + (badLogs[0] ? ' 例:' + String(badLogs[0].params.entry.text).slice(0, 60) : ''));

/* ============================================================
 * B 阶段：注入确定性 AI 桩后重载
 * ============================================================ */
console.log('\n================ B 阶段 · 注入 AI 桩（验证所有需要模型的功能）================');

const GRADE = ['## 一、总分', '**85 / 100**，核心思路正确。', '', '## 二、逐题得分表',
  '| 评分项 | 分值 | 得分 | 扣分原因 |', '| --- | --- | --- | --- |',
  '| 语法与编译 | 20 | 20 | 编译通过 |', '| 输入输出格式 | 20 | 16 | 第 12 行输出多了一个空格 |',
  '| 核心算法 | 40 | 35 | 第 7 行循环边界少一次 |', '| 边界处理 | 20 | 14 | 未处理 n=1 的情况 |', '',
  '## 三、样例演算', '样例 1 通过。', '', '## 四、漏洞清单', '- 第 7 行循环边界少一次', '- 未处理 n=1', '',
  '## 五、参考标准代码', '```cpp', '#include <bits/stdc++.h>', 'using namespace std;', 'int main(){', '    int n; cin >> n;', '    long long s = 0;', '    for (int i = 1; i <= n; ++i) s += i;', '    cout << s << endl;', '    return 0;', '}', '```', '',
  '## 六、学习总结与易错点', '1. 注意循环边界；2. 注意输出格式；3. 注意 long long 溢出。', '',
  '```json', '{"score":85,"verdict":"通过","items":[{"name":"语法与编译","max":20,"got":20,"reason":"编译通过"},{"name":"输入输出格式","max":20,"got":16,"reason":"第 12 行输出多了一个空格"},{"name":"核心算法","max":40,"got":35,"reason":"第 7 行循环边界少一次"},{"name":"边界处理","max":20,"got":14,"reason":"未处理 n=1 的情况"}],"samplesPassed":true,"sampleNote":"2/2 组样例通过","bugs":["第 7 行循环边界少一次","未处理 n=1"],"summary":"基础扎实，注意边界与格式"}', '```'].join('\n');

const ASST = ['# 代码诊断报告', '## 一、总体结论', '这段代码**无法通过编译**，存在 2 处致命问题。', '',
  '- 第 4 行：`printf` 末尾缺少分号（语法错误）', '- 第 6 行：数组下标 `a[n]` 越界（逻辑错误，UB）', '',
  '### 修正后的完整代码', '```cpp', '#include <iostream>', 'using namespace std;', 'int main() {', '    int n; cin >> n;', '    int a[1005];', '    for (int i = 0; i < n; ++i) cin >> a[i];', '    for (int i = 0; i < n; ++i) cout << a[i] << " ";', '    return 0;', '}', '```', '',
  '| 问题 | 类型 | 严重程度 |', '| --- | --- | --- |', '| 缺分号 | 语法错误 | 致命 |', '| 数组越界 | 逻辑错误 | 严重 |', '',
  '> 提交前务必检查每一行末尾的分号与循环边界。'].join('\n');

const CHAT = ['列表推导式就是把「循环 + 追加」压缩成一行：', '', '```python',
  'squares = [x * x for x in range(5)]   # [0, 1, 4, 9, 16]', '```', '', '几个要点：', '',
  '- 后面能加 `if` 过滤：`[x for x in nums if x > 0]`', '- 也能写字典推导：`{k: v for k, v in d.items()}`',
  '- 嵌套太多会牺牲可读性，考试里别写三层以上', '', '> 记忆点：先写「要什么」，再写「从哪来」，最后写「什么条件」。'].join('\n');

const QUIZ_JSON = JSON.stringify({ problems: [{
  id: 1, type: 'coding', title: '求和', points: 24,
  statement: '读入 n 个整数，输出它们的和。',
  inputFormat: '第一行一个整数 n；第二行 n 个整数。', outputFormat: '一行一个整数。',
  samples: [{ input: '3\n1 2 3', expected: '6', note: '样例 1' }, { input: '1\n-5', expected: '-5', note: '边界：单个负数' }],
  constraints: '1 ≤ n ≤ 1000', limits: '时间 1s / 内存 256MB',
  scorePoints: ['读入 20 分', '累加 50 分', '输出格式 20 分', '边界 10 分'],
  stemCode: '', templateCode: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    // 在此作答\n    return 0;\n}\n',
  blanks: [], choices: []
}] });
const QUIZ = ['### 第 1 题 · 编程题 · 24 分', '**题目描述**：读入 n 个整数，输出它们的和。',
  '**输入格式**：第一行一个整数 n；第二行 n 个整数。', '**输出格式**：一行一个整数。', '**样例**：',
  '```text', '输入：3 1 2 3', '输出：6', '```', '**数据范围**：1 ≤ n ≤ 1000',
  '**评分点**：读入 20 分 / 累加 50 分 / 输出格式 20 分 / 边界 10 分', '', '```json', QUIZ_JSON, '```'].join('\n');

const STUB = [
  '(function(){',
  '  /* 注意：桩里绝不能清 localStorage，否则会把「刷新后仍在」的持久化用例清空 */',
  '  window.__copied = []; window.__blobs = 0;',
  '  try { navigator.clipboard.writeText = function(t){ window.__copied.push(String(t)); return Promise.resolve(); }; } catch(e){}',
  '  var _oc = URL.createObjectURL; URL.createObjectURL = function(b){ window.__blobs++; return _oc ? _oc.call(URL, b) : "blob:stub"; };',
  '  var enc = new TextEncoder();',
  '  var GRADE = ' + JSON.stringify(GRADE) + ';',
  '  var ASST  = ' + JSON.stringify(ASST) + ';',
  '  var CHAT  = ' + JSON.stringify(CHAT) + ';',
  '  var QUIZ  = ' + JSON.stringify(QUIZ) + ';',
  '  window.fetch = function(url, init){',
  '    if (!init || !init.method || init.method === "GET") {',
  '      return Promise.resolve(new Response(JSON.stringify({ok:true,service:"codelearn-proxy",version:"1.1.0",deploy:"pages-function",providers:["deepseek","qwen"]}), {status:200, headers:{"Content-Type":"application/json"}}));',
  '    }',
  '    var b = JSON.parse(init.body || "{}");',
  '    var text = JSON.stringify(b.messages || []);',
  '    var reply = text.indexOf("批改下面这份") >= 0 ? GRADE',
  '             : text.indexOf("本档出题规范") >= 0 ? QUIZ',
  '             : text.indexOf("自由聊天") >= 0 ? CHAT : ASST;',
  '    if (!b.stream) return Promise.resolve(new Response(JSON.stringify({choices:[{message:{role:"assistant",content:reply}}]}), {status:200, headers:{"Content-Type":"application/json"}}));',
  '    var stream = new ReadableStream({ start: function(c){',
  '      for (var i=0;i<reply.length;i+=36) c.enqueue(enc.encode("data: " + JSON.stringify({choices:[{delta:{content:reply.slice(i,i+36)}}]}) + "\\n\\n"));',
  '      c.enqueue(enc.encode("data: [DONE]\\n\\n")); c.close();',
  '    }});',
  '    return new Promise(function(r){ setTimeout(function(){ r(new Response(stream, {status:200, headers:{"Content-Type":"text/event-stream"}})); }, 40); });',
  '  };',
  '})();'
].join('\n');

const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await nav('#chat');
await chk('AI 桩已随新文档注入（fetch 被替换）', "String(window.fetch).indexOf('function') === 0", v => v === true);
await ev("document.querySelector('.tab[data-panel=\"api\"]').click()");
await setV('apiKeyInput', 'sk-audit-stub-key');
await sleep(150);

setArea('B1 · 对话（AI）');
await ev("document.querySelector('.tab[data-panel=\"chat\"]').click()");
await chk('默认页为空态且带按语言定制的快捷提问（≥3 个）', "document.querySelectorAll('#chatBody .chip').length", v => v >= 3);
await click('chatNewBtn');
await chk('新建会话后左侧列表出现 1 条', "document.querySelectorAll('#chatList .chat-item').length", v => v === 1);
await setV('chatInput', 'Python 列表推导式是什么？能举个例吗？');
await click('chatSendBtn');
const got2 = await waitFor("document.querySelectorAll('#chatBody .msg').length >= 2 && document.querySelector('#chatBody .msg.ai .md') && document.querySelector('#chatBody .msg.ai .md').textContent.length > 20", 12000);
chkRaw('流式回复落地：用户 + AI 两条消息',
  got2 && (await ev("document.querySelectorAll('#chatBody .msg').length")) === 2,
  got2 + '|' + await ev("document.querySelectorAll('#chatBody .msg').length"));
await chk('Markdown 渲染：代码块 / 列表 / 引用', js(function () {
  return document.querySelectorAll('#chatBody .msg.ai .code-block').length + '/' + document.querySelectorAll('#chatBody .msg.ai .md ul li').length + '/' + document.querySelectorAll('#chatBody .msg.ai .md blockquote').length;
}), v => v === '1/3/1');
await chk('会话标题自动取自首条提问', "document.getElementById('chatTitle').value.indexOf('列表推导式') >= 0", v => v === true);
await chk('消息操作按钮齐全（复制/重新生成/删除）', "document.querySelectorAll('#chatBody .msg.ai .acts button').length", v => v >= 3);
await chk('会话搜索框可过滤', js(function () {
  var s = document.getElementById('chatSearch');
  s.value = '不存在的会话关键字'; s.dispatchEvent(new Event('input', { bubbles: true }));
  var a = document.querySelectorAll('#chatList .chat-item').length;
  s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
  var b = document.querySelectorAll('#chatList .chat-item').length;
  return a + '→' + b;
}), v => v === '0→1');
await chk('对话历史已写入 localStorage', "(localStorage.getItem('codetutor.chat.v1')||'').indexOf('列表推导式') >= 0", v => v === true);
await chk('导出会话按钮可用（点击不报错）', "(document.getElementById('chatExportBtn').click(), true)", v => v === true);
await chk('滚动到底部按钮存在（长对话时出现）', "!!document.getElementById('scrollBottomBtn')", v => v === true);
await chk('对话滚动链未断：.chat-main 被约束在 .chat-shell 内、内层才滚动', js(function () {
  var shell = document.querySelector('.chat-shell'), main = document.querySelector('.chat-main');
  var b = document.getElementById('chatBody');
  var hs = shell.getBoundingClientRect().height, hm = main.getBoundingClientRect().height;
  return (hm <= hs + 1) + '|' + (getComputedStyle(b).overflowY === 'auto') + '|' + (getComputedStyle(main).minHeight === '0px');
}), v => v === 'true|true|true');

setArea('B2 · 代码助手（AI）');
await ev("document.querySelector('.tab[data-panel=\"assistant\"]').click()");
await chk('4 个快捷动作按钮', "document.querySelectorAll('#assistantActions button').length", v => v === 4);
await chk('上传入口与示例按钮存在', "!!document.getElementById('assistantPickBtn') && !!document.getElementById('assistantFile') && !!document.getElementById('assistantDemoBtn')", v => v === true);
await ev(js(function () { document.querySelectorAll('#assistantActions button')[0].click(); }));
await sleep(200);
await ev("document.querySelectorAll('.CodeMirror')[0].CodeMirror.setValue('#include <stdio.h>\\nint main(){ int n; scanf(\"%d\", &n); int a[1005]; for(int i=0;i<=n;i++) a[i]=i; printf(\"%d\", a[n]) return 0; }')");
await chk('编辑器行数/字符统计实时更新', "Number(document.getElementById('assistantLines').textContent) > 0 && Number(document.getElementById('assistantChars').textContent) > 40", v => v === true);
await click('assistantAskBtn');
const asstOK = await waitFor("document.querySelectorAll('#assistantOutput .code-block').length >= 1 && !!document.querySelector('#assistantOutput table')", 12000);
const asstMd = await ev("document.querySelectorAll('#assistantOutput .code-block').length + '/' + document.querySelectorAll('#assistantOutput table').length + '/' + document.querySelectorAll('#assistantOutput ul li').length + '/' + document.querySelectorAll('#assistantOutput blockquote').length");
chkRaw('流式输出 + Markdown（代码块/表格/列表/引用）', asstOK && asstMd === '1/1/2/1', asstOK + '|' + asstMd);
await chk('代码块复制按钮写入剪贴板', js(function () {
  var b = document.querySelector('#assistantOutput .copy-btn');
  if (!b) return 'no-btn';
  b.click();
  return window.__copied.length;
}), v => v === 1);
await click('assistantClearBtn');
await chk('清空按钮清掉编辑器与输出', "document.querySelectorAll('.CodeMirror')[0].CodeMirror.getValue().length === 0", v => v === true);
await chk('代码助手使用次数已计入学习进度', "(JSON.parse(localStorage.getItem('codetutor.progress.v1')||'{}').assist||0) >= 1", v => v === true);

setArea('B3 · 练习：AI 出题（不给答案）');
await ev("document.querySelector('.tab[data-panel=\"practice\"]').click()");
const specs = await ev(js(function () {
  var out = [];
  var v = document.getElementById('quizLevel');
  ['basic', 'mid', 'adv', 'king'].forEach(function (k) {
    v.value = k; v.dispatchEvent(new Event('change', { bubbles: true }));
    out.push(document.getElementById('levelSpec').textContent.slice(0, 10));
  });
  return out.join('|');
}));
chkRaw('四档难度的规范提示都能显示（基础/二级/竞赛/蓝桥杯级）',
  String(specs).split('|').length === 4 && String(specs).indexOf('当前档位') >= 0, specs);
await chk('五档题型可选（含按难度自动配比）', "document.getElementById('quizType').options.length", v => v === 5);
await chk('题目数量 1/2/3/5', "document.getElementById('quizCount').options.length", v => v === 4);
await chk('内置题库按钮存在（离线可出题）', "!!document.getElementById('bankBtn')", v => v === true);
await setV('quizLevel', 'mid'); await setV('quizType', 'coding'); await setV('quizCount', '1');
await click('quizGenBtn');
const genOK = await waitFor("document.querySelectorAll('#answerArea .q-card').length > 0 && document.querySelectorAll('#practiceOutput .q-card').length > 0", 15000);
const genStep = await ev("document.getElementById('stepGen').style.display === 'none' && document.getElementById('stepAnswer').style.display !== 'none' && document.querySelectorAll('#practiceSteps .step-item')[1].classList.contains('active')");
chkRaw('生成后自动进入「作答」步骤（步骤条高亮 2）', genOK && genStep, genOK + '|' + genStep);
await chk('题面渲染出样例 / 数据范围 / 评分点', js(function () {
  var t = document.getElementById('practiceOutput').textContent;
  return (t.indexOf('样例') >= 0) + '/' + (t.indexOf('数据范围') >= 0) + '/' + (t.indexOf('评分点') >= 0);
}), v => v === 'true/true/true');
await chk('★出题阶段不泄露答案（无「答案/解析」，无 JSON 契约残留）', js(function () {
  var t = document.getElementById('practiceOutput').textContent;
  return (t.indexOf('答案') >= 0) + '/' + (t.indexOf('解析') >= 0) + '/' + (t.indexOf('"problems"') >= 0);
}), v => v === 'false/false/false');
await chk('★题面里的模板代码已注入答题编辑器', "document.querySelectorAll('.CodeMirror')[1].CodeMirror.getValue().indexOf('int main')", v => v >= 0);
await chk('答题编辑器标出当前题号与题型', "document.getElementById('answerWhich').textContent", v => String(v).indexOf('第 1 题') >= 0 && String(v).indexOf('编程题') >= 0);
await chk('未作答直接提交会被拦下', js(function () {
  document.querySelectorAll('.CodeMirror')[1].CodeMirror.setValue('   ');
  document.getElementById('submitAnswerBtn').click();
  return document.getElementById('stepGrade').style.display;
}), v => v === 'none');

setArea('B4 · 练习：提交 → 批改');
await ev("document.querySelectorAll('.CodeMirror')[1].CodeMirror.setValue('#include <bits/stdc++.h>\\nint main(){ int n; return 0; }')");
await click('submitAnswerBtn');
const gradeOK = await waitFor("document.querySelectorAll('#gradeScoreArea .score-card').length === 1", 15000);
const gradeStep = await ev("document.getElementById('stepGrade').style.display !== 'none'");
chkRaw('进入「批改」步骤并渲染评分卡', gradeOK && gradeStep, gradeOK + '|' + gradeStep);
await chk('总分解析为 85', "document.querySelector('#gradeScoreArea .score-ring .inner b').textContent", v => v === '85');
await chk('4 条评分项进度条按比例填充', js(function () {
  var f = document.querySelectorAll('#gradeScoreArea .bar-fill'), t = document.querySelectorAll('#gradeScoreArea .bar-track'), o = [];
  for (var i = 0; i < f.length; i++) o.push(Math.round(f[i].getBoundingClientRect().width / t[i].getBoundingClientRect().width * 100));
  return o.join(',');
}), v => v === '100,80,88,70');
await chk('样例通过与漏洞摘要渲染', js(function () {
  var t = document.getElementById('gradeScoreArea').textContent;
  return (t.indexOf('2/2') >= 0) + '/' + (t.indexOf('循环边界') >= 0);
}), v => v === 'true/true');
await chk('批改报告渲染 Markdown 表格与参考代码', "document.querySelectorAll('#gradeOutput table').length + '/' + document.querySelectorAll('#gradeOutput .code-block').length", v => v === '1/1');
await chk('不把裸 JSON 评分块展示给用户', "document.getElementById('gradeOutput').textContent.indexOf('\"score\"')", v => v === -1);
await chk('严格模式开关存在且默认开启', "document.getElementById('gradeStrict').checked", v => v === true);
await chk('「回去改一改」回到作答步骤', "(document.getElementById('gradeAgainBtn').click(), document.getElementById('stepAnswer').style.display !== 'none')", v => v === true);
await chk('「再出一套」回到出题步骤', "(document.getElementById('gradeNewBtn').click(), document.getElementById('stepGen').style.display !== 'none')", v => v === true);
await chk('批改记录已写入学习进度（含分数与明细）', js(function () {
  var g = JSON.parse(localStorage.getItem('codetutor.progress.v1') || '{}').grades || [];
  return g.length + '|' + (g[0] ? g[0].score : '') + '|' + (g[0] && g[0].items ? g[0].items.length : 0);
}), v => v === '1|85|4');

setArea('B5 · 练习：内置题库（4 档 × 语言）');
const bankRes = await ev(js(function () {
  var out = [];
  function set(id, v) { var e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }
  ['basic', 'mid', 'adv', 'king'].forEach(function (lv) {
    set('quizLevel', lv); set('quizType', 'mix'); set('quizCount', '5');
    document.getElementById('bankBtn').click();
    var n = document.querySelectorAll('#practiceOutput .q-card').length;
    var code = document.querySelectorAll('.CodeMirror')[1].CodeMirror.getValue();
    out.push(lv + ':' + n + ':' + (code.length > 10));
  });
  return out.join(' | ');
}));
chkRaw('四档都能从内置题库出题并进入作答（离线、不消耗 API）',
  String(bankRes).split('|').length === 4 && String(bankRes).indexOf(':0:') < 0, bankRes);
await chk('题库题目的题面代码同样进了答题区', js(function () {
  var l = document.getElementById('langSelect'); l.value = 'c'; l.dispatchEvent(new Event('change', { bubbles: true }));
  var v = document.getElementById('quizLevel'); v.value = 'mid'; v.dispatchEvent(new Event('change', { bubbles: true }));
  document.getElementById('bankBtn').click();
  var code = document.querySelectorAll('.CodeMirror')[1].CodeMirror.getValue();
  return code.indexOf('____(1)____') >= 0 || (code.indexOf('int main') >= 0);
}), v => v === true);

setArea('B6 · 学习进度（有数据后）');
await ev("document.querySelector('.tab[data-panel=\"progress\"]').click()");
await sleep(300);
await chk('统计卡显示批改次数与平均分', js(function () {
  var t = document.getElementById('statGrid').textContent;
  return (t.indexOf('批改次数') >= 0) + '/' + (t.indexOf('85') >= 0);
}), v => v === 'true/true');
await chk('趋势图画出折线与数据点', "document.querySelectorAll('#trendBox svg polyline').length + '/' + document.querySelectorAll('#trendBox svg circle').length", v => v === '1/1');
await chk('按语言统计出现记录', "document.getElementById('langStats').textContent.indexOf('次') >= 0", v => v === true);
await chk('批改历史列表 1 条且可展开明细', js(function () {
  var n = document.querySelectorAll('#gradeList .grade-item').length;
  document.querySelector('#gradeList [data-act="toggle"]').click();
  return n + '|' + document.querySelector('#gradeList .grade-item').classList.contains('open');
}), v => v === '1|true');
await chk('历史「重新批改」把题目带回练习作答页', js(function () {
  document.querySelector('#gradeList [data-act="redo"]').click();
  return document.getElementById('panel-practice').classList.contains('active') + '|' + (document.getElementById('stepAnswer').style.display !== 'none');
}), v => v === 'true|true');
await chk('趋势范围切换可用', js(function () {
  document.querySelector('.tab[data-panel="progress"]').click();
  var b = document.querySelectorAll('#trendRangeSeg button');
  if (b.length < 2) return 'no-seg';
  b[1].click(); var all = b[1].getAttribute('aria-pressed');
  b[0].click(); var ten = b[0].getAttribute('aria-pressed');
  return all + '|' + ten;
}), v => v === 'true|true');
await chk('导出 JSON 触发下载（createObjectURL 被调用）', "(document.getElementById('gradeExportBtn').click(), window.__blobs >= 1)", v => v === true);

setArea('B7 · 持久化（刷新后仍在）');
await nav('#chat');
await chk('刷新后对话历史仍在', "document.querySelectorAll('#chatList .chat-item').length >= 1 && (localStorage.getItem('codetutor.chat.v1')||'').indexOf('列表推导式') >= 0", v => v === true);
await chk('刷新后学习进度仍在（1 条批改记录）', "(JSON.parse(localStorage.getItem('codetutor.progress.v1')||'{}').grades||[]).length === 1", v => v === true);
await chk('刷新后皮肤选择仍在', "localStorage.getItem('codetutor.skin.v1')", v => v === 'shugu' || v === 'lin');
await chk('刷新后知识点掌握记录仍在', "String(localStorage.getItem('codetutor.kb.v1')).indexOf('basic:') >= 0", v => v === true);
await chk('全程仍然只有两个编辑器、7 个面板', "document.querySelectorAll('.CodeMirror').length + '/' + document.querySelectorAll('.panel').length", v => v === '2/7');

const bExceptions = events.filter(e => e.method === 'Runtime.exceptionThrown').length;
const bBadLogs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && /Uncaught|is not defined|Cannot read/.test(e.params.entry.text || '')).length;
chkRaw('B 阶段无未捕获异常、无脚本错误', bExceptions === 0 && bBadLogs === 0, '异常=' + bExceptions + ' 错误日志=' + bBadLogs);

await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier });

/* ---------- 汇总 ---------- */
const byArea = {};
results.forEach(r => { byArea[r.area] = byArea[r.area] || { p: 0, f: 0 }; byArea[r.area][r.ok ? 'p' : 'f']++; });
console.log('\n================ 全功能审计汇总 ================');
Object.keys(byArea).forEach(a => console.log('  ' + (byArea[a].f === 0 ? '✅' : '❌') + ' ' + a.padEnd(34) + ' 通过 ' + byArea[a].p + (byArea[a].f ? ' / 失败 ' + byArea[a].f : '')));
const fails = results.filter(r => !r.ok);
console.log('\n  总计：' + results.length + ' 项，通过 ' + (results.length - fails.length) + '，失败 ' + fails.length);
if (fails.length) { console.log('\n  失败明细：'); fails.forEach(f => console.log('   ✘ [' + f.area + '] ' + f.name + ' → ' + f.v)); }
console.log(fails.length === 0 ? '\n  ✅ 全功能完整性审计通过' : '\n  ❌ 存在未通过项');
process.exit(fails.length === 0 ? 0 : 1);
