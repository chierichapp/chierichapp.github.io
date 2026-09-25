-- Gruppo di turno anche per account cerimonieri (senza scheda chierichetto).

alter table public.cerimonieri
  add column if not exists gruppo text not null default '';

comment on column public.cerimonieri.gruppo is
  'Squadra di turno. Usato se l''account non è collegato a un chierichetto.';
