# StockLens — Roadmap

**Live:** https://stock-analyzer-blue-beta.vercel.app  
**Repo:** alealvarado804-cmyk/StockAnalyzer-  
**Stack:** React 18 UMD · FMP stable API · Finnhub (optional) · Anthropic (optional)

---

## ✅ Completado

### v1.0
- App base con scoring 0-100, perfil de empresa, gráfico de precio, veredicto

### v2.0
- 4 tabs (Overview / Fundamentals / Chart / Research)
- DCF de FMP, panel de analistas, señales técnicas (RSI, SMA)
- ❌ Todos los tickers fallaban (FMP v3 deprecado)

### v3.0
- **Migración FMP /api/v3 → /stable/** — fix crítico, todos los tickers funcionan
- **Setup screen** obligatorio al primer uso (patrón IC DataLayer)
- Settings mejorado: Test Connection, Reset Key
- Integración Finnhub (opcional): calendario de earnings, beat/miss, insiders
- Links SEC EDGAR: Form 4, 10-K, 13F
- AI Verdict con Claude Haiku (opcional, clave Anthropic)
- Fix branding: eliminado "v2.0" y referencias a InvestingPro

### v5.0
- **Peer Comparison** — tabla automática P/E · EV/EBITDA · Gross Margin · ROIC · Mkt Cap vs sector (FMP `/stable/peers`)
- **Balance Sheet Snapshot** — caja, deuda, net debt, current ratio, intangibles; mini chart Debt vs Cash
- **Free Cash Flow Detail** — histórico trimestral FCF = Op CF − CapEx; TTM FCF, FCF margin, FCF conversion; tabla + bar chart
- **Dividends Section** (condicional) — yield, payout ratio, años consecutivos, CAGR del dividendo; barras anuales + pagos recientes
- **Chart 5Y** — período de 5 años añadido al selector 1M/3M/6M/1Y
- Peers se cargan en background (key-metrics-ttm + ratios-ttm para hasta 5 peers)
- Nuevos endpoints FMP: `cash-flow-statement`, `peers`, `historical-dividends`
- Balance sheet: annual limit=1 → quarterly limit=4

### v4.0
- **Fix P/E, P/FCF, Interest Coverage** — mostraban "—" por renombrado incorrecto de campos
- **Tab "Valuation"** (5.º tab):
  - DCF interactivo con sliders (tasa crecimiento, WACC, terminal growth, capex, beta)
  - Tabla de sensibilidad 5×3 (WACC × terminal growth)
  - Multi-model valuation: Graham Number, Relative P/E, P/FCF fair value, promedio
- **Health Score 1-5** en 5 dimensiones (crecimiento, rentabilidad, momentum, valor relativo, salud financiera)
- **Price targets individuales** de analistas (Goldman, JPMorgan, etc.) con fecha
- **KPIs adicionales:** P/Book, P/Sales, Dividend Yield, Beta
- **Barra 52-Week Range** con cursor interactivo
- **Gráfico histórico P/E** (1 año, en tab Chart)
- **"About" expandible** — eliminado el truncado fijo a 3 líneas
- **Quarterly table** muestra "Q3 2024" en vez de solo "Q3"
- **Growth chart** con etiquetas de período+año y valor actual
- Income statement aumentado a 12 quarters (de 4)

---

## 🔲 Pendiente / En revisión

### Bugs conocidos a confirmar
- [ ] Verificar que P/E, P/FCF, Interest Coverage aparecen para MSFT post-v4
- [ ] Verificar que DCF Calculator muestra valores razonables (requiere `sharesOutstanding` en quote/profile)
- [ ] Verificar que "Avg Vol" aparece en header (campo `averageVolume` en FMP stable)
- [ ] Comprobar que price targets individuales aparecen (endpoint `/stable/price-target`)

### Mejoras UX pendientes (de feedback v4)
- [ ] **Quarterly trend**: YoY % comparativo requiere 8+ quarters — con 4 siempre mostraba "—". Ahora hay 12 quarters, verificar que YoY aparece
- [ ] **DCF defaults**: si `sharesOutstanding` es null en quote, el DCF no calcula. Añadir fallback desde `profile.sharesOutstanding` o estimación desde marketCap/price
- [ ] **Consenso analistas**: mostrar también cuántos analistas hay para cada precio objetivo individual (actualmente muestra el de `upgrades-downgrades-consensus`)

---

## 🗺️ Próximas mejoras (por orden de impacto)

### Alta prioridad

**A. Peer Comparison (Comparativa con competidores)**
- Añadir endpoint FMP `/stable/peers?symbol=SYM` para obtener peers automáticamente
- Mostrar tabla comparativa: ticker · P/E · EV/EBITDA · Gross Margin · ROIC · Market Cap
- Permite ver si la empresa está cara/barata vs sector inmediato
- Nueva sección en tab Fundamentals o Valuation

**B. Historical Valuation Charts (P/E en contexto histórico)**
- El gráfico P/E del Chart tab ya está (1 año)
- Ampliar a 3-5 años si hay suficiente historial de precio
- Añadir EV/EBITDA histórico (requiere historial de revenue/EBITDA trimestral)
- Mostrar línea de mediana histórica como referencia

**C. Balance Sheet Snapshot**
- Ya se pide `/stable/balance-sheet-statement` en v4 (para DCF)
- Mostrar: caja, deuda total, patrimonio, activos totales en un panel resumen
- Ratios de liquidez: current ratio, quick ratio
- Evolución de la deuda últimos 4 trimestres

**D. Free Cash Flow Detail**
- FCF = Operating Cash Flow − CapEx
- Histórico trimestral de FCF
- FCF margin %
- FCF conversion (FCF / Net Income)
- Añadir al tab Fundamentals

### Media prioridad

**E. Screener básico (watchlist de tickers)**
- Input para guardar lista de tickers favoritos en localStorage
- Vista resumen de todos: precio · cambio diario · score · rating
- Click en uno para ir al análisis completo

**F. Short Interest & Options Data (requiere Finnhub)**
- Short interest % of float (Finnhub: `stock/short-interest`)
- Days to cover
- Put/Call ratio si disponible

**G. Dividends Section**
- Historial de dividendos (FMP: `/stable/historical-price-eod` incluye dividendos)
- Dividend yield · payout ratio · consecutive years paying · CAGR del dividendo
- Solo mostrar si la empresa paga dividendo

**H. Earnings Transcript Summary (requiere Anthropic)**
- Si el usuario tiene clave Anthropic: obtener últimos earnings del Finnhub transcript endpoint
- Pasar a Claude Haiku para resumen en 5 puntos clave
- Mostrar en tab Research

**I. Price Chart mejoras**
- Añadir período "5Y" además de 1M/3M/6M/1Y
- Overlay de EPS trimestral como anotaciones en el gráfico
- Volumen como barras en la parte inferior del chart
- Zoom con scroll del ratón

### Baja prioridad / Futuro

**J. Comparativa macroeconómica (FRED API)**
- Overlay de Fed Funds Rate en el gráfico de precio
- Contexto de P/E del mercado (S&P 500 P/E) como referencia
- FRED no requiere clave para acceso básico

**K. Exportación PDF del análisis**
- Botón "Export Report" que genera un PDF con todos los datos
- Logo + ticker + fecha + todos los scores y métricas
- Requiere habilitar la skill de PDF

**L. Institutional Holdings (FMP)**
- Top 10 inversores institucionales (FMP: `/stable/institutional-holder`)
- % de acciones en manos institucionales
- Cambios recientes (compras/ventas institucionales)

**M. Análisis de dilución**
- Historial de shares outstanding (crecimiento/decrecimiento)
- Stock buybacks vs issuance
- Impact en EPS per share a lo largo del tiempo

---

## 📋 Próximo Claude Code prompt sugerido

**Prioridad sugerida para v5.0:**
1. Peer Comparison (impacto visual alto, FMP lo da gratis)
2. Balance Sheet Snapshot (los datos ya se piden)
3. Free Cash Flow detail
4. Dividends section (condicional)
5. Chart: período 5Y + volumen

---

## 🔑 APIs activas

| API | Key storage | Plan | Límite |
|-----|------------|------|--------|
| FMP `/stable/` | `sl_fmp` | Free | 250 calls/day |
| Finnhub | `sl_finnhub` | Free | 60 calls/min |
| Anthropic | `sl_anthropic` | Pay-per-use | Por tokens |
| SEC EDGAR | Sin clave | Público | Sin límite |
| FRED | Sin clave | Público | Sin límite |
