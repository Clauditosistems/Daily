-- Hasta qué fecha ya se generaron las instancias de cada rutina.
-- Evita recrear una instancia que el usuario borró a propósito.
alter table public.routines add column generated_until date;
