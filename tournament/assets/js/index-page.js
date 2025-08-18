// assets/js/index-page.js
import {
  AppState, connectSupabase, ping,
  listMatchesByStage, listKnockoutStructured, getTeamMap, labelOrName, setsToString,
  saveMatchScore, subscribeRealtime
} from './admin-app.js';

const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const toast = (msg)=>{ const bar=$('#snackbar'); const txt=$('#snackbarText'); if(!bar||!txt) return; txt.textContent=msg; bar.classList.remove('hidden'); setTimeout(()=>bar.classList.add('hidden'), 1600); }

let membersMap=new Map();
let lastFocusedInput=null;

/* ===== 앱 모드 ===== */
AppState.mode = 'prod';  // 기본값
async function fetchMode(){
  try{
    const { data } = await AppState.sb.from('app_settings').select('mode').single();
    AppState.mode = data?.mode || 'prod';
  }catch(e){ AppState.mode = 'prod'; }
  const b = document.getElementById('modeBadge');
  if (b) b.textContent = '모드: ' + (AppState.mode==='dev' ? '경기중' : '경기종료');
}

/* ========== 탭 전환 (경기|순위) ========== */
$$('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    $$('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const to = btn.dataset.tabto;
    ['games','standings'].forEach(n=>{
      $('#tab-'+n)?.classList.toggle('hidden', n!==to);
    });
  });
});

/* ========== 연결 ========== */
$('#btnConnect')?.addEventListener('click', async ()=>{
  try{
    const url = $('#spUrl').value.trim();
    const key = $('#spKey').value.trim();
    if (!url || !key) { toast('URL/KEY 입력'); return; }
    connectSupabase(url, key);
    await ping();
    $('#connStat').innerText = 'Supabase 연결 상태: OK';

    await Promise.all([loadMembers(), getTeamMap()]);
    await fullRefresh();
    subscribeRealtime(async ()=>{ await fullRefresh(); });
    toast('연결 완료');
  }catch(e){ console.error(e); toast('연결 실패: '+e.message); }
});
$('#btnRefresh')?.addEventListener('click', fullRefresh);

async function fullRefresh(){
  await Promise.all([
    renderAccordion(), renderBracket('#bracketGrid'),
    renderStandingsPage()
  ]);
}

/* ========== 멤버 ========== */
async function loadMembers(){
  const { data, error } = await AppState.sb.from('team_members').select('team_id, member_name');
  if (error) throw error;
  const m = new Map();
  for (const r of (data||[])){
    m.set(r.team_id, [...(m.get(r.team_id)||[]), r.member_name]);
  }
  membersMap = m;
}
function membersStr(teamId){
  const arr = membersMap.get(teamId) || [];
  return arr.length ? `(${arr.join(', ')})` : '(팀원 미등록)';
}

/* ========== 조별 아코디언(경기결과만) ========== */
async function renderAccordion(){
  const root = $('#accordionGroups'); if (!root) return;
  root.innerHTML = '';

  const list = await listMatchesByStage('group'); // includes groups(code)
  if (!list.length){ root.innerHTML = `<div class="hint">조별리그 매치가 없습니다.</div>`; return; }

  // 그룹별 묶기
  const byG = new Map();
  for (const m of list){
    const code = m.groups?.code || '-';
    byG.set(code, [...(byG.get(code)||[]), m]);
  }

  const codes = [...byG.keys()].sort((a,b)=>a.localeCompare(b));
  for (const code of codes){
    const items = (byG.get(code)||[]).sort((a,b)=>(a.round||0)-(b.round||0)||a.id-b.id);

    // 상태 요약
    const stat = { pending:0, playing:0, done:0 };
    for (const m of items) stat[m.status||'pending'] = (stat[m.status||'pending']||0)+1;

    const acc = document.createElement('details');
    acc.className = 'accordion-item border rounded-lg bg-white';
    acc.open = true;

    const sum = document.createElement('summary');
    sum.className = 'cursor-pointer list-none select-none px-3 py-2 flex items-center justify-between';
    sum.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-semibold">${code}조</span>
        <span class="badge">pending:${stat.pending||0}</span>
        <span class="badge">playing:${stat.playing||0}</span>
        <span class="badge">done:${stat.done||0}</span>
      </div>
      <svg class="acc-chevron w-4 h-4 text-slate-500 transition" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.08 1.04l-4.25 4.25a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z"/></svg>
    `;
    acc.appendChild(sum);

    // 컨텐츠 (아이패드 이상 2열)
    const cont = document.createElement('div');
    cont.className = 'grid md:grid-cols-2 gap-3 p-3 pt-0';
    for (const m of items){ cont.appendChild(makeScoreCard(m)); }
    acc.appendChild(cont);
    root.appendChild(acc);
  }
}

/* ========== 경기 카드 ========== */
function makeScoreCard(m){
  const aName = labelOrName(m, 'a');
  const bName = labelOrName(m, 'b');
  const aMembers = m.team_a_id ? membersStr(m.team_a_id) : '(팀원 미등록)';
  const bMembers = m.team_b_id ? membersStr(m.team_b_id) : '(팀원 미등록)';
  const sets = m.set_scores || [];
  const va = (sets[0]?.a ?? '');
  const vb = (sets[0]?.b ?? '');

  const card = document.createElement('div');
  card.className = 'card p-4 score-card flex flex-col hover:shadow-zen transition';
  card.dataset.matchId = m.id;
  card.dataset.points = (m.points_to_win ?? AppState.cfg.pointsToWin);
  card.dataset.cap    = (m.cap ?? AppState.cfg.cap);
  card.dataset.stage  = m.stage;

  // 상태별 미묘한 톤
  const st = (m.status || 'pending');
  if (st==='playing') card.classList.add('state-playing');
  else if (st==='done') card.classList.add('state-done');
  else card.classList.add('state-pending');

  const cap = parseInt(card.dataset.cap,10) || 25;
  const isDone = (m.status === 'done' || !!m.winner_id);
  const readOnly = isDone || (AppState.mode !== 'dev');  // dev 때만 편집 허용

  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-bold truncate">${aName} <span class="hint">vs</span> ${bName}</div>
        <div class="text-xs hint truncate">${aMembers} <span class="hint">vs</span> ${bMembers}</div>
      </div>
      <button class="btn btn-prim px-3 py-2 text-sm ripple" data-save ${readOnly?'disabled':''}>저장</button>
    </div>

    <div class="set-row relative border rounded-lg p-3 mt-3 bg-white">
      <div class="score-line">
        <span class="score-name text-sm font-medium text-slate-700 truncate">${aName}</span>
        <span class="hint">-</span>
        <input type="number" min="0" max="${cap}" step="1" inputmode="numeric"
               class="score-input border rounded-lg p-2 w-20 text-center text-lg font-semibold focus:outline-none focus:ring-1 focus:ring-accent-200 ${isDone?'bg-slate-50':''}"
               data-set="0" data-side="a" value="${va}" ${isDone?'disabled':''}>
        <span class="mx-1 font-semibold text-slate-700 text-lg text-center">:</span>
        <input type="number" min="0" max="${cap}" step="1" inputmode="numeric"
               class="score-input border rounded-lg p-2 w-20 text-center text-lg font-semibold focus:outline-none focus:ring-1 focus:ring-accent-200 ${isDone?'bg-slate-50':''}"
               data-set="0" data-side="b" value="${vb}" ${isDone?'disabled':''}>
        <span class="hint">-</span>
        <span class="score-name text-sm font-medium text-slate-700 truncate text-right">${bName}</span>
      </div>

      <div class="quick-pts hidden absolute left-2 top-full mt-1 z-10 bg-white border rounded-lg shadow p-1 flex gap-1">
        <button class="btn px-2 py-1 text-xs" data-quick-val="15" ${isDone?'disabled':''}>15</button>
        <button class="btn px-2 py-1 text-xs" data-quick-val="21" ${isDone?'disabled':''}>21</button>
        <button class="btn px-2 py-1 text-xs" data-quick-val="25" ${isDone?'disabled':''}>25</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2 mt-2">
      <span class="hint">빠른입력:</span>
      <button class="btn px-2 py-1 text-xs" data-win="a" ${readOnly?'disabled':''}>${aName} 승리</button>
      <button class="btn px-2 py-1 text-xs" data-win="b" ${readOnly?'disabled':''}>${bName} 승리</button>
      <span class="hint">(세트 입력칸을 누르면 15/21/25 팝오버)</span>
    </div>

    <div class="hint mt-1" data-msg>${
      isDone ? '이미 종료된 경기입니다. 변경이 필요하면 관리자에게 문의하세요.' : st
    }</div>
  `;
  return card;
}

/* 빠른입력/저장/포커스 팝오버 */
$('#accordionGroups')?.addEventListener('focusin', (e)=>{
  const input = e.target.closest('input[data-set]'); if (!input) return;
  lastFocusedInput = input;
  $$('#accordionGroups .quick-pts').forEach(el => el.classList.add('hidden'));
  input.closest('.set-row')?.querySelector('.quick-pts')?.classList.remove('hidden');
});
$('#accordionGroups')?.addEventListener('focusout', ()=>{
  setTimeout(()=>{
    if (!document.activeElement || !$('#accordionGroups')?.contains(document.activeElement)) {
      $$('#accordionGroups .quick-pts').forEach(el => el.classList.add('hidden'));
    }
  }, 100);
});
$('#accordionGroups')?.addEventListener('click', (e)=>{
  // ripple
  const rp = e.target.closest('.ripple');
  if (rp){
    const cir = document.createElement('span'); cir.className = 'ripple-circle';
    const r = Math.max(rp.clientWidth, rp.clientHeight);
    cir.style.width = cir.style.height = r + 'px';
    const rect = rp.getBoundingClientRect();
    cir.style.left = (e.clientX - rect.left - r/2) + 'px';
    cir.style.top  = (e.clientY - rect.top  - r/2) + 'px';
    rp.appendChild(cir); setTimeout(()=>cir.remove(), 400);
  }

  const card = e.target.closest('.score-card'); if (!card) return;
  const msgEl = card.querySelector('[data-msg]');

  const q = e.target.closest('[data-quick-val]');
  if (q && lastFocusedInput && card.contains(lastFocusedInput)) {
    const cap = parseInt(card.dataset.cap||'25',10);
    const val = Math.min(parseInt(q.dataset.quickVal,10), cap);
    lastFocusedInput.value = val;
    lastFocusedInput.dispatchEvent(new Event('input',{bubbles:true}));
    lastFocusedInput.focus(); return;
  }

  const wbtn = e.target.closest('[data-win]');
  if (wbtn && !wbtn.disabled){
    const side = wbtn.dataset.win;
    const pts  = Math.min(parseInt(card.dataset.points||'25',10), parseInt(card.dataset.cap||'25',10));
    const t = card.querySelector(`input[data-set="0"][data-side="${side}"]`);
    if (t){
      t.value = pts; t.dispatchEvent(new Event('input',{bubbles:true}));
      const other = side==='a'?'b':'a';
      const o = card.querySelector(`input[data-set="0"][data-side="${other}"]`);
      if (o){ o.focus(); o.select(); }
      msgEl.innerText = `세트 1: ${side.toUpperCase()}팀 ${pts}점 입력`;
    }
    return;
  }

  const saveBtn = e.target.closest('[data-save]');
  if (saveBtn && !saveBtn.disabled){
    saveOneCard(card).catch(err=>{ msgEl.innerText = '저장 실패: '+err.message; });
  }
});
$('#accordionGroups')?.addEventListener('input', (e)=>{
  const input = e.target.closest('input[data-set]'); if (!input) return;
  const card = e.target.closest('.score-card'); if (!card) return;
  const cap = parseInt(card.dataset.cap||'25',10);
  let v = parseInt(input.value || '0', 10);
  if (Number.isNaN(v)) v = 0; if (v < 0) v = 0; if (v > cap) v = cap;
  if (String(v) !== input.value) input.value = String(v);
});
async function saveOneCard(card){
  const matchId = card.dataset.matchId;
  const cap = parseInt(card.dataset.cap,10) || 25;
  const ai = card.querySelector('input[data-set="0"][data-side="a"]');
  const bi = card.querySelector('input[data-set="0"][data-side="b"]');
  const A = ai.value==='' ? null : Math.max(0, Math.min(cap, Number(ai.value)));
  const B = bi.value==='' ? null : Math.max(0, Math.min(cap, Number(bi.value)));
  const setArr = (typeof A==='number' && typeof B==='number') ? [{a:A,b:B}] : [];
  const msgEl = card.querySelector('[data-msg]');
  if (setArr.length===0){ msgEl.innerText = '입력된 점수가 없습니다.'; return; }
  const r = await saveMatchScore(matchId, setArr, 'normal');
  msgEl.innerText = r.winner ? '저장됨 · 승자 확정' : '저장됨';
  await fullRefresh();
}

/* ========== 브래킷 공용 렌더러 ========== */
async function renderBracket(mountSel){
  await getTeamMap();
  const grid = $(mountSel); if (!grid) return;
  const { qf, sf, fi } = await listKnockoutStructured();
  grid.innerHTML = '';

  const makeCol = (title, matches)=> {
    const col = document.createElement('div');
    col.className = 'bracket-col';
    const tt = document.createElement('div');
    tt.className = 'stage-title'; tt.textContent = title; col.appendChild(tt);

    if (!matches || matches.length===0) {
      const empty = document.createElement('div'); empty.className = 'hint'; empty.textContent = '없음';
      col.appendChild(empty); return col;
    }
    for (const m of matches) {
      const box = document.createElement('div');
      box.className = 'bracket-box hover:shadow-sm transition';
      const aName = labelOrName(m, 'a');
      const bName = labelOrName(m, 'b');
      const setsStr = setsToString(m.set_scores);
      const winnerA = m.winner_id && m.team_a_id && (m.winner_id === m.team_a_id);
      const winnerB = m.winner_id && m.team_b_id && (m.winner_id === m.team_b_id);
      const extra = (m.result_type && m.result_type!=='normal') ? ` · ${m.result_type.toUpperCase()}` : '';

      box.innerHTML = `
        <div class="hint mb-1">${m.stage.toUpperCase()} #${m.bracket_pos}</div>
        <div class="teamline"><span class="teamname ${m.team_a_id?'':'tbd'} ${winnerA?'winner':''}">${aName}</span></div>
        <div class="teamline"><span class="teamname ${m.team_b_id?'':'tbd'} ${winnerB?'winner':''}">${bName}</span></div>
        ${setsStr ? `<div class="hint mt-1">${setsStr}</div>` : ``}
        <div class="hint mt-1">${m.status || 'pending'}${extra}</div>`;
      col.appendChild(box);
    }
    return col;
  };

  grid.appendChild(makeCol('QF (8강)', qf));
  grid.appendChild(makeCol('SF (4강)', sf));
  grid.appendChild(makeCol('FINAL (결승)', fi));
}

/* ========== 순위 탭 ========== */
async function renderStandingsPage(){
  await renderBracket('#bracketGrid2');

  // 그룹/팀
  const { data: gt } = await AppState.sb
    .from('group_teams')
    .select('group_id, team_id, groups(code)');
  const teamMap = AppState.teamMap || new Map();
  const byG = new Map();
  for (const r of (gt||[])){
    const code = r.groups?.code || '-';
    byG.set(code, [...(byG.get(code)||[]), { team_id:r.team_id, name: teamMap.get(r.team_id)||'-' }]);
  }

  // 조별 매치
  const matches = await listMatchesByStage('group');

  // 스탯
  const statsByG = computeStandings(byG, matches);

  // 테이블
  const tableRoot = $('#tablesByGroup'); if (tableRoot) tableRoot.innerHTML='';
  for (const [code, rows] of statsByG){
    const card = document.createElement('div'); card.className='border rounded-lg bg-white';
    const head = document.createElement('div'); head.className='px-3 py-2 font-semibold'; head.textContent=`${code}조`;
    const tbl = document.createElement('table');
    tbl.className = 'w-full text-sm';
    tbl.innerHTML = `
      <thead><tr class="border-t">
        <th class="text-left p-2">팀</th><th class="p-2">경기</th><th class="p-2">승</th><th class="p-2">패</th><th class="p-2">득</th><th class="p-2">실</th><th class="p-2">득실</th>
      </tr></thead><tbody></tbody>`;
    const tb = tbl.querySelector('tbody');
    rows.forEach(r=>{
      const tr = document.createElement('tr'); tr.className='border-t';
      const mem = membersStr(r.team_id);
      tr.innerHTML = `<td class="p-2">
          <div class="flex flex-col">
            <span>${r.name}</span>
            <span class="hint text-xs">${mem}</span>
          </div>
        </td>
        <td class="text-center p-2">${r.gp}</td>
        <td class="text-center p-2">${r.w}</td>
        <td class="text-center p-2">${r.l}</td>
        <td class="text-center p-2">${r.pf}</td>
        <td class="text-center p-2">${r.pa}</td>
        <td class="text-center p-2">${r.diff}</td>`;
      tr.innerHTML = `<td class="p-2">${r.name}</td>
                      <td class="text-center p-2">${r.gp}</td><td class="text-center p-2">${r.w}</td><td class="text-center p-2">${r.l}</td>
                      <td class="text-center p-2">${r.pf}</td><td class="text-center p-2">${r.pa}</td><td class="text-center p-2">${r.diff}</td>`;
      tb.appendChild(tr);
    });
    card.appendChild(head); card.appendChild(tbl);
    tableRoot.appendChild(card);
  }

  // 조별 결과 모음
  const resRoot = $('#groupResultsAll'); if (resRoot) resRoot.innerHTML='';
  const byGm = new Map();
  for (const m of matches){
    const code = m.groups?.code || '-';
    byGm.set(code, [...(byGm.get(code)||[]), m]);
  }
  for (const code of [...byGm.keys()].sort()){
    const items = byGm.get(code)||[];
    const box = document.createElement('div'); box.className='border rounded-lg p-3 bg-white';
    const head = document.createElement('div'); head.className='font-semibold mb-2'; head.textContent=`${code}조 경기결과`;
    box.appendChild(head);
    items.sort((a,b)=>(a.round||0)-(b.round||0)||a.id-b.id);
    for (const m of items){
      const a = labelOrName(m,'a'); const b = labelOrName(m,'b');
      const aMem = membersStr(m.team_a_id); const bMem = membersStr(m.team_b_id);      
      const s = (m.set_scores||[])[0]||{};
      const line = document.createElement('div'); line.className='flex justify-between text-sm border-t py-1';
      line.innerHTML = `<div class="truncate">
        ${a} <span class="hint">${aMem}</span>
        <span class="hint">vs</span>
        ${b} <span class="hint">${bMem}</span>
      </div>
      <div class="font-semibold">${Number.isFinite(s.a)?s.a:'-'} : ${Number.isFinite(s.b)?s.b:'-'}</div>`;
      box.appendChild(line);
    }
    resRoot.appendChild(box);
  }
}

function computeStandings(byG, matches){
  const out = new Map();
  const mByG = new Map();
  for (const m of matches){
    const code = m.groups?.code || '-';
    mByG.set(code, [...(mByG.get(code)||[]), m]);
  }
  for (const [code, teams] of byG){
    const rows = new Map();
    for (const t of teams){
      rows.set(t.team_id, { team_id:t.team_id, name:t.name, gp:0, w:0, l:0, pf:0, pa:0, diff:0 });
    }
    for (const m of (mByG.get(code)||[])){
      const s = (m.set_scores||[])[0]; if (!s || !Number.isFinite(s.a) || !Number.isFinite(s.b)) continue;
      const A = rows.get(m.team_a_id) || rows.set(m.team_a_id,{ team_id:m.team_a_id, name: AppState.teamMap.get(m.team_a_id)||'-', gp:0,w:0,l:0,pf:0,pa:0,diff:0 }).get(m.team_a_id);
      const B = rows.get(m.team_b_id) || rows.set(m.team_b_id,{ team_id:m.team_b_id, name: AppState.teamMap.get(m.team_b_id)||'-', gp:0,w:0,l:0,pf:0,pa:0,diff:0 }).get(m.team_b_id);
      A.gp++; B.gp++; A.pf+=s.a; A.pa+=s.b; B.pf+=s.b; B.pa+=s.a;
      if (s.a>s.b){ A.w++; B.l++; } else if (s.b>s.a){ B.w++; A.l++; }
    }
    const arr = [...rows.values()].map(r=>({...r, diff:r.pf-r.pa}))
      .sort((x,y)=> (y.w-x.w) || ((y.diff)-(x.diff)) || x.name.localeCompare(y.name));
    out.set(code, arr);
  }
  return out;
}

/* ===== 자동 연결 (메타 태그) ===== */
async function autoConnectFromMeta(){
  const url = document.querySelector('meta[name="supabase-url"]')?.content?.trim();
  const key = document.querySelector('meta[name="supabase-key"]')?.content?.trim();
  if (!url || !key) { console.error('Supabase 메타 누락'); return; }
  connectSupabase(url, key);
  await ping();
  await Promise.all([loadMembers(), getTeamMap()]);
  await fetchMode();
  await fullRefresh();
  toast('연결 완료');

  // 모드 변경 실시간 반영
  AppState.sb
    .channel('realtime:app_settings')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, async () => {
      await fetchMode(); await fullRefresh();
    })
    .subscribe();
}
document.addEventListener('DOMContentLoaded', autoConnectFromMeta);
