-- Log accessi (login) all’app — solo lettura admin

create table if not exists public.accessi_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  cerimoniere_uuid text references public.cerimonieri (uuid) on delete set null,
  nome text not null default '',
  email text not null default '',
  metodo text not null default 'password'
    check (metodo in ('password', 'bootstrap', 'google', 'altro')),
  user_agent text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists accessi_log_at_idx on public.accessi_log (at desc);
create index if not exists accessi_log_email_idx on public.accessi_log (lower(email));

alter table public.accessi_log enable row level security;

drop policy if exists "accessi_insert_app_user" on public.accessi_log;
create policy "accessi_insert_app_user" on public.accessi_log
  for insert to authenticated
  with check (public.is_app_user());

drop policy if exists "accessi_select_admin" on public.accessi_log;
create policy "accessi_select_admin" on public.accessi_log
  for select to authenticated
  using (public.is_app_admin());

grant select, insert on public.accessi_log to authenticated;

comment on table public.accessi_log is
  'Storico login all’app. Inserito a ogni accesso riuscito; consultabile solo dall’admin.';
