# CodeTutor 桌面版（Electron）

把网页版打包成 **Windows 桌面软件**，支持一键安装：双击 `安装 CodeTutor.cmd` 就完成安装（解压到用户目录、创建桌面/开始菜单快捷方式、注册卸载入口、自动启动），**不需要管理员权限**。

```
desktop/
├─ package.json          Electron + electron-builder 配置（也保留了真正的 NSIS .exe 安装包配置）
├─ main.js               主进程：单实例、窗口尺寸记忆、外链走系统浏览器、--smoke 自检
├─ preload.js            只暴露只读桌面标识（不开 Node 能力给页面）
├─ app/                  构建时由 scripts/sync.js 生成（index.html + 本地 CodeMirror）
├─ build/icon.ico        应用图标（青绿渐变 + 「码」+ 浮玉桥线）
├─ installer/
│   ├─ install.ps1       一键安装逻辑
│   ├─ 安装 CodeTutor.cmd 双击启动器（纯 ASCII，避免 cmd 代码页问题）
│   └─ codetutor.nsi     真正的 NSIS 安装脚本（在普通 Windows 机器上可产出单个 .exe）
├─ scripts/
│   ├─ sync.js           复制 index.html 并把 CodeMirror 从 CDN 本地化
│   └─ make-bundle.js    一条命令产出「一键安装包」
└─ dist/                 构建产物
```

## 一、怎么构建

```powershell
cd D:\贵阳美图\codelearn\desktop
npm install          # 首次：装 electron + electron-builder（约 400 个包）
npm run bundle       # = node scripts/make-bundle.js：同步 → 打包 → 压缩 → 组装安装包
```

产物：

| 路径 | 说明 |
| --- | --- |
| `dist/win-unpacked/` | **免安装版**，双击 `CodeTutor.exe` 就能用 |
| `dist/一键安装-Windows/` | **一键安装包**（把这个文件夹发给用户） |

一键安装包里有：

```
安装 CodeTutor.cmd        双击 → 安装 → 自动启动
install.ps1               安装脚本（UTF-8 BOM）
CodeTutor-1.0.0-win64.zip 程序本体（约 103MB）
icon.ico                  快捷方式图标
安装说明.txt              给用户的说明（也会被装到安装目录）
```

## 二、安装脚本做了什么

1. 关掉正在运行的旧实例；
2. 解压到 `%LOCALAPPDATA%\Programs\CodeTutor`（**用户目录，不需要 UAC**）；
3. 写入 `icon.ico`、`Uninstall.ps1`、`卸载 CodeTutor.cmd`；
4. 创建**桌面快捷方式** + **开始菜单**（程序 / 卸载两项）；
5. 注册到 `HKCU\...\Uninstall\com.mikecode985.codetutor` → 出现在「设置 → 应用」里，可正常卸载；
6. 启动程序。

升级：重新构建后让用户再双击一次即可覆盖安装，**学习数据保留**在 `%APPDATA%\CodeTutor`。

卸载：开始菜单 → CodeTutor → 卸载；会问是否同时删除学习数据。

## 三、真正的 `.exe` 安装包（可选）

配置里已经保留了 electron-builder 的 NSIS 目标（`oneClick: true`）和一份**自己写的 NSIS 脚本** `installer/codetutor.nsi`：

```powershell
npm run dist                  # electron-builder 直接出 CodeTutor-Setup-1.0.0.exe
# 或（更省事、不受 electron-builder 预生成卸载器的限制）：
# 用 NSIS 3 打开 installer/codetator.nsi 编译
```

> **为什么本仓库默认用「zip + 安装脚本」而不是 NSIS？**
> 本次构建环境有两个硬限制：① **禁止创建内存映射文件** —— NSIS 的 `makensis` 直接报 `error creating mmap`，Electron 也会因同样原因崩溃（连 `electron --version` 都是 0x80000003）；
> ② 没有代码签名证书。在**普通 Windows 机器上**这两条都不存在，`npm run dist` 可以正常产出单个 `.exe` 安装包。
> 交付给用户的「一键安装包」不依赖这两样东西，双击即装，体验一致。

## 四、桌面版的适配细节

| 项 | 说明 |
| --- | --- |
| 页面来源 | 全部本地 `file://` 加载，**断网也能打开**（CodeMirror 已本地化到 `app/vendor/`） |
| 默认代理 | `file://` 没有同源后端，自动填 `https://code-tutor-site.pages.dev/api/chat`；也可切「直连服务商」 |
| 桌面标识 | 顶栏显示「桌面版」小标签，标题变「CodeTutor 编程学习助手（桌面版）」 |
| 安全 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；拒绝所有权限请求；外链一律交给系统浏览器 |
| 体验 | 单实例锁、窗口尺寸记忆、菜单（重新加载 / 缩放 / 深色外观 / 切换皮肤 / 开发者工具）、`F12` 开发者工具 |
| 数据 | 与网页版相同键名（`codetutor.*`）存在本机；**API Key 只在内存**，关掉即清除 |

## 五、自检

```powershell
npm run smoke                                        # Electron 内自检（7 标签 + 2 编辑器 + 桌面标识）
node ..\tests\desktop-package.mjs                    # 45 项：产物结构 / asar 内容 / 安装包完整性
node ..\tests\desktop-page.mjs                       # 16 项：file:// 下页面确实可用（需 Chrome CDP）
```

---

数据、隐私与网页版完全一致：文档/对话/进度都在本机，API Key 不落盘。
