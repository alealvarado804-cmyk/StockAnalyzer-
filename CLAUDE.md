# CLAUDE.md — StockLens
## Project
React 18 UMD stock analysis app (micro analysis). JSX source compiled to plain JS via babel-standalone.
Live: https://stock-lens-app.vercel.app  (old stock-analyzer-blue-beta.vercel.app 307-redirects here)
GitHub: alealvarado804-cmyk/StockAnalyzer- → main branch (Vercel auto-deploys on push)
## Critical Workflow — ALWAYS in this order
1. Edit `StockAnalyzer.jsx` (source of truth — NEVER touch StockAnalyzer.js)
2. Compile: `"/c/Users/aaao0/bin/node.exe" -e "const fs=require('fs');const babel=require('C:/Users/aaao0/bin/babel-standalone.js');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transform(src,{presets:['react'],filename:'StockAnalyzer.jsx',sourceType:'script'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"`
3. Verify: command prints "OK <bytes>", `ReactDOM` present in .js, tail not truncated. (Size may shrink if code was removed — that's fine; what matters is it compiled.)
4. Commit BOTH: `git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "..."`
5. Push: `git push origin main`
## Architecture (post Fase-0 security migration, 2026-05-22)
- React 18 UMD — no imports, global React from CDN. Hooks destructured at top: `const { useState, ... } = React;`
- Supabase SDK loaded in index.html (`unpkg.com/@supabase/supabase-js@2`) BEFORE StockAnalyzer.js.
- **NO API KEYS IN THE CLIENT.** All data flows through the shared proxy (see ../ic-proxy and memory `project_ic_proxy`).
  - `PROXY_URL = https://ic-proxy-psi.vercel.app`
  - `authedFetch(path, opts)` attaches the Supabase JWT (`Authorization: Bearer …`) and calls the proxy.
  - `fmpGet` → `/api/fmp/...` · `finnhubGet` → `/api/finnhub/...` · `fetchAiVerdict` → POST `/api/anthropic/messages`
  - Handle proxy statuses: 401 (re-login), 429 (rate limit — wait 1 min), 403 (endpoint not allowed).
- Auth: Supabase **magic link**. `LoginScreen` (`sb.auth.signInWithOtp`) renders when no session; logout button (top-right) calls `sb.auth.signOut()`. Session managed in App() via `getSession` + `onAuthStateChange`.
- FMP still uses `/stable/` field names (the proxy passes through to FMP /stable/).
## Scoring
calcScores() returns: { val(0-25), hlth(0-30), mom(0-25), growth(0-20), total(0-100) }
getRating(score): 80+ STRONG BUY · 65+ BUY · 50+ HOLD · 35+ CAUTION · below AVOID
## Key components (all in StockAnalyzer.jsx)
- calcScores, getRating, SECTOR_BM, ScoreGauge, ScoreBar, KPIBadge, PeerComparison,
  VerdictSection (Research tab), HealthScorePanel, TechnicalSignals (Overview), DCFCalculator,
  EarningsSurpriseChart, InsiderTable, AnalystPanel, LoginScreen (auth gate)
## NEVER
- Never run `node --check`
- Never edit StockAnalyzer.js directly
- Never put API keys in the client / localStorage (sl_fmp · sl_finnhub · sl_anthropic are GONE — everything goes through the proxy)
- Never use /api/v3/ FMP endpoints (proxy uses /stable/)
- Never commit only one of StockAnalyzer.jsx / StockAnalyzer.js
- Never use the system npm (broken in this environment) — use babel-standalone
- Never reference InvestingPro (Alejandro wants StockLens to be an independent tool)
