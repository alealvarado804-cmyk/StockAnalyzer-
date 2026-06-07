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

**Infra / UX**
- **Seguridad (Fase 0):** migración a ic-proxy + Supabase magic link; rate-limit Upstash; claves fuera del navegador.
- **UI kit** (ic-ui.css tokens) + **fallback inline de tokens** en `index.html` (resiliente si ic-proxy se bloquea/cae — commit `22c3707`).
- **Fetch-on-demand (2026-06-05):** abrir = 0 llamadas; Macro Tilt / Screener / Smart Money se cargan tras "⬇ Cargar contexto" (flag `autoLoaded`). El análisis por ticker ya era manual.

---

## 🔲 Backlog — lo que falta de verdad (prioridad por impacto)

> Verificado en código 2026-06-05: 0 menciones de estas features en `StockAnalyzer.jsx`.

**1. Earnings Transcript Summary** (vía Anthropic/ic-proxy) — *alto impacto*
- Traer el último transcript (Finnhub) y resumirlo con Claude Haiku (POST `/api/anthropic/messages`) en 5 puntos clave.
- Mostrar en tab Research. Condicional a disponibilidad del transcript.

**2. Short Interest & Options** (Finnhub) — *medio*
- Short interest % of float, days to cover (`stock/short-interest`); put/call ratio si disponible.
- Sección en Overview o Fundamentals.

**3. ~~Dilución / evolución de acciones~~** — ✅ Hecho (2026-06-07)
- `DilutionPanel` en tab Fundamentals: serie trimestral de `weightedAverageShsOutDil`, Δ YoY y Δ ventana, buybacks vs issuance TTM (cash-flow) + nota de impacto en EPS. Sin API nueva (reusa `stmts` + `cfStmts`).

**4. ~~Export PDF del análisis~~** — ✅ Hecho (2026-06-07)
- jsPDF (cdnjs 2.5.1) en `index.html` antes de `StockAnalyzer.js`. Botón "⬇ Export Report" en la cabecera (solo con análisis cargado) → PDF con ticker+nombre, fecha, score compuesto + subscores, rating, KPIs TTM, veredicto IA (si existe) y disclaimer. Client-side, sin API.

**Ideas menores / futuras:** overlay FRED (Fed Funds) en el gráfico de precio; EV/EBITDA histórico con mediana; volumen como barras en el chart; zoom con scroll.

---

## 🧪 QA pendiente (confirmar con un par de tickers reales)
- [ ] P/E, P/FCF, Interest Coverage aparecen (no "—") para MSFT/AAPL.
- [ ] DCF Calculator da valores razonables (depende de `sharesOutstanding` en quote/profile; añadir fallback desde `profile` o marketCap/price si es null).
- [ ] "Avg Vol" en header (`averageVolume`).
- [ ] Price targets individuales (`/stable/price-target`).
- [ ] Quarterly YoY % aparece ahora que hay 12 quarters.

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
