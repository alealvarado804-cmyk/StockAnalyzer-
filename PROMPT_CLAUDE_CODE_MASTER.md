# StockLens — Master Fix & Enhancement Prompt

## CONTEXT

You are working on **StockLens**, a React stock analysis app located at:
`C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer\`

**Files:**
- `StockAnalyzer.jsx` — React source (edit this)
- `StockAnalyzer.js` — Compiled output (regenerate after every JSX edit)
- `index.html` — **DO NOT TOUCH**

**Architecture:** React 18 UMD from CDN. No imports. Pre-compiled JSX. No build step in browser.
All React hooks accessed as: `const { useState, useCallback, useMemo, useRef, useEffect } = React;`

**Compile command (run from StockAnalyzer folder):**
```
node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"
```

**After compiling, push:**
```
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "feat: StockLens v3.0 — FMP stable migration + multi-API + setup screen" && git push origin main
```

---

## CRITICAL PROBLEM: FMP API v3 IS DEPRECATED

**ALL** endpoints using `/api/v3/` stopped working for new API keys after August 31, 2025. FMP now returns:
```json
{"Error Message": "Legacy Endpoint: Due to Legacy endpoints being no longer supported..."}
```

This is why every ticker fails with "Ticker not found" — the entire API layer is broken.

**The fix is a complete migration to `/stable/` endpoints.**

---

## CHANGE 1 — FMP API Migration (CRITICAL)

### 1A. New base URL and call format

**OLD** (broken):
```js
const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${fmpKey}`;
// Called like: fmpGet(`/quote/${sym}`)
```

**NEW** (working):
```js
const fmpGet = async (endpoint, params = {}) => {
  const base = 'https://financialmodelingprep.com/stable';
  const qs = new URLSearchParams({ ...params, apikey: fmpKey }).toString();
  const url = `${base}/${endpoint}?${qs}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Network error — check your internet connection');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('Invalid API key — go to Settings ⚙ to update it');
  if (!res.ok) throw new Error(`API error (HTTP ${res.status})`);
  const data = await res.json();
  if (data?.['Error Message']) {
    const msg = data['Error Message'];
    if (msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('upgrade'))
      throw new Error('API daily limit reached (250 calls/day on free plan) — try again tomorrow');
    if (msg.toLowerCase().includes('legacy'))
      throw new Error('FMP Legacy endpoint error — please update your key in Settings ⚙');
    if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('apikey'))
      throw new Error('Invalid API key — go to Settings ⚙ to update it');
    throw new Error(msg);
  }
  if (Array.isArray(data) && data.length === 0) return null;
  return data;
};
```

### 1B. Updated `analyze()` endpoint calls

Replace the entire `Promise.allSettled` block with these calls:

```js
const results = await Promise.allSettled([
  fmpGet('quote',                        { symbol: sym }),                    // 0
  fmpGet('profile',                      { symbol: sym }),                    // 1
  fmpGet('key-metrics-ttm',              { symbol: sym }),                    // 2
  fmpGet('ratios-ttm',                   { symbol: sym }),                    // 3
  fmpGet('historical-price-eod/full',    { symbol: sym }),                    // 4
  fmpGet('income-statement',             { symbol: sym, period: 'quarter', limit: '4' }), // 5
  fmpGet('news',                         { tickers: sym, limit: '8' }),       // 6
  fmpGet('price-target-consensus',       { symbol: sym }),                    // 7
  fmpGet('analyst-estimates',            { symbol: sym, limit: '2' }),        // 8
  fmpGet('upgrades-downgrades-consensus',{ symbol: sym }),                    // 9
  fmpGet('discounted-cash-flow',         { symbol: sym }),                    // 10
]);
```

**Important limit change:** income-statement limit is `'4'` (not `8`) — free tier maximum.

### 1C. Historical price data structure fix

**OLD:**
```js
setHist(hD?.historical || []);
```

**NEW** — the `/stable/historical-price-eod/full` endpoint returns a flat array directly (no `.historical` wrapper):
```js
setHist(Array.isArray(hD) ? hD : []);
```

### 1D. Field name changes — update ALL references in the codebase

These are the field renames from v3 to stable. Search and replace EVERY occurrence:

| Context | OLD field name | NEW field name |
|---------|---------------|----------------|
| `met` (key-metrics-ttm) | `peRatioTTM` | `priceToEarningsRatioTTM` |
| `met` (key-metrics-ttm) | `enterpriseValueOverEBITDATTM` | `evToEBITDATTM` |
| `met` (key-metrics-ttm) | `pfcfRatioTTM` | `priceToFreeCashFlowRatioTTM` |
| `met` (key-metrics-ttm) | `roicTTM` | `returnOnInvestedCapitalTTM` |
| `met` (key-metrics-ttm) | `roeTTM` | `returnOnEquityTTM` |
| `met` (key-metrics-ttm) | `interestCoverageTTM` | `interestCoverageRatioTTM` |
| `rat` (ratios-ttm) | `priceFairValueTTM` | `priceToFairValueTTM` |
| `quote` | `changesPercentage` | `changePercentage` |
| `quote` | `avgVolume` | `averageVolume` |

**Apply these everywhere:** in `calcScores()`, `healthCards` useMemo, `VerdictSection`, the company header, and anywhere else these fields are referenced.

---

## CHANGE 2 — First-Run Setup Screen (Mandatory API Key Entry)

Follow the IC DataLayer pattern exactly.

### 2A. New state variable

Add this state at the top of the `App()` component (above all other state):

```js
const [keysSubmitted, setKeysSubmitted] = useState(() => {
  try {
    const stored = localStorage.getItem('sl_fmp');
    return !!(stored && stored.trim().length > 10);
  } catch { return false; }
});
const [setupKey,    setSetupKey]    = useState('');
const [setupStatus, setSetupStatus] = useState(null); // null | 'testing' | 'ok' | {error: string}
```

### 2B. Setup screen component (add before the return of App())

Replace the first line of the `return (` block with:

```jsx
if (!keysSubmitted) {
  const testAndSave = async () => {
    if (!setupKey.trim()) return;
    setSetupStatus('testing');
    try {
      const res = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${setupKey.trim()}`);
      const data = await res.json();
      if (data?.['Error Message']) {
        const msg = data['Error Message'].toLowerCase();
        if (msg.includes('limit') || msg.includes('upgrade'))
          return setSetupStatus({ error: 'This key has reached its daily limit (250 calls/day on free plan). Try again tomorrow or use a different key.' });
        if (msg.includes('legacy'))
          return setSetupStatus({ error: 'This key returned a legacy endpoint error. Try generating a new key at financialmodelingprep.com.' });
        return setSetupStatus({ error: 'Invalid API key. Check it and try again.' });
      }
      if (!Array.isArray(data) || data.length === 0)
        return setSetupStatus({ error: 'Could not validate key — unexpected response. Check the key and try again.' });
      // Success
      localStorage.setItem('sl_fmp', setupKey.trim());
      setFmpKey(setupKey.trim());
      setKeysSubmitted(true);
    } catch (e) {
      setSetupStatus({ error: 'Network error — check your internet connection.' });
    }
  };

  return (
    <div style={{
      minHeight:'100vh', background:'#07080c', color:'#e2e8f0',
      fontFamily:"'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif",
      display:'flex', alignItems:'center', justifyContent:'center', padding:24
    }}>
      <style>{`*{box-sizing:border-box} @keyframes spin{to{transform:rotate(360deg)}} input::placeholder{color:#334155}`}</style>
      <div style={{
        background:'#0c0e14', border:'1px solid #1e2430', borderRadius:14,
        padding:'44px 40px', maxWidth:460, width:'100%', textAlign:'center'
      }}>
        <div style={{fontSize:44, marginBottom:12}}>⚡</div>
        <div style={{fontSize:26, fontWeight:800, color:'#fff', marginBottom:6}}>StockLens</div>
        <div style={{fontSize:13, color:'#475569', marginBottom:32, lineHeight:1.7}}>
          Professional stock analysis — powered by Financial Modeling Prep.
          <br/>Enter your free API key to get started.
        </div>

        {/* Step 1 */}
        <div style={{
          background:'#141720', border:'1px solid #1e2430', borderRadius:8,
          padding:'14px 16px', marginBottom:20, textAlign:'left'
        }}>
          <div style={{fontSize:10, fontWeight:700, color:'#3b82f6', textTransform:'uppercase', letterSpacing:'1px', marginBottom:8}}>
            Step 1 — Get a free API key
          </div>
          <div style={{fontSize:12, color:'#64748b', lineHeight:1.7, marginBottom:8}}>
            Create a free account at Financial Modeling Prep to get your API key:
          </div>
          <a
            href="https://site.financialmodelingprep.com/register"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:'inline-block', fontSize:12, color:'#60a5fa',
              background:'#1e3a5f44', border:'1px solid #1e3a5f',
              padding:'5px 12px', borderRadius:5, textDecoration:'none'
            }}
          >
            financialmodelingprep.com/register ↗
          </a>
        </div>

        {/* Step 2 */}
        <div style={{textAlign:'left', marginBottom:20}}>
          <div style={{fontSize:10, fontWeight:700, color:'#3b82f6', textTransform:'uppercase', letterSpacing:'1px', marginBottom:8}}>
            Step 2 — Paste your key below
          </div>
          <input
            value={setupKey}
            onChange={e => setSetupKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && testAndSave()}
            placeholder="Enter your FMP API key..."
            style={{
              width:'100%', background:'#141720', border:'1px solid #1e2430',
              color:'#e2e8f0', padding:'10px 14px', borderRadius:6,
              fontSize:13, outline:'none', marginBottom:10
            }}
          />
          <button
            onClick={testAndSave}
            disabled={setupStatus === 'testing' || !setupKey.trim()}
            style={{
              width:'100%', background: setupStatus === 'testing' ? '#1e2430' : '#3b82f6',
              color:'#fff', border:'none', padding:'10px 0', borderRadius:6,
              cursor: setupStatus === 'testing' ? 'not-allowed' : 'pointer',
              fontSize:14, fontWeight:700
            }}
          >
            {setupStatus === 'testing' ? (
              <span style={{display:'flex', alignItems:'center', justifyContent:'center', gap:8}}>
                <span style={{display:'inline-block', width:14, height:14, border:'2px solid #64748b', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.7s linear infinite'}}/>
                Testing...
              </span>
            ) : 'Test & Save Key'}
          </button>
        </div>

        {/* Error message */}
        {setupStatus && typeof setupStatus === 'object' && setupStatus.error && (
          <div style={{
            background:'#2a0d0d', border:'1px solid #7f1d1d', borderRadius:6,
            padding:'10px 14px', fontSize:12, color:'#f87171', marginBottom:12, textAlign:'left'
          }}>
            ⚠ {setupStatus.error}
          </div>
        )}

        <div style={{fontSize:10, color:'#1e2430', marginTop:16, lineHeight:1.6}}>
          Free plan: 250 API calls/day — enough for ~25 tickers/day.<br/>
          Your key is stored locally in your browser only.
        </div>
      </div>
    </div>
  );
}
```

Note: This block is placed **inside** `App()`, right before the normal `return (` of the app. It returns early if `!keysSubmitted`.

### 2C. Updated Settings panel

Replace the existing `{showCfg && (...)}` settings panel with this enhanced version that has Reset Key and Test Connection:

```jsx
{showCfg && (
  <div style={{background:'#0a0b10',borderBottom:'1px solid #161b26',padding:'16px 24px',display:'flex',flexDirection:'column',gap:12}}>
    <div style={{fontSize:11,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'1px'}}>API Settings</div>
    <div style={{display:'flex',gap:12,alignItems:'flex-end',flexWrap:'wrap'}}>
      <div>
        <div style={{fontSize:10,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.5px'}}>FMP API Key</div>
        <input
          value={fmpKey}
          onChange={e => setFmpKey(e.target.value)}
          style={{background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'6px 11px',borderRadius:6,fontSize:12,width:300,outline:'none'}}
        />
      </div>
      <button onClick={() => { localStorage.setItem('sl_fmp', fmpKey); setShowCfg(false); }} style={{
        background:'#22c55e',color:'#000',border:'none',
        padding:'6px 16px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700,whiteSpace:'nowrap'
      }}>Save Key</button>
      <button onClick={async () => {
        try {
          const res = await fetch(`https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${fmpKey}`);
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            alert('✓ Connection OK — key is working');
          } else {
            alert('✗ Connection failed — ' + (data?.['Error Message'] || 'unexpected response'));
          }
        } catch(e) { alert('✗ Network error'); }
      }} style={{
        background:'#141720',color:'#60a5fa',border:'1px solid #1e3a5f',
        padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,whiteSpace:'nowrap'
      }}>Test Connection</button>
      <button onClick={() => {
        if (!window.confirm('Reset your API key? You will need to enter it again.')) return;
        localStorage.removeItem('sl_fmp');
        setFmpKey('');
        setKeysSubmitted(false);
        setShowCfg(false);
      }} style={{
        background:'#2a0d0d',color:'#f87171',border:'1px solid #7f1d1d',
        padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,whiteSpace:'nowrap'
      }}>Reset Key</button>
    </div>
    <div style={{fontSize:10,color:'#334155'}}>Free plan: 250 calls/day. Key stored in your browser only.</div>
  </div>
)}
```

### 2D. Remove hardcoded default key

Change:
```js
const DEFAULT_FMP_KEY = 'wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2';
```
To:
```js
const DEFAULT_FMP_KEY = '';
```

And update the fmpKey state initializer:
```js
const [fmpKey, setFmpKey] = useState(() => localStorage.getItem('sl_fmp') || DEFAULT_FMP_KEY);
```

---

## CHANGE 3 — Error Panel Enhancement

Replace the error display with a smarter panel that offers action buttons:

```jsx
{!loading && error && (
  <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:8,padding:'16px 20px',margin:'24px 0'}}>
    <div style={{color:'#f87171',fontSize:13,marginBottom: (error.includes('Settings') || error.includes('limit')) ? 12 : 0}}>
      ⚠ {error}
    </div>
    {error.includes('Settings') && (
      <button onClick={() => setShowCfg(true)} style={{
        background:'#3b82f6',color:'#fff',border:'none',
        padding:'6px 16px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:600,marginRight:8
      }}>Open Settings ⚙</button>
    )}
    {error.includes('limit') && (
      <div style={{fontSize:11,color:'#64748b',marginTop:8}}>
        The 250 calls/day free limit resets at midnight UTC. You can use a different key or wait until tomorrow.
      </div>
    )}
  </div>
)}
```

---

## CHANGE 4 — Branding Text Fixes

### 4A. Empty state title

Find:
```jsx
<div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens v2.0</div>
```
Replace with:
```jsx
<div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens</div>
```

### 4B. Empty state subtitle

Find:
```jsx
Enter any US ticker for an InvestingPro-style deep analysis — 4-dimensional scoring, analyst consensus, DCF value, technical signals, and investment verdict.
```
Replace with:
```
Professional stock analysis — enter any ticker to get started. 4-dimensional scoring: valuation, financial health, momentum, and growth.
```

---

## CHANGE 5 — Finnhub API Integration

Finnhub provides earnings calendars, beat/miss history, and insider transactions on the free plan (60 calls/minute).

### 5A. Add Finnhub key state

In the `App()` component, add a Finnhub key state alongside the existing FMP key:
```js
const [finnhubKey, setFinnhubKey] = useState(() => localStorage.getItem('sl_finnhub') || '');
```

Also add a Finnhub data state:
```js
const [earnCalendar, setEarnCalendar]   = useState(null);  // next earnings date
const [earnSurprise, setEarnSurprise]   = useState([]);    // beat/miss last 8 quarters
const [insiderTxns,  setInsiderTxns]    = useState([]);    // insider transactions
```

### 5B. Finnhub fetch helper

Add this after `fmpGet`:
```js
const finnhubGet = useCallback(async (endpoint, params = {}) => {
  if (!finnhubKey) return null;
  const base = 'https://finnhub.io/api/v1';
  const qs = new URLSearchParams({ ...params, token: finnhubKey }).toString();
  try {
    const res = await fetch(`${base}/${endpoint}?${qs}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}, [finnhubKey]);
```

### 5C. Add Finnhub calls to analyze()

After the existing `Promise.allSettled` block (after setting all state from FMP results), add:

```js
// Fetch Finnhub data in parallel (optional — graceful if no key)
if (finnhubKey) {
  const today = new Date();
  const from = today.toISOString().substring(0, 10);
  const to = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const [earnCalRes, earnSurpRes, insiderRes] = await Promise.allSettled([
    finnhubGet('calendar/earnings', { symbol: sym, from, to }),
    finnhubGet('stock/earnings',    { symbol: sym, limit: '8' }),
    finnhubGet('stock/insider-transactions', { symbol: sym }),
  ]);
  const fg = r => r.status === 'fulfilled' ? r.value : null;
  const [ec, es, it] = [earnCalRes, earnSurpRes, insiderRes].map(fg);
  setEarnCalendar(ec?.earningsCalendar?.[0] || null);
  setEarnSurprise(Array.isArray(es) ? es.slice(0, 8) : []);
  setInsiderTxns(Array.isArray(it?.data) ? it.data.slice(0, 10) : []);
}
```

### 5D. Earnings & Insider UI components

Add these components above `App()`:

```jsx
function EarningsCalendarBadge({ earn }) {
  if (!earn) return null;
  const date = earn.date;
  const est = earn.epsEstimate;
  return (
    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 14px'}}>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Next Earnings</div>
      <div style={{fontSize:15,fontWeight:700,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{date || '—'}</div>
      {est != null && <div style={{fontSize:10,color:'#64748b',marginTop:3}}>Est. EPS: {est.toFixed(2)}</div>}
    </div>
  );
}

function EarningsSurpriseChart({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div>
      <SectionTitle>Earnings Beat / Miss — Last {data.length} Quarters</SectionTitle>
      <div style={{display:'flex',gap:6,alignItems:'flex-end',height:80}}>
        {[...data].reverse().map((q, i) => {
          const surprise = q.surprisePercent || 0;
          const isPos = surprise >= 0;
          const h = Math.min(70, Math.abs(surprise) * 3 + 10);
          return (
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
              <div style={{fontSize:9,color:isPos?'#22c55e':'#f87171',fontWeight:700}}>
                {isPos?'+':''}{surprise.toFixed(1)}%
              </div>
              <div style={{
                width:'100%',height:h,
                background:isPos?'#22c55e33':'#f8717133',
                border:`1px solid ${isPos?'#22c55e':'#f87171'}`,
                borderRadius:3
              }}/>
              <div style={{fontSize:8,color:'#334155'}}>{q.period}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsiderTable({ data }) {
  if (!data || data.length === 0) return null;
  const buys = data.filter(t => t.transactionType === 'P - Purchase' || t.change > 0);
  const sells = data.filter(t => t.transactionType === 'S - Sale' || t.change < 0);
  return (
    <div>
      <SectionTitle>Insider Transactions (Last 90 Days)</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div style={{background:'#0d2e1a',border:'1px solid #166534',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#22c55e'}}>{buys.length}</div>
          <div style={{fontSize:10,color:'#4ade80'}}>Insider Buys</div>
        </div>
        <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#f87171'}}>{sells.length}</div>
          <div style={{fontSize:10,color:'#fca5a5'}}>Insider Sells</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {data.slice(0, 6).map((t, i) => {
          const isBuy = t.change > 0;
          return (
            <div key={i} style={{
              display:'flex',justifyContent:'space-between',alignItems:'center',
              background:'#141720',borderRadius:5,padding:'7px 12px',fontSize:11
            }}>
              <span style={{color:'#64748b',flex:1}}>{t.name}</span>
              <span style={{color:'#94a3b8',marginRight:12}}>{t.filingDate?.substring(0,10)}</span>
              <span style={{
                fontWeight:700,color:isBuy?'#22c55e':'#f87171',
                fontFamily:'JetBrains Mono,monospace'
              }}>
                {isBuy ? '▲ Buy' : '▼ Sell'} {Math.abs(t.change || 0).toLocaleString()} shares
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 5E. Add Finnhub key field to Settings panel

In the settings panel, add a second input row for the Finnhub key:

```jsx
<div>
  <div style={{fontSize:10,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.5px'}}>Finnhub API Key <span style={{color:'#334155',fontWeight:400,textTransform:'none'}}>(optional — adds earnings & insider data)</span></div>
  <div style={{display:'flex',gap:8,alignItems:'center'}}>
    <input
      value={finnhubKey}
      onChange={e => setFinnhubKey(e.target.value)}
      placeholder="Get free key at finnhub.io"
      style={{background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'6px 11px',borderRadius:6,fontSize:12,width:300,outline:'none'}}
    />
    <button onClick={() => { localStorage.setItem('sl_finnhub', finnhubKey); }} style={{
      background:'#22c55e',color:'#000',border:'none',
      padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700
    }}>Save</button>
  </div>
</div>
```

Also save Finnhub key when the main "Save Key" button is clicked:
```js
localStorage.setItem('sl_fmp', fmpKey);
localStorage.setItem('sl_finnhub', finnhubKey);
```

### 5F. Show Finnhub data in the Research tab

In the Research tab content, add after the existing analyst panels:
```jsx
{finnhubKey && (
  <>
    <EarningsCalendarBadge earn={earnCalendar} />
    <EarningsSurpriseChart data={earnSurprise} />
    <InsiderTable data={insiderTxns} />
  </>
)}
{!finnhubKey && (
  <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px',textAlign:'center'}}>
    <div style={{fontSize:12,color:'#475569',marginBottom:8}}>Add a free Finnhub key in Settings ⚙ to unlock earnings calendar, beat/miss history, and insider transactions.</div>
    <a href="https://finnhub.io" target="_blank" rel="noopener noreferrer" style={{fontSize:11,color:'#60a5fa'}}>Get free key at finnhub.io ↗</a>
  </div>
)}
```

Also add the `EarningsCalendarBadge` in the Overview tab, next to the other KPI badges in the summary row.

---

## CHANGE 6 — SEC EDGAR Insider Trades (No Key Required)

SEC EDGAR data is free and requires no API key. This shows Form 4 filings (insider buying/selling).

### 6A. Add EDGAR state
```js
const [edgarInsiders, setEdgarInsiders] = useState([]);
```

### 6B. EDGAR fetch helper

Add after `finnhubGet`:
```js
const edgarGet = useCallback(async (sym) => {
  try {
    // Get CIK from EDGAR company search
    const searchRes = await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22${sym}%22&dateRange=custom&startdt=2024-01-01&forms=4&hits.hits._source.period_of_report=&hits.hits.total.value=true`);
    // Fallback: use ticker-to-CIK mapping
    const tickerRes = await fetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${sym}&type=4&dateb=&owner=include&count=10&search_text=&output=atom`);
    // Due to CORS restrictions, return empty gracefully
    return [];
  } catch { return []; }
}, []);
```

**Note on EDGAR CORS:** The SEC EDGAR API has CORS restrictions that prevent browser-side calls. Include this note in the UI instead of attempting the call: show a direct link to the EDGAR filing page.

### 6C. EDGAR link in UI

In the Research tab, add an EDGAR direct link panel:
```jsx
<div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'14px 18px'}}>
  <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>SEC EDGAR Filings</div>
  <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
    <a
      href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=4&dateb=&owner=include&count=20`}
      target="_blank" rel="noopener noreferrer"
      style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
    >
      Form 4 — Insider Filings ↗
    </a>
    <a
      href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K&dateb=&owner=include&count=5`}
      target="_blank" rel="noopener noreferrer"
      style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
    >
      10-K Annual Reports ↗
    </a>
    <a
      href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=13F&dateb=&owner=include&count=5`}
      target="_blank" rel="noopener noreferrer"
      style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
    >
      13F — Institutional Holdings ↗
    </a>
  </div>
</div>
```

---

## CHANGE 7 — Anthropic AI Verdict (Optional, Replaces Rule-Based Text)

When the user has an Anthropic API key, the VerdictSection "Bottom Line" text is generated by Claude Haiku instead of the static template strings.

### 7A. Add Anthropic key state
```js
const [anthropicKey, setAnthropicKey] = useState(() => localStorage.getItem('sl_anthropic') || localStorage.getItem('ic_api_keys.anthropic') || '');
const [aiVerdict,    setAiVerdict]    = useState(null);
const [aiLoading,    setAiLoading]    = useState(false);
```

### 7B. AI verdict fetch

Add this function inside `App()`:
```js
const fetchAiVerdict = useCallback(async (sym, scoreData, profileData, metricsData) => {
  if (!anthropicKey || !sym) return;
  setAiLoading(true);
  setAiVerdict(null);
  try {
    const prompt = `You are a concise equity analyst. Provide a 2-3 sentence investment verdict for ${sym} (${profileData?.companyName || ''}).

Key data:
- Composite score: ${scoreData?.total}/100 (${getRating(scoreData?.total)?.label})
- Valuation score: ${scoreData?.val}/25
- Financial Health score: ${scoreData?.hlth}/30
- Momentum score: ${scoreData?.mom}/25
- Growth score: ${scoreData?.growth}/20
- Sector: ${profileData?.sector || 'Unknown'}
- Market Cap: ${profileData?.mktCap ? '$' + (profileData.mktCap / 1e9).toFixed(1) + 'B' : 'Unknown'}
- P/E (TTM): ${metricsData?.priceToEarningsRatioTTM?.toFixed(1) || 'N/A'}
- ROIC (TTM): ${metricsData?.returnOnInvestedCapitalTTM ? (metricsData.returnOnInvestedCapitalTTM * 100).toFixed(1) + '%' : 'N/A'}
- Net Debt/EBITDA: ${metricsData?.netDebtToEBITDATTM?.toFixed(1) || 'N/A'}

Write 2-3 crisp sentences. No bullet points. Reference specific metrics. End with the rating word (STRONG BUY / BUY / HOLD / CAUTION / AVOID).`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    if (text) setAiVerdict(text);
  } catch (e) {
    // Silently fail — fall back to rule-based text
  } finally {
    setAiLoading(false);
  }
}, [anthropicKey]);
```

### 7C. Trigger AI verdict after analysis

At the end of the `analyze()` try block, after all setters, add:
```js
if (anthropicKey) {
  fetchAiVerdict(sym, calcScores(mD?.[0]||mD, rD?.[0]||rD, Array.isArray(hD)?hD:[], Array.isArray(sD)?sD:[]), pD?.[0]||pD, mD?.[0]||mD);
}
```

### 7D. Use AI verdict in VerdictSection

In `VerdictSection`, update the "Bottom Line" text block to accept and display `aiVerdict`:

Update the `VerdictSection` component signature:
```jsx
function VerdictSection({scores, profile, metrics, ratios, aiVerdict, aiLoading}) {
```

Replace the verdictText display with:
```jsx
<div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.65}}>
  {aiLoading ? (
    <span style={{color:'#475569',fontStyle:'italic'}}>✨ Generating AI analysis...</span>
  ) : aiVerdict ? (
    <span>{aiVerdict}</span>
  ) : (
    verdictText
  )}
</div>
```

Pass `aiVerdict` and `aiLoading` when rendering `VerdictSection`.

### 7E. Add Anthropic key to Settings panel

```jsx
<div>
  <div style={{fontSize:10,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.5px'}}>
    Anthropic API Key <span style={{color:'#334155',fontWeight:400,textTransform:'none'}}>(optional — enables AI-powered verdict)</span>
  </div>
  <div style={{display:'flex',gap:8,alignItems:'center'}}>
    <input
      value={anthropicKey}
      onChange={e => setAnthropicKey(e.target.value)}
      placeholder="sk-ant-..."
      type="password"
      style={{background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'6px 11px',borderRadius:6,fontSize:12,width:300,outline:'none'}}
    />
    <button onClick={() => { localStorage.setItem('sl_anthropic', anthropicKey); }} style={{
      background:'#22c55e',color:'#000',border:'none',
      padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700
    }}>Save</button>
  </div>
</div>
```

---

## CHANGE 8 — Setup Screen: Add Optional Keys

In the setup screen (Change 2B), below the "Test & Save Key" button section, add a collapsible "Optional: Boost your analysis" section:

```jsx
<details style={{textAlign:'left',marginTop:20}}>
  <summary style={{fontSize:11,color:'#475569',cursor:'pointer',marginBottom:12}}>
    ✨ Optional: Add more data sources (Finnhub + Anthropic AI)
  </summary>
  <div style={{display:'flex',flexDirection:'column',gap:10,marginTop:12}}>
    <div>
      <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Finnhub API Key — earnings calendar + insider transactions (free)</div>
      <input
        placeholder="Get free key at finnhub.io"
        id="sl_setup_finnhub"
        style={{width:'100%',background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'8px 12px',borderRadius:6,fontSize:12,outline:'none'}}
      />
    </div>
    <div>
      <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Anthropic API Key — AI-powered investment verdict</div>
      <input
        placeholder="sk-ant-..."
        type="password"
        id="sl_setup_anthropic"
        style={{width:'100%',background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'8px 12px',borderRadius:6,fontSize:12,outline:'none'}}
      />
    </div>
  </div>
</details>
```

And in the `testAndSave` function, after saving the FMP key, also save these optional keys if provided:
```js
const fhKey = document.getElementById('sl_setup_finnhub')?.value?.trim();
const antKey = document.getElementById('sl_setup_anthropic')?.value?.trim();
if (fhKey) { localStorage.setItem('sl_finnhub', fhKey); setFinnhubKey(fhKey); }
if (antKey) { localStorage.setItem('sl_anthropic', antKey); setAnthropicKey(antKey); }
```

---

## CHANGE 9 — Remove `DEFAULT_FMP_KEY` constant entirely

Since the key now comes only from localStorage via the setup screen, remove or empty the constant entirely and make sure there's no hardcoded key anywhere:

```js
// Remove this line entirely, or change to:
const DEFAULT_FMP_KEY = '';
```

---

## SUMMARY OF ALL FIELD NAME CHANGES

Go through the **entire file** and update every reference:

```
met.peRatioTTM                      →  met.priceToEarningsRatioTTM
met.enterpriseValueOverEBITDATTM    →  met.evToEBITDATTM
met.pfcfRatioTTM                    →  met.priceToFreeCashFlowRatioTTM
met.roicTTM                         →  met.returnOnInvestedCapitalTTM
met.roeTTM                          →  met.returnOnEquityTTM
met.interestCoverageTTM             →  met.interestCoverageRatioTTM
rat.priceFairValueTTM               →  rat.priceToFairValueTTM
quote.changesPercentage             →  quote.changePercentage
quote.avgVolume                     →  quote.averageVolume
hD?.historical                      →  hD (flat array — no .historical wrapper)
```

These appear in:
- `calcScores()` function (lines ~59-72)
- `healthCards` useMemo
- `VerdictSection` component
- Company header (avgVolume, changesPercentage references)
- Any other place that destructures or accesses these properties

---

## IMPORTANT CONSTRAINTS

1. **DO NOT change `index.html`**
2. **Keep all existing v2.0 features** — all 4 tabs (Overview, Fundamentals, Chart, Research), DCF, scoring gauge, analyst panel, price chart, technical signals
3. **All code in single `StockAnalyzer.jsx`** — no separate files
4. **No `import` statements** — all globals from CDN
5. After all edits: **compile to `StockAnalyzer.js`**, then **git add + commit + push**
6. **Verify push succeeded** before finishing

---

## FULL EXPECTED FLOW AFTER FIXES

1. User opens `stock-analyzer-blue-beta.vercel.app` for first time
2. Sees setup screen: StockLens logo, FMP key input, optional Finnhub + Anthropic fields
3. Pastes FMP key, clicks "Test & Save" — app calls `/stable/quote?symbol=AAPL&apikey=...`
4. If valid: saves key, enters app
5. App shows empty state: "StockLens — Professional stock analysis — enter any ticker to get started."
6. User types NVDA, clicks Analyze
7. App calls 10 FMP `/stable/` endpoints + optional Finnhub endpoints
8. All data loads correctly (FMP stable endpoints return real data)
9. If Anthropic key present: AI verdict generates in the Background and replaces rule-based text
10. If daily limit hit: clear error message with "Open Settings ⚙" button

---

## COMPILE AND PUSH (REQUIRED FINAL STEP)

After ALL edits are complete, run from the StockAnalyzer folder:

```
node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"
```

Then push:
```
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "feat: StockLens v3.0 — FMP stable migration + Finnhub + AI verdict + setup screen" && git push origin main
```

Verify with `git log --oneline -1` and `git push` exit code 0 before reporting done.
