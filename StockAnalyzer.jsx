// ============================================================
// StockLens v3.0 — Stock Analysis App
// Stack: React 18 UMD · Financial Modeling Prep API (stable)
// No imports — global React from CDN, pre-compiled by Babel
// ============================================================

const { useState, useCallback, useMemo, useRef, useEffect } = React;
const DEFAULT_FMP_KEY = '';

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
    total >= 85 ? '#10b981' : total >= 70 ? '#3b82f6' :
    total >= 55 ? '#8b5cf6' : total >= 40 ? '#f59e0b' : '#6b7280';
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

function getRating(s) {
  if(s>=80) return {label:'STRONG BUY',color:'#22c55e',bg:'#0d2e1a',border:'#166534'};
  if(s>=65) return {label:'BUY',       color:'#4ade80',bg:'#0d2318',border:'#14532d'};
  if(s>=50) return {label:'HOLD',      color:'#fbbf24',bg:'#2a1f00',border:'#78350f'};
  if(s>=35) return {label:'CAUTION',   color:'#f97316',bg:'#2a1200',border:'#7c2d12'};
  return          {label:'AVOID',      color:'#f87171',bg:'#2a0d0d',border:'#7f1d1d'};
}

async function computeMacroTilt(supabase, sector, netDebtEbitda, peRatio) {
  if (!supabase) return { tilt: 0, reasons: ["Sin Supabase"], quadrant: null, regime: null };
  let m = null;
  try {
    const { data } = await supabase.from("macro_state").select("*").eq("id", 1).maybeSingle();
    m = data;
  } catch (e) {}
  if (!m) return { tilt: 0, reasons: ["Macro no disponible aún"], quadrant: null, regime: null };
  let tilt = 0; const reasons = [];
  const nd = Number(netDebtEbitda) || 0, pe = Number(peRatio) || 0;
  if (m.credit_stress > 70 && nd > 3) { tilt -= 10; reasons.push(`Credit stress ${Math.round(m.credit_stress)} + deuda ${nd.toFixed(1)}x`); }
  if (m.liquidity_cycle < 35 && pe > 40) { tilt -= 5; reasons.push(`Liquidez baja ${Math.round(m.liquidity_cycle)} + P/E ${pe.toFixed(0)}`); }
  if (m.recession_prob > 60 && ["Energy","Industrials","Consumer Cyclical"].includes(sector)) { tilt -= 8; reasons.push(`Recesión ${Math.round(m.recession_prob)} + ${sector} cíclico`); }
  if (m.geopolitical_risk > 65 && ["Utilities","Healthcare","Basic Materials","Consumer Defensive"].includes(sector)) { tilt += 5; reasons.push(`Geopolítica ${Math.round(m.geopolitical_risk)} + ${sector} defensivo`); }
  const bonus = { estanflacion:{Energy:5,"Basic Materials":5,Technology:-5}, inflacion:{Energy:5,"Real Estate":5}, defensivo:{Healthcare:5,Utilities:5,"Consumer Defensive":5}, crecimiento:{Technology:5} };
  const b = (bonus[m.cartera_quadrant] && bonus[m.cartera_quadrant][sector]) || 0;
  if (b) { tilt += b; reasons.push(`Cuadrante ${m.cartera_quadrant} → ${sector} ${b>0?"+":""}${b}`); }
  tilt = Math.max(-15, Math.min(15, tilt));
  return { tilt, reasons: reasons.length ? reasons : ["Sin ajustes para este perfil"], quadrant: m.cartera_quadrant, regime: m.regime_label };
}

// ─── SKELETON ───────────────────────────────────────────────
function Sk({w='100%', h=16, s={}}) {
  return (
    <div style={{
      background:'linear-gradient(90deg,#0c0e14 25%,#141720 50%,#0c0e14 75%)',
      backgroundSize:'200% 100%',animation:'shimmer 1.5s infinite',
      borderRadius:4,width:w,height:h,...s
    }}/>
  );
}
function LoadingSkeleton() {
  return (
    <div style={{paddingTop:20,display:'flex',flexDirection:'column',gap:14}}>
      <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,padding:'20px 24px'}}>
        <Sk h={11} w="25%" s={{marginBottom:8}}/>
        <Sk h={30} w="55%" s={{marginBottom:8}}/>
        <Sk h={10} w="70%" s={{marginBottom:6}}/>
        <Sk h={10} w="45%"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14}}>
        <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,padding:'20px 24px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
          <Sk w={136} h={136} s={{borderRadius:'50%'}}/>
          {[80,90,70].map((w,i)=><Sk key={i} w={w} h={8} s={{marginBottom:2}}/>)}
        </div>
        <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,padding:'20px 24px'}}>
          <Sk h={11} w="30%" s={{marginBottom:14}}/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:9}}>
            {[...Array(9)].map((_,i)=>(
              <div key={i} style={{background:'#141720',borderRadius:6,padding:'10px 14px'}}>
                <Sk h={9} w="55%" s={{marginBottom:7}}/>
                <Sk h={18} w="70%"/>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,padding:'20px 24px'}}>
        <Sk h={200}/>
      </div>
    </div>
  );
}

// ─── LAYOUT PRIMITIVES ──────────────────────────────────────
function Panel({children, style={}}) {
  return (
    <div style={{
      background:'#0c0e14',border:'1px solid #161b26',
      borderRadius:10,padding:'20px 24px',...style
    }}>{children}</div>
  );
}
function SectionTitle({children}) {
  return (
    <div style={{
      fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'1px',
      color:'#334155',marginBottom:14,paddingBottom:8,borderBottom:'1px solid #141720'
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
    return diff>0 ? {t:`↑ vs ${bmLabel||'sector'}`,c:'#22c55e'} : {t:`↓ vs ${bmLabel||'sector'}`,c:'#f87171'};
  },[bmVal,value,bmLabel]);
  return (
    <div style={{
      background:'#141720',border:'1px solid #1e2430',borderRadius:6,
      padding:'10px 14px',display:'flex',flexDirection:'column',gap:3
    }}>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
      <div style={{fontSize:17,fontWeight:700,color:highlight||'#e2e8f0',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{value}</div>
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        {sub&&<div style={{fontSize:10,color:'#334155'}}>{sub}</div>}
        {vsStr&&<div style={{fontSize:9,color:vsStr.c,fontWeight:700}}>{vsStr.t}</div>}
      </div>
    </div>
  );
}

// ─── HEALTH CARD ────────────────────────────────────────────
function HealthCard({label, value, status, note}) {
  const C={
    green:  {bg:'#0d2e1a',border:'#166534',badge:'#22c55e',icon:'✓ BEAT'},
    amber:  {bg:'#2a1f00',border:'#78350f',badge:'#fbbf24',icon:'⚠ WATCH'},
    red:    {bg:'#2a0d0d',border:'#7f1d1d',badge:'#f87171',icon:'✗ MISS'},
    neutral:{bg:'#141720',border:'#1e2430',badge:'#475569',icon:'— N/A'},
  }[status||'neutral'];
  return (
    <div style={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,padding:'12px 14px',display:'flex',flexDirection:'column',gap:4}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:10,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
        <div style={{fontSize:10,fontWeight:700,color:C.badge}}>{C.icon}</div>
      </div>
      <div style={{fontSize:19,fontWeight:800,color:C.badge,fontFamily:'JetBrains Mono,monospace',lineHeight:1.1}}>{value}</div>
      {note&&<div style={{fontSize:10,color:'#475569'}}>{note}</div>}
    </div>
  );
}

// ─── SCORE GAUGE ────────────────────────────────────────────
function ScoreGauge({score}) {
  const r=getRating(score);
  const cir=2*Math.PI*52;
  const prog=(score/100)*cir;
  const col=score>=65?'#22c55e':score>=50?'#fbbf24':'#f87171';
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
          <circle cx="68" cy="68" r="52" fill="none" stroke="#1e2430" strokeWidth="10"/>
          <circle cx="68" cy="68" r="52" fill="none" stroke="url(#ggrad)" strokeWidth="10"
            strokeDasharray={`${prog} ${cir}`} strokeLinecap="round"
            style={{transition:'stroke-dasharray 1.2s ease-in-out'}}/>
        </svg>
        <div style={{position:'absolute',top:'50%',left:'50%',transform:'translate(-50%,-50%)',display:'flex',flexDirection:'column',alignItems:'center'}}>
          <div style={{fontSize:34,fontWeight:800,color:col,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{score}</div>
          <div style={{fontSize:9,color:'#475569',letterSpacing:'1px'}}>/100</div>
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
        <div style={{fontSize:11,color:'#94a3b8'}}>{label}</div>
        <div style={{fontSize:11,fontWeight:700,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{value}<span style={{color:'#334155'}}>/{max}</span></div>
      </div>
      <div style={{background:'#1e2430',borderRadius:4,height:5,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:4,transition:'width 1s ease'}}/>
      </div>
    </div>
  );
}

// ─── SPARKLINE ──────────────────────────────────────────────
function Sparkline({data, type='bar', color='#3b82f6', h=48, w=120}) {
  const vals=data.map(v=>ok(v)?v:0);
  if (!vals.length) return <div style={{width:w,height:h,background:'#141720',borderRadius:3}}/>;
  const mn=Math.min(...vals), mx=Math.max(...vals), rng=mx-mn||1;
  if (type==='bar') {
    const bw=w/vals.length;
    return (
      <svg width={w} height={h} style={{display:'block'}}>
        {vals.map((v,i)=>{
          const bh=((v-mn)/rng)*h;
          return <rect key={i} x={i*bw+0.5} y={h-bh} width={Math.max(1,bw-1)} height={bh} fill={v<0?'#f87171':color} rx={1}/>;
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

// ─── PRICE CHART (enhanced) ─────────────────────────────────
const PERIODS = {'1M':21,'3M':63,'6M':126,'1Y':365,'5Y':1825};

function PriceChart({history, ticker, period}) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const sorted = useMemo(()=>[...history].sort((a,b)=>new Date(a.date)-new Date(b.date)),[history]);
  const filtered = useMemo(()=>{
    const n=PERIODS[period]||365;
    return sorted.slice(-n);
  },[sorted,period]);

  if (!filtered.length || filtered.length < 2) return (
    <div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'#334155',fontSize:12}}>No price data</div>
  );

  const prices=filtered.map(d=>d.close);
  const volumes=filtered.map(d=>d.volume||0);
  const W=800, H=230, pt=10, pb=30, pl=12, pr=12;
  const priceH=160, volH=30;
  const priceBottom=pt+priceH;
  const volTop=priceBottom+8;
  const volBottom=volTop+volH;
  const cw=W-pl-pr;

  const minP=Math.min(...prices), maxP=Math.max(...prices), rngP=maxP-minP||1;
  const maxV=Math.max(...volumes,1);

  const px=i=>pl+(i/Math.max(1,filtered.length-1))*cw;
  const py=p=>pt+(1-(p-minP)/rngP)*priceH;
  const vy=v=>volBottom-(v/maxV)*volH;

  const isUp=prices[prices.length-1]>=prices[0];
  const stroke=isUp?'#22c55e':'#f87171';

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
  filtered.forEach((d,i)=>{
    const m=new Date(d.date).getMonth();
    if(m!==lastM){ticks.push({i,m});lastM=m;}
  });
  const mLbls=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const handleMouseMove = useCallback((e)=>{
    if (!svgRef.current) return;
    const rect=svgRef.current.getBoundingClientRect();
    const frac=(e.clientX-rect.left)/rect.width;
    const idx=Math.round(frac*(filtered.length-1));
    setHoverIdx(Math.max(0,Math.min(filtered.length-1,idx)));
  },[filtered.length]);

  const hd = hoverIdx!=null ? filtered[hoverIdx] : null;
  const hx = hoverIdx!=null ? px(hoverIdx) : null;

  return (
    <div style={{position:'relative'}}>
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
          <line key={f} x1={pl} x2={W-pr} y1={pt+f*priceH} y2={pt+f*priceH} stroke="#161b26" strokeWidth="1"/>
        ))}
        <line x1={pl} x2={W-pr} y1={py(hi52)} y2={py(hi52)} stroke="#334155" strokeWidth="0.8" strokeDasharray="4 4"/>
        <line x1={pl} x2={W-pr} y1={py(lo52)} y2={py(lo52)} stroke="#334155" strokeWidth="0.8" strokeDasharray="4 4"/>
        <polygon points={fillPts} fill="url(#sg2)"/>
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"/>
        {sma50pts && <polyline points={sma50pts} fill="none" stroke="#60a5fa" strokeWidth="1" strokeOpacity="0.7" strokeDasharray="3 2"/>}
        {volumes.map((v,i)=>(
          <rect key={i}
            x={pl+i*(cw/filtered.length)}
            y={vy(v)}
            width={Math.max(1,cw/filtered.length-0.5)}
            height={volBottom-vy(v)}
            fill="#1e2430" opacity="0.8"
          />
        ))}
        {ticks.filter((_,i)=>i%2===0).map(({i,m})=>(
          <text key={m} x={px(i)} y={H-8} fontSize="8" fill="#334155" textAnchor="middle">{mLbls[m]}</text>
        ))}
        <text x={pl+2} y={pt+10} fontSize="8" fill="#334155">${maxP.toFixed(0)}</text>
        <text x={pl+2} y={priceBottom-4} fontSize="8" fill="#334155">${minP.toFixed(0)}</text>
        <text x={W-pr-2} y={py(hi52)-3} fontSize="7.5" fill="#475569" textAnchor="end">52W H</text>
        <text x={W-pr-2} y={py(lo52)+8} fontSize="7.5" fill="#475569" textAnchor="end">52W L</text>
        {hx!=null&&(
          <g>
            <line x1={hx} x2={hx} y1={pt} y2={priceBottom} stroke="#475569" strokeWidth="0.8" strokeDasharray="3 2"/>
            <circle cx={hx} cy={py(prices[hoverIdx])} r="3.5" fill={stroke} stroke="#0c0e14" strokeWidth="1.5"/>
          </g>
        )}
        {sma50pts&&(
          <g>
            <line x1={W-80} x2={W-68} y1={pt+10} y2={pt+10} stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="3 2"/>
            <text x={W-65} y={pt+13} fontSize="7.5" fill="#60a5fa">50 SMA</text>
          </g>
        )}
      </svg>
      {hd&&hx!=null&&(
        <div style={{
          position:'absolute',top:8,
          left:Math.min(hx/800*100, 72)+'%',
          background:'#141720',border:'1px solid #1e2430',
          borderRadius:6,padding:'8px 11px',fontSize:11,
          fontFamily:'JetBrains Mono,monospace',
          pointerEvents:'none',minWidth:130,zIndex:10,
          boxShadow:'0 4px 16px rgba(0,0,0,0.5)'
        }}>
          <div style={{color:'#64748b',fontSize:9,marginBottom:5}}>{hd.date?.substring(0,10)}</div>
          <div style={{color:'#e2e8f0',marginBottom:2}}>C: <span style={{color:stroke}}>${hd.close?.toFixed(2)}</span></div>
          {hd.open&&<div style={{color:'#94a3b8'}}>O: ${hd.open?.toFixed(2)}</div>}
          {hd.high&&<div style={{color:'#94a3b8'}}>H: ${hd.high?.toFixed(2)}</div>}
          {hd.low &&<div style={{color:'#94a3b8'}}>L: ${hd.low?.toFixed(2)}</div>}
          {hd.volume&&<div style={{color:'#475569',fontSize:9,marginTop:3}}>Vol: {fmt.usd(hd.volume)}</div>}
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

  const rsiColor=!ok(rsi)?'#475569':rsi>70?'#f87171':rsi<30?'#22c55e':'#fbbf24';
  const rsiLabel=!ok(rsi)?'—':rsi>70?'OVERBOUGHT':rsi<30?'OVERSOLD':'NEUTRAL';
  const vs50=sma50?((cur-sma50)/sma50):null;
  const vs200=sma200?((cur-sma200)/sma200):null;

  const Sig=({label,val,color,extra})=>(
    <div style={{
      background:'#141720',border:`1px solid #1e2430`,borderRadius:6,
      padding:'10px 13px',flex:1,minWidth:120
    }}>
      <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:5}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:color||'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{val}</div>
      {extra&&<div style={{fontSize:9,color:'#334155',marginTop:3}}>{extra}</div>}
    </div>
  );

  return (
    <div>
      <SectionTitle>Technical Signals</SectionTitle>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Sig label="RSI 14" val={ok(rsi)?rsi.toFixed(1):'—'} color={rsiColor} extra={rsiLabel}/>
        <Sig label="vs 50-day SMA" val={ok(vs50)?fmt.chg(vs50):'—'} color={ok(vs50)?(vs50>0?'#22c55e':'#f87171'):'#475569'} extra={ok(sma50)?`SMA $${sma50.toFixed(2)}`:'insufficient data'}/>
        <Sig label="vs 200-day SMA" val={ok(vs200)?fmt.chg(vs200):'—'} color={ok(vs200)?(vs200>0?'#22c55e':'#f87171'):'#475569'} extra={ok(sma200)?`SMA $${sma200.toFixed(2)}`:'insufficient data'}/>
        <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 13px',flex:2,minWidth:160}}>
          <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:5}}>
            52-Week Range  <span style={{color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>${lo52.toFixed(0)} — ${hi52.toFixed(0)}</span>
          </div>
          <div style={{background:'#1e2430',borderRadius:3,height:6,overflow:'hidden',position:'relative'}}>
            <div style={{width:`${rangePct*100}%`,height:'100%',background:'#3b82f6',borderRadius:3,transition:'width 0.5s ease'}}/>
          </div>
          <div style={{fontSize:9,color:'#475569',marginTop:3}}>{(rangePct*100).toFixed(0)}% of range · Current ${ok(cur)?cur.toFixed(2):'—'}</div>
        </div>
      </div>
      {(macdData||rsData)&&(
        <div style={{marginTop:8,background:'#141720',border:'1px solid #1e2430',borderRadius:6,overflow:'hidden'}}>
          {macdData&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 13px',borderBottom:rsData?'1px solid #1e2430':'none'}}>
              <span style={{fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px'}}>MACD</span>
              <div style={{textAlign:'right'}}>
                <span style={{
                  color:
                    macdData.crossover==='bullish_cross' ? '#10b981' :
                    macdData.crossover==='bearish_cross' ? '#ef4444' :
                    macdData.crossover==='bullish'       ? '#34d399' :
                    macdData.crossover==='bearish'       ? '#f87171' : '#475569',
                  fontSize:13,fontWeight:700
                }}>
                  {macdData.crossover==='bullish_cross' ? '⬆ Bullish Crossover' :
                   macdData.crossover==='bearish_cross' ? '⬇ Bearish Crossover' :
                   macdData.crossover==='bullish'       ? '▲ Trending Up' :
                   macdData.crossover==='bearish'       ? '▼ Trending Down' : '→ Neutral'}
                </span>
                <div style={{color:'#334155',fontSize:10,marginTop:2}}>
                  MACD {macdData.macd.toFixed(3)} · Signal {macdData.signal.toFixed(3)}
                </div>
              </div>
            </div>
          )}
          {rsData&&(
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 13px'}}>
              <span style={{fontSize:11,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px'}}>vs SPY (6M)</span>
              <div style={{textAlign:'right'}}>
                <span style={{
                  color: rsData.outperforming ? '#10b981' : '#ef4444',
                  fontSize:13,fontWeight:700
                }}>
                  {rsData.outperforming ? '▲ Outperforming' : '▼ Underperforming'}
                  {' '}{rsData.alpha>=0?'+':''}{(rsData.alpha*100).toFixed(1)}%
                </span>
                <div style={{color:'#334155',fontSize:10,marginTop:2}}>
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

  const ratingColor=rating==='Strong Buy'?'#22c55e':rating==='Buy'?'#4ade80':rating==='Hold'?'#fbbf24':'#f87171';

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
            {total>0&&<div style={{fontSize:11,color:'#475569'}}>{total} analysts</div>}
          </div>
          {ok(targetMed)&&(
            <div>
              <div style={{fontSize:10,color:'#475569',marginBottom:3}}>Consensus Price Target</div>
              <div style={{fontSize:20,fontWeight:800,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
                {fmt.price(targetMed)}
                {ok(upside)&&<span style={{fontSize:12,fontWeight:600,color:upside>0?'#22c55e':'#f87171',marginLeft:8}}>
                  {upside>0?'▲':'▼'} {Math.abs(upside*100).toFixed(1)}% upside
                </span>}
              </div>
              {ok(pt?.targetHigh)&&ok(pt?.targetLow)&&(
                <div style={{fontSize:10,color:'#334155',marginTop:2}}>Range: {fmt.price(pt.targetLow)} — {fmt.price(pt.targetHigh)}</div>
              )}
            </div>
          )}
          {ok(fwdPE)&&(
            <div style={{background:'#141720',borderRadius:6,padding:'8px 12px',display:'inline-block'}}>
              <span style={{fontSize:10,color:'#475569'}}>Fwd P/E </span>
              <span style={{fontSize:14,fontWeight:700,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{fwdPE.toFixed(1)}x</span>
            </div>
          )}
        </div>
        {total>0&&(
          <div>
            <div style={{fontSize:10,color:'#475569',marginBottom:8}}>Analyst Distribution ({total})</div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              {[
                {label:'Buy / Strong Buy',pct:buyPct,color:'#22c55e',cnt:sb+b},
                {label:'Hold',pct:holdPct,color:'#fbbf24',cnt:h},
                {label:'Sell / Strong Sell',pct:sellPct,color:'#f87171',cnt:s+ss},
              ].map(({label,pct,color,cnt})=>(
                <div key={label}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:3,fontSize:10,color:'#64748b'}}>
                    <span>{label}</span>
                    <span style={{color,fontFamily:'JetBrains Mono,monospace',fontWeight:600}}>{cnt} ({ok(pct)?(pct*100).toFixed(0):0}%)</span>
                  </div>
                  <div style={{background:'#1e2430',borderRadius:3,height:5}}>
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
          <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>Recent Analyst Price Targets</div>
          <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:200,overflowY:'auto'}}>
            {ptList.slice(0,8).map((pt,i)=>{
              const upPt=(ok(pt.priceTarget)&&ok(currentPrice))?(pt.priceTarget-currentPrice)/currentPrice:null;
              const ptColor=!ok(upPt)?'#475569':upPt>0.1?'#22c55e':upPt<-0.1?'#f87171':'#fbbf24';
              return (
                <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',background:'#141720',borderRadius:5,padding:'6px 12px',fontSize:11}}>
                  <span style={{color:'#64748b',flex:1}}>{pt.analystCompany||pt.analystName}</span>
                  <span style={{color:'#475569',marginRight:12}}>{pt.publishedDate?.substring(0,10)}</span>
                  <span style={{fontWeight:700,color:ptColor,fontFamily:'JetBrains Mono,monospace'}}>
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
      <div style={{padding:'10px 0',borderBottom:'1px solid #161b26'}}>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{width:130,fontSize:11,color:'#94a3b8',flexShrink:0}}>{label}</div>
          <div style={{flex:1,position:'relative'}}>
            <Sparkline data={data} type={type} color={color} h={44} w={180}/>
            <div style={{display:'flex',justifyContent:'space-between',marginTop:2}}>
              <span style={{fontSize:9,color:'#334155'}}>{firstLabel}</span>
              <span style={{fontSize:9,color:'#334155'}}>{lastLabel}</span>
            </div>
          </div>
          <div style={{textAlign:'right',minWidth:90}}>
            {ok(latestVal)&&(
              <div style={{fontSize:11,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
                {type==='line'?fmt.pct(latestVal):fmt.usd(latestVal)}
              </div>
            )}
            {ok(cagrVal)&&(
              <div style={{fontSize:10,color:cagrVal>0?'#22c55e':'#f87171',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
                CAGR {fmt.chg(cagrVal)}
              </div>
            )}
            <div style={{fontSize:9,color:'#334155',marginTop:1}}>{data.length} qtrs</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <SectionTitle>Growth Profile — {stmts.length} Quarters</SectionTitle>
      <Row label="Revenue" data={revs} type="bar" color="#3b82f6" cagrVal={revCagr} stmtsData={rows}/>
      <Row label="Net Income" data={netI} type="bar" color="#22c55e" cagrVal={null} stmtsData={rows}/>
      <Row label="Gross Margin %" data={gms} type="line" color="#a78bfa" cagrVal={null} stmtsData={rows}/>
      <Row label="EPS" data={eps} type="line" color="#fbbf24" cagrVal={null} stmtsData={rows}/>
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
                <th key={h} style={{padding:'6px 10px',textAlign:'left',color:'#475569',borderBottom:'1px solid #1e2430',fontWeight:600,whiteSpace:'nowrap',fontSize:10}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((q)=>{
              const yoyQ=stmts.find(s=>s.period===q.period&&parseInt(s.calendarYear)===parseInt(q.calendarYear)-1);
              const yoy=(yoyQ?.revenue>0&&ok(q.revenue))?(q.revenue-yoyQ.revenue)/yoyQ.revenue:null;
              const gm=q.revenue>0?q.grossProfit/q.revenue:null;
              return (
                <tr key={q.date||q.period+q.calendarYear} style={{borderBottom:'1px solid #141720'}}>
                  <td style={{padding:'8px 10px',color:'#64748b',fontFamily:'JetBrains Mono,monospace',fontSize:10}}>{q.period} {q.calendarYear}</td>
                  <td style={{padding:'8px 10px',color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{fmt.usd(q.revenue)}</td>
                  <td style={{padding:'8px 10px',fontFamily:'JetBrains Mono,monospace',color:ok(yoy)?(yoy>=0?'#22c55e':'#f87171'):'#334155'}}>
                    {ok(yoy)?fmt.chg(yoy):'—'}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'JetBrains Mono,monospace',color:ok(gm)?(gm>=0.4?'#22c55e':gm>=0.2?'#fbbf24':'#f87171'):'#334155'}}>
                    {fmt.pct(gm)}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'JetBrains Mono,monospace',color:q.netIncome>=0?'#4ade80':'#f87171'}}>
                    {fmt.usd(q.netIncome)}
                  </td>
                  <td style={{padding:'8px 10px',fontFamily:'JetBrains Mono,monospace',color:q.eps>=0?'#4ade80':'#f87171'}}>
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
            <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 13px',transition:'border-color 0.15s'}}>
              <div style={{fontSize:12,color:'#cbd5e1',lineHeight:1.45,marginBottom:5}}>{n.title}</div>
              <div style={{display:'flex',gap:8,fontSize:10,color:'#334155'}}>
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
    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 14px'}}>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px',marginBottom:4}}>Next Earnings</div>
      <div style={{fontSize:15,fontWeight:700,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace'}}>{date || '—'}</div>
      {est != null && <div style={{fontSize:10,color:'#64748b',marginTop:3}}>Est. EPS: {est.toFixed(2)}</div>}
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
              <div style={{fontSize:9,color:isPos?'#22c55e':'#f87171',fontWeight:700}}>
                {isPos?'+':''}{surprise.toFixed(1)}%
              </div>
              <div style={{
                width:'100%',height:h,
                background:isPos?'#22c55e33':'#f8717133',
                border:`1px solid ${isPos?'#22c55e':'#f87171'}`,
                borderRadius:3
              }}/>
              <div style={{fontSize:8,color:'#334155'}}>{q.period}</div>
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
        <div style={{background:'#0d2e1a',border:'1px solid #166534',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#22c55e'}}>{buys.length}</div>
          <div style={{fontSize:10,color:'#4ade80'}}>Insider Buys</div>
        </div>
        <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:6,padding:'10px 14px',textAlign:'center'}}>
          <div style={{fontSize:20,fontWeight:800,color:'#f87171'}}>{sells.length}</div>
          <div style={{fontSize:10,color:'#fca5a5'}}>Insider Sells</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {data.slice(0, 6).map((t, i) => {
          const isBuy = t.change > 0;
          return (
            <div key={i} style={{
              display:'flex',justifyContent:'space-between',alignItems:'center',
              background:'#141720',borderRadius:5,padding:'7px 12px',fontSize:11
            }}>
              <span style={{color:'#64748b',flex:1}}>{t.name}</span>
              <span style={{color:'#94a3b8',marginRight:12}}>{t.filingDate?.substring(0,10)}</span>
              <span style={{fontWeight:700,color:isBuy?'#22c55e':'#f87171',fontFamily:'JetBrains Mono,monospace'}}>
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
    { key:'demand',  label:'Demand Inelasticity', desc:'Price-insensitive customers',    score: moat.demand,  max:25, color:'#10b981' },
    { key:'supply',  label:'Supply Barriers',      desc:'Difficult to replicate',          score: moat.supply,  max:25, color:'#3b82f6' },
    { key:'pricing', label:'Pricing Power',         desc:'Margin expansion capacity',       score: moat.pricing, max:25, color:'#8b5cf6' },
    { key:'capEff',  label:'Capital Efficiency',    desc:'High returns on reinvestment',    score: moat.capEff,  max:25, color:'#f59e0b' },
  ];
  return (
    <div style={{background:'#111827',border:'1px solid #1f2937',borderRadius:12,padding:'20px 24px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <div style={{color:'#f9fafb',fontWeight:700,fontSize:15}}>Quality Moat Scorecard</div>
          <div style={{color:'#6b7280',fontSize:12,marginTop:2}}>Durable competitive advantage across 4 pillars</div>
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{color:moat.moatColor,fontWeight:700,fontSize:14}}>{moat.moatRating}</div>
          <div style={{color:'#6b7280',fontSize:12}}>{moat.total}/100</div>
        </div>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12}}>
        {dimensions.map(d => {
          const pct = (d.score / d.max) * 100;
          return (
            <div key={d.key}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <div>
                  <span style={{color:'#e5e7eb',fontSize:13,fontWeight:600}}>{d.label}</span>
                  <span style={{color:'#6b7280',fontSize:11,marginLeft:8}}>{d.desc}</span>
                </div>
                <span style={{
                  color: d.score >= 18 ? d.color : d.score <= 8 ? '#ef4444' : '#9ca3af',
                  fontSize:13,fontWeight:700
                }}>{d.score}/{d.max}</span>
              </div>
              <div style={{background:'#1f2937',borderRadius:4,height:6,overflow:'hidden'}}>
                <div style={{
                  height:'100%',width:`${pct}%`,borderRadius:4,
                  background: d.score >= 18 ? d.color : d.score <= 8 ? '#ef4444' : '#4b5563',
                  transition:'width 0.4s ease'
                }}/>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:16,padding:'10px 14px',background:'#0d1117',borderRadius:8,borderLeft:`3px solid ${moat.moatColor}`}}>
        <div style={{color:'#9ca3af',fontSize:11}}>
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
    caution: { bg:'#422006', border:'#92400e', icon:'⚠️', title:'Valuation Caution', color:'#fbbf24' },
    risk:    { bg:'#450a0a', border:'#991b1b', icon:'🔴', title:'Overvaluation Risk Detected', color:'#f87171' },
    bubble:  { bg:'#1c1917', border:'#57534e', icon:'⚫', title:'BUBBLE TERRITORY — Extreme Overvaluation', color:'#d1d5db' },
  };
  const c = config[result.level];
  return (
    <div style={{background:c.bg,border:`1px solid ${c.border}`,borderRadius:12,padding:'16px 20px',marginBottom:16}}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
        <span style={{fontSize:16}}>{c.icon}</span>
        <span style={{color:c.color,fontWeight:700,fontSize:14}}>{c.title}</span>
        {result.peg && (
          <span style={{marginLeft:'auto',background:'#1f2937',borderRadius:6,padding:'2px 8px',color:c.color,fontSize:11,fontWeight:600}}>
            PEG {result.peg.toFixed(2)}
          </span>
        )}
      </div>
      <ul style={{margin:0,padding:'0 0 0 20px',listStyle:'disc'}}>
        {result.reasons.map((r,i) => (
          <li key={i} style={{color:'#9ca3af',fontSize:12,marginBottom:2}}>{r}</li>
        ))}
      </ul>
      <div style={{marginTop:10,color:'#6b7280',fontSize:11,fontStyle:'italic'}}>
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
    { key: 'value',    label: 'Value',    color: '#10b981', icon: '💰' },
    { key: 'growth',   label: 'Growth',   color: '#6366f1', icon: '📈' },
    { key: 'momentum', label: 'Momentum', color: '#f59e0b', icon: '⚡' },
    { key: 'quality',  label: 'Quality',  color: '#3b82f6', icon: '🏆' },
    { key: 'size',     label: 'Size',     color: '#8b5cf6', icon: '📊' },
  ];
  return (
    <div style={{background:'#111827',border:'1px solid #1f2937',borderRadius:12,padding:'20px 24px',marginBottom:16}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <div style={{color:'#f9fafb',fontWeight:700,fontSize:15}}>Factor Tilt Analysis</div>
          <div style={{color:'#6b7280',fontSize:12,marginTop:2}}>Quant factor exposure across 5 dimensions (0–20 each)</div>
        </div>
        <div style={{background:'#1f2937',borderRadius:8,padding:'4px 12px',color:'#a78bfa',fontSize:12,fontWeight:600}}>
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
              <div style={{width:80,color:'#9ca3af',fontSize:12,textAlign:'right'}}>{f.icon} {f.label}</div>
              <div style={{flex:1,background:'#1f2937',borderRadius:4,height:8,overflow:'hidden',position:'relative'}}>
                <div style={{
                  position:'absolute',left:0,top:0,height:'100%',
                  width:`${pct}%`,
                  background: neutral ? '#374151' : f.color,
                  borderRadius:4,
                  transition:'width 0.4s ease'
                }}/>
                <div style={{position:'absolute',left:'50%',top:-2,bottom:-2,width:1,background:'#374151'}}/>
              </div>
              <div style={{
                width:28,textAlign:'right',
                color: score >= 14 ? f.color : score <= 6 ? '#ef4444' : '#6b7280',
                fontSize:13,fontWeight:700
              }}>{score}</div>
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,display:'flex',gap:16,justifyContent:'flex-end'}}>
        {['Weak (0-7)','Neutral (8-12)','Strong (13-20)'].map((l,i)=>(
          <div key={l} style={{display:'flex',alignItems:'center',gap:4}}>
            <div style={{width:8,height:8,borderRadius:2,background:i===0?'#ef4444':i===1?'#374151':'#10b981'}}/>
            <span style={{color:'#6b7280',fontSize:10}}>{l}</span>
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
        <div style={{background:'#0d2e1a',border:'1px solid #166534',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#22c55e',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>🏰 Bull Case</div>
          {moat.length ? moat.map((m,i)=>(
            <div key={i} style={{fontSize:11,color:'#86efac',marginBottom:5,lineHeight:1.5}}>· {m}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No strong moat signals at current levels</div>}
        </div>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'0 8px'}}>
          <ScoreGauge score={scores.total}/>
          <div style={{width:140}}>
            <ScoreBar label="Valuation"       value={scores.val}    max={25} color="#60a5fa"/>
            <ScoreBar label="Financial Health" value={scores.hlth}   max={30} color="#22c55e"/>
            <ScoreBar label="Momentum"         value={scores.mom}    max={25} color="#fbbf24"/>
            <ScoreBar label="Growth"           value={scores.growth} max={20} color="#a78bfa"/>
          </div>
        </div>
        <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#f87171',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>⚠ Bear Case</div>
          {risks.length ? risks.map((rk,i)=>(
            <div key={i} style={{fontSize:11,color:'#fca5a5',marginBottom:5,lineHeight:1.5}}>· {rk}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No major risk flags detected</div>}
        </div>
      </div>
      <div style={{background:r.bg,border:`1px solid ${r.border}`,borderRadius:8,padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:5}}>
            Bottom Line {aiVerdict && <span style={{color:'#a78bfa',fontWeight:400,textTransform:'none',letterSpacing:0}}>✨ AI</span>}
          </div>
          <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.65}}>
            {aiLoading ? (
              <span style={{color:'#475569',fontStyle:'italic'}}>✨ Generating AI analysis...</span>
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
  const result=runDCF(inputs);
  const iv=result?.intrinsicValue;
  const mos=(ok(iv)&&ok(currentPrice)&&currentPrice>0)?(iv-currentPrice)/iv:null;
  const mosColor=!ok(mos)?'#475569':mos>0.15?'#22c55e':mos>-0.15?'#fbbf24':'#f87171';
  const set=(key,val)=>setInputs(p=>({...p,[key]:val}));

  const SliderInput=({label,stateKey,min,max,step=1,unit='%',note})=>(
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:10,color:'#64748b'}}>{label}</span>
        <span style={{fontSize:11,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>{inputs[stateKey]}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={inputs[stateKey]}
        onChange={e=>set(stateKey,parseFloat(e.target.value))}
        style={{width:'100%',accentColor:'#3b82f6',cursor:'pointer'}}/>
      {note&&<div style={{fontSize:9,color:'#334155'}}>{note}</div>}
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
    <div style={{background:'#0c0e14',border:'1px solid #161b26',borderRadius:10,overflow:'hidden'}}>
      <div style={{background:'#141720',borderBottom:'1px solid #161b26',padding:'12px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:11,fontWeight:700,color:'#e2e8f0',textTransform:'uppercase',letterSpacing:'1px'}}>📐 Interactive DCF Model</div>
        <div style={{fontSize:10,color:'#475569'}}>{profile?.companyName} · All values auto-recalculate</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 300px',gap:0}}>
        <div style={{padding:'16px 20px',borderRight:'1px solid #161b26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#3b82f6',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>Revenue Growth</div>
          <SliderInput label="Years 1–5 Growth Rate" stateKey="revGrowth1to5" min={-10} max={50} note="Analyst estimates for near-term growth"/>
          <SliderInput label="Years 6–10 Growth Rate" stateKey="revGrowth6to10" min={-5} max={30} note="Conservative long-run growth"/>
          <SliderInput label="EBIT Margin" stateKey="ebitMargin" min={0} max={60} note="Operating income / revenue"/>
          <SliderInput label="Tax Rate" stateKey="taxRate" min={10} max={40} note="Effective tax rate"/>
        </div>
        <div style={{padding:'16px 20px',borderRight:'1px solid #161b26'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#a78bfa',textTransform:'uppercase',letterSpacing:'1px',marginBottom:12}}>Discount & Capital</div>
          <SliderInput label="Discount Rate (WACC)" stateKey="discountRate" min={4} max={20} step={0.5} note="Weighted average cost of capital"/>
          <SliderInput label="Terminal Growth Rate" stateKey="terminalGrowth" min={0} max={6} step={0.5} note="Perpetuity growth (≤ GDP growth)"/>
          <SliderInput label="CapEx % of Revenue" stateKey="capexPct" min={0} max={30} note="Maintenance + growth capex"/>
          <SliderInput label="Beta" stateKey="beta" min={0.3} max={3} step={0.1} unit="" note="Used to contextualize risk"/>
          <div style={{fontSize:9,color:'#334155',marginTop:4}}>Net Debt: {fmt.usd(inputs.netDebt)} · Shares: {ok(inputs.shares)?(inputs.shares/1e6).toFixed(0)+'M':'—'}</div>
        </div>
        <div style={{padding:'16px 20px',display:'flex',flexDirection:'column',gap:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'#fbbf24',textTransform:'uppercase',letterSpacing:'1px',marginBottom:4}}>Valuation Result</div>
          <div style={{textAlign:'center',padding:'16px',background:'#0a0b10',borderRadius:8,border:'1px solid #1e2430'}}>
            <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Intrinsic Value / Share</div>
            <div style={{fontSize:28,fontWeight:800,color:ok(iv)?mosColor:'#475569',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
              {ok(iv)?fmt.price(iv):'—'}
            </div>
            {ok(mos)&&<div style={{marginTop:6,fontSize:12,fontWeight:700,color:mosColor}}>{mos>0?`+${(mos*100).toFixed(1)}% upside`:`${(mos*100).toFixed(1)}% overvalued`}</div>}
            {ok(currentPrice)&&<div style={{fontSize:10,color:'#475569',marginTop:3}}>vs. current {fmt.price(currentPrice)}</div>}
          </div>
          <div>
            <div style={{fontSize:9,color:'#334155',marginBottom:4}}>Sensitivity: Discount Rate (rows) × Terminal Growth (cols)</div>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:9}}>
              <thead>
                <tr>
                  <th style={{color:'#334155',padding:'2px 4px',textAlign:'center'}}>WACC\TG</th>
                  {[inputs.terminalGrowth-1,inputs.terminalGrowth,inputs.terminalGrowth+1].map(tg=>(
                    <th key={tg} style={{color:'#475569',padding:'2px 4px',textAlign:'center'}}>{tg}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[-2,-1,0,1,2].map((dr,ri)=>(
                  <tr key={dr}>
                    <td style={{color:'#475569',padding:'2px 4px',textAlign:'center',fontFamily:'JetBrains Mono,monospace'}}>{inputs.discountRate+dr}%</td>
                    {sensRows[ri].map((v,ci)=>{
                      const mos2=(ok(v)&&ok(currentPrice)&&currentPrice>0)?(v-currentPrice)/v:null;
                      const c=!ok(v)?'#334155':mos2>0.15?'#22c55e':mos2>-0.15?'#fbbf24':'#f87171';
                      return (
                        <td key={ci} style={{color:c,padding:'3px 4px',textAlign:'center',fontFamily:'JetBrains Mono,monospace',fontWeight:dr===0&&ci===1?800:400,background:dr===0&&ci===1?'#141720':'transparent',borderRadius:3}}>
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
  const avgColor=avgMos>0.15?'#22c55e':avgMos>-0.15?'#fbbf24':'#f87171';

  return (
    <div>
      <SectionTitle>Valuation Models Summary</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:`repeat(${models.length},1fr) 1fr`,gap:10}}>
        {models.map((m,i)=>{
          const mos=(m.value-currentPrice)/m.value;
          const c=mos>0.15?'#22c55e':mos>-0.15?'#fbbf24':'#f87171';
          return (
            <div key={i} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'14px 16px'}}>
              <div style={{fontSize:10,color:'#475569',marginBottom:4}}>{m.name}</div>
              <div style={{fontSize:20,fontWeight:800,color:c,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{fmt.price(m.value)}</div>
              <div style={{fontSize:10,color:c,marginTop:3}}>{mos>0?`+${(mos*100).toFixed(1)}% upside`:`${(mos*100).toFixed(1)}% overvalued`}</div>
              <div style={{fontSize:9,color:'#334155',marginTop:4}}>{m.note}</div>
            </div>
          );
        })}
        <div style={{background:'#0a0b10',border:`2px solid ${avgColor}44`,borderRadius:8,padding:'14px 16px'}}>
          <div style={{fontSize:10,color:'#475569',marginBottom:4}}>Model Average ({models.length} models)</div>
          <div style={{fontSize:20,fontWeight:800,color:avgColor,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{fmt.price(avg)}</div>
          <div style={{fontSize:10,color:avgColor,marginTop:3}}>{avgMos>0?`+${(avgMos*100).toFixed(1)}% upside`:`${(avgMos*100).toFixed(1)}% overvalued`}</div>
          <div style={{fontSize:9,color:'#334155',marginTop:4}}>avg of {models.length} methods</div>
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
  const overallColor=overall>=4?'#22c55e':overall>=3?'#fbbf24':'#f87171';

  return (
    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'1px'}}>Financial Health Score</div>
        <div style={{fontSize:22,fontWeight:800,color:overallColor,fontFamily:'JetBrains Mono,monospace'}}>{overall.toFixed(1)}<span style={{fontSize:12,color:'#475569'}}>/5</span></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:8}}>
        {dims.map((d,i)=>{
          const c=d.score>=4?'#22c55e':d.score>=3?'#fbbf24':'#f87171';
          return (
            <div key={i} style={{textAlign:'center'}}>
              <div style={{fontSize:18,marginBottom:4}}>{d.icon}</div>
              <div style={{fontSize:10,color:'#64748b',marginBottom:6}}>{d.name}</div>
              <div style={{display:'flex',gap:2,justifyContent:'center',marginBottom:4}}>
                {[1,2,3,4,5].map(n=>(
                  <div key={n} style={{width:8,height:8,borderRadius:2,background:n<=d.score?c:'#1e2430',transition:'background 0.3s'}}/>
                ))}
              </div>
              <div style={{fontSize:12,fontWeight:700,color:c}}>{d.score}/5</div>
              <div style={{fontSize:9,color:'#334155',marginTop:2,lineHeight:1.3}}>{d.note}</div>
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
    if (col.label === 'Ticker') return s === currentProf?.symbol ? '#60a5fa' : '#e2e8f0';
    const raw = col.label==='P/E'?(getM(s)?.priceToEarningsRatioTTM??getM(s)?.peRatioTTM)
              : col.label==='EV/EBITDA'?getM(s)?.evToEBITDATTM
              : col.label==='Gross Margin'?getR(s)?.grossProfitMarginTTM
              : col.label==='ROIC'?(getM(s)?.returnOnInvestedCapitalTTM??getM(s)?.roicTTM)
              : col.label==='Net Debt/EBITDA'?getM(s)?.netDebtToEBITDATTM
              : null;
    if (!ok(raw)) return '#475569';
    if (col.label==='Gross Margin') return raw>=0.4?'#22c55e':raw>=0.2?'#fbbf24':'#f87171';
    if (col.label==='ROIC')         return raw>=0.15?'#22c55e':raw>=0.06?'#fbbf24':'#f87171';
    if (col.label==='Net Debt/EBITDA') return raw<0.5?'#22c55e':raw<2.5?'#fbbf24':'#f87171';
    return '#e2e8f0';
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
                  color:'#334155',fontSize:9,fontWeight:700,textTransform:'uppercase',
                  letterSpacing:'0.8px',borderBottom:'1px solid #1e2430',whiteSpace:'nowrap'
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSymbols.map((s,ri)=>{
              const isMain = s === currentProf?.symbol;
              return (
                <tr key={s} style={{
                  borderBottom:'1px solid #141720',
                  background: isMain ? '#1e2430' : (ri%2===0?'transparent':'#0f1117')
                }}>
                  {cols.map(col=>(
                    <td key={col.label} style={{
                      padding:'8px 10px',
                      textAlign:col.label==='Ticker'?'left':'right',
                      fontFamily:'JetBrains Mono,monospace',
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
                          {isMain && <span style={{fontSize:8,color:'#3b82f6',marginLeft:4,fontWeight:700}}>(current)</span>}
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
        <div style={{fontSize:9,color:'#334155',marginTop:6}}>Loading peer metrics…</div>
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
    {label:'Cash & Equivalents', value:fmt.usd(cash),   note:'liquidity cushion', color:ok(cash)&&cash>0?'#22c55e':'#f87171'},
    {label:'Total Debt',         value:fmt.usd(totalDebt), note:'short + long term', color:ok(totalDebt)&&totalDebt<cash?'#22c55e':'#fbbf24'},
    {label:'Net Debt',           value:ok(netDebt)?(netDebt<0?`${fmt.usd(-netDebt)} net cash`:fmt.usd(netDebt)):'—', note:ok(netDebt)&&netDebt<0?'net cash position':'debt in excess of cash', color:ok(netDebt)?(netDebt<0?'#22c55e':netDebt<1e9?'#fbbf24':'#f87171'):'#475569'},
    {label:"Shareholders' Equity", value:fmt.usd(equity), note:'book value', color:'#94a3b8'},
    {label:'Total Assets',       value:fmt.usd(totalA),  note:'as of last period', color:'#94a3b8'},
    {label:'Current Ratio',      value:ok(currentR)?currentR.toFixed(2)+'x':'—', note:'current assets / liabilities', color:ok(currentR)?(currentR>=2?'#22c55e':currentR>=1?'#fbbf24':'#f87171'):'#475569'},
    {label:'Intangibles / Assets', value:(ok(intangibles)&&ok(totalA)&&totalA>0)?fmt.pct(intangibles/totalA):'—', note:'goodwill + intangibles share', color:'#94a3b8'},
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
          <div key={r.label} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:14,fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:r.color||'#e2e8f0'}}>{r.value}</div>
            <div style={{fontSize:9,color:'#334155',marginTop:2}}>{r.note}</div>
          </div>
        ))}
      </div>
      {debtTrend.length >= 2 && (
        <div>
          <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Debt vs Cash — last {debtTrend.length} periods</div>
          <div style={{display:'flex',gap:6}}>
            {debtTrend.map((p,i)=>{
              const maxVal = Math.max(...debtTrend.map(x=>Math.max(x.totalDebt||0,x.cash||0)),1);
              const dPct  = ok(p.totalDebt) ? Math.round(p.totalDebt/maxVal*100) : 0;
              const cPct  = ok(p.cash)      ? Math.round(p.cash/maxVal*100)      : 0;
              return (
                <div key={i} style={{flex:1,textAlign:'center'}}>
                  <div style={{display:'flex',gap:2,height:48,alignItems:'flex-end',justifyContent:'center',marginBottom:4}}>
                    <div style={{width:12,background:'#f87171',borderRadius:'2px 2px 0 0',height:`${dPct}%`,minHeight:2,title:'Debt'}}/>
                    <div style={{width:12,background:'#22c55e',borderRadius:'2px 2px 0 0',height:`${cPct}%`,minHeight:2,title:'Cash'}}/>
                  </div>
                  <div style={{fontSize:8,color:'#475569',lineHeight:1.3}}>{p.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',gap:12,marginTop:6}}>
            <span style={{fontSize:8,color:'#f87171'}}>■ Total Debt</span>
            <span style={{fontSize:8,color:'#22c55e'}}>■ Cash</span>
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
          {label:'TTM FCF',       value:fmt.usd(ttmFCF),       color:ttmFCF>0?'#22c55e':'#f87171'},
          {label:'TTM FCF Margin',value:fmt.pct(ttmFCFM),      color:ok(ttmFCFM)?(ttmFCFM>=0.15?'#22c55e':ttmFCFM>=0.05?'#fbbf24':'#f87171'):'#475569'},
          {label:'FCF Conversion', value:ok(recent4[recent4.length-1]?.fcfConv)?recent4[recent4.length-1].fcfConv.toFixed(2)+'x':'—', color:'#94a3b8'},
        ].map(r=>(
          <div key={r.label} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:16,fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:r.color}}>{r.value}</div>
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
              <div style={{fontSize:8,color:'#475569',fontFamily:'JetBrains Mono,monospace'}}>{fmt.usd(q.fcf)}</div>
              <div style={{
                width:'100%',height:h+4,minHeight:4,
                background: isPos ? '#22c55e' : '#f87171',
                borderRadius:'2px 2px 0 0',opacity:0.85
              }}/>
            </div>
          );
        })}
      </div>
      <div style={{display:'flex',gap:0}}>
        {enriched.map((q,i)=>(
          <div key={i} style={{flex:1,textAlign:'center',fontSize:8,color:'#334155'}}>{q.label.split(' ')[0]}<br/>{q.label.split(' ')[1]}</div>
        ))}
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:10,marginTop:12}}>
        <thead>
          <tr>
            {['Period','Op. Cash Flow','CapEx','FCF','FCF Margin','FCF Conv.'].map(h=>(
              <th key={h} style={{padding:'5px 8px',textAlign:h==='Period'?'left':'right',color:'#334155',fontSize:8,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.7px',borderBottom:'1px solid #1e2430'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {enriched.slice().reverse().slice(0,6).map((q,i)=>(
            <tr key={i} style={{borderBottom:'1px solid #0f1117'}}>
              <td style={{padding:'6px 8px',color:'#64748b',fontFamily:'JetBrains Mono,monospace',fontSize:9}}>{q.label}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:'#94a3b8'}}>{fmt.usd(q.ocf)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:'#f87171'}}>{ok(q.capex)?`(${fmt.usd(q.capex)})`:'—'}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:ok(q.fcf)?(q.fcf>=0?'#22c55e':'#f87171'):'#475569',fontWeight:700}}>{fmt.usd(q.fcf)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:'#94a3b8'}}>{fmt.pct(q.fcfM)}</td>
              <td style={{padding:'6px 8px',textAlign:'right',fontFamily:'JetBrains Mono,monospace',color:'#94a3b8'}}>{ok(q.fcfConv)?q.fcfConv.toFixed(2)+'x':'—'}</td>
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
          {label:'Dividend Yield',     value:fmt.pct(divYield),   color:ok(divYield)&&divYield>0?'#22c55e':'#475569'},
          {label:'Payout Ratio',       value:fmt.pct(payoutR),    color:ok(payoutR)?(payoutR<0.6?'#22c55e':payoutR<0.9?'#fbbf24':'#f87171'):'#475569'},
          {label:'Consec. Years Paid', value:consec>0?`${consec} yrs`:'—', color:consec>=10?'#22c55e':consec>=5?'#fbbf24':'#94a3b8'},
          {label:'Div. CAGR',          value:fmt.pct(divCAGR),    color:ok(divCAGR)&&divCAGR>0?'#22c55e':'#f87171'},
        ].map(r=>(
          <div key={r.label} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:6,padding:'10px 14px'}}>
            <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:4}}>{r.label}</div>
            <div style={{fontSize:15,fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:r.color}}>{r.value}</div>
          </div>
        ))}
      </div>
      {/* Annual dividends bar chart */}
      {years.length >= 2 && (
        <>
          <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Annual Dividends per Share</div>
          <div style={{display:'flex',gap:6,alignItems:'flex-end',height:60}}>
            {years.map((yr,i)=>{
              const h = Math.round((annualVals[i]/maxAnnual)*48);
              return (
                <div key={yr} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                  <div style={{fontSize:8,color:'#94a3b8',fontFamily:'JetBrains Mono,monospace'}}>${annualVals[i].toFixed(2)}</div>
                  <div style={{width:'70%',height:h+4,minHeight:4,background:'#3b82f6',borderRadius:'2px 2px 0 0',opacity:0.8}}/>
                  <div style={{fontSize:8,color:'#475569'}}>{yr}</div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {/* Recent dividend history */}
      <div style={{marginTop:12}}>
        <div style={{fontSize:9,color:'#475569',textTransform:'uppercase',letterSpacing:'0.7px',marginBottom:8}}>Recent Payments</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {sorted.slice(0,8).map((d,i)=>(
            <div key={i} style={{background:'#141720',border:'1px solid #1e2430',borderRadius:4,padding:'5px 10px',textAlign:'center'}}>
              <div style={{fontSize:9,color:'#64748b'}}>{d.date?.substring(0,10)}</div>
              <div style={{fontSize:12,fontWeight:700,color:'#22c55e',fontFamily:'JetBrains Mono,monospace'}}>${(d.dividend||d.adjDividend||0).toFixed(3)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutText({text}) {
  const [expanded,setExpanded]=React.useState(false);
  const long=text&&text.length>400;
  const display=expanded||!long?text:text.substring(0,400)+'...';
  return (
    <div>
      <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.75}}>{display}</div>
      {long&&(
        <button onClick={()=>setExpanded(e=>!e)} style={{marginTop:6,background:'none',border:'none',color:'#3b82f6',fontSize:11,cursor:'pointer',padding:0}}>
          {expanded?'▲ Show less':'▼ Read more'}
        </button>
      )}
    </div>
  );
}

// ─── CARTERA K MATRIX ────────────────────────────────────────
function CarteraKMatrix({ activeQuadrant, onSelect }) {
  const quads = [
    { id:'estanflacion', label:'Estanflación', sectors:['Oro','Energía'], x:80, y:50, color:'#D89B26', fill:'#F0E0B8' },
    { id:'inflacion', label:'Inflación', sectors:['Energía','Real estate'], x:240, y:50, color:'#B85A1E', fill:'#E8C3A7' },
    { id:'defensivo', label:'Defensivo', sectors:['Salud','Utilities','C. básico','Renta fija'], x:80, y:200, color:'#5C9156', fill:'#CFDDC8' },
    { id:'crecimiento', label:'Crecimiento', sectors:['Tecnología'], x:240, y:200, color:'#C0392B', fill:'#F0C4BD' },
  ];
  const QW=140, QH=140, W=460, H=370;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',maxWidth:W,height:'auto'}}>
      <text x={W/2} y={25} textAnchor="middle" fontSize={14} fontWeight="bold" fill="#e2e8f0">Cartera K — Macro Playbook</text>
      <text x={32} y={110} textAnchor="middle" fontSize={10} fill="#64748b">Infl. alta</text>
      <text x={32} y={270} textAnchor="middle" fontSize={10} fill="#64748b">Infl. baja</text>
      <text x={150} y={H-12} textAnchor="middle" fontSize={10} fill="#64748b">Crec. bajo</text>
      <text x={310} y={H-12} textAnchor="middle" fontSize={10} fill="#64748b">Crec. alto</text>
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

// ─── INSIDER TRACKER (SMART MONEY) ──────────────────────────
function InsiderTrackerPanel({ supabase, onAnalyze }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase
        .from('smart_money_top_buyers')
        .select('*')
        .order('month', { ascending: false })
        .order('rank',  { ascending: true })
        .limit(50);
      setRows(data || []);
      setLoading(false);
    })();
  }, [supabase]);

  return (
    <div style={{padding:16}}>
      <div style={{padding:14,background:'#1a1407',border:'1px solid #D89B26',borderRadius:8,marginBottom:14,color:'#e8c87a',fontSize:12,lineHeight:1.5}}>
        <strong>⚠ Backtest (2001–2026):</strong> Top-50 insider buyers, rebalanceo mensual, costes incluidos:{' '}
        <strong>15.1% anual vs S&P 500 9.1% · Sharpe 0.57 vs 0.48</strong>. Premium 5Y rolling actual{' '}
        <strong>−10.4%</strong> (pico +11% en 2021). Históricamente revierte tras drawdowns. No es consejo de inversión.
      </div>
      {loading
        ? <div style={{color:'#64748b',padding:16}}>Cargando…</div>
        : rows.length === 0
          ? <div style={{color:'#64748b',padding:16,textAlign:'center'}}>Sin datos aún. El cron los puebla diariamente (o dispáralo manual).</div>
          : (
            <table style={{width:'100%',fontSize:12,fontFamily:'JetBrains Mono,monospace'}}>
              <thead>
                <tr style={{color:'#64748b',textAlign:'left',borderBottom:'1px solid #1e2430'}}>
                  <th style={{padding:6}}>#</th>
                  <th style={{padding:6}}>Ticker</th>
                  <th style={{padding:6}}>Net Buying</th>
                  <th style={{padding:6}}>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(d => (
                  <tr key={d.id} style={{borderBottom:'1px solid #141720'}}>
                    <td style={{padding:6}}>{d.rank}</td>
                    <td style={{padding:6,fontWeight:600,color:'#3b82f6',cursor:'pointer'}} onClick={()=>onAnalyze&&onAnalyze(d.ticker)}>{d.ticker}</td>
                    <td style={{padding:6}}>${(d.net_insider_buying_usd/1e6).toFixed(1)}M</td>
                    <td style={{padding:6}}>{d.score?.toFixed(0)}</td>
                    <td style={{padding:6}}>
                      <button
                        onClick={()=>onAnalyze&&onAnalyze(d.ticker)}
                        style={{background:'none',border:'1px solid #2d3748',color:'#94a3b8',borderRadius:4,cursor:'pointer',fontSize:11,padding:'2px 8px'}}
                      >Analizar</button>
                    </td>
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
  const sorted = [...items].sort((a,b) => ((b.analysis?.[sortBy] ?? -999) - (a.analysis?.[sortBy] ?? -999)));
  return (
    <div style={{padding:16}}>
      <div style={{display:'flex',gap:8,marginBottom:16}}>
        <input value={newTicker} onChange={e=>setNewTicker(e.target.value)} placeholder="Añadir ticker (ej. NVDA)" onKeyDown={e=>e.key==='Enter'&&addTicker()} style={{flex:1,padding:'8px 12px',background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',borderRadius:6}}/>
        <button onClick={addTicker} style={{padding:'8px 16px',background:'#3b82f6',border:'none',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:600}}>Añadir</button>
        <button onClick={load} style={{padding:'8px 16px',background:'#1e2430',border:'1px solid #2d3748',color:'#e2e8f0',borderRadius:6,cursor:'pointer'}}>{loading?'…':'Recargar'}</button>
      </div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
        <thead>
          <tr style={{color:'#64748b',textAlign:'left',borderBottom:'1px solid #1e2430'}}>
            <th style={{padding:8}}>Ticker</th>
            <th style={{padding:8,cursor:'pointer'}} onClick={()=>setSortBy('score_total')}>Score ▾</th>
            <th style={{padding:8}}>Rating</th>
            <th style={{padding:8,cursor:'pointer'}} onClick={()=>setSortBy('macro_tilt')}>Macro Tilt</th>
            <th style={{padding:8}}>Sector</th>
            <th style={{padding:8}}></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(it => (
            <tr key={it.id} style={{borderBottom:'1px solid #141720'}}>
              <td style={{padding:8,fontWeight:600,color:'#3b82f6',cursor:'pointer'}} onClick={()=>onAnalyze&&onAnalyze(it.ticker)}>{it.ticker}</td>
              <td style={{padding:8}}>{it.analysis?.score_total ?? '—'}</td>
              <td style={{padding:8}}>{it.analysis?.rating ?? '—'}</td>
              <td style={{padding:8}}>{it.analysis?.macro_tilt ? ((it.analysis.macro_tilt>0?'+':'')+it.analysis.macro_tilt) : '—'}</td>
              <td style={{padding:8,color:'#94a3b8'}}>{it.analysis?.sector ?? '—'}</td>
              <td style={{padding:8}}><button onClick={()=>removeTicker(it.id)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer'}}>✕</button></td>
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={6} style={{padding:16,textAlign:'center',color:'#64748b'}}>Watchlist vacía. Añade tickers arriba, analízalos en Overview, y aparecerán aquí con su score.</td></tr>}
        </tbody>
      </table>
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
  if (sent) return <div style={{padding:40,textAlign:'center',color:'#e2e8f0'}}><h2>Check your email</h2><p>We sent a magic link to {email}.</p></div>;
  return (
    <div style={{maxWidth:380,margin:'80px auto',padding:32,background:'#0c0e14',borderRadius:12,border:'1px solid #1e2430'}}>
      <h2 style={{color:'#e2e8f0',marginBottom:8}}>StockLens — Login</h2>
      <p style={{color:'#64748b',fontSize:13,marginBottom:20}}>Sign in with email magic link. No password.</p>
      <input type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)}
        style={{width:'100%',padding:'10px 12px',background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',borderRadius:6,fontSize:14,marginBottom:12}}/>
      <button onClick={sendMagicLink}
        style={{width:'100%',padding:'10px',background:'#3b82f6',border:'none',color:'#fff',borderRadius:6,cursor:'pointer',fontWeight:600}}>
        Send magic link
      </button>
      {err && <div style={{color:'#f87171',fontSize:12,marginTop:10}}>{err}</div>}
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
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

  // v5.0 new state
  const [peers,         setPeers]        = useState([]);
  const [peerMetrics,   setPeerMetrics]  = useState({});
  const [cfStmts,       setCfStmts]      = useState([]);
  const [balanceSheets, setBalanceSheets]= useState([]);
  const [historicalDivs,setHistoricalDivs]=useState([]);
  const [spyHistory,    setSpyHistory]    = useState([]);
  const [macroTilt,     setMacroTilt]     = useState(null);

  const scores = useMemo(()=>calcScores(met,rat,hist,stmts),[met,rat,hist,stmts]);

  useEffect(()=>{
    const fn=()=>setScrolled(window.scrollY>180);
    window.addEventListener('scroll',fn,{passive:true});
    return ()=>window.removeEventListener('scroll',fn);
  },[]);

  useEffect(() => {
    if (!sb) { setAuthChecked(true); return; }
    sb.auth.getSession().then(({ data }) => { setSession(data.session); setAuthChecked(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const fmpGet = useCallback(async (endpoint, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    const res = await authedFetch(`/api/fmp/${endpoint}?${qs}`);
    if (res.status === 401) throw new Error('Session expired — please log in again');
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

  const fetchAiVerdict = useCallback(async (sym, scoreData, profileData, metricsData) => {
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

Write 2-3 crisp sentences. No bullet points. Reference specific metrics. End with the rating word (STRONG BUY / BUY / HOLD / CAUTION / AVOID).`;

      const res = await authedFetch('/api/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await res.json();
      const text = data?.content?.[0]?.text;
      if (text) setAiVerdict(text);
    } catch (e) {
      // Silently fail — fall back to rule-based text
    } finally {
      setAiLoading(false);
    }
  }, []);

  const analyze = useCallback(async (sym)=>{
    if (!sym) return;
    setLoading(true); setError(null); setActiveTab('Overview');
    setQuote(null); setProf(null); setMet(null); setRat(null);
    setHist([]); setStmts([]); setNews([]);
    setPtC(null); setAnalystEst(null); setUdC(null); setDcf(null);
    setDcfInputs(null); setPtList(null);
    setAiVerdict(null); setEarnCalendar(null); setEarnSurprise([]); setInsiderTxns([]);
    setPeers([]); setPeerMetrics({}); setCfStmts([]); setBalanceSheets([]); setHistoricalDivs([]);
    setSpyHistory([]);
    setMacroTilt(null);
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
        fmpGet('balance-sheet-statement',      { symbol: sym, period: 'quarter', limit: '4' }),
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

      // Fetch peer metrics in background (non-blocking)
      if (peerList.length > 0) {
        (async () => {
          try {
            const peerResults = await Promise.allSettled(
              peerList.map(ps => Promise.all([
                fmpGet('key-metrics-ttm', { symbol: ps }),
                fmpGet('ratios-ttm',      { symbol: ps }),
                fmpGet('profile',         { symbol: ps }),
              ]))
            );
            const peerMap = {};
            peerList.forEach((ps, i) => {
              const r = peerResults[i];
              if (r.status === 'fulfilled') {
                const [mRes, rRes, prRes] = r.value;
                peerMap[ps] = {
                  met:  Array.isArray(mRes)  ? mRes[0]  : mRes,
                  rat:  Array.isArray(rRes)  ? rRes[0]  : rRes,
                  name: (Array.isArray(prRes) ? prRes[0] : prRes)?.companyName || ps,
                };
              }
            });
            setPeerMetrics(peerMap);
          } catch(e) { /* silent fail */ }
        })();
      }

      // Populate DCF defaults from real data
      const bs0 = bsArr[0] || null;
      const q0  = sD_[0];
      const baseRevenue = q0?.revenue ? q0.revenue * 4 : null;
      const netDebt = bs0?.netDebt ?? (bs0 ? (bs0.totalDebt||0) - (bs0.cashAndCashEquivalents||0) : null);
      const shares = quote_?.sharesOutstanding ?? pD_?.sharesOutstanding ?? null;
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
        const [earnCalRes, earnSurpRes, insiderRes] = await Promise.allSettled([
          finnhubGet('calendar/earnings', { symbol: sym, from, to }),
          finnhubGet('stock/earnings',    { symbol: sym, limit: '8' }),
          finnhubGet('stock/insider-transactions', { symbol: sym }),
        ]);
        const fg = r => r.status === 'fulfilled' ? r.value : null;
        const [ec, es, it] = [earnCalRes, earnSurpRes, insiderRes].map(fg);
        setEarnCalendar(ec?.earningsCalendar?.[0] || null);
        setEarnSurprise(Array.isArray(es) ? es.slice(0, 8) : []);
        setInsiderTxns(Array.isArray(it?.data) ? it.data.slice(0, 10) : []);
      }

      // AI verdict
      const scores_ = calcScores(met_, rat_, hD_, sD_);
      fetchAiVerdict(sym, scores_, pD_, met_);

      // Compute macro tilt from IC DataLayer macro_state
      const _mt = await computeMacroTilt(sb, pD_?.sector, met_?.netDebtToEBITDATTM, met_?.peRatioTTM ?? met_?.priceToEarningsRatioTTM);
      setMacroTilt(_mt);

      // Persist analysis to Supabase
      if (sb) {
        try {
          const { data: { session: sess } } = await sb.auth.getSession();
          if (sess) {
            await sb.from('sl_analyses').insert({
              user_id: sess.user.id,
              ticker: sym.toUpperCase(),
              analysis_date: new Date().toISOString().slice(0,10),
              score_total: scores_.total, score_val: scores_.val, score_hlth: scores_.hlth,
              score_mom: scores_.mom, score_growth: scores_.growth,
              rating: getRating(scores_.total)?.label,
              macro_tilt: _mt?.tilt || 0,
              sector: pD_?.sector || null,
            });
          }
        } catch(e) { /* no romper el análisis si falla el guardado */ }
      }

    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  },[fmpGet, finnhubGet, fetchAiVerdict]);

  const handleSearch=()=>{const s=inputTicker.trim().toUpperCase();if(s) analyze(s);};

  // Derived
  const sorted    = useMemo(()=>[...hist].sort((a,b)=>new Date(a.date)-new Date(b.date)),[hist]);
  const priceNow  = quote?.price||sorted[sorted.length-1]?.close;
  const price12m  = sorted[0]?.close;
  const ret12m    = (ok(priceNow)&&ok(price12m)&&price12m>0)?(priceNow-price12m)/price12m:null;
  const chg1d     = quote?.changePercentage;
  const isUpDay   = (chg1d||0)>=0;

  const hasData = !!(quote||prof);
  const r = scores ? getRating(scores.total) : null;

  const bm = useMemo(()=>SECTOR_BM[prof?.sector]||null,[prof?.sector]);

  const dcfVal    = dcf?.dcf;
  const mosFrac   = (ok(dcfVal)&&ok(priceNow)&&dcfVal>0)?(dcfVal-priceNow)/dcfVal:null;
  const mosColor  = !ok(mosFrac)?'#475569':mosFrac>0.15?'#22c55e':mosFrac>-0.15?'#fbbf24':'#f87171';

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

  const tabs=['Overview','Fundamentals','Screener','Smart Money','Valuation','Chart','Research'];

  if (!authChecked) return null;
  if (!session) return <LoginScreen/>;

  return (
    <div style={{
      minHeight:'100vh',background:'#07080c',color:'#e2e8f0',
      fontFamily:"'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif",
      paddingBottom:60
    }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#07080c}
        ::-webkit-scrollbar-thumb{background:#1e2430;border-radius:3px}
        input::placeholder{color:#334155}
        a{color:inherit;text-decoration:none}
        button:hover{opacity:0.88}
      `}</style>

      {/* ── Sticky compact sub-header ── */}
      {scrolled&&hasData&&ticker&&(
        <div style={{
          position:'fixed',top:52,left:0,right:0,zIndex:190,
          background:'#0a0b10ee',backdropFilter:'blur(8px)',
          borderBottom:'1px solid #161b26',
          padding:'8px 24px',display:'flex',alignItems:'center',gap:12
        }}>
          {prof?.image&&<img src={prof.image} alt={ticker} style={{width:22,height:22,objectFit:'contain',borderRadius:3,background:'#fff',padding:2}}/>}
          <span style={{fontSize:14,fontWeight:800,color:'#fff',fontFamily:'JetBrains Mono,monospace'}}>{ticker}</span>
          <span style={{fontSize:12,color:'#64748b'}}>{prof?.companyName}</span>
          <span style={{fontSize:14,fontWeight:700,color:'#e2e8f0',fontFamily:'JetBrains Mono,monospace',marginLeft:'auto'}}>{fmt.price(priceNow)}</span>
          <span style={{fontSize:12,fontWeight:600,color:isUpDay?'#22c55e':'#f87171'}}>{isUpDay?'▲':'▼'}{Math.abs(chg1d||0).toFixed(2)}%</span>
          {r&&<div style={{padding:'2px 10px',borderRadius:12,background:r.bg,border:`1px solid ${r.border}`,fontSize:10,fontWeight:700,color:r.color,letterSpacing:'1px'}}>{r.label}</div>}
          {macroTilt && macroTilt.tilt !== 0 && (
            <span title={(macroTilt?.reasons||[]).join(" · ")}
              style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",marginLeft:8,borderRadius:4,
                background: macroTilt.tilt>0 ? "#22c55e22":"#ef444422",
                border:`1px solid ${macroTilt.tilt>0?"#22c55e":"#ef4444"}`,
                fontSize:11,fontFamily:"JetBrains Mono,monospace",cursor:"help"}}>
              Macro Tilt: {macroTilt.tilt>0?"+":""}{macroTilt.tilt}
            </span>
          )}
        </div>
      )}

      {/* ── Top navbar ── */}
      <div style={{
        background:'#0a0b10',borderBottom:'1px solid #161b26',
        padding:'0 24px',display:'flex',flexDirection:'column',
        position:'sticky',top:0,zIndex:200
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:52}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:18,fontWeight:800,color:'#fff',letterSpacing:'-0.5px'}}>⚡ StockLens</span>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <input
              value={inputTicker}
              onChange={e=>setInputTicker(e.target.value.toUpperCase())}
              onKeyDown={e=>e.key==='Enter'&&handleSearch()}
              placeholder="TICKER"
              maxLength={10}
              style={{
                background:'#141720',border:'1px solid #1e2430',color:'#fff',
                padding:'7px 13px',borderRadius:6,fontSize:14,fontWeight:700,
                width:110,outline:'none',fontFamily:'JetBrains Mono,monospace',
                letterSpacing:'1.5px',textTransform:'uppercase'
              }}
            />
            <button onClick={handleSearch} disabled={loading||!inputTicker.trim()} style={{
              background:loading?'#1e2430':'#3b82f6',color:'#fff',border:'none',
              padding:'7px 18px',borderRadius:6,cursor:loading?'not-allowed':'pointer',
              fontSize:13,fontWeight:600,whiteSpace:'nowrap'
            }}>{loading?'…':'Analyze'}</button>
            <button onClick={() => sb && sb.auth.signOut()} title="Sign out" style={{
              background:'#141720',color:'#475569',
              border:'1px solid #1e2430',padding:'7px 11px',borderRadius:6,
              cursor:'pointer',fontSize:13
            }}>⏻</button>
          </div>
        </div>
        {recentTickers.length>0&&(
          <div style={{display:'flex',gap:6,paddingBottom:8,alignItems:'center'}}>
            <span style={{fontSize:9,color:'#334155',textTransform:'uppercase',letterSpacing:'0.5px',marginRight:2}}>Recent:</span>
            {recentTickers.map(t=>(
              <button key={t} onClick={()=>{setInputTicker(t);analyze(t);}} style={{
                background:'#141720',border:'1px solid #1e2430',color:'#64748b',
                padding:'2px 10px',borderRadius:4,cursor:'pointer',fontSize:11,
                fontFamily:'JetBrains Mono,monospace',fontWeight:600
              }}>{t}</button>
            ))}
          </div>
        )}
      </div>


      {/* ── Content ── */}
      <div style={{maxWidth:1120,margin:'0 auto',padding:'0 24px'}}>

        {/* Empty state */}
        {!loading&&!hasData&&!error&&(
          <div style={{textAlign:'center',padding:'90px 20px'}}>
            <div style={{fontSize:52,marginBottom:14}}>⚡</div>
            <div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens</div>
            <div style={{fontSize:13,color:'#334155',maxWidth:400,margin:'0 auto 32px',lineHeight:1.7}}>
              Professional stock analysis — enter any ticker to get started. 4-dimensional scoring: valuation, financial health, momentum, and growth.
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'center',flexWrap:'wrap'}}>
              {['AAPL','MSFT','NVDA','AMZN','META','COST','V','ASML'].map(t=>(
                <button key={t} onClick={()=>{setInputTicker(t);analyze(t);}} style={{
                  background:'#141720',border:'1px solid #1e2430',color:'#94a3b8',
                  padding:'6px 14px',borderRadius:6,cursor:'pointer',fontSize:12,
                  fontFamily:'JetBrains Mono,monospace',fontWeight:600
                }}>{t}</button>
              ))}
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading&&<LoadingSkeleton/>}

        {/* Error */}
        {!loading&&error&&(
          <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:8,padding:'16px 20px',margin:'24px 0'}}>
            <div style={{color:'#f87171',fontSize:13,marginBottom:error.includes('limit')?12:0}}>
              ⚠ {error}
            </div>
            {error.includes('limit')&&(
              <div style={{fontSize:11,color:'#64748b',marginTop:8}}>
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
                      <span style={{fontSize:11,color:'#334155'}}>{[prof?.exchange,prof?.sector,prof?.industry].filter(Boolean).join(' · ')}</span>
                      {prof?.exchange&&(
                        <span style={{
                          fontSize:9,padding:'1px 6px',borderRadius:3,fontWeight:700,
                          background:prof.exchange.includes('NASDAQ')?'#1e3a5f':prof.exchange.includes('NYSE')?'#1a3a1a':'#2a2a1a',
                          color:prof.exchange.includes('NASDAQ')?'#60a5fa':prof.exchange.includes('NYSE')?'#4ade80':'#fbbf24'
                        }}>{prof.exchange}</span>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'baseline',gap:10,flexWrap:'wrap'}}>
                      <div style={{fontSize:28,fontWeight:800,color:'#fff',fontFamily:'JetBrains Mono,monospace'}}>{ticker}</div>
                      <div style={{fontSize:16,color:'#94a3b8',fontWeight:500}}>{prof?.companyName}</div>
                    </div>
                    <div style={{display:'flex',gap:14,marginTop:6,fontSize:11,color:'#475569',flexWrap:'wrap'}}>
                      {prof?.ceo&&<span>CEO: {prof.ceo}</span>}
                      {prof?.fullTimeEmployees&&<span>👥 {Number(prof.fullTimeEmployees).toLocaleString()} employees</span>}
                      {prof?.ipoDate&&<span>Est. {prof.ipoDate?.substring(0,4)}</span>}
                      {prof?.website&&<a href={prof.website} target="_blank" rel="noopener noreferrer" style={{color:'#3b82f6'}}>{prof.website?.replace(/^https?:\/\//,'')}</a>}
                    </div>
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:32,fontWeight:800,color:'#fff',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
                    {fmt.price(priceNow)}
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:isUpDay?'#22c55e':'#f87171',marginTop:3}}>
                    {isUpDay?'▲':'▼'} {Math.abs(chg1d||0).toFixed(2)}% today
                  </div>
                  {ok(ret12m)&&(
                    <div style={{fontSize:11,color:ret12m>=0?'#4ade80':'#f87171'}}>
                      {ret12m>=0?'▲':'▼'} {Math.abs(ret12m*100).toFixed(1)}% past 12m
                    </div>
                  )}
                  <div style={{fontSize:11,color:'#334155',marginTop:3}}>
                    Mkt Cap {fmt.usd(quote?.marketCap)} · Avg Vol {fmt.usd(quote?.averageVolume)}
                  </div>
                  <button
                    onClick={()=>setActiveTab('Valuation')}
                    style={{marginTop:8,background:'#141720',border:'1px solid #1e2430',borderRadius:5,padding:'5px 12px',color:'#3b82f6',fontSize:11,cursor:'pointer'}}
                  >→ See Valuation</button>
                </div>
              </div>
            </Panel>

            {/* Tab bar */}
            <div style={{
              background:'#0c0e14',borderLeft:'1px solid #161b26',borderRight:'1px solid #161b26',
              display:'flex',gap:0,
              position:'sticky',top:52+(recentTickers.length>0?32:0),zIndex:100
            }}>
              {tabs.map(tab=>(
                <button key={tab} onClick={()=>setActiveTab(tab)} style={{
                  background:'none',border:'none',borderBottom:activeTab===tab?'2px solid #3b82f6':'2px solid transparent',
                  color:activeTab===tab?'#e2e8f0':'#475569',
                  padding:'10px 20px',cursor:'pointer',fontSize:12,fontWeight:600,
                  letterSpacing:'0.3px',transition:'color 0.15s',whiteSpace:'nowrap'
                }}>{tab}</button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{
              background:'#0c0e14',border:'1px solid #161b26',
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
                        <ScoreBar label="Valuation"        value={scores.val}    max={25} color="#60a5fa"/>
                        <ScoreBar label="Financial Health"  value={scores.hlth}   max={30} color="#22c55e"/>
                        <ScoreBar label="Momentum"          value={scores.mom}    max={25} color="#fbbf24"/>
                        <ScoreBar label="Growth"            value={scores.growth} max={20} color="#a78bfa"/>
                      </div>
                      {earnCalendar&&<EarningsCalendarBadge earn={earnCalendar}/>}
                    </div>
                    <div>
                      <SectionTitle>Key Metrics — TTM</SectionTitle>
                      {ok(quote?.yearHigh) && ok(quote?.yearLow) && ok(priceNow) && (
                        <div style={{marginBottom:14}}>
                          <div style={{fontSize:10,color:'#475569',marginBottom:6,textTransform:'uppercase',letterSpacing:'0.5px'}}>52-Week Range</div>
                          <div style={{position:'relative',height:6,background:'#1e2430',borderRadius:3}}>
                            <div style={{
                              position:'absolute',left:0,
                              width:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
                              height:'100%',background:'#3b82f6',borderRadius:3,transition:'width 0.8s ease'
                            }}/>
                            <div style={{
                              position:'absolute',
                              left:`${Math.min(100,Math.max(0,((priceNow-quote.yearLow)/(quote.yearHigh-quote.yearLow))*100))}%`,
                              top:-3,transform:'translateX(-50%)',
                              width:12,height:12,background:'#fff',borderRadius:'50%',border:'2px solid #3b82f6'
                            }}/>
                          </div>
                          <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'#475569',fontFamily:'JetBrains Mono,monospace'}}>
                            <span>{fmt.price(quote.yearLow)} <span style={{color:'#334155'}}>52W Low</span></span>
                            <span style={{color:'#e2e8f0',fontWeight:700}}>{fmt.price(priceNow)}</span>
                            <span><span style={{color:'#334155'}}>52W High</span> {fmt.price(quote.yearHigh)}</span>
                          </div>
                        </div>
                      )}
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:9}}>
                        <KPIBadge label="P/E Ratio"      value={fmt.mult(met?.peRatioTTM??met?.priceToEarningsRatioTTM)}         sub="trailing 12 months"    bmVal={bm?.pe}   bmLabel="sector avg"/>
                        <KPIBadge label="EV/EBITDA"       value={fmt.mult(met?.evToEBITDATTM??met?.enterpriseValueOverEBITDATTM)}   sub="enterprise value mult." bmVal={bm?.ev}   bmLabel="sector avg"/>
                        <KPIBadge label="P/FCF"           value={fmt.mult(met?.pfcfRatioTTM??met?.priceToFreeCashFlowRatioTTM)}     sub="price / free cash flow"/>
                        <KPIBadge label="Gross Margin"    value={fmt.pct(rat?.grossProfitMarginTTM)}             sub="TTM"
                          highlight={ok(rat?.grossProfitMarginTTM)?(rat.grossProfitMarginTTM>=0.4?'#22c55e':rat.grossProfitMarginTTM>=0.2?'#fbbf24':'#f87171'):undefined}
                          bmVal={bm?.gm} bmLabel="sector avg"/>
                        <KPIBadge label="ROIC"            value={fmt.pct(met?.returnOnInvestedCapitalTTM??met?.roicTTM)}       sub="return on inv. capital"
                          highlight={ok(met?.returnOnInvestedCapitalTTM??met?.roicTTM)?((met?.returnOnInvestedCapitalTTM??met?.roicTTM)>=0.15?'#22c55e':(met?.returnOnInvestedCapitalTTM??met?.roicTTM)>=0.06?'#fbbf24':'#f87171'):undefined}
                          bmVal={bm?.roic} bmLabel="sector avg"/>
                        <KPIBadge label="Net Debt/EBITDA" value={fmt.ndx(met?.netDebtToEBITDATTM)}              sub={ok(met?.netDebtToEBITDATTM)&&met.netDebtToEBITDATTM<0?'net cash position':'leverage'}
                          highlight={ok(met?.netDebtToEBITDATTM)?(met.netDebtToEBITDATTM<0?'#22c55e':met.netDebtToEBITDATTM<2?'#fbbf24':'#f87171'):undefined}/>
                        <KPIBadge label="FCF Yield"       value={fmt.pct(met?.freeCashFlowYieldTTM)}            sub="TTM"/>
                        <KPIBadge label="ROE"             value={fmt.pct(met?.returnOnEquityTTM??met?.roeTTM)}               sub="return on equity"/>
                        <KPIBadge label="Interest Coverage" value={fmt.mult(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)}     sub="EBIT / interest expense"
                          highlight={ok(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)?((met?.interestCoverageTTM??met?.interestCoverageRatioTTM)>=10?'#22c55e':(met?.interestCoverageTTM??met?.interestCoverageRatioTTM)>=3?'#fbbf24':'#f87171'):undefined}/>
                        <KPIBadge label="P/Book"      value={fmt.mult(rat?.priceToBookRatioTTM??met?.pbRatioTTM)}     sub="price / book value"/>
                        <KPIBadge label="P/Sales"     value={fmt.mult(rat?.priceToSalesRatioTTM)}   sub="price / revenue TTM"/>
                        <KPIBadge label="Div. Yield"  value={fmt.pct(met?.dividendYieldTTM)}         sub="annual dividend yield"/>
                        <KPIBadge label="Beta"        value={ok(quote?.beta) ? quote.beta.toFixed(2) : (ok(prof?.beta) ? parseFloat(prof.beta).toFixed(2) : '—')} sub="market sensitivity"/>
                      </div>
                    </div>
                  </div>

                  <HealthScorePanel met={met} rat={rat} hist={hist} stmts={stmts} scores={scores}/>

                  {(ptC||udC)&&(
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
                      <AnalystPanel ptC={ptC} udC={udC} analystEst={analystEst} currentPrice={priceNow} ptList={ptList}/>
                    </div>
                  )}

                  {prof?.description&&(
                    <div>
                      <SectionTitle>About {prof.companyName}</SectionTitle>
                      <AboutText text={prof.description}/>
                    </div>
                  )}

                  <div style={{padding:16,background:'#0c0e14',border:'1px solid #1e2430',borderRadius:8,marginTop:16}}>
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
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
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
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
                      <BalanceSheetPanel bsData={balanceSheets}/>
                    </div>
                  )}
                  {cfStmts.length>0&&(
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
                      <FCFPanel cfData={cfStmts} incomeData={stmts}/>
                    </div>
                  )}
                  {historicalDivs.length>0&&(
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
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
                </div>
              )}

              {/* ── CHART TAB ── */}
              {activeTab==='Chart'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <div>
                    <div style={{display:'flex',gap:6,marginBottom:10,alignItems:'center'}}>
                      <span style={{fontSize:10,color:'#475569',marginRight:4}}>PERIOD:</span>
                      {['1M','3M','6M','1Y','5Y'].map(p=>(
                        <button key={p} onClick={()=>setChartPeriod(p)} style={{
                          background:chartPeriod===p?'#1e3a5f':'#141720',
                          color:chartPeriod===p?'#60a5fa':'#475569',
                          border:`1px solid ${chartPeriod===p?'#3b82f6':'#1e2430'}`,
                          padding:'3px 12px',borderRadius:4,cursor:'pointer',fontSize:11,
                          fontFamily:'JetBrains Mono,monospace',fontWeight:600
                        }}>{p}</button>
                      ))}
                    </div>
                    {hist.length>0
                      ? <PriceChart history={hist} ticker={ticker} period={chartPeriod}/>
                      : <div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'#334155',fontSize:12}}>No price data</div>
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
                        <div style={{fontSize:11,color:'#64748b',marginBottom:8}}>
                          Current P/E: <span style={{color:'#e2e8f0',fontWeight:700,fontFamily:'JetBrains Mono,monospace'}}>{peCurrent}x</span>
                          &nbsp;·&nbsp; Range: <span style={{fontFamily:'JetBrains Mono,monospace'}}>{peMin}x – {peMax}x</span>
                        </div>
                        <Sparkline data={peHistory.map(d=>d.pe)} type="line" color="#a78bfa" h={60} w={760}/>
                        <div style={{fontSize:9,color:'#334155',marginTop:4}}>Based on trailing quarterly EPS × 4 (annualized)</div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── SCREENER TAB ── */}
              {activeTab==='Screener'&&(
                <WatchlistManager supabase={sb} onAnalyze={(t)=>{ setInputTicker(t); setActiveTab('Overview'); analyze(t); }}/>
              )}

              {/* ── SMART MONEY TAB ── */}
              {activeTab==='Smart Money'&&(
                <InsiderTrackerPanel supabase={sb} onAnalyze={(t)=>{ setInputTicker(t); setActiveTab('Overview'); analyze(t); }}/>
              )}

              {/* ── RESEARCH TAB ── */}
              {activeTab==='Research'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <OvervaluationBanner metrics={met} ratios={rat} profile={prof}/>
                  <FactorTiltCard metrics={met} ratios={rat} history={hist} stmts={stmts} profile={prof}/>
                  <QualityMoatCard metrics={met} ratios={rat} stmts={stmts} profile={prof}/>
                  <VerdictSection scores={scores} profile={prof} metrics={met} ratios={rat} aiVerdict={aiVerdict} aiLoading={aiLoading}/>
                  {news.length>0&&<NewsCard items={news}/>}

                  <>
                    {earnSurprise.length>0&&<EarningsSurpriseChart data={earnSurprise}/>}
                    {insiderTxns.length>0&&<InsiderTable data={insiderTxns}/>}
                  </>

                  <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'14px 18px'}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:8}}>SEC EDGAR Filings</div>
                    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=4&dateb=&owner=include&count=20`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
                      >
                        Form 4 — Insider Filings ↗
                      </a>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=10-K&dateb=&owner=include&count=5`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
                      >
                        10-K Annual Reports ↗
                      </a>
                      <a
                        href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${ticker}&type=13F&dateb=&owner=include&count=5`}
                        target="_blank" rel="noopener noreferrer"
                        style={{fontSize:11,color:'#60a5fa',background:'#1e3a5f22',border:'1px solid #1e3a5f',padding:'5px 12px',borderRadius:5}}
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
      <div style={{textAlign:'center',marginTop:48,fontSize:10,color:'#1e2430',lineHeight:1.8}}>
        StockLens v5.0 · Data: Financial Modeling Prep · Not financial advice · {new Date().getFullYear()}
        {ticker&&quote&&<span> · Last updated: {new Date().toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
