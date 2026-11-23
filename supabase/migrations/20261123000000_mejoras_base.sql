-- Mejoras · Etapa 1: cambios de base.
-- SOLO AGREGA: columnas y tablas nuevas, y nuevas versiones de funciones.
-- No borra ni modifica ninguna fila existente (las columnas nuevas arrancan vacías).

-- ─── 1. TAREAS: detalle y "no la hice" ───────────────────────
alter table public.tasks
  add column detail          text,          -- lo específico de ese día ("comprar remeras rojas")
  add column outcome         text check (outcome in ('not_done')),  -- null = sin responder / hecha
  add column detail_moved_at timestamptz;   -- rutina: cuándo su detalle pasó a la próxima vez

comment on column public.tasks.detail is 'Detalle de esta tarea puntual. Nunca lo toca la plantilla de la rutina.';
comment on column public.tasks.outcome is '''not_done'' = el usuario dijo "no la hice": no hace rollover y no cuenta como pendiente.';

-- Igual que antes + marcarla hecha borra el "no la hice".
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

  if new.done then
    new.outcome := null;
  end if;

  if new.block_id is not null
     and exists (select 1 from public.weekly_blocks b where b.id = new.block_id and b.block_type = 'ocio') then
    new.block_id := null;
  end if;
  return new;
end;
$$;

-- ─── 2. SUBTAREAS (un solo nivel) ────────────────────────────
create table public.subtasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  task_id      uuid not null references public.tasks (id) on delete cascade,
  text         text not null check (length(trim(text)) > 0),
  done         boolean not null default false,
  completed_at timestamptz,
  position     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index subtasks_by_task_idx on public.subtasks (task_id, position);

alter table public.subtasks enable row level security;
create policy "own rows" on public.subtasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid())
              and exists (select 1 from public.tasks t where t.id = task_id and t.user_id = (select auth.uid())));

create trigger subtasks_updated_at before update on public.subtasks
  for each row execute function public.set_updated_at();

create or replace function public.subtasks_normalize()
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
  return new;
end;
$$;

create trigger subtasks_normalize before insert or update on public.subtasks
  for each row execute function public.subtasks_normalize();

-- Al marcar la última subtarea, la tarea se completa sola; si se desmarca (o se agrega) una, se reabre.
create or replace function public.subtasks_sync_task()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task  uuid := coalesce(new.task_id, old.task_id);
  v_total int;
  v_done  int;
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- cambio hecho por tasks_sync_subtasks
  select count(*), count(*) filter (where s.done) into v_total, v_done
    from public.subtasks s where s.task_id = v_task;
  if v_total = 0 then return null; end if;
  if v_done = v_total then
    update public.tasks t set done = true where t.id = v_task and not t.done;
  else
    update public.tasks t set done = false where t.id = v_task and t.done;
  end if;
  return null;
end;
$$;

create trigger subtasks_sync_task after insert or update of done or delete on public.subtasks
  for each row execute function public.subtasks_sync_task();

-- Al marcar la tarea entera, se marcan todas sus subtareas.
create or replace function public.tasks_sync_subtasks()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;  -- cambio hecho por subtasks_sync_task
  if new.done and not old.done then
    update public.subtasks s set done = true where s.task_id = new.id and not s.done;
  end if;
  return null;
end;
$$;

create trigger tasks_sync_subtasks after update of done on public.tasks
  for each row execute function public.tasks_sync_subtasks();

-- ─── 3. EVENTOS ──────────────────────────────────────────────
-- Fecha única, hora opcional, repetición anual opcional. No se marcan ni hacen rollover.
create table public.events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                 text not null check (length(trim(title)) > 0),
  detail                text,
  event_date            date not null,
  event_time            time,
  yearly                boolean not null default false,
  notify_before_minutes integer default 30 check (notify_before_minutes between 0 and 43200),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- con hora, el aviso es obligatorio
  check (event_time is null or notify_before_minutes is not null)
);

create index events_by_date_idx on public.events (user_id, event_date);

alter table public.events enable row level security;
create policy "own rows" on public.events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- Fecha de la próxima vez de un evento a partir de un día (anual: este año o el siguiente).
create or replace function public.event_on(p_date date, p_yearly boolean, p_from date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when not p_yearly then p_date
    when public.birthday_on(extract(month from p_date)::int, extract(day from p_date)::int, extract(year from p_from)::int) >= p_from
      then public.birthday_on(extract(month from p_date)::int, extract(day from p_date)::int, extract(year from p_from)::int)
    else public.birthday_on(extract(month from p_date)::int, extract(day from p_date)::int, extract(year from p_from)::int + 1)
  end;
$$;

-- Avisos de eventos: con hora, X minutos antes; sin hora y con aviso, a la hora de la mañana de ese día.
create or replace function public.due_event_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, s.morning_time,
           (now() at time zone s.timezone) as local_now,
           (now() at time zone s.timezone)::date as today
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  occ as (
    -- próxima vez de cada evento desde ayer (cubre avisos que cruzan medianoche)
    select u.*, e.id, e.title as e_title, e.event_time, e.notify_before_minutes,
           public.event_on(e.event_date, e.yearly, u.today - 1) as day
    from users u
    join public.events e on e.user_id = u.user_id
    where e.notify_before_minutes is not null
  ),
  fire as (
    select o.*,
           case when o.event_time is not null
                then o.day + o.event_time - make_interval(mins => o.notify_before_minutes)
                else o.day + o.morning_time end as fire_at
    from occ o
  ),
  content as (
    select f.user_id,
           'event:' || f.id || ':' || f.day as key,
           '📅 ' || f.e_title as title,
           case when f.event_time is null then 'Es hoy.'
                when f.day = f.today then 'Hoy a las ' || to_char(f.event_time, 'HH24:MI') || '.'
                when f.day = f.today + 1 then 'Mañana a las ' || to_char(f.event_time, 'HH24:MI') || '.'
                else to_char(f.day, 'DD/MM') || ' a las ' || to_char(f.event_time, 'HH24:MI') || '.' end as body
    from fire f
    where f.fire_at <= f.local_now
      and f.fire_at >  f.local_now - make_interval(mins => p_window_minutes)
  ),
  claimed as (
    insert into public.push_log (user_id, kind, key)
    select c.user_id, 'event', c.key from content c
    on conflict do nothing
    returning push_log.user_id, push_log.key
  )
  select c.user_id, c.key, c.title, c.body, '/?view=agenda'
  from content c
  join claimed k on k.user_id = c.user_id and k.key = c.key;
$$;

-- Igual que antes + eventos.
create or replace function public.due_notifications()
returns table (user_id uuid, key text, title text, body text, url text)
language sql
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
  select w.user_id, w.key, w.title, w.body, w.url from public.due_weekly_notifications() w
  union all
  select e.user_id, e.key, e.title, e.body, e.url from public.due_event_notifications() e;
$$;

-- ─── 4. AJUSTES: hora del cierre si el día no tiene ocio ─────
alter table public.settings
  add column dayclose_fallback_time time not null default '19:00';

-- ─── 5. ROLLOVER ─────────────────────────────────────────────
-- Igual que antes, salvo:
--  · lo marcado "no la hice" no pasa de día;
--  · rutinas: si una vez quedó sin hacer y tenía detalle, el detalle (y su contador) pasa a la
--    próxima vez de esa rutina, siempre que esa todavía no tenga detalle propio. Nunca se pisa nada.
create or replace function public.rollover_user(p_user_id uuid, p_today date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.tasks t
     set assigned_date  = coalesce(
                            case when t.block_type is not null
                                 then public.next_block_date(p_user_id, t.block_type, p_today) end,
                            p_today),
         block_id       = null,
         rollover_count = t.rollover_count + 1
   where t.user_id = p_user_id
     and not t.done
     and t.outcome is null
     and t.routine_id is null
     and t.assigned_date < p_today;
  get diagnostics moved = row_count;

  with src as (
    select distinct on (o.routine_id) o.id, o.routine_id, o.assigned_date, o.detail, o.rollover_count
      from public.tasks o
     where o.user_id = p_user_id and o.routine_id is not null
       and not o.done and o.outcome is null
       and o.assigned_date < p_today
       and o.detail is not null and length(trim(o.detail)) > 0
       and o.detail_moved_at is null
     order by o.routine_id, o.assigned_date desc
  ),
  dst as (
    select distinct on (s.id) s.id as src_id, n.id as dst_id, s.detail, s.rollover_count
      from src s
      join public.tasks n on n.routine_id = s.routine_id and n.assigned_date >= p_today
     where not n.done and (n.detail is null or length(trim(n.detail)) = 0)
     order by s.id, n.assigned_date
  ),
  upd as (
    update public.tasks n
       set detail = d.detail, rollover_count = d.rollover_count + 1
      from dst d
     where n.id = d.dst_id
    returning d.src_id
  )
  update public.tasks o set detail_moved_at = now()
    from upd where o.id = upd.src_id;

  return moved;
end;
$$;

-- ─── 6. MÉTRICAS ─────────────────────────────────────────────
-- Igual que antes + "pending" no cuenta lo marcado "no la hice",
-- y "steps_done" suma las subtareas hechas de tareas que todavía no se completaron (avance parcial).
create or replace function public.weekly_summary_stats(p_user_id uuid, p_week_start date)
returns jsonb
language sql
stable
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
  steps as (
    select (s.completed_at at time zone cfg.tz)::date as done_on
    from public.subtasks s
    join public.tasks t on t.id = s.task_id, cfg
    where s.user_id = p_user_id and s.done and not t.done
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
    'steps_done',      (select count(*) from steps where done_on between p_week_start and p_week_start + 6),
    'pending',         (select count(*) from public.tasks x
                         where x.user_id = p_user_id and not x.done and x.routine_id is null and x.outcome is null
                           and x.assigned_date between p_week_start and p_week_start + 6),
    'active_days',     (select count(distinct d) from (
                          select done_on as d from completions union all select done_on from steps) a
                         where d between p_week_start and p_week_start + 6),
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

-- Un bloque también cuenta como cumplido si se avanzó una subtarea de una tarea suya.
create or replace function public.block_done(p_user_id uuid, p_block_id uuid, p_block_type text, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
           select 1 from public.tasks t
            where t.user_id = p_user_id and t.done and t.assigned_date = p_day
              and (t.block_id = p_block_id or (t.block_id is null and t.block_type = p_block_type)))
      or exists (
           select 1 from public.subtasks s
             join public.tasks t on t.id = s.task_id
            where s.user_id = p_user_id and s.done and t.assigned_date = p_day
              and (t.block_id = p_block_id or (t.block_id is null and t.block_type = p_block_type)))
      or exists (
           select 1 from public.block_checkins c
            where c.user_id = p_user_id and c.block_id = p_block_id and c.day = p_day);
$$;

-- Actividad por día (mapa de calor): tareas hechas + pasos hechos de tareas en curso.
create or replace function public.activity_by_day(p_from date)
returns table (day date, done integer)
language sql
stable
set search_path = ''
as $$
  select d, count(*)::int
  from (
    select (t.completed_at at time zone s.timezone)::date as d
      from public.tasks t
      join public.settings s on s.user_id = t.user_id
     where t.user_id = auth.uid() and t.done
    union all
    select (x.completed_at at time zone s.timezone)::date
      from public.subtasks x
      join public.tasks t on t.id = x.task_id
      join public.settings s on s.user_id = x.user_id
     where x.user_id = auth.uid() and x.done and not t.done
  ) a
  where d >= p_from
  group by d
  order by d;
$$;
