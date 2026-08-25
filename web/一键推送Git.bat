@echo off
title 拉格朗日 - 一键推送到 GitHub
cd /d "%~dp0"

echo.
echo ==========================================
echo       拉格朗日 一键推送到 GitHub
echo ==========================================
echo.

echo [1/4] 从源文件夹同步文件...
robocopy "C:\Users\Administrator\Desktop\拉格朗日智能体3" "." /MIR /XD .git node_modules __pycache__ >nul
if errorlevel 8 (
    echo     同步失败！请检查源文件夹是否存在
    pause
    exit /b 1
)
echo     同步完成

:: 镜像同步会删除源中没有的文件，重建 .gitignore
(
echo node_modules/
echo *.log
echo fix_*.py
echo test_*.js
echo __pycache__/
echo .DS_Store
echo nul
) > .gitignore

echo [2/4] 清理临时文件...
if exist node_modules\ rmdir /s /q node_modules
if exist __pycache__\ rmdir /s /q __pycache__
del /q *.log 2>nul
del /q fix_*.py 2>nul
del /q test_*.js 2>nul
del /q nul 2>nul
echo     清理完成

echo [3/4] 提交到 Git...
git add -A
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set DT=%%I
set VER=v%DT:~0,4%%DT:~4,2%%DT:~6,2%_%DT:~8,2%%DT:~10,2%
git commit -m "%VER% 快速同步" >nul 2>&1
if errorlevel 1 (
    echo     没有变更，跳过提交
) else (
    echo     提交完成 [%VER%]
)

echo [4/4] 推送到 GitHub...
git push origin main
if errorlevel 1 (
    echo.
    echo ==========================================
    echo      推送失败！请检查网络或SSH配置
    echo ==========================================
    pause
    exit /b 1
) else (
    echo.
    echo ==========================================
    echo          推送成功！
    echo.
    echo     网址: https://obxx947.github.io/lglr/
    echo ==========================================
)

echo.
pause
