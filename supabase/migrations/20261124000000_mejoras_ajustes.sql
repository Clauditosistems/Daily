-- Mejoras · ajustes finales. PENDIENTE DE APROBACIÓN: todavía NO se corrió en Supabase.
-- No agrega tablas ni columnas y no modifica datos existentes: solo reemplaza dos funciones.
--
-- 1) reschedule_day (marcar un día como atípico): las tareas de rutina con detalle o subtareas
--    ya no se borran, se mueven como las demás. Lo marcado "no la hice" se queda en su día.
--    (La app ya hace esto antes de llamar a la función; esto lo asegura también en el servidor.)
-- 2) due_flow_notifications: el aviso de "Cierre del día" ya no cuenta como "pasa a mañana"
--    lo que marcaste "no la hice". Idéntica a la actual salvo "and t.outcome is null".

create or replace function public.reschedule_day(p_date date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  moved integer;
begin
  -- Antes de mover: las tareas de rutina sin hacer que tienen algo tuyo (detalle o subtareas)
  -- se desvinculan de la rutina, así se mueven como las demás en vez de borrarse.
  update public.tasks t
     set routine_id = null
   where t.user_id = uid and not t.done and t.routine_id is not null and t.assigned_date = p_date
     and ((t.detail is not null and length(trim(t.detail)) > 0)
          or exists (select 1 from public.subtasks s where s.task_id = t.id));

  update public.tasks t
     set assigned_date = coalesce(
                           case when t.block_type is not null
                                then public.next_block_date(uid, t.block_type, p_date + 1) end,
                           p_date + 1),
         block_id      = null
   where t.user_id = uid
     and not t.done
     and t.outcome is null
     and t.routine_id is null
     and t.assigned_date = p_date;
  get diagnostics moved = row_count;

  -- Solo se quitan las de rutina que siguen siendo "de plantilla" (sin nada tuyo).
  delete from public.tasks t
   where t.user_id = uid and not t.done and t.routine_id is not null and t.assigned_date = p_date;

  return moved;
end;
$$;

create or replace function public.due_flow_notifications(p_window_minutes integer DEFAULT 10)
 RETURNS TABLE(user_id uuid, key text, title text, body text, url text)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
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
       where t.user_id = c.user_id and t.assigned_date = c.today and not t.done and t.routine_id is null and t.outcome is null
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
$function$
;
