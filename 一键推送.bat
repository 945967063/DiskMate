@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   DiskMate 一键推送到 GitHub
echo ============================================
echo.
echo 正在推送 main 分支...
git push origin main
echo.
echo 正在推送标签...
git push origin --tags
echo.
echo 若提示 index.lock 等错误，删除 .git\index.lock 后重试。
echo 若连接被重置，请开启加速器/代理后再运行。
echo.
pause
