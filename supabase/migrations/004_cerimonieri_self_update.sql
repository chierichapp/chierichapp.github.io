-- Profilo: l'utente aggiorna solo la propria riga (nome/email/parrocchia/collegamento).
-- is_admin e attivo non sono modificabili da qui.

create or replace function public.update_my_profile(
  p_nome text,
  p_email text,
  p_parrocchia text default null,
  p_chierichetto_uuid text default null,
  p_set_chierichetto boolean default false
)
returns public.cerimonieri
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.cerimonieri;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_nome text := trim(coalesce(p_nome, ''));
begin
  if auth.uid() is null then
    raise exception 'Non autenticato';
  end if;
  if v_nome = '' or v_email = '' then
    raise exception 'Nome e email obbligatori';
  end if;

  update public.cerimonieri c
  set
    nome = v_nome,
    email = v_email,
    parrocchia = case
      when p_parrocchia is null then c.parrocchia
      else coalesce(p_parrocchia, '')
    end,
    chierichetto_uuid = case
      when p_set_chierichetto then nullif(p_chierichetto_uuid, '')
      else c.chierichetto_uuid
    end
  where c.auth_user_id = auth.uid()
     or lower(c.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  returning c.* into v_row;

  if v_row.uuid is null then
    raise exception 'Profilo non trovato';
  end if;

  return v_row;
end;
$$;

grant execute on function public.update_my_profile(text, text, text, text, boolean)
  to authenticated;
