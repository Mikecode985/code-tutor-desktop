# 部署指南

三种部署方式：Cloudflare Pages（推荐）、自建 Worker、本机代理与直连模式。请部署**你自己的**代理，或直接用「直连服务商」，不要依赖别人的代理跑自己的 Key。

## 六、部署步骤

> **先选代理方案**：如果你在国内网络下访问 `*.workers.dev` 失败（`Failed to fetch`），
> 请直接看 **第三节「网络被墙怎么办」**，用同源 `/api/chat`（推荐）或本机 `local-proxy.mjs`，
> 下面的第 1 步可以跳过。下面按「Worker 默认可用的网络环境」来写。

### 第 1 步：部署 Worker（先做这步，才能拿到代理地址）

**方式 A — 控制台粘贴（推荐）**

1. 登录 <https://dash.cloudflare.com> → 左侧 **Workers & Pages** → **Create** → **Create Worker**
2. 名称填 `codelearn-proxy`（随意）→ **Deploy**
3. 点 **Edit code**，把 `cloudflare-proxy.js` 的全部内容粘贴进去覆盖模板 → **Deploy**
4. 记下生成的地址，形如：`https://codelearn-proxy.你的子域.workers.dev`
5. 【重要】回到 Worker 的 **Settings → Variables and Secrets**，添加变量：
   - `ALLOWED_ORIGINS` = `https://你的站点.pages.dev`（多个用英文逗号分隔；本地调试再加 `http://localhost:8080`）
   - 不设置则默认 `*`，任何网站都能调你的代理，正式站点务必收紧。

**方式 B — Wrangler CLI**

```bash
npm i -g wrangler
wrangler login
mkdir codelearn-proxy && cd codelearn-proxy
# 把 cloudflare-proxy.js 改名为 index.js 放进来
cat > wrangler.toml <<'EOF'
name = "codelearn-proxy"
main = "index.js"
compatibility_date = "2025-01-01"

[vars]
ALLOWED_ORIGINS = "https://你的站点.pages.dev,http://localhost:8080"
EOF
wrangler deploy
```

**验证代理是否活着**：浏览器直接打开 Worker 地址，应返回
`{"ok":true,"service":"codelearn-proxy",...}`。

### 第 2 步：部署前端

**方式 A — Cloudflare Pages（推荐，与 Worker 同生态）**

1. Workers & Pages → **Create** → **Pages** → **Upload assets**
2. 项目名随意，把 `index.html` 拖进去（或上传整个 `codelearn` 目录）→ **Deploy**
3. 得到 `https://项目名.pages.dev`
4. 回到 Worker，把 `ALLOWED_ORIGINS` 改成这个真实域名并保存

> Git 集成方式：把仓库连到 Pages，构建命令留空、输出目录填 `.`（因为不需要构建）。

**方式 B — GitHub Pages**

```bash
git init && git add index.html && git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/codelearn.git
git push -u origin main
```

仓库 **Settings → Pages** → Source 选 `Deploy from a branch` → 分支 `main`、目录 `/ (root)` → Save。
地址为 `https://你的用户名.github.io/codelearn/`，把它加进 Worker 的 `ALLOWED_ORIGINS`。

**方式 C — 本地跑**

双击 `index.html` 即可（file:// 也能用）；或 `python -m http.server 8080` 后访问
<http://localhost:8080>（记得把 `http://localhost:8080` 加进 `ALLOWED_ORIGINS`）。

### 第 3 步：站点配置

1. 打开站点 → **API 设置** 标签页
2. 服务商选 **DeepSeek** 或 **通义千问**
3. 填入你自己的 API Key（[DeepSeek 控制台](https://platform.deepseek.com) / [阿里云百炼](https://bailian.console.aliyun.com)）
4. 代理地址填第 1 步拿到的 Worker 地址
5. 点 **测试连接** → 显示「连接成功」即配置完成
6. 顶部选择编程语言，切到 **代码助手 / 练习（出题 · 作答 · 批改）** 开始使用

---

---

## 七、网络被墙怎么办（`*.workers.dev` 连不上）

**症状**：前端报 `无法连接代理。原始错误：Failed to fetch`（注意与"401 认证失败"是两回事）。

**原因**：国内网络对 `*.workers.dev` 普遍做了 **DNS 污染 + SNI 阻断**。本机实测（2026-10）：

| 检查项 | 实测结果 |
| --- | --- |
| `nslookup code-proxy.xxx.workers.dev` | 解析到 `31.13.96.192`、`185.60.216.169`（**Facebook IP 段**）——每次查询还不一样 |
| 解析一个**根本不存在的**随机子域 | 竟然也"解析成功"，返回 `162.125.2.5`（**Dropbox IP**）→ 确证是污染 |
| 用公共 DoH（Cloudflare DNS）查询 | 返回正确答案 `104.21.72.244`（Cloudflare 真实 IP） |
| 用正确 IP + 正确 SNI 强制直连 | **ECONNRESET**（TCP 能连、TLS 握手被重置）→ SNI 阻断 |
| 同一台机器访问你的 Pages 站点、`api.deepseek.com` | **完全正常** |

> 结论：这是**网络层问题**，改代码没用；而且**改 hosts 文件也没用**（SNI 阻断发生在 TLS 阶段，
> 与 DNS 解析结果无关——上面那条 ECONNRESET 就是用正确 IP 测出来的）。

### 方案 ①（推荐）：改用同源 `/api/chat`（Pages Functions）

代理跑在**你自己的站点域名**下，同域请求、没有 CORS、完全不碰 `workers.dev`。

```bash
# 目录里放好 index.html 与 functions/api/chat.js（functions/ 必须与 index.html 同级，
# 不能放进 dist/ 之类的构建输出目录），然后在项目根目录执行：
npm i -g wrangler && wrangler login
wrangler pages deploy . --project-name=code-tutor-site
#                    ↑ project-name 必须与你现有的 Pages 项目名完全一致
```

- **注意**：控制台「拖拽上传」**不支持** Functions（[官方说明](https://developers.cloudflare.com/pages/functions/get-started/)），必须用 `wrangler` 或 Git 集成（构建命令留空、输出目录 `.`）。
- 部署后浏览器打开 `https://你的站点.pages.dev/api/chat`，应看到 `{"ok":true,"service":"codelearn-proxy","deploy":"pages-function",...}`
- 前端【API 设置】→ 代理地址填 **`/api/chat`**（以 `/` 开头会被识别为同源路径）

### 方案 ②：给 Worker 绑定自定义域名

Workers & Pages → 你的 Worker → **Settings → Domains & Routes → Add → Custom Domain**，
绑定例如 `api.你的域名.com`（域名需托管在 Cloudflare）。前端代理地址填 `https://api.你的域名.com`。

### 方案 ③：本机代理（最快，但新版 Chrome/Edge 需要授权）

```bash
node local-proxy.mjs        # 看到 "本机代理已启动 http://127.0.0.1:8787"
```

前端代理地址填 `http://127.0.0.1:8787`。

> ⚠️ **Chrome 147+ / Edge 147+ 会拦这一跳**。它们引入了 **Local Network Access** 策略：
> 公网 https 页面访问本机 `127.0.0.1` 必须由用户显式授权，否则前端只显示 `Failed to fetch`，
> 浏览器控制台原文（本机实测 Chrome 154.0.8037.93）：
> ```
> Access to fetch at 'http://127.0.0.1:8787/' from origin 'https://xxxx.pages.dev'
>   has been blocked by CORS policy: Permission was denied for this request
>   to access the `loopback` address space.
> net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS   (LocalNetworkAccessPermissionDenied)
> ```
> **处理**：点「测试连接」时留意地址栏弹出的「访问本地网络上的设备」提示 → 允许；
> 若已误拒，去 地址栏图标 → 网站设置 → 「本地网络访问」→ 允许 → 刷新重试。
> （`local-proxy.mjs` 已按规范返回 `Access-Control-Allow-Private-Network: true`，服务端无需再改。）
> 想彻底不折腾这一套，请用**方案 ①**。

优点是零依赖、不受任何封锁影响；代价是**只有你自己开着脚本时能用**，且每个浏览器都要单独授权一次。

### 怎么确认是"被墙"而不是"地址写错"

```bash
nslookup 你的worker名.你的子域.workers.dev      # 看是不是 Facebook/Twitter/Dropbox 等无关 IP
curl -v https://你的worker名.你的子域.workers.dev   # 看是不是 TCP 通、TLS 被 reset
```

前端「测试连接」第 1 步也会自动区分三种失败：**连不上（网络）** / **能连上但读不到（CORS）** /
**连上了但不是我们的脚本（装错）**，并给出对应处理建议。

---

---

## 九、可选环境变量（Worker）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ALLOWED_ORIGINS` | `*` | 允许的来源白名单，逗号分隔 |
| `MAX_TOKENS_CAP` | `8192` | 单次请求 `max_tokens` 上限 |
| `MAX_BODY_BYTES` | `524288` | 请求体上限（字节） |
| `RATE_LIMIT_PER_MIN` | `60` | 每 IP 每分钟请求上限（尽力而为） |
| `ALLOW_SERVER_KEY` | `false` | 设为 `true` 时允许用服务端密钥（你自己付费） |
| `SERVER_DEEPSEEK_KEY` / `SERVER_QWEN_KEY` | 无 | 服务端密钥，仅上一条为 true 时生效 |

---

---

## 十、安全注意事项

1. **密钥零存储**：`apiKey` 只存在于页面 JavaScript 内存变量 `state.apiKey` 中，
   不写 `localStorage` / `sessionStorage` / Cookie / IndexedDB，刷新即消失（已由自动化测试断言）。
2. **不要用别人的代理**：Key 会随请求经代理转发，代理方理论上可见。只填自己部署的 Worker。
3. **用限额 Key**：在服务商控制台设置消费上限，用完即轮换/销毁；不要用主账号高权限 Key。
4. **收紧白名单**：正式上线一定要设置 `ALLOWED_ORIGINS`，否则任何人都能白嫖你的 Worker 做转发。
5. **限流是尽力而为**：Worker 免费版的 Map 限流不跨机房共享，只防手滑连点。要真正防刷请用
   Cloudflare WAF 的 Rate Limiting Rules，或改用「服务端密钥 + 严格白名单 + 每日预算告警」。
6. **XSS 防护**：AI 返回内容全部先 HTML 转义再渲染（`esc()`），Markdown 渲染器不输出
   原始 HTML，因此模型输出无法注入脚本。
7. **隐私**：粘贴的代码和题目会发送给对应的 AI 服务商，不要提交涉密或含个人隐私的代码。

---

---

## 十一、免责声明

本项目为纯静态教学演示网站，仅供学习参考。AI 生成内容可能存在错误、过时语法或不被考试认可的
写法，**请以编译器运行结果、教材与考试大纲为准**。API 调用产生的费用由使用者账号承担。
因使用本网站造成的任何直接或间接损失（包括但不限于 API 费用、作业/考试成绩影响），
作者不承担任何责任。使用即表示已知悉并接受《API 设置》页的完整免责声明。

---
