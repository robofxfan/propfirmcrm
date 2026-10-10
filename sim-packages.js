/* ============================================================
   SIM PACKAGE MANAGEMENT  (roles: admin, sim)
   Saudi Arabia — time zone Asia/Riyadh, prices in SAR.
   Separate module: own tables (sim_cards, sim_renewals, sim_notifications,
   sim_expenses). Uses the CRM's existing helpers ($, sb, ME, esc, card,
   openModal, closeModal, logAct, sar, pickField, pickVal, csvDl, pdfReport).
   Loaded before the main script; functions run only when a page opens.
============================================================ */
const SIM_TZ = 'Asia/Riyadh';
const SIM_NETWORKS = ['STC', 'Mobily', 'Zain', 'Virgin Mobile', 'Lebara', 'Salam'];
const SIM_STATUSES = ['active', 'inactive', 'suspended', 'lost'];
const SIM_EXP_KINDS = { new_sim: 'New SIM', package: 'Package', renewal: 'Renewal', other: 'Other' };
let simData = [], simRenData = [], simExpData = [], simLogData = [];

/* ---------- styles (scoped to this module) ---------- */
(function simStyles(){
  const css = `
  .nav .nav-sec{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:14px 14px 6px;font-weight:700;opacity:.85}
  .nav a .sim-count{margin-left:auto;background:var(--danger);color:#fff;border-radius:20px;font-size:10px;padding:1px 7px;font-weight:800}
  .badge.sim{background:#05222a;color:#5eead4}
  .sim-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .sim-wrap table{min-width:720px}
  .sim-pill{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}
  .sim-pill.ok{background:#0f2a1a;color:var(--green2)}
  .sim-pill.w7{background:#2a2405;color:#facc15}
  .sim-pill.w3{background:#3a2205;color:#fb923c}
  .sim-pill.today{background:#3a1405;color:#fdba74;border:1px solid #f97316}
  .sim-pill.exp{background:#3a1414;color:#fca5a5;border:1px solid #ef4444}
  .sim-pill.off{background:#2a2a2a;color:#bbb}
  .sim-pill.none{background:#1a2430;color:#93c5fd}
  body.light .sim-pill.ok{background:#dcfce7;color:#166534}
  body.light .sim-pill.w7{background:#fef9c3;color:#854d0e}
  body.light .sim-pill.w3{background:#ffedd5;color:#9a3412}
  body.light .sim-pill.today{background:#ffedd5;color:#9a3412}
  body.light .sim-pill.exp{background:#fee2e2;color:#991b1b}
  body.light .sim-pill.off{background:#e5e5e5;color:#444}
  body.light .sim-pill.none{background:#dbeafe;color:#1e40af}
  .sim-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
  .sim-alert{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:10px;margin-bottom:8px;border:1px solid var(--border);background:var(--panel2)}
  .sim-alert.exp{border-color:#7f1d1d;background:rgba(239,68,68,.08)}
  .sim-alert.today{border-color:#9a3412;background:rgba(249,115,22,.08)}
  .sim-alert.w3{border-color:#854d0e;background:rgba(250,204,21,.06)}
  .sim-alert b{font-size:14px}
  .sim-alert .grow{flex:1;min-width:0}
  .sim-kv{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px;margin-bottom:14px}
  .sim-kv div:nth-child(odd){color:var(--muted)}
  .sim-quick{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .sim-quick button{padding:4px 9px;font-size:11px}
  .sim-steps{margin:0 0 0 18px;line-height:1.8;font-size:13px}
  .sim-steps code{background:var(--panel2);padding:1px 6px;border-radius:5px}
  .sim-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;white-space:pre-wrap;background:var(--panel2);padding:10px;border-radius:8px;border:1px solid var(--border)}
  .sim-check{display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:14px}
  .sim-check input{width:auto}
  @media(max-width:820px){ .sim-kv{grid-template-columns:110px 1fr} .sim-acts{justify-content:flex-start} }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();

/* ---------- date helpers (Saudi calendar day) ---------- */
function simToday(){ return new Intl.DateTimeFormat('en-CA',{timeZone:SIM_TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function simDayMs(s){ const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(s||'')); return m?Date.UTC(+m[1],+m[2]-1,+m[3]):null; }
function simAddDays(day,n){ return new Date(simDayMs(day)+n*86400000).toISOString().slice(0,10); }
function simDaysLeft(exp){ const e=simDayMs(exp); if(e==null) return null; return Math.round((e-simDayMs(simToday()))/86400000); }
function simFmt(d){ const t=simDayMs(d); if(t==null) return '-'; return new Date(t).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}); }
function simMonthLabel(ym){ const [y,m]=ym.split('-'); return new Date(Date.UTC(+y,+m-1,1)).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}); }
function simNum(s){ return String(s||'').replace(/[\s\-()]/g,''); }

/* ---------- expiry status ---------- */
function simState(s){
  if(s.status!=='active') return {k:'off',label:s.status,rank:9,d:null};
  const d=simDaysLeft(s.expiry_date);
  if(d==null) return {k:'none',label:'No expiry set',rank:8,d};
  if(d<0)   return {k:'exp',label:'Expired '+Math.abs(d)+'d ago',rank:0,d};
  if(d===0) return {k:'today',label:'Expires today',rank:1,d};
  if(d<=3)  return {k:'w3',label:d+(d===1?' day left':' days left'),rank:2,d};
  if(d<=7)  return {k:'w7',label:d+' days left',rank:3,d};
  return {k:'ok',label:d+' days left',rank:4,d};
}
const simPill = s => { const st=simState(s); return `<span class="sim-pill ${st.k}">${esc(st.label)}</span>`; };
const simSortByExpiry = (a,b)=>{ const x=simState(a),y=simState(b); return x.rank-y.rank || String(a.expiry_date||'9999').localeCompare(String(b.expiry_date||'9999')); };

/* ---------- data ---------- */
async function simLoad(){
  const {data,error}=await sb.from('sim_cards').select('*').order('expiry_date',{ascending:true,nullsFirst:false});
  if(error) throw error; simData=data||[]; return simData;
}
function simSetupError(e){
  const msg=String((e&&e.message)||e||'');
  const missing=/relation .*sim_|does not exist|schema cache|Could not find the table/i.test(msg);
  $('view').innerHTML=`<div class="page-title">\u{1F4F6} SIM Package Management</div>
    <div class="panel" style="margin-top:16px"><h3>${missing?'⚙️ Database setup pending':'⚠️ Could not load SIM data'}</h3>
    <p class="page-sub" style="margin:0">${missing?'SIM tables abhi Supabase mein nahi bane. Supabase Dashboard → SQL Editor mein <b>supabase/sim_package_management.sql</b> run karein, phir page refresh karein.':esc(msg)}</p></div>`;
}
async function simApi(action, extra){
  const {data:{session}}=await sb.auth.getSession();
  if(!session) throw new Error('Login expired. Please log in again.');
  const r=await fetch('/api/sim-reminders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(Object.assign({action},extra||{}))});
  let j={}; try{ j=await r.json(); }catch(e){ throw new Error(r.status===404?'Server function not deployed yet (api/sim-reminders.js).':'Server error '+r.status); }
  if(!r.ok && !j.ok) throw new Error(j.error||('Server error '+r.status)+(j.missing&&j.missing.length?' — missing: '+j.missing.join(', '):''));
  return j;
}

/* nav badge: urgent count (expired / today / <=3 days) */
async function simNavBadge(){
  try{
    if(!ME || !['admin','sim'].includes(ME.role)) return;
    const {data}=await sb.from('sim_cards').select('status,expiry_date').eq('status','active');
    const n=(data||[]).filter(s=>{const d=simDaysLeft(s.expiry_date);return d!=null&&d<=3;}).length;
    const a=document.querySelector('.nav a[data-k="simdash"]'); if(!a) return;
    let b=a.querySelector('.sim-count'); if(!n){ if(b) b.remove(); return; }
    if(!b){ b=document.createElement('span'); b.className='sim-count'; a.appendChild(b); }
    b.textContent=n; b.title=n+' SIM package(s) expired / expiring within 3 days';
  }catch(e){}
}

/* ============================================================
   1) SIM DASHBOARD
============================================================ */
async function simPageDashboard(){
  $('view').innerHTML=`<div class="page-title">\u{1F4F6} SIM Dashboard</div>
    <div class="page-sub">SIM packages overview — Saudi time (${esc(simFmt(simToday()))}). Reminders: 7, 3, 2, 1 din pehle, expiry ke din, aur expiry ke baad roz.</div>
    <div class="toolbar"><span class="grow"></span>
      <button class="btn ghost" onclick="go('simupcoming')">\u{1F4C5} Upcoming</button>
      <button class="btn" onclick="simModal()">+ Add SIM</button></div>
    <div class="cards" id="simCards"><div class="empty">Loading...</div></div>
    <div class="panel"><h3>\u{1F514} Alerts (action needed)</h3><div id="simAlerts"></div></div>
    <div class="panel" style="padding:0"><div style="padding:20px 20px 0"><h3>⏳ Upcoming expiries (next 7 days + expired)</h3></div><div id="simUpTable"></div></div>`;
  try{ await simLoad(); }catch(e){ return simSetupError(e); }
  const act=simData.filter(s=>s.status==='active');
  const days=act.map(s=>simDaysLeft(s.expiry_date));
  const cnt=f=>days.filter(d=>d!=null&&f(d)).length;
  let monthSpend='—';
  try{
    const ym=simToday().slice(0,7);
    const {data}=await sb.from('sim_expenses').select('amount').gte('entry_date',ym+'-01').lte('entry_date',ym+'-31');
    monthSpend=sar((data||[]).reduce((s,x)=>s+Number(x.amount||0),0));
  }catch(e){}
  $('simCards').innerHTML=
    card('Total SIMs',String(simData.length),'')+
    card('Active Packages',String(cnt(d=>d>=0)),'g')+
    card('Expiring Within 7 Days',String(cnt(d=>d>=0&&d<=7)),'gd')+
    card('Expiring Within 3 Days',String(cnt(d=>d>=0&&d<=3)),'gd')+
    card('Expiring Today',String(cnt(d=>d===0)),cnt(d=>d===0)?'r':'')+
    card('Expired Packages',String(cnt(d=>d<0)),cnt(d=>d<0)?'r':'')+
    card('This Month SIM Spend',monthSpend,'');
  const urgent=act.filter(s=>{const d=simDaysLeft(s.expiry_date);return d!=null&&d<=3;}).sort(simSortByExpiry);
  $('simAlerts').innerHTML=urgent.length?urgent.map(s=>{const st=simState(s);return `<div class="sim-alert ${st.k}">
      <div class="grow"><b>${esc(s.sim_number)}</b> · ${esc(s.network)} · ${esc(s.package_name||'-')}<br>
      <span style="font-size:12px;color:var(--muted)">${esc(s.assigned_to||'Unassigned')} · Expiry ${esc(simFmt(s.expiry_date))}</span></div>
      <div style="text-align:right">${simPill(s)}<div style="margin-top:6px"><button class="btn sm" onclick="simRenewModal('${s.id}')">\u{1F504} Renew</button></div></div></div>`;}).join('')
    :'<div class="empty">Sab theek hai \u{1F44D} — koi package 3 din ke andar expire nahi ho raha.</div>';
  const up=act.filter(s=>{const d=simDaysLeft(s.expiry_date);return d!=null&&d<=7;}).sort(simSortByExpiry);
  $('simUpTable').innerHTML=simTable(up,'simPageDashboard','Agle 7 din mein koi expiry nahi.');
  simNavBadge();
}

/* shared SIM table */
function simTable(rows,after,emptyMsg){
  if(!rows.length) return `<div class="empty">${esc(emptyMsg||'No SIMs found.')}</div>`;
  return `<div class="sim-wrap"><table><thead><tr><th>SIM</th><th>Network</th><th>Assigned</th><th>Package</th><th>Price</th><th>Expiry</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(s=>`<tr>
      <td><a href="#" onclick="simView('${s.id}');return false"><b>${esc(s.sim_number)}</b></a></td>
      <td>${esc(s.network)}</td><td>${esc(s.assigned_to||'-')}</td><td>${esc(s.package_name||'-')}</td>
      <td>${s.package_price!=null?sar(s.package_price):'-'}</td><td style="white-space:nowrap">${esc(simFmt(s.expiry_date))}</td>
      <td>${simPill(s)}</td>
      <td><div class="sim-acts">
        <button class="btn sm" onclick="simRenewModal('${s.id}')">\u{1F504} Renew</button>
        <button class="btn ghost sm" onclick="simModal(simData.find(x=>x.id==='${s.id}'),'${after}')">Edit</button>
        <button class="btn ghost sm" onclick="simView('${s.id}')">View</button>
      </div></td></tr>`).join('')}
  </tbody></table></div>`;
}

/* ============================================================
   2) ALL SIMS
============================================================ */
async function simPageAll(){
  $('view').innerHTML=`<div class="page-title">\u{1F4F1} All SIMs</div>
    <div class="page-sub">Add, edit, search and filter SIM records.</div>
    <div class="toolbar">
      <input class="grow" id="simQ" placeholder="Search number, person, package, notes..." oninput="simRenderAll()">
      <select id="simFNet" style="width:auto" onchange="simRenderAll()"></select>
      <select id="simFExp" style="width:auto" onchange="simRenderAll()">
        <option value="">All expiry states</option><option value="exp">Expired</option><option value="today">Expires today</option>
        <option value="3">Within 3 days</option><option value="7">Within 7 days</option><option value="ok">More than 7 days</option><option value="none">No expiry set</option></select>
      <select id="simFSt" style="width:auto" onchange="simRenderAll()"><option value="">All statuses</option>${SIM_STATUSES.map(x=>`<option>${x}</option>`).join('')}</select>
      <button class="btn ghost" onclick="simCsvAll()">⬇ CSV</button>
      <button class="btn" onclick="simModal(null,'simPageAll')">+ Add SIM</button></div>
    <div class="cards" id="simAllCards"></div>
    <div class="panel" style="padding:0"><div id="simAllTable"><div class="empty">Loading...</div></div></div>`;
  try{ await simLoad(); }catch(e){ return simSetupError(e); }
  const nets=[...new Set([...SIM_NETWORKS,...simData.map(s=>s.network).filter(Boolean)])];
  $('simFNet').innerHTML='<option value="">All networks</option>'+nets.map(n=>`<option>${esc(n)}</option>`).join('');
  simRenderAll();
}
function simFiltered(){
  const q=(($('simQ')||{}).value||'').toLowerCase().trim(), net=($('simFNet')||{}).value||'', fx=($('simFExp')||{}).value||'', fs=($('simFSt')||{}).value||'';
  return simData.filter(s=>{
    if(q && !([s.sim_number,simNum(s.sim_number),s.assigned_to,s.package_name,s.notes,s.network].join(' ').toLowerCase().includes(q))) return false;
    if(net && s.network!==net) return false;
    if(fs && s.status!==fs) return false;
    if(fx){ const st=simState(s), d=st.d;
      if(fx==='exp'&&st.k!=='exp') return false; if(fx==='today'&&st.k!=='today') return false;
      if(fx==='3'&&!(s.status==='active'&&d!=null&&d>=0&&d<=3)) return false;
      if(fx==='7'&&!(s.status==='active'&&d!=null&&d>=0&&d<=7)) return false;
      if(fx==='ok'&&st.k!=='ok') return false; if(fx==='none'&&st.k!=='none') return false; }
    return true; }).sort(simSortByExpiry);
}
function simRenderAll(){
  const rows=simFiltered();
  $('simAllCards').innerHTML=card('Showing',rows.length+' / '+simData.length,'')+card('Monthly package value',sar(rows.filter(s=>s.status==='active').reduce((t,s)=>t+Number(s.package_price||0),0)),'gd');
  $('simAllTable').innerHTML=simTable(rows,'simPageAll',simData.length?'Is filter mein koi SIM nahi.':'Abhi koi SIM add nahi hui. "+ Add SIM" se shuru karein.');
}
function simCsvAll(){
  csvDl('sim-cards',simFiltered().map(s=>Object.assign({},s,{days_left:simDaysLeft(s.expiry_date)})),
    ['sim_number','network','assigned_to','package_name','package_price','sim_cost','activation_date','expiry_date','days_left','status','notes']);
}

/* ---------- add / edit ---------- */
function simModal(x,after){
  x=x||{}; const ed=!!x.id; after=after||(typeof CURRENT!=='undefined'&&CURRENT==='simall'?'simPageAll':'simPageDashboard');
  const today=simToday();
  openModal(`<h3>${ed?'Edit SIM':'Add SIM'}</h3>
    <div class="row"><div class="field" style="flex:1;min-width:160px"><label>SIM number *</label><input id="sm_num" inputmode="tel" placeholder="05XXXXXXXX" value="${esc(x.sim_number||'')}"></div>
      <div class="field" style="flex:1;min-width:160px">${pickField('sm_net','Network *',SIM_NETWORKS,x.network)}</div></div>
    <div class="row"><div class="field" style="flex:1;min-width:160px"><label>Assigned person</label><input id="sm_who" value="${esc(x.assigned_to||'')}"></div>
      <div class="field" style="flex:1;min-width:160px"><label>Status</label><select id="sm_st">${SIM_STATUSES.map(o=>`<option ${ (x.status||'active')===o?'selected':''}>${o}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field" style="flex:2;min-width:160px"><label>Package name</label><input id="sm_pkg" placeholder="e.g. Sawa Monthly 30GB" value="${esc(x.package_name||'')}"></div>
      <div class="field" style="flex:1;min-width:110px"><label>Package price (SAR)</label><input id="sm_price" type="number" step="0.01" min="0" value="${x.package_price!=null?x.package_price:''}"></div></div>
    <div class="row"><div class="field" style="flex:1;min-width:140px"><label>Activation date</label><input id="sm_act" type="date" value="${esc(x.activation_date||(ed?'':today))}"></div>
      <div class="field" style="flex:1;min-width:140px"><label>Expiry date</label><input id="sm_exp" type="date" value="${esc(x.expiry_date||'')}">
        <div class="sim-quick">${[7,15,30,90].map(n=>`<button type="button" class="btn ghost" onclick="simQuick('sm_act','sm_exp',${n})">+${n}d</button>`).join('')}</div></div></div>
    ${ed?'':`<div class="field"><label>SIM purchase cost (SAR) — nayi SIM ki qeemat, agar khareedi</label><input id="sm_cost" type="number" step="0.01" min="0" placeholder="0"></div>
    <label class="sim-check"><input type="checkbox" id="sm_addexp" checked> SIM Expenses mein add karein (SIM cost + package price)</label>`}
    <div class="field"><label>Notes</label><textarea id="sm_notes" rows="2">${esc(x.notes||'')}</textarea></div>
    ${ed&&x.expiry_date?'<div style="font-size:12px;color:var(--muted);margin-bottom:10px">ℹ️ Package renew karna ho to "Renew" button use karein — us se history aur kharcha bhi record hota hai. Yahan sirf ghalti theek karein.</div>':''}
    <div class="row" style="justify-content:flex-end">
      ${ed?`<button class="btn danger" style="margin-right:auto" onclick="simDelete('${x.id}','${after}')">Delete</button>`:''}
      <button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="sm_save" onclick="simSave('${x.id||''}','${after}')">Save</button></div>`);
}
function simQuick(actId,expId,n){ const a=$(actId).value||simToday(); $(expId).value=simAddDays(a,n); }
async function simSave(id,after){
  const rec={sim_number:simNum($('sm_num').value), network:pickVal('sm_net'), assigned_to:$('sm_who').value.trim()||null,
    package_name:$('sm_pkg').value.trim()||null, package_price:$('sm_price').value===''?null:Number($('sm_price').value),
    activation_date:$('sm_act').value||null, expiry_date:$('sm_exp').value||null, status:$('sm_st').value, notes:$('sm_notes').value.trim()||null};
  if(!rec.sim_number){alert('SIM number is required');return;}
  if(!/^\+?\d{6,15}$/.test(rec.sim_number)){alert('SIM number sirf digits mein likhein (e.g. 0551234567 ya +966551234567)');return;}
  if(!rec.network){alert('Network is required');return;}
  if(rec.package_price!=null&&!(rec.package_price>=0)){alert('Price sahi likhein');return;}
  if(rec.activation_date&&rec.expiry_date&&rec.expiry_date<rec.activation_date){alert('Expiry date activation date se pehle nahi ho sakti.');return;}
  let cost=0, addExp=false;
  if(!id){ cost=Number(($('sm_cost')||{}).value||0); addExp=!!(($('sm_addexp')||{}).checked); if(cost<0){alert('SIM cost sahi likhein');return;} rec.sim_cost=cost||null; }
  const btn=$('sm_save'); if(btn){btn.disabled=true;btn.textContent='Saving...';}
  let res;
  if(id) res=await sb.from('sim_cards').update(rec).eq('id',id).select().maybeSingle();
  else res=await sb.from('sim_cards').insert(rec).select().single();
  if(res.error){
    const dup=/duplicate|unique/i.test(res.error.message);
    alert(dup?'Yeh SIM number pehle se maujood hai.':res.error.message);
    if(btn){btn.disabled=false;btn.textContent='Save';} return;
  }
  if(!id && addExp && res.data){
    const s=res.data, d=s.activation_date||simToday(), rows=[];
    if(cost>0) rows.push({sim_id:s.id,sim_number:s.sim_number,network:s.network,kind:'new_sim',description:'New SIM purchase',amount:cost,entry_date:d});
    if(Number(s.package_price)>0) rows.push({sim_id:s.id,sim_number:s.sim_number,network:s.network,kind:'package',description:s.package_name||'Package',amount:Number(s.package_price),entry_date:d});
    if(rows.length){ const e=await sb.from('sim_expenses').insert(rows); if(e.error) alert('SIM save ho gayi, lekin kharcha record nahi hua: '+e.error.message); }
  }
  logAct(id?'Update SIM':'Add SIM', rec.sim_number+' '+rec.network);
  closeModal(); window[after] ? window[after]() : simPageAll();
}
async function simDelete(id,after){
  const s=simData.find(x=>x.id===id);
  if(!confirm('SIM '+(s?s.sim_number:'')+' delete karni hai?\n\nRenewal history aur SIM Expenses ka record mehfooz rahega.')) return;
  const r=await sb.from('sim_cards').delete().eq('id',id);
  if(r.error){alert(r.error.message);return;}
  logAct('Delete SIM',s?s.sim_number:id); closeModal(); window[after]?window[after]():simPageAll();
}

/* ---------- view ---------- */
async function simView(id){
  let s=simData.find(x=>x.id===id);
  if(!s){ const r=await sb.from('sim_cards').select('*').eq('id',id).maybeSingle(); s=r.data; }
  if(!s){alert('SIM not found');return;}
  const [ren,logs]=await Promise.all([
    sb.from('sim_renewals').select('*').eq('sim_id',id).order('renewed_at',{ascending:false}).limit(20),
    sb.from('sim_notifications').select('*').eq('sim_id',id).order('created_at',{ascending:false}).limit(10)]);
  const rr=ren.data||[], ll=logs.data||[];
  openModal(`<h3>\u{1F4F1} ${esc(s.sim_number)} ${simPill(s)}</h3>
    <div class="sim-kv">
      <div>Network</div><div>${esc(s.network)}</div><div>Assigned to</div><div>${esc(s.assigned_to||'-')}</div>
      <div>Package</div><div>${esc(s.package_name||'-')}</div><div>Price</div><div>${s.package_price!=null?sar(s.package_price):'-'}</div>
      <div>Activation</div><div>${esc(simFmt(s.activation_date))}</div><div>Expiry</div><div>${esc(simFmt(s.expiry_date))}</div>
      <div>Status</div><div>${esc(s.status)}</div><div>Notes</div><div>${esc(s.notes||'-')}</div></div>
    <h3 style="font-size:13px;margin:6px 0 8px">Renewal history (${rr.length})</h3>
    ${rr.length?`<div class="sim-wrap"><table style="min-width:0"><tbody>${rr.map(r=>`<tr><td>${esc(simFmt(String(r.renewed_at).slice(0,10)))}</td><td>${esc(simFmt(r.old_expiry_date))} → <b>${esc(simFmt(r.new_expiry_date))}</b></td><td>${r.new_price!=null?sar(r.new_price):''}</td></tr>`).join('')}</tbody></table></div>`:'<div style="color:var(--muted);font-size:12px">No renewals yet.</div>'}
    <h3 style="font-size:13px;margin:14px 0 8px">Recent reminders (${ll.length})</h3>
    ${ll.length?`<div class="sim-wrap"><table style="min-width:0"><tbody>${ll.map(n=>`<tr><td>${esc(simFmt(n.run_date))}</td><td>${esc(simStageLabel(n))}</td><td>${simLogPill(n.status)}</td></tr>`).join('')}</tbody></table></div>`:'<div style="color:var(--muted);font-size:12px">No reminders yet.</div>'}
    <div class="row" style="justify-content:flex-end;margin-top:16px">
      <button class="btn ghost" onclick="closeModal()">Close</button>
      <button class="btn ghost" onclick="simModal(simData.find(x=>x.id==='${s.id}')||${esc(JSON.stringify({id:s.id}))})">Edit</button>
      <button class="btn" onclick="simRenewModal('${s.id}')">\u{1F504} Renew Package</button></div>`);
}

/* ---------- renew ---------- */
async function simRenewModal(id){
  let s=simData.find(x=>x.id===id);
  if(!s){ const r=await sb.from('sim_cards').select('*').eq('id',id).maybeSingle(); s=r.data; }
  if(!s){alert('SIM not found');return;}
  const today=simToday();
  const defAct=(s.expiry_date&&s.expiry_date>=today)?s.expiry_date:today;
  openModal(`<h3>\u{1F504} Renew Package — ${esc(s.sim_number)}</h3>
    <div class="sim-kv"><div>Network</div><div>${esc(s.network)}</div><div>Current package</div><div>${esc(s.package_name||'-')} ${s.package_price!=null?'('+sar(s.package_price)+')':''}</div>
      <div>Current expiry</div><div>${esc(simFmt(s.expiry_date))} ${simPill(s)}</div></div>
    <div class="row"><div class="field" style="flex:1;min-width:140px"><label>New activation date *</label><input id="rn_act" type="date" value="${defAct}"></div>
      <div class="field" style="flex:1;min-width:140px"><label>New expiry date *</label><input id="rn_exp" type="date">
        <div class="sim-quick">${[7,15,30,90].map(n=>`<button type="button" class="btn ghost" onclick="simQuick('rn_act','rn_exp',${n})">+${n}d</button>`).join('')}</div></div></div>
    <div class="row"><div class="field" style="flex:2;min-width:160px"><label>Package name</label><input id="rn_pkg" value="${esc(s.package_name||'')}"></div>
      <div class="field" style="flex:1;min-width:110px"><label>Price (SAR)</label><input id="rn_price" type="number" step="0.01" min="0" value="${s.package_price!=null?s.package_price:''}"></div></div>
    <div class="field"><label>Notes</label><input id="rn_notes" placeholder="e.g. paid via STC Pay"></div>
    <label class="sim-check"><input type="checkbox" id="rn_addexp" checked> SIM Expenses mein add karein</label>
    <div style="font-size:12px;color:var(--muted);margin-bottom:12px">Purani expiry history mein save hogi, purani expiry ke reminders band ho jayenge aur nayi expiry ke reminders shuru honge.</div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="rn_save" onclick="simRenewSave('${s.id}')">Renew</button></div>`);
}
async function simRenewSave(id){
  const act=$('rn_act').value||null, exp=$('rn_exp').value, price=$('rn_price').value;
  if(!act){alert('New activation date zaroori hai');return;}
  if(!exp){alert('New expiry date zaroori hai');return;}
  if(exp<act){alert('Expiry date activation date se pehle nahi ho sakti.');return;}
  const s=simData.find(x=>x.id===id);
  if(s&&s.expiry_date&&exp<=s.expiry_date&&!confirm('Nayi expiry ('+simFmt(exp)+') purani expiry ('+simFmt(s.expiry_date)+') se aage nahi hai. Phir bhi save karein?')) return;
  if(price!==''&&!(Number(price)>=0)){alert('Price sahi likhein');return;}
  const btn=$('rn_save'); if(btn){btn.disabled=true;btn.textContent='Saving...';}
  const {error}=await sb.rpc('sim_renew',{p_sim_id:id,p_new_activation:act,p_new_expiry:exp,
    p_package_name:$('rn_pkg').value.trim()||null,p_price:price===''?null:Number(price),p_notes:$('rn_notes').value.trim()||null,
    p_add_expense:!!$('rn_addexp').checked});
  if(error){alert('Renew nahi hua: '+error.message);if(btn){btn.disabled=false;btn.textContent='Renew';}return;}
  logAct('Renew SIM package',(s?s.sim_number:id)+' → '+exp);
  closeModal();
  const back={simdash:simPageDashboard,simall:simPageAll,simupcoming:simPageUpcoming}[CURRENT];
  (back||simPageDashboard)();
}

/* ============================================================
   3) UPCOMING EXPIRIES
============================================================ */
async function simPageUpcoming(){
  $('view').innerHTML=`<div class="page-title">\u{1F4C5} Upcoming Expiries</div>
    <div class="page-sub">Active SIM packages sorted by expiry date (Saudi time).</div>
    <div class="toolbar"><select id="simUpRange" style="width:auto" onchange="simRenderUpcoming()">
      <option value="7">Next 7 days</option><option value="15">Next 15 days</option><option value="30" selected>Next 30 days</option><option value="60">Next 60 days</option><option value="9999">All</option></select>
      <label class="sim-check" style="margin:0"><input type="checkbox" id="simUpExp" checked onchange="simRenderUpcoming()"> Include expired</label></div>
    <div class="panel" style="padding:0"><div id="simUpList"><div class="empty">Loading...</div></div></div>`;
  try{ await simLoad(); }catch(e){ return simSetupError(e); }
  simRenderUpcoming();
}
function simRenderUpcoming(){
  const n=Number($('simUpRange').value), inc=$('simUpExp').checked;
  const rows=simData.filter(s=>{ if(s.status!=='active') return false; const d=simDaysLeft(s.expiry_date); if(d==null) return false; return d<0?inc:d<=n; }).sort(simSortByExpiry);
  $('simUpList').innerHTML=simTable(rows,'simPageUpcoming','Is range mein koi expiry nahi.');
}

/* ============================================================
   4) RENEWAL HISTORY
============================================================ */
async function simPageRenewals(){
  $('view').innerHTML=`<div class="page-title">\u{1F5C2}️ Renewal History</div>
    <div class="page-sub">Har renewal ka record (audit) — purani aur nayi expiry, package aur price.</div>
    <div class="toolbar"><input class="grow" id="simRenQ" placeholder="Search SIM number, network, package, notes..." oninput="simRenderRenewals()">
      <button class="btn ghost" onclick="simCsvRenewals()">⬇ CSV</button></div>
    <div class="panel" style="padding:0"><div id="simRenTable"><div class="empty">Loading...</div></div></div>`;
  const {data,error}=await sb.from('sim_renewals').select('*').order('renewed_at',{ascending:false}).limit(1000);
  if(error) return simSetupError(error);
  simRenData=data||[]; simRenderRenewals();
}
function simRenFiltered(){ const q=(($('simRenQ')||{}).value||'').toLowerCase(); return simRenData.filter(r=>[r.sim_number,r.network,r.old_package_name,r.new_package_name,r.notes].join(' ').toLowerCase().includes(q)); }
function simRenderRenewals(){
  const rows=simRenFiltered();
  $('simRenTable').innerHTML=rows.length?`<div class="sim-wrap"><table><thead><tr><th>Renewed on</th><th>SIM</th><th>Network</th><th>Old package / expiry</th><th>New package / expiry</th><th>Price</th><th>Notes</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td style="white-space:nowrap">${esc(simFmt(String(r.renewed_at).slice(0,10)))}${entryMeta({created_by:r.renewed_by},'')}</td>
      <td><b>${esc(r.sim_number)}</b></td><td>${esc(r.network||'-')}</td>
      <td>${esc(r.old_package_name||'-')}<br><span style="color:var(--muted);font-size:12px">${esc(simFmt(r.old_expiry_date))}</span></td>
      <td>${esc(r.new_package_name||'-')}<br><span style="color:var(--green2);font-size:12px">${esc(simFmt(r.new_activation_date))} → ${esc(simFmt(r.new_expiry_date))}</span></td>
      <td>${r.new_price!=null?sar(r.new_price):'-'}</td><td>${esc(r.notes||'')}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Abhi koi renewal record nahi.</div>';
}
function simCsvRenewals(){ csvDl('sim-renewals',simRenFiltered(),['renewed_at','sim_number','network','old_package_name','old_price','old_activation_date','old_expiry_date','new_package_name','new_price','new_activation_date','new_expiry_date','notes']); }

/* ============================================================
   5) SIM EXPENSES  (separate ledger, month-wise)
============================================================ */
async function simPageExpenses(){
  $('view').innerHTML=`<div class="page-title">\u{1F4B8} SIM Expenses</div>
    <div class="page-sub">SIM packages aur nayi SIMs ka kharcha (SAR) — alag hisaab, kisi aur section se connected nahi.</div>
    <div class="panel"><h3>\u{1F4C5} Month</h3>
      <div class="field" style="max-width:260px"><label>Select month</label><select id="seMonth" onchange="simRenderExpenses()"></select></div></div>
    <div class="cards" id="seCards"></div>
    <div class="toolbar"><input class="grow" id="seQ" placeholder="Search SIM, network, description, notes..." oninput="simRenderExpenses()">
      <button class="btn ghost" onclick="simPdfExpenses()">⬇ PDF</button><button class="btn ghost" onclick="simCsvExpenses()">⬇ CSV</button>
      <button class="btn" onclick="simExpModal()">+ Add Expense</button></div>
    <div class="panel" style="padding:0"><div id="seTable"><div class="empty">Loading...</div></div></div>
    <div class="panel"><h3>\u{1F4CA} Month-wise summary</h3><div id="seMonths"></div></div>`;
  const [ex,sims]=await Promise.all([sb.from('sim_expenses').select('*').order('entry_date',{ascending:false}).order('created_at',{ascending:false}), sb.from('sim_cards').select('id,sim_number,network')]);
  if(ex.error) return simSetupError(ex.error);
  simExpData=ex.data||[]; if(!sims.error) simData=simData.length?simData:(sims.data||[]);
  const cur=simToday().slice(0,7);
  const ms=[...new Set([cur,...simExpData.map(x=>String(x.entry_date).slice(0,7))])].sort().reverse();
  $('seMonth').innerHTML=ms.map(m=>`<option value="${m}" ${m===cur?'selected':''}>${esc(simMonthLabel(m))}</option>`).join('')+'<option value="all">All months</option>';
  simRenderExpenses();
}
function simExpFiltered(){
  const m=($('seMonth')||{}).value||'all', q=(($('seQ')||{}).value||'').toLowerCase();
  return simExpData.filter(x=>(m==='all'||String(x.entry_date).slice(0,7)===m) && [x.sim_number,x.network,x.description,x.notes,SIM_EXP_KINDS[x.kind]].join(' ').toLowerCase().includes(q));
}
function simRenderExpenses(){
  const rows=simExpFiltered(), m=$('seMonth').value;
  const sum=f=>rows.filter(f).reduce((t,x)=>t+Number(x.amount||0),0);
  $('seCards').innerHTML=card((m==='all'?'Total':'This month')+' spent',sar(sum(()=>true)),'r')+
    card('Packages & renewals',sar(sum(x=>x.kind==='package'||x.kind==='renewal')),'gd')+
    card('New SIMs',sar(sum(x=>x.kind==='new_sim')),'gd')+card('Other',sar(sum(x=>x.kind==='other')),'')+card('Entries',String(rows.length),'');
  $('seTable').innerHTML=rows.length?`<div class="sim-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>SIM</th><th>Description</th><th>Amount</th><th>Notes</th><th></th></tr></thead><tbody>
    ${rows.map(x=>`<tr><td style="white-space:nowrap">${esc(simFmt(x.entry_date))}${entryMeta(x,'entry_date')}</td><td>${esc(SIM_EXP_KINDS[x.kind]||x.kind)}</td>
      <td>${esc(x.sim_number||'-')}<br><span style="font-size:11px;color:var(--muted)">${esc(x.network||'')}</span></td><td>${esc(x.description||'')}</td>
      <td style="color:#fca5a5;font-weight:700;white-space:nowrap">${sar(x.amount)}</td><td>${esc(x.notes||'')}</td>
      <td><div class="sim-acts"><button class="btn ghost sm" onclick="simExpModal(simExpData.find(e=>e.id==='${x.id}'))">Edit</button>
        <button class="btn danger sm" onclick="delRow('sim_expenses','${x.id}',simPageExpenses)">Del</button></div></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Is month mein koi SIM kharcha nahi.</div>';
  const byM={}; simExpData.forEach(x=>{const k=String(x.entry_date).slice(0,7);const o=byM[k]=byM[k]||{t:0,p:0,n:0,o:0,c:0};const a=Number(x.amount||0);o.t+=a;o.c++;if(x.kind==='new_sim')o.n+=a;else if(x.kind==='other')o.o+=a;else o.p+=a;});
  const keys=Object.keys(byM).sort().reverse();
  $('seMonths').innerHTML=keys.length?`<div class="sim-wrap"><table style="min-width:520px"><thead><tr><th>Month</th><th>Packages</th><th>New SIMs</th><th>Other</th><th>Total</th><th>Entries</th></tr></thead><tbody>
    ${keys.map(k=>`<tr style="cursor:pointer" onclick="$('seMonth').value='${k}';simRenderExpenses()"><td><b>${esc(simMonthLabel(k))}</b></td><td>${sar(byM[k].p)}</td><td>${sar(byM[k].n)}</td><td>${sar(byM[k].o)}</td><td style="font-weight:800">${sar(byM[k].t)}</td><td>${byM[k].c}</td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">No data yet.</div>';
}
function simExpModal(x){
  x=x||{}; const ed=!!x.id;
  const opts=simData.slice().sort((a,b)=>String(a.sim_number).localeCompare(String(b.sim_number)));
  openModal(`<h3>${ed?'Edit':'Add'} SIM Expense</h3>
    <div class="row"><div class="field" style="flex:1;min-width:140px"><label>Type *</label><select id="se_kind">${Object.entries(SIM_EXP_KINDS).map(([k,l])=>`<option value="${k}" ${(x.kind||'package')===k?'selected':''}>${l}</option>`).join('')}</select></div>
      <div class="field" style="flex:1;min-width:140px"><label>Amount (SAR) *</label><input id="se_amt" type="number" step="0.01" min="0" value="${x.amount!=null?x.amount:''}"></div></div>
    <div class="field"><label>SIM</label><select id="se_sim"><option value="">— Not linked to a SIM —</option>${opts.map(s=>`<option value="${s.id}" ${x.sim_id===s.id?'selected':''}>${esc(s.sim_number)} · ${esc(s.network)}</option>`).join('')}</select></div>
    <div class="field"><label>Description</label><input id="se_desc" placeholder="e.g. Sawa 30GB monthly" value="${esc(x.description||'')}"></div>
    <div class="field"><label>Date *</label><input id="se_date" type="date" value="${esc(x.entry_date||simToday())}"></div>
    <div class="field"><label>Notes</label><textarea id="se_notes" rows="2">${esc(x.notes||'')}</textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" onclick="closeModal()">Cancel</button>
      <button class="btn" id="se_save" onclick="simExpSave('${x.id||''}')">Save</button></div>`);
}
async function simExpSave(id){
  const simId=$('se_sim').value, s=simData.find(z=>z.id===simId);
  const rec={kind:$('se_kind').value, amount:Number($('se_amt').value), description:$('se_desc').value.trim()||null,
    entry_date:$('se_date').value, notes:$('se_notes').value.trim()||null, sim_id:simId||null,
    sim_number:s?s.sim_number:null, network:s?s.network:null};
  if(!($('se_amt').value!==''&&rec.amount>=0)){alert('Amount sahi likhein');return;}
  if(!rec.entry_date){alert('Date zaroori hai');return;}
  if(id){ const old=simExpData.find(e=>e.id===id); if(old&&!simId&&old.sim_id==null){ rec.sim_number=old.sim_number; rec.network=old.network; } }
  const btn=$('se_save'); if(btn){btn.disabled=true;btn.textContent='Saving...';}
  const r=id?await sb.from('sim_expenses').update(rec).eq('id',id):await sb.from('sim_expenses').insert(rec);
  if(r.error){alert(r.error.message);if(btn){btn.disabled=false;btn.textContent='Save';}return;}
  logAct(id?'Update SIM expense':'Add SIM expense',(rec.sim_number||'')+' '+sar(rec.amount));
  closeModal(); simPageExpenses();
}
function simCsvExpenses(){ csvDl('sim-expenses',simExpFiltered(),['entry_date','kind','sim_number','network','description','amount','notes']); }
function simPdfExpenses(){
  const rows=simExpFiltered(), m=$('seMonth').value, tot=rows.reduce((t,x)=>t+Number(x.amount||0),0);
  pdfReport({section:'SIM Expenses (SAR)',period:m==='all'?'Overall':simMonthLabel(m),
    columns:['Date','Type','SIM','Description','Amount (SAR)'],
    rows:rows.map(x=>[x.entry_date||'',SIM_EXP_KINDS[x.kind]||x.kind,(x.sim_number||'-')+(x.network?' ('+x.network+')':''),x.description||'',pdfN(x.amount)]),
    totals:[['Total Spent','SAR '+pdfN(tot),PDF_RED]], filename:'sim-expenses-'+(m==='all'?'overall':m)+'.pdf'});
}

/* ============================================================
   6) SIM SETTINGS  (Telegram, schedule, notification log)
============================================================ */
const simStageLabel = n => ({d7:'7-day reminder',d3:'3 days',d2:'2 days',d1:'1 day',d0:'Expiry day',overdue:'Expired (daily)',test:'Test message'}[n.stage]||n.stage)+(n.days_left!=null&&n.stage!=='test'?' ('+n.days_left+'d)':'');
const simLogPill = st => `<span class="sim-pill ${({sent:'ok',failed:'exp',pending:'w7',sending:'w3',cancelled:'off'})[st]||'off'}">${esc(st)}</span>`;
async function simPageSettings(){
  $('view').innerHTML=`<div class="page-title">⚙️ SIM Settings</div>
    <div class="page-sub">Telegram reminders, schedule aur notification log.</div>
    <div class="panel"><h3>\u{1F4E8} Telegram status</h3><div id="simTgStatus"><div class="empty">Checking...</div></div>
      <div class="toolbar" style="margin:12px 0 0">
        <button class="btn" onclick="simTestTelegram()">\u{1F4E4} Send test message</button>
        <button class="btn ghost" onclick="simRunNow(true)">\u{1F441} Preview today's reminders</button>
        <button class="btn gold" onclick="simRunNow(false)">▶ Run check now</button>
        <button class="btn ghost" onclick="simFindChats()">\u{1F50E} Find my chat ID</button></div>
      <div id="simTgOut" style="margin-top:12px"></div></div>
    <div class="panel"><h3>⏰ Schedule</h3>
      <div class="sim-kv"><div>Time zone</div><div>Asia/Riyadh (Saudi Arabia, UTC+3)</div>
        <div>Daily check</div><div>Roz subah 9:00–9:59 Saudi time (Vercel Cron, free plan par ek din mein ek baar)</div>
        <div>Reminders</div><div>7, 3, 2, 1 din pehle · expiry ke din · expiry ke baad roz, jab tak renewal record na ho</div>
        <div>Duplicate</div><div>Har SIM + expiry date + stage ka reminder sirf ek baar jata hai</div></div>
      <div style="font-size:12px;color:var(--muted)">Time badalna ho to repo ki <code>vercel.json</code> mein schedule badlein (UTC mein: Saudi time − 3 ghante, e.g. 9 AM = <code>0 6 * * *</code>).</div></div>
    <div class="panel"><h3>\u{1F6E0} Telegram setup (ek baar)</h3><ol class="sim-steps">
      <li>Telegram mein <b>@BotFather</b> kholein → <code>/newbot</code> → naam dein → jo <b>token</b> mile woh copy karein.</li>
      <li>Apne naye bot ko Telegram mein kholein aur <b>Start</b> dabayein (koi bhi message bhej dein). Group mein chahiye to bot ko group mein add karein.</li>
      <li>Vercel → Project → Settings → Environment Variables mein <code>TELEGRAM_BOT_TOKEN</code> daalein aur redeploy karein.</li>
      <li>Yahan <b>"Find my chat ID"</b> dabayein, jo ID aaye usay <code>TELEGRAM_CHAT_ID</code> mein daalein (kai IDs comma se) aur redeploy karein.</li>
      <li><b>"Send test message"</b> dabayein — Telegram par message aa jaye to setup mukammal.</li></ol></div>
    <div class="panel" style="padding:0"><div style="padding:20px 20px 0"><h3>\u{1F4DC} Notification log <button class="btn ghost sm" onclick="simLoadLogs()">\u{1F504}</button></h3></div><div id="simLogTable"><div class="empty">Loading...</div></div></div>`;
  simLoadStatus(); simLoadLogs();
}
async function simLoadStatus(){
  try{
    const s=await simApi('status');
    const row=(ok,t,warn)=>`<div style="margin:4px 0">${ok?'✅':(warn?'⚠️':'❌')} ${t}</div>`;
    $('simTgStatus').innerHTML=row(s.telegramTokenSet,'Bot token '+(s.telegramTokenSet?'set':'missing (TELEGRAM_BOT_TOKEN)'))+
      row(s.telegramChats>0,'Chat ID '+(s.telegramChats>0?'set ('+s.telegramChats+')':'missing (TELEGRAM_CHAT_ID)'))+
      row(s.cronSecretSet,'Scheduled job secret '+(s.cronSecretSet?'set':'missing (CRON_SECRET) — daily check will not run'))+
      `<div style="margin-top:8px;font-size:12px;color:var(--muted)">Server date (Saudi): ${esc(simFmt(s.today))}${s.telegramConfigured?'':' · Telegram set na ho tab bhi reminders log mein "pending" dikhte hain aur Dashboard par alerts nazar aate hain.'}</div>`;
  }catch(e){ $('simTgStatus').innerHTML=`<div class="msg err">${esc(e.message)}</div>`; }
}
async function simLoadLogs(){
  const {data,error}=await sb.from('sim_notifications').select('*').order('created_at',{ascending:false}).limit(150);
  if(error){ $('simLogTable').innerHTML=`<div class="empty">${esc(error.message)}</div>`; return; }
  simLogData=data||[];
  $('simLogTable').innerHTML=simLogData.length?`<div class="sim-wrap"><table><thead><tr><th>Date</th><th>SIM</th><th>Reminder</th><th>Status</th><th>Tries</th><th>Error / note</th><th></th></tr></thead><tbody>
    ${simLogData.map((n,i)=>`<tr><td style="white-space:nowrap">${esc(simFmt(n.run_date))}</td><td>${esc(n.sim_number||'-')}</td><td>${esc(simStageLabel(n))}</td>
      <td>${simLogPill(n.status)}</td><td>${n.attempts||0}</td><td style="font-size:12px;color:var(--muted);max-width:280px">${esc(n.last_error||'')}</td>
      <td><button class="btn ghost sm" onclick="simShowMsg(${i})">Message</button></td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty">Abhi koi reminder generate nahi hua.</div>';
}
function simShowMsg(i){ const n=simLogData[i]; openModal(`<h3>Reminder message</h3><div class="sim-mono">${esc(n&&n.message||'-')}</div><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" onclick="closeModal()">Close</button></div>`); }
async function simTestTelegram(){
  const o=$('simTgOut'); o.innerHTML='<div class="empty">Sending...</div>';
  try{ await simApi('test'); o.innerHTML='<div class="msg ok">✅ Test message bhej diya. Telegram check karein.</div>'; logAct('SIM Telegram test','sent'); }
  catch(e){ o.innerHTML=`<div class="msg err">❌ ${esc(e.message)}</div>`; }
  simLoadLogs();
}
async function simRunNow(dry){
  if(!dry&&!confirm('Abhi reminder check chalayein? Jo reminders aaj due hain woh Telegram par chale jayenge (jo pehle ja chuke woh dobara nahi jayenge).')) return;
  const o=$('simTgOut'); o.innerHTML='<div class="empty">Running...</div>';
  try{
    const r=await simApi('run',{dryRun:!!dry});
    if(dry){ o.innerHTML=`<div class="msg ok">Aaj (${esc(simFmt(r.today))}) ${r.due} reminder(s) due:</div>`+(r.preview&&r.preview.length?`<div class="sim-mono">${r.preview.map(p=>esc(p.sim_number+'  ·  '+simStageLabel(p)+'  ·  expiry '+simFmt(p.expiry_date))).join('\n')}</div><div style="font-size:12px;color:var(--muted);margin-top:6px">Jo pehle bheje ja chuke hain woh dobara nahi jayenge.</div>`:''); }
    else { o.innerHTML=`<div class="msg ${r.failed?'err':'ok'}">Checked ${r.checked} SIM(s) · new reminders ${r.created} · sent ${r.sent} · failed ${r.failed}${r.waiting?' · waiting (Telegram not configured) '+r.waiting:''}</div>`; logAct('SIM reminder run (manual)','sent '+r.sent+', failed '+r.failed); simLoadLogs(); }
  }catch(e){ o.innerHTML=`<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
async function simFindChats(){
  const o=$('simTgOut'); o.innerHTML='<div class="empty">Checking bot messages...</div>';
  try{ const r=await simApi('chat_ids');
    o.innerHTML=r.chats&&r.chats.length?`<div class="msg ok">Yeh chat(s) mile — ID ko Vercel mein <b>TELEGRAM_CHAT_ID</b> mein daalein:</div><div class="sim-mono">${r.chats.map(c=>esc(c.id+'   '+c.type+'   '+c.name)).join('\n')}</div>`
      :'<div class="msg err">Koi chat nahi mili. Pehle Telegram mein apne bot ko kholein, Start dabayein / koi message bhejein, phir dobara try karein.</div>';
  }catch(e){ o.innerHTML=`<div class="msg err">❌ ${esc(e.message)}</div>`; }
}
