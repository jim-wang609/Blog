@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal EnableExtensions

rem 宿主环境里的 SERVER__PORT 会被 Spring 宽松绑定成 server.port，
rem 盖掉配置文件里的端口，导致每次启动都随机换端口。这里先清掉。
set "SERVER__PORT="
set "SERVER__HOST="

set "BASE=http://127.0.0.1:8080"
set "PROBE=%BASE%/api/bootstrap"

rem 数据库只连 MySQL：默认 127.0.0.1:3306/kimon_blog，账号 root / 密码 root。
rem 本机密码不一样时，先 set DB_USER / DB_PASSWORD 再运行（或写进系统环境变量）。
if not defined DB_USER set "DB_USER=root"
if not defined DB_PASSWORD set "DB_PASSWORD=root"

echo.
echo   Kimon's Blog  /  Spring Boot + MySQL
echo   前台      %BASE%/home.html
echo   站主入口  %BASE%/enter.html   （首页顶栏/页脚也能点进去）
echo   管理台    %BASE%/studio.html
echo   访客日志  backend\logs\visitor.log
echo.

rem ---- 0. 先检查 Java / Maven，缺工具时直接给提示，别等 mvn 报一长串 ----
where java >nul 2>&1
if errorlevel 1 (
  echo   [X] 找不到 java。请安装 JDK 17，并把 bin 目录加进 PATH 后重开本窗口。
  echo       验证：java -version
  echo.
  pause
  exit /b 1
)
where mvn >nul 2>&1
if errorlevel 1 (
  echo   [X] 找不到 mvn。请安装 Maven 3.9+，并把 bin 目录加进 PATH 后重开本窗口。
  echo       验证：mvn -v
  echo.
  pause
  exit /b 1
)

rem ---- 1. 服务已经在跑？直接开页面，不重复启动 ----
call :PROBE
if not errorlevel 1 (
  echo   [OK] 后端已经在运行，直接打开首页。
  start "" "%BASE%/home.html"
  timeout /t 2 >nul
  exit /b 0
)

rem ---- 2. 先收掉“本项目的”旧 java/mvn 进程 ----
rem 只按命令行过滤本项目相关进程（spring-boot:run / com.kimon.blog / blog-backend），
rem 绝不 taskkill 任意占用 8080 的进程——那可能是别的程序。
call :KILL_PROJECT_PROCESSES

set "OCC="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do set "OCC=%%p"
if defined OCC (
  echo   [!] 8080 被“非本项目”进程 PID %OCC% 占用，本脚本不会结束它。
  echo       先看看它是谁：
  echo         powershell -NoProfile -Command "Get-Process -Id %OCC% ^| Format-List Id,ProcessName,Path"
  echo         netstat -ano ^| findstr :8080
  echo       确认可以关掉后再手动结束，或改本脚本里的端口。
  echo.
  pause
  exit /b 1
)

rem ---- 3. 启动后端（独立最小化窗口，主窗口负责等它就绪） ----
echo   正在启动后端，首次启动 / 刚改完代码大约 10–40 秒...
echo   后端跑在那个最小化的「Kimon Blog 后端」窗口里，启动期间不要关掉它。
echo.
start "Kimon Blog 后端" /min /d "%~dp0backend" cmd /c "mvn spring-boot:run -Dspring-boot.run.arguments=--server.port=8080"

echo   等待 %PROBE% 返回 200（最多 120 秒）...
call :WAIT_READY
set "WAIT_RC=%errorlevel%"

if "%WAIT_RC%"=="0" (
  echo   [OK] 后端已就绪，正在打开首页。
  start "" "%BASE%/home.html"
  echo.
  echo   当前窗口可以关闭；后端在最小化的「Kimon Blog 后端」窗口里运行，
  echo   关掉那个窗口或按 Ctrl+C 才会停止服务。
  echo.
  pause
  exit /b 0
)

echo.
if "%WAIT_RC%"=="2" (
  echo   [X] 后端进程已经退出（启动失败）。请切到「Kimon Blog 后端」窗口看红色报错。
) else (
  echo   [X] 120 秒内没有等到后端就绪。
)
echo       常见原因：
echo       - MySQL 没启动，或 DB_USER / DB_PASSWORD 不对（本机默认 root / root）
echo       - 8080 被别的程序占用
echo       - 端口 / 数据库配置被环境变量覆盖
echo       排查：切到「Kimon Blog 后端」窗口看最后几行；或运行
echo             netstat -ano ^| findstr :8080
echo.
pause
exit /b 1

rem ============================================================================
rem :PROBE —— 探测 /api/bootstrap 是否返回 2xx
rem ============================================================================
:PROBE
powershell -NoProfile -Command "try { $q=[System.Net.HttpWebRequest]::Create('%PROBE%'); $q.Timeout=2500; $q.Proxy=$null; $r=$q.GetResponse(); $ok=([int]$r.StatusCode -ge 200 -and [int]$r.StatusCode -lt 300); $r.Close(); if($ok){exit 0} } catch {}; exit 1" >nul 2>&1
exit /b %errorlevel%

rem ============================================================================
rem :KILL_PROJECT_PROCESSES —— 只结束本项目的 java / mvn / cmd 包装进程
rem 判断依据：命令行里出现 spring-boot:run、com.kimon.blog 或 blog-backend。
rem 用纯 PowerShell 完成筛选和结束，避免 for /f 里再套管道带来的转义问题；
rem 不按端口结束进程，8080 上的陌生进程一律不动。
rem ============================================================================
:KILL_PROJECT_PROCESSES
powershell -NoProfile -Command "$procs = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(java|mvn|cmd)\.(exe|cmd)$' -and $_.CommandLine -match 'spring-boot:run|com\.kimon\.blog|blog-backend' }); foreach ($p in $procs) { Write-Host ('  [kill] project PID ' + $p.ProcessId); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }"
rem 给端口一点释放时间
timeout /t 1 >nul
exit /b 0

rem ============================================================================
rem :WAIT_READY —— 每 2 秒探测一次，最多 120 秒
rem   退出码 0 = 就绪；1 = 超时；2 = 后端进程已退出
rem ============================================================================
:WAIT_READY
powershell -NoProfile -Command "$u='%PROBE%'; for($i=0;$i -lt 60;$i++){ try { $q=[System.Net.HttpWebRequest]::Create($u); $q.Timeout=2500; $q.Proxy=$null; $r=$q.GetResponse(); $ok=([int]$r.StatusCode -ge 200 -and [int]$r.StatusCode -lt 300); $r.Close(); if($ok){exit 0} } catch {}; if($i -ge 15){ $n=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(java|mvn|cmd)\.(exe|cmd)$' -and $_.CommandLine -match 'spring-boot:run|com\.kimon\.blog|blog-backend' }).Count; if($n -eq 0){exit 2} }; Start-Sleep -Seconds 2 }; exit 1"
exit /b %errorlevel%
