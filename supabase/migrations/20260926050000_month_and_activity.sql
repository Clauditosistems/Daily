-- Datos agregados para la vista de mes de la agenda y el mapa de actividad del resumen.

-- Un registro por día del rango: tipos de bloque del día, tareas pendientes/hechas,
-- notas con fecha y si es día atípico. Del usuario logueado (RLS + auth.uid()).
create or replace function public.month_overview(p_from date, p_to date)
returns table (day date, block_types text[], pending int, done int, notes int, atypical boolean)
language sql stable security invoker
set search_path = ''
as $$
  select g.d::date,
         (select coalesce(array_agg(distinct b.block_type), '{}')
            from public.blocks_for_day(g.d::date, auth.uid()) b),
         (select count(*)::int from public.tasks t
           where t.user_id = auth.uid() and t.assigned_date = g.d::date and not t.done),
         (select count(*)::int from public.tasks t
           where t.user_id = auth.uid() and t.assigned_date = g.d::date and t.done),
         (select count(*)::int from public.notes n
           where n.user_id = auth.uid() and n.note_date = g.d::date and not n.archived),
         exists (select 1 from public.day_overrides o
                  where o.user_id = auth.uid() and o.override_date = g.d::date and o.is_atypical)
  from generate_series(p_from, least(p_to, p_from + 62), interval '1 day') as g(d)
  order by 1;
$$;

-- Tareas completadas por día (fecha local) desde p_from.
create or replace function public.activity_by_day(p_from date)
returns table (day date, done int)
language sql stable security invoker
set search_path = ''
as $$
  select (t.completed_at at time zone s.timezone)::date, count(*)::int
  from public.tasks t
  join public.settings s on s.user_id = t.user_id
  where t.user_id = auth.uid() and t.done
    and (t.completed_at at time zone s.timezone)::date >= p_from
  group by 1
  order by 1;
$$;
