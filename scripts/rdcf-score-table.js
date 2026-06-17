#!/usr/bin/env node
// scripts/rdcf-score-table.js — F4 before/after IC Score preview.
//
// Shows how raising RDCF_VALUATION_WEIGHT would move the IC Score for tickers
// that ALREADY have a cached reverse_dcf (written when the flag is on during
// analysis). ZERO new API quota: feed it rows exported from sl_analyses (e.g.
// via the Supabase console / MCP) as a JSON file.
//
// Rows shape (array): [{ ticker, score_total, macro_tilt, reverse_dcf }, ...]
//   reverse_dcf = the jsonb object StockLens stored (or {applicable:false,...}).
//
// Usage:  node scripts/rdcf-score-table.js [rowsFile=scripts/_rows.json] [weight=0.5]
//
// IC Score = clamp(round(micro_total + macro_tilt), 0, 100).  Reverse-DCF enters
// micro_total as weight × RDCF.valuationAdj(reverse_dcf) (same as the app).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rowsFile = path.resolve(process.cwd(), process.argv[2] || path.join('scripts', '_rows.json'));
const weight = process.argv[3] != null ? parseFloat(process.argv[3]) : 0.5;

function fail(m){ console.error('rdcf-score-table FAIL: ' + m); process.exit(1); }

// Extract the RDCF core from the jsx (same approach as rdcf-golden.js).
const src = fs.readFileSync(path.join(ROOT, 'StockAnalyzer.jsx'), 'utf8');
const m = src.match(/\/\/ RDCF-CORE-START[\s\S]*?\/\/ RDCF-CORE-END/);
if (!m) fail('RDCF-CORE markers not found');
let RDCF;
try { RDCF = new Function(m[0] + '\nreturn RDCF;')(); }
catch (e) { fail('eval RDCF: ' + e.message); }

if (!fs.existsSync(rowsFile)) fail(`rows file not found: ${rowsFile}\n  Export rows from sl_analyses (ticker, score_total, macro_tilt, reverse_dcf) as JSON first.`);
let rows;
try { rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8')); }
catch (e) { fail('rows file is not valid JSON: ' + e.message); }
if (!Array.isArray(rows)) fail('rows file must be a JSON array');

const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
const ic = (micro, tilt) => clamp((micro || 0) + (tilt || 0));

console.log(`\nReverse-DCF → IC Score · before/after at weight = ${weight}\n`);
console.log('ticker   IC before   adj(pts)   IC after   Δ   band');
console.log('───────  ─────────   ────────   ────────  ───  ───────────');
let moved = 0;
for (const r of rows) {
  const tilt = r.macro_tilt || 0;
  const before = ic(r.score_total, tilt);
  const rd = r.reverse_dcf || null;
  const adj = RDCF.valuationAdj(rd);
  const microAfter = Math.max(0, Math.min(100, (r.score_total || 0) + weight * adj));
  const after = ic(microAfter, tilt);
  const d = after - before;
  if (d !== 0) moved++;
  const band = rd && rd.applicable ? (rd.realityBand || '—') : (rd ? `n/a:${rd.reason||''}` : 'no-rdcf');
  console.log(
    `${String(r.ticker||'?').padEnd(7)}  ${String(before).padStart(9)}   ${(weight*adj).toFixed(2).padStart(8)}   ${String(after).padStart(8)}  ${(d>=0?'+':'')+d}`.padEnd(54) + `  ${band}`
  );
}
console.log(`\n${rows.length} tickers · ${moved} con cambio de IC Score a weight=${weight}.`);
console.log('Nota: weight=0 (default en la app) → Δ=0 en todos. Sube el peso solo tras revisar esta tabla.\n');
