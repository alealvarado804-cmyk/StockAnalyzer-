# scripts/smoke.ps1 - Pre-push safety net for StockLens + IC DataLayer.
#
# Runs the compile gate (does StockAnalyzer.jsx still compile?) and then the
# headless mount-check (do both apps still mount with a clean console?).
# A TDZ does NOT break the build but DOES break the mount - this catches it.
#
# Usage (from the StockAnalyzer repo root):
#   powershell -ExecutionPolicy Bypass -File scripts\smoke.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\smoke.ps1 https://my-preview.vercel.app
#
# Costs $0: the smoke-test only checks MOUNT, never loads ticker data.
$ErrorActionPreference = 'Stop'
$node = 'C:\Users\aaao0\bin\node.exe'   # PowerShell has no node on PATH in this env
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "`n[1/2] Compile gate (StockAnalyzer.jsx -> babel)..." -ForegroundColor Cyan
& $node (Join-Path $here 'compile-check.js')
if ($LASTEXITCODE -ne 0) { Write-Host "Compile gate FAILED - aborting." -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host "`n[2/2] Headless mount-check (both apps, peeled)..." -ForegroundColor Cyan
& $node (Join-Path $here 'smoke.js') @args
exit $LASTEXITCODE
