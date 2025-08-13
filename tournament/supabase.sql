create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- 기본 테이블
create table if not exists players (id bigserial primary key, name text unique not null);
create table if not exists groups  (id bigserial primary key, name text unique not null);
create table if not exists teams   (
  id bigserial primary key,
  name text unique not null,
  pin_hash text,
  group_id bigint references groups(id)
);
create table if not exists team_members (
  team_id bigint references teams(id) on delete cascade,
  player_id bigint references players(id) on delete cascade,
  primary key(team_id, player_id)
);

create type match_stage as enum ('group','qf','sf','final');

create table if not exists matches (
  id bigserial primary key,
  stage match_stage not null,
  group_id bigint references groups(id),
  team_a_id bigint not null references teams(id),
  team_b_id bigint not null references teams(id),
  best_of int not null default 1,
  points_to_win int not null default 25,
  win_by int not null default 0,
  cap int,
  is_final boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists match_sets (
  id bigserial primary key,
  match_id bigint not null references matches(id) on delete cascade,
  set_no int not null check (set_no>=1),
  score_a int not null default 0,
  score_b int not null default 0,
  unique(match_id,set_no)
);

-- 관리자 비밀키 저장
create table if not exists settings (key text primary key, value text);

-- ===== 결과/순위용 뷰 =====
create or replace view v_set_results as
select s.match_id,m.stage,m.group_id,m.team_a_id,m.team_b_id,s.set_no,s.score_a,s.score_b,
case when s.score_a>s.score_b then 'A' when s.score_b>s.score_a then 'B' else null end as set_winner
from match_sets s join matches m on m.id=s.match_id;

create or replace view v_match_results as
with agg as (
  select m.id as match_id,m.stage,m.group_id,m.team_a_id,m.team_b_id,
  coalesce(sum(case when r.set_winner='A' then 1 else 0 end),0) as sets_a,
  coalesce(sum(case when r.set_winner='B' then 1 else 0 end),0) as sets_b,
  coalesce(sum(r.score_a),0) as pts_a, coalesce(sum(r.score_b),0) as pts_b, m.is_final
  from matches m left join v_set_results r on r.match_id=m.id group by m.id
)
select *, case when sets_a>sets_b then team_a_id when sets_b>sets_a then team_b_id else null end as winner_team_id
from agg;

create or replace view v_group_stats as
select g.name as group_name, t.id as team_id, t.name as team_name,
count(v.match_id) filter (where v.is_final and (v.team_a_id=t.id or v.team_b_id=t.id)) as played,
count(v.match_id) filter (where v.is_final and v.winner_team_id=t.id) as win,
count(v.match_id) filter (where v.is_final and v.winner_team_id is not null and v.winner_team_id<>t.id and (v.team_a_id=t.id or v.team_b_id=t.id)) as loss,
coalesce(sum(case when v.team_a_id=t.id then v.pts_a when v.team_b_id=t.id then v.pts_b else 0 end),0) as pts_for,
coalesce(sum(case when v.team_a_id=t.id then v.pts_b when v.team_b_id=t.id then v.pts_a else 0 end),0) as pts_against,
coalesce(sum(case when v.team_a_id=t.id then v.sets_a when v.team_b_id=t.id then v.sets_b else 0 end),0) as sets_for,
coalesce(sum(case when v.team_a_id=t.id then v.sets_b when v.team_b_id=t.id then v.sets_a else 0 end),0) as sets_against
from teams t join groups g on g.id=t.group_id
left join v_match_results v on v.group_id=g.id and (v.team_a_id=t.id or v.team_b_id=t.id) and v.stage='group'
group by g.name,t.id,t.name;

create or replace view v_group_ranked as
with base as (
  select *, (pts_for-pts_against) as point_diff, (sets_for-sets_against) as set_diff from v_group_stats
),
h2h as (
  select b1.group_name,b1.team_id,
  coalesce((
    select avg(case when v.winner_team_id=b1.team_id then 1.0 when v.winner_team_id is null then 0.5 else 0 end)
    from v_match_results v
    join teams ot on (ot.id = case when v.team_a_id=b1.team_id then v.team_b_id when v.team_b_id=b1.team_id then v.team_a_id end)
    join v_group_stats s_opp on s_opp.team_id=ot.id
    where v.stage='group' and v.is_final and (v.team_a_id=b1.team_id or v.team_b_id=b1.team_id)
      and s_opp.group_name=b1.group_name and s_opp.win=b1.win
  ),0.0) as h2h_win_pct
  from base b1
)
select b.group_name,b.team_id,b.team_name,b.played,b.win,b.loss,b.pts_for,b.pts_against,b.sets_for,b.sets_against,
(b.sets_for-b.sets_against) as set_diff,(b.pts_for-b.pts_against) as point_diff,h.h2h_win_pct,
row_number() over(partition by b.group_name order by b.win desc,h.h2h_win_pct desc,b.set_diff desc,b.point_diff desc,b.pts_for desc,b.team_name asc) as group_rank
from base b left join h2h h on h.group_name=b.group_name and h.team_id=b.team_id;

-- ===== 트리거: 세트 변경 → 경기 종료여부 재계산 =====
create or replace function recompute_match_finalization(p_match_id bigint) returns void language plpgsql as $$
declare m matches; a int; b int; needed int;
begin
  select * into m from matches where id=p_match_id for update; if not found then return; end if;
  select coalesce(sum(case when r.set_winner='A' then 1 else 0 end),0),
         coalesce(sum(case when r.set_winner='B' then 1 else 0 end),0)
  into a,b from v_set_results r where r.match_id=m.id;
  needed := (m.best_of+1)/2;
  if a>=needed or b>=needed then update matches set is_final=true where id=m.id;
  else update matches set is_final=false where id=m.id; end if;
end$$;

create or replace function trg_match_sets_change() returns trigger language plpgsql as $$
begin
  perform recompute_match_finalization(coalesce(new.match_id, old.match_id)); return null;
end$$;

drop trigger if exists t_match_sets_ins on match_sets;
drop trigger if exists t_match_sets_upd on match_sets;
drop trigger if exists t_match_sets_del on match_sets;
create trigger t_match_sets_ins after insert on match_sets for each row execute function trg_match_sets_change();
create trigger t_match_sets_upd after update on match_sets for each row execute function trg_match_sets_change();
create trigger t_match_sets_del after delete on match_sets for each row execute function trg_match_sets_change();

-- ===== 관리자/팀 RPC =====
create or replace function set_admin_secret(p_secret text) returns void language plpgsql security definer as $$
declare cur text; begin
  select value into cur from settings where key='admin_secret_hash';
  if cur is not null then raise exception 'Admin secret already set'; end if;
  insert into settings(key,value) values('admin_secret_hash', crypt(p_secret, gen_salt('bf')));
end$$;

create or replace function admin_ok(p_secret text) returns boolean language sql as $$
  select exists(select 1 from settings where key='admin_secret_hash' and crypt(p_secret, value)=value);
$$;

create or replace function admin_set_team_pin(p_team_id bigint, p_pin text, p_secret text) returns void language plpgsql security definer as $$
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  update teams set pin_hash=crypt(p_pin, gen_salt('bf')) where id=p_team_id;
end$$;

create or replace function upsert_score_by_pin(
  p_match_id bigint, p_set_no int, p_score_a int, p_score_b int, p_pin text, p_actor text default 'team'
) returns void language plpgsql security definer as $$
declare t1 teams; t2 teams;
begin
  select ta.* into t1 from teams ta join matches m on m.team_a_id=ta.id where m.id=p_match_id;
  select tb.* into t2 from teams tb join matches m on m.team_b_id=tb.id where m.id=p_match_id;
  if t1 is null or t2 is null then raise exception 'match not found'; end if;
  if (t1.pin_hash is not null and crypt(p_pin,t1.pin_hash)=t1.pin_hash)
     or (t2.pin_hash is not null and crypt(p_pin,t2.pin_hash)=t2.pin_hash)
     or (t1.pin_hash is null and t2.pin_hash is null and p_pin is null) then
    insert into match_sets(match_id,set_no,score_a,score_b)
    values(p_match_id,p_set_no,greatest(0,p_score_a),greatest(0,p_score_b))
    on conflict(match_id,set_no) do update set score_a=excluded.score_a, score_b=excluded.score_b;
  else raise exception 'invalid pin'; end if;
end$$;

-- 로스터 업서트 + 조편성 + 라운드로빈
create or replace function admin_upsert_roster_and_seed(
  p_roster jsonb, p_teams_per_group int, p_group_best_of int, p_group_points_to_win int, p_secret text
) returns void language plpgsql security definer as $$
declare tcount int; i int; gcount int; gname text; tid bigint; pid bigint; t jsonb; m text; arr jsonb;
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  delete from match_sets; delete from matches; delete from team_members; delete from players; delete from teams; delete from groups;

  for m in select jsonb_array_elements_text(p_roster->'players') loop
    insert into players(name) values(trim(m)) on conflict do nothing;
  end loop;

  for t in select jsonb_array_elements(p_roster->'teams') loop
    insert into teams(name) values(trim(t->>'name')) returning id into tid;
    arr := t->'members';
    for m in select jsonb_array_elements_text(arr) loop
      insert into players(name) values(trim(m)) on conflict(name) do nothing returning id into pid;
      if pid is null then select id into pid from players where name=trim(m); end if;
      insert into team_members(team_id,player_id) values(tid,pid) on conflict do nothing;
    end loop;
  end loop;

  select count(*) into tcount from teams;
  gcount := ceil(tcount::numeric / p_teams_per_group);
  for i in 0..gcount-1 loop gname := chr(ascii('A')+i); insert into groups(name) values(gname) on conflict do nothing; end loop;

  i := 0;
  for tid in select id from teams order by id loop
    update teams set group_id=(select id from groups order by id limit 1 offset (i / p_teams_per_group)) where id=tid;
    i := i+1;
  end loop;

  for i in (select id from groups order by id) loop
    for tid in (select t1.id from teams t1 where t1.group_id=i.id order by t1.id) loop
      for pid in (select t2.id from teams t2 where t2.group_id=i.id and t2.id>tid order by t2.id) loop
        insert into matches(stage,group_id,team_a_id,team_b_id,best_of,points_to_win,win_by,cap)
        values('group',i.id,tid,pid,p_group_best_of,p_group_points_to_win,0,null);
      end loop;
    end loop;
  end loop;
end$$;

-- 8강 시드 생성
create or replace function admin_generate_knockout(
  p_secret text, p_best_of int default 3, p_points_to_win int default 21, p_win_by int default 2, p_cap int default 30
) returns void language plpgsql security definer as $$
declare g record; top record; seeds bigint[]; needed int:=8; r record;
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  delete from matches where stage in ('qf','sf','final');

  for g in select distinct group_name from v_group_ranked loop
    select team_id into top from v_group_ranked where group_name=g.group_name order by group_rank asc limit 1;
    if top.team_id is not null then seeds := seeds || top.team_id; end if;
  end loop;

  for r in
    select team_id from v_group_ranked where team_id <> all(seeds)
    order by win desc, h2h_win_pct desc, set_diff desc, point_diff desc, pts_for desc
  loop
    exit when coalesce(array_length(seeds,1),0) >= needed;
    seeds := seeds || r.team_id;
  end loop;

  if coalesce(array_length(seeds,1),0) < 2 then raise exception 'not enough teams'; end if;

  perform (with pairs as (
    select 1 a,8 b union all select 4,5 union all select 2,7 union all select 3,6
  ) select case when array_length(seeds,1)>=greatest(a,b)
    then (insert into matches(stage,team_a_id,team_b_id,best_of,points_to_win,win_by,cap)
          values('qf',seeds[a],seeds[b],p_best_of,p_points_to_win,p_win_by,p_cap))
    else null end from pairs);
end$$;

-- 4강/결승 자동 생성
create or replace function admin_advance_knockout(p_secret text) returns void language plpgsql security definer as $$
declare winners bigint[]; fin_exists boolean;
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;

  if not exists(select 1 from matches where stage='sf') then
    select array_agg(case when sets_a>sets_b then team_a_id when sets_b>sets_a then team_b_id end)
    into winners from v_match_results where stage='qf' and is_final order by match_id;
    if array_length(winners,1)=4 then
      insert into matches(stage,team_a_id,team_b_id,best_of,points_to_win,win_by,cap)
      values('sf',winners[1],winners[2],3,21,2,30),
            ('sf',winners[3],winners[4],3,21,2,30);
    end if;
  end if;

  select exists(select 1 from matches where stage='final') into fin_exists;
  if not fin_exists then
    select array_agg(case when sets_a>sets_b then team_a_id when sets_b>sets_a then team_b_id end)
    into winners from v_match_results where stage='sf' and is_final order by match_id;
    if array_length(winners,1)=2 then
      insert into matches(stage,team_a_id,team_b_id,best_of,points_to_win,win_by,cap)
      values('final',winners[1],winners[2],3,21,2,30);
    end if;
  end if;
end$$;

-- ===== RLS =====
alter table players enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table groups enable row level security;
alter table matches enable row level security;
alter table match_sets enable row level security;
alter table settings enable row level security;

create policy "public read players" on players for select using (true);
create policy "public read teams" on teams for select using (true);
create policy "public read team_members" on team_members for select using (true);
create policy "public read groups" on groups for select using (true);
create policy "public read matches" on matches for select using (true);
create policy "public read match_sets" on match_sets for select using (true);
create policy "no read settings" on settings for select using (false);

-- 직접 쓰기 차단
create policy "no write players" on players for all using (false) with check (false);
create policy "no write teams" on teams for all using (false) with check (false);
create policy "no write team_members" on team_members for all using (false) with check (false);
create policy "no write groups" on groups for all using (false) with check (false);
create policy "no write matches" on matches for all using (false) with check (false);
create policy "no write match_sets" on match_sets for all using (false) with check (false);
