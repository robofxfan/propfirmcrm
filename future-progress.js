/* Live read-only performance. No business-record writes or local record copies. */
(function(root){
  const pad=n=>String(n).padStart(2,'0');
  const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  // Calendar periods match Hisab; historical selections include the full period.
  function period(kind,asOf){
    const anchor=asOf?new Date(asOf+'T12:00:00'):new Date();
    if(Number.isNaN(anchor.getTime()))throw Error('Invalid performance date');
    const year=anchor.getFullYear(),month=anchor.getMonth();
    if(kind==='week'){
      const start=new Date(year,month,anchor.getDate());start.setDate(start.getDate()-6);
      return {from:iso(start),to:iso(anchor)};
    }
    const size={month:1,quarter:3,six:6,year:12}[kind];
    if(!size)throw Error('Invalid performance period');
    const first=Math.floor(month/size)*size;
    return {from:iso(new Date(year,first,1)),to:iso(new Date(year,first+size,0))};
  }
  function monthly(days,range){
    const buckets=new Map();
    for(let d=new Date(range.from.slice(0,7)+'-01T12:00:00');iso(d)<=range.to;d.setMonth(d.getMonth()+1)){
      const month=iso(d).slice(0,7);
      buckets.set(month,{month,revenue:0,expense:0,pending:0,expenseCount:0,revenueCount:0});
    }
    for(const row of days){
      if(row.date<range.from||row.date>range.to)continue;
      const b=buckets.get(row.date.slice(0,7));if(!b)continue;
      for(const k of ['revenue','expense','pending','expenseCount','revenueCount'])b[k]+=Number(row[k]||0);
    }
    return [...buckets.values()].map(b=>({...b,net:b.revenue-b.expense,roi:b.expense>0?(b.revenue-b.expense)/b.expense*100:null}));
  }
  function aggregate(cfd,futures,mode,from,to){
    const map=new Map(), sources=[];
    if(mode!=='futures')sources.push(['CFD',cfd]);
    if(mode!=='cfd')sources.push(['Futures',futures]);
    const breakdown=[];
    for(const [source,rows] of sources){
      const total={source,expense:0,revenue:0,pending:0,expenseCount:0,revenueCount:0};
      for(const row of rows||[]){
        if(row.date<from||row.date>to)continue;
        const day=map.get(row.date)||{date:row.date,expense:0,revenue:0,pending:0,expenseCount:0,revenueCount:0};
        for(const k of ['expense','revenue','pending','expenseCount','revenueCount']){const n=Number(row[k]||0);if(!Number.isFinite(n))throw Error('Invalid amount in '+source);day[k]+=n;total[k]+=n;}
        map.set(row.date,day);
      }
      total.net=total.revenue-total.expense;breakdown.push(total);
    }
    const total=breakdown.reduce((a,b)=>{for(const k of ['expense','revenue','pending','expenseCount','revenueCount'])a[k]+=b[k];return a;},{expense:0,revenue:0,pending:0,expenseCount:0,revenueCount:0});
    total.net=total.revenue-total.expense;total.roi=total.expense>0?total.net/total.expense*100:null;
    return {total,breakdown,days:[...map.values()].sort((a,b)=>a.date.localeCompare(b.date))};
  }
  root.ProgressMath={period,aggregate,monthly};
})(globalThis);

let progressAnchor=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-01';
const progressMonths=['January','February','March','April','May','June','July','August','September','October','November','December'];
let progressMode='futures',progressPeriod='month',progressTimer=null,progressGeneration=0,progressChart=null;
function stopFutureProgress(){clearInterval(progressTimer);progressTimer=null;progressGeneration++;if(progressChart){progressChart.destroy();progressChart=null;}}
function openFutureProgress(mode){progressMode=mode;go('futureprogress');}
function setProgressDate(value){
  if(!/^\d{4}-\d{2}-01$/.test(value)||Number(value.slice(0,4))<1900||Number(value.slice(0,4))>9998)return;
  progressAnchor=value;go('futureprogress');
}
function shiftProgressPeriod(direction){
  const d=new Date(progressAnchor+'T12:00:00');
  d.setMonth(d.getMonth()+direction*({month:1,quarter:3,six:6,year:12}[progressPeriod]||1));
  setProgressDate(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01');
}
function progressPicker(){
  if(progressPeriod==='week')return '';
  const year=Number(progressAnchor.slice(0,4)),month=Number(progressAnchor.slice(5,7))-1;
  const options=progressPeriod==='month'?progressMonths.map((m,i)=>[i,m]):progressPeriod==='quarter'?[[0,'Q1 · Jan–Mar'],[3,'Q2 · Apr–Jun'],[6,'Q3 · Jul–Sep'],[9,'Q4 · Oct–Dec']]:progressPeriod==='six'?[[0,'H1 · Jan–Jun'],[6,'H2 · Jul–Dec']]:[];
  const size={month:1,quarter:3,six:6,year:12}[progressPeriod];
  return `<div class="toolbar" style="flex-wrap:wrap" aria-label="Select performance dates">
    <button class="btn ghost" aria-label="Previous period" onclick="shiftProgressPeriod(-1)">←</button>
    ${options.length?`<label>${progressPeriod==='month'?'Month':progressPeriod==='quarter'?'Quarter':'Half year'} <select aria-label="${progressPeriod==='month'?'Performance month':progressPeriod==='quarter'?'Performance quarter':'Performance half year'}" style="width:auto" onchange="setProgressDate(progressAnchor.slice(0,4)+'-'+this.value+'-01')">${options.map(([i,l])=>`<option value="${String(i+1).padStart(2,'0')}" ${Math.floor(month/size)*size===i?'selected':''}>${l}</option>`).join('')}</select></label>`:''}
    <label>Year <input aria-label="Performance year" type="number" min="1900" max="9998" value="${year}" style="width:100px" onchange="if(this.checkValidity()&&this.value)setProgressDate(this.value.padStart(4,'0')+progressAnchor.slice(4))"></label>
    <button class="btn ghost" aria-label="Next period" onclick="shiftProgressPeriod(1)">→</button>
    <button class="btn ghost" onclick="setProgressDate(new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-01')">Current period</button>
  </div>`;
}
function pageFutureProgress(){
  if(!ME||ME.role!=='admin')return;
  const range=ProgressMath.period(progressPeriod,progressPeriod==='week'?undefined:progressAnchor);
  $('view').innerHTML=`<div class="page-title">Future Progress</div>
    <div class="page-sub">Revenue (+) − expenses (−) · USD</div>
    <div class="toolbar" aria-label="Progress source">${[['cfd','CFD'],['futures','Futures'],['both','Both']].map(([k,l])=>`<button class="btn ${progressMode===k?'':'ghost'}" aria-pressed="${progressMode===k}" onclick="openFutureProgress('${k}')">${l}</button>`).join('')}</div>
    <div class="toolbar" aria-label="Performance period">${[['week','Weekly'],['month','Monthly'],['quarter','Quarterly'],['six','6 Months'],['year','Yearly']].map(([k,l])=>`<button class="btn ${progressPeriod===k?'':'ghost'}" aria-pressed="${progressPeriod===k}" onclick="progressPeriod='${k}';go('futureprogress')">${l}</button>`).join('')}
    <button class="btn ghost" id="progressRefresh" onclick="loadFutureProgress()">↻ Refresh</button></div>
    ${progressPicker()}
    <div class="page-sub">${range.from} → ${range.to} · ${progressPeriod==='week'?'Last 7 days':'Calendar period · '+(progressPeriod==='month'?progressMonths[Number(range.from.slice(5,7))-1]+' '+range.from.slice(0,4):progressPeriod==='quarter'?'Quarterly':progressPeriod==='six'?'Half-yearly':'Yearly')} · Auto refresh every 60 seconds</div>
    <div id="progressStatus" role="status" aria-live="polite">Loading current records…</div>
    <div id="progressResults"></div>`;
  document.querySelectorAll('[data-progress-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.progressMode===progressMode)));
  loadFutureProgress();
  progressTimer=setInterval(()=>{if(CURRENT==='futureprogress'&&!document.hidden)loadFutureProgress();},60000);
}
async function progressReadTable(table,columns,dateField,range){
  const rows=[];
  for(let offset=0;;offset+=1000){
    const {data,error}=await sb.from(table).select(columns).gte(dateField,range.from).lte(dateField,range.to).order('id').range(offset,offset+999);
    if(error)throw Error('CFD sync unavailable: '+error.message);
    if(!Array.isArray(data))throw Error('CFD data unavailable');
    rows.push(...data);if(data.length<1000)return rows;
  }
}
async function progressCFD(range){
  const [expenses,payouts]=await Promise.all([
    progressReadTable('expenses','id,spent_on,cost','spent_on',range),
    progressReadTable('payouts','id,payout_date,amount,net_amount,status','payout_date',range)
  ]);
  return [...expenses.map(r=>({date:r.spent_on,expense:Number(r.cost),expenseCount:1})),...payouts.map(r=>({date:r.payout_date,revenue:r.status==='paid'?Number(r.net_amount??r.amount):0,revenueCount:r.status==='paid'?1:0,pending:r.status==='paid'?0:Number(r.net_amount??r.amount)}))];
}
async function progressFutures(range){
  const {data,error}=await sb.auth.getSession();
  if(error||!data.session)throw Error('Please log in to the CRM again.');
  const url='https://propdesk-accounts.robofxfan-propdesk.workers.dev/api/integrations/crm-progress?'+new URLSearchParams(range);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store',signal:AbortSignal.timeout(20000)});
  const json=await response.json();
  if(!response.ok)throw Error(json.error||'Hisab sync unavailable');
  if(!Array.isArray(json.days)||json.currency!=='USD')throw Error('Invalid Hisab response');
  return json.days;
}
async function loadFutureProgress(){
  const generation=++progressGeneration,mode=progressMode,range=ProgressMath.period(progressPeriod,progressPeriod==='week'?undefined:progressAnchor);
  const status=$('progressStatus'),results=$('progressResults');if(!status||!results)return;
  status.textContent='Syncing latest records…';const button=$('progressRefresh');if(button)button.disabled=true;
  try{
    const [cfd,futures]=await Promise.all([mode==='futures'?[]:progressCFD(range),mode==='cfd'?[]:progressFutures(range)]);
    if(generation!==progressGeneration||CURRENT!=='futureprogress')return;
    const data=ProgressMath.aggregate(cfd,futures,mode,range.from,range.to);
    renderFutureProgress(data,range);
    status.textContent='✓ Updated '+new Date().toLocaleTimeString()+' · '+(mode==='both'?'CFD CRM + Hisab':mode==='cfd'?'CFD CRM':'Hisab')+' · Read-only';
  }catch(error){
    if(generation!==progressGeneration||CURRENT!=='futureprogress')return;
    if(progressChart){progressChart.destroy();progressChart=null;}
    results.innerHTML='';status.textContent='Unable to show complete performance: '+error.message+' Use Refresh to retry.';
  }finally{if(generation===progressGeneration&&$('progressRefresh'))$('progressRefresh').disabled=false;}
}
function renderFutureProgress(data,range){
  const t=data.total,signed=n=>(n>=0?'+':'−')+money(Math.abs(n));
  const months=ProgressMath.monthly(data.days,range);
  if(progressChart){progressChart.destroy();progressChart=null;}
  $('progressResults').innerHTML=`<div class="cards" style="margin-top:18px">${card('Revenue (+)','+'+money(t.revenue),'g')}${card('Expenses (−)','−'+money(t.expense),'r')}${card('Net performance',signed(t.net),t.net>=0?'g':'r')}${card('ROI',HIDEBAL?'••••':t.roi===null?'—':t.roi.toFixed(1)+'%',t.net>=0?'gd':'r')}</div>
    <p class="page-sub">${t.revenueCount} received revenue entries · ${t.expenseCount} expense entries · Pending / unpaid: ${money(t.pending)} (excluded from net)</p>
    <div class="panel"><h3>Progress over time</h3><div style="height:260px;position:relative"><canvas id="progressChart" aria-label="Revenue, expenses and net performance" role="img"></canvas></div></div>
    <div class="panel"><h3>Monthly performance</h3><p class="page-sub">Each month separately · Click a month for daily details. Empty months show zero.</p><div style="overflow-x:auto"><table><thead><tr><th>Month</th><th>Revenue (+)</th><th>Expenses (−)</th><th>Net performance</th><th>ROI</th></tr></thead><tbody>${months.map(r=>`<tr><td><button class="btn ghost" onclick="progressPeriod='month';setProgressDate('${r.month}-01')">${progressMonths[Number(r.month.slice(5,7))-1]} ${r.month.slice(0,4)}</button></td><td>+${money(r.revenue)}</td><td>−${money(r.expense)}</td><td>${signed(r.net)}</td><td>${HIDEBAL?'••••':r.roi===null?'—':r.roi.toFixed(1)+'%'}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h3>Source breakdown</h3><div style="overflow-x:auto"><table><thead><tr><th>Source</th><th>Revenue (+)</th><th>Expenses (−)</th><th>Net</th></tr></thead><tbody>${data.breakdown.map(r=>`<tr><td>${r.source}</td><td>${'+'+money(r.revenue)}</td><td>${'−'+money(r.expense)}</td><td>${signed(r.net)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="panel"><h3>Daily progress</h3><div style="overflow-x:auto">${data.days.length?`<table><thead><tr><th>Date</th><th>Revenue (+)</th><th>Expenses (−)</th><th>Net</th></tr></thead><tbody>${data.days.slice().reverse().map(r=>`<tr><td>${esc(r.date)}</td><td>+${money(r.revenue)}</td><td>−${money(r.expense)}</td><td>${signed(r.revenue-r.expense)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">No entries in this period.</div>'}</div></div>
    <p class="page-sub">Futures revenue follows Hisab: received amount after split and fees. CFD uses the existing CRM expense and paid-payout records.</p>`;
  const byMonth=['quarter','six','year'].includes(progressPeriod),buckets=new Map();
  for(let d=new Date(range.from+'T12:00:00');d<=new Date(range.to+'T12:00:00');d.setDate(d.getDate()+1)){const key=byMonth?d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'):d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');buckets.set(key,{revenue:0,expense:0});}
  for(const row of data.days){const key=byMonth?row.date.slice(0,7):row.date;const v=buckets.get(key);if(v){v.revenue+=row.revenue;v.expense+=row.expense;}}
  const values=[...buckets.values()];
  if(typeof Chart!=='undefined'&&!HIDEBAL)progressChart=new Chart($('progressChart'),{type:'bar',data:{labels:[...buckets.keys()],datasets:[{label:'Revenue (+)',data:values.map(x=>x.revenue),backgroundColor:'#22c55e'},{label:'Expenses (−)',data:values.map(x=>-x.expense),backgroundColor:'#ef4444'},{label:'Net',type:'line',data:values.map(x=>x.revenue-x.expense),borderColor:'#d4af37',tension:.2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#94a3b8'}}},scales:{x:{ticks:{color:'#94a3b8'}},y:{ticks:{color:'#94a3b8'}}}}});
}
