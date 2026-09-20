-- ChierichApp — schema Supabase (GitHub Pages + Auth email)
-- Applica da: Supabase Dashboard → SQL Editor, oppure `supabase db push`

create extension if not exists "pgcrypto";

-- ── Tabelle ──────────────────────────────────────────────────

create table if not exists public.chierichetti (
  uuid text primary key,
  nome text not null,
  anno_nascita text default '',
  parrocchia text default '',
  gruppo text default '',
  email text not null default '',
  telefono text default '',
  ruolo text not null default 'chierichetto',
  cerimoniere_turno boolean not null default false,
  attivo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cerimonieri (
  uuid text primary key,
  auth_user_id uuid unique references auth.users (id) on delete set null,
  nome text not null,
  email text not null unique,
  parrocchia text default '',
  chierichetto_uuid text references public.chierichetti (uuid) on delete set null,
  attivo boolean not null default true,
  is_admin boolean not null default false,
  ruolo text not null default 'cerimoniere'
    check (ruolo in ('cerimoniere', 'prete')),
  created_at timestamptz not null default now()
);

create table if not exists public.turni (
  uuid text primary key,
  data date not null,
  ora_inizio text default '08:00',
  ora_fine text default '12:00',
  parrocchia text not null,
  gruppo text default '',
  turno_num text default '',
  numero_chierichetti integer default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.presenze (
  uuid text primary key,
  data date not null,
  chierichetto_uuid text default '',
  nome text default '',
  stato text not null,
  ora text default '',
  sede text default '',
  motivo text default '',
  created_at timestamptz not null default now()
);

create unique index if not exists presenze_slot_idx
  on public.presenze (data, coalesce(ora, ''), coalesce(sede, ''), coalesce(chierichetto_uuid, nome));

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.calendario_cache (
  anno text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.app_config (key, value) values
  ('gruppiConfig', '{
    "gruppi": [
      {"id":"gruppo1","nome":"Gruppo 1","ordine":0},
      {"id":"gruppo2","nome":"Gruppo 2","ordine":1},
      {"id":"gruppo3","nome":"Gruppo 3","ordine":2}
    ],
    "messeDomenicali": [
      {"id":"slot1","dayOffset":-1,"ora":"18:00","sede":"santuario","vigilia":true,"conTurno":true,"turnoNum":1},
      {"id":"slot2","dayOffset":0,"ora":"08:30","sede":"vanzago","vigilia":false,"conTurno":true,"turnoNum":2},
      {"id":"slot3","dayOffset":0,"ora":"11:15","sede":"santuario","vigilia":false,"conTurno":true,"turnoNum":3},
      {"id":"msc1","dayOffset":0,"ora":"10:00","sede":"mantegazza","vigilia":false,"conTurno":false},
      {"id":"msc2","dayOffset":0,"ora":"18:00","sede":"mantegazza","vigilia":false,"conTurno":false}
    ],
    "rotazione":{"attiva":false,"inizioFinestra":null},
    "cronologia":[]
  }'::jsonb),
  ('messeExtra', '[]'::jsonb)
on conflict (key) do nothing;

-- ── Helper auth ──────────────────────────────────────────────

create or replace function public.current_cerimoniere()
returns public.cerimonieri
language sql
stable
security definer
set search_path = public
as $$
  select c.*
  from public.cerimonieri c
  where c.auth_user_id = auth.uid()
     or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cerimonieri c
    where c.attivo = true
      and (
        c.auth_user_id = auth.uid()
        or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cerimonieri c
    where c.attivo = true
      and c.is_admin = true
      and (
        c.auth_user_id = auth.uid()
        or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

-- Visibile anche ad anon: serve al gate di login (bootstrap vs accesso)
create or replace function public.cerimonieri_is_empty()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.cerimonieri);
$$;

grant execute on function public.current_cerimoniere() to authenticated;
grant execute on function public.is_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.cerimonieri_is_empty() to anon, authenticated;

-- Collegamento automatico auth.users → cerimonieri.auth_user_id
create or replace function public.link_cerimoniere_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.cerimonieri
  set auth_user_id = new.id
  where lower(email) = lower(new.email)
    and auth_user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_link_cerimoniere on auth.users;
create trigger on_auth_user_created_link_cerimoniere
  after insert on auth.users
  for each row execute function public.link_cerimoniere_on_signup();

-- ── RLS ──────────────────────────────────────────────────────

alter table public.chierichetti enable row level security;
alter table public.cerimonieri enable row level security;
alter table public.turni enable row level security;
alter table public.presenze enable row level security;
alter table public.app_config enable row level security;
alter table public.calendario_cache enable row level security;

-- Lettura/scrittura dati operativi: cerimonieri attivi
create policy "chierichetti_select" on public.chierichetti for select to authenticated using (public.is_app_user());
create policy "chierichetti_write" on public.chierichetti for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

create policy "turni_select" on public.turni for select to authenticated using (public.is_app_user());
create policy "turni_write" on public.turni for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

create policy "presenze_select" on public.presenze for select to authenticated using (public.is_app_user());
create policy "presenze_write" on public.presenze for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

create policy "config_select" on public.app_config for select to authenticated using (public.is_app_user());
create policy "config_write" on public.app_config for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

create policy "cal_select" on public.calendario_cache for select to authenticated using (public.is_app_user());
create policy "cal_write" on public.calendario_cache for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- Cerimonieri: tutti gli utenti app leggono; solo admin scrive
create policy "cerimonieri_select" on public.cerimonieri for select to authenticated using (public.is_app_user());
create policy "cerimonieri_admin_write" on public.cerimonieri for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

-- Bootstrap primo admin (bypassa RLS: la policy INSERT con count sullo stesso table fallisce spesso)
create or replace function public.bootstrap_first_admin(p_nome text)
returns public.cerimonieri
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_row public.cerimonieri;
begin
  if auth.uid() is null then
    raise exception 'Devi essere autenticato';
  end if;

  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  if v_email = '' then
    raise exception 'Email non presente nella sessione';
  end if;

  if trim(coalesce(p_nome, '')) = '' then
    raise exception 'Nome obbligatorio';
  end if;

  if exists (select 1 from public.cerimonieri) then
    raise exception 'Bootstrap già eseguito';
  end if;

  insert into public.cerimonieri (
    uuid, auth_user_id, nome, email, parrocchia, chierichetto_uuid, attivo, is_admin
  ) values (
    'CER-ADMIN',
    auth.uid(),
    trim(p_nome),
    v_email,
    '',
    null,
    true,
    true
  )
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.bootstrap_first_admin(text) to authenticated;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
