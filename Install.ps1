#Requires -Version 7.0
param([string]$ApplicationPath, [switch]$CheckOnly)
# Run with PowerShell 7: pwsh -NoLogo -NoProfile -File Install.ps1
$ErrorActionPreference = 'Stop'
if (-not $ApplicationPath) { $ApplicationPath = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\DeepSeek Harness.exe' }
$ApplicationPath = (Get-Item -LiteralPath $ApplicationPath).FullName
$desktopLauncher = Join-Path (Split-Path -Parent $ApplicationPath) 'resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $desktopLauncher -PathType Leaf)) { throw '未找到桌面端自带的 dsh 命令。请使用 -ApplicationPath 指定 DeepSeek Harness.exe。' }
$installedVersion = (& $desktopLauncher --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { throw '无法读取桌面端版本。' }
if ($installedVersion -notmatch '(?m)^0\.2\.0-rc\.2$') { throw "此插件仅验证过 0.2.0-rc.2；检测到：$installedVersion" }
$packageFile = Join-Path $PSScriptRoot 'dsh-desktop-delete-0.1.1.tgz'
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { throw '请将安装脚本和 dsh-desktop-delete-0.1.1.tgz 放在同一目录。' }
$runningDesktop = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0
Write-Host "桌面端版本：$installedVersion"
Write-Host "插件包：$packageFile"
if ($CheckOnly) { Write-Host "检查通过；桌面端正在运行：$runningDesktop"; exit 0 }
if ($runningDesktop) { throw '请在 Harness 系统托盘菜单选择“退出”，再运行安装脚本。关闭窗口会继续在后台运行。' }
& $desktopLauncher plugin --profile desktop add $packageFile
if ($LASTEXITCODE -ne 0) { throw '插件安装失败，请查看上方 dsh 错误信息。' }
Write-Host '安装完成。重新打开 DeepSeek Harness，在对话的三点菜单中选择“删除对话”。'
