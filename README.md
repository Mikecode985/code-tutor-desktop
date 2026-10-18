# CodeTutor · 编程学习助手（开源版 · 含 Windows 桌面版）

<p align="center">
  <img src="docs/screenshots/logo.png" width="88" alt="CodeTutor">
</p>

<p align="center">
  <b>单文件静态站点 · AI 编程教学 · 四档考试级练习 · 学习知识库 · 多格式文档阅读器（含扫描件 OCR）</b><br>
  <sub>Python / C / C++ ｜ 界面 Apple HIG × 贵阳城市意象 ｜ 数据全部留在本机</sub>
</p>

<p align="center">
  <a href="https://code-tutor-site.pages.dev"><img src="https://img.shields.io/badge/在线体验-code--tutor--site.pages.dev-2f6d63?style=flat-square" alt="在线体验"></a>
  <img src="https://img.shields.io/badge/HTML%2FCSS%2FJS-单文件-5fb3a1?style=flat-square" alt="技术栈">
  <img src="https://img.shields.io/badge/Cloudflare-Pages%20%2B%20Functions-f38020?style=flat-square" alt="Cloudflare">
  <img src="https://img.shields.io/badge/Windows-桌面版-0078d4?style=flat-square" alt="桌面版">
  <img src="https://img.shields.io/badge/license-MIT-34c759?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/tests-476%20passing-34c759?style=flat-square" alt="Tests">
  <a href="https://github.com/Mikecode985/code-tutor-desktop/actions/workflows/ci.yml"><img src="https://github.com/Mikecode985/code-tutor-desktop/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="docs/screenshots/00-hero.png" width="820" alt="首页">
</p>

---

## ✨ 这个项目是什么

本仓库是 CodeTutor 的**开源版本**：既包含可直接部署的**单文件静态网页**（`index.html` 内联全部
HTML/CSS/JS，零构建、零后端），也包含把它打包成 **Windows 桌面软件**（Electron + 一键安装包）的
全部工程与测试。你可以只部署网页，也可以直接构建安装包发给别人用。

- **不需要安装环境**：没有 npm、没有打包步骤，双击 `index.html` 就能用
- **不需要服务器**：静态托管即可（Cloudflare Pages / GitHub Pages / 任意静态空间）
- **不需要别人的 Key**：AI 请求走你自己填的 Key，且可以「浏览器直连服务商」（实测 100~300ms）
- **数据不上传**：对话、进度、掌握度存 `localStorage`；API Key 只在内存里，关页即清

## 🎯 七个面板

| 面板 | 能做什么 |
| --- | --- |
| **对话** | 流式 AI 对话、多轮上下文、历史记录（本地保存）、Markdown 渲染、代码块一键复制 |
| **代码助手** | Bug 诊断 / 代码讲解 / 修复优化 / 易错点，四种任务模板；CodeMirror 编辑器（Python · C · C++） |
| **练习** | **出题 → 作答 → 批改** 三步闭环：按**四档难度规范**（基础 / 计算机二级 / CSP-J / 蓝桥杯国赛级）出题，**出题绝不泄露答案**，批改产出得分环 + 逐项评分 + 漏洞清单 |
| **学习知识** | 四档 × 25 个知识点模块（要点 / 易错点 / 考法 / 语言差异 / 示例代码），标记掌握、一键「练这个知识点」 |
| **实用工具** | **多格式文档阅读器**：Markdown / TXT / PDF / EPUB / DOCX / 代码 / CSV / JSON，多文件列表 + 章节目录 + 原文/AI 提炼双视图 + **导出 Markdown**；**扫描版 PDF 支持 OCR**（AI 视觉 / 本地 Tesseract 双引擎） |
| **学习进度** | 对话轮数、练习次数、批改趋势图、掌握度、导出/导入 JSON 备份 |
| **API 设置** | 服务商与模型、**经代理 / 直连服务商**、视觉模型独立配置、两步自检（含代理身份校验、CORS 预检） |

### 几个用心的地方

- **出题不显示答案**：题目 JSON 契约里根本没有答案字段，答案是批改时由模型独立判断
- **选择题批改带选项**：批改请求会把 A/B/C/D 原文发过去，并禁止模型以"无样例"为由判 0 分
- **OCR 双引擎**：有视觉模型走 AI；DeepSeek / 没配 Key 时自动回落到浏览器内的 Tesseract（不消耗 API），AI 失败还会自动降级
- **按页选择**：`1-3,5,8-10` 表达式 + 页格勾选，OCR 与导出都只处理选中的页
- **9 套贵阳主题**：林城 / 甲秀 / 树谷 / 侗蓝 / 青岩 / 阳明 / 九门 / 三语 / 樱花，默认按季节自动切换，深浅色各自成对
- **UI 遵循 Apple HIG**：系统字体、hairline 分隔线、分组卡片、玻璃拟态、单一强调色、SF Symbols 风格图标（21 个内联 SVG）
- **移动端**：≤760px 自动切换底部标签栏，图表与编辑器都做了触摸适配

## 🚀 快速开始

### 方式一：直接用线上版

打开 <https://code-tutor-site.pages.dev> → 【API 设置】填自己的 Key → 开始用。
（线上版已部署同源 `/api/chat` 代理，访客零配置）

### 方式二：本地打开

```bash
git clone https://github.com/Mikecode985/code-tutor-site.git
cd code-tutor-site
# 双击 index.html，或任意静态服务器：
npx serve .
```

> 本地 `file://` 打开时没有同源代理，请到【API 设置】把连接方式切成**「直连服务商」**。

### 方式三：部署你自己的站点（Cloudflare Pages）

```bash
# 让 Pages 自动识别 functions/ 目录（同源代理，推荐）
npx wrangler pages deploy . --project-name=你的项目名
```

或直接在 Cloudflare 控制台连 GitHub 仓库，构建命令留空、输出目录填 `/`。

> 想让别人也能用，请部署**你自己的** `functions/api/chat.js`；
> 也支持自建 Worker（`cloudflare-proxy.js`）与本地代理（`local-proxy.mjs`），见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 方式四：Windows 桌面版（一键安装）

```powershell
cd desktop
npm install          # 首次安装 Electron 与打包工具
npm run bundle       # 产出 dist\一键安装-Windows\ 与免安装版
```

把 `desktop/dist/一键安装-Windows/` 整个文件夹发给使用者，**双击「安装 CodeTutor.cmd」**即可：

解压到 `%LOCALAPPDATA%\Programs\CodeTutor` → 建桌面/开始菜单快捷方式 → 注册卸载入口 → 自动启动。
**不需要管理员权限**，卸载走「设置 → 应用」。细节见 [desktop/README.md](desktop/README.md)。

## 🔑 配置 AI

| 字段 | 建议值 | 说明 |
| --- | --- | --- |
| 服务商 | 通义千问 / DeepSeek | 用哪家就填哪家的 Key |
| 模型名称 | **`qwen-plus`** / `deepseek-chat` | 文本任务（对话、出题、批改、提炼） |
| 视觉模型 | **`qwen-vl-max`** | **只给图片 OCR 用**；留空自动选 |
| 连接方式 | **直连服务商（最快）** | 浏览器直接打服务商；不受 Cloudflare 回源波动影响 |
| 代理地址 | `/api/chat` | 仅在「经代理」模式下需要 |

⚠️ **三个最常见的坑**（都会表现为"AI 不工作"）：

1. **把模型名称填成 VL 模型**（`qwen-vl-max`）→ 出题要输出 7000 tokens，而 VL 上限约 1500 → `400 max_tokens is invalid`。
   正确做法：模型名称用 `qwen-plus`，视觉模型单独填。程序已按模型自动限流兜底。
2. **通义千问"不稳定"** → 多半是 Cloudflare 边缘回源抖动（实测 0.5~20s）。切「直连服务商」即可（实测 96ms）。
3. **选择题批改被判 0 分** → 曾经的 bug（批改没带选项），已修复并加了回归测试。

更多排查见 [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)。

## 📸 界面预览

| 对话 | 出题 | 作答 |
| --- | --- | --- |
| ![](docs/screenshots/01-chat.png) | ![](docs/screenshots/02-practice.png) | ![](docs/screenshots/03-answer.png) |

| 批改评分 | 学习知识 | 文档阅读器 |
| --- | --- | --- |
| ![](docs/screenshots/04-score.png) | ![](docs/screenshots/05-knowledge.png) | ![](docs/screenshots/06-reader.png) |

| 学习进度 | 深色模式 | 皮肤系统 |
| --- | --- | --- |
| ![](docs/screenshots/07-progress.png) | ![](docs/screenshots/08-dark.png) | ![](docs/screenshots/09-skins.png) |

<p align="center"><img src="docs/screenshots/10-mobile.png" width="300" alt="移动端"></p>

## 🧱 项目结构

```
code-tutor-site/
├─ index.html              应用本体（单文件：HTML + CSS + 全部 JS，约 7000 行）
├─ functions/api/chat.js   Cloudflare Pages Function：同源 AI 代理（推荐）
├─ cloudflare-proxy.js     自建 Worker 版代理（备选）
├─ local-proxy.mjs         本机 Node 代理（http://127.0.0.1:8787，仅自用）
├─ desktop/                Electron 桌面版 + 一键安装包
│  ├─ main.js / preload.js 主进程与预加载（contextIsolation + sandbox）
│  ├─ scripts/sync.js      复制页面并把 CodeMirror 本地化（断网可用）
│  ├─ scripts/make-bundle.js  一条命令产出安装包
│  └─ installer/           安装脚本与 NSIS 脚本
├─ tests/                  10 套自动化测试（476 项断言）
├─ docs/                   架构设计 / 部署 / 故障排查 / 截图
└─ README.md
```

无需安装依赖即可运行；只有跑测试（`jsdom`）和构建桌面版（Electron）需要 `npm install`。

## 🧪 测试：10 套 · 476 项断言

| 套件 | 断言 | 需要 | 覆盖 |
| --- | --- | --- | --- |
| `syntax-check.mjs` | 5 | node | 内联脚本与代理文件的语法 |
| `worker.test.mjs` | 22 | node | Worker 代理：CORS、密钥传递、白名单、错误包装 |
| `alt-deploy.test.mjs` | 28 | node | Pages Function + 本机代理：**多模态 content 原样转发**、429 重试、超时、模型不支持图片的提示 |
| `e2e.mjs` | **137** | jsdom | 前端全链路：七个面板、练习三步、批改解析、知识面板、连接方式、选择题批改 |
| `reader.mjs` | 56 | Chrome | 文档阅读器：真实拖入、手写 EPUB、PDF OCR 与降级、按页选择、隐私 |
| `browser.mjs` | 18 | Chrome | 真实渲染、移动端、长对话滚动回归 |
| `live-verify.mjs` | 39 | Chrome + 线上 | 线上同源代理与真实链路 |
| `feature-audit.mjs` | 109 | Chrome | 全功能完整性审计（A 阶段真实链路 + B 阶段 AI 桩） |
| `desktop-package.mjs` | 45 | node | 桌面版产物：asar 内容、安装包完整、脚本编码 |
| `desktop-page.mjs` | 16 | Chrome | 以 `file://` 加载打包后的页面 |

```bash
cd tests
npm install jsdom        # 仅 e2e 需要
node syntax-check.mjs    # 秒级，随手跑
node worker.test.mjs
node alt-deploy.test.mjs
node e2e.mjs             # 137 项
node desktop-package.mjs # 需要有 desktop/dist 产物
```

GitHub Actions 会自动跑「语法检查 + 代理测试 + e2e」，见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。
需要浏览器与真实网络的套件（audit / reader / browser / live）请在本机跑，用法见 [tests/README.md](tests/README.md)。

## 🔒 隐私与安全

- **API Key**：只存在内存，不写 `localStorage` / Cookie / 服务器；关闭页面即清除
- **学习数据**：`codetutor.*` 前缀存本地浏览器；可在【学习进度】导出 JSON 备份
- **文档阅读器**：文件内容**只在浏览器内存里解析**，刻意不落盘（有自动化断言守住）；只有点「AI 提炼」才会把节选发给你配置的模型
- **OCR**：图片在你本机渲染；本地引擎全程不联网，AI 视觉只发给你的模型
- **桌面版**：`contextIsolation` + `sandbox`，不开 Node 能力给页面，外链一律交给系统浏览器
- **代理**：只转发白名单字段（`model/messages/temperature/max_tokens/stream`），不落盘、不记日志

## 🗺️ Roadmap

- [ ] 文档阅读器：PP-DocLayout 版面分块后逐块 OCR（提升多栏/表格质量）
- [ ] 练习：错题本与按知识点自动组卷
- [ ] 知识库：可导入自己的 Markdown 笔记并与出题联动
- [ ] 桌面版：macOS / Linux 打包
- [ ] i18n：英文界面

## 🤝 贡献

欢迎 Issue 与 PR。提交前请：

1. 跑 `node tests/syntax-check.mjs` 与 `node tests/e2e.mjs`（需 `jsdom`）；
2. 改动界面请附截图；改动逻辑请说明"怎么验证的"；
3. 项目原则：**单文件、零构建、数据本地优先、不引入运行时后端依赖**。

## 📄 License

[MIT](LICENSE) © 2026 Mikecode985

## 🙏 致谢

- 主题设计参考 **dsh-client-ui-guiyang-theme v0.5.0**（贵阳 · 多彩主题）的配色与城市意象
- 扫描件 OCR 的"无 API 兜底"思路借鉴 [universal-reader](https://universal-reader.pages.dev/)
- [CodeMirror 5](https://codemirror.net/5/)、[pdf.js](https://mozilla.github.io/pdf.js/)、[Tesseract.js](https://tesseract.projectnaptha.com/)、[Electron](https://www.electronjs.org/)
- 贵州：甲秀楼、南明河、黔灵山、青岩古镇、阳明心学 —— 「知行合一，协力争先」

---

<p align="center"><sub>如果这个项目帮到你，欢迎点个 ⭐ Star</sub></p>
