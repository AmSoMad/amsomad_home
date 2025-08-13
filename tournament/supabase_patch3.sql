-- 조건에 맞는 matches를 일괄 업데이트
create or replace function admin_bulk_update_matches(
  p_secret text,
  p_stage text default null,           -- 'group'|'qf'|'sf'|'final' 필터
  p_group_name text default null,      -- 'A','B',...
  p_court int default null,            -- 특정 코트 필터
  p_id_from bigint default null,       -- ID 범위 시작
  p_id_to bigint default null,         -- ID 범위 끝
  -- 적용 값(널이면 미적용)
  p_best_of int default null,
  p_points_to_win int default null,
  p_win_by int default null,
  p_cap int default null,
  p_set_court int default null,
  p_set_time timestamptz default null,
  p_shift_minutes int default null     -- 일정 일괄 이동(분)
) returns int language plpgsql security definer as $$
declare cnt int;
begin
  if not admin_ok(p_secret) then raise exception 'invalid admin secret'; end if;

  with target as (
    select m.*
    from matches m
    left join groups g on g.id=m.group_id
    where (p_stage is null or m.stage::text=p_stage)
      and (p_group_name is null or g.name=p_group_name)
      and (p_court is null or m.court_no=p_court)
      and (p_id_from is null or m.id>=p_id_from)
      and (p_id_to is null or m.id<=p_id_to)
  )
  update matches m set
    best_of = coalesce(p_best_of, m.best_of),
    points_to_win = coalesce(p_points_to_win, m.points_to_win),
    win_by = coalesce(p_win_by, m.win_by),
    cap = coalesce(p_cap, m.cap),
    court_no = coalesce(p_set_court, m.court_no),
    scheduled_at = coalesce(
      p_set_time,
      case when p_shift_minutes is not null and m.scheduled_at is not null then m.scheduled_at + make_interval(mins=>p_shift_minutes) else m.scheduled_at end
    )
  from target t
  where m.id=t.id
  returning 1 into cnt;

  get diagnostics cnt = row_count;
  return coalesce(cnt,0);
end$$;
