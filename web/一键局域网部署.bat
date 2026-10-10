@echo off
setlocal enabledelayedexpansion
title 拉格朗日智能体 - 一键局域网部署

rem ============================================================
rem  拉格朗日智能体 · 一键局域网部署（2026-10-10 修复版）
rem  纯静态站点：起一个 HTTP 服务，局域网内任何设备都能打开。
rem  用法：双击本文件即可。停止服务按 Ctrl+C 或直接关窗口。
rem  端口：默认 3002（可用环境变量 PORT 覆盖）
rem  本文件必须保存为【CRLF 换行 + GBK/ANSI 编码】——UTF-8 会让 cmd 随机解析出错
rem ============================================================
if not defined PORT set PORT=3002

cd /d "%~dp0"

echo.
echo ==========================================================
echo            拉格朗日智能体 · 一键局域网部署
echo ==========================================================
echo.

rem ---------- 0. 端口是否已在运行 ----------
netstat -ano | findstr ":%PORT% " | findstr /i "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [i] 端口 %PORT% 已经在监听 -- 服务可能已经在运行，不再重复启动。
    echo     本机访问:   http://127.0.0.1:%PORT%/index.html
    echo     停止旧服务: 在原来的黑窗口按 Ctrl+C，或任务管理器结束 python。
    echo.
    if not defined NO_BROWSER start "" http://127.0.0.1:%PORT%/index.html
    pause
    exit /b 0
)

rem ---------- 1. 找 Python ----------
set PY=
where py >nul 2>nul && (py -3 -c "import sys" >nul 2>nul && set "PY=py -3")
if not defined PY ( where python >nul 2>nul && set "PY=python" )
if not defined PY (
    echo [x] 没找到 Python。
    echo     请先装 Python 3（装的时候勾上 "Add Python to PATH"）:
    echo     https://www.python.org/downloads/
    echo     装好后重新双击本文件即可。
    pause
    exit /b 1
)
echo [1/4] Python 已就绪: %PY%

rem ---------- 2. 取本机局域网 IP（ipconfig 优先） ----------
set LANIP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set "T=%%a"
    set "T=!T: =!"
    if not defined LANIP (
        echo !T! | findstr /b /c:"127." >nul || echo !T! | findstr /b /c:"169.254." >nul || set "LANIP=!T!"
    )
)
if defined LANIP ( echo [2/4] 本机局域网 IP: %LANIP% ) else ( echo [2/4] 没取到局域网 IP（只能本机访问，不影响使用） & set LANIP=127.0.0.1 )

rem ---------- 3. 防火墙放行（需要管理员；失败就提示手动） ----------
netsh advfirewall firewall show rule name="拉格朗日智能体-LAN" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="拉格朗日智能体-LAN" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul
    if errorlevel 1 (
        echo [3/4] [注意] 没能自动放行防火墙端口 %PORT%。
        echo       如果别的设备打不开，请【用管理员身份】双击本文件一次，
        echo       或在 高级安全 Windows Defender 防火墙 里手动放行 TCP %PORT%。
    ) else (
        echo [3/4] 已放行防火墙 TCP %PORT%
    )
) else (
    echo [3/4] 防火墙规则已存在，跳过
)

rem ---------- 4. 起服务 ----------
echo [4/4] 正在启动 HTTP 服务...
echo.
echo ----------------------------------------------------------
echo   本机访问:   http://127.0.0.1:%PORT%/index.html
echo   局域网访问: http://%LANIP%:%PORT%/index.html
echo ----------------------------------------------------------
echo.
echo   把这个局域网地址发给同一个 WiFi / 路由下的手机、平板、别的电脑，
echo   就能直接打开（不用装任何东西）。
echo.
echo   常用入口:
echo     首页       http://%LANIP%:%PORT%/index.html
echo     战舰配队   http://%LANIP%:%PORT%/fleet.html
echo     舰船加点   http://%LANIP%:%PORT%/addpoint.html
echo     战斗模拟   http://%LANIP%:%PORT%/simulator.html
echo     神经元      http://%LANIP%:%PORT%/neuron.html
echo     舰船图鉴   http://%LANIP%:%PORT%/ships.html
echo.
echo   停止服务: 在本窗口按 Ctrl+C，或直接关掉窗口。
echo ----------------------------------------------------------
echo.

if not defined NO_BROWSER start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:%PORT%/index.html"

%PY% -m http.server %PORT% --bind 0.0.0.0

echo.
echo 服务已停止。
pause
