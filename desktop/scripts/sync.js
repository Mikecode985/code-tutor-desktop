'use strict';
/**
 * 打包前同步：把仓库根目录的 index.html 复制进 app/，
 * 并把 CodeMirror 的 CDN 资源下载到本地 vendor/，改写引用为相对路径。
 * —— 这样桌面版**断网也能用编辑器**（只有 AI 请求、PDF、OCR 需要联网）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');          // codelearn/
const DESKTOP = path.resolve(__dirname, '..');
const APP_DIR = path.join(DESKTOP, 'app');
const VENDOR = path.join(APP_DIR, 'vendor', 'codemirror');

const CM_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/';
const CM_MIRRORS = [
  CM_BASE,
  'https://cdn.jsdelivr.net/npm/codemirror@5.65.16/',
  'https://unpkg.com/codemirror@5.65.16/'
];
/** [CDN 路径, 本地文件名] */
const CM_FILES = [
  ['codemirror.min.css', 'codemirror.min.css'],
  ['codemirror.min.js', 'codemirror.min.js'],
  ['mode/python/python.min.js', 'python.min.js'],
  ['mode/clike/clike.min.js', 'clike.min.js'],
  ['addon/edit/matchbrackets.min.js', 'matchbrackets.min.js'],
  ['addon/edit/closebrackets.min.js', 'closebrackets.min.js'],
  ['addon/selection/active-line.min.js', 'active-line.min.js']
];

async function download(rel, out) {
  if (fs.existsSync(out) && fs.statSync(out).size > 200) {
    console.log('  = 已有 ' + path.basename(out));
    return true;
  }
  for (const base of CM_MIRRORS) {
    try {
      const res = await fetch(base + rel, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 200) continue;
      fs.writeFileSync(out, buf);
      console.log('  ↓ ' + rel + ' (' + Math.round(buf.length / 1024) + 'KB)');
      return true;
    } catch (e) { /* 换下一个镜像 */ }
  }
  console.error('  ✗ 下载失败：' + rel);
  return false;
}

(async function main() {
  fs.mkdirSync(VENDOR, { recursive: true });

  console.log('[1/3] 下载 CodeMirror 到 app/vendor/codemirror …');
  let ok = true;
  for (const [rel, name] of CM_FILES) {
    if (!(await download(rel, path.join(VENDOR, name)))) ok = false;
  }
  if (!ok) {
    console.error('\n有资源下载失败。可以稍后重试（脚本会跳过已下载的文件），或临时保留 CDN 引用。');
  }

  console.log('[2/3] 复制 index.html → app/index.html');
  const htmlPath = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  const before = html.length;

  // 改写 CodeMirror 的 CDN 引用为本地相对路径
  let replaced = 0;
  for (const [rel, name] of CM_FILES) {
    const full = CM_BASE + rel;
    const local = 'vendor/codemirror/' + name;
    if (html.indexOf(full) >= 0) {
      html = html.split(full).join(local);
      replaced++;
    }
  }
  // 兜底：任何残留的 cdnjs codemirror 链接都指向 vendor（防止版本号变动后漏改）
  html = html.replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/[^"']+/g, function (m) {
    const name = path.basename(m).replace(/^python\.min\.js$/, 'python.min.js');
    if (/codemirror\.min\.(css|js)$/.test(name)) return 'vendor/codemirror/' + name;
    return 'vendor/codemirror/' + (name === 'clike.min.js' ? 'clike.min.js' : name);
  });

  // 注入构建标记，便于排查"这是哪个版本打出来的包"
  const stamp = new Date().toISOString();
  const marker = '<!-- CodeTutor Desktop build ' + stamp + ' -->';
  html = html.replace('</head>', marker + '\n</head>');

  const outPath = path.join(APP_DIR, 'index.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('  ✓ 已写入 app/index.html（' + Math.round(before / 1024) + 'KB → ' + Math.round(html.length / 1024) + 'KB，改写 CDN 引用 ' + replaced + ' 处）');

  console.log('[3/3] 自检');
  const checks = [
    ['本地 CodeMirror 引用', html.indexOf('vendor/codemirror/codemirror.min.js') >= 0],
    ['无残留 codemirror CDN', html.indexOf('cdnjs.cloudflare.com/ajax/libs/codemirror') < 0],
    ['体积合理（>100KB）', html.length > 100000]
  ];
  let allOk = true;
  for (const [name, pass] of checks) {
    console.log('  ' + (pass ? '✓' : '✗') + ' ' + name);
    if (!pass) allOk = false;
  }
  if (!allOk) process.exit(1);
})();
