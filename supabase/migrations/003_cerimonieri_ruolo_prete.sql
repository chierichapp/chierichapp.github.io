-- Account sacerdoti (Don): ruolo su cerimonieri
-- Esegui in Supabase → SQL Editor dopo 001/002

alter table public.cerimonieri
  add column if not exists ruolo text not null default 'cerimoniere';

alter table public.cerimonieri
  drop constraint if exists cerimonieri_ruolo_check;

alter table public.cerimonieri
  add constraint cerimonieri_ruolo_check
  check (ruolo in ('cerimoniere', 'prete'));

comment on column public.cerimonieri.ruolo is
  'cerimoniere = capo squadra/login tipico; prete = sacerdote (Don) con stesso accesso app';
