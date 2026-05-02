// ============================================================
// StockLens v1.0 — Stock Analysis App
// Stack: React 18 UMD · Financial Modeling Prep API
// No imports — global React from CDN, pre-compiled by Babel
// ============================================================

const { useState, useCallback, useMemo } = React;

const DEFAULT_FMP_KEY = 'wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2';

// ─── FORMATTERS ─────────────────────────────────────────────
const ok = (v) => v != null && !isNaN(v) && isFinite(v);

const fmt = {
  pct:  (v, d=1) => ok(v) ? `${(v*100).toFixed(d)}%` : '—',
  mult: (v, d=1) => ok(v) && v > 0 ? `${v.toFixed(d)}x` : (ok(v) ? `${v.toFixed(d)}x` : '—'),
  price:(v)      => ok(v) ? `$${v.toFixed(2)}` : '—',
  chg:  (v)      => ok(v) ? (v>=0?'+':'')+`${(v*100).toFixed(2)}%` : '—',
  usd:  (v) => {
    if (!ok(v)) return '—';
    const a=Math.abs(v), s=v<0?'-':'';
    if (a>=1e12) return `${s}$${(a/1e12).toFixed(2)}T`;
    if (a>=1e9)  return `${s}$${(a/1e9).toFixed(1)}B`;
    if (a>=1e6)  return `${s}$${(a/1e6).toFixed(1)}M`;
    return `${s}$${a.toFixed(0)}`;
  },
  ndx: (v) => ok(v) ? (v<0?`${v.toFixed(1)}x (net cash)`:`${v.toFixed(1)}x`) : '—',
};

// ─── SCORING ────────────────────────────────────────────────
function calcScores(metrics, ratios, history) {
  let val=0, hlth=0, mom=0;

  if (metrics && ratios) {
    const pe    = metrics.peRatioTTM;
    const ev    = metrics.enterpriseValueOverEBITDATTM;
    const pfcf  = metrics.pfcfRatioTTM;
    const fvr   = ratios.priceFairValueTTM;
    const gm    = ratios.grossProfitMarginTTM;
    const roic  = metrics.roicTTM;
    const nd    = metrics.netDebtToEBITDATTM;
    const roe   = metrics.roeTTM;
    const ic    = metrics.interestCoverageTTM;

    // P/E (0–12 pts)
    if (ok(pe)&&pe>0) {
      if      (pe<12)  val+=12;
      else if (pe<18)  val+=10;
      else if (pe<25)  val+=8;
      else if (pe<35)  val+=5;
      else if (pe<50)  val+=3;
      else             val+=1;
    }
    // EV/EBITDA (0–9 pts)
    if (ok(ev)&&ev>0) {
      if      (ev<8)   val+=9;
      else if (ev<12)  val+=7;
      else if (ev<18)  val+=5;
      else if (ev<25)  val+=3;
      else if (ev<35)  val+=1;
    }
    // P/FCF (0–9 pts)
    if (ok(pfcf)&&pfcf>0) {
      if      (pfcf<12) val+=9;
      else if (pfcf<20) val+=7;
      else if (pfcf<28) val+=5;
      else if (pfcf<40) val+=2;
      else              val+=1;
    }
    // Fair Value ratio (0–5 pts)
    if (ok(fvr)) {
      if      (fvr<0.85) val+=5;
      else if (fvr<1.00) val+=4;
      else if (fvr<1.15) val+=2;
      else if (fvr<1.30) val+=1;
    }
    val = Math.min(35, val);

    // Gross Margin (0–8 pts)
    if (ok(gm)) {
      if      (gm>=0.65) hlth+=8;
      else if (gm>=0.45) hlth+=7;
      else if (gm>=0.30) hlth+=5;
      else if (gm>=0.15) hlth+=3;
      else if (gm>=0.05) hlth+=1;
    }
    // ROIC (0–8 pts)
    if (ok(roic)) {
      if      (roic>=0.25) hlth+=8;
      else if (roic>=0.18) hlth+=7;
      else if (roic>=0.12) hlth+=5;
      else if (roic>=0.06) hlth+=3;
      else if (roic>=0)    hlth+=1;
    }
    // Net Debt/EBITDA (0–8 pts)
    if (ok(nd)) {
      if      (nd<-1.0)  hlth+=8;
      else if (nd<0)     hlth+=7;
      else if (nd<0.5)   hlth+=6;
      else if (nd<1.5)   hlth+=4;
      else if (nd<2.5)   hlth+=2;
      else if (nd<4)     hlth+=1;
    }
    // ROE (0–6 pts)
    if (ok(roe)) {
      if      (roe>=0.35) hlth+=6;
      else if (roe>=0.20) hlth+=5;
      else if (roe>=0.12) hlth+=3;
      else if (roe>=0.05) hlth+=1;
    }
    // Interest Coverage (0–5 pts)
    if (ok(ic)) {
      if      (ic>=20) hlth+=5;
      else if (ic>=10) hlth+=4;
      else if (ic>=5)  hlth+=3;
      else if (ic>=2)  hlth+=1;
    }
    hlth = Math.min(35, hlth);
  }

  if (history && history.length>10) {
    const s   = [...history].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const cur = s[s.length-1]?.close;
    const p3  = s[Math.max(0,s.length-63)]?.close;
    const p6  = s[Math.max(0,s.length-126)]?.close;
    const p12 = s[0]?.close;
    const ret = (now,then) => (ok(now)&&ok(then)&&then>0) ? (now-then)/then : null;

    const r12=ret(cur,p12), r6=ret(cur,p6), r3=ret(cur,p3);

    // 12m return (0–12 pts)
    if (ok(r12)) {
      if      (r12>0.40)  mom+=12;
      else if (r12>0.20)  mom+=10;
      else if (r12>0.08)  mom+=8;
      else if (r12>0)     mom+=5;
      else if (r12>-0.10) mom+=3;
      else if (r12>-0.25) mom+=1;
    }
    // 6m return (0–10 pts)
    if (ok(r6)) {
      if      (r6>0.20)  mom+=10;
      else if (r6>0.10)  mom+=8;
      else if (r6>0.03)  mom+=6;
      else if (r6>-0.03) mom+=4;
      else if (r6>-0.12) mom+=2;
    }
    // 3m return (0–8 pts)
    if (ok(r3)) {
      if      (r3>0.12)  mom+=8;
      else if (r3>0.06)  mom+=6;
      else if (r3>0.01)  mom+=4;
      else if (r3>-0.05) mom+=2;
    }
    mom = Math.min(30, mom);
  }

  return { val, hlth, mom, total: val+hlth+mom };
}

function getRating(s) {
  if (s>=80) return { label:'STRONG BUY', color:'#22c55e', bg:'#0d2e1a', border:'#166534' };
  if (s>=65) return { label:'BUY',        color:'#4ade80', bg:'#0d2318', border:'#14532d' };
  if (s>=50) return { label:'HOLD',       color:'#fbbf24', bg:'#2a1f00', border:'#78350f' };
  if (s>=35) return { label:'CAUTION',    color:'#f97316', bg:'#2a1200', border:'#7c2d12' };
  return       { label:'AVOID',           color:'#f87171', bg:'#2a0d0d', border:'#7f1d1d' };
}

// ─── SMALL COMPONENTS ────────────────────────────────────────
function Spinner() {
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:16,padding:80}}>
      <div style={{
        width:44,height:44,border:'3px solid #1e2430',
        borderTopColor:'#3b82f6',borderRadius:'50%',
        animation:'spin 0.8s linear infinite'
      }}/>
      <div style={{color:'#475569',fontSize:13,fontFamily:'JetBrains Mono,monospace'}}>Analyzing...</div>
    </div>
  );
}

function KPIBadge({label, value, sub, highlight}) {
  return (
    <div style={{
      background:'#141720',border:'1px solid #1e2430',borderRadius:6,
      padding:'10px 14px',display:'flex',flexDirection:'column',gap:3
    }}>
      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
      <div style={{
        fontSize:17,fontWeight:700,
        color: highlight || '#e2e8f0',
        fontFamily:'JetBrains Mono,monospace',lineHeight:1
      }}>{value}</div>
      {sub && <div style={{fontSize:10,color:'#334155'}}>{sub}</div>}
    </div>
  );
}

function HealthCard({label, value, status, note}) {
  const C = {
    green:   {bg:'#0d2e1a',border:'#166534',badge:'#22c55e',icon:'✓ BEAT'},
    amber:   {bg:'#2a1f00',border:'#78350f',badge:'#fbbf24',icon:'⚠ WATCH'},
    red:     {bg:'#2a0d0d',border:'#7f1d1d',badge:'#f87171',icon:'✗ MISS'},
    neutral: {bg:'#141720',border:'#1e2430',badge:'#475569',icon:'— N/A'},
  }[status||'neutral'];
  return (
    <div style={{
      background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,
      padding:'12px 14px',display:'flex',flexDirection:'column',gap:4
    }}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:10,color:'#64748b',textTransform:'uppercase',letterSpacing:'0.5px'}}>{label}</div>
        <div style={{fontSize:10,fontWeight:700,color:C.badge}}>{C.icon}</div>
      </div>
      <div style={{fontSize:19,fontWeight:800,color:C.badge,fontFamily:'JetBrains Mono,monospace',lineHeight:1.1}}>{value}</div>
      {note && <div style={{fontSize:10,color:'#475569'}}>{note}</div>}
    </div>
  );
}

function ScoreGauge({score}) {
  const r   = getRating(score);
  const cir = 2*Math.PI*52;
  const prog= (score/100)*cir;
  const col = score>=65?'#22c55e':score>=50?'#fbbf24':'#f87171';
  return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
      <div style={{position:'relative',width:136,height:136}}>
        <svg width="136" height="136" style={{transform:'rotate(-90deg)'}}>
          <circle cx="68" cy="68" r="52" fill="none" stroke="#1e2430" strokeWidth="10"/>
          <circle cx="68" cy="68" r="52" fill="none" stroke={col} strokeWidth="10"
            strokeDasharray={`${prog} ${cir}`} strokeLinecap="round"
            style={{transition:'stroke-dasharray 1.2s ease-in-out'}}/>
        </svg>
        <div style={{
          position:'absolute',top:'50%',left:'50%',
          transform:'translate(-50%,-50%)',
          display:'flex',flexDirection:'column',alignItems:'center'
        }}>
          <div style={{fontSize:34,fontWeight:800,color:col,fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>{score}</div>
          <div style={{fontSize:9,color:'#475569',letterSpacing:'1px'}}>/100</div>
        </div>
      </div>
      <div style={{
        padding:'4px 18px',borderRadius:20,
        background:r.bg,border:`1px solid ${r.border}`,
        fontSize:11,fontWeight:700,color:r.color,letterSpacing:'1.5px'
      }}>{r.label}</div>
    </div>
  );
}

function ScoreBar({label, value, max, color}) {
  const pct = Math.min(100, (value/max)*100);
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

function PriceChart({history, ticker}) {
  const sorted = useMemo(()=>[...history].sort((a,b)=>new Date(a.date)-new Date(b.date)),[history]);
  if (!sorted.length) return <div style={{height:110,display:'flex',alignItems:'center',justifyContent:'center',color:'#334155',fontSize:12}}>No price data</div>;

  const prices  = sorted.map(d=>d.close);
  const minP    = Math.min(...prices);
  const maxP    = Math.max(...prices);
  const range   = maxP-minP || 1;
  const W=800, H=110, pt=8, pb=22, pl=8, pr=8;
  const cw=W-pl-pr, ch=H-pt-pb;

  const px = (i)=> pl + (i/(prices.length-1))*cw;
  const py = (p)=> pt + (1-(p-minP)/range)*ch;
  const points = prices.map((p,i)=>`${px(i)},${py(p)}`).join(' ');
  const fillPts = `${pl},${H-pb} ${points} ${W-pr},${H-pb}`;

  const isUp    = prices[prices.length-1] >= prices[0];
  const stroke  = isUp ? '#22c55e' : '#f87171';
  const ret12m  = prices[0]>0 ? (prices[prices.length-1]-prices[0])/prices[0] : null;

  // Month tick labels
  const ticks = [];
  let lastM = -1;
  sorted.forEach((d,i)=>{
    const m = new Date(d.date).getMonth();
    if (m!==lastM) { ticks.push({i,m}); lastM=m; }
  });
  const mLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <div style={{fontSize:11,color:'#475569'}}>{ticker} — 12-month price history</div>
        <div style={{fontSize:12,fontWeight:700,color:isUp?'#22c55e':'#f87171',fontFamily:'JetBrains Mono,monospace'}}>
          ${prices[prices.length-1].toFixed(2)} {ok(ret12m)&&<span style={{fontSize:11}}>({fmt.chg(ret12m)} 12m)</span>}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height:110}}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.18"/>
            <stop offset="100%" stopColor={stroke} stopOpacity="0.01"/>
          </linearGradient>
        </defs>
        {[0.25,0.5,0.75].map(f=>(
          <line key={f} x1={pl} x2={W-pr} y1={pt+f*ch} y2={pt+f*ch} stroke="#1a1e28" strokeWidth="1"/>
        ))}
        <polygon points={fillPts} fill="url(#sg)"/>
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round"/>
        {ticks.filter((_,i)=>i%2===0).map(({i,m})=>(
          <text key={m} x={px(i)} y={H-5} fontSize="8.5" fill="#334155" textAnchor="middle">{mLabels[m]}</text>
        ))}
        <text x={pl+2} y={pt+10} fontSize="8.5" fill="#334155">${maxP.toFixed(0)}</text>
        <text x={pl+2} y={H-pb-3} fontSize="8.5" fill="#334155">${minP.toFixed(0)}</text>
      </svg>
    </div>
  );
}

function QuarterlyTable({stmts}) {
  if (!stmts||!stmts.length) return null;
  const rows = stmts.slice(0,6).slice().reverse();
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
            {rows.map((q,i)=>{
              const prev = stmts[stmts.length - 1 - i + 4]; // year-ago Q
              const yoy  = prev?.revenue>0 ? (q.revenue-prev.revenue)/prev.revenue : null;
              const gm   = q.revenue>0 ? q.grossProfit/q.revenue : null;
              return (
                <tr key={q.date} style={{borderBottom:'1px solid #141720'}}>
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

function NewsCard({items}) {
  if (!items||!items.length) return null;
  return (
    <div>
      <SectionTitle>Latest News</SectionTitle>
      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {items.slice(0,6).map((n,i)=>(
          <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" style={{textDecoration:'none'}}>
            <div style={{
              background:'#141720',border:'1px solid #1e2430',borderRadius:6,
              padding:'10px 13px',transition:'border-color 0.15s'
            }}>
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

function VerdictSection({scores, profile, metrics, ratios}) {
  const r   = getRating(scores.total);
  const moat=[], risks=[];

  const gm   = ratios?.grossProfitMarginTTM;
  const roic = metrics?.roicTTM;
  const nd   = metrics?.netDebtToEBITDATTM;
  const ic   = metrics?.interestCoverageTTM;
  const pfcf = metrics?.pfcfRatioTTM;
  const pe   = metrics?.peRatioTTM;

  if (ok(gm)   && gm>=0.50)   moat.push('Gross margin >50% — strong pricing power');
  if (ok(roic) && roic>=0.20) moat.push('ROIC >20% — deep competitive moat');
  if (ok(nd)   && nd<0)       moat.push('Net cash balance sheet — fortress');
  if (ok(ic)   && ic>=15)     moat.push('Interest coverage >15x — zero financing risk');
  if (ok(pfcf) && pfcf<22)    moat.push('Attractive P/FCF — solid FCF yield');

  if (ok(pe)   && pe>50)      risks.push('Premium P/E >50x — requires flawless execution');
  if (ok(nd)   && nd>3)       risks.push('High leverage Net Debt/EBITDA >3x');
  if (ok(gm)   && gm<0.15)    risks.push('Thin gross margins — pricing vulnerability');
  if (ok(roic) && roic<0.05)  risks.push('Low ROIC — weak capital allocation');
  if (scores.total<50)        risks.push('Composite score below Hold threshold');

  const co = profile?.companyName||'This company';

  return (
    <div>
      <SectionTitle>Investment Verdict</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
        <div style={{background:'#0d2e1a',border:'1px solid #166534',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#22c55e',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>🏰 Quality Signals</div>
          {moat.length ? moat.map((m,i)=>(
            <div key={i} style={{fontSize:11,color:'#86efac',marginBottom:5,lineHeight:1.4}}>· {m}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No strong moat signals at current levels</div>}
        </div>
        <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#f87171',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>⚠ Risk Flags</div>
          {risks.length ? risks.map((r,i)=>(
            <div key={i} style={{fontSize:11,color:'#fca5a5',marginBottom:5,lineHeight:1.4}}>· {r}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No major risk flags detected</div>}
        </div>
      </div>
      <div style={{
        background:r.bg,border:`1px solid ${r.border}`,
        borderRadius:8,padding:'16px 20px',
        display:'flex',alignItems:'center',justifyContent:'space-between',gap:16
      }}>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:5}}>Bottom Line</div>
          <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.6}}>
            {co} scores <strong style={{color:r.color}}>{scores.total}/100</strong> on the StockLens composite model (Valuation {scores.val}/35 · Health {scores.hlth}/35 · Momentum {scores.mom}/30).{' '}
            {r.label==='STRONG BUY'&&'Exceptional quality, reasonable valuation, and strong momentum. High-conviction opportunity.'}
            {r.label==='BUY'&&'Solid fundamentals with favourable risk/reward at current levels.'}
            {r.label==='HOLD'&&'Decent business but valuation or momentum limits near-term upside. Wait for pullback.'}
            {r.label==='CAUTION'&&'Weak signals on valuation or fundamentals — risk/reward unattractive at current price.'}
            {r.label==='AVOID'&&'Multiple red flags across valuation, financial health, or momentum. High risk.'}
          </div>
        </div>
        <div style={{
          padding:'10px 22px',borderRadius:6,
          background:r.bg,border:`2px solid ${r.color}`,flexShrink:0,
          fontSize:13,fontWeight:800,color:r.color,letterSpacing:'2px',whiteSpace:'nowrap'
        }}>{r.label}</div>
      </div>
    </div>
  );
}

// ─── LAYOUT HELPERS ──────────────────────────────────────────
function Panel({children, style={}}) {
  return (
    <div style={{
      background:'#0d0f14',border:'1px solid #1e2430',
      borderRadius:10,padding:'20px 24px',
      ...style
    }}>{children}</div>
  );
}

function SectionTitle({children}) {
  return (
    <div style={{
      fontSize:10,fontWeight:700,textTransform:'uppercase',
      letterSpacing:'1px',color:'#334155',marginBottom:14,
      paddingBottom:8,borderBottom:'1px solid #141720'
    }}>{children}</div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
function App() {
  const [fmpKey,      setFmpKey]      = useState(()=>localStorage.getItem('sl_fmp')||DEFAULT_FMP_KEY);
  const [inputTicker, setInputTicker] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [showCfg,     setShowCfg]     = useState(false);
  const [ticker,      setTicker]      = useState(null);

  // Data state
  const [quote,  setQuote]  = useState(null);
  const [prof,   setProf]   = useState(null);
  const [met,    setMet]    = useState(null);
  const [rat,    setRat]    = useState(null);
  const [hist,   setHist]   = useState([]);
  const [stmts,  setStmts]  = useState([]);
  const [news,   setNews]   = useState([]);

  const scores = useMemo(()=>calcScores(met,rat,hist),[met,rat,hist]);

  const fmpGet = useCallback(async (path) => {
    const sep = path.includes('?')?'&':'?';
    const url = `https://financialmodelingprep.com/api/v3${path}${sep}apikey=${fmpKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
    const data = await res.json();
    if (data?.['Error Message']) throw new Error(data['Error Message']);
    if (Array.isArray(data) && data.length===0) throw new Error(`No data found for ticker`);
    return data;
  }, [fmpKey]);

  const analyze = useCallback(async (sym) => {
    if (!sym) return;
    setLoading(true); setError(null);
    setQuote(null); setProf(null); setMet(null); setRat(null);
    setHist([]); setStmts([]); setNews([]);
    try {
      const results = await Promise.allSettled([
        fmpGet(`/quote/${sym}`),
        fmpGet(`/profile/${sym}`),
        fmpGet(`/key-metrics-ttm/${sym}`),
        fmpGet(`/ratios-ttm/${sym}`),
        fmpGet(`/historical-price-full/${sym}?timeseries=365`),
        fmpGet(`/income-statement/${sym}?period=quarter&limit=8`),
        fmpGet(`/stock_news?tickers=${sym}&limit=8`),
      ]);

      const get = (r) => r.status==='fulfilled' ? r.value : null;
      const [qD,pD,mD,rD,hD,sD,nD] = results.map(get);

      if (!qD) throw new Error(`Ticker "${sym}" not found — check the symbol and try again`);

      setQuote(Array.isArray(qD) ? qD[0] : qD);
      setProf (Array.isArray(pD) ? pD[0] : pD);
      setMet  (Array.isArray(mD) ? mD[0] : mD);
      setRat  (Array.isArray(rD) ? rD[0] : rD);
      setHist (hD?.historical || []);
      setStmts(Array.isArray(sD) ? sD : []);
      setNews (Array.isArray(nD) ? nD : []);
      setTicker(sym.toUpperCase());
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fmpGet]);

  const handleSearch = () => {
    const sym = inputTicker.trim().toUpperCase();
    if (sym) analyze(sym);
  };

  // Derived stats
  const sorted    = useMemo(()=>[...hist].sort((a,b)=>new Date(a.date)-new Date(b.date)),[hist]);
  const priceNow  = quote?.price || sorted[sorted.length-1]?.close;
  const price12m  = sorted[0]?.close;
  const ret12m    = (ok(priceNow)&&ok(price12m)&&price12m>0) ? (priceNow-price12m)/price12m : null;
  const chg1d     = quote?.changesPercentage;
  const isUpDay   = (chg1d||0) >= 0;

  // Revenue growth YoY (Q0 vs Q4)
  const revGrowthYoY = useMemo(()=>{
    if (stmts.length>=5 && stmts[0]?.revenue>0 && stmts[4]?.revenue>0)
      return (stmts[0].revenue - stmts[4].revenue) / stmts[4].revenue;
    return null;
  },[stmts]);

  // Health cards config
  const healthCards = useMemo(()=>{
    if (!met||!rat) return [];
    const pe    = met.peRatioTTM;
    const ev    = met.enterpriseValueOverEBITDATTM;
    const pfcf  = met.pfcfRatioTTM;
    const gm    = rat.grossProfitMarginTTM;
    const roic  = met.roicTTM;
    const nd    = met.netDebtToEBITDATTM;
    return [
      { label:'P/E Ratio',       value:fmt.mult(pe),    note:'price / earnings (TTM)',
        status: ok(pe)&&pe>0 ? (pe<25?'green':pe<45?'amber':'red') : 'neutral' },
      { label:'EV / EBITDA',     value:fmt.mult(ev),    note:'enterprise value multiple',
        status: ok(ev)&&ev>0 ? (ev<14?'green':ev<22?'amber':'red') : 'neutral' },
      { label:'P / FCF',         value:fmt.mult(pfcf),  note:'price / free cash flow',
        status: ok(pfcf)&&pfcf>0 ? (pfcf<20?'green':pfcf<35?'amber':'red') : 'neutral' },
      { label:'Gross Margin',    value:fmt.pct(gm),     note:'revenue − COGS (TTM)',
        status: ok(gm) ? (gm>=0.40?'green':gm>=0.20?'amber':'red') : 'neutral' },
      { label:'ROIC',            value:fmt.pct(roic),   note:'return on invested capital',
        status: ok(roic) ? (roic>=0.15?'green':roic>=0.06?'amber':'red') : 'neutral' },
      { label:'Net Debt/EBITDA', value:fmt.ndx(nd),     note:ok(nd)&&nd<0?'fortress balance sheet':'leverage ratio',
        status: ok(nd) ? (nd<0.5?'green':nd<2.5?'amber':'red') : 'neutral' },
    ];
  },[met,rat]);

  const hasData = !!(quote||prof);

  return (
    <div style={{
      minHeight:'100vh',background:'#08090d',color:'#e2e8f0',
      fontFamily:"'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif",
      paddingBottom:60
    }}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-track{background:#08090d}
        ::-webkit-scrollbar-thumb{background:#1e2430;border-radius:3px}
        input::placeholder{color:#334155}
        a{color:inherit;text-decoration:none}
      `}</style>

      {/* ── Top bar ── */}
      <div style={{
        background:'#0a0b10',borderBottom:'1px solid #161b26',
        padding:'0 24px',display:'flex',alignItems:'center',
        justifyContent:'space-between',height:52,
        position:'sticky',top:0,zIndex:200
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:18,fontWeight:800,color:'#fff',letterSpacing:'-0.5px'}}>⚡ StockLens</span>
          <span style={{fontSize:10,color:'#334155',background:'#141720',border:'1px solid #1e2430',padding:'2px 7px',borderRadius:4}}>v1.0</span>
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
            fontSize:13,fontWeight:600,transition:'background 0.2s',whiteSpace:'nowrap'
          }}>{loading?'…':'Analyze'}</button>
          <button onClick={()=>setShowCfg(p=>!p)} title="Settings" style={{
            background:'#141720',color:showCfg?'#60a5fa':'#475569',
            border:'1px solid #1e2430',padding:'7px 11px',borderRadius:6,
            cursor:'pointer',fontSize:13,lineHeight:1
          }}>⚙</button>
        </div>
      </div>

      {/* ── Config panel ── */}
      {showCfg && (
        <div style={{
          background:'#0a0b10',borderBottom:'1px solid #161b26',
          padding:'14px 24px',display:'flex',gap:14,alignItems:'flex-end'
        }}>
          <div>
            <div style={{fontSize:10,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.5px'}}>FMP API Key</div>
            <input value={fmpKey} onChange={e=>setFmpKey(e.target.value)}
              style={{background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',
                padding:'6px 11px',borderRadius:6,fontSize:12,width:280,outline:'none'}}/>
          </div>
          <button onClick={()=>{localStorage.setItem('sl_fmp',fmpKey);setShowCfg(false);}} style={{
            background:'#22c55e',color:'#000',border:'none',
            padding:'6px 16px',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:700
          }}>Save</button>
        </div>
      )}

      {/* ── Content ── */}
      <div style={{maxWidth:1120,margin:'0 auto',padding:'0 24px'}}>

        {/* Empty state */}
        {!loading&&!hasData&&!error&&(
          <div style={{textAlign:'center',padding:'90px 20px'}}>
            <div style={{fontSize:52,marginBottom:14}}>⚡</div>
            <div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens</div>
            <div style={{fontSize:13,color:'#334155',maxWidth:400,margin:'0 auto 32px',lineHeight:1.7}}>
              Enter any ticker to get an InvestingPro-style deep analysis — risk score, fundamentals, price chart, and investment verdict.
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

        {/* Loading */}
        {loading && <Spinner/>}

        {/* Error */}
        {!loading&&error&&(
          <div style={{
            background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:8,
            padding:'14px 18px',margin:'24px 0',color:'#f87171',fontSize:13
          }}>⚠ {error}</div>
        )}

        {/* ── Main analysis ── */}
        {!loading&&hasData&&(
          <div style={{paddingTop:20,display:'flex',flexDirection:'column',gap:14}}>

            {/* Company header */}
            <Panel>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                <div>
                  <div style={{fontSize:11,color:'#334155',marginBottom:5}}>
                    {[prof?.exchange, prof?.sector, prof?.industry].filter(Boolean).join(' · ')}
                  </div>
                  <div style={{display:'flex',alignItems:'baseline',gap:12,flexWrap:'wrap'}}>
                    <div style={{fontSize:30,fontWeight:800,color:'#fff',fontFamily:'JetBrains Mono,monospace'}}>{ticker}</div>
                    <div style={{fontSize:17,color:'#94a3b8',fontWeight:500}}>{prof?.companyName}</div>
                  </div>
                  <div style={{display:'flex',gap:16,marginTop:8,fontSize:11,color:'#475569',flexWrap:'wrap'}}>
                    {prof?.country && <span>🌍 {prof.country}</span>}
                    {prof?.employees && <span>👥 {Number(prof.employees).toLocaleString()} employees</span>}
                    {prof?.ipoDate  && <span>📅 IPO {prof.ipoDate?.substring(0,4)}</span>}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:34,fontWeight:800,color:'#fff',fontFamily:'JetBrains Mono,monospace',lineHeight:1}}>
                    {fmt.price(priceNow)}
                  </div>
                  <div style={{fontSize:14,fontWeight:600,color:isUpDay?'#22c55e':'#f87171',marginTop:3}}>
                    {isUpDay?'▲':'▼'} {Math.abs(chg1d||0).toFixed(2)}% today
                  </div>
                  {ok(ret12m)&&<div style={{fontSize:11,color:ret12m>=0?'#4ade80':'#f87171'}}>
                    {ret12m>=0?'▲':'▼'} {Math.abs((ret12m*100)).toFixed(1)}% past 12 months
                  </div>}
                  <div style={{fontSize:11,color:'#334155',marginTop:4}}>
                    Mkt Cap {fmt.usd(quote?.marketCap)} · Vol {fmt.usd(quote?.avgVolume)}
                  </div>
                </div>
              </div>
            </Panel>

            {/* Score + KPI grid */}
            <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14}}>
              {/* Score gauge */}
              <Panel style={{display:'flex',flexDirection:'column',alignItems:'center',gap:18}}>
                <ScoreGauge score={scores.total}/>
                <div style={{width:'100%'}}>
                  <ScoreBar label="Valuation"       value={scores.val}  max={35} color="#60a5fa"/>
                  <ScoreBar label="Financial Health" value={scores.hlth} max={35} color="#22c55e"/>
                  <ScoreBar label="Momentum"         value={scores.mom}  max={30} color="#fbbf24"/>
                </div>
              </Panel>

              {/* KPIs */}
              <Panel>
                <SectionTitle>Key Metrics — TTM</SectionTitle>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:9}}>
                  <KPIBadge label="P/E Ratio"       value={fmt.mult(met?.peRatioTTM)}                      sub="trailing 12 months"/>
                  <KPIBadge label="EV/EBITDA"        value={fmt.mult(met?.enterpriseValueOverEBITDATTM)}     sub="enterprise value mult."/>
                  <KPIBadge label="P/FCF"            value={fmt.mult(met?.pfcfRatioTTM)}                    sub="price / free cash flow"/>
                  <KPIBadge label="Gross Margin"     value={fmt.pct(rat?.grossProfitMarginTTM)}             sub="TTM" highlight={ok(rat?.grossProfitMarginTTM)?(rat.grossProfitMarginTTM>=0.4?'#22c55e':rat.grossProfitMarginTTM>=0.2?'#fbbf24':'#f87171'):undefined}/>
                  <KPIBadge label="ROIC"             value={fmt.pct(met?.roicTTM)}                         sub="return on inv. capital" highlight={ok(met?.roicTTM)?(met.roicTTM>=0.15?'#22c55e':met.roicTTM>=0.06?'#fbbf24':'#f87171'):undefined}/>
                  <KPIBadge label="Net Debt/EBITDA"  value={fmt.ndx(met?.netDebtToEBITDATTM)}              sub={ok(met?.netDebtToEBITDATTM)&&met.netDebtToEBITDATTM<0?'net cash position':'leverage'} highlight={ok(met?.netDebtToEBITDATTM)?(met.netDebtToEBITDATTM<0?'#22c55e':met.netDebtToEBITDATTM<2?'#fbbf24':'#f87171'):undefined}/>
                  <KPIBadge label="Revenue Growth"   value={fmt.chg(revGrowthYoY)}                         sub="year-over-year (Q)" highlight={ok(revGrowthYoY)?(revGrowthYoY>=0.1?'#22c55e':revGrowthYoY>=0?'#fbbf24':'#f87171'):undefined}/>
                  <KPIBadge label="FCF Yield"        value={fmt.pct(met?.freeCashFlowYieldTTM)}            sub="TTM"/>
                  <KPIBadge label="ROE"              value={fmt.pct(met?.roeTTM)}                          sub="return on equity"/>
                </div>
              </Panel>
            </div>

            {/* Price chart */}
            <Panel>
              <PriceChart history={hist} ticker={ticker}/>
            </Panel>

            {/* Health checks */}
            <Panel>
              <SectionTitle>Health Checks — Valuation · Profitability · Leverage</SectionTitle>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                {healthCards.map((c,i)=><HealthCard key={i} {...c}/>)}
              </div>
            </Panel>

            {/* Company description */}
            {prof?.description&&(
              <Panel>
                <SectionTitle>About {prof.companyName}</SectionTitle>
                <div style={{
                  fontSize:12,color:'#94a3b8',lineHeight:1.75,
                  display:'-webkit-box',WebkitLineClamp:3,
                  WebkitBoxOrient:'vertical',overflow:'hidden'
                }}>{prof.description}</div>
              </Panel>
            )}

            {/* Quarterly table */}
            {stmts.length>0&&(
              <Panel><QuarterlyTable stmts={stmts}/></Panel>
            )}

            {/* News */}
            {news.length>0&&(
              <Panel><NewsCard items={news}/></Panel>
            )}

            {/* Verdict */}
            <Panel>
              <VerdictSection scores={scores} profile={prof} metrics={met} ratios={rat}/>
            </Panel>

          </div>
        )}
      </div>

      <div style={{textAlign:'center',marginTop:48,fontSize:10,color:'#141720'}}>
        StockLens · Data: Financial Modeling Prep · Not financial advice · {new Date().getFullYear()}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
