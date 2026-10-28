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
$manifestFile = Join-Path $PSScriptRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) { throw '请完整解压安装 ZIP，保留 Install.ps1、package.json 和插件 tgz 包在同一目录。' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ($manifest.name -ne 'dsh-desktop-delete') { throw '安装包的 package.json 不正确。' }
# Use the same semver library/options as Harness and the actual package manifest.
# No per-release whitelist, separate Node installation, or version exemption.
$compatibilityCheck = @'
const path = require('node:path');
const fs = require('node:fs');
const load = require('node:module').createRequire(path.join(path.dirname(process.execPath), 'resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js'));
const semver = load('semver');
const manifest = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!semver.valid(process.argv[2]) || !semver.satisfies(process.argv[2], manifest.engines.dsh, { includePrerelease: true })) {
  console.error(`Harness ${process.argv[2]} does not satisfy ${manifest.engines.dsh}`);
  process.exitCode = 1;
}
'@
$nodeStart = [System.Diagnostics.ProcessStartInfo]::new()
$nodeStart.FileName = $ApplicationPath
$nodeStart.UseShellExecute = $false
$nodeStart.CreateNoWindow = $true
$nodeStart.RedirectStandardOutput = $true
$nodeStart.RedirectStandardError = $true
$nodeStart.Environment['ELECTRON_RUN_AS_NODE'] = '1'
foreach ($argument in @('--expose-internals', '-e', $compatibilityCheck, '--', $manifestFile, $installedVersion)) {
  $nodeStart.ArgumentList.Add($argument)
}
$nodeProcess = [System.Diagnostics.Process]::Start($nodeStart)
try {
  $stdout = $nodeProcess.StandardOutput.ReadToEndAsync()
  $stderr = $nodeProcess.StandardError.ReadToEndAsync()
  $nodeProcess.WaitForExit()
  $diagnostic = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()).Trim()
  if ($diagnostic) { Write-Host $diagnostic }
  if ($nodeProcess.ExitCode -ne 0) { throw "此插件不支持当前桌面端，或无法检查兼容性：$installedVersion" }
} finally { $nodeProcess.Dispose() }
$packageFile = Join-Path $PSScriptRoot "$($manifest.name)-$($manifest.version).tgz"
if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) { throw '请将安装脚本、package.json 和对应版本的插件 tgz 包放在同一目录。' }
$runningDesktop = @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue).Count -gt 0
Write-Host "桌面端版本：$installedVersion"
Write-Host "插件包：$packageFile"
if ($CheckOnly) { Write-Host "检查通过；桌面端正在运行：$runningDesktop"; exit 0 }
if ($runningDesktop) { throw '请在 Harness 系统托盘菜单选择“退出”，再运行安装脚本。关闭窗口会继续在后台运行。' }
& $desktopLauncher plugin --profile desktop add $packageFile
if ($LASTEXITCODE -ne 0) { throw '插件安装失败，请查看上方 dsh 错误信息。' }
Write-Host '安装完成。重新打开 DeepSeek Harness，在对话的三点菜单中选择“删除对话”。'
