#!/usr/bin/env node
// scripts/compile-check.js - Compile gate for StockLens (cheap, high value).
//
// Babel-compiles StockAnalyzer.jsx (the same babel-standalone toolchain used to
// build StockAnalyzer.js) and FAILS (exit != 0) if it does not compile, or if
// the output is missing ReactDOM / has a truncated tail. This is the "compila"
// half of the safety net; scripts/smoke.js is the "monta" half.
//
// It does NOT overwrite StockAnalyzer.js - it only validates. Run the real
// build (see CLAUDE.md) separately to update the committed .js.
//
// Run:  node scripts/compile-check.js
'use strict';
const fs = require('fs');
const path = require('path');

const BABEL = process.env.BABEL_STANDALONE || 'C:/Users/aaao0/bin/babel-standalone.js';
const ROOT = path.resolve(__dirname, '..');
const JSX = path.join(ROOT, 'StockAnalyzer.jsx');

function fail(msg) { console.error(`compile-check FAIL: ${msg}`); process.exit(1); }

if (!fs.existsSync(JSX)) fail(`source not found: ${JSX}`);
let babel;
try { babel = require(BABEL); }
catch (e) { fail(`cannot load babel-standalone at ${BABEL} (set BABEL_STANDALONE): ${e.message}`); }

const src = fs.readFileSync(JSX, 'utf8');
let code;
try {
  code = babel.transform(src, { presets: ['react'], filename: 'StockAnalyzer.jsx', sourceType: 'script' }).code;
} catch (e) {
  fail(`babel did not compile: ${e.message}`);
}

// Structural checks: ReactDOM present + mount tail intact (not truncated).
if (!/ReactDOM/.test(code)) fail('compiled output has no ReactDOM reference.');
if (!/ReactDOM\.createRoot/.test(code)) fail('compiled output missing ReactDOM.createRoot mount.');
if (!/createElement\(\s*App/.test(code)) fail('compiled output missing App mount tail (likely truncated).');
const tail = code.slice(-400);
if (!/render\s*\(/.test(tail)) fail('mount .render(...) not found near end of file (likely truncated).');
if (code.indexOf('\u0000') !== -1) fail('compiled output contains null bytes.');

console.log(`compile-check OK - StockAnalyzer.jsx compiles (${code.length} bytes), ReactDOM + mount tail present.`);
process.exit(0);
