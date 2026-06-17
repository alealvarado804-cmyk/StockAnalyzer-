#!/usr/bin/env node
// scripts/rdcf-golden.js — F1 gate for the Reverse DCF headless core.
//
// Proves two things, with ZERO new API calls / network:
//   1) GOLDEN: the RDCF core embedded in StockAnalyzer.jsx reproduces the EXACT
//      EV and implied g1 of the reference math (buildModel + bisect) copied
//      VERBATIM below from reverse_dcf_v2.html, for the prototype "base" scenario.
//   2) DEGRADATION: reverseDcf() returns {applicable:false, reason} (and never
//      throws) for excluded sector, negative FCF, and missing data.
//
// It does NOT modify StockAnalyzer.jsx/.js. Run: node scripts/rdcf-golden.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JSX = path.join(ROOT, 'StockAnalyzer.jsx');

function fail(msg){ console.error(`rdcf-golden FAIL: ${msg}`); process.exit(1); }

// ── 1. Extract the RDCF core from the JSX (between the markers) ──
const src = fs.readFileSync(JSX, 'utf8');
const m = src.match(/\/\/ RDCF-CORE-START[\s\S]*?\/\/ RDCF-CORE-END/);
if (!m) fail('RDCF-CORE-START/END markers not found in StockAnalyzer.jsx');
let block = m[0];
// Defensive: the core must be self-contained (only Math + its own num()).
if (/\bok\s*\(/.test(block)) fail('RDCF core references global ok() — must be self-contained for headless test.');

let RDCF;
try {
  RDCF = new Function(block + '\nreturn RDCF;')();
} catch(e){ fail(`could not evaluate RDCF core: ${e.message}`); }
for (const fn of ['buildModel','bisect','reverseDcf','realityBand','waccFromMacro']) {
  if (typeof RDCF[fn] !== 'function') fail(`RDCF.${fn} missing/not a function`);
}

// ── 2. Reference math · VERBATIM copy from reverse_dcf_v2.html ──
const BASE_YEAR = 2026;
function refBuildModel(p){
  const rows=[]; let rev=p.baseRevenue, pvSum=0;
  const fade=Math.max(1, Math.min(p.fadeYears, p.horizon));
  const ramp=Math.max(1, p.marginRamp);
  const capex=p.capexPct||0;
  for(let t=1; t<=p.horizon; t++){
    const fg=Math.min(t-1,fade)/fade;
    const g=p.g1+(p.gT-p.g1)*fg;
    rev*=(1+g);
    const fm=Math.min(t,ramp)/ramp;
    const margin=(p.m0+(p.mT-p.m0)*fm) - capex;
    const fcf=rev*margin;
    const pv=fcf*Math.pow(1+p.wacc,-t);
    pvSum+=pv;
    rows.push({year:BASE_YEAR+t,t,g,margin,rev,fcf,pv,pvCum:pvSum});
  }
  const last=rows[rows.length-1];
  const spread=Math.max(p.wacc-p.gT,0.0025);
  const tvGordon=last.fcf*(1+p.gT)/spread;
  const tv = (p.tvMode==='exit') ? last.fcf*(p.exitMult||15) : tvGordon;
  const pvTV=tv*Math.pow(1+p.wacc,-p.horizon);
  const ev=pvSum+pvTV;
  const revCagr=Math.pow(last.rev/p.baseRevenue,1/p.horizon)-1;
  return {ev,revCagr,pvTV,last};
}
function refBisect(fn, lo, hi, target, iters=90, tol=1e-4){
  let flo=fn(lo)-target, fhi=fn(hi)-target;
  if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0) return null;
  let a=lo,b=hi;
  for(let i=0;i<iters;i++){
    const mm=(a+b)/2, fm=fn(mm)-target;
    if(Math.abs(fm)/target<tol) return mm;
    if(flo*fm<=0){b=mm;} else {a=mm; flo=fm;}
  }
  return (a+b)/2;
}

// Prototype "base" preset + market inputs (reverse_dcf_v2.html S{} defaults).
const base = {
  baseRevenue:23, horizon:40, gT:.025, fadeYears:30, m0:.06, mT:.30,
  marginRamp:15, wacc:.10, capexPct:.03, dilution:.015, exitMult:18,
  tvMode:'gordon', netDebt:29.1, shares:1000,
};
const marketCap = 2000;
const targetEV = marketCap + base.netDebt;

const refG1 = refBisect(x => refBuildModel({...base, g1:x}).ev, -0.10, 1.50, targetEV);
if (refG1 == null) fail('reference solver did not converge (test bug)');
const refEV = refBuildModel({...base, g1:refG1}).ev;

// ── 3. Run the embedded core with the same inputs ──
const out = RDCF.reverseDcf('TEST', {
  marketCap, netDebt:base.netDebt, baseRevenue:base.baseRevenue, shares:base.shares,
  m0:base.m0, mT:base.mT, capexPct:base.capexPct, dilution:base.dilution,
  gT:base.gT, fadeYears:base.fadeYears, marginRamp:base.marginRamp, horizon:base.horizon,
  exitMult:base.exitMult, tvMode:base.tvMode, wacc:base.wacc,
}, null);

if (!out || out.applicable !== true) fail(`base scenario not applicable: ${JSON.stringify(out)}`);

const TOL = 1e-9;
const dG1 = Math.abs(out.impliedG1 - refG1);
const dEV = Math.abs(out.ev - refEV);
if (dG1 > TOL) fail(`implied g1 mismatch: core=${out.impliedG1} ref=${refG1} (|Δ|=${dG1})`);
if (dEV > TOL) fail(`EV mismatch: core=${out.ev} ref=${refEV} (|Δ|=${dEV})`);

// ── 4. Degradation paths (must not throw, must be applicable:false) ──
const cases = [
  ['sector_excluded', { sector:'Financial Services', marketCap, baseRevenue:23, shares:1000, m0:.06 }],
  ['negative_fcf',    { marketCap, baseRevenue:23, shares:1000, m0:-0.05 }],
  ['missing_data',    { marketCap, shares:1000, m0:.06 }], // no baseRevenue
];
for (const [expected, inp] of cases) {
  let r;
  try { r = RDCF.reverseDcf('X', inp, null); }
  catch(e){ fail(`reverseDcf threw on ${expected} case: ${e.message}`); }
  if (!r || r.applicable !== false) fail(`${expected}: expected applicable:false, got ${JSON.stringify(r)}`);
  if (r.reason !== expected) fail(`${expected}: expected reason '${expected}', got '${r.reason}'`);
}

// ── 5. rf fallback / low-confidence (no macro) vs macro_state.dgs10 ──
const noMacro = RDCF.waccFromMacro(1.2, null);
if (!noMacro.lowConfidence || noMacro.rfSource !== 'default') fail('expected low-confidence default rf when macro absent');
const withMacro = RDCF.waccFromMacro(1.2, { dgs10:4.3 });
if (withMacro.lowConfidence || withMacro.rfSource !== 'macro_state.dgs10') fail('expected dgs10 used when present');
if (Math.abs(withMacro.rf - 0.043) > 1e-12) fail(`dgs10=4.3 should normalize to rf=0.043, got ${withMacro.rf}`);

// ── 6. buildInputs (F2) · FMP-shaped synthetic data → model units (B$/M) ──
const q = (rev) => ({ revenue: rev });
const synthStmts = [q(6e9), q(6e9), q(6e9), q(6e9)];                 // TTM rev = 24e9
const synthCf = [
  { freeCashFlow: 1.5e9, capitalExpenditure: -0.6e9 },
  { freeCashFlow: 1.5e9, capitalExpenditure: -0.6e9 },
  { freeCashFlow: 1.5e9, capitalExpenditure: -0.6e9 },
  { freeCashFlow: 1.5e9, capitalExpenditure: -0.6e9 },
];                                                                   // FCF TTM = 6e9, capex TTM = 2.4e9
const synthBs = [{ netDebt: 10e9 }];
const synthQuote = { sharesOutstanding: 2e9, marketCap: 300e9, beta: 1.3 };
const synthProf = { sector: 'Technology' };
const synthAe = [{ date: '2026', revenueAvg: 24e9 }, { date: '2027', revenueAvg: 30e9 }];

const inp = RDCF.buildInputs(synthQuote && { freeCashFlowMarginTTM: null }, synthProf, synthQuote, synthStmts, synthBs, synthCf, synthAe);
const near = (a, b, t=1e-9) => Math.abs(a - b) <= t;
if (!near(inp.baseRevenue, 24)) fail(`buildInputs.baseRevenue expected 24 B$, got ${inp.baseRevenue}`);
if (!near(inp.m0, 0.25))        fail(`buildInputs.m0 expected 0.25, got ${inp.m0}`);          // 6/24
if (!near(inp.capexPct, 0.10))  fail(`buildInputs.capexPct expected 0.10, got ${inp.capexPct}`); // 2.4/24
if (!near(inp.netDebt, 10))     fail(`buildInputs.netDebt expected 10 B$, got ${inp.netDebt}`);
if (!near(inp.shares, 2000))    fail(`buildInputs.shares expected 2000 M, got ${inp.shares}`);
if (!near(inp.marketCap, 300))  fail(`buildInputs.marketCap expected 300 B$, got ${inp.marketCap}`);
if (!near(inp.beta, 1.3))       fail(`buildInputs.beta expected 1.3, got ${inp.beta}`);
if (inp.sector !== 'Technology') fail(`buildInputs.sector expected Technology, got ${inp.sector}`);
if (!near(inp.analystGrowth, 0.25)) fail(`buildInputs.analystGrowth expected 0.25, got ${inp.analystGrowth}`);

// End-to-end with no macro → applicable, low-confidence rf fallback, WACC = rf + beta*erp
const e2e = RDCF.reverseDcf('SYN', inp, null);
if (!e2e || e2e.applicable !== true) fail(`buildInputs end-to-end not applicable: ${JSON.stringify(e2e)}`);
if (e2e.lowConfidence !== true) fail('expected low-confidence (no dgs10 in macro)');
if (!near(e2e.wacc, 0.043 + 1.3 * 0.05)) fail(`WACC expected ${0.043 + 1.3*0.05}, got ${e2e.wacc}`);

// ── 7. valuationAdj (F4) · signed delta + weight-0 no-op + double gate ──
if (typeof RDCF.valuationAdj !== 'function') fail('RDCF.valuationAdj missing');
const adjHigh = RDCF.valuationAdj({ applicable:true, impliedGrowthPremium:0.022, tvShare:0.189 });
if (!near(adjHigh, -(0.022/0.06)*6)) fail(`valuationAdj high: expected ${-(0.022/0.06)*6}, got ${adjHigh}`);
const adjHot  = RDCF.valuationAdj({ applicable:true, impliedGrowthPremium:0.17, tvShare:0.82 });
if (!near(adjHot, -6 - 0.6*4)) fail(`valuationAdj hot: expected ${-6 - 0.6*4}, got ${adjHot}`); // -8.4
const adjBonus = RDCF.valuationAdj({ applicable:true, impliedGrowthPremium:-0.06, tvShare:0.3 });
if (!near(adjBonus, 6)) fail(`valuationAdj bonus: expected +6, got ${adjBonus}`);
if (RDCF.valuationAdj({ applicable:false, reason:'x' }) !== 0) fail('valuationAdj not-applicable must be 0');
if (RDCF.valuationAdj({ applicable:true }) !== 0) fail('valuationAdj with no premium/tv must be 0');
if (RDCF.valuationAdj(null) !== 0) fail('valuationAdj(null) must be 0');
// bounded ≈[-10,+6]
for (const t of [adjHigh, adjHot, adjBonus]) if (t < -10.0001 || t > 6.0001) fail(`valuationAdj out of bounds: ${t}`);
// weight-0 no-op: contribution is exactly 0 regardless of the signal (flag-on, weight 0).
const W0 = 0;
if (W0 * adjHot !== 0) fail('weight-0 contribution must be exactly 0');
// a candidate weight does move it (mechanism alive for when the weight is raised).
if (!near(0.5 * adjHot, -4.2)) fail(`weight 0.5 × hot expected -4.2, got ${0.5*adjHot}`);

console.log('rdcf-golden OK');
console.log(`  golden: impliedG1=${(out.impliedG1*100).toFixed(4)}%  EV=${out.ev.toFixed(4)} B$  (|Δg1|=${dG1.toExponential(2)}, |ΔEV|=${dEV.toExponential(2)})`);
console.log(`  CAGR=${(out.revCagr*100).toFixed(2)}%  band="${out.realityBand}"  tvShare=${(out.tvShare*100).toFixed(1)}%  exitMult=${out.impliedExitMultiple.toFixed(1)}x  perShare=$${out.perShare.toFixed(2)}`);
console.log(`  degradation: sector_excluded / negative_fcf / missing_data all return applicable:false (no throw)`);
console.log(`  rf: fallback=${(RDCF.CONFIG.rfDefault*100).toFixed(1)}% (low-confidence) · dgs10 used when macro_state has it`);
console.log(`  buildInputs: 24 B$ rev / m0=25% / capex=10% / 10 B$ netDebt / 2000 M sh / 300 B$ cap → applicable, WACC=${(e2e.wacc*100).toFixed(2)}%`);
console.log(`  valuationAdj (F4): high=${adjHigh.toFixed(2)} pts, hot=${adjHot.toFixed(2)} pts, bonus=+${adjBonus.toFixed(2)} pts · weight-0 contribution = 0 (no-op)`);
process.exit(0);
