#!/usr/bin/env node
// scripts/validate-js.js — structural validation of the committed StockAnalyzer.js
// against OneDrive truncation / encoding damage. Reads from disk. No network.
'use strict';
const fs = require('fs');
const path = require('path');
const NUL = String.fromCharCode(0);
const js = fs.readFileSync(path.resolve(__dirname, '..', 'StockAnalyzer.js'), 'utf8');
const bal = (s, o, c) => { let n = 0; for (const ch of s) { if (ch === o) n++; else if (ch === c) n--; } return n; };
const checks = [
  ['size>250k',           js.length > 250000, js.length],
  ['ReactDOM.createRoot', /ReactDOM\.createRoot/.test(js)],
  ['mount tail render(',  /render\s*\(/.test(js.slice(-400))],
  ['no null bytes',       js.indexOf(NUL) === -1],
  ['RDCF present',        /RDCF/.test(js)],
  ['reverseDcf present',  /reverseDcf/.test(js)],
  ['FLAGS present',       /REVERSE_DCF_ENABLED/.test(js)],
  ['balanced ()',         bal(js, '(', ')') === 0, bal(js, '(', ')')],
  ['balanced []',         bal(js, '[', ']') === 0, bal(js, '[', ']')],
  ['balanced {}',         bal(js, '{', '}') === 0, bal(js, '{', '}')],
];
let allOk = true;
for (const c of checks) { if (!c[1]) allOk = false; console.log((c[1] ? '  OK  ' : 'FAIL  ') + c[0] + (c[2] !== undefined ? `  [${c[2]}]` : '')); }
console.log(allOk ? 'validate-js OK' : 'validate-js FAIL');
process.exit(allOk ? 0 : 1);
