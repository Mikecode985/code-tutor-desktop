/**
 * 桌面版工程自洽性检查（CI 用，不需要 Electron / Windows）
 *   node tests/desktop-ci-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = path.join(ROOT, 'desktop');

const need = [
  'package.json', 'main.js', 'preload.js', 'README.md', '安装说明.txt',
  'build/icon.ico', 'installer/install.ps1', 'installer/安装 CodeTutor.cmd', 'installer/codetutor.nsi',
  'scripts/sync.js', 'scripts/make-bundle.js'
];
let bad = 0;
const ok = (name, pass, detail) => {
  console.log('  ' + (pass ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '   →   ' + detail : ''));
  if (!pass) bad++;
};

for (const f of need) {
  const p = path.join(D, f);
  ok('存在：' + f, fs.existsSync(p));
}

// package.json 结构
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(D, 'package.json'), 'utf8'));
  ok('package.json 有 main/scripts/build', !!pkg.main && !!pkg.scripts && !!pkg.build);
  ok('主进程入口为 main.js', pkg.main === 'main.js', pkg.main);
  ok('electron / electron-builder 在 devDependencies',
    !!(pkg.devDependencies && pkg.devDependencies.electron && pkg.devDependencies['electron-builder']));
  ok('bundle 脚本存在', !!(pkg.scripts && pkg.scripts.bundle));
} catch (e) {
  ok('package.json 可解析', false, e.message);
}

// main.js 安全配置
const mainJs = fs.readFileSync(path.join(D, 'main.js'), 'utf8');
ok('contextIsolation: true', /contextIsolation:\s*true/.test(mainJs));
ok('nodeIntegration: false', /nodeIntegration:\s*false/.test(mainJs));
ok('外链交给系统浏览器', mainJs.indexOf('shell.openExternal') >= 0);
ok('单实例锁', mainJs.indexOf('requestSingleInstanceLock') >= 0);

// install.ps1 必须是 UTF-8 BOM（PowerShell 5.1 读中文的硬要求）
const ps1 = fs.readFileSync(path.join(D, 'installer', 'install.ps1'));
ok('install.ps1 带 UTF-8 BOM', ps1[0] === 0xEF && ps1[1] === 0xBB && ps1[2] === 0xBF);
const ps1Text = ps1.toString('utf8');
ok('install.ps1 含解压与快捷方式逻辑',
  ps1Text.indexOf('ExtractToDirectory') >= 0 && ps1Text.indexOf('CreateShortcut') >= 0);

// 启动器必须是纯 ASCII
const cmd = fs.readFileSync(path.join(D, 'installer', '安装 CodeTutor.cmd'), 'latin1');
ok('启动器 cmd 纯 ASCII 且调用 powershell',
  cmd.indexOf('powershell') >= 0 && !/[^\x00-\x7F]/.test(cmd));

// 同步脚本会把 CDN 本地化
const syncJs = fs.readFileSync(path.join(D, 'scripts', 'sync.js'), 'utf8');
ok('sync.js 会下载 CodeMirror 到本地', syncJs.indexOf('vendor') >= 0 && syncJs.indexOf('codemirror') >= 0);

console.log('\n' + (bad === 0 ? '✅ 桌面版工程检查通过' : '❌ ' + bad + ' 项失败'));
process.exit(bad === 0 ? 0 : 1);
