-- Resumen semanal: el domingo a las 20 (hora local) se guarda un snapshot de la semana
-- (lunes a domingo) y se manda un push. La app también muestra la semana en curso en vivo.

create table public.weekly_summaries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 1),  -- lunes
  stats       jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.weekly_summaries enable row level security;
create policy "read own" on public.weekly_summaries
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Estadísticas de una semana. Fechas locales según settings.timezone.
create or replace function public.weekly_summary_stats(p_user_id uuid, p_week_start date)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with cfg as (
    select coalesce((select s.timezone from public.settings s where s.user_id = p_user_id), 'UTC') as tz
  ),
  today as (
    select (now() at time zone cfg.tz)::date as d from cfg
  ),
  completions as (
    select t.id, t.block_type, (t.completed_at at time zone cfg.tz)::date as done_on
    from public.tasks t, cfg
    where t.user_id = p_user_id and t.done
  ),
  planned as (
    select b.block_type, sum(extract(epoch from (b.end_time - b.start_time)) / 60)::int as minutes
    from generate_series(0, 6) as g(i)
    cross join lateral public.blocks_for_day(p_week_start + g.i, p_user_id) b
    where not b.floating
    group by b.block_type
  ),
  by_type as (
    select k.t as type, k.ord,
           (select count(*) from completions c
             where c.done_on between p_week_start and p_week_start + 6
               and c.block_type is not distinct from k.t) as done,
           (select count(*) from public.tasks x
             where x.user_id = p_user_id and not x.done and x.routine_id is null
               and x.assigned_date between p_week_start and p_week_start + 6
               and x.block_type is not distinct from k.t) as pending,
           coalesce((select p.minutes from planned p where p.block_type = k.t), 0) as planned_minutes
    from (values ('trabajo', 1), ('estudio', 2), ('facultad', 3), ('entreno', 4), ('ocio', 5), ('otro', 6), (null, 7)) as k(t, ord)
  ),
  routine_stats as (
    select r.text, r.created_at,
           count(*) filter (where x.done) as done,
           count(*) as total
    from public.routines r
    join public.tasks x on x.routine_id = r.id
    where r.user_id = p_user_id
      and x.assigned_date between p_week_start and least(p_week_start + 6, (select d from today))
    group by r.id, r.text, r.created_at
  ),
  completion_days as (
    select distinct done_on from completions
  ),
  streak_anchor as (
    select least(p_week_start + 6, (select d from today)) as a
  )
  select jsonb_build_object(
    'week_start',   p_week_start,
    'done',         (select count(*) from completions where done_on between p_week_start and p_week_start + 6),
    'done_prev',    (select count(*) from completions where done_on between p_week_start - 7 and p_week_start - 1),
    'pending',      (select count(*) from public.tasks x
                      where x.user_id = p_user_id and not x.done and x.routine_id is null
                        and x.assigned_date between p_week_start and p_week_start + 6),
    'active_days',  (select count(*) from completion_days where done_on between p_week_start and p_week_start + 6),
    'streak',       (select coalesce(min(g.i), 366) from generate_series(0, 366) as g(i), streak_anchor sa
                      where not exists (select 1 from completion_days cd where cd.done_on = sa.a - g.i)),
    'planned_minutes', (select coalesce(sum(minutes), 0) from planned),
    'atypical_days',   (select count(*) from public.day_overrides o
                         where o.user_id = p_user_id and o.is_atypical
                           and o.override_date between p_week_start and p_week_start + 6),
    'by_type',      (select coalesce(jsonb_agg(jsonb_build_object(
                        'type', type, 'done', done, 'pending', pending, 'planned_minutes', planned_minutes) order by ord), '[]'::jsonb)
                      from by_type where done + pending + planned_minutes > 0),
    'routines',     (select coalesce(jsonb_agg(jsonb_build_object('text', text, 'done', done, 'total', total) order by created_at), '[]'::jsonb)
                      from routine_stats),
    'stuck',        (select coalesce(jsonb_agg(jsonb_build_object('text', s.text, 'rollover_count', s.rollover_count) order by s.rollover_count desc), '[]'::jsonb)
                      from (select x.text, x.rollover_count from public.tasks x
                             where x.user_id = p_user_id and not x.done and x.rollover_count >= 2
                             order by x.rollover_count desc, x.created_at limit 5) s)
  );
$$;

-- Desde la app: la semana en curso (o cualquier otra) del usuario logueado.
create or replace function public.my_week_stats(p_week_start date)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select public.weekly_summary_stats(auth.uid(), p_week_start);
$$;

-- Cron: los domingos desde las 20 (hora local) guarda el resumen de la semana, una sola vez.
create or replace function public.generate_weekly_summaries()
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  created integer;
begin
  insert into public.weekly_summaries (user_id, week_start, stats)
  select s.user_id, l.d - 6, public.weekly_summary_stats(s.user_id, l.d - 6)
  from public.settings s
  cross join lateral (select (now() at time zone s.timezone) as ts, (now() at time zone s.timezone)::date as d) l
  where extract(dow from l.d) = 0 and l.ts::time >= time '20:00'
  on conflict (user_id, week_start) do nothing;
  get diagnostics created = row_count;
  return created;
end;
$$;

revoke execute on function public.generate_weekly_summaries() from public, anon, authenticated;
revoke execute on function public.weekly_summary_stats(uuid, date) from public, anon;

-- Resúmenes recién guardados que todavía no se avisaron (solo de las últimas 2 semanas).
create or replace function public.due_weekly_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with fresh as (
    select w.user_id, 'weekly:' || w.week_start as key, w.stats
    from public.weekly_summaries w
    where w.week_start >= current_date - 13
      and exists (select 1 from public.push_subscriptions p where p.user_id = w.user_id)
  ),
  content as (
    select f.user_id, f.key,
           '📊 Tu semana' as title,
           (f.stats->>'done') || ' tareas hechas'
             || case
                  when (f.stats->>'done')::int > (f.stats->>'done_prev')::int
                    then ' (+' || ((f.stats->>'done')::int - (f.stats->>'done_prev')::int) || ' vs la anterior)'
                  when (f.stats->>'done')::int < (f.stats->>'done_prev')::int
                    then ' (' || ((f.stats->>'done')::int - (f.stats->>'done_prev')::int) || ' vs la anterior)'
                  else '' end
             || case when (f.stats->>'pending')::int > 0 then ' · ' || (f.stats->>'pending') || ' pendientes' else '' end
             || case when (f.stats->>'streak')::int > 1 then ' · 🔥 ' || (f.stats->>'streak') || ' días de racha' else '' end
             || '. Tocá para ver el resumen.' as body
    from fresh f
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'weekly_summary', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body, '/?view=resumen'
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

-- Todo lo que la Edge Function "push" tiene que mandar en esta pasada.
create or replace function public.due_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  select b.user_id, b.key, b.title, b.body, '/' from public.due_block_notifications() b
  union all
  select w.user_id, w.key, w.title, w.body, w.url from public.due_weekly_notifications() w;
$$;

revoke execute on function public.due_weekly_notifications() from public, anon, authenticated;
revoke execute on function public.due_notifications() from public, anon, authenticated;

select cron.schedule('weekly-summary', '0 * * * *', $$select public.generate_weekly_summaries()$$);
