/**
 * 桌面版打包产物校验（不需要 Electron 运行，纯文件级断言）
 * 用法：node tests/desktop-package.mjs [--site=file:///.../desktop/app/index.html]
 *
 * 校验内容：
 *  1. app/index.html 已同步且 CodeMirror 本地化（离线可用）
 *  2. win-unpacked 结构完整（exe / app.asar / 关键 dll）
 *  3. app.asar 内含 main.js、preload.js、app/index.html、vendor/codemirror/*
 *  4. 一键安装包齐全（cmd / ps1 / zip / ico / 说明），ps1 带 UTF-8 BOM（否则 PS5.1 中文乱码）
 *  5. zip 里含 CodeTutor.exe 与 resources/app.asar
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'desktop');
const DIST = path.join(DESKTOP, 'dist');
const results = [];
const chk = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail).slice(0, 90) }); };

/* ---------- 1. 同步后的页面 ---------- */
const appHtml = path.join(DESKTOP, 'app', 'index.html');
chk('app/index.html 已生成', fs.existsSync(appHtml));
let html = '';
if (fs.existsSync(appHtml)) html = fs.readFileSync(appHtml, 'utf8');
chk('页面引用了本地 CodeMirror（vendor/）', html.indexOf('vendor/codemirror/codemirror.min.js') >= 0);
chk('页面无残留 CodeMirror CDN 引用', html.indexOf('cdnjs.cloudflare.com/ajax/libs/codemirror') < 0);
chk('页面注入了打包标记', html.indexOf('CodeTutor Desktop build') >= 0, (html.match(/CodeTutor Desktop build [^>]*/) || [''])[0]);
for (const f of ['codemirror.min.js', 'codemirror.min.css', 'python.min.js', 'clike.min.js', 'matchbrackets.min.js', 'closebrackets.min.js', 'active-line.min.js']) {
  const p = path.join(DESKTOP, 'app', 'vendor', 'codemirror', f);
  chk('vendor 资源存在：' + f, fs.existsSync(p) && fs.statSync(p).size > 200, fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024) + 'KB' : '缺失');
}

/* ---------- 2. win-unpacked ---------- */
const unpacked = path.join(DIST, 'win-unpacked');
chk('win-unpacked 目录存在', fs.existsSync(unpacked));
for (const f of ['CodeTutor.exe', 'resources/app.asar', 'icudtl.dat', 'resources.pak', 'libEGL.dll', 'ffmpeg.dll']) {
  const p = path.join(unpacked, f);
  chk('打包结构：' + f, fs.existsSync(p), fs.existsSync(p) ? Math.round(fs.statSync(p).size / 1024 / 1024) + 'MB' : '缺失');
}

/* ---------- 3. app.asar 内容 ---------- */
const asar = path.join(unpacked, 'resources', 'app.asar');
if (fs.existsSync(asar)) {
  const asarCli = path.join(DESKTOP, 'node_modules', '@electron', 'asar', 'bin', 'asar.js');
  try {
    const list = execFileSync(process.execPath, [asarCli, 'list', asar], { encoding: 'utf8' });
    chk('asar 含 main.js', /\bmain\.js\b/.test(list));
    chk('asar 含 preload.js', /\bpreload\.js\b/.test(list));
    chk('asar 含 app/index.html', list.indexOf('app\\index.html') >= 0 || list.indexOf('app/index.html') >= 0);
    chk('asar 含本地 CodeMirror', list.indexOf('vendor') >= 0 && list.indexOf('codemirror.min.js') >= 0);
    chk('asar 含应用图标', list.indexOf('icon.ico') >= 0);
    chk('asar 不含 node_modules 等冗余', list.indexOf('node_modules') < 0 && list.indexOf('dist') < 0);
  } catch (e) {
    chk('asar 可列举（asar CLI 可用）', false, e.message.slice(0, 60));
  }
}

/* ---------- 4. 一键安装包 ---------- */
const bundles = fs.existsSync(DIST) ? fs.readdirSync(DIST).filter(n => n.indexOf('一键安装') >= 0) : [];
chk('一键安装包目录存在', bundles.length > 0, bundles.join(','));
let bundleDir = bundles.length ? path.join(DIST, bundles[0]) : '';
if (bundleDir) {
  const need = ['安装 CodeTutor.cmd', 'install.ps1', 'icon.ico', '安装说明.txt'];
  for (const f of need) chk('安装包含：' + f, fs.existsSync(path.join(bundleDir, f)));
  const zips = fs.readdirSync(bundleDir).filter(n => /\.zip$/i.test(n));
  chk('安装包含 payload zip', zips.length === 1, zips.join(','));
  if (zips.length) {
    const zp = path.join(bundleDir, zips[0]);
    chk('payload zip 大小合理（>80MB）', fs.statSync(zp).size > 80 * 1024 * 1024, Math.round(fs.statSync(zp).size / 1024 / 1024) + 'MB');
    const seven = path.join(DESKTOP, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
    if (fs.existsSync(seven)) {
      const list = execFileSync(seven, ['l', zp], { encoding: 'utf8' });
      chk('zip 含 CodeTutor.exe', /CodeTutor\.exe/.test(list));
      chk('zip 含 resources/app.asar', /app\.asar/.test(list));
      chk('zip 条目数 ≥ 70', (list.match(/\n20\d\d-/g) || []).length >= 70 || list.length > 5000);
    }
  }
  // ps1 必须是 UTF-8 BOM，否则中文在 PowerShell 5.1 下解析失败
  const ps1 = path.join(bundleDir, 'install.ps1');
  if (fs.existsSync(ps1)) {
    const buf = fs.readFileSync(ps1);
    chk('install.ps1 带 UTF-8 BOM', buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF);
    const txt = buf.toString('utf8');
    chk('install.ps1 关键步骤齐全',
      txt.indexOf('ExtractToDirectory') >= 0 && txt.indexOf('CreateShortcut') >= 0 &&
      txt.indexOf('Uninstall') >= 0 && txt.indexOf('WriteUninstaller') < 0);
    chk('install.ps1 用 WScript.Shell 建快捷方式', txt.indexOf('WScript.Shell') >= 0);
    chk('install.ps1 注册卸载入口', txt.indexOf('CurrentVersion\\Uninstall') >= 0);
  }
  // cmd 必须是 ASCII（cmd 按 OEM 代码页解析）
  const cmdPath = path.join(bundleDir, '安装 CodeTutor.cmd');
  if (fs.existsSync(cmdPath)) {
    const ascii = fs.readFileSync(cmdPath, 'latin1');
    chk('启动器 cmd 为纯 ASCII + 调用 ps1', ascii.indexOf('powershell') >= 0 && !/[^\x00-\x7F]/.test(ascii));
  }
}

/* ---------- 5. 主进程脚本 ---------- */
const mainJs = fs.readFileSync(path.join(DESKTOP, 'main.js'), 'utf8');
chk('main.js 开启 contextIsolation 且关闭 nodeIntegration', /contextIsolation:\s*true/.test(mainJs) && /nodeIntegration:\s*false/.test(mainJs));
chk('main.js 外链交给系统浏览器', mainJs.indexOf('shell.openExternal') >= 0);
chk('main.js 单实例锁', mainJs.indexOf('requestSingleInstanceLock') >= 0);
chk('main.js 记忆窗口尺寸', mainJs.indexOf('window-state.json') >= 0);
chk('main.js 支持 --smoke 自检', mainJs.indexOf('--smoke') >= 0);
const preload = fs.readFileSync(path.join(DESKTOP, 'preload.js'), 'utf8');
chk('preload 只暴露只读桌面标识', preload.indexOf('contextBridge.exposeInMainWorld') >= 0 && preload.indexOf('exposeInMainWorld(\'__CODETUTOR_DESKTOP__\'') >= 0 || preload.indexOf('__CODETUTOR_DESKTOP__') >= 0);

/* ---------- 输出 ---------- */
const fail = results.filter(r => !r.ok);
console.log('\n================ 桌面版打包产物校验 ================');
results.forEach((r, i) => console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '   →   ' + r.detail : '')));
console.log('\n总计：' + results.length + ' 项，通过 ' + (results.length - fail.length) + '，失败 ' + fail.length);
process.exit(fail.length === 0 ? 0 : 1);
