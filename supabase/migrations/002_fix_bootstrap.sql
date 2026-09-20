-- Fix bootstrap admin (RLS bloccava l'INSERT diretto)
-- Esegui in Supabase → SQL Editor se hai già applicato 001_init.sql

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

-- La vecchia policy INSERT non serve più (e poteva fallire col count sotto RLS)
drop policy if exists "cerimonieri_bootstrap_insert" on public.cerimonieri;
