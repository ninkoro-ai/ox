@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   股权穿透结构图生成器 - 本地演示
echo ============================================
echo.
echo 正在启动，稍后会自动打开浏览器（http://localhost:5173）
echo 关闭本窗口即可停止服务。
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173"
call npm.cmd run dev
pause
