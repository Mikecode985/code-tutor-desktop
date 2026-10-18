'use strict';
/**
 * CodeTutor 桌面版主进程
 *  · 单实例、窗口尺寸记忆、外链走系统浏览器
 *  · 页面全部本地加载（file://），不依赖任何服务器（AI 请求仍走你配置的代理/直连）
 *  · --smoke：无界面自检（加载页面 → 检查 7 个标签与 2 个编辑器 → 退出码 0/1）
 */
const { app, BrowserWindow, shell, Menu, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const SMOKE = process.argv.includes('--smoke');
const APP_INDEX = path.join(__dirname, 'app', 'index.html');
const ICON = path.join(__dirname, 'build', 'icon.ico');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch (e) { return {}; }
}
function writeState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({
      width: b.width, height: b.height, x: b.x, y: b.y, maximized: win.isMaximized()
    }));
  } catch (e) { /* 忽略 */ }
}

let mainWindow = null;

function createWindow() {
  const st = readState();
  mainWindow = new BrowserWindow({
    width: st.width || 1340,
    height: st.height || 900,
    x: Number.isFinite(st.x) ? st.x : undefined,
    y: Number.isFinite(st.y) ? st.y : undefined,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#f5f5f7',
    title: 'CodeTutor 编程学习助手',
    icon: ICON,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webgl: true
    }
  });

  if (st.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(APP_INDEX);

  // 新窗口一律交给系统浏览器（彩蛋栏的贴吧链接等）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 页面内导航：只允许留在本地页面，外链交给系统浏览器
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const cur = mainWindow.webContents.getURL();
    if (url !== cur) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.on('close', () => writeState(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  if (SMOKE) {
    mainWindow.webContents.once('did-finish-load', async () => {
      await new Promise(r => setTimeout(r, 3000));   // 等内联脚本跑完（CodeMirror 由本地 vendor 加载）
      let res;
      try {
        res = await mainWindow.webContents.executeJavaScript(`(function(){
          return {
            tabs: document.querySelectorAll('.tab').length,
            panels: document.querySelectorAll('.panel').length,
            cm: document.querySelectorAll('.CodeMirror').length,
            skin: document.documentElement.getAttribute('data-skin') || '',
            title: document.title,
            desktop: !!(window.__CODETUTOR_DESKTOP__ && window.__CODETUTOR_DESKTOP__.desktop),
            vendorLocal: document.documentElement.innerHTML.indexOf('vendor/codemirror') >= 0
          };
        })()`);
      } catch (e) { res = { error: String(e) }; }
      console.log('[smoke] ' + JSON.stringify(res));
      const ok = res && res.desktop === true && res.tabs >= 7 && res.cm === 2;
      app.exit(ok ? 0 : 1);
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => {
      console.error('[smoke] renderer gone: ' + JSON.stringify(d));
      app.exit(1);
    });
  }
  return mainWindow;
}

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.reload() },
        { label: '放大', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(0.1) },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.1) },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', click: () => { if (mainWindow) mainWindow.webContents.setZoomFactor(1); } },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' }, { label: '重做', role: 'redo' }, { type: 'separator' },
        { label: '剪切', role: 'cut' }, { label: '复制', role: 'copy' }, { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '深色外观', accelerator: 'CmdOrCtrl+Shift+D', click: () => mainWindow && mainWindow.webContents.executeJavaScript("(function(){var b=document.getElementById('themeBtn');if(b)b.click();return true;})()") },
        { label: '切换皮肤', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow && mainWindow.webContents.executeJavaScript("(function(){var b=document.getElementById('skinBtn');if(b)b.click();return true;})()") },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow && mainWindow.webContents.toggleDevTools() }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开在线版',
          click: () => shell.openExternal('https://code-tutor-site.pages.dev/')
        },
        {
          label: '关于 CodeTutor',
          click: () => dialog.showMessageBoxSync(mainWindow, {
            type: 'info',
            title: '关于 CodeTutor',
            message: 'CodeTutor 编程学习助手',
            detail: '桌面版 ' + app.getVersion() + '\nElectron ' + process.versions.electron + ' · Chromium ' + process.versions.chrome +
              '\n\n所有学习数据（对话、进度、掌握度）都保存在你自己的电脑上；\nAPI Key 只保存在内存，关闭即清除。',
            buttons: ['好的']
          })
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function zoom(delta) {
  if (!mainWindow) return;
  const wc = mainWindow.webContents;
  const f = Math.min(2, Math.max(0.6, wc.getZoomFactor() + delta));
  wc.setZoomFactor(f);
}

if (SMOKE) {
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
    createWindow();
  });
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    });
    app.whenReady().then(() => {
      // 桌面版不需要任何浏览器权限（麦克风/摄像头/通知等一律拒绝）
      session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
      createWindow();
      buildMenu();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
