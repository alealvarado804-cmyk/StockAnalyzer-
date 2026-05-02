// ============================================================
// StockLens v2.0 — Stock Analysis App
// Stack: React 18 UMD · Financial Modeling Prep API
// No imports — global React from CDN, pre-compiled by Babel
// ============================================================

const { useState, useCallback, useMemo, useRef, useEffect } = React;
const DEFAULT_FMP_KEY = 'wXLMidktyQfzS8ADy4HvUyR6yaWKtqS2';
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

// ─── SCORING ────────────────────────────────────────────────
function calcScores(metrics, ratios, history, stmts) {
  let val=0, hlth=0, mom=0, growth=0;
  if (metrics && ratios) {
    const pe=metrics.peRatioTTM, ev=metrics.enterpriseValueOverEBITDATTM;
    const pfcf=metrics.pfcfRatioTTM, fvr=ratios.priceFairValueTTM;
    const gm=ratios.grossProfitMarginTTM, roic=metrics.roicTTM;
    const nd=metrics.netDebtToEBITDATTM, roe=metrics.roeTTM, ic=metrics.interestCoverageTTM;
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
const PERIODS = {'1M':21,'3M':63,'6M':126,'1Y':365};

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

  // 50-day SMA
  const sma50pts = useMemo(()=>{
    if (prices.length < 50) return null;
    const points=[];
    for (let i=49;i<prices.length;i++) {
      const avg=prices.slice(i-49,i+1).reduce((a,b)=>a+b,0)/50;
      points.push(`${px(i)},${py(avg)}`);
    }
    return points.join(' ');
  },[prices,px,py]);

  // 52W markers
  const hi52=Math.max(...prices), lo52=Math.min(...prices);

  // Month ticks
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
        {/* 52W high/low dashed */}
        <line x1={pl} x2={W-pr} y1={py(hi52)} y2={py(hi52)} stroke="#334155" strokeWidth="0.8" strokeDasharray="4 4"/>
        <line x1={pl} x2={W-pr} y1={py(lo52)} y2={py(lo52)} stroke="#334155" strokeWidth="0.8" strokeDasharray="4 4"/>
        {/* Fill */}
        <polygon points={fillPts} fill="url(#sg2)"/>
        {/* Price line */}
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round"/>
        {/* 50 SMA */}
        {sma50pts && <polyline points={sma50pts} fill="none" stroke="#60a5fa" strokeWidth="1" strokeOpacity="0.7" strokeDasharray="3 2"/>}
        {/* Volume bars */}
        {volumes.map((v,i)=>(
          <rect key={i}
            x={pl+i*(cw/filtered.length)}
            y={vy(v)}
            width={Math.max(1,cw/filtered.length-0.5)}
            height={volBottom-vy(v)}
            fill="#1e2430" opacity="0.8"
          />
        ))}
        {/* X-axis labels */}
        {ticks.filter((_,i)=>i%2===0).map(({i,m})=>(
          <text key={m} x={px(i)} y={H-8} fontSize="8" fill="#334155" textAnchor="middle">{mLbls[m]}</text>
        ))}
        <text x={pl+2} y={pt+10} fontSize="8" fill="#334155">${maxP.toFixed(0)}</text>
        <text x={pl+2} y={priceBottom-4} fontSize="8" fill="#334155">${minP.toFixed(0)}</text>
        <text x={W-pr-2} y={py(hi52)-3} fontSize="7.5" fill="#475569" textAnchor="end">52W H</text>
        <text x={W-pr-2} y={py(lo52)+8} fontSize="7.5" fill="#475569" textAnchor="end">52W L</text>
        {/* Crosshair */}
        {hx!=null&&(
          <g>
            <line x1={hx} x2={hx} y1={pt} y2={priceBottom} stroke="#475569" strokeWidth="0.8" strokeDasharray="3 2"/>
            <circle cx={hx} cy={py(prices[hoverIdx])} r="3.5" fill={stroke} stroke="#0c0e14" strokeWidth="1.5"/>
          </g>
        )}
        {/* SMA legend */}
        {sma50pts&&(
          <g>
            <line x1={W-80} x2={W-68} y1={pt+10} y2={pt+10} stroke="#60a5fa" strokeWidth="1.2" strokeDasharray="3 2"/>
            <text x={W-65} y={pt+13} fontSize="7.5" fill="#60a5fa">50 SMA</text>
          </g>
        )}
      </svg>
      {/* Hover tooltip */}
      {hd&&hx!=null&&(
        <div style={{
          position:'absolute',
          top:8,
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
function TechnicalSignals({history}) {
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
    return {cur,rsi,sma50,sma200,hi52,lo52,rangePct};
  },[history]);

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
    </div>
  );
}

// ─── ANALYST PANEL ──────────────────────────────────────────
function AnalystPanel({ptC, udC, analystEst, currentPrice}) {
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

  // 3Y CAGR approx
  const cagr=(first,last,yrs)=>(ok(first)&&ok(last)&&first>0&&last>0)?Math.pow(last/first,1/yrs)-1:null;
  const years=stmts.length/4;
  const revCagr=cagr(rows[0]?.revenue,rows[rows.length-1]?.revenue,years);

  const Row=({label,data,type,color,cagrVal})=>(
    <div style={{display:'flex',alignItems:'center',gap:12,padding:'9px 0',borderBottom:'1px solid #161b26'}}>
      <div style={{width:130,fontSize:11,color:'#94a3b8',flexShrink:0}}>{label}</div>
      <Sparkline data={data} type={type} color={color} h={44} w={140}/>
      <div style={{marginLeft:'auto',textAlign:'right'}}>
        {ok(cagrVal)&&(
          <div style={{fontSize:10,color:cagrVal>0?'#22c55e':'#f87171',fontFamily:'JetBrains Mono,monospace',fontWeight:700}}>
            CAGR {fmt.chg(cagrVal)}
          </div>
        )}
        <div style={{fontSize:10,color:'#475569',marginTop:2}}>{stmts.length} qtrs</div>
      </div>
    </div>
  );

  return (
    <div>
      <SectionTitle>Growth Profile — {stmts.length} Quarters</SectionTitle>
      <Row label="Revenue" data={revs} type="bar" color="#3b82f6" cagrVal={revCagr}/>
      <Row label="Net Income" data={netI} type="bar" color="#22c55e" cagrVal={null}/>
      <Row label="Gross Margin %" data={gms} type="line" color="#a78bfa" cagrVal={null}/>
      <Row label="EPS" data={eps} type="line" color="#fbbf24" cagrVal={null}/>
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

// ─── VERDICT SECTION ────────────────────────────────────────
function VerdictSection({scores, profile, metrics, ratios}) {
  const r=getRating(scores.total);
  const moat=[], risks=[];
  const gm=ratios?.grossProfitMarginTTM, roic=metrics?.roicTTM;
  const nd=metrics?.netDebtToEBITDATTM, ic=metrics?.interestCoverageTTM;
  const pfcf=metrics?.pfcfRatioTTM, pe=metrics?.peRatioTTM;

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
        {/* Bull case */}
        <div style={{background:'#0d2e1a',border:'1px solid #166534',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#22c55e',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>🏰 Bull Case</div>
          {moat.length ? moat.map((m,i)=>(
            <div key={i} style={{fontSize:11,color:'#86efac',marginBottom:5,lineHeight:1.5}}>· {m}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No strong moat signals at current levels</div>}
        </div>
        {/* Center score */}
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,padding:'0 8px'}}>
          <ScoreGauge score={scores.total}/>
          <div style={{width:140}}>
            <ScoreBar label="Valuation"       value={scores.val}    max={25} color="#60a5fa"/>
            <ScoreBar label="Financial Health" value={scores.hlth}   max={30} color="#22c55e"/>
            <ScoreBar label="Momentum"         value={scores.mom}    max={25} color="#fbbf24"/>
            <ScoreBar label="Growth"           value={scores.growth} max={20} color="#a78bfa"/>
          </div>
        </div>
        {/* Bear case */}
        <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:6,padding:'13px 15px'}}>
          <div style={{fontSize:10,fontWeight:700,color:'#f87171',marginBottom:8,textTransform:'uppercase',letterSpacing:'1px'}}>⚠ Bear Case</div>
          {risks.length ? risks.map((rk,i)=>(
            <div key={i} style={{fontSize:11,color:'#fca5a5',marginBottom:5,lineHeight:1.5}}>· {rk}</div>
          )) : <div style={{fontSize:11,color:'#334155'}}>No major risk flags detected</div>}
        </div>
      </div>
      <div style={{background:r.bg,border:`1px solid ${r.border}`,borderRadius:8,padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:16}}>
        <div style={{flex:1}}>
          <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:'1px',marginBottom:5}}>Bottom Line</div>
          <div style={{fontSize:13,color:'#cbd5e1',lineHeight:1.65}}>{verdictText}</div>
        </div>
        <div style={{padding:'10px 22px',borderRadius:6,background:r.bg,border:`2px solid ${r.color}`,flexShrink:0,fontSize:13,fontWeight:800,color:r.color,letterSpacing:'2px',whiteSpace:'nowrap'}}>{r.label}</div>
      </div>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────
function App() {
  const [fmpKey,       setFmpKey]       = useState(()=>localStorage.getItem('sl_fmp')||DEFAULT_FMP_KEY);
  const [inputTicker,  setInputTicker]  = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [showCfg,      setShowCfg]      = useState(false);
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
  const [dcf,    setDcf]    = useState(null);

  const scores = useMemo(()=>calcScores(met,rat,hist,stmts),[met,rat,hist,stmts]);

  useEffect(()=>{
    const fn=()=>setScrolled(window.scrollY>180);
    window.addEventListener('scroll',fn,{passive:true});
    return ()=>window.removeEventListener('scroll',fn);
  },[]);

  // Bug fix: returns null on empty array instead of throwing
  const fmpGet = useCallback(async (path) => {
    const sep=path.includes('?')?'&':'?';
    const url=`https://financialmodelingprep.com/api/v3${path}${sep}apikey=${fmpKey}`;
    const res=await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data=await res.json();
    if (data?.['Error Message']) throw new Error(data['Error Message']);
    if (Array.isArray(data)&&data.length===0) return null;
    return data;
  },[fmpKey]);

  const analyze = useCallback(async (sym)=>{
    if (!sym) return;
    setLoading(true); setError(null); setActiveTab('Overview');
    setQuote(null); setProf(null); setMet(null); setRat(null);
    setHist([]); setStmts([]); setNews([]);
    setPtC(null); setAnalystEst(null); setUdC(null); setDcf(null);
    try {
      const results = await Promise.allSettled([
        fmpGet(`/quote/${sym}`),                              // 0
        fmpGet(`/profile/${sym}`),                            // 1
        fmpGet(`/key-metrics-ttm/${sym}`),                    // 2
        fmpGet(`/ratios-ttm/${sym}`),                         // 3
        fmpGet(`/historical-price-full/${sym}?timeseries=365`), // 4
        fmpGet(`/income-statement/${sym}?period=quarter&limit=8`), // 5
        fmpGet(`/stock_news?tickers=${sym}&limit=8`),         // 6
        fmpGet(`/price-target-consensus/${sym}`),             // 7
        fmpGet(`/analyst-estimates/${sym}?limit=2`),          // 8
        fmpGet(`/upgrades-downgrades-consensus/${sym}`),      // 9
        fmpGet(`/discounted-cash-flow/${sym}`),               // 10
      ]);

      const get=r=>r.status==='fulfilled'?r.value:null;
      const [qD,pD,mD,rD,hD,sD,nD,ptD,aeD,udD,dcfD]=results.map(get);

      // Only fail if BOTH quote and profile are missing
      if (!qD && !pD) throw new Error(`Ticker "${sym}" not found — check the symbol and try again`);

      setQuote(Array.isArray(qD)?qD[0]:qD);
      setProf (Array.isArray(pD)?pD[0]:pD);
      setMet  (Array.isArray(mD)?mD[0]:mD);
      setRat  (Array.isArray(rD)?rD[0]:rD);
      setHist (hD?.historical||[]);
      setStmts(Array.isArray(sD)?sD:[]);
      setNews (Array.isArray(nD)?nD:[]);
      setPtC  (ptD);
      setAnalystEst(aeD);
      setUdC  (udD);
      setDcf  (Array.isArray(dcfD)?dcfD[0]:dcfD);
      setTicker(sym.toUpperCase());

      // Save to history
      const hist5=[sym,...JSON.parse(localStorage.getItem('sl_history')||'[]')]
        .filter((t,i,a)=>a.indexOf(t)===i).slice(0,5);
      localStorage.setItem('sl_history',JSON.stringify(hist5));
      setRecentTickers(hist5);

    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  },[fmpGet]);

  const handleSearch=()=>{const s=inputTicker.trim().toUpperCase();if(s) analyze(s);};

  // Derived
  const sorted    = useMemo(()=>[...hist].sort((a,b)=>new Date(a.date)-new Date(b.date)),[hist]);
  const priceNow  = quote?.price||sorted[sorted.length-1]?.close;
  const price12m  = sorted[0]?.close;
  const ret12m    = (ok(priceNow)&&ok(price12m)&&price12m>0)?(priceNow-price12m)/price12m:null;
  const chg1d     = quote?.changesPercentage;
  const isUpDay   = (chg1d||0)>=0;

  const hasData = !!(quote||prof);
  const r = scores ? getRating(scores.total) : null;

  // Sector benchmarks for KPI badges
  const bm = useMemo(()=>SECTOR_BM[prof?.sector]||null,[prof?.sector]);

  // DCF display
  const dcfVal    = dcf?.dcf;
  const mosFrac   = (ok(dcfVal)&&ok(priceNow)&&dcfVal>0)?(dcfVal-priceNow)/dcfVal:null;
  const mosColor  = !ok(mosFrac)?'#475569':mosFrac>0.15?'#22c55e':mosFrac>-0.15?'#fbbf24':'#f87171';

  // Health cards
  const healthCards = useMemo(()=>{
    if (!met||!rat) return [];
    const pe=met.peRatioTTM, ev=met.enterpriseValueOverEBITDATTM;
    const pfcf=met.pfcfRatioTTM, gm=rat.grossProfitMarginTTM;
    const roic=met.roicTTM, nd=met.netDebtToEBITDATTM;
    return [
      {label:'P/E Ratio',      value:fmt.mult(pe),   note:'trailing 12 months',  status:ok(pe)&&pe>0?(pe<25?'green':pe<45?'amber':'red'):'neutral'},
      {label:'EV / EBITDA',    value:fmt.mult(ev),   note:'enterprise multiple',  status:ok(ev)&&ev>0?(ev<14?'green':ev<22?'amber':'red'):'neutral'},
      {label:'P / FCF',        value:fmt.mult(pfcf), note:'price / free cash flow',status:ok(pfcf)&&pfcf>0?(pfcf<20?'green':pfcf<35?'amber':'red'):'neutral'},
      {label:'Gross Margin',   value:fmt.pct(gm),    note:'revenue − COGS (TTM)', status:ok(gm)?(gm>=0.40?'green':gm>=0.20?'amber':'red'):'neutral'},
      {label:'ROIC',           value:fmt.pct(roic),  note:'return on invested capital',status:ok(roic)?(roic>=0.15?'green':roic>=0.06?'amber':'red'):'neutral'},
      {label:'Net Debt/EBITDA',value:fmt.ndx(nd),    note:ok(nd)&&nd<0?'net cash position':'leverage ratio',status:ok(nd)?(nd<0.5?'green':nd<2.5?'amber':'red'):'neutral'},
    ];
  },[met,rat]);

  const tabs=['Overview','Fundamentals','Chart','Research'];

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

      {/* ── Sticky compact sub-header (appears on scroll) ── */}
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
            <span style={{fontSize:10,color:'#334155',background:'#141720',border:'1px solid #1e2430',padding:'2px 7px',borderRadius:4}}>v2.0</span>
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
            <button onClick={()=>setShowCfg(p=>!p)} title="Settings" style={{
              background:'#141720',color:showCfg?'#60a5fa':'#475569',
              border:'1px solid #1e2430',padding:'7px 11px',borderRadius:6,
              cursor:'pointer',fontSize:13
            }}>⚙</button>
          </div>
        </div>
        {/* Recent tickers */}
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

      {/* ── Config panel ── */}
      {showCfg&&(
        <div style={{background:'#0a0b10',borderBottom:'1px solid #161b26',padding:'14px 24px',display:'flex',gap:14,alignItems:'flex-end'}}>
          <div>
            <div style={{fontSize:10,color:'#475569',marginBottom:4,textTransform:'uppercase',letterSpacing:'0.5px'}}>FMP API Key</div>
            <input value={fmpKey} onChange={e=>setFmpKey(e.target.value)}
              style={{background:'#141720',border:'1px solid #1e2430',color:'#e2e8f0',padding:'6px 11px',borderRadius:6,fontSize:12,width:280,outline:'none'}}/>
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
            <div style={{fontSize:26,fontWeight:800,color:'#fff',marginBottom:8}}>StockLens v2.0</div>
            <div style={{fontSize:13,color:'#334155',maxWidth:400,margin:'0 auto 32px',lineHeight:1.7}}>
              Enter any US ticker for an InvestingPro-style deep analysis — 4-dimensional scoring, analyst consensus, DCF value, technical signals, and investment verdict.
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
          <div style={{background:'#2a0d0d',border:'1px solid #7f1d1d',borderRadius:8,padding:'14px 18px',margin:'24px 0',color:'#f87171',fontSize:13}}>
            ⚠ {error}
          </div>
        )}

        {/* ── Main analysis ── */}
        {!loading&&hasData&&(
          <div style={{paddingTop:20,display:'flex',flexDirection:'column',gap:0}}>

            {/* Company header */}
            <Panel style={{marginBottom:0,borderBottomLeftRadius:0,borderBottomRightRadius:0,borderBottom:'none'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12}}>
                {/* Left: logo + name */}
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
                {/* Right: price + DCF */}
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
                    Mkt Cap {fmt.usd(quote?.marketCap)} · Avg Vol {fmt.usd(quote?.avgVolume)}
                  </div>
                  {ok(dcfVal)&&(
                    <div style={{marginTop:8,padding:'5px 10px',borderRadius:5,background:mosColor+'18',border:`1px solid ${mosColor}44`,display:'inline-block'}}>
                      <span style={{fontSize:10,color:'#475569'}}>DCF Intrinsic Value: </span>
                      <span style={{fontSize:12,fontWeight:700,color:mosColor,fontFamily:'JetBrains Mono,monospace'}}>{fmt.price(dcfVal)}</span>
                      {ok(mosFrac)&&<span style={{fontSize:10,color:mosColor,marginLeft:5}}>({mosFrac>0?'+':''}{(mosFrac*100).toFixed(1)}% {mosFrac>0?'upside':'overvalued'})</span>}
                    </div>
                  )}
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
                  {/* Score + KPIs */}
                  <div style={{display:'grid',gridTemplateColumns:'220px 1fr',gap:14}}>
                    {/* Score gauge */}
                    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:18,padding:'4px 0'}}>
                      <ScoreGauge score={scores.total}/>
                      <div style={{width:'100%'}}>
                        <ScoreBar label="Valuation"        value={scores.val}    max={25} color="#60a5fa"/>
                        <ScoreBar label="Financial Health"  value={scores.hlth}   max={30} color="#22c55e"/>
                        <ScoreBar label="Momentum"          value={scores.mom}    max={25} color="#fbbf24"/>
                        <ScoreBar label="Growth"            value={scores.growth} max={20} color="#a78bfa"/>
                      </div>
                    </div>
                    {/* KPIs */}
                    <div>
                      <SectionTitle>Key Metrics — TTM</SectionTitle>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:9}}>
                        <KPIBadge label="P/E Ratio"      value={fmt.mult(met?.peRatioTTM)}                   sub="trailing 12 months"    bmVal={bm?.pe}   bmLabel="sector avg"/>
                        <KPIBadge label="EV/EBITDA"       value={fmt.mult(met?.enterpriseValueOverEBITDATTM)} sub="enterprise value mult." bmVal={bm?.ev}   bmLabel="sector avg"/>
                        <KPIBadge label="P/FCF"           value={fmt.mult(met?.pfcfRatioTTM)}                sub="price / free cash flow"/>
                        <KPIBadge label="Gross Margin"    value={fmt.pct(rat?.grossProfitMarginTTM)}         sub="TTM"
                          highlight={ok(rat?.grossProfitMarginTTM)?(rat.grossProfitMarginTTM>=0.4?'#22c55e':rat.grossProfitMarginTTM>=0.2?'#fbbf24':'#f87171'):undefined}
                          bmVal={bm?.gm} bmLabel="sector avg"/>
                        <KPIBadge label="ROIC"            value={fmt.pct(met?.roicTTM)}                     sub="return on inv. capital"
                          highlight={ok(met?.roicTTM)?(met.roicTTM>=0.15?'#22c55e':met.roicTTM>=0.06?'#fbbf24':'#f87171'):undefined}
                          bmVal={bm?.roic} bmLabel="sector avg"/>
                        <KPIBadge label="Net Debt/EBITDA" value={fmt.ndx(met?.netDebtToEBITDATTM)}          sub={ok(met?.netDebtToEBITDATTM)&&met.netDebtToEBITDATTM<0?'net cash position':'leverage'}
                          highlight={ok(met?.netDebtToEBITDATTM)?(met.netDebtToEBITDATTM<0?'#22c55e':met.netDebtToEBITDATTM<2?'#fbbf24':'#f87171'):undefined}/>
                        <KPIBadge label="FCF Yield"       value={fmt.pct(met?.freeCashFlowYieldTTM)}        sub="TTM"/>
                        <KPIBadge label="ROE"             value={fmt.pct(met?.roeTTM)}                      sub="return on equity"/>
                        <KPIBadge label="Interest Coverage" value={fmt.mult(met?.interestCoverageTTM)}      sub="EBIT / interest expense"
                          highlight={ok(met?.interestCoverageTTM)?(met.interestCoverageTTM>=10?'#22c55e':met.interestCoverageTTM>=3?'#fbbf24':'#f87171'):undefined}/>
                      </div>
                    </div>
                  </div>

                  {/* Analyst consensus */}
                  {(ptC||udC)&&(
                    <div style={{background:'#141720',border:'1px solid #1e2430',borderRadius:8,padding:'16px 20px'}}>
                      <AnalystPanel ptC={ptC} udC={udC} analystEst={analystEst} currentPrice={priceNow}/>
                    </div>
                  )}

                  {/* About */}
                  {prof?.description&&(
                    <div>
                      <SectionTitle>About {prof.companyName}</SectionTitle>
                      <div style={{fontSize:12,color:'#94a3b8',lineHeight:1.75,display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>
                        {prof.description}
                      </div>
                    </div>
                  )}
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
                </div>
              )}

              {/* ── CHART TAB ── */}
              {activeTab==='Chart'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  {/* Period selector */}
                  <div>
                    <div style={{display:'flex',gap:6,marginBottom:10,alignItems:'center'}}>
                      <span style={{fontSize:10,color:'#475569',marginRight:4}}>PERIOD:</span>
                      {['1M','3M','6M','1Y'].map(p=>(
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
                  <TechnicalSignals history={hist}/>
                </div>
              )}

              {/* ── RESEARCH TAB ── */}
              {activeTab==='Research'&&(
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <VerdictSection scores={scores} profile={prof} metrics={met} ratios={rat}/>
                  {news.length>0&&<NewsCard items={news}/>}
                </div>
              )}

            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{textAlign:'center',marginTop:48,fontSize:10,color:'#1e2430',lineHeight:1.8}}>
        StockLens v2.0 · Data: Financial Modeling Prep · Not financial advice · {new Date().getFullYear()}
        {ticker&&quote&&<span> · Last updated: {new Date().toLocaleTimeString()}</span>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
