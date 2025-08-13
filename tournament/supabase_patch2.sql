do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='timer_started_at')
  then alter table matches add column timer_started_at timestamptz; end if;

  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='timer_elapsed_sec')
  then alter table matches add column timer_elapsed_sec int not null default 0; end if;

  if not exists (select 1 from information_schema.columns where table_name='matches' and column_name='status')
  then alter table matches add column status text not null default 'scheduled' check(status in('scheduled','live','finished')); end if;
end$$;

create or replace function sync_status_with_final() returns trigger language plpgsql as $$
begin
  if new.is_final and new.status<>'finished' then new.status:='finished'; new.finished_at:=coalesce(new.finished_at,now()); end if;
  return new;
end$$;
drop trigger if exists trg_sync_status on matches;
create trigger trg_sync_status before update on matches for each row execute function sync_status_with_final();

create or replace view v_match_timer as
select id as match_id,status,timer_started_at,timer_elapsed_sec,
(timer_elapsed_sec + coalesce(extract(epoch from (now()-timer_started_at))::int,0)) as effective_elapsed_sec
from matches;

create or replace function admin_timer_control(p_match_id bigint,p_action text,p_secret text)
returns void language plpgsql security definer as $$
declare m matches; nowts timestamptz := now();
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;
  select * into m from matches where id=p_match_id for update; if not found then raise exception 'match not found'; end if;

  if p_action='start' then
    if m.timer_started_at is null then update matches set timer_started_at=nowts,status='live' where id=m.id; end if;
  elsif p_action='pause' then
    if m.timer_started_at is not null then
      update matches set timer_elapsed_sec=m.timer_elapsed_sec+extract(epoch from (nowts-m.timer_started_at))::int, timer_started_at=null where id=m.id;
    end if;
  elsif p_action='reset' then
    update matches set timer_started_at=null,timer_elapsed_sec=0,status=case when is_final then 'finished' else 'scheduled' end where id=m.id;
  else raise exception 'invalid action'; end if;
end$$;
