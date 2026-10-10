@echo off
title "Panchayat Chunav 2026 - Super Admin Portal"
color 0B

echo ==============================================================================
echo        PANCHAYAT CHUNAV 2026 - SUPER ADMIN AND REAL-TIME SYNC
echo ==============================================================================
echo.

:: 1. Setup paths
set "PATH=C:\Program Files\Git\cmd;C:\Users\HP\AppData\Local\Programs\Python\Python312;C:\Users\HP\AppData\Local\Programs\Python\Python312\Scripts;C:\Users\HP\AppData\Local\Programs\nodejs;%PATH%"

set "BASE_CODE=C:\Users\HP\OneDrive\Desktop\code\pan"
set "PAN_DIR=C:\Users\HP\OneDrive\Desktop\code\pan\pan"
set "VOTER_DIR=C:\Users\HP\OneDrive\Desktop\code\pan\voter-portal"
set "BLO_DIR=C:\Users\HP\OneDrive\Desktop\code\pan\blo-portal"

echo [*] STEP 1/3: Purane background Node server ko stop kiya ja raha hai...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 1 >nul 2>&1

echo.
echo [*] STEP 2/3: GITHUB SE 100%% FRESH CODE DOWNLOAD AUR OVERWRITE HO RAHA HAI...
echo     (Purana code overwrite karke GitHub se latest commits apply ho rahe hain)
echo.

cd /d "%BASE_CODE%"
"C:\Users\HP\AppData\Local\Programs\Python\Python312\python.exe" deploy_tri_portals.py --clean

echo.
echo ==============================================================================
echo [*] STEP 3/3: Node.js High-Speed Server LIVE ho raha hai...
echo     - Super Admin Control: http://localhost:3000
echo     - Live Voter Portal:   https://jit9763.github.io/voter-portal/
echo     - Live BLO Portal:     https://jit9763.github.io/blo-portal/
echo.
echo  [AUTO-PULL & AUTO-PUSH ACTIVE]
echo  - Har 5 minute me background me GitHub difference check hokar naye
echo    updates automatically fetch aur update hote rahenge.
echo  - Jab bhi aap Super Admin me setting badlenge, wo GitHub par push
echo    hone se pehle latest code PULL karega aur fir PUSH karega.
echo  Is window ko band MAT karein!
echo ==============================================================================
echo.

cd /d "%PAN_DIR%"

start "" "http://localhost:3000"

"C:\Users\HP\AppData\Local\Programs\nodejs\node.exe" server.js

echo.
echo Server band ho gaya.
pause
