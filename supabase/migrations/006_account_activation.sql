alter table public.cerimonieri
  add column if not exists account_activated boolean not null default true;

alter table public.cerimonieri
  add column if not exists invite_accepted boolean not null default true;

update public.cerimonieri
   set account_activated = false
 where password_changed = false;

update public.cerimonieri
   set invite_accepted = false
 where password_changed = false;

create or replace function public.mark_my_password_changed()
returns void language sql security definer set search_path = public
as $$
  update public.cerimonieri
     set password_changed = true,
         account_activated = true,
         invite_accepted = true,
         auth_user_id = coalesce(auth_user_id, auth.uid())
   where auth_user_id = auth.uid()
      or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
