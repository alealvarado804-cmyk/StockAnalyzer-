# StockLens — Fix Prompt for Claude Code

## CONTEXT

You are working on StockLens, a stock analysis React app at:
`C:\Users\aaao0\OneDrive\Documents\Claude\Projects\FINANCE AI\StockAnalyzer\`

Files:
- `StockAnalyzer.jsx` — React source (edit this)
- `StockAnalyzer.js` — Compiled output (regenerate after every JSX edit)
- `index.html` — DO NOT TOUCH

**Architecture:** React 18 UMD from CDN. No imports. Pre-compiled JSX. No build step in browser.

**Compile command (PowerShell, run from StockAnalyzer folder):**
```
node -e "const fs=require('fs');const babel=require('@babel/core');const pr=require('@babel/preset-react');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transformSync(src,{presets:[[pr]],filename:'StockAnalyzer.jsx'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length,'bytes')"
```

After compiling, push:
```
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "fix: setup screen + api fixes" && git push origin main
```

---

## PROBLEMS TO FIX

### Problem 1 — Text/Branding
In the empty state (home screen), currently shows:
- "StockLens v2.0" → change to just **"StockLens"**
- Subtitle mentions "InvestingPro-style deep analysis" → **remove all InvestingPro references**. This is an independent tool. Replace with something neutral like: "Professional stock analysis — enter any ticker to get started."
- The navbar badge "v2.0" is fine to keep.

### Problem 2 — No ticker works ("Ticker X not found" on every ticker)
**Root cause:** The hardcoded FMP API key `wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2` has hit its 250-calls/day free-tier rate limit. When rate limited, FMP returns `{"Error Message": "Limit Reach . Please upgrade your plan or visit our documentation for more details https://site.financialmodelingprep.com/developer/docs/pricing"}` OR empty arrays for all endpoints. Both cases result in null for quote+profile, triggering the "not found" error.

**Fix:** The app must NOT rely on a hardcoded shared key. Each user must enter their own FMP API key. The app should show a **mandatory setup screen** (similar to IC DataLayer pattern) before any analysis can happen.

### Problem 3 — No first-run setup experience
The current ⚙ settings button is too hidden. Users must know to look for it. There's no guidance on what API key to get or how.

---

## WHAT TO BUILD

### A) First-Run Setup Screen (mandatory)

Create a `keysSubmitted` state (boolean) following the IC DataLayer pattern:

```js
const [keysSubmitted, setKeysSubmitted] = useState(() => {
  try {
    const stored = localStorage.getItem('sl_fmp');
    return !!(stored && stored.trim().length > 10);
  } catch { return false; }
});
```

If `!keysSubmitted`, show a full-screen setup panel INSTEAD of the normal app. This screen should:

1. Show the StockLens logo/name centered
2. Explain: "To use StockLens, you need a free API key from Financial Modeling Prep."
3. Show a link: `financialmodelingprep.com/developer/docs` (or `site.financialmodelingprep.com/register`)
4. Have an input field: "FMP API Key" with placeholder `Enter your FMP API key...`
5. Have a **"Test & Save"** button that:
   - Calls `https://financialmodelingprep.com/api/v3/quote/AAPL?apikey={enteredKey}`
   - If response is valid array with data → save to localStorage `sl_fmp`, set `keysSubmitted = true`
   - If rate limit error → show red message: "This key has reached its daily limit. Try again tomorrow or use a different key."
   - If invalid key → show: "Invalid API key. Check it and try again."
   - While testing → show spinner in button: "Testing..."
6. Small gray note at bottom: "Free plan: 250 API calls/day. Enough for ~25 tickers/day. Key is stored locally only."

Style: dark theme matching the rest of the app (`#07080c` background, `#0c0e14` card, `#3b82f6` button).

### B) Settings Tab / Reset

When `keysSubmitted = true`, the ⚙ button should still work to change the API key.

Add a **"Reset Key"** button in the settings panel that sets `keysSubmitted = false` and clears localStorage, sending the user back to the setup screen.

Also add a **"Test Connection"** button in settings that re-runs the AAPL probe and shows ✓ or ✗ with the error message.

### C) Better API Error Messages

In `fmpGet`, detect specific FMP error patterns and throw descriptive errors:

```js
const fmpGet = async (path) => {
  const sep = path.includes('?') ? '&' : '?';
  const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${fmpKey}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('Network error — check your internet connection');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Invalid API key — go to Settings (⚙) to update it');
  if (!res.ok) throw new Error(`API error (HTTP ${res.status})`);
  const data = await res.json();
  if (data?.['Error Message']) {
    const msg = data['Error Message'];
    if (msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('upgrade'))
      throw new Error('API daily limit reached (250 calls/day on free plan) — try again tomorrow or use a different key');
    if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('apikey'))
      throw new Error('Invalid API key — go to Settings (⚙) to update it');
    throw new Error(msg);
  }
  if (Array.isArray(data) && data.length === 0) return null;
  return data;
};
```

When the error message mentions "limit" or "Settings", make the error panel show a button:
```jsx
{error && error.includes('Settings') && (
  <button onClick={() => setShowCfg(true)} style={{...}}>Open Settings ⚙</button>
)}
```

### D) Remove hardcoded default key

Change:
```js
const DEFAULT_FMP_KEY = 'wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2';
```
To:
```js
const DEFAULT_FMP_KEY = '';
```

The key now comes only from localStorage. If empty, the setup screen shows.

### E) Text fixes (quick changes)

1. In the empty state h1: change "StockLens v2.0" → "StockLens"
2. In the empty state subtitle: remove "InvestingPro-style" and any InvestingPro reference
3. New subtitle text: "Professional stock analysis — enter any ticker to get started."
4. Keep the quick-pick buttons (AAPL, MSFT, NVDA, etc.) as they are

---

## FULL FLOW AFTER FIX

1. User opens `stock-analyzer-blue-beta.vercel.app` for first time
2. Sees setup screen: "StockLens — Enter your FMP API key"
3. Pastes key, clicks "Test & Save"
4. App tests AAPL quote — if OK, saves key and enters app
5. App shows empty state: "StockLens — Professional stock analysis..."
6. User types any ticker and clicks Analyze (or clicks a quick-pick)
7. If daily limit hit mid-session: clear error message with "try again tomorrow" + "Open Settings" button

---

## IMPORTANT CONSTRAINTS

- DO NOT change `index.html`
- Keep all existing v2.0 features (tabs, analyst panel, DCF, chart, etc.)
- All code in single `StockAnalyzer.jsx` — no separate files
- No `import` statements
- After all edits: compile to `StockAnalyzer.js`, then git add + commit + push
- Verify push succeeded before finishing
