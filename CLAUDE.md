# CLAUDE.md — StockLens v3.0
## Project
React 18 UMD stock analysis app. JSX source compiled to plain JS via Babel.
Live: https://stock-analyzer-blue-beta.vercel.app
GitHub: alealvarado804-cmyk/StockAnalyzer- → main branch
## Critical Workflow — ALWAYS in this order
1. Edit `StockAnalyzer.jsx` (source of truth — NEVER touch StockAnalyzer.js)
2. Compile: `"/c/Users/aaao0/bin/node.exe" -e "const fs=require('fs');const babel=require('C:/Users/aaao0/bin/babel-standalone.js');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transform(src,{presets:['react'],filename:'StockAnalyzer.jsx',sourceType:'script'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"`
3. Verify: check bytes printed (must be bigger than before)
4. Commit: `git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "..."`
5. Push: `git push origin main`
## Architecture
- React 18 UMD — no imports, global React from CDN
- All hooks destructured at top: `const { useState, ... } = React;`
- FMP base URL: `https://financialmodelingprep.com/stable/`
- API keys in localStorage: sl_fmp · sl_finnhub · sl_anthropic
- Babel: babel-standalone at C:/Users/aaao0/bin/babel-standalone.js
## Scoring
calcScores() returns: { val(0-25), hlth(0-30), mom(0-25), growth(0-20), total(0-100) }
getRating(score): 80+ STRONG BUY · 65+ BUY · 50+ HOLD · 35+ CAUTION · below AVOID
## Key components (all in StockAnalyzer.jsx)
- calcScores() — master scoring engine
- getRating() — label/color from score
- SECTOR_BM — sector P/E, EV/EBITDA, GM, ROIC benchmarks
- ScoreGauge — SVG circular gauge
- ScoreBar — horizontal progress bar
- KPIBadge — metric vs sector benchmark
- PeerComparison — multi-stock comparison table
- VerdictSection — Bull/Bear/AI verdict (Research tab)
- HealthScorePanel — 5-dimension dot matrix
- TechnicalSignals — RSI, vs 50/200 DMA (Overview tab)
- DCFCalculator — interactive DCF sliders
- EarningsSurpriseChart — beat/miss bar chart
- InsiderTable — insider buy/sell table
- AnalystPanel — analyst consensus + price targets
## Data flow in App()
- met/rat — FMP key-metrics-ttm / ratios-ttm (single object each)
- hist — FMP historical-price-eod/full (array of OHLCV)
- stmts — FMP income-statement quarterly (array)
- prof — FMP profile (single object)
- History sorted ascending inside components via [...history].sort()
## NEVER
- Never run node --check
- Never edit StockAnalyzer.js directly
- Never use /api/v3/ FMP endpoints (always /stable/)
- Never commit only one of StockAnalyzer.jsx / StockAnalyzer.js
- Never use the system npm (broken in this environment) — use babel-standalone
