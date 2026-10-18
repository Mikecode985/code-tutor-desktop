; CodeTutor 一键安装程序（NSIS 3）
; 特点：无需管理员权限（安装到 %LOCALAPPDATA%\Programs），自动创建桌面/开始菜单快捷方式，
;       注册卸载入口，安装完成可直接启动；卸载器在安装时生成（不需要构建期执行安装器）。

Unicode true
!include "MUI2.nsh"

!define APP_NAME       "CodeTutor"
!define APP_DISPLAY    "CodeTutor 编程学习助手"
!define APP_VERSION    "1.0.0"
!define APP_EXE        "CodeTutor.exe"
!define APP_PUBLISHER  "Mikecode985"
!define APP_ID         "com.mikecode985.codetutor"
!define UNINST_KEY     "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

Name "${APP_DISPLAY}"
BrandingText "${APP_DISPLAY} ${APP_VERSION}"
OutFile "..\dist\CodeTutor-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\CodeTutor"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
CRCCheck on
XPStyle on

!define MUI_ICON "..\build\icon.ico"
!define MUI_UNICON "..\build\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 ${APP_DISPLAY}"
!define MUI_WELCOMEPAGE_TEXT "将把 ${APP_DISPLAY} 安装到你的用户目录，不需要管理员权限。$\r$\n$\r$\n安装后会创建桌面和开始菜单快捷方式，并可以直接启动。$\r$\n$\r$\n所有学习数据保存在你自己的电脑上；API Key 只在运行时保存在内存中。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 ${APP_DISPLAY}"
!define MUI_FINISHPAGE_LINK "了解如何在软件里配置 API Key"
!define MUI_FINISHPAGE_LINK_LOCATION "https://code-tutor-site.pages.dev/"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

VIProductVersion "1.0.0.0"
VIAddVersionKey "ProductName"     "${APP_DISPLAY}"
VIAddVersionKey "FileDescription" "${APP_DISPLAY} 安装程序"
VIAddVersionKey "FileVersion"     "${APP_VERSION}"
VIAddVersionKey "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey "CompanyName"     "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright"  "Copyright © 2026 ${APP_PUBLISHER}"

Function .onInit
  ; 已装过就提示（不静默覆盖，避免用户困惑）
  ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
  StrCmp $0 "" done
done:
FunctionEnd

Section "主程序" SecMain
  ; 关掉正在运行的旧实例，避免文件占用
  nsExec::Exec 'taskkill /IM ${APP_EXE} /F'

  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  File "..\build\icon.ico"
  File "..\安装说明.txt"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 快捷方式（用我们自己的图标，即使 exe 未做资源编辑也能显示正确图标）
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_DISPLAY}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_DISPLAY}.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\icon.ico" 0
  CreateShortCut "$DESKTOP\${APP_DISPLAY}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0

  ; 卸载入口
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayName"     "${APP_DISPLAY}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKCU "${UNINST_KEY}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKCU "${UNINST_KEY}" "DisplayIcon"     "$INSTDIR\icon.ico"
  WriteRegStr   HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr   HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr   HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\Uninstall.exe$\" /S"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" 180000

  ; 让 Windows 记住这是"应用"（开始菜单可搜索）
  WriteRegStr HKCU "Software\Classes\${APP_ID}" "" "CodeTutor 编程学习助手"
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM ${APP_EXE} /F'

  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\安装说明.txt"
  RMDir /r "$INSTDIR"

  Delete "$DESKTOP\${APP_DISPLAY}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_DISPLAY}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\卸载 ${APP_DISPLAY}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Classes\${APP_ID}"

  ; 学习数据（对话 / 进度 / 掌握度）默认保留在 %APPDATA%\CodeTutor，需要可手动删除
  MessageBox MB_YESNO|MB_ICONQUESTION "是否同时删除本地学习数据（对话历史、学习进度、掌握度）？$\r$\n选择「否」则保留，重装后可继续使用。" IDNO keepData
    RMDir /r "$APPDATA\CodeTutor"
  keepData:
SectionEnd
