-- Notificaciones push: aviso al empezar cada bloque, con las tareas que tiene.
--
-- Flujo: pg_cron (cada minuto) → pg_net → Edge Function "push" → due_block_notifications()
--        → web push a cada suscripción del usuario.

-- Claves VAPID y otros secretos del backend. Sin políticas RLS: solo el service role las lee.
-- La Edge Function genera las claves la primera vez que corre.
create table public.app_secrets (
  key    text primary key,
  value  text not null
);
alter table public.app_secrets enable row level security;

-- Qué se mandó, para no repetir un aviso aunque el cron corra varias veces en la ventana.
create table public.push_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  kind     text not null,
  key      text not null,
  sent_at  timestamptz not null default now(),
  unique (user_id, key)
);
alter table public.push_log enable row level security;
create policy "read own" on public.push_log
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Bloques que empezaron en los últimos p_window_minutes (hora local de cada usuario) y todavía
-- no se avisaron. Los marca como avisados y devuelve el contenido de cada notificación.
-- Los bloques flexibles no avisan (su horario es aproximado).
create or replace function public.due_block_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, (now() at time zone s.timezone) as local_now
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
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

revoke execute on function public.due_block_notifications(int) from public, anon, authenticated;

-- Cron: cada minuto le pide a la Edge Function que mande lo que corresponda.
-- La anon key es pública (ya viaja en la app); "send-due" solo manda avisos pendientes.
create extension if not exists pg_net;

select cron.schedule(
  'push-due',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://rtpqdivjgrykwwbnsksw.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0cHFkaXZqZ3J5a3d3Ym5za3N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzNDkyNTEsImV4cCI6MjEwNTkyNTI1MX0.N5K0XIg2vMJYJm24wCxTcSWe7APBgjB00HIdlT4GXSU'
    ),
    body    := '{"action":"send-due"}'::jsonb
  );
  $$
);
