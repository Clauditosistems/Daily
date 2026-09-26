-- Daily — schema inicial
--
--   weekly_blocks     grilla base, se repite cada semana (day_of_week 0=domingo, igual que Date.getDay())
--   block_overrides   excepción puntual a un bloque en una fecha (mover horario o cancelarlo)
--   day_overrides     día atípico: cancela todos los bloques de esa fecha
--   routines          tareas que se repiten ciertos días de la semana (generan filas en tasks)
--   tasks             tareas de rutina y sueltas, asignadas a una fecha y opcionalmente a un bloque
--   push_subscriptions  Web Push por dispositivo
--   settings          zona horaria (el backend la necesita para mandar push con la app cerrada)
--
-- Aunque hay un solo usuario, cada tabla lleva user_id + RLS: la anon key viaja en el bundle
-- de la PWA, así que sin RLS cualquiera que la lea puede leer/escribir las tareas.
-- Horas (time/date) son locales en settings.timezone. Los bloques no cruzan medianoche
-- (uno que termina a medianoche usa end_time = '24:00').

create extension if not exists btree_gist with schema extensions;

-- ─── HELPERS ─────────────────────────────────────────────────

create type public.timerange as range (subtype = time);

create or replace function public.is_valid_timezone(tz text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─── SETTINGS ────────────────────────────────────────────────

create table public.settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  timezone    text not null default 'UTC' check (public.is_valid_timezone(timezone)),  -- el cliente la setea con Intl
  updated_at  timestamptz not null default now()
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── WEEKLY BLOCKS ───────────────────────────────────────────

create table public.weekly_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),  -- 0=domingo
  start_time   time not null,
  end_time     time not null,
  block_type   text not null check (block_type in ('trabajo','estudio','entreno','facultad','ocio','otro')),
  label        text,
  floating     boolean not null default false,  -- true para el bloque "flotante" del domingo
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_time > start_time),
  -- Dos bloques fijos no pueden pisarse el mismo día (los flotantes quedan afuera).
  exclude using gist (
    user_id with =,
    day_of_week with =,
    public.timerange(start_time, end_time, '[)') with &&
  ) where (not floating)
);

create index weekly_blocks_user_day_idx on public.weekly_blocks (user_id, day_of_week);

create trigger weekly_blocks_updated_at before update on public.weekly_blocks
  for each row execute function public.set_updated_at();

-- ─── OVERRIDES ───────────────────────────────────────────────

create table public.block_overrides (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  block_id       uuid not null references public.weekly_blocks (id) on delete cascade,
  override_date  date not null,
  start_time     time,          -- null = mantiene el horario del bloque
  end_time       time,
  cancelled      boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (block_id, override_date),
  check (start_time is null or end_time is null or end_time > start_time)
);

create table public.day_overrides (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  override_date  date not null,
  is_atypical    boolean not null default true,
  note           text,
  created_at     timestamptz not null default now(),
  unique (user_id, override_date)
);

-- Bloques efectivos de una fecha: grilla base + block_overrides, nada si es día atípico.
-- security invoker → desde el cliente RLS filtra solo; desde el service role pasar p_user_id.
create or replace function public.blocks_for_day(p_date date, p_user_id uuid default auth.uid())
returns table (
  block_id     uuid,
  block_type   text,
  label        text,
  floating     boolean,
  start_time   time,
  end_time     time,
  overridden   boolean
)
language sql stable security invoker
set search_path = ''
as $$
  select b.id,
         b.block_type,
         b.label,
         b.floating,
         coalesce(o.start_time, b.start_time),
         coalesce(o.end_time, b.end_time),
         o.id is not null
  from public.weekly_blocks b
  left join public.block_overrides o
         on o.block_id = b.id and o.override_date = p_date
  where b.user_id = p_user_id
    and b.day_of_week = extract(dow from p_date)
    and not coalesce(o.cancelled, false)
    and not exists (
      select 1 from public.day_overrides d
      where d.user_id = p_user_id and d.override_date = p_date and d.is_atypical
    )
  order by 5;
$$;

-- ─── ROUTINES ────────────────────────────────────────────────

create table public.routines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text          text not null check (length(trim(text)) > 0),
  block_type    text check (block_type in ('trabajo','estudio','entreno','facultad','ocio','otro')),
  days_of_week  smallint[] not null check (cardinality(days_of_week) > 0 and days_of_week <@ '{0,1,2,3,4,5,6}'),  -- 0=domingo
  prio          text not null default 'mid' check (prio in ('high','mid','low')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger routines_updated_at before update on public.routines
  for each row execute function public.set_updated_at();

-- ─── TASKS ───────────────────────────────────────────────────

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text            text not null,
  block_type      text check (block_type in ('trabajo','estudio','entreno','facultad','ocio','otro')),
  block_id        uuid references public.weekly_blocks (id) on delete set null,  -- null si no está atada a un bloque fijo
  assigned_date   date not null,
  done            boolean not null default false,
  completed_at    timestamptz,
  rollover_count  int not null default 0,        -- días consecutivos sin completarse
  routine_id      uuid references public.routines (id) on delete set null,  -- null = tarea suelta
  prio            text not null default 'mid' check (prio in ('high','mid','low')),
  legacy_id       bigint,                         -- id de IndexedDB (migración idempotente)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (done = (completed_at is not null)),
  unique (routine_id, assigned_date),             -- una instancia por rutina por día
  unique (user_id, legacy_id)
);

create index tasks_pending_idx on public.tasks (user_id, assigned_date) where not done;
create index tasks_block_idx on public.tasks (block_id) where block_id is not null;

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

-- Mantiene done/completed_at en sync y block_type igual al del bloque asignado.
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

  if new.block_id is not null then
    select b.block_type into new.block_type
      from public.weekly_blocks b
     where b.id = new.block_id;
  end if;
  return new;
end;
$$;

create trigger tasks_normalize before insert or update on public.tasks
  for each row execute function public.tasks_normalize();

-- ─── PUSH ────────────────────────────────────────────────────

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────

alter table public.settings           enable row level security;
alter table public.weekly_blocks      enable row level security;
alter table public.block_overrides    enable row level security;
alter table public.day_overrides      enable row level security;
alter table public.routines           enable row level security;
alter table public.tasks              enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "own rows" on public.settings
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.weekly_blocks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.block_overrides
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.day_overrides
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.routines
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own rows" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
