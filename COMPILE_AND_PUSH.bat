@echo off
REM ============================================================
REM  StockLens — Compile JSX + Push (use after every JSX edit)
REM ============================================================
cd /d "C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer"

echo Compiling StockAnalyzer.jsx...
"C:\Users\aaao0\bin\node.exe" "C:\Users\aaao0\bin\compile_jsx.js" StockAnalyzer.jsx StockAnalyzer.js

if %ERRORLEVEL% NEQ 0 (
  echo COMPILE FAILED - aborting
  pause
  exit /b 1
)

echo Pushing to GitHub...
git add StockAnalyzer.js StockAnalyzer.jsx
git commit -m "update: StockLens recompile"
git push origin main

echo DONE - Vercel will auto-deploy in ~30s
pause
