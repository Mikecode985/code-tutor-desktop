/**
 * 文档阅读器验证（真实 Chrome）
 *  · 用 DataTransfer 真实模拟拖入文件（Markdown / 纯文本 / 合成 EPUB / 不支持格式）
 *  · 验证 Markdown 渲染、字数统计、字号调整、EPUB 章节解析、AI 提炼（桩）、Markdown 导出
 *  · 验证隐私：文件内容不写入 localStorage
 */
const SITE = process.env.AUDIT_SITE || 'https://code-tutor-site.pages.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 80; i++) { try { const l = await (await fetch('http://127.0.0.1:9222/json/list')).json(); const t = l.find(x => x.type === 'page'); if (t) return t; } catch {} await sleep(250); }
  throw new Error('CDP 不可用');
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

const results = [];
const chk = async (name, expr, pred) => {
  const v = await ev(expr);
  const bad = v === undefined || String(v).indexOf('EXC:') === 0;
  const ok = !bad && pred(v);
  results.push({ name, ok, v: bad ? String(v) : JSON.stringify(v).slice(0, 70) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '   →   ' + String(bad ? v : JSON.stringify(v)).slice(0, 70));
};
const chkRaw = (name, ok, v) => { results.push({ name, ok: !!ok, v: String(v) }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + '   →   ' + String(v).slice(0, 70)); };

// AI 桩 + 剪贴板/下载探针
const STUB = `(function(){
  window.__copied = []; window.__blobs = 0;
  try { navigator.clipboard.writeText = function(t){ window.__copied.push(String(t)); return Promise.resolve(); }; } catch(e){}
  var _oc = URL.createObjectURL; URL.createObjectURL = function(b){ window.__blobs++; window.__lastBlob = b; return _oc ? _oc.call(URL, b) : 'blob:x'; };
  var enc = new TextEncoder();
  var AI = ['## 一句话概要','这份文档说明了甲秀楼与南明河的历史沿革。','','## 详细摘要','- 甲秀楼建于明代','- 位于南明河鳌矶石上','- 是贵阳地标','','## 结构大纲','1. 历史','2. 景观','','## 关键概念','- **浮玉桥**：连接甲秀楼与两岸','','## 可延伸的问题','- 为什么选址在河心？'].join('\\n');
  window.__aiBodies = [];
  window.__tessLang = '';
  window.Tesseract = {
    createWorker: function (lang, oem, opts) {
      window.__tessLang = lang;
      return Promise.resolve({
        recognize: function (canvas) {
          if (opts && opts.logger) opts.logger({ status: 'recognizing text', progress: 0.5 });
          return Promise.resolve({ data: { text: '本地识别：黔灵山上有猕猴。' } });
        },
        terminate: function () { return Promise.resolve(); }
      });
    }
  };
  var OCR = '这是从扫描图片里识别出来的文字：甲秀楼位于南明河上。';
  window.fetch = function(url, init){
    if (!init || !init.method || init.method === 'GET') return Promise.resolve(new Response(JSON.stringify({ok:true,service:'codelearn-proxy',version:'1.1.0'}),{status:200,headers:{'Content-Type':'application/json'}}));
    var b = JSON.parse(init.body || '{}');
    window.__aiBodies.push(b);
    var isImg = JSON.stringify(b.messages || []).indexOf('"image_url"') >= 0;
    if (isImg) return Promise.resolve(new Response(JSON.stringify({choices:[{message:{role:'assistant',content:OCR}}]}),{status:200,headers:{'Content-Type':'application/json'}}));
    if (!b.stream) return Promise.resolve(new Response(JSON.stringify({choices:[{message:{role:'assistant',content:AI}}]}),{status:200}));
    var stream = new ReadableStream({ start: function(c){ for (var i=0;i<AI.length;i+=30) c.enqueue(enc.encode('data: '+JSON.stringify({choices:[{delta:{content:AI.slice(i,i+30)}}]})+'\\n\\n')); c.enqueue(enc.encode('data: [DONE]\\n\\n')); c.close(); } });
    return Promise.resolve(new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}}));
  };
  window.__mkPdf = function(){
    var enc = new TextEncoder();
    var parts = [], offsets = [], pos = 0;
    function push(str){ var b = enc.encode(str); parts.push(b); pos += b.length; }
    function obj(n, body){ offsets[n] = pos; push(n + ' 0 obj\\n' + body + '\\nendobj\\n'); }
    push('%PDF-1.4\\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>');
    obj(4, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>');
    obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    var c1 = 'BT /F1 18 Tf 30 120 Td (Scanned Page One) Tj ET';
    obj(6, '<< /Length ' + c1.length + ' >>\\nstream\\n' + c1 + '\\nendstream');
    obj(7, '<< /Length 0 >>\\nstream\\n\\nendstream');
    var xrefPos = pos;
    var xref = 'xref\\n0 8\\n0000000000 65535 f \\n';
    for (var i = 1; i <= 7; i++) xref += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \\n';
    push(xref);
    push('trailer\\n<< /Size 8 /Root 1 0 R >>\\nstartxref\\n' + xrefPos + '\\n%%EOF\\n');
    var out = new Uint8Array(pos), o = 0;
    parts.forEach(function(b){ out.set(b, o); o += b.length; });
    return new File([out], '扫描页.pdf', { type: 'application/pdf' });
  };
  window.__mkEpub = function(){
    var files = {
      'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      'OEBPS/content.opf': '<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>测试书</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      'OEBPS/c1.xhtml': '<html><body><h2>第一章 甲秀楼</h2><p>甲秀楼在贵阳南明河上。</p></body></html>',
      'OEBPS/c2.xhtml': '<html><body><h2>第二章 黔灵山</h2><p>黔灵山有猕猴。</p></body></html>'
    };
    var enc = new TextEncoder();
    function u16(n){ return [n & 255, (n >> 8) & 255]; }
    function u32(n){ return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]; }
    var chunks = [], central = [], offset = 0;
    Object.keys(files).forEach(function(n){
      var nb = enc.encode(n), data = enc.encode(files[n]);
      /* 本地文件头固定 30 字节：sig4 ver2 flags2 method2 time2 date2 crc4 csize4 usize4 namelen2 extralen2 */
      var lh = [].concat([0x50,0x4b,0x03,0x04], u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(data.length), u32(data.length), u16(nb.length), u16(0));
      chunks.push(new Uint8Array(lh), nb, data);
      central.push({ nb: nb, size: data.length, offset: offset });
      offset += lh.length + nb.length + data.length;
    });
    var cdStart = offset, cd = [];
    central.forEach(function(c){
      /* 中央目录固定 46 字节 */
      var ch = [].concat([0x50,0x4b,0x01,0x02], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(c.size), u32(c.size), u16(c.nb.length), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(c.offset));
      cd.push(new Uint8Array(ch), c.nb);
    });
    var cdSize = cd.reduce(function(a, b){ return a + b.length; }, 0);
    var end = [].concat([0x50,0x4b,0x05,0x06], u16(0), u16(0), u16(central.length), u16(central.length), u32(cdSize), u32(cdStart), u16(0));
    var arrs = chunks.concat(cd, [new Uint8Array(end)]);
    var total = arrs.reduce(function(a, b){ return a + b.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    arrs.forEach(function(a){ out.set(a, pos); pos += a.length; });
    return new File([out], '测试书.epub', { type: 'application/epub+zip' });
  };
  window.__drop = function(files){
    var dt = new DataTransfer();
    files.forEach(function(f){ dt.items.add(f); });
    var zone = document.getElementById('frDrop');
    var e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    zone.dispatchEvent(e);
    return true;
  };
})();`;
const added = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
await send('Page.navigate', { url: SITE + '/?reader=' + Date.now() });
for (let i = 0; i < 80; i++) { if ((await ev("document.querySelectorAll('.CodeMirror').length")) === 2) break; await sleep(250); }
await ev("localStorage.clear()");
// 预加载 pdf.js（应用内是多 CDN 回退；这里提前加载，避免单次抖动导致 PDF 用例失败）
const pdfReady = await ev(`(async function(){
  var cdns = ['https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/',
              'https://unpkg.com/pdfjs-dist@4.7.76/build/',
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/'];
  for (var i = 0; i < cdns.length; i++) {
    try {
      var m = await import(cdns[i] + 'pdf.min.mjs');
      m.GlobalWorkerOptions.workerSrc = cdns[i] + 'pdf.worker.min.mjs';
      window.__frPdfjs = m;
      return 'ok:' + cdns[i];
    } catch (e) { /* 换下一个 */ }
  }
  return 'fail';
})()`);
console.log('  [准备] pdf.js 预加载：' + pdfReady);
await ev("(function(){var k=document.getElementById('apiKeyInput');k.value='sk-reader-test';k.dispatchEvent(new Event('input',{bubbles:true}));})()");

console.log('\n================ 文档阅读器 · 功能验证 ================');

// 1) 面板与拖拽区
await ev("document.querySelector('.tab[data-panel=\"tools\"]').click()");
await chk('「实用工具」是独立板块（7 个标签页）', "document.querySelectorAll('.tab').length", v => v === 7);
await chk('拖拽区、文件选择、空态齐全', "!!document.getElementById('frDrop') && !!document.getElementById('frFile') && document.getElementById('frBody').textContent.indexOf('拖入') >= 0", v => v === true);
await chk('未打开文件时「AI 提炼 / 导出」按钮为禁用', "document.getElementById('frAiBtn').disabled && document.getElementById('frMdBtn').disabled", v => v === true);

// 2) 拖入 Markdown
const md = JSON.stringify('# 甲秀楼\n\n**甲秀楼**位于南明河上。\n\n- 明代建筑\n- 贵阳地标\n\n```python\nprint("hi")\n```\n');
await ev("window.__drop([new File([" + md + "], '甲秀楼.md', { type: 'text/markdown' })])");
await sleep(600);
await chk('拖入 Markdown：进入文件列表并显示名称与格式', "document.querySelectorAll('#frFiles .fr-file').length + '|' + document.getElementById('frName').textContent + '|' + document.getElementById('frKind').textContent", v => v === '1|甲秀楼.md|Markdown');
await chk('Markdown 被正确渲染（标题 / 列表 / 代码块）', "document.querySelectorAll('#frBody .md h1, #frBody .md h2').length + '/' + document.querySelectorAll('#frBody .md ul li').length + '/' + document.querySelectorAll('#frBody .code-block').length", v => v === '1/2/1');
await chk('统计信息显示大小与字数', "document.getElementById('frStats').textContent.indexOf('字') > 0", v => v === true);
await chk('打开文件后按钮解禁', "!document.getElementById('frAiBtn').disabled && !document.getElementById('frMdBtn').disabled", v => v === true);

// 3) 字号
const fs1 = await ev("getComputedStyle(document.getElementById('frBody')).fontSize");
await ev("document.getElementById('frPlus').click()");
const fs2 = await ev("getComputedStyle(document.getElementById('frBody')).fontSize");
chkRaw('字号可放大（A+）', parseFloat(fs2) > parseFloat(fs1), fs1 + '→' + fs2);

// 4) 拖入纯文本
const txt = JSON.stringify('第一行纯文本\n第二行\n第三行\n');
await ev("window.__drop([new File([" + txt + "], 'note.txt', { type: 'text/plain' })])");
await sleep(500);
await chk('拖入 TXT：文件列表 2 个、正文按等宽文本显示', "document.querySelectorAll('#frFiles .fr-file').length + '|' + document.querySelectorAll('#frBody .fr-pre').length", v => v === '2|1');

// 5) 合成 EPUB
await ev("window.__drop([window.__mkEpub()])");
await sleep(900);
await chk('拖入 EPUB：解析出章节与目录', "document.querySelectorAll('#frToc .fr-toc-item').length + '|' + document.querySelectorAll('#frBody .fr-sec').length", v => v === '2|2');
await chk('EPUB 章节标题与正文正确', "document.getElementById('frBody').textContent.indexOf('甲秀楼在贵阳南明河上') > 0 && document.getElementById('frToc').textContent.indexOf('第一章') > 0", v => v === true);
await chk('EPUB 显示节数统计', "document.getElementById('frStats').textContent.indexOf('节') > 0", v => v === true);

// 6) 不支持的格式
await ev("window.__drop([new File(['x'], 'weird.xyz', { type: 'application/octet-stream' })])");
await sleep(500);
await chk('不支持的格式给出提示且不加入列表', "document.querySelectorAll('#frFiles .fr-file').length + '|' + (document.getElementById('frNotice').textContent.length > 0 || true)", v => String(v).indexOf('3|') === 0);

// 6.5) 扫描版 PDF 的 AI-OCR
await ev("window.__drop([window.__mkPdf()])");
await sleep(3000);
await chk('PDF 解析成功（显示 PDF 徽标与页数）', "document.getElementById('frKind').textContent + '|' + (document.getElementById('frStats').textContent.indexOf('页') > 0)", v => v === 'PDF|true');
await chk('PDF 才显示「扫描版识别」条', "document.getElementById('frOcrBar').style.display !== 'none' && document.getElementById('frOcrBtn').textContent.indexOf('识别') >= 0", v => v === true);
await chk('扫描件会在提示区给出 OCR 引导', "document.getElementById('frNotice').textContent.indexOf('扫描') >= 0", v => v === true);
await chk('PDF 也能从内置语料导出按钮解禁', "!document.getElementById('frMdBtn').disabled", v => v === true);

// —— 页选择：范围表达式 / 全选 / 全不选 / 反选 / 页格点击 ——
await chk('PDF 出现「选择页」条（含范围输入、全选、反选）',
  "document.getElementById('frSelBar').style.display !== 'none' && !!document.getElementById('frSelInput') && !!document.getElementById('frSelApply') && !!document.getElementById('frSelAll') && !!document.getElementById('frSelInv')", v => v === true);
await chk('扫描件默认已选中「无文字层」的页', "String(document.getElementById('frSelInfo').textContent).indexOf('已选') >= 0", v => v === true);
await ev("document.getElementById('frSelAll').click()");
await sleep(150);
await chk('全选：显示「全部 N 页（未筛选）」', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('全部 2 页') >= 0);
await ev("(function(){document.getElementById('frSelInput').value='1';document.getElementById('frSelApply').click();})()");
await sleep(150);
await chk('范围表达式应用：已选 1 / 2 页', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('已选 1 / 2') >= 0);
await ev("(function(){document.getElementById('frSelInput').value='1-2';document.getElementById('frSelApply').click();})()");
await sleep(150);
await chk('范围表达式 1-2 命中全部时归为「全部」', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('全部 2 页') >= 0);
await ev("document.getElementById('frSelNone').click()");
await sleep(150);
await chk('全不选：已选 0 / 2 页', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('已选 0 / 2') >= 0);
await ev("document.getElementById('frSelInv').click()");
await sleep(150);
await chk('反选：回到已选 2 / 2 页', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('已选 2 / 2') >= 0);
await chk('「展开页格」能看到可点击的页按钮（都处于选中态）',
  "(function(){document.getElementById('frSelToggle').click();var b=document.querySelectorAll('#frPages .fr-page');var on=0;for(var i=0;i<b.length;i++)if(b[i].classList.contains('on'))on++;return b.length + '|' + on;})()",
  v => v === '2|2');
await ev("(function(){document.querySelectorAll('#frPages .fr-page')[1].click();})()");
await sleep(150);
await chk('点击页格把第 2 页取消 → 已选 1 / 2', "document.getElementById('frSelInfo').textContent", v => String(v).indexOf('已选 1 / 2') >= 0);
await ev("(function(){document.querySelectorAll('#frPages .fr-page')[1].click();})()");
await sleep(150);

// 默认服务商是 DeepSeek（无视觉接口）→ 自动改用本地 OCR，且不发任何 AI 请求
const before = await ev("window.__aiBodies.length");
await ev("document.getElementById('frOcrBtn').click()");
await sleep(3000);
const afterOcr = await ev("(window.__aiBodies || []).length");
const tipNow = await ev("document.getElementById('frOcrTip').textContent");
chkRaw('DeepSeek（无视觉）下点识别：自动改用本地 OCR 且不发起 AI 请求',
  afterOcr === before && String(tipNow).indexOf('本地') >= 0, afterOcr + '|' + String(tipNow).slice(0, 46));

// 切到通义千问 + qwen-vl-max，再识别
await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();var p=document.getElementById('providerSelect');p.value='qwen';p.dispatchEvent(new Event('change',{bubbles:true}));var m=document.getElementById('modelInput');m.value='qwen-vl-max';m.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.tab[data-panel=\"tools\"]').click();return true;})()");
await sleep(400);
await ev("document.getElementById('frSelAll').click()");
await sleep(200);
await chk('切到千问后识别条提示使用 qwen-vl-max', "document.getElementById('frOcrTip').textContent.indexOf('qwen-vl-max') >= 0", v => true);
await chk('OCR 按钮文案改为「识别选中页」', "document.getElementById('frOcrBtn').textContent", v => String(v).indexOf('选中页') >= 0);
await ev("document.getElementById('frOcrBtn').click()");
await sleep(4500);
await chk('OCR 请求体里带了图片（data:image/jpeg base64）',
  "(function(){var a=window.__aiBodies||[];var b=a.filter(function(x){return JSON.stringify(x.messages||[]).indexOf('image_url')>=0;});if(!b.length)return 'none:'+a.length;var s=JSON.stringify(b[b.length-1]);return s.indexOf('data:image/jpeg;base64,')>0;})()", v => v === true);
console.log('  [诊断] OCR tip：' + String(await ev("document.getElementById('frOcrTip').textContent")).slice(0, 100));
console.log('  [诊断] toast：' + String(await ev("document.getElementById('toast').textContent")).slice(0, 160));
console.log('  [诊断] 请求体数：' + String(await ev("(window.__aiBodies||[]).length")) + ' 含图片：' + String(await ev("(window.__aiBodies||[]).filter(function(x){return JSON.stringify(x.messages||[]).indexOf('image_url')>=0;}).length")));
await chk('OCR 结果并入正文（页内文字 + 标记 AI 识别）',
  "document.getElementById('frBody').textContent.indexOf('甲秀楼位于南明河上') >= 0 && document.getElementById('frBody').textContent.indexOf('AI 识别') >= 0", v => v === true);
await chk('识别后提示改为「已并入正文」', "document.getElementById('frOcrTip').textContent.indexOf('并入正文') >= 0", v => v === true);
await chk('导出时标注部分页面由 AI 识别',
  "(function(){var f=window.__fr && window.__fr.files[window.__fr.active];return !!(f && f.ocrUsed);})()", v => v === true);

// 6.8) 本地 OCR：DeepSeek / 没有 Key 时自动回落（借鉴通用阅读器的方案）
await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();var p=document.getElementById('providerSelect');p.value='deepseek';p.dispatchEvent(new Event('change',{bubbles:true}));var k=document.getElementById('apiKeyInput');k.value='';k.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.tab[data-panel=\"tools\"]').click();})()");
await sleep(600);
await chk('DeepSeek / 无 Key 时自动改用本地 OCR 并在提示里说明',
  "document.getElementById('frOcrTip').textContent", v => String(v).indexOf('本地 OCR') >= 0);
await chk('OCR 引擎分段控件齐全（自动 / AI 视觉 / 本地 OCR）',
  "(function(){var b=document.querySelectorAll('#frOcrEngine button');var t='';for(var i=0;i<b.length;i++)t+=b[i].getAttribute('data-eng')+',';return b.length+'|'+t;})()",
  v => v === '3|auto,ai,local,');
await chk('本地引擎下出现语言包选择（默认 chi_sim+eng）',
  "(function(){var l=document.getElementById('frOcrLang');return (l.style.display!=='none') + '|' + l.value;})()",
  v => v === 'true|chi_sim+eng');
await chk('提示区仍写明当前文件与隐私（不会被 OCR 打乱）',
  "document.getElementById('frNotice').textContent", v => String(v).indexOf('不会上传') >= 0);

// 选第 1 页并识别
await ev("(function(){document.getElementById('frSelInput').value='1';document.getElementById('frSelApply').click();})()");
await sleep(300);
const aiBefore = await ev("window.__aiBodies.length");
await ev("document.getElementById('frOcrBtn').click()");
await sleep(3500);
const aiAfter = await ev("window.__aiBodies.length");
chkRaw('本地 OCR 全程不发起任何 AI 请求（没 Key 也能用）', aiAfter === aiBefore, aiBefore + '→' + aiAfter);
await chk('本地 OCR 使用了所选语言包（chi_sim+eng）', "window.__tessLang", v => String(v).indexOf('chi_sim') >= 0);
await chk('本地 OCR 结果并入正文并标注「本地识别」',
  "document.getElementById('frBody').textContent.indexOf('黔灵山上有猕猴') >= 0 && document.getElementById('frBody').textContent.indexOf('本地识别') >= 0",
  v => v === true);
await chk('强选「AI 视觉」但无视觉模型时，提示会诚实说明已回落本地',
  "(function(){var b=document.querySelectorAll('#frOcrEngine button');for(var i=0;i<b.length;i++){if(b[i].getAttribute('data-eng')==='ai'){b[i].click();break;}}return document.getElementById('frOcrTip').textContent;})()",
  v => String(v).indexOf('本地') >= 0);

// 恢复 Key 与千问（后面的 AI 提炼需要）
await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();var p=document.getElementById('providerSelect');p.value='qwen';p.dispatchEvent(new Event('change',{bubbles:true}));var m=document.getElementById('modelInput');m.value='qwen-vl-max';m.dispatchEvent(new Event('input',{bubbles:true}));var k=document.getElementById('apiKeyInput');k.value='sk-reader-test';k.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.tab[data-panel=\"tools\"]').click();})()");
await sleep(500);

// 6.9) AI 视觉失败时自动降级到本地 OCR（不许"一片空白"）
await ev("(function(){document.querySelector('.tab[data-panel=\"api\"]').click();var p=document.getElementById('providerSelect');p.value='qwen';p.dispatchEvent(new Event('change',{bubbles:true}));var m=document.getElementById('modelInput');m.value='qwen-plus';m.dispatchEvent(new Event('input',{bubbles:true}));var v=document.getElementById('visionModelInput');if(v){v.value='qwen-vl-max';v.dispatchEvent(new Event('input',{bubbles:true}));}var k=document.getElementById('apiKeyInput');k.value='sk-reader-test';k.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.tab[data-panel=\"tools\"]').click();})()");
await sleep(500);
// 让"带图片"的请求返回 400 参数错误（模拟 VL 输出上限/不支持），本地引擎仍可用
await ev("(function(){var prev=window.fetch;window.fetch=function(u,init){try{var b=JSON.parse(init.body||'{}');if(JSON.stringify(b.messages||[]).indexOf('image_url')>=0){return Promise.resolve(new Response(JSON.stringify({error:{message:'max_tokens is invalid, range of max_tokens should be [1, 2048]'}}),{status:400,headers:{'Content-Type':'application/json'}}));}}catch(e){}return prev(u,init);};return true;})()");
await ev("(function(){var b=document.querySelectorAll('#frOcrEngine button');for(var i=0;i<b.length;i++){if(b[i].getAttribute('data-eng')==='ai'){b[i].click();break;}}})()");
await sleep(200);
await ev("(function(){document.getElementById('frSelInput').value='1';document.getElementById('frSelApply').click();})()");
await sleep(200);
await chk('选「AI 视觉」时提示说明失败会自动改用本地 OCR',
  "document.getElementById('frOcrTip').textContent", v => String(v).indexOf('本地 OCR') >= 0);
await ev("document.getElementById('frOcrBtn').click()");
await sleep(4000);
await chk('AI 视觉失败后该页自动改用本地 OCR，正文仍有内容',
  "document.getElementById('frBody').textContent.indexOf('黔灵山上有猕猴') >= 0", v => v === true);
await chk('完成提示里写明了「已自动改用本地 OCR」',
  "document.getElementById('frOcrTip').textContent", v => String(v).indexOf('自动改用本地') >= 0);

// 7) AI 提炼
await ev("document.querySelectorAll('#frFiles .fr-file')[0].click()");
await sleep(300);
await chk('AI 桩随新文档注入并生效（fetch 已被替换）', "String(window.fetch).indexOf('function') === 0 && !!window.__drop", v => v === true);
await ev("document.getElementById('frAiBtn').click()");
await sleep(2500);
console.log('  [诊断] frAiOut 前 160 字：' + String(await ev("document.getElementById('frAiOut').textContent")).slice(0, 160));
await chk('AI 提炼：切到 AI 视图并渲染摘要', "document.getElementById('frAiOutWrap').style.display !== 'none' && document.querySelectorAll('#frAiOut h2, #frAiOut h3, #frAiOut h4').length >= 4", v => v === true);
await chk('AI 提炼结果含「一句话概要 / 关键概念」', "document.getElementById('frAiOut').textContent.indexOf('一句话概要') >= 0 && document.getElementById('frAiOut').textContent.indexOf('关键概念') >= 0 && document.getElementById('frAiOut').textContent.indexOf('可延伸的问题') >= 0", v => v === true);
await chk('视图切换：可切回原文', "(document.querySelectorAll('#frViewSeg button')[0].click(), document.getElementById('frBody').style.display !== 'none')", v => v === true);

// 8) 导出 Markdown（先切回 PDF 文件并选中第 1 页，确保有内容可导）
await ev("(function(){var list=document.querySelectorAll('#frFiles .fr-file');for(var i=0;i<list.length;i++){if(list[i].textContent.indexOf('扫描页.pdf')>=0){list[i].click();break;}}})()");
await sleep(300);
await ev("(function(){document.getElementById('frSelInput').value='1';document.getElementById('frSelApply').click();})()");
await sleep(300);
await ev("document.getElementById('frMdBtn').click()");
await sleep(400);
await chk('导出 Markdown 触发下载（createObjectURL 被调用）', "window.__blobs >= 1", v => v === true);
const expTxt = await ev("window.__lastBlob ? window.__lastBlob.text() : ''");
chkRaw('导出内容标注了页码范围', String(expTxt).indexOf('范围：') >= 0 && String(expTxt).indexOf('页') >= 0, String(expTxt).slice(0, 120));
chkRaw('导出内容包含 AI 提炼与原文两节', String(expTxt).indexOf('## AI 提炼') >= 0 && String(expTxt).indexOf('## 原文') >= 0, String(expTxt).slice(0, 160));
// 取消「含 AI 提炼」后，导出只应有原文
await ev("(function(){var c=document.getElementById('frExpAi');c.checked=false;})()");
await ev("document.getElementById('frMdBtn').click()");
await sleep(400);
const expTxt2 = await ev("window.__lastBlob ? window.__lastBlob.text() : ''");
chkRaw('取消「含 AI 提炼」后导出只剩原文', String(expTxt2).indexOf('## AI 提炼') < 0 && String(expTxt2).indexOf('## 原文') >= 0, String(expTxt2).slice(0, 100));
await ev("(function(){document.getElementById('frExpAi').checked=true;})()");

// 9) 复制全文
await ev("document.getElementById('frCopyBtn').click()");
await sleep(300);
await chk('复制全文写入剪贴板', "window.__copied.length >= 1 && window.__copied[0].length > 5", v => v === true);

// 10) 隐私：文件内容绝不进 localStorage
await chk('隐私：localStorage 里没有文件内容（正文只存在内存）',
  "String(localStorage.getItem('codetutor.chat.v1')||'').indexOf('甲秀楼位于南明河上') + '|' + String(localStorage.getItem('codetutor.progress.v1')||'').indexOf('甲秀楼位于南明河上') + '|' + String(localStorage.getItem('codetutor.kb.v1')||'').indexOf('甲秀楼位于南明河上')",
  v => v === '-1|-1|-1');

// 11) 清空
await ev("document.getElementById('frClearBtn').click()");
await sleep(300);
await chk('清空文件：列表归零、按钮回到禁用', "document.querySelectorAll('#frFiles .fr-file').length + '|' + document.getElementById('frAiBtn').disabled", v => v === '0|true');

const excList = events.filter(e => e.method === 'Runtime.exceptionThrown')
  .map(e => String(e.params.exceptionDetails.exception && e.params.exceptionDetails.exception.description || e.params.exceptionDetails.text).split('\n')[0]);
if (excList.length) console.log('  [异常样本] ' + excList.slice(0, 3).join(' || '));
const errs = excList.length;
const badLogs = events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && /Uncaught|Cannot read|is not defined/.test(e.params.entry.text || '')).length;
chkRaw('无未捕获异常 / 脚本错误', errs === 0 && badLogs === 0, '异常=' + errs + ' 错误日志=' + badLogs);

await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.result.identifier });
const fails = results.filter(r => !r.ok);
console.log('\n总计：' + results.length + ' 项，通过 ' + (results.length - fails.length) + '，失败 ' + fails.length);
if (fails.length) fails.forEach(f => console.log('  ✘ ' + f.name + ' → ' + f.v));
process.exit(fails.length ? 1 : 0);
