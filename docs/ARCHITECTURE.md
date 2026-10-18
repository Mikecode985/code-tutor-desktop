# 架构与设计说明

单文件静态应用（index.html 内联全部 HTML/CSS/JS）+ 可选 Cloudflare 代理函数。本文记录设计语言、皮肤系统、模块划分与关键实现取舍。

## 一、设计语言：Apple HIG × 贵阳

界面按 Apple 人机界面指南（HIG）重做了一遍，贵阳特色只出现在「讲故事」的地方，不干扰可用性。

**① 字体与层级（Apple 的系统感）**

- 字体栈：`-apple-system, BlinkMacSystemFont, "SF Pro Text", …, "PingFang SC", "Segoe UI", "Microsoft YaHei"`
  —— Mac 上是 SF Pro + 苹方，Windows 上自动落到 Segoe UI Variable + 微软雅黑，中英混排都不别扭。
- 全局 `letter-spacing:-0.011em`（标题 `-0.022em`），数字一律 `tabular-nums`，字号层级收敛为
  主文字 15 / 次文字 13.5 / 三级 12.5 / 说明 12，不再有十几种字号。

**② 材质与层次（而不是粗边框 + 大渐变）**

- 顶栏、弹窗遮罩、Toast、回到底部按钮都是**毛玻璃**：`backdrop-filter: saturate(180%) blur(20px)` + 半透明底色。
- 分隔一律用**发丝线**（`rgba(0,0,0,.055)` / 深色 `rgba(255,255,255,.065)`），卡片只留极淡投影。
- 页面底色 `#f5f5f7`、卡片纯白（深色 `#000` / `#1c1c1e`），靠**明度层次**而不是描边区分区域。

**③ 色彩：中性层固定，强调层由贵阳皮肤驱动**

| 层 | 来源 | 用途 |
| --- | --- | --- |
| 中性层 | Apple 系统灰（`#f5f5f7` / `#1d1d1f` / `#6e6e73` / `#86868b`…） | 背景、卡片、正文、次要文字、发丝线 |
| **强调层** | **贵阳 · 多彩主题的 9 套皮肤主色** | 主按钮、选中态、链接、用户消息气泡、图表、焦点光环 |
| 语义层 | Apple 系统色（绿 `#34c759` / 橙 `#ff9500` / 红 `#ff3b30`） | 通过 / 警告 / 错误，保证判读正确 |
| 装饰层 | 皮肤的暖色与金属色（`--gy-red` / `--gy-metal`） | 纹样与彩蛋栏的点缀 |

**④ 图标：不用 emoji，用 SF Symbols 那种线条图标**

全站 **21 枚内联 SVG symbol**（`<use href="#i-xxx">`），统一 `stroke-width:1.7`、圆头圆角、`currentColor`，
并跟着字号缩放（`width:1.15em`）——聊天/代码/靶心/书/图表/齿轮/铅笔/对勾/锁/火花/keyboard/礼物/太阳/月亮…
顶栏、标签栏、面板标题、帮助弹窗、彩蛋栏、按钮里的 emoji 全部换成了它们。
（原来那套 💬🔧🎯📚📈⚙️ 现在看起来就像"网页工具"，换成线条图标后才像系统 App。）

**⑤ 分组容器：靠底色分层，不靠描边**

卡片去掉边框与投影，只留 22px 圆角，靠 `#f5f5f7`（页面）/ `#fff`（卡片）的明度差分层——就是 iOS「分组列表」的做法；
分隔一律用发丝线。只有代码块保留一根 1px 发丝线，避免与输出区糊在一起。

**⑥ 标签栏：桌面端分段控件，手机端 iOS 底部标签栏**

- 桌面：一排 Apple 分段控件（灰轨道 + 白色滑块 + 细投影）；
- 手机（≤760px）：变成**固定底部标签栏**（毛玻璃 + 图标在上文字在下 + 选中项用强调色），
  `body` 预留 74px、`main` 预留 96px 避免遮挡；顶部工具栏收敛成一排横向滚动（iOS 工具栏做法）。
  > 实现要点：标签栏必须放在 `<header>` **之外**——`backdrop-filter` 会给 `position:fixed` 的子元素创建包含块，放在 header 里就跑不到屏幕底部了。

**⑦ 组件观感**

- 分段控件：原生 `select` 被 `enhanceSelect` 换成**灰轨道 + 白色滑块**的 Apple 分段控件；
- 标签栏：选中项是**白色药丸 + 细投影**；
- 弹窗：类 iOS Sheet（遮罩模糊 + `translateY(16px) scale(.97) → 1` 的弹性入场）；
- 通知：右上角**毛玻璃胶囊**（手机端自动落到底部）；
- 批改历史：从「一张张卡片」改成 **inset 分组列表**（发丝线分隔 + 悬停整行高亮）；
- 按钮/输入框：胶囊按钮（最小 40px 触控高度，手机 44px），输入框为**填充式**（无边框，聚焦才出现强调色光环），按下 `scale(.97)`；
- 对话气泡：用户侧＝强调色实底 + 右下角收角，AI 侧＝浅灰气泡 + 左下角收角（iMessage 观感）。

**⑤ 贵阳特色落点（都是细线条 SVG，不抢内容）**

| 位置 | 内容 |
| --- | --- |
| App 图标 | 甲秀楼三层飞檐 + 塔尖 + 浮玉桥双拱 + 水面，两层不透明度做出立体感（底色取当前皮肤渐变） |
| 对话空态 | **手绘细线场景**：月亮与月晕 · 黔灵山 · 金融城天际线（带窗格）· 甲秀楼三层飞檐与浮玉桥 · 南明河三重水波 · 飞鸟，配 **「知行合一 · 协力争先」** 城市精神印章 |
| 皮肤选择器 | 9 张皮肤卡各带一枚**96×40 细线徽记**，用**该皮肤的主色**绘制：山峦雾线 / 甲秀楼与月 / 数据柱与上行曲线 / 鼓楼与风雨桥 / 城墙垛口与门楼 / 竹影与一线天 / 城门与灯笼 / 海百合与波 / 梯田与花瓣 |
| 页脚 | 一条随时间换肤的天际线水印 |
| 彩蛋栏 | 品牌色→呼应色→暖色的极淡渐变 + 缓慢扫过的高光 |

**绘制的讲究**（全部是手工内联 SVG，不用位图，任意缩放都清晰）：

- **分层做纵深**：远山 `.10` → 城市 `.13` → 甲秀楼与桥 `.24~.34`，用不透明度区分前后景，而不是靠颜色；
- **细节到位**：金融城塔楼带窗格线、飞檐用二次贝塞尔做出上翘、桥有三个拱、水面三重波纹、天空两只飞鸟、月亮带月晕；
- **融进卡片**：空态用 `radial-gradient` 遮罩做柔和暗角，页脚用 `linear-gradient` 遮罩做左右淡出，不会出现生硬的方框边缘；
- **跟着皮肤变**：整套插画都用 `currentColor`，换皮肤即换色；9 枚徽记分别用各自皮肤的主色绘制。

> 早期版本用的是插件 `preview/art-*.svg` 里 520×132 的全景剪影，压到卡片里只有 4:1 的细长比例、细节全糊成一团；
> 现在换成按用途重画的「大场景 + 九枚徽记」两套图。

---

---

## 二、外观与皮肤（贵阳 · 多彩主题）

配色**整体移植自插件 `dsh-client-ui-guiyang-theme v0.5.0`**：9 套贵阳皮肤、每套的
主色 `p` / 呼应色 `a` / 暖色 `w` / 金属色 `m` / 底色 `surface`（各带浅深两版），
以及插件的 `mix()/alpha()` 令牌推衍公式都保持一致 —— 所以网站和你在 DSH 里看到的皮肤是同一套配色。

| 皮肤 | 主色（浅/深） | 呼应色 | 灵感 |
| --- | --- | --- | --- |
| **林城晨雾** lin | `#0f9d6f` / `#2fbf8f` | `#0e7490` / `#5eead4` | 贵阳的早晨：森林绿 + 南明河的水汽 |
| **甲秀夜月** jiaxiu | `#0d7a6a` / `#37c39c` | `#3e8e93` / `#7fd1c1` | 甲秀楼的月色：碧瓦青 + 水青 + 朱梁 |
| **数谷蓝调** shugu | `#0a66c2` / `#5b93ff` | `#0093ad` / `#4dd0e1` | 中国数谷：科技蓝 + 数据青 |
| **侗乡蓝** dong | `#2b4a6f` / `#8fb6e0` | `#4a6fa5` / `#a9c4e8` | 侗布靛蓝 + 苗绣红 + 银饰白 |
| **青岩古韵** qingyan | `#4f6a72` / `#9fb9c0` | `#7a8a8f` / `#b9c8cc` | 青岩古镇的青石 + 苗绣红 + 石牌坊 |
| **阳明心源** yangming | `#6a4c93` / `#a98fd6` | `#7c8c6a` / `#b5c79a` | 修文龙场悟道：一线天光 + 竹影 |
| **九门夜灯** jiubamen | `#8c6d46` / `#d8b06a` | `#9a7b1f` / `#e8b100` | 老贵阳九门四阁：城门灯影 |
| **三叠纪之海** sanyu | `#2f6d63` / `#5fb3a1` | `#3f7f96` / `#8fd0dd` | 2.4 亿年前兴义海底：胡氏贵州龙 |
| **樱花梯田** yinghua | `#c95f88` / `#f2a0bd` | `#5f8c42` / `#a8cf7a` | 贵安樱花园与黔中梯田 |

**怎么用**：顶栏「皮肤」按钮 → 面板里 9 张卡片（含色板圆点与说明），点一下即换；
选择存 `localStorage`（`codetutor.skin.v1`）。**首次访问按节令自动选皮**（春樱花 / 夏林城 / 秋九门 / 冬甲秀），
与插件行为一致；用户一旦手动选过就以用户选择为准。

**深浅色**：顶栏「外观」按钮三态循环（跟随系统 / 浅色 / 深色）。每套皮肤都自带浅深两套令牌，
一次注入、随 `data-theme` 自动切换；CodeMirror 的高亮配色也分浅深两套。

**技术上怎么落的**：`<head>` 里一段独立小脚本定义皮肤表与推衍函数，把结果写成
`html:root{…}` 与 `html[data-theme="dark"]{…}` 注入 `<style id="gySkinStyle">`；
静态 CSS 里的令牌是"无 JS 时的兜底"，`html:root` 的特异性保证皮肤永远覆盖它，不存在闪屏。

---

---

## 三、彩蛋栏 🎈

页面底部常驻一条彩蛋栏：**「代码写累了，看看贵州发展吧休息一下吧～」**，
右侧「去逛逛 ↗」按钮新窗口打开 [贵州发展吧（百度贴吧）](https://tieba.baidu.com/f?kw=%E8%B4%B5%E5%B7%9E%E5%8F%91%E5%B1%95&fr=personalize_page)。

- 右侧 `✕` 可收起，状态记在 `localStorage`（`codetutor.eggbar.v1`）
- 页脚留了「🎈 显示彩蛋栏」入口，随时能找回来
- 栏身是「品牌色 → 呼应色 → 暖色」的柔和渐变，一道高光缓慢扫过（`prefers-reduced-motion` 下自动关闭）

---

---

## 一、文件清单与架构
codelearn/
├── index.html               # 主站（单文件：页面 + 样式 + CodeMirror 集成 + 全部交互逻辑）
├── functions/api/chat.js    # 【已上线·方案①】Cloudflare Pages Functions 同源代理
├── deploy-site/             # 可直接部署/提交的干净目录（index.html + functions/）
├── repo/                    # 站点 Git 仓库的本地克隆（已含待推送的提交 6ba81f0）
├── cloudflare-proxy.js      # 【备用·方案③】Cloudflare Worker 跨域代理
├── local-proxy.mjs          # 【备用·方案④】本机 Node 代理（127.0.0.1:8787）
├── README.md                # 本文档
├── preview-1-assistant.png  # 预览图：代码助手
├── preview-2-grading.png    # 预览图：练习批改（评分卡）
├── preview-3-mobile.png     # 预览图：手机端
├── preview-4-scorecard.png  # 预览图：评分卡特写
├── preview-5-proxy-check.png# 预览图：代理自检诊断界面
├── preview-6-chat.png       # 预览图：对话页
├── preview-7-progress.png   # 预览图：学习进度页
├── preview-8-chat-mobile.png# 预览图：手机端对话页
├── preview-9-dark-chat.png  # 预览图：深色对话页
├── preview-10-dark-progress.png # 预览图：深色学习进度页
├── preview-11-skin-lin.png  # 预览图：林城晨雾皮肤
├── preview-12-skin-shugu-dark.png # 预览图：数谷蓝调皮肤（深色）
├── preview-13-skin-yinghua.png    # 预览图：樱花梯田皮肤
├── preview-14-skin-jiubamen-dark.png # 预览图：九门夜灯皮肤（深色）
└── tests/
    ├── worker.test.mjs      # Worker 单元测试（22 项断言）
    ├── alt-deploy.test.mjs  # Pages Function + 本机代理测试（20 项断言）
    ├── e2e.mjs              # jsdom 端到端测试（116 项断言：全功能 + 知识板块 + 练习三步 + 对话 + 进度 + 持久化 + 皮肤 + 彩蛋栏）
    ├── browser.mjs          # 真实 Chrome 验证 + 预览图生成（17 项断言）
    ├── failure-repro.mjs    # 复现"Worker 装错"故障并截图（6 项判定）
    ├── live-verify.mjs      # 对线上生产域名做端到端验证（29 项判定）
    ├── feature-preview.mjs  # 生成对话页/进度页/多皮肤预览图
    ├── lna-diagnose.mjs     # 诊断 Chrome Local Network Access 拦截
    └── README.md            # 测试运行方法
```

---

---

## 一、文件清单与架构
codelearn/
├── index.html               # 主站（单文件：页面 + 样式 + CodeMirror 集成 + 全部交互逻辑）
├── functions/api/chat.js    # 【已上线·方案①】Cloudflare Pages Functions 同源代理
├── deploy-site/             # 可直接部署/提交的干净目录（index.html + functions/）
├── repo/                    # 站点 Git 仓库的本地克隆（已含待推送的提交 6ba81f0）
├── cloudflare-proxy.js      # 【备用·方案③】Cloudflare Worker 跨域代理
├── local-proxy.mjs          # 【备用·方案④】本机 Node 代理（127.0.0.1:8787）
├── README.md                # 本文档
├── preview-1-assistant.png  # 预览图：代码助手
├── preview-2-grading.png    # 预览图：练习批改（评分卡）
├── preview-3-mobile.png     # 预览图：手机端
├── preview-4-scorecard.png  # 预览图：评分卡特写
├── preview-5-proxy-check.png# 预览图：代理自检诊断界面
├── preview-6-chat.png       # 预览图：对话页
├── preview-7-progress.png   # 预览图：学习进度页
├── preview-8-chat-mobile.png# 预览图：手机端对话页
├── preview-9-dark-chat.png  # 预览图：深色对话页
├── preview-10-dark-progress.png # 预览图：深色学习进度页
├── preview-11-skin-lin.png  # 预览图：林城晨雾皮肤
├── preview-12-skin-shugu-dark.png # 预览图：数谷蓝调皮肤（深色）
├── preview-13-skin-yinghua.png    # 预览图：樱花梯田皮肤
├── preview-14-skin-jiubamen-dark.png # 预览图：九门夜灯皮肤（深色）
└── tests/
    ├── worker.test.mjs      # Worker 单元测试（22 项断言）
    ├── alt-deploy.test.mjs  # Pages Function + 本机代理测试（20 项断言）
    ├── e2e.mjs              # jsdom 端到端测试（116 项断言：全功能 + 知识板块 + 练习三步 + 对话 + 进度 + 持久化 + 皮肤 + 彩蛋栏）
    ├── browser.mjs          # 真实 Chrome 验证 + 预览图生成（17 项断言）
    ├── failure-repro.mjs    # 复现"Worker 装错"故障并截图（6 项判定）
    ├── live-verify.mjs      # 对线上生产域名做端到端验证（29 项判定）
    ├── feature-preview.mjs  # 生成对话页/进度页/多皮肤预览图
    ├── lna-diagnose.mjs     # 诊断 Chrome Local Network Access 拦截
    └── README.md            # 测试运行方法
```

---
