@echo off
REM ============================================================
REM  StockLens — GitHub + Vercel setup (run ONCE from Windows)
REM ============================================================
REM STEP 1: Create a new repo on GitHub.com called "StockAnalyzer"
REM         (public or private, no README)
REM         Then paste your GitHub username below:

set GH_USER=aaao0

REM ============================================================
cd /d "C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer"

echo Initializing git repo...
git init -b main
git config user.email "alealvarado804@gmail.com"
git config user.name "Alejandro"

echo Adding files...
git add .
git commit -m "feat: StockLens v1.0 - InvestingPro-style stock analyzer"

echo Adding GitHub remote...
git remote add origin https://github.com/%GH_USER%/StockAnalyzer.git

echo Pushing to GitHub...
git push -u origin main

echo.
echo ============================================================
echo  DONE! Now go to vercel.com:
echo  1. New Project -> Import from GitHub -> StockAnalyzer
echo  2. Framework: Other (static)
echo  3. Deploy!
echo ============================================================
pause
