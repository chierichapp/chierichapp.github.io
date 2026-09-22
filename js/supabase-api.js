/**
 * ChierichApp — client API Supabase (browser)
 * Espone window.ChierichSupabase con gli stessi contratti usati da webapp.html
 */
(function (global) {
  'use strict';

  const cfg = global.CHIERICH_CONFIG || {};
  let client = null;
  let passwordRecoveryPending = false;
  let authListenersReady = false;

  function recoveryRedirectTo() {
    return global.location.origin + global.location.pathname;
  }

  function detectRecoveryFromUrl() {
    try {
      const hash = new URLSearchParams(String(global.location.hash || '').replace(/^#/, ''));
      const search = new URLSearchParams(String(global.location.search || '').replace(/^\?/, ''));
      if (hash.get('type') === 'recovery' || search.get('type') === 'recovery') {
        passwordRecoveryPending = true;
        return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  function ensureAuthListeners() {
    detectRecoveryFromUrl();
    if (authListenersReady) return;
    const sb = requireClient();
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') passwordRecoveryPending = true;
    });
    authListenersReady = true;
  }

  function isPasswordRecovery() {
    detectRecoveryFromUrl();
    return passwordRecoveryPending;
  }

  function clearPasswordRecovery() {
    passwordRecoveryPending = false;
  }

  function requireClient() {
    if (client) return client;
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
      throw new Error('Manca CHIERICH_CONFIG (SUPABASE_URL / SUPABASE_ANON_KEY)');
    }
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error('Libreria @supabase/supabase-js non caricata');
    }
    client = global.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: global.localStorage
      }
    });
    ensureAuthListeners();
    return client;
  }

  function mapChi(row) {
    if (!row) return null;
    return {
      uuid: row.uuid,
      nome: row.nome,
      annoNascita: row.anno_nascita || '',
      parrocchia: row.parrocchia || '',
      gruppo: row.gruppo || '',
      email: row.email || '',
      telefono: row.telefono || '',
      ruolo: row.ruolo || 'chierichetto',
      cerimoniereTurno: !!row.cerimoniere_turno,
      attivo: row.attivo !== false,
      createdAt: row.created_at || ''
    };
  }

  function mapCer(row) {
    if (!row) return null;
    const ruolo = row.ruolo === 'prete' ? 'prete' : 'cerimoniere';
    return {
      uuid: row.uuid,
      nome: row.nome,
      email: String(row.email || '').toLowerCase(),
      parrocchia: row.parrocchia || '',
      chierichettoUuid: row.chierichetto_uuid || '',
      attivo: row.attivo !== false,
      admin: !!row.is_admin,
      ruolo,
      createdAt: row.created_at || ''
    };
  }

  function mapTurno(row) {
    if (!row) return null;
    return {
      uuid: row.uuid,
      data: row.data,
      oraInizio: row.ora_inizio || '08:00',
      oraFine: row.ora_fine || '12:00',
      parrocchia: row.parrocchia,
      gruppo: row.gruppo || '',
      turnoNum: row.turno_num || '',
      numeroChierichetti: row.numero_chierichetti || 0,
      createdAt: row.created_at || ''
    };
  }

  function mapPresenza(row) {
    if (!row) return null;
    return {
      uuid: row.uuid,
      data: row.data,
      chierichettoUuid: row.chierichetto_uuid || '',
      nome: row.nome || '',
      stato: row.stato,
      ora: row.ora || '',
      sede: row.sede || '',
      motivo: row.motivo || '',
      createdAt: row.created_at || ''
    };
  }

  function newId(prefix) {
    return prefix + Date.now() + '-' + Math.random().toString(36).slice(2, 11).toUpperCase();
  }

  async function getCurrentCerimoniere() {
    const sb = requireClient();
    const { data: { user }, error: userErr } = await sb.auth.getUser();
    if (userErr) throw userErr;
    if (!user) return null;
    const email = String(user.email || '').toLowerCase();
    const { data, error } = await sb
      .from('cerimonieri')
      .select('*')
      .or(`auth_user_id.eq.${user.id},email.eq.${email}`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCer(data) : null;
  }

  function isTransientError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const status = err?.status || err?.code;
    return (
      status === 503 ||
      status === 504 ||
      status === 429 ||
      msg.includes('failed to fetch') ||
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('fetch') ||
      msg.includes('abort')
    );
  }

  async function withRetry(fn, attempts = 2) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (i === attempts - 1 || !isTransientError(err)) throw err;
        await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      }
    }
    throw lastErr;
  }

  async function getAuthStatus() {
    const sb = requireClient();
    const { data: { session } } = await sb.auth.getSession();
    const { data: emptyFlag, error: emptyErr } = await sb.rpc('cerimonieri_is_empty');
    if (emptyErr) throw emptyErr;
    const needsBootstrap = !!emptyFlag;
    const cerimonieriCount = needsBootstrap ? 0 : 1;

    if (!session?.user) {
      return {
        authMode: 'supabase',
        authenticated: false,
        needsBootstrap,
        unauthorized: false,
        user: null,
        cerimonieriCount,
        message: ''
      };
    }

    const user = await getCurrentCerimoniere();
    if (!user) {
      return {
        authMode: 'supabase',
        authenticated: false,
        needsBootstrap,
        unauthorized: !needsBootstrap,
        googleEmail: session.user.email,
        user: null,
        cerimonieriCount,
        message: needsBootstrap
          ? 'Primo avvio: crea il tuo account cerimoniere'
          : 'Account non autorizzato. Chiedi all\'admin di aggiungerti in Anagrafica → Cerimonieri.'
      };
    }

    if (!user.attivo) {
      return {
        authMode: 'supabase',
        authenticated: false,
        unauthorized: true,
        googleEmail: session.user.email,
        user: null,
        cerimonieriCount,
        message: 'Account disattivato'
      };
    }

    return {
      authMode: 'supabase',
      authenticated: true,
      user,
      token: session.access_token,
      cerimonieriCount,
      message: ''
    };
  }

  async function login(email, password) {
    const sb = requireClient();
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password
    });
    if (error) return { success: false, message: error.message };
    try {
      const status = await withRetry(() => getAuthStatus(), 3);
      if (!status.authenticated) {
        await sb.auth.signOut();
        return { success: false, message: status.message || 'Non autorizzato' };
      }
      return { success: true, token: data.session.access_token, user: status.user };
    } catch (err) {
      console.error('Login post-auth failed:', err);
      return {
        success: false,
        message: isTransientError(err)
          ? 'Supabase non risponde — riprova tra qualche secondo'
          : (err.message || 'Verifica account non riuscita')
      };
    }
  }

  async function resetPasswordForEmail(email) {
    const sb = requireClient();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) return { success: false, message: 'Inserisci l\'email' };
    const { error } = await sb.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: recoveryRedirectTo()
    });
    if (error) return { success: false, message: error.message };
    return {
      success: true,
      message: 'Se l\'email è registrata, riceverai un link per reimpostare la password.'
    };
  }

  async function updatePassword(password) {
    const sb = requireClient();
    const pwd = String(password || '');
    if (pwd.length < 6) {
      return { success: false, message: 'Password di almeno 6 caratteri' };
    }
    const { error } = await sb.auth.updateUser({ password: pwd });
    if (error) return { success: false, message: error.message };
    clearPasswordRecovery();
    try {
      if (global.history?.replaceState) {
        global.history.replaceState(null, '', global.location.pathname + global.location.search);
      }
    } catch { /* ignore */ }
    const status = await getAuthStatus();
    if (!status.authenticated) {
      return {
        success: true,
        needsLogin: true,
        message: 'Password aggiornata. Accedi con la nuova password.'
      };
    }
    return {
      success: true,
      token: status.token,
      user: status.user,
      message: 'Password aggiornata'
    };
  }

  async function bootstrap({ nome, email, password }) {
    const sb = requireClient();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanNome = String(nome || '').trim();
    if (!cleanNome || !cleanEmail || !password) {
      return { success: false, message: 'Nome, email e password obbligatori' };
    }

    const { data: emptyFlag, error: emptyErr } = await sb.rpc('cerimonieri_is_empty');
    if (emptyErr) return { success: false, message: emptyErr.message };
    if (!emptyFlag) {
      return { success: false, message: 'Bootstrap già eseguito' };
    }

    let session = (await sb.auth.getSession()).data.session;
    if (!session) {
      const { data: sign, error: signErr } = await sb.auth.signUp({
        email: cleanEmail,
        password
      });

      if (signErr) {
        const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (loginErr) {
          return { success: false, message: signErr.message || loginErr.message };
        }
        session = loginData.session;
      } else if (sign.session) {
        session = sign.session;
      } else {
        const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (loginErr) {
          return {
            success: true,
            needsEmailConfirm: true,
            message: 'Account Auth creato. Conferma l\'email (o disattiva Confirm email in Supabase) poi riprova.'
          };
        }
        session = loginData.session;
      }
    }

    if (!session) {
      return { success: false, message: 'Sessione Auth mancante dopo la registrazione' };
    }

    const { error: bootErr } = await sb.rpc('bootstrap_first_admin', { p_nome: cleanNome });
    if (bootErr) return { success: false, message: bootErr.message };

    const status = await getAuthStatus();
    if (!status.authenticated) {
      return { success: false, message: status.message || 'Account creato ma non autenticato' };
    }
    return { success: true, token: session.access_token, user: status.user };
  }

  async function logout() {
    const sb = requireClient();
    await sb.auth.signOut();
    return { success: true };
  }

  async function getAppData() {
    const sb = requireClient();
    const auth = await getAuthStatus();
    if (!auth.authenticated) {
      return {
        ok: false,
        auth,
        chierichetti: [],
        turni: [],
        presenze: [],
        cerimonieri: [],
        config: { gruppiConfig: null, messeExtra: [] }
      };
    }

    const [chi, turni, pres, cer, cfgRows] = await Promise.all([
      sb.from('chierichetti').select('*'),
      sb.from('turni').select('*'),
      sb.from('presenze').select('*'),
      sb.from('cerimonieri').select('*'),
      sb.from('app_config').select('key,value')
    ]);

    for (const r of [chi, turni, pres, cer, cfgRows]) {
      if (r.error) throw r.error;
    }

    const configMap = {};
    (cfgRows.data || []).forEach((row) => { configMap[row.key] = row.value; });

    return {
      ok: true,
      auth,
      chierichetti: (chi.data || []).map(mapChi),
      turni: (turni.data || []).map(mapTurno),
      presenze: (pres.data || []).map(mapPresenza),
      cerimonieri: (cer.data || []).map(mapCer),
      config: {
        gruppiConfig: configMap.gruppiConfig || null,
        messeExtra: Array.isArray(configMap.messeExtra) ? configMap.messeExtra : []
      }
    };
  }

  async function salvaChierichetto(dati) {
    const sb = requireClient();
    const uuid = dati.uuid || newId('CHI-');
    const row = {
      uuid,
      nome: dati.nome,
      anno_nascita: String(dati.annoNascita || dati.classe || ''),
      parrocchia: dati.parrocchia || '',
      gruppo: dati.gruppo || '',
      email: dati.email || '',
      telefono: dati.telefono || '',
      ruolo: dati.ruolo || 'chierichetto',
      cerimoniere_turno: !!dati.cerimoniereTurno,
      attivo: dati.attivo === false || dati.attivo === 'false' ? false : true,
      created_at: dati.createdAt || new Date().toISOString()
    };
    const { error } = await sb.from('chierichetti').upsert(row);
    if (error) return { success: false, message: error.message };
    return { success: true, uuid, message: 'Persona salvata' };
  }

  async function aggiornaChierichetto(uuid, dati) {
    const sb = requireClient();
    const patch = {};
    if (dati.nome) patch.nome = dati.nome;
    if (dati.annoNascita !== undefined) patch.anno_nascita = String(dati.annoNascita);
    else if (dati.classe) patch.anno_nascita = String(dati.classe);
    if (dati.parrocchia !== undefined) patch.parrocchia = dati.parrocchia;
    if (dati.gruppo !== undefined) patch.gruppo = dati.gruppo;
    if (dati.email) patch.email = dati.email;
    if (dati.telefono !== undefined) patch.telefono = dati.telefono || '';
    if (dati.ruolo) patch.ruolo = dati.ruolo;
    if (dati.cerimoniereTurno !== undefined) patch.cerimoniere_turno = !!dati.cerimoniereTurno;
    if (dati.attivo !== undefined) patch.attivo = !(dati.attivo === false || dati.attivo === 'false');
    const { error } = await sb.from('chierichetti').update(patch).eq('uuid', uuid);
    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Chierichetto aggiornato' };
  }

  async function eliminaChierichetto(uuid) {
    const sb = requireClient();
    const { error } = await sb.from('chierichetti').delete().eq('uuid', uuid);
    if (error) return { success: false, message: error.message };
    return { success: true, message: 'Chierichetto eliminato' };
  }

  async function salvaTurno(dati) {
    const sb = requireClient();
    const uuid = dati.uuid || newId('TUR-');
    const row = {
      uuid,
      data: dati.data,
      ora_inizio: dati.oraInizio || '08:00',
      ora_fine: dati.oraFine || '12:00',
      parrocchia: dati.parrocchia,
      gruppo: dati.gruppo || '',
      turno_num: dati.turnoNum || '',
      numero_chierichetti: parseInt(dati.numeroChierichetti, 10) || 0,
      created_at: dati.createdAt || new Date().toISOString()
    };
    const { error } = await sb.from('turni').upsert(row);
    if (error) return { success: false, message: error.message };
    return { success: true, uuid, message: 'Turno salvato' };
  }

  async function salvaPresenza(dati) {
    const sb = requireClient();
    const uuid = dati.uuid || newId('PRE-');
    // Rimuovi eventuale presenza sullo stesso slot
    let q = sb.from('presenze').delete().eq('data', dati.data).eq('ora', dati.ora || '').eq('sede', dati.sede || '');
    if (dati.chierichettoUuid) q = q.eq('chierichetto_uuid', dati.chierichettoUuid);
    else if (dati.nome) q = q.eq('nome', dati.nome);
    await q;

    const row = {
      uuid,
      data: dati.data,
      chierichetto_uuid: dati.chierichettoUuid || '',
      nome: dati.nome || '',
      stato: dati.stato,
      ora: dati.ora || '',
      sede: dati.sede || '',
      motivo: dati.motivo || '',
      created_at: dati.createdAt || new Date().toISOString()
    };
    const { error } = await sb.from('presenze').insert(row);
    if (error) return { success: false, message: error.message };
    return { success: true, uuid, message: 'Presenza salvata' };
  }

  async function eliminaPresenza(uuid) {
    const sb = requireClient();
    const { error } = await sb.from('presenze').delete().eq('uuid', uuid);
    if (error) return { success: false, message: error.message };
    return { success: true };
  }

  async function salvaAppelloBatch(payload) {
    const sb = requireClient();
    const remove = payload?.removeUuids || [];
    const add = payload?.add || [];
    if (remove.length) {
      const { error } = await sb.from('presenze').delete().in('uuid', remove);
      if (error) return { success: false, message: error.message };
    }
    if (add.length) {
      const rows = add.map((d) => ({
        uuid: d.uuid || newId('PRE-'),
        data: d.data,
        chierichetto_uuid: d.chierichettoUuid || '',
        nome: d.nome || '',
        stato: d.stato || 'presente',
        ora: d.ora || '',
        sede: d.sede || '',
        motivo: d.motivo || '',
        created_at: d.createdAt || new Date().toISOString()
      }));
      const { error } = await sb.from('presenze').upsert(rows);
      if (error) return { success: false, message: error.message };
    }
    return { success: true, message: 'Appello salvato' };
  }

  async function salvaConfig(body) {
    const sb = requireClient();
    const rows = [];
    if (body?.gruppiConfig) {
      rows.push({ key: 'gruppiConfig', value: body.gruppiConfig, updated_at: new Date().toISOString() });
    }
    if (body?.messeExtra) {
      rows.push({ key: 'messeExtra', value: body.messeExtra, updated_at: new Date().toISOString() });
    }
    if (!rows.length) return { success: true };
    const { error } = await sb.from('app_config').upsert(rows);
    if (error) return { success: false, message: error.message };
    return { success: true };
  }

  async function getCerimonieri() {
    const sb = requireClient();
    const { data, error } = await sb.from('cerimonieri').select('*').order('created_at');
    if (error) throw error;
    return (data || []).map(mapCer);
  }

  async function salvaCerimoniere(dati) {
    const sb = requireClient();
    const email = String(dati.email || '').trim().toLowerCase();
    const password = String(dati.password || '');
    const uuid = newId('CER-');
    const ruolo = dati.ruolo === 'prete' ? 'prete' : 'cerimoniere';

    if (!password || password.length < 6) {
      return { success: false, message: 'Password di almeno 6 caratteri obbligatoria' };
    }

    const { data: sessData } = await sb.auth.getSession();
    const adminSession = sessData?.session;
    if (!adminSession) {
      return { success: false, message: 'Sessione scaduta — riloggia come admin' };
    }

    // Crea utente Auth senza perdere la sessione admin
    const { data: sign, error: signErr } = await sb.auth.signUp({ email, password });
    const { error: restoreErr } = await sb.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token
    });
    if (restoreErr) {
      return {
        success: false,
        message: 'Utente Auth creato ma sessione admin persa — riloggia e riprova'
      };
    }

    if (signErr) {
      const msg = signErr.message || 'Creazione Auth fallita';
      // Se l'email esiste già in Auth, procedi con la riga anagrafica
      if (!/already|registered|exists|duplicate/i.test(msg)) {
        return { success: false, message: msg };
      }
    }

    const { error } = await sb.from('cerimonieri').insert({
      uuid,
      nome: String(dati.nome || '').trim(),
      email,
      parrocchia: dati.parrocchia || '',
      chierichetto_uuid: dati.chierichettoUuid || null,
      attivo: dati.attivo === false ? false : true,
      is_admin: false,
      ruolo
    });
    if (error) return { success: false, message: error.message };

    const needsEmailConfirm = !!(sign?.user && !sign?.session && !signErr);
    return {
      success: true,
      uuid,
      needsEmailConfirm,
      message: needsEmailConfirm
        ? 'Account creato. Conferma l\'email (o disattiva Confirm email in Supabase Auth) prima del primo accesso.'
        : (ruolo === 'prete' ? 'Account Don creato' : 'Account creato')
    };
  }

  async function aggiornaCerimoniere(uuid, dati) {
    const sb = requireClient();
    const patch = {};
    if (dati.nome) patch.nome = String(dati.nome).trim();
    if (dati.email) patch.email = String(dati.email).trim().toLowerCase();
    if (dati.parrocchia !== undefined) patch.parrocchia = dati.parrocchia || '';
    if (dati.chierichettoUuid !== undefined) patch.chierichetto_uuid = dati.chierichettoUuid || null;
    if (dati.attivo !== undefined) patch.attivo = !!dati.attivo;
    if (dati.ruolo !== undefined) patch.ruolo = dati.ruolo === 'prete' ? 'prete' : 'cerimoniere';
    const { error } = await sb.from('cerimonieri').update(patch).eq('uuid', uuid);
    if (error) return { success: false, message: error.message };
    return { success: true };
  }

  /**
   * Aggiorna il proprio profilo (Auth + riga cerimonieri).
   * Password/email passano da sb.auth.updateUser; anagrafica via RPC update_my_profile.
   */
  async function aggiornaIlMioProfilo(dati) {
    const sb = requireClient();
    const status = await getAuthStatus();
    if (!status.authenticated || !status.user?.uuid) {
      return { success: false, message: 'Non autenticato' };
    }

    const nome = String(dati.nome || '').trim();
    const email = String(dati.email || '').trim().toLowerCase();
    const password = String(dati.password || '');
    const parrocchia = dati.parrocchia !== undefined ? (dati.parrocchia || '') : null;

    if (!nome || !email) {
      return { success: false, message: 'Nome e email obbligatori' };
    }
    if (password && password.length < 6) {
      return { success: false, message: 'Password di almeno 6 caratteri' };
    }

    const authPatch = {};
    const currentEmail = String(status.user.email || '').trim().toLowerCase();
    if (email && email !== currentEmail) authPatch.email = email;
    if (password) authPatch.password = password;

    let needsEmailConfirm = false;
    if (Object.keys(authPatch).length) {
      const { data: updated, error: authErr } = await sb.auth.updateUser(authPatch);
      if (authErr) return { success: false, message: authErr.message };
      if (authPatch.email) {
        const sessionEmail = String(updated?.user?.email || '').toLowerCase();
        needsEmailConfirm = sessionEmail !== email;
      }
    }

    const { data: row, error } = await sb.rpc('update_my_profile', {
      p_nome: nome,
      p_email: email,
      p_parrocchia: parrocchia,
      p_chierichetto_uuid: dati.chierichettoUuid || null,
      p_set_chierichetto: dati.chierichettoUuid !== undefined
    });
    if (error) return { success: false, message: error.message };

    const refreshed = await getAuthStatus();
    return {
      success: true,
      needsEmailConfirm,
      user: refreshed.user || (row ? mapCer(Array.isArray(row) ? row[0] : row) : status.user),
      message: needsEmailConfirm
        ? 'Profilo aggiornato. Controlla la nuova email e conferma il link prima di usarla per accedere.'
        : (password ? 'Profilo e password aggiornati' : 'Profilo aggiornato')
    };
  }

  async function eliminaCerimoniere(uuid) {
    const sb = requireClient();
    const { error } = await sb.from('cerimonieri').delete().eq('uuid', uuid);
    if (error) return { success: false, message: error.message };
    return { success: true };
  }

  async function getCalendarioLiturgico(anno) {
    const sb = requireClient();
    const { data, error } = await sb.from('calendario_cache').select('payload').eq('anno', String(anno)).maybeSingle();
    if (error) throw error;
    if (data?.payload) return data.payload;
    return { anno: String(anno), events: [], byDate: {}, source: 'supabase' };
  }

  async function salvaCalendarioLiturgico(anno, payload) {
    const sb = requireClient();
    const { error } = await sb.from('calendario_cache').upsert({
      anno: String(anno),
      payload,
      updated_at: new Date().toISOString()
    });
    if (error) return { success: false, message: error.message };
    return { success: true };
  }

  global.ChierichSupabase = {
    getAuthStatus,
    login,
    bootstrap,
    logout,
    resetPasswordForEmail,
    updatePassword,
    ensureAuthListeners,
    isPasswordRecovery,
    clearPasswordRecovery,
    getAppData,
    salvaChierichetto,
    aggiornaChierichetto,
    eliminaChierichetto,
    salvaTurno,
    salvaPresenza,
    eliminaPresenza,
    salvaAppelloBatch,
    salvaConfig,
    getCerimonieri,
    salvaCerimoniere,
    aggiornaCerimoniere,
    aggiornaIlMioProfilo,
    eliminaCerimoniere,
    getCalendarioLiturgico,
    salvaCalendarioLiturgico
  };
})(typeof window !== 'undefined' ? window : globalThis);
