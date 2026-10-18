'use strict';
/**
 * 预加载脚本：只暴露只读的桌面环境信息，不开任何 Node 能力给页面。
 * 页面据此判断"我在桌面版里"（例如把默认代理换成绝对地址）。
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('__CODETUTOR_DESKTOP__', {
  desktop: true,
  version: process.versions.electron,
  chrome: process.versions.chrome,
  platform: process.platform
});
