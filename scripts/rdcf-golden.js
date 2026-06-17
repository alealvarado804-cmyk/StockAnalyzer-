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

console.log('rdcf-golden OK');
console.log(`  golden: impliedG1=${(out.impliedG1*100).toFixed(4)}%  EV=${out.ev.toFixed(4)} B$  (|Δg1|=${dG1.toExponential(2)}, |ΔEV|=${dEV.toExponential(2)})`);
console.log(`  CAGR=${(out.revCagr*100).toFixed(2)}%  band="${out.realityBand}"  tvShare=${(out.tvShare*100).toFixed(1)}%  exitMult=${out.impliedExitMultiple.toFixed(1)}x  perShare=$${out.perShare.toFixed(2)}`);
console.log(`  degradation: sector_excluded / negative_fcf / missing_data all return applicable:false (no throw)`);
console.log(`  rf: fallback=${(RDCF.CONFIG.rfDefault*100).toFixed(1)}% (low-confidence) · dgs10 used when macro_state has it`);
process.exit(0);
