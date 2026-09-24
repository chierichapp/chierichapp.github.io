-- Secondo telefono genitori/tutori.
alter table public.chierichetti
  add column if not exists telefono2 text not null default '';
