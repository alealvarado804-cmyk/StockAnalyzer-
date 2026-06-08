#!/usr/bin/env node
// scripts/smoke.js — Headless mount-check for StockLens + IC DataLayer.
//
// WHY: a runtime TDZ ("Cannot access 'X' before initialization") does NOT break
// the build — it leaves the app mounted-blank and was only ever caught by hand.
// This script loads each app PEELED (base URL, no ?ticker=, no clicks) in a
// headless Chrome and FAILS (exit != 0) if #root never gets children or if the
// page throws / logs its own errors. It catches exactly that TDZ class.
//
// COST: $0. It never analyzes a ticker, never presses Cargar/Analizar, never
// navigates to a ?ticker= route — so it triggers zero FMP/Finnhub/Anthropic
// spend. It only confirms MOUNT (mount + clean console).
//
// ZERO dependencies / ZERO downloads: drives the already-installed Chrome (or
// Edge) over the DevTools Protocol using Node's built-in fetch + WebSocket
// (Node >= 21). No Playwright/Puppeteer, no browser download.
//
// Run:  node scripts/smoke.js          (or: powershell -File scripts/smoke.ps1)
// Add a URL:  node scripts/smoke.js https://my-preview.vercel.app
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Targets: the two apps, PEELED (no ?ticker=, no auto-load). ───────────────
const APPS = [
  { name: 'StockLens',    url: 'https://stock-lens-app.vercel.app' },
  { name: 'IC DataLayer', url: 'https://ic-datalayer-app.vercel.app' },
];
// Allow extra URLs from argv (e.g. a Vercel preview deployment).
for (const a of process.argv.slice(2)) {
  if (/^https?:\/\//.test(a)) APPS.push({ name: a.replace(/^https?:\/\//, ''), url: a });
}

const MOUNT_TIMEOUT_MS = 15000;

// ── Allow-list: known third-party / benign noise to IGNORE (not own errors). ─
// Keep this minimal and documented — anything not matched here counts as a real
// failure. A TDZ surfaces as an uncaught exception and is never matched here.
const IGNORE = [
  /favicon/i,
  /manifest\.json/i,
  /\bservice ?worker\b/i,
  /ResizeObserver loop/i,
  /chrome-extension:\/\//i,
  /Download the React DevTools/i,
  /\[HMR\]/i,
  /net::ERR_/i, // resource fetch hiccups (fonts, images) — not a mount failure
];
const isIgnored = (msg) => IGNORE.some((re) => re.test(msg || ''));

// ── Locate an installed Chromium browser. ────────────────────────────────────
function findBrowser() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome/Edge found in standard install locations.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Minimal CDP client over a single browser-level WebSocket (flatten mode). ─
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this._id = 0;
    this._pending = new Map();
    this._listeners = [];
    this._ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('WS error: ' + (e.message || 'unknown'))));
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this._pending.has(msg.id)) {
        const { resolve, reject } = this._pending.get(msg.id);
        this._pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        for (const l of this._listeners) l(msg);
      }
    });
  }
  ready() { return this._ready; }
  on(fn) { this._listeners.push(fn); }
  send(method, params = {}, sessionId) {
    const id = ++this._id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this._pending.has(id)) { this._pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 20000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// ── Check a single app: returns { name, ok, mounted, errors }. ───────────────
async function checkApp(cdp, app) {
  const errors = [];
  // Fresh, isolated page per app.
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  // Capture own errors for THIS session only.
  const onEvent = (msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'Uncaught exception';
      if (!isIgnored(text)) errors.push(`pageerror: ${String(text).split('\n')[0]}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? a.value : a.description !== undefined ? a.description : a.type))
        .join(' ');
      if (!isIgnored(text)) errors.push(`console.error: ${text}`);
    }
  };
  cdp.on(onEvent);

  // Enable domains BEFORE navigating so we catch load-time TDZ exceptions.
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: app.url }, sessionId);

  // Poll for a real mount: #root must gain children.
  const evalExpr = `(()=>{var r=document.getElementById('root');return r?r.children.length:0;})()`;
  let mounted = false;
  const deadline = Date.now() + MOUNT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: evalExpr, returnByValue: true }, sessionId);
      if (r && r.result && Number(r.result.value) > 0) { mounted = true; break; }
    } catch {}
    await sleep(400);
  }

  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  this_removeListener(cdp, onEvent);

  const ok = mounted && errors.length === 0;
  return { name: app.name, url: app.url, ok, mounted, errors };
}

// listeners array has no public removal; do it directly to avoid cross-talk.
function this_removeListener(cdp, fn) {
  const i = cdp._listeners.indexOf(fn);
  if (i >= 0) cdp._listeners.splice(i, 1);
}

async function main() {
  const browser = findBrowser();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ];
  const proc = spawn(browser, args, { stdio: 'ignore' });

  let cdp;
  try {
    // Read the chosen debugging port from DevToolsActivePort (line 1).
    const portFile = path.join(userDataDir, 'DevToolsActivePort');
    let port = null;
    for (let i = 0; i < 50 && port == null; i++) {
      await sleep(200);
      if (fs.existsSync(portFile)) {
        const line = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) port = line;
      }
    }
    if (!port) throw new Error('Chrome did not expose a debugging port.');

    const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    cdp = new CDP(ver.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Target.setDiscoverTargets', { discover: true });

    const results = [];
    for (const app of APPS) results.push(await checkApp(cdp, app));

    // ── Report. ──────────────────────────────────────────────────────────────
    console.log('\n── Smoke-test: headless mount-check ───────────────────────');
    let allOk = true;
    for (const r of results) {
      if (!r.ok) allOk = false;
      const status = r.ok ? 'OK montó' : `FAIL (${!r.mounted ? '#root vacío tras timeout' : 'errores en consola'})`;
      console.log(`\n  ${r.ok ? '✅' : '❌'} ${r.name}  →  ${status}`);
      console.log(`     ${r.url}`);
      if (r.errors.length) for (const e of r.errors) console.log(`       · ${e}`);
    }
    console.log('\n───────────────────────────────────────────────────────────');
    console.log(allOk ? '✅ TODAS las apps montaron limpias.\n' : '❌ Al menos una app FALLÓ.\n');
    process.exitCode = allOk ? 0 : 1;
  } finally {
    if (cdp) cdp.close();
    try { proc.kill(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((e) => {
  console.error('smoke-test crashed:', e.message);
  process.exitCode = 2;
});
