# StockLens — Roadmap

**Live:** https://stock-lens-app.vercel.app  (el viejo stock-analyzer-blue-beta.vercel.app redirige aquí)
**Repo:** alealvarado804-cmyk/StockAnalyzer-  ·  **main** (Vercel auto-deploy on push)
**Stack:** React 18 UMD (JSX → babel-standalone → `.js`) · ic-proxy (Vercel Edge) para FMP/Finnhub/Anthropic · Supabase Auth (magic link) · **claves 100% server-side, sin nada en el cliente**

> Workflow: editar `StockAnalyzer.jsx`, **recompilar** a `StockAnalyzer.js`, commitear AMBOS, push. Ver `CLAUDE.md`.

---

## ✅ Hecho (estado real, act. 2026-06-05)

**Núcleo de análisis**
- Scoring 0-100 (Valuation 25 · Health 30 · Momentum 25 · Growth 20) + rating (STRONG BUY/BUY/HOLD/CAUTION/AVOID).
- 7 tabs: Overview · Fundamentals · Chart · Valuation · Research · Screener · Smart Money.
- Perfil, precio (1M/3M/6M/1Y/**5Y**), 52-week range interactivo, P/E histórico.
- FMP `/stable/` (v3 deprecado), campos TTM renombrados correctos.

**Fundamentals / Valuation**
- **Peer Comparison** automático (P/E · EV/EBITDA · Gross Margin · ROIC · Mkt Cap vs sector, `/stable/peers`).
- **Balance Sheet Snapshot** (caja, deuda, net debt, current ratio, intangibles + mini chart).
- **Free Cash Flow Detail** (FCF trimestral, TTM FCF, FCF margin, FCF conversion).
- **Dividends** (yield, payout, años consecutivos, CAGR — condicional).
- **DCF interactivo** (sliders WACC/crecimiento/terminal/capex/beta) + sensibilidad 5×3 + multi-model (Graham, P/E relativo, P/FCF).
- **Health Score 1-5** en 5 dimensiones · price targets individuales de analistas · KPIs (P/Book, P/Sales, Beta…).

**Smart Money (lee Supabase, cron de ic-proxy)**
- Funds 13F Tracker · Consensus (issuers en ≥3 fondos) · Jensen Pattern. (Insider panel descartado: sin fuente free market-wide.)

**Screener / Watchlist** — guardar tickers, vista resumen, click → análisis.
**Macro Tilt** — badge de régimen macro (lee `macro_state`).
**Macro Tilt que muerde (2026-06-08):** ✅ Hecho. El tilt ya no es solo badge: (A) "Score ajustado por macro" visible en Overview (número + rating + delta + razones; resalta cambio de banda, p.ej. BUY → HOLD) + línea en Export PDF; (B) régimen/cuadrante/tilt/razones como contexto en el AI Verdict y el AI Earnings. Sin tocar `calcScores` (capa de display, `macroAdj = clamp(total + tilt, 0, 100)`). Degrada si no hay tilt. commit `9145cb4`.
**IC Score — Score Unificado macro×micro (2026-06-08):** ✅ Hecho. Métrica canónica única en ambas apps: helper `icScore(total,tilt)=clamp(round(total+tilt),0,100)`, mismas bandas (getRating 80/65/50/35). Bloque Overview rebautizado "IC Score (macro × micro)"; columna "IC Score" (color por banda) + orden en Screener/Watchlist; línea PDF "IC Score: NN/100". Recompute-on-read (sin migración). Espejo exacto en IC DataLayer (panel Tu Watchlist, columna IC Score). commit `ac65b8a`. **Integración macro↔micro CERRADA** (#1 tilt muerde + #2 panel watchlist + #3 IC Score).

**Infra / UX**
- **Seguridad (Fase 0):** migración a ic-proxy + Supabase magic link; rate-limit Upstash; claves fuera del navegador.
- **UI kit** (ic-ui.css tokens) + **fallback inline de tokens** en `index.html` (resiliente si ic-proxy se bloquea/cae — commit `22c3707`).
- **Fetch-on-demand (2026-06-05):** abrir = 0 llamadas; Macro Tilt / Screener / Smart Money se cargan tras "⬇ Cargar contexto" (flag `autoLoaded`). El análisis por ticker ya era manual.

---

## 🔲 Backlog — lo que falta de verdad (prioridad por impacto)

> Verificado en código 2026-06-05: 0 menciones de estas features en `StockAnalyzer.jsx`.

> **Nota IA (2026-06-07):** TODAS las llamadas Anthropic de StockLens usan `claude-sonnet-4-6` (antes Haiku). Opus NO está permitido por la allow-list del proxy. 0 `claude-haiku` en el código.

**1. ~~Earnings Transcript Summary~~ → AI Earnings Analysis** — ✅ Hecho (pivote 2026-06-07)
- No hay API free de transcripts (Finnhub/FMP/AlphaVantage/API-Ninjas premium) → **pivote**: `summarizeEarnings` ensambla un JSON compacto con datos FMP ya disponibles (income-statement últimos ~8Q + márgenes, sorpresa EPS del último Q, `analyst-estimates`, `price-target-consensus`, `upgrades-downgrades-consensus`, P/E TTM, precio) y lo analiza con `claude-sonnet-4-6` (max_tokens 700) en 5 puntos (último Q beat/miss, tendencia rev/EPS, márgenes, sentimiento/PT, lectura forward). Sección tab Research **gated por botón** "📊 Analizar últimos earnings" (1 llamada Anthropic). Estados loading/resultado/vacío/error, cache por ticker, disclaimer "no es asesoría". $0 de datos extra (sin endpoints nuevos ni Finnhub transcript).

**2. ~~Short Interest & Options~~** — ✅ Hecho (2026-06-07) · placeholder (sin fuente free fiable)
- `ShortInterestPanel` en tab Overview: short interest, % shares out (proxy float), days to cover (SI/avg vol) + sparkline, vía `finnhubGet('stock/short-interest')`. Finnhub short-interest es premium → la sección **queda como placeholder** "no disponible en plan actual" (degrada limpio). No se invierte más aquí hasta tener fuente free. (Put/call ratio omitido: opciones premium.)

**3. ~~Dilución / evolución de acciones~~** — ✅ Hecho (2026-06-07)
- `DilutionPanel` en tab Fundamentals: serie trimestral de `weightedAverageShsOutDil`, Δ YoY y Δ ventana, buybacks vs issuance TTM (cash-flow) + nota de impacto en EPS. Sin API nueva (reusa `stmts` + `cfStmts`).

**4. ~~Export PDF del análisis~~** — ✅ Hecho (2026-06-07)
- jsPDF (cdnjs 2.5.1) en `index.html` antes de `StockAnalyzer.js`. Botón "⬇ Export Report" en la cabecera (solo con análisis cargado) → PDF con ticker+nombre, fecha, score compuesto + subscores, rating, KPIs TTM, veredicto IA (si existe) y disclaimer. Client-side, sin API.

**Ideas del gráfico** — ✅ Hecho (2026-06-07)
- **Barras de volumen up/down** — banda inferior del `PriceChart` tintada verde/rojo según `close ≥ closePrevio` (opacidad 0.3). `feat(chart): barras de volumen con color up/down`.
- **Zoom con rueda** — estado `zoom {startIdx,endIdx}` sobre el slice del período; listener `wheel` nativo no-pasivo anclado al cursor (mín. 10 puntos); botón "reset zoom"; cambiar de período/ticker resetea. `feat(chart): zoom con rueda del ratón en el gráfico de precio`.
- **EV/EBITDA histórico + mediana** — panel `EVEBITDAHistory` en tab Valuation: EV = precio·acciones + deuda − caja, EBITDA TTM (4Q), línea + mediana dashed + actual; degrada limpio. `balance-sheet-statement` subido a limit 12. `feat(valuation): EV/EBITDA histórico con línea de mediana`.
- **Overlay FRED Fed Funds** — toggle gated sobre el chart (solo trae `/api/fred/series?series_id=FEDFUNDS` al activar, cache por sesión); 2ª polyline ámbar con eje Y secundario (%), step mensual alineado por fecha; estados loading/error. `feat(chart): overlay opcional Fed Funds (FRED) con eje secundario`.

---

## 🧪 QA (act. 2026-06-07)
- [x] P/E, P/FCF, Interest Coverage aparecen (no "—") para MSFT/AAPL. — P/E (`peRatioTTM??priceToEarningsRatioTTM`) e Interest Coverage (`interestCoverageTTM??interestCoverageRatioTTM`) ya tenían ambos aliases; añadido 3er alias P/FCF `priceToFreeCashFlowsRatioTTM` por robustez.
- [x] DCF Calculator da valores razonables. — añadido fallback final de `shares` = `marketCap/price` (precio de `quote` o último `close` de `history`) cuando `sharesOutstanding` es null en quote y profile.
- [x] "Avg Vol" en header. — añadido fallback `averageVolume ?? avgVolume ?? volAvg` (header + panel short-interest).
- [x] Price targets individuales (`/stable/price-target`). — parseo correcto (`analystCompany||analystName`, `priceTarget`, `publishedDate`); si el array viene vacío la sección se oculta y queda el consenso (degrada limpio). Sin cambios.
- [x] Quarterly YoY % aparece ahora que hay 12 quarters. — el lookup empareja `period` + `calendarYear-1` sobre los 12 quarters de `stmts`; correcto. Sin cambios.

---

## 🔑 APIs activas

| API | Acceso | Plan | Límite proxy |
|-----|--------|------|--------------|
| FMP `/stable/` | vía ic-proxy (`FMP_KEY` server-side) | Free | 40/min/usuario (FMP: 250/día) |
| Finnhub | vía ic-proxy (`FINNHUB_KEY` server-side) | Free | 30/min/usuario |
| Anthropic | vía ic-proxy (`ANTHROPIC_KEY` server-side) | Pay-per-use | 5/min/usuario |
| SEC EDGAR | directo, sin clave | Público | — |
| FRED | vía ic-proxy (`FRED_KEY`) | Público | 10/min/usuario |

> Las claves NO viven en `localStorage`. Son env vars server-side en Vercel (proyecto `ic-proxy`). El cliente solo manda el JWT de Supabase.
