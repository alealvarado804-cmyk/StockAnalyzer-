@echo off
REM ============================================================
REM  StockLens — Push all files to GitHub (run ONCE)
REM ============================================================
cd /d "C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer"

echo Cleaning stale git locks...
if exist ".git\index.lock" del /f ".git\index.lock"
if exist ".git\config.lock" del /f ".git\config.lock"

echo Setting git config...
git config user.email "alealvarado804@gmail.com"
git config user.name "Alejandro"
git remote remove origin 2>nul
git remote add origin https://github.com/alealvarado804-cmyk/StockAnalyzer-.git
git checkout -b main 2>nul || git checkout main 2>nul

echo Adding files...
git add index.html StockAnalyzer.js StockAnalyzer.jsx .gitignore SETUP_STOCKLENS.bat COMPILE_AND_PUSH.bat

echo Committing...
git commit -m "feat: StockLens v1.0 - full app"

echo Force-pushing to GitHub...
git push -f origin main

echo.
echo ============================================================
echo  DONE! Vercel auto-deploys in ~30 seconds.
echo  URL: https://stock-analyzer-blue-beta.vercel.app
echo ============================================================
pause
