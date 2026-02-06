// assets/js/admin-page.js (patched: hover-to-join DnD + Korean status labels)
import {
  AppState, connectSupabase, ping,
  parseExcelTextarea, upsertTeams, loadTeams,
  shuffle, planGroups, lockGroups,
  createGroupLeagueMatches, createKnockoutPlaceholders, autoAssignKnockout, assignCourtsInterleaved,
  listGroupMatches, listKnockout, listMatchesByStage, getMatch, saveMatchScore, startMatch,
  listKnockoutStructured, getTeamMap, labelOrName, setsToString,
  resetTournament, exportJson, subscribeRealtime
} from './admin-app.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const toast = (msg)=>{ const el = $('#log'); if (el) el.innerText = msg; };

let PlanPreviewCache = null;
let tapSelectedId = null;
let isConnected = false;

// ---- DnD (hover-to-join) state ----
let draggingTeamId = null;
let dndHoverTimer = null;
const DND_HOVER_DELAY = 500; // ms

// --- 멤버 로딩(팀원 표시용) ---
let membersMap = new Map();
async function loadMembers(){
  const { data, error } = await AppState.sb.from('team_members').select('team_id, member_name');
  if (error) throw error;
  const m = new Map();
  for (const r of (data||[])){
    const arr = m.get(r.team_id) || [];
    arr.push(r.member_name);
    m.set(r.team_id, arr);
  }
  membersMap = m;
}
function membersStr(teamId){
  const arr = membersMap.get(teamId) || [];
  return arr.length ? `(${arr.join(', ')})` : '(팀원 미등록)';
}

// ===== 상태 문자열 현지화 =====
function statusKR(s){
  if (s === 'playing') return '경기중';
  if (s === 'done') return '경기종료';
  return '대기중'; // pending or unknown
}

// ===== 코트 스냅샷 공용 유틸 =====
const STALLED_MINUTES = 10;
async function fetchCourtSnapshotAdmin(){
  const { data:list, error } = await AppState.sb.from('matches')
    .select('id,court_no,court_seq,status,stage,points_to_win,cap,team_a:team_a_id(name),team_b:team_b_id(name),started_at,last_action_at')
    .not('court_no','is', null)
    .order('court_no',{ascending:true})
    .order('court_seq',{ascending:true});
  if (error) throw error;
  return list||[];
}
function groupByCourt(list){
  const m = new Map();
  for (const x of list){ if (!m.has(x.court_no)) m.set(x.court_no, []); m.get(x.court_no).push(x); }
  return [...m.entries()].sort((a,b)=>a[0]-b[0]);
}
function isStalled(m){
  if (m.status!=='playing') return false;
  const t = m.last_action_at || m.started_at; if (!t) return false;
  return ((Date.now()-new Date(t).getTime())/60000) >= STALLED_MINUTES;
}

// ===== 코트 현황(관리) =====
async function renderAdminCourtBoard(){
  const root = document.getElementById('adminCourtBoard'); if (!root) return;
  try{
    const list = await fetchCourtSnapshotAdmin();
    const courts = groupByCourt(list);
    const stalled = list.filter(isStalled);
    let html = '';
    if (stalled.length){
      html += `<div class="mb-3 p-2 border rounded-lg bg-amber-50"><strong>⚠ 멈춘 경기</strong> (${STALLED_MINUTES}분 이상): ${
        stalled.map(m=>`코트 ${m.court_no} · ${m.court_seq}번 (${m.team_a?.name||'A'} vs ${m.team_b?.name||'B'})`).join(' , ')
      }</div>`;
    }
    html += `<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">`;
    for (const [no, arr] of courts){
      const playing = arr.find(x=>x.status==='playing');
      const next = arr.find(x=>x.status!=='done' && (!playing || x.court_seq>playing.court_seq));
      html += `<div class="card p-3 space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">코트 ${no}</div>
          <div>${playing?'<span class="pill pill-live">경기중</span>':'<span class="pill">대기중</span>'}</div>
        </div>
        <div class="border rounded-lg p-2 bg-white">
          <div class="font-semibold mb-1">현재</div>
          ${playing ? `
            <div class="flex items-center justify-between text-sm">
              <div class="truncate">#${playing.court_seq} ${playing.team_a?.name||'A'} vs ${playing.team_b?.name||'B'}</div>
              <div class="shrink-0 flex gap-1">
                <button class="btn px-2 py-1 text-xs" data-win="a" data-id="${playing.id}" data-cap="${playing.cap||25}">${playing.team_a?.name||'A'} 승리</button>
                <button class="btn px-2 py-1 text-xs" data-win="b" data-id="${playing.id}" data-cap="${playing.cap||25}">${playing.team_b?.name||'B'} 승리</button>
              </div>
            </div>` : `<div class="text-sm text-slate-500">현재 경기중인 경기가 없습니다.</div>`}
        </div>
        <div class="border rounded-lg p-2 bg-white">
          <div class="font-semibold mb-1">다음</div>
          ${next ? `
            <div class="flex items-center justify-between text-sm">
              <div class="truncate">#${next.court_seq} ${next.team_a?.name||'A'} vs ${next.team_b?.name||'B'}</div>
              <div class="shrink-0">
                <button class="btn px-2 py-1 text-xs" data-start data-id="${next.id}">시작</button>
              </div>
            </div>` : `<div class="text-sm text-slate-500">대기 매치 없음</div>`}
        </div>
      </div>`;
    }
    html += `</div>`;
    root.innerHTML = html;
  }catch(e){ console.error('renderAdminCourtBoard', e); root.innerHTML = `<div class="hint">코트 현황을 불러오지 못했습니다.</div>`; }
}

// 이벤트(승리/시작)
document.getElementById('adminCourtBoard')?.addEventListener('click', async (e)=>{
  const winBtn = e.target.closest('[data-win]');
  if (winBtn){
    const side = winBtn.dataset.win; const id = winBtn.dataset.id; const cap = parseInt(winBtn.dataset.cap||'25',10);
    try{
      const set = side==='a' ? [{a:cap,b:0}] : [{a:0,b:cap}];
      await saveMatchScore(id, set, 'normal');   // 규칙검증 통과(cap)
      await renderAdminCourtBoard();
      await renderAdminCourtSchedule();
    }catch(err){ alert('저장 실패: ' + err.message); }
    return;
  }
  const startBtn = e.target.closest('[data-start]');
  if (startBtn){
    try{
      await startMatch(startBtn.dataset.id);
      await renderAdminCourtBoard();
      await renderAdminCourtSchedule();
    }catch(err){ alert('시작 실패: ' + err.message); }
  }
});

// ===== 코트별 스케줄 =====
async function renderAdminCourtSchedule(){
  const wrap = document.getElementById('adminCourtSchedule'); if (!wrap) return;
  try{
    const { data:list, error } = await AppState.sb.from('matches')
      .select('id,court_no,court_seq,status,team_a:team_a_id(name),team_b:team_b_id(name)')
      .not('court_no','is', null)
      .order('court_no',{ascending:true})
      .order('court_seq',{ascending:true});
    if (error) throw error;
    const map = new Map();
    for (const m of (list||[])){ if (!map.has(m.court_no)) map.set(m.court_no, []); map.get(m.court_no).push(m); }
    const courts = [...map.entries()].sort((a,b)=>a[0]-b[0]);
    if (!courts.length){ wrap.innerHTML = `<div class="hint">코트에 배정된 경기가 없습니다.</div>`; return; }
    let html = `<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">`;
    for (const [no, arr] of courts){
      const chips = arr.map(m=>{
        const cls = m.status==='playing' ? 'pill pill-live' : 'pill';
        return `<span class="${cls}" title="#${m.court_seq} ${m.team_a?.name||'A'} vs ${m.team_b?.name||'B'}">#${m.court_seq}</span>`;
      }).join(' ');
      const lines = arr.map(m=>{
        const st = m.status==='playing' ? '<span class="text-amber-600 font-semibold">경기중</span>'
                 : m.status==='done'    ? '<span class="text-slate-500">경기종료</span>'
                 : '<span class="text-slate-500">대기중</span>';
        return `<li class="flex items-center gap-2">
          <span class="w-8 shrink-0 text-right text-sm">#${m.court_seq}</span>
          <span class="flex-1 truncate text-sm">${m.team_a?.name||'A'} vs ${m.team_b?.name||'B'}</span>
          <span class="shrink-0 text-xs">${st}</span>
        </li>`;
      }).join('');
      html += `<div class="card p-3">
        <div class="flex items-center justify-between">
          <div class="text-lg font-semibold">코트 ${no}</div>
          <div class="hint">총 ${arr.length}경기</div>
        </div>
        <div class="mt-2 flex flex-wrap gap-2">${chips}</div>
        <ol class="mt-2 space-y-1">${lines}</ol>
      </div>`;
    }
    html += `</div>`;
    wrap.innerHTML = html;
  }catch(e){ console.error('renderAdminCourtSchedule', e); wrap.innerHTML = `<div class="hint">코트 스케줄을 불러오는 중 문제가 발생했습니다.</div>`; }
}

// --- 연결 UI 잠금/해제 ---
function setConnUI(connected) {
  isConnected = connected;
  const toDisable = [
    '#btnImport','#btnLoadTeams',
    '#btnShuffle','#btnPreviewGroups','#btnLockGroups',
    '#btnCreateGroupLeague','#btnCreateKnockout','#btnAutoAssign',
    '#btnReloadAll','#btnReset','#btnExport','#btnSaveAll',
    '#selMode','#inpGroupSize','#selAdvance','#scoreStage'
  ];
  toDisable.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.disabled = !connected;
    el.classList.toggle('opacity-60', !connected);
    el.classList.toggle('cursor-not-allowed', !connected);
  });
}
setConnUI(false);

/* =========================
 * 0) 연결
 * ========================= */
$('#btnConnect')?.addEventListener('click', async ()=>{
  try {
    const url = $('#spUrl').value.trim();
    const key = $('#spKey').value.trim();
    if (!url || !key) return toast('URL/KEY를 입력하세요.');
    connectSupabase(url, key);
    await ping();
    $('#connStat').innerText = 'Supabase 연결 상태: OK';
    setConnUI(true);

    await Promise.all([loadTeams(), loadMembers()]);
    await refreshAllViews();
    subscribeRealtime(async ()=>{ await refreshAllViews(); });

    toast('연결되었습니다.');
  } catch(e){ console.error(e); toast('연결 실패: ' + e.message); }
});

async function refreshAllViews(){
  await refreshLists();
  await refreshScoreTable();   // 카드형 UI
  await renderBracket();
  await renderAdminCourtBoard();
  await renderAdminCourtSchedule();
}

function getGroupSizeFromInput(){
  const el = $('#inpGroupSize');
  const v = parseInt(el?.value || '4', 10);
  return Number.isFinite(v) && v>0 ? v : 4;
}

async function autoPlanAndPreview(){
  const mode = $('#selMode')?.value || 'auto';
  const size = getGroupSizeFromInput();
  const teams = AppState.teamsCache.length ? AppState.teamsCache : await loadTeams();
  const plan = planGroups({ mode, groupSize: size, teams });
  PlanPreviewCache = plan;
  renderGroupPreview(plan);
  updateGroupStatus(false);
}

function updateGroupStatus(locked){
  const tcnt = AppState.teamsCache?.length || 0;
  const gcnt = PlanPreviewCache?.groups?.length || 0;
  const el = $('#groupStatusLabel');
  if (el) el.innerText = `조편성 상태: ${locked?'확정됨 ✅':'미확정'} · 팀 ${tcnt} · 그룹 ${gcnt}`;
  const b = $('#groupStatusBadge');
  if (b){
    b.textContent = locked ? '확정됨' : '미확정';
    b.classList.toggle('bg-[#f7fff7]', locked);
    b.classList.toggle('border-green-300', locked);
    b.classList.toggle('bg-[#fffaf0]', !locked);
    b.classList.toggle('border-amber-200', !locked);
  }
}

/* =========================
 * 1) 참가팀 등록
 * ========================= */
$('#btnParse')?.addEventListener('click', ()=>{
  const items = parseExcelTextarea($('#taExcel').value);
  const pre = $('#preview'); if (pre) pre.textContent = JSON.stringify(items, null, 2);
});

$('#btnImport')?.addEventListener('click', async ()=>{
  try{
    if (!isConnected) { toast('먼저 "0) 연결/확인"을 완료하세요.'); return; }
    const items = parseExcelTextarea($('#taExcel').value);
    if (!items.length) return toast('붙여넣기 내용이 없습니다.');
    const r = await upsertTeams(items);
    await Promise.all([loadTeams(), loadMembers()]);
    toast(`등록 완료: 신규 ${r.ok}, 중복 ${r.skip}, 실패 ${r.fail}`);
    await autoPlanAndPreview();
  }catch(e){ console.error(e); toast('팀 등록 실패: '+e.message); }
});

$('#btnLoadTeams')?.addEventListener('click', async ()=>{
  await Promise.all([loadTeams(), loadMembers()]);
  toast(`팀 ${AppState.teamsCache.length}개 로드`);
});

/* =========================
 * 2) 조편성 (미리보기 + DnD)
 * ========================= */
$('#btnShuffle')?.addEventListener('click', async ()=>{
  if (!isConnected) { toast('먼저 연결하세요.'); return; }
  if (!confirm('팀을 섞을까요? 현재 미리보기가 새로 계산됩니다.')) return;
  const teams = await loadTeams();
  AppState.teamsCache = shuffle(teams);
  await autoPlanAndPreview();
  toast('팀을 섞었습니다. 미리보기를 갱신했습니다.');
});

$('#btnPreviewGroups')?.addEventListener('click', async ()=>{
  const mode = $('#selMode').value;
  const size = getGroupSizeFromInput();
  const teams = AppState.teamsCache.length ? AppState.teamsCache : await loadTeams();
  const plan = planGroups({ mode, groupSize: size, teams });
  PlanPreviewCache = plan;
  renderGroupPreview(plan);
});

function renderGroupPreview(plan){
  const root = $('#groupPreview');
  if (!root) return;
  root.innerHTML = '';
  if (!plan?.groups?.length){ root.innerHTML = '<div class="hint">그룹이 비어있습니다.</div>'; return; }

  for (const g of plan.groups) {
    const box = document.createElement('div');
    box.className = 'group-box';
    box.dataset.group = g.code;

    const title = document.createElement('div');
    title.className = 'font-semibold mb-2';
    title.textContent = `${g.code}조`;
    box.appendChild(title);

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-2';
    for (const t of g.teams) {
      const item = document.createElement('div');
      item.className = 'team-pill';
      item.draggable = true;
      item.dataset.teamId = t.id;
      item.dataset.group = g.code;
      item.textContent = `#${t.seed} ${t.name}`;
      list.appendChild(item);
    }
    box.appendChild(list);
    root.appendChild(box);
  }
  enablePreviewDnD(root, plan);
}

// ----- plan 조작 유틸 -----
function reseedPlan(plan){
  for (const g of plan.groups){ g.teams.forEach((t,i)=> t.seed = i+1); }
  return plan;
}
function findInPlan(plan, teamId){
  for (const g of plan.groups){
    const idx = g.teams.findIndex(x=>String(x.id)===String(teamId));
    if (idx>=0) return { group:g, idx };
  }
  return null;
}
function swapInPlan(plan, aId, bId){
  if (!aId || !bId || aId===bId) return plan;
  const A = findInPlan(plan, aId);
  const B = findInPlan(plan, bId);
  if (!A || !B) return plan;
  const tmp = A.group.teams[A.idx];
  A.group.teams[A.idx] = B.group.teams[B.idx];
  B.group.teams[B.idx] = tmp;
  return reseedPlan(plan);
}
function canMoveBetweenGroupsPlan(plan, fromCode, toCode){
  if (!fromCode || !toCode || fromCode===toCode) return false;
  const groups = plan.groups;
  const groupSize = getGroupSizeFromInput();
  const total = groups.reduce((s,g)=> s + (g.teams?.length||0), 0);
  const remainder = total % groupSize; // 예: 13%3 = 1 → 4팀 조 1개 허용
  const from = groups.find(g=>g.code===fromCode);
  const to   = groups.find(g=>g.code===toCode);
  if (!from || !to) return false;
  const destLen = to.teams.length;
  const srcLen  = from.teams.length;
  const overCnt = groups.filter(g=> g.teams.length > groupSize).length;

  if (destLen < groupSize) return true;           // 아직 미만이면 자유 이동
  if (destLen >= groupSize + 1) return false;     // 이미 +1 초과 금지
  if (overCnt < remainder) return true;           // 4팀 조 아직 더 만들 수 있음
  if (srcLen > groupSize) return true;            // 4팀→4팀 유지 이동 허용

  return false;
}
function moveTeamToGroup(plan, teamId, toCode){
  const A = findInPlan(plan, teamId);
  if (!A) return false;
  const srcCode = A.group.code;
  if (srcCode === toCode) return false;
  const to = plan.groups.find(g=>g.code===toCode);
  if (!to) return false;
  if (to.teams.some(t=> String(t.id) === String(teamId))) return false;
  const [teamObj] = A.group.teams.splice(A.idx,1);
  to.teams.push(teamObj); // 끝으로 편입
  reseedPlan(plan);
  return true;
}

// ----- DnD 바인딩 (칩 스왑 + 그룹박스 호버 편입) -----
function clearHoverTimer(){
  if (dndHoverTimer){ clearTimeout(dndHoverTimer); dndHoverTimer = null; }
}
function enablePreviewDnD(root, plan){
  // 1) 팀 칩: 스왑 + 탭 스왑
  root.querySelectorAll('.team-pill').forEach(el=>{
    el.addEventListener('dragstart', (e)=>{
      draggingTeamId = el.dataset.teamId;
      e.dataTransfer.setData('text/plain', draggingTeamId);
      requestAnimationFrame(()=> el.classList.add('drop-hover'));
    });
    el.addEventListener('dragend', ()=> { el.classList.remove('drop-hover'); draggingTeamId = null; clearHoverTimer(); });
    el.addEventListener('dragover', (e)=> e.preventDefault());
    el.addEventListener('dragenter', ()=> el.classList.add('drop-hover'));
    el.addEventListener('dragleave', ()=> el.classList.remove('drop-hover'));
    el.addEventListener('drop', (e)=>{
      e.preventDefault();
      const srcId = e.dataTransfer.getData('text/plain');
      const dstId = el.dataset.teamId;
      PlanPreviewCache = swapInPlan(plan, srcId, dstId);
      renderGroupPreview(PlanPreviewCache);
    });
    el.addEventListener('click', ()=>{
      const id = el.dataset.teamId;
      if (!tapSelectedId){
        tapSelectedId = id;
        el.classList.add('team-selected');
      } else {
        const prv = root.querySelector('.team-selected');
        if (prv) prv.classList.remove('team-selected');
        if (tapSelectedId !== id){
          PlanPreviewCache = swapInPlan(plan, tapSelectedId, id);
          renderGroupPreview(PlanPreviewCache);
        }
        tapSelectedId = null;
      }
    });
  });

  // 2) 그룹 박스: 드래그 호버 시 자동 편입 + 드롭 지원
  root.querySelectorAll('.group-box').forEach(box=>{
    box.addEventListener('dragover', (e)=>{ if (draggingTeamId) e.preventDefault(); });
    box.addEventListener('dragenter', ()=>{
      if (!draggingTeamId) return;
      const toCode = box.dataset.group;
      const from = findInPlan(plan, draggingTeamId);
      if (!from) return;
      if (!canMoveBetweenGroupsPlan(plan, from.group.code, toCode)) return;
      box.classList.add('drop-hover');
      clearHoverTimer();
      dndHoverTimer = setTimeout(()=>{
        if (moveTeamToGroup(plan, draggingTeamId, toCode)){
          PlanPreviewCache = plan;
          renderGroupPreview(plan);
        }
      }, DND_HOVER_DELAY);
    });
    box.addEventListener('dragleave', ()=>{ box.classList.remove('drop-hover'); clearHoverTimer(); });
    box.addEventListener('drop', (e)=>{
      if (!draggingTeamId) return;
      e.preventDefault();
      const toCode = box.dataset.group;
      const from = findInPlan(plan, draggingTeamId);
      if (from && canMoveBetweenGroupsPlan(plan, from.group.code, toCode)){
        if (moveTeamToGroup(plan, draggingTeamId, toCode)){
          PlanPreviewCache = plan;
          renderGroupPreview(plan);
        }
      } else {
        toast?.('이 조에는 더 이상 팀을 추가할 수 없어요. (균등 분배 규칙)');
      }
      box.classList.remove('drop-hover');
      clearHoverTimer();
    });
  });
}

$('#btnLockGroups')?.addEventListener('click', async ()=>{
  try{
    if (!PlanPreviewCache){ await autoPlanAndPreview(); }
    await lockGroups(PlanPreviewCache);
    await loadTeams();
    updateGroupStatus(true);
    toast('조편성을 확정했습니다.');
  }catch(e){ console.error(e); toast('조편성 확정 실패: '+e.message); }
});

/* =========================
 * 3) 경기 생성
 * ========================= */
$('#btnCreateGroupLeague')?.addEventListener('click', async ()=>{
  try {
    const courts = parseInt(document.querySelector('#inpCourts')?.value||'1',10);
    await createGroupLeagueMatches();
    await assignCourtsInterleaved({ numCourts: courts, randomize: true });
    toast('조별리그 매치 생성 + 코트 배정을 완료했습니다.');
    await refreshAllViews();
  } catch(e){ console.error(e); toast('조별리그 생성 실패: '+e.message); }
});

$('#btnCreateKnockout')?.addEventListener('click', async ()=>{
  try {
    const adv = parseInt($('#selAdvance').value, 10);
    await createKnockoutPlaceholders({ advancePerGroup: adv });
    toast('8강/4강/결승 플레이스홀더를 생성했습니다.');
    await refreshAllViews();
  } catch(e){ console.error(e); toast('토너먼트 생성 실패: '+e.message); }
});

$('#btnAutoAssign')?.addEventListener('click', async ()=>{
  try {
    const adv = parseInt($('#selAdvance').value, 10);
    await autoAssignKnockout({ advancePerGroup: adv });
    toast('현재 조별 순위 기준으로 브래킷 자동 배정 완료');
    await refreshAllViews();
  } catch(e){ console.error(e); toast('자동배정 실패: '+e.message); }
});

/* =========================
 * 4) 스코어 입력 — 카드형 UI
 * ========================= */
$('#scoreStage')?.addEventListener('change', refreshScoreTable);

// 전역: 현재 포커스된 점수 input
let lastFocusedInput = null;

// cap(최대점수)에 맞춰 빠른입력 버튼 구성
function quickButtonsHtml(cap, base){
  const vals = Array.from(new Set([21, base, cap])).filter(v=>v<=cap).sort((a,b)=>a-b);
  return vals.map(v=>`<button class="btn btn-ghost px-2 py-1 text-xs" data-quick-val="${v}">${v}</button>`).join('');
}

async function refreshScoreTable(){
  try{
    await Promise.all([getTeamMap(), loadMembers()]);
    const root = $('#scoreTable'); if (!root) return;

    const st = $('#scoreStage').value || 'all';
    const list = await listMatchesByStage(st);

    // 레이아웃: 아이패드 이상 2열
    root.className = 'mt-3 grid md:grid-cols-2 gap-3';
    root.innerHTML = '';

    if (!list.length){
      root.innerHTML = `<div class="hint">표시할 매치가 없습니다.</div>`;
      return;
    }

    for (const m of list) {
      const aName = labelOrName(m, 'a');
      const bName = labelOrName(m, 'b');
      const aMembers = m.team_a_id ? membersStr(m.team_a_id) : '(팀원 미등록)';
      const bMembers = m.team_b_id ? membersStr(m.team_b_id) : '(팀원 미등록)';

      // 헤드라인 점수(가장 최근 입력 세트 or 1세트)
      const sets = m.set_scores || [];
      const headIdx = Math.max(0, sets.length ? sets.length-1 : 0);
      const headA = (typeof sets[headIdx]?.a === 'number') ? sets[headIdx].a : '–';
      const headB = (typeof sets[headIdx]?.b === 'number') ? sets[headIdx].b : '–';

      const card = document.createElement('div');
      card.className = 'card p-4 score-card flex flex-col hover:shadow-md transition';
      card.dataset.matchId = m.id;
      card.dataset.points = (m.points_to_win ?? AppState.cfg.pointsToWin);
      card.dataset.winby  = (m.win_by ?? AppState.cfg.winBy);
      card.dataset.cap    = (m.cap ?? AppState.cfg.cap);
      card.dataset.bestOf = (m.best_of || AppState.cfg.bestOf);
      card.dataset.stage  = m.stage;

      const cap = parseInt(card.dataset.cap,10) || 25;
      const base = parseInt(card.dataset.points,10) || 25;

      card.innerHTML = `
        <div class="card-head">
          <div class="card-head__left">
            <div class="text-sm font-bold truncate">${aName} <span class="hint">vs</span> ${bName}</div>
            <div class="text-xs hint truncate members-line">${aMembers} <span class="hint">vs</span> ${bMembers}</div>
          </div>
          <div class="card-head__right">
            <select class="border rounded-lg p-2 text-sm bg-white" data-result>
              <option value="normal" ${m.result_type==='normal'?'selected':''}>일반</option>
              <option value="wo_a">몰수(${aName})</option>
              <option value="wo_b">몰수(${bName})</option>
              <option value="inj_a">부상기권(${aName})</option>
              <option value="inj_b">부상기권(${bName})</option>
            </select>
            <button class="btn btn-prim px-3 py-2 text-sm" data-save>저장</button>
          </div>
        </div>

        <div class="text-lg font-bold text-center my-2">
          <span class="truncate">${aName}</span>
          <span class="mx-2">${headA} : ${headB}</span>
          <span class="truncate">${bName}</span>
        </div>

        <div class="space-y-2 mt-2" data-sets></div>

        <div class="flex flex-wrap items-center gap-2 mt-2">
          <span class="hint">빠른입력:</span>
          <button class="btn btn-ghost px-2 py-1 text-xs" data-win="a">${aName} 승리</button>
          <button class="btn btn-ghost px-2 py-1 text-xs" data-win="b">${bName} 승리</button>
          <span class="hint">(세트 입력칸을 누르면 ${[...new Set([21, base, cap])].filter(v=>v<=cap).sort((a,b)=>a-b).join('/')} 팝오버가 해당 칸 아래에 표시됩니다)</span>
        </div>

        <div class="hint mt-1" data-msg">${statusKR(m.status || 'pending')}</div>
      `;

      // 세트 행 렌더
      const setsWrap = card.querySelector('[data-sets]');
      const bestOf = m.best_of || AppState.cfg.bestOf;
      for (let i=0;i<bestOf;i++){
        const va = (sets[i]?.a ?? '');
        const vb = (sets[i]?.b ?? '');
        const row = document.createElement('div');
        row.className = 'set-row relative border rounded-lg p-2 bg-white';
        row.dataset.set = i;
        row.innerHTML = `
          <div class="grid grid-cols-2 gap-3 items-center">
            <div class="flex items-center gap-2">
              <span class="hint w-16">-</span>
              <input type="number" min="0" max="${cap}" class="border rounded-lg p-2 w-full focus:outline-none focus:ring-1 focus:ring-[#e7e5e4]" data-set="${i}" data-side="a" value="${va}">
            </div>
            <div class="flex items-center gap-2">
              <span class="hint w-16">-</span>
              <input type="number" min="0" max="${cap}" class="border rounded-lg p-2 w-full focus:outline-none focus:ring-1 focus:ring-[#e7e5e4]" data-set="${i}" data-side="b" value="${vb}">
            </div>
          </div>
          <!-- 포커스 시 표시되는 빠른입력 팝오버 -->
          <div class="quick-pts hidden absolute left-2 top-full mt-1 z-10 bg-white border rounded-lg shadow p-1 flex gap-1">
            ${quickButtonsHtml(cap, base)}
          </div>
        `;
        setsWrap.appendChild(row);
      }

      root.appendChild(card);
    }
  }catch(e){ console.error(e); toast('스코어 UI 로딩 실패: '+e.message); }
}

// ---- 카드 내 이벤트 위임 ----
$('#scoreTable')?.addEventListener('focusin', (e)=>{
  const input = e.target.closest('input[data-set]');
  if (!input) return;
  lastFocusedInput = input;

  // 모든 팝오버 숨김
  $$('#scoreTable .quick-pts').forEach(el => el.classList.add('hidden'));

  // 현재 세트 행의 팝오버 표시
  const row = input.closest('.set-row');
  const pop = row?.querySelector('.quick-pts');
  if (pop) pop.classList.remove('hidden');
});

$('#scoreTable')?.addEventListener('focusout', (e)=>{
  // 포커스가 카드 외로 완전히 빠져나가면 팝오버 숨김(살짝 지연)
  setTimeout(()=>{
    if (!document.activeElement || !document.querySelector('#scoreTable')?.contains(document.activeElement)) {
      $$('#scoreTable .quick-pts').forEach(el => el.classList.add('hidden'));
    }
  }, 100);
});

$('#scoreTable')?.addEventListener('click', (e)=>{
  const card = e.target.closest('.score-card');
  if (!card) return;

  const msgEl = card.querySelector('[data-msg]');

  // 1) 빠른입력 팝오버 버튼
  const q = e.target.closest('[data-quick-val]');
  if (q && lastFocusedInput && card.contains(lastFocusedInput)) {
    const cap = parseInt(card.dataset.cap,10) || 25;
    const val = Math.min(parseInt(q.dataset.quickVal,10), cap);
    lastFocusedInput.value = val;
    lastFocusedInput.dispatchEvent(new Event('input', {bubbles:true}));
    lastFocusedInput.focus();
    return;
  }

  // 2) 팀 승리(다음 빈 세트에 승자 점수 채우기)
  const wbtn = e.target.closest('[data-win]');
  if (wbtn){
    const side = wbtn.dataset.win; // 'a' or 'b'
    const pts  = Math.min(parseInt(card.dataset.points || '25', 10), parseInt(card.dataset.cap||'25',10));
    const inputs = Array.from(card.querySelectorAll('input[data-set]'));
    const nextIdx = findNextEmptySetIndex(inputs);
    const tInput = card.querySelector(`input[data-set="${nextIdx}"][data-side="${side}"]`);
    if (tInput){
      tInput.value = pts;
      tInput.dispatchEvent(new Event('input',{bubbles:true}));
      // 상대 점수 입력으로 포커스 넘김
      const other = side==='a' ? 'b' : 'a';
      const oInput = card.querySelector(`input[data-set="${nextIdx}"][data-side="${other}"]`);
      if (oInput) { oInput.focus(); oInput.select(); }
      msgEl.innerText = `세트 ${nextIdx+1}: ${side.toUpperCase()}팀 ${pts}점 입력`;
    }
    return;
  }

  // 3) 저장(해당 카드만 저장)
  const saveBtn = e.target.closest('[data-save]');
  if (saveBtn){
    saveOneCard(card).catch(err=>{
      console.error(err);
      msgEl.innerText = '저장 실패: ' + err.message;
    });
    return;
  }
});

// 입력 변경: 클램핑(0..cap) + 헤드라인 갱신
$('#scoreTable')?.addEventListener('input', (e)=>{
  const input = e.target.closest('input[data-set]');
  if (!input) return;
  const card = e.target.closest('.score-card');
  if (!card) return;

  const cap = parseInt(card.dataset.cap,10) || 25;
  let v = parseInt(input.value || '0', 10);
  if (Number.isNaN(v)) v = 0;
  if (v < 0) v = 0;
  if (v > cap) v = cap;
  if (String(v) !== input.value) input.value = String(v);
  const msgEl = card.querySelector('[data-msg]');
  if (v === cap) msgEl.innerText = `최대 ${cap}점(조별 단판)`;
  else if (msgEl.innerText.startsWith('최대')) msgEl.innerText = '';

  // 가장 최근(값이 있는) 세트 찾기 → 헤드라인
  const inputs = Array.from(card.querySelectorAll('input[data-set]'));
  const byIdx = new Map();
  for (const el of inputs){
    const idx = parseInt(el.dataset.set,10);
    const obj = byIdx.get(idx) || {a:'',b:''};
    obj[el.dataset.side] = el.value;
    byIdx.set(idx, obj);
  }
  let lastIdx = 0;
  for (const i of [...byIdx.keys()].sort((a,b)=>a-b)){
    const v = byIdx.get(i);
    if ((v.a!=='' || v.b!=='')) lastIdx = i;
  }
  const v2 = byIdx.get(lastIdx) || {a:'–', b:'–'};
  const headline = card.querySelector('.text-lg.font-bold.text-center');
  if (headline){
    const spans = headline.querySelectorAll('span');
    if (spans[1]) spans[1].innerText = `${v2.a || '–'} : ${v2.b || '–'}`;
  }
});

// 다음 빈 세트 인덱스
function findNextEmptySetIndex(inputs){
  const grouped = new Map();
  for (const el of inputs){
    const idx = parseInt(el.dataset.set,10);
    const g = grouped.get(idx) || {a:'',b:''};
    g[el.dataset.side] = el.value;
    grouped.set(idx, g);
  }
  const order = [...grouped.keys()].sort((a,b)=>a-b);
  for (const i of order){
    const g = grouped.get(i);
    if ((g.a??'')==='' || (g.b??'')==='') return i;
  }
  return order[order.length-1] ?? 0;
}

// 카드 저장 로직(그 경기만)
async function saveOneCard(card){
  const matchId = card.dataset.matchId;
  const resultType = card.querySelector('[data-result]')?.value || 'normal';
  const cap = parseInt(card.dataset.cap,10) || 25;

  const inputs = Array.from(card.querySelectorAll('input[data-set]'));
  const byIdx = new Map();
  for (const el of inputs){
    const idx = parseInt(el.dataset.set,10);
    const side = el.dataset.side;
    const obj = byIdx.get(idx) || {};
    // 저장 직전에도 0..cap 클램핑
    let v = el.value==='' ? null : Number(el.value);
    if (typeof v === 'number' && !Number.isNaN(v)) {
      if (v < 0) v = 0;
      if (v > cap) v = cap;
    } else {
      v = null;
    }
    obj[side] = v;
    byIdx.set(idx, obj);
  }
  const setArr = [];
  [...byIdx.entries()].sort((a,b)=>a[0]-b[0]).forEach(([_,o])=>{
    if (typeof o.a === 'number' && typeof o.b === 'number') setArr.push({a:o.a, b:o.b});
  });

  const msgEl = card.querySelector('[data-msg]');
  // 일반결과인데 입력이 하나도 없으면 안내만
  if (resultType==='normal' && setArr.length===0){
    msgEl.innerText = '입력된 점수가 없습니다.';
    return;
  }

  const r = await saveMatchScore(matchId, setArr, resultType);
  msgEl.innerText = r.winner ? '저장됨 · 승자 확정' : '저장됨';
  await refreshLists();       // 리스트 갱신
  await renderBracket();      // 브래킷 갱신
}

// ============ Save All (보이는 카드 일괄 저장) ============
async function saveAllVisibleCards(){
  const btn = document.querySelector('#btnSaveAll');
  try{
    // 실행 중 버튼 잠금
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60','cursor-not-allowed'); }

    const cards = Array.from(document.querySelectorAll('#scoreTable .score-card'));
    let ok = 0, skip = 0, fail = 0;
    let firstFailCard = null;

    for (const card of cards) {
      const msgEl = card.querySelector('[data-msg]');
      const resultType = card.querySelector('[data-result]')?.value || 'normal';

      // 입력이 전혀 없고 '일반'인 카드는 건너뜀(의도치 않은 실패 방지)
      const hasAnyInput = Array.from(card.querySelectorAll('input[data-set]'))
        .some(i => (i.value ?? '') !== '');
      if (resultType === 'normal' && !hasAnyInput) {
        skip++;
        if (msgEl) msgEl.innerText = '건너뜀(입력 없음)';
        continue;
      }

      try {
        await saveOneCard(card);   // per-card 저장 로직 재사용
        ok++;
      } catch (e) {
        fail++;
        if (!firstFailCard) firstFailCard = card;
        console.error(e);
        if (msgEl) msgEl.innerText = '저장 실패: ' + e.message;
      }
    }

    // 첫 실패 카드로 스크롤 유도
    if (firstFailCard) firstFailCard.scrollIntoView({ behavior:'smooth', block:'center' });

    // 요약 토스트
    const summary = `일괄 저장 완료 · 성공 ${ok} / 건너뜀 ${skip} / 실패 ${fail}`;
    const log = document.querySelector('#log'); if (log) log.innerText = summary;

    // 리스트/브래킷 갱신
    await Promise.all([refreshLists(), renderBracket()]);
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60','cursor-not-allowed'); }
  }
}

// 버튼 바인딩
document.querySelector('#btnSaveAll')?.addEventListener('click', saveAllVisibleCards);


/* =========================
 * 5) 브래킷 뷰어
 * ========================= */
async function renderBracket(){
  await getTeamMap();
  const grid = $('#bracketGrid'); if (!grid) return;
  const { qf, sf, fi } = await listKnockoutStructured();
  grid.innerHTML = '';

  const makeCol = (title, matches)=> {
    const col = document.createElement('div');
    col.className = 'bracket-col';
    const tt = document.createElement('div');
    tt.className = 'stage-title'; tt.textContent = title;
    col.appendChild(tt);

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
        <div class="hint mt-1">${statusKR(m.status || 'pending')}${extra}</div>`;
      col.appendChild(box);
    }
    return col;
  };

  grid.appendChild(makeCol('QF (8강)', qf));
  grid.appendChild(makeCol('SF (4강)', sf));
  grid.appendChild(makeCol('FINAL (결승)', fi));
}

/* =========================
 * 6) 기타(리스트/리셋/내보내기)
 * ========================= */
async function refreshLists(){
  try {
    await getTeamMap();
    const [gm, ko] = await Promise.all([listGroupMatches(), listKnockout()]);
    renderMatches('#listGroupMatches', gm, true);
    renderMatches('#listKO', ko, false);
  } catch(e){ console.error(e); toast('리스트 로딩 실패: '+e.message); }
}

function matchLabel(m){
  const a = m.team_a_id ? (AppState.teamMap.get(m.team_a_id) || '-') : (m.seed_label_a || 'TBD');
  const b = m.team_b_id ? (AppState.teamMap.get(m.team_b_id) || '-') : (m.seed_label_b || 'TBD');
  return `${a} vs ${b}`;
}
function renderMatches(sel, items, showGroup){
  const root = $(sel);
  if (!root) return;
  root.innerHTML = '';
  for (const m of items) {
    const row = document.createElement('div');
    row.className = 'border rounded-lg p-2 text-sm flex items-center justify-between bg-white';
    const head = showGroup ? `[${m.groups?.code||'-'} R${m.round}]` : `[${m.stage.toUpperCase()} #${m.bracket_pos}]`;
    const setsStr = setsToString(m.set_scores);
    row.innerHTML = `<div>${head} ${matchLabel(m)}${setsStr?` · <span class="hint">${setsStr}</span>`:''}</div>
      <div>${statusPill(m.status||'pending')}</div>`;
    root.appendChild(row);
  }
}
const statusPill = (s)=>{
  const base = 'px-2 py-0.5 text-[11px] rounded-full border';
  if (s==='done') return `<span class="${base} bg-[#ecfeff]">경기종료</span>`;
  if (s==='playing') return `<span class="${base} bg-[#eef2ff]">경기중</span>`;
  return `<span class="${base}">대기중</span>`;
};

$('#btnReloadAll')?.addEventListener('click', refreshAllViews);

$('#btnReset')?.addEventListener('click', async ()=>{
  if (!confirm('토너먼트를 완전히 초기화할까요?')) return;
  await resetTournament();
  toast('초기화 완료');
  await refreshAllViews();
});

$('#btnExport')?.addEventListener('click', async ()=>{
  const j = await exportJson();
  const blob = new Blob([j], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'tournament-export.json'; a.click();
  URL.revokeObjectURL(url);
  toast('JSON 내보내기를 완료했습니다.');
});

// ============ Preflight & Status Summary ============
async function runPreflight(){
  try{
    // 0) 연결
    if (!AppState.sb) throw new Error('Supabase 미연결');

    // 1) 규칙 고정 확인
    const cfgOk =
      AppState.cfg.bestOf === 1 &&
      AppState.cfg.pointsToWin === 25 &&
      AppState.cfg.winBy === 1 &&
      AppState.cfg.cap === 25;

    // 2) DB 상태 수집
    const sb = AppState.sb;
    const [teams, groups, gteams, groupMatches, koMatches] = await Promise.all([
      sb.from('teams').select('id,name'),
      sb.from('groups').select('id,code,locked'),
      sb.from('group_teams').select('group_id,team_id'),
      sb.from('matches').select('id,group_id,team_a_id,team_b_id,set_scores,winner_id,status').eq('stage','group'),
      sb.from('matches').select('id,stage,bracket_pos,seed_label_a,seed_label_b,team_a_id,team_b_id,status').in('stage',['qf','sf','final'])
    ]);
    const ok = (msg)=>({ level:'ok', msg });
    const warn = (msg)=>({ level:'warn', msg });
    const bad = (msg)=>({ level:'bad', msg });

    // 3) 체크
    const items = [];
    items.push(cfgOk ? ok('규칙 고정(단판25·winBy1·cap25) 설정 확인') : bad('규칙이 고정값과 다릅니다'));

    // 팀/그룹
    const tcnt = teams.data?.length||0;
    const gcnt = groups.data?.length||0;
    const lockedCnt = (groups.data||[]).filter(g=>g.locked).length;
    items.push(tcnt>=2 ? ok(`팀 ${tcnt}개`) : bad('팀이 2개 미만'));
    items.push(gcnt>0 ? ok(`그룹 ${gcnt}개`) : warn('그룹이 없습니다. 조편성 필요'));
    items.push(lockedCnt===gcnt && gcnt>0 ? ok('조편성 확정됨') : warn('조편성이 미확정입니다(확정 버튼 필요)'));

    // 조별리그 매치 생성
    const gmCnt = groupMatches.data?.length||0;
    items.push(gmCnt>0 ? ok(`조별리그 매치 ${gmCnt}개 생성됨`) : warn('조별리그 매치가 없습니다(3)에서 생성)'));

    // KO 플레이스홀더
    const koCnt = koMatches.data?.length||0;
    items.push(koCnt>0 ? ok(`토너먼트(8/4/결승) ${koCnt}개 생성됨`) : warn('토너먼트 플레이스홀더가 없습니다(3)에서 생성)'));

    // KO 배정 상태(시드라벨은 있는데 팀 미배정)
    const koUnassigned = (koMatches.data||[]).filter(m=>{
      const needA = m.seed_label_a && !m.team_a_id;
      const needB = m.seed_label_b && !m.team_b_id;
      return needA || needB;
    }).length;
    items.push(koUnassigned===0 ? ok('토너먼트 시드 배정 OK') : warn(`토너먼트 시드 미배정 ${koUnassigned}개(자동배정 실행 추천)`));

    // 이상치 점수(규칙 불일치 세트) 간단 검사
    let invalidSets = 0;
    for (const m of (groupMatches.data||[])) {
      for (const s of (m.set_scores||[])) {
        const v = (a,b)=> {
          const w = (a===AppState.cfg.cap || b===AppState.cfg.cap) ? true :
                    (Math.max(a,b) >= AppState.cfg.pointsToWin && Math.abs(a-b) >= AppState.cfg.winBy);
          return Number.isFinite(a) && Number.isFinite(b) && a!==b && (a>=0 && b>=0) && w;
        };
        if (!v(Number(s?.a), Number(s?.b))) { invalidSets++; break; }
      }
    }
    items.push(invalidSets===0 ? ok('점수 형식/규칙 이상 없음') : warn(`규칙과 불일치한 세트 추정 ${invalidSets}개(확인 필요)`));

    renderPreflight(items);
  }catch(e){
    renderPreflight([{level:'bad', msg:'점검 실패: '+e.message}]);
  }
}

function renderPreflight(items){
  const ul = document.querySelector('#preflightList');
  if (!ul) return;
  ul.innerHTML = '';
  for (const it of items){
    const li = document.createElement('li');
    const color = it.level==='ok' ? 'text-green-700' : it.level==='warn' ? 'text-amber-700' : 'text-red-700';
    const dot   = it.level==='ok' ? '🟢' : it.level==='warn' ? '🟡' : '🔴';
    li.innerHTML = `<div class="border rounded-lg p-2 ${it.level==='ok'?'bg-[#f7fff7]':it.level==='warn'?'bg-[#fffaf0]':'bg-[#fff5f5]'}">
      <span class="${color} mr-1">${dot}</span>${it.msg}
    </div>`;
    ul.appendChild(li);
  }
}

async function renderStatusSummary(){
  try{
    const sb = AppState.sb;
    const { data, error } = await sb.from('matches').select('stage,status');
    if (error) throw error;
    const agg = {};
    for (const r of (data||[])){
      const k = `${r.stage||'?'}/${r.status||'pending'}`;
      agg[k] = (agg[k]||0)+1;
    }
    const blocks = [];
    const order = ['group','qf','sf','final'];
    const states = ['pending','playing','done'];
    for (const stg of order){
      const line = states.map(s=>{
        const n = agg[`${stg}/${s}`]||0;
        const pill = s==='pending' ? 'border' : s==='playing' ? 'bg-[#eef2ff] border' : 'bg-[#ecfeff] border';
        const txt = statusKR(s);
        return `<span class="px-2 py-0.5 text-[11px] rounded-full ${pill}">${txt}:${n}</span>`;
      }).join(' ');
      blocks.push(`<div><span class="font-semibold mr-2">${stg.toUpperCase()}</span>${line}</div>`);
    }
    const root = document.querySelector('#statusSummary');
    if (root) root.innerHTML = blocks.join('');
  }catch(e){
    const root = document.querySelector('#statusSummary');
    if (root) root.innerHTML = `<div class="hint">요약 실패: ${e.message}</div>`;
  }
}

// 버튼 바인딩 + 연결 직후 자동 실행
document.querySelector('#btnPreflight')?.addEventListener('click', runPreflight);
document.querySelector('#btnStatusSummary')?.addEventListener('click', renderStatusSummary);
// 연결 완료 시점(refreshAllViews) 뒤에 자동 호출
const oldRefreshAllViews = refreshAllViews;
refreshAllViews = async function(){
  await oldRefreshAllViews();
  await runPreflight();
  await renderStatusSummary();
};

// ============ Keyboard shortcuts for score cards ============
let activeCard = null;
document.querySelector('#scoreTable')?.addEventListener('mouseenter', (e)=>{
  const c = e.target.closest('.score-card'); if (!c) return;
  activeCard = c; // 마지막으로 호버한 카드
}, true);
document.querySelector('#scoreTable')?.addEventListener('mouseleave', (e)=>{
  const c = e.target.closest('.score-card'); if (!c) return;
  if (activeCard === c) activeCard = null;
}, true);

document.addEventListener('keydown', (e)=>{
  if (!activeCard) return;
  const key = e.key.toLowerCase();

  // A/B로 승리 버튼
  if (key==='a' || key==='b'){
    const btn = activeCard.querySelector(`[data-win="${key}"]`);
    if (btn){ btn.click(); e.preventDefault(); }
    return;
  }

  // Enter -> 저장
  if (key==='enter'){
    const btn = activeCard.querySelector('[data-save]');
    if (btn){ btn.click(); e.preventDefault(); }
    return;
  }

  // 숫자/Backspace -> 포커스된 input
  if (!lastFocusedInput || !activeCard.contains(lastFocusedInput)) return;
  const cap = parseInt(activeCard.dataset.cap||'25',10);

  if (/^\d$/.test(key)){
    const cur = String(lastFocusedInput.value||'');
    const next = (cur + key).slice(0,2); // 2자리까지만
    let v = parseInt(next,10);
    if (Number.isNaN(v)) v = 0;
    if (v>cap) v=cap;
    lastFocusedInput.value = String(v);
    lastFocusedInput.dispatchEvent(new Event('input',{bubbles:true}));
    e.preventDefault();
  } else if (key==='backspace'){
    lastFocusedInput.value = '';
    lastFocusedInput.dispatchEvent(new Event('input',{bubbles:true}));
    e.preventDefault();
  }
});

// 현재 모드 표시
async function fetchAdminMode(){
  try{
    const { data } = await AppState.sb.from('app_settings').select('mode').single();
    const mode = data?.mode || 'prod';
    document.getElementById('adminModeBadge').textContent = '모드: ' + (mode==='dev'?'개발':'운영');
  }catch(e){
    console.warn('모드 조회 실패', e);
  }
}

// 모드 전환
async function switchMode(next){
  const secret = (document.getElementById('adminSecret')?.value || '').trim();
  if (!secret) { alert('비밀키를 입력하세요'); return; }
  try{
    const { error } = await AppState.sb.rpc('set_mode', { p_secret: secret, p_mode: next });
    if (error) throw error;
    await fetchAdminMode();
    alert('모드가 ' + (next==='dev'?'개발':'운영') + '으로 전환되었습니다.');
  }catch(e){
    console.error(e);
    alert('전환 실패: ' + (e?.message || e));
  }
}
document.getElementById('btnModeDev')?.addEventListener('click', ()=> switchMode('dev'));
document.getElementById('btnModeProd')?.addEventListener('click', ()=> switchMode('prod'));

// 관리자 페이지 진입 시 모드 뱃지 갱신(및 실시간 반영)
(async ()=>{
  try{
    await fetchAdminMode();
    AppState.sb
      .channel('realtime:app_settings')
      .on('postgres_changes', { event: '*', schema:'public', table:'app_settings' }, fetchAdminMode)
      .subscribe();
  }catch(e){ console.warn('모드 조회 실패', e); }
})();
