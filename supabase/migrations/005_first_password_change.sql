alter table public.cerimonieri
  add column if not exists password_changed boolean not null default true;

create or replace function public.mark_my_password_changed()
returns void language sql security definer set search_path = public
as $$
  update public.cerimonieri
     set password_changed = true,
         auth_user_id = coalesce(auth_user_id, auth.uid())
   where auth_user_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

grant execute on function public.mark_my_password_changed() to authenticated;
