-- 안전한 컬럼 추가(있으면 건너뜀)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='court_no')
  then alter table matches add column court_no int; end if;

  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='scheduled_at')
  then alter table matches add column scheduled_at timestamptz; end if;

  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='finished_at')
  then alter table matches add column finished_at timestamptz; end if;
end$$;

-- 감사 로그
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text,
  match_id bigint references matches(id) on delete set null,
  set_no int,
  score_a int,
  score_b int
);
alter table audit_log enable row level security;
create policy "public read audit" on audit_log for select using (true);
create or replace view v_audit_recent as
select id,at,actor,match_id,set_no,score_a,score_b from audit_log order by id desc limit 300;

-- 일정 뷰
create or replace view v_schedule as
select m.id as match_id,m.stage,m.group_id,m.court_no,m.scheduled_at,m.is_final,
m.team_a_id,ta.name as team_a,m.team_b_id,tb.name as team_b
from matches m join teams ta on ta.id=m.team_a_id join teams tb on tb.id=m.team_b_id
order by coalesce(m.scheduled_at,now()), m.court_no nulls last, m.id;

-- 관리자 RPC: 코트 배정/락/점수(관리자)
create or replace function admin_assign_court(p_match_id bigint,p_court int,p_time timestamptz,p_secret text)
returns void language plpgsql security definer as $$
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  update matches set court_no=p_court, scheduled_at=p_time where id=p_match_id;
end$$;

create or replace function admin_lock_match(p_match_id bigint,p_lock boolean,p_secret text)
returns void language plpgsql security definer as $$
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  update matches set is_final=p_lock, finished_at = case when p_lock then now() else null end where id=p_match_id;
end$$;

create or replace function upsert_score_by_admin(p_match_id bigint,p_set_no int,p_score_a int,p_score_b int,p_secret text,p_actor text default 'admin')
returns void language plpgsql security definer as $$
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  insert into match_sets(match_id,set_no,score_a,score_b)
  values(p_match_id,p_set_no,greatest(0,p_score_a),greatest(0,p_score_b))
  on conflict(match_id,set_no) do update set score_a=excluded.score_a, score_b=excluded.score_b;
  insert into audit_log(actor,match_id,set_no,score_a,score_b) values(coalesce(p_actor,'admin'),p_match_id,p_set_no,p_score_a,p_score_b);
end$$;

-- Realtime: matches/match_sets/audit_log 테이블을 ON
