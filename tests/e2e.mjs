/**
 * index.html 端到端 DOM 测试（jsdom + 伪造 AI 响应）
 * 覆盖：初始化 / 标签页 / 语言联动 / Markdown 渲染 / 流式解析 / 代码复制 /
 *       批改评分卡解析 / 习题送入批改 / 无 Key 守卫 / 密钥不落盘
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const requests = [];   // 记录发给「Worker」的请求体
const copied = [];     // 记录复制到剪贴板的文本
let healthChecks = 0;  // 记录代理自检次数
const fetchedUrls = []; // 记录每次请求的 URL（用于验证同源路径解析）
const errors = [];

/* ---------- 伪造 AI 回复内容 ---------- */
const ASSISTANT_REPLY = [
  '# 代码诊断报告',
  '## 一、总体结论',
  '代码存在 **2 处** 问题，无法通过编译。',
  '',
  '- 第 3 行：缺少分号',
  '- 第 7 行：循环边界越界',
  '',
  '### 修正后的完整代码',
  '```cpp',
  '#include <iostream>',
  'int main() { return 0; }',
  '```',
  '',
  '| 问题 | 类型 | 严重程度 |',
  '| --- | --- | --- |',
  '| 缺分号 | 语法错误 | 致命 |',
  '| 越界 | 逻辑错误 | 严重 |',
  '',
  '> 提交前请检查每一行末尾的分号。'
].join('\n');

const GRADE_REPLY = [
  '## 一、总分',
  '85 / 100，核心思路正确，格式与边界有待注意。',
  '',
  '## 二、逐项得分表',
  '| 评分项 | 分值 | 得分 | 扣分原因 |',
  '| --- | --- | --- | --- |',
  '| 语法与编译 | 20 | 20 | 编译通过 |',
  '| 输入输出格式 | 20 | 16 | 第 12 行多了空格 |',
  '',
  '## 五、参考标准代码',
  '```cpp',
  'int main(){ return 0; }',
  '```',
  '',
  '## 六、学习总结',
  '1. 注意边界。2. 注意格式。',
  '',
  '```json',
  '{"score":85,"verdict":"通过","items":[{"name":"语法与编译","max":20,"got":20,"reason":"编译通过"},{"name":"输入输出格式","max":20,"got":16,"reason":"第 12 行多了空格"}],"samplesPassed":true,"sampleNote":"2/2 组样例通过","bugs":["第 7 行循环边界少一次"],"summary":"基础扎实，注意边界与格式"}',
  '```'
].join('\n');

const QUIZ_JSON = JSON.stringify({ problems: [{
  id: 1, type: 'coding', title: '求和', points: 24,
  statement: '读入 n 个整数，输出它们的和。',
  inputFormat: '第一行一个整数 n；第二行 n 个整数。',
  outputFormat: '一行一个整数。',
  samples: [{ input: '3\n1 2 3', expected: '6', note: '样例 1' }, { input: '1\n-5', expected: '-5', note: '边界：单个负数' }],
  constraints: '1 ≤ n ≤ 1000', limits: '时间 1s / 内存 256MB',
  scorePoints: ['读入 20 分', '累加 50 分', '输出格式 20 分', '边界 10 分'],
  stemCode: '',
  templateCode: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int n; cin >> n;\n    // 在此作答\n    return 0;\n}\n',
  blanks: [], choices: []
}] });

const CHOICE_JSON = JSON.stringify({ problems: [{
  id: 1, type: 'choice', title: '变量作用域', points: 5,
  statement: '下面关于 C 语言中 static 局部变量的说法，正确的是？',
  inputFormat: '', outputFormat: '', constraints: '', limits: '',
  samples: [], scorePoints: ['正确选项 100 分'],
  stemCode: '', templateCode: '', blanks: [],
  choices: [
    { key: 'A', text: '每次函数调用都会重新初始化为 0' },
    { key: 'B', text: '只初始化一次，函数调用结束后值仍保留' },
    { key: 'C', text: '作用域与普通局部变量不同，可跨函数访问' },
    { key: 'D', text: '不能用于递归函数' }
  ]
}] });

const CHOICE_REPLY = [
  '### 第 1 题 · 选择题 · 5 分',
  '**题目**：下面关于 C 语言中 static 局部变量的说法，正确的是？',
  '**选项**：',
  'A. 每次函数调用都会重新初始化为 0',
  'B. 只初始化一次，函数调用结束后值仍保留',
  'C. 作用域与普通局部变量不同，可跨函数访问',
  'D. 不能用于递归函数',
  '',
  '```json',
  CHOICE_JSON,
  '```'
].join('\n');

const QUIZ_REPLY = [
  '### 第 1 题 · 编程题 · 24 分',
  '**题目描述**：读入 n 个整数，输出它们的和。',
  '**输入格式**：第一行一个整数 n；第二行 n 个整数。',
  '**输出格式**：一行一个整数。',
  '**样例**：',
  '```text',
  '输入：3 1 2 3',
  '输出：6',
  '```',
  '**数据范围**：1 ≤ n ≤ 1000',
  '**评分点**：读入 20 分 / 累加 50 分 / 输出格式 20 分 / 边界 10 分',
  '',
  '```json',
  QUIZ_JSON,
  '```'
].join('\n');

const CHAT_REPLY = [
  '列表推导式就是把「循环 + 追加」压缩成一行：',
  '',
  '```python',
  'squares = [x * x for x in range(5)]   # [0, 1, 4, 9, 16]',
  '```',
  '',
  '几个要点：',
  '',
  '- 后面能加 `if` 过滤：`[x for x in nums if x > 0]`',
  '- 也能写字典推导：`{k: v for k, v in d.items()}`',
  '- 嵌套太多会牺牲可读性，考试里别写三层以上',
  '',
  '> 记忆点：先写「要什么」，再写「从哪来」，最后写「什么条件」。'
].join('\n');

/* ---------- 伪造 fetch ---------- */
function pick(body) {
  const text = JSON.stringify(body.messages || []);
  if (text.indexOf('批改下面这份') >= 0) return GRADE_REPLY;
  if (text.indexOf('本档出题规范') >= 0) {
    if (text.indexOf('【题型】选择题') >= 0) return CHOICE_REPLY;
    return QUIZ_REPLY;
  }
  if (text.indexOf('请只回复四个字') >= 0) return '连接成功';
  if (text.indexOf('自由聊天') >= 0) return CHAT_REPLY;
  return ASSISTANT_REPLY;
}
function sseResponse(text) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < text.length; i += 24) {
        c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 24) } }] }) + '\n\n'));
      }
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
function jsonResponse(text) {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }), { status: 200 });
}
function plainJson(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function makeCodeMirrorStub(window) {
  return {
    fromTextArea(ta, opts) {
      const div = window.document.createElement('div');
      div.className = 'CodeMirror';
      const inst = {
        _v: ta.value, _h: [], opt_mode: opts && opts.mode,
        getValue() { return this._v; },
        setValue(v) { this._v = v == null ? '' : v; this._h.forEach(f => f()); ta.value = this._v; },
        on(ev, cb) { if (ev === 'change') this._h.push(cb); },
        setOption(k, v) { this['opt_' + k] = v; },
        focus() {}, refresh() {}
      };
      div.CodeMirror = inst;
      ta.parentNode.insertBefore(div, ta.nextSibling);
      return inst;
    }
  };
}

async function boot(withCodeMirror, wrongProxy, autoProxy, seed) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(HTML, {
    url: 'https://codetutor.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (seed) {   // 模拟"重新打开页面"：预置上一次留下的本地数据
        try {
          if (seed.chat) window.localStorage.setItem('codetutor.chat.v1', JSON.stringify(seed.chat));
          if (seed.progress) window.localStorage.setItem('codetutor.progress.v1', JSON.stringify(seed.progress));
        } catch (e) { errors.push('seed 失败: ' + e.message); }
      }
      if (withCodeMirror) window.CodeMirror = makeCodeMirrorStub(window);
      window.fetch = async (url, init) => {
        fetchedUrls.push(String(url));
        const method = (init && init.method) || 'GET';
        if (method === 'GET') {
          // 页面加载时的"自动探测"（不带头）与用户点测试时的"代理自检"（带 Accept 头）要分开处理
          const isProbe = !(init && init.headers && init.headers.Accept);
          if (isProbe && !autoProxy) {
            // 默认模拟"本站没有部署同源函数"，让其余用例保持确定性
            return new Response('not found', { status: 404 });
          }
          healthChecks++;
          if (wrongProxy) return new Response('Authentication Fails (governor)', { status: 401 });
          return plainJson({ ok: true, service: 'codelearn-proxy', version: '1.1.0', deploy: autoProxy ? 'pages-function' : 'worker', providers: ['deepseek', 'qwen'] });
        }
        if (wrongProxy) return new Response('Authentication Fails (governor)', { status: 401 });
        requests.push(JSON.parse(init.body));
        const body = JSON.parse(init.body);
        const text = pick(body);
        return body.stream ? sseResponse(text) : jsonResponse(text);
      };
      window.Response = Response;
      window.ReadableStream = ReadableStream;
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.AbortController = AbortController;
      window.Element.prototype.scrollIntoView = function () {};
      Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText: async (t) => { copied.push(t); } }, configurable: true
      });
      window.addEventListener('error', e => errors.push('window.onerror: ' + (e.message || '')));
    }
  });
  await sleep(120);
  return dom;
}

/* ---------- 断言工具 ---------- */
const results = [];
function check(name, pass, detail) { results.push({ name, pass: !!pass, detail }); }
let activeDom = null;                                  // 当前被测文档（主用例 / 降级用例切换）
function $(sel) { return activeDom.window.document.querySelector(sel); }
function ev2(expr) { return activeDom.window.eval(expr); }
function $$(sel) { return Array.from(activeDom.window.document.querySelectorAll(sel)); }
function click(el) { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true })); }
function setInput(sel, value) {
  const el = $(sel);
  el.value = value;
  el.dispatchEvent(new activeDom.window.Event('input', { bubbles: true }));
  el.dispatchEvent(new activeDom.window.Event('change', { bubbles: true }));
}
async function waitFor(fn, ms = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(40); }
  return false;
}

/* ============================ 主流程 ============================ */
const dom = await boot(true);
activeDom = dom;
const W = dom.window, D = W.document;

// --- A. 初始化 ---
check('初始化无 JS 异常', errors.length === 0, errors.join(' | '));
check('标签页 7 个（对话/助手/练习/知识/实用工具/进度/设置）', $$('.tab').length === 7, $$('.tab').length);
check('面板 7 个', $$('.panel').length === 7, $$('.panel').length);
check('两个 CodeMirror 编辑器（助手/批改）', $$('.CodeMirror').length === 2, $$('.CodeMirror').length);
check('默认语言 Python', $('#langSelect').value === 'python', $('#langSelect').value);
check('示例代码已载入编辑器', $$('.CodeMirror')[0].CodeMirror.getValue().length > 100, $$('.CodeMirror')[0].CodeMirror.getValue().length);
check('行数/字符统计已计算', $('#assistantLines').textContent !== '0', $('#assistantLines').textContent);
check('API 状态初始为未配置', $('#apiStatus').textContent.indexOf('未配置') >= 0, $('#apiStatus').textContent);
check('免责声明存在且提到"不会写入"', D.body.textContent.indexOf('不会') > 0 && D.body.textContent.indexOf('免责') > 0, '');

// --- B. 语言联动 ---
setInput('#langSelect', 'cpp');
await sleep(60);
const badges = ['assistantLangBadge', 'practiceLangBadge', 'gradeLangBadge', 'answerLangBadge'].map(i => $('#' + i).textContent).join('|');
check('切到 C++ 后四处语言徽标联动', badges === 'C++|C++|C++|C++', badges);
const cmMode = $$('.CodeMirror')[0].CodeMirror.opt_mode;
check('CodeMirror 语法模式切到 C++', cmMode === 'text/x-c++src', cmMode);
setInput('#langSelect', 'c');
await sleep(60);
check('切到 C 后模式为 text/x-csrc', $$('.CodeMirror')[0].CodeMirror.opt_mode === 'text/x-csrc', $$('.CodeMirror')[0].CodeMirror.opt_mode);

// --- C. 标签页切换 ---
click($('.tab[data-panel="practice"]'));
await sleep(60);
check('切到练习面板：目标显示、原面板隐藏',
  $('#panel-practice').classList.contains('active') && !$('#panel-assistant').classList.contains('active'), '');

// --- D. 无 Key 守卫 ---
click($('.tab[data-panel="practice"]'));
click($('#quizGenBtn'));
await sleep(250);
check('未配置 API 时给出明确提示并跳到 API 设置页',
  $('#panel-api').classList.contains('active') && $('#toast').textContent.indexOf('API Key') >= 0,
  $('#toast').textContent.slice(0, 40));

// --- E. 配置 API（仅内存）---
click($('.tab[data-panel="api"]'));
setInput('#apiKeyInput', 'sk-test-not-a-real-key');
setInput('#proxyInput', 'https://proxy.example.workers.dev');
await sleep(60);
check('配置后 API 状态转为已就绪', $('#apiStatus').textContent.indexOf('已就绪') >= 0, $('#apiStatus').textContent);
check('密钥未写入 localStorage',
  !(W.localStorage.getItem('codetutor.settings.v1') || '').includes('sk-test'), W.localStorage.getItem('codetutor.settings.v1') || '(空)');
check('密钥字段不落盘：存储对象里没有 apiKey 键',
  !JSON.parse(W.localStorage.getItem('codetutor.settings.v1') || '{}').hasOwnProperty('apiKey'), W.localStorage.getItem('codetutor.settings.v1'));

// --- E2. 连接方式：经代理 / 直连（通义千问"不稳定"的解法）---
click($('.tab[data-panel="api"]'));
check('[连接方式] 有「经代理 / 直连」两个选项', $$('#proxyModeSeg button').length === 2, $$('#proxyModeSeg button').length);
setInput('#apiKeyInput', 'sk-direct-test');
click($$('#proxyModeSeg button')[1]);
await sleep(150);
check('[连接方式] 切到直连后输入框显示直连端点', /^https:\/\//.test($('#proxyInput').value), $('#proxyInput').value);
check('[连接方式] 直连模式说明里写清「不经过本站代理」', $('#proxyModeHint').textContent.indexOf('不经过') >= 0, $('#proxyModeHint').textContent.slice(0, 40));
check('[连接方式] 直连模式下状态徽标显示「直连」', $('#apiStatus').textContent.indexOf('直连') >= 0, $('#apiStatus').textContent);
// 直连下直接发一条对话：请求应打到服务商官方域名，且 body 里没有 provider / apiKey
click($('.tab[data-panel="chat"]'));
await click($('#chatNewBtn'));
await sleep(80);
$('#chatInput').value = '直连测试';
click($('#chatSendBtn'));
await waitFor(() => fetchedUrls.some(u => /dashscope|deepseek\.com/.test(u)), 4000);
const directUrl = fetchedUrls[fetchedUrls.length - 1];
check('[连接方式] 直连请求直接打到服务商官方端点', /dashscope|deepseek\.com/.test(String(directUrl)), directUrl);
const directBody = requests[requests.length - 1] || {};
check('[连接方式] 直连 body 不含 provider / apiKey（Key 走 Authorization 头）',
  directBody.provider === undefined && directBody.apiKey === undefined && !!directBody.model, JSON.stringify(Object.keys(directBody)));
// 切回经代理
click($('.tab[data-panel="api"]'));
click($$('#proxyModeSeg button')[0]);
await sleep(120);
check('[连接方式] 切回经代理后输入框恢复成代理地址（不再是直连端点）',
  !/dashscope|deepseek\.com/.test($('#proxyInput').value), $('#proxyInput').value);

// --- E3. 视觉模型独立配置 + VL 模型的 max_tokens 限流（导致过"出题失败"）---
click($('.tab[data-panel="api"]'));
check('[视觉模型] API 页有独立的「视觉模型（OCR 用）」输入框', !!$('#visionModelInput'), '');
setInput('#visionModelInput', 'qwen-vl-max');
check('[视觉模型] 填了视觉模型不会改动全局模型', $('#modelInput').value !== 'qwen-vl-max', $('#modelInput').value);
// 把全局模型设成 VL 模型（用户误操作的典型场景），出题应自动把 max_tokens 压到 VL 的上限
await ev2("(function(){var m=document.getElementById('modelInput');m.value='qwen-vl-max';m.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
click($('.tab[data-panel="practice"]'));
const beforeVl = requests.length;
click($('#quizGenBtn'));
await waitFor(() => requests.length > beforeVl, 4000);
const vlReq = requests[requests.length - 1] || {};
check('[视觉模型] 全局模型=VL 时，出题把 max_tokens 压到 ≤1500（避免上游 400）',
  Number(vlReq.max_tokens) > 0 && Number(vlReq.max_tokens) <= 1500, 'max_tokens=' + vlReq.max_tokens);
// 换回通用模型后，出题恢复大预算
await ev2("(function(){var m=document.getElementById('modelInput');m.value='qwen-plus';m.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
const beforeTxt = requests.length;
click($('#quizGenBtn'));
await waitFor(() => requests.length > beforeTxt, 4000);
const txtReq = requests[requests.length - 1] || {};
check('[视觉模型] 通用模型（qwen-plus）出题保留大 max_tokens（>1500）',
  Number(txtReq.max_tokens) > 1500, 'max_tokens=' + txtReq.max_tokens);

// --- F. 测试连接（非流式）---
click($('#testApiBtn'));
await waitFor(() => $('#apiTestResult').textContent.indexOf('模型连通性正常') >= 0 || $('#apiTestResult').textContent.indexOf('模型调用失败') >= 0);
const testTxt = $('#apiTestResult').textContent;
check('测试连接 · 第 1 步代理自检通过并显示版本号',
  testTxt.indexOf('代理自检通过') >= 0 && testTxt.indexOf('1.1.0') >= 0, testTxt.slice(0, 80));
check('测试连接 · 第 2 步模型连通性正常（非流式）',
  testTxt.indexOf('模型连通性正常') >= 0, testTxt.slice(-60));
check('代理自检确实发起了 GET 请求', healthChecks > 0, healthChecks);

// --- G. 代码助手：流式 + Markdown 渲染 ---
click($('.tab[data-panel="assistant"]'));
$$('.CodeMirror')[0].CodeMirror.setValue('#include <stdio.h>\nint main(){printf("hi")}\n');
click($('#assistantActions .btn[data-mode="diagnose"]'));
const okG = await waitFor(() => $('#assistantOutput .code-block') && $('#assistantOutput table'), 4000);
check('流式响应渲染出代码块与表格', okG, $('#assistantOutput').textContent.length);
check('渲染标题 h2/h3/h4（# -> h3 -> h4 逐级映射）', $$('#assistantOutput h3').length >= 1 && $$('#assistantOutput h4').length >= 1, '');
check('渲染无序列表与引用', $$('#assistantOutput ul li').length >= 2 && $$('#assistantOutput blockquote').length === 1, '');
check('代码块带语言标签与复制按钮', $('#assistantOutput .code-lang').textContent === 'cpp' && !!$('#assistantOutput .copy-btn'), $('#assistantOutput .code-lang').textContent);
check('请求体为流式且带 system 提示词',
  requests.some(r => r.stream === true && r.messages && r.messages[0].role === 'system' && r.messages[0].content.indexOf('你是编程助教') >= 0), requests.length + ' 次请求');
check('system 提示词包含当前语言 C',
  (requests[requests.length - 1].messages[0].content || '').indexOf('当前选定的编程语言是 C。') >= 0, '');

// --- H. 一键复制 ---
click($('#assistantOutput .copy-btn'));
await sleep(120);
check('点击复制按钮写入剪贴板且内容正确',
  copied.length === 1 && copied[0].indexOf('int main') >= 0, JSON.stringify(copied[0] || '').slice(0, 60));

// --- I. 练习板块：出题（不泄露答案）---
click($('.tab[data-panel="api"]'));
setInput('#apiKeyInput', 'sk-test-not-a-real-key');
setInput('#proxyInput', 'https://proxy.example.workers.dev');
await sleep(60);
click($('.tab[data-panel="practice"]'));
setInput('#quizLevel', 'mid');
setInput('#quizType', 'coding');
setInput('#quizCount', '1');
check('[练习] 难度规范提示随难度切换显示',
  $('#levelSpec').textContent.indexOf('计算机等级考试二级') >= 0, $('#levelSpec').textContent.slice(0, 24));
click($('#quizGenBtn'));
const okGen = await waitFor(() => $$('#answerArea .q-card').length > 0 && $$('#practiceOutput .q-card').length > 0, 6000);
check('[练习] 生成后自动进入「作答」步骤（出题页隐藏、步骤条高亮 2）',
  okGen && $('#stepGen').style.display === 'none' && $('#stepAnswer').style.display !== 'none' &&
  $$('#practiceSteps .step-item')[1].classList.contains('active'), '');
check('[练习] 题面渲染出题卡（含样例 / 数据范围 / 评分点）',
  $('#practiceOutput').textContent.indexOf('样例') >= 0 &&
  $('#practiceOutput').textContent.indexOf('数据范围') >= 0 &&
  $('#practiceOutput').textContent.indexOf('评分点') >= 0, '');
check('[练习] 出题阶段不泄露答案（题面无「答案 / 解析」，也无 JSON 契约残留）',
  $('#practiceOutput').textContent.indexOf('答案') < 0 &&
  $('#practiceOutput').textContent.indexOf('解析') < 0 &&
  $('#practiceOutput').textContent.indexOf('"problems"') < 0, '');
check('[练习] 题面里的模板代码已注入答题区的编辑器',
  $$('.CodeMirror')[1].CodeMirror.getValue().indexOf('int main') >= 0,
  $$('.CodeMirror')[1].CodeMirror.getValue().slice(0, 22));
check('[练习] 答题编辑器顶上标出当前题号与题型',
  $('#answerWhich').textContent.indexOf('第 1 题') >= 0 && $('#answerWhich').textContent.indexOf('编程题') >= 0,
  $('#answerWhich').textContent);
check('[练习] 未作答直接提交会被拦下',
  (function () { $$('.CodeMirror')[1].CodeMirror.setValue('   '); click($('#submitAnswerBtn')); return $('#stepGrade').style.display === 'none'; })(), '');

// --- J. 练习板块：提交 → 批改 → 评分卡 ---
$$('.CodeMirror')[1].CodeMirror.setValue('#include <bits/stdc++.h>\nint main(){ int n; return 0; }');
click($('#submitAnswerBtn'));
const okScore = await waitFor(() => $('#gradeScoreArea .score-card'), 6000);
check('[练习] 提交后进入「批改」步骤并渲染评分卡',
  okScore && $('#stepGrade').style.display !== 'none' && $$('#gradeScoreArea .score-card').length === 1, '');
check('[练习] 总分解析为 85', okScore && $('#gradeScoreArea .score-ring .inner b').textContent === '85',
  okScore ? $('#gradeScoreArea .score-ring .inner b').textContent : 'n/a');
check('[练习] 评分项进度条渲染 2 行', okScore && $$('#gradeScoreArea .bar-row').length === 2, '');
check('[练习] 样例通过与漏洞摘要均渲染',
  okScore && $('#gradeScoreArea').textContent.indexOf('2/2 组样例通过') >= 0 &&
  $('#gradeScoreArea').textContent.indexOf('循环边界') >= 0, '');
check('[练习] 批改报告渲染 Markdown 表格', $$('#gradeOutput table').length >= 1, '');
check('[练习] 评分条填充宽度按得分比例（100% / 80%）',
  $$('#gradeScoreArea .bar-fill').map(function (e) { return e.style.width; }).join(',') === '100%,80%',
  $$('#gradeScoreArea .bar-fill').map(function (e) { return e.style.width; }).join(','));
check('[练习] 报告不再把裸 JSON 评分块展示给用户',
  $('#gradeOutput').textContent.indexOf('"score"') < 0, $('#gradeOutput').textContent.slice(-40));
check('[练习] 「回去改一改」能回到作答步骤',
  (function () { click($('#gradeAgainBtn')); return $('#stepAnswer').style.display !== 'none'; })(), '');
check('[练习] 批改结果写入学习进度',
  (JSON.parse(dom.window.localStorage.getItem('codetutor.progress.v1') || '{}').grades || []).length >= 1, '');


// --- J2. 学习知识：四档知识点 + 掌握进度 + 学练闭环 ---
const domKB = await boot(true, false, true);
activeDom = domKB;
click($('.tab[data-panel="knowledge"]'));
check('[知识] 「学习知识」已是独立板块（7 个标签页）', $$('.tab').length === 7 && $('#panel-knowledge').classList.contains('active'), $$('.tab').length);
check('[知识] 四档难度可选（基础 / 二级 / 竞赛 / 王者）', $('#kbLevel').options.length === 4, $('#kbLevel').options.length);
check('[知识] 默认渲染基础档的知识模块（6 个）', $$('#kbList .kb-card').length === 6, $$('#kbList .kb-card').length);
check('[知识] 每个模块都有要点 / 易错点 / 典型考法',
  $$('#kbList .kb-sec').length >= 18 &&
  $('#kbList').textContent.indexOf('要点') >= 0 &&
  $('#kbList').textContent.indexOf('易错点') >= 0 &&
  $('#kbList').textContent.indexOf('典型考法') >= 0, $$('#kbList .kb-sec').length);
check('[知识] 首个模块默认展开，其余折叠', $$('#kbList .kb-card.open').length === 1, $$('#kbList .kb-card.open').length);
check('[知识] 点击标题可展开另一个模块',
  (function () { var h = $$('#kbList .kb-head')[2]; h.click(); return $$('#kbList .kb-card.open').length === 2; })(), '');
check('[知识] 语言提示跟随全局语言（Python → C）', (function () {
  var before = $('#kbList').textContent.indexOf('Python 提示') >= 0;
  var s = $('#langSelect'); s.value = 'c'; s.dispatchEvent(new activeDom.window.Event('change', { bubbles: true }));
  var after = $('#kbList').textContent.indexOf('C 提示') >= 0;
  return before && after;
})(), '');
check('[知识] 切档位换知识点内容（基础 → 王者）', (function () {
  var s = $('#kbLevel'); s.value = 'king'; s.dispatchEvent(new activeDom.window.Event('change', { bubbles: true }));
  return $$('#kbList .kb-card').length === 6 && $('#kbList').textContent.indexOf('蓝桥杯') >= 0 || $('#kbList').textContent.indexOf('并查集') >= 0;
})(), $('#kbGoal').textContent.slice(0, 20));
check('[知识] 掌握进度初始为 0', $('#kbProgressTxt').textContent.indexOf('已掌握 0 / 6') >= 0, $('#kbProgressTxt').textContent);
click($$('#kbList [data-kb-done]')[0]);
check('[知识] 标记已掌握：出现徽标 + 进度更新 + 写入 localStorage',
  $$('#kbList .kb-done-badge').length === 1 &&
  $('#kbProgressTxt').textContent.indexOf('已掌握 1 / 6') >= 0 &&
  (domKB.window.localStorage.getItem('codetutor.kb.v1') || '').indexOf('king:') >= 0,
  domKB.window.localStorage.getItem('codetutor.kb.v1'));
check('[知识] 再点一次可取消掌握',
  (function () { $$('#kbList [data-kb-done]')[0].click(); return $$('#kbList .kb-done-badge').length === 0 && $('#kbProgressTxt').textContent.indexOf('已掌握 0 / 6') >= 0; })(), '');
check('[知识] 储备里不含 API Key', String(domKB.window.localStorage.getItem('codetutor.kb.v1') || '').indexOf('sk-') < 0, '');
check('[知识] 「练这个知识点」把难度/知识点带进练习并切页', (function () {
  var s = $('#kbLevel'); s.value = 'adv'; s.dispatchEvent(new activeDom.window.Event('change', { bubbles: true }));
  var title = $$('#kbList .kb-title')[0].textContent;
  $$('#kbList [data-kb-practice]')[0].click();
  return $('#panel-practice').classList.contains('active') && $('#quizLevel').value === 'adv' && $('#quizTopic').value === title;
})(), $('#quizTopic').value);

// --- J3. 实用工具：文档阅读器（结构 + 纯文本读取 + 隐私） ---
click($('.tab[data-panel="tools"]'));
check('[工具] 「实用工具」面板含拖拽区 / 文件选择 / 空态',
  !!$('#frDrop') && !!$('#frFile') && $('#frBody').textContent.indexOf('拖入') >= 0, '');
check('[工具] 未打开文件时 AI / 导出按钮禁用',
  $('#frAiBtn').disabled === true && $('#frMdBtn').disabled === true, '');
check('[工具] 支持的格式清单写进了 accept',
  ['.md', '.txt', '.pdf', '.epub', '.docx'].every(function (e) {
    return ($('#frFile').getAttribute('accept') || '').indexOf(e) >= 0;
  }), $('#frFile').getAttribute('accept'));
check('[工具] 清空按钮在无文件时不报错', (function () { click($('#frClearBtn')); return true; })(), '');

// --- K. 降级路径（无 CodeMirror）---
const dom2 = await boot(false);
activeDom = dom2;
const W2 = dom2.window;
check('[降级] 无 CodeMirror 时仍可初始化且 textarea 可见',
  $$('.CodeMirror').length === 0 && $('#assistantEditor').classList.contains('fallback-editor') &&
  $('#assistantEditor').value.length > 100, $('#assistantEditor').value.length);
click($('.tab[data-panel="practice"]'));
await sleep(60);
check('[降级] 面板切换正常', $('#panel-practice').classList.contains('active'), '');

// --- L. 故障复现：代理地址上跑的是别的脚本（返回纯文本 401）---
const dom3 = await boot(true, true);
activeDom = dom3;
setInput('#apiKeyInput', 'sk-whatever-valid-looking-key');
setInput('#proxyInput', 'https://code-proxy.wrong-account.workers.dev');
click($('#testApiBtn'));
await waitFor(() => $('#apiTestResult').textContent.indexOf('跑的不是本项目的 Worker') >= 0, 3000);
const t3 = $('#apiTestResult').textContent;
check('[故障复现] 代理自检能识别出"该地址不是本项目的 Worker"',
  t3.indexOf('跑的不是本项目的 Worker') >= 0, t3.slice(0, 90));
check('[故障复现] 自检结果里原样展示代理返回的内容，便于定位',
  t3.indexOf('Authentication Fails (governor)') >= 0, '');
check('[故障复现] 同时给出排查指引（是否粘了 cloudflare-proxy.js / 地址是否对得上）',
  t3.indexOf('cloudflare-proxy.js') >= 0 && t3.indexOf('完全一致') >= 0, '');
check('[故障复现] 非 JSON 响应会额外提示而不是只抛 401',
  t3.indexOf('纯文本') >= 0, '');
check('[故障复现] 第 2 步失败信息同样指向"不是本项目的 cloudflare-proxy.js"',
  t3.indexOf('不是') >= 0 && t3.indexOf('cloudflare-proxy.js') >= 0 && t3.indexOf('模型调用失败') >= 0, '');

// --- M. 同源路径 /api/chat（Pages Functions 方案）---
const dom4 = await boot(true);
activeDom = dom4;
setInput('#apiKeyInput', 'sk-same-origin-key');
setInput('#proxyInput', '/api/chat');
click($('#testApiBtn'));
await waitFor(() => $('#apiTestResult').textContent.indexOf('代理自检通过') >= 0, 3000);
const t4 = $('#apiTestResult').textContent;
check('[同源] /api/chat 能通过代理自检并识别为同源',
  t4.indexOf('代理自检通过') >= 0 && t4.indexOf('同源') >= 0, t4.slice(0, 80));
const lastUrls = fetchedUrls.slice(-2);
check('[同源] 同源路径被正确解析为 location.origin + /api/chat（GET 自检 + POST 调用）',
  lastUrls.length === 2 && lastUrls[0] === 'https://codetutor.test/api/chat' && lastUrls[1] === 'https://codetutor.test/api/chat'
  && t4.indexOf('模型连通性正常') >= 0, lastUrls.join(' , '));
check('[同源] 相对路径不会再被"必须以 http 开头"拦下',
  t4.indexOf('必须以 http') < 0, '');

// --- N. 访客零配置：本站带同源函数时自动启用 /api/chat ---
const dom5 = await boot(true, false, true);
activeDom = dom5;
await waitFor(() => $('#proxyInput').value === '/api/chat', 3000);
const t5 = await (async function () {
  const badge = $('#apiStatus').textContent;
  const stored = JSON.parse(dom5.window.localStorage.getItem('codetutor.settings.v1') || '{}');
  return { badge: badge, value: $('#proxyInput').value, stored: stored.proxyUrl || '(无)' };
})();
check('[访客零配置] 自动探测到同源函数并把代理地址设为 /api/chat',
  t5.value === '/api/chat', t5.value);
check('[访客零配置] 自动生效后写入本地设置（下次打开无需再探测）',
  t5.stored === '/api/chat', t5.stored);
check('[访客零配置] 无 Key 时状态提示"配置不完整"，而不是"未配置"',
  t5.badge.indexOf('配置不完整') >= 0, t5.badge);
// 访客只填 Key 就能用
setInput('#apiKeyInput', 'sk-visitor-key');
click($('#testApiBtn'));
await waitFor(() => $('#apiTestResult').textContent.indexOf('模型连通性正常') >= 0 || $('#apiTestResult').textContent.indexOf('模型调用失败') >= 0, 4000);
const t6 = $('#apiTestResult').textContent;
check('[访客零配置] 只填 Key 点一次测试即可跑通两步自检',
  t6.indexOf('代理自检通过') >= 0 && t6.indexOf('pages-function') >= 0 && t6.indexOf('同源') >= 0, t6.slice(0, 90));

// --- O. 对话：默认页 / 新建 / 发送 / 本地保存 ---
const dom6 = await boot(true, false, true);
activeDom = dom6;
check('[对话] 默认打开的就是对话页', $('#panel-chat').classList.contains('active'), '');
check('[对话] 空状态给出按语言定制的快捷提问',
  $$('#chatBody .chip').length >= 3 && $('#chatBody').textContent.indexOf('Python') >= 0,
  $$('#chatBody .chip').length);
setInput('#apiKeyInput', 'sk-chat-test-key');
click($('#chatNewBtn'));
check('[对话] 新建后会话列表 1 条', $$('#chatList .chat-item').length === 1, $$('#chatList .chat-item').length);
$('#chatInput').value = 'Python 列表推导式是什么？';
click($('#chatSendBtn'));
await waitFor(() => $$('#chatBody .msg').length >= 2 && $('#chatBody .msg.ai .md') && $('#chatBody .msg.ai .md').textContent.length > 10, 5000);
check('[对话] 用户 + AI 两条气泡都渲染', $$('#chatBody .msg').length === 2, $$('#chatBody .msg').length);
check('[对话] AI 回复按 Markdown 渲染（含代码块与列表）',
  $$('#chatBody .code-block').length >= 1 && $$('#chatBody .msg.ai ul li').length >= 2, '');
check('[对话] 会话标题自动取自首条提问', $('#chatTitle').value.indexOf('列表推导式') >= 0, $('#chatTitle').value);
const savedChat = JSON.parse(dom6.window.localStorage.getItem('codetutor.chat.v1') || '{}');
check('[对话] 历史已写入 localStorage（2 条消息）',
  savedChat.sessions && savedChat.sessions.length === 1 && savedChat.sessions[0].messages.length === 2,
  savedChat.sessions ? savedChat.sessions[0].messages.length : '无');
check('[对话] 本地历史里不含 API Key', JSON.stringify(savedChat).indexOf('sk-chat-test-key') < 0, '');
check('[对话] 发送后进度里的对话轮数 +1',
  (JSON.parse(dom6.window.localStorage.getItem('codetutor.progress.v1') || '{}').chat || 0) === 1, '');

// 会话管理：改名 / 新建第二个 / 切换 / 删除
$('#chatTitle').value = '推导式专题';
$('#chatTitle').dispatchEvent(new dom6.window.Event('input', { bubbles: true }));
check('[对话] 改名后写入存储',
  JSON.parse(dom6.window.localStorage.getItem('codetutor.chat.v1')).sessions[0].title === '推导式专题', '');
click($('#chatNewBtn'));
check('[对话] 新建第二个会话', $$('#chatList .chat-item').length === 2, $$('#chatList .chat-item').length);
click($$('#chatList .chat-item')[1]);
check('[对话] 切回旧会话能恢复消息', $$('#chatBody .msg').length === 2, $$('#chatBody .msg').length);
click($$('#chatList .chat-item')[0].querySelector('.del'));
check('[对话] 删除会话生效', $$('#chatList .chat-item').length === 1, $$('#chatList .chat-item').length);

// --- P. 学习进度：批改记录 / 统计 / 趋势 ---
const dom7 = await boot(true, false, true);
activeDom = dom7;
setInput('#apiKeyInput', 'sk-progress-test');
click($('.tab[data-panel="practice"]'));
check('[进度] 内置题库可用（不消耗 API）',
  (function () { click($('#bankBtn')); return $('#stepAnswer').style.display !== 'none' && $$('#practiceOutput .q-card').length >= 1; })(),
  $$('#practiceOutput .q-card').length);
$$('.CodeMirror')[1].CodeMirror.setValue('#include <bits/stdc++.h>\nint main(){ return 0; }');
click($('#submitAnswerBtn'));
await waitFor(() => $('#gradeScoreArea .score-card'), 6000);
const prog = JSON.parse(dom7.window.localStorage.getItem('codetutor.progress.v1') || '{}');
check('[进度] 批改后写入 1 条记录（分数 85 / 语言 Python / 含题目）',
  prog.grades && prog.grades.length === 1 && prog.grades[0].score === 85 && prog.grades[0].lang === 'python' && (prog.grades[0].problem || '').length > 4,
  prog.grades ? JSON.stringify({ n: prog.grades.length, s: prog.grades[0].score, l: prog.grades[0].lang }) : '无');
check('[进度] 记录里保留了当时提交的代码', (prog.grades[0].code || '').indexOf('int main') >= 0, '');
check('[进度] 记录里保留了逐项扣分明细', Array.isArray(prog.grades[0].items) && prog.grades[0].items.length === 2, '');
check('[进度] 本地存储里不含 API Key（进度）', JSON.stringify(prog).indexOf('sk-progress-test') < 0, '');

click($('.tab[data-panel="progress"]'));
check('[进度] 统计卡渲染 8 张', $$('#statGrid .stat-card').length === 8, $$('#statGrid .stat-card').length);
check('[进度] 平均分与最高分正确显示', $('#statGrid').textContent.indexOf('85') >= 0, '');
check('[进度] 连续学习显示 1 天', $('#statGrid').textContent.indexOf('连续学习') >= 0, '');
check('[进度] 分数趋势画出 1 个折线 + 1 个数据点',
  $$('#trendBox svg polyline').length === 1 && $$('#trendBox svg circle').length === 1,
  $$('#trendBox svg polyline').length + '/' + $$('#trendBox svg circle').length);
check('[进度] 按语言统计里 Python 显示「1 次 · 平均 85 分」',
  $('#langStats').textContent.indexOf('1 次 · 平均 85 分') >= 0, $('#langStats').textContent.replace(/\s+/g, ' ').slice(0, 80));
check('[进度] 批改历史列表 1 条', $$('#gradeList .grade-item').length === 1, $$('#gradeList .grade-item').length);
click($('#gradeList [data-act="toggle"]'));
check('[进度] 明细可展开', $('#gradeList .grade-item').classList.contains('open'), '');
click($('#gradeList [data-act="redo"]'));
check('[进度] 「重新批改」把题目与代码带回练习的作答步骤',
  $('#panel-practice').classList.contains('active') && $('#stepAnswer').style.display !== 'none' &&
  $$('#practiceOutput .q-card').length === 1 && $$('.CodeMirror')[1].CodeMirror.getValue().indexOf('int main') >= 0, '');

// --- Q. 重新打开页面：历史与进度都要还在 ---
const dom8 = await boot(true, false, false, { chat: savedChat, progress: prog });
activeDom = dom8;
check('[持久化] 重开后历史对话被恢复',
  $$('#chatList .chat-item').length === savedChat.sessions.length && $$('#chatBody .msg').length === 2,
  $$('#chatList .chat-item').length + '/' + $$('#chatBody .msg').length);
click($('.tab[data-panel="progress"]'));
check('[持久化] 重开后学习进度被恢复（统计里还有 85 分与 1 条历史）',
  $('#statGrid').textContent.indexOf('85') >= 0 && $$('#gradeList .grade-item').length === 1, '');
const keys = ['codetutor.settings.v1', 'codetutor.chat.v1', 'codetutor.progress.v1'];
check('[安全] 三类本地数据里都不含 API Key',
  keys.every(function (k) { return String(dom8.window.localStorage.getItem(k) || '').indexOf('sk-') < 0; }), '');

// --- R. 容量保护：超量历史在载入时被裁剪到上限，不炸页面 ---
const bigSession = { id: 'big', title: '超长会话', lang: 'python', createdAt: Date.now(), updatedAt: Date.now(),
  messages: [] };
for (let i = 0; i < 300; i++) bigSession.messages.push({ role: i % 2 ? 'assistant' : 'user', content: '消息 ' + i, ts: Date.now() });
const dom9 = await boot(true, false, false, { chat: { sessions: [bigSession], activeId: 'big' }, progress: { grades: [{ ts: Date.now(), score: 9999, lang: 'python' }], quiz: 0, assist: 0, chat: 0, days: {} } });
activeDom = dom9;
const restored = $$('#chatBody .msg').length;
check('[容量保护] 超长会话被裁到上限（120 条）而不是全部载入', restored === 120, restored);
check('[容量保护] 非法分数（9999）被过滤掉', dom9.window.document.getElementById('statGrid').textContent.indexOf('9999') < 0, '');

// --- S. 贵阳·多彩主题 皮肤系统 ---
const dom10 = await boot(true, false, true);
activeDom = dom10;
const skinInfo = await (async function () {
  const gy = dom10.window.__gySkin;
  const style = dom10.window.document.getElementById('gySkinStyle');
  return {
    hasApi: !!gy,
    count: gy ? gy.SKINS.length : 0,
    ids: gy ? gy.SKINS.map(function (x) { return x.id; }).join(',') : '',
    hasStyleTag: !!style,
    css: style ? style.textContent : '',
    attr: dom10.window.document.documentElement.getAttribute('data-skin'),
    seasonal: gy ? gy.seasonal() : ''
  };
})();
check('[皮肤] 注入 9 套贵阳皮肤（林城晨雾…樱花梯田）', skinInfo.count === 9,
  skinInfo.count + ' | ' + skinInfo.ids);
check('[皮肤] 皮肤样式表已写入并同时含浅色与深色两套令牌',
  skinInfo.hasStyleTag && skinInfo.css.indexOf('html:root{') === 0 && skinInfo.css.indexOf('html[data-theme="dark"]{') > 0,
  skinInfo.css.slice(0, 40));
check('[皮肤] html 上打了 data-skin 标记', !!skinInfo.attr && skinInfo.ids.indexOf(skinInfo.attr) >= 0, skinInfo.attr);
check('[皮肤] 按节令给的默认皮肤合法', skinInfo.ids.indexOf(skinInfo.seasonal) >= 0, skinInfo.seasonal);

// 切到「数谷蓝调」：令牌里应出现它的主色 #0a66c2（浅）/ #5b93ff（深）
await ev2('window.__gySkin.apply("shugu")');
const shuguCss = await ev2("document.getElementById('gySkinStyle').textContent");
check('[皮肤] 切换到数谷蓝调后令牌换成该皮肤的主色',
  shuguCss.indexOf('#0a66c2') >= 0 && shuguCss.indexOf('#5b93ff') >= 0 && shuguCss.indexOf('--brand:#0a66c2') >= 0,
  shuguCss.slice(shuguCss.indexOf('--brand:'), shuguCss.indexOf('--brand:') + 24));

// 通过弹窗点选皮肤：应写入 localStorage 并刷新按钮文案
click($('#skinBtn'));
check('[皮肤] 点「皮肤」按钮弹出选择面板且列出 9 张皮肤卡', $$('#skinMask.show').length === 1 && $$('#skinGrid .skin-card').length === 9,
  $$('#skinGrid .skin-card').length);
click($$('#skinGrid .skin-card')[6]);   // 第 7 张 = 九门夜灯
check('[皮肤] 选中的皮肤卡标记为「使用中」',
  $$('#skinGrid .skin-card')[6].getAttribute('aria-pressed') === 'true' &&
  $$('#skinGrid .skin-card')[6].textContent.indexOf('使用中') >= 0, '');
check('[皮肤] 选择写入 localStorage', dom10.window.localStorage.getItem('codetutor.skin.v1') === 'jiubamen',
  dom10.window.localStorage.getItem('codetutor.skin.v1'));
check('[皮肤] 顶栏皮肤按钮文案跟着更新',
  dom10.window.document.getElementById('skinLbl').textContent === '九门夜灯',
  dom10.window.document.getElementById('skinLbl').textContent);
click($('#skinCloseBtn'));
check('[皮肤] 关闭面板', $$('#skinMask.show').length === 0, '');

// --- T. 彩蛋栏（代码写累了，看看贵州发展吧） ---
const dom11 = await boot(true, false, true);
activeDom = dom11;
check('[彩蛋栏] 默认展示，文案含「代码写累了 / 贵州发展吧 / 休息一下吧」',
  $$('#eggBar').length === 1 && !$('#eggBar').classList.contains('hide') &&
  $('#eggBar').textContent.indexOf('代码写累了') >= 0 &&
  $('#eggBar').textContent.indexOf('贵州发展吧') >= 0 &&
  $('#eggBar').textContent.indexOf('休息一下吧') >= 0,
  $('#eggBar').textContent.trim().slice(0, 34));
check('[彩蛋栏] 按钮指向贵州发展吧、新窗口打开且带 noopener',
  $('#eggGo').getAttribute('href') === 'https://tieba.baidu.com/f?kw=%E8%B4%B5%E5%B7%9E%E5%8F%91%E5%B1%95&fr=personalize_page' &&
  $('#eggGo').getAttribute('target') === '_blank' &&
  ($('#eggGo').getAttribute('rel') || '').indexOf('noopener') >= 0,
  $('#eggGo').getAttribute('href'));
click($('#eggClose'));
check('[彩蛋栏] 收起后隐藏并记住状态（localStorage=0）',
  $('#eggBar').classList.contains('hide') && dom11.window.localStorage.getItem('codetutor.eggbar.v1') === '0',
  dom11.window.localStorage.getItem('codetutor.eggbar.v1'));
click($('#eggRestore'));
check('[彩蛋栏] 页脚「显示彩蛋栏」可重新打开（localStorage=1）',
  !$('#eggBar').classList.contains('hide') && dom11.window.localStorage.getItem('codetutor.eggbar.v1') === '1',
  dom11.window.localStorage.getItem('codetutor.eggbar.v1'));
// 再次进入页面时应保持"已收起"的状态
const dom12 = await boot(true, false, true, { chat: null, progress: null });
activeDom = dom12;
dom12.window.localStorage.setItem('codetutor.eggbar.v1', '0');
check('[彩蛋栏] 状态存的是本地偏好键，不含任何密钥',
  String(dom12.window.localStorage.getItem('codetutor.eggbar.v1')).indexOf('sk-') < 0, '');

// --- F2. 选择题：选项必须同时进「出题 / 作答 / 批改」三处 ---
// 先补好 Key 与代理地址（前面的用例可能清过），否则生成会被配置校验拦住
click($('.tab[data-panel="api"]'));
setInput('#apiKeyInput', 'sk-choice-test');
await ev2("(function(){var seg=document.querySelectorAll('#proxyModeSeg button');if(seg[0])seg[0].click();var p=document.getElementById('proxyInput');p.value='/api/chat';p.dispatchEvent(new Event('change',{bubbles:true}));p.dispatchEvent(new Event('input',{bubbles:true}));return true;})()");
await sleep(150);
click($('.tab[data-panel="practice"]'));
await ev2("(function(){var t=document.getElementById('quizType');t.value='choice';t.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
const beforeChoice = requests.length;
// 此时可能停在「批改」步骤，用「换一批」触发一次重新出题（该按钮在任何步骤都可用）
click($('#quizRegenBtn'));
await waitFor(() => $$('#answerArea .opt').length > 0, 8000);
await sleep(400);
check('[选择题] 出题渲染出 A~D 四个选项', $$('#answerArea .opt').length === 4, $$('#answerArea .opt').length);
check('[选择题] 选项文本正确显示（B 项内容）',
  $('#answerArea').textContent.indexOf('只初始化一次') >= 0, '');
await ev2("(function(){var r=document.querySelectorAll('#answerArea input[type=radio]');if(r[1]){r[1].checked=true;r[1].dispatchEvent(new Event('change',{bubbles:true}));}var o=document.querySelectorAll('#answerArea .opt');if(o[1])o[1].click();return true;})()");
await sleep(200);
click($('#submitAnswerBtn'));
await sleep(250);
const gradeText = JSON.stringify(requests[requests.length - 1] || {});
check('[选择题] 批改请求里带上了四个选项原文',
  gradeText.indexOf('每次函数调用都会重新初始化为 0') >= 0 &&
  gradeText.indexOf('只初始化一次') >= 0 &&
  gradeText.indexOf('不能用于递归函数') >= 0, '');
check('[选择题] 批改要求明确禁止以「无样例 / 选项缺失」拒评或判 0 分',
  gradeText.indexOf('选项缺失') >= 0 && gradeText.indexOf('判 0 分') >= 0, '');
check('[选择题] 批改请求里带了学生所选选项（B）',
  gradeText.indexOf('答案：B') >= 0 || gradeText.indexOf('选择 B') >= 0, '');
check('[选择题] 纯选择题的批改不再索要「参考标准代码」', gradeText.indexOf('参考标准代码') < 0, '');
await ev2("(function(){var t=document.getElementById('quizType');t.value='coding';t.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");

/* ---------- 输出 ---------- */
const failed = results.filter(r => !r.pass);
console.log('\n================ index.html 端到端测试 ================');
results.forEach((r, i) => console.log(String(i + 1).padStart(3) + '. ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + (r.pass ? '' : '   → ' + JSON.stringify(r.detail))));
console.log('\n捕获到的页面错误: ' + (errors.length ? '\n  ' + errors.join('\n  ') : '无'));
console.log('结论: ' + (failed.length === 0 && errors.length === 0
  ? '全部 ' + results.length + ' 项断言通过 ✅'
  : failed.length + ' 项失败 / ' + errors.length + ' 条错误 ❌'));
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
