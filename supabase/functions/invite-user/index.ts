import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Sempre produzione: non fidarsi di body.redirectTo (client vecchi / localhost). */
const APP_REDIRECT = Deno.env.get('SITE_URL') || 'https://chierichapp.github.io/';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
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
    if (body.resetExisting) {
      const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const existing = users.users.find((item) => String(item.email || '').toLowerCase() === email);
      if (!existing) throw new Error('Utente Auth non trovato');
      const temporary = `Tmp-${crypto.randomUUID()}-aA1!`;
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password: temporary });
      if (updateError) throw updateError;
      const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: APP_REDIRECT,
      });
      if (resetError) throw resetError;
      return new Response(JSON.stringify({
        success: true,
        message: 'Nuovo link di attivazione inviato via email'
      }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }
    if (body.replaceExisting) {
      const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) throw listError;
      const existing = users.users.find((item) => String(item.email || '').toLowerCase() === email);
      if (existing) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
        if (deleteError) throw deleteError;
      }
    }
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: APP_REDIRECT,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ success: true, userId: data.user.id, message: 'Invito inviato via email' }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error?.message || 'Invito non riuscito' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    });
  }
});
