/* Monthly analysis: derives reports from existing records; never writes records. */
(function(root){
  const val=(n)=>{const x=Number(n??0);if(!Number.isFinite(x))throw Error('Invalid report amount');return x;};
  const label=(s,fallback='Unassigned')=>String(s??'').trim()||fallback;
  function entries(cfd,hisab,range){
    if(!Array.isArray(cfd.expenses)||!Array.isArray(cfd.payouts)||!Array.isArray(hisab.expenses)||!Array.isArray(hisab.payouts))throw Error('Incomplete monthly details');
    const rows=[];
    for(const r of cfd.expenses)rows.push({source:'CFD',kind:'expense',id:r.id,date:r.spent_on,firm:label(r.prop_firm),name:'Unassigned',account:label(r.account_size,'-'),note:label(r.notes,'-'),expense:val(r.cost),revenue:0,pending:0,gross:0,status:'Expense'});
    for(const r of cfd.payouts){const received=r.status==='paid',net=val(r.net_amount??r.amount);rows.push({source:'CFD',kind:'payout',id:r.id,date:r.payout_date,firm:label(r.prop_firm),name:label(r.payout_for),account:label(r.account_size,'-'),note:label(r.notes,'-'),expense:0,revenue:received?net:0,pending:received?0:net,gross:val(r.amount),split:r.split_pct,fee:0,status:received?'Received':label(r.status,'Unpaid'),net});}
    for(const r of hisab.expenses)rows.push({source:'Futures',kind:'expense',id:r.id,date:r.date,firm:'Unassigned',name:'Unassigned',account:'-',note:label(r.title,'Expense')+(r.note?' | '+r.note:''),expense:val(r.amount),revenue:0,pending:0,gross:0,status:'Expense'});
    for(const r of hisab.payouts){const status=String(r.status??'received').toLowerCase(),received=status==='received',gross=val(r.gross),share=gross*val(r.split)/100,fee=share*val(r.fee_pct)/100,net=share-fee;rows.push({source:'Futures',kind:'payout',id:r.id,date:r.date,firm:label(r.firm),name:label(r.profile),account:'-',note:label(r.note,'-'),expense:0,revenue:received?net:0,pending:status==='pending'?net:0,gross,split:r.split,fee,status:received?'Received':label(r.status,'Unpaid'),net});}
    return rows.filter(r=>r.date>=range.from&&r.date<=range.to).sort((a,b)=>a.date.localeCompare(b.date)||a.source.localeCompare(b.source)||String(a.id).localeCompare(String(b.id)));
  }
  function sum(rows){const t={expense:0,revenue:0,pending:0,grossReceived:0,expenseCount:0,revenueCount:0};for(const r of rows){t.expense+=r.expense;t.revenue+=r.revenue;t.pending+=r.pending;if(r.kind==='expense')t.expenseCount++;if(r.status==='Received'){t.revenueCount++;t.grossReceived+=r.gross;}}t.net=t.revenue-t.expense;t.roi=t.expense>0?t.net/t.expense*100:null;return t;}
  function grouped(rows,key){const map=new Map();for(const r of rows){const k=key(r);if(!map.has(k))map.set(k,[]);map.get(k).push(r);}return [...map.values()].map(a=>({source:a[0].source,firm:a[0].firm,name:a[0].name,...sum(a)})).sort((a,b)=>a.source.localeCompare(b.source)||b.revenue-a.revenue||a.firm.localeCompare(b.firm));}
  function build(cfd,hisab,range,generatedAt=new Date().toISOString()){
    const rows=entries(cfd,hisab,range),sources=['CFD','Futures'].map(source=>({source,...sum(rows.filter(r=>r.source===source))}));
    const firms=grouped(rows,r=>r.source+'|'+r.firm.trim().toLowerCase());
    const recipients=grouped(rows.filter(r=>r.kind==='payout'),r=>r.source+'|'+r.firm.trim().toLowerCase()+'|'+r.name.trim().toLowerCase());
    return {range,month:range.from.slice(0,7),generatedAt,rows,total:sum(rows),sources,firms,recipients};
  }
  function daily(rows){return rows.map(r=>({date:r.date,expense:r.expense,revenue:r.revenue,pending:r.pending,expenseCount:r.kind==='expense'?1:0,revenueCount:r.status==='Received'?1:0}));}
  const cash=n=>'$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function pdf(report,jsPDF){
    const doc=new jsPDF({unit:'mm',format:'a4'}),W=210,H=297,M=14;
    let y=22;
    const text=(s)=>String(s??'-').replace(/[\u2010-\u2015]/g,'-').replace(/[^\x20-\x7E\n\u00A0-\u00FF]/g,'?');
    const heading=(title)=>{if(y>250){doc.addPage();y=22;}doc.setFont('helvetica','bold');doc.setFontSize(13);doc.setTextColor(20,83,45);doc.text(title,M,y);y+=7;};
    const note=(s)=>{doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(70);const lines=doc.splitTextToSize(text(s),W-2*M);if(y+lines.length*4>275){doc.addPage();y=22;}doc.text(lines,M,y);y+=lines.length*4+5;};
    const table=(title,head,body)=>{heading(title);doc.autoTable({startY:y,head:[head],body:body.length?body:[head.map((_,i)=>i===0?'No recorded entries':'-')],margin:{left:M,right:M,top:20,bottom:20},styles:{font:'helvetica',fontSize:8,cellPadding:2.2,overflow:'linebreak'},headStyles:{fillColor:[20,83,45]},alternateRowStyles:{fillColor:[243,247,244]},rowPageBreak:'avoid',didParseCell:d=>{d.cell.text=d.cell.text.map(text);}});y=doc.lastAutoTable.finalY+10;};
    doc.setFont('helvetica','bold');doc.setTextColor(20,83,45);doc.setFontSize(24);doc.text('MAJID ALI',M,y);y+=9;
    doc.setFontSize(16);doc.text('Monthly Performance | '+report.month,M,y);y+=8;
    note('Combined CFD + Futures | USD\nPeriod: '+report.range.from+' to '+report.range.to+'\nGenerated: '+report.generatedAt.replace('T',' ').slice(0,19)+' UTC');
    const t=report.total;
    table('Overall monthly earnings',['Received earning','Expenses / invested','Net after expenses','Pending / unpaid'],[[cash(t.revenue),cash(t.expense),cash(t.net),cash(t.pending)]]);
    table('CFD and Futures summary',['Source','Gross received','Received earning','Expenses','Net','ROI'],report.sources.map(s=>[s.source,cash(s.grossReceived),cash(s.revenue),cash(s.expense),cash(s.net),s.roi===null?'-':s.roi.toFixed(1)+'%']));
    heading('Earning vs expenses by source');
    // Native vector bars remain sharp in downloaded PDFs.
    const max=Math.max(1,...report.sources.flatMap(s=>[s.revenue,s.expense]));
    for(const s of report.sources){
      doc.setFontSize(10);doc.setTextColor(40);doc.text(s.source,M,y+3);y+=8;
      for(const [name,value,color] of [['Earning',s.revenue,[22,130,78]],['Expenses',s.expense,[192,63,63]]]){
        doc.setFontSize(8);doc.setTextColor(60);doc.text(name,M,y+3);doc.setFillColor(...color);doc.rect(M+25,y,Math.max(0,value/max)*105,5,'F');doc.text(cash(value),W-M,y+4,{align:'right'});y+=9;
      }y+=3;
    }
    note('Received earning is after payout split and fees. Pending/unpaid payouts are excluded from earning and net. Expenses are recorded costs, not account equity. Dates follow the saved transaction date; this is not a separate bank-settlement-date report.');
    doc.addPage();y=22;
    table('Firm-wise earning and recorded costs',['Source','Firm','Received earning','Assigned expenses','Net*','Pending'],report.firms.map(f=>[f.source,f.firm,cash(f.revenue),cash(f.expense),cash(f.net),cash(f.pending)]));
    note('* Firm net subtracts only expenses explicitly assigned to that firm. Hisab expenses do not store firm/person fields, so they are listed under Unassigned and included in overall Futures net. Do not treat unallocated firm net as final profitability. Case/spacing variants group together; different saved spellings remain separate.');
    table('Payouts by person and firm',['Source','Name / profile','Firm','Received count','Received earning','Pending'],report.recipients.map(r=>[r.source,r.name,r.firm,String(r.revenueCount),cash(r.revenue),cash(r.pending)]));
    for(const source of ['CFD','Futures']){
      doc.addPage();y=22;heading(source+' | transaction details');
      const rows=report.rows.filter(r=>r.source===source);
      table(source+' - expenses / money invested',['Date','Firm','Name','Account','Amount','Purpose / notes'],rows.filter(r=>r.kind==='expense').map(r=>[r.date,r.firm,r.name,r.account,cash(r.expense),r.note]));
      table(source+' - payouts',['Date','Firm','Name / profile','Gross','Split %','Fee','Net payout','Status'],rows.filter(r=>r.kind==='payout').map(r=>[r.date,r.firm,r.name,cash(r.gross),r.split==null?'-':String(r.split),cash(r.fee),cash(r.net),r.status]));
      table(source+' - payout references / notes',['Date','Firm','Name / profile','Account','Notes'],rows.filter(r=>r.kind==='payout'&&r.note!=='-').map(r=>[r.date,r.firm,r.name,r.account,r.note]));
    }
    note('Historical reports use the records currently saved for the selected month. Future months show only recorded entries, not forecasts. Refresh and download again after new entries or corrections. Totals use unrounded values; displayed rows can differ by a cent when summed.');
    const count=doc.internal.getNumberOfPages();for(let i=1;i<=count;i++){doc.setPage(i);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(110);doc.text('Prop Firm CRM | '+report.month+' | Private monthly report',M,H-10);doc.text(i+' / '+count,W-M,H-10,{align:'right'});}
    return doc;
  }
  root.MonthlyReport={build,daily,pdf,cash};
})(globalThis);

let monthlyReportData=null;
function clearMonthlyReport(){monthlyReportData=null;}
function downloadMonthlyReport(){
  if(HIDEBAL){alert('PDF download ke liye balances show karein.');return;}
  if(!monthlyReportData||CURRENT!=='futureprogress'||progressPeriod!=='month'||monthlyReportData.month!==progressAnchor.slice(0,7)){alert('Monthly report ready nahi hai. Refresh karein.');return;}
  try{if(!window.jspdf?.jsPDF)throw Error('PDF library unavailable. Refresh and retry.');MonthlyReport.pdf(monthlyReportData,window.jspdf.jsPDF).save('majid-ali-monthly-'+monthlyReportData.month+'.pdf');}catch(e){alert('PDF error: '+e.message);}
}
function renderMonthlyReport(report){
  monthlyReportData=report;if($('monthlyPdfTop'))$('monthlyPdfTop').disabled=!!HIDEBAL;
  const el=$('monthlyReport');if(!el)return;
  if(HIDEBAL){el.innerHTML='<div class="panel">Detailed monthly report: show balances to view or download.</div>';return;}
  const fmt=MonthlyReport.cash,htmlTable=(head,body)=>`<div style="overflow-x:auto"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.length?body.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${head.length}">No recorded entries in this month.</td></tr>`}</tbody></table></div>`;
  const t=report.total,max=Math.max(1,...report.sources.flatMap(s=>[s.revenue,s.expense]));
  el.innerHTML=`<div class="panel"><div class="toolbar" style="justify-content:space-between"><h3>Detailed monthly analysis · ${esc(report.month)}</h3><button class="btn" id="monthlyPdf" onclick="downloadMonthlyReport()">Download PDF</button></div><p class="page-sub">Full combined report: CFD + Futures, regardless of the source filter above. Download any past or selected month; future months show recorded entries only.</p>
  ${htmlTable(['Combined received earning','Total expenses / invested','Net after expenses','Pending / unpaid'],[[fmt(t.revenue),fmt(t.expense),fmt(t.net),fmt(t.pending)]])}
  <h3>Earning vs expenses · CFD and Futures</h3><div role="img" aria-label="Monthly earning and expense comparison">${report.sources.map(s=>`<div style="margin:18px 0"><b>${s.source}</b>${[['Received earning',s.revenue,'#16824e'],['Expenses',s.expense,'#c03f3f']].map(([name,value,color])=>`<div style="display:grid;grid-template-columns:110px minmax(20px,1fr) 110px;gap:8px;align-items:center;margin:8px 0;font-size:12px"><span>${name}</span><div style="height:16px;background:var(--border)"><div style="height:100%;width:${Math.max(0,value/max)*100}%;background:${color}"></div></div><strong style="text-align:right">${fmt(value)}</strong></div>`).join('')}<span class="page-sub">Net after expenses: ${fmt(s.net)} · Received payouts: ${s.revenueCount}</span></div>`).join('')}</div>
  <h3>Firm-wise earning</h3>${htmlTable(['Source','Firm','Received earning','Assigned expenses','Net before unassigned costs','Pending'],report.firms.map(f=>[f.source,f.firm,fmt(f.revenue),fmt(f.expense),fmt(f.net),fmt(f.pending)]))}
  <p class="page-sub">Hisab expenses have no saved firm/person field: they remain Unassigned and reduce overall Futures net. Different firm spellings remain separate. Dates are saved transaction dates.</p>
  <h3>Payouts by name / profile</h3>${htmlTable(['Source','Name / profile','Firm','Received payouts','Received earning','Pending'],report.recipients.map(r=>[r.source,r.name,r.firm,r.revenueCount,fmt(r.revenue),fmt(r.pending)]))}
  ${['CFD','Futures'].map(source=>`<details style="margin-top:20px" open><summary style="cursor:pointer;font-weight:700">${source} · expenses and payouts</summary><h4>Expenses / money invested</h4>${htmlTable(['Date','Firm','Name','Account','Amount','Purpose / notes'],report.rows.filter(r=>r.source===source&&r.kind==='expense').map(r=>[r.date,r.firm,r.name,r.account,fmt(r.expense),r.note]))}<h4>Payouts</h4>${htmlTable(['Date','Firm','Name / profile','Gross','Split %','Fee','Net payout','Status','Notes'],report.rows.filter(r=>r.source===source&&r.kind==='payout').map(r=>[r.date,r.firm,r.name,fmt(r.gross),r.split??'-',fmt(r.fee),fmt(r.net),r.status,r.note]))}</details>`).join('')}
  <p class="page-sub">Pending payouts are excluded from received earning. New entries appear after Refresh or the next automatic sync. PDF generated locally in your browser.</p></div>`;
}
