# StockLens v2.0 — Master Improvement Prompt

## CONTEXT & MISSION

You are rebuilding **StockLens**, a stock analysis React app inspired by InvestingPro. The current version (v1.0) is live at `stock-analyzer-blue-beta.vercel.app`. You have the complete source code below and must produce an improved v2.0 version.

**Architecture constraints — DO NOT CHANGE:**
- React 18 UMD loaded from CDN (`unpkg.com`) — no npm, no Webpack, no build step in browser
- All code in a single `StockAnalyzer.jsx` file, pre-compiled to `StockAnalyzer.js` via Babel (you must do this)
- NO `import` or `require` statements in JSX — use `const { useState, useCallback, useMemo, useRef, useEffect } = React;`
- No external JS libraries (no Chart.js, no D3) — all charts are pure SVG
- `index.html` loads React UMD from CDN + compiled `StockAnalyzer.js` — leave `index.html` unchanged
- Google Fonts already loaded: DM Sans (body), JetBrains Mono (data/numbers) — use them
- FMP API key hardcoded: `wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2` (also stored in `localStorage.sl_fmp`)
- After editing JSX, compile with Babel: `node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);"`

---

## CURRENT CODEBASE — StockAnalyzer.jsx (full, ~830 lines)

```jsx
[PASTE FULL StockAnalyzer.jsx HERE — or read it from the file at:
C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer\StockAnalyzer.jsx]
```

---

## BUG FIXES (CRITICAL — fix these first)

### Bug 1 — "Ticker not found" on valid tickers (e.g., META)
**Root cause:** In `fmpGet()`, line:
```js
if (Array.isArray(data) && data.length===0) throw new Error(`No data found for ticker`);
```
This throws for ANY endpoint that returns empty array (e.g., if `/key-metrics-ttm/META` returns `[]` due to plan restrictions). Since `Promise.allSettled` catches it, `qD` becomes null and the whole analysis fails with a misleading error.

**Fix:** Change `fmpGet` so it does NOT throw on empty arrays — return `null` silently instead. Only throw on genuine HTTP errors (4xx/5xx) or explicit FMP error messages. Let each piece of data be optional:
```js
const fmpGet = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${fmpKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.['Error Message']) throw new Error(data['Error Message']);
  if (Array.isArray(data) && data.length === 0) return null; // silent null, not throw
  return data;
};
```
Then: only throw the "Ticker not found" error if BOTH `/quote` AND `/profile` return null.

### Bug 2 — YoY revenue growth calculation is wrong
Line: `const prev = stmts[stmts.length - 1 - i + 4]` — this logic is incorrect.
**Fix:** Properly find the year-ago quarter by matching `period` + comparing `calendarYear`:
```js
const yoyQuarter = stmts.find(s =>
  s.period === q.period && parseInt(s.calendarYear) === parseInt(q.calendarYear) - 1
);
const yoy = yoyQuarter?.revenue > 0 ? (q.revenue - yoyQuarter.revenue) / yoyQuarter.revenue : null;
```

### Bug 3 — Price chart crashes if all prices are identical
`const range = maxP - minP || 1;` — fine, but `px(i)` divides by `prices.length - 1` which fails for length=1. Add guard: `if (prices.length < 2) return null;`

---

## NEW FEATURES TO ADD

### Feature 1 — Analyst Consensus Panel
Add a new section after the Score panel showing Wall Street analyst data from FMP.

**New API calls to add** (add to `Promise.allSettled` array):
```js
fmpGet(`/price-target-consensus/${sym}`),        // analyst PT consensus
fmpGet(`/analyst-estimates/${sym}?limit=4`),     // forward EPS/Rev estimates
fmpGet(`/upgrades-downgrades-consensus/${sym}`), // buy/hold/sell consensus
```

**What to render:**
- Analyst rating (Strong Buy / Buy / Hold / Sell) from consensus — show with colored badge
- Consensus price target vs current price → upside/downside % with colored arrow
- Number of analysts covering (from `strongBuy + buy + hold + sell + strongSell`)
- Forward P/E (current price / next year EPS estimate from `analystEstimates`)
- Forward revenue growth estimate (next year revenue vs TTM revenue)
- A simple horizontal bar showing distribution: [██████░░░░] Buy vs Hold vs Sell

### Feature 2 — DCF Intrinsic Value Estimate
Add FMP's DCF endpoint:
```js
fmpGet(`/discounted-cash-flow/${sym}`),
```
Show in the header panel next to market price:
- "Intrinsic Value: $XXX.XX (FMP DCF)" 
- Margin of safety % = (intrinsicValue - currentPrice) / intrinsicValue
- Color: green if >15% margin, amber if -15% to +15%, red if >15% overvalued

### Feature 3 — Company Logo in Header
FMP `/profile` returns `image` field (company logo URL). Add it to the company header:
```js
{prof?.image && (
  <img src={prof.image} alt={ticker}
    style={{width:40, height:40, objectFit:'contain', borderRadius:6,
            background:'#fff', padding:4}} />
)}
```
Place it to the left of the ticker name.

### Feature 4 — Enhanced Price Chart with Hover Tooltip
The current chart is static SVG with no interactivity. Upgrade it:
- Add SVG `onMouseMove` / `onMouseLeave` for crosshair + tooltip
- Show date + OHLC data on hover (use `historical` data which has OHLC)
- Add 52-week high/low markers on the chart (thin dashed lines)
- Add moving average line (50-day SMA) — compute from the price history array
- Add volume bars at the bottom (scaled to 20% of chart height)
- Chart height should increase to 180px (from 110px)
- Add period selector buttons: [1M] [3M] [6M] [1Y] — filter the `historical` array shown

### Feature 5 — Search History (last 5 tickers)
Store last 5 searched tickers in `localStorage.sl_history`. Show them as clickable chips below the search bar (in the navbar). On click, re-run analysis.

```js
// After successful analysis, add to history:
const hist5 = [sym, ...JSON.parse(localStorage.getItem('sl_history')||'[]')]
  .filter((t,i,a)=>a.indexOf(t)===i).slice(0,5);
localStorage.setItem('sl_history', JSON.stringify(hist5));
```

### Feature 6 — Growth Metrics Section (new panel)
Add a "Growth Profile" panel showing quarterly trends as sparklines (mini inline SVG charts — 60px tall):
- Revenue per quarter (last 8 quarters) as bar chart sparkline
- Net income per quarter as bar chart sparkline
- EPS per quarter (line) with beat/miss markers
- Gross margin trend per quarter (line)
- CAGR label next to each: "Revenue CAGR 3Y: +18.4%"

Compute CAGR from income statements:
```js
const cagr = (first, last, years) => Math.pow(last / first, 1/years) - 1;
```

### Feature 7 — Tabbed Layout
Replace the linear single-scroll layout with 4 tabs:
- **Overview** — Score gauge + KPI grid + company header + analyst consensus + DCF
- **Fundamentals** — Health cards + Growth sparklines + Quarterly table
- **Chart** — Full-width enhanced price chart + technical section
- **Research** — Verdict section + Quality signals/risks + News

Use `useState` for active tab. Tab bar sits just below the company header, sticky within the content area. Style like InvestingPro — dark underline tab, selected has blue accent:
```jsx
const tabs = ['Overview','Fundamentals','Chart','Research'];
// Tab bar style: bottom border highlight on active
```

### Feature 8 — Technical Signals Section (in Chart tab)
Compute from `historical` price data (no new API calls needed):
- **RSI (14-day)**: compute from close prices, show colored badge (overbought >70 = red, oversold <30 = green, neutral = amber)
- **200-day SMA**: current price vs 200-day SMA → above = bullish, below = bearish
- **50-day SMA**: same
- **52-week high/low**: show price range, where current price sits
- **ATH distance**: how far from all-time high in dataset

Show as a row of signal badges:
```
RSI 14: [42 — NEUTRAL]  |  vs 50MA: [▲ +8.4%]  |  vs 200MA: [▲ +12.1%]  |  52W Range: ████░░ 73% of range
```

### Feature 9 — Loading Skeleton
Replace the `<Spinner/>` with a skeleton loading UI that mirrors the actual layout. Show gray animated blocks where panels will appear. This gives the app a polished, professional feel.

```jsx
function Skeleton({width='100%', height=16, style={}}) {
  return (
    <div style={{
      background:'linear-gradient(90deg,#141720 25%,#1e2430 50%,#141720 75%)',
      backgroundSize:'200% 100%',
      animation:'shimmer 1.5s infinite',
      borderRadius:4, width, height, ...style
    }}/>
  );
}
// Add @keyframes shimmer to the style tag
```

### Feature 10 — Sector/Industry Benchmarking Text
In the KPI badges and Health cards, show where the metric stands vs sector average. Add static benchmark data for 8 sectors (Tech, Healthcare, Financials, Consumer, Energy, Industrials, Utilities, REITs):

```js
const SECTOR_BENCHMARKS = {
  'Technology': { pe: 28, ev: 18, gm: 0.55, roic: 0.18, nd: -0.5 },
  'Healthcare': { pe: 22, ev: 14, gm: 0.60, roic: 0.12, nd: 0.5 },
  'Consumer Discretionary': { pe: 20, ev: 12, gm: 0.35, roic: 0.14, nd: 1.0 },
  'Consumer Staples': { pe: 18, ev: 12, gm: 0.38, roic: 0.16, nd: 1.5 },
  'Energy': { pe: 12, ev: 7, gm: 0.30, roic: 0.10, nd: 1.0 },
  'Financials': { pe: 12, ev: null, gm: null, roic: 0.10, nd: null },
  'Industrials': { pe: 18, ev: 12, gm: 0.30, roic: 0.12, nd: 1.5 },
  'Utilities': { pe: 15, ev: 10, gm: 0.45, roic: 0.07, nd: 3.0 },
};
```

In each KPI badge, add a tiny line: `vs sector avg: ${sectorAvgPE}x` in gray. If metric is 20% better than sector = show `↑ vs sector` in green.

---

## VISUAL / UI REDESIGN (HIGH PRIORITY)

### Design Philosophy
Inspired by InvestingPro, Bloomberg Terminal aesthetics. Dark, data-dense, professional.
- Background: `#07080c` (even darker than current `#08090d`)
- Panel background: `#0c0e14`
- Panel border: `#161b26`
- Accent blue: `#3b82f6` (keep current)
- Section borders: left border accent style instead of full border

### Specific Style Changes

**1. Score Panel — left accent border:**
Replace full border with left accent:
```jsx
// Panel gets: borderLeft: `3px solid ${ratingColor}`, borderTop: 'none', etc.
```

**2. KPI Badges — add trend arrows:**
Add a trend indicator (▲▼) showing QoQ change vs previous quarter where available.

**3. Company Header — more compact, more data:**
Add a second row with: `CEO: [name] · Founded: [year] · Employees: [N] · Website: [domain]`
Extract CEO from `prof.ceo`, website from `prof.website` (FMP profile endpoint returns these).
Also add exchange badge (colored by exchange: NASDAQ=blue, NYSE=green, etc.)

**4. Verdict section — upgrade to 3-column:**
- Left: Key Bull Case points (quality signals)
- Center: Score gauge + rating
- Right: Key Bear Case points (risk flags)
This makes it look like a proper institutional research verdict.

**5. Color the score gauge arc as gradient:**
Instead of single color, use SVG linearGradient along the arc:
- 0-35: red → 35-65: amber → 65-80: light green → 80-100: bright green
Use multiple circle arcs stacked to create gradient effect.

**6. Sticky company header after scroll:**
When user scrolls past the main header panel, show a compact sticky sub-header showing:
ticker | company name | price | day change | score badge
This way the user always knows what they're looking at as they scroll.

**7. Panel hover effect:**
```css
panel:hover { border-color: #232a3a; transition: border-color 0.2s; }
```

**8. Footer upgrade:**
Show: `Last updated: [timestamp]` | `API: FMP` | `StockLens v2.0` | small disclaimer

---

## SCORING SYSTEM IMPROVEMENTS

### Add 4th dimension: Growth (max 20 pts)
Restructure scoring to 4 categories totaling 100 pts:
- **Valuation** (25 pts) — same metrics, rescaled
- **Financial Health** (30 pts) — same metrics, rescaled
- **Momentum** (25 pts) — same metrics, rescaled
- **Growth** (20 pts) — NEW:
  - Revenue growth YoY latest Q: >30%→6, >20%→5, >10%→4, >0%→2, <0%→0
  - EPS growth YoY latest Q: >30%→5, >20%→4, >10%→3, >0%→1, <0%→0
  - Revenue CAGR 3Y (from income statements): >20%→5, >10%→4, >5%→2, >0%→1
  - Gross margin trend (improving QoQ?): improving→4, stable→2, declining→0

### Sector-adjusted scoring
For financial sector stocks (banks, insurance), skip EV/EBITDA (not applicable) and replace with:
- Price/Book: <1→10pts, <1.5→8, <2→5, etc.
- Net Interest Margin instead of Gross Margin

Detect via `prof?.sector === 'Financial Services'` or `prof?.sector === 'Financials'`

---

## SPECIFIC CODE CHANGES TO MAKE

### 1. Upgrade `analyze()` function — add new endpoints
```js
const results = await Promise.allSettled([
  fmpGet(`/quote/${sym}`),                            // [0] qD
  fmpGet(`/profile/${sym}`),                          // [1] pD
  fmpGet(`/key-metrics-ttm/${sym}`),                  // [2] mD
  fmpGet(`/ratios-ttm/${sym}`),                       // [3] rD
  fmpGet(`/historical-price-full/${sym}?timeseries=365`), // [4] hD
  fmpGet(`/income-statement/${sym}?period=quarter&limit=8`), // [5] sD
  fmpGet(`/stock_news?tickers=${sym}&limit=8`),       // [6] nD
  fmpGet(`/price-target-consensus/${sym}`),           // [7] ptD
  fmpGet(`/analyst-estimates/${sym}?limit=2`),        // [8] aeD
  fmpGet(`/upgrades-downgrades-consensus/${sym}`),    // [9] udD
  fmpGet(`/discounted-cash-flow/${sym}`),             // [10] dcfD
]);
```

### 2. Upgrade App state
```js
const [ptConsensus, setPtConsensus] = useState(null);  // price target
const [analystEst,  setAnalystEst]  = useState(null);  // analyst estimates
const [udConsensus, setUdConsensus] = useState(null);  // upgrades/downgrades
const [dcf,         setDcf]         = useState(null);  // DCF intrinsic value
const [activeTab,   setActiveTab]   = useState('Overview');
const [chartPeriod, setChartPeriod] = useState('1Y');  // 1M/3M/6M/1Y
const [recentTickers, setRecentTickers] = useState(() => 
  JSON.parse(localStorage.getItem('sl_history')||'[]')
);
```

### 3. Add `AnalystPanel` component
```jsx
function AnalystPanel({ consensus, estimates, udConsensus, currentPrice }) {
  if (!consensus && !estimates) return null;
  
  const rating = consensus?.consensus; // "Strong Buy", "Buy", "Hold", "Sell"
  const targetHigh = consensus?.targetHigh;
  const targetLow  = consensus?.targetLow;
  const targetMed  = consensus?.targetMedian || consensus?.targetConsensus;
  const upside = (targetMed && currentPrice) ? (targetMed - currentPrice) / currentPrice : null;
  
  const total = (consensus?.strongBuy||0)+(consensus?.buy||0)+(consensus?.hold||0)+(consensus?.sell||0)+(consensus?.strongSell||0);
  const bullPct = total > 0 ? ((consensus?.strongBuy||0)+(consensus?.buy||0))/total : null;
  const bearPct = total > 0 ? ((consensus?.sell||0)+(consensus?.strongSell||0))/total : null;
  
  // ... render panel
}
```

### 4. Add `TechnicalSignals` component
Computed purely from `hist` (historical prices array):

```js
function computeRSI(prices, period=14) {
  if (prices.length < period + 1) return null;
  const changes = prices.slice(1).map((p,i) => p - prices[i]);
  let gains = 0, losses = 0;
  changes.slice(0, period).forEach(c => { if(c>0) gains+=c; else losses+=Math.abs(c); });
  let avgGain = gains/period;
  let avgLoss = losses/period;
  for (let i = period; i < changes.length; i++) {
    const c = changes[i];
    avgGain = (avgGain * (period-1) + Math.max(0,c)) / period;
    avgLoss = (avgLoss * (period-1) + Math.max(0,-c)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100/(1+rs));
}

function computeSMA(prices, period) {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a,b)=>a+b,0) / period;
}
```

### 5. Chart period filter
In `PriceChart`, add period filtering before computing points:
```js
const PERIODS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 365 };
const filtered = sorted.slice(-PERIODS[period]);
```

---

## LAYOUT RESTRUCTURE (v2.0 final layout)

```
┌─────────────────────────────────────────────────────────────────┐
│ NAVBAR: ⚡StockLens v2.0  |  [recent tickers]  |  [TICKER] [Analyze] [⚙] │
├─────────────────────────────────────────────────────────────────┤
│ COMPANY HEADER PANEL:                                            │
│ [LOGO] AAPL  Apple Inc.                    $213.42  ▲ +1.2%    │
│ NASDAQ · Technology · Consumer Electronics  ▲ +12.4% 12m       │
│ CEO: Tim Cook · 150,000 employees · Est. 1976 · Mkt Cap $3.2T  │
│ [Intrinsic Value: $198.50 — 6.7% overvalued]   [DCF badge]    │
├─────────────────────────────────────────────────────────────────┤
│ TABS: [Overview] [Fundamentals] [Chart] [Research]              │
├─────────────────────────────────────────────────────────────────┤
│ OVERVIEW TAB:                                                    │
│ ┌──────────────┐  ┌─────────────────────────────────────────┐  │
│ │  Score Gauge │  │  Key Metrics TTM (3×3 grid)             │  │
│ │   [87/100]   │  │  P/E   EV/EBITDA  P/FCF                │  │
│ │  STRONG BUY  │  │  GM    ROIC       ND/EBITDA             │  │
│ │  ─────────── │  │  RevGrowth  FCFYield  ROE               │  │
│ │  Val:  25/25 │  └─────────────────────────────────────────┘  │
│ │  Hlth: 28/30 │  ┌─────────────────────────────────────────┐  │
│ │  Mom:  22/25 │  │  Analyst Consensus                      │  │
│ │  Growth:18/20│  │  STRONG BUY (28 analysts)               │  │
│ └──────────────┘  │  Target: $240.00  (+12.4% upside)      │  │
│                   │  ████████░░ 72% buy / 18% hold / 10% sell│  │
│                   └─────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│ FUNDAMENTALS TAB:                                                │
│ [Health Cards 3×2] + [Growth Sparklines] + [Quarterly Table]    │
├─────────────────────────────────────────────────────────────────┤
│ CHART TAB:                                                       │
│ [Period: 1M 3M 6M 1Y] [Full Price Chart with hover + SMA lines] │
│ [Technical Signals: RSI | vs50MA | vs200MA | 52W Range]         │
├─────────────────────────────────────────────────────────────────┤
│ RESEARCH TAB:                                                    │
│ [3-col Verdict: Bull Case | Score | Bear Case]                   │
│ [News Cards]                                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## INVESTMENT PHILOSOPHY EMBEDDED (DO NOT REMOVE)

The verdict section should reflect these frameworks (from Pedro Escudero and Stanley Druckenmiller):

**Quality Framework (Pedro Escudero — embed in verdict text):**
- Quality businesses have ROIC > cost of capital → moat signal
- Pricing power = gross margin stability or expansion over time
- "Good businesses at fair prices" → don't penalize high P/E if ROIC > 20%
- Balance sheet strength is non-negotiable (ND/EBITDA < 2x preferred)

**Momentum as confirming signal (Druckenmiller):**
- Momentum is NOT a standalone reason to buy — it CONFIRMS thesis
- Strong price action + strong fundamentals = highest conviction
- Avoid catching falling knives: weak momentum + weak fundamentals = double danger
- Adjust position sizing based on momentum: STRONG BUY requires BOTH quality AND positive momentum

**Modify verdict text to reflect this:**
```js
// In VerdictSection, update bottom-line text:
const verdictText = {
  'STRONG BUY': `${co} shows exceptional quality fundamentals confirmed by strong price momentum — the combination Druckenmiller calls the highest-conviction setup. ROIC > 20% signals a durable economic moat (Escudero framework). Scoring ${scores.total}/100.`,
  'BUY': `${co} demonstrates solid quality metrics with favorable risk/reward at current prices. Fundamentals support the thesis; momentum is constructive. Scoring ${scores.total}/100.`,
  'HOLD': `${co} has decent fundamentals but current valuation or weak momentum limits near-term upside. Pedro Escudero framework: good business, but wait for a better entry or catalyst. Scoring ${scores.total}/100.`,
  'CAUTION': `${co} shows warning signs on valuation or fundamentals. Momentum is not confirming the bull case. Druckenmiller principle: when price and fundamentals diverge negatively, respect the signal. Scoring ${scores.total}/100.`,
  'AVOID': `${co} fails multiple quality/value/momentum criteria. High risk of capital impairment. Scoring ${scores.total}/100.`,
};
```

---

## AFTER CODING — COMPILATION & DEPLOYMENT INSTRUCTIONS

1. Edit `StockAnalyzer.jsx` with all changes
2. Compile to JS (run in the StockAnalyzer directory):
```bash
node -e "
const fs=require('fs');
const babel=require('@babel/core');
const pr=require('@babel/preset-react');
const src=fs.readFileSync('StockAnalyzer.jsx','utf8');
const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});
fs.writeFileSync('StockAnalyzer.js',r.code);
console.log('Compiled: '+r.code.length+' bytes');
"
```
3. Test locally by opening `index.html` in browser (or use `python -m http.server 8000`)
4. Git add + commit + push:
```bash
git add StockAnalyzer.jsx StockAnalyzer.js
git commit -m "feat: StockLens v2.0 - major upgrade"
git push origin main
```
5. Vercel auto-deploys in ~30 seconds. Verify at `stock-analyzer-blue-beta.vercel.app`

---

## PRIORITY ORDER

Execute in this order:
1. **FIRST:** Fix the 3 bugs (especially the empty-array bug causing META to fail)
2. **SECOND:** Add company logo, DCF intrinsic value to header, search history
3. **THIRD:** Tabbed layout (Overview / Fundamentals / Chart / Research)
4. **FOURTH:** Analyst consensus panel + enhanced price chart with period selector
5. **FIFTH:** Growth metrics panel + scoring upgrade (4th dimension)
6. **SIXTH:** Technical signals (RSI, SMA) + skeleton loading
7. **SEVENTH:** All remaining visual polish (sector benchmarks, verdict text, hover effects)

Start with the bugs, get them working, then layer in features one by one. Compile and test after each major addition.

---

## WHAT SUCCESS LOOKS LIKE

When done, StockLens v2.0 should:
- ✅ Analyze any valid US ticker without false "not found" errors
- ✅ Show company logo + intrinsic value in the header
- ✅ 4 clean tabs (no infinite scroll)
- ✅ Analyst consensus + price targets visible in Overview tab
- ✅ Interactive price chart with 1M/3M/6M/1Y selector
- ✅ RSI + SMA technical signals in Chart tab
- ✅ Growth sparklines showing 8-quarter trend in Fundamentals tab
- ✅ 4-dimensional scoring (Valuation/Health/Momentum/Growth) totaling 100
- ✅ Investment verdict with Druckenmiller/Escudero framework language
- ✅ Polished professional look comparable to InvestingPro
- ✅ Loads in under 2 seconds, smooth transitions between tabs
