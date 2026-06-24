// ============================================================
// StockLens v3.0 — Stock Analysis App
// Stack: React 18 UMD · Financial Modeling Prep API (stable)
// No imports — global React from CDN, pre-compiled by Babel
// ============================================================

const { useState, useCallback, useMemo, useRef, useEffect } = React;
const PROXY_URL = 'https://ic-proxy-psi.vercel.app';
const SUPABASE_URL = 'https://acxaosesbsprrusdvgop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjeGFvc2VzYnNwcnJ1c2R2Z29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0OTg2MjIsImV4cCI6MjA4OTA3NDYyMn0.EsRMK92iKgLVZhK2xy692JXKrMUZsuMEq6MG4UKbBk8';

const sb = (typeof window !== 'undefined' && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

async function authedFetch(path, opts = {}) {
  if (!sb) throw new Error('Supabase not loaded');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('NOT_AUTHENTICATED');
  return fetch(`${PROXY_URL}${path}`, {
    ...opts,
    headers: { ...(opts.headers || {}), 'Authorization': `Bearer ${session.access_token}` },
  });
}
const ok = v => v != null && !isNaN(v) && isFinite(v);

const fmt = {
  pct:  (v, d=1) => ok(v) ? `${(v*100).toFixed(d)}%` : '—',
  mult: (v, d=1) => ok(v) && v > 0 ? `${v.toFixed(d)}x` : (ok(v) ? `${v.toFixed(d)}x` : '—'),
  price:(v)      => ok(v) ? `$${v.toFixed(2)}` : '—',
  chg:  (v)      => ok(v) ? (v>=0?'+':'')+`${(v*100).toFixed(2)}%` : '—',
  usd:  v => {
    if (!ok(v)) return '—';
    const a=Math.abs(v), s=v<0?'-':'';
    return a>=1e12?`${s}$${(a/1e12).toFixed(2)}T`:a>=1e9?`${s}$${(a/1e9).toFixed(1)}B`:a>=1e6?`${s}$${(a/1e6).toFixed(1)}M`:`${s}$${a.toFixed(0)}`;
  },
  ndx: v => ok(v) ? (v<0?`${v.toFixed(1)}x (net cash)`:`${v.toFixed(1)}x`) : '—',
};

const SECTOR_BM = {
  'Technology':             {pe:28,ev:18,gm:0.55,roic:0.18},
  'Healthcare':             {pe:22,ev:14,gm:0.60,roic:0.12},
  'Consumer Discretionary': {pe:20,ev:12,gm:0.35,roic:0.14},
  'Consumer Staples':       {pe:18,ev:12,gm:0.38,roic:0.16},
  'Energy':                 {pe:12,ev:7, gm:0.30,roic:0.10},
  'Financials':             {pe:12,ev:null,gm:null,roic:0.10},
  'Financial Services':     {pe:12,ev:null,gm:null,roic:0.10},
  'Industrials':            {pe:18,ev:12,gm:0.30,roic:0.12},
  'Utilities':              {pe:15,ev:10,gm:0.45,roic:0.07},
};

// ─── REVERSE DCF feature flag ───────────────────────────────
// The master switch lives in SL_FLAGS.REVERSE_DCF_ENABLED (declared with the
// other StockLens flags). Off by default → no UI / no scoring / no fetch change.

// RDCF-CORE-START  (do not remove markers — scripts/rdcf-golden.js extracts this block)
// ============================================================
// REVERSE DCF — headless core (F1). 100% additive, gated by FLAGS.
// Math (buildModel + bisect) ported VERBATIM from reverse_dcf_v2.html — that
// artifact is the source of truth for the calculation. No UI here, no scoring
// impact. The public entry `reverseDcf(ticker, inputs, macro)` ALWAYS returns
// a plain object and NEVER throws: on any problem it returns
// { applicable:false, reason }. Units mirror the prototype: money in B$,
// shares in M (F2 converts raw FMP values into these units).
// ============================================================
const RDCF = (() => {
  const BASE_YEAR = 2026;
  const num = v => (v != null && !isNaN(v) && isFinite(v)) ? Number(v) : null;

  // ── math · ported VERBATIM from reverse_dcf_v2.html (buildModel) ──
  function buildModel(p){
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
    const impliedExit = last.fcf>0 ? tv/last.fcf : null;
    const equity = ev - p.netDebt;
    const dilShares = (p.shares>0) ? p.shares*Math.pow(1+(p.dilution||0), p.horizon) : 0;
    const perShare = dilShares>0 ? (equity*1000)/dilShares : null;
    return {rows,pvFCF:pvSum,tv,pvTV,ev,last,revCagr,impliedExit,equity,perShare,dilShares};
  }
  // ── solver · ported VERBATIM from reverse_dcf_v2.html (bisect) ──
  function bisect(fn, lo, hi, target, iters=90, tol=1e-4){
    let flo=fn(lo)-target, fhi=fn(hi)-target;
    if(!isFinite(flo)||!isFinite(fhi)||flo*fhi>0) return null;
    let a=lo,b=hi;
    for(let i=0;i<iters;i++){
      const m=(a+b)/2, fm=fn(m)-target;
      if(Math.abs(fm)/target<tol) return m;
      if(flo*fm<=0){b=m;} else {a=m; flo=fm;}
    }
    return (a+b)/2;
  }

  // ── reality bands (illustrative) · VERBATIM from prototype ──
  const REALITY_BANDS=[
    {to:.08, color:'#5ac576', label:'Común',    desc:'Muchas grandes empresas sostienen <8 % a 20 años.'},
    {to:.15, color:'#6ea8ff', label:'Raro',      desc:'8–15 % a 20 años: pocas lo logran.'},
    {to:.22, color:'#eca851', label:'Muy raro',  desc:'15–22 % a 20 años: un puñado en cada generación.'},
    {to:.40, color:'#eb6459', label:'Casi nadie',desc:'>22 % sostenido 20 años: prácticamente sin precedentes a esta escala.'},
  ];
  function realityBand(c){ return REALITY_BANDS.find(b=>c<=b.to) || REALITY_BANDS[REALITY_BANDS.length-1]; }

  // ── modeling defaults (mirror the prototype "base" preset) ──
  const CONFIG = {
    rfDefault: 0.043,   // fallback risk-free when macro_state.dgs10 is absent (low confidence)
    erp: 0.05,          // equity risk premium
    erpStressAddon: 0.01, // bump ERP under credit stress (spec §3 regime modulation)
    horizon: 40, fadeYears: 30, marginRamp: 15,
    gT: 0.025, gSeed: 0.35, mT: 0.30, dilution: 0.015,
    exitMultDefault: 18,
  };

  // ── WACC from regime · rf from macro_state.dgs10 (read-only), config fallback ──
  // macro_state.dgs10 is provided by a separate (research) batch via ic-proxy;
  // this module NEVER writes it. While absent → CONFIG.rfDefault + low confidence.
  function waccFromMacro(beta, macro){
    let rf = CONFIG.rfDefault, lowConfidence = true, rfSource = 'default';
    const dgs10 = macro ? num(macro.dgs10) : null;
    if (dgs10 != null) {
      rf = dgs10 > 1 ? dgs10/100 : dgs10;   // accept percent (4.3) or decimal (0.043)
      lowConfidence = false; rfSource = 'macro_state.dgs10';
    }
    const b = (num(beta) != null && beta > 0) ? Number(beta) : 1;
    let erp = CONFIG.erp;
    if (macro && num(macro.credit_stress) != null && macro.credit_stress > 70) erp += CONFIG.erpStressAddon;
    return { wacc: rf + b * erp, rf, erp, beta: b, lowConfidence, rfSource };
  }

  // ── exclusions (spec §6): financials / banks / insurers don't fit DCF-FCF ──
  const EXCLUDED_SECTORS = new Set(['Financials','Financial Services','Banks','Insurance']);

  // ── public entry · always returns an object, never throws ──
  function reverseDcf(ticker, inputs, macro){
    try {
      inputs = inputs || {};
      const sector = inputs.sector || null;
      if (sector && EXCLUDED_SECTORS.has(sector))
        return { applicable:false, reason:'sector_excluded', sector };

      const marketCap = num(inputs.marketCap);
      const baseRevenue = num(inputs.baseRevenue);
      const shares = num(inputs.shares);
      const m0 = num(inputs.m0);
      if (marketCap == null || marketCap <= 0 || baseRevenue == null || baseRevenue <= 0 || shares == null || shares <= 0)
        return { applicable:false, reason:'missing_data', lowConfidence:true };
      if (m0 == null || m0 <= 0)
        return { applicable:false, reason:'negative_fcf', m0, lowConfidence:true }; // pre-profit / negative FCF

      const netDebt = num(inputs.netDebt) != null ? num(inputs.netDebt) : 0;
      const capexPct = num(inputs.capexPct) != null ? num(inputs.capexPct) : 0;

      // WACC: explicit override (testing/golden) wins; else derive from macro.
      const w = (num(inputs.wacc) != null)
        ? { wacc:num(inputs.wacc), rf:null, erp:null, beta:num(inputs.beta), lowConfidence:false, rfSource:'override' }
        : waccFromMacro(inputs.beta, macro);

      const base = {
        baseRevenue, horizon: num(inputs.horizon) != null ? num(inputs.horizon) : CONFIG.horizon,
        g1: num(inputs.g1) != null ? num(inputs.g1) : CONFIG.gSeed,   // seed; replaced by solver
        gT: num(inputs.gT) != null ? num(inputs.gT) : CONFIG.gT,
        fadeYears: num(inputs.fadeYears) != null ? num(inputs.fadeYears) : CONFIG.fadeYears,
        m0, mT: num(inputs.mT) != null ? num(inputs.mT) : CONFIG.mT,
        marginRamp: num(inputs.marginRamp) != null ? num(inputs.marginRamp) : CONFIG.marginRamp,
        wacc: w.wacc, capexPct,
        dilution: num(inputs.dilution) != null ? num(inputs.dilution) : CONFIG.dilution,
        exitMult: num(inputs.exitMult) != null ? num(inputs.exitMult) : CONFIG.exitMultDefault,
        tvMode: inputs.tvMode || 'gordon',
        netDebt, shares,
      };

      const targetEV = marketCap + netDebt;
      const impliedG1 = bisect(x => buildModel({...base, g1:x}).ev, -0.10, 1.50, targetEV);
      if (impliedG1 == null) {
        console.warn('[RDCF] bisect no convergence — targetEV:', targetEV, 'wacc:', w.wacc);
        return { applicable:false, reason:'no_convergence', targetEV, wacc:w.wacc, lowConfidence:true };
      }

      const model = buildModel({...base, g1:impliedG1});
      const revCagr = model.revCagr;
      const tvShare = model.ev > 0 ? model.pvTV/model.ev : null;
      const band = realityBand(Math.max(0, revCagr));
      const analystGrowth = num(inputs.analystGrowth);
      const impliedGrowthPremium = analystGrowth != null ? (revCagr - analystGrowth) : null;
      const exitFlag = (base.tvMode === 'gordon' && model.impliedExit != null && model.impliedExit > 35);

      return {
        applicable:true,
        ticker: ticker || null,
        impliedG1, revCagr,
        realityBand: band.label, realityDesc: band.desc, realityColor: band.color,
        tvShare, tvFlag: (tvShare != null && tvShare > 0.7),
        impliedExitMultiple: model.impliedExit, exitFlag,
        impliedGrowthPremium, analystGrowth,
        perShare: model.perShare,
        ev: model.ev, targetEV,
        wacc: w.wacc, rf: w.rf, erp: w.erp, beta: w.beta, rfSource: w.rfSource,
        lowConfidence: !!w.lowConfidence,
      };
    } catch(e){
      return { applicable:false, reason:'error', detail:(e && e.message) || String(e) };
    }
  }

  // ── input mapping (F2) · maps already-fetched FMP data → model units ──
  // Pure, no fetches. Money → B$, shares → M (the units the prototype uses).
  // Everything is best-effort; missing pieces just yield null and reverseDcf
  // degrades gracefully. `stmts`/`cfStmts` are newest-first quarterly arrays.
  function buildInputs(met, prof, quote, stmts, balanceSheets, cfStmts, analystEst){
    const B = 1e9, M = 1e6;
    stmts = Array.isArray(stmts) ? stmts : [];
    cfStmts = Array.isArray(cfStmts) ? cfStmts : [];
    balanceSheets = Array.isArray(balanceSheets) ? balanceSheets : [];

    // Revenue TTM (sum of last 4 quarters; fallback q0×4) — raw $
    let revTTM = null;
    if (stmts.length >= 4) {
      const s4 = stmts.slice(0,4).map(q => num(q && q.revenue)).filter(v => v != null);
      if (s4.length === 4) revTTM = s4.reduce((a,b) => a+b, 0);
    }
    if (revTTM == null && num(stmts[0] && stmts[0].revenue) != null) revTTM = num(stmts[0].revenue) * 4;
    const baseRevenue = revTTM != null ? revTTM / B : null;

    // FCF margin TTM (decimal): prefer the metric StockLens already holds
    let m0 = num(met && met.freeCashFlowMarginTTM);
    if (m0 == null && cfStmts.length >= 4 && revTTM) {
      const fcf4 = cfStmts.slice(0,4).map(q => num(q && q.freeCashFlow)).filter(v => v != null);
      if (fcf4.length === 4) m0 = fcf4.reduce((a,b) => a+b, 0) / revTTM;
    }

    // Capex % of sales (decimal) from cash-flow TTM (capex is negative in FMP)
    let capexPct = 0;
    if (cfStmts.length >= 4 && revTTM) {
      const cx4 = cfStmts.slice(0,4).map(q => num(q && q.capitalExpenditure)).filter(v => v != null);
      if (cx4.length === 4) capexPct = Math.abs(cx4.reduce((a,b) => a+b, 0)) / revTTM;
    }

    // Net debt (B$)
    const bs0 = balanceSheets[0] || null;
    let netDebtRaw = bs0 ? num(bs0.netDebt) : null;
    if (netDebtRaw == null && bs0) {
      const cash = num(bs0.cashAndCashEquivalents) != null ? num(bs0.cashAndCashEquivalents) : (num(bs0.cashAndShortTermInvestments) || 0);
      netDebtRaw = (num(bs0.totalDebt) || 0) - cash;
    }
    const netDebt = netDebtRaw != null ? netDebtRaw / B : 0;

    // Shares (M) and market cap (B$)
    const sharesRaw = num(quote && quote.sharesOutstanding) != null ? num(quote.sharesOutstanding) : num(prof && prof.sharesOutstanding);
    const shares = sharesRaw != null ? sharesRaw / M : null;
    const mcRaw = num(quote && quote.marketCap) != null ? num(quote.marketCap) : num(prof && prof.mktCap);
    const marketCap = mcRaw != null ? mcRaw / B : null;

    const beta = num(quote && quote.beta) != null ? num(quote.beta) : num(prof && prof.beta);
    const sector = (prof && prof.sector) || null;

    // Analyst growth (decimal) for the gap — estimated revenue CAGR, best-effort
    let analystGrowth = null;
    const ae = Array.isArray(analystEst) ? analystEst : (analystEst ? [analystEst] : []);
    if (ae.length >= 2) {
      const sorted = ae.slice().sort((a,b) => String(a && a.date).localeCompare(String(b && b.date)));
      const first = sorted[0], lastE = sorted[sorted.length-1];
      const r0 = num((first && (first.estimatedRevenueAvg != null ? first.estimatedRevenueAvg : first.revenueAvg)));
      const rN = num((lastE && (lastE.estimatedRevenueAvg != null ? lastE.estimatedRevenueAvg : lastE.revenueAvg)));
      const yrs = sorted.length - 1;
      if (r0 != null && rN != null && r0 > 0 && yrs > 0) analystGrowth = Math.pow(rN / r0, 1 / yrs) - 1;
    }

    return { marketCap, netDebt, baseRevenue, shares, m0, capexPct, beta, sector, analystGrowth };
  }

  // ── valuation adjustment (F4) · signed point delta for the IC Score ──
  // Converts the reverse-DCF signals (growth premium vs analysts + terminal-value
  // share) into a SIGNED adjustment to micro_total, BEFORE any weight.
  //   <0 penalty: price demands more growth than analysts / speculative terminal.
  //   >0 bonus:   price demands LESS than the company realistically achieves.
  // Pure & bounded (≈[-10,+6]). Returns 0 when not applicable or no analyst gap.
  // NOTE: this is the pre-weight delta; the caller scales it by RDCF_VALUATION_WEIGHT
  // (default 0 → no effect) and only applies it when the feature flag is on.
  function valuationAdj(rdcf){
    if (!rdcf || rdcf.applicable !== true) return 0;
    let adj = 0;
    const prem = num(rdcf.impliedGrowthPremium);
    if (prem != null) {
      const x = Math.max(-1, Math.min(1, prem / 0.06));  // ±6pp premium → full ±6 pts
      adj -= x * 6;
    }
    const tv = num(rdcf.tvShare);
    if (tv != null && tv > 0.70) {
      adj -= Math.min((tv - 0.70) / 0.20, 1) * 4;          // speculative terminal → up to -4 pts
    }
    return adj;
  }

  return { buildModel, bisect, realityBand, REALITY_BANDS, waccFromMacro, reverseDcf, buildInputs, valuationAdj, CONFIG, EXCLUDED_SECTORS, BASE_YEAR };
})();
// RDCF-CORE-END

// ─── TECHNICAL ──────────────────────────────────────────────
function computeRSI(prices, period=14) {
  if (!prices || prices.length < period+1) return null;
  const ch = prices.slice(1).map((p,i)=>p-prices[i]);
  let ag=0, al=0;
  ch.slice(0,period).forEach(c=>{if(c>0) ag+=c; else al+=Math.abs(c);});
  ag/=period; al/=period;
  for (let i=period;i<ch.length;i++) {
    const c=ch[i];
    ag=(ag*(period-1)+Math.max(0,c))/period;
    al=(al*(period-1)+Math.max(0,-c))/period;
  }
  return al===0 ? 100 : 100-(100/(1+ag/al));
}
function computeSMA(prices, period) {
  if (!prices||prices.length<period) return null;
  return prices.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function computeMACD(prices, fast=12, slow=26, signal=9) {
  if (!prices || prices.length < slow + signal) return null;
  const ema = (arr, period) => {
    const k = 2 / (period + 1);
    let val = arr.slice(0, period).reduce((a,b)=>a+b,0) / period;
    const result = [val];
    for (let i = period; i < arr.length; i++) {
      val = arr[i] * k + val * (1 - k);
      result.push(val);
    }
    return result;
  };
  const fastEMA  = ema(prices, fast);
  const slowEMA  = ema(prices, slow);
  const offset   = slow - fast;
  const macdLine = fastEMA.slice(offset).map((v, i) => v - slowEMA[i]);
  const signalLine = ema(macdLine, signal);
  const histOffset = signal - 1;
  const histogram  = macdLine.slice(histOffset).map((v, i) => v - signalLine[i]);
  const last  = macdLine[macdLine.length - 1];
  const sig   = signalLine[signalLine.length - 1];
  const hist  = histogram[histogram.length - 1];
  const prevH = histogram[histogram.length - 2] ?? 0;
  const crossover =
    hist > 0 && prevH <= 0 ? 'bullish_cross' :
    hist < 0 && prevH >= 0 ? 'bearish_cross' :
    hist > 0 ? 'bullish' : hist < 0 ? 'bearish' : 'neutral';
  return { macd: last, signal: sig, histogram: hist, crossover };
}
function computeRelativeStrength(stockHistory, spyHistory, days=126) {
  if (!stockHistory || !spyHistory || stockHistory.length < days || spyHistory.length < days) return null;
  const stockPrices = [...stockHistory].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(d=>d.close).filter(Boolean);
  const spyPrices   = [...spyHistory].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(d=>d.close).filter(Boolean);
  if (stockPrices.length < days || spyPrices.length < days) return null;
  const stockRet = (stockPrices[stockPrices.length-1] - stockPrices[stockPrices.length-days]) / stockPrices[stockPrices.length-days];
  const spyRet   = (spyPrices[spyPrices.length-1]   - spyPrices[spyPrices.length-days])   / spyPrices[spyPrices.length-days];
  const alpha = stockRet - spyRet;
  return { stockRet, spyRet, alpha, outperforming: alpha > 0 };
}

// ─── QUALITY MOAT SCORECARD (Pedro Escudero Framework) ──────
function computeMoatScore(metrics, ratios, stmts, profile) {
  const ok = v => v != null && !isNaN(v) && isFinite(v);
  // 1. DEMAND INELASTICITY (0-25)
  let demand = 12;
  const gm   = metrics?.grossProfitMarginTTM ?? ratios?.grossProfitMarginTTM;
  const opM  = metrics?.operatingProfitMarginTTM ?? ratios?.operatingProfitMarginTTM;
  if (ok(gm))  demand += gm  > 0.70 ? 8 : gm  > 0.50 ? 5 : gm  > 0.35 ? 2 : gm  > 0.20 ? 0 : -4;
  if (ok(opM)) demand += opM > 0.30 ? 4 : opM > 0.20 ? 2 : opM > 0.10 ? 0 : -3;
  if (stmts && stmts.length >= 3) {
    const revs = stmts.slice(0,4).map(s => s.revenue).filter(Boolean);
    if (revs.length >= 2) {
      const growths = revs.slice(0,-1).map((r,i) => (r - revs[i+1]) / Math.abs(revs[i+1]));
      const allPos  = growths.every(g => g > 0);
      demand += allPos ? 3 : growths.filter(g=>g>0).length >= 2 ? 1 : -2;
    }
  }
  demand = Math.max(0, Math.min(25, Math.round(demand)));
  // 2. SUPPLY BARRIERS (0-25)
  let supply = 12;
  const roic = metrics?.returnOnInvestedCapitalTTM ?? metrics?.roicTTM;
  const roe  = metrics?.returnOnEquityTTM ?? metrics?.roeTTM;
  const assetT = metrics?.assetTurnoverTTM;
  if (ok(roic))  supply += roic > 0.30 ? 8 : roic > 0.20 ? 5 : roic > 0.12 ? 2 : roic > 0.07 ? 0 : -4;
  if (ok(roe))   supply += roe  > 0.30 ? 3 : roe  > 0.15 ? 1 : roe  < 0.05 ? -2 : 0;
  if (ok(assetT)) supply += assetT > 1.5 ? 2 : assetT > 0.8 ? 1 : assetT < 0.3 ? -2 : 0;
  supply = Math.max(0, Math.min(25, Math.round(supply)));
  // 3. PRICING POWER (0-25)
  let pricing = 12;
  const fcfM = metrics?.freeCashFlowMarginTTM;
  const netM  = metrics?.netProfitMarginTTM ?? ratios?.netProfitMarginTTM;
  if (ok(fcfM)) pricing += fcfM > 0.25 ? 8 : fcfM > 0.15 ? 5 : fcfM > 0.08 ? 2 : fcfM > 0 ? 0 : -5;
  if (ok(netM)) pricing += netM > 0.20 ? 4 : netM > 0.10 ? 2 : netM > 0.05 ? 0 : -3;
  if (stmts && stmts.length >= 5) {
    const gms = stmts.slice(0,5).map(s =>
      s.grossProfit && s.revenue ? s.grossProfit / s.revenue : null
    ).filter(Boolean);
    if (gms.length >= 2) {
      const improving = gms[0] > gms[gms.length-1];
      pricing += improving ? 3 : gms[0] < gms[gms.length-1] * 0.95 ? -2 : 0;
    }
  }
  pricing = Math.max(0, Math.min(25, Math.round(pricing)));
  // 4. CAPITAL EFFICIENCY (0-25)
  let capEff = 12;
  const capexM  = metrics?.capitalExpenditureCoverageRatioTTM;
  const debtEb  = metrics?.netDebtToEBITDATTM ?? metrics?.debtToEbitdaTTM;
  const currRat = metrics?.currentRatioTTM;
  if (ok(capexM))  capEff += capexM > 10 ? 6 : capexM > 5 ? 3 : capexM > 2 ? 1 : -2;
  if (ok(debtEb))  capEff += debtEb < 0 ? 5 : debtEb < 1 ? 3 : debtEb < 2 ? 1 : debtEb < 3 ? 0 : debtEb > 5 ? -4 : -2;
  if (ok(currRat)) capEff += currRat > 2 ? 2 : currRat > 1.5 ? 1 : currRat < 1 ? -3 : 0;
  capEff = Math.max(0, Math.min(25, Math.round(capEff)));
  const total = demand + supply + pricing + capEff;
  const moatRating =
    total >= 85 ? 'Ultra-Wide Moat' :
    total >= 70 ? 'Wide Moat' :
    total >= 55 ? 'Moderate Moat' :
    total >= 40 ? 'Narrow Moat' : 'No Moat';
  const moatColor =
    total >= 85 ? '#5ac576' : total >= 70 ? '#968ff7' :
    total >= 55 ? '#968ff7' : total >= 40 ? '#eca851' : '#787a83';
  return { demand, supply, pricing, capEff, total, moatRating, moatColor };
}

// ─── OVERVALUATION BUBBLE ALERT ─────────────────────────────
function detectOvervaluation(metrics, ratios, profile, sectorBM) {
  const ok = v => v != null && !isNaN(v) && isFinite(v);
  const sector = profile?.sector ?? '';
  const bm     = sectorBM?.[sector] ?? { pe: 20, ev: 14 };
  const pe   = metrics?.peRatioTTM ?? metrics?.priceToEarningsRatioTTM;
  const evEb = metrics?.evToEBITDATTM ?? metrics?.enterpriseValueOverEBITDATTM;
  const epsG = metrics?.epsgrowthTTM ?? ratios?.epsgrowthTTM;
  const peg  = ok(pe) && ok(epsG) && epsG > 0 ? pe / (epsG * 100) : null;
  const reasons = [];
  let score = 0;
  if (ok(pe) && ok(bm.pe)) {
    const ratio = pe / bm.pe;
    if      (ratio > 3)   { reasons.push(`P/E ${pe.toFixed(1)}× is 3×+ sector benchmark (${bm.pe}×)`); score += 3; }
    else if (ratio > 2)   { reasons.push(`P/E ${pe.toFixed(1)}× is 2×+ sector benchmark (${bm.pe}×)`); score += 2; }
    else if (ratio > 1.5) { reasons.push(`P/E ${pe.toFixed(1)}× exceeds 1.5× sector benchmark (${bm.pe}×)`); score += 1; }
  }
  if (ok(evEb) && ok(bm.ev)) {
    const ratio = evEb / bm.ev;
    if      (ratio > 3)   { reasons.push(`EV/EBITDA ${evEb.toFixed(1)}× is 3×+ sector benchmark (${bm.ev}×)`); score += 3; }
    else if (ratio > 2)   { reasons.push(`EV/EBITDA ${evEb.toFixed(1)}× is 2×+ sector benchmark (${bm.ev}×)`); score += 2; }
    else if (ratio > 1.5) { reasons.push(`EV/EBITDA ${evEb.toFixed(1)}× exceeds 1.5× sector benchmark (${bm.ev}×)`); score += 1; }
  }
  if (ok(peg)) {
    if      (peg > 4) { reasons.push(`PEG ratio ${peg.toFixed(2)} is extreme (>4) — pricing in unrealistic growth`); score += 3; }
    else if (peg > 3) { reasons.push(`PEG ratio ${peg.toFixed(2)} is very elevated (>3)`); score += 2; }
    else if (peg > 2) { reasons.push(`PEG ratio ${peg.toFixed(2)} signals potential overvaluation`); score += 1; }
  }
  let level = 'none';
  if      (score >= 7) level = 'bubble';
  else if (score >= 3) level = 'risk';
  else if (score >= 1) level = 'caution';
  return { level, reasons, peg, pe, evEb };
}

// ─── FACTOR TILT ENGINE ─────────────────────────────────────
function computeFactorTilts(metrics, ratios, history, stmts, profile) {
  const ok = v => v != null && !isNaN(v) && isFinite(v);
  // --- VALUE (0-20) ---
  let value = 10;
  const pe   = metrics?.peRatioTTM ?? metrics?.priceToEarningsRatioTTM;
  const evEb = metrics?.evToEBITDATTM ?? metrics?.enterpriseValueOverEBITDATTM;
  const pb   = metrics?.priceToBookRatioTTM;
  const pfcf = metrics?.priceToFreeCashFlowRatioTTM;
  if (ok(pe))   value += pe < 15 ? 4 : pe < 22 ? 2 : pe < 30 ? 0 : -3;
  if (ok(evEb)) value += evEb < 8 ? 3 : evEb < 14 ? 1 : evEb < 20 ? 0 : -2;
  if (ok(pb))   value += pb < 2 ? 2 : pb < 4 ? 1 : pb > 8 ? -1 : 0;
  if (ok(pfcf)) value += pfcf < 15 ? 3 : pfcf < 25 ? 1 : pfcf > 40 ? -2 : 0;
  value = Math.max(0, Math.min(20, Math.round(value)));
  // --- GROWTH (0-20) ---
  let growth = 10;
  const revG = metrics?.revenueGrowthTTM ?? ratios?.revenueGrowthTTM;
  const epsG = metrics?.epsgrowthTTM ?? ratios?.epsgrowthTTM;
  const fwdPe = metrics?.forwardPERatioTTM;
  if (ok(revG))  growth += revG > 0.20 ? 4 : revG > 0.10 ? 2 : revG > 0.05 ? 1 : revG < 0 ? -3 : 0;
  if (ok(epsG))  growth += epsG > 0.20 ? 4 : epsG > 0.10 ? 2 : epsG > 0.05 ? 1 : epsG < 0 ? -3 : 0;
  if (ok(fwdPe) && ok(pe)) growth += fwdPe < pe * 0.85 ? 3 : fwdPe < pe ? 1 : -1;
  growth = Math.max(0, Math.min(20, Math.round(growth)));
  // --- MOMENTUM (0-20) ---
  let momentum = 10;
  if (history && history.length > 5) {
    const prices = [...history].sort((a,b)=>new Date(a.date)-new Date(b.date)).map(d => d.close).filter(Boolean);
    const cur    = prices[prices.length - 1];
    const sma50  = prices.length >= 50  ? prices.slice(-50).reduce((a,b)=>a+b,0)/50  : null;
    const sma200 = prices.length >= 200 ? prices.slice(-200).reduce((a,b)=>a+b,0)/200 : null;
    const ret12m = prices.length >= 252 ? (cur - prices[prices.length-252]) / prices[prices.length-252] : null;
    const rsi    = computeRSI(prices);
    if (ok(sma50))  momentum += cur > sma50  ? 3 : cur < sma50 * 0.95 ? -2 : 0;
    if (ok(sma200)) momentum += cur > sma200 ? 3 : cur < sma200 * 0.95 ? -2 : 0;
    if (ok(ret12m)) momentum += ret12m > 0.30 ? 3 : ret12m > 0.10 ? 2 : ret12m > 0 ? 1 : ret12m < -0.20 ? -3 : -1;
    if (ok(rsi))    momentum += rsi > 70 ? -1 : rsi > 50 ? 1 : rsi < 30 ? -2 : 0;
  }
  momentum = Math.max(0, Math.min(20, Math.round(momentum)));
  // --- QUALITY (0-20) ---
  let quality = 10;
  const roic = metrics?.returnOnInvestedCapitalTTM ?? metrics?.roicTTM;
  const roe  = metrics?.returnOnEquityTTM ?? metrics?.roeTTM;
  const gm   = metrics?.grossProfitMarginTTM ?? ratios?.grossProfitMarginTTM;
  const cov  = metrics?.interestCoverageRatioTTM ?? metrics?.interestCoverageTTM;
  const fcfM = metrics?.freeCashFlowMarginTTM;
  if (ok(roic)) quality += roic > 0.20 ? 4 : roic > 0.12 ? 2 : roic > 0.07 ? 0 : -2;
  if (ok(roe))  quality += roe  > 0.20 ? 2 : roe  > 0.12 ? 1 : roe  < 0.05 ? -2 : 0;
  if (ok(gm))   quality += gm   > 0.50 ? 3 : gm   > 0.30 ? 1 : gm   < 0.15 ? -2 : 0;
  if (ok(cov))  quality += cov  > 10   ? 2 : cov  > 5    ? 1 : cov  < 3    ? -2 : 0;
  if (ok(fcfM)) quality += fcfM > 0.15 ? 2 : fcfM > 0.08 ? 1 : fcfM < 0   ? -3 : 0;
  quality = Math.max(0, Math.min(20, Math.round(quality)));
  // --- SIZE (0-20) ---
  let size = 10;
  const mktCap = profile?.mktCap ?? metrics?.marketCapTTM;
  if (ok(mktCap)) {
    if      (mktCap < 2e9)   size = 18;
    else if (mktCap < 10e9)  size = 15;
    else if (mktCap < 50e9)  size = 12;
    else if (mktCap < 200e9) size = 9;
    else                      size = 6;
  }
  const scores = { value, growth, momentum, quality, size };
  const dominant = Object.entries(scores).sort((a,b)=>b[1]-a[1])[0][0];
  const labels = {
    value: 'Value Tilt', growth: 'Growth Tilt', momentum: 'Momentum Tilt',
    quality: 'Quality Compounder', size: 'Small-Cap Alpha'
  };
  return { value, growth, momentum, quality, size, dominant, tilt_label: labels[dominant] };
}

// ─── SCORING ────────────────────────────────────────────────
function calcScores(metrics, ratios, history, stmts) {
  let val=0, hlth=0, mom=0, growth=0;
  if (metrics && ratios) {
    const pe   = metrics.peRatioTTM ?? metrics.priceToEarningsRatioTTM;
    const ev   = metrics.evToEBITDATTM ?? metrics.enterpriseValueOverEBITDATTM;
    const pfcf = metrics.pfcfRatioTTM ?? metrics.priceToFreeCashFlowRatioTTM;
    const fvr  = ratios.priceToFairValueTTM ?? ratios.priceFairValueTTM;
    const gm   = ratios.grossProfitMarginTTM;
    const roic = metrics.returnOnInvestedCapitalTTM ?? metrics.roicTTM;
    const nd   = metrics.netDebtToEBITDATTM;
    const roe  = metrics.returnOnEquityTTM ?? metrics.roeTTM;
    const ic   = metrics.interestCoverageTTM ?? metrics.interestCoverageRatioTTM;
    if(ok(pe)&&pe>0)    val+=pe<12?9:pe<18?8:pe<25?6:pe<35?4:pe<50?2:1;
    if(ok(ev)&&ev>0)    val+=ev<8?7:ev<12?5:ev<18?3:ev<25?2:ev<35?1:0;
    if(ok(pfcf)&&pfcf>0) val+=pfcf<12?6:pfcf<20?5:pfcf<28?3:pfcf<40?1:0;
    if(ok(fvr))          val+=fvr<0.85?3:fvr<1?2:fvr<1.15?1:0;
    val=Math.min(25,val);
    if(ok(gm))   hlth+=gm>=0.65?7:gm>=0.45?6:gm>=0.30?4:gm>=0.15?2:gm>=0.05?1:0;
    if(ok(roic)) hlth+=roic>=0.25?8:roic>=0.18?7:roic>=0.12?5:roic>=0.06?3:roic>=0?1:0;
    if(ok(nd))   hlth+=nd<-1?7:nd<0?6:nd<0.5?5:nd<1.5?3:nd<2.5?1:0;
    if(ok(roe))  hlth+=roe>=0.35?5:roe>=0.20?4:roe>=0.12?2:roe>=0.05?1:0;
    if(ok(ic))   hlth+=ic>=20?3:ic>=10?2:ic>=5?1:0;
    hlth=Math.min(30,hlth);
  }
  if (history && history.length>10) {
    const s=[...history].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const cur=s[s.length-1]?.close;
    const p3=s[Math.max(0,s.length-63)]?.close;
    const p6=s[Math.max(0,s.length-126)]?.close;
    const p12=s[0]?.close;
    const r=(n,t)=>(ok(n)&&ok(t)&&t>0)?(n-t)/t:null;
    const r12=r(cur,p12),r6=r(cur,p6),r3=r(cur,p3);
    if(ok(r12)) mom+=r12>0.40?10:r12>0.20?8:r12>0.08?6:r12>0?4:r12>-0.10?2:r12>-0.25?1:0;
    if(ok(r6))  mom+=r6>0.20?8:r6>0.10?6:r6>0.03?4:r6>-0.03?3:r6>-0.12?1:0;
    if(ok(r3))  mom+=r3>0.12?7:r3>0.06?5:r3>0.01?3:r3>-0.05?1:0;
    mom=Math.min(25,mom);
  }
  if (stmts && stmts.length>=5) {
    const q0=stmts[0];
    const yoyQ=stmts.find(s=>s.period===q0?.period&&parseInt(s.calendarYear)===parseInt(q0?.calendarYear)-1);
    const ry=(yoyQ?.revenue>0&&ok(q0?.revenue))?(q0.revenue-yoyQ.revenue)/yoyQ.revenue:null;
    const ey=(yoyQ?.eps&&yoyQ.eps!==0&&ok(q0?.eps))?(q0.eps-yoyQ.eps)/Math.abs(yoyQ.eps):null;
    if(ok(ry)) growth+=ry>0.30?6:ry>0.20?5:ry>0.10?4:ry>0?2:0;
    if(ok(ey)) growth+=ey>0.30?5:ey>0.20?4:ey>0.10?3:ey>0?1:0;
    if (stmts.length>=8) {
      const old=stmts[stmts.length-1];
      const yrs=stmts.length/4;
      if (old?.revenue>0&&q0?.revenue>0) {
        const cagr=Math.pow(q0.revenue/old.revenue,1/yrs)-1;
        growth+=cagr>0.20?5:cagr>0.10?4:cagr>0.05?2:cagr>0?1:0;
      }
    }
    if (stmts.length>=4) {
      const gms=stmts.slice(0,4).map(q=>q.revenue>0?q.grossProfit/q.revenue:null).filter(v=>ok(v));
      if (gms.length>=2) growth+=gms[0]>gms[gms.length-1]?4:Math.abs(gms[0]-gms[gms.length-1])<0.02?2:0;
    }
    growth=Math.min(20,growth);
  }
  return {val,hlth,mom,growth,total:val+hlth+mom+growth};
}

// ─── RATING THRESHOLDS — breakpoints canonicos del IC Score ──
// Single source of truth. También usados en ScoreGauge para el color del gauge.
const RT = { STRONG_BUY: 80, BUY: 65, HOLD: 50, CAUTION: 35 };

function getRating(s) {
  if(s>=RT.STRONG_BUY) return {label:'STRONG BUY',color:'#5ac576',bg:'#194224',border:'#194224'};
  if(s>=RT.BUY)        return {label:'BUY',       color:'#5ac576',bg:'#194224',border:'#194224'};
  if(s>=RT.HOLD)       return {label:'HOLD',      color:'#eca851',bg:'#54360b',border:'#54360b'};
  if(s>=RT.CAUTION)    return {label:'CAUTION',   color:'#eca851',bg:'#54360b',border:'#54360b'};
  return                      {label:'AVOID',      color:'#eb6459',bg:'#602a25',border:'#602a25'};
}

// ─── IC SCORE — métrica canónica unificada (macro × micro) ───
// IC Score = clamp(round(micro_total + macro_tilt), 0, 100)
//   micro_total = score 0-100 de StockLens (calcScores)
//   macro_tilt  = ajuste del régimen (computeMacroTilt, ∈[-15,15])
// Bandas (getRating): ≥80 STRONG BUY · ≥65 BUY · ≥50 HOLD · ≥35 CAUTION · <35 AVOID
// Mismo concepto y fórmula en IC DataLayer (panel "Tu Watchlist", columna "IC Score").
const icScore = (total, tilt) => Math.max(0, Math.min(100, Math.round((total||0) + (tilt||0))));

// ─── B1 — PESOS POR RÉGIMEN (gated) — MASTER_PROMPT_MEJORAS_RESEARCH F2 ───
// El régimen macro re-pondera las 4 dimensiones micro (no solo inclina el score
// final). FLAG OFF (default) → NO se usa: el IC Score es BYTE-idéntico al de hoy
// (los call-sites usan scores.total directamente cuando el flag está off).
// Los pesos _default = los caps actuales (val25/hlth30/mom25/growth20), así que
// regimeWeightedTotal con quadrant desconocido reproduce scores.total exacto.
const SL_FLAGS = { B1_REGIME_WEIGHTS: true, B2_RATE_SENSITIVITY: true, REVERSE_DCF_ENABLED: true };

// F4 — weight of the reverse-DCF valuation signal in the IC Score. ∈[0,1].
// DEFAULT 0 → the signal does NOT move any score, even with REVERSE_DCF_ENABLED on.
// Raising it is a deliberate, reviewed step (see scripts/rdcf-score-table.js for the
// before/after preview). Applied only when REVERSE_DCF_ENABLED is on AND this is > 0.
const RDCF_VALUATION_WEIGHT = 0.2;

// ─── B2 — RATE SENSITIVITY (gated) — MEJORAS_RESEARCH F3 ───
// Apalancamiento alto + baja cobertura de intereses → penaliza más SOLO en
// regímenes de tipos altos (estanflación/defensivo). Enlaza con B1. Devuelve 0
// fuera de esos regímenes; con el flag OFF nunca se invoca (IC Score idéntico).
function rateSensitivityPenalty(netDebtEbitda, interestCov, quadrant) {
  if (quadrant !== "estanflacion" && quadrant !== "defensivo") return 0;
  const nd = Number(netDebtEbitda), ic = Number(interestCov);
  let pen = 0;
  if (isFinite(nd) && nd > 3) pen += 4;
  if (isFinite(ic) && ic > 0 && ic < 3) pen += 4;
  else if (isFinite(ic) && ic >= 3 && ic < 5) pen += 2;
  return Math.min(8, pen);
}

// ─── B3 — Conciencia de eventos IPO/lockup — MEJORAS_RESEARCH F4 ───
// Lockups suelen expirar 90–180d post-IPO (shock de oferta); nombres recién
// públicos cargan riesgo de venta estructural. Solo es un tag informativo: NO
// cambia el score. Devuelve null si no aplica.
function ipoEventTag(profile) {
  const d = profile && profile.ipoDate;
  if (!d) return null;
  const t = new Date(d).getTime();
  if (!isFinite(t)) return null;
  const days = (Date.now() - t) / 86400000;
  if (days < 0 || days > 400) return null;
  if (days >= 90 && days <= 200) return { label: "Ventana de lockup", color: "#eb6459", note: "Lockup típico 90–180d post-IPO: posible shock de oferta (vender la noticia)." };
  if (days < 90) return { label: "Recién IPO", color: "#eca851", note: "Salió a bolsa hace <90d: histórico limitado, alta volatilidad." };
  return { label: "IPO <1 año", color: "#eca851", note: "IPO reciente: riesgo de rotación/lockup residual." };
}
const REGIME_WEIGHTS = {
  _default:     { val: 25, hlth: 30, mom: 25, growth: 20 }, // = caps actuales (hoy)
  crecimiento:  { val: 22, hlth: 25, mom: 28, growth: 25 }, // risk-on: + Growth/Momentum
  inflacion:    { val: 25, hlth: 28, mom: 25, growth: 22 }, // reflación: balanceado
  estanflacion: { val: 24, hlth: 38, mom: 20, growth: 18 }, // tipos altos: + Financial Health
  defensivo:    { val: 24, hlth: 40, mom: 20, growth: 16 }, // contracción/neutral: + Financial Health
};
// Re-escala cada sub-score (0..cap → 0..1) por su peso de régimen. La suma de
// pesos = 100 en todas las filas → resultado en 0..100. Con _default reproduce
// val+hlth+mom+growth = scores.total. Solo se invoca con el flag ON.
function regimeWeightedTotal(s, quadrant) {
  if (!s) return 0;
  const W = REGIME_WEIGHTS[quadrant] || REGIME_WEIGHTS._default;
  const t = (s.val / 25) * W.val + (s.hlth / 30) * W.hlth + (s.mom / 25) * W.mom + (s.growth / 20) * W.growth;
  return Math.round(t);
}

// ─── MACRO TILT THRESHOLDS ───────────────────────────────────
// Umbrales de los indicadores del macro_state que disparan ajustes en el tilt.
// Documentados aquí para facilitar calibración futura.
const MT = {
  CREDIT_STRESS_HIGH:   70,   // credit_stress > 70 → penaliza deuda alta
  CREDIT_DEBT_HIGH:      3,   // netDebt/EBITDA > 3x
  CREDIT_TILT:         -10,
  LIQUIDITY_LOW:        35,   // liquidity_cycle < 35 → penaliza P/E alto
  LIQUIDITY_PE_HIGH:    40,   // P/E > 40
  LIQUIDITY_TILT:        -5,
  RECESSION_HIGH:       60,   // recession_prob > 60 → penaliza sectores cíclicos
  RECESSION_TILT:        -8,
  GEO_HIGH:             65,   // geopolitical_risk > 65 → bonus sectores defensivos
  GEO_TILT:              5,
  MAX_TILT:             15,
};

async function computeMacroTilt(supabase, sector, netDebtEbitda, peRatio) {
  if (!supabase) return { tilt: 0, reasons: ["Sin Supabase"], quadrant: null, regime: null };
  let m = null;
  try {
    const { data } = await supabase.from("macro_state").select("*").eq("id", 1).maybeSingle();
    m = data;
  } catch (e) { console.warn('[StockLens] macro_state fetch failed:', e?.message); }
  if (!m) return { tilt: 0, reasons: ["Macro no disponible aún"], quadrant: null, regime: null };
  let tilt = 0; const reasons = [];
  const nd = Number(netDebtEbitda) || 0, pe = Number(peRatio) || 0;
  if (m.credit_stress > MT.CREDIT_STRESS_HIGH && nd > MT.CREDIT_DEBT_HIGH) { tilt += MT.CREDIT_TILT; reasons.push(`Credit stress ${Math.round(m.credit_stress)} + deuda ${nd.toFixed(1)}x`); }
  if (m.liquidity_cycle < MT.LIQUIDITY_LOW && pe > MT.LIQUIDITY_PE_HIGH) { tilt += MT.LIQUIDITY_TILT; reasons.push(`Liquidez baja ${Math.round(m.liquidity_cycle)} + P/E ${pe.toFixed(0)}`); }
  if (m.recession_prob > MT.RECESSION_HIGH && ["Energy","Industrials","Consumer Cyclical"].includes(sector)) { tilt += MT.RECESSION_TILT; reasons.push(`Recesión ${Math.round(m.recession_prob)} + ${sector} cíclico`); }
  if (m.geopolitical_risk > MT.GEO_HIGH && ["Utilities","Healthcare","Basic Materials","Consumer Defensive"].includes(sector)) { tilt += MT.GEO_TILT; reasons.push(`Geopolítica ${Math.round(m.geopolitical_risk)} + ${sector} defensivo`); }
  const bonus = { estanflacion:{Energy:5,"Basic Materials":5,Technology:-5}, inflacion:{Energy:5,"Real Estate":5}, defensivo:{Healthcare:5,Utilities:5,"Consumer Defensive":5}, crecimiento:{Technology:5} };
  const b = (bonus[m.cartera_quadrant] && bonus[m.cartera_quadrant][sector]) || 0;
  if (b) { tilt += b; reasons.push(`Cuadrante ${m.cartera_quadrant} → ${sector} ${b>0?"+":""}${b}`); }
  tilt = Math.max(-MT.MAX_TILT, Math.min(MT.MAX_TILT, tilt));
  return { tilt, reasons: reasons.length ? reasons : ["Sin ajustes para este perfil"], quadrant: m.cartera_quadrant, regime: m.regime_label, updatedAt: m.updated_at || null,
    // A8 contrarian sentiment (ya viene en la fila; 0 fetches extra)
    putCall: m.put_call_ratio ?? null, fearGreed: m.fear_greed ?? null, fgRating: m.fear_greed_rating ?? null, sentimentSignal: m.sentiment_signal ?? null };
}

// ─── FRESCURA MACRO — badge de salud del cron macro-refresh ──
// Calcula edad de macro_state.updated_at (dato ya cargado, 0 fetches nuevos).
// Umbrales: verde ≤48h · ámbar >48h · rojo >5 días.
function macroFreshness(updatedAt) {
  if (!updatedAt) return null;
  const ts = new Date(updatedAt).getTime();
  if (!isFinite(ts)) return null;
  const h = (Date.now() - ts) / 3.6e6;
  const d = h / 24;
  let age;
  if (h < 1) age = "hace <1h";
  else if (h < 48) age = `hace ${Math.round(h)}h`;
  else age = `hace ${Math.round(d)}d`;
  let color, warn = null;
  if (h <= 48) color = "#5ac576";
  else if (d <= 5) { color = "#eca851"; warn = "el cron macro-refresh puede estar fallando"; }
  else { color = "#eb6459"; warn = "el cron macro-refresh puede estar fallando"; }
  return { age, color, warn };
}

// ─── SKELETON ───────────────────────────────────────────────
function Sk({w='100%', h=16, s={}}) {
  return (
    <div style={{
      background:'linear-gradient(90deg,#15151c 25%,#1c1d26 50%,#15151c 75%)',
      backgroundSize:'200% 100%',animation:'shimmer 1.5s infinite',
      borderRadius:4,width:w,height:h,...s
    }}/>
  );
}
function LoadingSkeleton() {
  return (
    <div style={{paddingTop:20,display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:'#15151c',border:'1px solid #1c1d26',borderRadius:10,padding:'20px 24px'}}>
        <Sk h={11} w="25%" s={{marginBottom:8}}/>
        <Sk h={30} w="55%" s={{marginBottom:8}}/>
        <Sk h={10} w="70%" s={{marginBottom:6}}/>
        <Sk h={10} w="45%"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14}}>
        <div style={{background:'#15151c',border:'1px solid #1c1d26',borderRadius:10,padding:'20px 24px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <Sk w={136} h={136} s={{borderRadius:'50%'}}/>
          {[80,90,70].map((w,i)=><Sk key={i} w={w} h={8} s={{marginBottom:2}}/>)}
        </div>
        <div style={{background:'#15151c',border:'1px solid #1c1d26',borderRadius:10,padding:'20px 24px'}}>
          <Sk h={11} w="30%" s={{marginBottom:14}}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:9}}>
            {[...Array(9)].map((_,i)=>(
              <div key={i} style={{background:'#1c1d26',borderRadius:6,padding:'10px 14px'}}>
                <Sk h={9} w="55%" s={{marginBottom:7}}/>
                <Sk h={18} w="70%"/>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{background:'#15151c',border:'1px solid #1c1d26',borderRadius:10,padding:'20px 24px'}}>
        <Sk h={200}/>
      </div>
    </div>
  );
}

// ─── LAYOUT PRIMITIVES ──────────────────────────────────────
function Panel({children, style={}}) {
  return (
    <div style={{
      background:'#15151c',border:'1px solid #1c1d26',
      borderRadius:10,padding:'20px 24px',...style
    }}>{children}</div>
  );
}
function SectionTitle({children}) {
  return (
    <div style={{
      fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',
      color:'#33353f',marginBottom:14,paddingBottom:8,borderBottom:'1px solid #1c1d26'
    }}>{children}</div>
  );
}

// ─── KPI BADGE ──────────────────────────────────────────────
function KPIBadge({label, value, sub, highlight, sector, bmVal, bmLabel}) {
  const vsStr = useMemo(()=>{
    if (!ok(bmVal)||!ok(parseFloat(value))) return null;
    const v=parseFloat(value.replace('x','').replace('%',''));
    const diff=(v-bmVal)/Math.abs(bmVal);
    if (Math.abs(diff)<0.15) return null;
    return diff>0 ? {t:`↑ vs ${bmLabel||'sector'}`,c:'#5ac576'} : {t:`↓ vs ${bmLabel||'sector'}`,c:'#eb6459'};
  },[bmVal,value,bmLabel]);
  return (
    <div style={{
      background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,
      padding:'10px 14px',display:'flex',flexDirection:'column',gap:3
    }}>
      <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
      <div style={{fontSize:17,fontWeight:700,color:highlight||'#edeef4',fontFamily:'Geist Mono,monospace',lineHeight:1}}>{value}</div>
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        {sub&&<div style={{fontSize:10,color:'#33353f'}}>{sub}</div>}
        {vsStr&&<div style={{fontSize:9,color:vsStr.c,fontWeight:700}}>{vsStr.t}</div>}
      </div>
    </div>
  );
}

// ─── HEALTH CARD ────────────────────────────────────────────
function HealthCard({label, value, status, note}) {
  const C={
    green:  {bg:'#194224',border:'#194224',badge:'#5ac576',icon:'✓ BEAT'},
    amber:  {bg:'#54360b',border:'#54360b',badge:'#eca851',icon:'⚠ WATCH'},
    red:    {bg:'#602a25',border:'#602a25',badge:'#eb6459',icon:'✗ MISS'},
    neutral:{bg:'#1c1d26',border:'#24262f',badge:'#787a83',icon:'— N/A'},
  }[status||'neutral'];
  return (
    <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'12px 14px',display:'flex',flexDirection:'column',gap:4}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
        <div style={{fontSize:10,fontWeight:700,color:C.badge}}>{C.icon}</div>
      </div>
      <div style={{fontSize:19,fontWeight:800,color:C.badge,fontFamily:'Geist Mono,monospace',lineHeight:1.1}}>{value}</div>
      {note&&<div style={{fontSize:10,color:'#787a83'}}>{note}</div>}
    </div>
  );
}

// ─── SCORE GAUGE ────────────────────────────────────────────
function ScoreGauge({score}) {
  const r=getRating(score);
  const cir=2*Math.PI*52;
  const prog=(score/100)*cir;
  const col=score>=RT.BUY?'#5ac576':score>=RT.HOLD?'#eca851':'#eb6459';
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
      <div style={{position:'relative',width:136,height:136}}>
        <svg width="136" height="136" style={{transform:'rotate(-90deg)'}}>
          <defs>
            <linearGradient id="ggrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={col} stopOpacity="0.5"/>
              <stop offset="100%" stopColor={col}/>
            </linearGradient>
          </defs>
          <circle cx="68" cy="68" r="52" fill="none" stroke="#24262f" strokeWidth="10"/>
          <circle cx="68" cy="68" r="52" fill="none" stroke="url(#ggrad)" strokeWidth="10"
            strokeDasharray={`${prog} ${cir}`} strokeLinecap="round"
            style={{transition:'stroke-dasharray 1.2s ease-in-out'}}/>
        </svg>
        <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',display:'flex',flexDirection:'column',alignItems:'center'}}>
          <div style={{fontSize:34,fontWeight:800,color:col,fontFamily:'Geist Mono,monospace',lineHeight:1}}>{score}</div>
          <div style={{fontSize:9,color:'#787a83',letterSpacing:'1px'}}>/100</div>
        </div>
      </div>
      <div style={{padding:'4px 18px',borderRadius:20,background:r.bg,border:`1px solid ${r.border}`,fontSize:11,fontWeight:700,color:r.color,letterSpacing:'1.5px'}}>{r.label}</div>
    </div>
  );
}

function ScoreBar({label, value, max, color}) {
  const pct=Math.min(100,(value/max)*100);
  return (
    <div style={{marginBottom:9}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <div style={{fontSize:11,color:'#a6a7b1'}}>{label}</div>
        <div style={{fontSize:11,fontWeight:700,color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>{value}<span style={{color:'#33353f'}}>/{max}</span></div>
      </div>
      <div style={{background:'#24262f',borderRadius:4,height:5,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:4,transition:'width 1s ease'}}/>
      </div>
    </div>
  );
}

// ─── SPARKLINE ──────────────────────────────────────────────
function Sparkline({data, type='bar', color='#968ff7', h=48, w=120}) {
  const vals=data.map(v=>ok(v)?v:0);
  if (!vals.length) return <div style={{width:w,height:h,background:'#1c1d26',borderRadius:3}}/>;
  const mn=Math.min(...vals), mx=Math.max(...vals), rng=mx-mn||1;
  if (type==='bar') {
    const bw=w/vals.length;
    return (
      <svg width={w} height={h} style={{display:'block'}}>
        {vals.map((v,i)=>{
          const bh=((v-mn)/rng)*h;
          return <rect key={i} x={i*bw+0.5} y={h-bh} width={Math.max(1,bw-1)} height={bh} fill={v<0?'#eb6459':color} rx={1}/>;
        })}
      </svg>
    );
  }
  const pts=vals.map((v,i)=>{
    const x=(vals.length<2?0.5:i/(vals.length-1))*w;
    const y=h-((v-mn)/rng)*(h-4)-2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} style={{display:'block'}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

// ─── IC SCORE HISTORY SPARKLINE (lee sl_analyses, $0) ───────
function ScoreHistorySparkline({ data }) {
  const [hover, setHover] = useState(null);
  const n = data ? data.length : 0;
  if (n < 2) {
    return (
      <div style={{width:'100%',background:'#15151c',border:'1px solid #1c1d26',borderRadius:8,padding:'10px 12px'}}>
        <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',fontWeight:700,marginBottom:4}}>Histórico IC Score</div>
        <div style={{fontSize:9,color:'#33353f',lineHeight:1.4}}>El histórico se construye con cada análisis (aún {n} punto{n===1?'':'s'}).</div>
      </div>
    );
  }
  const w=168, h=44, pad=4;
  const vals=data.map(d=>d.ic);
  const mn=Math.min(...vals), mx=Math.max(...vals), rng=(mx-mn)||1;
  const xAt=i=>pad+(i/(n-1))*(w-2*pad);
  const yAt=v=>h-pad-((v-mn)/rng)*(h-2*pad);
  const pts=data.map((d,i)=>`${xAt(i)},${yAt(d.ic)}`).join(' ');
  const last=data[n-1], first=data[0], delta=last.ic-first.ic;
  return (
    <div style={{width:'100%',background:'#15151c',border:'1px solid #1c1d26',borderRadius:8,padding:'10px 12px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
        <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',fontWeight:700}}>Histórico IC Score</div>
        <div style={{fontSize:10,fontWeight:700,color:delta>=0?'#5ac576':'#eb6459',fontFamily:'Geist Mono,monospace'}}>{delta>=0?'+':''}{delta} · {n}p</div>
      </div>
      <svg width={w} height={h} style={{display:'block',maxWidth:'100%'}} onMouseLeave={()=>setHover(null)}>
        <polyline points={pts} fill="none" stroke="#968ff7" strokeWidth="1.5" strokeLinejoin="round"/>
        {data.map((d,i)=>(
          <circle key={i} cx={xAt(i)} cy={yAt(d.ic)} r={hover===i?3.5:2.2}
            fill={hover===i?'#968ff7':'#968ff7'} style={{cursor:'pointer'}}
            onMouseEnter={()=>setHover(i)}/>
        ))}
      </svg>
      <div style={{fontSize:9,color:'#787a83',fontFamily:'Geist Mono,monospace',marginTop:4,minHeight:12}}>
        {hover!=null ? `${data[hover].date} · IC ${data[hover].ic}` : `Último: ${last.date} · IC ${last.ic}`}
      </div>
    </div>
  );
}

// ─── PRICE CHART (enhanced) ─────────────────────────────────
const PERIODS = {'1M':21,'3M':63,'6M':126,'1Y':365,'5Y':1825};

const _fredCache = {};   // cache por sesion: series_id -> [{date,val}]

function PriceChart({history, ticker, period}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const [zoom, setZoom] = useState(null);   // {startIdx,endIdx} sobre `filtered`; null = periodo completo
  const [fredOn, setFredOn] = useState(false);
  const [fredObs, setFredObs] = useState(null);     // [{date,val}] Fed Funds
  const [fredStatus, setFredStatus] = useState('idle');  // idle|loading|error
  const svgRef = useRef(null);

  const sorted = useMemo(()=>[...history].sort((a,b)=>new Date(a.date)-new Date(b.date)),[history]);
  const filtered = useMemo(()=>{
    const n=PERIODS[period]||365;
    return sorted.slice(-n);
  },[sorted,period]);

  // cambiar de periodo o ticker resetea el zoom
  useEffect(()=>{ setZoom(null); setHoverIdx(null); },[period,ticker]);

  // ventana visible (slice del periodo segun zoom)
  const view = useMemo(()=>{
    if(!zoom) return filtered;
    const a=Math.max(0,Math.min(zoom.startIdx,zoom.endIdx));
    const b=Math.min(filtered.length-1,Math.max(zoom.startIdx,zoom.endIdx));
    return filtered.slice(a,b+1);
  },[filtered,zoom]);

  // zoom con rueda — listener nativo no-pasivo para poder preventDefault sin scrollear la pagina
  useEffect(()=>{
    const el=svgRef.current;
    if(!el) return;
    const onWheel=(e)=>{
      if(filtered.length<2) return;
      e.preventDefault();
      const rect=el.getBoundingClientRect();
      const frac=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
      const cur=zoom||{startIdx:0,endIdx:filtered.length-1};
      const span=cur.endIdx-cur.startIdx;
      const anchor=cur.startIdx+frac*span;
      const factor=e.deltaY<0?0.8:1.25;       // in acerca, out aleja
      let newSpan=Math.round(span*factor);
      newSpan=Math.max(10,Math.min(filtered.length-1,newSpan));
      if(newSpan>=filtered.length-1){ setZoom(null); return; }
      let start=Math.round(anchor-frac*newSpan);
      let end=start+newSpan;
      if(start<0){ start=0; end=newSpan; }
      if(end>filtered.length-1){ end=filtered.length-1; start=Math.max(0,end-newSpan); }
      setZoom({startIdx:start,endIdx:end});
    };
    el.addEventListener('wheel',onWheel,{passive:false});
    return ()=>el.removeEventListener('wheel',onWheel);
  },[zoom,filtered]);

  // FRED Fed Funds — gated: solo se trae al activar el toggle (cache por sesion)
  const toggleFred = useCallback(async ()=>{
    if(fredOn){ setFredOn(false); return; }
    setFredOn(true);
    if(fredObs && fredObs.length) return;
    if(_fredCache.FEDFUNDS){ setFredObs(_fredCache.FEDFUNDS); return; }
    setFredStatus('loading');
    try{
      const start=(sorted[0]?.date||'').substring(0,10) || '2019-01-01';
      const res=await authedFetch(`/api/fred/series?series_id=FEDFUNDS&observation_start=${start}`);
      if(!res.ok) throw new Error('fred '+res.status);
      const data=await res.json();
      const obs=(data?.observations||[])
        .filter(o=>o && o.value!=='.' && o.value!=null)
        .map(o=>({date:o.date, val:parseFloat(o.value)}))
        .filter(o=>ok(o.val));
      if(!obs.length) throw new Error('fred empty');
      _fredCache.FEDFUNDS=obs;
      setFredObs(obs);
      setFredStatus('idle');
    }catch(e){ console.warn('[StockLens] FRED fetch failed:', e?.message); setFredStatus('error'); }
  },[fredOn,fredObs,sorted]);

  if (!view.length || view.length < 2) return (
    <div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'#33353f',fontSize:12}}>No price data</div>
  );

  const prices=view.map(d=>d.close);
  const volumes=view.map(d=>d.volume||0);
  const W=800, H=230, pt=10, pb=30, pl=12, pr=12;
  const priceH=160, volH=30;
  const priceBottom=pt+priceH;
  const volTop=priceBottom+8;
  const volBottom=volTop+volH;
  const cw=W-pl-pr;

  const minP=Math.min(...prices), maxP=Math.max(...prices), rngP=maxP-minP||1;
  const maxV=Math.max(...volumes,1);

  const px=i=>pl+(i/Math.max(1,view.length-1))*cw;
  const py=p=>pt+(1-(p-minP)/rngP)*priceH;
  const vy=v=>volBottom-(v/maxV)*volH;

  // FRED Fed Funds overlay — alineado por fecha al eje X (step mensual), eje Y secundario propio
  const fredSamples = (fredOn && fredObs && fredObs.length) ? (()=>{
    const obsS=[...fredObs].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const valAt=(t)=>{ let v=null; for(const o of obsS){ if(new Date(o.date).getTime()<=t) v=o.val; else break; } return v ?? obsS[0].val; };
    return view.map((d,i)=>({i, val:valAt(new Date(d.date).getTime())}));
  })() : null;
  const fredVals = fredSamples ? fredSamples.map(s=>s.val) : [];
  const fMin = fredVals.length ? Math.min(...fredVals) : 0;
  const fMax = fredVals.length ? Math.max(...fredVals) : 1;
  const fRng = (fMax-fMin)||1;
  const fy = v => pt+(1-(v-fMin)/fRng)*priceH;
  const fredPts = fredSamples ? fredSamples.map(s=>`${px(s.i)},${fy(s.val)}`).join(' ') : null;

  const isUp=prices[prices.length-1]>=prices[0];
  const stroke=isUp?'#5ac576':'#eb6459';

  const pts=prices.map((p,i)=>`${px(i)},${py(p)}`).join(' ');
  const fillPts=`${pl},${priceBottom} ${pts} ${W-pr},${priceBottom}`;

  const sma50pts = useMemo(()=>{
    if (prices.length < 50) return null;
    const points=[];
    for (let i=49;i<prices.length;i++) {
      const avg=prices.slice(i-49,i+1).reduce((a,b)=>a+b,0)/50;
      points.push(`${px(i)},${py(avg)}`);
    }
    return points.join(' ');
  },[prices,px,py]);

  const hi52=Math.max(...prices), lo52=Math.min(...prices);

  const ticks=[];
  let lastM=-1;
  view.forEach((d,i)=>{
    const m=new Date(d.date).getMonth();
    if(m!==lastM){ticks.push({i,m});lastM=m;}
  });
  const mLbls=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const handleMouseMove = useCallback((e)=>{
    if (!svgRef.current) return;
    const rect=svgRef.current.getBoundingClientRect();
    const frac=(e.clientX-rect.left)/rect.width;
    const idx=Math.round(frac*(view.length-1));
    setHoverIdx(Math.max(0,Math.min(view.length-1,idx)));
  },[view.length]);

  const hd = hoverIdx!=null ? view[hoverIdx] : null;
  const hx = hoverIdx!=null ? px(hoverIdx) : null;

  return (
    <div style={{position:'relative'}}>
      <div style={{position:'absolute',top:6,left:8,zIndex:11,display:'flex',gap:6,alignItems:'center'}}>
        <button onClick={toggleFred} style={{
          background:fredOn?'#54360b':'#1c1d26',
          border:`1px solid ${fredOn?'#eca851':'#24262f'}`,
          color:fredOn?'#eca851':'#787a83',
          padding:'2px 9px',borderRadius:4,cursor:'pointer',fontSize:9,
          fontFamily:'Geist Mono,monospace',fontWeight:600
        }}>{fredOn?'● ':'○ '}Fed Funds</button>
        {fredStatus==='loading'&&<span style={{fontSize:9,color:'#787a83'}}>cargando…</span>}
        {fredStatus==='error'&&<span style={{fontSize:9,color:'#eb6459'}}>FRED no disponible</span>}
      </div>
      {zoom&&(
        <button onClick={()=>setZoom(null)} style={{
          position:'absolute',top:6,right:8,zIndex:11,
          background:'#1c1d26',border:'1px solid #34315f',color:'#968ff7',
          padding:'2px 9px',borderRadius:4,cursor:'pointer',fontSize:9,
          fontFamily:'Geist Mono,monospace',fontWeight:600
        }}>⤢ reset zoom</button>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{width:'100%',height:200,display:'block'}}
        onMouseMove={handleMouseMove}
        onMouseLeave={()=>setHoverIdx(null)}
      >
        <defs>
          <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={stroke} stopOpacity="0.01"/>
          </linearGradient>
        </defs>
        {[0.25,0.5,0.75].map(f=>(
          <line key={f} x1={pl} x2={W-pr} y1={pt+f*priceH} y2={pt+f*priceH} stroke="#1c1d26" strokeWidth="1"/>
        ))}
        <line x1={pl} x2={W-pr} y1={py(hi52)} y2={py(hi52)} stroke="#33353f" strokeWidth="0.8" strokeDasharray="4 4"/>
        <line x1={pl} x2={W-pr} y1={py(lo52)} y2={py(lo52)} stroke="#33353f" strokeWidth="0.8" strokeDasharray="4 4"/>
        <polygon points={fillPts} fill="url(#sg2)"/>
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"/>
        {sma50pts && <polyline points={sma50pts} fill="none" stroke="#968ff7" strokeWidth="1" strokeOpacity="0.7" strokeDasharray="3 2"/>}
        {fredPts && <polyline points={fredPts} fill="none" stroke="#eca851" strokeWidth="1.4" strokeOpacity="0.9"/>}
        {fredPts && (
          <g>
            <text x={W-pr-2} y={fy(fMax)+(fy(fMax)<pt+12?12:-2)} fontSize="7.5" fill="#eca851" textAnchor="end">{fMax.toFixed(2)}%</text>
            <text x={W-pr-2} y={fy(fMin)-2} fontSize="7.5" fill="#eca851" textAnchor="end">{fMin.toFixed(2)}%</text>
            <line x1={W-80} x2={W-68} y1={pt+22} y2={pt+22} stroke="#eca851" strokeWidth="1.4"/>
            <text x={W-65} y={pt+25} fontSize="7.5" fill="#eca851">Fed Funds</text>
          </g>
        )}
        {volumes.map((v,i)=>(
          <rect key={i}
            x={pl+i*(cw/view.length)}
            y={vy(v)}
            width={Math.max(1,cw/view.length-0.5)}
            height={volBottom-vy(v)}
            fill={i>0 ? (prices[i] >= prices[i-1] ? '#5ac576' : '#eb6459') : '#787a83'}
            opacity="0.3"
          />
        ))}
        {ticks.filter((_,i)=>i%2===0).map(({i,m})=>(
          <text key={m} x={px(i)} y={H-8} fontSize="8" fill="#33353f" textAnchor="middle">{mLbls[m]}</text>
        ))}
        <text x={pl+2} y={pt+10} fontSize="8" fill="#33353f">${maxP.toFixed(0)}</text>
        <text x={pl+2} y={priceBottom-4} fontSize="8" fill="#33353f">${minP.toFixed(0)}</text>
        <text x={W-pr-2} y={py(hi52)-3} fontSize="7.5" fill="#787a83" textAnchor="end">52W H</text>
        <text x={W-pr-2} y={py(lo52)+8} fontSize="7.5" fill="#787a83" textAnchor="end">52W L</text>
        {hx!=null&&(
          <g>
            <line x1={hx} x2={hx} y1={pt} y2={priceBottom} stroke="#787a83" strokeWidth="0.8" strokeDasharray="3 2"/>
            <circle cx={hx} cy={py(prices[hoverIdx])} r="3.5" fill={stroke} stroke="#15151c" strokeWidth="1.5"/>
          </g>
        )}
        {sma50pts&&(
          <g>
            <line x1={W-80} x2={W-68} y1={pt+10} y2={pt+10} stroke="#968ff7" strokeWidth="1.2" strokeDasharray="3 2"/>
            <text x={W-65} y={pt+13} fontSize="7.5" fill="#968ff7">50 SMA</text>
          </g>
        )}
      </svg>
      {hd&&hx!=null&&(
        <div style={{
          position:'absolute',top:8,
          left:Math.min(hx/800*100, 72)+'%',
          background:'#1c1d26',border:'1px solid #24262f',
          borderRadius:6,padding:'8px 11px',fontSize:11,
          fontFamily:'Geist Mono,monospace',
          pointerEvents:'none',minWidth:130,zIndex:10,
          boxShadow:'0 4px 16px rgba(0,0,0,0.5)'
        }}>
          <div style={{color:'#787a83',fontSize:9,marginBottom:5}}>{hd.date?.substring(0,10)}</div>
          <div style={{color:'#edeef4',marginBottom:2}}>C: <span style={{color:stroke}}>${hd.close?.toFixed(2)}</span></div>
          {hd.open&&<div style={{color:'#a6a7b1'}}>O: ${hd.open?.toFixed(2)}</div>}
          {hd.high&&<div style={{color:'#a6a7b1'}}>H: ${hd.high?.toFixed(2)}</div>}
          {hd.low &&<div style={{color:'#a6a7b1'}}>L: ${hd.low?.toFixed(2)}</div>}
          {hd.volume&&<div style={{color:'#787a83',fontSize:9,marginTop:3}}>Vol: {fmt.usd(hd.volume)}</div>}
        </div>
      )}
    </div>
  );
}

// ─── TECHNICAL SIGNALS ──────────────────────────────────────
function TechnicalSignals({history, spyHistory}) {
  const data = useMemo(()=>{
    if (!history||history.length<20) return null;
    const s=[...history].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const closes=s.map(d=>d.close);
    const cur=closes[closes.length-1];
    const rsi=computeRSI(closes,14);
    const sma50=computeSMA(closes,50);
    const sma200=computeSMA(closes,200);
    const hi52=Math.max(...closes);
    const lo52=Math.min(...closes);
    const rangePct=(cur-lo52)/Math.max(hi52-lo52,1);
    return {cur,rsi,sma50,sma200,hi52,lo52,rangePct,closes};
  },[history]);

  const macdData = useMemo(() => data ? computeMACD(data.closes) : null, [data]);
  const rsData   = useMemo(() => computeRelativeStrength(history, spyHistory), [history, spyHistory]);

  if (!data) return null;
  const {cur,rsi,sma50,sma200,hi52,lo52,rangePct}=data;

  const rsiColor=!ok(rsi)?'#787a83':rsi>70?'#eb6459':rsi<30?'#5ac576':'#eca851';
  const rsiLabel=!ok(rsi)?'—':rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL';
  const vs50=sma50?((cur-sma50)/sma50):null;
  const vs200=sma200?((cur-sma200)/sma200):null;

  const Sig=({label,val,color,extra})=>(
    <div style={{
      background:'#1c1d26',border:`1px solid #24262f`,borderRadius:6,
      padding:'10px 13px',flex:1,minWidth:120
    }}>
      <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:5}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:color||'#edeef4',fontFamily:'Geist Mono,monospace'}}>{val}</div>
      {extra&&<div style={{fontSize:9,color:'#33353f',marginTop:3}}>{extra}</div>}
    </div>
  );

  return (
    <div>
      <SectionTitle>Technical Signals</SectionTitle>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Sig label="RSI 14" val={ok(rsi)?rsi.toFixed(1):'—'} color={rsiColor} extra={rsiLabel}/>
        <Sig label="vs 50-day SMA" val={ok(vs50)?fmt.chg(vs50):'—'} color={ok(vs50)?(vs50>0?'#5ac576':'#eb6459'):'#787a83'} extra={ok(sma50)?`SMA $${sma50.toFixed(2)}`:'insufficient data'}/>
        <Sig label="vs 200-day SMA" val={ok(vs200)?fmt.chg(vs200):'—'} color={ok(vs200)?(vs200>0?'#5ac576':'#eb6459'):'#787a83'} extra={ok(sma200)?`SMA $${sma200.toFixed(2)}`:'insufficient data'}/>
        <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 13px',flex:2,minWidth:160}}>
          <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:5}}>
            52-Week Range  <span style={{color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>${lo52.toFixed(0)} — ${hi52.toFixed(0)}</span>
          </div>
          <div style={{background:'#24262f',borderRadius:3,height:6,overflow:'hidden',position:'relative'}}>
            <div style={{width:`${rangePct*100}%`,height:'100%',background:'#968ff7',borderRadius:3,transition:'width 0.5s ease'}}/>
          </div>
          <div style={{fontSize:9,color:'#787a83',marginTop:3}}>{(rangePct*100).toFixed(0)}% of range · Current ${ok(cur)?cur.toFixed(2):'—'}</div>
        </div>
      </div>
      {(macdData||rsData)&&(
        <div style={{marginTop:8,background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,overflow:'hidden'}}>
          {macdData&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 13px',borderBottom:rsData?'1px solid #24262f':'none'}}>
              <span style={{fontSize:11,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px'}}>MACD</span>
              <div style={{textAlign:'right'}}>
                <span style={{
                  color:
                    macdData.crossover==='bullish_cross' ? '#5ac576' :
                    macdData.crossover==='bearish_cross' ? '#eb6459' :
                    macdData.crossover==='bullish'       ? '#5ac576' :
                    macdData.crossover==='bearish'       ? '#eb6459' : '#787a83',
                  fontSize:13,fontWeight:700
                }}>
                  {macdData.crossover==='bullish_cross' ? '⬆ Bullish Crossover' :
                   macdData.crossover==='bearish_cross' ? '⬇ Bearish Crossover' :
                   macdData.crossover==='bullish'       ? '▲ Trending Up' :
                   macdData.crossover==='bearish'       ? '▼ Trending Down' : '→ Neutral'}
                </span>
                <div style={{color:'#33353f',fontSize:10,marginTop:2}}>
                  MACD {macdData.macd.toFixed(3)} · Signal {macdData.signal.toFixed(3)}
                </div>
              </div>
            </div>
          )}
          {rsData&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 13px'}}>
              <span style={{fontSize:11,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px'}}>vs SPY (6M)</span>
              <div style={{textAlign:'right'}}>
                <span style={{
                  color: rsData.outperforming ? '#5ac576' : '#eb6459',
                  fontSize:13,fontWeight:700
                }}>
                  {rsData.outperforming ? '▲ Outperforming' : '▼ Underperforming'}
                  {' '}{rsData.alpha>=0?'+':''}{(rsData.alpha*100).toFixed(1)}%
                </span>
                <div style={{color:'#33353f',fontSize:10,marginTop:2}}>
                  Stock {rsData.stockRet>=0?'+':''}{(rsData.stockRet*100).toFixed(1)}% · SPY {rsData.spyRet>=0?'+':''}{(rsData.spyRet*100).toFixed(1)}%
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ANALYST PANEL ──────────────────────────────────────────
function AnalystPanel({ptC, udC, analystEst, currentPrice, ptList}) {
  if (!ptC && !udC) return null;

  const pt=Array.isArray(ptC)?ptC[0]:ptC;
  const ud=Array.isArray(udC)?udC[0]:udC;
  const ae=Array.isArray(analystEst)?analystEst[0]:analystEst;

  const targetMed=pt?.targetMedian||pt?.targetConsensus;
  const upside=(ok(targetMed)&&ok(currentPrice)&&currentPrice>0)?(targetMed-currentPrice)/currentPrice:null;
  const rating=ud?.consensus||pt?.consensus;

  const sb=ud?.strongBuy||0, b=ud?.buy||0, h=ud?.hold||0, s=ud?.sell||0, ss=ud?.strongSell||0;
  const total=sb+b+h+s+ss;
  const buyPct=total>0?(sb+b)/total:null;
  const holdPct=total>0?h/total:null;
  const sellPct=total>0?(s+ss)/total:null;

  const ratingColor=rating==='Strong Buy'?'#5ac576':rating==='Buy'?'#5ac576':rating==='Hold'?'#eca851':'#eb6459';

  const fwdEps=ae?.estimatedEpsAvg;
  const fwdPE=(ok(fwdEps)&&fwdEps>0&&ok(currentPrice))?currentPrice/fwdEps:null;

  return (
    <div>
      <SectionTitle>Analyst Consensus</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            {rating&&(
              <div style={{
                padding:'5px 14px',borderRadius:20,
                background:ratingColor+'22',border:`1px solid ${ratingColor}55`,
                fontSize:12,fontWeight:700,color:ratingColor,letterSpacing:'1px'
              }}>{rating.toUpperCase()}</div>
            )}
            {total>0&&<div style={{fontSize:11,color:'#787a83'}}>{total} analysts</div>}
          </div>
          {ok(targetMed)&&(
            <div>
              <div style={{fontSize:10,color:'#787a83',marginBottom:3}}>Consensus Price Target</div>
              <div style={{fontSize:20,fontWeight:800,color:'#edeef4',fontFamily:'Geist Mono,monospace',lineHeight:1}}>
                {fmt.price(targetMed)}
                {ok(upside)&&<span style={{fontSize:12,fontWeight:600,color:upside>0?'#5ac576':'#eb6459',marginLeft:8}}>
                  {upside>0?'▲':'▼'} {Math.abs(upside*100).toFixed(1)}% upside
                </span>}
              </div>
              {ok(pt?.targetHigh)&&ok(pt?.targetLow)&&(
                <div style={{fontSize:10,color:'#33353f',marginTop:2}}>Range: {fmt.price(pt.targetLow)} — {fmt.price(pt.targetHigh)}</div>
              )}
            </div>
          )}
          {ok(fwdPE)&&(
            <div style={{background:'#1c1d26',borderRadius:6,padding:'8px 12px',display:'inline-block'}}>
              <span style={{fontSize:10,color:'#787a83'}}>Fwd P/E </span>
              <span style={{fontSize:14,fontWeight:700,color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>{fwdPE.toFixed(1)}x</span>
            </div>
          )}
        </div>
        {total>0&&(
          <div>
            <div style={{fontSize:10,color:'#787a83',marginBottom:8}}>Analyst Distribution ({total})</div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {[
                {label:'Buy / Strong Buy',pct:buyPct,color:'#5ac576',cnt:sb+b},
                {label:'Hold',pct:holdPct,color:'#eca851',cnt:h},
                {label:'Sell / Strong Sell',pct:sellPct,color:'#eb6459',cnt:s+ss},
              ].map(({label,pct,color,cnt})=>(
                <div key={label}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:3,fontSize:10,color:'#787a83'}}>
                    <span>{label}</span>
                    <span style={{color,fontFamily:'Geist Mono,monospace',fontWeight:600}}>{cnt} ({ok(pct)?(pct*100).toFixed(0):0}%)</span>
                  </div>
                  <div style={{background:'#24262f',borderRadius:3,height:5}}>
                    <div style={{width:`${(pct||0)*100}%`,height:'100%',background:color,borderRadius:3,transition:'width 0.8s ease'}}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {ptList&&ptList.length>0&&(
        <div style={{marginTop:14}}>
          <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>Recent Analyst Price Targets</div>
          <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:200,overflowY:'auto'}}>
            {ptList.slice(0,8).map((pt,i)=>{
              const upPt=(ok(pt.priceTarget)&&ok(currentPrice))?(pt.priceTarget-currentPrice)/currentPrice:null;
              const ptColor=!ok(upPt)?'#787a83':upPt>0.1?'#5ac576':upPt<-0.1?'#eb6459':'#eca851';
              return (
                <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#1c1d26',borderRadius:5,padding:'6px 12px',fontSize:11}}>
                  <span style={{color:'#787a83',flex:1}}>{pt.analystCompany||pt.analystName}</span>
                  <span style={{color:'#787a83',marginRight:12}}>{pt.publishedDate?.substring(0,10)}</span>
                  <span style={{fontWeight:700,color:ptColor,fontFamily:'Geist Mono,monospace'}}>
                    {fmt.price(pt.priceTarget)}
                    {ok(upPt)&&<span style={{fontSize:10,marginLeft:5}}>({upPt>0?'+':''}{(upPt*100).toFixed(1)}%)</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── GROWTH PANEL ───────────────────────────────────────────
function GrowthPanel({stmts}) {
  if (!stmts||stmts.length<2) return null;
  const rows=[...stmts].reverse();

  const revs=rows.map(q=>q.revenue);
  const netI=rows.map(q=>q.netIncome);
  const gms=rows.map(q=>q.revenue>0?q.grossProfit/q.revenue:null);
  const eps=rows.map(q=>q.eps);

  const cagr=(first,last,yrs)=>(ok(first)&&ok(last)&&first>0&&last>0)?Math.pow(last/first,1/yrs)-1:null;
  const years=stmts.length/4;
  const revCagr=cagr(rows[0]?.revenue,rows[rows.length-1]?.revenue,years);

  const Row=({label,data,type,color,cagrVal,stmtsData})=>{
    const validData=data.filter(v=>ok(v));
    const latestVal=data[data.length-1];
    const firstLabel=stmtsData?.[0]?`${stmtsData[0].period} ${stmtsData[0].calendarYear}`:'';
    const lastLabel=stmtsData?.[stmtsData.length-1]?`${stmtsData[stmtsData.length-1].period} ${stmtsData[stmtsData.length-1].calendarYear}`:'';
    return (
      <div style={{padding:'10px 0',borderBottom:'1px solid #1c1d26'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:130,fontSize:11,color:'#a6a7b1',flexShrink:0}}>{label}</div>
          <div style={{flex:1,position:'relative'}}>
            <Sparkline data={data} type={type} color={color} h={44} w={180}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:2}}>
              <span style={{fontSize:9,color:'#33353f'}}>{firstLabel}</span>
              <span style={{fontSize:9,color:'#33353f'}}>{lastLabel}</span>
            </div>
          </div>
          <div style={{textAlign:'right',minWidth:90}}>
            {ok(latestVal)&&(
              <div style={{fontSize:11,color:'#edeef4',fontFamily:'Geist Mono,monospace',fontWeight:700}}>
                {type==='line'?fmt.pct(latestVal):fmt.usd(latestVal)}
              </div>
            )}
            {ok(cagrVal)&&(
              <div style={{fontSize:10,color:cagrVal>0?'#5ac576':'#eb6459',fontFamily:'Geist Mono,monospace',fontWeight:700}}>
                CAGR {fmt.chg(cagrVal)}
              </div>
            )}
            <div style={{fontSize:9,color:'#33353f',marginTop:1}}>{data.length} qtrs</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <SectionTitle>Growth Profile — {stmts.length} Quarters</SectionTitle>
      <Row label="Revenue" data={revs} type="bar" color="#968ff7" cagrVal={revCagr} stmtsData={rows}/>
      <Row label="Net Income" data={netI} type="bar" color="#5ac576" cagrVal={null} stmtsData={rows}/>
      <Row label="Gross Margin %" data={gms} type="line" color="#968ff7" cagrVal={null} stmtsData={rows}/>
      <Row label="EPS" data={eps} type="line" color="#eca851" cagrVal={null} stmtsData={rows}/>
    </div>
  );
}

// ─── QUARTERLY TABLE ─────────────────────────────────────────
function QuarterlyTable({stmts}) {
  if (!stmts||!stmts.length) return null;
  const rows=stmts.slice(0,6).slice().reverse();
  return (
    <div>
      <SectionTitle>Quarterly Trend</SectionTitle>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead>
            <tr>
              {['Period','Revenue','YoY Δ','Gross Margin','Net Income','EPS'].map(h=>(
                <th key={h} style={{padding:'6px 10px',textAlign:'left',color:'#787a83',borderBottom:'1px solid #24262f',fontWeight:600,whiteSpace:'nowrap',fontSize:10}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((q)=>{
              const yoyQ=stmts.find(s=>s.period===q.period&&parseInt(s.calendarYear)===parseInt(q.calendarYear)-1);
              const yoy=(yoyQ?.revenue>0&&ok(q.revenue))?(q.revenue-yoyQ.revenue)/yoyQ.revenue:null;
              const gm=q.revenue>0?q.grossProfit/q.revenue:null;
              return (
                <tr key={q.date||q.period+q.calendarYear} style={{borderBottom:'1px solid #1c1d26'}}>
                  <td style={{padding:'8px 10px',color:'#787a83',fontFamily:'Geist Mono,monospace',fontSize:10}}>{q.period} {q.calendarYear}</td>
                  <td style={{padding:'8px 10px',color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>{fmt.usd(q.revenue)}</td>
                  <td style={{padding:'8px 10px',fontFamily:'Geist Mono,monospace',color:ok(yoy)?(yoy>=0?'#5ac576':'#eb6459'):'#33353f'}}>
                    {ok(yoy)?fmt.chg(yoy):'—'}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'Geist Mono,monospace',color:ok(gm)?(gm>=0.4?'#5ac576':gm>=0.2?'#eca851':'#eb6459'):'#33353f'}}>
                    {fmt.pct(gm)}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'Geist Mono,monospace',color:q.netIncome>=0?'#5ac576':'#eb6459'}}>
                    {fmt.usd(q.netIncome)}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'Geist Mono,monospace',color:q.eps>=0?'#5ac576':'#eb6459'}}>
                    {ok(q.eps)?`$${q.eps.toFixed(2)}`:'—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── NEWS ───────────────────────────────────────────────────
function NewsCard({items}) {
  if (!items||!items.length) return null;
  return (
    <div>
      <SectionTitle>Latest News</SectionTitle>
      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {items.slice(0,6).map((n,i)=>(
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none'}}>
            <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 13px',transition:'border-color 0.15s'}}>
              <div style={{fontSize:12,color:'#a6a7b1',lineHeight:1.45,marginBottom:5}}>{n.title}</div>
              <div style={{display:'flex',gap:8,fontSize:10,color:'#33353f'}}>
                <span>{n.site}</span><span>·</span>
                <span>{n.publishedDate?.substring(0,10)}</span>
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── FINNHUB COMPONENTS ─────────────────────────────────────
function EarningsCalendarBadge({ earn }) {
  if (!earn) return null;
  const date = earn.date;
  const est = earn.epsEstimate;
  return (
    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
      <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Next Earnings</div>
      <div style={{fontSize:15,fontWeight:700,color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>{date || '—'}</div>
      {est != null && <div style={{fontSize:10,color:'#787a83',marginTop:3}}>Est. EPS: {est.toFixed(2)}</div>}
    </div>
  );
}

function EarningsSurpriseChart({ data }) {
  if (!data || data.length === 0) return null;
  return (
    <div>
      <SectionTitle>Earnings Beat / Miss — Last {data.length} Quarters</SectionTitle>
      <div style={{display:'flex',gap:6,alignItems:'flex-end',height:80}}>
        {[...data].reverse().map((q, i) => {
          const surprise = q.surprisePercent || 0;
          const isPos = surprise >= 0;
          const h = Math.min(70, Math.abs(surprise) * 3 + 10);
          return (
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
              <div style={{fontSize:9,color:isPos?'#5ac576':'#eb6459',fontWeight:700}}>
                {isPos?'+':''}{surprise.toFixed(1)}%
              </div>
              <div style={{
                width:'100%',height:h,
                background:isPos?'#5ac57633':'#eb645933',
                border:`1px solid ${isPos?'#5ac576':'#eb6459'}`,
                borderRadius:3
              }}/>
              <div style={{fontSize:8,color:'#33353f'}}>{q.period}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsiderTable({ data }) {
  if (!data || data.length === 0) return null;
  const buys = data.filter(t => t.transactionType === 'P - Purchase' || t.change > 0);
  const sells = data.filter(t => t.transactionType === 'S - Sale' || t.change < 0);
  return (
    <div>
      <SectionTitle>Insider Transactions (Last 90 Days)</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
        <div style={{background:'#194224',border:'1px solid #194224',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#5ac576'}}>{buys.length}</div>
          <div style={{fontSize:10,color:'#5ac576'}}>Insider Buys</div>
        </div>
        <div style={{background:'#602a25',border:'1px solid #602a25',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#eb6459'}}>{sells.length}</div>
          <div style={{fontSize:10,color:'#eb6459'}}>Insider Sells</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {data.slice(0, 6).map((t, i) => {
          const isBuy = t.change > 0;
          return (
            <div key={i} style={{
              display:'flex',justifyContent:'space-between',alignItems:'center',
              background:'#1c1d26',borderRadius:5,padding:'7px 12px',fontSize:11
            }}>
              <span style={{color:'#787a83',flex:1}}>{t.name}</span>
              <span style={{color:'#a6a7b1',marginRight:12}}>{t.filingDate?.substring(0,10)}</span>
              <span style={{fontWeight:700,color:isBuy?'#5ac576':'#eb6459',fontFamily:'Geist Mono,monospace'}}>
                {isBuy ? '▲ Buy' : '▼ Sell'} {Math.abs(t.change || 0).toLocaleString()} shares
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── QUALITY MOAT CARD ──────────────────────────────────────
function QualityMoatCard({ metrics, ratios, stmts, profile }) {
  const moat = useMemo(
    () => computeMoatScore(metrics, ratios, stmts, profile),
    [metrics, ratios, stmts, profile]
  );
  if (!metrics) return null;
  const dimensions = [
    { key:'demand',  label:'Demand Inelasticity', desc:'Price-insensitive customers',    score: moat.demand,  max:25, color:'#5ac576' },
    { key:'supply',  label:'Supply Barriers',      desc:'Difficult to replicate',          score: moat.supply,  max:25, color:'#968ff7' },
    { key:'pricing', label:'Pricing Power',         desc:'Margin expansion capacity',       score: moat.pricing, max:25, color:'#968ff7' },
    { key:'capEff',  label:'Capital Efficiency',    desc:'High returns on reinvestment',    score: moat.capEff,  max:25, color:'#eca851' },
  ];
  return (
    <div style={{background:'#24262f',border:'1px solid #24262f',borderRadius:12,padding:'20px 24px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <div style={{color:'#edeef4',fontWeight:700,fontSize:15}}>Quality Moat Scorecard</div>
          <div style={{color:'#787a83',fontSize:12,marginTop:2}}>Durable competitive advantage across 4 pillars</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{color:moat.moatColor,fontWeight:700,fontSize:14}}>{moat.moatRating}</div>
          <div style={{color:'#787a83',fontSize:12}}>{moat.total}/100</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {dimensions.map(d => {
          const pct = (d.score / d.max) * 100;
          return (
            <div key={d.key}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <div>
                  <span style={{color:'#edeef4',fontSize:13,fontWeight:600}}>{d.label}</span>
                  <span style={{color:'#787a83',fontSize:11,marginLeft:8}}>{d.desc}</span>
                </div>
                <span style={{
                  color: d.score >= 18 ? d.color : d.score <= 8 ? '#eb6459' : '#a6a7b1',
                  fontSize:13,fontWeight:700
                }}>{d.score}/{d.max}</span>
              </div>
              <div style={{background:'#24262f',borderRadius:4,height:6,overflow:'hidden'}}>
                <div style={{
                  height:'100%',width:`${pct}%`,borderRadius:4,
                  background: d.score >= 18 ? d.color : d.score <= 8 ? '#eb6459' : '#4b4c58',
                  transition:'width 0.4s ease'
                }}/>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:16,padding:'10px 14px',background:'#15151c',borderRadius:8,borderLeft:`3px solid ${moat.moatColor}`}}>
        <div style={{color:'#a6a7b1',fontSize:11}}>
          <strong style={{color:moat.moatColor}}>Moat insight: </strong>
          {moat.total >= 85
            ? 'Exceptional competitive position. The business can compound capital at high rates for a decade+.'
            : moat.total >= 70
            ? 'Strong structural advantages. Durable earnings power with limited competitive threats.'
            : moat.total >= 55
            ? 'Moderate defensibility. Watch for margin compression or competitive encroachment.'
            : moat.total >= 40
            ? 'Thin competitive barriers. Valuation must compensate for earnings vulnerability.'
            : 'No identifiable moat. Commodity economics — any premium valuation is speculative.'
          }
        </div>
      </div>
    </div>
  );
}

// ─── OVERVALUATION BANNER ───────────────────────────────────
function OvervaluationBanner({ metrics, ratios, profile }) {
  const result = useMemo(
    () => detectOvervaluation(metrics, ratios, profile, SECTOR_BM),
    [metrics, ratios, profile]
  );
  if (!metrics || result.level === 'none') return null;
  const config = {
    caution: { bg:'#54360b', border:'#54360b', icon:'⚠️', title:'Valuation Caution', color:'#eca851' },
    risk:    { bg:'#602a25', border:'#602a25', icon:'🔴', title:'Overvaluation Risk Detected', color:'#eb6459' },
    bubble:  { bg:'#33353f', border:'#33353f', icon:'⚫', title:'BUBBLE TERRITORY — Extreme Overvaluation', color:'#a6a7b1' },
  };
  const c = config[result.level];
  return (
    <div style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:12,padding:'16px 20px',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <span style={{fontSize:16}}>{c.icon}</span>
        <span style={{color:c.color,fontWeight:700,fontSize:14}}>{c.title}</span>
        {result.peg && (
          <span style={{marginLeft:'auto',background:'#24262f',borderRadius:6,padding:'2px 8px',color:c.color,fontSize:11,fontWeight:600}}>
            PEG {result.peg.toFixed(2)}
          </span>
        )}
      </div>
      <ul style={{margin:0,padding:'0 0 0 20px',listStyle:'disc'}}>
        {result.reasons.map((r,i) => (
          <li key={i} style={{color:'#a6a7b1',fontSize:12,marginBottom:2}}>{r}</li>
        ))}
      </ul>
      <div style={{marginTop:10,color:'#787a83',fontSize:11,fontStyle:'italic'}}>
        Priced-for-perfection stocks face asymmetric downside. Any earnings miss can destroy 20–40% of value instantly.
      </div>
    </div>
  );
}

// ─── FACTOR TILT CARD ───────────────────────────────────────
function FactorTiltCard({ metrics, ratios, history, stmts, profile }) {
  const tilts = useMemo(
    () => computeFactorTilts(metrics, ratios, history, stmts, profile),
    [metrics, ratios, history, stmts, profile]
  );
  if (!metrics) return null;
  const factors = [
    { key: 'value',    label: 'Value',    color: '#5ac576', icon: '💰' },
    { key: 'growth',   label: 'Growth',   color: '#968ff7', icon: '📈' },
    { key: 'momentum', label: 'Momentum', color: '#eca851', icon: '⚡' },
    { key: 'quality',  label: 'Quality',  color: '#968ff7', icon: '🏆' },
    { key: 'size',     label: 'Size',     color: '#968ff7', icon: '📊' },
  ];
  return (
    <div style={{background:'#24262f',border:'1px solid #24262f',borderRadius:12,padding:'20px 24px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <div style={{color:'#edeef4',fontWeight:700,fontSize:15}}>Factor Tilt Analysis</div>
          <div style={{color:'#787a83',fontSize:12,marginTop:2}}>Quant factor exposure across 5 dimensions (0–20 each)</div>
        </div>
        <div style={{background:'#24262f',borderRadius:8,padding:'4px 12px',color:'#968ff7',fontSize:12,fontWeight:600}}>
          {tilts.tilt_label}
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        {factors.map(f => {
          const score = tilts[f.key];
          const pct   = (score / 20) * 100;
          const neutral = pct > 45 && pct < 55;
          return (
            <div key={f.key} style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:80,color:'#a6a7b1',fontSize:12,textAlign:'right'}}>{f.icon} {f.label}</div>
              <div style={{flex:1,background:'#24262f',borderRadius:4,height:8,overflow:'hidden',position:'relative'}}>
                <div style={{
                  position:'absolute',left:0,top:0,height:'100%',
                  width:`${pct}%`,
                  background: neutral ? '#33353f' : f.color,
                  borderRadius:4,
                  transition:'width 0.4s ease'
                }}/>
                <div style={{position:'absolute',left:'50%',top:-2,bottom:-2,width:1,background:'#33353f'}}/>
              </div>
              <div style={{
                width:28,textAlign:'right',
                color: score >= 14 ? f.color : score <= 6 ? '#eb6459' : '#787a83',
                fontSize:13,fontWeight:700
              }}>{score}</div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,display:'flex',gap:16,justifyContent:'flex-end'}}>
        {['Weak (0-7)','Neutral (8-12)','Strong (13-20)'].map((l,i)=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:i===0?'#eb6459':i===1?'#33353f':'#5ac576'}}/>
            <span style={{color:'#787a83',fontSize:10}}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── VERDICT SECTION ────────────────────────────────────────
function VerdictSection({scores, profile, metrics, ratios, aiVerdict, aiLoading}) {
  const r=getRating(scores.total);
  const moat=[], risks=[];
  const gm=ratios?.grossProfitMarginTTM, roic=metrics?.returnOnInvestedCapitalTTM??metrics?.roicTTM;
  const nd=metrics?.netDebtToEBITDATTM, ic=metrics?.interestCoverageTTM??metrics?.interestCoverageRatioTTM;
  const pfcf=metrics?.pfcfRatioTTM??metrics?.priceToFreeCashFlowRatioTTM, pe=metrics?.peRatioTTM??metrics?.priceToEarningsRatioTTM;

  if(ok(gm)&&gm>=0.50)   moat.push('Gross margin >50% — strong pricing power');
  if(ok(roic)&&roic>=0.20) moat.push('ROIC >20% — deep competitive moat (Escudero framework)');
  if(ok(nd)&&nd<0)         moat.push('Net cash balance sheet — fortress');
  if(ok(ic)&&ic>=15)       moat.push('Interest coverage >15x — zero financing risk');
  if(ok(pfcf)&&pfcf<22)    moat.push('Attractive P/FCF — solid free cash flow yield');
  if(ok(roic)&&roic>=0.15&&scores.mom>=18) moat.push('Quality + momentum combo — Druckenmiller highest-conviction setup');

  if(ok(pe)&&pe>50)        risks.push('Premium P/E >50x — requires flawless execution');
  if(ok(nd)&&nd>3)         risks.push('High leverage Net Debt/EBITDA >3x');
  if(ok(gm)&&gm<0.15)      risks.push('Thin gross margins — pricing vulnerability');
  if(ok(roic)&&roic<0.05)  risks.push('Low ROIC — weak capital allocation efficiency');
  if(scores.mom<8)         risks.push('Weak price momentum — not confirming the bull case');
  if(scores.total<50)      risks.push('Composite score below Hold threshold');

  const co=profile?.companyName||'This company';
  const verdictText = {
    'STRONG BUY': `${co} shows exceptional quality fundamentals confirmed by strong price momentum — the combination Druckenmiller calls the highest-conviction setup. ROIC signals a durable economic moat (Escudero framework). Scoring ${scores.total}/100.`,
    'BUY': `${co} demonstrates solid quality metrics with favorable risk/reward at current prices. Fundamentals support the thesis; momentum is constructive. Scoring ${scores.total}/100.`,
    'HOLD': `${co} has decent fundamentals but current valuation or weak momentum limits near-term upside. Good business, but wait for a better entry or catalyst (Escudero). Scoring ${scores.total}/100.`,
    'CAUTION': `${co} shows warning signs on valuation or fundamentals. Momentum is not confirming the bull case. When price and fundamentals diverge negatively, respect the signal (Druckenmiller). Scoring ${scores.total}/100.`,
    'AVOID': `${co} fails multiple quality, value, and momentum criteria. High risk of capital impairment. Scoring ${scores.total}/100.`,
  }[r.label];

  return (
    <div>
      <SectionTitle>Investment Verdict</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:12,marginBottom:14,alignItems:'start'}}>
        <div style={{background:'#194224',border:'1px solid #194224',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#5ac576',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>🏰 Bull Case</div>
          {moat.length ? moat.map((m,i)=>(
            <div key={i} style={{fontSize:11,color:'#5ac576',marginBottom:5,lineHeight:1.5}}>· {m}</div>
          )) : <div style={{fontSize:11,color:'#33353f'}}>No strong moat signals at current levels</div>}
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'0 8px'}}>
          <ScoreGauge score={scores.total}/>
          <div style={{width:140}}>
            <ScoreBar label="Valuation"       value={scores.val}    max={25} color="#968ff7"/>
            <ScoreBar label="Financial Health" value={scores.hlth}   max={30} color="#5ac576"/>
            <ScoreBar label="Momentum"         value={scores.mom}    max={25} color="#eca851"/>
            <ScoreBar label="Growth"           value={scores.growth} max={20} color="#968ff7"/>
          </div>
        </div>
        <div style={{background:'#602a25',border:'1px solid #602a25',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#eb6459',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>⚠ Bear Case</div>
          {risks.length ? risks.map((rk,i)=>(
            <div key={i} style={{fontSize:11,color:'#eb6459',marginBottom:5,lineHeight:1.5}}>· {rk}</div>
          )) : <div style={{fontSize:11,color:'#33353f'}}>No major risk flags detected</div>}
        </div>
      </div>
      <div style={{background:r.bg,border:`1px solid ${r.border}`,borderRadius:8,padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'1px',marginBottom:5}}>
            Bottom Line {aiVerdict && <span style={{color:'#968ff7',fontWeight:400,textTransform:'none',letterSpacing:0}}>✨ AI</span>}
          </div>
          <div style={{fontSize:13,color:'#a6a7b1',lineHeight:1.65}}>
            {aiLoading ? (
              <span style={{color:'#787a83',fontStyle:'italic'}}>✨ Generating AI analysis...</span>
            ) : aiVerdict ? (
              <span>{aiVerdict}</span>
            ) : (
              verdictText
            )}
          </div>
        </div>
        <div style={{padding:'10px 22px',borderRadius:6,background:r.bg,border:`2px solid ${r.color}`,flexShrink:0,fontSize:13,fontWeight:800,color:r.color,letterSpacing:'2px',whiteSpace:'nowrap'}}>{r.label}</div>
      </div>
    </div>
  );
}

// ─── DCF CALCULATOR ─────────────────────────────────────────
function runDCF(inputs) {
  const { revGrowth1to5, revGrowth6to10, ebitMargin, taxRate, capexPct, wcChange, discountRate, terminalGrowth, netDebt, shares, baseRevenue } = inputs;
  if (!ok(baseRevenue) || !ok(shares) || shares <= 0) return null;
  const g1=revGrowth1to5/100, g2=revGrowth6to10/100, ebit=ebitMargin/100, tax=taxRate/100;
  const capex=capexPct/100, wc=wcChange/100, r=discountRate/100, tg=terminalGrowth/100;
  if (r <= tg) return null;
  let rev=baseRevenue, pv=0;
  for (let yr=1; yr<=10; yr++) {
    const g=yr<=5?g1:g2;
    rev=rev*(1+g);
    const fcf=rev*ebit*(1-tax)-rev*(capex+wc);
    pv+=fcf/Math.pow(1+r,yr);
  }
  const lastFCF=rev*ebit*(1-tax)-rev*(capex+wc);
  const tv=lastFCF*(1+tg)/(r-tg);
  const pvTV=tv/Math.pow(1+r,10);
  const enterpriseValue=pv+pvTV;
  const equityValue=enterpriseValue-(netDebt||0);
  const intrinsicValue=equityValue/shares;
  return {intrinsicValue,pv,pvTV,enterpriseValue,equityValue};
}

function DCFCalculator({inputs,setInputs,currentPrice,profile}) {
  if (!inputs) return null;
  const rateError = inputs.discountRate <= inputs.terminalGrowth;
  const result=runDCF(inputs);
  const iv=result?.intrinsicValue;
  const mos=(ok(iv)&&ok(currentPrice)&&currentPrice>0)?(iv-currentPrice)/iv:null;
  const mosColor=!ok(mos)?'#787a83':mos>0.15?'#5ac576':mos>-0.15?'#eca851':'#eb6459';
  const set=(key,val)=>setInputs(p=>({...p,[key]:val}));

  const SliderInput=({label,stateKey,min,max,step=1,unit='%',note})=>(
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:10,color:'#787a83'}}>{label}</span>
        <span style={{fontSize:11,color:'#edeef4',fontFamily:'Geist Mono,monospace',fontWeight:700}}>{inputs[stateKey]}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={inputs[stateKey]}
        onChange={e=>set(stateKey,parseFloat(e.target.value))}
        style={{width:'100%',accentColor:'#968ff7',cursor:'pointer'}}/>
      {note&&<div style={{fontSize:9,color:'#33353f'}}>{note}</div>}
    </div>
  );

  const sensRows=[-2,-1,0,1,2].map(dr=>{
    const rr=inputs.discountRate+dr;
    return [-1,0,1].map(dg=>{
      const tg=inputs.terminalGrowth+dg;
      if(rr<=tg) return null;
      const res=runDCF({...inputs,discountRate:rr,terminalGrowth:tg});
      return res?.intrinsicValue;
    });
  });

  return (
    <div style={{background:'#15151c',border:'1px solid #1c1d26',borderRadius:10,overflow:'hidden'}}>
      <div style={{background:'#1c1d26',borderBottom:'1px solid #1c1d26',padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#edeef4',textTransform:'uppercase',letterSpacing:'1px'}}>📐 Interactive DCF Model</div>
        <div style={{fontSize:10,color:'#787a83'}}>{profile?.companyName} · All values auto-recalculate</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 300px',gap:0}}>
        <div style={{padding:'16px 20px',borderRight:'1px solid #1c1d26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#968ff7',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>Revenue Growth</div>
          <SliderInput label="Years 1–5 Growth Rate" stateKey="revGrowth1to5" min={-10} max={50} note="Analyst estimates for near-term growth"/>
          <SliderInput label="Years 6–10 Growth Rate" stateKey="revGrowth6to10" min={-5} max={30} note="Conservative long-run growth"/>
          <SliderInput label="EBIT Margin" stateKey="ebitMargin" min={0} max={60} note="Operating income / revenue"/>
          <SliderInput label="Tax Rate" stateKey="taxRate" min={10} max={40} note="Effective tax rate"/>
        </div>
        <div style={{padding:'16px 20px',borderRight:'1px solid #1c1d26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#968ff7',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>Discount & Capital</div>
          <SliderInput label="Discount Rate (WACC)" stateKey="discountRate" min={4} max={20} step={0.5} note="Weighted average cost of capital"/>
          <SliderInput label="Terminal Growth Rate" stateKey="terminalGrowth" min={0} max={6} step={0.5} note="Perpetuity growth (≤ GDP growth)"/>
          <SliderInput label="CapEx % of Revenue" stateKey="capexPct" min={0} max={30} note="Maintenance + growth capex"/>
          <SliderInput label="Beta" stateKey="beta" min={0.3} max={3} step={0.1} unit="" note="Used to contextualize risk"/>
          <div style={{fontSize:9,color:'#33353f',marginTop:4}}>Net Debt: {fmt.usd(inputs.netDebt)} · Shares: {ok(inputs.shares)?(inputs.shares/1e6).toFixed(0)+'M':'—'}</div>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'#eca851',textTransform:'uppercase',letterSpacing:'1px',marginBottom:4}}>Valuation Result</div>
          {rateError && (
            <div style={{background:'#602a25',border:'1px solid #eb6459',borderRadius:6,padding:'8px 12px',fontSize:10,color:'#eb6459',fontWeight:600}}>
              ⚠ WACC ({inputs.discountRate}%) must exceed terminal growth ({inputs.terminalGrowth}%) — adjust the sliders above.
            </div>
          )}
          <div style={{textAlign:'center',padding:'16px',background:'#15151c',borderRadius:8,border:`1px solid ${rateError?'#eb6459':'#24262f'}`}}>
            <div style={{fontSize:10,color:'#787a83',marginBottom:4}}>Intrinsic Value / Share</div>
            <div style={{fontSize:28,fontWeight:800,color:ok(iv)?mosColor:'#787a83',fontFamily:'Geist Mono,monospace',lineHeight:1}}>
              {ok(iv)?fmt.price(iv):'—'}
            </div>
            {ok(mos)&&<div style={{marginTop:6,fontSize:12,fontWeight:700,color:mosColor}}>{mos>0?`+${(mos*100).toFixed(1)}% upside`:`${(mos*100).toFixed(1)}% overvalued`}</div>}
            {ok(currentPrice)&&<div style={{fontSize:10,color:'#787a83',marginTop:3}}>vs. current {fmt.price(currentPrice)}</div>}
          </div>
          <div>
            <div style={{fontSize:9,color:'#33353f',marginBottom:4}}>Sensitivity: Discount Rate (rows) × Terminal Growth (cols)</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:9}}>
              <thead>
                <tr>
                  <th style={{color:'#33353f',padding:'2px 4px',textAlign:'center'}}>WACC\TG</th>
                  {[inputs.terminalGrowth-1,inputs.terminalGrowth,inputs.terminalGrowth+1].map(tg=>(
                    <th key={tg} style={{color:'#787a83',padding:'2px 4px',textAlign:'center'}}>{tg}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[-2,-1,0,1,2].map((dr,ri)=>(
                  <tr key={dr}>
                    <td style={{color:'#787a83',padding:'2px 4px',textAlign:'center',fontFamily:'Geist Mono,monospace'}}>{inputs.discountRate+dr}%</td>
                    {sensRows[ri].map((v,ci)=>{
                      const mos2=(ok(v)&&ok(currentPrice)&&currentPrice>0)?(v-currentPrice)/v:null;
                      const c=!ok(v)?'#33353f':mos2>0.15?'#5ac576':mos2>-0.15?'#eca851':'#eb6459';
                      return (
                        <td key={ci} style={{color:c,padding:'3px 4px',textAlign:'center',fontFamily:'Geist Mono,monospace',fontWeight:dr===0&&ci===1?800:400,background:dr===0&&ci===1?'#1c1d26':'transparent',borderRadius:3}}>
                          {ok(v)?`$${v.toFixed(0)}`:'—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── EV/EBITDA HISTORY ──────────────────────────────────────
function EVEBITDAHistory({stmts, balanceSheets, history, shares}) {
  const series = useMemo(()=>{
    if(!Array.isArray(stmts)||stmts.length<4||!ok(shares)||shares<=0) return null;
    const inc=stmts;  // FMP devuelve trimestres mas recientes primero
    const bsByDate={};
    (balanceSheets||[]).forEach(b=>{
      if(b?.date) bsByDate[b.date.substring(0,10)]=b;
      if(b?.period&&b?.calendarYear) bsByDate[`${b.period}-${b.calendarYear}`]=b;
    });
    const hist=[...(history||[])].filter(h=>ok(h.close)).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const priceAt=(dateStr)=>{
      if(!hist.length||!dateStr) return null;
      const t=new Date(dateStr).getTime();
      let chosen=null;
      for(const h of hist){ if(new Date(h.date).getTime()<=t) chosen=h.close; else break; }
      return chosen ?? hist[0].close;
    };
    const ebitdaOf=(q)=>{
      if(ok(q?.ebitda)) return q.ebitda;
      if(ok(q?.operatingIncome)&&ok(q?.depreciationAndAmortization)) return q.operatingIncome+q.depreciationAndAmortization;
      return null;
    };
    const out=[];
    for(let i=0;i+3<inc.length;i++){
      const q=inc[i];
      let ttm=0, allOk=true;
      for(let j=i;j<=i+3;j++){ const e=ebitdaOf(inc[j]); if(!ok(e)){ allOk=false; break; } ttm+=e; }
      if(!allOk||ttm<=0) continue;
      const price=priceAt(q.date);
      if(!ok(price)||price<=0) continue;
      const bs=bsByDate[q.date?.substring(0,10)]||bsByDate[`${q.period}-${q.calendarYear}`]||balanceSheets?.[0]||null;
      const totalDebt=ok(bs?.totalDebt)?bs.totalDebt:0;
      const cashRaw=bs?.cashAndCashEquivalents ?? bs?.cashAndShortTermInvestments;
      const cash=ok(cashRaw)?cashRaw:0;
      const ev=price*shares+totalDebt-cash;
      const ratio=ev/ttm;
      if(!ok(ratio)||ratio<=0||ratio>200) continue;
      out.push({date:q.date, label:`${q.period||''} ${q.calendarYear||(q.date?.substring(0,4))||''}`.trim(), ratio});
    }
    return out.reverse();  // cronologico ascendente
  },[stmts,balanceSheets,history,shares]);

  if(!series||series.length<3) return (
    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
      <SectionTitle>EV/EBITDA — Histórico</SectionTitle>
      <div style={{fontSize:11,color:'#787a83',padding:'6px 0'}}>Histórico no disponible (faltan datos de balance o EBITDA).</div>
    </div>
  );

  const vals=series.map(s=>s.ratio);
  const sv=[...vals].sort((a,b)=>a-b);
  const median=sv.length%2 ? sv[(sv.length-1)/2] : (sv[sv.length/2-1]+sv[sv.length/2])/2;
  const current=vals[vals.length-1];
  const minV=Math.min(...vals,median), maxV=Math.max(...vals,median), rng=maxV-minV||1;
  const W=800,H=170,pt=14,pb=22,pl=14,pr=46;
  const cw=W-pl-pr, ch=H-pt-pb;
  const px=i=>pl+(i/Math.max(1,vals.length-1))*cw;
  const py=v=>pt+(1-(v-minV)/rng)*ch;
  const linePts=vals.map((v,i)=>`${px(i)},${py(v)}`).join(' ');
  const medY=py(median);
  const curColor=current>median*1.1?'#eb6459':current<median*0.9?'#5ac576':'#eca851';

  return (
    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
      <SectionTitle>EV/EBITDA — Histórico ({series.length}Q)</SectionTitle>
      <div style={{display:'flex',gap:18,marginBottom:10,flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px'}}>Actual</div>
          <div style={{fontSize:20,fontWeight:800,color:curColor,fontFamily:'Geist Mono,monospace',lineHeight:1.1}}>{current.toFixed(1)}x</div>
        </div>
        <div>
          <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px'}}>Mediana</div>
          <div style={{fontSize:20,fontWeight:800,color:'#a6a7b1',fontFamily:'Geist Mono,monospace',lineHeight:1.1}}>{median.toFixed(1)}x</div>
        </div>
        <div style={{alignSelf:'flex-end',fontSize:10,color:current>median?'#eb6459':'#5ac576'}}>
          {current>median?'▲ prima':'▼ descuento'} {Math.abs((current/median-1)*100).toFixed(0)}% vs mediana
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{width:'100%',height:150,display:'block'}}>
        {[0.25,0.5,0.75].map(f=>(
          <line key={f} x1={pl} x2={W-pr} y1={pt+f*ch} y2={pt+f*ch} stroke="#1c1d26" strokeWidth="1"/>
        ))}
        <line x1={pl} x2={W-pr} y1={medY} y2={medY} stroke="#a6a7b1" strokeWidth="0.9" strokeDasharray="5 4"/>
        <text x={W-pr+3} y={medY+3} fontSize="8.5" fill="#a6a7b1">med {median.toFixed(1)}x</text>
        <polyline points={linePts} fill="none" stroke="#968ff7" strokeWidth="1.8" strokeLinejoin="round"/>
        <circle cx={px(vals.length-1)} cy={py(current)} r="3.5" fill={curColor} stroke="#15151c" strokeWidth="1.5"/>
        <text x={pl+2} y={pt+8} fontSize="8" fill="#33353f">{maxV.toFixed(0)}x</text>
        <text x={pl+2} y={H-pb+8} fontSize="8" fill="#33353f">{minV.toFixed(0)}x</text>
        {series.filter((_,i)=>i%Math.ceil(series.length/6)===0).map((s,k)=>{
          const idx=series.indexOf(s);
          return <text key={k} x={px(idx)} y={H-6} fontSize="7.5" fill="#33353f" textAnchor="middle">{s.label}</text>;
        })}
      </svg>
      <div style={{fontSize:9,color:'#33353f',marginTop:6}}>EV ≈ precio·acciones + deuda total − caja · EBITDA TTM (4Q) · EV aproximado con acciones actuales.</div>
    </div>
  );
}

// ─── MULTI-MODEL VALUATION ───────────────────────────────────
function MultiModelValuation({met,rat,quote,prof,stmts,currentPrice}) {
  if (!met||!rat||!currentPrice) return null;
  const eps=stmts?.[0]?.eps;
  const bvps=met?.bookValuePerShareTTM??null;
  const graham=(ok(eps)&&eps>0&&ok(bvps)&&bvps>0)?Math.sqrt(22.5*eps*bvps):null;
  const sector=prof?.sector;
  const sectorPE=SECTOR_BM[sector]?.pe;
  const relPE=(ok(sectorPE)&&ok(eps)&&eps>0)?sectorPE*eps*4:null;
  const fcfYield=met?.freeCashFlowYieldTTM;
  const fcfFair=(ok(fcfYield)&&fcfYield>0)?currentPrice/fcfYield*0.035:null;

  const models=[
    {name:'Graham Number',value:graham,note:'√(22.5 × EPS × BVPS)'},
    {name:'Relative P/E',value:relPE,note:`Sector avg P/E (${sectorPE}x) × EPS`},
    {name:'P/FCF Fair Value',value:fcfFair,note:'3.5% FCF yield target'},
  ].filter(m=>ok(m.value)&&m.value>0);

  if(!models.length) return null;
  const avg=models.reduce((s,m)=>s+m.value,0)/models.length;
  const avgMos=(avg-currentPrice)/avg;
  const avgColor=avgMos>0.15?'#5ac576':avgMos>-0.15?'#eca851':'#eb6459';

  return (
    <div>
      <SectionTitle>Valuation Models Summary</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${models.length},1fr) 1fr`,gap:10}}>
        {models.map((m,i)=>{
          const mos=(m.value-currentPrice)/m.value;
          const c=mos>0.15?'#5ac576':mos>-0.15?'#eca851':'#eb6459';
          return (
            <div key={i} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#787a83',marginBottom:4}}>{m.name}</div>
              <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:'Geist Mono,monospace',lineHeight:1}}>{fmt.price(m.value)}</div>
              <div style={{fontSize:10,color:c,marginTop:3}}>{mos>0?`+${(mos*100).toFixed(1)}% upside`:`${(mos*100).toFixed(1)}% overvalued`}</div>
              <div style={{fontSize:9,color:'#33353f',marginTop:4}}>{m.note}</div>
            </div>
          );
        })}
        <div style={{background:'#15151c',border:`2px solid ${avgColor}44`,borderRadius:8,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'#787a83',marginBottom:4}}>Model Average ({models.length} models)</div>
          <div style={{fontSize:20,fontWeight:800,color:avgColor,fontFamily:'Geist Mono,monospace',lineHeight:1}}>{fmt.price(avg)}</div>
          <div style={{fontSize:10,color:avgColor,marginTop:3}}>{avgMos>0?`+${(avgMos*100).toFixed(1)}% upside`:`${(avgMos*100).toFixed(1)}% overvalued`}</div>
          <div style={{fontSize:9,color:'#33353f',marginTop:4}}>avg of {models.length} methods</div>
        </div>
      </div>
    </div>
  );
}

// ─── HEALTH SCORE PANEL ──────────────────────────────────────
function HealthScorePanel({met,rat,hist,stmts,scores}) {
  if (!met&&!rat) return null;
  const pe=met?.peRatioTTM??met?.priceToEarningsRatioTTM;
  const gm=rat?.grossProfitMarginTTM;
  const roic=met?.returnOnInvestedCapitalTTM??met?.roicTTM;
  const fcfY=met?.freeCashFlowYieldTTM;
  const fvr=rat?.priceToFairValueTTM??rat?.priceFairValueTTM;

  const dims=[
    {name:'Growth',icon:'📈',score:(()=>{const s=scores.growth;return s>=16?5:s>=12?4:s>=8?3:s>=4?2:1;})(),note:'Revenue & EPS growth trend'},
    {name:'Profitability',icon:'💰',score:(()=>{let pts=0;if(ok(gm))pts+=gm>=0.50?2:gm>=0.25?1:0;if(ok(roic))pts+=roic>=0.20?3:roic>=0.12?2:roic>=0.05?1:0;return Math.min(5,pts);})(),note:'Gross margin & ROIC quality'},
    {name:'Momentum',icon:'⚡',score:(()=>{const s=scores.mom;return s>=20?5:s>=15?4:s>=10?3:s>=5?2:1;})(),note:'Price performance vs history'},
    {name:'Rel. Value',icon:'⚖️',score:(()=>{let pts=0;if(ok(pe)&&pe>0)pts+=pe<15?2:pe<25?1:0;if(ok(fvr))pts+=fvr<0.9?2:fvr<1.1?1:0;if(ok(fcfY))pts+=fcfY>0.05?1:0;return Math.min(5,Math.max(1,pts+1));})(),note:'P/E, fair value, FCF yield'},
    {name:'Fin. Health',icon:'🏦',score:(()=>{const s=scores.hlth;return s>=24?5:s>=18?4:s>=12?3:s>=6?2:1;})(),note:'Leverage, coverage, balance sheet'},
  ];
  const overall=dims.reduce((a,d)=>a+d.score,0)/dims.length;
  const overallColor=overall>=4?'#5ac576':overall>=3?'#eca851':'#eb6459';

  return (
    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:700,color:'#787a83',textTransform:'uppercase',letterSpacing:'1px'}}>Financial Health Score</div>
        <div style={{fontSize:22,fontWeight:800,color:overallColor,fontFamily:'Geist Mono,monospace'}}>{overall.toFixed(1)}<span style={{fontSize:12,color:'#787a83'}}>/5</span></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
        {dims.map((d,i)=>{
          const c=d.score>=4?'#5ac576':d.score>=3?'#eca851':'#eb6459';
          return (
            <div key={i} style={{textAlign:'center'}}>
              <div style={{fontSize:18,marginBottom:4}}>{d.icon}</div>
              <div style={{fontSize:10,color:'#787a83',marginBottom:6}}>{d.name}</div>
              <div style={{display:'flex',gap:2,justifyContent:'center',marginBottom:4}}>
                {[1,2,3,4,5].map(n=>(
                  <div key={n} style={{width:8,height:8,borderRadius:2,background:n<=d.score?c:'#24262f',transition:'background 0.3s'}}/>
                ))}
              </div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{d.score}/5</div>
              <div style={{fontSize:9,color:'#33353f',marginTop:2,lineHeight:1.3}}>{d.note}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ABOUT TEXT (collapsible) ────────────────────────────────
// ─── PEER COMPARISON ────────────────────────────────────────
function PeerComparison({peers, peerMetrics, currentMet, currentRat, currentProf, onAnalyze}) {
  if (!peers || peers.length === 0) return null;
  const allSymbols = [currentProf?.symbol, ...peers].filter(Boolean);
  const mName = s => s === currentProf?.symbol ? (currentProf?.companyName||s) : (peerMetrics[s]?.name || s);
  const getM  = s => s === currentProf?.symbol ? currentMet  : peerMetrics[s]?.met;
  const getR  = s => s === currentProf?.symbol ? currentRat  : peerMetrics[s]?.rat;

  const cols = [
    { label:'Ticker',       fn:(s)=>s },
    { label:'P/E',          fn:(s)=>{ const v=getM(s)?.priceToEarningsRatioTTM??getM(s)?.peRatioTTM; return ok(v)&&v>0?v.toFixed(1)+'x':'—'; }},
    { label:'EV/EBITDA',    fn:(s)=>{ const v=getM(s)?.evToEBITDATTM; return ok(v)&&v>0?v.toFixed(1)+'x':'—'; }},
    { label:'Gross Margin', fn:(s)=>{ const v=getR(s)?.grossProfitMarginTTM; return ok(v)?fmt.pct(v):'—'; }},
    { label:'ROIC',         fn:(s)=>{ const v=getM(s)?.returnOnInvestedCapitalTTM??getM(s)?.roicTTM; return ok(v)?fmt.pct(v):'—'; }},
    { label:'Net Debt/EBITDA', fn:(s)=>{ const v=getM(s)?.netDebtToEBITDATTM; return ok(v)?fmt.ndx(v):'—'; }},
    { label:'Mkt Cap',      fn:(s)=>{ const v=getM(s)?.marketCapTTM??getR(s)?.marketCapTTM; return ok(v)?fmt.usd(v):'—'; }},
  ];

  const colorVal = (col, s) => {
    if (col.label === 'Ticker') return s === currentProf?.symbol ? '#968ff7' : '#edeef4';
    const raw = col.label==='P/E'?(getM(s)?.priceToEarningsRatioTTM??getM(s)?.peRatioTTM)
              : col.label==='EV/EBITDA'?getM(s)?.evToEBITDATTM
              : col.label==='Gross Margin'?getR(s)?.grossProfitMarginTTM
              : col.label==='ROIC'?(getM(s)?.returnOnInvestedCapitalTTM??getM(s)?.roicTTM)
              : col.label==='Net Debt/EBITDA'?getM(s)?.netDebtToEBITDATTM
              : null;
    if (!ok(raw)) return '#787a83';
    if (col.label==='Gross Margin') return raw>=0.4?'#5ac576':raw>=0.2?'#eca851':'#eb6459';
    if (col.label==='ROIC')         return raw>=0.15?'#5ac576':raw>=0.06?'#eca851':'#eb6459';
    if (col.label==='Net Debt/EBITDA') return raw<0.5?'#5ac576':raw<2.5?'#eca851':'#eb6459';
    return '#edeef4';
  };

  return (
    <div>
      <SectionTitle>Peer Comparison</SectionTitle>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
          <thead>
            <tr>
              {cols.map(c=>(
                <th key={c.label} style={{padding:'6px 10px',textAlign:c.label==='Ticker'?'left':'right',
                  color:'#33353f',fontSize:9,fontWeight:700,textTransform:'uppercase',
                  letterSpacing:'0.8px',borderBottom:'1px solid #24262f',whiteSpace:'nowrap'
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSymbols.map((s,ri)=>{
              const isMain = s === currentProf?.symbol;
              return (
                <tr key={s} style={{
                  borderBottom:'1px solid #1c1d26',
                  background: isMain ? '#24262f' : (ri%2===0?'transparent':'#15151c')
                }}>
                  {cols.map(col=>(
                    <td key={col.label} style={{
                      padding:'8px 10px',
                      textAlign:col.label==='Ticker'?'left':'right',
                      fontFamily:'Geist Mono,monospace',
                      color: colorVal(col, s),
                      fontWeight: isMain ? 700 : 400,
                      cursor: col.label==='Ticker'&&!isMain ? 'pointer' : 'default',
                      fontSize: col.label==='Ticker' ? 11 : 10,
                    }}
                    onClick={col.label==='Ticker'&&!isMain ? ()=>onAnalyze(s) : undefined}
                    title={col.label==='Ticker'&&!isMain ? `Analyze ${s}` : mName(s)}
                    >
                      {col.label==='Ticker' ? (
                        <span>
                          {s}
                          {isMain && <span style={{fontSize:8,color:'#968ff7',marginLeft:4,fontWeight:700}}>(current)</span>}
                        </span>
                      ) : col.fn(s)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {peers.some(s=>!peerMetrics[s]) && (
        <div style={{fontSize:9,color:'#33353f',marginTop:6}}>Loading peer metrics…</div>
      )}
    </div>
  );
}

// ─── BALANCE SHEET SNAPSHOT ──────────────────────────────────
function BalanceSheetPanel({bsData}) {
  if (!bsData || bsData.length === 0) return null;
  const sorted = [...bsData].sort((a,b)=>new Date(b.date)-new Date(a.date));
  const bs = sorted[0];
  if (!bs) return null;

  const cash    = bs.cashAndCashEquivalents ?? bs.cashAndShortTermInvestments;
  const totalDebt = bs.totalDebt;
  const equity  = bs.totalStockholdersEquity;
  const totalA  = bs.totalAssets;
  const intangibles = bs.goodwillAndIntangibleAssets ?? ((bs.goodwill||0)+(bs.intangibleAssets||0));
  const netDebt = ok(totalDebt)&&ok(cash) ? totalDebt-cash : null;
  const currentA = bs.totalCurrentAssets;
  const currentL = bs.totalCurrentLiabilities;
  const currentR = (ok(currentA)&&ok(currentL)&&currentL>0) ? currentA/currentL : null;

  const rows = [
    {label:'Cash & Equivalents', value:fmt.usd(cash),   note:'liquidity cushion', color:ok(cash)&&cash>0?'#5ac576':'#eb6459'},
    {label:'Total Debt',         value:fmt.usd(totalDebt), note:'short + long term', color:ok(totalDebt)&&totalDebt<cash?'#5ac576':'#eca851'},
    {label:'Net Debt',           value:ok(netDebt)?(netDebt<0?`${fmt.usd(-netDebt)} net cash`:fmt.usd(netDebt)):'—', note:ok(netDebt)&&netDebt<0?'net cash position':'debt in excess of cash', color:ok(netDebt)?(netDebt<0?'#5ac576':netDebt<1e9?'#eca851':'#eb6459'):'#787a83'},
    {label:"Shareholders' Equity", value:fmt.usd(equity), note:'book value', color:'#a6a7b1'},
    {label:'Total Assets',       value:fmt.usd(totalA),  note:'as of last period', color:'#a6a7b1'},
    {label:'Current Ratio',      value:ok(currentR)?currentR.toFixed(2)+'x':'—', note:'current assets / liabilities', color:ok(currentR)?(currentR>=2?'#5ac576':currentR>=1?'#eca851':'#eb6459'):'#787a83'},
    {label:'Intangibles / Assets', value:(ok(intangibles)&&ok(totalA)&&totalA>0)?fmt.pct(intangibles/totalA):'—', note:'goodwill + intangibles share', color:'#a6a7b1'},
  ];

  // Debt trend over 4 periods
  const debtTrend = sorted.slice(0,4).map(q=>({
    label:`${q.period||''} ${q.calendarYear||q.date?.substring(0,4)||''}`.trim(),
    totalDebt: q.totalDebt,
    cash: q.cashAndCashEquivalents ?? q.cashAndShortTermInvestments,
  }));

  return (
    <div>
      <SectionTitle>Balance Sheet Snapshot</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:16}}>
        {rows.map(r=>(
          <div key={r.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:14,fontWeight:700,fontFamily:'Geist Mono,monospace',color:r.color||'#edeef4'}}>{r.value}</div>
            <div style={{fontSize:9,color:'#33353f',marginTop:2}}>{r.note}</div>
          </div>
        ))}
      </div>
      {debtTrend.length >= 2 && (
        <div>
          <div style={{fontSize:10,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Debt vs Cash — last {debtTrend.length} periods</div>
          <div style={{display:'flex',gap:6}}>
            {debtTrend.map((p,i)=>{
              const maxVal = Math.max(...debtTrend.map(x=>Math.max(x.totalDebt||0,x.cash||0)),1);
              const dPct  = ok(p.totalDebt) ? Math.round(p.totalDebt/maxVal*100) : 0;
              const cPct  = ok(p.cash)      ? Math.round(p.cash/maxVal*100)      : 0;
              return (
                <div key={i} style={{flex:1,textAlign:'center'}}>
                  <div style={{display:'flex',gap:2,height:48,alignItems:'flex-end',justifyContent:'center',marginBottom:4}}>
                    <div style={{width:12,background:'#eb6459',borderRadius:'2px 2px 0 0',height:`${dPct}%`,minHeight:2,title:'Debt'}}/>
                    <div style={{width:12,background:'#5ac576',borderRadius:'2px 2px 0 0',height:`${cPct}%`,minHeight:2,title:'Cash'}}/>
                  </div>
                  <div style={{fontSize:8,color:'#787a83',lineHeight:1.3}}>{p.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:12,marginTop:6}}>
            <span style={{fontSize:8,color:'#eb6459'}}>■ Total Debt</span>
            <span style={{fontSize:8,color:'#5ac576'}}>■ Cash</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── FREE CASH FLOW DETAIL ───────────────────────────────────
function FCFPanel({cfData, incomeData}) {
  if (!cfData || cfData.length === 0) return null;
  const sorted = [...cfData].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
  if (sorted.length < 2) return null;

  const enriched = sorted.map((q,i)=>{
    const ocf   = q.operatingCashFlow;
    const capex = q.capitalExpenditure ?? q.capitalExpenditures;
    const fcf   = (ok(ocf)&&ok(capex)) ? ocf - Math.abs(capex) : (ok(ocf)?ocf:null);
    const rev   = incomeData?.find(s=>s.period===q.period&&s.calendarYear===q.calendarYear)?.revenue;
    const ni    = incomeData?.find(s=>s.period===q.period&&s.calendarYear===q.calendarYear)?.netIncome;
    const fcfM  = (ok(fcf)&&ok(rev)&&rev>0) ? fcf/rev : null;
    const fcfConv = (ok(fcf)&&ok(ni)&&ni>0) ? fcf/ni : null;
    return { label:`${q.period} ${q.calendarYear}`, ocf, capex: ok(capex)?Math.abs(capex):null, fcf, fcfM, fcfConv };
  }).reverse();

  const recent4 = enriched.slice(-4);
  const ttmFCF  = recent4.reduce((s,q)=>ok(q.fcf)?s+q.fcf:s, 0);
  const ttmRev  = (() => {
    const last4Rev = incomeData?.slice(0,4)?.reduce((s,q)=>ok(q.revenue)?s+q.revenue:s, 0);
    return last4Rev || 0;
  })();
  const ttmFCFM = (ttmFCF && ttmRev>0) ? ttmFCF/ttmRev : null;

  const maxFCF  = Math.max(...enriched.map(q=>Math.abs(q.fcf||0)),1);

  return (
    <div>
      <SectionTitle>Free Cash Flow — Quarterly</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
        {[
          {label:'TTM FCF',       value:fmt.usd(ttmFCF),       color:ttmFCF>0?'#5ac576':'#eb6459'},
          {label:'TTM FCF Margin',value:fmt.pct(ttmFCFM),      color:ok(ttmFCFM)?(ttmFCFM>=0.15?'#5ac576':ttmFCFM>=0.05?'#eca851':'#eb6459'):'#787a83'},
          {label:'FCF Conversion', value:ok(recent4[recent4.length-1]?.fcfConv)?recent4[recent4.length-1].fcfConv.toFixed(2)+'x':'—', color:'#a6a7b1'},
        ].map(r=>(
          <div key={r.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:16,fontWeight:700,fontFamily:'Geist Mono,monospace',color:r.color}}>{r.value}</div>
          </div>
        ))}
      </div>
      {/* Bar chart */}
      <div style={{display:'flex',gap:4,alignItems:'flex-end',height:70,marginBottom:4}}>
        {enriched.map((q,i)=>{
          const h = ok(q.fcf) ? Math.round((Math.abs(q.fcf)/maxFCF)*60) : 0;
          const isPos = (q.fcf||0) >= 0;
          return (
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{fontSize:8,color:'#787a83',fontFamily:'Geist Mono,monospace'}}>{fmt.usd(q.fcf)}</div>
              <div style={{
                width:'100%',height:h+4,minHeight:4,
                background: isPos ? '#5ac576' : '#eb6459',
                borderRadius:'2px 2px 0 0',opacity:0.85
              }}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:0}}>
        {enriched.map((q,i)=>(
          <div key={i} style={{flex:1,textAlign:'center',fontSize:8,color:'#33353f'}}>{q.label.split(' ')[0]}<br/>{q.label.split(' ')[1]}</div>
        ))}
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:10,marginTop:12}}>
        <thead>
          <tr>
            {['Period','Op. Cash Flow','CapEx','FCF','FCF Margin','FCF Conv.'].map(h=>(
              <th key={h} style={{padding:'5px 8px',textAlign:h==='Period'?'left':'right',color:'#33353f',fontSize:8,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.7px',borderBottom:'1px solid #24262f'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {enriched.slice().reverse().slice(0,6).map((q,i)=>(
            <tr key={i} style={{borderBottom:'1px solid #15151c'}}>
              <td style={{padding:'6px 8px',color:'#787a83',fontFamily:'Geist Mono,monospace',fontSize:9}}>{q.label}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Geist Mono,monospace',color:'#a6a7b1'}}>{fmt.usd(q.ocf)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Geist Mono,monospace',color:'#eb6459'}}>{ok(q.capex)?`(${fmt.usd(q.capex)})`:'—'}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Geist Mono,monospace',color:ok(q.fcf)?(q.fcf>=0?'#5ac576':'#eb6459'):'#787a83',fontWeight:700}}>{fmt.usd(q.fcf)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Geist Mono,monospace',color:'#a6a7b1'}}>{fmt.pct(q.fcfM)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'Geist Mono,monospace',color:'#a6a7b1'}}>{ok(q.fcfConv)?q.fcfConv.toFixed(2)+'x':'—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── DIVIDENDS SECTION ───────────────────────────────────────
function DividendsPanel({divData, met, currentPrice}) {
  if (!divData || divData.length === 0) return null;
  const sorted = [...divData].sort((a,b)=>new Date(b.date)-new Date(a.date));
  // Only show section if company actually pays a dividend
  const recentDiv = sorted[0]?.dividend || sorted[0]?.adjDividend;
  if (!ok(recentDiv) || recentDiv <= 0) return null;

  const divYield = met?.dividendYieldTTM;
  const payoutR  = met?.payoutRatioTTM ?? met?.dividendPayoutRatioTTM;

  // Annual dividend totals
  const byYear = {};
  sorted.forEach(d=>{
    const yr = (d.date||'').substring(0,4);
    if (!yr) return;
    byYear[yr] = (byYear[yr]||0) + (d.dividend||d.adjDividend||0);
  });
  const years = Object.keys(byYear).sort().slice(-6);
  const annualVals = years.map(y=>byYear[y]);
  const maxAnnual = Math.max(...annualVals, 0.01);

  // Consecutive years of payment
  const distinctYears = Object.keys(byYear).filter(y=>byYear[y]>0).sort();
  let consec = 0;
  for (let i=distinctYears.length-1;i>0;i--) {
    if (parseInt(distinctYears[i])-parseInt(distinctYears[i-1])===1) consec++;
    else break;
  }
  consec += 1;

  // Dividend CAGR
  const divCAGR = years.length>=2 && annualVals[0]>0 && annualVals[annualVals.length-1]>0
    ? Math.pow(annualVals[annualVals.length-1]/annualVals[0], 1/(years.length-1)) - 1
    : null;

  return (
    <div>
      <SectionTitle>Dividends</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:14}}>
        {[
          {label:'Dividend Yield',     value:fmt.pct(divYield),   color:ok(divYield)&&divYield>0?'#5ac576':'#787a83'},
          {label:'Payout Ratio',       value:fmt.pct(payoutR),    color:ok(payoutR)?(payoutR<0.6?'#5ac576':payoutR<0.9?'#eca851':'#eb6459'):'#787a83'},
          {label:'Consec. Years Paid', value:consec>0?`${consec} yrs`:'—', color:consec>=10?'#5ac576':consec>=5?'#eca851':'#a6a7b1'},
          {label:'Div. CAGR',          value:fmt.pct(divCAGR),    color:ok(divCAGR)&&divCAGR>0?'#5ac576':'#eb6459'},
        ].map(r=>(
          <div key={r.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:15,fontWeight:700,fontFamily:'Geist Mono,monospace',color:r.color}}>{r.value}</div>
          </div>
        ))}
      </div>
      {/* Annual dividends bar chart */}
      {years.length >= 2 && (
        <>
          <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Annual Dividends per Share</div>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',height:60}}>
            {years.map((yr,i)=>{
              const h = Math.round((annualVals[i]/maxAnnual)*48);
              return (
                <div key={yr} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                  <div style={{fontSize:8,color:'#a6a7b1',fontFamily:'Geist Mono,monospace'}}>${annualVals[i].toFixed(2)}</div>
                  <div style={{width:'70%',height:h+4,minHeight:4,background:'#968ff7',borderRadius:'2px 2px 0 0',opacity:0.8}}/>
                  <div style={{fontSize:8,color:'#787a83'}}>{yr}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* Recent dividend history */}
      <div style={{marginTop:12}}>
        <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Recent Payments</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {sorted.slice(0,8).map((d,i)=>(
            <div key={i} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:4,padding:'5px 10px',textAlign:'center'}}>
              <div style={{fontSize:9,color:'#787a83'}}>{d.date?.substring(0,10)}</div>
              <div style={{fontSize:12,fontWeight:700,color:'#5ac576',fontFamily:'Geist Mono,monospace'}}>${(d.dividend||d.adjDividend||0).toFixed(3)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DILUTION / SHARE COUNT SECTION ──────────────────────────
function DilutionPanel({stmts, cfData}) {
  if (!stmts || stmts.length < 2) return null;

  // Diluted shares outstanding per quarter (oldest → newest)
  const series = [...stmts]
    .filter(s => ok(s.weightedAverageShsOutDil) && s.weightedAverageShsOutDil > 0)
    .sort((a,b)=>new Date(a.date)-new Date(b.date))
    .map(s => ({ label:`${s.period} ${s.calendarYear}`, shares:s.weightedAverageShsOutDil, eps:s.eps }));
  if (series.length < 2) return null;

  const latest   = series[series.length-1];
  const first    = series[0];
  const yoyRef   = series.length > 4 ? series[series.length-1-4] : first;  // ~4 quarters back
  const yoyDelta = ok(yoyRef?.shares) && yoyRef.shares>0 ? (latest.shares - yoyRef.shares)/yoyRef.shares : null;
  const totDelta = first.shares>0 ? (latest.shares-first.shares)/first.shares : null;

  // Buybacks vs issuance — TTM (last 4 quarters of cash flow)
  const cfSorted   = (cfData||[]).filter(Boolean).sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,4);
  const ttmRepurch = cfSorted.reduce((s,q)=>s+Math.abs(q.commonStockRepurchased||0),0);
  const ttmIssued  = cfSorted.reduce((s,q)=>s+Math.abs(q.commonStockIssued||0),0);
  const netBuyback = ttmRepurch - ttmIssued;  // >0 net buyback (good), <0 net issuance (dilutive)
  const hasCF      = cfSorted.length>0 && (ttmRepurch>0 || ttmIssued>0);

  // Trend classification on YoY share count
  const trend = yoyDelta==null ? 'flat' : (yoyDelta > 0.005 ? 'dilution' : yoyDelta < -0.005 ? 'buyback' : 'flat');
  const trendColor = trend==='buyback' ? '#5ac576' : trend==='dilution' ? '#eb6459' : '#eca851';
  const trendLabel = trend==='buyback' ? 'Recompra neta' : trend==='dilution' ? 'Dilución' : 'Estable';

  // Bar chart scaled within min..max so small % changes are visible
  const sharesArr = series.map(s=>s.shares);
  const minS = Math.min(...sharesArr), maxS = Math.max(...sharesArr);
  const range = (maxS - minS) || 1;
  const fmtShares = v => ok(v) ? (v>=1e9 ? (v/1e9).toFixed(2)+'B' : v>=1e6 ? (v/1e6).toFixed(1)+'M' : v.toFixed(0)) : '—';
  const view = series.slice(-12);

  return (
    <div>
      <SectionTitle>Dilución / Evolución de Acciones</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:14}}>
        {[
          {label:'Δ Shares YoY',  value:ok(yoyDelta)?(yoyDelta>=0?'+':'')+(yoyDelta*100).toFixed(2)+'%':'—', color:trendColor},
          {label:`Δ Shares (${series.length}T)`, value:ok(totDelta)?(totDelta>=0?'+':'')+(totDelta*100).toFixed(2)+'%':'—', color:ok(totDelta)?(totDelta<=0?'#5ac576':'#eb6459'):'#787a83'},
          {label:'Tendencia',     value:trendLabel, color:trendColor},
        ].map(r=>(
          <div key={r.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:15,fontWeight:700,fontFamily:'Geist Mono,monospace',color:r.color}}>{r.value}</div>
          </div>
        ))}
      </div>

      {/* Diluted share count bar chart */}
      <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Diluted Shares Outstanding</div>
      <div style={{display:'flex',gap:4,alignItems:'flex-end',height:70,marginBottom:4}}>
        {view.map((q,i)=>{
          const h = 18 + Math.round(((q.shares-minS)/range)*44);
          return (
            <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
              <div style={{fontSize:8,color:'#787a83',fontFamily:'Geist Mono,monospace'}}>{fmtShares(q.shares)}</div>
              <div style={{width:'100%',height:h,minHeight:4,background:trend==='buyback'?'#5ac576':trend==='dilution'?'#eb6459':'#968ff7',borderRadius:'2px 2px 0 0',opacity:0.82}}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:0,marginBottom:14}}>
        {view.map((q,i)=>(
          <div key={i} style={{flex:1,textAlign:'center',fontSize:8,color:'#33353f'}}>{q.label.split(' ')[0]}<br/>{q.label.split(' ')[1]}</div>
        ))}
      </div>

      {/* Buybacks vs issuance (TTM) */}
      {hasCF && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
          {[
            {label:'Buybacks (TTM)',  value:fmt.usd(ttmRepurch), color:ttmRepurch>0?'#5ac576':'#787a83'},
            {label:'Issuance (TTM)',  value:fmt.usd(ttmIssued),  color:ttmIssued>0?'#eb6459':'#787a83'},
            {label:'Neto (TTM)',      value:(netBuyback>=0?'+':'-')+fmt.usd(Math.abs(netBuyback)), color:netBuyback>=0?'#5ac576':'#eb6459'},
          ].map(r=>(
            <div key={r.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
              <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:'Geist Mono,monospace',color:r.color}}>{r.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{fontSize:10,color:'#787a83',lineHeight:1.6,background:'#15151c',border:'1px solid #24262f',borderRadius:6,padding:'8px 12px'}}>
        {trend==='buyback'
          ? '↓ El share count cae: las recompras concentran el EPS y benefician al accionista.'
          : trend==='dilution'
            ? '↑ El share count sube: la dilución reparte el beneficio entre más acciones y presiona el EPS.'
            : '→ Share count estable: impacto neutro sobre el EPS por dilución/recompra.'}
        {' '}Impacto EPS = inverso a la variación del número de acciones.
      </div>
    </div>
  );
}

// ─── SHORT INTEREST SECTION ──────────────────────────────────
function ShortInterestPanel({data, quote}) {
  const arr = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  const series = arr.map(d => ({
    date: d.settlementDate || d.date || d.recordDate || null,
    si:   d.shortInterest ?? d.interest ?? d.sharesShort ?? d.shares ?? null,
  })).filter(x => ok(x.si) && x.date)
     .sort((a,b)=>new Date(a.date)-new Date(b.date));

  if (series.length === 0) {
    return (
      <div>
        <SectionTitle>Short Interest</SectionTitle>
        <div style={{fontSize:11,color:'#787a83',background:'#15151c',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
          Short interest no disponible en el plan actual de datos.
        </div>
      </div>
    );
  }

  const latest = series[series.length-1];
  const prev   = series.length>1 ? series[series.length-2] : null;
  const deltaPct = prev && prev.si>0 ? (latest.si-prev.si)/prev.si : null;

  const shares   = quote?.sharesOutstanding;
  const pctOut   = ok(shares) && shares>0 ? latest.si/shares : null;   // % of shares outstanding (proxy for float)
  const avgVol   = quote?.averageVolume ?? quote?.avgVolume ?? quote?.volAvg;
  const daysCover= ok(avgVol) && avgVol>0 ? latest.si/avgVol : null;

  const fmtShares = v => ok(v) ? (v>=1e9 ? (v/1e9).toFixed(2)+'B' : v>=1e6 ? (v/1e6).toFixed(1)+'M' : v>=1e3 ? (v/1e3).toFixed(0)+'K' : v.toFixed(0)) : '—';
  const maxSI = Math.max(...series.map(s=>s.si),1);
  const view  = series.slice(-12);

  const cards = [
    {label:'Short Interest', value:fmtShares(latest.si), sub:latest.date, color:'#edeef4'},
    {label:'% Shares Out',   value:ok(pctOut)?(pctOut*100).toFixed(2)+'%':'—', sub:'aprox. float',
      color:ok(pctOut)?(pctOut>0.10?'#eb6459':pctOut>0.05?'#eca851':'#5ac576'):'#787a83'},
    {label:'Days to Cover',  value:ok(daysCover)?daysCover.toFixed(1):'—', sub:'SI / avg vol',
      color:ok(daysCover)?(daysCover>5?'#eb6459':daysCover>2?'#eca851':'#5ac576'):'#787a83'},
  ];

  return (
    <div>
      <SectionTitle>Short Interest</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:12}}>
        {cards.map(c=>(
          <div key={c.label} style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{c.label}</div>
            <div style={{fontSize:15,fontWeight:700,fontFamily:'Geist Mono,monospace',color:c.color}}>{c.value}</div>
            <div style={{fontSize:8,color:'#33353f',marginTop:2}}>{c.sub}</div>
          </div>
        ))}
      </div>
      {view.length>=2&&(
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
            <span style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px'}}>Tendencia (short interest)</span>
            {ok(deltaPct)&&<span style={{fontSize:10,fontFamily:'Geist Mono,monospace',color:deltaPct>0?'#eb6459':'#5ac576'}}>{deltaPct>=0?'▲':'▼'} {Math.abs(deltaPct*100).toFixed(1)}% vs anterior</span>}
          </div>
          <div style={{display:'flex',gap:3,alignItems:'flex-end',height:50}}>
            {view.map((q,i)=>{
              const h = 6 + Math.round((q.si/maxSI)*40);
              return <div key={i} title={`${q.date}: ${fmtShares(q.si)}`} style={{flex:1,height:h,minHeight:3,background:i===view.length-1?'#eca851':'#787a83',borderRadius:'2px 2px 0 0',opacity:0.85}}/>;
            })}
          </div>
        </>
      )}
      <div style={{fontSize:8,color:'#33353f',marginTop:6}}>% Shares Out usa acciones en circulación como aproximación al float. Fuente: Finnhub.</div>
    </div>
  );
}

function AboutText({text}) {
  const [expanded,setExpanded]=React.useState(false);
  const long=text&&text.length>400;
  const display=expanded||!long?text:text.substring(0,400)+'...';
  return (
    <div>
      <div style={{fontSize:12,color:'#a6a7b1',lineHeight:1.75}}>{display}</div>
      {long&&(
        <button onClick={()=>setExpanded(e=>!e)} style={{marginTop:6,background:'none',border:'none',color:'#968ff7',fontSize:11,cursor:'pointer',padding:0}}>
          {expanded?'▲ Show less':'▼ Read more'}
        </button>
      )}
    </div>
  );
}

// ─── CARTERA K MATRIX ────────────────────────────────────────
function CarteraKMatrix({ activeQuadrant, onSelect }) {
  const quads = [
    { id:'estanflacion', label:'Estanflación', sectors:['Oro','Energía'], x:80, y:50, color:'#eca851', fill:'#eca851' },
    { id:'inflacion', label:'Inflación', sectors:['Energía','Real estate'], x:240, y:50, color:'#54360b', fill:'#eca851' },
    { id:'defensivo', label:'Defensivo', sectors:['Salud','Utilities','C. básico','Renta fija'], x:80, y:200, color:'#5ac576', fill:'#5ac576' },
    { id:'crecimiento', label:'Crecimiento', sectors:['Tecnología'], x:240, y:200, color:'#eb6459', fill:'#eb6459' },
  ];
  const QW=140, QH=140, W=460, H=370;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,height:'auto'}}>
      <text x={W/2} y={25} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#edeef4">Cartera K — Macro Playbook</text>
      <text x={32} y={110} textAnchor="middle" fontSize={10} fill="#787a83">Infl. alta</text>
      <text x={32} y={270} textAnchor="middle" fontSize={10} fill="#787a83">Infl. baja</text>
      <text x={150} y={H-12} textAnchor="middle" fontSize={10} fill="#787a83">Crec. bajo</text>
      <text x={310} y={H-12} textAnchor="middle" fontSize={10} fill="#787a83">Crec. alto</text>
      {quads.map(q => {
        const active = q.id === activeQuadrant;
        return (
          <g key={q.id} style={{cursor: onSelect?'pointer':'default'}} onClick={() => onSelect && onSelect(q.id)}>
            <rect x={q.x} y={q.y} width={QW} height={QH} rx={8} fill={q.fill} stroke={q.color} strokeWidth={active?4:1.5} opacity={active?1:0.55}/>
            <text x={q.x+QW/2} y={q.y+32} textAnchor="middle" fontSize={14} fontWeight="bold" fill={q.color}>{q.label}</text>
            {q.sectors.map((s,i)=>(<text key={i} x={q.x+QW/2} y={q.y+56+i*16} textAnchor="middle" fontSize={11} fill={q.color}>{s}</text>))}
          </g>
        );
      })}
    </svg>
  );
}

// ─── INSIDER TRACKER ─────────────────────────────────────────
function InsiderTrackerPanel({ supabase }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase
        .from('smart_money_top_buyers')
        .select('rank,ticker,sector,net_insider_buying_usd,num_insiders,month')
        .order('month', { ascending: false })
        .order('rank', { ascending: true })
        .limit(20);
      setRows(data || []);
      setLoading(false);
    })();
  }, [supabase]);

  const month = rows[0]?.month?.slice(0, 7) ?? null;
  const fmt = (v) => v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : '$' + (v / 1e3).toFixed(0) + 'K';

  return (
    <div>
      <SectionTitle>Insider Tracker — Top Open-Market Buys{month ? ` (${month})` : ''}</SectionTitle>
      {loading
        ? <LoadingSkeleton/>
        : rows.length === 0
          ? (
            <div style={{color:'#787a83',padding:16,textAlign:'center'}}>
              Sin datos todavía — el cron corre cada lunes (FMP Form 4s).
            </div>
          )
          : (
            <table style={{width:'100%',fontSize:11,fontFamily:'Geist Mono,monospace'}}>
              <thead>
                <tr style={{color:'#787a83',textAlign:'left',borderBottom:'1px solid #24262f'}}>
                  <th style={{padding:'4px 6px'}}>#</th>
                  <th style={{padding:'4px 6px'}}>Ticker</th>
                  <th style={{padding:'4px 6px'}}>Net Buy</th>
                  <th style={{padding:'4px 6px'}}>Insiders</th>
                  <th style={{padding:'4px 6px'}}>Sector</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.rank} style={{borderBottom:'1px solid #15151c'}}>
                    <td style={{padding:'4px 6px',color:'#787a83'}}>{r.rank}</td>
                    <td style={{padding:'4px 6px',fontWeight:700,color:'#968ff7'}}>{r.ticker}</td>
                    <td style={{padding:'4px 6px',color:'#5ac576'}}>{r.net_insider_buying_usd ? fmt(r.net_insider_buying_usd) : '—'}</td>
                    <td style={{padding:'4px 6px',color:'#a6a7b1'}}>{r.num_insiders ?? '—'}</td>
                    <td style={{padding:'4px 6px',color:'#787a83',fontSize:10}}>{r.sector ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      }
    </div>
  );
}

// ─── 13F TRACKER PANELS ──────────────────────────────────────
function Funds13FPanel({ supabase }) {
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data: rows } = await supabase
        .from('smart_money_13f')
        .select('*')
        .order('filing_date', { ascending: false });
      const byFund = {};
      for (const r of rows || []) {
        if (!byFund[r.fund_name]) byFund[r.fund_name] = [];
        byFund[r.fund_name].push(r);
      }
      setData(byFund);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div>
      <SectionTitle>13F Tracker — Smart Money Funds</SectionTitle>
      {loading
        ? <LoadingSkeleton/>
        : Object.keys(data).length === 0
          ? <div style={{color:'#787a83',padding:16,textAlign:'center'}}>Sin datos 13F aún. El cron los puebla mensualmente (día 15).</div>
          : Object.entries(data).map(([fund, rows]) => (
            <div key={fund} style={{marginBottom:20,padding:12,background:'#1c1d26',borderRadius:8,border:'1px solid #24262f'}}>
              <h4 style={{color:'#edeef4',margin:'0 0 4px 0',fontSize:13}}>{fund}</h4>
              <div style={{fontSize:10,color:'#787a83',marginBottom:8}}>Last filing: {rows[0]?.filing_date}</div>
              <table style={{width:'100%',fontSize:11,fontFamily:'Geist Mono,monospace'}}>
                <thead>
                  <tr style={{color:'#787a83',textAlign:'left',borderBottom:'1px solid #24262f'}}>
                    <th style={{padding:'4px 6px'}}>Issuer</th>
                    <th style={{padding:'4px 6px'}}>Shares</th>
                    <th style={{padding:'4px 6px'}}>Value</th>
                    <th style={{padding:'4px 6px'}}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 10).map(r => (
                    <tr key={r.id} style={{borderBottom:'1px solid #15151c'}}>
                      <td style={{padding:'4px 6px',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.ticker}</td>
                      <td style={{padding:'4px 6px'}}>{r.shares_held ? (r.shares_held/1e3).toFixed(0)+'K' : '—'}</td>
                      <td style={{padding:'4px 6px'}}>{r.market_value_usd ? '$'+(r.market_value_usd/1e6).toFixed(1)+'M' : '—'}</td>
                      <td style={{padding:'4px 6px',color:'#a6a7b1'}}>{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
      }
    </div>
  );
}

function ConsensusPanel({ supabase }) {
  const [consensus, setConsensus] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase.from('smart_money_13f').select('ticker, fund_name');
      const counts = {};
      for (const r of data || []) {
        if (!counts[r.ticker]) counts[r.ticker] = new Set();
        counts[r.ticker].add(r.fund_name);
      }
      const arr = Object.entries(counts)
        .filter(([_, funds]) => funds.size >= 3)
        .map(([ticker, funds]) => ({ ticker, fund_count: funds.size, funds: [...funds] }))
        .sort((a, b) => b.fund_count - a.fund_count);
      setConsensus(arr);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div>
      <SectionTitle>Consensus — Held by ≥3 Smart Money Funds</SectionTitle>
      {loading
        ? <LoadingSkeleton/>
        : consensus.length === 0
          ? <div style={{color:'#787a83',padding:16,textAlign:'center'}}>Sin consenso todavía (necesita datos 13F de ≥3 fondos).</div>
          : (
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {consensus.map(c => (
                <div key={c.ticker} style={{padding:'8px 12px',background:'#1c1d26',borderRadius:6,border:'1px solid #24262f',display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontWeight:700,color:'#968ff7',fontFamily:'Geist Mono,monospace',minWidth:60}}>{c.ticker}</span>
                  <span style={{fontSize:11,color:'#a6a7b1'}}>{c.fund_count} fondos:</span>
                  <span style={{fontSize:11,color:'#787a83'}}>{c.funds.join(' · ')}</span>
                </div>
              ))}
            </div>
          )
      }
    </div>
  );
}

// ─── JENSEN PATTERN PANEL ────────────────────────────────────
const JENSEN_PATTERN = [
  { ticker: 'NBIS', name: 'Nebius',           mention_date: '2024-11-15', mention_price:   21, source: 'AI cloud partner spotlight' },
  { ticker: 'APLD', name: 'Applied Digital',  mention_date: '2024-03-10', mention_price:    3, source: 'Infrastructure partner reference' },
  { ticker: 'TSM',  name: 'TSMC',             mention_date: '2024-06-05', mention_price:  180, source: 'Critical to AI buildout' },
  { ticker: 'MU',   name: 'Micron',           mention_date: '2024-08-20', mention_price:   86, source: 'HBM memory supplier' },
  { ticker: 'NOW',  name: 'ServiceNow',       mention_date: '2026-04-12', mention_price:   90, source: 'Spotlighted as agentic AI leader' },
  { ticker: 'CRWV', name: 'CoreWeave',        mention_date: '2026-01-22', mention_price:  114, source: '$2B direct investment' },
  { ticker: 'IREN', name: 'IREN',             mention_date: '2026-05-15', mention_price:   60, source: '5GW partnership for DSX' },
  { ticker: 'ORCL', name: 'Oracle',           mention_date: '2026-03-01', mention_price:  145, source: 'Compute partnership' },
  { ticker: 'AVGO', name: 'Broadcom',         mention_date: '2026-02-10', mention_price: 1100, source: 'Custom ASIC partner' },
  { ticker: 'AMD',  name: 'AMD',              mention_date: '2026-04-08', mention_price:  165, source: 'MI300X co-positioning' },
  { ticker: 'ASML', name: 'ASML',             mention_date: '2026-01-30', mention_price:  720, source: 'EUV supply critical' },
  { ticker: 'SMH',  name: 'VanEck Semi ETF',  mention_date: '2026-05-10', mention_price:  320, source: 'Aschenbrenner 13F basket' },
];

function JensenPatternPanel({ fmpGet }) {
  const [enriched, setEnriched] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!fmpGet) { setLoading(false); return; }
      const results = await Promise.allSettled(
        JENSEN_PATTERN.map(async (j) => {
          const quote = await fmpGet('quote', { symbol: j.ticker }).catch(() => null);
          const currentPrice = Array.isArray(quote) ? quote[0]?.price : quote?.price;
          const returnPct = currentPrice != null ? ((currentPrice - j.mention_price) / j.mention_price) * 100 : null;
          return { ...j, currentPrice, returnPct };
        })
      );
      setEnriched(results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean));
      setLoading(false);
    })();
  }, [fmpGet]);

  return (
    <div>
      <SectionTitle>Jensen Pattern — Nvidia-Adjacent Companies</SectionTitle>
      <div style={{padding:10,background:'#54360b',border:'1px solid #eca851',borderRadius:6,marginBottom:14,fontSize:11,color:'#eca851',lineHeight:1.5}}>
        Empresas mencionadas en keynotes de Jensen Huang o en las que NVIDIA ha invertido directamente.
        Patrón histórico observado, no causalidad confirmada. Past performance does not predict future returns.
      </div>
      {loading
        ? <LoadingSkeleton/>
        : (
          <table style={{width:'100%',fontSize:11,fontFamily:'Geist Mono,monospace'}}>
            <thead>
              <tr style={{color:'#787a83',textAlign:'left',borderBottom:'1px solid #24262f'}}>
                <th style={{padding:'4px 6px'}}>Ticker</th>
                <th style={{padding:'4px 6px'}}>Name</th>
                <th style={{padding:'4px 6px'}}>Date</th>
                <th style={{padding:'4px 6px'}}>Entry $</th>
                <th style={{padding:'4px 6px'}}>Now $</th>
                <th style={{padding:'4px 6px'}}>Return</th>
                <th style={{padding:'4px 6px',fontSize:9}}>Source</th>
              </tr>
            </thead>
            <tbody>
              {enriched.sort((a,b) => (b.returnPct||0) - (a.returnPct||0)).map(j => (
                <tr key={j.ticker} style={{borderBottom:'1px solid #1c1d26'}}>
                  <td style={{padding:'4px 6px',fontWeight:700,color:'#968ff7'}}>{j.ticker}</td>
                  <td style={{padding:'4px 6px',color:'#a6a7b1'}}>{j.name}</td>
                  <td style={{padding:'4px 6px'}}>{j.mention_date}</td>
                  <td style={{padding:'4px 6px'}}>${j.mention_price.toLocaleString()}</td>
                  <td style={{padding:'4px 6px'}}>{j.currentPrice != null ? '$'+j.currentPrice.toFixed(0) : '—'}</td>
                  <td style={{padding:'4px 6px',fontWeight:700,color:(j.returnPct||0)>0?'#5ac576':'#eb6459'}}>
                    {j.returnPct != null ? (j.returnPct>0?'+':'')+j.returnPct.toFixed(0)+'%' : '—'}
                  </td>
                  <td style={{padding:'4px 6px',fontSize:9,color:'#787a83'}}>{j.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}

// ─── WATCHLIST MANAGER ───────────────────────────────────────
function WatchlistManager({ supabase, onAnalyze }) {
  const [items, setItems] = useState([]);
  const [newTicker, setNewTicker] = useState('');
  const [sortBy, setSortBy] = useState('score_total');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: wl } = await supabase.from('sl_watchlist').select('*').order('added_at');
    if (!wl) { setItems([]); setLoading(false); return; }
    const tickers = wl.map(w => w.ticker);
    let analyses = [];
    if (tickers.length) {
      const { data } = await supabase.from('sl_analyses').select('*').in('ticker', tickers).order('analysis_date', { ascending: false });
      analyses = data || [];
    }
    const latest = {};
    for (const a of analyses) if (!latest[a.ticker]) latest[a.ticker] = a;
    setItems(wl.map(w => ({ ...w, analysis: latest[w.ticker] || null })));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);
  const addTicker = async () => {
    const t = newTicker.trim().toUpperCase();
    if (!t) return;
    await supabase.from('sl_watchlist').insert({ ticker: t });
    setNewTicker(''); load();
  };
  const removeTicker = async (id) => { await supabase.from('sl_watchlist').delete().eq('id', id); load(); };
  const sortKey = (x) => sortBy === 'ic'
    ? icScore(x.analysis?.score_total, x.analysis?.macro_tilt)
    : (x.analysis?.[sortBy] ?? -999);
  const sorted = [...items].sort((a,b) => (sortKey(b) - sortKey(a)));
  return (
    <div style={{padding:16}}>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <input value={newTicker} onChange={e=>setNewTicker(e.target.value)} placeholder="Añadir ticker (ej. NVDA)" onKeyDown={e=>e.key==='Enter'&&addTicker()} style={{flex:1,padding:'8px 12px',background:'#1c1d26',border:'1px solid #24262f',color:'#edeef4',borderRadius:6}}/>
        <button onClick={addTicker} style={{padding:'8px 16px',background:'#968ff7',border:'none',color:'#15151c',borderRadius:6,cursor:'pointer',fontWeight:600}}>Añadir</button>
        <button onClick={load} style={{padding:'8px 16px',background:'#24262f',border:'1px solid #33353f',color:'#edeef4',borderRadius:6,cursor:'pointer'}}>{loading?'…':'Recargar'}</button>
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead>
          <tr style={{color:'#787a83',textAlign:'left',borderBottom:'1px solid #24262f'}}>
            <th style={{padding:8}}>Ticker</th>
            <th style={{padding:8,cursor:'pointer'}} onClick={()=>setSortBy('score_total')}>Score{sortBy==='score_total'?' ▾':''}</th>
            <th style={{padding:8,cursor:'pointer'}} onClick={()=>setSortBy('macro_tilt')}>Macro Tilt{sortBy==='macro_tilt'?' ▾':''}</th>
            <th style={{padding:8,cursor:'pointer'}} onClick={()=>setSortBy('ic')} title="IC Score = clamp(score + macro tilt, 0, 100)">IC Score{sortBy==='ic'?' ▾':''}</th>
            <th style={{padding:8}}>Rating</th>
            <th style={{padding:8}}>Sector</th>
            <th style={{padding:8}}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(it => (
            <tr key={it.id} style={{borderBottom:'1px solid #1c1d26'}}>
              <td style={{padding:8,fontWeight:600,color:'#968ff7',cursor:'pointer'}} onClick={()=>onAnalyze&&onAnalyze(it.ticker)}>{it.ticker}</td>
              <td style={{padding:8}}>{it.analysis?.score_total ?? '—'}</td>
              <td style={{padding:8,color: it.analysis?.macro_tilt ? (it.analysis.macro_tilt>0?'#5ac576':'#eb6459') : '#787a83'}}>{it.analysis?.macro_tilt ? ((it.analysis.macro_tilt>0?'+':'')+it.analysis.macro_tilt) : '—'}</td>
              <td style={{padding:8,fontWeight:700,color: it.analysis ? getRating(icScore(it.analysis.score_total, it.analysis.macro_tilt)).color : '#787a83'}}>{it.analysis ? icScore(it.analysis.score_total, it.analysis.macro_tilt) : '—'}</td>
              <td style={{padding:8}}>{it.analysis?.rating ?? '—'}</td>
              <td style={{padding:8,color:'#a6a7b1'}}>{it.analysis?.sector ?? '—'}</td>
              <td style={{padding:8}}><button onClick={()=>removeTicker(it.id)} style={{background:'none',border:'none',color:'#eb6459',cursor:'pointer'}}>✕</button></td>
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={7} style={{padding:16,textAlign:'center',color:'#787a83'}}>Watchlist vacía. Añade tickers arriba, analízalos en Overview, y aparecerán aquí con su score.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ─── COMPARADOR (2-3 tickers ya analizados, lee sl_analyses, $0) ───
function CompareView({ supabase, onAnalyze }) {
  const [rows, setRows]       = useState([]);   // [{ticker, analysis}] de la watchlist
  const [sel, setSel]         = useState([]);   // tickers seleccionados (máx 3)
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: wl } = await supabase.from('sl_watchlist').select('ticker').order('added_at');
    const tickers = (wl || []).map(w => w.ticker);
    let analyses = [];
    if (tickers.length) {
      const { data } = await supabase.from('sl_analyses').select('*').in('ticker', tickers).order('analysis_date', { ascending: false });
      analyses = data || [];
    }
    const latest = {};
    for (const a of analyses) if (!latest[a.ticker]) latest[a.ticker] = a;
    setRows(tickers.map(t => ({ ticker: t, analysis: latest[t] || null })));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const toggle = (t) => setSel(s => s.includes(t) ? s.filter(x => x !== t) : (s.length >= 3 ? s : [...s, t]));
  const chosen = sel.map(t => rows.find(r => r.ticker === t)).filter(Boolean);
  const noAnalysis = chosen.filter(c => !c.analysis).map(c => c.ticker);

  const metricRows = [
    { k:'IC Score',    get:a => icScore(a.score_total, a.macro_tilt),    hi:'max' },
    { k:'Score base',  get:a => a.score_total ?? null,                   hi:'max' },
    { k:'Rating',      get:a => a.rating ?? null,                        hi:null  },
    { k:'Sector',      get:a => a.sector ?? null,                        hi:null  },
    { k:'Macro Tilt',  get:a => a.macro_tilt ?? null,                    hi:'max', fmt:v => v==null?'—':((v>0?'+':'')+v) },
    { k:'Valuation',   get:a => a.score_val ?? null,                     hi:'max' },
    { k:'Fin. Health', get:a => a.score_hlth ?? null,                    hi:'max' },
    { k:'Momentum',    get:a => a.score_mom ?? null,                     hi:'max' },
    { k:'Growth',      get:a => a.score_growth ?? null,                  hi:'max' },
  ];

  return (
    <div style={{padding:16}}>
      <div style={{fontSize:13,color:'#a6a7b1',marginBottom:8}}>Selecciona 2–3 tickers de tu watchlist para compararlos lado a lado (datos ya guardados, $0).</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:16}}>
        {rows.map(r => {
          const on = sel.includes(r.ticker);
          const has = !!r.analysis;
          const blocked = !on && sel.length >= 3;
          return (
            <button key={r.ticker} onClick={() => toggle(r.ticker)} disabled={blocked}
              title={has ? '' : 'Sin análisis guardado — analízalo primero'}
              style={{
                padding:'6px 12px',borderRadius:6,cursor:blocked?'not-allowed':'pointer',
                background:on?'#968ff7':'#1c1d26',border:`1px solid ${on?'#968ff7':'#24262f'}`,
                color:on?'#15151c':(has?'#edeef4':'#787a83'),fontWeight:600,fontSize:12,opacity:blocked?0.5:1
              }}>{r.ticker}{has?'':' ·—'}</button>
          );
        })}
        <button onClick={load} style={{padding:'6px 12px',background:'#24262f',border:'1px solid #33353f',color:'#edeef4',borderRadius:6,cursor:'pointer',fontSize:12}}>{loading?'…':'↻'}</button>
      </div>

      {!rows.length && !loading && (
        <div style={{padding:'40px 20px',textAlign:'center',color:'#787a83',fontSize:13}}>Watchlist vacía. Añade tickers en la pestaña Screener y analízalos.</div>
      )}

      {rows.length > 0 && chosen.length < 2 && (
        <div style={{padding:'40px 20px',textAlign:'center',color:'#787a83',fontSize:13}}>Elige al menos 2 tickers para comparar.</div>
      )}

      {chosen.length >= 2 && (
        <>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead>
              <tr style={{color:'#787a83',textAlign:'left',borderBottom:'1px solid #24262f'}}>
                <th style={{padding:8}}>Métrica</th>
                {chosen.map(c => (
                  <th key={c.ticker} style={{padding:8,color:'#968ff7',cursor:'pointer'}}
                    title="Analizar este ticker" onClick={() => onAnalyze && onAnalyze(c.ticker)}>{c.ticker}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricRows.map(mr => {
                const cells = chosen.map(c => c.analysis ? mr.get(c.analysis) : null);
                const nums = cells.filter(v => typeof v === 'number');
                const best = (mr.hi === 'max' && nums.length) ? Math.max(...nums) : null;
                const manyDistinct = new Set(nums).size > 1;
                return (
                  <tr key={mr.k} style={{borderBottom:'1px solid #1c1d26'}}>
                    <td style={{padding:8,color:'#a6a7b1'}}>{mr.k}</td>
                    {chosen.map((c, i) => {
                      const v = cells[i];
                      const isBest = best != null && manyDistinct && typeof v === 'number' && v === best;
                      const display = c.analysis ? (mr.fmt ? mr.fmt(v) : (v ?? '—')) : '—';
                      return (
                        <td key={c.ticker} style={{
                          padding:8,fontWeight:isBest?800:500,
                          color:isBest?'#5ac576':(c.analysis?'#edeef4':'#787a83')
                        }}>{display}</td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {noAnalysis.length > 0 && (
            <div style={{marginTop:12,fontSize:11,color:'#787a83'}}>
              Sin análisis guardado: {noAnalysis.map((t, i) => (
                <span key={t}>
                  <span style={{color:'#968ff7',cursor:'pointer',fontWeight:600}} onClick={() => onAnalyze && onAnalyze(t)}>{t}</span>
                  {i < noAnalysis.length - 1 ? ', ' : ''}
                </span>
              ))} — analízalo(s) primero para comparar.
            </div>
          )}
          <div style={{marginTop:10,fontSize:9,color:'#33353f'}}>Verde = mejor valor de la fila. Comparativa de análisis ya guardados; no dispara nuevos análisis.</div>
        </>
      )}
    </div>
  );
}

// ─── LOGIN ───────────────────────────────────────────────────
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  const sendMagicLink = async () => {
    setErr(null);
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) setErr(error.message); else setSent(true);
  };
  if (sent) return <div style={{padding:40,textAlign:'center',color:'#edeef4'}}><h2>Check your email</h2><p>We sent a magic link to {email}.</p></div>;
  return (
    <div style={{maxWidth:380,margin:'80px auto',padding:32,background:'#15151c',borderRadius:12,border:'1px solid #24262f'}}>
      <h2 style={{color:'#edeef4',marginBottom:8}}>StockLens — Login</h2>
      <p style={{color:'#787a83',fontSize:13,marginBottom:20}}>Sign in with email magic link. No password.</p>
      <input type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)}
        style={{width:'100%',padding:'10px 12px',background:'#1c1d26',border:'1px solid #24262f',color:'#edeef4',borderRadius:6,fontSize:14,marginBottom:12}}/>
      <button onClick={sendMagicLink}
        style={{width:'100%',padding:'10px',background:'#968ff7',border:'none',color:'#15151c',borderRadius:6,cursor:'pointer',fontWeight:600}}>
        Send magic link
      </button>
      {err && <div style={{color:'#eb6459',fontSize:12,marginTop:10}}>{err}</div>}
    </div>
  );
}

// ─── REVERSE DCF CARD (F3, gated) — "Qué descuenta el precio" ──
// Presentational only. Renders the RDCF result computed in App (state
// `reverseDcf`). Instrument skin: same inline hex palette as the rest of
// StockLens (accent #968ff7, text #edeef4, muted #787a83, panels #1c1d26).
// Rendered only when SL_FLAGS.REVERSE_DCF_ENABLED is on AND a result exists,
// so with the flag off this component never mounts.
function ReverseDcfCard({ data, horizonYears }) {
  const [showAdv, setShowAdv] = useState(false);
  const pct = (v, d=1) => (v == null || !isFinite(v)) ? '—' : `${(v*100).toFixed(d)}%`;
  const card = { background:'#15151c', border:'1px solid #1c1d26', borderRadius:10, padding:'20px 24px', display:'flex', flexDirection:'column', gap:16 };
  const panel = { background:'#1c1d26', border:'1px solid #24262f', borderRadius:6, padding:'10px 14px', display:'flex', flexDirection:'column', gap:3 };

  if (!data) return null;

  if (data.applicable === false) {
    const why = {
      sector_excluded: 'Sector financiero/asegurador — el DCF de caja libre no aplica de forma fiable.',
      negative_fcf:    'Caja libre negativa o pre-beneficios — el precio no produce un crecimiento implícito interpretable.',
      missing_data:    'Faltan datos de FMP (ingresos, acciones o caja libre) para construir el modelo.',
      no_convergence:  'El solver no converge con el precio actual y los supuestos del modelo.',
      error:           'No se pudo calcular el reverse DCF para este ticker.',
    }[data.reason] || 'Reverse DCF no aplicable para este ticker.';
    return (
      <div style={card}>
        <SectionTitle>Qué descuenta el precio</SectionTitle>
        <div style={{ fontSize:13, color:'#787a83', lineHeight:1.6 }}>No aplicable. {why}</div>
      </div>
    );
  }

  const H = horizonYears || (RDCF.CONFIG && RDCF.CONFIG.horizon) || 40;
  const cagr = Math.max(0, data.revCagr || 0);
  const bands = RDCF.REALITY_BANDS;
  const band = bands.find(b => cagr <= b.to) || bands[bands.length - 1];
  const AX = 0.40; // reality-bar axis max
  const widths = bands.map((b, i) => (Math.min(b.to, AX) - (i === 0 ? 0 : bands[i-1].to)) / AX * 100);
  const markerLeft = Math.min(cagr / AX, 1) * 100;

  const gap = data.impliedGrowthPremium;
  const tvShare = data.tvShare;
  const exitM = data.impliedExitMultiple;

  // Natural-language verdict ("what you'd have to believe"), impersonal.
  const verdict =
    `Para justificar el precio actual, el mercado exige un crecimiento de ventas de ` +
    `${pct(cagr)} anual sostenido durante ${H} años — zona «${band.label.toLowerCase()}». ` +
    band.desc + ' ' +
    (data.analystGrowth != null
      ? `Los analistas proyectan ~${pct(data.analystGrowth)} anual` +
        (gap != null ? ` (${gap >= 0 ? '+' : ''}${pct(gap)} de prima exigida por el precio).` : '.')
      : 'Sin estimación de analista disponible para contrastar.') +
    ' Informativo, no recomendación.';

  return (
    <div style={card}>
      <SectionTitle>Qué descuenta el precio · Reverse DCF</SectionTitle>

      {/* Hero: implied CAGR + band */}
      <div style={{ display:'flex', alignItems:'baseline', gap:14, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:10, color:'#787a83', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:4 }}>Crecimiento de ventas implícito</div>
          <div style={{ fontSize:46, fontWeight:700, color:'#968ff7', fontFamily:'Geist Mono,monospace', lineHeight:1 }}>{pct(cagr)}</div>
          <div style={{ fontSize:11, color:'#787a83', marginTop:4 }}>CAGR a {H} años · g₁ implícito {pct(data.impliedG1, 1)}</div>
        </div>
        <div style={{ marginLeft:'auto', alignSelf:'center' }}>
          <span style={{ display:'inline-block', padding:'6px 14px', borderRadius:100, fontSize:13, fontWeight:700,
            color:band.color, background:`color-mix(in srgb, ${band.color} 14%, transparent)`, border:`1px solid color-mix(in srgb, ${band.color} 40%, transparent)` }}>
            {band.label}
          </span>
        </div>
      </div>

      {/* Reality bar */}
      <div>
        <div style={{ position:'relative', height:26, borderRadius:6, overflow:'hidden', display:'flex' }}>
          {bands.map((b, i) => (
            <div key={i} style={{ width:`${widths[i]}%`, height:'100%', background:`color-mix(in srgb, ${b.color} 80%, transparent)`,
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:9.5, fontWeight:700, color:'#0f0f14', whiteSpace:'nowrap', overflow:'hidden' }}>
              {b.label}
            </div>
          ))}
          <div style={{ position:'absolute', top:-3, bottom:-3, left:`${markerLeft}%`, width:2, background:'#edeef4' }}/>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:9.5, color:'#33353f' }}>
          <span>0%</span><span>10%</span><span>20%</span><span>30%</span><span>40%+</span>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
        <div style={panel}>
          <div style={{ fontSize:10, color:'#787a83', textTransform:'uppercase', letterSpacing:'0.5px' }}>Peso del valor terminal</div>
          <div style={{ fontSize:17, fontWeight:700, fontFamily:'Geist Mono,monospace', lineHeight:1, color: tvShare != null && tvShare > 0.7 ? '#eb6459' : '#5ac576' }}>{pct(tvShare)}</div>
          <div style={{ fontSize:10, color:'#33353f' }}>{tvShare != null && tvShare > 0.7 ? 'precio depende del futuro lejano' : 'anclado en flujos cercanos'}</div>
        </div>
        <div style={panel}>
          <div style={{ fontSize:10, color:'#787a83', textTransform:'uppercase', letterSpacing:'0.5px' }}>Gap vs analista</div>
          <div style={{ fontSize:17, fontWeight:700, fontFamily:'Geist Mono,monospace', lineHeight:1, color: gap == null ? '#787a83' : gap > 0 ? '#eb6459' : '#5ac576' }}>{gap == null ? '—' : `${gap >= 0 ? '+' : ''}${pct(gap)}`}</div>
          <div style={{ fontSize:10, color:'#33353f' }}>prima de crecimiento exigida</div>
        </div>
        <div style={panel}>
          <div style={{ fontSize:10, color:'#787a83', textTransform:'uppercase', letterSpacing:'0.5px' }}>Múltiplo de salida impl.</div>
          <div style={{ fontSize:17, fontWeight:700, fontFamily:'Geist Mono,monospace', lineHeight:1, color: data.exitFlag ? '#eb6459' : '#edeef4' }}>{exitM != null && isFinite(exitM) ? `${exitM.toFixed(1)}x` : '—'}</div>
          <div style={{ fontSize:10, color:'#33353f' }}>{data.exitFlag ? 'valoración no anclada' : 'FCF terminal'}</div>
        </div>
        <div style={panel}>
          <div style={{ fontSize:10, color:'#787a83', textTransform:'uppercase', letterSpacing:'0.5px' }}>Valor por acción impl.</div>
          <div style={{ fontSize:17, fontWeight:700, fontFamily:'Geist Mono,monospace', lineHeight:1, color:'#edeef4' }}>{data.perShare != null && isFinite(data.perShare) ? `$${data.perShare.toFixed(2)}` : '—'}</div>
          <div style={{ fontSize:10, color:'#33353f' }}>diluido, supuestos del modelo</div>
        </div>
      </div>

      {/* Verdict */}
      <div style={{ fontSize:13, color:'#c7c8d1', lineHeight:1.65, borderLeft:'2px solid #968ff7', paddingLeft:12 }}>{verdict}</div>

      {/* Low-confidence note */}
      {data.lowConfidence && (
        <div style={{ fontSize:11, color:'#eca851', background:'color-mix(in srgb, #eca851 9%, transparent)', border:'1px solid color-mix(in srgb, #eca851 30%, transparent)', borderRadius:6, padding:'8px 12px' }}>
          WACC con risk-free por defecto ({pct(RDCF.CONFIG.rfDefault)}) — baja confianza hasta que el 10Y (macro_state.dgs10) esté disponible. El número se afina solo cuando llegue.
        </div>
      )}

      {/* Advanced (collapsed) */}
      <div>
        <button onClick={() => setShowAdv(s => !s)} style={{ background:'none', border:'none', color:'#968ff7', fontSize:11, fontWeight:600, cursor:'pointer', padding:0 }}>
          {showAdv ? '▾ Ocultar detalle del modelo' : '▸ Ver detalle del modelo'}
        </button>
        {showAdv && (
          <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:8, fontSize:11 }}>
            {[
              ['WACC', pct(data.wacc, 2)],
              ['Beta', data.beta != null ? data.beta.toFixed(2) : '—'],
              ['ERP', data.erp != null ? pct(data.erp, 2) : '—'],
              ['rf', data.rf != null ? pct(data.rf, 2) : `${pct(RDCF.CONFIG.rfDefault)} (def.)`],
              ['EV implícito', data.ev != null ? `${data.ev.toFixed(0)} B$` : '—'],
              ['EV objetivo', data.targetEV != null ? `${data.targetEV.toFixed(0)} B$` : '—'],
              ['g₁ implícito', pct(data.impliedG1, 2)],
              ['Fuente rf', data.rfSource || '—'],
            ].map(([k, v], i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', gap:8, padding:'4px 0', borderBottom:'1px solid #1c1d26' }}>
                <span style={{ color:'#787a83' }}>{k}</span>
                <span style={{ color:'#edeef4', fontFamily:'Geist Mono,monospace' }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize:10, color:'#33353f', marginTop:10, lineHeight:1.6 }}>
          Modelo: FCFₜ = ingresos × (margen − capex%); transición lineal g₁→g∞; valor terminal de Gordon; solver por bisección.
          Las bandas de rareza son ilustrativas (probabilidad histórica de sostener un CAGR alto a 20+ años). Herramienta analítica, no asesoramiento de inversión.
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
// ─── INTERNATIONAL EXCHANGE SUPPORT ─────────────────────────
// Mapa sufijo → bolsa. FMP acepta TICKER.XX para mercados no-US.
// Añadir sufijo aquí para que el badge de bandera aparezca en la UI.
const EXCHANGE_SUFFIXES = {
  '.PA': { name:'Euronext Paris',          flag:'🇫🇷', short:'EURONEXT' },
  '.DE': { name:'Xetra Frankfurt',          flag:'🇩🇪', short:'XETRA'   },
  '.L':  { name:'London Stock Exchange',    flag:'🇬🇧', short:'LSE'     },
  '.AS': { name:'Euronext Amsterdam',       flag:'🇳🇱', short:'AMS'     },
  '.MI': { name:'Borsa Italiana',           flag:'🇮🇹', short:'BIT'     },
  '.MC': { name:'Bolsa de Madrid',          flag:'🇪🇸', short:'BME'     },
  '.SW': { name:'SIX Swiss Exchange',       flag:'🇨🇭', short:'SIX'     },
  '.ST': { name:'Nasdaq Stockholm',         flag:'🇸🇪', short:'STO'     },
  '.CO': { name:'Nasdaq Copenhagen',        flag:'🇩🇰', short:'CPH'     },
  '.OL': { name:'Oslo Børs',               flag:'🇳🇴', short:'OSL'     },
  '.HE': { name:'Nasdaq Helsinki',          flag:'🇫🇮', short:'HEL'     },
  '.T':  { name:'Tokyo Stock Exchange',     flag:'🇯🇵', short:'TSE'     },
  '.HK': { name:'Hong Kong Stock Exchange', flag:'🇭🇰', short:'HKEX'   },
  '.SS': { name:'Shanghai Stock Exchange',  flag:'🇨🇳', short:'SSE'     },
  '.SZ': { name:'Shenzhen Stock Exchange',  flag:'🇨🇳', short:'SZSE'    },
  '.KS': { name:'Korea Stock Exchange',     flag:'🇰🇷', short:'KRX'     },
  '.KQ': { name:'KOSDAQ',                   flag:'🇰🇷', short:'KOSDAQ'  },
  '.AX': { name:'ASX Australia',            flag:'🇦🇺', short:'ASX'     },
  '.TO': { name:'Toronto Stock Exchange',   flag:'🇨🇦', short:'TSX'     },
  '.TW': { name:'Taiwan Stock Exchange',    flag:'🇹🇼', short:'TWSE'    },
  '.SA': { name:'B3 São Paulo',             flag:'🇧🇷', short:'B3'      },
  '.MX': { name:'Bolsa Mexicana',           flag:'🇲🇽', short:'BMV'     },
  '.NS': { name:'NSE India',                flag:'🇮🇳', short:'NSE'     },
  '.BO': { name:'BSE India',                flag:'🇮🇳', short:'BSE'     },
  '.JO': { name:'JSE South Africa',         flag:'🇿🇦', short:'JSE'     },
};

// Retorna { base, suffix, name, flag, short } o null si es ticker US sin sufijo.
function parseIntlTicker(ticker) {
  if (!ticker) return null;
  const dot = ticker.lastIndexOf('.');
  if (dot < 1) return null;
  const suffix = ticker.slice(dot);
  const meta = EXCHANGE_SUFFIXES[suffix];
  if (!meta) return null;
  return { base: ticker.slice(0, dot), suffix, ...meta };
}

// ─── WATCHLIST PANEL ────────────────────────────────────────
// Muestra el análisis más reciente de cada ticker guardado en sl_analyses.
// Lee solo columnas ligeras (0 API calls). Click en card → re-analiza.
function WatchlistPanel({ rows, onAnalyze }) {
  if (!Array.isArray(rows)) return null;
  // Deduplicar: un ticker → análisis más reciente (filtra filas corruptas)
  const latest = Object.values(
    rows.reduce((acc, r) => {
      if (!r || !r.ticker || !r.analysis_date) return acc; // fila corrupta
      if (!acc[r.ticker] || r.analysis_date > acc[r.ticker].analysis_date)
        acc[r.ticker] = r;
      return acc;
    }, {})
  ).sort((a, b) => b.analysis_date.localeCompare(a.analysis_date));

  if (!latest.length) return null;

  return (
    <div style={{ paddingTop: 28 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#33353f', marginBottom: 14 }}>
        My Watchlist · {latest.length} ticker{latest.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 10 }}>
        {latest.map(row => {
          const ic = icScore(row.score_total, row.macro_tilt);
          const r  = getRating(ic);
          const col = ic >= RT.BUY ? '#5ac576' : ic >= RT.HOLD ? '#eca851' : '#eb6459';
          return (
            <div key={row.ticker}
              onClick={() => onAnalyze(row.ticker)}
              onMouseEnter={e => e.currentTarget.style.borderColor = '#34315f'}
              onMouseLeave={e => e.currentTarget.style.borderColor = '#24262f'}
              style={{
                background: '#1c1d26', border: '1px solid #24262f', borderRadius: 8,
                padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s',
              }}>
              {/* ticker + IC score */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: 'Geist Mono,monospace', lineHeight: 1 }}>{row.ticker}</div>
                  {row.sector && <div style={{ fontSize: 9, color: '#33353f', marginTop: 3 }}>{row.sector}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: col, fontFamily: 'Geist Mono,monospace', lineHeight: 1 }}>{ic}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: r.color, letterSpacing: '0.8px', marginTop: 2 }}>{r.label}</div>
                </div>
              </div>
              {/* sub-scores */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px', marginBottom: 8 }}>
                {[['Val', row.score_val, 25], ['Hlth', row.score_hlth, 30], ['Mom', row.score_mom, 25], ['Growth', row.score_growth, 20]].map(([lbl, v, mx]) => (
                  <div key={lbl} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#787a83' }}>
                    <span>{lbl}</span>
                    <span style={{ color: '#a6a7b1', fontFamily: 'Geist Mono,monospace' }}>{v ?? '—'}/{mx}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 9, color: '#33353f' }}>{row.analysis_date}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const [session,      setSession]      = useState(null);
  const [authChecked,  setAuthChecked]  = useState(false);
  const [aiVerdict,    setAiVerdict]    = useState(null);
  const [aiLoading,    setAiLoading]    = useState(false);

  const [inputTicker,  setInputTicker]  = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [ticker,       setTicker]       = useState(null);
  const [activeTab,    setActiveTab]    = useState('Overview');
  const [chartPeriod,  setChartPeriod]  = useState('1Y');
  const [scrolled,     setScrolled]     = useState(false);
  const [recentTickers,setRecentTickers]= useState(()=>JSON.parse(localStorage.getItem('sl_history')||'[]'));

  // Data state
  const [quote,  setQuote]  = useState(null);
  const [prof,   setProf]   = useState(null);
  const [met,    setMet]    = useState(null);
  const [rat,    setRat]    = useState(null);
  const [hist,   setHist]   = useState([]);
  const [stmts,  setStmts]  = useState([]);
  const [news,   setNews]   = useState([]);
  const [ptC,    setPtC]    = useState(null);
  const [analystEst,setAnalystEst] = useState(null);
  const [udC,    setUdC]    = useState(null);
  const [dcf,       setDcf]       = useState(null);
  const [dcfInputs, setDcfInputs] = useState(null);
  const [ptList,    setPtList]    = useState(null);

  // Finnhub data state
  const [earnCalendar, setEarnCalendar] = useState(null);
  const [earnSurprise, setEarnSurprise] = useState([]);
  const [insiderTxns,  setInsiderTxns]  = useState([]);
  const [shortInt,     setShortInt]     = useState(null);

  // Earnings transcript summary (gated by button — costs 1 Anthropic call)
  const [transcriptSum,     setTranscriptSum]     = useState(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError,   setTranscriptError]   = useState(null);
  const transcriptCache = useRef({});

  // v5.0 new state
  const [peers,         setPeers]        = useState([]);
  const [peerMetrics,   setPeerMetrics]  = useState({});
  const [cfStmts,       setCfStmts]      = useState([]);
  const [balanceSheets, setBalanceSheets]= useState([]);
  const [historicalDivs,setHistoricalDivs]=useState([]);
  const [spyHistory,    setSpyHistory]    = useState([]);
  const [macroTilt,     setMacroTilt]     = useState(null);
  const [autoLoaded,    setAutoLoaded]    = useState(false);
  const [scoreHistory,  setScoreHistory]  = useState([]);   // [{date, ic}] histórico IC Score del ticker (lectura sl_analyses, $0)
  const [reverseDcf,    setReverseDcf]    = useState(null);  // Reverse DCF result (gated por SL_FLAGS.REVERSE_DCF_ENABLED; null si flag off)
  const [watchlist,     setWatchlist]     = useState([]);    // [{ticker,analysis_date,score_total,...}] — lectura sl_analyses al arranque y post-análisis

  const scores    = useMemo(()=>calcScores(met,rat,hist,stmts),[met,rat,hist,stmts]);
  const intlMeta  = useMemo(()=>parseIntlTicker(ticker),[ticker]);

  useEffect(()=>{
    const fn=()=>setScrolled(window.scrollY>180);
    window.addEventListener('scroll',fn,{passive:true});
    return ()=>window.removeEventListener('scroll',fn);
  },[]);

  const loadWatchlist = useCallback(async (sess) => {
    if (!sb || !sess) return;
    try {
      const { data } = await sb.from('sl_analyses')
        .select('ticker, analysis_date, score_total, score_val, score_hlth, score_mom, score_growth, rating, macro_tilt, sector')
        .eq('user_id', sess.user.id)
        .order('analysis_date', { ascending: false })
        .limit(200);
      if (Array.isArray(data)) setWatchlist(data);
    } catch(e) { console.warn('[StockLens] watchlist load failed:', e?.message); }
  }, []);

  useEffect(() => {
    if (!sb) { setAuthChecked(true); return; }
    sb.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
      if (data.session) loadWatchlist(data.session);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) loadWatchlist(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadWatchlist]);

  const fmpGet = useCallback(async (endpoint, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authedFetch(`/api/fmp/${endpoint}?${qs}`);
    if (res.status === 401) { if (sb) sb.auth.signOut(); throw new Error('Session expired — please log in again'); }
    if (res.status === 429) throw new Error('Rate limit — wait 1 minute');
    if (res.status === 403) throw new Error('Endpoint not allowed');
    if (!res.ok) throw new Error(`API error (HTTP ${res.status})`);
    const data = await res.json();
    if (Array.isArray(data) && data.length === 0) return null;
    return data;
  }, []);

  const finnhubGet = useCallback(async (endpoint, params = {}) => {
    try {
      const qs = new URLSearchParams(params).toString();
      const res = await authedFetch(`/api/finnhub/${endpoint}?${qs}`);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }, []);

  const fetchAiVerdict = useCallback(async (sym, scoreData, profileData, metricsData, macroData) => {
    if (!sym) return;
    setAiLoading(true);
    setAiVerdict(null);
    try {
      const prompt = `You are a concise equity analyst. Provide a 2-3 sentence investment verdict for ${sym} (${profileData?.companyName || ''}).

Key data:
- Composite score: ${scoreData?.total}/100 (${getRating(scoreData?.total)?.label})
- Valuation score: ${scoreData?.val}/25
- Financial Health score: ${scoreData?.hlth}/30
- Momentum score: ${scoreData?.mom}/25
- Growth score: ${scoreData?.growth}/20
- Sector: ${profileData?.sector || 'Unknown'}
- Market Cap: ${profileData?.mktCap ? '$' + (profileData.mktCap / 1e9).toFixed(1) + 'B' : 'Unknown'}
- P/E (TTM): ${metricsData?.priceToEarningsRatioTTM?.toFixed(1) || 'N/A'}
- ROIC (TTM): ${metricsData?.returnOnInvestedCapitalTTM ? (metricsData.returnOnInvestedCapitalTTM * 100).toFixed(1) + '%' : 'N/A'}
- Net Debt/EBITDA: ${metricsData?.netDebtToEBITDATTM?.toFixed(1) || 'N/A'}
${macroData?.regime ? `- Contexto macro actual: régimen ${macroData.regime}${macroData.quadrant?` (cuadrante ${macroData.quadrant})`:''}; ajuste macro al score ${macroData.tilt>0?'+':''}${macroData.tilt} por: ${(macroData.reasons||[]).join('; ')}. Pondera este régimen en el veredicto (p.ej. penalizar growth/high-beta en régimen restrictivo).` : ''}

Write 2-3 crisp sentences. No bullet points. Reference specific metrics. End with the rating word (STRONG BUY / BUY / HOLD / CAUTION / AVOID).`;

      const res = await authedFetch('/api/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text;
      if (text) setAiVerdict(text);
    } catch (e) {
      console.warn('[StockLens] AI verdict failed:', e?.message);
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Earnings transcript summary — Finnhub transcript → Claude Haiku. Gated by button.
  // AI Earnings Analysis — ensambla datos FMP ya disponibles → Claude Sonnet. Gated por botón.
  const summarizeEarnings = useCallback(async () => {
    if (!ticker || transcriptLoading) return;
    // Cache hit (por ticker)
    if (transcriptCache.current[ticker]) {
      setTranscriptSum(transcriptCache.current[ticker]); setTranscriptError(null); return;
    }
    setTranscriptLoading(true); setTranscriptError(null); setTranscriptSum(null);
    try {
      const m1 = (n, d) => ok(n) && ok(d) && d !== 0 ? +(n / d * 100).toFixed(1) : null;  // margen %

      // Últimos ~8 trimestres de income-statement (stmts viene newest-first)
      const quarters = (Array.isArray(stmts) ? stmts : []).slice(0, 8).map(s => ({
        period: `${s.period || ''} ${s.calendarYear || s.fiscalYear || (s.date || '').slice(0, 4)}`.trim(),
        revenue: ok(s.revenue) ? s.revenue : null,
        eps: s.eps ?? s.epsdiluted ?? null,
        grossMarginPct: m1(s.grossProfit, s.revenue),
        operatingMarginPct: m1(s.operatingIncome, s.revenue),
        netMarginPct: m1(s.netIncome, s.revenue),
      }));

      // Sorpresa del último Q (Finnhub stock/earnings → EPS actual vs estimado, ya en estado)
      const le = (Array.isArray(earnSurprise) ? earnSurprise : [])[0];
      const lastQuarterSurprise = le ? {
        period: le.period || (le.quarter && le.year ? `Q${le.quarter} ${le.year}` : null),
        epsActual: le.actual ?? null,
        epsEstimate: le.estimate ?? null,
        surprisePct: le.surprisePercent ?? le.surprise ?? null,
      } : null;

      // Estimaciones forward (analyst-estimates)
      const estimates = (Array.isArray(analystEst) ? analystEst : []).slice(0, 2).map(e => ({
        date: e.date || e.period || null,
        revenueAvg: e.revenueAvg ?? e.estimatedRevenueAvg ?? null,
        epsAvg: e.epsAvg ?? e.estimatedEpsAvg ?? null,
      }));

      // Price target consensus + rating de analistas
      const pt = Array.isArray(ptC) ? ptC[0] : ptC;
      const ud = Array.isArray(udC) ? udC[0] : udC;
      const priceTarget = pt ? {
        consensus: pt.targetConsensus ?? null, high: pt.targetHigh ?? null,
        low: pt.targetLow ?? null, median: pt.targetMedian ?? null,
      } : null;
      const analystConsensus = ud ? {
        rating: ud.consensus ?? null, strongBuy: ud.strongBuy, buy: ud.buy,
        hold: ud.hold, sell: ud.sell, strongSell: ud.strongSell,
      } : null;

      if (quarters.length === 0 && !lastQuarterSurprise) { setTranscriptError('empty'); return; }

      const payload = {
        symbol: ticker,
        currentPrice: ok(quote?.price) ? +quote.price.toFixed(2) : null,
        peRatioTTM: met?.peRatioTTM ?? met?.priceToEarningsRatioTTM ?? null,
        quarters, lastQuarterSurprise, estimates, priceTarget, analystConsensus,
        macroRegime: macroTilt?.regime ?? null, macroTilt: macroTilt?.tilt ?? null, macroReasons: macroTilt?.reasons ?? null,
      };

      const label = quarters[0]?.period || lastQuarterSurprise?.period || '';
      const dateLabel = ((Array.isArray(stmts) ? stmts : [])[0]?.date || '').slice(0, 10);

      const prompt = `Eres analista de equity. Con estos datos de earnings de ${ticker}, da un análisis en 5 puntos: (1) último trimestre (revenue/EPS y beat/miss vs estimación), (2) tendencia de revenue/EPS (¿acelera o desacelera?), (3) márgenes (expansión/compresión), (4) sentimiento de analistas / price target vs precio actual, (5) lectura forward / qué vigilar. Considera el contexto macro: régimen ${payload.macroRegime ?? 'n/d'}, ajuste ${payload.macroTilt ?? 0}. Ajusta el tono/riesgos a ese régimen. Conciso, en español, sin relleno. Datos: ${JSON.stringify(payload)}`;

      const res = await authedFetch('/api/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.status === 401) { setTranscriptError('Sesión expirada — vuelve a iniciar sesión.'); if (sb) sb.auth.signOut(); return; }
      if (res.status === 429) { setTranscriptError('Límite de uso alcanzado — espera 1 minuto e inténtalo de nuevo.'); return; }
      if (!res.ok) { setTranscriptError('Análisis no disponible ahora mismo.'); return; }
      const data = await res.json();
      const summary = data?.content?.[0]?.text;
      if (!summary) { setTranscriptError('Análisis no disponible ahora mismo.'); return; }

      const result = { ticker, label, date: dateLabel, summary };
      if (Object.keys(transcriptCache.current).length >= 50) transcriptCache.current = {};
      transcriptCache.current[ticker] = result;
      setTranscriptSum(result);
    } catch (e) {
      setTranscriptError('Análisis no disponible ahora mismo.');
    } finally {
      setTranscriptLoading(false);
    }
  }, [ticker, transcriptLoading, stmts, earnSurprise, analystEst, ptC, udC, met, quote, macroTilt]);

  const analyze = useCallback(async (sym)=>{
    if (!sym) return;
    setLoading(true); setError(null); setActiveTab('Overview');
    setQuote(null); setProf(null); setMet(null); setRat(null);
    setHist([]); setStmts([]); setNews([]);
    setPtC(null); setAnalystEst(null); setUdC(null); setDcf(null);
    setDcfInputs(null); setPtList(null);
    setAiVerdict(null); setEarnCalendar(null); setEarnSurprise([]); setInsiderTxns([]); setShortInt(null);
    setTranscriptSum(null); setTranscriptError(null); setTranscriptLoading(false);
    setPeers([]); setPeerMetrics({}); setCfStmts([]); setBalanceSheets([]); setHistoricalDivs([]);
    setSpyHistory([]);
    setMacroTilt(null);
    setScoreHistory([]);
    setReverseDcf(null);
    try {
      const results = await Promise.allSettled([
        fmpGet('quote',                        { symbol: sym }),
        fmpGet('profile',                      { symbol: sym }),
        fmpGet('key-metrics-ttm',              { symbol: sym }),
        fmpGet('ratios-ttm',                   { symbol: sym }),
        fmpGet('historical-price-eod/full',    { symbol: sym }),
        fmpGet('income-statement',             { symbol: sym, period: 'quarter', limit: '12' }),
        fmpGet('news',                         { tickers: sym, limit: '8' }),
        fmpGet('price-target-consensus',       { symbol: sym }),
        fmpGet('analyst-estimates',            { symbol: sym, limit: '2' }),
        fmpGet('upgrades-downgrades-consensus',{ symbol: sym }),
        fmpGet('discounted-cash-flow',         { symbol: sym }),
        fmpGet('balance-sheet-statement',      { symbol: sym, period: 'quarter', limit: '12' }),
        fmpGet('price-target',                 { symbol: sym, limit: '10' }),
        fmpGet('cash-flow-statement',          { symbol: sym, period: 'quarter', limit: '8' }),
        fmpGet('peers',                        { symbol: sym }),
        fmpGet('historical-dividends',         { symbol: sym, limit: '30' }),
      ]);

      const get=r=>r.status==='fulfilled'?r.value:null;
      const [qD,pD,mD,rD,hD,sD,nD,ptD,aeD,udD,dcfD,bsD,ptListD,cfD,peersD,divD]=results.map(get);

      if (!qD && !pD) throw new Error(`Ticker "${sym}" not found — check the symbol and try again`);

      const quote_ = Array.isArray(qD)?qD[0]:qD;
      const pD_    = Array.isArray(pD)?pD[0]:pD;
      const met_   = Array.isArray(mD)?mD[0]:mD;
      const rat_   = Array.isArray(rD)?rD[0]:rD;
      const hD_    = Array.isArray(hD)?hD:[];
      const sD_    = Array.isArray(sD)?sD:[];

      setQuote(quote_);
      setProf (pD_);
      setMet  (met_);
      setRat  (rat_);
      setHist (hD_);
      setStmts(sD_);
      setNews (Array.isArray(nD)?nD:[]);
      setPtC  (ptD);
      setAnalystEst(aeD);
      setUdC  (udD);
      setDcf  (Array.isArray(dcfD)?dcfD[0]:dcfD);
      setPtList(Array.isArray(ptListD)?ptListD:null);
      setTicker(sym.toUpperCase());

      // v5.0 data
      const cfArr   = Array.isArray(cfD) ? cfD : [];
      const bsArr   = Array.isArray(bsD) ? bsD : [];
      const divArr  = Array.isArray(divD) ? divD : (divD?.historical||[]);
      setCfStmts(cfArr);
      setBalanceSheets(bsArr);
      setHistoricalDivs(divArr);

      // Fetch SPY history for relative strength (non-blocking)
      fmpGet('historical-price-eod/full', { symbol: 'SPY' })
        .then(d => { if (Array.isArray(d)) setSpyHistory(d); })
        .catch(() => {});

      // Peers — fetch their metrics in background
      const peersRaw = Array.isArray(peersD) ? peersD : (peersD?.peersList || []);
      const peerList = (Array.isArray(peersRaw[0]) ? peersRaw[0] : peersRaw)
        .filter(s => typeof s === 'string' && s !== sym.toUpperCase())
        .slice(0,5);
      setPeers(peerList);

      // Fetch peer metrics in background (non-blocking, sequential per ticker to avoid rate limits)
      if (peerList.length > 0) {
        (async () => {
          try {
            const peerMap = {};
            for (const ps of peerList) {
              try {
                const [mRes, rRes, prRes] = await Promise.all([
                  fmpGet('key-metrics-ttm', { symbol: ps }),
                  fmpGet('ratios-ttm',      { symbol: ps }),
                  fmpGet('profile',         { symbol: ps }),
                ]);
                peerMap[ps] = {
                  met:  Array.isArray(mRes)  ? mRes[0]  : mRes,
                  rat:  Array.isArray(rRes)  ? rRes[0]  : rRes,
                  name: (Array.isArray(prRes) ? prRes[0] : prRes)?.companyName || ps,
                };
              } catch(_e) { /* un peer fallido no bloquea los demás */ }
            }
            setPeerMetrics(peerMap);
          } catch(e) { console.warn('[StockLens] peer metrics fetch failed:', e?.message); }
        })();
      }

      // Populate DCF defaults from real data
      const bs0 = bsArr[0] || null;
      const q0  = sD_[0];
      const baseRevenue = q0?.revenue ? q0.revenue * 4 : null;
      const netDebt = bs0?.netDebt ?? (bs0 ? (bs0.totalDebt||0) - (bs0.cashAndCashEquivalents||0) : null);
      const priceForShares = quote_?.price ?? (hD_.length ? hD_[0]?.close : null);
      const shares = quote_?.sharesOutstanding ?? pD_?.sharesOutstanding
        ?? (ok(quote_?.marketCap) && ok(priceForShares) && priceForShares > 0 ? quote_.marketCap / priceForShares : null);
      const beta_  = quote_?.beta ?? pD_?.beta ?? 1.2;
      setDcfInputs({
        revGrowth1to5:  12,
        revGrowth6to10: 6,
        ebitMargin: ok(rat_?.operatingProfitMarginTTM) ? Math.round(rat_.operatingProfitMarginTTM*100) : 20,
        taxRate:    21,
        capexPct:   5,
        wcChange:   1,
        discountRate:   9,
        terminalGrowth: 3,
        beta:       ok(beta_) ? +beta_.toFixed(2) : 1.2,
        netDebt:    ok(netDebt) ? netDebt : 0,
        shares:     ok(shares) ? shares : null,
        baseRevenue: ok(baseRevenue) ? baseRevenue : null,
      });

      const hist5=[sym,...JSON.parse(localStorage.getItem('sl_history')||'[]')]
        .filter((t,i,a)=>a.indexOf(t)===i).slice(0,5);
      localStorage.setItem('sl_history',JSON.stringify(hist5));
      setRecentTickers(hist5);

      // Finnhub data
      {
        const today = new Date();
        const from = today.toISOString().substring(0, 10);
        const to = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
        const siFrom = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
        const [earnCalRes, earnSurpRes, insiderRes, shortIntRes] = await Promise.allSettled([
          finnhubGet('calendar/earnings', { symbol: sym, from, to }),
          finnhubGet('stock/earnings',    { symbol: sym, limit: '8' }),
          finnhubGet('stock/insider-transactions', { symbol: sym }),
          finnhubGet('stock/short-interest', { symbol: sym, from: siFrom, to: from }),
        ]);
        const fg = r => r.status === 'fulfilled' ? r.value : null;
        const [ec, es, it, si] = [earnCalRes, earnSurpRes, insiderRes, shortIntRes].map(fg);
        setEarnCalendar(ec?.earningsCalendar?.[0] || null);
        setEarnSurprise(Array.isArray(es) ? es.slice(0, 8) : []);
        setInsiderTxns(Array.isArray(it?.data) ? it.data.slice(0, 10) : []);
        setShortInt(si || null);
      }

      // Compute macro tilt from IC DataLayer macro_state (antes del verdict para alimentar la IA)
      const scores_ = calcScores(met_, rat_, hD_, sD_);
      const _mt = await computeMacroTilt(sb, pD_?.sector, met_?.netDebtToEBITDATTM, met_?.peRatioTTM ?? met_?.priceToEarningsRatioTTM);
      setMacroTilt(_mt);

      // ── Reverse DCF (F2, gated) — pure math over data ALREADY in memory.
      // 0 new FMP fetches. When the flag is OFF this whole block is skipped, so
      // StockLens behaves byte-for-byte as before (no extra Supabase read, no state).
      let _rdcf = null;
      if (SL_FLAGS.REVERSE_DCF_ENABLED) {
        try {
          // rf comes from macro_state.dgs10 (read-only). A separate research batch
          // adds that field via ic-proxy; until it's live, RDCF falls back to a
          // config rf and marks the result low-confidence. One tiny Supabase read,
          // on-analyze only (never on app open). Never throws.
          let macroRow = null;
          try {
            const { data: mr } = await sb.from('macro_state').select('*').eq('id', 1).maybeSingle();
            macroRow = mr || null;
          } catch (e) { /* macro optional → low-confidence rf fallback */ }
          const rdIn = RDCF.buildInputs(met_, pD_, quote_, sD_, bsArr, cfArr, aeD);
          _rdcf = RDCF.reverseDcf(sym.toUpperCase(), rdIn, macroRow);
        } catch (e) { _rdcf = null; /* never break the analysis */ }
        setReverseDcf(_rdcf);
      }
      // B1 (gated): el régimen re-pondera el micro_total que se persiste/puntúa.
      // Flag off → idéntico a scores_.total. Quadrant null → _default → mismo total.
      let microTotal_ = (SL_FLAGS.B1_REGIME_WEIGHTS && _mt?.quadrant)
        ? regimeWeightedTotal(scores_, _mt.quadrant)
        : scores_.total;
      // NaN guard: si scores_ tiene campos undefined, regimeWeightedTotal puede dar NaN
      if (!Number.isFinite(microTotal_)) microTotal_ = scores_.total || 0;
      // B2 (gated): penaliza sensibilidad a tipos en regímenes de tipos altos.
      if (SL_FLAGS.B2_RATE_SENSITIVITY) microTotal_ = Math.max(0, microTotal_ - rateSensitivityPenalty(met_?.netDebtToEBITDATTM, met_?.interestCoverageTTM ?? met_?.interestCoverageRatioTTM, _mt?.quadrant));
      // F4 (gated + weight): reverse-DCF valuation signal into Valuation. DEFAULT
      // weight 0 → no effect even with the flag on. Persisted score = live score.
      if (SL_FLAGS.REVERSE_DCF_ENABLED && RDCF_VALUATION_WEIGHT > 0 && _rdcf?.applicable === true) {
        const safeWeight = Math.max(0, Math.min(1, RDCF_VALUATION_WEIGHT));
        microTotal_ = Math.max(0, Math.min(100, microTotal_ + safeWeight * RDCF.valuationAdj(_rdcf)));
      }

      // AI verdict (con contexto macro/régimen)
      fetchAiVerdict(sym, scores_, pD_, met_, _mt);

      // Persist analysis to Supabase
      if (sb) {
        try {
          const { data: { session: sess } } = await sb.auth.getSession();
          if (sess) {
            await sb.from('sl_analyses').insert({
              user_id: sess.user.id,
              ticker: sym.toUpperCase(),
              analysis_date: new Date().toISOString().slice(0,10),
              score_total: microTotal_, score_val: scores_.val, score_hlth: scores_.hlth,
              score_mom: scores_.mom, score_growth: scores_.growth,
              rating: getRating(microTotal_)?.label,
              macro_tilt: _mt?.tilt || 0,
              sector: pD_?.sector || null,
              // Reverse DCF cache (F2, gated). Flag OFF → key absent → insert
              // object byte-identical to before. Column is nullable/additive.
              ...(SL_FLAGS.REVERSE_DCF_ENABLED ? { reverse_dcf: _rdcf || null } : {}),
            });
          }
        } catch(e) { /* no romper el análisis si falla el guardado */ }

        // Refrescar watchlist (no-blocking; incluye el análisis recién insertado)
        sb.auth.getSession().then(({ data: { session: s2 } }) => { if (s2) loadWatchlist(s2); }).catch(()=>{});

        // Histórico del IC Score (lectura $0; incluye el análisis recién guardado)
        try {
          const { data: histRows } = await sb.from('sl_analyses')
            .select('analysis_date, score_total, macro_tilt')
            .eq('ticker', sym.toUpperCase())
            .order('analysis_date', { ascending: true });
          if (Array.isArray(histRows)) {
            setScoreHistory(histRows.map(row => ({
              date: row.analysis_date,
              ic:   icScore(row.score_total, row.macro_tilt),
            })));
          }
        } catch(e) { /* histórico opcional — no romper el análisis */ }
      }

    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  },[fmpGet, finnhubGet, fetchAiVerdict, loadWatchlist]);

  const handleSearch=()=>{const s=inputTicker.trim().toUpperCase();if(s) analyze(s);};

  // Deep-link: ?ticker=SYM → auto-analiza (acción deliberada del usuario; no viola fetch-on-demand)
  useEffect(() => {
    if (!session) return;                  // espera a estar logueado
    const sym = new URLSearchParams(window.location.search).get('ticker');
    if (sym && /^[A-Za-z0-9.]{1,12}$/.test(sym)) {
      const s = sym.toUpperCase();
      setInputTicker(s);
      analyze(s);
    }
  }, [session, analyze]);   // analyze en deps para evitar closure stale

  // Derived
  const sorted    = useMemo(()=>[...hist].sort((a,b)=>new Date(a.date)-new Date(b.date)),[hist]);
  const priceNow  = quote?.price||sorted[sorted.length-1]?.close;
  const price12m  = sorted[0]?.close;
  const ret12m    = (ok(priceNow)&&ok(price12m)&&price12m>0)?(priceNow-price12m)/price12m:null;
  const chg1d     = quote?.changePercentage;
  const isUpDay   = (chg1d||0)>=0;

  const hasData = !!(quote||prof);
  const r = scores ? getRating(scores.total) : null;

  // ── IC Score (macro × micro) — display layer, NO toca calcScores ──
  const tiltN     = macroTilt?.tilt || 0;
  // B1 (gated): el micro_total mostrado se re-pondera por régimen. Flag off →
  // microTotalLive === scores?.total (idéntico a hoy).
  let microTotalLive = (SL_FLAGS.B1_REGIME_WEIGHTS && scores) ? regimeWeightedTotal(scores, macroTilt?.quadrant) : scores?.total;
  if (SL_FLAGS.B2_RATE_SENSITIVITY && scores) microTotalLive = Math.max(0, microTotalLive - rateSensitivityPenalty(met?.netDebtToEBITDATTM, met?.interestCoverageTTM ?? met?.interestCoverageRatioTTM, macroTilt?.quadrant));
  // F4 (gated + weight): reverse-DCF valuation signal. DEFAULT weight 0 → no effect.
  if (SL_FLAGS.REVERSE_DCF_ENABLED && RDCF_VALUATION_WEIGHT > 0 && scores && reverseDcf?.applicable === true)
    microTotalLive = Math.max(0, Math.min(100, microTotalLive + Math.max(0, Math.min(1, RDCF_VALUATION_WEIGHT)) * RDCF.valuationAdj(reverseDcf)));
  const macroAdj  = icScore(microTotalLive, tiltN);   // IC Score canónico
  const baseRating = scores ? getRating(microTotalLive) : null;
  const adjRating  = scores ? getRating(macroAdj) : null;

  const bm = useMemo(()=>SECTOR_BM[prof?.sector]||null,[prof?.sector]);

  // ── Export Report → PDF (client-side, jsPDF) ──
  const exportPDF = () => {
    const JS = window.jspdf && window.jspdf.jsPDF;
    if (!JS) { alert('Export no disponible: jsPDF no cargó.'); return; }
    const doc = new JS({ unit:'pt', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 48;
    let y = 58;
    const rating = getRating(scores?.total);

    // Title
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(20,20,20);
    doc.text(`${ticker} — ${prof?.companyName || ''}`.trim(), M, y); y += 18;
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(110,110,110);
    const meta = [prof?.exchange, prof?.sector, prof?.industry].filter(Boolean).join('  ·  ');
    if (meta) { doc.text(meta, M, y); y += 13; }
    doc.text(`StockLens · ${new Date().toISOString().slice(0,10)}`, M, y); y += 8;
    doc.setDrawColor(220,220,220); doc.line(M, y, W-M, y); y += 30;

    // Composite score + rating
    doc.setFont('helvetica','bold'); doc.setFontSize(32); doc.setTextColor(30,30,30);
    doc.text(`${scores?.total ?? '—'}`, M, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(120,120,120);
    doc.text('/ 100   Composite Score', M+54, y);
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(40,40,40);
    doc.text(rating?.label || '—', W-M, y, { align:'right' }); y += 30;

    // IC Score (macro × micro) — si hay tilt
    if (macroTilt && tiltN !== 0) {
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120,120,120);
      doc.text(`IC Score: ${macroAdj}/100 (${adjRating?.label || '—'})  ·  tilt ${tiltN>0?'+':''}${tiltN}  ·  régimen ${macroTilt.regime || 'n/d'}`, M, y);
      y += 22;
    }

    // Sub-scores row
    const subs = [
      ['Valuation', `${scores?.val ?? '—'}/25`],
      ['Fin. Health', `${scores?.hlth ?? '—'}/30`],
      ['Momentum', `${scores?.mom ?? '—'}/25`],
      ['Growth', `${scores?.growth ?? '—'}/20`],
    ];
    const colW = (W - 2*M) / subs.length;
    subs.forEach((s, i) => {
      const x = M + i*colW;
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(130,130,130);
      doc.text(s[0].toUpperCase(), x, y);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(40,40,40);
      doc.text(s[1], x, y+15);
    });
    y += 38;
    doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 24;

    // KPI grid (2 columns)
    const kpis = [
      ['Price', fmt.price(priceNow)],
      ['Market Cap', fmt.usd(quote?.marketCap)],
      ['P/E (TTM)', fmt.mult(met?.peRatioTTM ?? met?.priceToEarningsRatioTTM)],
      ['EV/EBITDA', fmt.mult(met?.evToEBITDATTM ?? met?.enterpriseValueOverEBITDATTM)],
      ['ROIC', fmt.pct(met?.returnOnInvestedCapitalTTM ?? met?.roicTTM)],
      ['ROE', fmt.pct(met?.returnOnEquityTTM ?? met?.roeTTM)],
      ['Gross Margin', fmt.pct(rat?.grossProfitMarginTTM)],
      ['Net Debt/EBITDA', fmt.ndx(met?.netDebtToEBITDATTM)],
      ['FCF Yield', fmt.pct(met?.freeCashFlowYieldTTM)],
      ['Beta', ok(quote?.beta) ? quote.beta.toFixed(2) : (ok(prof?.beta) ? parseFloat(prof.beta).toFixed(2) : '—')],
    ];
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
    doc.text('Key Metrics — TTM', M, y); y += 18;
    const kpiColW = (W - 2*M) / 2;
    kpis.forEach((kv, i) => {
      const col = i % 2, row = Math.floor(i/2);
      const x = M + col*kpiColW, ry = y + row*20;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120,120,120);
      doc.text(kv[0], x, ry);
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(40,40,40);
      doc.text(String(kv[1]), x + kpiColW - 14, ry, { align:'right' });
    });
    y += Math.ceil(kpis.length/2)*20 + 14;

    // AI verdict
    if (aiVerdict) {
      doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 22;
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
      doc.text('AI Verdict', M, y); y += 16;
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(70,70,70);
      const lines = doc.splitTextToSize(aiVerdict, W - 2*M);
      doc.text(lines, M, y); y += lines.length*13 + 6;
    }

    // Footer disclaimer
    const H = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('Generado por StockLens · Solo fines informativos, no es consejo de inversión · Verificar con la fuente.', M, H-36);

    doc.save(`${ticker}_StockLens_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  // ── Full Report → PDF extendido (todo en memoria, $0 — no dispara llamadas) ──
  const exportFullPDF = () => {
    const JS = window.jspdf && window.jspdf.jsPDF;
    if (!JS) { alert('Export no disponible: jsPDF no cargó.'); return; }
    const doc = new JS({ unit:'pt', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 48;
    let y = 58;
    const ensure = (need) => { if (y + need > H - 50) { doc.addPage(); y = 58; } };
    const drawLines = (lines, lh) => { lines.forEach(ln => { ensure(lh); doc.text(ln, M, y); y += lh; }); };
    const rating = getRating(scores?.total);

    // Title
    doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.setTextColor(20,20,20);
    doc.text(`${ticker} — ${prof?.companyName || ''}`.trim(), M, y); y += 18;
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(110,110,110);
    const meta = [prof?.exchange, prof?.sector, prof?.industry].filter(Boolean).join('  ·  ');
    if (meta) { doc.text(meta, M, y); y += 13; }
    doc.text(`StockLens · Full Report · ${new Date().toISOString().slice(0,10)}`, M, y); y += 8;
    doc.setDrawColor(220,220,220); doc.line(M, y, W-M, y); y += 30;

    // Composite score (micro) + rating
    doc.setFont('helvetica','bold'); doc.setFontSize(32); doc.setTextColor(30,30,30);
    doc.text(`${scores?.total ?? '—'}`, M, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(11); doc.setTextColor(120,120,120);
    doc.text('/ 100   Composite Score (micro)', M+54, y);
    doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.setTextColor(40,40,40);
    doc.text(rating?.label || '—', W-M, y, { align:'right' }); y += 28;

    // IC Score (macro × micro)
    doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(30,30,30);
    doc.text(`IC Score: ${macroAdj}/100`, M, y);
    doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(120,120,120);
    doc.text(`(${adjRating?.label || '—'})  ·  tilt ${tiltN>0?'+':''}${tiltN}${macroTilt?.regime?`  ·  régimen ${macroTilt.regime}`:''}`, M+120, y);
    y += 24;

    // Sub-scores row
    const subs = [
      ['Valuation', `${scores?.val ?? '—'}/25`],
      ['Fin. Health', `${scores?.hlth ?? '—'}/30`],
      ['Momentum', `${scores?.mom ?? '—'}/25`],
      ['Growth', `${scores?.growth ?? '—'}/20`],
    ];
    const colW = (W - 2*M) / subs.length;
    subs.forEach((s, i) => {
      const x = M + i*colW;
      doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(130,130,130);
      doc.text(s[0].toUpperCase(), x, y);
      doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(40,40,40);
      doc.text(s[1], x, y+15);
    });
    y += 38;
    doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 24;

    // Contexto macro
    if (macroTilt) {
      ensure(70);
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
      doc.text('Contexto macro', M, y); y += 16;
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(70,70,70);
      const macroLine = [
        macroTilt.regime   ? `Régimen: ${macroTilt.regime}` : null,
        macroTilt.quadrant ? `Cuadrante: ${macroTilt.quadrant}` : null,
        `Tilt macro: ${tiltN>0?'+':''}${tiltN}`,
      ].filter(Boolean).join('  ·  ');
      drawLines(doc.splitTextToSize(macroLine, W-2*M), 13); y += 2;
      if ((macroTilt.reasons||[]).length) {
        drawLines(doc.splitTextToSize('Razones: ' + macroTilt.reasons.join(' · '), W-2*M), 13);
      }
      y += 8; doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 24;
    }

    // KPI grid (2 columns)
    const kpis = [
      ['Price', fmt.price(priceNow)],
      ['Market Cap', fmt.usd(quote?.marketCap)],
      ['P/E (TTM)', fmt.mult(met?.peRatioTTM ?? met?.priceToEarningsRatioTTM)],
      ['EV/EBITDA', fmt.mult(met?.evToEBITDATTM ?? met?.enterpriseValueOverEBITDATTM)],
      ['ROIC', fmt.pct(met?.returnOnInvestedCapitalTTM ?? met?.roicTTM)],
      ['ROE', fmt.pct(met?.returnOnEquityTTM ?? met?.roeTTM)],
      ['Gross Margin', fmt.pct(rat?.grossProfitMarginTTM)],
      ['Net Debt/EBITDA', fmt.ndx(met?.netDebtToEBITDATTM)],
      ['FCF Yield', fmt.pct(met?.freeCashFlowYieldTTM)],
      ['Beta', ok(quote?.beta) ? quote.beta.toFixed(2) : (ok(prof?.beta) ? parseFloat(prof.beta).toFixed(2) : '—')],
    ];
    ensure(40 + Math.ceil(kpis.length/2)*20);
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
    doc.text('Key Metrics — TTM', M, y); y += 18;
    const kpiColW = (W - 2*M) / 2;
    kpis.forEach((kv, i) => {
      const col = i % 2, row = Math.floor(i/2);
      const x = M + col*kpiColW, ry = y + row*20;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120,120,120);
      doc.text(kv[0], x, ry);
      doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(40,40,40);
      doc.text(String(kv[1]), x + kpiColW - 14, ry, { align:'right' });
    });
    y += Math.ceil(kpis.length/2)*20 + 14;

    // AI Verdict
    if (aiVerdict) {
      ensure(50);
      doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 22;
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
      ensure(16); doc.text('AI Verdict', M, y); y += 16;
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(70,70,70);
      drawLines(doc.splitTextToSize(aiVerdict, W-2*M), 13); y += 6;
    }

    // AI Earnings — SOLO si ya se generó (no auto-disparar)
    if (transcriptSum && transcriptSum.ticker === ticker) {
      ensure(50);
      doc.setDrawColor(235,235,235); doc.line(M, y, W-M, y); y += 22;
      doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30,30,30);
      ensure(16); doc.text('AI Earnings Analysis', M, y); y += 16;
      const head = [transcriptSum.label, transcriptSum.date].filter(Boolean).join('  ·  ');
      if (head) { doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(120,120,120); ensure(13); doc.text(head, M, y); y += 14; }
      doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(70,70,70);
      drawLines(doc.splitTextToSize(transcriptSum.summary || '', W-2*M), 13); y += 6;
    } else {
      ensure(28);
      doc.setFont('helvetica','italic'); doc.setFontSize(9); doc.setTextColor(150,150,150);
      doc.text('Genera el «Análisis de Earnings» (pestaña Research) para incluirlo en el informe.', M, y); y += 16;
    }

    // Footer disclaimer
    doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('Generado por StockLens · Solo fines informativos, no es consejo de inversión · Verificar con la fuente.', M, H-36);

    doc.save(`${ticker}_StockLens_FullReport_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  // ── Export → CSV (sin dependencias — Blob nativo, abre en Excel/Sheets) ──
  const exportCSV = () => {
    if (!scores || !ticker) return;
    const date = new Date().toISOString().slice(0, 10);
    const rating = getRating(scores.total);
    const n = v => (v == null || !Number.isFinite(v)) ? '' : v;
    const rows = [
      ['StockLens Export', ticker, date],
      [],
      ['Company',         prof?.companyName || ''],
      ['Ticker',          ticker],
      ['Exchange',        prof?.exchange || (intlMeta?.name ?? '')],
      ['Sector',          prof?.sector || ''],
      ['Industry',        prof?.industry || ''],
      ['Export Date',     date],
      [],
      ['── SCORES ──'],
      ['Composite Score', n(scores.total), '/ 100'],
      ['IC Score',        n(macroAdj),     '/ 100'],
      ['Rating',          rating?.label || ''],
      ['Macro Tilt',      n(tiltN),        'pts'],
      ['Valuation',       n(scores.val),   '/ 25'],
      ['Financial Health',n(scores.hlth),  '/ 30'],
      ['Momentum',        n(scores.mom),   '/ 25'],
      ['Growth',          n(scores.growth),'/ 20'],
      [],
      ['── PRICE ──'],
      ['Price',           n(priceNow)],
      ['DCF Fair Value',  n(dcfVal)],
      ['Margin of Safety',ok(mosFrac) ? `${(mosFrac*100).toFixed(1)}%` : ''],
      [],
      ['── KEY METRICS (TTM) ──'],
      ['P/E',             n(met?.peRatioTTM ?? met?.priceToEarningsRatioTTM)],
      ['EV/EBITDA',       n(met?.evToEBITDATTM ?? met?.enterpriseValueOverEBITDATTM)],
      ['P/S',             n(met?.priceToSalesRatioTTM)],
      ['P/B',             n(met?.priceToBookRatioTTM)],
      ['ROE',             ok(met?.returnOnEquityTTM ?? met?.roeTTM) ? `${((met?.returnOnEquityTTM ?? met?.roeTTM)*100).toFixed(1)}%` : ''],
      ['ROIC',            ok(met?.roicTTM) ? `${(met?.roicTTM*100).toFixed(1)}%` : ''],
      ['Net Margin',      ok(rat?.netProfitMarginTTM) ? `${(rat?.netProfitMarginTTM*100).toFixed(1)}%` : ''],
      ['Gross Margin',    ok(rat?.grossProfitMarginTTM) ? `${(rat?.grossProfitMarginTTM*100).toFixed(1)}%` : ''],
      ['Revenue Growth',  ok(rat?.revenueGrowthTTM ?? met?.revenueGrowthTTM) ? `${((rat?.revenueGrowthTTM ?? met?.revenueGrowthTTM)*100).toFixed(1)}%` : ''],
      ['Net Debt/EBITDA', n(met?.netDebtToEBITDATTM)],
      ['Interest Coverage',n(met?.interestCoverageTTM ?? met?.interestCoverageRatioTTM)],
      ['Current Ratio',   n(met?.currentRatioTTM)],
      [],
      ['── ANALYST CONSENSUS ──'],
      ['PT Consensus',    ptList?.length ? `$${(ptList.reduce((s,p)=>s+(p.priceTarget||0),0)/ptList.length).toFixed(2)}` : ''],
      ['# Analysts',      n(ptList?.length)],
      [],
      ['Disclaimer', 'Solo fines informativos. No es consejo de inversión. Verificar con la fuente.'],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${ticker}_StockLens_${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const dcfVal    = dcf?.dcf;
  const mosFrac   = (ok(dcfVal)&&ok(priceNow)&&dcfVal>0)?(dcfVal-priceNow)/dcfVal:null;
  const mosColor  = !ok(mosFrac)?'#787a83':mosFrac>0.15?'#5ac576':mosFrac>-0.15?'#eca851':'#eb6459';

  const healthCards = useMemo(()=>{
    if (!met||!rat) return [];
    const pe=met.peRatioTTM??met.priceToEarningsRatioTTM, ev=met.evToEBITDATTM??met.enterpriseValueOverEBITDATTM;
    const pfcf=met.pfcfRatioTTM??met.priceToFreeCashFlowRatioTTM, gm=rat.grossProfitMarginTTM;
    const roic=met.returnOnInvestedCapitalTTM??met.roicTTM, nd=met.netDebtToEBITDATTM;
    return [
      {label:'P/E Ratio',      value:fmt.mult(pe),   note:'trailing 12 months',  status:ok(pe)&&pe>0?(pe<25?'green':pe<45?'amber':'red'):'neutral'},
      {label:'EV / EBITDA',    value:fmt.mult(ev),   note:'enterprise multiple',  status:ok(ev)&&ev>0?(ev<14?'green':ev<22?'amber':'red'):'neutral'},
      {label:'P / FCF',        value:fmt.mult(pfcf), note:'price / free cash flow',status:ok(pfcf)&&pfcf>0?(pfcf<20?'green':pfcf<35?'amber':'red'):'neutral'},
      {label:'Gross Margin',   value:fmt.pct(gm),    note:'revenue − COGS (TTM)', status:ok(gm)?(gm>=0.40?'green':gm>=0.20?'amber':'red'):'neutral'},
      {label:'ROIC',           value:fmt.pct(roic),  note:'return on invested capital',status:ok(roic)?(roic>=0.15?'green':roic>=0.06?'amber':'red'):'neutral'},
      {label:'Net Debt/EBITDA',value:fmt.ndx(nd),    note:ok(nd)&&nd<0?'net cash position':'leverage ratio',status:ok(nd)?(nd<0.5?'green':nd<2.5?'amber':'red'):'neutral'},
    ];
  },[met,rat]);

  const tabs=['Overview','Fundamentals','Screener','⚖ Comparar','Smart Money','Valuation',
    ...(SL_FLAGS.REVERSE_DCF_ENABLED ? ['Descuento'] : []),   // F3: tab gated — absent when flag off
    'Chart','Research'];

  if (!authChecked) return null;
  if (!session) return <LoginScreen/>;

  return (
    <div style={{
      minHeight:'100vh',background:'#15151c',color:'#edeef4',
      fontFamily:"'Hanken Grotesk',-apple-system,BlinkMacSystemFont,sans-serif",
      paddingBottom:60
    }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#15151c}
        ::-webkit-scrollbar-thumb{background:#24262f;border-radius:3px}
        input::placeholder{color:#33353f}
        a{color:inherit;text-decoration:none}
        button:hover{opacity:0.88}
      `}</style>

      {/* ── Sticky compact sub-header ── */}
      {scrolled&&hasData&&ticker&&(
        <div style={{
          position:'fixed',top:52,left:0,right:0,zIndex:190,
          background:'#15151cee',backdropFilter:'blur(8px)',
          borderBottom:'1px solid #1c1d26',
          padding:'8px 24px',display:'flex',alignItems:'center',gap:12
        }}>
          {prof?.image&&<img src={prof.image} alt={ticker} style={{width:22,height:22,objectFit:'contain',borderRadius:3,background:'#fff',padding:2}}/>}
          <span style={{fontSize:14,fontWeight:800,color:'#fff',fontFamily:'Geist Mono,monospace'}}>{ticker}</span>
          <span style={{fontSize:12,color:'#787a83'}}>{prof?.companyName}</span>
          <span style={{fontSize:14,fontWeight:700,color:'#edeef4',fontFamily:'Geist Mono,monospace',marginLeft:'auto'}}>{fmt.price(priceNow)}</span>
          <span style={{fontSize:12,fontWeight:600,color:isUpDay?'#5ac576':'#eb6459'}}>{isUpDay?'▲':'▼'}{Math.abs(chg1d||0).toFixed(2)}%</span>
          {r&&<div style={{padding:'2px 10px',borderRadius:12,background:r.bg,border:`1px solid ${r.border}`,fontSize:10,fontWeight:700,color:r.color,letterSpacing:'1px'}}>{r.label}</div>}
          {macroTilt && macroTilt.tilt !== 0 && (
            <span title={(macroTilt?.reasons||[]).join(" · ")}
              style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",marginLeft:8,borderRadius:4,
                background: macroTilt.tilt>0 ? "#5ac57622":"#eb645922",
                border:`1px solid ${macroTilt.tilt>0?"#5ac576":"#eb6459"}`,
                fontSize:11,fontFamily:"Geist Mono,monospace",cursor:"help"}}>
              Macro Tilt: {macroTilt.tilt>0?"+":""}{macroTilt.tilt}
            </span>
          )}
          {macroTilt && macroTilt.fearGreed != null && (
            <span title={`CNN Fear & Greed ${macroTilt.fearGreed}/100 (${macroTilt.fgRating||'—'})${macroTilt.putCall!=null?` · Put/Call ${macroTilt.putCall}`:''}. Contrarian: euforia = cautela, pánico = oportunidad.`}
              style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",marginLeft:8,borderRadius:4,
                background: macroTilt.sentimentSignal==="euforia" ? "#eb645922" : macroTilt.sentimentSignal==="panico" ? "#5ac57622" : "#787a8322",
                border:`1px solid ${macroTilt.sentimentSignal==="euforia" ? "#eb6459" : macroTilt.sentimentSignal==="panico" ? "#5ac576" : "#787a83"}`,
                fontSize:11,fontFamily:"Geist Mono,monospace",cursor:"help"}}>
              F&G {macroTilt.fearGreed}{macroTilt.putCall!=null?` · P/C ${macroTilt.putCall}`:""}
            </span>
          )}
        </div>
      )}

      {/* ── Top navbar ── */}
      <div style={{
        background:'#15151c',borderBottom:'1px solid #1c1d26',
        padding:'0 24px',display:'flex',flexDirection:'column',
        position:'sticky',top:0,zIndex:200
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:18,fontWeight:800,color:'#fff',letterSpacing:'-0.5px'}}>⚡ StockLens</span>
            <a href="https://ic-datalayer-app.vercel.app" target="_blank" rel="noopener noreferrer"
               title="Ver régimen macro completo (IC DataLayer)"
               style={{fontSize:11,color:'#968ff7',textDecoration:'none'}}>🌐 Macro ↗</a>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input
              value={inputTicker}
              onChange={e=>setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==='Enter'&&handleSearch()}
              placeholder="AAPL / MC.PA"
              maxLength={12}
              style={{
                background:'#1c1d26',border:'1px solid #24262f',color:'#fff',
                padding:'7px 13px',borderRadius:6,fontSize:13,fontWeight:700,
                width:130,outline:'none',fontFamily:'Geist Mono,monospace',
                letterSpacing:'1px',textTransform:'uppercase'
              }}
            />
            <button onClick={handleSearch} disabled={loading||!inputTicker.trim()} style={{
              background:loading?'#24262f':'#968ff7',color:loading?'#edeef4':'#15151c',border:'none',
              padding:'7px 18px',borderRadius:6,cursor:loading?'not-allowed':'pointer',
              fontSize:13,fontWeight:600,whiteSpace:'nowrap'
            }}>{loading?'…':'Analyze'}</button>
            {!autoLoaded&&(
              <button onClick={()=>setAutoLoaded(true)} title="Activar Screener y Smart Money" style={{
                background:'#24262f',color:'#a6a7b1',
                border:'1px solid #33353f',padding:'7px 13px',borderRadius:6,
                cursor:'pointer',fontSize:11,whiteSpace:'nowrap'
              }}>⬇ Cargar contexto</button>
            )}
            <button onClick={() => sb && sb.auth.signOut()} title="Sign out" style={{
              background:'#1c1d26',color:'#787a83',
              border:'1px solid #24262f',padding:'7px 11px',borderRadius:6,
              cursor:'pointer',fontSize:13
            }}>⏻</button>
          </div>
        </div>
        {recentTickers.length>0&&(
          <div style={{display:'flex',gap:6,paddingBottom:8,alignItems:'center'}}>
            <span style={{fontSize:9,color:'#33353f',textTransform:'uppercase',letterSpacing:'0.5px',marginRight:2}}>Recent:</span>
            {recentTickers.map(t=>(
              <button key={t} onClick={()=>{setInputTicker(t);analyze(t);}} style={{
                background:'#1c1d26',border:'1px solid #24262f',color:'#787a83',
                padding:'2px 10px',borderRadius:4,cursor:'pointer',fontSize:11,
                fontFamily:'Geist Mono,monospace',fontWeight:600
              }}>{t}</button>
            ))}
          </div>
        )}
      </div>


      {/* ── Content ── */}
      <div style={{maxWidth:1120,margin:'0 auto',padding:'0 24px'}}>

        {/* Empty state / Watchlist */}
        {!loading&&!hasData&&!error&&(
          watchlist.length > 0
            ? <WatchlistPanel rows={watchlist} onAnalyze={t=>{setInputTicker(t);analyze(t);}}/>
            : (
              <div style={{textAlign:'center',padding:'90px 20px'}}>
                <div style={{fontSize:52,marginBottom:14}}>⚡</div>
                <div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens</div>
                <div style={{fontSize:13,color:'#33353f',maxWidth:400,margin:'0 auto 32px',lineHeight:1.7}}>
                  Professional stock analysis — enter any ticker to get started. 4-dimensional scoring: valuation, financial health, momentum, and growth.
                </div>
                <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
                  {['AAPL','MSFT','NVDA','AMZN','META','COST','V','ASML'].map(t=>(
                    <button key={t} onClick={()=>{setInputTicker(t);analyze(t);}} style={{
                      background:'#1c1d26',border:'1px solid #24262f',color:'#a6a7b1',
                      padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,
                      fontFamily:'Geist Mono,monospace',fontWeight:600
                    }}>{t}</button>
                  ))}
                </div>
                <div style={{fontSize:10,color:'#33353f',marginTop:20,marginBottom:8,textTransform:'uppercase',letterSpacing:'0.8px'}}>International — formato TICKER.BOLSA</div>
                <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
                  {[
                    {t:'MC.PA',  l:'LVMH 🇫🇷'},
                    {t:'SAP.DE', l:'SAP 🇩🇪'},
                    {t:'NESN.SW',l:'Nestlé 🇨🇭'},
                    {t:'BP.L',   l:'BP 🇬🇧'},
                    {t:'AIR.PA', l:'Airbus 🇫🇷'},
                    {t:'SIE.DE', l:'Siemens 🇩🇪'},
                  ].map(({t,l})=>(
                    <button key={t} onClick={()=>{setInputTicker(t);analyze(t);}} style={{
                      background:'#1c1d26',border:'1px solid #24262f',color:'#a6a7b1',
                      padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,
                      fontFamily:'Geist Mono,monospace',fontWeight:600
                    }}>{l} · {t}</button>
                  ))}
                </div>
              </div>
            )
        )}

        {/* Loading skeleton */}
        {loading&&<LoadingSkeleton/>}

        {/* Error */}
        {!loading&&error&&(
          <div style={{background:'#602a25',border:'1px solid #602a25',borderRadius:8,padding:'16px 20px',margin:'24px 0'}}>
            <div style={{color:'#eb6459',fontSize:13,marginBottom:error.includes('limit')?12:0}}>
              ⚠ {error}
            </div>
            {error.includes('limit')&&(
              <div style={{fontSize:11,color:'#787a83',marginTop:8}}>
                Try again in about a minute.
              </div>
            )}
          </div>
        )}

        {/* ── Main analysis ── */}
        {!loading&&hasData&&(
          <div style={{paddingTop:20,display:'flex',flexDirection:'column',gap:0}}>

            {/* Company header */}
            <Panel style={{marginBottom:0,borderBottomLeftRadius:0,borderBottomRightRadius:0,borderBottom:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                <div style={{display:'flex',gap:14,alignItems:'flex-start'}}>
                  {prof?.image&&(
                    <img src={prof.image} alt={ticker} style={{width:44,height:44,objectFit:'contain',borderRadius:6,background:'#fff',padding:4,flexShrink:0}}/>
                  )}
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                      <span style={{fontSize:11,color:'#33353f'}}>{[prof?.exchange,prof?.sector,prof?.industry].filter(Boolean).join(' · ')}</span>
                      {prof?.exchange&&(
                        <span style={{
                          fontSize:9,padding:'1px 6px',borderRadius:3,fontWeight:700,
                          background:prof.exchange.includes('NASDAQ')?'#34315f':prof.exchange.includes('NYSE')?'#194224':'#54360b',
                          color:prof.exchange.includes('NASDAQ')?'#968ff7':prof.exchange.includes('NYSE')?'#5ac576':'#eca851'
                        }}>{prof.exchange}</span>
                      )}
                      {intlMeta?.flag && intlMeta?.short &&(
                        <span title={intlMeta.name || intlMeta.short} style={{
                          fontSize:9,padding:'1px 7px',borderRadius:3,fontWeight:700,
                          background:'#24262f',border:'1px solid #33353f',color:'#a6a7b1',cursor:'help'
                        }}>{intlMeta.flag} {intlMeta.short}</span>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}>
                      <div style={{fontSize:28,fontWeight:800,color:'#fff',fontFamily:'Geist Mono,monospace'}}>
                        {intlMeta
                          ? <>{intlMeta.base}<span style={{color:'#33353f',fontSize:18}}>{intlMeta.suffix}</span></>
                          : ticker}
                      </div>
                      <div style={{fontSize:16,color:'#a6a7b1',fontWeight:500}}>{prof?.companyName}</div>
                    </div>
                    <div style={{display:'flex',gap:14,marginTop:6,fontSize:11,color:'#787a83',flexWrap:'wrap'}}>
                      {prof?.ceo&&<span>CEO: {prof.ceo}</span>}
                      {prof?.fullTimeEmployees&&<span>👥 {Number(prof.fullTimeEmployees).toLocaleString()} employees</span>}
                      {prof?.ipoDate&&<span>Est. {prof.ipoDate?.substring(0,4)}</span>}
                      {(()=>{const tg=ipoEventTag(prof);return tg?<span title={tg.note} style={{padding:'1px 7px',borderRadius:20,fontWeight:700,color:tg.color,background:`color-mix(in srgb, ${tg.color} 14%, transparent)`,border:`1px solid color-mix(in srgb, ${tg.color} 32%, transparent)`}}>⚑ {tg.label}</span>:null;})()}
                      {prof?.website&&<a href={prof.website} target="_blank" rel="noopener noreferrer" style={{color:'#968ff7'}}>{prof.website?.replace(/^https?:\/\//,'')}</a>}
                    </div>
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:32,fontWeight:800,color:'#fff',fontFamily:'Geist Mono,monospace',lineHeight:1}}>
                    {fmt.price(priceNow)}
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:isUpDay?'#5ac576':'#eb6459',marginTop:3}}>
                    {isUpDay?'▲':'▼'} {Math.abs(chg1d||0).toFixed(2)}% today
                  </div>
                  {ok(ret12m)&&(
                    <div style={{fontSize:11,color:ret12m>=0?'#5ac576':'#eb6459'}}>
                      {ret12m>=0?'▲':'▼'} {Math.abs(ret12m*100).toFixed(1)}% past 12m
                    </div>
                  )}
                  <div style={{fontSize:11,color:'#33353f',marginTop:3}}>
                    Mkt Cap {fmt.usd(quote?.marketCap)} · Avg Vol {fmt.usd(quote?.averageVolume ?? quote?.avgVolume ?? quote?.volAvg)}
                  </div>
                  <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:8}}>
                    <button
                      onClick={()=>setActiveTab('Valuation')}
                      style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:5,padding:'5px 12px',color:'#968ff7',fontSize:11,cursor:'pointer'}}
                    >→ See Valuation</button>
                    <button
                      onClick={exportCSV}
                      title="Exportar KPIs a CSV (abre en Excel / Google Sheets)"
                      style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:5,padding:'5px 12px',color:'#5ac576',fontSize:11,cursor:'pointer'}}
                    >⬇ CSV</button>
                    <button
                      onClick={exportPDF}
                      title="Descargar informe en PDF"
                      style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:5,padding:'5px 12px',color:'#a6a7b1',fontSize:11,cursor:'pointer'}}
                    >⬇ PDF</button>
                    <button
                      onClick={exportFullPDF}
                      title="Informe completo: IC Score + macro + AI Verdict + earnings (si ya se generó)"
                      style={{background:'#1c1d26',border:'1px solid #34315f',borderRadius:5,padding:'5px 12px',color:'#968ff7',fontSize:11,cursor:'pointer'}}
                    >📄 Full Report</button>
                  </div>
                </div>
              </div>
            </Panel>

            {/* Tab bar */}
            <div style={{
              background:'#15151c',borderLeft:'1px solid #1c1d26',borderRight:'1px solid #1c1d26',
              display:'flex',gap:0,
              position:'sticky',top:52+(recentTickers.length>0?32:0),zIndex:100
            }}>
              {tabs.map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab)} style={{
                  background:'none',border:'none',borderBottom:activeTab===tab?'2px solid #968ff7':'2px solid transparent',
                  color:activeTab===tab?'#edeef4':'#787a83',
                  padding:'10px 20px',cursor:'pointer',fontSize:12,fontWeight:600,
                  letterSpacing:'0.3px',transition:'color 0.15s',whiteSpace:'nowrap'
                }}>{tab}</button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{
              background:'#15151c',border:'1px solid #1c1d26',
              borderTop:'none',borderBottomLeftRadius:10,borderBottomRightRadius:10,
              padding:'20px 24px',display:'flex',flexDirection:'column',gap:16
            }}>

              {/* ── OVERVIEW TAB ── */}
              {activeTab==='Overview'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14}}>
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:18,padding:'4px 0'}}>
                      <ScoreGauge score={scores.total}/>
                      <div style={{width:'100%'}}>
                        <ScoreBar label="Valuation"        value={scores.val}    max={25} color="#968ff7"/>
                        <ScoreBar label="Financial Health"  value={scores.hlth}   max={30} color="#5ac576"/>
                        <ScoreBar label="Momentum"          value={scores.mom}    max={25} color="#eca851"/>
                        <ScoreBar label="Growth"            value={scores.growth} max={20} color="#968ff7"/>
                      </div>

                      {/* ── Frescura macro (cron macro-refresh) — $0, solo dato ya cargado ── */}
                      {macroTilt && macroTilt.updatedAt && (()=>{
                        const fr = macroFreshness(macroTilt.updatedAt);
                        if (!fr) return null;
                        return (
                          <div title={fr.warn || `macro_state actualizado ${new Date(macroTilt.updatedAt).toLocaleString()}`}
                            style={{alignSelf:'flex-start',display:'inline-flex',alignItems:'center',gap:5,
                              padding:'2px 8px',borderRadius:10,background:`${fr.color}22`,
                              border:`1px solid ${fr.color}`,fontSize:9,fontWeight:700,color:fr.color,
                              fontFamily:'Geist Mono,monospace',cursor:'help'}}>
                            <span style={{width:6,height:6,borderRadius:'50%',background:fr.color}}/>
                            macro: {fr.age}{fr.warn?' ⚠':''}
                          </div>
                        );
                      })()}

                      {/* ── IC Score (macro × micro) — score unificado ── */}
                      {macroTilt && tiltN !== 0 ? (
                        <div style={{width:'100%',background:'#15151c',border:`1px solid ${tiltN>0?'#194224':'#602a25'}`,borderRadius:8,padding:'10px 12px',display:'flex',flexDirection:'column',gap:6}}>
                          <div style={{fontSize:9,color:'#787a83',textTransform:'uppercase',letterSpacing:'0.7px',fontWeight:700}}>IC Score (macro × micro)</div>
                          <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                            <span style={{fontSize:28,fontWeight:800,color:adjRating?.color,fontFamily:'Geist Mono,monospace',lineHeight:1}}>{macroAdj}</span>
                            <span style={{fontSize:12,fontWeight:700,color:tiltN>0?'#5ac576':'#eb6459',fontFamily:'Geist Mono,monospace'}}>{tiltN>0?'+':''}{tiltN}</span>
                            <span style={{marginLeft:'auto',fontSize:10,fontWeight:700,color:adjRating?.color,letterSpacing:'1px'}}>{adjRating?.label}</span>
                          </div>
                          {adjRating&&baseRating&&adjRating.label!==baseRating.label&&(
                            <div style={{fontSize:10,fontWeight:700,color:tiltN>0?'#5ac576':'#eb6459'}}>{baseRating.label} → {adjRating.label} por macro</div>
                          )}
                          {(macroTilt.regime||macroTilt.quadrant)&&(
                            <div style={{fontSize:9,color:'#787a83',lineHeight:1.4}}>{macroTilt.regime?`Régimen: ${macroTilt.regime}`:''}{macroTilt.quadrant?` · ${macroTilt.quadrant}`:''}</div>
                          )}
                          {(macroTilt.reasons||[]).length>0&&(
                            <div style={{fontSize:9,color:'#787a83',lineHeight:1.4}} title={(macroTilt.reasons||[]).join(' · ')}>{(macroTilt.reasons||[]).join(' · ')}</div>
                          )}
                          <div style={{fontSize:8,color:'#33353f'}}>Titular = score micro ({scores.total}). IC Score = micro + tilt macro, acotado 0–100.</div>
                        </div>
                      ) : macroTilt ? (
                        <div style={{width:'100%',fontSize:9,color:'#33353f',textAlign:'center'}}>Sin ajuste macro para este perfil</div>
                      ) : null}

                      {/* ── Histórico del IC Score (sparkline temporal, lee sl_analyses, $0) ── */}
                      {scoreHistory.length >= 2 && <ScoreHistorySparkline data={scoreHistory}/>}

                      {earnCalendar&&<EarningsCalendarBadge earn={earnCalendar}/>}
                    </div>
                    <div>
                      <SectionTitle>Key Metrics — TTM</SectionTitle>
                      {ok(quote?.yearHigh) && ok(quote?.yearLow) && ok(priceNow) && (
                        <div style={{marginBottom:14}}>
                          <div style={{fontSize:10,color:'#787a83',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>52-Week Range</div>
                          <div style={{position:'relative',height:6,background:'#24262f',borderRadius:3}}>
                            <div style={{
                              position:'absolute',left:0,
                              width:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
                              height:'100%',background:'#968ff7',borderRadius:3,transition:'width 0.8s ease'
                            }}/>
                            <div style={{
                              position:'absolute',
                              left:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
                              top:-3,transform:'translateX(-50%)',
                              width:12,height:12,background:'#fff',borderRadius:'50%',border:'2px solid #968ff7'
                            }}/>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'#787a83',fontFamily:'Geist Mono,monospace'}}>
                            <span>{fmt.price(quote.yearLow)} <span style={{color:'#33353f'}}>52W Low</span></span>
                            <span style={{color:'#edeef4',fontWeight:700}}>{fmt.price(priceNow)}</span>
                            <span><span style={{color:'#33353f'}}>52W High</span> {fmt.price(quote.yearHigh)}</span>
                          </div>
                        </div>
                      )}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:9}}>
                        <KPIBadge label="P/E Ratio"      value={fmt.mult(met?.peRatioTTM??met?.priceToEarningsRatioTTM)}         sub="trailing 12 months"    bmVal={bm?.pe}   bmLabel="sector avg"/>
                        <KPIBadge label="EV/EBITDA"       value={fmt.mult(met?.evToEBITDATTM??met?.enterpriseValueOverEBITDATTM)}   sub="enterprise value mult." bmVal={bm?.ev}   bmLabel="sector avg"/>
                        <KPIBadge label="P/FCF"           value={fmt.mult(met?.pfcfRatioTTM??met?.priceToFreeCashFlowRatioTTM??met?.priceToFreeCashFlowsRatioTTM)}     sub="price / free cash flow"/>
                        <KPIBadge label="Gross Margin"    value={fmt.pct(rat?.grossProfitMarginTTM)}             sub="TTM"
                          highlight={ok(rat?.grossProfitMarginTTM)?(rat.grossProfitMarginTTM>=0.4?'#5ac576':rat.grossProfitMarginTTM>=0.2?'#eca851':'#eb6459'):undefined}
                          bmVal={bm?.gm} bmLabel="sector avg"/>
                        <KPIBadge label="ROIC"            value={fmt.pct(met?.returnOnInvestedCapitalTTM??met?.roicTTM)}       sub="return on inv. capital"
                          highlight={ok(met?.returnOnInvestedCapitalTTM??met?.roicTTM)?((met?.returnOnInvestedCapitalTTM??met?.roicTTM)>=0.15?'#5ac576':(met?.returnOnInvestedCapitalTTM??met?.roicTTM)>=0.06?'#eca851':'#eb6459'):undefined}
                          bmVal={bm?.roic} bmLabel="sector avg"/>
                        <KPIBadge label="Net Debt/EBITDA" value={fmt.ndx(met?.netDebtToEBITDATTM)}              sub={ok(met?.netDebtToEBITDATTM)&&met.netDebtToEBITDATTM<0?'net cash position':'leverage'}
                          highlight={ok(met?.netDebtToEBITDATTM)?(met.netDebtToEBITDATTM<0?'#5ac576':met.netDebtToEBITDATTM<2?'#eca851':'#eb6459'):undefined}/>
                        <KPIBadge label="FCF Yield"       value={fmt.pct(met?.freeCashFlowYieldTTM)}            sub="TTM"/>
                        <KPIBadge label="ROE"             value={fmt.pct(met?.returnOnEquityTTM??met?.roeTTM)}               sub="return on equity"/>
                        <KPIBadge label="Interest Coverage" value={fmt.mult(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)}     sub="EBIT / interest expense"
                          highlight={ok(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)?((met?.interestCoverageTTM??met?.interestCoverageRatioTTM)>=10?'#5ac576':(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)>=3?'#eca851':'#eb6459'):undefined}/>
                        <KPIBadge label="P/Book"      value={fmt.mult(rat?.priceToBookRatioTTM??met?.pbRatioTTM)}     sub="price / book value"/>
                        <KPIBadge label="P/Sales"     value={fmt.mult(rat?.priceToSalesRatioTTM)}   sub="price / revenue TTM"/>
                        <KPIBadge label="Div. Yield"  value={fmt.pct(met?.dividendYieldTTM)}         sub="annual dividend yield"/>
                        <KPIBadge label="Beta"        value={ok(quote?.beta) ? quote.beta.toFixed(2) : (ok(prof?.beta) ? parseFloat(prof.beta).toFixed(2) : '—')} sub="market sensitivity"/>
                      </div>
                    </div>
                  </div>

                  <HealthScorePanel met={met} rat={rat} hist={hist} stmts={stmts} scores={scores}/>

                  {(ptC||udC)&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <AnalystPanel ptC={ptC} udC={udC} analystEst={analystEst} currentPrice={priceNow} ptList={ptList}/>
                    </div>
                  )}

                  <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                    <ShortInterestPanel data={shortInt} quote={quote}/>
                  </div>

                  {prof?.description&&(
                    <div>
                      <SectionTitle>About {prof.companyName}</SectionTitle>
                      <AboutText text={prof.description}/>
                    </div>
                  )}

                  <div style={{padding:16,background:'#15151c',border:'1px solid #24262f',borderRadius:8,marginTop:16}}>
                    <CarteraKMatrix activeQuadrant={macroTilt?.quadrant || null} />
                  </div>
                </div>
              )}

              {/* ── FUNDAMENTALS TAB ── */}
              {activeTab==='Fundamentals'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <div>
                    <SectionTitle>Health Checks — Valuation · Profitability · Leverage</SectionTitle>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                      {healthCards.map((c,i)=><HealthCard key={i} {...c}/>)}
                    </div>
                  </div>
                  {stmts.length>=2&&<GrowthPanel stmts={stmts}/>}
                  {stmts.length>0&&<QuarterlyTable stmts={stmts}/>}
                  {peers.length>0&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <PeerComparison
                        peers={peers}
                        peerMetrics={peerMetrics}
                        currentMet={met}
                        currentRat={rat}
                        currentProf={prof}
                        onAnalyze={s=>{ setInputTicker(s); analyze(s); }}
                      />
                    </div>
                  )}
                  {balanceSheets.length>0&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <BalanceSheetPanel bsData={balanceSheets}/>
                    </div>
                  )}
                  {cfStmts.length>0&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <FCFPanel cfData={cfStmts} incomeData={stmts}/>
                    </div>
                  )}
                  {stmts.length>=2&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <DilutionPanel stmts={stmts} cfData={cfStmts}/>
                    </div>
                  )}
                  {historicalDivs.length>0&&(
                    <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                      <DividendsPanel divData={historicalDivs} met={met} currentPrice={priceNow}/>
                    </div>
                  )}
                </div>
              )}

              {/* ── VALUATION TAB ── */}
              {activeTab==='Valuation'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <DCFCalculator inputs={dcfInputs} setInputs={setDcfInputs} currentPrice={priceNow} profile={prof}/>
                  <MultiModelValuation met={met} rat={rat} quote={quote} prof={prof} stmts={stmts} currentPrice={priceNow}/>
                  {stmts.length>=4&&(
                    <EVEBITDAHistory
                      stmts={stmts}
                      balanceSheets={balanceSheets}
                      history={hist}
                      shares={quote?.sharesOutstanding ?? (ok(quote?.marketCap)&&ok(priceNow)&&priceNow>0 ? quote.marketCap/priceNow : null)}
                    />
                  )}
                </div>
              )}

              {/* ── CHART TAB ── */}
              {activeTab==='Chart'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <div>
                    <div style={{display:'flex',gap:6,marginBottom:10,alignItems:'center'}}>
                      <span style={{fontSize:10,color:'#787a83',marginRight:4}}>PERIOD:</span>
                      {['1M','3M','6M','1Y','5Y'].map(p=>(
                        <button key={p} onClick={()=>setChartPeriod(p)} style={{
                          background:chartPeriod===p?'#34315f':'#1c1d26',
                          color:chartPeriod===p?'#968ff7':'#787a83',
                          border:`1px solid ${chartPeriod===p?'#968ff7':'#24262f'}`,
                          padding:'3px 12px',borderRadius:4,cursor:'pointer',fontSize:11,
                          fontFamily:'Geist Mono,monospace',fontWeight:600
                        }}>{p}</button>
                      ))}
                    </div>
                    {hist.length>0
                      ? <PriceChart history={hist} ticker={ticker} period={chartPeriod}/>
                      : <div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'#33353f',fontSize:12}}>No price data</div>
                    }
                  </div>
                  <TechnicalSignals history={hist} spyHistory={spyHistory}/>
                  {stmts.length>=1&&hist.length>0&&(()=>{
                    const annualEps=(stmts[0]?.eps||0)*4;
                    if(!ok(annualEps)||annualEps<=0) return null;
                    const sorted2=[...hist].sort((a,b)=>new Date(a.date)-new Date(b.date));
                    const peHistory=sorted2.slice(-252).map(d=>({date:d.date,pe:d.close/annualEps}));
                    const peValues=peHistory.map(d=>d.pe).filter(ok);
                    if(!peValues.length) return null;
                    const peMin=Math.min(...peValues).toFixed(1);
                    const peMax=Math.max(...peValues).toFixed(1);
                    const peCurrent=(priceNow/annualEps).toFixed(1);
                    return (
                      <div>
                        <SectionTitle>Historical P/E — 1 Year</SectionTitle>
                        <div style={{fontSize:11,color:'#787a83',marginBottom:8}}>
                          Current P/E: <span style={{color:'#edeef4',fontWeight:700,fontFamily:'Geist Mono,monospace'}}>{peCurrent}x</span>
                          &nbsp;·&nbsp; Range: <span style={{fontFamily:'Geist Mono,monospace'}}>{peMin}x – {peMax}x</span>
                        </div>
                        <Sparkline data={peHistory.map(d=>d.pe)} type="line" color="#968ff7" h={60} w={760}/>
                        <div style={{fontSize:9,color:'#33353f',marginTop:4}}>Based on trailing quarterly EPS × 4 (annualized)</div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── SCREENER TAB ── */}
              {activeTab==='Screener'&&(
                autoLoaded
                  ? <WatchlistManager supabase={sb} onAnalyze={(t)=>{ setInputTicker(t); setActiveTab('Overview'); analyze(t); }}/>
                  : <div style={{textAlign:'center',padding:'60px 20px'}}>
                      <div style={{fontSize:13,color:'#787a83',marginBottom:20}}>Activa el contexto para cargar el screener.</div>
                      <button onClick={()=>setAutoLoaded(true)} style={{background:'#968ff7',color:'#fff',border:'none',padding:'10px 24px',borderRadius:6,cursor:'pointer',fontWeight:600,fontSize:13}}>⬇ Cargar contexto</button>
                    </div>
              )}

              {/* ── COMPARAR TAB (lee sl_analyses/sl_watchlist, $0) ── */}
              {activeTab==='⚖ Comparar'&&(
                <CompareView supabase={sb} onAnalyze={(t)=>{ setInputTicker(t); setActiveTab('Overview'); analyze(t); }}/>
              )}

              {/* ── SMART MONEY TAB ── */}
              {activeTab==='Smart Money'&&(
                <div style={{display:'flex',flexDirection:'column',gap:24}}>
                  {autoLoaded
                    ? <>
                        <InsiderTrackerPanel supabase={sb}/>
                        <ConsensusPanel supabase={sb}/>
                        <Funds13FPanel supabase={sb}/>
                        <JensenPatternPanel fmpGet={fmpGet}/>
                      </>
                    : <div style={{textAlign:'center',padding:'60px 20px'}}>
                        <div style={{fontSize:13,color:'#787a83',marginBottom:20}}>Activa el contexto para cargar los datos Smart Money.</div>
                        <button onClick={()=>setAutoLoaded(true)} style={{background:'#968ff7',color:'#fff',border:'none',padding:'10px 24px',borderRadius:6,cursor:'pointer',fontWeight:600,fontSize:13}}>⬇ Cargar contexto</button>
                      </div>
                  }
                </div>
              )}

              {/* ── DESCUENTO TAB (Reverse DCF, F3, gated) ── */}
              {SL_FLAGS.REVERSE_DCF_ENABLED && activeTab==='Descuento' && (
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  {reverseDcf
                    ? <ReverseDcfCard data={reverseDcf}/>
                    : <div style={{textAlign:'center',padding:'60px 20px',fontSize:13,color:'#787a83'}}>Analiza un ticker para ver qué descuenta su precio.</div>}
                </div>
              )}

              {/* ── RESEARCH TAB ── */}
              {activeTab==='Research'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <OvervaluationBanner metrics={met} ratios={rat} profile={prof}/>
                  <FactorTiltCard metrics={met} ratios={rat} history={hist} stmts={stmts} profile={prof}/>
                  <QualityMoatCard metrics={met} ratios={rat} stmts={stmts} profile={prof}/>
                  <VerdictSection scores={scores} profile={prof} metrics={met} ratios={rat} aiVerdict={aiVerdict} aiLoading={aiLoading}/>

                  {/* AI Earnings Analysis — datos FMP free + Sonnet, gated por botón (1 llamada Anthropic) */}
                  <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'16px 20px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                      <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',color:'#33353f'}}>AI Earnings Analysis</div>
                      <button
                        onClick={summarizeEarnings}
                        disabled={transcriptLoading}
                        style={{
                          background:transcriptLoading?'#24262f':'#968ff7',color:'#fff',border:'none',
                          padding:'7px 14px',borderRadius:6,cursor:transcriptLoading?'not-allowed':'pointer',
                          fontSize:12,fontWeight:600,whiteSpace:'nowrap'
                        }}
                      >{transcriptLoading?'Analizando…':'📊 Analizar últimos earnings'}</button>
                    </div>

                    {transcriptLoading&&(
                      <div style={{marginTop:14,fontSize:12,color:'#787a83'}}>Analizando earnings con Claude Sonnet…</div>
                    )}

                    {!transcriptLoading&&transcriptError==='empty'&&(
                      <div style={{marginTop:14,fontSize:11,color:'#787a83',background:'#15151c',border:'1px solid #24262f',borderRadius:6,padding:'10px 14px'}}>
                        Sin datos de earnings suficientes para analizar {ticker}.
                      </div>
                    )}

                    {!transcriptLoading&&transcriptError&&transcriptError!=='empty'&&(
                      <div style={{marginTop:14,fontSize:11,color:'#eb6459',background:'#602a25',border:'1px solid #602a25',borderRadius:6,padding:'10px 14px'}}>
                        ⚠ {transcriptError}
                      </div>
                    )}

                    {!transcriptLoading&&transcriptSum&&transcriptSum.ticker===ticker&&(
                      <div style={{marginTop:14}}>
                        <div style={{display:'flex',gap:10,alignItems:'baseline',marginBottom:10,flexWrap:'wrap'}}>
                          <span style={{fontSize:12,fontWeight:700,color:'#edeef4',fontFamily:'Geist Mono,monospace'}}>{transcriptSum.label}</span>
                          {transcriptSum.date&&<span style={{fontSize:10,color:'#787a83'}}>{transcriptSum.date}</span>}
                        </div>
                        <div style={{fontSize:12.5,color:'#a6a7b1',lineHeight:1.7,whiteSpace:'pre-wrap'}}>{transcriptSum.summary}</div>
                        <div style={{fontSize:9,color:'#33353f',marginTop:12,fontStyle:'italic'}}>Análisis IA (Claude Sonnet) sobre datos reportados — no es asesoría.</div>
                      </div>
                    )}
                  </div>

                  {news.length>0&&<NewsCard items={news}/>}

                  <>
                    {earnSurprise.length>0&&<EarningsSurpriseChart data={earnSurprise}/>}
                    {insiderTxns.length>0&&<InsiderTable data={insiderTxns}/>}
                  </>

                  <div style={{background:'#1c1d26',border:'1px solid #24262f',borderRadius:8,padding:'14px 18px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#787a83',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>SEC EDGAR Filings</div>
                    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=4&dateb=&owner=include&count=20`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#968ff7',background:'#34315f22',border:'1px solid #34315f',padding:'5px 12px',borderRadius:5}}
                      >
                        Form 4 — Insider Filings ↗
                      </a>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K&dateb=&owner=include&count=5`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#968ff7',background:'#34315f22',border:'1px solid #34315f',padding:'5px 12px',borderRadius:5}}
                      >
                        10-K Annual Reports ↗
                      </a>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=13F&dateb=&owner=include&count=5`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#968ff7',background:'#34315f22',border:'1px solid #34315f',padding:'5px 12px',borderRadius:5}}
                      >
                        13F — Institutional Holdings ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{textAlign:'center',marginTop:48,fontSize:10,color:'#24262f',lineHeight:1.8}}>
        StockLens v5.0 · Data: Financial Modeling Prep · Not financial advice · {new Date().getFullYear()}
        {ticker&&quote&&<span> · Last updated: {new Date().toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
