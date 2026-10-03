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

function mapAuthError(err: { message?: string } | null | undefined) {
  const msg = String(err?.message || 'Invito non riuscito');
  if (/rate.?limit|too many|429/i.test(msg)) {
    return 'Limite email Supabase raggiunto: aspetta 30–60 minuti oppure configura SMTP personalizzato (Authentication → SMTP)';
  }
  return msg;
}

async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    const users = data?.users || [];
    const found = users.find((item) => String(item.email || '').toLowerCase() === email);
    if (found) return found;
    if (users.length < 200) break;
  }
  return null;
}

async function sendRecovery(admin: ReturnType<typeof createClient>, email: string) {
  const { error: resetError } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: APP_REDIRECT,
  });
  if (resetError) throw new Error(mapAuthError(resetError));
}

async function sendInviteEmail(admin: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: APP_REDIRECT,
  });
  if (error) throw new Error(mapAuthError(error));
  return data;
}

/**
 * Sempre mail di invito (type=invite).
 * Se l'utente Auth esiste già: delete + nuovo inviteUserByEmail.
 * Non usare auth.resend(signup): quello manda type=email (conferma), non invite.
 */
async function inviteFresh(admin: ReturnType<typeof createClient>, email: string) {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(existing.id);
    if (deleteError) throw new Error(mapAuthError(deleteError));
    await new Promise((r) => setTimeout(r, 1200));
  }

  try {
    return await sendInviteEmail(admin, email);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 2000));
    return await sendInviteEmail(admin, email);
  }
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

    // Solo «Invia cambio password» (account già attivato) → mail recovery
    if (body.passwordReset || body.sendRecovery) {
      await sendRecovery(admin, email);
      return json({
        success: true,
        message: 'Link per il cambio password inviato via email'
      });
    }

    // Reinvio invito / replace: sempre mail di invito (type=invite)
    if (body.resetExisting || body.replaceExisting) {
      const data = await inviteFresh(admin, email);
      return json({
        success: true,
        userId: data.user?.id,
        message: 'Invito inviato via email'
      });
    }

    try {
      const data = await sendInviteEmail(admin, email);
      return json({
        success: true,
        userId: data.user.id,
        message: 'Invito inviato via email'
      });
    } catch (err) {
      const msg = String((err as Error)?.message || '');
      if (/already|registered|exists|invito/i.test(msg)) {
        const data2 = await inviteFresh(admin, email);
        return json({
          success: true,
          userId: data2.user?.id,
          message: 'Invito inviato via email'
        });
      }
      throw err;
    }
  } catch (error) {
    return json({
      success: false,
      message: mapAuthError(error)
    }, 200);
  }
});
