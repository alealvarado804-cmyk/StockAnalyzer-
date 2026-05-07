# StockLens v4.0 — Enhancement Prompt

## CONTEXT

Working on StockLens v3.0 at:
`C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer\`

**Files to edit:** `StockAnalyzer.jsx` only. After all edits, compile to `StockAnalyzer.js` and push.

**Architecture:** React 18 UMD from CDN. No imports. Pre-compiled JSX. `const { useState, useCallback, useMemo, useRef, useEffect } = React;`

**Compile:**
```
node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"
```

**Push:**
```
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "feat: StockLens v4.0 — fixes + DCF calculator + health score + analyst detail" && git push origin main
```

---

## BUG FIX 1 — P/E, P/FCF, Interest Coverage Showing "—"

**Root cause:** The FMP `/stable/key-metrics-ttm` endpoint uses the ORIGINAL field names for P/E, P/FCF, and Interest Coverage — they were NOT renamed in the stable API. Only some fields were renamed. The master prompt incorrectly renamed them.

**Fix:** Use a fallback pattern `??` to handle both possible names everywhere in the file.

In `calcScores()`, replace:
```js
const pe=metrics.priceToEarningsRatioTTM, ev=metrics.evToEBITDATTM;
const pfcf=metrics.priceToFreeCashFlowRatioTTM, fvr=ratios.priceToFairValueTTM;
const gm=ratios.grossProfitMarginTTM, roic=metrics.returnOnInvestedCapitalTTM;
const nd=metrics.netDebtToEBITDATTM, roe=metrics.returnOnEquityTTM, ic=metrics.interestCoverageRatioTTM;
```
With:
```js
const pe   = metrics.peRatioTTM ?? metrics.priceToEarningsRatioTTM;
const ev   = metrics.evToEBITDATTM ?? metrics.enterpriseValueOverEBITDATTM;
const pfcf = metrics.pfcfRatioTTM ?? metrics.priceToFreeCashFlowRatioTTM;
const fvr  = ratios.priceToFairValueTTM ?? ratios.priceFairValueTTM;
const gm   = ratios.grossProfitMarginTTM;
const roic = metrics.returnOnInvestedCapitalTTM ?? metrics.roicTTM;
const nd   = metrics.netDebtToEBITDATTM;
const roe  = metrics.returnOnEquityTTM ?? metrics.roeTTM;
const ic   = metrics.interestCoverageTTM ?? metrics.interestCoverageRatioTTM;
```

Apply this SAME fallback pattern to `healthCards` useMemo and everywhere else `met.*` or `rat.*` is accessed for these fields:
- P/E: `met?.peRatioTTM ?? met?.priceToEarningsRatioTTM`
- P/FCF: `met?.pfcfRatioTTM ?? met?.priceToFreeCashFlowRatioTTM`
- ROIC: `met?.returnOnInvestedCapitalTTM ?? met?.roicTTM`
- ROE: `met?.returnOnEquityTTM ?? met?.roeTTM`
- Interest Coverage: `met?.interestCoverageTTM ?? met?.interestCoverageRatioTTM`
- EV/EBITDA: `met?.evToEBITDATTM ?? met?.enterpriseValueOverEBITDATTM`
- Fair Value ratio: `rat?.priceToFairValueTTM ?? rat?.priceFairValueTTM`

Also in `VerdictSection` component, apply the same fallback pattern for all metric references.

---

## BUG FIX 2 — "About Company" Text Gets Cut Off

**Root cause:** `display:'-webkit-box', WebkitLineClamp:3` hard-truncates the text.

**Fix:** Replace the About section with a collapsible "Read more" pattern:

```jsx
{prof?.description && (
  <div>
    <SectionTitle>About {prof.companyName}</SectionTitle>
    <AboutText text={prof.description} />
  </div>
)}
```

Add this component above `App()`:
```jsx
function AboutText({ text }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = text && text.length > 400;
  const display = expanded || !long ? text : text.substring(0, 400) + '...';
  return (
    <div>
      <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.75}}>{display}</div>
      {long && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{marginTop:6,background:'none',border:'none',color:'#3b82f6',fontSize:11,cursor:'pointer',padding:0}}
        >
          {expanded ? '▲ Show less' : '▼ Read more'}
        </button>
      )}
    </div>
  );
}
```

---

## BUG FIX 3 — Quarterly Table Shows "Q1" Without Year

**Root cause:** `rows` uses `q.period` without `q.calendarYear`.

**Fix:** In `QuarterlyTable`, in the Period column, display:
```jsx
<td ...>{q.period} {q.calendarYear}</td>
```
For example: "Q3 2024" instead of just "Q3".

Also in `GrowthPanel`, update the sparkline x-axis labels (if rendered as SVG text) to show `q.period + ' ' + q.calendarYear` for each data point.

---

## BUG FIX 4 — Growth Profile Chart Has No Axis Labels or Date Context

**Fix:** Update the `GrowthPanel` component:

1. Add a date-labeled x-axis below each sparkline, showing the period+year for first and last data point.
2. Add y-axis scale (min and max values shown as small labels).
3. Show actual values for the latest period (most recent quarter) next to each CAGR label.

Update the `Row` component inside `GrowthPanel`:
```jsx
const Row = ({ label, data, type, color, cagrVal, stmtsData }) => {
  const validData = data.filter(v => ok(v));
  const minVal = Math.min(...validData);
  const maxVal = Math.max(...validData);
  const latestVal = data[data.length - 1];
  const firstLabel = stmtsData?.[0] ? `${stmtsData[0].period} ${stmtsData[0].calendarYear}` : '';
  const lastLabel = stmtsData?.[stmtsData.length-1] ? `${stmtsData[stmtsData.length-1].period} ${stmtsData[stmtsData.length-1].calendarYear}` : '';
  return (
    <div style={{padding:'10px 0',borderBottom:'1px solid #161b26'}}>
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:130,fontSize:11,color:'#94a3b8',flexShrink:0}}>{label}</div>
        <div style={{flex:1,position:'relative'}}>
          <Sparkline data={data} type={type} color={color} h={44} w={180}/>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:2}}>
            <span style={{fontSize:9,color:'#334155'}}>{firstLabel}</span>
            <span style={{fontSize:9,color:'#334155'}}>{lastLabel}</span>
          </div>
        </div>
        <div style={{textAlign:'right',minWidth:90}}>
          {ok(latestVal) && (
            <div style={{fontSize:11,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
              {type === 'line' ? fmt.pct(latestVal) : fmt.usd(latestVal)}
            </div>
          )}
          {ok(cagrVal) && (
            <div style={{fontSize:10,color:cagrVal>0?'#22c55e':'#f87171',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
              CAGR {fmt.chg(cagrVal)}
            </div>
          )}
          <div style={{fontSize:9,color:'#334155',marginTop:1}}>{data.length} qtrs</div>
        </div>
      </div>
    </div>
  );
};
```

Pass `stmtsData={rows}` (the reversed stmts array) to each `<Row/>`.

Also **increase the income-statement limit from 4 to 12** in the `analyze()` call to show 3 years of quarterly data:
```js
fmpGet('income-statement', { symbol: sym, period: 'quarter', limit: '12' }),
```
(FMP free plan allows up to ~20 quarterly statements. If it returns fewer, the code already handles it gracefully.)

---

## NEW FEATURE 1 — Interactive DCF Calculator

**Replace** the static FMP DCF value with a full interactive DCF calculator. Users can adjust all inputs and the value recalculates instantly.

### 1A. Add new state variables in `App()`

```js
// Interactive DCF state — populated from real financials, user can override
const [dcfInputs, setDcfInputs] = useState(null); // set when data loads
const [showDcf,   setShowDcf]   = useState(false);
```

### 1B. Add balance-sheet call to analyze()

Add to `Promise.allSettled`:
```js
fmpGet('balance-sheet-statement', { symbol: sym, period: 'annual', limit: '1' }),  // index 11
```
Unpack in the results as `bsD` at index 11:
```js
const [qD,pD,mD,rD,hD,sD,nD,ptD,aeD,udD,dcfD,bsD]=results.map(get);
```

After setting all other state, populate DCF inputs from real data:
```js
// Build DCF defaults from real data
const q0 = (Array.isArray(sD)?sD:[])[0];
const bs0 = Array.isArray(bsD)?bsD[0]:(bsD||null);
const baseRevenue = q0?.revenue ? q0.revenue * 4 : null; // annualize latest quarter
const baseFCF = met_?.freeCashFlowYieldTTM && quote_?.marketCap
  ? met_.freeCashFlowYieldTTM * quote_.marketCap
  : null;
const netDebt = bs0?.netDebt ?? (bs0 ? (bs0.totalDebt||0) - (bs0.cashAndCashEquivalents||0) : null);
const shares = quote_?.sharesOutstanding ?? pD_?.sharesOutstanding ?? null;
const beta = quote_?.beta ?? pD_?.beta ?? 1.2;

setDcfInputs({
  revGrowth1to5:  12,    // % revenue growth yr 1-5
  revGrowth6to10: 6,     // % revenue growth yr 6-10
  ebitMargin:     ok(rat_?.operatingProfitMarginTTM) ? Math.round(rat_.operatingProfitMarginTTM*100) : 20,
  taxRate:        21,    // %
  capexPct:       5,     // % of revenue
  wcChange:       1,     // working capital change % of revenue
  discountRate:   9,     // WACC %
  terminalGrowth: 3,     // terminal growth %
  beta:           ok(beta) ? +beta.toFixed(2) : 1.2,
  netDebt:        ok(netDebt) ? netDebt : 0,
  shares:         ok(shares) ? shares : null,
  baseRevenue:    ok(baseRevenue) ? baseRevenue : null,
});
```

Note: use local variables for the post-processing above (set with `const q0 = ...` before calling setters), since state updates are async.

### 1C. DCF calculation function (pure, no side effects)

Add this pure function at the top of the file (after `computeSMA`):

```js
function runDCF(inputs) {
  const {
    revGrowth1to5, revGrowth6to10, ebitMargin, taxRate,
    capexPct, wcChange, discountRate, terminalGrowth,
    netDebt, shares, baseRevenue
  } = inputs;

  if (!ok(baseRevenue) || !ok(shares) || shares <= 0) return null;

  const g1 = revGrowth1to5 / 100;
  const g2 = revGrowth6to10 / 100;
  const ebit = ebitMargin / 100;
  const tax = taxRate / 100;
  const capex = capexPct / 100;
  const wc = wcChange / 100;
  const r = discountRate / 100;
  const tg = terminalGrowth / 100;

  if (r <= tg) return null; // math breaks

  let rev = baseRevenue;
  let pv = 0;
  for (let yr = 1; yr <= 10; yr++) {
    const g = yr <= 5 ? g1 : g2;
    rev = rev * (1 + g);
    const nopat = rev * ebit * (1 - tax);
    const reinvest = rev * (capex + wc);
    const fcf = nopat - reinvest;
    pv += fcf / Math.pow(1 + r, yr);
  }

  // Terminal value
  const lastFCF = rev * ebit * (1 - tax) - rev * (capex + wc);
  const tv = lastFCF * (1 + tg) / (r - tg);
  const pvTV = tv / Math.pow(1 + r, 10);

  const enterpriseValue = pv + pvTV;
  const equityValue = enterpriseValue - (netDebt || 0);
  const intrinsicValue = equityValue / shares;

  return { intrinsicValue, pv, pvTV, enterpriseValue, equityValue };
}
```

### 1D. DCF Calculator Component

Add this component above `App()`:

```jsx
function DCFCalculator({ inputs, setInputs, currentPrice, profile }) {
  if (!inputs) return null;

  const result = runDCF(inputs);
  const iv = result?.intrinsicValue;
  const mos = (ok(iv) && ok(currentPrice) && currentPrice > 0)
    ? (iv - currentPrice) / iv : null;
  const mosColor = !ok(mos) ? '#475569' : mos > 0.15 ? '#22c55e' : mos > -0.15 ? '#fbbf24' : '#f87171';

  const set = (key, val) => setInputs(p => ({ ...p, [key]: val }));

  const SliderInput = ({ label, stateKey, min, max, step = 1, unit = '%', note }) => (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:10,color:'#64748b'}}>{label}</span>
        <span style={{fontSize:11,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
          {inputs[stateKey]}{unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={inputs[stateKey]}
        onChange={e => set(stateKey, parseFloat(e.target.value))}
        style={{width:'100%',accentColor:'#3b82f6',cursor:'pointer'}}
      />
      {note && <div style={{fontSize:9,color:'#334155'}}>{note}</div>}
    </div>
  );

  // Sensitivity table: rows = discount rate ±2%, cols = terminal growth ±1%
  const sensRows = [-2,-1,0,1,2].map(dr => {
    const r = inputs.discountRate + dr;
    return [-1,0,1].map(dg => {
      const tg = inputs.terminalGrowth + dg;
      if (r <= tg) return null;
      const res = runDCF({ ...inputs, discountRate: r, terminalGrowth: tg });
      return res?.intrinsicValue;
    });
  });

  return (
    <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,overflow:'hidden'}}>
      <div style={{
        background:'#141720',borderBottom:'1px solid #161b26',
        padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'
      }}>
        <div style={{fontSize:11,fontWeight:700,color:'#e2e8f0',textTransform:'uppercase',letterSpacing:'1px'}}>
          📐 Interactive DCF Model
        </div>
        <div style={{fontSize:10,color:'#475569'}}>
          {profile?.companyName} · All values auto-recalculate
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 300px',gap:0}}>

        {/* Left: Growth inputs */}
        <div style={{padding:'16px 20px',borderRight:'1px solid #161b26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#3b82f6',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>
            Revenue Growth
          </div>
          <SliderInput label="Years 1–5 Growth Rate" stateKey="revGrowth1to5" min={-10} max={50} note="Analyst estimates for near-term growth"/>
          <SliderInput label="Years 6–10 Growth Rate" stateKey="revGrowth6to10" min={-5} max={30} note="Conservative long-run growth"/>
          <SliderInput label="EBIT Margin" stateKey="ebitMargin" min={0} max={60} note="Operating income / revenue"/>
          <SliderInput label="Tax Rate" stateKey="taxRate" min={10} max={40} note="Effective tax rate"/>
        </div>

        {/* Center: Discount inputs */}
        <div style={{padding:'16px 20px',borderRight:'1px solid #161b26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#a78bfa',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>
            Discount & Capital
          </div>
          <SliderInput label="Discount Rate (WACC)" stateKey="discountRate" min={4} max={20} step={0.5} note="Weighted average cost of capital"/>
          <SliderInput label="Terminal Growth Rate" stateKey="terminalGrowth" min={0} max={6} step={0.5} note="Perpetuity growth (≤ GDP growth)"/>
          <SliderInput label="CapEx % of Revenue" stateKey="capexPct" min={0} max={30} note="Maintenance + growth capex"/>
          <SliderInput label="Beta" stateKey="beta" min={0.3} max={3} step={0.1} unit="" note="Used to contextualize risk"/>
          <div style={{fontSize:9,color:'#334155',marginTop:4}}>
            Net Debt: {fmt.usd(inputs.netDebt)} · Shares: {ok(inputs.shares) ? (inputs.shares/1e6).toFixed(0)+'M' : '—'}
          </div>
        </div>

        {/* Right: Result */}
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'#fbbf24',textTransform:'uppercase',letterSpacing:'1px',marginBottom:4}}>
            Valuation Result
          </div>
          <div style={{textAlign:'center',padding:'16px',background:'#0a0b10',borderRadius:8,border:'1px solid #1e2430'}}>
            <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Intrinsic Value / Share</div>
            <div style={{
              fontSize:28,fontWeight:800,
              color: ok(iv) ? mosColor : '#475569',
              fontFamily:'JetBrains Mono,monospace',lineHeight:1
            }}>
              {ok(iv) ? fmt.price(iv) : '—'}
            </div>
            {ok(mos) && (
              <div style={{marginTop:6,fontSize:12,fontWeight:700,color:mosColor}}>
                {mos > 0 ? `+${(mos*100).toFixed(1)}% upside` : `${(mos*100).toFixed(1)}% overvalued`}
              </div>
            )}
            {ok(currentPrice) && (
              <div style={{fontSize:10,color:'#475569',marginTop:3}}>vs. current {fmt.price(currentPrice)}</div>
            )}
          </div>

          {/* Sensitivity table */}
          <div>
            <div style={{fontSize:9,color:'#334155',marginBottom:4}}>
              Sensitivity: Discount Rate (rows) × Terminal Growth (cols)
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:9}}>
              <thead>
                <tr>
                  <th style={{color:'#334155',padding:'2px 4px',textAlign:'center'}}>WACC\TG</th>
                  {[inputs.terminalGrowth-1, inputs.terminalGrowth, inputs.terminalGrowth+1].map(tg=>(
                    <th key={tg} style={{color:'#475569',padding:'2px 4px',textAlign:'center'}}>{tg}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[-2,-1,0,1,2].map((dr,ri)=>(
                  <tr key={dr}>
                    <td style={{color:'#475569',padding:'2px 4px',textAlign:'center',fontFamily:'JetBrains Mono,monospace'}}>
                      {inputs.discountRate+dr}%
                    </td>
                    {sensRows[ri].map((v,ci)=>{
                      const mos2 = (ok(v)&&ok(currentPrice)&&currentPrice>0) ? (v-currentPrice)/v : null;
                      const c = !ok(v)?'#334155':mos2>0.15?'#22c55e':mos2>-0.15?'#fbbf24':'#f87171';
                      return (
                        <td key={ci} style={{
                          color:c,padding:'3px 4px',textAlign:'center',
                          fontFamily:'JetBrains Mono,monospace',fontWeight:dr===0&&ci===1?800:400,
                          background:dr===0&&ci===1?'#141720':'transparent',borderRadius:3
                        }}>
                          {ok(v) ? `$${v.toFixed(0)}` : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 1E. Add DCF Calculator to a new "Valuation" tab

Add `'Valuation'` to the tabs array:
```js
const tabs=['Overview','Fundamentals','Valuation','Chart','Research'];
```

Add Valuation tab content:
```jsx
{/* ── VALUATION TAB ── */}
{activeTab==='Valuation'&&(
  <div style={{display:'flex',flexDirection:'column',gap:16}}>
    <DCFCalculator
      inputs={dcfInputs}
      setInputs={setDcfInputs}
      currentPrice={priceNow}
      profile={prof}
    />
    {/* Multi-model valuation summary */}
    <MultiModelValuation
      met={met}
      rat={rat}
      quote={quote}
      prof={prof}
      stmts={stmts}
      currentPrice={priceNow}
    />
  </div>
)}
```

Remove the static DCF badge from the company header (the inline `{ok(dcfVal)&&...}` block) and replace it with a clickable link: `<button onClick={()=>setActiveTab('Valuation')}>→ See Valuation</button>`.

---

## NEW FEATURE 2 — Multi-Model Valuation Summary

Add this component above `App()`. It shows 4 valuation methods side by side:

```jsx
function MultiModelValuation({ met, rat, quote, prof, stmts, currentPrice }) {
  if (!met || !rat || !currentPrice) return null;

  const pe    = met?.peRatioTTM ?? met?.priceToEarningsRatioTTM;
  const pfcf  = met?.pfcfRatioTTM ?? met?.priceToFreeCashFlowRatioTTM;
  const gm    = rat?.grossProfitMarginTTM;
  const roic  = met?.returnOnInvestedCapitalTTM ?? met?.roicTTM;
  const bv    = rat?.priceToBookRatioTTM ?? met?.pbRatioTTM;

  // Graham Number: sqrt(22.5 * EPS * BookValuePerShare)
  const eps    = stmts?.[0]?.eps;
  const bvps   = met?.bookValuePerShareTTM ?? null;
  const graham = (ok(eps) && eps > 0 && ok(bvps) && bvps > 0)
    ? Math.sqrt(22.5 * eps * bvps) : null;

  // Relative P/E: sector median P/E * trailing EPS
  const sector = prof?.sector;
  const sectorPE = SECTOR_BM[sector]?.pe;
  const relPE = (ok(sectorPE) && ok(eps) && eps > 0) ? sectorPE * eps * 4 : null; // annualized EPS

  // P/FCF implied: sector typical P/FCF * FCF per share
  const fcfYield = met?.freeCashFlowYieldTTM;
  const fcfFair  = (ok(fcfYield) && fcfYield > 0) ? currentPrice / fcfYield * 0.035 : null; // 3.5% target yield

  const models = [
    { name: 'Graham Number', value: graham, note: '√(22.5 × EPS × BVPS)' },
    { name: 'Relative P/E', value: relPE, note: `Sector avg P/E (${sectorPE}x) × EPS` },
    { name: 'P/FCF Fair Value', value: fcfFair, note: '3.5% FCF yield target' },
  ].filter(m => ok(m.value) && m.value > 0);

  if (models.length === 0) return null;

  const avg = models.reduce((s,m) => s + m.value, 0) / models.length;
  const avgMos = (avg - currentPrice) / avg;
  const avgColor = avgMos > 0.15 ? '#22c55e' : avgMos > -0.15 ? '#fbbf24' : '#f87171';

  return (
    <div>
      <SectionTitle>Valuation Models Summary</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${models.length},1fr) 1fr`,gap:10}}>
        {models.map((m,i) => {
          const mos = (m.value - currentPrice) / m.value;
          const c = mos > 0.15 ? '#22c55e' : mos > -0.15 ? '#fbbf24' : '#f87171';
          return (
            <div key={i} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#475569',marginBottom:4}}>{m.name}</div>
              <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
                {fmt.price(m.value)}
              </div>
              <div style={{fontSize:10,color:c,marginTop:3}}>
                {mos > 0 ? `+${(mos*100).toFixed(1)}% upside` : `${(mos*100).toFixed(1)}% overvalued`}
              </div>
              <div style={{fontSize:9,color:'#334155',marginTop:4}}>{m.note}</div>
            </div>
          );
        })}
        {/* Average */}
        <div style={{background:'#0a0b10',border:`2px solid ${avgColor}44`,borderRadius:8,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Model Average ({models.length} models)</div>
          <div style={{fontSize:20,fontWeight:800,color:avgColor,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
            {fmt.price(avg)}
          </div>
          <div style={{fontSize:10,color:avgColor,marginTop:3}}>
            {avgMos > 0 ? `+${(avgMos*100).toFixed(1)}% upside` : `${(avgMos*100).toFixed(1)}% overvalued`}
          </div>
          <div style={{fontSize:9,color:'#334155',marginTop:4}}>avg of {models.length} methods</div>
        </div>
      </div>
    </div>
  );
}
```

---

## NEW FEATURE 3 — Enhanced Analyst Consensus Panel

**Add a new FMP endpoint call** to get individual analyst price targets:
```js
fmpGet('price-target',  { symbol: sym, limit: '10' }),  // index 12
```

Unpack as `ptListD` at index 12.

Update `AnalystPanel` to accept and display individual targets:

```jsx
function AnalystPanel({ptC, udC, analystEst, currentPrice, ptList}) {
```

After the existing consensus display, add a section showing individual analyst targets (the latest from each analyst firm):

```jsx
{ptList && ptList.length > 0 && (
  <div style={{marginTop:14}}>
    <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>
      Recent Analyst Price Targets
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:200,overflowY:'auto'}}>
      {ptList.slice(0,8).map((pt,i) => {
        const upPt = ok(pt.priceTarget) && ok(currentPrice)
          ? (pt.priceTarget - currentPrice) / currentPrice : null;
        const ptColor = !ok(upPt)?'#475569':upPt>0.1?'#22c55e':upPt<-0.1?'#f87171':'#fbbf24';
        return (
          <div key={i} style={{
            display:'flex',alignItems:'center',justifyContent:'space-between',
            background:'#141720',borderRadius:5,padding:'6px 12px',fontSize:11
          }}>
            <span style={{color:'#64748b',flex:1}}>{pt.analystCompany || pt.analystName}</span>
            <span style={{color:'#475569',marginRight:12}}>{pt.publishedDate?.substring(0,10)}</span>
            <span style={{fontWeight:700,color:ptColor,fontFamily:'JetBrains Mono,monospace'}}>
              {fmt.price(pt.priceTarget)}
              {ok(upPt) && <span style={{fontSize:10,marginLeft:5}}>({upPt>0?'+':''}{(upPt*100).toFixed(1)}%)</span>}
            </span>
          </div>
        );
      })}
    </div>
  </div>
)}
```

Pass `ptList={ptListD}` when rendering `<AnalystPanel .../>`.

---

## NEW FEATURE 4 — Financial Health Score (1–5 Scale, 5 Dimensions)

Inspired by InvestingPro's Health Score. Add before `App()`:

```jsx
function HealthScorePanel({ met, rat, hist, stmts, scores }) {
  if (!met && !rat) return null;

  const pe    = met?.peRatioTTM ?? met?.priceToEarningsRatioTTM;
  const gm    = rat?.grossProfitMarginTTM;
  const roic  = met?.returnOnInvestedCapitalTTM ?? met?.roicTTM;
  const nd    = met?.netDebtToEBITDATTM;
  const fcfY  = met?.freeCashFlowYieldTTM;
  const fvr   = rat?.priceToFairValueTTM ?? rat?.priceFairValueTTM;

  // 5 dimensions, each scored 1-5
  const dims = [
    {
      name: 'Growth',
      icon: '📈',
      score: (() => {
        const s = scores.growth;
        return s >= 16 ? 5 : s >= 12 ? 4 : s >= 8 ? 3 : s >= 4 ? 2 : 1;
      })(),
      note: 'Revenue & EPS growth trend',
    },
    {
      name: 'Profitability',
      icon: '💰',
      score: (() => {
        let pts = 0;
        if (ok(gm)) pts += gm >= 0.50 ? 2 : gm >= 0.25 ? 1 : 0;
        if (ok(roic)) pts += roic >= 0.20 ? 3 : roic >= 0.12 ? 2 : roic >= 0.05 ? 1 : 0;
        return Math.min(5, pts);
      })(),
      note: 'Gross margin & ROIC quality',
    },
    {
      name: 'Momentum',
      icon: '⚡',
      score: (() => {
        const s = scores.mom;
        return s >= 20 ? 5 : s >= 15 ? 4 : s >= 10 ? 3 : s >= 5 ? 2 : 1;
      })(),
      note: 'Price performance vs history',
    },
    {
      name: 'Relative Value',
      icon: '⚖️',
      score: (() => {
        let pts = 0;
        if (ok(pe) && pe > 0) pts += pe < 15 ? 2 : pe < 25 ? 1 : 0;
        if (ok(fvr)) pts += fvr < 0.9 ? 2 : fvr < 1.1 ? 1 : 0;
        if (ok(fcfY)) pts += fcfY > 0.05 ? 1 : 0;
        return Math.min(5, Math.max(1, pts+1));
      })(),
      note: 'P/E, fair value, FCF yield',
    },
    {
      name: 'Financial Health',
      icon: '🏦',
      score: (() => {
        const s = scores.hlth;
        return s >= 24 ? 5 : s >= 18 ? 4 : s >= 12 ? 3 : s >= 6 ? 2 : 1;
      })(),
      note: 'Leverage, coverage, balance sheet',
    },
  ];

  const overall = (dims.reduce((a,d) => a + d.score, 0) / dims.length);
  const overallColor = overall >= 4 ? '#22c55e' : overall >= 3 ? '#fbbf24' : '#f87171';

  return (
    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'1px'}}>
          Financial Health Score
        </div>
        <div style={{fontSize:22,fontWeight:800,color:overallColor,fontFamily:'JetBrains Mono,monospace'}}>
          {overall.toFixed(1)}<span style={{fontSize:12,color:'#475569'}}>/5</span>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
        {dims.map((d,i) => {
          const c = d.score >= 4 ? '#22c55e' : d.score >= 3 ? '#fbbf24' : '#f87171';
          return (
            <div key={i} style={{textAlign:'center'}}>
              <div style={{fontSize:18,marginBottom:4}}>{d.icon}</div>
              <div style={{fontSize:10,color:'#64748b',marginBottom:6}}>{d.name}</div>
              <div style={{display:'flex',gap:2,justifyContent:'center',marginBottom:4}}>
                {[1,2,3,4,5].map(n => (
                  <div key={n} style={{
                    width:8,height:8,borderRadius:2,
                    background: n <= d.score ? c : '#1e2430',
                    transition:'background 0.3s'
                  }}/>
                ))}
              </div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{d.score}/5</div>
              <div style={{fontSize:9,color:'#334155',marginTop:2,lineHeight:1.3}}>{d.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Place `<HealthScorePanel met={met} rat={rat} hist={hist} stmts={stmts} scores={scores}/>` in the **Overview tab**, between the KPI grid and the Analyst Consensus section.

---

## NEW FEATURE 5 — More KPI Badges in Overview

Add these additional KPI badges to the Overview grid (after the existing 9):

```jsx
<KPIBadge label="P/Book"      value={fmt.mult(rat?.priceToBookRatioTTM ?? met?.pbRatioTTM)}     sub="price / book value"/>
<KPIBadge label="P/Sales"     value={fmt.mult(rat?.priceToSalesRatioTTM)}   sub="price / revenue TTM"/>
<KPIBadge label="Div. Yield"  value={fmt.pct(met?.dividendYieldTTM)}         sub="annual dividend yield"/>
<KPIBadge label="Beta"        value={ok(quote?.beta) ? quote.beta.toFixed(2) : (ok(prof?.beta) ? parseFloat(prof.beta).toFixed(2) : '—')} sub="market sensitivity"/>
```

Change the grid from `repeat(3,1fr)` to `repeat(4,1fr)` to fit 4 columns.

Also add a **52-week range bar** above the KPI grid:
```jsx
{ok(quote?.yearHigh) && ok(quote?.yearLow) && ok(priceNow) && (
  <div style={{marginBottom:14}}>
    <div style={{fontSize:10,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>
      52-Week Range
    </div>
    <div style={{position:'relative',height:6,background:'#1e2430',borderRadius:3}}>
      <div style={{
        position:'absolute',left:0,
        width:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
        height:'100%',background:'#3b82f6',borderRadius:3,transition:'width 0.8s ease'
      }}/>
      <div style={{
        position:'absolute',
        left:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
        top:-3,transform:'translateX(-50%)',
        width:12,height:12,background:'#fff',borderRadius:'50%',border:'2px solid #3b82f6'
      }}/>
    </div>
    <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'#475569',fontFamily:'JetBrains Mono,monospace'}}>
      <span>{fmt.price(quote.yearLow)} <span style={{color:'#334155'}}>52W Low</span></span>
      <span style={{color:'#e2e8f0',fontWeight:700}}>{fmt.price(priceNow)}</span>
      <span><span style={{color:'#334155'}}>52W High</span> {fmt.price(quote.yearHigh)}</span>
    </div>
  </div>
)}
```

---

## NEW FEATURE 6 — Historical P/E Context (Chart Tab)

In the Chart tab, after the existing price chart and technical signals, add a **P/E Valuation History** section:

This can be calculated client-side: for each historical price point, divide by TTM EPS to get implied P/E over time.

```jsx
{/* P/E History */}
{stmts.length >= 1 && hist.length > 0 && (() => {
  const annualEps = stmts[0]?.eps * 4; // rough annualization
  if (!ok(annualEps) || annualEps <= 0) return null;
  const sorted2 = [...hist].sort((a,b) => new Date(a.date)-new Date(b.date));
  const peHistory = sorted2.slice(-252).map(d => ({ date: d.date, pe: d.close / annualEps }));
  const peValues = peHistory.map(d => d.pe).filter(ok);
  const peMin = Math.min(...peValues).toFixed(1);
  const peMax = Math.max(...peValues).toFixed(1);
  const peCurrent = (priceNow / annualEps).toFixed(1);
  return (
    <div>
      <SectionTitle>Historical P/E — 1 Year</SectionTitle>
      <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>
        Current P/E: <span style={{color:'#e2e8f0',fontWeight:700,fontFamily:'JetBrains Mono,monospace'}}>{peCurrent}x</span>
        &nbsp;·&nbsp; Range: <span style={{fontFamily:'JetBrains Mono,monospace'}}>{peMin}x – {peMax}x</span>
      </div>
      <Sparkline data={peHistory.map(d=>d.pe)} type="line" color="#a78bfa" h={60} w="100%"/>
      <div style={{fontSize:9,color:'#334155',marginTop:4}}>Based on trailing quarterly EPS × 4 (annualized)</div>
    </div>
  );
})()}
```

---

## IMPORTANT: Keep All Existing Features

- All 4 original tabs (Overview, Fundamentals, Chart, Research) must still work
- Setup screen unchanged
- Finnhub integration unchanged
- AI verdict unchanged
- SEC EDGAR links unchanged
- All scoring logic unchanged (calcScores function)

---

## COMPILE AND PUSH

After ALL edits:

```
node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"
```

Then:
```
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "feat: StockLens v4.0 — fixes P/E P/FCF IC + interactive DCF + health score + analyst targets + multi-model valuation" && git push origin main
```

Verify with `git log --oneline -1` before reporting done.
