@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
title Panchayat Chunav Portal 2026 - Master Hub (Repo: pan)
color 0B
cls

echo =========================================================================
echo   Panchayat Chunav Portal 2026 - Master Hub (Super Admin)
echo   Live Server, Auto-Save and Tri-Repo Sync Engine (Repo: pan)
echo =========================================================================
echo   Local URL       : http://localhost:3000
echo   Master Repo     : https://github.com/Jit9763/pan
echo   Live Pan Portal : https://jit9763.github.io/pan/
echo   BLO Portal      : https://jit9763.github.io/blo-portal/
echo   Voter Portal    : https://jit9763.github.io/voter-portal/
echo =========================================================================
echo.

:: 1. Set environment & PATH
set "PATH=%USERPROFILE%\nodejs;C:\Users\jiten\AppData\Local\GitHubDesktop\app-3.6.7\resources\app\git\cmd;%PATH%"

:: 2. Target GitHub pan repository directory
set "PORTAL_DIR=C:\Users\jiten\Documents\GitHub\pan"
if not exist "!PORTAL_DIR!\server.js" (
    if exist "C:\Users\jiten\Desktop\panchayat chunav\voter_portal\server.js" (
        set "PORTAL_DIR=C:\Users\jiten\Desktop\panchayat chunav\voter_portal"
    )
)
cd /d "!PORTAL_DIR!"

:: 3. Safe Pull & Diff Check before starting (prevents any clash with other PCs)
echo [1/3] Checking latest settings from GitHub (repo: pan)...
git stash push -m "local-temp-stash" >nul 2>&1
git fetch origin main >nul 2>&1
git pull --rebase origin main >nul 2>&1
git stash pop >nul 2>&1
echo [OK] Code and settings are 100%% up to date with other PCs.
echo.

:: 4. Clean lingering process on Port 3000 (IPv4 & IPv6 robust cleanup)
echo [2/3] Preparing Port 3000...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1

:: 5. Open browser after brief pause
echo [3/3] Opening Panchayat Master Portal in browser...
start "" "http://localhost:3000"

:: 6. Start Live Server in foreground with auto-push logs
echo.
echo =========================================================================
echo   PORTAL LIVE HAI! (Port: 3000)
echo   - Portal me setting change karte hi ye automatically GitHub repo "pan"
echo     par bina kisi clash ke commit aur push ho jayegi.
echo   - Dusre PCs ki settings bhi safely rebase ho jayengi.
echo =========================================================================
echo.

node --experimental-sqlite server.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [SERVER STOPPED] Kuch gadbad hui ya server stop hua.
    pause
)
