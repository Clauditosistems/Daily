-- Rollover automático de tareas no completadas + reprogramación al marcar un día atípico.
--
-- Reglas:
--   * Una tarea pendiente con fecha pasada se mueve al próximo día (desde hoy) que tenga un bloque
--     de su mismo tipo, mirando hasta 14 días. Sin tipo, o sin bloque en ese rango → hoy.
--   * Cada pase suma 1 a rollover_count.
--   * Las instancias de rutinas no se mueven: una rutina salteada queda como no hecha en su día
--     (moverla chocaría con la instancia del próximo día de la rutina).
--   * "Hoy" es la fecha local según settings.timezone.

-- Próxima fecha, desde p_from inclusive, con un bloque de ese tipo (respeta overrides y días atípicos).
create or replace function public.next_block_date(p_user_id uuid, p_block_type text, p_from date, p_days int default 14)
returns date
language sql stable security invoker
set search_path = ''
as $$
  select d::date
  from generate_series(p_from, p_from + p_days, interval '1 day') as d
  where exists (
    select 1 from public.blocks_for_day(d::date, p_user_id) b
    where b.block_type = p_block_type
  )
  order by d
  limit 1;
$$;

create or replace function public.rollover_user(p_user_id uuid, p_today date)
returns integer
language plpgsql security invoker
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
     and t.routine_id is null
     and t.assigned_date < p_today;
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- Desde el cliente, al abrir la agenda (no espera al cron).
create or replace function public.rollover_mine()
returns integer
language sql security invoker
set search_path = ''
as $$
  select public.rollover_user(s.user_id, (now() at time zone s.timezone)::date)
  from public.settings s
  where s.user_id = auth.uid();
$$;

-- Para el cron: todos los usuarios, cada uno con su fecha local.
create or replace function public.rollover_all()
returns void
language sql security invoker
set search_path = ''
as $$
  select public.rollover_user(s.user_id, (now() at time zone s.timezone)::date)
  from public.settings s;
$$;

revoke execute on function public.rollover_all() from public, anon, authenticated;

-- Al marcar un día como atípico: sus tareas sueltas pendientes pasan al próximo bloque de su tipo
-- (o al día siguiente si no tienen tipo) sin sumar rollover; las instancias de rutinas de ese día se borran.
-- Se llama después de insertar el day_override, así next_block_date ya saltea ese día.
create or replace function public.reschedule_day(p_date date)
returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  moved integer;
begin
  update public.tasks t
     set assigned_date = coalesce(
                           case when t.block_type is not null
                                then public.next_block_date(uid, t.block_type, p_date + 1) end,
                           p_date + 1),
         block_id      = null
   where t.user_id = uid
     and not t.done
     and t.routine_id is null
     and t.assigned_date = p_date;
  get diagnostics moved = row_count;

  delete from public.tasks t
   where t.user_id = uid and not t.done and t.routine_id is not null and t.assigned_date = p_date;

  return moved;
end;
$$;

-- Cron: cada hora al minuto 5. Idempotente: solo mueve tareas con fecha anterior a hoy.
create extension if not exists pg_cron;

select cron.schedule('daily-rollover', '5 * * * *', $$select public.rollover_all()$$);
