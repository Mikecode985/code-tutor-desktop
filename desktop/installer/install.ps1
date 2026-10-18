# CodeTutor 编程学习助手 · 一键安装脚本
# 用法：双击同目录的「安装 CodeTutor.cmd」，或在 PowerShell 里执行本脚本。
# 可选参数：
#   -TargetDir "D:\xxx"    安装到指定目录（默认 %LOCALAPPDATA%\Programs\CodeTutor）
#   -NoLaunch              安装完不自动启动
#   -DryRun                只打印计划，不实际改动（自检用）
param(
  [string]$TargetDir = (Join-Path $env:LOCALAPPDATA 'Programs\CodeTutor'),
  [switch]$NoLaunch,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$AppName    = 'CodeTutor 编程学习助手'
$AppShort   = 'CodeTutor'
$AppExe     = 'CodeTutor.exe'
$AppVersion = '1.0.0'
$AppId      = 'com.mikecode985.codetutor'
$Here       = Split-Path -Parent $MyInvocation.MyCommand.Path
$Zip        = Get-ChildItem -Path $Here -Filter 'CodeTutor-*-win64.zip' | Select-Object -First 1
$IconSrc    = Join-Path $Here 'icon.ico'

function Say([string]$Msg, [string]$Color = 'Gray') { Write-Host $Msg -ForegroundColor $Color }
function Step([string]$Msg) { Write-Host ''; Write-Host "▶ $Msg" -ForegroundColor Cyan }

Say ''
Say '==============================================' Cyan
Say "  $AppName  桌面版 $AppVersion" Cyan
Say '==============================================' Cyan

if (-not $Zip) {
  Say "✗ 找不到安装包（CodeTutor-*-win64.zip）。请把本脚本与压缩包放在同一个文件夹里。" Red
  Read-Host '按回车退出'
  exit 1
}
Say "安装包：$($Zip.Name)  ($([math]::Round($Zip.Length/1MB,1)) MB)"
Say "安装到：$TargetDir"
Say "数据目录：$(Join-Path $env:APPDATA $AppShort)（对话/进度，卸载时可选择保留）"

if ($DryRun) { Say ''; Say '[DryRun] 只打印计划，不做任何改动' Yellow }

# ---------- 1. 关闭正在运行的实例 ----------
Step '1/6 关闭正在运行的 CodeTutor'
$procs = Get-Process -Name 'CodeTutor' -ErrorAction SilentlyContinue
if ($procs) {
  if (-not $DryRun) { $procs | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600 }
  Say "  已结束 $($procs.Count) 个进程" Green
} else { Say '  没有正在运行的实例' Green }

# ---------- 2. 解压 ----------
Step '2/6 解压程序文件'
if ($DryRun) {
  Say "  [计划] 解压到 $TargetDir"
} else {
  if (Test-Path $TargetDir) {
    # 就地覆盖升级：只删程序文件，保留 %APPDATA% 里的学习数据
    Get-ChildItem $TargetDir -Force | Where-Object { $_.Name -notin @('Uninstall.ps1','卸载 CodeTutor.cmd') } |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip.FullName, $TargetDir)
  $exePath = Join-Path $TargetDir $AppExe
  if (-not (Test-Path $exePath)) { throw "解压后没找到 $AppExe，安装包可能不完整" }
  Say "  已解压 $((Get-ChildItem $TargetDir -Recurse -File | Measure-Object).Count) 个文件" Green
}

# ---------- 3. 图标 & 卸载脚本 ----------
Step '3/6 写入图标与卸载脚本'
$iconDst = Join-Path $TargetDir 'icon.ico'
if (-not $DryRun) {
  if (Test-Path $IconSrc) { Copy-Item $IconSrc $iconDst -Force }

  $uninstallPs1 = @'
param([switch]$Silent)
$ErrorActionPreference = 'SilentlyContinue'
$AppShort = 'CodeTutor'
$AppDisplay = 'CodeTutor 编程学习助手'
$AppId = 'com.mikecode985.codetutor'
Get-Process -Name $AppShort | Stop-Process -Force
Start-Sleep -Milliseconds 500
$installDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) $AppShort
Remove-Item (Join-Path $desktop "$AppDisplay.lnk") -Force
Remove-Item $startMenu -Recurse -Force
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId" -Recurse -Force
Remove-Item "HKCU:\Software\Classes\$AppId" -Recurse -Force
Remove-Item $installDir -Recurse -Force
Write-Host ''
Write-Host '✔ 已卸载 CodeTutor 编程学习助手' -ForegroundColor Green
Write-Host "  学习数据仍保留在 $(Join-Path $env:APPDATA $AppShort)（如需彻底清除请手动删除该文件夹）" -ForegroundColor DarkGray
if (-not $Silent) { Read-Host '按回车退出' }
'@
  Set-Content -Path (Join-Path $TargetDir 'Uninstall.ps1') -Value $uninstallPs1 -Encoding UTF8

  $uninstallCmd = @'
@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall.ps1"
'@
  Set-Content -Path (Join-Path $TargetDir '卸载 CodeTutor.cmd') -Value $uninstallCmd -Encoding OEM

  # 安装说明也放一份到安装目录"
  $readme = Join-Path $Here '安装说明.txt'
  if (Test-Path $readme) { Copy-Item $readme (Join-Path $TargetDir '安装说明.txt') -Force }
  Say '  完成' Green
}

# ---------- 4. 快捷方式 ----------
Step '4/6 创建快捷方式（桌面 + 开始菜单）'
if ($DryRun) {
  Say '  [计划] 桌面：CodeTutor 编程学习助手.lnk'
  Say '  [计划] 开始菜单：CodeTutor → 程序 / 卸载'
} else {
  $exePath = Join-Path $TargetDir $AppExe
  $uninstPath = Join-Path $TargetDir 'Uninstall.ps1'
  $iconPath = if (Test-Path $iconDst) { $iconDst } else { $exePath }
  $shell = New-Object -ComObject WScript.Shell

  $desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"
  $s = $shell.CreateShortcut($desktopLnk)
  $s.TargetPath = $exePath; $s.WorkingDirectory = $TargetDir
  $s.IconLocation = "$iconPath,0"; $s.Description = $AppName
  $s.Save()

  $startDir = Join-Path ([Environment]::GetFolderPath('Programs')) $AppShort
  New-Item -ItemType Directory -Force -Path $startDir | Out-Null
  $s2 = $shell.CreateShortcut((Join-Path $startDir "$AppName.lnk"))
  $s2.TargetPath = $exePath; $s2.WorkingDirectory = $TargetDir
  $s2.IconLocation = "$iconPath,0"; $s2.Description = $AppName
  $s2.Save()

  $s3 = $shell.CreateShortcut((Join-Path $startDir "卸载 $AppName.lnk"))
  # 用 powershell 作为目标，避免 cmd 闪窗
  $s3.TargetPath = 'powershell.exe'
  $s3.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$uninstPath`""
  $s3.IconLocation = "$iconPath,0"; $s3.Description = "卸载 $AppName"
  $s3.Save()
  Say "  桌面：$desktopLnk" Green
  Say "  开始菜单：$startDir" Green
}

# ---------- 5. 注册卸载入口 ----------
Step '5/6 注册到「设置 → 应用」'
if ($DryRun) {
  Say '  [计划] HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\com.mikecode985.codetutor'
} else {
  $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$AppId"
  New-Item -Path $key -Force | Out-Null
  $sizeKb = if (Test-Path $TargetDir) { [int](((Get-ChildItem $TargetDir -Recurse -File | Measure-Object Length -Sum).Sum) / 1KB) } else { 0 }
  $uninstExe = Join-Path $TargetDir '卸载 CodeTutor.cmd'
  Set-ItemProperty -Path $key -Name 'DisplayName'     -Value $AppName
  Set-ItemProperty -Path $key -Name 'DisplayVersion'  -Value $AppVersion
  Set-ItemProperty -Path $key -Name 'Publisher'       -Value 'Mikecode985'
  Set-ItemProperty -Path $key -Name 'DisplayIcon'     -Value (Join-Path $TargetDir 'icon.ico')
  Set-ItemProperty -Path $key -Name 'InstallLocation' -Value $TargetDir
  Set-ItemProperty -Path $key -Name 'UninstallString' -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $TargetDir 'Uninstall.ps1')`""
  Set-ItemProperty -Path $key -Name 'QuietUninstallString' -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $TargetDir 'Uninstall.ps1')`" -Silent"
  Set-ItemProperty -Path $key -Name 'EstimatedSize'   -Value $sizeKb -Type DWord
  Set-ItemProperty -Path $key -Name 'NoModify'        -Value 1 -Type DWord
  Set-ItemProperty -Path $key -Name 'NoRepair'        -Value 1 -Type DWord
  New-Item -Path "HKCU:\Software\Classes\$AppId" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Classes\$AppId" -Name '(default)' -Value $AppName
  Say '  完成：可在「设置 → 应用」里看到并卸载' Green
}

# ---------- 6. 启动 ----------
Step '6/6 启动'
if ($DryRun -or $NoLaunch) {
  Say '  跳过启动（DryRun 或 -NoLaunch）'
} else {
  Start-Process -FilePath (Join-Path $TargetDir $AppExe) -WorkingDirectory $TargetDir
  Say '  已启动 CodeTutor' Green
}

Say ''
Say '==============================================' Green
Say '  ✔ 安装完成' Green
Say '==============================================' Green
Say ''
Say '接下来：' White
Say '  1. 打开软件 → 顶部「API 设置」'
Say '  2. 选服务商 + 填你自己的 API Key'
Say '  3. 连接方式建议选「直连服务商（最快）」'
Say '     · 通义千问：模型名称 qwen-plus，视觉模型 qwen-vl-max'
Say '     · DeepSeek：模型名称 deepseek-chat（不支持图片）'
Say '  4. 点「测试连接」确认可用'
Say ''
Say "数据在 $(Join-Path $env:APPDATA $AppShort)，API Key 只在内存中，关闭即清除。" DarkGray
Say ''
if (-not $DryRun) { Read-Host '按回车退出' }
