import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Fisso su produzione. NON usare SITE_URL/env: un secret locale
 *  (es. http://localhost:3000 da template Docker) finirebbe nei link email. */
const APP_REDIRECT = 'https://chierichapp.github.io/';

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) throw listError;
  return users.users.find((item) => String(item.email || '').toLowerCase() === email) || null;
}

async function sendRecovery(admin: ReturnType<typeof createClient>, email: string) {
  const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: APP_REDIRECT,
  });
  if (resetError) throw resetError;
}

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

    // Cambio / reset password (admin → «Invia cambio password»)
    if (body.passwordReset || body.sendRecovery) {
      await sendRecovery(admin, email);
      return json({
        success: true,
        message: 'Link per il cambio password inviato via email'
      });
    }

    // Reinvio attivazione: utente Auth già presente → recovery (tipo recovery in email)
    if (body.resetExisting) {
      const existing = await findAuthUserByEmail(admin, email);
      if (!existing) {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: APP_REDIRECT,
        });
        if (error) throw error;
        return json({
          success: true,
          userId: data.user.id,
          message: 'Invito inviato via email'
        });
      }
      const temporary = `Tmp-${crypto.randomUUID()}-aA1!`;
      const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, { password: temporary });
      if (updateError) throw updateError;
      await sendRecovery(admin, email);
      return json({
        success: true,
        message: 'Nuovo link di attivazione inviato via email'
      });
    }

    if (body.replaceExisting) {
      const existing = await findAuthUserByEmail(admin, email);
      if (existing) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
        if (deleteError) throw deleteError;
      }
    }

    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: APP_REDIRECT,
    });
    if (error) {
      const msg = String(error.message || '');
      // Già registrato: invia recovery come re-invito
      if (/already|registered|exists|invito/i.test(msg)) {
        await sendRecovery(admin, email);
        return json({
          success: true,
          message: 'Utente già presente: inviato link di attivazione via email'
        });
      }
      throw error;
    }
    return json({
      success: true,
      userId: data.user.id,
      message: 'Invito inviato via email'
    });
  } catch (error) {
    // 200 + success:false così functions.invoke espone data.message (non solo «non-2xx»)
    return json({
      success: false,
      message: error?.message || 'Invito non riuscito'
    }, 200);
  }
});
