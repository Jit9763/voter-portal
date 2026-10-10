# -*- coding: utf-8 -*-
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "पंचायत चुनाव 2026 - सुपर एडमिन कंट्रोल पैनल"

$baseDir = "C:\Users\jiten\Desktop\panchayat chunav"
if (-not (Test-Path "$baseDir\voter_portal\server.js")) {
    $baseDir = "C:\Users\jiten\Desktop\panchyt order"
}
$portalDir = "$baseDir\voter_portal"
Set-Location $portalDir

function Free-Port3000 {
    try {
        $conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

function Run-FetchRemote {
    Write-Host "`n[📥 FETCH] गिटहब से नवीनतम सेटिंग्स फेच की जा रही हैं..." -ForegroundColor Cyan
    git -C "$portalDir" fetch origin main --quiet 2>$null
    git -C "$portalDir" merge origin/main --no-edit -m "merge: auto sync remote" --quiet 2>$null
    python "$baseDir\build_tri_portal_repos.py" *>$null
    Write-Host "[✓ SUCCESS] ऑनलाइन सेटिंग्स सफलतापूर्वक फेच व सिंक हो चुकी हैं!`n" -ForegroundColor Green
}

function Run-DeployTriPortals {
    Write-Host "`n[⚡ DEPLOY] तीनों पोर्टल्स (pan, blo-portal, voter-portal) पर डिप्लॉय किया जा रहा है..." -ForegroundColor Yellow
    git -C "$portalDir" fetch origin main --quiet 2>$null
    git -C "$portalDir" merge origin/main --no-edit -m "merge: auto sync remote" --quiet 2>$null
    python "$baseDir\deploy_tri_portals.py"
    Write-Host "`n[✓ SUCCESS] तीनों पोर्टल्स गिटहब पर लाइव अपडेट हो चुके हैं!`n" -ForegroundColor Green
}

Clear-Host
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "  🗳️ पंचायत चुनाव 2026 - मुख्य व्यवस्थापक (Super Admin) कंट्रोल सर्वर" -ForegroundColor Yellow
Write-Host "  Panchayat Chunav Portal - Auto-Fetch, Live Server & Tri-Repo Sync Engine" -ForegroundColor White
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "  लोकल एडमिन URL (Local URL)  : http://localhost:3000" -ForegroundColor Green
Write-Host "  मास्टर एडमिन पोर्टल (Pan)   : https://jit9763.github.io/pan/" -ForegroundColor White
Write-Host "  बी.एल.ओ. पोर्टल (BLO)        : https://jit9763.github.io/blo-portal/" -ForegroundColor White
Write-Host "  पब्लिक वोटर पोर्टल (Voter)   : https://jit9763.github.io/voter-portal/" -ForegroundColor White
Write-Host "  जिला: अजमेर (AJMER)          : समस्त 30 ग्राम पंचायतें" -ForegroundColor DarkGray
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  [1] 🚀 सुपर एडमिन सर्वर चालू करें (Start Local Server & Auto-Sync) [डिफ़ॉल्ट]" -ForegroundColor Green
Write-Host "  [2] ⚡ अभी तुरंत सभी सेटिंग्स तीनों पोर्टल्स पर पुश करें (One-Click Sync & Push)" -ForegroundColor Yellow
Write-Host "  [3] 📥 ऑनलाइन / गिटहब से नवीनतम सेटिंग्स फेच करें (Fetch Remote Settings)" -ForegroundColor Cyan
Write-Host "  [4] 🌐 तीनों लाइव ऑनलाइन पोर्टल्स ब्राउज़र में खोलें (Open Live Links)" -ForegroundColor Magenta
Write-Host "  [0] बाहर निकलें (Exit)" -ForegroundColor Gray
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host ""

$choice = Read-Host "विकल्प चुनें [1/2/3/4/0] (Enter दबाने पर विकल्प 1 स्वतः शुरू होगा)"
if ([string]::IsNullOrWhiteSpace($choice)) {
    $choice = "1"
}

if ($choice -eq "2") {
    Run-DeployTriPortals
    Write-Host ""
    $null = Read-Host "जारी रखने के लिए Enter दबाएं..."
    exit 0
}
elseif ($choice -eq "3") {
    Run-FetchRemote
    Write-Host ""
    $null = Read-Host "जारी रखने के लिए Enter दबाएं..."
    exit 0
}
elseif ($choice -eq "4") {
    Start-Process "https://jit9763.github.io/pan/"
    Start-Process "https://jit9763.github.io/blo-portal/"
    Start-Process "https://jit9763.github.io/voter-portal/"
    exit 0
}
elseif ($choice -eq "0") {
    exit 0
}

# Option 1: Start Server
Clear-Host
Write-Host "=========================================================================" -ForegroundColor Cyan
Write-Host "  🚀 सुपर एडमिन लोकल सर्वर चालू हो रहा है..." -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Cyan

# 1. Fetch remote settings first
Run-FetchRemote

# 2. Clean port 3000
Write-Host "[🧹 PORT] पोर्ट 3000 को साफ़ किया जा रहा है..." -ForegroundColor DarkGray
Free-Port3000

# 3. Open browser
Write-Host "[🌐 BROWSER] ब्राउज़र में लोकल एडमिन खोला जा रहा है..." -ForegroundColor Cyan
Start-Process -FilePath "cmd.exe" -ArgumentList "/c timeout /t 2 /nobreak >nul & start http://localhost:3000" -WindowStyle Hidden

Write-Host ""
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "  ✓ सर्वर सफलतापूर्वक चालू है! (Port: 3000)" -ForegroundColor Green
Write-Host "  ✓ URL: http://localhost:3000" -ForegroundColor White
Write-Host "  ⚡ ऑटो-सिंक सक्रिय: जब भी आप कोई परमिशन या सेटिंग बदलेंगे," -ForegroundColor Yellow
Write-Host "     यह स्वतः तीनों गिटहब पोर्टल्स (pan, blo-portal, voter-portal) पर पुश हो जाएगी।" -ForegroundColor Yellow
Write-Host "=========================================================================" -ForegroundColor Green
Write-Host "  💡 नोट: काम करने के दौरान इस विंडो को बंद न करें।" -ForegroundColor DarkGray
Write-Host ""

node server.js
