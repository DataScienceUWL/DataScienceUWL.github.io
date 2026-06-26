
let BUNDLE=null, OV=JSON.parse(localStorage.getItem('mom_ov')||'{}');
const PRIORITY={answer:1,render:1};
const COLORS={render:'#e5484d',answer:'#e5484d','figure-todo':'#e0a800',visual:'#8e4ec6',fidelity:'#3a7bd5',context:'#777',note:'#777'};
const app=document.getElementById('app');
const k=(pid,line)=>pid+':'+line;
function saveOV(){localStorage.setItem('mom_ov',JSON.stringify(OV));}
function resolved(pid,it){const o=OV[k(pid,it.line)];return o&&'resolved'in o?o.resolved:it.resolved;}
function noteOf(pid,line){const o=OV[k(pid,line)];return o&&o.note||'';}
function probMap(){const m={};BUNDLE.problems.forEach(p=>m[p.pid]=p);return m;}
function openItems(p){return p.items.filter(it=>!resolved(p.pid,it));}
function seq(){return BUNDLE.problems.filter(p=>openItems(p).length>0);}
function typeset(){if(window.MathJax&&MathJax.typesetPromise)MathJax.typesetPromise();}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

async function boot(){
  try{const r=await fetch('./data/bundle.json');BUNDLE=await r.json();}
  catch(e){app.innerHTML='<p class=muted>Could not load data. Connect once, then it works offline.</p>';return;}
  window.addEventListener('hashchange',route);route();
}

function route(){
  const h=location.hash.slice(2);
  if(h.startsWith('p/'))return viewProblem(h.slice(2));
  if(h.startsWith('ch/'))return viewChapter(+h.slice(3));
  if(h==='priority')return viewPriority();
  return viewHome();
}

function viewHome(){
  const rows={};
  seq().forEach(p=>{const n=openItems(p).length;const pr=openItems(p).filter(it=>PRIORITY[it.tag]).length;
    rows[p.ch]=rows[p.ch]||{problems:0,items:0,priority:0};rows[p.ch].problems++;rows[p.ch].items+=n;rows[p.ch].priority+=pr;});
  const chs=Object.keys(rows).map(Number).sort((a,b)=>a-b);
  const total=chs.reduce((s,c)=>s+rows[c].items,0),prio=chs.reduce((s,c)=>s+rows[c].priority,0);
  let html=`<div class=bar><button class=go onclick="dl(this)">⬇ Download all for offline</button></div>`
    +`<div class=crumb>${total} open items · <b style="color:#e5484d">${prio} priority</b> · snapshot ${BUNDLE.generated.slice(0,10)}</div>`;
  if(!chs.length)html+='<p class=muted>🎉 Nothing left to review.</p>';
  chs.forEach(c=>{const r=rows[c];html+=`<a href="#/ch/${c}"><div class=row><div class=grow>
    <div class=big>Chapter ${c}</div><div class=sub>${r.problems} problems${r.priority?` · <span style="color:#e5484d">${r.priority} priority</span>`:''}</div></div>
    <span class=count>${r.items}</span></div></a>`;});
  app.innerHTML=html;
}

function viewChapter(ch){
  let html=`<div class=crumb><a href="#/">Home</a> › Chapter ${ch}</div>`;
  const ps=seq().filter(p=>p.ch===ch);
  if(!ps.length)html+='<p class=muted>No open items here.</p>';
  ps.forEach(p=>{const tags=[...new Set(openItems(p).map(it=>it.tag))].sort((a,b)=>(PRIORITY[b]||0)-(PRIORITY[a]||0));
    const pills=tags.map(t=>`<span class=pill style="background:${COLORS[t]||'#777'}">${t}</span>`).join(' ');
    html+=`<a href="#/p/${p.pid}"><div class=row><div class=grow><div class=big>Problem ${ch}.${p.num}</div>
      <div class=sub>${pills}</div></div><span class=count>${openItems(p).length}</span></div></a>`;});
  app.innerHTML=html;
}

function viewPriority(){
  let rows='',n=0;
  seq().forEach(p=>openItems(p).filter(it=>PRIORITY[it.tag]).forEach(it=>{n++;
    rows+=`<a href="#/p/${p.pid}"><div class=row><div class=grow>
      <div class=big>${p.ch}.${p.num} <span class=pill style="background:${COLORS[it.tag]}">${it.tag}</span></div>
      <div class=sub>${esc(it.body).slice(0,90)}</div></div><span class=count>›</span></div></a>`;}));
  app.innerHTML=`<div class=crumb><a href="#/">Home</a> › Priority — ${n} items</div>`
    +(n?rows:'<p class=muted>🎉 No priority items left.</p>');
}

function viewProblem(pid){
  const M=probMap(),p=M[pid];if(!p){app.innerHTML='<p class=muted>Not found.</p>';return;}
  const S=seq(),i=S.findIndex(x=>x.pid===pid);
  const prv=i>0?S[i-1].pid:(S.filter(x=>x.ch*100+x.num<p.ch*100+p.num).pop()||{}).pid;
  const nx=i>=0?(i+1<S.length?S[i+1].pid:null):(S.find(x=>x.ch*100+x.num>p.ch*100+p.num)||{}).pid;
  const pos=i>=0?`${i+1} / ${S.length}`:`${S.length} left`;
  let html=`<div class=nav>${prv?`<a href="#/p/${prv}">‹ Prev</a>`:'<span class=dis>‹ Prev</span>'}
    <span class=pos>${pos}</span>${nx?`<a href="#/p/${nx}">Next ›</a>`:'<span class=dis>Next ›</span>'}</div>
    <div class=crumb><a href="#/">Home</a> › <a href="#/ch/${p.ch}">Ch ${p.ch}</a> › ${pid}</div>
    <div class=tabs><button class=on onclick="tab(0)">Rendered</button><button onclick="tab(1)">Original</button></div>
    <div class="pane on">${p.shot?`<a href="./${p.shot}" target=_blank><img class=shot src="./${p.shot}"></a>`:'<div class=muted>No screenshot.</div>'}</div>
    <div class=pane><div class=orig>${p.original}</div></div>`;
  p.items.forEach(it=>{const done=resolved(pid,it);
    html+=`<div class="item${done?' done':''}" id="it${it.line}">
      <div class=hd><span class=pill style="background:${COLORS[it.tag]||'#777'}">${it.tag}</span></div>
      <div class=body>${esc(it.body)}</div>${it.sug?`<div class=sug><b>Suggested change:</b> ${esc(it.sug)}</div>`:''}
      <textarea class=note placeholder="Add a note (dictate here)…" oninput="setNote('${pid}',${it.line},this.value)">${esc(noteOf(pid,it.line))}</textarea>
      <div class="toggle${done?' on':''}" onclick="toggle('${pid}',${it.line},this)">${done?'✓ Resolved — tap to undo':'Resolve'}</div></div>`;});
  app.innerHTML=html;typeset();
}

function tab(n){document.querySelectorAll('.tabs button').forEach((b,i)=>b.classList.toggle('on',i==n));
  document.querySelectorAll('.pane').forEach((p,i)=>p.classList.toggle('on',i==n));typeset();}
function setNote(pid,line,v){const key=k(pid,line);OV[key]=OV[key]||{};if(v.trim())OV[key].note=v;else delete OV[key].note;
  if(!OV[key].note&&!('resolved'in OV[key]))delete OV[key];saveOV();}
function toggle(pid,line,el){const key=k(pid,line);OV[key]=OV[key]||{};
  const cur=el.classList.contains('on');OV[key].resolved=!cur;saveOV();
  el.classList.toggle('on');el.closest('.item').classList.toggle('done');
  el.textContent=el.classList.contains('on')?'✓ Resolved — tap to undo':'Resolve';}

function exportNotes(){
  const out={exported:new Date().toISOString(),snapshot:BUNDLE.generated,changes:OV};
  const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='mom-review-export.json';document.body.appendChild(a);a.click();a.remove();}

async function dl(btn){
  const urls=['./data/bundle.json',...BUNDLE.problems.filter(p=>p.shot).map(p=>'./'+p.shot)];
  const cache=await caches.open('mom-data-v1');let done=0;
  for(const u of urls){try{await cache.add(u);}catch(e){}done++;if(done%10===0||done===urls.length)btn.textContent=`Downloading ${done}/${urls.length}…`;}
  btn.textContent='✓ Offline ready';btn.classList.remove('go');}

if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'});
boot();
