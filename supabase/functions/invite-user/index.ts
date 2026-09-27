import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(url, service);
    const { data: { user } } = await caller.auth.getUser();
    if (!user) throw new Error('Non autenticato');
    const { data: me } = await admin.from('cerimonieri').select('is_admin')
      .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
      .maybeSingle();
    if (!me?.is_admin) throw new Error('Solo l\'admin può inviare inviti');
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    if (!email) throw new Error('Email obbligatoria');
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: body.redirectTo || `${url}/`
    });
    if (error) throw error;
    return Response.json({ success: true, userId: data.user.id, message: 'Invito inviato via email' });
  } catch (error) {
    return Response.json({ success: false, message: error?.message || 'Invito non riuscito' }, { status: 400 });
  }
});
