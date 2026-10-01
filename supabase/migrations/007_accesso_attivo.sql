alter table public.cerimonieri
  add column if not exists accesso_attivo boolean not null default true;
