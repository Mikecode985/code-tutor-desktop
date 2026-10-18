# 自动化测试说明

这些脚本用于交付前的验证与故障定位，**不影响网站运行**，可以整体删除。

| 脚本 | 需要什么 | 断言数 | 覆盖内容 |
| --- | --- | --- | --- |
| `worker.test.mjs` | 无（纯 Node，import 真实 Worker 模块） | 22 | 代理转发逻辑、密钥来源、错误分级、CORS、限流参数 |
| `alt-deploy.test.mjs` | 无（纯 Node，含真实起本机代理做端到端） | 20 | Pages Functions 同源版 + `local-proxy.mjs` 本机版 |
| `e2e.mjs` | `npm i jsdom` | 116 | 前端全流程、安全断言、降级路径、同源路径、访客零配置、故障复现、**对话**、**学习进度**、**重开恢复**、**容量保护**、**贵阳皮肤系统** |
| `browser.mjs` | headless Chrome + CDP | 17 | 真实 CodeMirror、真实排版/像素、移动端、预览图 |
| `failure-repro.mjs` | headless Chrome + CDP | 6 | 复现"Worker 装错脚本"故障，验证新版自检输出并截图 |
| `live-verify.mjs` | headless Chrome + CDP + 可访问线上域名 | 29 |
| `feature-audit.mjs` | headless Chrome + CDP + 线上域名 | 104 | **全功能完整性审计**：A 阶段走真实链路、B 阶段注入 AI 桩，逐项覆盖全部用户功能 | **对生产域名**跑完整链路：访客零配置、两步自检、**对话链路**、本地保存 |
| `feature-preview.mjs` | headless Chrome + CDP | — | 生成对话/进度/多皮肤/彩蛋栏/练习板块预览图 |
| `lna-diagnose.mjs` | headless Chrome + CDP | — | 诊断 Chrome `Local Network Access` 拦截本机地址 |

## 1. `worker.test.mjs`

用桩替换全局 `fetch` 捕获"转发给上游的请求"，重点验证：

- `GET /` 返回 `{"ok":true,"service":"codelearn-proxy","version":"1.1.0"}` + `X-Proxy` 头，且**不消耗上游请求**
- **`body.apiKey` 必须被转发成 `Authorization: Bearer`**（这正是"装了老脚本"故障的分水岭）
- `Authorization` 头里的 Key 也能被接受（兼容另一种客户端写法）
- 上游 401 → 原样透传状态码，并带 `stage=upstream` / `key_source` / `hint`（用于区分"代理坏"与"Key 被拒"）
- 缺 Key 401 `stage=proxy`、未知 provider 400、非法 JSON 400、空 messages 400、非白名单 Origin 403、OPTIONS 204
- `max_tokens` 被压到 `MAX_TOKENS_CAP` 以内；`apiKey` 不会被塞进上游请求体

```bash
node worker.test.mjs      # 期望：全部 22 项通过 ✅
```

## 2. `e2e.mjs`

jsdom 加载 `index.html`，伪造 SSE 流式/非流式响应，跑通四个面板；含无 CodeMirror 的降级路径与
**故障复现用例**（模拟"代理地址上跑的是别的脚本，GET/POST 都返回 401 纯文本"）：

- 语言联动（徽标 + CodeMirror 语法模式）、Markdown 渲染（标题/列表/表格/引用/代码块）、一键复制
- 批改评分 JSON 解析 → 评分卡、总分、进度条比例；报告中的裸 JSON 被隐藏
- **安全断言**：`apiKey` 不写入 localStorage、存储对象里没有 `apiKey` 键
- **故障复现**：自检能识别"该地址不是本项目的 Worker"，原样展示返回内容并给出排查指引

```bash
npm i jsdom
node e2e.mjs              # 期望：全部 43 项断言通过 ✅
```

## 3. `browser.mjs`

CDP 驱动 headless Chrome，验证 jsdom 覆盖不到的真实渲染：

- CodeMirror 从 CDN 真实加载并应用语法高亮
- 桌面 1440px / 手机 390px **横向溢出 = 0px**
- 评分条**真实像素宽度**与得分比例一致（100/80/88/70%）
- 评分圆环中心**最顶层元素**是分数文字（防被 `::after` 白圆遮盖）
- 「测试连接」两步流程：① 代理自检通过 + 版本号 ② 模型连通性正常
- 生成 `preview-1~4.png`

```bash
chrome --headless=new --remote-debugging-port=9222 --hide-scrollbars \
       --user-data-dir=/tmp/ct about:blank
node browser.mjs          # 期望：17 项全通过 ✅
```

## 4. `failure-repro.mjs`

本地起两个服务：`8899` 提供页面、`8898` 精确模拟"装错脚本的 Worker"（401 + 纯文本
`Authentication Fails (governor)`，无 `X-Proxy` 头）。然后驱动新版前端点「测试连接」，
验证诊断是否准确，并生成 `preview-5-proxy-check.png`。

> 用 mock 的原因：本机沙箱里的 headless Chrome 连不上 `workers.dev`（`ERR_CONNECTION_TIMED_OUT`）；
> 对真实地址的行为结论由 Node 直连探针给出。

```bash
node failure-repro.mjs    # 期望：6 项判定全 PASS，并生成截图
```

## 5. `alt-deploy.test.mjs`

同时验证两个"绕开 workers.dev"的部署版本（应对 DNS 污染 / SNI 阻断）：

- **`functions/api/chat.js`（Pages Functions 同源版）**：身份标识 `deploy=pages-function`、
  `body.apiKey → Authorization: Bearer`、上游 401 分级、参数校验、OPTIONS 204、**SSE 流式透传**、
  `max_tokens` 上限
- **`local-proxy.mjs`（本机版）**：真实 `spawn` 起进程 → 健康检查 `deploy=local-node`、
  CORS 回显来源、缺 Key 401、OPTIONS 204，并用一个无效 Key 真实打通 DeepSeek
  （得到上游 401 而非网络错误，证明本机网络可直连 `api.deepseek.com`）

```bash
node alt-deploy.test.mjs   # 期望：全部 20 项通过 ✅
```


## 6. `live-verify.mjs`

对**生产域名** `https://code-tutor-site.pages.dev` 做真实浏览器端到端验证（10 项判定）：

- 内联 JS 已执行、前端是新版（含同源支持 + 两步自检按钮）
- **访客零配置**：全新 profile 打开页面，代理地址自动变为 `/api/chat`
- 只填一个假 Key 点「测试连接」→ 第 1 步自检通过（`pages-function` · 同源）；
  第 2 步拿到 DeepSeek 的真实 401 回执（`****fake is invalid`）→ 证明全链路通畅
- 全程无 `Failed to fetch`、控制台无 CORS / loopback(LNA) 错误

```bash
chrome --headless=new --remote-debugging-port=9222 --hide-scrollbars \
       --user-data-dir=/tmp/ct about:blank
node live-verify.mjs
```

## 7. `lna-diagnose.mjs`

诊断「公网 https 页面 → 本机 127.0.0.1」被 Chrome 拦截的问题（Chrome 147+ 的 Local Network Access）。
会打印浏览器原始报错，并显示对 `127.0.0.1` 的请求流水（`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`）。
`--disable-features=LocalNetworkAccessChecks` 可用来做对照实验。


## 8. 关于新增功能的测试覆盖（`e2e.mjs` 第 51~80 项）

- **对话**：默认落在对话页、按语言定制快捷提问、新建/切换/改名/删除会话、发送后用户+AI 双气泡、
  AI 回复按 Markdown 渲染（代码块 + 列表）、标题自动取自首条提问、历史写入 localStorage、
  **历史里不含 API Key**、对话轮数计入进度
- **学习进度**：批改后写入分数/语言/题目/代码/扣分明细、统计卡 8 张、平均分与最高分、连续学习天数、
  趋势 SVG 折线与数据点、按语言统计、批改历史展开明细、**「重新批改」把题目代码带回批改页**
- **持久化**：预置 localStorage 后重新装载页面（`boot(..., seed)`），验证历史与进度都恢复
- **容量保护**：预置 300 条消息的会话 → 载入后裁到 120 条；非法分数（9999）被过滤掉

## 9. 皮肤系统测试（`e2e.mjs` 第 89~98 项）

- 注入 9 套贵阳皮肤（id 齐全）、样式表同时含浅色与深色两套令牌、`html` 上有 `data-skin` 标记
- 节令默认皮肤合法（春樱花 / 夏林城 / 秋九门 / 冬甲秀）
- 切换「数谷蓝调」后令牌里确实出现该皮肤的主色 `#0a66c2`（浅）/ `#5b93ff`（深）
- 通过弹窗点选皮肤：9 张卡片、「使用中」标记、写入 `codetutor.skin.v1`、顶栏按钮文案同步、可关闭面板

## 10. 彩蛋栏测试（`e2e.mjs` 第 99~103 项 / `live-verify.mjs`）

- 默认展示、文案含「代码写累了 / 贵州发展吧 / 休息一下吧」
- 按钮指向贵州发展吧、`target=_blank` 且带 `rel=noopener`
- 收起后隐藏并记住状态（`codetutor.eggbar.v1` = 0），页脚「显示彩蛋栏」可恢复（= 1）

## 11. 练习板块测试（`e2e.mjs` 第 22~40 项 / `browser.mjs` / `live-verify.mjs`）

- **出题**：点生成后自动进入「作答」步骤；题面渲染出「样例 / 数据范围 / 评分点」；
  **题面不得出现「答案 / 解析」字样、不得残留 JSON 契约**；难度规范提示随档位切换（二级 / 蓝桥杯级）
- **作答**：题面里的模板代码已注入答题编辑器；编辑器顶部标出当前题号与题型；未作答直接提交会被拦下；多题可用题号切换
- **批改**：「提交并批改」后进入「批改」步骤并渲染评分卡；总分解析为 85；评分项进度条按比例填充（真实像素宽度 100/80/88/70%）；
  样例通过与漏洞摘要渲染；报告不再展示裸 JSON 评分块；「回去改一改」能回到作答步骤
- **题库**：不消耗 API 即可出题（离线），字段与 AI 出题契约一致
- **进度联动**：批改结果写入学习进度，且「重新批改」把题目与代码带回练习的作答步骤
- **回归**：`answerEditor` 未声明曾导致 init 中断（连带自动探测代理失效 → 对话历史不落盘），现已由「对话历史已写入 localStorage」等断言守住

## 12. 全功能完整性审计（`feature-audit.mjs`，96 项）

对**线上生产域名**跑两阶段审计，专门回答"功能是否完整、有没有悄悄坏掉"：

**A 阶段（不干预网络，验证真实链路）**
- A1 全局结构与导航：5 个标签 / 5 个面板 / 无独立 quiz·grade 面板 / 默认页 / Alt+1~5 / hash 直达 / hashchange 前进后退
- A2 编程语言联动：分段控件、四处徽标联动、CodeMirror 语法模式（用真实 `getOption('mode')`）
- A3 外观与皮肤：三态循环、令牌注入、9 套皮肤点选切色并落盘、皮肤面板开关、`theme-color` meta
- A4 快捷键帮助弹窗：`?` 打开、6 条快捷键、Esc 关闭、按钮关闭
- A5 彩蛋栏：文案三要素、按钮 href/target/rel、收起持久化、页脚恢复
- A6 学习进度（空态）：8 张统计卡、趋势组件、语言统计、导出/导入/清空入口、空态引导文案
- A7 API 设置：四个配置项、服务商切换联动、Key 显隐、免责声明、自动探测同源代理、**真实两步自检**（第 1 步识别本项目代理、第 2 步如实报告上游 401）
- A8 安全：本地存储无 `sk-`、刷新后 Key 输入框为空、代理仍自动就位
- A9 布局与稳定性：1440 / 390 无横向溢出、全程零未捕获异常与零 CORS/脚本错误

**B 阶段（注入确定性 AI 桩，验证所有需要模型的功能）**
- B1 对话：空态快捷提问、新建、流式回复、Markdown（代码块/列表/引用）、标题自动命名、消息操作、搜索过滤、历史落盘、导出、滚动到底部
- B2 代码助手：4 个快捷动作、上传入口与示例、行数/字数统计、流式 + Markdown（代码块/表格/列表/引用）、代码块复制写剪贴板、清空、使用次数入进度
- B3 练习·出题：四档规范提示、五种题型、数量档、内置题库入口、**生成后自动进入作答**、题面三要素、**不泄露答案**、模板代码进编辑器、题号题型标注、未作答拦截
- B4 练习·批改：进入批改步骤、评分卡、总分 85、4 条评分条按比例填充、样例与漏洞、报告 Markdown、无裸 JSON、严格模式、回去改一改 / 再出一套、记录入进度
- B5 内置题库：四档都能离线出题并进入作答；题库题目的代码同样进答题区
- B6 进度（有数据）：统计卡、趋势折线与数据点、语言统计、历史展开、一键带回作答、范围切换、导出触发下载
- B7 持久化：刷新后对话 / 进度 / 皮肤仍在；编辑器与面板数量稳定

**踩坑记（写这类审计脚本必须注意的）**
1. **只改 hash 属于同文档跳转**：内联脚本不会重跑，`Page.addScriptToEvaluateOnNewDocument` 也不生效 —— 必须给每次导航加不同的 query 参数强制整页加载，否则会出现"桩没装上、AI 请求真打线上返回 401"的连锁假失败。
2. `chk(表达式, 期望)` 这类封装**不要把已算好的值再当表达式求值**：`'true|true'` 在 JS 里是按位或，会变成 `1`。
3. 桩里**不要**清 `localStorage`，否则"刷新后仍在"的持久化用例必假失败。
4. 真实 CodeMirror 没有 `opt_mode`（那是 jsdom 替身的属性），要用 `getOption('mode')`。
5. hashchange 是异步事件，改 hash 后要等一拍再断言。

## 13. 学习知识测试（`e2e.mjs` / `feature-audit.mjs` / `live-verify.mjs`）

- 四档难度都能渲染出知识模块（基础 6 / 二级 7 / 竞赛 6 / 王者 6）
- 每个模块都含「要点 / 易错点 / 典型考法 / 当前语言提示」；语言提示跟随顶部语言选择器切换（Python ↔ C ↔ C++）
- 折叠展开：默认展开首个模块，点标题可再展开一个
- 「标记为已掌握」→ 出现徽标、进度条按比例走动、写入 `localStorage`（`codetutor.kb.v1`），再点可取消；记录里不含任何密钥
- 学练闭环：「练这个知识点」/「按本档去练一套」会切到【练习】并预设好难度档位与知识点关键字
- 全功能审计里还额外验证了「刷新后掌握记录仍在」

## 14. 对话滚动回归（`browser.mjs` / `feature-audit.mjs` / `scroll-diag.mjs`）

**曾经的真实故障**：桌面端长对话无法向下滚动，超出部分是直接被裁掉的。

根因是**滚动链断了**——`.chat-shell` 是 `height:min(74vh,780px)` 的 grid 容器，
但 grid 子项 `.chat-main` 默认 `min-height:auto`，内容把它撑到 2723px（容器只有 666px），
于是 `#chatBody` 的 `scrollHeight === clientHeight`，内部永远不出现滚动条。
修复：`grid-template-rows:minmax(0,1fr)` + 逐层 `min-height:0`，只在 `#chatBody` 这一层允许滚动。

两道防线：
- `feature-audit.mjs`：**几何断言** —— `.chat-main` 高度必须 ≤ `.chat-shell`、`#chatBody` 为 `overflow:auto`、`.chat-main` 的 `min-height` 为 `0px`；
- `browser.mjs`：**真实滚动断言** —— 往对话区追加 14 条长消息后，`scrollHeight - clientHeight > 200` 且 `scrollTop` 能设到最大值。

排障工具：`node scroll-diag.mjs`（需先起 headless Chrome 9222）会打印整条滚动链的
`clientHeight / scrollHeight / overflowY / minHeight`，并实际设置一次 `scrollTop` 判断"能不能滚"。

**顺带修的第二个问题**：流式回复结束后 `renderChatAll()` 重排了 DOM 高度，但没有再贴底，
导致最后一条消息的底部（含操作按钮）被切掉一点。现在收尾会按"用户是否还贴着底部"再滚一次；
代码助手与批改的终稿渲染后也各补了一次 `scrollBottom()`。

## 15. 套件总数

| 套件 | 断言 |
| --- | --- |
| `worker.test.mjs` | 22 |
| `alt-deploy.test.mjs` | 28 |
| `e2e.mjs` | 116 |
| `browser.mjs` | 18 |
| `failure-repro.mjs` | 6 |
| `live-verify.mjs` | 29 |
| `feature-audit.mjs` | 105 |
| **合计** | **316** |

## 16. 文档阅读器测试（`reader.mjs`，53 项）

对线上站点用真实 Chrome 跑，**用 DataTransfer 真实模拟拖入文件**：

- 面板：7 个标签、拖拽区/文件选择/空态齐全、未打开文件时按钮禁用
- Markdown：拖入 `.md` → 文件列表出现、名称与格式正确、标题/列表/代码块渲染、字数统计、按钮解禁
- 字号：A+ 后 `fontSize` 真的变大
- TXT：拖入 → 切换为该文件、正文走等宽 `<pre>`
- **EPUB**：测试里用**手工构造的 ZIP**（stored 方式，不压缩）合成一本两章的书 → 解析出 2 章目录 + 2 个正文段落、显示节数
- 不支持格式：给出提示且不加入列表
- AI 提炼：桩（stub）注入后点「AI 提炼」→ 切到 AI 视图、渲染出 ≥4 个标题、含「一句话概要 / 关键概念 / 可延伸的问题」
- 导出 Markdown：`URL.createObjectURL` 被调用（触发下载）
- 复制全文：写入剪贴板
- **隐私**：localStorage 三个键里都搜不到文件特征串
- 清空：列表归零、按钮回到禁用、无未捕获异常

**按页选择（9 项）**：范围表达式 `1` / `1-2` 应用、全选、全不选、反选、展开页格并点击切换选中、
未选中页在正文中淡出、导出的 Markdown 抬头写明页码范围、取消「含 AI 提炼」后导出只剩原文。

**本地 OCR 回落（8 项）**：测试里注入了**假的 `window.Tesseract`**（真实 WASM + 中文语言包太大、且 CDN 不稳），
断言：DeepSeek/无 Key 时**自动改用本地 OCR** 且 **AI 请求数完全不变**、引擎三段控件齐全、
本地引擎下出现语言包选择且默认 `chi_sim+eng`、识别结果并入正文并标注**「本地识别」**、
强选「AI 视觉」但无视觉模型时提示会诚实说明已回落本地。

**扫描版 PDF + AI-OCR（11 项）**：测试里**手写了一个最小可解析 PDF**（含 xref 表），拖入后：
PDF 解析成功 → 出现「扫描版识别」条 → 非视觉服务商（DeepSeek）点识别会给出指引且**不发请求** →
切到 `qwen` + `qwen-vl-max` 后识别，断言 OCR 请求体里确实带了 `data:image/jpeg;base64,` 的 `image_url` →
识别文字并入正文并打上「AI 识别」标记 → 提示变成「已并入正文」→ 导出时标注 OCR。

> 踩坑记：① 桩脚本里 `__mkPdf` 的 `\n` 在模板字符串中会被当成**真实换行**，导致整段桩语法错误、所有拖入静默失败；
> ② 预加载 pdf.js 时要**预先注入** `window.__frPdfjs`，否则单次 CDN 抖动就会让 PDF 用例失败（应用内已有三路 CDN 回退）。

> 写这个测试踩的两个坑：① 手工构造 ZIP 时把 2 字节字段写成了 4 字节（本地头必须 30 字节、中央目录必须 46 字节），导致解析失败；
> ② 拖入是**异步解析**，断言要等一拍再读文件列表。

## 17. 套件总数

| 套件 | 断言 |
| --- | --- |
| `worker.test.mjs` | 22 |
| `alt-deploy.test.mjs` | 28 |
| `e2e.mjs` | 127 |
| `reader.mjs` | 53 |
| `browser.mjs` | 18 |
| `failure-repro.mjs` | 6 |
| `live-verify.mjs` | 39 |
| `feature-audit.mjs` | 109 |
| **合计** | **402** |

## 18. 代理层新增测试（`alt-deploy.test.mjs` A6~A9）

对着 `functions/api/chat.js` 的 handler 直接打桩，覆盖三个曾导致"通义千问不稳定"的根因：

- **A6 多模态**：`content` 数组原样转发（`text` + `image_url(data:image/jpeg;base64,…)`），
  非 `data:image` / `https` 的图片 URL 被丢弃，响应头带 `X-Images`
- **A7 重试**：第一次 429、第二次 200 → 整体 200 且 `X-Upstream-Attempts=2`
- **A8 超时**：上游永不响应 → `504` + 可操作提示（用 `env.UPSTREAM_TIMEOUT_MS=120` 让测试跑得快）
- **A9 模型不支持图片**：用 `qwen-plus` 带图 → 400 且提示「改用 qwen-vl-max / 本地 OCR」

`live-verify.mjs` 另外加了 6 项线上断言：浏览器 CORS 预检能直连通义千问、直连切换与端点、直连状态徽标、
`X-Upstream-*` 诊断头、`X-Images=1`。

## 20. 选择题批改回归（`e2e.mjs` F2，6 项）

桩里新增一份**选择题题目 JSON**（4 个选项 + 内嵌 ```json 代码块），走完整链路：

1. 生成出题 → 作答区渲染出 **A~D 四个选项**，选项文本正确显示；
2. 选中 B → 提交作答；
3. 断言**批改请求**里带上了四个选项原文（`每次函数调用都会重新初始化为 0` / `只初始化一次` / `不能用于递归函数`）；
4. 断言批改要求里含「选项缺失」「判 0 分」这类**反拒评**约束（防止模型再以"无样例"为由判 0）；
5. 断言请求里带了学生所选（`答案：B`）；
6. 断言**纯选择题不再索要「参考标准代码」**。

> 踩坑记：① jsdom 里点 `<label class="opt">` 不会自动勾选内部 radio，得直接 `checked + dispatchEvent('change')`；
> ② 测试到这一步时配置可能被前面用例清掉，生成会被配置校验拦住 —— 需要先补 Key 与代理地址；
> ③ 切片停在「批改」步骤时 `#quizGenBtn` 不可用，要用「换一批」`#quizRegenBtn` 触发。

## 21. 桌面版打包产物（`desktop-package.mjs`，45 项，纯文件级，不需要 Electron）

- **同步后的页面**：`app/index.html` 存在、引用 `vendor/codemirror/*`、无残留 CDN、带打包标记；
  7 个 vendor 文件都在且体积合理
- **打包结构**：`win-unpacked` 里 `CodeTutor.exe` / `resources/app.asar` / `icudtl.dat` / dll 齐全
- **asar 内容**：含 `main.js`、`preload.js`、`app/index.html`、本地 CodeMirror、图标，且**不含 node_modules/dist**
- **一键安装包**：`安装 CodeTutor.cmd`（纯 ASCII）/ `install.ps1`（**必须带 UTF-8 BOM**，否则 PS 5.1 中文解析失败）/
  zip / icon.ico / 安装说明；zip 里确实有 exe 与 asar
- **主进程安全**：`contextIsolation: true` + `nodeIntegration: false`、外链走 `shell.openExternal`、
  单实例锁、窗口尺寸记忆、`--smoke` 自检
- **安装脚本要素**：`ExtractToDirectory` / `CreateShortcut` / `WScript.Shell` / 卸载注册表项

## 22. 桌面版页面（`desktop-page.mjs`，16 项，Chrome CDP 打开 `file://`）

用 Chrome 以 `file://` 打开 `desktop/app/index.html`（**这正是 Electron 的加载方式**），并注入与 preload 等价的
`window.__CODETUTOR_DESKTOP__`，断言：页面能加载、7 个标签、2 个 CodeMirror 来自**本地 vendor**、
无 CDN 引用、显示「桌面版」标签与标题、**默认代理自动填成绝对地址**、API 提示里写明桌面版、
9 套皮肤、彩蛋栏、知识面板、实用工具、localStorage 可用、**零未捕获异常 / 零脚本错误**。

> 这两个套件与 Electron 运行解耦：因为本次构建环境禁止创建内存映射文件，**Electron 二进制连 `--version` 都会崩溃**，
> 所以改用「文件级校验 + Chrome 加载同一份产物」来验证，属于环境限制而非应用缺陷。
