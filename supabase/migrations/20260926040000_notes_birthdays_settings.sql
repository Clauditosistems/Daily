-- Notas e ideas, cumpleaños, hora opcional en tareas y preferencias de notificación.

-- ─── PREFERENCIAS ────────────────────────────────────────────
alter table public.settings
  add column notify_blocks       boolean not null default true,   -- aviso al empezar cada bloque
  add column notify_tasks        boolean not null default true,   -- aviso a la hora de una tarea
  add column notify_weekly       boolean not null default true,   -- resumen del domingo
  add column notify_birthdays    boolean not null default true,
  add column birthday_day_before boolean not null default false,  -- avisar también el día antes
  add column morning_time        time    not null default '09:00'; -- hora de avisos de notas y cumpleaños

-- ─── HORA EN TAREAS Y RUTINAS ────────────────────────────────
alter table public.tasks add column scheduled_time time;
alter table public.routines add column scheduled_time time;  -- se copia a cada instancia

-- ─── NOTAS E IDEAS ───────────────────────────────────────────
create table public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind         text not null default 'note' check (kind in ('note', 'idea')),
  text         text not null check (length(trim(text)) > 0),
  note_date    date,            -- nota con fecha: aparece en la agenda y avisa ese día
  remind_time  time,            -- null = settings.morning_time
  archived     boolean not null default false,
  legacy_id    bigint,          -- id de IndexedDB (migración idempotente)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, legacy_id),
  check (kind = 'note' or (note_date is null and remind_time is null)),
  check (remind_time is null or note_date is not null)
);

create index notes_by_date_idx on public.notes (user_id, note_date) where not archived and note_date is not null;

create trigger notes_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

alter table public.notes enable row level security;
create policy "own rows" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ─── CUMPLEAÑOS ──────────────────────────────────────────────
create table public.birthdays (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  month       smallint not null check (month between 1 and 12),
  day         smallint not null check (day >= 1 and day <= case when month = 2 then 29 when month in (4, 6, 9, 11) then 30 else 31 end),
  year        smallint check (year between 1900 and 2100),  -- opcional, para saber cuántos cumple
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger birthdays_updated_at before update on public.birthdays
  for each row execute function public.set_updated_at();

alter table public.birthdays enable row level security;
create policy "own rows" on public.birthdays
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Fecha del cumpleaños en un año dado (29/2 cae el 28/2 en años no bisiestos).
create or replace function public.birthday_on(p_month int, p_day int, p_year int)
returns date
language sql immutable
set search_path = ''
as $$
  select make_date(p_year, p_month,
    least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int));
$$;

-- ─── AVISOS ──────────────────────────────────────────────────

-- Igual que antes, pero respeta settings.notify_blocks.
create or replace function public.due_block_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, (now() at time zone s.timezone) as local_now
    from public.settings s
    where s.notify_blocks
      and exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  due as (
    select u.user_id, u.local_now::date as day, b.*
    from users u
    cross join lateral public.blocks_for_day(u.local_now::date, u.user_id) b
    where not b.floating
      and u.local_now::date + b.start_time <= u.local_now
      and u.local_now::date + b.start_time >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  content as (
    select d.user_id,
           'block:' || d.block_id || ':' || d.day as key,
           (case d.block_type
              when 'trabajo'  then '💼 ' when 'estudio' then '📚 ' when 'facultad' then '🎓 '
              when 'entreno'  then '🏋️ ' when 'ocio'    then '🎮 ' else '✦ ' end)
             || coalesce(d.label, initcap(d.block_type))
             || ' · ' || to_char(d.start_time, 'HH24:MI') || '–' || to_char(d.end_time, 'HH24:MI') as title,
           coalesce(
             (select case when count(*) = 1 then '1 tarea: ' else count(*) || ' tareas: ' end
                     || string_agg(t.text, ' · ' order by
                          t.scheduled_time nulls last,
                          case t.prio when 'high' then 0 when 'mid' then 1 else 2 end, t.created_at)
                from public.tasks t
               where t.user_id = d.user_id and t.assigned_date = d.day and not t.done
                 and t.block_type = d.block_type
                 and (t.block_id is null or t.block_id = d.block_id)
              having count(*) > 0),
             'Sin tareas asignadas.') as body
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

-- Tareas con hora: aviso a esa hora (si cambia la hora, es otro aviso).
create or replace function public.due_task_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, (now() at time zone s.timezone) as local_now
    from public.settings s
    where s.notify_tasks
      and exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  content as (
    select t.user_id,
           'task:' || t.id || ':' || t.assigned_date || ':' || to_char(t.scheduled_time, 'HH24MI') as key,
           '⏰ ' || to_char(t.scheduled_time, 'HH24:MI') || ' · ' || t.text as title,
           case t.block_type
             when 'trabajo' then '💼 Trabajo' when 'estudio' then '📚 Estudio' when 'facultad' then '🎓 Facultad'
             when 'entreno' then '🏋️ Entreno' when 'ocio' then '🎮 Ocio' when 'otro' then '✦ Otro'
             else 'Tarea de hoy' end as body
    from users u
    join public.tasks t on t.user_id = u.user_id
    where not t.done and t.scheduled_time is not null
      and t.assigned_date = u.local_now::date
      and t.assigned_date + t.scheduled_time <= u.local_now
      and t.assigned_date + t.scheduled_time >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'task', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body, '/'
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

-- Notas con fecha (a su hora o a morning_time) y cumpleaños (a morning_time, hoy y opcionalmente mañana).
create or replace function public.due_reminder_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, s.morning_time, s.notify_birthdays, s.birthday_day_before,
           (now() at time zone s.timezone) as local_now,
           (now() at time zone s.timezone)::date as today
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  note_content as (
    select n.user_id,
           'note:' || n.id || ':' || n.note_date as key,
           '📝 Recordatorio' as title,
           n.text as body
    from users u
    join public.notes n on n.user_id = u.user_id
    where not n.archived and n.kind = 'note' and n.note_date = u.today
      and u.today + coalesce(n.remind_time, u.morning_time) <= u.local_now
      and u.today + coalesce(n.remind_time, u.morning_time) >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  morning_users as (
    select u.* from users u
    where u.notify_birthdays
      and u.today + u.morning_time <= u.local_now
      and u.today + u.morning_time >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  birthday_content as (
    select b.user_id,
           'bday:' || b.id || ':' || extract(year from u.today)::int as key,
           '🎂 Hoy cumple ' || b.name as title,
           case when b.year is not null
                then 'Cumple ' || (extract(year from u.today)::int - b.year) || ' años. ¡Saludalo!'
                else '¡No te olvides de saludar!' end as body
    from morning_users u
    join public.birthdays b on b.user_id = u.user_id
    where public.birthday_on(b.month, b.day, extract(year from u.today)::int) = u.today
    union all
    select b.user_id,
           'bday-pre:' || b.id || ':' || extract(year from u.today + 1)::int,
           '🎂 Mañana cumple ' || b.name,
           case when b.year is not null
                then 'Cumple ' || (extract(year from u.today + 1)::int - b.year) || ' años.'
                else 'Mañana es su cumpleaños.' end
    from morning_users u
    join public.birthdays b on b.user_id = u.user_id
    where u.birthday_day_before
      and public.birthday_on(b.month, b.day, extract(year from u.today + 1)::int) = u.today + 1
  ),
  content as (
    select * from note_content
    union all
    select * from birthday_content
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'reminder', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body, '/'
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

-- Igual que antes, pero respeta settings.notify_weekly.
create or replace function public.due_weekly_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with fresh as (
    select w.user_id, 'weekly:' || w.week_start as key, w.stats
    from public.weekly_summaries w
    join public.settings s on s.user_id = w.user_id
    where w.week_start >= current_date - 13
      and s.notify_weekly
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

create or replace function public.due_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  select b.user_id, b.key, b.title, b.body, '/' from public.due_block_notifications() b
  union all
  select t.user_id, t.key, t.title, t.body, t.url from public.due_task_notifications() t
  union all
  select r.user_id, r.key, r.title, r.body, r.url from public.due_reminder_notifications() r
  union all
  select w.user_id, w.key, w.title, w.body, w.url from public.due_weekly_notifications() w;
$$;

revoke execute on function public.due_task_notifications(int) from public, anon, authenticated;
revoke execute on function public.due_reminder_notifications(int) from public, anon, authenticated;
