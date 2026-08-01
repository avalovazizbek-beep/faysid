@echo off
chcp 65001 >nul
title FaceHub Lokal Server - o'rnatish
cd /d "%~dp0"

echo =================================================
echo  FaceHub Lokal Server - o'rnatish
echo =================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [XATO] Kompyuterda Node.js o'rnatilmagan.
    echo.
    echo Iltimos avval quyidagi manzildan Node.js ni yuklab o'rnating:
    echo    https://nodejs.org
    echo ^("LTS" tugmasini bosing, o'rnatishda hammasini "Next" bilan o'tkazing^)
    echo O'rnatib bo'lgach, ushbu install.bat faylini qayta ishga tushiring.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js topildi:
node -v
echo.

where pm2 >nul 2>nul
if errorlevel 1 (
    echo pm2 topilmadi, o'rnatilyapti ^(bir marta, biroz vaqt olishi mumkin^)...
    call npm install -g pm2
    echo.
)

echo [OK] pm2 tayyor:
call pm2 -v
echo.

node setup.js

echo.
echo Bu oynani yopishingiz mumkin - server fonda ishlashda davom etadi.
pause
