-- Planes: notas con fecha obligatoria (y hora opcional) que avisan el día antes a la hora de la mañana,
-- y el mismo día a su hora si tienen una.

-- Las reglas de "kind" pasan a admitir 'plan'. Se buscan por definición porque se crearon sin nombre.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.notes'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.notes drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.notes
  add constraint notes_kind_check check (kind in ('note', 'idea', 'plan')),
  add constraint notes_date_by_kind check (
    (kind = 'idea' and note_date is null and remind_time is null)
    or (kind = 'plan' and note_date is not null)
    or kind = 'note');

alter table public.settings
  add column notify_plans boolean not null default true;  -- aviso el día antes de cada plan

-- Igual que antes + planes (día antes a la mañana; el mismo día a su hora si tienen).
create or replace function public.due_reminder_notifications(p_window_minutes int default 10)
returns table (user_id uuid, key text, title text, body text, url text)
language sql volatile security invoker
set search_path = ''
as $$
  with users as (
    select s.user_id, s.morning_time, s.notify_birthdays, s.birthday_day_before, s.notify_plans,
           (now() at time zone s.timezone) as local_now,
           (now() at time zone s.timezone)::date as today
    from public.settings s
    where exists (select 1 from public.push_subscriptions p where p.user_id = s.user_id)
  ),
  in_morning as (
    select u.* from users u
    where u.today + u.morning_time <= u.local_now
      and u.today + u.morning_time >  u.local_now - make_interval(mins => p_window_minutes)
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
  plan_content as (
    select n.user_id,
           'plan-pre:' || n.id || ':' || n.note_date as key,
           '📅 Mañana: ' || n.text as title,
           case when n.remind_time is not null then 'A las ' || to_char(n.remind_time, 'HH24:MI') || '.' else 'Es mañana.' end as body
    from in_morning u
    join public.notes n on n.user_id = u.user_id
    where u.notify_plans and not n.archived and n.kind = 'plan' and n.note_date = u.today + 1
    union all
    select n.user_id,
           'plan:' || n.id || ':' || n.note_date || ':' || to_char(n.remind_time, 'HH24MI'),
           '📅 ' || n.text,
           'Ahora, a las ' || to_char(n.remind_time, 'HH24:MI') || '.'
    from users u
    join public.notes n on n.user_id = u.user_id
    where not n.archived and n.kind = 'plan' and n.note_date = u.today and n.remind_time is not null
      and u.today + n.remind_time <= u.local_now
      and u.today + n.remind_time >  u.local_now - make_interval(mins => p_window_minutes)
  ),
  birthday_content as (
    select b.user_id,
           'bday:' || b.id || ':' || extract(year from u.today)::int as key,
           '🎂 Hoy cumple ' || b.name as title,
           case when b.year is not null
                then 'Cumple ' || (extract(year from u.today)::int - b.year) || ' años. ¡Saludalo!'
                else '¡No te olvides de saludar!' end as body
    from in_morning u
    join public.birthdays b on b.user_id = u.user_id
    where u.notify_birthdays
      and public.birthday_on(b.month, b.day, extract(year from u.today)::int) = u.today
    union all
    select b.user_id,
           'bday-pre:' || b.id || ':' || extract(year from u.today + 1)::int,
           '🎂 Mañana cumple ' || b.name,
           case when b.year is not null
                then 'Cumple ' || (extract(year from u.today + 1)::int - b.year) || ' años.'
                else 'Mañana es su cumpleaños.' end
    from in_morning u
    join public.birthdays b on b.user_id = u.user_id
    where u.notify_birthdays and u.birthday_day_before
      and public.birthday_on(b.month, b.day, extract(year from u.today + 1)::int) = u.today + 1
  ),
  content as (
    select * from note_content
    union all select * from plan_content
    union all select * from birthday_content
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
