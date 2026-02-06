// assets/js/pinball-page.js  (DB 연동 + 로컬 폴백 완성본)
import { AppState, connectSupabase, ping } from './admin-app.js';

/* ========== 유틸 ========== */
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const nowStr=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};
const LS={ save:(k,v)=>localStorage.setItem(k,JSON.stringify(v)), load:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}}};
const LS_KEYS={ names:'maru-pinball:names', prizes:'maru-pinball:prizes', logs:'maru-pinball:logs' };

/* ========== 앱 모드 감지 ========== */
const MODE={ get isDB(){ return !!AppState.sb; } };
async function autoConnect(){
  try{
    const url=document.querySelector('meta[name="supabase-url"]')?.content?.trim();
    const key=document.querySelector('meta[name="supabase-key"]')?.content?.trim();
    if(!url||!key) throw 0;
    connectSupabase(url,key); await ping();
    $('#modeBadge').textContent='모드: 운영(DB)';
  }catch{ $('#modeBadge').textContent='모드: 로컬'; }
}
document.addEventListener('DOMContentLoaded', autoConnect);

/* ========== 상태 ========== */
let Names=[];             // 문자열 배열
let Prizes=[];            // [{id?, name, left}]
let Logs=[];              // 로컬 UI 표시용 [{ts,name,prize}]
let Winner=null;
let AssignedPrize=null;

/* ========== DB 액세스 ========== */
function sb(){ return AppState.sb; }
async function dbSafe(fn){ try{ return await fn(); }catch(e){ console.warn(e); return { data:null, error:e }; } }

/* prizes */
async function dbLoadPrizes(){
  const { data, error } = await dbSafe(()=>sb().from('prizes').select('id,name,qty_left').order('created_at'));
  if(error) throw error;
  Prizes = (data||[]).map(r=>({ id:r.id, name:r.name, left:r.qty_left }));
}
async function dbAddPrize(name,qty){
  const { error } = await dbSafe(()=>sb().from('prizes').insert([{ name, qty_total:qty, qty_left:qty }]).select().single());
  if(error) throw error;
  await dbLoadPrizes();
}
async function dbDeletePrize(id){
  const { error } = await dbSafe(()=>sb().from('prizes').delete().eq('id',id));
  if(error) throw error;
  await dbLoadPrizes();
}
async function dbDecPrize(id){
  const { data, error } = await dbSafe(()=>sb().from('prizes').select('qty_left').eq('id',id).single());
  if(error) throw error;
  const left = Math.max(0,(data?.qty_left??0)-1);
  const { error:err2 } = await dbSafe(()=>sb().from('prizes').update({ qty_left:left }).eq('id',id));
  if(err2) throw err2;
  await dbLoadPrizes();
}

/* draw_logs */
async function dbInsertLog({ ts, name, prize, seed, preset, team_id=null, prize_id=null }){
  const row={ created_at:new Date(ts.replace(' ','T')+':00+09:00'), winner_name:name, prize_name:prize||null, seed:seed||null, preset:preset||null, team_id, prize_id };
  const { error } = await dbSafe(()=>sb().from('draw_logs').insert([row]));
  if(error) throw error;
}

/* 팀/맴버 매칭(선택) */
async function dbFindTeamIdByName(winnerName){
  // 1) 팀명으로 매칭
  let { data } = await dbSafe(()=>sb().from('teams').select('id').eq('name',winnerName).maybeSingle());
  if(data?.id) return data.id;
  // 2) 팀원명으로 매칭 → 팀 소속 리턴
  ({ data } = await dbSafe(()=>sb().from('team_members').select('team_id').eq('member_name',winnerName).maybeSingle()));
  return data?.team_id ?? null;
}

/* ========== 참가자/상품/로그 UI ========== */
function refreshNameBox(){ $('#taNames').value = Names.join('\n'); }
function renderPrizes(){
  const tb=$('#prizeTbody'); tb.innerHTML='';
  Prizes.forEach((p,i)=>{
    const tr=document.createElement('tr'); tr.className='border-t';
    tr.innerHTML=`
      <td class="p-2">${p.name}</td>
      <td class="p-2 text-center">${p.left}</td>
      <td class="p-2 text-center"><button class="btn px-3 py-1 text-xs" data-assign="${i}">배정</button></td>
      <td class="p-2 text-right"><button class="btn px-3 py-1 text-xs" data-del="${i}">삭제</button></td>`;
    tb.appendChild(tr);
  });
}
function renderLogs(){
  const tb=$('#logTbody'); tb.innerHTML='';
  Logs.forEach(l=>{
    const tr=document.createElement('tr'); tr.className='border-t';
    tr.innerHTML=`<td class="p-2">${l.ts}</td><td class="p-2">${l.name}</td><td class="p-2">${l.prize??'-'}</td>`;
    tb.appendChild(tr);
  });
}
function nextPrize(){ return Prizes.find(p=>p.left>0)||null; }
function decPrizeLocal(p){ if(!p) return; const idx=Prizes.indexOf(p); if(idx>=0&&Prizes[idx].left>0) Prizes[idx].left--; }

/* ========== 부팅 ========== */
async function boot(){
  // 이름
  Names = LS.load(LS_KEYS.names, []);
  refreshNameBox();
  // 상품
  if(MODE.isDB){
    try{ await dbLoadPrizes(); }catch{ Prizes = LS.load(LS_KEYS.prizes, []); }
  }else{
    Prizes = LS.load(LS_KEYS.prizes, []);
  }
  renderPrizes();
  // 로그(로컬 UI전용)
  Logs = LS.load(LS_KEYS.logs, []);
  renderLogs();
}
boot();

/* ========== 참가자 불러오기(Supabase) ========== */
async function loadTeamNames(){
  if(!MODE.isDB) return alert('Supabase 연결이 필요합니다.');
  const { data, error } = await dbSafe(()=>sb().from('teams').select('name').order('name'));
  if(error) return alert(error.message);
  Names = (data||[]).map(x=>x.name); LS.save(LS_KEYS.names, Names); refreshNameBox();
}
async function loadMemberNames(){
  if(!MODE.isDB) return alert('Supabase 연결이 필요합니다.');
  const { data, error } = await dbSafe(()=>sb().from('team_members').select('member_name').order('member_name'));
  if(error) return alert(error.message);
  Names = (data||[]).map(x=>x.member_name); LS.save(LS_KEYS.names, Names); refreshNameBox();
}

/* ========== 상품 UI 바인딩 ========== */
$('#btnAddPrize')?.addEventListener('click', async ()=>{
  const name=$('#prizeName').value.trim();
  const qty=Math.max(1,parseInt($('#prizeQty').value||'1',10));
  if(!name) return;
  if(MODE.isDB){
    try{ await dbAddPrize(name,qty); renderPrizes(); }catch(e){ alert('상품 추가 실패: '+(e?.message||e)); }
  }else{
    Prizes.push({ name, left:qty }); LS.save(LS_KEYS.prizes, Prizes); renderPrizes();
  }
  $('#prizeName').value=''; $('#prizeQty').value='';
});
$('#prizeTbody')?.addEventListener('click', async (e)=>{
  const del=e.target.closest('[data-del]');
  const assign=e.target.closest('[data-assign]');
  if(del){
    const i=parseInt(del.dataset.del,10);
    if(MODE.isDB){
      const id=Prizes[i].id;
      try{ await dbDeletePrize(id); }catch(err){ return alert('삭제 실패: '+(err?.message||err)); }
    }else{
      Prizes.splice(i,1); LS.save(LS_KEYS.prizes, Prizes);
    }
    renderPrizes(); return;
  }
  if(assign){
    if(!Winner) return alert('아직 우승자 없습니다.');
    const i=parseInt(assign.dataset.assign,10);
    if(Prizes[i].left<=0) return alert('수량이 없습니다.');
    if(MODE.isDB){
      try{ await dbDecPrize(Prizes[i].id); await dbLoadPrizes(); renderPrizes(); }catch(err){ return alert('배정 실패: '+(err?.message||err)); }
      $('#winnerPrize').textContent=`상품: ${Prizes[i].name}`; AssignedPrize=Prizes[i].name;
    }else{
      decPrizeLocal(Prizes[i]); LS.save(LS_KEYS.prizes, Prizes); renderPrizes();
      $('#winnerPrize').textContent=`상품: ${Prizes[i].name}`; AssignedPrize=Prizes[i].name;
    }
  }
});
$('#btnClearPrizes')?.addEventListener('click', ()=>{
  if(!confirm('상품 목록을 모두 지울까요?')) return;
  if(MODE.isDB){ alert('DB 모드에서는 일괄 삭제 기능을 제공하지 않습니다.\n개별 삭제를 이용해주세요.'); return; }
  Prizes=[]; LS.save(LS_KEYS.prizes, Prizes); renderPrizes();
});

/* ========== 참가자 입력/샘플 ========= */
$('#btnSampleNames')?.addEventListener('click', ()=>{
  const sample=['김민준','이서아','박서진','최정건','정유나','오해솔','한지후','변희수','김지안','유다현','강도윤','서수아'];
  Names=sample; refreshNameBox(); LS.save(LS_KEYS.names, Names);
});
$('#btnLoadTeams')?.addEventListener('click', loadTeamNames);
$('#btnLoadMembers')?.addEventListener('click', loadMemberNames);
$('#taNames')?.addEventListener('input', ()=>{
  Names=$('#taNames').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  LS.save(LS_KEYS.names, Names);
});

/* ========== 로그(로컬) ========= */
$('#btnExportLog')?.addEventListener('click', ()=>{
  const blob=new Blob([JSON.stringify(Logs,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download='pinball-draw-logs.json'; a.click(); URL.revokeObjectURL(url);
});
$('#btnClearLog')?.addEventListener('click', ()=>{
  if(!confirm('로컬 로그를 모두 지울까요?')) return;
  Logs=[]; LS.save(LS_KEYS.logs, Logs); renderLogs();
});

/* ========== RNG/물리/게임 ========== */
const cv=$('#pinballCanvas'), ctx=cv.getContext('2d');
const W=()=>cv.width, H=()=>cv.height;
let RNG=Math.random, RAF=null, running=false, Balls=[], Pegs=[];
function seedRng(str=''){ if(!str){RNG=Math.random;return;} let h=2166136261>>>0; for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619)} RNG=()=>{h+=0x6D2B79F5;let t=Math.imul(h^h>>>15,1|h);t^=t+Math.imul(t^t>>>7,61|t);return((t^t>>>14)>>>0)/4294967296}; }

class Ball{
  constructor(name,x,y){ this.name=name; this.x=x; this.y=y; const a=RNG()*Math.PI*2,s=1.5+RNG()*0.6; this.vx=Math.cos(a)*s; this.vy=Math.sin(a)*s; this.r=10; this.color=pickColor(name); this.finished=false; this.finishTime=null; }
  step(g){ this.vy+=g; this.x+=this.vx; this.y+=this.vy;
    if(this.x<this.r){this.x=this.r; this.vx*=-0.96}
    if(this.x>W()-this.r){this.x=W()-this.r; this.vx*=-0.96}
    if(this.y<this.r){this.y=this.r; this.vy*=-0.96}
    if(!this.finished && this.y>=H()-64-this.r){ this.finished=true; this.finishTime=performance.now(); }
  }
  draw(){ ctx.beginPath(); ctx.arc(this.x,this.y,this.r,0,Math.PI*2); ctx.fillStyle=this.color; ctx.fill(); ctx.strokeStyle='rgba(15,23,42,.15)'; ctx.stroke();
    ctx.fillStyle='#111827'; ctx.font='bold 10px ui-sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    const label=this.name.length>2?this.name.slice(0,2):this.name; ctx.fillText(label,this.x,this.y);
  }
}
class Peg{ constructor(x,y,r=4,rest=1.0){this.x=x;this.y=y;this.r=r;this.rest=rest;}
  collide(b){ const dx=b.x-this.x, dy=b.y-this.y; const d2=dx*dx+dy*dy, rr=(b.r+this.r)**2; if(d2<rr){ const d=Math.sqrt(d2)||.0001, nx=dx/d, ny=dy/d; const overlap=(b.r+this.r)-d; b.x+=nx*overlap; b.y+=ny*overlap; const vn=b.vx*nx+b.vy*ny; b.vx-=(1+this.rest)*vn*nx; b.vy-=(1+this.rest)*vn*ny; } } }
function pickColor(key){const C=['#fecaca','#fcd34d','#86efac','#93c5fd','#a5b4fc','#f0abfc','#fda4af','#fdba74','#bef264','#7dd3fc','#c4b5fd','#f5d0fe']; let h=0; for(let i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))>>>0; return C[h%C.length];}

const pegLayer=$('#pegLayer'); pegLayer.style.position='absolute'; pegLayer.style.inset='0';
function clearPegLayer(){ Pegs=[]; pegLayer.innerHTML=''; }
function addPegVisual(x,y){ const d=document.createElement('div'); d.className='peg'; d.style.left=x+'px'; d.style.top=y+'px'; pegLayer.appendChild(d); }

function presetClassic(){ clearPegLayer(); const gapX=48,gapY=44,offset=24; for(let row=0,y=80;y<=H()-140;row++,y+=gapY){ const start=(row%2?offset:offset*2); for(let x=start;x<=W()-start;x+=gapX){ Pegs.push(new Peg(x,y,4,1.0)); addPegVisual(x,y); } } }
function presetChaos(){ clearPegLayer(); for(let i=0;i<90;i++){ const x=40+RNG()*(W()-80), y=80+RNG()*(H()-180), r=RNG()<0.15?10:4, rest=r>6?1.15:1.0; Pegs.push(new Peg(x,y,r,rest)); addPegVisual(x,y);} }
function presetSparse(){ clearPegLayer(); for(let i=0;i<50;i++){ const x=40+RNG()*(W()-80), y=100+RNG()*(H()-220); Pegs.push(new Peg(x,y,4,1.0)); addPegVisual(x,y);} }

function resetBoard(){
  running=false; Winner=null; AssignedPrize=null; $('#winnerOverlay').style.display='none';
  $('#winnerName').textContent='-'; $('#winnerPrize').textContent=''; $('#statusLine').textContent='대기중';
  Balls=[]; cancelAnimationFrame(RAF);
  const seed=$('#inpSeed').value.trim(); seedRng(seed);
  const pv=$('#selPreset').value; if(pv==='classic')presetClassic(); else if(pv==='chaos')presetChaos(); else presetSparse();
  drawFrame();
}

/* 루프 */
function loop(){
  RAF=requestAnimationFrame(loop);
  const g=parseFloat($('#inpGravity').value||'0.28'); // 마찰은 Peg 충돌에서 처리
  for(const b of Balls){ if(!b.finished){ b.step(g); for(const peg of Pegs) peg.collide(b); } }
  drawFrame(); checkFinish();
}
function drawFrame(){
  ctx.clearRect(0,0,W(),H());
  ctx.strokeStyle='rgba(15,23,42,.08)'; ctx.strokeRect(0.5,0.5,W()-1,H()-65.5);
  for(const b of Balls) b.draw();
  ctx.fillStyle='#e2e8f0'; ctx.fillRect(0,H()-64,W(),64);
}
function checkFinish(){
  if(Winner) return;
  const fin=Balls.filter(b=>b.finished).sort((a,b)=>a.finishTime-b.finishTime)[0];
  if(fin){
    running=false; Winner=fin.name; $('#winnerName').textContent=fin.name;
    if($('#autoAssign').checked){
      const p=nextPrize();
      if(p){
        if(MODE.isDB){ dbDecPrize(p.id).then(()=>dbLoadPrizes().then(renderPrizes)).catch(()=>{}); }
        else{ decPrizeLocal(p); LS.save(LS_KEYS.prizes, Prizes); renderPrizes(); }
        AssignedPrize=p.name; $('#winnerPrize').textContent=`상품: ${p.name}`;
      }else $('#winnerPrize').textContent='(남은 상품 없음)';
    }
    $('#winnerOverlay').style.display='flex'; confettiBurst();
  }
}

/* 시작/일시정지/초기화 */
$('#btnReset')?.addEventListener('click', resetBoard);
$('#btnPause')?.addEventListener('click', ()=>{ running=!running; if(running) loop(); else $('#statusLine').textContent='일시정지'; });
$('#btnStart')?.addEventListener('click', ()=>{
  Names=$('#taNames').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(Names.length<2) return alert('참가자가 2명 이상 필요합니다.');
  let chosen=[...Names]; const MAX=120;
  if(chosen.length>MAX){ const picked=new Set(); while(picked.size<MAX) picked.add(Math.floor(RNG()*chosen.length)); chosen=[...picked].map(i=>Names[i]); $('#statusLine').textContent=`참가자 ${Names.length}명 중 랜덤 ${MAX}명 경주`; }
  else $('#statusLine').textContent=`참가자 ${chosen.length}명 경주`;
  Balls=[]; const margin=28; for(let i=0;i<chosen.length;i++){ const x=margin+(i/(chosen.length-1||1))*(W()-margin*2); Balls.push(new Ball(chosen[i],x,24)); }
  running=true; loop();
});

/* 우승 확정/재경주 → DB Insert + 로컬UI 로그 */
$('#btnConfirmWin')?.addEventListener('click', async ()=>{
  if(!Winner) return;
  const item={ ts:nowStr(), name:Winner, prize:AssignedPrize||null };
  // 1) 로컬 표시 로그
  Logs.unshift(item); LS.save(LS_KEYS.logs, Logs); renderLogs();
  // 2) DB 저장(가능하면)
  if(MODE.isDB){
    try{
      const seed=$('#inpSeed').value.trim()||null; const preset=$('#selPreset').value;
      const team_id = await dbFindTeamIdByName(Winner);
      let prize_id=null;
      if(AssignedPrize){
        const p=Prizes.find(x=>x.name===AssignedPrize); if(p?.id) prize_id=p.id;
      }
      await dbInsertLog({ ts:item.ts, name:Winner, prize:AssignedPrize, seed, preset, team_id, prize_id });
    }catch(e){ console.warn(e); alert('DB 저장 실패(로컬 로그는 유지): '+(e?.message||e)); }
  }
  $('#winnerOverlay').style.display='none';
});
$('#btnReplay')?.addEventListener('click', ()=>{ $('#winnerOverlay').style.display='none'; resetBoard(); $('#btnStart').click(); });

/* 컨페티 */
function confettiBurst(){
  const wrap=$('#boardWrap');
  for(let i=0;i<120;i++){
    const d=document.createElement('div'); d.className='confetti'; d.style.left=(W()/2)+'px'; d.style.top=(H()/2-80)+'px';
    d.style.background=['#fde68a','#86efac','#93c5fd','#fda4af','#a5b4fc','#f0abfc'][i%6]; wrap.appendChild(d);
    const ang=RNG()*Math.PI*2, sp=2+RNG()*5, life=800+RNG()*700, vx=Math.cos(ang)*sp, vy=Math.sin(ang)*sp, start=performance.now();
    (function tick(){ const t=performance.now()-start; d.style.transform=`translate(${vx*t/4}px, ${vy*t/4+0.001*t*t/2}px) rotate(${t/3}deg)`; d.style.opacity=String(1-t/life); if(t<life) requestAnimationFrame(tick); else d.remove(); })();
  }
}

/* 반응형 캔버스 */
function fitCanvas(){ const r=cv.getBoundingClientRect(); cv.width=Math.max(720,Math.floor(r.width*devicePixelRatio)); cv.height=Math.floor(520*devicePixelRatio); }
new ResizeObserver(()=>{ fitCanvas(); resetBoard(); }).observe($('#boardWrap'));
fitCanvas();

/* 스타일 요소(HTML에 있는 클래스 재사용) */
