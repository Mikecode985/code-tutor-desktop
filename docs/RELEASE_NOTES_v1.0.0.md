# CodeTutor 编程学习助手 v1.0.0

首个开源版本：一个**单文件静态站点**式的 AI 编程学习助手，并附带 **Windows 桌面版（一键安装）**。

## 下载

| 文件 | 适用 | 说明 |
| --- | --- | --- |
| `CodeTutor-1.0.0-win64-setup.zip`（≈103MB） | 普通用户 | 解压后双击 `安装 CodeTutor.cmd`，自动装好并创建快捷方式（**不需要管理员权限**） |
| `CodeTutor-1.0.0-win64-portable.zip`（≈103MB） | 不想安装 | 绿色版，解压后直接双击 `CodeTutor.exe` |

**系统要求**：Windows 10/11（64 位）· 磁盘约 260MB · 无需管理员权限。

SHA-256：

```text
3992B6E0CE433394990F1605635A374BB02A34F87C02748D194F216EE4C4C6D3  CodeTutor-1.0.0-win64-setup.zip
CE7EDFBA04F3887F776B48156A0317A4738F457949A11086596A18A27DFAC7C4  CodeTutor-1.0.0-win64-portable.zip
```

不想装软件也可以直接用在线版：<https://code-tutor-site.pages.dev>

## 功能

- **对话**：流式 AI 对话、多轮上下文、本地历史、Markdown 与代码块复制
- **代码助手**：Bug 诊断 / 讲解 / 修复 / 易错点；CodeMirror 编辑器（Python · C · C++）
- **练习**：**出题 → 作答 → 批改** 三步；四档考试级难度（基础 / 计算机二级 / CSP-J / 蓝桥杯国赛级）；
  **出题绝不泄露答案**；批改给得分环 + 逐项评分 + 漏洞清单
- **学习知识**：四档 × 25 个知识点模块，标记掌握，一键「练这个知识点」
- **实用工具**：多格式文档阅读器（Markdown / TXT / PDF / EPUB / DOCX / 代码 / CSV / JSON），
  多文件列表、章节目录、原文与 AI 提炼双视图、导出 Markdown；
  **扫描版 PDF 支持 OCR**：AI 视觉（qwen-vl）与**本地 Tesseract** 双引擎，没 Key / 用 DeepSeek 时自动回落本地
- **学习进度**：对话轮数、练习次数、批改趋势、掌握度，导出/导入 JSON
- **API 设置**：两种连接方式（**经代理 / 直连服务商**）、视觉模型独立配置、两步自检

## 视觉

- 遵循 Apple HIG：系统字体、hairline 分隔线、分组卡片、玻璃拟态、21 个内联 SVG 图标
- **9 套「贵阳 · 多彩主题」**：林城 / 甲秀 / 树谷 / 侗蓝 / 青岩 / 阳明 / 九门 / 三语 / 樱花，
  默认按季节切换，深浅色成对
- 移动端 ≤760px 自动切换底部标签栏

## 隐私

- API Key **只在内存**，关闭即清除，不写 localStorage / Cookie / 服务器
- 学习数据存本机 `localStorage`（`codetutor.*`），可导出备份
- 文档阅读器：文件**只在浏览器内存里解析**，刻意不落盘；只有「AI 提炼」才会发节选给模型
- 桌面版：`contextIsolation` + `sandbox`，不开 Node 能力给页面，外链交给系统浏览器

## 质量

- **10 套 / 476 项自动化断言**全部通过，CI 已接入 GitHub Actions
  （语法检查 + 代理单元测试 + Pages Function 多模态/重试 + jsdom e2e 137 项 + 桌面工程检查）
- 代理层：多模态 `content` 原样转发、75s 超时、429/5xx 自动重试、`X-Upstream-*` 诊断头

## 已知限制

- 安装包**未做代码签名**，首次运行会有 SmartScreen 提示（更多信息 → 仍要运行）
- 本版只提供 Windows x64 安装包；macOS / Linux 需自行 `npm run bundle` 构建
- 扫描件 OCR 的本地引擎在**多栏 / 表格**版式上不如 AI 视觉（后续会补版面分块）

## 校验与协议

MIT License。源码：<https://github.com/Mikecode985/code-tutor-desktop>
