'use strict';
/**
 * 一键生成「桌面版 + 一键安装包」（不需要 NSIS/管理员权限）
 *
 *   node scripts/make-bundle.js          完整构建：同步 → 打包 win-unpacked → 压缩 zip → 组装安装包
 *   node scripts/make-bundle.js --fast   跳过 electron-builder（复用已有 win-unpacked），只重打 zip
 *
 * 产物：desktop/dist/
 *   ├─ win-unpacked/                 免安装运行目录（CodeTutor.exe 直接双击可用）
 *   └─ 一键安装-Windows/
 *       ├─ 安装 CodeTutor.cmd        双击即可安装（解压 + 快捷方式 + 卸载入口 + 启动）
 *       ├─ install.ps1               安装逻辑（UTF-8 BOM，PowerShell 5.1 可读中文）
 *       ├─ CodeTutor-<ver>-win64.zip 程序本体（win-unpacked 的压缩包）
 *       ├─ icon.ico                  快捷方式图标
 *       └─ 安装说明.txt
 *
 * 说明：本项目也保留了 electron-builder 的 NSIS 配置（npm run dist）。
 * 某些受限环境（禁止创建内存映射 / 无签名证书）会让 NSIS 与 Electron 无法运行，
 * 这时用本脚本产出的「zip + 安装脚本」同样是一次点击完成安装。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DESKTOP = path.resolve(__dirname, '..');
const DIST = path.join(DESKTOP, 'dist');
const UNPACKED = path.join(DIST, 'win-unpacked');
const CACHE = path.join(DESKTOP, '.cache');
const FAST = process.argv.includes('--fast');

const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const VERSION = pkg.version;

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: DESKTOP }, opts || {}));
  if (r.status !== 0) {
    console.error('\n[失败] ' + cmd + ' ' + args.join(' ') + ' → exit ' + r.status);
    process.exit(r.status || 1);
  }
}

function must(p, what) {
  if (!fs.existsSync(p)) {
    console.error('[缺失] ' + what + '：' + p);
    process.exit(1);
  }
}

/* ---------- 1. 同步页面 + 本地化 CodeMirror ---------- */
console.log('\n[1/4] 同步页面资源');
run(process.execPath, [path.join(DESKTOP, 'scripts', 'sync.js')]);

/* ---------- 2. 打包 win-unpacked ---------- */
if (FAST) {
  console.log('\n[2/4] --fast：跳过 electron-builder，复用已有 win-unpacked');
  must(UNPACKED, 'win-unpacked（去掉 --fast 可重新生成）');
} else {
  console.log('\n[2/4] 打包应用目录（electron-builder --dir）');
  const eb = path.join(DESKTOP, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  must(eb, 'electron-builder');
  run(process.execPath, [eb, '--win', '--dir'], {
    env: Object.assign({}, process.env, {
      ELECTRON_BUILDER_CACHE: path.join(CACHE, 'electron-builder'),
      ELECTRON_CACHE: path.join(CACHE, 'electron'),
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    })
  });
  must(path.join(UNPACKED, 'CodeTutor.exe'), '打包后的 CodeTutor.exe');
  must(path.join(UNPACKED, 'resources', 'app.asar'), 'app.asar');
}

/* ---------- 3. 压缩 payload ---------- */
console.log('\n[3/4] 压缩程序本体（约 100MB，请稍候）');
const seven = path.join(DESKTOP, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
must(seven, '7za.exe（随 electron-builder 安装）');
const bundleDir = path.join(DIST, '一键安装-Windows');
fs.mkdirSync(bundleDir, { recursive: true });
fs.mkdirSync(path.join(CACHE, '7ztmp'), { recursive: true });
const zipPath = path.join(bundleDir, `CodeTutor-${VERSION}-win64.zip`);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
run(seven, ['a', '-tzip', '-mx=5', '-mmt=on', '-w' + path.join(CACHE, '7ztmp'), zipPath, '.\\*'], { cwd: UNPACKED });
console.log('  zip：' + (fs.statSync(zipPath).size / 1048576).toFixed(1) + 'MB');

/* ---------- 4. 组装安装包 ---------- */
console.log('\n[4/4] 组装一键安装包');
const copies = [
  [path.join(DESKTOP, 'installer', 'install.ps1'), 'install.ps1'],
  [path.join(DESKTOP, 'installer', '安装 CodeTutor.cmd'), '安装 CodeTutor.cmd'],
  [path.join(DESKTOP, 'build', 'icon.ico'), 'icon.ico'],
  [path.join(DESKTOP, '安装说明.txt'), '安装说明.txt']
];
for (const [src, name] of copies) {
  must(src, name);
  fs.copyFileSync(src, path.join(bundleDir, name));
}
// 校验 ps1 必须是 UTF-8 BOM（PowerShell 5.1 读中文的硬要求）
const ps1 = fs.readFileSync(path.join(bundleDir, 'install.ps1'));
if (!(ps1[0] === 0xEF && ps1[1] === 0xBB && ps1[2] === 0xBF)) {
  console.error('[失败] install.ps1 缺少 UTF-8 BOM，PowerShell 5.1 会解析失败（中文乱码）');
  process.exit(1);
}

const totalMb = (fs.readdirSync(bundleDir).reduce(function (s, n) {
  return s + fs.statSync(path.join(bundleDir, n)).size;
}, 0) / 1048576).toFixed(1);
console.log('\n================ 构建完成 ================');
console.log('  免安装版：' + UNPACKED);
console.log('  一键安装：' + bundleDir + '（共 ' + totalMb + 'MB）');
console.log('  用法：把「一键安装-Windows」整个文件夹发给用户 → 双击「安装 CodeTutor.cmd」');
console.log('  升级：重新跑本脚本，用户再双击一次即可覆盖安装（学习数据保留）');
