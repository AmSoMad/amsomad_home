// assets/js/admin-app.js
// 공용 비즈니스 로직 + 규칙검증 + Realtime (관리/참가 공용)

/* =========================
 * 전역 상태
 * ========================= */
export const AppState = {
  sb: null,
  // 배드민턴 기본 규칙: 21점 듀스, 2점차, cap 25, 3세트(2선승)
  cfg: { bestOf: 1, pointsToWin: 25, winBy: 1, cap: 25 },
  teamsCache: [],
  groupsCache: [],
  groupTeamsCache: [],
  matchesCache: [],
  teamMap: new Map(), // id -> name
  rtChannel: null,
};

export function connectSupabase(url, key) {
  AppState.sb = window.supabase.createClient(url, key);
  return AppState.sb;
}

export async function ping() {
  const { error } = await AppState.sb.from('teams').select('id').limit(1);
  if (error) throw error;
  return true;
}

export function ensureSB() {
  if (!AppState.sb) {
    throw new Error('Supabase 미연결 상태입니다. 상단의 "0) 연결/확인"으로 먼저 연결하세요.');
  }
}

/* =========================
 * 1) 팀 Import / 캐시
 * ========================= */
export function parseExcelTextarea(raw) {
  const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim(); // 공백/탭 정규화
  const lines = String(raw).trim().split(/\r?\n/).filter(Boolean);
  const items = [];
  for (const line of lines) {
    const cols = line.includes('\t') ? line.split('\t') : line.split(/[,\s]{2,}|,/);
    const team = clean(cols[0]);
    if (!team) continue;
    const m1 = clean(cols[1]);
    const m2 = clean(cols[2]);
    // 멤버 중복 제거
    const members = Array.from(new Set([m1, m2].filter(Boolean)));
    items.push({ name: team, members });
  }
  return items;
}

export async function upsertTeams(items) {
  ensureSB();
  const sb = AppState.sb;
  let ok = 0, skip = 0, fail = 0;

  // 기존 팀 캐시
  const { data: existTeams, error: existErr } = await sb.from('teams').select('id,name');
  if (existErr) throw existErr;
  const exist = new Map((existTeams || []).map(t => [t.name.toLowerCase().trim(), t.id]));

  for (const it of items) {
    const key = it.name.toLowerCase().trim();
    let teamId = exist.get(key);

    // 팀 생성(없으면)
    if (!teamId) {
      const { data: ins, error } = await sb.from('teams')
        .insert({ name: it.name })
        .select('id')
        .maybeSingle();
      if (error || !ins?.id) { fail++; continue; }
      teamId = ins.id;
      exist.set(key, teamId);
      ok++;
    } else {
      skip++;
    }

    // 멤버 upsert: (team_id, member_name) 유니크 충돌 시 무시
    const rows = (it.members || []).map(n => ({ team_id: teamId, member_name: n }));
    if (rows.length) {
      const { error: memErr } = await sb.from('team_members')
        .upsert(rows, { onConflict: 'team_id,member_name', ignoreDuplicates: true })
        .select('id'); // returning
      if (memErr) {
        // 멤버는 경고만 띄우고 계속 진행
        console.warn('member upsert warning:', memErr.message);
      }
    }
  }
  return { ok, skip, fail };
}

export async function loadTeams() {
  ensureSB();
  const { data, error } = await AppState.sb.from('teams').select('id,name').order('name');
  if (error) throw error;
  AppState.teamsCache = data || [];
  AppState.teamMap = new Map(AppState.teamsCache.map(t => [t.id, t.name]));
  return AppState.teamsCache;
}

export async function getTeamMap() {
  if (!AppState.teamMap || AppState.teamMap.size === 0) {
    await loadTeams();
  }
  return AppState.teamMap;
}

/* =========================
 * 2) 조편성
 * ========================= */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function planGroups({ mode = 'auto', groupSize = 4, teams = [] }) {
  const n = teams.length;
  if (mode === 'auto') {
    if (n <= 5) return { mode: 'fullleague', groups: [{ code: 'A', teams: teams.map((t, i) => ({ ...t, seed: i + 1 })) }] };
    mode = 'groups';
  }
  if (mode === 'fullleague') {
    return { mode, groups: [{ code: 'A', teams: teams.map((t, i) => ({ ...t, seed: i + 1 })) }] };
  }
  const codes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const groups = [];
  let gi = 0;
  for (let i = 0; i < teams.length; i += groupSize) {
    const chunk = teams.slice(i, i + groupSize);
    groups.push({ code: codes[gi++], teams: chunk.map((t, idx) => ({ ...t, seed: idx + 1 })) });
  }
  return { mode: 'groups', groups };
}

export async function lockGroups(plan) {
  ensureSB();
  const sb = AppState.sb;
  // 기존 그룹/배정 초기화
  await sb.from('group_teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  for (const g of plan.groups) {
    const { data: gIns, error: ge } = await sb.from('groups')
      .insert({ code: g.code, name: `${g.code}조`, locked: true })
      .select('id')
      .maybeSingle();
    if (ge) throw ge;

    for (const t of g.teams) {
      const { error: ie } = await sb.from('group_teams')
        .insert({ group_id: gIns.id, team_id: t.id, seed: t.seed })
        .select('id')
        .maybeSingle();
      if (ie) throw ie;
    }
  }
  return true;
}

export async function loadGroups() {
  ensureSB();
  const sb = AppState.sb;
  const [{ data: groups, error: e1 }, { data: gt, error: e2 }] = await Promise.all([
    sb.from('groups').select('*').order('code'),
    sb.from('group_teams').select('group_id,team_id,seed')
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  AppState.groupsCache = groups || [];
  AppState.groupTeamsCache = gt || [];
  return { groups: AppState.groupsCache, groupTeams: AppState.groupTeamsCache };
}

/* =========================
 * 3) 경기 생성 (라운드로빈 + 토너먼트)
 * ========================= */
function roundRobinPairs(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push(null); // bye
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const schedule = [];
  for (let r = 0; r < rounds; r++) {
    const pairs = [];
    for (let i = 0; i < half; i++) {
      const a = ids[i], b = ids[n - 1 - i];
      if (a != null && b != null) pairs.push([a, b]);
    }
    schedule.push(pairs);
    const fixed = ids[0];
    const rest = ids.slice(1);
    rest.unshift(rest.pop());
    ids.splice(0, ids.length, fixed, ...rest);
  }
  return schedule;
}

export async function createGroupLeagueMatches() {
  ensureSB();
  const sb = AppState.sb;
  const { groups, groupTeams } = await loadGroups();
  await sb.from('matches').delete().eq('stage', 'group');

  for (const g of groups) {
    const teamIds = groupTeams.filter(x => x.group_id === g.id).sort((a, b) => a.seed - b.seed).map(x => x.team_id);
    if (teamIds.length < 2) continue;
    const rounds = roundRobinPairs(teamIds);
    let roundNo = 1, pos = 1;
    for (const pairs of rounds) {
      for (const [A, B] of pairs) {
        const { error } = await sb.from('matches').insert({
          stage: 'group', group_id: g.id, round: roundNo, bracket_pos: pos++,
          team_a_id: A, team_b_id: B,
          best_of: AppState.cfg.bestOf, points_to_win: AppState.cfg.pointsToWin,
          win_by: AppState.cfg.winBy, cap: AppState.cfg.cap,
          status: 'pending'
        });
        if (error) throw error;
      }
      roundNo++;
    }
  }
  return true;
}

export function decideAdvancers({ groups, advancePerGroup = 1 }) {
  const labels = [];
  for (const g of groups) for (let r = 1; r <= advancePerGroup; r++) labels.push(`${g.code}${r}`);
  return labels.sort();
}
function nextPow2(x) { let p = 1; while (p < x) p <<= 1; return p; }

// 교체: 8강/4강/결승 플레이스홀더(시드 라벨 없이도 동작)
// 진출 팀 수에 따라 qf/sf/final을 정확히 생성
export async function createKnockoutPlaceholders({ advancePerGroup = 1 }) {
  ensureSB();
  const sb = AppState.sb;

  // 그룹 정보로 "잠재 진출 팀 수" 계산
  const { groups } = await loadGroups();
  const seeds = decideAdvancers({ groups, advancePerGroup }); // ["A1","B1",...]
  const n = Math.max(0, seeds.length);

  // 기존 KO 전부 초기화
  await sb.from('matches').delete().in('stage', ['qf', 'sf', 'final']);

  // 공통 필드
  const base = {
    best_of: AppState.cfg.bestOf,
    points_to_win: AppState.cfg.pointsToWin,
    win_by: AppState.cfg.winBy,
    cap: AppState.cfg.cap,
    status: 'pending',
    is_placeholder: true
  };

  // 0~1팀: 결승만 생성(나중에 autoAssign에서 자동 우승 처리)
  if (n <= 1) {
    const { error } = await sb.from('matches').insert({ stage: 'final', bracket_pos: 1, ...base });
    if (error) throw error;
    return true;
  }

  // 2팀: 결승만
  if (n === 2) {
    const { error } = await sb.from('matches').insert({ stage: 'final', bracket_pos: 1, ...base });
    if (error) throw error;
    return true;
  }

  // 3팀: SF #1 + FINAL
  if (n === 3) {
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      sb.from('matches').insert({ stage: 'sf', bracket_pos: 1, ...base }),
      sb.from('matches').insert({ stage: 'final', bracket_pos: 1, ...base }),
    ]);
    if (e1) throw e1; if (e2) throw e2;
    return true;
  }

  // 4팀: SF #1, #2 + FINAL
  if (n === 4) {
    const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
      sb.from('matches').insert({ stage: 'sf', bracket_pos: 1, ...base }),
      sb.from('matches').insert({ stage: 'sf', bracket_pos: 2, ...base }),
      sb.from('matches').insert({ stage: 'final', bracket_pos: 1, ...base }),
    ]);
    if (e1) throw e1; if (e2) throw e2; if (e3) throw e3;
    return true;
  }

  // 5~8팀: QF #1~#4 + SF #1~#2 + FINAL
  if (n >= 5 && n <= 8) {
    const qfs = [1,2,3,4].map(i => ({ stage:'qf', bracket_pos:i, ...base }));
    const sfs = [1,2].map(i => ({ stage:'sf', bracket_pos:i, ...base }));
    const fi  = { stage:'final', bracket_pos:1, ...base };
    const { error } = await sb.from('matches').insert([...qfs, ...sfs, fi]);
    if (error) throw error;
    return true;
  }

  // 그 이상은 현재 스코프 밖(필요시 16강도 동일 패턴으로 확장)
  // 일단 8팀 초과는 8강 브래킷만 생성해 둡니다.
  const qfs = [1,2,3,4].map(i => ({ stage:'qf', bracket_pos:i, ...base }));
  const sfs = [1,2].map(i => ({ stage:'sf', bracket_pos:i, ...base }));
  const fi  = { stage:'final', bracket_pos:1, ...base };
  const { error } = await sb.from('matches').insert([...qfs, ...sfs, fi]);
  if (error) throw error;
  return true;
}


/* =========================
 * 4) 순위 산정 & 브래킷 자동 배정
 * ========================= */

/** 세트 승자 검증 */
export function validateSetWinner(a, b, { points_to_win, win_by, cap }) {
  if (typeof a !== 'number' || typeof b !== 'number') return null;
  if (a < 0 || b < 0) return null;
  if (a === b) return null;

  const hi = Math.max(a, b), lo = Math.min(a, b);
  const lead = hi - lo;

  // cap 우선
  if (cap != null) {
    if (a === cap || b === cap) return a > b ? 'A' : 'B';
  }
  if (hi >= points_to_win && lead >= (win_by ?? 1)) {
    return a > b ? 'A' : 'B';
  }
  return null;
}

function computeWinnerBySets(best_of, set_scores, matchCfg, teamAId, teamBId) {
  const need = Math.floor(best_of / 2) + 1;
  let a = 0, b = 0;
  for (const s of (set_scores || [])) {
    const w = validateSetWinner(s?.a, s?.b, matchCfg);
    if (w === 'A') a++; else if (w === 'B') b++;
  }
  if (a >= need) return teamAId;
  if (b >= need) return teamBId;
  return null;
}

/** 문자열 표기용 */
export function setsToString(sets) {
  if (!Array.isArray(sets) || !sets.length) return '';
  return sets.map(s => {
    const A = (typeof s?.a === 'number') ? s.a : '';
    const B = (typeof s?.b === 'number') ? s.b : '';
    return `${A}\u2013${B}`;
  }).join(', ');
}

/** (옵션) 다음 라운드 슬롯 결정 */
function bracketNext(stage, pos) {
  if (stage === 'qf') {
    if (pos === 1) return { stage: 'sf', pos: 1, slot: 'A' };
    if (pos === 2) return { stage: 'sf', pos: 1, slot: 'B' };
    if (pos === 3) return { stage: 'sf', pos: 2, slot: 'A' };
    if (pos === 4) return { stage: 'sf', pos: 2, slot: 'B' };
  }
  if (stage === 'sf') {
    if (pos === 1) return { stage: 'final', pos: 1, slot: 'A' };
    if (pos === 2) return { stage: 'final', pos: 1, slot: 'B' };
  }
  return null;
}

async function applyWinnerToNext(winnerId, stage, pos) {
  if (!winnerId) return;
  const next = bracketNext(stage, pos);
  if (!next) return;
  const sb = AppState.sb;
  const { data: nextM, error } = await sb.from('matches').select('*')
    .eq('stage', next.stage).eq('bracket_pos', next.pos).maybeSingle();
  if (error) throw error;
  if (!nextM) return;
  const patch = {};
  if (next.slot === 'A' && !nextM.team_a_id) patch.team_a_id = winnerId;
  if (next.slot === 'B' && !nextM.team_b_id) patch.team_b_id = winnerId;
  if (Object.keys(patch).length) {
    const { error: ue } = await sb.from('matches').update(patch).eq('id', nextM.id);
    if (ue) throw ue;
  }
}

/** 스코어 저장 + 자동 진출 반영 */
export async function saveMatchScore(matchId, setArr, resultType = 'normal') {
  ensureSB();
  const sb = AppState.sb;
  const m = await getMatch(matchId);
  if (!m?.team_a_id || !m?.team_b_id) throw new Error('팀이 확정되지 않은 매치입니다.');

  const cfg = {
    points_to_win: m.points_to_win ?? AppState.cfg.pointsToWin,
    win_by: m.win_by ?? AppState.cfg.winBy,
    cap: m.cap ?? AppState.cfg.cap
  };
  const bestOf = m.best_of || AppState.cfg.bestOf;

  let winner = null;
  let status = 'pending';
  let sets = Array.isArray(setArr) ? setArr.filter(s => typeof s?.a === 'number' && typeof s?.b === 'number') : [];

  if (resultType !== 'normal') {
    // WO/부상기권 처리
    winner = (resultType.endsWith('_a')) ? m.team_a_id : m.team_b_id;
    status = 'done';
    sets = [];
  } else {
    const invalid = sets.some(s => !validateSetWinner(s.a, s.b, cfg));
    if (invalid) throw new Error('세트 점수가 규칙(cap/win_by/points_to_win)에 맞지 않습니다.');
    winner = computeWinnerBySets(bestOf, sets, cfg, m.team_a_id, m.team_b_id);
    status = winner ? 'done' : (sets.length > 0 ? 'playing' : 'pending');
  }

  const { error } = await sb.from('matches').update({
    set_scores: sets, winner_id: winner, status, result_type: resultType, updated_at: new Date().toISOString()
  }).eq('id', matchId);
  if (error) throw error;

  if (winner && (m.stage === 'qf' || m.stage === 'sf')) {
    await applyWinnerToNext(winner, m.stage, m.bracket_pos);
  }
  return { winner, status };
}

/* =========================
 * 5) 리스트/조회
 * ========================= */
export async function listGroupMatches() {
  ensureSB();
  const { data, error } = await AppState.sb
    .from('matches')
    .select('*, groups(code)')
    .eq('stage', 'group')
    .order('group_id')
    .order('round')
    .order('bracket_pos');
  if (error) throw error;
  return data || [];
}

export async function listKnockout() {
  ensureSB();
  const { data, error } = await AppState.sb
    .from('matches')
    .select('*')
    .in('stage', ['qf', 'sf', 'final'])
    .order('stage', { ascending: true })
    .order('bracket_pos', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listMatchesByStage(stage = 'all') {
  ensureSB();
  let q = AppState.sb.from('matches').select('*, groups(code)');
  if (stage !== 'all') q = q.eq('stage', stage);
  const { data, error } = await q.order('stage', { ascending: true }).order('group_id').order('round').order('bracket_pos');
  if (error) throw error;
  return data || [];
}

export async function getMatch(id) {
  ensureSB();
  const { data, error } = await AppState.sb.from('matches').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listKnockoutStructured() {
  const arr = await listKnockout();
  const qf = arr.filter(x => x.stage === 'qf').sort((a, b) => a.bracket_pos - b.bracket_pos);
  const sf = arr.filter(x => x.stage === 'sf').sort((a, b) => a.bracket_pos - b.bracket_pos);
  const fi = arr.filter(x => x.stage === 'final').sort((a, b) => a.bracket_pos - b.bracket_pos);
  return { qf, sf, fi };
}

export function labelOrName(m, side = 'a') {
  const id = side === 'a' ? m.team_a_id : m.team_b_id;
  if (id) return AppState.teamMap.get(id) || '팀';
  const label = side === 'a' ? m.seed_label_a : m.seed_label_b;
  return label || 'TBD';
}

/* =========================
 * 6) 자동배정: 뷰 없을 때 자동 계산 Fallback 포함
 * ========================= */

/** 그룹 순위 Fallback 계산(뷰 없이도 동작) */
async function computeStandingsFallback() {
  ensureSB();
  await getTeamMap();

  const sb = AppState.sb;
  // 그룹 및 팀 배정
  const [{ data: groups }, { data: gteams }] = await Promise.all([
    sb.from('groups').select('id,code'),
    sb.from('group_teams').select('group_id,team_id')
  ]);
  const { data: matches } = await sb.from('matches')
    .select('group_id,team_a_id,team_b_id,set_scores,winner_id,result_type,stage')
    .eq('stage', 'group');

  const gidToCode = new Map((groups || []).map(g => [g.id, g.code]));
  const rows = new Map(); // key: `${group_code}:${team_id}` -> {group_code, team_id, team_name, wins, losses, diff}

  function ensureRow(group_code, tid) {
    const key = `${group_code}:${tid}`;
    if (!rows.has(key)) {
      rows.set(key, { group_code, team_id: tid, team_name: AppState.teamMap.get(tid) || '-', wins: 0, losses: 0, diff: 0 });
    }
    return rows.get(key);
  }

  // 초기 팀 엔트리 생성
  for (const gt of (gteams || [])) {
    const code = gidToCode.get(gt.group_id);
    if (!code) continue;
    ensureRow(code, gt.team_id);
  }

  // 경기 반영
  for (const m of (matches || [])) {
    const code = gidToCode.get(m.group_id);
    if (!code || !m.team_a_id || !m.team_b_id) continue;

    const A = ensureRow(code, m.team_a_id);
    const B = ensureRow(code, m.team_b_id);

    // 점수차(diff) 계산
    if (Array.isArray(m.set_scores)) {
      for (const s of m.set_scores) {
        const a = Number(s?.a ?? NaN);
        const b = Number(s?.b ?? NaN);
        if (!Number.isNaN(a) && !Number.isNaN(b)) {
          A.diff += (a - b);
          B.diff += (b - a);
        }
      }
    }

    // 승패
    if (m.winner_id) {
      if (m.winner_id === m.team_a_id) { A.wins++; B.losses++; }
      else if (m.winner_id === m.team_b_id) { B.wins++; A.losses++; }
    }
  }

  // 결과 배열
  return Array.from(rows.values());
}

// 교체: KO 자동 배정
// - v_group_standings(있으면 사용) 없으면 fallback 계산
// - 진출 팀 수에 맞춰 브래킷 단계별 정확한 배치
export async function autoAssignKnockout({ advancePerGroup = 1 }) {
  ensureSB();
  const sb = AppState.sb;

  // 1) standings 확보 (뷰→실패시 fallback)
  let standings = [];
  let se = null;
  try {
    const res = await sb.from('v_group_standings').select('*');
    if (res.error) throw res.error;
    standings = res.data || [];
  } catch (err) {
    se = err;
  }
  if (!standings.length) {
    try { standings = await computeStandingsFallback(); }
    catch (e) { throw new Error('조별 순위 산정 실패(뷰/대체계산 모두 실패): ' + (se?.message || e.message)); }
  }

  // 2) 그룹별 정렬(wins desc, diff desc, name asc) 후 상위 advancePerGroup 뽑기
  const byG = new Map();
  for (const row of (standings || [])) {
    const code = row.group_code || row.code || row.group || row.groups?.code;
    if (!code) continue;
    const arr = byG.get(code) || [];
    arr.push({
      group_code: code,
      team_id: row.team_id,
      team_name: row.team_name || AppState.teamMap.get(row.team_id) || '-',
      wins: Number(row.wins ?? 0),
      diff: Number(row.diff ?? 0)
    });
    byG.set(code, arr);
  }
  for (const [g, arr] of byG.entries()) {
    arr.sort((a,b)=>(b.wins-a.wins)||(b.diff-a.diff)||a.team_name.localeCompare(b.team_name));
    byG.set(g, arr);
  }
  const advancers = [];
  for (const arr of byG.values()) {
    for (let i=0;i<advancePerGroup;i++){
      if (arr[i]) advancers.push(arr[i]);
    }
  }
  // 전체 시드 정렬(그룹 구분 없이)
  advancers.sort((a,b)=>(b.wins-a.wins)||(b.diff-a.diff)||a.team_name.localeCompare(b.team_name));
  const n = advancers.length;

  // 3) 현재 생성된 KO 스켈레톤 조회
  const { data: koAll } = await sb.from('matches').select('*').in('stage',['qf','sf','final']);
  const qf = (koAll||[]).filter(x=>x.stage==='qf').sort((a,b)=>a.bracket_pos-b.bracket_pos);
  const sf = (koAll||[]).filter(x=>x.stage==='sf').sort((a,b)=>a.bracket_pos-b.bracket_pos);
  const fi = (koAll||[]).find(x=>x.stage==='final');

  const up = async (id, patch)=> {
    const { error } = await sb.from('matches').update(patch).eq('id', id);
    if (error) throw error;
  };
  const byeWin = async (m, tid)=> {
    // 한쪽만 있으면 즉시 승자 반영
    await up(m.id, { team_a_id: m.team_a_id||null, team_b_id: m.team_b_id||null, status:'done', winner_id: tid });
  };

  // 4) 경우의 수별 배치
  if (n <= 1) {
    // 우승 확정(결승만 있는 상태)
    if (fi) {
      const champ = advancers[0]?.team_id || null;
      if (champ) await up(fi.id, { team_a_id: champ, team_b_id: null, status: 'done', winner_id: champ });
    }
    return true;
  }

  if (n === 2) {
    // 결승만
    if (fi) {
      const A = advancers[0]?.team_id || null;
      const B = advancers[1]?.team_id || null;
      let patch = { team_a_id: A, team_b_id: B, status: 'pending', winner_id: null };
      if (A && !B) patch = { team_a_id: A, team_b_id: null, status:'done', winner_id: A };
      if (!A && B) patch = { team_a_id: null, team_b_id: B, status:'done', winner_id: B };
      await up(fi.id, patch);
    }
    return true;
  }

  if (n === 3) {
    // SF #1: 2위 vs 3위, FINAL: 탑시드 부전승으로 결승 직행
    if (!sf.length || !fi) return true; // 스켈레톤 없음(안전장치)
    const top = advancers[0]?.team_id || null;
    const s2  = advancers[1]?.team_id || null;
    const s3  = advancers[2]?.team_id || null;

    await up(sf[0].id, { team_a_id: s2, team_b_id: s3, status:'pending', winner_id:null });
    // bracketNext 규칙상 SF #1 승자가 결승의 slot A 로 들어가므로,
    // 탑시드는 결승 slot B에 배치
    let patch = { team_a_id: null, team_b_id: top, status:'pending', winner_id:null };
    if (top && (!s2 || !s3)) {
      // 이례적으로 2/3위 중 결원이 있으면 결승도 즉시 확정 가능
      patch = { team_a_id: null, team_b_id: top, status: 'pending', winner_id: null };
    }
    await up(fi.id, patch);
    return true;
  }

  if (n === 4) {
    // SF #1: 1 vs 4, SF #2: 2 vs 3
    if (sf.length < 2 || !fi) return true;
    const id = (i)=>advancers[i]?.team_id || null;
    await up(sf[0].id, { team_a_id: id(0), team_b_id: id(3), status:'pending', winner_id:null });
    await up(sf[1].id, { team_a_id: id(1), team_b_id: id(2), status:'pending', winner_id:null });
    return true;
  }

  // 5~8팀 → 8강 시드: QF #1: 1v8, #2:4v5, #3:3v6, #4:2v7
  if (qf.length) {
    const id = (i)=>advancers[i]?.team_id || null;
    const pairs = [
      [id(0), id(7)], // QF1
      [id(3), id(4)], // QF2
      [id(2), id(5)], // QF3
      [id(1), id(6)], // QF4
    ];
    for (let i=0;i<qf.length;i++){
      const A = pairs[i]?.[0] || null;
      const B = pairs[i]?.[1] || null;
      if (A && B) {
        await up(qf[i].id, { team_a_id:A, team_b_id:B, status:'pending', winner_id:null });
      } else if (A || B) {
        await byeWin(qf[i], A || B);
      } else {
        await up(qf[i].id, { team_a_id:null, team_b_id:null, status:'pending', winner_id:null });
      }
    }
    // (QF에서 부전승으로 완료된 경기는 saveMatchScore 없이도 next 라운드 수동 배정 필요 X)
    return true;
  }

  return true;
}


/* =========================
 * 7) Export/Reset
 * ========================= */
export async function resetTournament() {
  ensureSB();
  const sb = AppState.sb;
  await sb.from('matches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('group_teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('groups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('team_members').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('teams').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

export async function exportJson() {
  ensureSB();
  const sb = AppState.sb;
  const [teams, members, groups, gteams, matches] = await Promise.all([
    sb.from('teams').select('*'),
    sb.from('team_members').select('*'),
    sb.from('groups').select('*'),
    sb.from('group_teams').select('*'),
    sb.from('matches').select('*')
  ]);
  return JSON.stringify({
    teams: teams.data || [], team_members: members.data || [],
    groups: groups.data || [], group_teams: gteams.data || [], matches: matches.data || []
  }, null, 2);
}

/* =========================
 * 8) Realtime
 * ========================= */
export function subscribeRealtime(onChange) {
  if (!AppState.sb) return;
  if (AppState.rtChannel) {
    try { AppState.sb.removeChannel(AppState.rtChannel); } catch {}
    AppState.rtChannel = null;
  }
  const ch = AppState.sb.channel('realtime-matches')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, payload => onChange?.(payload))
    .subscribe();
  AppState.rtChannel = ch;
  return ch;
}
