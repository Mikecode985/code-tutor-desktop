/**
 * 语法检查：把 index.html 里所有内联 <script> 抽出来逐个 node --check，
 * 避免"一个逗号写错导致整页白屏"这类问题进入仓库。CI 与本地都能跑：
 *
 *   node tests/syntax-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length === 0) {
  console.error('✗ 没有找到内联脚本，检查 index.html 是否正常');
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-syntax-'));
let bad = 0;
scripts.forEach((js, i) => {
  const fp = path.join(tmp, 'inline-' + i + '.mjs');
  fs.writeFileSync(fp, js, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', fp], { stdio: 'pipe' });
    console.log('  ✓ 内联脚本 #' + i + '（' + Math.round(js.length / 1024) + 'KB）语法正确');
  } catch (e) {
    bad++;
    console.error('  ✗ 内联脚本 #' + i + ' 语法错误：');
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
  fs.unlinkSync(fp);
});

// 顺带校验代理文件
for (const f of ['functions/api/chat.js', 'cloudflare-proxy.js', 'local-proxy.mjs']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  try {
    execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' });
    console.log('  ✓ ' + f + ' 语法正确');
  } catch (e) {
    bad++;
    console.error('  ✗ ' + f + ' 语法错误');
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
console.log('\n' + (bad === 0 ? '✅ 语法检查通过（' + (scripts.length + 3) + ' 个文件）' : '❌ 有 ' + bad + ' 个文件语法错误'));
process.exit(bad === 0 ? 0 : 1);
