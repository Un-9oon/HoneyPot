@echo off
setlocal EnableDelayedExpansion

:: Nexus Honeypot - Windows Automated Management CLI
:: Usage: manage.bat {deploy|start|stop|restart|dashboard}

set "command=%~1"

if "%command%"=="" (
    echo [Nexus Honeypot Management Tool]
    echo Usage: manage.bat {deploy^|start^|stop^|restart^|dashboard}
    exit /b 1
)

if "%command%"=="deploy" (
    echo [*] Initiating Automated Deployment for Windows...
    call npm install
    call npm install -g pm2
    echo [+] Deployment complete! Run 'manage.bat start' to start the honeypot.
    exit /b 0
)

if "%command%"=="start" (
    echo [*] Starting Honeypot ^& Dashboard...
    call npx pm2 start server.js --name "honeypot"
    call npx pm2 save
    echo [+] System online. Run 'manage.bat dashboard' for access info.
    exit /b 0
)

if "%command%"=="stop" (
    echo [*] Stopping Honeypot Services...
    call npx pm2 stop honeypot
    exit /b 0
)

if "%command%"=="restart" (
    echo [*] Restarting Honeypot Services...
    call npx pm2 restart honeypot
    exit /b 0
)

if "%command%"=="dashboard" (
    echo ================================================
    echo        HONEYPOT DASHBOARD ^& ACCESS INFO
    echo ================================================
    call npx pm2 status honeypot | findstr /i "honeypot online"
    echo ------------------------------------------------
    
    echo Honeypot Dashboard  : http://127.0.0.1:3002
    
    if exist "config\auth.json" (
        for /f "tokens=4 delims=^"" %%a in ('findstr "username" config\auth.json') do set "USER=%%a"
        for /f "tokens=4 delims=^"" %%a in ('findstr "password" config\auth.json') do set "PASS=%%a"
        echo Honeypot Username   : !USER!
        echo Honeypot Password   : !PASS!
    ) else (
        echo Dashboard credentials not found. Please run 'manage.bat start' first.
    )
    
    echo ------------------------------------------------
    echo [*] Opening Honeypot dashboard in your default browser...
    start http://127.0.0.1:3002
    echo ================================================
    exit /b 0
)

echo Usage: manage.bat {deploy^|start^|stop^|restart^|dashboard}
exit /b 1
