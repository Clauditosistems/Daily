-- Rediseño "sin señalar fallas":
--   * "✓ Estuve" por bloque y día (block_checkins) → base del % de bloques cumplidos.
--   * Ocio protegido: sin tareas ni rutinas, siempre con horario fijo.
--   * Una tarea puede ir en un bloque de otro tipo (el tipo ya no se pisa con el del bloque).
--   * Rutinas generadas por el servidor (cron), aunque no se abra la app.
--   * Avisos: inicio de bloque con UNA tarea, mitad de bloque, fin del ocio, cierre del día.
--   * Racha semanal: semanas seguidas con >= 50% de bloques cumplidos; resumen en positivo.

-- ─── PREFERENCIAS ────────────────────────────────────────────
alter table public.settings
  add column notify_midblock boolean not null default true,  -- a mitad de bloques de más de 90 min
  add column notify_ocio     boolean not null default true,  -- inicio y fin del tiempo libre
  add column notify_dayclose boolean not null default true;  -- al terminar el último bloque del día

-- ─── "✓ ESTUVE" ──────────────────────────────────────────────
create table public.block_checkins (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  block_id    uuid not null references public.weekly_blocks (id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  unique (user_id, block_id, day)
);
alter table public.block_checkins enable row level security;
create policy "own rows" on public.block_checkins
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ─── OCIO PROTEGIDO ──────────────────────────────────────────
-- Los bloques de ocio flexibles pasan a horario fijo (salvo que eso los haga pisarse con otro).
update public.weekly_blocks w
   set floating = false
 where w.block_type = 'ocio' and w.floating
   and not exists (
     select 1 from public.weekly_blocks o
      where o.user_id = w.user_id and o.id <> w.id and o.day_of_week = w.day_of_week and not o.floating
        and public.timerange(o.start_time, o.end_time, '[)') && public.timerange(w.start_time, w.end_time, '[)'));
alter table public.weekly_blocks
  add constraint ocio_not_floating check (not (block_type = 'ocio' and floating)) not valid;

-- Tareas y rutinas no pueden ser de ocio.
update public.tasks    set block_type = null where block_type = 'ocio';
update public.routines set block_type = null where block_type = 'ocio';
alter table public.tasks    add constraint tasks_not_ocio    check (block_type is distinct from 'ocio');
alter table public.routines add constraint routines_not_ocio check (block_type is distinct from 'ocio');

-- ─── TAREA EN BLOQUE DE OTRO TIPO ────────────────────────────
-- Antes el trigger copiaba el tipo del bloque a la tarea; ahora solo sincroniza done/completed_at.
-- Una tarea no puede quedar atada a un bloque de ocio.
create or replace function public.tasks_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done and new.completed_at is null then
    new.completed_at := now();
  elsif not new.done then
    new.completed_at := null;
  end if;

  if new.block_id is not null
     and exists (select 1 from public.weekly_blocks b where b.id = new.block_id and b.block_type = 'ocio') then
    new.block_id := null;
  end if;
  return new;
end;
$$;

-- ─── RUTINAS DESDE EL SERVIDOR ───────────────────────────────
-- Crea las instancias de hoy a hoy+p_days para cada rutina activa (fecha local de cada usuario),
-- salteando días atípicos. Idempotente por (routine_id, assigned_date).
create or replace function public.generate_routine_tasks(p_days int default 7)
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  created integer;
begin
  with r as (
    select ro.*, (now() at time zone s.timezone)::date as today
    from public.routines ro
    join public.settings s on s.user_id = ro.user_id
    where ro.active
  ),
  slots as (
    select r.id, r.user_id, r.text, r.block_type, r.prio, r.scheduled_time, g.d::date as day
    from r
    cross join lateral generate_series(
      greatest(r.today, coalesce(r.generated_until + 1, r.today)), r.today + p_days, interval '1 day') as g(d)
    where extract(dow from g.d)::smallint = any (r.days_of_week)
      and not exists (select 1 from public.day_overrides o
                       where o.user_id = r.user_id and o.override_date = g.d::date and o.is_atypical)
  ),
  ins as (
    insert into public.tasks (user_id, routine_id, assigned_date, text, block_type, prio, scheduled_time)
    select s.user_id, s.id, s.day, s.text, s.block_type, s.prio, s.scheduled_time from slots s
    on conflict (routine_id, assigned_date) do nothing
    returning 1
  )
  select count(*) into created from ins;

  update public.routines ro
     set generated_until = (now() at time zone s.timezone)::date + p_days
    from public.settings s
   where s.user_id = ro.user_id and ro.active
     and (ro.generated_until is null or ro.generated_until < (now() at time zone s.timezone)::date + p_days);

  return created;
end;
$$;

revoke execute on function public.generate_routine_tasks(int) from public, anon, authenticated;
select cron.schedule('routine-tasks', '20 * * * *', $$select public.generate_routine_tasks()$$);

-- ─── HELPERS DE AVISOS ───────────────────────────────────────
create or replace function public.block_icon(p_type text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
    when p_type is null       then '✓ '
    when p_type = 'trabajo'  then '💼 '
    when p_type = 'estudio'  then '📚 '
    when p_type = 'facultad' then '🎓 '
    when p_type = 'entreno'  then '🏋️ '
    when p_type = 'ocio'     then '🎮 '
    else '✦ ' end;
$$;

-- ¿El bloque cuenta como cumplido ese día? Alguna tarea suya hecha o "✓ Estuve".
create or replace function public.block_done(p_user_id uuid, p_block_id uuid, p_block_type text, p_day date)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select exists (
           select 1 from public.tasks t
            where t.user_id = p_user_id and t.done and t.assigned_date = p_day
              and (t.block_id = p_block_id or (t.block_id is null and t.block_type = p_block_type)))
      or exists (
           select 1 from public.block_checkins c
            where c.user_id = p_user_id and c.block_id = p_block_id and c.day = p_day);
$$;

-- Primera tarea pendiente del bloque ese día (hora, prioridad, antigüedad).
create or replace function public.first_task(p_user_id uuid, p_block_id uuid, p_block_type text, p_day date)
returns text
language sql stable security invoker
set search_path = ''
as $$
  select t.text from public.tasks t
   where t.user_id = p_user_id and t.assigned_date = p_day and not t.done
     and (p_block_id is null or t.block_id = p_block_id or (t.block_id is null and t.block_type = p_block_type))
   order by t.scheduled_time nulls last, case t.prio when 'high' then 0 when 'mid' then 1 else 2 end, t.created_at
   limit 1;
$$;

-- ─── AVISO DE INICIO DE BLOQUE (una sola tarea; ocio en tono de permiso) ──
create or replace function public.due_block_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, s.notify_blocks, s.notify_ocio, (now() at time zone s.timezone) as local_now
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  due as (
    select u.user_id, u.local_now::date as day, b.*
    from users u
    cross join lateral public.blocks_for_day(u.local_now::date, u.user_id) b
    where not b.floating
      and ((b.block_type = 'ocio' and u.notify_ocio) or (b.block_type <> 'ocio' and u.notify_blocks))
      and u.local_now::date + b.start_time <= u.local_now
      and u.local_now::date + b.start_time >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  content as (
    select d.user_id,
           'block:' || d.block_id || ':' || d.day as key,
           case when d.block_type = 'ocio'
                then '🎮 Tiempo libre hasta las ' || to_char(d.end_time, 'HH24:MI')
                else public.block_icon(d.block_type) || coalesce(d.label, initcap(d.block_type)) || ' · ' || to_char(d.start_time, 'HH24:MI')
           end as title,
           case when d.block_type = 'ocio'
                then 'Está en el plan, disfrutalo.'
                else coalesce('Para arrancar: ' || public.first_task(d.user_id, d.block_id, d.block_type, d.day),
                              'Sin tareas puntuales: usalo para lo que necesites.')
           end as body
    from due d
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'block_start', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

-- ─── MITAD DE BLOQUE, FIN DEL OCIO Y CIERRE DEL DÍA ──────────
create or replace function public.due_flow_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, s.timezone, s.notify_midblock, s.notify_ocio, s.notify_dayclose,
           (now() at time zone s.timezone) as local_now,
           (now() at time zone s.timezone)::date as today
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  today_blocks as (
    select u.*, b.block_id, b.block_type, b.label, b.floating, b.start_time, b.end_time
    from users u
    cross join lateral public.blocks_for_day(u.today, u.user_id) b
  ),
  mid as (
    select tb.user_id,
           'mid:' || tb.block_id || ':' || tb.today as key,
           public.block_icon(tb.block_type) || 'Mitad del bloque de ' || coalesce(tb.label, initcap(tb.block_type)) as title,
           case when public.block_done(tb.user_id, tb.block_id, tb.block_type, tb.today)
                then 'Ya sumaste en este bloque. Seguí a tu ritmo.'
                else 'Si ya estás en eso, bien ahí. Si no, 10 minutos alcanzan para arrancar.' end as body,
           '/?view=agenda&mode=ahora' as url
    from today_blocks tb
    where tb.notify_midblock and not tb.floating and tb.block_type <> 'ocio'
      and (tb.end_time - tb.start_time) > interval '90 minutes'
      and tb.today + tb.start_time + (tb.end_time - tb.start_time) / 2 <= tb.local_now
      and tb.today + tb.start_time + (tb.end_time - tb.start_time) / 2 >  tb.local_now - make_interval(mins => p_window_minutes)
  ),
  ocio_end as (
    select tb.user_id,
           'ocio-end:' || tb.block_id || ':' || tb.today as key,
           '🎮 Terminó el tiempo libre' as title,
           coalesce(
             (select 'Lo que sigue: ' || public.block_icon(n.block_type) || coalesce(n.label, initcap(n.block_type))
                     || ' a las ' || to_char(n.start_time, 'HH24:MI') || '.'
                from public.blocks_for_day(tb.today, tb.user_id) n
               where n.start_time >= tb.end_time and n.block_type <> 'ocio'
               order by n.start_time limit 1),
             'Por hoy no hay más bloques.') as body,
           '/?view=agenda&mode=ahora' as url
    from today_blocks tb
    where tb.notify_ocio and tb.block_type = 'ocio' and not tb.floating
      and tb.today + tb.end_time <= tb.local_now
      and tb.today + tb.end_time >  tb.local_now - make_interval(mins => p_window_minutes)
  ),
  closing as (
    select u.*, (select max(b.end_time) from public.blocks_for_day(u.today, u.user_id) b where not b.floating) as last_end
    from users u
    where u.notify_dayclose
  ),
  day_close as (
    select c.user_id,
           'dayclose:' || c.today as key,
           case when dn.n > 0 then '🌙 Cierre del día' else '🌙 Para mañana' end as title,
           case when dn.n > 0
                then 'Hoy hiciste ' || dn.n || case when dn.n = 1 then ' cosa' else ' cosas' end
                     || coalesce(': ' || dn.types, '') || '. '
                else '' end
             || coalesce('Mañana arrancás con ' || public.block_icon(tb.block_type) || coalesce(tb.label, initcap(tb.block_type))
                         || ' a las ' || to_char(tb.start_time, 'HH24:MI') || '.',
                         'Mañana no tenés bloques.')
             || case when dn.n = 0 and ft.text is not null then ' La primera: ' || ft.text || '.' else '' end
             || case when dn.n > 0 and pc.n > 0
                     then ' ' || pc.n || case when pc.n = 1 then ' cosa pasa' else ' cosas pasan' end || ' a mañana.'
                     else '' end as body,
           '/' as url
    from closing c
    cross join lateral (
      select coalesce(sum(g.n), 0)::int as n,
             string_agg(public.block_icon(g.block_type) || g.n, ' · ' order by g.n desc) as types
      from (select t.block_type, count(*)::int as n from public.tasks t
             where t.user_id = c.user_id and t.done and (t.completed_at at time zone c.timezone)::date = c.today
             group by t.block_type) g
    ) dn
    left join lateral (
      select b.block_id, b.block_type, b.label, b.start_time
      from public.blocks_for_day(c.today + 1, c.user_id) b
      where b.block_type <> 'ocio'
      order by b.start_time limit 1
    ) tb on true
    left join lateral (
      select public.first_task(c.user_id, tb.block_id, tb.block_type, c.today + 1) as text
    ) ft on true
    cross join lateral (
      select count(*)::int as n from public.tasks t
       where t.user_id = c.user_id and t.assigned_date = c.today and not t.done and t.routine_id is null
    ) pc
    where c.last_end is not null
      and c.today + c.last_end <= c.local_now
      and c.today + c.last_end >  c.local_now - make_interval(mins => p_window_minutes)
  ),
  content as (
    select * from mid
    union all select * from ocio_end
    union all select * from day_close
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'flow', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body, c.url
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

revoke execute on function public.due_flow_notifications(int) from public, anon, authenticated;

-- ─── BLOQUES DE UNA SEMANA Y RACHA ───────────────────────────
-- Bloques ya empezados de la semana (sin ocio; los atípicos y cancelados no aparecen en blocks_for_day),
-- desde que el usuario armó su semana, con si cuentan como cumplidos.
create or replace function public.week_blocks(p_user_id uuid, p_week_start date)
returns table (day date, block_id uuid, block_type text, done boolean)
language sql stable security invoker
set search_path = ''
as $$
  with cfg as (
    select now() at time zone coalesce((select s.timezone from public.settings s where s.user_id = p_user_id), 'UTC') as local_now,
           (select min(w.created_at)::date from public.weekly_blocks w where w.user_id = p_user_id) as since
  )
  select g.d::date, b.block_id, b.block_type,
         public.block_done(p_user_id, b.block_id, b.block_type, g.d::date)
  from cfg
  cross join generate_series(p_week_start, p_week_start + 6, interval '1 day') as g(d)
  cross join lateral public.blocks_for_day(g.d::date, p_user_id) b
  where b.block_type <> 'ocio'
    and cfg.since is not null and g.d::date >= cfg.since
    and g.d::date + b.start_time <= cfg.local_now;
$$;

-- Semanas seguidas (hasta p_week_start) con >= 50% de bloques cumplidos.
-- Semanas sin bloques que contar son neutras; la semana en curso solo suma, nunca corta.
create or replace function public.week_streak(p_user_id uuid, p_week_start date)
returns table (streak int, best int)
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  ws       date;
  total    int;
  cumplido int;
  run      int := 0;
  best_run int := 0;
  today    date := (now() at time zone coalesce((select s.timezone from public.settings s where s.user_id = p_user_id), 'UTC'))::date;
begin
  for i in reverse 51..0 loop
    ws := p_week_start - 7 * i;
    select count(*), count(*) filter (where wb.done) into total, cumplido
      from public.week_blocks(p_user_id, ws) wb;
    if total = 0 then
      continue;
    elsif cumplido * 2 >= total then
      run := run + 1;
      best_run := greatest(best_run, run);
    elsif ws + 6 < today then
      run := 0;
    end if;
  end loop;
  streak := run;
  best := best_run;
  return next;
end;
$$;

-- ─── RESUMEN SEMANAL (en positivo) ───────────────────────────
create or replace function public.weekly_summary_stats(p_user_id uuid, p_week_start date)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with cfg as (
    select coalesce((select s.timezone from public.settings s where s.user_id = p_user_id), 'UTC') as tz
  ),
  completions as (
    select t.block_type, (t.completed_at at time zone cfg.tz)::date as done_on
    from public.tasks t, cfg
    where t.user_id = p_user_id and t.done
  ),
  wb as (
    select * from public.week_blocks(p_user_id, p_week_start)
  ),
  planned as (
    select coalesce(sum(extract(epoch from (b.end_time - b.start_time)) / 60), 0)::int as minutes
    from generate_series(0, 6) as g(i)
    cross join lateral public.blocks_for_day(p_week_start + g.i, p_user_id) b
    where not b.floating
  ),
  by_type as (
    select k.t as type, k.ord,
           (select count(*) from wb where wb.block_type = k.t)::int as blocks_total,
           (select count(*) from wb where wb.block_type = k.t and wb.done)::int as blocks_done,
           (select count(*) from completions c
             where c.done_on between p_week_start and p_week_start + 6
               and c.block_type is not distinct from k.t)::int as done
    from (values ('trabajo', 1), ('estudio', 2), ('facultad', 3), ('entreno', 4), ('otro', 6), (null, 7)) as k(t, ord)
  ),
  routine_stats as (
    select r.text, r.created_at, count(*)::int as done
    from public.routines r
    join public.tasks x on x.routine_id = r.id
    where r.user_id = p_user_id and x.done
      and x.assigned_date between p_week_start and p_week_start + 6
    group by r.id, r.text, r.created_at
  ),
  st as (
    select * from public.week_streak(p_user_id, p_week_start)
  )
  select jsonb_build_object(
    'week_start',      p_week_start,
    'done',            (select count(*) from completions where done_on between p_week_start and p_week_start + 6),
    'done_prev',       (select count(*) from completions where done_on between p_week_start - 7 and p_week_start - 1),
    'pending',         (select count(*) from public.tasks x
                         where x.user_id = p_user_id and not x.done and x.routine_id is null
                           and x.assigned_date between p_week_start and p_week_start + 6),
    'active_days',     (select count(distinct done_on) from completions where done_on between p_week_start and p_week_start + 6),
    'atypical_days',   (select count(*) from public.day_overrides o
                         where o.user_id = p_user_id and o.is_atypical
                           and o.override_date between p_week_start and p_week_start + 6),
    'planned_minutes', (select minutes from planned),
    'blocks_total',    (select count(*) from wb),
    'blocks_done',     (select count(*) from wb where wb.done),
    'streak_weeks',    (select st.streak from st),
    'best_streak',     (select st.best from st),
    'by_type',         (select coalesce(jsonb_agg(jsonb_build_object(
                          'type', type, 'blocks_total', blocks_total, 'blocks_done', blocks_done, 'done', done) order by ord), '[]'::jsonb)
                        from by_type where blocks_total + done > 0),
    'routines',        (select coalesce(jsonb_agg(jsonb_build_object('text', text, 'done', done) order by created_at), '[]'::jsonb)
                        from routine_stats)
  );
$$;

create or replace function public.due_weekly_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with fresh as (
    select w.user_id, 'weekly:' || w.week_start as key, w.stats,
           (w.stats->>'done')::int as done, (w.stats->>'done_prev')::int as done_prev,
           (w.stats->>'blocks_total')::int as blocks_total, (w.stats->>'blocks_done')::int as blocks_done,
           coalesce((w.stats->>'streak_weeks')::int, 0) as streak
    from public.weekly_summaries w
    join public.settings s on s.user_id = w.user_id
    where w.week_start >= current_date - 13
      and s.notify_weekly
      and exists (select 1 from public.push_subscriptions p where p.user_id = w.user_id)
  ),
  content as (
    select f.user_id, f.key,
           '📊 Tu semana' as title,
           case when f.done > 0 or f.blocks_done > 0 then
                  case when f.done > 0
                       then 'Hiciste ' || f.done || case when f.done = 1 then ' cosa' else ' cosas' end || ' esta semana'
                            || case when f.done_prev > 0 and f.done > f.done_prev
                                    then ' (+' || (f.done - f.done_prev) || ' más que la anterior)' else '' end
                       else 'Estuviste en tus bloques' end
                  || case when f.blocks_total > 0
                          then ' · ' || round(100.0 * f.blocks_done / f.blocks_total) || '% de tus bloques' else '' end
                  || case when f.streak >= 1
                          then ' · 🔥 ' || f.streak || case when f.streak = 1 then ' semana' else ' semanas' end || ' de racha'
                          else '' end
                  || '.'
                else 'Arranca una semana nueva. Tocá para ver tu plan.' end as body
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

-- ─── TODO LO QUE MANDA LA EDGE FUNCTION ──────────────────────
create or replace function public.due_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  select b.user_id, b.key, b.title, b.body, '/?view=agenda&mode=ahora' from public.due_block_notifications() b
  union all
  select f.user_id, f.key, f.title, f.body, f.url from public.due_flow_notifications() f
  union all
  select t.user_id, t.key, t.title, t.body, t.url from public.due_task_notifications() t
  union all
  select r.user_id, r.key, r.title, r.body, r.url from public.due_reminder_notifications() r
  union all
  select w.user_id, w.key, w.title, w.body, w.url from public.due_weekly_notifications() w;
$$;
