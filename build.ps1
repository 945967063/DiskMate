# ============================================================
#  DiskMate v2.1 - Build script (run on any Windows x64 PC)
#  双击 build.bat 即可；完成后生成 DiskMate 文件夹和桌面快捷方式
# ============================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $root 'app'
if (-not (Test-Path $appDir)) { Write-Host 'ERROR: app folder not found. Please extract the zip completely.' -ForegroundColor Red; exit 1 }

$ver = '33.4.11'
$zipName = "electron-v$ver-win32-x64.zip"
$zipPath = Join-Path $root $zipName
$outDir = Join-Path $root 'DiskMate'

if (-not (Test-Path $zipPath)) {
    $urls = @(
        "https://registry.npmmirror.com/-/binary/electron/$ver/$zipName",
        "https://cdn.npmmirror.com/binaries/electron/$ver/$zipName",
        "https://github.com/electron/electron/releases/download/v$ver/$zipName"
    )
    $done = $false
    foreach ($u in $urls) {
        Write-Host "Downloading Electron runtime (~110MB): $u" -ForegroundColor Cyan
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $u -OutFile $zipPath -UseBasicParsing
            if ((Get-Item $zipPath).Length -gt 50MB) { $done = $true; break }
        } catch { Write-Host "  failed, trying next mirror... ($($_.Exception.Message))" -ForegroundColor Yellow }
    }
    if (-not $done) { Write-Host 'Download failed. Check your network and retry.' -ForegroundColor Red; exit 1 }
}

Write-Host 'Extracting...' -ForegroundColor Cyan
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force }
Expand-Archive -Path $zipPath -DestinationPath $outDir

Write-Host 'Assembling DiskMate...' -ForegroundColor Cyan
Remove-Item (Join-Path $outDir 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue
Copy-Item $appDir (Join-Path $outDir 'resources\app') -Recurse
Rename-Item (Join-Path $outDir 'electron.exe') 'DiskMate.exe'

Get-ChildItem (Join-Path $outDir 'locales') -Filter *.pak |
    Where-Object { $_.Name -notin @('zh-CN.pak','en-US.pak') } |
    Remove-Item -Force -ErrorAction SilentlyContinue

try {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'DiskMate.lnk'))
    $lnk.TargetPath = (Join-Path $outDir 'DiskMate.exe')
    $lnk.WorkingDirectory = $outDir
    $lnk.Save()
    Write-Host 'Desktop shortcut created.' -ForegroundColor Green
} catch {}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host "DONE! Run: $outDir\DiskMate.exe" -ForegroundColor Green
