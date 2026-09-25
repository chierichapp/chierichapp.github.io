// ── Config ──────────────────────────────────────────────────
const isSupabase = !!(window.CHIERICH_CONFIG?.supabaseUrl && window.CHIERICH_CONFIG?.supabaseAnonKey
  && !String(window.CHIERICH_CONFIG.supabaseUrl).includes('YOUR_PROJECT'));
const isGAS = !isSupabase && typeof google !== 'undefined' && google.script && google.script.host;
const STORAGE_KEY = 'chierichetti_data';
const DATA_SCHEMA_VERSION = 6;

const PAGE_META = {
  dashboard:  { title: 'Oggi',       subtitle: 'Prossima messa, turni e scorciatoie' },
  presenze:   { title: 'Appello',    subtitle: 'Segna presenti e assenti al servizio' },
  registro:   { title: 'Registro',   subtitle: 'Storico presenze per anno pastorale' },
  messe:      { title: 'Messe',      subtitle: 'Agenda celebrazioni e indicazioni del don' },
  turni:      { title: 'Turni',      subtitle: 'Messe di servizio e rotazione squadre' },
  gruppi:     { title: 'Gruppi',     subtitle: 'Squadre di turno e assegnazioni' },
  anagrafica: { title: 'Anagrafica', subtitle: 'Chierichetti, ex e accessi all’app' },
  calendario: { title: 'Liturgia',   subtitle: 'Calendario ambrosiano del giorno' },
  account:    { title: 'Account',    subtitle: 'Il tuo profilo e accesso' }
};

const GRUPPI_LABEL_LEGACY = {
  gruppo1: 'Gruppo 1',
  gruppo2: 'Gruppo 2',
  gruppo3: 'Gruppo 3',
  centrale: 'Centrale', nord: 'Nord', sud: 'Sud', est: 'Est', ovest: 'Ovest'
};
const SEDI_LABEL = { santuario: 'Santuario', vanzago: 'Vanzago', mantegazza: 'Mantegazza' };
const PARROCCHIA_LABEL = { vanzago: 'Vanzago', mantegazza: 'Mantegazza' };
const CLASSE_TO_ANNO_NASCITA = { '1a': '2015', '2a': '2014', '3a': '2013', '4a': '2012', '5a': '2011' };
const RUOLI_LABEL = { chierichetto: 'Chierichetto', cerimoniere: 'Cerimoniere', prete: 'Don' };
const ACCOUNT_RUOLI_LABEL = { cerimoniere: 'Cerimoniere', prete: 'Don' };

let anagraficaTab = 'chierichetto';
let anagraficaStatusFilter = 'attivi';
let registroTab = 'messa';
/** Anno di inizio dell'anno pastorale (settembre → giugno dell'anno dopo) */
let registroPastoralStart = null;
/** Mese 0–11 entro l'anno pastorale, o null = tutto l'anno (set–giu) */
let registroMonth = null;
let registroOpenSlotKey = '';
let registroOpenGroupId = '';

/** Mesi dell'anno pastorale: agosto (apertura) + settembre … giugno */
const REGISTRO_PASTORAL_MONTHS = [7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];
/** Primo anno pastorale gestito dall'app (2026/27) */
const REGISTRO_MIN_PASTORAL_START = 2026;
/** Giorni prima del 1° settembre in cui apre la finestra dell'anno pastorale */
const REGISTRO_PASTORAL_OPEN_DAYS_BEFORE = 14;

const DEFAULT_GRUPPI_CONFIG = {
  gruppi: [
    { id: 'gruppo1', nome: 'Gruppo 1', ordine: 0 },
    { id: 'gruppo2', nome: 'Gruppo 2', ordine: 1 },
    { id: 'gruppo3', nome: 'Gruppo 3', ordine: 2 }
  ],
  messeDomenicali: [
    { id: 'slot1', dayOffset: -1, ora: '18:00', sede: 'santuario', vigilia: true, conTurno: true, turnoNum: 1 },
    { id: 'slot2', dayOffset: 0, ora: '08:30', sede: 'vanzago', vigilia: false, conTurno: true, turnoNum: 2 },
    { id: 'slot3', dayOffset: 0, ora: '11:15', sede: 'santuario', vigilia: false, conTurno: true, turnoNum: 3 },
    { id: 'msc1', dayOffset: 0, ora: '10:00', sede: 'mantegazza', vigilia: false, conTurno: false },
    { id: 'msc2', dayOffset: 0, ora: '18:00', sede: 'mantegazza', vigilia: false, conTurno: false }
  ],
  rotazione: { attiva: false, inizioFinestra: null, fineFinestra: null, storicoFinestre: [] },
  cronologia: []
};

let editingMessaDomenicaleId = null;
let turniTab = 'anteprima';
let gruppiTab = 'squadre';
let gruppiEditDraft = null;
let gruppiEditMode = 'nuovi'; // 'nuovi' | 'aggiorna'
let gruppiEditBaseline = null;
let gruppiEditSelected = new Set();
let gruppiEditUndoStack = [];
let appelloParrocchiaTab = 'mine';
let appelloParrocchiaTabBySlot = {};
let appelloSelectedSlotKey = '';
let appelloSaving = false;
let appelloDraft = {};
let appelloDraftDirty = {};
let appelloAutoSaveTimer = null;
let appelloSaveFailed = false;
let appelloSaveQuiet = false;

window.addEventListener('beforeunload', (e) => {
  if (!isAnyAppelloDraftDirty() && !appelloSaving && !appelloSaveFailed) return;
  e.preventDefault();
  e.returnValue = '';
});

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function getMondayFirstOffset(date) {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}
const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const API_BASE = isGAS || isSupabase ? '' : 'http://localhost:3000';
const SESSION_KEY = 'chierichetti_session';

let state = { chierichetti: [], turni: [], presenze: [], messeExtra: [], messeIndicazioni: {}, schemaVersion: DATA_SCHEMA_VERSION };
let messeIndicazioniSaveTimer = null;
let messaNotaModalCtx = null;
let cerimonieriAccounts = [];
let cerimonieriHydrated = false;
let editingUuid = null;
let promotingUuid = null;
let editingCerimoniereUuid = null;
let editingCerimoniereAsProfile = false;
let apiOnline = false;
let authToken = null;
let currentUser = null;
let authMode = 'login';

const calState = {
  data: null,
  month: new Date().getMonth(),
  selectedDate: null,
  loading: false,
  unavailable: false
};

const messeState = {
  selectedDate: null,
  loading: false,
  showPast: false
};

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('auth-login-form').addEventListener('submit', handleAuthSubmit);
  document.getElementById('cerimoniereForm').addEventListener('submit', handleCerimoniereFormSubmit);
  document.getElementById('accountForm')?.addEventListener('submit', handleAccountFormSubmit);
  if (isGAS) prepareGoogleAuthUi();
  else if (isSupabase) prepareSupabaseAuthUi();
  initMobileMoreGestures();
  checkAuthAndInit();
});

function prepareSupabaseAuthUi() {
  const sub = document.getElementById('form-cerimoniere-sub');
  if (sub) sub.textContent = 'Anagrafica subito; email e password solo se vuoi abilitare il login';
  const googleBlock = document.getElementById('auth-google-block');
  if (googleBlock) googleBlock.hidden = true;
  const pwdWrap = document.getElementById('cerimoniere-password-wrap');
  if (pwdWrap) {
    pwdWrap.hidden = false;
    pwdWrap.style.display = '';
  }
  const pwd = document.getElementById('cerimoniere-password');
  if (pwd) pwd.required = false;
  const emailInput = document.getElementById('cerimoniere-email');
  if (emailInput) emailInput.required = false;
  const loginHint = document.getElementById('cerimoniere-login-hint');
  if (loginHint) {
    loginHint.style.display = '';
    loginHint.textContent = 'Puoi salvare solo nome e ruolo senza email/password: la persona non potrà accedere finché non le imposti.';
  }
  onCerimoniereRuoloChange();
}

function prepareGoogleAuthUi() {
  const pwdWrap = document.getElementById('cerimoniere-password-wrap');
  if (pwdWrap) pwdWrap.hidden = true;
  const pwd = document.getElementById('cerimoniere-password');
  if (pwd) pwd.required = false;
  const emailLabel = document.querySelector('label[for="cerimoniere-email"]');
  if (emailLabel) emailLabel.textContent = 'Email Google';
  const emailInput = document.getElementById('cerimoniere-email');
  if (emailInput) emailInput.placeholder = 'mario@gmail.com';
  const sub = document.getElementById('form-cerimoniere-sub');
  if (sub) sub.textContent = 'Autorizzano l\'accesso con Account Google — cerimonieri e sacerdoti';
  const googleBlock = document.getElementById('auth-google-block');
  if (googleBlock) googleBlock.hidden = false;
  onCerimoniereRuoloChange();
}

function showAuthInfo(msg) {
  const el = document.getElementById('auth-info-hint');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = '';
    el.classList.add('is-success');
  } else {
    el.textContent = '';
    el.style.display = 'none';
    el.classList.remove('is-success');
  }
}

function setAuthMode(mode, extra = {}) {
  authMode = mode;
  const isBootstrap = mode === 'bootstrap';
  const isUnauthorized = mode === 'unauthorized';
  const waitGoogle = mode === 'google-wait';
  const isForgot = mode === 'forgot';
  const isRecovery = mode === 'recovery';
  const googleEmail = extra.googleEmail || '';

  showAuthError('');
  if (!extra.keepInfo) showAuthInfo('');

  document.getElementById('auth-subtitle').textContent = isBootstrap
    ? 'Configurazione iniziale'
    : isUnauthorized
      ? 'Accesso non autorizzato'
      : isForgot
        ? 'Recupero password'
        : isRecovery
          ? 'Nuova password'
          : 'Accesso riservato a cerimonieri e sacerdoti';

  const hint = document.getElementById('auth-bootstrap-hint');
  if (isBootstrap && isGAS) {
    hint.style.display = '';
    hint.textContent = 'Primo avvio: questo Account Google diventa il primo accesso. Poi potrai autorizzare cerimonieri e Don da Anagrafica → Accessi.';
  } else if (isBootstrap) {
    hint.style.display = '';
    hint.textContent = 'Primo avvio: crea l\'account del responsabile. Potrai aggiungere cerimonieri e Don da Anagrafica → Accessi.';
  } else if (isForgot) {
    hint.style.display = '';
    hint.textContent = 'Inserisci l\'email dell\'account: ti invieremo un link per scegliere una nuova password.';
  } else if (isRecovery) {
    hint.style.display = '';
    hint.textContent = 'Scegli una nuova password (almeno 6 caratteri), poi potrai accedere.';
  } else {
    hint.style.display = 'none';
  }

  const form = document.getElementById('auth-login-form');
  const emailWrap = document.getElementById('auth-email-wrap');
  const passwordWrap = document.getElementById('auth-password-wrap');
  const password2Wrap = document.getElementById('auth-password2-wrap');
  const forgotLink = document.getElementById('auth-forgot-link');
  const backLogin = document.getElementById('auth-back-login');
  const googleBlock = document.getElementById('auth-google-block');
  const googleEmailEl = document.getElementById('auth-google-email');
  const googleBtn = document.getElementById('auth-google-btn');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const password2Input = document.getElementById('auth-password2');

  if (isGAS) {
    if (googleBlock) googleBlock.hidden = false;
    if (passwordWrap) passwordWrap.style.display = 'none';
    if (password2Wrap) password2Wrap.style.display = 'none';
    if (forgotLink) forgotLink.style.display = 'none';
    if (backLogin) backLogin.style.display = 'none';
    if (passwordInput) passwordInput.required = false;
    if (password2Input) password2Input.required = false;
    if (emailInput) {
      emailInput.required = false;
      emailInput.readOnly = true;
      if (googleEmail) emailInput.value = googleEmail;
    }
    if (emailWrap) emailWrap.style.display = isBootstrap ? '' : 'none';
    form.style.display = isBootstrap ? '' : 'none';
    document.getElementById('auth-nome-wrap').style.display = isBootstrap ? '' : 'none';
    document.getElementById('auth-submit-btn').textContent = 'Crea account e continua';
    const nomeInput = document.getElementById('auth-nome');
    if (nomeInput) nomeInput.required = isBootstrap;

    if (googleEmailEl) {
      if (waitGoogle) {
        googleEmailEl.textContent = 'Apri l\'app con un Account Google, autorizza l\'accesso e premi continua.';
      } else if (isUnauthorized) {
        googleEmailEl.textContent = googleEmail
          ? `Sei connesso come ${googleEmail}. Questo account non è in elenco.`
          : 'Questo Account Google non è autorizzato.';
      } else if (isBootstrap && googleEmail) {
        googleEmailEl.textContent = `Account Google: ${googleEmail}`;
      } else if (googleEmail) {
        googleEmailEl.textContent = `Account Google: ${googleEmail}`;
      } else {
        googleEmailEl.textContent = '';
      }
    }
    if (googleBtn) {
      googleBtn.style.display = isBootstrap ? 'none' : '';
      googleBtn.textContent = isUnauthorized ? 'Riprova' : 'Continua con Google';
    }
  } else {
    if (googleBlock) googleBlock.hidden = true;
    form.style.display = '';
    if (emailWrap) emailWrap.style.display = isRecovery ? 'none' : '';
    if (passwordWrap) passwordWrap.style.display = (isForgot ? 'none' : '');
    if (password2Wrap) password2Wrap.style.display = isRecovery ? '' : 'none';
    if (forgotLink) forgotLink.style.display = (isSupabase && mode === 'login') ? '' : 'none';
    if (backLogin) backLogin.style.display = (isForgot || isRecovery) ? '' : 'none';
    if (emailInput) {
      emailInput.required = !isRecovery;
      emailInput.readOnly = false;
      emailInput.autocomplete = isForgot ? 'email' : 'username';
    }
    if (passwordInput) {
      passwordInput.required = !isForgot;
      passwordInput.autocomplete = isRecovery ? 'new-password' : 'current-password';
      if (isRecovery) {
        const pwdLabel = passwordWrap?.querySelector('label');
        if (pwdLabel) pwdLabel.textContent = 'Nuova password';
      } else {
        const pwdLabel = passwordWrap?.querySelector('label');
        if (pwdLabel) pwdLabel.textContent = 'Password';
      }
    }
    if (password2Input) password2Input.required = isRecovery;
    document.getElementById('auth-nome-wrap').style.display = isBootstrap ? '' : 'none';
    document.getElementById('auth-submit-btn').textContent = isBootstrap
      ? 'Crea account'
      : isForgot
        ? 'Invia link'
        : isRecovery
          ? 'Salva nuova password'
          : 'Accedi';
    const nomeInput = document.getElementById('auth-nome');
    if (nomeInput) nomeInput.required = isBootstrap;
  }
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(token, user) {
  authToken = token;
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  updateSidebarUser();
}

function clearSession() {
  authToken = null;
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function isCurrentUserAdmin() {
  if (!isGAS && !isSupabase) return true;
  return !!(currentUser && currentUser.admin);
}

function requireAdminAction(msg) {
  if (isCurrentUserAdmin()) return true;
  showToast(msg || 'Solo l\'admin può modificare questa sezione', 'error');
  return false;
}

/** Allinea currentUser.admin con la riga anagrafica (evita UI admin su account demo). */
function syncCurrentUserAdminFlag() {
  if (!currentUser?.uuid || !cerimonieriAccounts.length) return false;
  const me = cerimonieriAccounts.find(c => c.uuid === currentUser.uuid);
  if (!me) return false;
  const nextAdmin = !!me.admin;
  if (!!currentUser.admin === nextAdmin) return false;
  currentUser = { ...currentUser, admin: nextAdmin };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.user = { ...(parsed.user || {}), admin: nextAdmin };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
  return true;
}

function syncCerimonieriAdminUi() {
  const panel = document.getElementById('cerimoniere-form-panel');
  const grid = document.getElementById('anag-panel-cerimonieri');
  const canAdmin = isCurrentUserAdmin();
  // Solo admin gestisce accessi da Anagrafica; il profilo è in sezione Account
  if (panel) panel.style.display = canAdmin ? '' : 'none';
  if (grid) grid.classList.toggle('cerimonieri-readonly', !canAdmin);
  const ruoloSelect = document.getElementById('cerimoniere-ruolo');
  if (ruoloSelect && canAdmin) ruoloSelect.disabled = false;
}

function syncChierichettiAdminUi() {
  const formPanel = document.getElementById('chierichetto-form-panel');
  if (formPanel) formPanel.style.display = '';
}

function syncGruppiAdminUi() {
  const formWrap = document.getElementById('gruppi-gestione-form-wrap');
  const canAdmin = isCurrentUserAdmin();
  if (formWrap) {
    if (!canAdmin) {
      formWrap.style.display = 'none';
      closeGruppiFormSheet();
    } else {
      formWrap.style.display = '';
    }
  }
  document.querySelectorAll('#btn-modifica-gruppi, #btn-modifica-gruppi-mobile, #gruppi-gestione-head-actions, #gruppi-gestione-cta').forEach(el => {
    el.hidden = !canAdmin;
  });
  const turniForm = document.querySelector('.turni-form-panel');
  if (turniForm) turniForm.style.display = canAdmin ? '' : 'none';
  if (!canAdmin && document.body.classList.contains('gruppi-edit-open')) closeGruppiEdit(true);
  syncGruppiFab();
}

function isEditingOwnCerimoniere() {
  const uuid = document.getElementById('edit-cerimoniere-uuid')?.value;
  return !!(uuid && currentUser?.uuid && uuid === currentUser.uuid);
}

function openAccountPage() {
  closeMobileMore();
  closeSidebar();
  void showSection('account');
}

function openMyProfile() {
  openAccountPage();
}

function accountInitials(nome) {
  const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function populateAccountForm() {
  if (!currentUser) return;
  const ruolo = currentUser.ruolo === 'prete' ? 'Don' : 'Cerimoniere';
  const roleBits = [ruolo];
  if (currentUser.admin) roleBits.push('Admin');
  const email = (currentUser.email || '').trim();
  if (email) roleBits.push(email);
  const roleEl = document.getElementById('account-role-label');
  if (roleEl) roleEl.textContent = roleBits.join(' · ');

  const displayName = document.getElementById('account-display-name');
  if (displayName) displayName.textContent = currentUser.nome || email || 'Il tuo profilo';

  const avatar = document.getElementById('account-avatar');
  if (avatar) avatar.textContent = accountInitials(currentUser.nome || email);

  const nome = document.getElementById('account-nome');
  const emailInput = document.getElementById('account-email');
  const parrocchia = document.getElementById('account-parrocchia');
  const pwd = document.getElementById('account-password');
  const pwd2 = document.getElementById('account-password2');
  if (nome) nome.value = currentUser.nome || '';
  if (emailInput) emailInput.value = currentUser.email || '';
  if (parrocchia) parrocchia.value = currentUser.parrocchia || '';
  if (pwd) pwd.value = '';
  if (pwd2) pwd2.value = '';
  const pending = document.getElementById('account-email-pending');
  if (pending) {
    pending.hidden = true;
    pending.textContent = '';
  }
  const pwdSection = document.getElementById('account-password-section');
  const pwdWrap = document.getElementById('account-password-wrap');
  const pwd2Wrap = document.getElementById('account-password2-wrap');
  const hidePwd = !!isGAS;
  if (pwdSection) pwdSection.hidden = hidePwd;
  if (pwdWrap) pwdWrap.style.display = hidePwd ? 'none' : '';
  if (pwd2Wrap) pwd2Wrap.style.display = hidePwd ? 'none' : '';
}

async function handleAccountFormSubmit(e) {
  e.preventDefault();
  if (!currentUser?.uuid) {
    showToast('Sessione non valida');
    return;
  }
  const nome = document.getElementById('account-nome')?.value.trim() || '';
  const email = document.getElementById('account-email')?.value.trim() || '';
  const parrocchia = document.getElementById('account-parrocchia')?.value || '';
  const password = document.getElementById('account-password')?.value || '';
  const password2 = document.getElementById('account-password2')?.value || '';

  if (!nome || !email) {
    showToast('Nome e email obbligatori');
    return;
  }
  if (password) {
    if (password.length < 6) {
      showToast('Password di almeno 6 caratteri');
      return;
    }
    if (password !== password2) {
      showToast('Le password non coincidono');
      return;
    }
  }

  let result;
  if (isSupabase) {
    result = await window.ChierichSupabase.aggiornaIlMioProfilo({
      nome,
      email,
      parrocchia,
      password: password || undefined
    });
  } else if (isGAS) {
    result = await gasRun('aggiornaCerimoniere', currentUser.uuid, { nome, email, parrocchia });
  } else {
    showToast('Salvataggio non disponibile');
    return;
  }

  if (!result?.success) {
    showToast(result?.message || 'Errore salvataggio');
    return;
  }

  if (result.user) {
    saveSession(authToken || 'supabase', result.user);
    updateSidebarUser();
  } else {
    currentUser = { ...currentUser, nome, email, parrocchia };
    updateSidebarUser();
  }

  const pendingEl = document.getElementById('account-email-pending');
  if (result.needsEmailConfirm && pendingEl) {
    pendingEl.hidden = false;
    pendingEl.textContent = result.message
      || 'Controlla la nuova email e conferma il link prima di usarla per accedere.';
    showToast('Controlla la nuova email per confermare');
  } else {
    if (pendingEl) {
      pendingEl.hidden = true;
      pendingEl.textContent = '';
    }
    showToast(result.message || (password ? 'Profilo e password aggiornati' : 'Profilo aggiornato'));
  }
  populateAccountForm();
}

function updateSidebarUser() {
  syncCerimonieriAdminUi();
  syncChierichettiAdminUi();
  syncGruppiAdminUi();
  const label = currentUser ? (currentUser.nome || currentUser.email || '—') : '—';
  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = label;
  const moreName = document.getElementById('mobile-more-user-name');
  if (moreName) moreName.textContent = label;
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}

function showAuthGate() {
  document.getElementById('auth-gate').classList.remove('hidden');
  document.getElementById('auth-gate').setAttribute('aria-hidden', 'false');
  document.getElementById('app-shell').classList.add('hidden');
}

function showAppShell() {
  document.getElementById('auth-gate').classList.add('hidden');
  document.getElementById('auth-gate').setAttribute('aria-hidden', 'true');
  document.getElementById('app-shell').classList.remove('hidden');
  initMobileMoreGestures();
}

function gasRun(fn, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
}

async function fetchAuthStatus() {
  if (isGAS) {
    return gasRun('getAuthStatus');
  }
  if (isSupabase) {
    return window.ChierichSupabase.getAuthStatus();
  }
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  const res = await fetch(`${API_BASE}/api/auth/status`, { headers });
  return res.ok ? res.json() : { needsBootstrap: false, authenticated: false };
}

function applyGasAuthStatus(status) {
  if (!status) {
    showAuthGate();
    setAuthMode('google-wait');
    showAuthError('Nessuna risposta dal server Google. Ricarica la pagina.');
    return false;
  }
  if (status.authenticated && status.user) {
    saveSession(status.token || 'google', status.user);
    showAppShell();
    initApp();
    return true;
  }
  clearSession();
  showAuthGate();
  const detail = [status.message, status.error].filter(Boolean).join(' — ');
  if (status.needsGoogleIdentity) {
    setAuthMode('google-wait', { googleEmail: status.googleEmail });
    showAuthError(detail || 'Google non ha inviato l\'email. Vedi le istruzioni sotto.');
  } else if (status.needsBootstrap) {
    setAuthMode('bootstrap', { googleEmail: status.googleEmail });
    if (detail) showAuthError(detail);
  } else if (status.unauthorized) {
    setAuthMode('unauthorized', { googleEmail: status.googleEmail });
    showAuthError(detail || 'Account non autorizzato');
  } else {
    setAuthMode('google-wait', { googleEmail: status.googleEmail });
    showAuthError(detail || 'Accesso non riuscito');
  }
  return false;
}

async function continueWithGoogle() {
  showAuthError('');
  const btn = document.getElementById('auth-google-btn');
  if (btn) btn.disabled = true;
  try {
    const status = await gasRun('loginWithGoogle');
    applyGasAuthStatus(status);
  } catch (err) {
    const msg = (err && (err.message || err.details || String(err))) || 'errore sconosciuto';
    showAuthError('Errore Google: ' + msg + ' — se la distribuzione è «Esegui come Me», cambiala in «Utente che accede all\'app web».');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const opts = { ...options, headers };
  if (opts.body && typeof opts.body === 'object') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    clearSession();
    showAuthGate();
    setAuthMode('login');
    showAuthError('Sessione scaduta — accedi di nuovo');
    throw new Error('Non autenticato');
  }
  return res;
}

async function checkAuthAndInit() {
  if (isGAS) {
    try {
      const status = await fetchAuthStatus();
      applyGasAuthStatus(status);
    } catch {
      showAuthGate();
      setAuthMode('google-wait');
      showAuthError('Autorizza l\'app quando Google lo chiede, poi premi Continua con Google.');
    }
    return;
  }

  if (!isSupabase) {
    showAuthGate();
    setAuthMode('login');
    showAuthError('Accesso non configurato su questo sito. Se sei l\'amministratore: GitHub → Settings → Pages → Source = GitHub Actions, con i secret SUPABASE_URL e SUPABASE_ANON_KEY.');
    console.warn('[ChierichApp] CHIERICH_CONFIG assente. Locale: npm run dev con .env. Produzione: secret Actions + Pages su GitHub Actions.');
    return;
  }

  try {
    window.ChierichSupabase.ensureAuthListeners();
    // Breve attesa perché detectSessionInUrl / PASSWORD_RECOVERY possano settarsi
    await new Promise(r => setTimeout(r, 80));
    if (window.ChierichSupabase.isPasswordRecovery()) {
      clearSession();
      showAuthGate();
      setAuthMode('recovery');
      return;
    }
    const status = await fetchAuthStatus();
    if (window.ChierichSupabase.isPasswordRecovery()) {
      clearSession();
      showAuthGate();
      setAuthMode('recovery');
      return;
    }
    if (status.authenticated && status.user) {
      saveSession(status.token || 'supabase', status.user);
      showAppShell();
      initApp();
      return;
    }
    clearSession();
    showAuthGate();
    if (status.needsBootstrap) setAuthMode('bootstrap');
    else if (status.unauthorized) {
      setAuthMode('login');
      showAuthError(status.message || 'Account non autorizzato');
    } else setAuthMode('login');
  } catch (err) {
    showAuthGate();
    setAuthMode('login');
    showAuthError('Supabase non raggiungibile — riprova tra poco');
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  showAuthError('');
  if (authMode !== 'forgot') showAuthInfo('');
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const password2 = document.getElementById('auth-password2')?.value || '';
  const nome = document.getElementById('auth-nome').value.trim();
  const btn = document.getElementById('auth-submit-btn');
  btn.disabled = true;

  try {
    let result;
    if (isGAS) {
      if (authMode !== 'bootstrap') {
        await continueWithGoogle();
        return;
      }
      if (!nome) {
        showAuthError('Inserisci nome e cognome');
        return;
      }
      result = await gasRun('bootstrapCerimoniere', { nome });
      if (result.authenticated && result.user) {
        applyGasAuthStatus(result);
        document.getElementById('auth-login-form').reset();
        return;
      }
      if (!result.success) {
        showAuthError(result.message || 'Errore creazione account');
        return;
      }
      applyGasAuthStatus(result);
      return;
    }

    if (authMode === 'forgot') {
      if (!isSupabase) {
        showAuthError('Recupero password non disponibile');
        return;
      }
      result = await window.ChierichSupabase.resetPasswordForEmail(email);
      if (!result.success) {
        showAuthError(result.message || 'Invio non riuscito');
        return;
      }
      showAuthInfo(result.message);
      setAuthMode('login', { keepInfo: true });
      return;
    }

    if (authMode === 'recovery') {
      if (!isSupabase) {
        showAuthError('Recupero password non disponibile');
        return;
      }
      if (password !== password2) {
        showAuthError('Le password non coincidono');
        return;
      }
      result = await window.ChierichSupabase.updatePassword(password);
      if (!result.success) {
        showAuthError(result.message || 'Aggiornamento non riuscito');
        return;
      }
      document.getElementById('auth-login-form').reset();
      if (result.user) {
        saveSession(result.token || 'supabase', result.user);
        showAppShell();
        initApp();
        showToast(result.message || 'Password aggiornata');
        return;
      }
      showAuthInfo(result.message || 'Password aggiornata. Accedi con la nuova password.');
      setAuthMode('login', { keepInfo: true });
      return;
    }

    if (authMode === 'bootstrap') {
      if (!nome) {
        showAuthError('Inserisci nome e cognome');
        return;
      }
      if (isSupabase) {
        result = await window.ChierichSupabase.bootstrap({ nome, email, password });
        if (result.needsEmailConfirm) {
          showAuthError(result.message || 'Conferma l\'email poi accedi');
          setAuthMode('login');
          return;
        }
      } else {
        const res = await fetch(`${API_BASE}/api/auth/bootstrap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nome, email, password })
        });
        result = await res.json();
        if (!result.success) {
          showAuthError(result.message || 'Errore creazione account');
          return;
        }
        const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        result = await loginRes.json();
      }
    } else if (isSupabase) {
      result = await window.ChierichSupabase.login(email, password);
    } else {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      result = await res.json();
    }

    if (!result.success) {
      showAuthError(result.message || 'Accesso non riuscito');
      return;
    }
    saveSession(result.token, result.user);
    showAppShell();
    document.getElementById('auth-login-form').reset();
    initApp();
  } catch (err) {
    console.error('Auth submit failed:', err);
    const msg = String(err?.message || '').toLowerCase();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) {
      showAuthError('Sei offline — controlla la connessione');
    } else if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('fetch')) {
      showAuthError('Supabase non raggiungibile — riprova tra qualche secondo');
    } else {
      showAuthError(err?.message || 'Accesso non riuscito — riprova');
    }
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  try {
    if (isSupabase) await window.ChierichSupabase.logout();
    else if (!isGAS && authToken) await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch { /* ok */ }
  clearSession();
  showAuthGate();
  if (isGAS) {
    setAuthMode('google-wait');
    showAuthError('Per uscire del tutto, cambia Account Google nel browser e ricarica la pagina.');
  } else {
    setAuthMode('login');
  }
  document.getElementById('auth-login-form').reset();
}

function initApp() {
  loadData();
  ensureGruppiConfig();
  populateGruppoSelects();
  populateAnnoNascitaSelect();
  updateTurniPanelMeta();
  updateMesseDomenicaliSummary();
  updateTopbarDate();

  const today = getTodayStr();
  const appelloData = document.getElementById('appello-data');
  if (appelloData) appelloData.value = today;

  const year = new Date().getFullYear();
  document.getElementById('anno-messe').value = String(year);
  document.getElementById('anno-calendario').value = String(year);

  const launchSection = getLaunchSection();
  if (launchSection === 'presenze') openAppello();
  else if (launchSection === 'account') openAccountPage();
  else showSection(launchSection || 'dashboard');
  syncMessaDomenicaleFormDay();
  void bootstrapFromServer().then(() => {
    if (calState.data?.byDate) {
      if (document.getElementById('dashboard').classList.contains('active')) renderDashboard();
    } else {
      void ensureCalendarioForToday();
    }
  });
}

function getLaunchSection() {
  try {
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    const allowed = new Set([
      'dashboard', 'presenze', 'registro', 'messe',
      'calendario', 'gruppi', 'turni', 'anagrafica', 'account'
    ]);
    if (!section || !allowed.has(section)) return null;
    params.delete('section');
    const qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    return section;
  } catch {
    return null;
  }
}

async function bootstrapFromServer() {
  setSyncBanner('Caricamento dati…');
  const statusEl = document.getElementById('sync-status');
  if (statusEl) statusEl.textContent = 'Caricamento…';
  try {
    await syncFromServer();
    setSyncBanner('');
  } catch {
    setSyncBanner('Non sincronizzato. Mostro i dati già sul dispositivo.', true);
  }
  refreshVisibleUi();
  if (!isGAS && !isSupabase) await loadCerimonieriAccounts();
}

function setSyncBanner(text, isError) {
  const el = document.getElementById('sync-banner');
  if (!el) return;
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    el.classList.remove('is-error');
    return;
  }
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
  el.classList.remove('hidden');
}

function refreshVisibleUi() {
  populateGruppoSelects();
  updateTurniPanelMeta();
  updateMesseDomenicaliSummary();
  const active = document.querySelector('.section.active');
  if (active?.id) showSection(active.id);
}

function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function ensureCalendarioForToday() {
  await ensureCalendarioForYear(new Date().getFullYear());
  if (document.getElementById('dashboard').classList.contains('active')) renderDashboard();
}

async function ensureCalendarioForYear(anno) {
  anno = String(anno);
  if (calState.data?.anno === anno && calState.data?.byDate && Object.keys(calState.data.byDate).length) {
    calState.unavailable = false;
    return calState.data;
  }
  try {
    if (isGAS) {
      const data = await gasRun('getCalendarioLiturgico', anno);
      if (data?.byDate && Object.keys(data.byDate).length) {
        calState.data = data;
        calState.unavailable = false;
        return calState.data;
      }
    } else if (isSupabase) {
      let data = await window.ChierichSupabase.getCalendarioLiturgico(anno);
      if (!data?.byDate || !Object.keys(data.byDate).length) {
        data = await fetchAmbrosianCalendarYear(anno);
        await window.ChierichSupabase.salvaCalendarioLiturgico(anno, data);
      }
      if (data?.byDate && Object.keys(data.byDate).length) {
        calState.data = data;
        calState.unavailable = false;
        return calState.data;
      }
    } else {
      const res = await fetch(`${API_BASE}/api/calendario/${anno}`);
      if (res.ok) {
        calState.data = await res.json();
        if (calState.data?.byDate && Object.keys(calState.data.byDate).length) {
          calState.unavailable = false;
          return calState.data;
        }
      }
    }
  } catch { /* offline ok */ }
  calState.unavailable = true;
  return null;
}

function isCalendarioUnavailable() {
  return !!calState.unavailable;
}

function calendarioUnavailableHtml(opts = {}) {
  const withCta = opts.withCta !== false;
  const cta = withCta
    ? `<div class="today-agenda-footer"><button type="button" class="btn-ghost-light" onclick="showSection('calendario')">Apri Liturgia e aggiorna</button></div>`
    : '';
  return `<p class="today-empty empty-state-inline">Calendario liturgico non disponibile — riprova da Liturgia.</p>${cta}`;
}

function updateTopbarDate() {
  const el = document.getElementById('topbar-date');
  el.textContent = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

// ── Sidebar / mobile «Altro» ─────────────────────────────────
function isPhoneShell() {
  return window.matchMedia('(max-width: 1024px)').matches;
}

function openAltroMenu() {
  if (isPhoneShell()) {
    if (document.getElementById('mobile-more-sheet')?.classList.contains('is-open')) closeMobileMore();
    else openMobileMore();
    return;
  }
  openSidebar();
}

function openMobileMore() {
  closeSidebar();
  const sheet = document.getElementById('mobile-more-sheet');
  const overlay = document.getElementById('mobile-more-overlay');
  const altro = document.getElementById('mobile-tab-altro');
  if (!sheet || !overlay) return;
  const nameSrc = document.getElementById('sidebar-user-name')?.textContent || '—';
  const nameEl = document.getElementById('mobile-more-user-name');
  if (nameEl) nameEl.textContent = nameSrc;
  const activeId = document.querySelector('.section.active')?.id;
  sheet.querySelectorAll('.mobile-more-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.section === activeId);
  });
  overlay.hidden = false;
  sheet.hidden = false;
  sheet.style.transform = '';
  overlay.style.opacity = '';
  requestAnimationFrame(() => {
    overlay.classList.add('is-open');
    sheet.classList.add('is-open');
  });
  document.body.classList.add('more-sheet-open');
  if (altro) altro.setAttribute('aria-expanded', 'true');
}

function closeMobileMore() {
  const sheet = document.getElementById('mobile-more-sheet');
  const overlay = document.getElementById('mobile-more-overlay');
  const altro = document.getElementById('mobile-tab-altro');
  if (!sheet || !overlay) return;
  overlay.classList.remove('is-open');
  sheet.classList.remove('is-open');
  sheet.style.transform = '';
  overlay.style.opacity = '';
  document.body.classList.remove('more-sheet-open');
  if (altro) altro.setAttribute('aria-expanded', 'false');
  window.setTimeout(() => {
    if (!sheet.classList.contains('is-open')) {
      overlay.hidden = true;
      sheet.hidden = true;
    }
  }, 280);
}

/** Swipe-up dalla tab bar / bordo basso → apre; swipe-down sul foglio → chiude. */
function initMobileMoreGestures() {
  if (initMobileMoreGestures.done) return;
  initMobileMoreGestures.done = true;

  const sheet = document.getElementById('mobile-more-sheet');
  const overlay = document.getElementById('mobile-more-overlay');
  const tabbar = document.getElementById('mobile-tabbar');
  if (!sheet || !overlay || !tabbar) return;

  const OPEN_DY = 56;
  const CLOSE_DY = 64;
  let track = null;

  function isSheetOpen() {
    return sheet.classList.contains('is-open');
  }

  function onStart(e) {
    if (!isPhoneShell() || e.touches.length !== 1) return;
    if (document.getElementById('app-shell')?.classList.contains('hidden')) return;
    const t = e.touches[0];
    const handleOrChrome = e.target.closest('.mobile-more-handle, .mobile-more-brand, .mobile-more-footer');
    // Click su Account: non avviare gesto swipe
    if (e.target.closest('.mobile-more-account, .mobile-more-close')) return;
    const nav = sheet.querySelector('.mobile-more-nav');
    const atTop = !nav || nav.scrollTop <= 0;
    const fromSheet = isSheetOpen() && sheet.contains(e.target) && (handleOrChrome || atTop);
    // Solo dalla tab bar: lo swipe dal bordo contenuto rubava lo scroll e «espandeva» la nav
    const fromTabbar = !isSheetOpen() && tabbar.contains(e.target);
    if (!fromSheet && !fromTabbar) return;
    track = {
      x0: t.clientX,
      y0: t.clientY,
      y: t.clientY,
      mode: fromSheet ? 'close' : 'open',
      moved: false
    };
  }

  function onMove(e) {
    if (!track || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dy = t.clientY - track.y0;
    const dx = t.clientX - track.x0;
    track.y = t.clientY;
    if (!track.moved) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        track = null;
        return;
      }
      track.moved = true;
    }
    if (track.mode === 'close' && dy > 0) {
      e.preventDefault();
      sheet.classList.add('is-dragging');
      sheet.style.transform = `translateY(${dy}px)`;
      overlay.style.opacity = String(Math.max(0.15, 1 - dy / 280));
    } else if (track.mode === 'open' && dy < 0) {
      e.preventDefault();
      if (sheet.hidden) {
        sheet.hidden = false;
        overlay.hidden = false;
        overlay.classList.add('is-open');
        sheet.classList.add('is-dragging');
      }
      const h = Math.max(sheet.offsetHeight, 280);
      const progress = Math.min(1, -dy / (OPEN_DY * 1.4));
      sheet.style.transform = `translateY(${h * (1 - progress)}px)`;
      overlay.style.opacity = String(0.15 + progress * 0.85);
    }
  }

  function onEnd() {
    if (!track) return;
    const dy = track.y - track.y0;
    const { mode, moved } = track;
    track = null;
    sheet.classList.remove('is-dragging');

    if (!moved) {
      sheet.style.transform = '';
      overlay.style.opacity = '';
      return;
    }

    if (mode === 'close') {
      if (dy > CLOSE_DY) closeMobileMore();
      else {
        sheet.style.transform = '';
        overlay.style.opacity = '';
      }
      return;
    }

    if (dy < -OPEN_DY) {
      sheet.style.transform = '';
      overlay.style.opacity = '';
      openMobileMore();
    } else {
      sheet.style.transform = '';
      overlay.style.opacity = '';
      if (!isSheetOpen()) {
        overlay.classList.remove('is-open');
        sheet.classList.remove('is-open');
        overlay.hidden = true;
        sheet.hidden = true;
      }
    }
  }

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onEnd, { passive: true });
}

function openSidebar() {
  if (isPhoneShell()) {
    openMobileMore();
    return;
  }
  closeMobileMore();
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
  document.body.classList.add('sidebar-open');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
  document.body.classList.remove('sidebar-open');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (document.getElementById('sidebar')?.classList.contains('open')) closeSidebar();
  else openSidebar();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('messa-nota-modal')?.classList.contains('hidden')) {
    closeMessaNotaModal();
    return;
  }
  if (document.getElementById('anag-action-sheet')?.classList.contains('is-open')) {
    closeAnagPersonMenu();
    return;
  }
  if (document.body.classList.contains('anag-sheet-open')) {
    closeAnagSheet();
    return;
  }
  if (document.body.classList.contains('messe-sheet-open')) {
    closeMesseSheet();
    return;
  }
  if (document.body.classList.contains('gruppi-sheet-open')) {
    closeGruppiFormSheet();
    return;
  }
  closeMobileMore();
  closeSidebar();
});

window.addEventListener('resize', () => {
  syncAnagFab();
  syncMesseFab();
  syncGruppiFab();
  if (!isAnagMobile()) {
    document.body.classList.remove('anag-sheet-open');
    closeMesseSheet();
    closeGruppiFormSheet();
    const overlay = document.getElementById('anag-form-overlay');
    if (overlay) overlay.hidden = true;
    const tel = document.getElementById('anag-telefoni-fields');
    if (tel) tel.classList.add('has-tel2');
  } else {
    const open = isAnagSheetOpen();
    document.body.classList.toggle('anag-sheet-open', open);
    const overlay = document.getElementById('anag-form-overlay');
    if (overlay) overlay.hidden = !open;
  }
});

function updateMobileNav(sectionId) {
  const primary = { dashboard: true, presenze: true, messe: true };
  document.querySelectorAll('.mobile-tab[data-section]').forEach(btn => {
    const on = btn.dataset.section === sectionId;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  const altro = document.getElementById('mobile-tab-altro');
  if (altro) altro.classList.toggle('active', !primary[sectionId]);
  document.querySelectorAll('.mobile-more-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.section === sectionId);
  });
}

// ── Navigation ──────────────────────────────────────────────
function isAnyAppelloDraftDirty() {
  return Object.values(appelloDraftDirty).some(Boolean);
}

function scheduleAppelloAutoSave() {
  if (appelloAutoSaveTimer) clearTimeout(appelloAutoSaveTimer);
  appelloAutoSaveTimer = setTimeout(() => {
    appelloAutoSaveTimer = null;
    void saveAppello({ quiet: true });
  }, 800);
}

async function flushAppelloIfNeeded() {
  if (appelloAutoSaveTimer) {
    clearTimeout(appelloAutoSaveTimer);
    appelloAutoSaveTimer = null;
  }
  if (appelloSaving) {
    // Attendi il salvataggio in corso
    for (let i = 0; i < 40 && appelloSaving; i++) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  if (!isAnyAppelloDraftDirty() && !appelloSaveFailed) return true;
  await saveAppello({ quiet: true });
  if (isAnyAppelloDraftDirty() || appelloSaveFailed) {
    showToast('Salva l\'appello prima di uscire — tocca Riprova');
    return false;
  }
  return true;
}

async function showSection(sectionId) {
  const current = document.querySelector('.section.active')?.id;
  if (current === 'presenze' && sectionId !== 'presenze') {
    const ok = await flushAppelloIfNeeded();
    if (!ok) return;
  }

  const next = document.getElementById(sectionId);
  if (!next) return;

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  next.classList.add('active');
  // Re-trigger section enter animation
  next.style.animation = 'none';
  void next.offsetWidth;
  next.style.animation = '';
  document.body.classList.toggle('appello-focus', sectionId === 'presenze');

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === sectionId);
  });
  updateMobileNav(sectionId);

  const meta = PAGE_META[sectionId];
  if (meta) {
    document.getElementById('page-title').textContent = meta.title;
    document.getElementById('page-subtitle').textContent = meta.subtitle;
  }

  closeSidebar();
  closeMobileMore();
  if (sectionId !== 'anagrafica') {
    closeAnagPersonMenu();
    closeAnagPersonDetail();
    document.body.classList.remove('anag-sheet-open');
    const overlay = document.getElementById('anag-form-overlay');
    if (overlay) overlay.hidden = true;
  }
  if (sectionId !== 'messe') closeMesseSheet();
  if (sectionId !== 'gruppi') {
    closeGruppiFormSheet();
    closeGruppiEdit(true);
  }
  syncAnagFab();
  syncMesseFab();
  syncGruppiFab();

  if (sectionId === 'dashboard') renderDashboard();
  else if (sectionId === 'anagrafica') {
    if (anagraficaTab === 'cerimoniere') {
      loadCerimonieriAccounts().then(() => renderCerimonieri());
    } else {
      updateAnagraficaFormLabels();
      renderChierichetti();
    }
  }
  else if (sectionId === 'turni') renderTurni();
  else if (sectionId === 'gruppi') void renderGruppi();
  else if (sectionId === 'messe') loadMesseAgenda();
  else if (sectionId === 'presenze') renderAppello();
  else if (sectionId === 'registro') {
    renderRegistro();
    syncRegistroFiltersToggle();
  }
  else if (sectionId === 'calendario') {
    if (!calState.data || calState.data.anno !== getCalAnno()) loadCalendario();
    else {
      renderCalMonth();
      ensureCalDaySelected();
    }
  }
  else if (sectionId === 'account') {
    populateAccountForm();
  }
}

// ── Data ────────────────────────────────────────────────────
function normalizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(s.chierichetti)) s.chierichetti = [];
  if (!Array.isArray(s.turni)) s.turni = [];
  if (!Array.isArray(s.presenze)) s.presenze = [];
  if (!Array.isArray(s.messeExtra)) s.messeExtra = [];
  if (!s.messeIndicazioni || typeof s.messeIndicazioni !== 'object' || Array.isArray(s.messeIndicazioni)) {
    s.messeIndicazioni = {};
  }
  s.schemaVersion = DATA_SCHEMA_VERSION;
  return s;
}

function migratePresenzeUuid() {
  state.presenze.forEach(p => {
    if (p.chierichettoUuid) return;
    const chi = state.chierichetti.find(c => c.nome === p.nome);
    if (chi) p.chierichettoUuid = chi.uuid;
    if (p.ora === undefined) p.ora = '';
    if (p.sede === undefined) p.sede = '';
  });
}

function migrateMesseExtra() {
  state.messeExtra.forEach(m => {
    if (!m.ora) m.ora = '10:00';
    if (!m.sede) m.sede = 'santuario';
  });
}

function migrateChierichettiParrocchia() {
  state.chierichetti.forEach((c, i) => {
    if (!isChierichettoPersona(c) || c.parrocchia) return;
    c.parrocchia = i % 2 === 0 ? 'vanzago' : 'mantegazza';
  });
}

function migrateAnnoNascita() {
  state.chierichetti.forEach(c => {
    if (c.annoNascita) {
      c.annoNascita = String(c.annoNascita);
      if (c.classe) delete c.classe;
      return;
    }
    const raw = c.classe;
    if (!raw) return;
    if (/^\d{4}$/.test(String(raw))) c.annoNascita = String(raw);
    else if (CLASSE_TO_ANNO_NASCITA[raw]) c.annoNascita = CLASSE_TO_ANNO_NASCITA[raw];
    delete c.classe;
  });
}

function getAnniNascitaRange() {
  const year = new Date().getFullYear();
  const anni = [];
  for (let y = year - 6; y >= year - 18; y--) anni.push(String(y));
  return anni;
}

function formatAnnoNascitaLabel(anno) {
  if (!anno) return '—';
  return String(anno);
}

function populateAnnoNascitaSelect(selected) {
  const sel = document.getElementById('anno-nascita');
  if (!sel) return;
  const val = selected ?? sel.value;
  sel.innerHTML = '<option value="">Seleziona</option>' +
    getAnniNascitaRange().map(y =>
      `<option value="${y}"${String(val) === y ? ' selected' : ''}>${y}</option>`
    ).join('');
}

function populateAnnoNascitaFilter() {
  const sel = document.getElementById('filter-anno-nascita');
  if (!sel) return;
  const current = sel.value;
  const fromData = [...new Set(
    state.chierichetti.map(c => c.annoNascita).filter(Boolean).map(String)
  )];
  const anni = [...new Set([...getAnniNascitaRange(), ...fromData])].sort((a, b) => b - a);
  sel.innerHTML = '<option value="">Tutti gli anni</option>' +
    anni.map(y => `<option value="${y}"${current === y ? ' selected' : ''}>${y}</option>`).join('');
}

function migrateCerimoniereTurno() {
  // I chierichetti non sono più «cerimoniere di turno»: azzera il flag su tutti
  state.chierichetti.forEach(c => {
    if (c.ruolo === 'cerimoniere') c.ruolo = 'chierichetto';
    c.cerimoniereTurno = false;
  });
}

function migrateChierichettiPromosso() {
  state.chierichetti.forEach(c => {
    if (c.promosso === 'true') c.promosso = true;
    else if (c.promosso === 'false' || c.promosso === undefined || c.promosso === '') c.promosso = false;
  });
}

function migrateChierichettiAttivo() {
  state.chierichetti.forEach(c => {
    if (c.attivo === 'false') c.attivo = false;
    else if (c.attivo === 'true' || c.attivo === undefined || c.attivo === '') c.attivo = true;
  });
}

/** Azzera storico operativo: si riparte dall'anno pastorale 2026/27 */
function migrateResetOperationalHistoryFor2026_27(prevVersion) {
  const pastoralFrom = getPastoralYearWindowStart(REGISTRO_MIN_PASTORAL_START);
  if (prevVersion < 6) {
    state.presenze = [];
    state.turni = [];
    state.messeExtra = [];
    state.messeIndicazioni = {};
    if (state.gruppiConfig && Array.isArray(state.gruppiConfig.cronologia)) {
      state.gruppiConfig.cronologia = [];
    }
    appelloDraft = {};
    appelloDraftDirty = {};
    registroPastoralStart = REGISTRO_MIN_PASTORAL_START;
    registroMonth = null;
    return;
  }
  state.presenze = (state.presenze || []).filter(p => !p.data || p.data >= pastoralFrom);
  state.turni = (state.turni || []).filter(t => !t.data || t.data >= pastoralFrom);
  state.messeExtra = (state.messeExtra || []).filter(m => !m.data || m.data >= pastoralFrom);
  const ind = ensureMesseIndicazioni();
  Object.keys(ind).forEach(dateStr => {
    if (dateStr < pastoralFrom) delete ind[dateStr];
  });
}

function isCerimoniereTurno(c) {
  return c?.cerimoniereTurno === true || c?.cerimoniereTurno === 'true';
}

function isLinkedCerimoniereAccount(chi) {
  if (!chi || !cerimonieriAccounts?.length) return false;
  if (cerimonieriAccounts.some(a => a.chierichettoUuid && a.chierichettoUuid === chi.uuid)) return true;
  const email = (chi.email || '').trim().toLowerCase();
  if (!email) return false;
  return cerimonieriAccounts.some(a => (a.email || '').trim().toLowerCase() === email);
}

/** Account cerimoniere/Don senza scheda chierichetto collegata (assegnabile ai gruppi da solo). */
function isCerimoniereAccountStandalone(a) {
  return !!(a && a.uuid && !a.chierichettoUuid);
}

/** Don (sacerdote): non è cerimoniere di servizio e non entra nei gruppi. */
function isDonPersona(p) {
  if (!p) return false;
  if (p.ruolo === 'prete') return true;
  if (p._source === 'cerimoniere') return false;
  const acc = (cerimonieriAccounts || []).find(a =>
    (a.chierichettoUuid && a.chierichettoUuid === p.uuid) ||
    (!!p.email && !!a.email && String(a.email).toLowerCase() === String(p.email).toLowerCase())
  );
  return acc?.ruolo === 'prete';
}

function asCerimoniereGruppoPersona(a) {
  if (!a) return null;
  return {
    uuid: a.uuid,
    nome: a.nome,
    email: a.email || '',
    parrocchia: a.parrocchia || '',
    gruppo: a.gruppo || '',
    attivo: a.attivo !== false,
    ruolo: a.ruolo === 'prete' ? 'prete' : 'cerimoniere',
    annoNascita: '',
    telefono: '',
    telefono2: '',
    _source: 'cerimoniere',
    cerimoniereTurno: false,
    promosso: false
  };
}

function getCerimonieriStandaloneForGruppi() {
  return (cerimonieriAccounts || [])
    .filter(a =>
      isPersonaAttiva(a) &&
      isCerimoniereAccountStandalone(a) &&
      a.ruolo !== 'prete'
    )
    .map(asCerimoniereGruppoPersona);
}

/** Chierichetti attivi + cerimonieri (non Don) dell’anagrafica accessi senza doppioni collegati. */
function getPersoneGruppiPool() {
  return [
    ...state.chierichetti.filter(c => isChierichettoAttivo(c) && !isDonPersona(c)),
    ...getCerimonieriStandaloneForGruppi()
  ];
}

function findGruppoPersona(uuid) {
  if (!uuid) return null;
  const chi = state.chierichetti.find(c => c.uuid === uuid);
  if (chi) return chi;
  const acc = (cerimonieriAccounts || []).find(a => a.uuid === uuid && isCerimoniereAccountStandalone(a));
  return acc ? asCerimoniereGruppoPersona(acc) : null;
}

function isCerimoniereAccountPersona(p) {
  return !!(p && (p._source === 'cerimoniere' || (
    (cerimonieriAccounts || []).some(a => a.uuid === p.uuid && isCerimoniereAccountStandalone(a))
  )));
}

function setPersonaGruppoLocal(uuid, gruppoId) {
  const chi = state.chierichetti.find(c => c.uuid === uuid);
  if (chi) {
    chi.gruppo = gruppoId || '';
    return chi;
  }
  const acc = (cerimonieriAccounts || []).find(a => a.uuid === uuid);
  if (acc) {
    acc.gruppo = gruppoId || '';
    return asCerimoniereGruppoPersona(acc);
  }
  return null;
}

async function persistPersonaGruppo(uuid, gruppoId) {
  const persona = findGruppoPersona(uuid);
  if (!persona) return false;

  if (isCerimoniereAccountPersona(persona)) {
    const prev = (cerimonieriAccounts.find(a => a.uuid === uuid)?.gruppo) || '';
    setPersonaGruppoLocal(uuid, gruppoId);
    try {
      let result;
      if (isGAS) result = await gasRun('aggiornaCerimoniere', uuid, { gruppo: gruppoId || '' });
      else if (isSupabase) result = await window.ChierichSupabase.aggiornaCerimoniere(uuid, { gruppo: gruppoId || '' });
      else result = { success: true };
      if (result && result.success === false) {
        setPersonaGruppoLocal(uuid, prev);
        showToast(result.message || 'Salvataggio gruppo non riuscito');
        return false;
      }
      return true;
    } catch (e) {
      setPersonaGruppoLocal(uuid, prev);
      showToast(e.message || 'Salvataggio gruppo non riuscito');
      return false;
    }
  }

  const chi = state.chierichetti.find(c => c.uuid === uuid);
  if (!chi) return false;
  const prev = chi.gruppo || '';
  chi.gruppo = gruppoId || '';
  const ok = await persistPersona({
    nome: chi.nome,
    email: chi.email || '',
    telefono: chi.telefono || '',
    telefono2: chi.telefono2 || '',
    telefonoChi: chi.telefonoChi || '',
    telefono2Chi: chi.telefono2Chi || '',
    ruolo: chi.ruolo,
    annoNascita: chi.annoNascita,
    parrocchia: chi.parrocchia,
    cerimoniereTurno: false,
    gruppo: gruppoId || ''
  }, chi.uuid);
  if (!ok) chi.gruppo = prev;
  return ok;
}

/** Cerimoniere di servizio (non Don) — tab Cerimonieri, sezione gruppi, conteggi. */
function isAppelloCerimoniere(c) {
  if (!c || isDonPersona(c)) return false;
  if (c._source === 'cerimoniere') return true;
  return isCerimoniereTurno(c) || isLinkedCerimoniereAccount(c);
}

function chierichettoNomeHtml(c) {
  return isAppelloCerimoniere(c) ? `<strong>${esc(c.nome)}</strong>` : esc(c.nome);
}

function parsePersonaNome(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { nome: '', cognome: '' };
  if (parts.length === 1) return { nome: parts[0], cognome: parts[0] };
  return {
    nome: parts.slice(0, -1).join(' '),
    cognome: parts[parts.length - 1]
  };
}

function comparePersonaNome(a, b) {
  const pa = parsePersonaNome(a.nome);
  const pb = parsePersonaNome(b.nome);
  const byCognome = pa.cognome.localeCompare(pb.cognome, 'it', { sensitivity: 'base' });
  if (byCognome !== 0) return byCognome;
  return pa.nome.localeCompare(pb.nome, 'it', { sensitivity: 'base' });
}

function sortChierichettiAppello(a, b) {
  const byRole = (isAppelloCerimoniere(a) ? 0 : 1) - (isAppelloCerimoniere(b) ? 0 : 1);
  if (byRole !== 0) return byRole;
  return comparePersonaNome(a, b);
}

function sortChierichettiInGruppo(a, b) {
  const d = (isCerimoniereTurno(a) ? 0 : 1) - (isCerimoniereTurno(b) ? 0 : 1);
  return d !== 0 ? d : a.nome.localeCompare(b.nome, 'it');
}

function getCurrentUserChierichetto() {
  if (!currentUser) return null;
  if (currentUser.chierichettoUuid) {
    const linked = state.chierichetti.find(c => c.uuid === currentUser.chierichettoUuid);
    if (linked) return linked;
  }
  const email = (currentUser.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = state.chierichetti.find(c =>
      isChierichettoPersona(c) && (c.email || '').trim().toLowerCase() === email
    );
    if (byEmail) return byEmail;
  }
  const acc = (cerimonieriAccounts || []).find(a => a.uuid === currentUser.uuid && isCerimoniereAccountStandalone(a));
  return acc ? asCerimoniereGruppoPersona(acc) : null;
}

function excludeCurrentUserFromAppelloList(list) {
  const me = getCurrentUserChierichetto();
  if (!me) return list;
  return list.filter(c => c.uuid !== me.uuid);
}

function usesGlobalAppelloTabs() {
  return !!(getCurrentUserChierichetto()?.gruppo);
}

function getAppelloPrimaryGruppo(slotGruppo) {
  if (slotGruppo) return slotGruppo;
  return getCurrentUserChierichetto()?.gruppo || '';
}

/** Messa senza squadra assegnata — appello libero per sede/parrocchia */
function isMessaSenzaGruppoServizio(slot) {
  return !!slot && !slot.gruppo;
}

function getAppelloPrimaryGruppoForSlot(slot) {
  if (!slot || isMessaSenzaGruppoServizio(slot)) return '';
  return getAppelloPrimaryGruppo(slot.gruppo);
}

function getDefaultAppelloParrocchiaTab(primaryGruppo, slot) {
  if (primaryGruppo) return 'mine';
  if (slot?.sede === 'mantegazza') {
    const hasMantegazza = state.chierichetti.some(c =>
      isChierichettoPersona(c) && c.parrocchia === 'mantegazza' && !isAppelloCerimoniere(c)
    );
    return hasMantegazza ? 'mantegazza' : 'vanzago';
  }
  if (slot?.sede === 'vanzago') return 'vanzago';
  return 'vanzago';
}

function getAppelloParrocchiaTabs(primaryGruppo, slot) {
  const tabs = [];
  if (primaryGruppo) {
    tabs.push({ id: 'mine', label: 'Di turno' });
  }
  tabs.push({ id: 'vanzago', label: 'Vanzago' });
  tabs.push({ id: 'mantegazza', label: 'Mantegazza' });
  tabs.push({ id: 'cerimonieri', label: 'Cerimonieri' });
  return tabs;
}

function filterAppelloCerimonieriExtra(list, primaryGruppo) {
  return list.filter(c =>
    isAppelloCerimoniere(c) &&
    (!primaryGruppo || c.gruppo !== primaryGruppo)
  );
}

function filterChierichettiForAppelloTab(list, tab, primaryGruppo) {
  if (tab === 'mine' && primaryGruppo) {
    return list.filter(c => c.gruppo === primaryGruppo);
  }
  if (tab === 'vanzago') {
    return list.filter(c =>
      c.parrocchia !== 'mantegazza' &&
      (!primaryGruppo || c.gruppo !== primaryGruppo) &&
      !isAppelloCerimoniere(c)
    );
  }
  if (tab === 'mantegazza') {
    return list.filter(c =>
      c.parrocchia === 'mantegazza' &&
      (!primaryGruppo || c.gruppo !== primaryGruppo) &&
      !isAppelloCerimoniere(c)
    );
  }
  if (tab === 'cerimonieri') {
    return filterAppelloCerimonieriExtra(list, primaryGruppo);
  }
  return list;
}

function resolveAppelloTab(currentTab, primaryGruppo, slot) {
  const tabs = getAppelloParrocchiaTabs(primaryGruppo, slot);
  const sedeDefault = getDefaultAppelloParrocchiaTab(primaryGruppo, slot);
  if (!currentTab || !tabs.some(t => t.id === currentTab)) return sedeDefault;
  return currentTab;
}

function getAppelloTabForSlot(slotKey, primaryGruppo, slot) {
  if (usesGlobalAppelloTabs()) {
    appelloParrocchiaTab = resolveAppelloTab(appelloParrocchiaTab, primaryGruppo, slot);
    return appelloParrocchiaTab;
  }
  const key = slotKey || '_fallback';
  appelloParrocchiaTabBySlot[key] = resolveAppelloTab(
    appelloParrocchiaTabBySlot[key],
    primaryGruppo,
    slot
  );
  return appelloParrocchiaTabBySlot[key];
}

function ensureAppelloParrocchiaTab(primaryGruppo, slot) {
  appelloParrocchiaTab = resolveAppelloTab(appelloParrocchiaTab, primaryGruppo, slot || null);
}

function renderAppelloParrocchiaTabsHtml(primaryGruppo, slotKey, activeTab, slot) {
  const tab = activeTab ?? getAppelloTabForSlot(slotKey, primaryGruppo, slot);
  const tabs = getAppelloParrocchiaTabs(primaryGruppo, slot);
  const slotArg = slotKey && !usesGlobalAppelloTabs() ? `, ${jsStr(slotKey)}` : '';
  return `
    <div class="appello-parrocchia-tabs section-tabs" role="tablist" aria-label="Filtra per gruppo, parrocchia o cerimonieri">
      ${tabs.map(t => `
        <button type="button" class="section-tab${t.id === tab ? ' active' : ''}"
          role="tab" aria-selected="${t.id === tab}"
          onclick='switchAppelloParrocchiaTab(${jsStr(t.id)}${slotArg})'>${esc(t.label)}</button>
      `).join('')}
    </div>
  `;
}

function switchAppelloParrocchiaTab(tab, slotKey) {
  if (slotKey && !usesGlobalAppelloTabs()) {
    appelloParrocchiaTabBySlot[slotKey] = tab;
  } else {
    appelloParrocchiaTab = tab;
  }
  renderAppello();
}

function getAppelloTier(c, myGruppo) {
  if (myGruppo && c.gruppo === myGruppo) return 0;
  if (c.parrocchia === 'vanzago') return 1;
  if (c.parrocchia === 'mantegazza') return 2;
  return 3;
}

function getAppelloTierLabel(tier, myGruppo) {
  if (tier === 0) return getGruppoLabel(myGruppo) || 'Il tuo gruppo';
  if (tier === 1) return myGruppo ? 'Altri — Vanzago' : 'Vanzago';
  if (tier === 2) return myGruppo ? 'Altri — Mantegazza' : 'Mantegazza';
  return 'Altri';
}

function sortAppelloChierichetti(a, b, myGruppo) {
  const ta = getAppelloTier(a, myGruppo);
  const tb = getAppelloTier(b, myGruppo);
  if (ta !== tb) return ta - tb;
  return sortChierichettiInGruppo(a, b);
}

function getAppelloFilteredList() {
  const dateStr = getAppelloDate();
  const myGruppo = getCurrentUserChierichetto()?.gruppo || '';

  let list = getPersoneGruppiPool();
  list = filterAppelloChierichetti(list);
  list.sort((a, b) => sortAppelloChierichetti(a, b, myGruppo));
  return { list, myGruppo, dateStr };
}

function getParrocchiaLabel(id) {
  return PARROCCHIA_LABEL[id] || id || '—';
}

function parrocchiaBadgeHtml(id) {
  if (!id || !PARROCCHIA_LABEL[id]) return '';
  return `<span class="parrocchia-badge ${esc(id)}">${esc(getParrocchiaLabel(id))}</span>`;
}

/** Santuario: entrambe le parrocchie; Vanzago/Mantegazza: parrocchia dedicata */
function getParrocchiaForSede(sede) {
  if (sede === 'vanzago' || sede === 'mantegazza') return sede;
  return null;
}

function getSlotParrocchiaLabel(sede) {
  const p = getParrocchiaForSede(sede);
  return p ? getParrocchiaLabel(p) : 'Vanzago e Mantegazza';
}

/** Messa di servizio nel weekend (ex «turno» T1/M1 nel tabellone) */
function formatMessaServizioLabel(num) {
  return num ? `Messa ${num}` : '';
}

function formatMessaServizioShort(num) {
  return num ? `M${num}` : '';
}

/** Turno del ciclo di rotazione settimanale (ex «ciclo») */
function formatRotazioneTurnoLabel(num) {
  return num ? `Turno ${num}` : '';
}

function chierichettoCanServeSlot(chi, slotOrSede) {
  const sede = typeof slotOrSede === 'string' ? slotOrSede : slotOrSede?.sede;
  const req = getParrocchiaForSede(sede);
  if (!req) return true;
  if (!chi.parrocchia) return true; // entrambe / non impostata
  return chi.parrocchia === req;
}

function chierichettoCanJoinGruppo(chi, gruppoId) {
  if (!chi || isDonPersona(chi)) return false;
  const gruppi = getGruppiOrdered().slice(0, getTurniSlot().length);
  if (gruppi.findIndex(g => g.id === gruppoId) < 0) return false;
  return getTurniSlot().some(slot => chierichettoCanServeSlot(chi, slot));
}

function loadData() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) state = normalizeState(JSON.parse(data));
    else state = normalizeState({});
    const prevVersion = Number(state.schemaVersion) || 0;
    ensureGruppiConfig();
    migratePresenzeUuid();
    migrateMesseExtra();
    migrateChierichettiParrocchia();
    migrateAnnoNascita();
    migrateCerimoniereTurno();
    migrateChierichettiAttivo();
    migrateChierichettiPromosso();
    migrateResetOperationalHistoryFor2026_27(prevVersion);
    state.schemaVersion = DATA_SCHEMA_VERSION;
  } catch (e) {
    console.error('Errore caricamento dati:', e);
    state = normalizeState({});
  }
}

function saveDataLocal() {
  try {
    state.schemaVersion = DATA_SCHEMA_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Errore salvataggio dati:', e);
    showToast('Errore salvataggio locale — spazio esaurito?');
  }
}

function saveData() {
  saveDataLocal();
}

function mergeByUuid(local, remote, idField) {
  if (!Array.isArray(remote)) return local;
  const map = new Map(local.map(x => [x[idField || 'uuid'], x]));
  remote.forEach(item => {
    if (item && item.uuid) map.set(item.uuid, { ...map.get(item.uuid), ...item });
  });
  return [...map.values()];
}

async function fetchGasAppData() {
  try {
    return await gasRun('getAppData');
  } catch {
    const [chi, turni, pres, configRes, cer] = await Promise.all([
      gasRun('getChierichetti'),
      gasRun('getTurni'),
      gasRun('getPresenze'),
      gasRun('getConfig'),
      gasRun('getCerimonieri').catch(() => [])
    ]);
    return {
      ok: true,
      chierichetti: chi,
      turni,
      presenze: pres,
      cerimonieri: cer,
      config: configRes
    };
  }
}

function applyServerSnapshot(chi, turni, pres, configRes, cerimonieri) {
  const pastoralFrom = getPastoralYearWindowStart(REGISTRO_MIN_PASTORAL_START);
  state.chierichetti = Array.isArray(chi) ? chi : [];
  state.turni = (Array.isArray(turni) ? turni : []).filter(t => !t.data || t.data >= pastoralFrom);
  state.presenze = (Array.isArray(pres) ? pres : []).filter(p => !p.data || p.data >= pastoralFrom);
  state.messeExtra = Array.isArray(configRes?.messeExtra)
    ? configRes.messeExtra.filter(m => !m.data || m.data >= pastoralFrom)
    : [];
  state.messeIndicazioni = (configRes?.messeIndicazioni && typeof configRes.messeIndicazioni === 'object' && !Array.isArray(configRes.messeIndicazioni))
    ? configRes.messeIndicazioni
    : {};
  Object.keys(state.messeIndicazioni).forEach(dateStr => {
    if (dateStr < pastoralFrom) delete state.messeIndicazioni[dateStr];
  });
  if (configRes?.gruppiConfig) state.gruppiConfig = configRes.gruppiConfig;
  if (Array.isArray(cerimonieri)) {
    cerimonieriAccounts = cerimonieri;
    cerimonieriHydrated = true;
  }
  migratePresenzeUuid();
  migrateCerimoniereTurno();
  migrateChierichettiAttivo();
  migrateChierichettiPromosso();
}

async function syncFromServer() {
  const statusEl = document.getElementById('sync-status');
  try {
    let chi = [];
    let turni = [];
    let pres = [];
    let configRes = null;
    let cer = null;
    if (isGAS) {
      const pack = await fetchGasAppData();
      if (pack?.ok === false) {
        if (pack.auth && !pack.auth.authenticated) applyGasAuthStatus(pack.auth);
        throw new Error(pack.auth?.message || 'Sincronizzazione non riuscita');
      }
      chi = Array.isArray(pack?.chierichetti) ? pack.chierichetti : [];
      turni = Array.isArray(pack?.turni) ? pack.turni : [];
      pres = Array.isArray(pack?.presenze) ? pack.presenze : [];
      configRes = pack?.config || null;
      cer = pack?.cerimonieri;
      if (pack?.calendario?.byDate) calState.data = pack.calendario;
    } else if (isSupabase) {
      const pack = await window.ChierichSupabase.getAppData();
      if (pack?.ok === false) {
        throw new Error(pack.auth?.message || 'Sincronizzazione non riuscita');
      }
      chi = Array.isArray(pack?.chierichetti) ? pack.chierichetti : [];
      turni = Array.isArray(pack?.turni) ? pack.turni : [];
      pres = Array.isArray(pack?.presenze) ? pack.presenze : [];
      configRes = pack?.config || null;
      cer = pack?.cerimonieri;
    } else {
      const pack = await apiFetch('/api/app-data').then(r => r.ok ? r.json() : null);
      if (pack) {
        chi = Array.isArray(pack.chierichetti) ? pack.chierichetti : [];
        turni = Array.isArray(pack.turni) ? pack.turni : [];
        pres = Array.isArray(pack.presenze) ? pack.presenze : [];
        configRes = pack.config || null;
        cer = pack.cerimonieri;
      } else {
        [chi, turni, pres, configRes] = await Promise.all([
          apiFetch('/api/chierichetti').then(r => r.ok ? r.json() : []),
          apiFetch('/api/turni').then(r => r.ok ? r.json() : []),
          apiFetch('/api/presenze').then(r => r.ok ? r.json() : []),
          apiFetch('/api/config').then(r => r.ok ? r.json() : null)
        ]);
      }
    }
    applyServerSnapshot(chi, turni, pres, configRes, cer);
    apiOnline = true;
    saveDataLocal();
    if (statusEl) {
      statusEl.textContent = isGAS
        ? 'Sincronizzato con Google Sheets'
        : isSupabase
          ? 'Sincronizzato con Supabase'
          : 'Sincronizzato con server locale';
    }
  } catch {
    apiOnline = false;
    if (statusEl) {
      statusEl.textContent = isGAS
        ? 'Solo locale (Sheets non raggiungibile)'
        : isSupabase
          ? 'Solo locale (Supabase non raggiungibile)'
          : 'Solo locale (server non raggiungibile)';
    }
    throw new Error('sync failed');
  }
}

function mutationFailed(result, fallback) {
  if (result && result.success === false) {
    throw new Error(result.message || fallback);
  }
  return result;
}

async function persistToApi(path, body, method) {
  if (isGAS || isSupabase) return { success: true, skipped: true };
  if (!apiOnline) return { success: true, skipped: true };
  const res = await apiFetch(path, {
    method: method || 'POST',
    body
  });
  let result = {};
  try { result = await res.json(); } catch { result = {}; }
  if (!res.ok) throw new Error(result.message || 'Operazione non riuscita');
  return mutationFailed(result, 'Operazione non riuscita') || result;
}

async function persistPersona(dati, uuid) {
  saveDataLocal();
  try {
    if (isGAS) {
      const result = uuid
        ? await gasRun('aggiornaChierichetto', uuid, dati)
        : await gasRun('salvaChierichetto', dati);
      mutationFailed(result, 'Salvataggio persona non riuscito');
    } else if (isSupabase) {
      const result = uuid
        ? await window.ChierichSupabase.aggiornaChierichetto(uuid, dati)
        : await window.ChierichSupabase.salvaChierichetto(dati);
      mutationFailed(result, 'Salvataggio persona non riuscito');
    } else if (uuid) {
      await persistToApi(`/api/chierichetti/${uuid}`, dati, 'PUT');
    } else {
      await persistToApi('/api/chierichetti', dati);
    }
    saveDataLocal();
    return true;
  } catch (e) {
    showToast(e.message || 'Salvataggio persona non riuscito');
    return false;
  }
}

async function persistTurnoRecord(turno) {
  saveDataLocal();
  try {
    if (isGAS) {
      mutationFailed(await gasRun('salvaTurno', turno), 'Salvataggio turno non riuscito');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaTurno(turno), 'Salvataggio turno non riuscito');
    } else {
      await persistToApi('/api/turni', turno);
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Salvataggio turno non riuscito');
    return false;
  }
}

async function persistPresenzaRecord(presenza) {
  saveDataLocal();
  try {
    if (isGAS) {
      mutationFailed(await gasRun('salvaPresenza', presenza), 'Presenza non salvata');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaPresenza(presenza), 'Presenza non salvata');
    } else {
      await persistToApi('/api/presenze', presenza);
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Presenza non salvata');
    return false;
  }
}

async function persistDeletePresenza(uuid) {
  if (!uuid) return true;
  try {
    if (isGAS) {
      mutationFailed(await gasRun('eliminaPresenza', uuid), 'Eliminazione presenza non riuscita');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.eliminaPresenza(uuid), 'Eliminazione presenza non riuscita');
    } else if (apiOnline) {
      await persistToApi(`/api/presenze/${uuid}`, {}, 'DELETE');
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Eliminazione presenza non riuscita');
    return false;
  }
}

async function persistDeletePersona(uuid) {
  try {
    if (isGAS) {
      mutationFailed(await gasRun('eliminaChierichetto', uuid), 'Eliminazione non riuscita');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.eliminaChierichetto(uuid), 'Eliminazione non riuscita');
    } else if (apiOnline) {
      await persistToApi(`/api/chierichetti/${uuid}`, {}, 'DELETE');
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Eliminazione non riuscita');
    return false;
  }
}

async function persistConfig() {
  if (!requireAdminAction('Solo l\'admin può modificare gruppi e configurazione')) return false;
  saveDataLocal();
  const body = {
    gruppiConfig: state.gruppiConfig,
    messeExtra: state.messeExtra || [],
    messeIndicazioni: state.messeIndicazioni || {}
  };
  try {
    if (isGAS) {
      mutationFailed(await gasRun('salvaConfig', body), 'Salvataggio configurazione non riuscito');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaConfig(body), 'Salvataggio configurazione non riuscito');
    } else {
      await persistToApi('/api/config', body);
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Salvataggio configurazione non riuscito');
    return false;
  }
}

async function persistMesseIndicazioni() {
  saveDataLocal();
  const body = { messeIndicazioni: state.messeIndicazioni || {} };
  try {
    if (isGAS) {
      mutationFailed(await gasRun('salvaConfig', body), 'Salvataggio indicazioni non riuscito');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaConfig(body), 'Salvataggio indicazioni non riuscito');
    } else {
      await persistToApi('/api/config', body);
    }
    return true;
  } catch (e) {
    showToast(e.message || 'Salvataggio indicazioni non riuscito');
    return false;
  }
}

function updateMesseAgendaSummary() {
  const el = document.getElementById('messe-agenda-summary');
  if (!el) return;
  const nTurni = getTurniPerDomenica();
  const nMesse = getMesseSenzaChierichetti().length;
  const nTot = nTurni + nMesse;
  const sediTurni = [...new Set(getTurniSlot().map(t => SEDI_LABEL[t.sede] || t.sede))].join(', ');
  el.innerHTML = `${nTot} celebrazioni domenicali · <strong>${nTurni} con squadra</strong>${sediTurni ? ' (' + esc(sediTurni) + ')' : ''}${nMesse ? ' · ' + nMesse + ' libere' : ''}`;
}

function getGruppiServizioForDate(dateStr) {
  const gruppi = new Set();
  const info = getMessaInfo(dateStr);
  if (info?.type === 'domenica') {
    getTurniSlots(dateStr).forEach(s => { if (s.gruppo) gruppi.add(s.gruppo); });
  } else if (info?.type === 'extra') {
    state.turni.filter(t => t.data === dateStr).forEach(t => { if (t.gruppo) gruppi.add(t.gruppo); });
    const ora = info.extra?.ora || '10:00';
    const sede = info.extra?.sede || 'santuario';
    const slotGruppo = state.turni.find(t => t.data === dateStr && t.oraInizio === ora && t.parrocchia === sede);
    if (slotGruppo?.gruppo) gruppi.add(slotGruppo.gruppo);
  }
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDay() === 6) {
    const dom = addDaysToDateStr(dateStr, 1);
    if (getMessaInfo(dom)?.type === 'domenica') {
      getMesseOrdinarieSlots(dom).filter(s => s.conChierichetti && s.data === dateStr).forEach(s => {
        if (s.gruppo) gruppi.add(s.gruppo);
      });
    }
  }
  if (d.getDay() === 0) {
    getTurniSlots(dateStr).forEach(s => { if (s.gruppo) gruppi.add(s.gruppo); });
  }
  return [...gruppi];
}

function getAppelloDate() {
  return document.getElementById('appello-data')?.value || getTodayStr();
}

function messaSlotKey(slot) {
  return `${slot.data}|${slot.sede}|${slot.ora}`;
}

function newMessaNotaId() {
  return 'NOTE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function ensureMesseIndicazioni() {
  if (!state.messeIndicazioni || typeof state.messeIndicazioni !== 'object' || Array.isArray(state.messeIndicazioni)) {
    state.messeIndicazioni = {};
  }
  return state.messeIndicazioni;
}

function normalizeMessaNotaItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const testo = String(raw.testo || '').trim();
  if (!testo) return null;
  return {
    id: raw.id || newMessaNotaId(),
    testo,
    autoreUuid: raw.autoreUuid || '',
    autoreNome: raw.autoreNome || 'Utente',
    createdAt: raw.createdAt || new Date().toISOString()
  };
}

/** Migra stringa legacy → array note multi-autore */
function normalizeMessaNoteList(raw) {
  if (Array.isArray(raw)) {
    return raw.map(normalizeMessaNotaItem).filter(Boolean)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [{
      id: newMessaNotaId(),
      testo: raw.trim(),
      autoreUuid: '',
      autoreNome: 'Indicazioni',
      createdAt: new Date().toISOString()
    }];
  }
  return [];
}

function ensureMesseIndicazioniEntry(messaDateStr) {
  const map = ensureMesseIndicazioni();
  let entry = map[messaDateStr];
  if (!entry || typeof entry !== 'object') {
    entry = { note: [], celebrazioni: {} };
    map[messaDateStr] = entry;
  }
  // legacy: entry.nota (string) → entry.note (array)
  if (!Array.isArray(entry.note)) {
    entry.note = normalizeMessaNoteList(entry.nota);
    delete entry.nota;
  } else {
    entry.note = normalizeMessaNoteList(entry.note);
  }
  if (!entry.celebrazioni || typeof entry.celebrazioni !== 'object' || Array.isArray(entry.celebrazioni)) {
    entry.celebrazioni = {};
  }
  Object.keys(entry.celebrazioni).forEach(k => {
    entry.celebrazioni[k] = normalizeMessaNoteList(entry.celebrazioni[k]);
  });
  map[messaDateStr] = entry;
  return entry;
}

function getMessaNoteList(messaDateStr) {
  return ensureMesseIndicazioniEntry(messaDateStr).note.slice();
}

function getCelebrazioneNoteList(messaDateStr, slot) {
  const key = typeof slot === 'string' ? slot : messaSlotKey(slot);
  const entry = ensureMesseIndicazioniEntry(messaDateStr);
  return (entry.celebrazioni[key] || []).slice();
}

function pruneMesseIndicazioniEntry(messaDateStr) {
  const map = ensureMesseIndicazioni();
  const entry = map[messaDateStr];
  if (!entry) return;
  const note = normalizeMessaNoteList(entry.note);
  const celeb = {};
  Object.entries(entry.celebrazioni || {}).forEach(([k, list]) => {
    const cleaned = normalizeMessaNoteList(list);
    if (cleaned.length) celeb[k] = cleaned;
  });
  if (!note.length && !Object.keys(celeb).length) {
    delete map[messaDateStr];
  } else {
    map[messaDateStr] = { note, celebrazioni: celeb };
  }
}

function getMessaNotaAutore() {
  if (!currentUser) return { uuid: '', nome: 'Utente' };
  const nome = (currentUser.nome || '').trim()
    || (currentUser.email || '').trim()
    || 'Utente';
  return { uuid: currentUser.uuid || '', nome };
}

function formatMessaNotaWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

function canDeleteMessaNota(note) {
  if (!note) return false;
  if (isCurrentUserAdmin()) return true;
  return !!(currentUser?.uuid && note.autoreUuid && note.autoreUuid === currentUser.uuid);
}

function schedulePersistMesseIndicazioni() {
  saveDataLocal();
  clearTimeout(messeIndicazioniSaveTimer);
  messeIndicazioniSaveTimer = setTimeout(() => {
    void persistMesseIndicazioni();
  }, 400);
}

function addMessaNota(messaDateStr, slotKey, testo) {
  const text = String(testo || '').trim();
  if (!text) return false;
  const entry = ensureMesseIndicazioniEntry(messaDateStr);
  const autore = getMessaNotaAutore();
  const item = {
    id: newMessaNotaId(),
    testo: text,
    autoreUuid: autore.uuid,
    autoreNome: autore.nome,
    createdAt: new Date().toISOString()
  };
  if (slotKey) {
    if (!Array.isArray(entry.celebrazioni[slotKey])) entry.celebrazioni[slotKey] = [];
    entry.celebrazioni[slotKey].push(item);
  } else {
    entry.note.push(item);
  }
  pruneMesseIndicazioniEntry(messaDateStr);
  schedulePersistMesseIndicazioni();
  return true;
}

function removeMessaNota(messaDateStr, slotKey, noteId) {
  const entry = ensureMesseIndicazioniEntry(messaDateStr);
  const list = slotKey
    ? (entry.celebrazioni[slotKey] || [])
    : entry.note;
  const note = list.find(n => n.id === noteId);
  if (!canDeleteMessaNota(note)) {
    showToast('Puoi eliminare solo le tue note');
    return;
  }
  if (!confirm('Eliminare questa nota?')) return;
  if (slotKey) {
    entry.celebrazioni[slotKey] = list.filter(n => n.id !== noteId);
  } else {
    entry.note = list.filter(n => n.id !== noteId);
  }
  pruneMesseIndicazioniEntry(messaDateStr);
  schedulePersistMesseIndicazioni();
  if (messeState.selectedDate) renderMessaDetail(messeState.selectedDate);
}

function openMessaNotaModal(messaDateStr, slotKey, contextLabel) {
  if (!currentUser) {
    showToast('Accedi per inserire una nota');
    return;
  }
  messaNotaModalCtx = {
    messaDate: messaDateStr,
    slotKey: slotKey || null,
    label: contextLabel || 'questa messa'
  };
  const modal = document.getElementById('messa-nota-modal');
  const title = document.getElementById('messa-nota-modal-title');
  const sub = document.getElementById('messa-nota-modal-sub');
  const ta = document.getElementById('messa-nota-modal-text');
  if (title) title.textContent = slotKey ? 'Nota celebrazione' : 'Indicazioni del don';
  if (sub) sub.textContent = contextLabel
    ? `La nota sarà firmata con il tuo nome · ${contextLabel}`
    : 'La nota sarà firmata con il tuo nome';
  if (ta) ta.value = '';
  modal?.classList.remove('hidden');
  requestAnimationFrame(() => ta?.focus());
}

function closeMessaNotaModal() {
  document.getElementById('messa-nota-modal')?.classList.add('hidden');
  messaNotaModalCtx = null;
  const ta = document.getElementById('messa-nota-modal-text');
  if (ta) ta.value = '';
}

function submitMessaNotaModal() {
  if (!messaNotaModalCtx?.messaDate) return;
  const ta = document.getElementById('messa-nota-modal-text');
  const text = (ta?.value || '').trim();
  if (!text) {
    showToast('Scrivi una nota prima di inserirla');
    ta?.focus();
    return;
  }
  const ok = addMessaNota(messaNotaModalCtx.messaDate, messaNotaModalCtx.slotKey, text);
  if (!ok) return;
  closeMessaNotaModal();
  showToast('Nota inserita');
  if (messeState.selectedDate) renderMessaDetail(messeState.selectedDate);
}

function renderMessaNotesListHtml(notes, messaDateStr, slotKey) {
  if (!notes.length) {
    return '<p class="messa-notes-empty">Nessuna nota ancora</p>';
  }
  return `<ul class="messa-notes-list">${notes.map(n => {
    const canDel = canDeleteMessaNota(n);
    return `
      <li class="messa-note-card${canDel ? ' has-delete' : ''}">
        <div class="messa-note-meta">
          <span class="messa-note-author">${esc(n.autoreNome || 'Utente')}</span>
          <span>${esc(formatMessaNotaWhen(n.createdAt))}</span>
        </div>
        <p class="messa-note-body">${esc(n.testo)}</p>
        ${canDel ? `
          <button type="button" class="messa-note-delete" title="Elimina nota"
            onclick='removeMessaNota(${jsStr(messaDateStr)}, ${jsStr(slotKey || '')}, ${jsStr(n.id)})'
            aria-label="Elimina nota">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>
            </svg>
          </button>` : ''}
      </li>`;
  }).join('')}</ul>`;
}

function renderMessaNotaFieldHtml(messaDateStr, { label } = {}) {
  const notes = getMessaNoteList(messaDateStr);
  const title = label || 'Indicazioni del don';
  const count = notes.length ? ` · ${notes.length}` : '';
  return `
    <section class="messa-notes">
      <div class="messa-notes-head">
        <h4 class="messa-notes-title">${esc(title)}${count}</h4>
        <button type="button" class="messa-notes-add"
          onclick='openMessaNotaModal(${jsStr(messaDateStr)}, null, ${jsStr(title)})'>+ Aggiungi</button>
      </div>
      ${renderMessaNotesListHtml(notes, messaDateStr, null)}
    </section>`;
}

function renderCelebrazioneNotaFieldHtml(messaDateStr, slot) {
  const key = messaSlotKey(slot);
  const notes = getCelebrazioneNoteList(messaDateStr, key);
  const context = `${slot.ora || ''} ${slot.sedeLabel || SEDI_LABEL[slot.sede] || slot.sede || ''}`.trim();
  const count = notes.length ? ` · ${notes.length}` : '';
  return `
    <section class="messa-notes messa-slot-notes">
      <div class="messa-notes-head">
        <h4 class="messa-notes-title">Note${count}</h4>
        <button type="button" class="messa-notes-add"
          onclick='openMessaNotaModal(${jsStr(messaDateStr)}, ${jsStr(key)}, ${jsStr(context)})'>+ Nota</button>
      </div>
      ${notes.length ? renderMesseNotesListHtml(notes, messaDateStr, key) : ''}
    </section>`;
}

function parseMessaSlotKey(key) {
  const [data, sede, ora] = key.split('|');
  return { data, sede, ora };
}

function presenzaMatchesChierichetto(p, uuid) {
  const chi = state.chierichetti.find(c => c.uuid === uuid);
  return p.chierichettoUuid === uuid || (!p.chierichettoUuid && chi && p.nome === chi.nome);
}

function isPresenzaGiorno(p) {
  return !p.ora && !p.sede;
}

function getPresenzaServizioFor(uuid, dateStr, ora, sede) {
  return state.presenze.find(p =>
    p.data === dateStr && p.ora === ora && p.sede === sede &&
    p.stato === 'presente' && presenzaMatchesChierichetto(p, uuid)
  );
}

function getPresenzaGiornoFor(uuid, dateStr) {
  return state.presenze.find(p =>
    p.data === dateStr && isPresenzaGiorno(p) && presenzaMatchesChierichetto(p, uuid)
  );
}

/** @deprecated use getPresenzaGiornoFor or getPresenzaServizioFor */
function getPresenzaFor(uuid, dateStr) {
  return getPresenzaGiornoFor(uuid, dateStr) || state.presenze.find(p =>
    p.data === dateStr && p.stato === 'presente' && presenzaMatchesChierichetto(p, uuid)
  );
}

function getCelebrationsForAppelloDate(dateStr) {
  const info = getMessaInfo(dateStr);
  const slots = [];
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();

  const pushSlotsForDate = (domenicaRef, slotDate) => {
    getMesseOrdinarieSlots(domenicaRef)
      .filter(s => s.data === slotDate)
      .forEach(s => slots.push({ ...s, key: messaSlotKey(s) }));
  };

  if (info?.type === 'domenica' || day === 0) {
    pushSlotsForDate(dateStr, dateStr);
  }

  if (day === 6) {
    const dom = addDaysToDateStr(dateStr, 1);
    if (getMessaInfo(dom)?.type === 'domenica') {
      pushSlotsForDate(dom, dateStr);
    }
  }

  if (info?.type === 'extra') {
    const ex = info.extra;
    const ora = ex.ora || '10:00';
    const sede = ex.sede || 'santuario';
    const slot = {
      data: dateStr,
      ora,
      sede,
      sedeLabel: SEDI_LABEL[sede] || sede,
      label: ex.nota || 'Messa straordinaria',
      conChierichetti: true,
      gruppo: null,
      gruppoLabel: null,
      vigilia: false,
      isExtra: true,
      key: messaSlotKey({ data: dateStr, ora, sede })
    };
    if (!slots.some(s => s.key === slot.key)) slots.push(slot);
  }

  return slots.sort((a, b) => a.ora.localeCompare(b.ora) || (a.sede || '').localeCompare(b.sede || ''));
}

function sortChierichettiForMessaSlot(a, b, slotGruppo) {
  const tier = c => {
    if (slotGruppo && c.gruppo === slotGruppo) return 0;
    if (c.parrocchia === 'vanzago') return 1;
    if (c.parrocchia === 'mantegazza') return 2;
    return 3;
  };
  const ta = tier(a), tb = tier(b);
  if (ta !== tb) return ta - tb;
  return sortChierichettiInGruppo(a, b);
}

function getExpectedForMessaSlot(slot) {
  if (!slot.gruppo) return [];
  return getPersoneGruppiPool().filter(c =>
    c.gruppo === slot.gruppo && chierichettoCanServeSlot(c, slot.sede)
  );
}

/** Elenco appello: messe libere ammettono entrambe le parrocchie */
function getChierichettiForAppelloSlot(slot) {
  if (!slot) return [];
  if (isMessaSenzaGruppoServizio(slot)) {
    return getPersoneGruppiPool()
      .slice()
      .sort((a, b) => sortChierichettiForMessaSlot(a, b, null));
  }
  return getChierichettiForMessaSlot(slot);
}

function getChierichettiForMessaSlot(slot) {
  return getPersoneGruppiPool()
    .filter(c => chierichettoCanServeSlot(c, slot.sede))
    .sort((a, b) => sortChierichettiForMessaSlot(a, b, slot.gruppo));
}

function removePresenzaRecord(uuid) {
  state.presenze = state.presenze.filter(p => p.uuid !== uuid);
  saveData();
  return persistDeletePresenza(uuid);
}

function upsertPresenzaServizio(chierichettoUuid, slot, served) {
  const chi = findGruppoPersona(chierichettoUuid);
  if (!chi) return Promise.resolve(true);
  const removed = state.presenze.filter(p =>
    p.data === slot.data && p.ora === slot.ora && p.sede === slot.sede &&
    presenzaMatchesChierichetto(p, chierichettoUuid)
  );
  state.presenze = state.presenze.filter(p => !(
    p.data === slot.data && p.ora === slot.ora && p.sede === slot.sede &&
    presenzaMatchesChierichetto(p, chierichettoUuid)
  ));
  if (served) {
    const record = {
      uuid: 'PRE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
      data: slot.data,
      chierichettoUuid,
      nome: chi.nome,
      stato: 'presente',
      ora: slot.ora,
      sede: slot.sede,
      motivo: '',
      createdAt: new Date().toISOString()
    };
    state.presenze.push(record);
    return persistPresenzaRecord(record);
  }
  saveData();
  return Promise.all(removed.map(p => persistDeletePresenza(p.uuid)));
}

function toggleServizioMessa(chierichettoUuid, slotKey, served) {
  const slot = parseMessaSlotKey(slotKey);
  slot.sedeLabel = SEDI_LABEL[slot.sede] || slot.sede;
  setDraftPresente(chierichettoUuid, slot.data, slot, served);
  renderAppello();
}

function upsertPresenza(chierichettoUuid, dateStr, stato, motivo) {
  const chi = findGruppoPersona(chierichettoUuid);
  if (!chi) return;
  state.presenze = state.presenze.filter(p => !(p.data === dateStr && isPresenzaGiorno(p) && (
    p.chierichettoUuid === chierichettoUuid ||
    (!p.chierichettoUuid && p.nome === chi.nome)
  )));
  const record = {
    uuid: 'PRE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    data: dateStr,
    chierichettoUuid,
    nome: chi.nome,
    stato,
    ora: '',
    sede: '',
    motivo: motivo || '',
    createdAt: new Date().toISOString()
  };
  state.presenze.push(record);
  saveData();
  persistPresenzaRecord(record);
}

function emailExists(email, excludeUuid) {
  const e = email.trim().toLowerCase();
  return state.chierichetti.some(c => c.email.trim().toLowerCase() === e && c.uuid !== excludeUuid);
}

function ensureGruppiConfig() {
  if (!state.gruppiConfig) {
    state.gruppiConfig = JSON.parse(JSON.stringify(DEFAULT_GRUPPI_CONFIG));
  }

  if (Array.isArray(state.gruppiConfig.turni) && !state.gruppiConfig.turniSlot && !state.gruppiConfig.messeDomenicali) {
    const old = state.gruppiConfig.turni;
    state.gruppiConfig.gruppi = old.map(t => ({
      id: t.id,
      nome: t.nome,
      ordine: (t.turnoNum || 1) - 1
    }));
    state.gruppiConfig.turniSlot = old.map(t => ({
      id: 'slot-' + t.id,
      turnoNum: t.turnoNum,
      dayOffset: t.dayOffset,
      ora: t.ora,
      sede: t.sede,
      vigilia: !!t.vigilia
    }));
    delete state.gruppiConfig.turni;
  }

  if (!Array.isArray(state.gruppiConfig.gruppi)) {
    state.gruppiConfig.gruppi = JSON.parse(JSON.stringify(DEFAULT_GRUPPI_CONFIG.gruppi));
  }
  if (!Array.isArray(state.gruppiConfig.messeDomenicali)) {
    const messe = [];
    const turni = state.gruppiConfig.turniSlot || DEFAULT_GRUPPI_CONFIG.messeDomenicali.filter(m => m.conTurno);
    const libere = state.gruppiConfig.messeSenzaChierichetti || DEFAULT_GRUPPI_CONFIG.messeDomenicali.filter(m => !m.conTurno);
    turni.forEach(t => {
      messe.push({
        id: t.id,
        dayOffset: t.dayOffset,
        ora: t.ora,
        sede: t.sede,
        vigilia: !!t.vigilia,
        conTurno: true,
        turnoNum: t.turnoNum
      });
    });
    libere.forEach(m => {
      messe.push({
        id: m.id,
        dayOffset: m.dayOffset,
        ora: m.ora,
        sede: m.sede,
        vigilia: !!m.vigilia,
        conTurno: false
      });
    });
    state.gruppiConfig.messeDomenicali = messe.length
      ? messe
      : JSON.parse(JSON.stringify(DEFAULT_GRUPPI_CONFIG.messeDomenicali));
    delete state.gruppiConfig.turniSlot;
    delete state.gruppiConfig.messeSenzaChierichetti;
  }
  normalizeRotazioneConfig();
  if (!Array.isArray(state.gruppiConfig.cronologia)) {
    state.gruppiConfig.cronologia = [];
  }
  renumberMesseDomenicali();
  repairGruppiConfig();
  syncGruppiToTurniSlots();
}

/** Ripara id duplicati o mancanti (es. due volte gruppo2 senza gruppo1) */
function repairGruppiConfig() {
  if (!state.gruppiConfig?.gruppi) return;
  const n = state.gruppiConfig.messeDomenicali.filter(m => m.conTurno).length;
  const gruppi = state.gruppiConfig.gruppi;
  const ids = gruppi.map(g => g.id);
  const dupIds = ids.length !== new Set(ids).size;
  const badIds = gruppi.some((g, i) => g.id !== 'gruppo' + (i + 1));

  if (!dupIds && !badIds && gruppi.length === n) return;

  const old = gruppi.slice().sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)).slice(0, n);
  const names = old.map((g, i) => {
    const dupName = old.some((x, j) => j !== i && x.nome === g.nome);
    return dupName || !g.nome?.trim() ? 'Gruppo ' + (i + 1) : g.nome.trim();
  });

  state.gruppiConfig.gruppi = Array.from({ length: n }, (_, i) => ({
    id: 'gruppo' + (i + 1),
    nome: names[i] || ('Gruppo ' + (i + 1)),
    ordine: i
  }));
}

function getMesseDomenicali() {
  ensureGruppiConfig();
  return state.gruppiConfig.messeDomenicali.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset || a.ora.localeCompare(b.ora));
}

function renumberMesseDomenicali() {
  if (!state.gruppiConfig?.messeDomenicali) return;
  const messe = state.gruppiConfig.messeDomenicali.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset || a.ora.localeCompare(b.ora));
  let n = 1;
  messe.forEach(m => {
    if (m.conTurno) m.turnoNum = n++;
    else delete m.turnoNum;
  });
  state.gruppiConfig.messeDomenicali = messe;
}

/** I gruppi sono fissi: uno per ogni messa domenicale con turno */
function syncGruppiToTurniSlots() {
  if (!state.gruppiConfig?.gruppi || !state.gruppiConfig?.messeDomenicali) return;
  const n = state.gruppiConfig.messeDomenicali.filter(m => m.conTurno).length;
  const gruppi = state.gruppiConfig.gruppi;

  while (gruppi.length < n) {
    const i = gruppi.length;
    gruppi.push({
      id: 'gruppo' + (i + 1),
      nome: 'Gruppo ' + (i + 1),
      ordine: i
    });
  }

  if (gruppi.length > n) {
    const removed = gruppi.splice(n);
    removed.forEach(g => appendGruppoCronologia('rimosso', g.id, { nome: g.nome }));
    const removedIds = new Set(removed.map(g => g.id));
    state.chierichetti.forEach(c => {
      if (c.gruppo && removedIds.has(c.gruppo)) c.gruppo = '';
    });
    (cerimonieriAccounts || []).forEach(a => {
      if (a.gruppo && removedIds.has(a.gruppo)) a.gruppo = '';
    });
  }
  gruppi.forEach((g, i) => { g.ordine = i; });

  const el = document.getElementById('gruppi-attivi-count');
  if (el) el.textContent = String(n);
}

function getGruppiThatWouldBeRemoved(newTurnoCount) {
  const gruppi = getGruppiOrdered();
  if (gruppi.length <= newTurnoCount) return [];
  return gruppi.slice(newTurnoCount);
}

function confirmOrphanGruppi(newTurnoCount) {
  const removed = getGruppiThatWouldBeRemoved(newTurnoCount);
  if (!removed.length) return true;
  const withChi = removed.filter(g => countChierichettiInGruppo(g.id) > 0);
  if (!withChi.length) return true;
  const names = withChi.map(g => getGruppoLabel(g.id)).join(', ');
  const n = withChi.reduce((s, g) => s + countChierichettiInGruppo(g.id), 0);
  return confirm(`Verranno rimossi ${removed.length} gruppo/i (${names}) e ${n} chierichetti perderanno l'assegnazione. Continuare?`);
}

function getGruppoIndex(gruppoId) {
  return getGruppiOrdered().slice(0, getTurniSlot().length).findIndex(g => g.id === gruppoId);
}

/** Settimana del ciclo (0-based) in cui il gruppo serve un dato turno messa */
function getRotationWeekForGruppoTurno(gruppoIndex, turnoNum) {
  const n = getTurniSlot().length;
  if (gruppoIndex < 0 || !turnoNum || !n) return 0;
  return ((turnoNum - 1 - gruppoIndex) % n + n) % n;
}

function getTurniAssignmentsForGruppo(gruppoId) {
  const gIdx = getGruppoIndex(gruppoId);
  if (gIdx < 0) return [];
  return getTurniSlot()
    .map(slot => ({ slot, rotationWeek: getRotationWeekForGruppoTurno(gIdx, slot.turnoNum) }))
    .sort((a, b) => a.rotationWeek - b.rotationWeek);
}

function getFixedTurnoNumForGruppo(gruppoId) {
  const gIdx = getGruppoIndex(gruppoId);
  return gIdx >= 0 ? gIdx + 1 : null;
}

function getCurrentWeekAssignmentForGruppo(gruppoId) {
  const gIdx = getGruppoIndex(gruppoId);
  if (gIdx < 0) return null;
  const prossimaDom = getProssimeDomeniche(1)[0];
  if (!prossimaDom) return null;

  let w = 0;
  if (isRotazioneAttiva()) {
    if (isDomenicaInFinestraRotazione(prossimaDom)) {
      w = getRotationWeekOffset(prossimaDom);
      if (w == null) return null;
    } else {
      const rot = getRotazioneConfig();
      const sabato = addDaysToDateStr(prossimaDom, -1);
      if (rot.fineFinestra && sabato > rot.fineFinestra) {
        w = 0; // dopo fine: assegnazione fissa
      } else {
        return null; // prima dell'inizio: libera
      }
    }
  }

  const slot = getTurniSlot().find(s => getRotationWeekForGruppoTurno(gIdx, s.turnoNum) === w);
  return slot ? { slot, rotationWeek: w } : null;
}

function formatTurnoSlotBrief(slot) {
  if (!slot) return '';
  const day = slot.dayOffset === -1 ? 'Sab' : 'Dom';
  const vig = slot.vigilia ? ' vigilia' : '';
  const sede = SEDI_LABEL[slot.sede] || slot.sede;
  return `${day} ${slot.ora}${vig} · ${sede}`;
}

function formatGruppoServizioMeta(gruppoId, opts = {}) {
  const compact = !!opts.compact;
  const assignments = getTurniAssignmentsForGruppo(gruppoId);
  if (!assignments.length) return '';

  if (isRotazioneAttiva()) {
    if (compact) {
      const current = getCurrentWeekAssignmentForGruppo(gruppoId);
      if (current) return `Questa sett. · ${formatTurnoSlotBrief(current.slot)}`;
      const first = assignments[0];
      return first ? formatTurnoSlotBrief(first.slot) : '';
    }
    const cicli = assignments.map(({ slot, rotationWeek }) =>
      `${formatRotazioneTurnoLabel(rotationWeek + 1)}: ${formatMessaServizioLabel(slot.turnoNum)} ${formatTurnoSlotBrief(slot)}`
    ).join(' · ');
    const current = getCurrentWeekAssignmentForGruppo(gruppoId);
    const now = current
      ? ` · Questa settimana: ${formatMessaServizioLabel(current.slot.turnoNum)} (${formatTurnoSlotBrief(current.slot)})`
      : '';
    return cicli + now;
  }

  const turnoNum = getFixedTurnoNumForGruppo(gruppoId);
  const slot = getTurniSlot().find(s => s.turnoNum === turnoNum);
  if (!slot) return '';
  if (compact) return formatTurnoSlotBrief(slot);
  return `Servizio fisso — ${formatMessaServizioLabel(turnoNum)}: ${formatTurnoSlotBrief(slot)} · ${getSlotParrocchiaLabel(slot.sede)}`;
}

function getGruppi() {
  ensureGruppiConfig();
  return state.gruppiConfig.gruppi;
}

function getGruppiOrdered() {
  return getGruppi().slice().sort((a, b) => (a.ordine ?? 0) - (b.ordine ?? 0));
}

function getTurniSlot() {
  ensureGruppiConfig();
  return getMesseDomenicali()
    .filter(m => m.conTurno)
    .sort((a, b) => (a.turnoNum || 0) - (b.turnoNum || 0));
}

function getRotazioneConfig() {
  ensureGruppiConfig();
  return state.gruppiConfig.rotazione;
}

function normalizeRotazioneConfig() {
  const prev = state.gruppiConfig.rotazione || {};
  const storico = Array.isArray(prev.storicoFinestre)
    ? prev.storicoFinestre
      .filter(f => f && f.inizio)
      .map(f => ({
        inizio: f.inizio,
        fine: f.fine || null,
        chiusaIl: f.chiusaIl || null
      }))
      .slice(0, 24)
    : [];
  state.gruppiConfig.rotazione = {
    attiva: !!prev.attiva,
    inizioFinestra: prev.inizioFinestra || null,
    fineFinestra: prev.fineFinestra || null,
    storicoFinestre: storico
  };
}

function isRotazioneAttiva() {
  const r = getRotazioneConfig();
  return !!(r.attiva && r.inizioFinestra);
}

function getMesseSenzaChierichetti() {
  ensureGruppiConfig();
  return getMesseDomenicali().filter(m => !m.conTurno);
}

/** Sabato di riferimento per una data (domenica → sabato precedente). */
function getSabatoDiRiferimento(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  if (day === 6) return dateStr;
  const back = day === 0 ? 1 : day + 1;
  d.setDate(d.getDate() - back);
  return formatDateFromDate(d);
}

function getNearestSaturdayOnOrAfter(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 6 ? 0 : (6 - day + 7) % 7;
  d.setDate(d.getDate() + diff);
  return formatDateFromDate(d);
}

function getNearestSaturdayOnOrBefore(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 6 ? 0 : (day + 1) % 7;
  d.setDate(d.getDate() - diff);
  return formatDateFromDate(d);
}

function getSabatoProssimo() {
  const d = new Date();
  const day = d.getDay();
  let diff = day === 6 ? 7 : (6 - day + 7) % 7;
  d.setDate(d.getDate() + diff);
  return formatDateFromDate(d);
}

/**
 * Fase corrente della finestra:
 * off | scheduled | active | expired
 */
function getRotazionePhase(rot = null) {
  const r = rot || getRotazioneConfig();
  if (!r.attiva || !r.inizioFinestra) return 'off';
  const sabato = getSabatoDiRiferimento(getTodayStr());
  if (sabato < r.inizioFinestra) return 'scheduled';
  if (r.fineFinestra && sabato > r.fineFinestra) return 'expired';
  return 'active';
}

/** Domenica coperta dalla finestra: sabato precedente in [inizio, fine]. */
function isDomenicaInFinestraRotazione(domenicaDateStr, rotOverride = null) {
  const rot = rotOverride || getRotazioneConfig();
  if (!rot.attiva || !rot.inizioFinestra || !domenicaDateStr) return false;
  const sabato = addDaysToDateStr(domenicaDateStr, -1);
  if (sabato < rot.inizioFinestra) return false;
  if (rot.fineFinestra && sabato > rot.fineFinestra) return false;
  return true;
}

function getRotationWeekOffset(domenicaDateStr, rotOverride = null) {
  const rot = rotOverride || getRotazioneConfig();
  if (!rot.attiva || !rot.inizioFinestra) return 0;
  if (!isDomenicaInFinestraRotazione(domenicaDateStr, rot)) return null;

  const windowStart = new Date(`${rot.inizioFinestra}T12:00:00`);
  const sabato = addDaysToDateStr(domenicaDateStr, -1);
  const cycleStart = new Date(`${sabato}T12:00:00`);

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.floor((cycleStart - windowStart) / msPerWeek);
}

function getGruppoIdForTurno(turnoNum, domenicaDateStr, rotOverride = null) {
  const gruppi = getGruppiOrdered().slice(0, getTurniSlot().length);
  const n = gruppi.length;
  if (!n || !turnoNum) return null;

  const rot = rotOverride || getRotazioneConfig();
  const attiva = !!(rot.attiva && rot.inizioFinestra);

  if (attiva && domenicaDateStr) {
    const sabato = addDaysToDateStr(domenicaDateStr, -1);
    if (sabato < rot.inizioFinestra) {
      // Prima dell'apertura: messe di servizio → libere
      return null;
    }
    if (rot.fineFinestra && sabato > rot.fineFinestra) {
      // Dopo la fine programmata: assegnazione fissa (come finestra chiusa)
      const idx = ((turnoNum - 1) % n + n) % n;
      return gruppi[idx].id;
    }
  }

  const w = attiva ? (getRotationWeekOffset(domenicaDateStr, rot) ?? 0) : 0;
  const idx = ((turnoNum - 1 - w) % n + n) % n;
  return gruppi[idx].id;
}

function getMESSE_ORDINARIE() {
  return getMesseDomenicali().map(m => ({
    dayOffset: m.dayOffset,
    ora: m.ora,
    sede: m.sede,
    vigilia: !!m.vigilia,
    turno: m.conTurno ? m.turnoNum : null,
    conChierichetti: !!m.conTurno
  }));
}

function getTurniPerDomenica() {
  return getTurniSlot().length;
}

function getCelebrazioniDomenicaliCount() {
  return getMESSE_ORDINARIE().length;
}

function getGruppoLabel(id) {
  if (!id) return '';
  const g = getGruppi().find(x => x.id === id);
  if (g) return g.nome;
  return GRUPPI_LABEL_LEGACY[id] || id;
}

function getGruppoOptionLabel(g) {
  return g.nome;
}

function dayOffsetLabel(offset) {
  return offset === -1 ? 'Sabato (vigilia)' : 'Domenica';
}

function renumberTurniSlot() {
  renumberMesseDomenicali();
}

function getSabatoRotazioneDefault() {
  const d = new Date();
  const day = d.getDay();
  let diff = day === 6 ? 0 : (6 - day + 7) % 7;
  if (day === 6 && d.getHours() >= 12) diff = 7;
  d.setDate(d.getDate() + diff);
  return formatDateFromDate(d);
}

function isSabatoDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay() === 6;
}

function getProssimeDomeniche(n, fromDateStr) {
  const result = [];
  const from = fromDateStr || getTodayStr();
  const d = new Date(from + 'T12:00:00');
  let guard = 0;
  while (result.length < n && guard < 400) {
    if (d.getDay() === 0) result.push(formatDateFromDate(d));
    d.setDate(d.getDate() + 1);
    guard++;
  }
  return result;
}

function populateGruppoSelects() {
  const gruppi = getGruppiOrdered();
  const anagOptions = gruppi.map(g => `<option value="${esc(g.id)}">${esc(getGruppoOptionLabel(g))}</option>`).join('');

  const gruppoEl = document.getElementById('gruppo');
  if (gruppoEl) {
    const cur = gruppoEl.value;
    gruppoEl.innerHTML = '<option value="">Seleziona</option>' + anagOptions;
    if (cur && gruppi.some(g => g.id === cur)) gruppoEl.value = cur;
  }
}

function updateTurniPanelMeta() {
  /* Scopo pagina resta in PAGE_META.turni.subtitle */
}

function updateGruppiSummary() {
  updateMesseDomenicaliSummary();
  updateGruppiPanelMeta();
}

function updateMesseDomenicaliSummary() {
  const el = document.getElementById('messe-domenicali-summary');
  const tot = getCelebrazioniDomenicaliCount();
  const nTurni = getTurniPerDomenica();
  const nLibere = getMesseSenzaChierichetti().length;
  if (el) {
    el.textContent = `${tot} celebrazioni nel turno · ${nTurni} con squadra · ${nLibere} libere`;
  }
  updateMesseAgendaSummary();
}

function switchTurniTab(tab) {
  turniTab = tab;
  const tabs = ['anteprima', 'gestione', 'cronologia', 'messe'];
  tabs.forEach(id => {
    document.getElementById(`tab-turni-${id}`)?.classList.toggle('active', tab === id);
    document.getElementById(`turni-panel-${id}`)?.classList.toggle('active', tab === id);
  });
  if (tab === 'anteprima') renderRotazioneAnteprima();
  else if (tab === 'gestione') renderRotazioneGestione();
  else if (tab === 'cronologia') renderRotazioneCronologia();
}

function switchGruppiTab(tab) {
  if (tab !== 'gestione' && document.body.classList.contains('gruppi-edit-open')) {
    if (!closeGruppiEdit()) return;
  }
  gruppiTab = tab;
  document.getElementById('tab-gruppi-squadre')?.classList.toggle('active', tab === 'squadre');
  document.getElementById('tab-gruppi-gestione')?.classList.toggle('active', tab === 'gestione');
  document.getElementById('tab-gruppi-cronologia')?.classList.toggle('active', tab === 'cronologia');
  document.getElementById('gruppi-panel-squadre')?.classList.toggle('active', tab === 'squadre');
  document.getElementById('gruppi-panel-gestione')?.classList.toggle('active', tab === 'gestione');
  document.getElementById('gruppi-panel-cronologia')?.classList.toggle('active', tab === 'cronologia');
  if (tab !== 'gestione') closeGruppiFormSheet();
  else syncGruppiFab();
  if (tab === 'cronologia') renderGruppiCronologia();
}

function updateGruppiPanelMeta() {
  syncGruppiToTurniSlots();
  const pool = getPersoneGruppiPool();
  const nonAssegnati = pool.filter(c => !c.gruppo).length;
  const wrap = document.getElementById('gruppi-unassigned-wrap');
  if (wrap) wrap.style.display = (nonAssegnati > 0 || !pool.length) ? '' : 'none';
  const countEl = document.getElementById('gruppi-attivi-count');
  if (countEl) countEl.textContent = String(getGruppiAttivi().length);
}

const GRUPPO_CRONOLOGIA_TIPO_LABEL = {
  creato: 'Gruppo creato',
  rinominato: 'Rinominato',
  rimosso: 'Gruppo rimosso',
  configurazione: 'Configurazione salvata',
  membro_aggiunto: 'Assegnato',
  membro_spostato: 'Spostato',
  membro_rimosso: 'Rimosso'
};

function appendGruppoCronologia(tipo, gruppoId, extra = {}) {
  ensureGruppiConfig();
  if (!Array.isArray(state.gruppiConfig.cronologia)) {
    state.gruppiConfig.cronologia = [];
  }
  state.gruppiConfig.cronologia.unshift({
    id: 'gru-log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    at: new Date().toISOString(),
    tipo,
    gruppoId: gruppoId || '',
    gruppoNome: gruppoId ? getGruppoLabel(gruppoId) : (extra.nome || ''),
    ...extra
  });
  if (state.gruppiConfig.cronologia.length > 80) {
    state.gruppiConfig.cronologia.length = 80;
  }
}

/** Aggiorna l’ultima configurazione in cronologia (niente nuovo record). */
function updateLastGruppoConfigurazioneCronologia(extra = {}) {
  ensureGruppiConfig();
  if (!Array.isArray(state.gruppiConfig.cronologia)) {
    state.gruppiConfig.cronologia = [];
  }
  const idx = state.gruppiConfig.cronologia.findIndex(e => e.tipo === 'configurazione');
  if (idx < 0) {
    appendGruppoCronologia('configurazione', '', extra);
    return 'created';
  }
  const prev = state.gruppiConfig.cronologia[idx];
  state.gruppiConfig.cronologia[idx] = {
    ...prev,
    ...extra,
    tipo: 'configurazione',
    at: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  return 'updated';
}

function formatGruppoCronologiaWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Ieri ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function summarizeGruppiChanges(changes) {
  if (!changes?.length) return 'Nessun cambio di assegnazione';
  let assegnati = 0;
  let spostati = 0;
  let rimossi = 0;
  changes.forEach(ch => {
    if (!ch.daId && ch.aId) assegnati += 1;
    else if (ch.daId && !ch.aId) rimossi += 1;
    else spostati += 1;
  });
  const parts = [];
  if (assegnati) parts.push(assegnati === 1 ? '1 assegnazione' : `${assegnati} assegnazioni`);
  if (spostati) parts.push(spostati === 1 ? '1 spostamento' : `${spostati} spostamenti`);
  if (rimossi) parts.push(rimossi === 1 ? '1 rimozione' : `${rimossi} rimozioni`);
  return parts.join(' · ') || `${changes.length} cambiamenti`;
}

function buildGruppiSnapshotFromState() {
  return {
    gruppi: getGruppiAttivi().map(g => ({
      id: g.id,
      nome: g.nome,
      membri: getChierichettiInGruppo(g.id).map(c => ({
        uuid: c.uuid,
        nome: c.nome,
        cer: isAppelloCerimoniere(c)
      }))
    })),
    senzaGruppo: getChierichettiSenzaGruppo().map(c => ({
      uuid: c.uuid,
      nome: c.nome,
      cer: isAppelloCerimoniere(c)
    }))
  };
}

function describeGruppoCronologiaEntry(entry) {
  const squadra = entry.gruppoNome || getGruppoLabel(entry.gruppoId) || 'Squadra';
  const persona = entry.personaNome ? esc(entry.personaNome) : '';
  let detail = '';

  switch (entry.tipo) {
    case 'configurazione':
      detail = esc(entry.summary || summarizeGruppiChanges(entry.changes));
      break;
    case 'creato':
      detail = entry.messa ? esc(entry.messa) : 'Nuova squadra nel turno';
      break;
    case 'rinominato':
      detail = entry.nomePrecedente
        ? `${esc(entry.nomePrecedente)} → ${esc(entry.nomeNuovo || squadra)}`
        : esc(squadra);
      break;
    case 'membro_aggiunto':
      detail = persona ? `${persona} → ${esc(squadra)}` : esc(squadra);
      break;
    case 'membro_spostato':
      detail = persona && entry.gruppoPrecedente
        ? `${persona}: ${esc(entry.gruppoPrecedente)} → ${esc(squadra)}`
        : persona ? `${persona} → ${esc(squadra)}` : esc(squadra);
      break;
    case 'membro_rimosso':
      detail = persona ? `${persona} da ${esc(squadra)}` : esc(squadra);
      break;
    case 'rimosso':
      detail = entry.nome ? esc(entry.nome) : 'Messa senza squadra in Turni';
      break;
    default:
      detail = esc(squadra);
  }

  return {
    title: GRUPPO_CRONOLOGIA_TIPO_LABEL[entry.tipo] || entry.tipo,
    detail
  };
}

function renderGruppiCronologiaSnapshot(entry) {
  const snap = entry.snapshot;
  if (!snap?.gruppi?.length) return '';
  const groupsHtml = snap.gruppi.map(g => {
    const membri = (g.membri || []).map(m => esc(m.nome)).join(', ') || '—';
    return `<li><strong>${esc(g.nome)}</strong>: ${membri}</li>`;
  }).join('');
  const senza = (snap.senzaGruppo || []).map(m => esc(m.nome)).join(', ');
  const senzaHtml = senza
    ? `<li><strong>Senza gruppo</strong>: ${senza}</li>`
    : '';
  const changes = (entry.changes || []).slice(0, 12).map(ch =>
    `<li>${esc(ch.personaNome)}: ${esc(ch.da)} → ${esc(ch.a)}</li>`
  ).join('');
  const more = (entry.changes || []).length > 12
    ? `<li class="gruppi-cronologia-more">+${entry.changes.length - 12} altri</li>`
    : '';
  return `
    <details class="gruppi-cronologia-details">
      <summary>Dettaglio composizione</summary>
      ${changes ? `<ul class="gruppi-cronologia-changes">${changes}${more}</ul>` : ''}
      <ul class="gruppi-cronologia-snapshot">${groupsHtml}${senzaHtml}</ul>
    </details>
  `;
}

function renderGruppiCronologia() {
  const container = document.getElementById('gruppi-cronologia-list');
  if (!container) return;
  ensureGruppiConfig();
  const items = (state.gruppiConfig.cronologia || []).filter(entry =>
    entry.tipo === 'configurazione' ||
    entry.tipo === 'creato' ||
    entry.tipo === 'rinominato' ||
    entry.tipo === 'rimosso'
  );
  if (!items.length) {
    container.innerHTML = '<p class="empty-state">Nessuna configurazione salvata — usa «Nuovi gruppi × nuovi turni» e salva</p>';
    return;
  }
  container.innerHTML = items.map(entry => {
    const { title, detail } = describeGruppoCronologiaEntry(entry);
    const extra = entry.tipo === 'configurazione' ? renderGruppiCronologiaSnapshot(entry) : '';
    return `
      <div class="gruppi-cronologia-item${entry.tipo === 'configurazione' ? ' is-config' : ''}">
        <time class="gruppi-cronologia-when" datetime="${esc(entry.at)}">${formatGruppoCronologiaWhen(entry.at)}</time>
        <div class="gruppi-cronologia-body">
          <p class="gruppi-cronologia-tipo">${esc(title)}</p>
          <p class="gruppi-cronologia-dettaglio">${detail}</p>
          ${extra}
        </div>
      </div>
    `;
  }).join('');
}

function updateNuovoGruppoFormDefaults() {
  const n = getTurniSlot().length + 1;
  const nomeEl = document.getElementById('nuovo-gruppo-nome');
  if (nomeEl && !nomeEl.value.trim()) {
    nomeEl.placeholder = 'Gruppo ' + n;
  }
}

function syncNuovoGruppoFormDay() {
  const dayEl = document.getElementById('nuovo-gruppo-day');
  const vigiliaWrap = document.getElementById('nuovo-gruppo-vigilia-wrap');
  const vigilia = document.getElementById('nuovo-gruppo-vigilia');
  if (!dayEl || !vigiliaWrap) return;
  const isSabato = parseInt(dayEl.value, 10) === -1;
  vigiliaWrap.hidden = !isSabato;
  if (!isSabato && vigilia) vigilia.checked = false;
}

function createNuovoGruppoFromForm(e) {
  e.preventDefault();
  if (!requireAdminAction('Solo l\'admin può creare gruppi')) return;
  const nomeInput = document.getElementById('nuovo-gruppo-nome')?.value.trim();
  const dayOffset = parseInt(document.getElementById('nuovo-gruppo-day').value, 10);
  const ora = document.getElementById('nuovo-gruppo-ora').value;
  const sede = document.getElementById('nuovo-gruppo-sede').value;
  const vigilia = document.getElementById('nuovo-gruppo-vigilia')?.checked;

  const duplicate = getMesseDomenicali().find(m =>
    m.dayOffset === dayOffset && m.ora === ora && m.sede === sede
  );
  if (duplicate) {
    showToast('Esiste già una celebrazione con stesso giorno, ora e sede');
    return;
  }

  if (nomeInput && getGruppi().some(g => g.nome.trim().toLowerCase() === nomeInput.toLowerCase())) {
    showToast('Esiste già una squadra con questo nome');
    return;
  }

  state.gruppiConfig.messeDomenicali.push({
    id: 'md-' + Date.now(),
    dayOffset,
    ora,
    sede,
    vigilia: vigilia || dayOffset === -1,
    conTurno: true
  });

  renumberMesseDomenicali();
  syncGruppiToTurniSlots();
  const newGruppo = getGruppiOrdered().slice(-1)[0];
  if (newGruppo && nomeInput) newGruppo.nome = nomeInput;

  const slot = getTurniSlot().slice(-1)[0];
  appendGruppoCronologia('creato', newGruppo?.id, {
    nome: newGruppo?.nome,
    messa: slot ? formatTurnoSlotBrief(slot) : ''
  });

  document.getElementById('nuovoGruppoForm')?.reset();
  document.getElementById('nuovo-gruppo-day').value = '0';
  document.getElementById('nuovo-gruppo-ora').value = '10:00';
  syncNuovoGruppoFormDay();
  closeGruppiFormSheet();
  switchGruppiTab('gestione');
  afterGruppiConfigChange();
  showToast(newGruppo ? `${newGruppo.nome} creato` : 'Gruppo creato');
}

function sedeLabel(id) {
  return SEDI_LABEL[id] || GRUPPI_LABEL_LEGACY[id] || id;
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return formatDateFromDate(d);
}

function addMinutesToTime(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function slotDateTime(slot) {
  return new Date(`${slot.data}T${slot.ora || '12:00'}:00`);
}

function getRuoloPersona(p) {
  return p?.ruolo === 'cerimoniere' ? 'cerimoniere' : 'chierichetto';
}

function isChierichettoPersona(p) {
  return !!p && (p.ruolo === 'chierichetto' || p.ruolo === 'cerimoniere' || !p.ruolo);
}

function isPersonaAttiva(p) {
  if (!p) return false;
  return p.attivo !== false && p.attivo !== 'false';
}

function isChierichettoPromosso(p) {
  if (!p) return false;
  return p.promosso === true || p.promosso === 'true' || isLinkedCerimoniereAccount(p);
}

function isChierichettoAttivo(p) {
  return isChierichettoPersona(p) && isPersonaAttiva(p) && !isChierichettoPromosso(p);
}

function countChierichettiInGruppo(gruppo) {
  if (!gruppo) return 0;
  return getPersoneGruppiPool().filter(c => c.gruppo === gruppo).length;
}

function getMesseOrdinarieSlots(domenicaDateStr) {
  const weekOffset = isRotazioneAttiva() ? getRotationWeekOffset(domenicaDateStr) : null;
  return getMESSE_ORDINARIE().map(slot => {
    const data = addDaysToDateStr(domenicaDateStr, slot.dayOffset);
    const gruppo = slot.turno ? getGruppoIdForTurno(slot.turno, domenicaDateStr) : null;
    return {
      data,
      ora: slot.ora,
      sede: slot.sede,
      sedeLabel: SEDI_LABEL[slot.sede],
      vigilia: !!slot.vigilia,
      turno: slot.turno || null,
      gruppo,
      gruppoLabel: gruppo ? getGruppoLabel(gruppo) : null,
      conChierichetti: !!slot.conChierichetti,
      domenicaRef: domenicaDateStr,
      rotazioneSettimana: weekOffset,
      label: `${slot.ora} ${SEDI_LABEL[slot.sede]}`
    };
  });
}

function getTurniSlots(domenicaDateStr) {
  return getMesseOrdinarieSlots(domenicaDateStr).filter(s => s.conChierichetti);
}

function getTurnoRecordForSlot(slot) {
  return state.turni.find(t =>
    t.data === slot.data &&
    t.parrocchia === slot.sede &&
    t.oraInizio === slot.ora
  );
}

function isSlotCoperto(slot) {
  if (!slot.conChierichetti) return false;
  if (slot.gruppo) return countChierichettiInGruppo(slot.gruppo) > 0;
  return !!getTurnoRecordForSlot(slot);
}

function getTurnoForSlot(slot) {
  return getTurnoRecordForSlot(slot);
}

function getTurniForAgendaDate(dateStr) {
  const info = getMessaInfo(dateStr);
  if (info?.type === 'domenica') {
    const turniSlots = getTurniSlots(dateStr);
    return state.turni.filter(t =>
      turniSlots.some(s => s.data === t.data && s.sede === t.parrocchia && s.ora === t.oraInizio)
    );
  }
  return getTurniForDate(dateStr);
}

function countAssignedSlots(domenicaDateStr) {
  return getTurniSlots(domenicaDateStr).filter(isSlotCoperto).length;
}

function getChierichettiSlotsForYear(anno) {
  const slots = [];
  getMesseDatesForYear(anno).forEach(dateStr => {
    const info = getMessaInfo(dateStr);
    if (info?.type === 'domenica') {
      getTurniSlots(dateStr).forEach(s => {
        slots.push({ ...s, massInfo: info });
      });
    } else if (info?.type === 'extra') {
      const ex = info.extra;
      const ora = ex?.ora || '10:00';
      const sede = ex?.sede || 'santuario';
      slots.push({
        data: dateStr,
        ora,
        sede,
        sedeLabel: SEDI_LABEL[sede] || sede,
        domenicaRef: dateStr,
        isExtra: true,
        vigilia: false,
        turno: null,
        gruppo: null,
        conChierichetti: true,
        label: ex?.nota || 'Messa straordinaria',
        massInfo: info
      });
    }
  });
  return slots;
}

function getAllSlotsForYear(anno) {
  const slots = [];
  getMesseDatesForYear(anno).forEach(dateStr => {
    const info = getMessaInfo(dateStr);
    if (info?.type === 'domenica') {
      getMesseOrdinarieSlots(dateStr).forEach(s => {
        slots.push({ ...s, massInfo: info });
      });
    } else if (info?.type === 'extra') {
      const ex = info.extra;
      const ora = ex?.ora || '10:00';
      const sede = ex?.sede || 'santuario';
      slots.push({
        data: dateStr,
        ora,
        sede,
        sedeLabel: SEDI_LABEL[sede] || sede,
        domenicaRef: dateStr,
        isExtra: true,
        vigilia: false,
        conChierichetti: true,
        label: ex?.nota || 'Messa straordinaria',
        massInfo: info
      });
    }
  });
  return slots;
}

function getNextMessaSlot(fromDate) {
  const today = fromDate || getTodayStr();
  const anno = parseInt(today.slice(0, 4), 10);
  const now = new Date();
  const slots = getChierichettiSlotsForYear(anno).concat(getChierichettiSlotsForYear(anno + 1));
  return slots
    .filter(s => slotDateTime(s) >= now)
    .sort((a, b) => slotDateTime(a) - slotDateTime(b))[0] || null;
}

function renderMessaSlotsHtml(slots, { compact, dark, turniOnly, withNotes, messaDate } = {}) {
  const list = turniOnly ? slots.filter(s => s.conChierichetti !== false) : slots;
  if (!list.length) return '';
  const chipClass = dark ? 'today-turno-chip' : 'messa-agenda-turno-chip';
  const notesMessaDate = messaDate || null;
  return `<div class="messa-slot-list">${list.map(slot => {
    if (!slot.conChierichetti) {
      const d = new Date(slot.data + 'T12:00:00');
      const dayLabel = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
      const noteHtml = (withNotes && notesMessaDate) ? renderCelebrazioneNotaFieldHtml(notesMessaDate, slot) : '';
      return `
        <div class="messa-slot-item no-chierichetti">
          <div class="messa-slot-row">
            <div class="messa-slot-main">
              <div class="messa-slot-time">${esc(slot.ora)} · ${esc(slot.sedeLabel)}</div>
              <div class="messa-slot-meta">${esc(dayLabel)} · Messa libera</div>
            </div>
            <span class="messa-slot-no-turno">—</span>
          </div>
          ${noteHtml}
        </div>`;
    }

    const coperto = isSlotCoperto(slot);
    const d = new Date(slot.data + 'T12:00:00');
    const dayLabel = d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
    const nGruppo = slot.gruppo ? countChierichettiInGruppo(slot.gruppo) : 0;

    if (compact) {
      return slot.gruppo || coperto
        ? `<span class="${chipClass}">${esc(dayLabel)} ${esc(slot.ora)} ${esc(slot.gruppoLabel || slot.sedeLabel)}</span>`
        : '';
    }

    const rotHint = slot.rotazioneSettimana != null ? ` · ${formatRotazioneTurnoLabel(slot.rotazioneSettimana + 1).toLowerCase()}` : '';
    const statusLine = coperto
      ? `${nGruppo} in squadra`
      : (slot.gruppo ? 'Squadra vuota' : 'Libera');
    const noteHtml = (withNotes && notesMessaDate) ? renderCelebrazioneNotaFieldHtml(notesMessaDate, slot) : '';
    return `
      <div class="messa-slot-item ${coperto ? 'assigned' : ''}">
        <div class="messa-slot-row">
          <div class="messa-slot-main">
            <div class="messa-slot-time">${formatMessaServizioLabel(slot.turno) || 'Messa —'} · ${esc(slot.ora)} · ${esc(slot.sedeLabel)}</div>
            <div class="messa-slot-meta">${esc(dayLabel)}${slot.vigilia ? ' · <span class="messa-slot-vigilia">Vigilia</span>' : ''}${slot.gruppoLabel ? ' · ' + esc(slot.gruppoLabel) : ''}${rotHint} · ${esc(statusLine)}</div>
          </div>
        </div>
        ${noteHtml}
      </div>`;
  }).join('')}</div>`;
}

function countTurniConfermatiForDate(dateStr) {
  const anno = parseInt(dateStr.slice(0, 4), 10);
  const slots = getChierichettiSlotsForYear(anno).filter(s => s.data === dateStr);
  if (slots.length) return slots.filter(isSlotCoperto).length;
  return state.turni.filter(t => t.data === dateStr).length;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

/** Literal JS string for inline handlers — use inside onclick='…' / onchange='…' */
function jsStr(value) {
  return JSON.stringify(value ?? '');
}

// ── Oggi (dashboard cerimoniere) ────────────────────────────
function renderDashboard() {
  const today = getTodayStr();
  const todayLabel = new Date(today + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  document.getElementById('today-date-label').textContent = todayLabel;
  document.getElementById('total-chierichetti').textContent = state.chierichetti.filter(isChierichettoAttivo).length;

  const turniOggi = state.turni.filter(t => t.data === today);
  const nextSlot = getNextMessaSlot(today);
  const turniOggiCount = countTurniConfermatiForDate(today);
  document.getElementById('turni-oggi-count').textContent = turniOggiCount;
  document.getElementById('quick-turni-hint').textContent = nextSlot
    ? (nextSlot.data === today
      ? `Oggi ${nextSlot.ora} ${nextSlot.sedeLabel}`
      : (() => {
          const days = daysUntilMessa(nextSlot.data, today);
          return days === 1
            ? `Domani ${nextSlot.ora} ${nextSlot.sedeLabel}`
            : `${nextSlot.ora} ${nextSlot.sedeLabel} · tra ${days} giorni`;
        })())
    : 'Nessuna messa in agenda';

  const presenti = state.presenze.filter(p => p.data === today && p.stato === 'presente').length;
  document.getElementById('presenze-oggi').textContent = presenti;

  renderTodayAgendaPreview(today, nextSlot);
}

function daysUntilMessa(dateStr, fromDate) {
  const a = new Date(fromDate + 'T12:00:00');
  const b = new Date(dateStr + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

function groupTodaySlotsByDay(slots) {
  const groups = [];
  const seen = new Map();
  slots.forEach(slot => {
    if (!seen.has(slot.data)) {
      const g = { data: slot.data, slots: [] };
      seen.set(slot.data, g);
      groups.push(g);
    }
    seen.get(slot.data).slots.push(slot);
  });
  return groups;
}

function isSameMessaSlot(a, b) {
  return !!a && !!b && a.data === b.data && a.sede === b.sede && a.ora === b.ora;
}

/** Messa da evidenziare: turno utente futuro, altrimenti prossima celebrazione */
function getTodayHeroHighlightInfo(slots, nextSlot) {
  const now = new Date();
  const myGruppo = getCurrentUserChierichetto()?.gruppo;
  if (myGruppo) {
    const mineUpcoming = slots
      .filter(s => s.gruppo === myGruppo && s.conChierichetti !== false && slotDateTime(s) >= now)
      .sort((a, b) => slotDateTime(a) - slotDateTime(b))[0];
    if (mineUpcoming) return { slot: mineUpcoming, tag: 'Il tuo turno' };
  }
  if (nextSlot) return { slot: nextSlot, tag: 'Prossima' };
  return { slot: null, tag: '' };
}

function renderTodayDayGroup(group, today, highlightSlot, highlightTag) {
  const d = new Date(group.data + 'T12:00:00');
  const dayLabel = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '');
  const hasVigilia = group.slots.some(s => s.vigilia);
  const isToday = group.data === today;
  return `
    <section class="today-messa-day-group">
      <header class="today-messa-day-head${isToday ? ' is-today' : ''}">
        <span>${esc(dayLabel)}</span>
        ${isToday ? '<span class="today-messa-day-oggi">Oggi</span>' : ''}
        ${hasVigilia ? '<span class="today-messa-day-tag">Vigilia</span>' : ''}
      </header>
      <div class="today-messa-day-rows">
        ${group.slots.map(s => renderTodayMessaRow(s, highlightSlot, highlightTag)).join('')}
      </div>
    </section>
  `;
}

function renderTodayMessaRow(slot, highlightSlot, highlightTag) {
  const now = new Date();
  const isPast = slotDateTime(slot) < now;
  const isHighlight = !isPast && isSameMessaSlot(slot, highlightSlot);
  const isLibera = isMessaSenzaGruppoServizio(slot);
  const isPermanentlyLibera = slot.conChierichetti === false;
  const coperto = !isLibera && isSlotCoperto(slot);

  const messaBadge = slot.turno && !isLibera
    ? `<span class="today-messa-m">${esc(formatMessaServizioShort(slot.turno))}</span>`
    : (isLibera && slot.turno
      ? '<span class="today-messa-m" style="opacity:.7">Libera</span>'
      : '');

  const focusBadge = isHighlight && highlightTag
    ? `<span class="today-messa-focus">${esc(highlightTag)}</span>`
    : '';

  let meta = '';
  if (!isLibera) {
    if (coperto) meta = `${slot.gruppoLabel || 'Gruppo'} · ${countChierichettiInGruppo(slot.gruppo)} in squadra`;
    else if (slot.gruppo) meta = `${slot.gruppoLabel} · da completare`;
  } else if (!isPermanentlyLibera) {
    meta = 'Fuori dalla finestra di rotazione';
  }

  const clickAction = isPermanentlyLibera
    ? `goToMessa(${jsStr(slot.domenicaRef || slot.data)})`
    : `openAppello(${jsStr(slot.data)}, ${jsStr(messaSlotKey(slot))})`;

  return `
    <article class="today-messa-row${isPast ? ' is-past' : ''}${isHighlight ? ' is-highlight' : ''}"
      role="button" tabindex="0"
      onclick='${clickAction}'
      onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
      <time class="today-messa-time" datetime="${esc(slot.data)}T${esc(slot.ora)}">${esc(slot.ora)}</time>
      <div class="today-messa-main">
        <div class="today-messa-line">
          <span class="today-messa-sede">${esc(slot.sedeLabel)}</span>
          ${messaBadge}
          ${focusBadge}
        </div>
        ${meta ? `<p class="today-messa-meta">${esc(meta)}</p>` : ''}
      </div>
    </article>
  `;
}

function renderTodayAgendaPreview(today, nextSlot) {
  const container = document.getElementById('today-agenda-preview');
  const heroTitle = document.getElementById('today-hero-title');
  const dateLabel = document.getElementById('today-date-label');

  if (isCalendarioUnavailable() && !nextSlot) {
    heroTitle.textContent = 'Agenda messe';
    if (dateLabel) dateLabel.textContent = 'Calendario non disponibile';
    container.innerHTML = calendarioUnavailableHtml();
    return;
  }

  if (!nextSlot) {
    heroTitle.textContent = 'Agenda messe';
    if (dateLabel) dateLabel.textContent = 'Nessuna celebrazione in programma';
    container.innerHTML = `
      <p class="today-empty empty-state-inline">Nessuna messa in agenda per questo anno.</p>
      <div class="today-agenda-footer">
        <button type="button" class="btn-ghost-light" onclick="showSection('messe')">Apri agenda messe</button>
      </div>
    `;
    return;
  }

  const calBanner = isCalendarioUnavailable()
    ? `<p class="today-empty empty-state-inline today-cal-banner">Calendario liturgico non disponibile — i titoli delle messe possono essere generici. <button type="button" class="btn-ghost-light btn-inline-link" onclick="showSection('calendario')">Apri Liturgia</button></p>`
    : '';

  const domenicaRef = nextSlot.domenicaRef ||
    (getMessaInfo(nextSlot.data)?.type === 'domenica' ? nextSlot.data : null);

  let slots = [];
  if (domenicaRef && getMessaInfo(domenicaRef)?.type === 'domenica') {
    slots = getMesseOrdinarieSlots(domenicaRef);
    const events = calState.data?.byDate?.[domenicaRef] || [];
    const primary = primaryEvent(events) || events[0];
    const liturgyTitle = primary?.nome || getMessaAgendaTitle(domenicaRef, getMessaInfo(domenicaRef), primary);
    const domLabel = new Date(domenicaRef + 'T12:00:00').toLocaleDateString('it-IT', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    heroTitle.textContent = liturgyTitle;
    heroTitle.classList.toggle('liturgy-long', liturgyTitle.length > 48);
    if (dateLabel) dateLabel.textContent = domLabel;
  } else {
    slots = [nextSlot];
    const litRef = nextSlot.domenicaRef || nextSlot.data;
    const events = calState.data?.byDate?.[litRef] || [];
    const primary = primaryEvent(events) || events[0];
    const liturgyTitle = primary?.nome || getMessaAgendaTitle(litRef, getMessaInfo(litRef), primary);
    const d = new Date(nextSlot.data + 'T12:00:00');
    heroTitle.textContent = liturgyTitle || 'Prossima messa';
    heroTitle.classList.toggle('liturgy-long', (liturgyTitle || '').length > 48);
    if (dateLabel) {
      dateLabel.textContent = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    }
  }

  const { slot: highlightSlot, tag: highlightTag } = getTodayHeroHighlightInfo(slots, nextSlot);
  const { shown, more } = limitTodayHeroSlots(slots, highlightSlot);

  container.innerHTML = `
    ${calBanner}
    ${groupTodaySlotsByDay(shown).map(g => renderTodayDayGroup(g, today, highlightSlot, highlightTag)).join('')}
    <div class="today-agenda-footer">
      <button type="button" class="btn-ghost-light" onclick="showSection('messe')">${more > 0 ? `Altre ${more} · vedi agenda →` : 'Vedi tutta l\'agenda →'}</button>
    </div>
  `;
}

/** Max 4 slot in hero (prossima + fino a 3 successive). */
function limitTodayHeroSlots(slots, highlightSlot) {
  const list = Array.isArray(slots) ? slots : [];
  if (list.length <= 4) return { shown: list, more: 0 };
  const keyOf = (s) => `${s.data}|${s.ora || ''}|${s.sede || ''}`;
  const hiKey = highlightSlot ? keyOf(highlightSlot) : '';
  let shown = list.slice(0, 4);
  if (hiKey && !shown.some((s) => keyOf(s) === hiKey)) {
    shown = [highlightSlot, ...list.filter((s) => keyOf(s) !== hiKey).slice(0, 3)];
  }
  return { shown, more: list.length - shown.length };
}

function goToMessa(dateStr) {
  document.getElementById('anno-messe').value = dateStr.slice(0, 4);
  messeState.selectedDate = dateStr;
  showSection('messe');
  requestAnimationFrame(() => {
    const el = document.getElementById('messa-item-' + dateStr);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function openAppello(dateStr, slotKey) {
  const el = document.getElementById('appello-data');
  if (el) el.value = dateStr || getTodayStr();
  if (slotKey) appelloSelectedSlotKey = slotKey;
  else appelloSelectedSlotKey = '';
  showSection('presenze');
}

async function onAppelloDateChange() {
  const ok = await flushAppelloIfNeeded();
  if (!ok) {
    // Ripristina data precedente se il flush fallisce non è banale senza stash —
    // l'utente resta sulla nuova data ma con toast a salvare
  }
  appelloParrocchiaTabBySlot = {};
  appelloSelectedSlotKey = '';
  renderAppello();
}

async function shiftAppelloDate(delta) {
  const ok = await flushAppelloIfNeeded();
  if (!ok) return;
  const el = document.getElementById('appello-data');
  if (!el) return;
  el.value = addDaysToDateStr(el.value || getTodayStr(), delta);
  appelloParrocchiaTabBySlot = {};
  appelloSelectedSlotKey = '';
  renderAppello();
}

async function goAppelloToday() {
  const ok = await flushAppelloIfNeeded();
  if (!ok) return;
  const el = document.getElementById('appello-data');
  if (el) el.value = getTodayStr();
  appelloParrocchiaTabBySlot = {};
  appelloSelectedSlotKey = '';
  renderAppello();
}

function openAppelloDatePicker() {
  const el = document.getElementById('appello-data');
  if (!el) return;
  if (typeof el.showPicker === 'function') el.showPicker();
  else { el.focus(); el.click(); }
}

function getPastoralYearStartForDate(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth();
  // Lug–Ago: anno pastorale in arrivo (apre 2 sett. prima di settembre)
  if (m >= 6 && m <= 7) return Math.max(y, REGISTRO_MIN_PASTORAL_START);
  const start = m >= 8 ? y : y - 1;
  return Math.max(start, REGISTRO_MIN_PASTORAL_START);
}

function getPastoralYearWindowStart(startY) {
  return addDaysToDateStr(`${startY}-09-01`, -REGISTRO_PASTORAL_OPEN_DAYS_BEFORE);
}

function formatPastoralYearLabel(startY) {
  return `${startY}/${String(startY + 1).slice(2)}`;
}

function formatPastoralYearRangeLabel(startY) {
  const from = getPastoralYearWindowStart(startY);
  const d = new Date(from + 'T12:00:00');
  const openLabel = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
  return `${openLabel} ${startY} – Giu ${startY + 1}`;
}

function getRegistroPastoralBounds(startY) {
  return {
    from: getPastoralYearWindowStart(startY),
    to: `${startY + 1}-06-30`
  };
}

function calendarYearForPastoralMonth(startY, month) {
  if (month === 7) return startY;
  return month >= 8 ? startY : startY + 1;
}

function getMaxPastoralYearStart() {
  return Math.max(getPastoralYearStartForDate(new Date()), REGISTRO_MIN_PASTORAL_START);
}

function isPastoralYearNotStarted(startY) {
  return getRegistroPastoralBounds(startY).from > getTodayStr();
}

function ensureRegistroPeriod() {
  if (registroPastoralStart == null) {
    const t = new Date();
    registroPastoralStart = getPastoralYearStartForDate(t);
    const m = t.getMonth();
    registroMonth = (m >= 7 || m <= 5) ? m : null;
  }
  if (registroPastoralStart < REGISTRO_MIN_PASTORAL_START) {
    registroPastoralStart = REGISTRO_MIN_PASTORAL_START;
  }
  const max = getMaxPastoralYearStart();
  if (registroPastoralStart > max) registroPastoralStart = max;
}

function switchRegistroTab(tab) {
  registroTab = tab;
  ['messa', 'gruppo', 'persone'].forEach(t => {
    document.getElementById('tab-registro-' + t)?.classList.toggle('active', tab === t);
    document.getElementById('registro-panel-' + t)?.classList.toggle('active', tab === t);
  });
}

function toggleRegistroMass(slotKey) {
  registroOpenSlotKey = registroOpenSlotKey === slotKey ? '' : slotKey;
  document.querySelectorAll('.registro-mass').forEach(el => {
    const open = el.dataset.slot === registroOpenSlotKey;
    el.classList.toggle('is-open', open);
    el.querySelector('.registro-mass-btn')?.setAttribute('aria-expanded', String(open));
    const body = el.querySelector('.registro-mass-body');
    if (body) body.hidden = !open;
    const chev = el.querySelector('.registro-mass-chevron');
    if (chev) chev.textContent = open ? '▾' : '▸';
  });
}

function toggleRegistroGroup(groupId) {
  registroOpenGroupId = registroOpenGroupId === groupId ? '' : groupId;
  document.querySelectorAll('.registro-group-card').forEach(el => {
    const open = el.dataset.group === registroOpenGroupId;
    el.classList.toggle('is-open', open);
    el.querySelector('.registro-group-head')?.setAttribute('aria-expanded', String(open));
    const body = el.querySelector('.registro-group-body');
    if (body) body.hidden = !open;
    const chev = el.querySelector('.registro-group-chevron');
    if (chev) chev.textContent = open ? '▾' : '▸';
  });
}

function populateRegistroMonthFilter() {
  const sel = document.getElementById('registro-filter-mese');
  if (!sel) return;
  ensureRegistroPeriod();
  const cur = registroMonth == null ? '' : String(registroMonth);
  sel.innerHTML = '<option value="">Tutto l\'anno</option>' +
    REGISTRO_PASTORAL_MONTHS.map(m => {
      const y = calendarYearForPastoralMonth(registroPastoralStart, m);
      return `<option value="${m}">${MONTHS[m]} ${y}</option>`;
    }).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
  if (sel.value === '' && registroMonth != null) registroMonth = null;
  else if (sel.value !== '') registroMonth = parseInt(sel.value, 10);
}

function onRegistroMonthFilterChange() {
  const v = document.getElementById('registro-filter-mese')?.value ?? '';
  registroMonth = v === '' ? null : parseInt(v, 10);
  renderRegistro();
}

function getRegistroMonthSlots() {
  ensureRegistroPeriod();
  const { from, to } = getRegistroPastoralBounds(registroPastoralStart);
  const today = getTodayStr();
  const end = today < to ? today : to;
  const sedeF = document.getElementById('registro-filter-sede')?.value || '';

  const slots = getAllSlotsForYear(registroPastoralStart)
    .concat(getAllSlotsForYear(registroPastoralStart + 1));

  return slots
    .filter(s => s.data >= from && s.data <= end)
    .filter(s => {
      if (registroMonth == null) return true;
      const y = calendarYearForPastoralMonth(registroPastoralStart, registroMonth);
      const prefix = `${y}-${String(registroMonth + 1).padStart(2, '0')}`;
      return s.data.startsWith(prefix);
    })
    .filter(s => !sedeF || s.sede === sedeF)
    .map(s => ({ ...s, slotKey: s.key || messaSlotKey(s) }))
    .sort((a, b) => b.data.localeCompare(a.data) || b.ora.localeCompare(a.ora));
}

function getRegistroRows() {
  ensureRegistroPeriod();
  const statoF = document.getElementById('registro-filter-stato')?.value || '';
  const gruppoF = document.getElementById('registro-filter-gruppo')?.value || '';
  const q = (document.getElementById('registro-search')?.value || '').trim().toLowerCase();

  const slots = getRegistroMonthSlots();
  const rows = [];

  slots.forEach(slot => {
    const slotKey = slot.slotKey || slot.key || messaSlotKey(slot);
    const isLibera = isMessaSenzaGruppoServizio(slot);
    const expected = isLibera ? [] : getExpectedForMessaSlot(slot);
    const seen = new Set();

    expected.forEach(chi => {
      seen.add(chi.uuid);
      const presente = isPresenteAtRegistroSlot(chi.uuid, slot);
      rows.push({
        data: slot.data,
        ora: slot.ora,
        sede: slot.sede,
        sedeLabel: slot.sedeLabel || SEDI_LABEL[slot.sede] || slot.sede,
        gruppoId: slot.gruppo || chi.gruppo || '',
        gruppoLabel: slot.gruppoLabel || getGruppoLabel(chi.gruppo),
        chi,
        stato: presente ? 'presente' : 'assente',
        extra: false,
        isLibera,
        slotKey
      });
    });

    state.presenze.forEach(p => {
      if (p.data !== slot.data || p.stato !== 'presente') return;
      const sameSlot = p.ora === slot.ora && p.sede === slot.sede;
      const dayOnly = isPresenzaGiorno(p) && (isLibera || !expected.length);
      if (!sameSlot && !dayOnly) return;
      const chi = state.chierichetti.find(c => presenzaMatchesChierichetto(p, c.uuid));
      const uuid = chi?.uuid || p.chierichettoUuid || p.nome;
      if (seen.has(uuid)) return;
      seen.add(uuid);
      if (!chi && !p.nome) return;
      const person = chi || { uuid: uuid, nome: p.nome, gruppo: '', parrocchia: '' };
      rows.push({
        data: slot.data,
        ora: slot.ora,
        sede: slot.sede,
        sedeLabel: slot.sedeLabel || SEDI_LABEL[slot.sede] || slot.sede,
        gruppoId: slot.gruppo || person.gruppo || '',
        gruppoLabel: slot.gruppoLabel || getGruppoLabel(person.gruppo) || (isLibera ? 'Libera' : ''),
        chi: person,
        stato: 'presente',
        extra: !expected.some(e => e.uuid === uuid),
        isLibera,
        slotKey
      });
    });
  });

  return rows.filter(r => {
    if (statoF && r.stato !== statoF) return false;
    if (gruppoF && r.gruppoId !== gruppoF) return false;
    if (q && !(r.chi.nome || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function changeRegistroPastoralYear(delta) {
  ensureRegistroPeriod();
  const next = registroPastoralStart + delta;
  const max = getMaxPastoralYearStart();
  if (next > max) {
    showToast(`L'anno ${formatPastoralYearLabel(next)} non è ancora disponibile`);
    return;
  }
  if (next < REGISTRO_MIN_PASTORAL_START) {
    showToast(`Il registro parte dall'anno ${formatPastoralYearLabel(REGISTRO_MIN_PASTORAL_START)}`);
    return;
  }
  registroPastoralStart = next;
  renderRegistro();
}

function goRegistroThisPastoralYear() {
  const t = new Date();
  registroPastoralStart = getPastoralYearStartForDate(t);
  const m = t.getMonth();
  registroMonth = (m >= 7 || m <= 5) ? m : null;
  renderRegistro();
}

function hasServizioPresenzaOnDate(uuid, dateStr) {
  return state.presenze.some(p =>
    p.data === dateStr && p.ora && p.sede && p.stato === 'presente' && presenzaMatchesChierichetto(p, uuid)
  );
}

function isPresenteAtRegistroSlot(uuid, slot) {
  if (getPresenzaServizioFor(uuid, slot.data, slot.ora, slot.sede)) return true;
  if (hasServizioPresenzaOnDate(uuid, slot.data)) return false;
  return getPresenzaGiornoFor(uuid, slot.data)?.stato === 'presente';
}

function populateRegistroGruppoFilter() {
  const sel = document.getElementById('registro-filter-gruppo');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Tutti i gruppi</option>' +
    getGruppiOrdered().map(g => `<option value="${esc(g.id)}">${esc(g.nome)}</option>`).join('');
  if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function renderRegistro() {
  ensureRegistroPeriod();
  populateRegistroMonthFilter();
  populateRegistroGruppoFilter();
  const label = document.getElementById('registro-month-label');
  if (label) {
    label.textContent = formatPastoralYearLabel(registroPastoralStart);
    label.title = formatPastoralYearRangeLabel(registroPastoralStart);
  }

  const slots = getRegistroMonthSlots();
  const rows = getRegistroRows();
  const nP = rows.filter(r => r.stato === 'presente').length;
  const nA = rows.filter(r => r.stato === 'assente').length;
  const tot = nP + nA;
  const elP = document.getElementById('registro-stat-p');
  const elA = document.getElementById('registro-stat-a');
  const elR = document.getElementById('registro-stat-rate');
  if (elP) elP.textContent = nP;
  if (elA) elA.textContent = nA;
  if (elR) elR.textContent = tot ? Math.round((nP / tot) * 100) + '%' : '—';

  const meta = document.getElementById('registro-month-meta');
  if (meta) {
    const nMesse = slots.length;
    const nLibere = slots.filter(s => isMessaSenzaGruppoServizio(s)).length;
    const period = registroMonth == null
      ? formatPastoralYearRangeLabel(registroPastoralStart)
      : `${MONTHS[registroMonth]} ${calendarYearForPastoralMonth(registroPastoralStart, registroMonth)}`;
    if (isPastoralYearNotStarted(registroPastoralStart)) {
      const open = getPastoralYearWindowStart(registroPastoralStart);
      const openLabel = new Date(open + 'T12:00:00').toLocaleDateString('it-IT', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
      meta.textContent = `L'anno ${formatPastoralYearLabel(registroPastoralStart)} apre il ${openLabel} — non ci sono ancora messe da mostrare`;
    } else {
      meta.textContent = nMesse
        ? `${period} · ${nMesse} messe${nLibere ? ` (${nLibere} libere)` : ''} · ${rows.length} voci`
        : `Nessuna messa passata in ${period.toLowerCase()}`;
    }
  }

  renderRegistroByMessa(slots, rows);
  renderRegistroByGruppo(rows);
  renderRegistroByPersona(rows);
  switchRegistroTab(registroTab);
}

function renderRegistroPersonRow(r) {
  return `
    <div class="registro-row">
      <div>
        <p class="registro-row-name">${esc(r.chi.nome)}${isAppelloCerimoniere(r.chi) ? ' · cer.' : ''}</p>
        <p class="registro-row-sub">${r.extra ? 'Non di turno · ' : ''}${esc(getParrocchiaLabel(r.chi.parrocchia) || '')}</p>
      </div>
      <span class="badge ${r.stato === 'presente' ? 'badge-presente' : 'badge-assente'}">${r.stato === 'presente' ? 'Presente' : 'Assente'}</span>
    </div>
  `;
}

function registroMassRateClass(nP, nA) {
  const tot = nP + nA;
  if (!tot || !nA) return '';
  const pct = (nP / tot) * 100;
  if (pct >= 75) return '';
  if (pct >= 50) return ' is-warn';
  return ' is-bad';
}

function renderRegistroByMessa(slots, rows) {
  const container = document.getElementById('registro-messa-list');
  if (!container) return;

  const bySlot = new Map();
  rows.forEach(r => {
    const key = r.slotKey || `${r.data}|${r.sede}|${r.ora}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(r);
  });

  const statoF = document.getElementById('registro-filter-stato')?.value || '';
  const gruppoF = document.getElementById('registro-filter-gruppo')?.value || '';
  const q = (document.getElementById('registro-search')?.value || '').trim().toLowerCase();
  const hasPersonFilters = !!(statoF || gruppoF || q);

  let visibleSlots = slots;
  if (hasPersonFilters) {
    const keysWithRows = new Set(rows.map(r => r.slotKey));
    visibleSlots = slots.filter(s => keysWithRows.has(s.slotKey));
  }

  if (!visibleSlots.length) {
    const future = isPastoralYearNotStarted(registroPastoralStart);
    const currentLabel = formatPastoralYearLabel(getMaxPastoralYearStart());
    const openLabel = future
      ? new Date(getPastoralYearWindowStart(registroPastoralStart) + 'T12:00:00').toLocaleDateString('it-IT', {
          day: 'numeric', month: 'long', year: 'numeric'
        })
      : '';
    container.innerHTML = future
      ? `<p class="empty-state">Questo anno pastorale apre il ${openLabel}.<br><button type="button" class="btn btn-secondary" style="margin-top:12px" onclick="goRegistroThisPastoralYear()">Apri ${esc(currentLabel)}</button></p>`
      : '<p class="empty-state">Nessuna messa in questo periodo con i filtri scelti</p>';
    return;
  }

  const byDate = new Map();
  visibleSlots.forEach(slot => {
    if (!byDate.has(slot.data)) byDate.set(slot.data, []);
    byDate.get(slot.data).push(slot);
  });

  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  container.innerHTML = dates.map(dateStr => {
    const daySlots = byDate.get(dateStr);
    const dayLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    const massesHtml = daySlots.map(slot => {
      const slotKey = slot.slotKey;
      const list = bySlot.get(slotKey) || [];
      const isLibera = isMessaSenzaGruppoServizio(slot);
      const nP = list.filter(r => r.stato === 'presente').length;
      const nA = list.filter(r => r.stato === 'assente').length;
      const tot = nP + nA;
      const pct = tot ? Math.round((nP / tot) * 100) : 0;
      const people = list.slice().sort((a, b) => {
        if (a.stato !== b.stato) return a.stato === 'assente' ? -1 : 1;
        return (a.chi.nome || '').localeCompare(b.chi.nome || '', 'it');
      });
      const open = registroOpenSlotKey === slotKey;
      const gruppoBadge = isLibera
        ? '<span class="badge badge-libera">Libera</span>'
        : (slot.gruppoLabel ? esc(slot.gruppoLabel) : '');
      const countsLabel = isLibera
        ? (nP ? `${nP} presenti` : 'Nessun appello')
        : `${nP} P · ${nA} A`;
      const rateBar = !isLibera && tot
        ? `<span class="registro-mass-rate" title="${pct}%"><span style="width:${pct}%"></span></span>`
        : '';
      return `
        <div class="registro-mass${open ? ' is-open' : ''}${isLibera ? ' is-libera' : ''}${registroMassRateClass(nP, nA)}" data-slot="${esc(slotKey)}">
          <button type="button" class="registro-mass-btn" onclick='toggleRegistroMass(${jsStr(slotKey)})' aria-expanded="${open}">
            <div>
              <p class="registro-mass-title">${esc((slot.ora || '').slice(0, 5))} · ${esc(slot.sedeLabel)}</p>
              <p class="registro-mass-meta">${gruppoBadge}</p>
            </div>
            ${rateBar}
            <span class="registro-mass-counts">${countsLabel}</span>
            <span class="registro-mass-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
          </button>
          <div class="registro-mass-body"${open ? '' : ' hidden'}>
            ${people.length
              ? people.map(renderRegistroPersonRow).join('')
              : '<p class="registro-empty-mass">Nessun appello registrato per questa messa.</p>'}
            <div style="padding:10px 16px 14px">
              <button type="button" class="btn btn-ghost" onclick="openAppello(${jsStr(slot.data)}, ${jsStr(slotKey)})">Apri appello</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
      <section class="registro-day-block">
        <h4 class="registro-day-label">${esc(dayLabel)}</h4>
        ${massesHtml}
      </section>
    `;
  }).join('');
}

function renderRegistroByGruppo(rows) {
  const container = document.getElementById('registro-gruppo-list');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="empty-state">Nessuna voce in questo mese con i filtri scelti</p>';
    return;
  }

  const byGroup = new Map();
  rows.forEach(r => {
    const id = r.gruppoId || '_none';
    if (!byGroup.has(id)) {
      byGroup.set(id, {
        id,
        label: id === '_none' ? 'Messe libere / altri' : (r.gruppoLabel || 'Senza gruppo'),
        rows: []
      });
    }
    byGroup.get(id).rows.push(r);
  });

  const cards = [...byGroup.values()].sort((a, b) => a.label.localeCompare(b.label, 'it'));
  container.innerHTML = cards.map(g => {
    const nP = g.rows.filter(r => r.stato === 'presente').length;
    const nA = g.rows.filter(r => r.stato === 'assente').length;
    const tot = nP + nA;
    const pct = tot ? Math.round((nP / tot) * 100) : 0;
    const byPerson = new Map();
    g.rows.forEach(r => {
      const pid = r.chi.uuid || r.chi.nome;
      if (!byPerson.has(pid)) byPerson.set(pid, { chi: r.chi, presente: 0, assente: 0 });
      const rec = byPerson.get(pid);
      if (r.stato === 'presente') rec.presente += 1;
      else rec.assente += 1;
    });
    const people = [...byPerson.values()].sort((a, b) => {
      const ta = a.presente + a.assente;
      const tb = b.presente + b.assente;
      const pa = ta ? a.presente / ta : 0;
      const pb = tb ? b.presente / tb : 0;
      if (pa !== pb) return pa - pb;
      return (a.chi.nome || '').localeCompare(b.chi.nome || '', 'it');
    });
    const open = registroOpenGroupId === g.id;
    return `
      <div class="registro-group-card${open ? ' is-open' : ''}" data-group="${esc(g.id)}">
        <button type="button" class="registro-group-head" onclick='toggleRegistroGroup(${jsStr(g.id)})' aria-expanded="${open}">
          <div>
            <h4 style="margin:0;font-size:1rem">${esc(g.label)}</h4>
            <p class="registro-group-summary">${nP} presenze · ${nA} assenze · ${pct}% · ${people.length} persone</p>
            <div class="registro-person-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          </div>
          <span class="registro-group-chevron" aria-hidden="true">${open ? '▾' : '▸'}</span>
        </button>
        <div class="registro-group-body"${open ? '' : ' hidden'}>
          <div class="registro-group-people">
            ${people.map(({ chi, presente, assente }) => {
              const t = presente + assente;
              const p = t ? Math.round((presente / t) * 100) : 0;
              return `
                <div class="registro-row">
                  <div>
                    <p class="registro-row-name">${esc(chi.nome)}</p>
                    <p class="registro-row-sub">${presente} P · ${assente} A · ${p}%</p>
                    <div class="registro-person-bar" aria-hidden="true"><span style="width:${p}%"></span></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRegistroByPersona(rows) {
  const container = document.getElementById('registro-persone-list');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="empty-state">Nessuna voce in questo mese con i filtri scelti</p>';
    return;
  }

  const byPerson = new Map();
  rows.forEach(r => {
    const id = r.chi.uuid || r.chi.nome;
    if (!byPerson.has(id)) {
      byPerson.set(id, { chi: r.chi, presente: 0, assente: 0 });
    }
    const rec = byPerson.get(id);
    if (r.stato === 'presente') rec.presente += 1;
    else rec.assente += 1;
  });

  const list = [...byPerson.values()].sort((a, b) => {
    const ta = a.presente + a.assente;
    const tb = b.presente + b.assente;
    const pa = ta ? a.presente / ta : 0;
    const pb = tb ? b.presente / tb : 0;
    if (pa !== pb) return pa - pb;
    return (a.chi.nome || '').localeCompare(b.chi.nome || '', 'it');
  });

  container.innerHTML = `<div class="registro-person-grid">${list.map(({ chi, presente, assente }) => {
    const tot = presente + assente;
    const pct = tot ? Math.round((presente / tot) * 100) : 0;
    const pctClass = pct >= 75 ? 'is-ok' : (pct >= 50 ? 'is-mid' : 'is-low');
    return `
      <article class="registro-person-card">
        <div class="registro-person-avatar" aria-hidden="true">${esc(chierichettoInitials(chi.nome))}</div>
        <div class="registro-person-card-main">
          <p class="registro-person-card-name">${esc(chi.nome)}</p>
          <p class="registro-person-card-meta">${esc(getGruppoLabel(chi.gruppo) || 'Senza gruppo')}${chi.parrocchia ? ' · ' + esc(getParrocchiaLabel(chi.parrocchia)) : ''}</p>
          <div class="registro-person-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
          <p class="registro-person-pct ${pctClass}">${pct}%</p>
          <p class="registro-person-card-meta">${presente} presenze · ${assente} assenze</p>
        </div>
      </article>
    `;
  }).join('')}</div>`;
}

function chierichettoInitials(nome) {
  return (nome || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function formatAppelloDateHuman(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

function getAppelloSlotKey(slot) {
  return slot.key || messaSlotKey(slot);
}

function getAppelloDraftKey(dateStr, slot) {
  return slot ? getAppelloSlotKey(slot) : `_day|${dateStr}`;
}

function getSavedAppelloPresentSet(dateStr, slot) {
  const set = new Set();
  state.chierichetti.forEach(c => {
    if (slot) {
      if (getPresenzaServizioFor(c.uuid, dateStr, slot.ora, slot.sede)) set.add(c.uuid);
    } else if (getPresenzaGiornoFor(c.uuid, dateStr)?.stato === 'presente') {
      set.add(c.uuid);
    }
  });
  return set;
}

function ensureAppelloDraft(dateStr, slot) {
  const key = getAppelloDraftKey(dateStr, slot);
  if (!appelloDraft[key]) {
    appelloDraft[key] = getSavedAppelloPresentSet(dateStr, slot);
    appelloDraftDirty[key] = false;
  }
  return appelloDraft[key];
}

function isAppelloDraftDirty(dateStr, slot) {
  const key = getAppelloDraftKey(dateStr, slot);
  return !!appelloDraftDirty[key];
}

function isDraftPresente(uuid, dateStr, slotOrKey) {
  const slot = typeof slotOrKey === 'string'
    ? (slotOrKey.startsWith('_day|') ? null : parseMessaSlotKey(slotOrKey))
    : slotOrKey;
  const key = typeof slotOrKey === 'string' && slotOrKey.startsWith('_day|')
    ? slotOrKey
    : getAppelloDraftKey(dateStr, slot);
  if (appelloDraft[key]) return appelloDraft[key].has(uuid);
  if (slot) return !!getPresenzaServizioFor(uuid, dateStr, slot.ora, slot.sede);
  return getPresenzaGiornoFor(uuid, dateStr)?.stato === 'presente';
}

function setDraftPresente(uuid, dateStr, slot, present) {
  const draft = ensureAppelloDraft(dateStr, slot);
  const key = getAppelloDraftKey(dateStr, slot);
  if (present) draft.add(uuid);
  else draft.delete(uuid);
  const saved = getSavedAppelloPresentSet(dateStr, slot);
  const dirty = draft.size !== saved.size || [...draft].some(id => !saved.has(id));
  appelloDraftDirty[key] = dirty;
  appelloSaveFailed = false;
  if (dirty) scheduleAppelloAutoSave();
  else if (appelloAutoSaveTimer) {
    clearTimeout(appelloAutoSaveTimer);
    appelloAutoSaveTimer = null;
  }
}

function updateAppelloSaveBar(dateStr, slot, opts = {}) {
  const bar = document.querySelector('.appello-save-bar');
  const hasPeople = opts.hasPeople;
  if (bar && typeof hasPeople === 'boolean') {
    bar.classList.toggle('is-hidden', !hasPeople);
  }
  const dirty = isAppelloDraftDirty(dateStr, slot);
  const hint = document.getElementById('appello-save-hint');
  const saveBtn = document.getElementById('btn-save-appello');
  const discardBtn = document.getElementById('btn-discard-appello');
  if (hint) {
    hint.classList.remove('is-dirty', 'is-saved', 'is-saving', 'is-error');
    if (appelloSaving) {
      hint.textContent = 'Salvataggio…';
      hint.classList.add('is-saving');
    } else if (appelloSaveFailed) {
      hint.textContent = 'Non salvato — riprova';
      hint.classList.add('is-error');
    } else if (dirty) {
      hint.textContent = 'Salvataggio automatico…';
      hint.classList.add('is-dirty');
    } else {
      hint.textContent = 'Tutto salvato';
      hint.classList.add('is-saved');
    }
  }
  if (saveBtn) {
    const needRetry = appelloSaveFailed || dirty;
    saveBtn.disabled = (!needRetry && !dirty) || appelloSaving;
    if (appelloSaving) saveBtn.textContent = 'Salvataggio…';
    else if (appelloSaveFailed) saveBtn.textContent = 'Riprova';
    else if (dirty) saveBtn.textContent = 'Salva ora';
    else saveBtn.textContent = 'Salva appello';
  }
  if (discardBtn) discardBtn.disabled = (!dirty && !appelloSaveFailed) || appelloSaving;
}

function discardAppelloDraft() {
  if (appelloAutoSaveTimer) {
    clearTimeout(appelloAutoSaveTimer);
    appelloAutoSaveTimer = null;
  }
  appelloSaveFailed = false;
  const dateStr = getAppelloDate();
  const celebrations = getCelebrationsForAppelloDate(dateStr);
  const slot = getSelectedAppelloCelebration(celebrations);
  const key = getAppelloDraftKey(dateStr, slot);
  delete appelloDraft[key];
  delete appelloDraftDirty[key];
  ensureAppelloDraft(dateStr, slot);
  renderAppello();
}

async function saveAppello(opts = {}) {
  if (appelloSaving) return;
  if (appelloAutoSaveTimer) {
    clearTimeout(appelloAutoSaveTimer);
    appelloAutoSaveTimer = null;
  }
  const quiet = !!opts.quiet;
  const dateStr = getAppelloDate();
  const celebrations = getCelebrationsForAppelloDate(dateStr);
  const slot = getSelectedAppelloCelebration(celebrations);
  const key = getAppelloDraftKey(dateStr, slot);
  const draft = ensureAppelloDraft(dateStr, slot);
  const saved = getSavedAppelloPresentSet(dateStr, slot);
  const toAdd = [...draft].filter(id => !saved.has(id));
  const toRemove = [...saved].filter(id => !draft.has(id));
  if (!toAdd.length && !toRemove.length) {
    appelloDraftDirty[key] = false;
    appelloSaveFailed = false;
    updateAppelloSaveBar(dateStr, slot);
    return;
  }

  const removeUuids = [];
  const add = [];
  if (slot) {
    toRemove.forEach(id => {
      state.presenze.filter(p =>
        p.data === slot.data && p.ora === slot.ora && p.sede === slot.sede &&
        presenzaMatchesChierichetto(p, id)
      ).forEach(p => removeUuids.push(p.uuid));
      state.presenze = state.presenze.filter(p => !(
        p.data === slot.data && p.ora === slot.ora && p.sede === slot.sede &&
        presenzaMatchesChierichetto(p, id)
      ));
    });
    toAdd.forEach(id => {
      const chi = state.chierichetti.find(c => c.uuid === id);
      if (!chi) return;
      const record = {
        uuid: 'PRE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        data: slot.data,
        chierichettoUuid: id,
        nome: chi.nome,
        stato: 'presente',
        ora: slot.ora,
        sede: slot.sede,
        motivo: '',
        createdAt: new Date().toISOString()
      };
      state.presenze.push(record);
      add.push(record);
    });
  } else {
    toRemove.forEach(id => {
      const existing = getPresenzaGiornoFor(id, dateStr);
      if (existing) {
        removeUuids.push(existing.uuid);
        state.presenze = state.presenze.filter(p => p.uuid !== existing.uuid);
      }
    });
    toAdd.forEach(id => {
      const chi = state.chierichetti.find(c => c.uuid === id);
      if (!chi) return;
      const record = {
        uuid: 'PRE-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        data: dateStr,
        chierichettoUuid: id,
        nome: chi.nome,
        stato: 'presente',
        ora: '',
        sede: '',
        motivo: '',
        createdAt: new Date().toISOString()
      };
      state.presenze.push(record);
      add.push(record);
    });
  }

  saveData();
  appelloSaving = true;
  appelloSaveQuiet = quiet;
  updateAppelloSaveBar(dateStr, slot);

  try {
    if (isGAS) {
      mutationFailed(await gasRun('salvaAppelloBatch', { removeUuids, add }), 'Sincronizzazione appello non riuscita');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaAppelloBatch({ removeUuids, add }), 'Sincronizzazione appello non riuscita');
    } else {
      await Promise.all([
        ...removeUuids.map(id => persistDeletePresenza(id)),
        ...add.map(r => persistPresenzaRecord(r))
      ]);
    }
    appelloDraft[key] = getSavedAppelloPresentSet(dateStr, slot);
    appelloDraftDirty[key] = false;
    appelloSaveFailed = false;
    if (!quiet) showToast('Appello salvato');
  } catch (e) {
    appelloDraftDirty[key] = true;
    appelloSaveFailed = true;
    showToast(e.message || 'Salvataggio non riuscito — riprova');
  } finally {
    appelloSaving = false;
    appelloSaveQuiet = false;
    renderAppello();
    if (document.getElementById('dashboard')?.classList.contains('active')) renderDashboard();
  }
}

function formatAppelloMessaShort(slot) {
  const ora = (slot.ora || '').slice(0, 5);
  const sede = slot.sedeLabel || SEDI_LABEL[slot.sede] || slot.sede || '';
  return `${sede} ${ora}`.trim();
}

function ensureAppelloMessaSelection(celebrations) {
  if (!celebrations.length) {
    appelloSelectedSlotKey = '_fallback';
    return;
  }
  const keys = celebrations.map(getAppelloSlotKey);
  if (appelloSelectedSlotKey && keys.includes(appelloSelectedSlotKey)) return;

  if (celebrations.length === 1) {
    appelloSelectedSlotKey = getAppelloSlotKey(celebrations[0]);
    return;
  }

  const dateStr = getAppelloDate();
  const ranked = celebrations.map(slot => {
    const [h, m] = (slot.ora || '00:00').split(':').map(Number);
    const t = new Date(dateStr + 'T12:00:00');
    t.setHours(h || 0, m || 0, 0, 0);
    const stats = getAppelloStatsForSlot(dateStr, slot);
    return { slot, t, incomplete: !stats.isComplete && !stats.libera };
  });

  if (dateStr === getTodayStr()) {
    const now = new Date();
    const upcomingIncomplete = ranked.find(x => x.t >= now && x.incomplete);
    const upcoming = ranked.find(x => x.t >= now);
    const firstIncomplete = ranked.find(x => x.incomplete);
    const pick = upcomingIncomplete || upcoming || firstIncomplete || ranked[0];
    appelloSelectedSlotKey = getAppelloSlotKey(pick.slot);
    return;
  }

  const incomplete = ranked.find(x => x.incomplete);
  appelloSelectedSlotKey = getAppelloSlotKey((incomplete || ranked[0]).slot);
}

function getSelectedAppelloCelebration(celebrations) {
  ensureAppelloMessaSelection(celebrations);
  if (!celebrations.length) return null;
  return celebrations.find(s => getAppelloSlotKey(s) === appelloSelectedSlotKey) || celebrations[0];
}

async function selectAppelloMessa(slotKey) {
  if (slotKey === appelloSelectedSlotKey) return;
  const ok = await flushAppelloIfNeeded();
  if (!ok) return;
  appelloSelectedSlotKey = slotKey;
  const slot = parseMessaSlotKey(slotKey);
  const primaryGruppo = getAppelloPrimaryGruppoForSlot(slot);
  appelloParrocchiaTab = getDefaultAppelloParrocchiaTab(primaryGruppo, slot);
  appelloParrocchiaTabBySlot = {};
  renderAppello();
}

function renderAppelloSelfPresence(dateStr, slot) {
  const me = getCurrentUserChierichetto();
  if (!me) return '';
  const slotKey = slot ? getAppelloSlotKey(slot) : null;
  const checked = isChierichettoSegnatoInAppello(me, dateStr, slotKey);
  const cerClass = isAppelloCerimoniere(me) ? ' is-cerimoniere' : '';
  const onChange = slotKey
    ? `toggleServizioMessa(${jsStr(me.uuid)}, ${jsStr(slotKey)}, this.checked)`
    : `togglePresenzaGiorno(${jsStr(me.uuid)}, this.checked)`;
  return `
    <aside class="appello-self-card${cerClass}" aria-label="La tua presenza">
      <label class="appello-self-check">
        <input type="checkbox"${checked ? ' checked' : ''} onchange='${onChange}' aria-label="Segna la tua presenza">
        <span class="appello-self-avatar" aria-hidden="true">${esc(chierichettoInitials(me.nome))}</span>
        <span class="appello-self-copy">
          <span class="appello-self-name">${chierichettoNomeHtml(me)}</span>
          <span class="appello-self-hint">Tu</span>
        </span>
      </label>
    </aside>
  `;
}

function renderAppelloMessePicker(celebrations, dateStr) {
  const wrap = document.getElementById('appello-messe-picker');
  if (!wrap) return;
  const selected = celebrations.length ? getSelectedAppelloCelebration(celebrations) : null;
  const selfHtml = renderAppelloSelfPresence(dateStr, selected);

  if (!celebrations.length) {
    wrap.innerHTML = selfHtml
      ? `<div class="appello-messe-picker-row">${selfHtml}</div>`
      : '';
    return;
  }
  ensureAppelloMessaSelection(celebrations);
  wrap.innerHTML = `
    <div class="appello-messe-picker-row">
      <div class="appello-messe-picker" role="tablist" aria-label="Seleziona messa">
        ${celebrations.map(slot => {
          const key = getAppelloSlotKey(slot);
          const stats = getAppelloStatsForSlot(dateStr, slot);
          const active = key === appelloSelectedSlotKey;
          const turno = slot.gruppoLabel
            ? `<span class="appello-messa-pill-turno">${esc(slot.gruppoLabel)}</span>`
            : (isMessaSenzaGruppoServizio(slot)
              ? '<span class="appello-messa-pill-turno appello-messa-pill-libera">Libera</span>'
              : '');
          return `
            <button type="button" class="appello-messa-pill${active ? ' active' : ''}${stats.isComplete ? ' is-done' : ''}"
              role="tab" aria-selected="${active}"
              onclick='selectAppelloMessa(${jsStr(key)})'>
              <span class="appello-messa-pill-time">${esc(formatAppelloMessaShort(slot))}</span>
              ${turno}
            </button>
          `;
        }).join('')}
      </div>
      ${selfHtml}
    </div>
  `;
}

/** Pool del tab «Di turno»: gruppo dell'utente se collegato, altrimenti turno della messa */
function getAppelloDiTurnoPool(slot) {
  if (!slot) return [];
  const primaryGruppo = getAppelloPrimaryGruppoForSlot(slot);
  const pool = getChierichettiForAppelloSlot(slot);
  if (primaryGruppo) {
    return pool.filter(c => c.gruppo === primaryGruppo);
  }
  return pool;
}

function getAppelloCerimonieriDiServizio(slotOrExpected) {
  const pool = Array.isArray(slotOrExpected)
    ? slotOrExpected
    : getAppelloDiTurnoPool(slotOrExpected);
  return pool.filter(c => isAppelloCerimoniere(c));
}

function countAppelloPresentiCerimonieri(dateStr, slot, cerimonieri) {
  return cerimonieri.filter(c => isDraftPresente(c.uuid, dateStr, slot)).length;
}

function getAppelloStatsForSlot(dateStr, slot) {
  if (slot) {
    ensureAppelloDraft(dateStr, slot);
    const libera = isMessaSenzaGruppoServizio(slot);
    const expected = libera ? getChierichettiForAppelloSlot(slot) : getExpectedForMessaSlot(slot);
    const diServizio = expected.length;
    const presenti = libera
      ? getChierichettiForAppelloSlot(slot).filter(c => isDraftPresente(c.uuid, dateStr, slot)).length
      : expected.filter(c => isDraftPresente(c.uuid, dateStr, slot)).length;
    const assenti = libera ? 0 : Math.max(0, diServizio - presenti);
    const cerimonieri = getAppelloCerimonieriDiServizio(slot);
    const cerPresenti = countAppelloPresentiCerimonieri(dateStr, slot, cerimonieri);
    return {
      diServizio: libera ? 0 : diServizio,
      presenti,
      assenti,
      cerimonieri: cerimonieri.length,
      cerPresenti,
      isComplete: !libera && diServizio > 0 && presenti >= diServizio,
      libera
    };
  }

  ensureAppelloDraft(dateStr, null);
  const gruppi = getGruppiServizioForDate(dateStr);
  const { list } = getAppelloFilteredList();
  const expected = gruppi.length
    ? getPersoneGruppiPool().filter(c => gruppi.includes(c.gruppo))
    : list;
  const diServizio = expected.length;
  const presenti = expected.filter(c => isDraftPresente(c.uuid, dateStr, null)).length;
  const assenti = Math.max(0, diServizio - presenti);
  const cerimonieri = getAppelloCerimonieriDiServizio(expected);
  const cerPresenti = countAppelloPresentiCerimonieri(dateStr, null, cerimonieri);
  return {
    diServizio,
    presenti,
    assenti,
    cerimonieri: cerimonieri.length,
    cerPresenti,
    isComplete: diServizio > 0 && presenti >= diServizio
  };
}

function applyAppelloStatsToHeader(stats) {
  const setStat = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const expectedChip = document.getElementById('appello-stat-expected')?.closest('.appello-stat-chip');
  const assentiChip = document.getElementById('appello-stat-a')?.closest('.appello-stat-chip');
  if (stats.libera) {
    if (expectedChip) expectedChip.hidden = true;
    if (assentiChip) assentiChip.hidden = true;
    setStat('appello-stat-p', stats.presenti);
  } else {
    if (expectedChip) expectedChip.hidden = false;
    if (assentiChip) assentiChip.hidden = false;
    setStat('appello-stat-expected', stats.diServizio);
    setStat('appello-stat-p', stats.presenti);
    setStat('appello-stat-a', stats.assenti);
  }
  const cerWrap = document.getElementById('appello-stats-cer-wrap');
  if (cerWrap) {
    const showCer = stats.cerimonieri > 0;
    cerWrap.hidden = !showCer;
    if (showCer) {
      setStat('appello-stat-cer', stats.cerimonieri);
      setStat('appello-stat-cer-p', stats.cerPresenti);
    }
  }
}

function resetAppelloSummary(dateStr, slot) {
  const label = document.getElementById('appello-date-label');
  if (label) label.textContent = formatAppelloDateHuman(dateStr || getAppelloDate());
  applyAppelloStatsToHeader({ diServizio: 0, presenti: 0, assenti: 0, cerimonieri: 0, cerPresenti: 0 });
  document.getElementById('appello-complete-banner')?.classList.remove('visible');
  const subtitleEl = document.getElementById('appello-subtitle');
  if (subtitleEl) subtitleEl.textContent = slot ? formatAppelloMessaShort(slot) : 'Seleziona data e messa';
  const ds = dateStr || getAppelloDate();
  document.getElementById('appello-today-btn')?.classList.toggle('is-today', ds === getTodayStr());
  renderAppelloMessePicker([], ds);
}

function updateAppelloSummary(dateStr, slot) {
  const label = document.getElementById('appello-date-label');
  if (label) label.textContent = formatAppelloDateHuman(dateStr);

  const stats = getAppelloStatsForSlot(dateStr, slot);
  applyAppelloStatsToHeader(stats);

  document.getElementById('appello-complete-banner')?.classList.toggle('visible', stats.isComplete);
  document.getElementById('appello-today-btn')?.classList.toggle('is-today', dateStr === getTodayStr());

  const subtitleEl = document.getElementById('appello-subtitle');
  if (subtitleEl) {
    if (slot) {
      const parts = [
        formatAppelloMessaShort(slot),
        slot.gruppoLabel
          ? (/gruppo/i.test(String(slot.gruppoLabel).trim())
              ? slot.gruppoLabel
              : `Gruppo ${slot.gruppoLabel}`)
          : (isMessaSenzaGruppoServizio(slot) ? 'Messa libera' : null),
        'Spunta chi ha servito'
      ].filter(Boolean);
      subtitleEl.textContent = parts.join(' · ');
    } else {
      subtitleEl.textContent = 'Appello giornaliero · assenze calcolate automaticamente';
    }
  }
}

function togglePresenzaGiorno(uuid, checked) {
  const dateStr = getAppelloDate();
  setDraftPresente(uuid, dateStr, null, checked);
  renderAppello();
}

function filterAppelloChierichetti(list) {
  const search = (document.getElementById('appello-search')?.value || '').toLowerCase();
  return list.filter(c => !search || c.nome.toLowerCase().includes(search));
}

function isChierichettoSegnatoInAppello(c, dateStr, slotKey) {
  if (slotKey) {
    const slot = parseMessaSlotKey(slotKey);
    return isDraftPresente(c.uuid, dateStr, slot);
  }
  return isDraftPresente(c.uuid, dateStr, null);
}

function getAppelloTabChierichetti(slot) {
  const dateStr = getAppelloDate();
  let list;
  if (slot) {
    const slotKey = getAppelloSlotKey(slot);
    const primaryGruppo = getAppelloPrimaryGruppoForSlot(slot);
    const activeTab = getAppelloTabForSlot(slotKey, primaryGruppo, slot);
    list = filterAppelloChierichetti(getChierichettiForAppelloSlot(slot));
    list = filterChierichettiForAppelloTab(list, activeTab, primaryGruppo);
  } else {
    const myGruppo = getCurrentUserChierichetto()?.gruppo || '';
    const primaryGruppo = myGruppo || (getGruppiServizioForDate(dateStr)[0] || '');
    const activeTab = getAppelloTabForSlot('_fallback', primaryGruppo);
    const { list: fallbackList } = getAppelloFilteredList();
    list = filterChierichettiForAppelloTab(fallbackList, activeTab, primaryGruppo);
  }
  return excludeCurrentUserFromAppelloList(list).slice().sort(sortChierichettiAppello);
}

function renderAppelloCheckboxes(chierichetti, dateStr, slotKey) {
  return chierichetti.map(c => {
    const checked = isChierichettoSegnatoInAppello(c, dateStr, slotKey);
    const cerClass = isAppelloCerimoniere(c) ? ' is-cerimoniere' : '';
    const onChange = slotKey
      ? `toggleServizioMessa(${jsStr(c.uuid)}, ${jsStr(slotKey)}, this.checked)`
      : `togglePresenzaGiorno(${jsStr(c.uuid)}, this.checked)`;
    return `
      <label class="appello-check${cerClass}">
        <input type="checkbox"${checked ? ' checked' : ''} onchange='${onChange}'>
        <span class="appello-check-avatar" aria-hidden="true">${esc(chierichettoInitials(c.nome))}</span>
        <span class="appello-check-name">${chierichettoNomeHtml(c)}</span>
      </label>
    `;
  }).join('');
}

function renderAppelloTuttiPresentiTile(chierichetti, dateStr, slotKey) {
  if (!chierichetti.length) return '';
  const allChecked = chierichetti.every(c => isChierichettoSegnatoInAppello(c, dateStr, slotKey));
  return `
    <label class="appello-check appello-check-all">
      <input type="checkbox"${allChecked ? ' checked' : ''} onchange="toggleTuttiPresentiTab(this.checked)">
      <span class="appello-check-avatar appello-check-all-icon" aria-hidden="true">&#10003;</span>
      <span class="appello-check-all-text">
        <span class="appello-check-name">Tutti presenti</span>
        <span class="appello-check-all-hint">Segna o deseleziona tutti in questa tab</span>
      </span>
    </label>
  `;
}

function renderAppelloCheckGrid(chierichetti, dateStr, slotKey) {
  if (!chierichetti.length) {
    return '<p class="empty-state">Nessun chierichetto in questa tab per questa sede</p>';
  }
  return `
    <div class="appello-check-grid">
      ${renderAppelloTuttiPresentiTile(chierichetti, dateStr, slotKey)}
      ${renderAppelloCheckboxes(chierichetti, dateStr, slotKey)}
    </div>
  `;
}

function renderAppelloMessaContent(slot, dateStr) {
  const slotKey = getAppelloSlotKey(slot);
  const chierichetti = getAppelloTabChierichetti(slot);
  return renderAppelloCheckGrid(chierichetti, dateStr, slotKey);
}

function renderAppelloFallback(dateStr, list, primaryGruppo) {
  const activeTab = getAppelloTabForSlot('_fallback', primaryGruppo);
  const filtered = getAppelloTabChierichetti(null);
  const signed = filtered.filter(c => getPresenzaGiornoFor(c.uuid, dateStr)?.stato === 'presente').length;
  const tabLabel = getAppelloParrocchiaTabs(primaryGruppo, null).find(t => t.id === activeTab)?.label || '';
  const myGruppo = getCurrentUserChierichetto()?.gruppo || '';

  return `
    <p class="appello-fallback-note">Nessuna celebrazione in agenda — segna i presenti in <strong>${esc(tabLabel)}</strong>. Gli assenti si calcolano automaticamente.</p>
    <div class="appello-section${(myGruppo || primaryGruppo) && activeTab === 'mine' ? ' is-mine' : ''}">
      <div class="appello-section-head">
        <div class="appello-section-head-left">
          <h4 class="appello-section-title">${esc(tabLabel)}</h4>
          <span class="appello-section-progress">${signed} / ${filtered.length} presenti</span>
        </div>
        <span class="appello-section-count">${filtered.length}</span>
      </div>
      ${renderAppelloCheckGrid(filtered, dateStr, null)}
    </div>
  `;
}

// ── Anagrafica ──────────────────────────────────────────────
function syncAnagraficaStatusTabs() {
  const filter = anagraficaStatusFilter;
  document.getElementById('anag-status-attivi')?.classList.toggle('active', filter === 'attivi');
  document.getElementById('anag-status-ex')?.classList.toggle('active', filter === 'ex');
  document.getElementById('anag-status-promossi')?.classList.toggle('active', filter === 'promossi');
  document.getElementById('anag-cer-status-attivi')?.classList.toggle('active', filter === 'attivi');
  document.getElementById('anag-cer-status-ex')?.classList.toggle('active', filter === 'ex');
  const statusSelect = document.getElementById('filter-anag-status');
  if (statusSelect && statusSelect.value !== filter) statusSelect.value = filter;
  const cerStatusSelect = document.getElementById('filter-cer-status');
  const cerVal = filter === 'ex' ? 'ex' : 'attivi';
  if (cerStatusSelect && cerStatusSelect.value !== cerVal) cerStatusSelect.value = cerVal;
}

function setAnagraficaStatusFilter(status) {
  if (status === 'ex') anagraficaStatusFilter = 'ex';
  else if (status === 'promossi') anagraficaStatusFilter = 'promossi';
  else anagraficaStatusFilter = 'attivi';
  // Il tab Cerimonieri e Don non ha «Ora cerimoniere»
  if (anagraficaTab === 'cerimoniere' && anagraficaStatusFilter === 'promossi') {
    anagraficaStatusFilter = 'attivi';
  }
  syncAnagraficaStatusTabs();
  if (anagraficaTab === 'cerimoniere') renderCerimonieri();
  else renderChierichetti();
}

function switchAnagraficaTab(ruolo, keepForm) {
  anagraficaTab = ruolo;
  document.getElementById('tab-anag-chierichetti').classList.toggle('active', ruolo === 'chierichetto');
  document.getElementById('tab-anag-cerimonieri').classList.toggle('active', ruolo === 'cerimoniere');
  document.getElementById('anag-panel-chierichetti').style.display = ruolo === 'chierichetto' ? '' : 'none';
  document.getElementById('anag-panel-cerimonieri').style.display = ruolo === 'cerimoniere' ? '' : 'none';
  syncAnagraficaStatusTabs();

  if (ruolo === 'chierichetto') {
    document.getElementById('persona-ruolo').value = 'chierichetto';
    if (!keepForm) {
      cancelPromoteChierichetto();
      cancelEdit();
    }
    else updateAnagraficaFormLabels();
    renderChierichetti();
  } else {
    closeAnagPersonMenu();
    closeAnagPersonDetail();
    setAnagFormOpen(false);
    setCerFormOpen(false);
    syncAnagFab();
    loadCerimonieriAccounts().then(() => {
      renderCerimonieri();
      if (!keepForm && isCurrentUserAdmin()) cancelCerimoniereEdit();
    });
  }
}

function updateAnagraficaFormLabels() {
  const editing = !!editingUuid;
  const promoting = !!promotingUuid;
  if (promoting) {
    document.getElementById('form-chierichetto-title').textContent = 'Promuovi a cerimoniere';
    document.getElementById('form-chierichetto-sub').textContent = 'Email e password per il nuovo account di login';
  } else {
    document.getElementById('form-chierichetto-title').textContent = editing ? 'Modifica chierichetto' : 'Nuovo chierichetto';
    if (!editing) {
      document.getElementById('form-chierichetto-sub').textContent = 'Nome, parrocchia e telefoni genitori — il gruppo si assegna in Gruppi';
    }
  }
  document.getElementById('anag-gruppo-hint').style.display = promoting ? 'none' : '';
  document.getElementById('anag-list-title').textContent = 'Elenco';
  document.getElementById('anag-list-count-label').textContent =
    anagraficaStatusFilter === 'ex' ? 'ex'
      : anagraficaStatusFilter === 'promossi' ? 'ora cerimoniere'
      : 'attivi';
  const search = document.getElementById('search-chierichetti');
  if (search) search.placeholder = isAnagMobile() ? 'Cerca…' : 'Cerca nome o telefono…';
  const annoEl = document.getElementById('anno-nascita');
  if (annoEl) annoEl.required = false;
  const parrocchiaEl = document.getElementById('parrocchia');
  if (parrocchiaEl) parrocchiaEl.required = true;
}

function isAnagraficaChierichetto(chi) {
  return isChierichettoPersona(chi);
}

async function setChierichettoAttivo(uuid, attivo) {
  const idx = state.chierichetti.findIndex(c => c.uuid === uuid);
  if (idx < 0) return;
  const c = state.chierichetti[idx];
  if (isChierichettoPromosso(c)) {
    showToast('Questo chierichetto è già stato promosso a cerimoniere');
    return;
  }
  const next = {
    ...c,
    attivo: !!attivo,
    gruppo: attivo ? c.gruppo : '',
    cerimoniereTurno: false,
    promosso: false
  };
  state.chierichetti[idx] = next;
  saveData();
  const ok = await persistPersona({
    nome: next.nome,
    email: '',
    telefono: next.telefono || '',
    telefono2: next.telefono2 || '',
    telefonoChi: next.telefonoChi || '',
    telefono2Chi: next.telefono2Chi || '',
    ruolo: 'chierichetto',
    annoNascita: next.annoNascita,
    parrocchia: next.parrocchia,
    cerimoniereTurno: false,
    promosso: false,
    gruppo: next.gruppo || '',
    attivo: !!attivo
  }, uuid);
  if (!ok) return;
  showToast(attivo ? `${c.nome} ripristinato tra gli attivi` : `${c.nome} segnato come ex`);
  await renderChierichetti();
  populateGruppoSelects();
  if (document.getElementById('gruppi')?.classList.contains('active')) {
    renderGruppi();
  }
}

async function setCerimoniereAttivo(uuid, attivo) {
  if (!requireAdminAction('Solo l\'admin può attivare o disattivare gli accessi')) return;
  const c = cerimonieriAccounts.find(x => x.uuid === uuid);
  if (!c) return;
  if (!attivo && (currentUser?.uuid === uuid || c.admin)) {
    showToast(c.admin ? 'Non puoi disattivare l\'account admin' : 'Non puoi disattivare il tuo account');
    return;
  }
  let result;
  if (isGAS) {
    result = await gasRun('aggiornaCerimoniere', uuid, { attivo: !!attivo });
  } else if (isSupabase) {
    result = await window.ChierichSupabase.aggiornaCerimoniere(uuid, { attivo: !!attivo });
  } else {
    const res = await apiFetch(`/api/cerimonieri/${uuid}`, {
      method: 'PUT',
      body: { attivo: !!attivo }
    });
    result = await res.json();
  }
  if (!result?.success) {
    showToast(result?.message || 'Aggiornamento non riuscito');
    return;
  }
  showToast(attivo ? `${c.nome} ripristinato` : `${c.nome} segnato come ex`);
  await loadCerimonieriAccounts(true);
  renderCerimonieri();
}

function personInitials(nome) {
  const parts = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isAnagMobile() {
  return isPhoneShell();
}

function syncAnagFab() {
  const fab = document.getElementById('anag-fab');
  if (!fab) return;
  const onAnag = document.getElementById('anagrafica')?.classList.contains('active');
  const canAddCer = anagraficaTab === 'cerimoniere' && isCurrentUserAdmin();
  const sheetBusy = isAnagSheetOpen();
  const show = !!(onAnag && isAnagMobile() && !sheetBusy && (anagraficaTab === 'chierichetto' || canAddCer));
  fab.hidden = !show;
  fab.classList.toggle('is-visible', show);
  fab.setAttribute('aria-label', anagraficaTab === 'cerimoniere' ? 'Aggiungi accesso' : 'Aggiungi chierichetto');
}

function onAnagFabClick() {
  if (anagraficaTab === 'cerimoniere') startNewCerimoniere();
  else startNewChierichetto();
}

function isAnagSheetOpen() {
  const chi = document.getElementById('chierichetto-form-panel');
  const cer = document.getElementById('cerimoniere-form-panel');
  return !!(
    (chi && !chi.classList.contains('is-collapsed')) ||
    (cer && !cer.classList.contains('is-collapsed') && cer.style.display !== 'none') ||
    isAnagDetailOpen()
  );
}

function setAnagFormOpen(open) {
  const panel = document.getElementById('chierichetto-form-panel');
  const toggle = document.getElementById('btn-toggle-anag-form');
  const overlay = document.getElementById('anag-form-overlay');
  if (!panel) return;
  if (open) {
    closeAnagPersonDetail();
    document.getElementById('cerimoniere-form-panel')?.classList.add('is-collapsed');
  }
  panel.classList.toggle('is-collapsed', !open);
  document.body.classList.toggle('anag-sheet-open', !!(open && isAnagMobile()));
  if (overlay) {
    overlay.hidden = !(open && isAnagMobile());
  }
  if (toggle) {
    toggle.textContent = open ? 'Chiudi' : 'Apri';
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  syncAnagFab();
}

function setCerFormOpen(open) {
  const panel = document.getElementById('cerimoniere-form-panel');
  const overlay = document.getElementById('anag-form-overlay');
  if (!panel) return;
  if (open) document.getElementById('chierichetto-form-panel')?.classList.add('is-collapsed');
  panel.classList.toggle('is-collapsed', !open);
  document.body.classList.toggle('anag-sheet-open', !!(open && isAnagMobile()));
  if (overlay) {
    overlay.hidden = !(open && isAnagMobile());
  }
  syncAnagFab();
}

function closeAnagSheet() {
  if (isAnagDetailOpen()) {
    closeAnagPersonDetail();
    return;
  }
  const cerPanel = document.getElementById('cerimoniere-form-panel');
  if (cerPanel && !cerPanel.classList.contains('is-collapsed') && anagraficaTab === 'cerimoniere') {
    cancelCerimoniereEdit();
    setCerFormOpen(false);
    return;
  }
  if (promotingUuid) cancelPromoteChierichetto();
  else if (editingUuid) cancelEdit();
  else {
    document.getElementById('chierichettoForm')?.reset();
    populateAnnoNascitaSelect();
    syncAnagTel2Visibility(null);
    setChierichettoFormMode('create');
    updateAnagraficaFormLabels();
  }
  setAnagFormOpen(false);
}

function toggleAnagForm() {
  const panel = document.getElementById('chierichetto-form-panel');
  const open = panel?.classList.contains('is-collapsed');
  setAnagFormOpen(!!open);
  if (open) {
    if (!isAnagMobile()) {
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.getElementById('nome')?.focus();
  }
}

function toggleAnagFilters() {
  const filters = document.getElementById('anag-filters');
  const btn = document.getElementById('btn-anag-filters');
  if (!filters) return;
  const open = !filters.classList.contains('is-open');
  filters.classList.toggle('is-open', open);
  syncAnagFiltersToggle();
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncAnagFiltersToggle() {
  const btn = document.getElementById('btn-anag-filters');
  const filters = document.getElementById('anag-filters');
  if (!btn) return;
  const anno = document.getElementById('filter-anno-nascita')?.value;
  const parro = document.getElementById('filter-parrocchia')?.value;
  const statusOff = anagraficaStatusFilter !== 'attivi';
  const open = !!filters?.classList.contains('is-open');
  const active = open || !!(anno || parro || statusOff);
  btn.classList.toggle('is-active', active);
}

function toggleCerFilters() {
  const filters = document.getElementById('anag-cer-filters');
  const btn = document.getElementById('btn-cer-filters');
  if (!filters) return;
  const open = !filters.classList.contains('is-open');
  filters.classList.toggle('is-open', open);
  syncCerFiltersToggle();
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncCerFiltersToggle() {
  const btn = document.getElementById('btn-cer-filters');
  const filters = document.getElementById('anag-cer-filters');
  if (!btn) return;
  const statusOff = anagraficaStatusFilter !== 'attivi';
  const open = !!filters?.classList.contains('is-open');
  btn.classList.toggle('is-active', open || statusOff);
}

function startNewCerimoniere() {
  if (!requireAdminAction('Solo l\'admin può creare nuovi accessi')) return;
  cancelCerimoniereEdit();
  setCerFormOpen(true);
  const cancelBtn = document.getElementById('btn-cancel-cerimoniere-edit');
  if (cancelBtn && isAnagMobile()) cancelBtn.style.display = 'block';
  if (!isAnagMobile()) {
    document.getElementById('cerimoniere-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('cerimoniere-nome')?.focus();
}

function showAnagTel2() {
  document.getElementById('anag-telefoni-fields')?.classList.add('has-tel2');
  document.getElementById('telefono2-chi')?.focus();
}

function syncAnagTel2Visibility(c) {
  const wrap = document.getElementById('anag-telefoni-fields');
  if (!wrap) return;
  const hasSecond = !!(c?.telefono2 || c?.telefono2Chi);
  wrap.classList.toggle('has-tel2', hasSecond || !isAnagMobile());
}

function startNewChierichetto() {
  cancelPromoteChierichetto();
  cancelEdit();
  syncAnagTel2Visibility(null);
  setAnagFormOpen(true);
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (cancelBtn && isAnagMobile()) cancelBtn.style.display = 'block';
  if (!isAnagMobile()) {
    requestAnimationFrame(() => {
      document.getElementById('chierichetto-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
  document.getElementById('nome')?.focus();
}

function setChierichettoFormMode(mode) {
  const createForm = document.getElementById('chierichettoForm');
  const promoteForm = document.getElementById('promoteChierichettoForm');
  const isPromote = mode === 'promote';
  if (createForm) createForm.style.display = isPromote ? 'none' : '';
  if (promoteForm) promoteForm.style.display = isPromote ? '' : 'none';
}

function startPromoteChierichetto(uuid) {
  if (!isCurrentUserAdmin()) {
    showToast('Solo l\'admin può promuovere a cerimoniere', 'error');
    return;
  }
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c || !isChierichettoPersona(c) || isChierichettoPromosso(c) || !isPersonaAttiva(c)) return;

  cancelEdit();
  promotingUuid = uuid;
  document.getElementById('promote-uuid').value = uuid;
  document.getElementById('promote-nome-hint').textContent =
    `Promuovi ${c.nome} a cerimoniere: indica email e password per il login.`;
  document.getElementById('promote-email').value = '';
  document.getElementById('promote-password').value = '';
  document.getElementById('promote-password2').value = '';
  setChierichettoFormMode('promote');
  updateAnagraficaFormLabels();
  setAnagFormOpen(true);
  if (!isAnagMobile()) {
    document.getElementById('chierichetto-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('promote-email')?.focus();
}

function cancelPromoteChierichetto() {
  promotingUuid = null;
  const form = document.getElementById('promoteChierichettoForm');
  if (form) form.reset();
  document.getElementById('promote-uuid').value = '';
  setChierichettoFormMode('create');
  updateAnagraficaFormLabels();
  if (isAnagMobile()) setAnagFormOpen(false);
}

async function handlePromoteChierichettoSubmit(e) {
  e.preventDefault();
  if (!isCurrentUserAdmin()) {
    showToast('Solo l\'admin può promuovere a cerimoniere', 'error');
    cancelPromoteChierichetto();
    return;
  }

  const uuid = document.getElementById('promote-uuid').value || promotingUuid;
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c) {
    showToast('Chierichetto non trovato');
    return;
  }
  if (isChierichettoPromosso(c)) {
    showToast('Già promosso a cerimoniere');
    return;
  }

  const email = document.getElementById('promote-email').value.trim();
  const password = document.getElementById('promote-password').value;
  const password2 = document.getElementById('promote-password2').value;
  if (!email) {
    showToast('Inserisci l\'email di login');
    return;
  }
  if (!password || password.length < 6) {
    showToast('Password di almeno 6 caratteri');
    return;
  }
  if (password !== password2) {
    showToast('Le password non coincidono');
    return;
  }

  const btn = document.getElementById('btn-promote-chierichetto');
  if (btn) btn.disabled = true;
  try {
    const datiAccount = {
      nome: c.nome,
      email,
      password,
      parrocchia: c.parrocchia || '',
      chierichettoUuid: c.uuid,
      ruolo: 'cerimoniere'
    };

    let result;
    if (isGAS) {
      result = await gasRun('salvaCerimoniere', datiAccount);
    } else if (isSupabase) {
      result = await window.ChierichSupabase.salvaCerimoniere(datiAccount);
    } else {
      const res = await apiFetch('/api/cerimonieri', { method: 'POST', body: datiAccount });
      result = await res.json();
    }
    if (!result?.success) {
      showToast(result?.message || 'Creazione account non riuscita');
      return;
    }

    const idx = state.chierichetti.findIndex(ch => ch.uuid === uuid);
    if (idx >= 0) {
      const prev = state.chierichetti[idx];
      const next = {
        ...prev,
        promosso: true,
        gruppo: '',
        cerimoniereTurno: false,
        attivo: true
      };
      state.chierichetti[idx] = next;
      saveData();
      const ok = await persistPersona({
        nome: next.nome,
        email: '',
        telefono: next.telefono || '',
        telefono2: next.telefono2 || '',
        telefonoChi: next.telefonoChi || '',
        telefono2Chi: next.telefono2Chi || '',
        ruolo: 'chierichetto',
        annoNascita: next.annoNascita,
        parrocchia: next.parrocchia,
        cerimoniereTurno: false,
        promosso: true,
        gruppo: '',
        attivo: true
      }, uuid);
      if (!ok) {
        state.chierichetti[idx] = prev;
        saveData();
        showToast('Account creato, ma aggiornamento anagrafica non riuscito — riprova');
        return;
      }
    }

    await loadCerimonieriAccounts(true);
    cancelPromoteChierichetto();
    anagraficaStatusFilter = 'promossi';
    syncAnagraficaStatusTabs();
    await renderChierichetti();
    populateGruppoSelects();
    showToast(result.needsEmailConfirm
      ? `${c.nome} promosso. Conferma l'email prima del primo accesso.`
      : `${c.nome} promosso a cerimoniere`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function renderChierichetti() {
  await loadCerimonieriAccounts();
  if (syncCurrentUserAdminFlag()) updateSidebarUser();
  if (promotingUuid && !isCurrentUserAdmin()) cancelPromoteChierichetto();
  syncAnagraficaStatusTabs();

  const anagChi = state.chierichetti.filter(isAnagraficaChierichetto);
  const nAttivi = anagChi.filter(c => isPersonaAttiva(c) && !isChierichettoPromosso(c)).length;
  const nEx = anagChi.filter(c => !isPersonaAttiva(c) && !isChierichettoPromosso(c)).length;
  const nPromossi = anagChi.filter(isChierichettoPromosso).length;
  const mobile = isAnagMobile();
  document.getElementById('tab-anag-chierichetti').textContent = `Chierichetti (${nAttivi})`;
  const nCerAttivi = cerimonieriAccounts.filter(isPersonaAttiva).length;
  document.getElementById('tab-anag-cerimonieri').textContent = mobile
    ? `Cer. e Don (${nCerAttivi})`
    : `Cerimonieri e Don (${nCerAttivi})`;

  const statusAttivi = document.getElementById('anag-status-attivi');
  const statusEx = document.getElementById('anag-status-ex');
  const statusPromossi = document.getElementById('anag-status-promossi');
  if (statusAttivi) statusAttivi.textContent = `Attivi (${nAttivi})`;
  if (statusEx) statusEx.textContent = `Ex (${nEx})`;
  if (statusPromossi) statusPromossi.textContent = mobile ? `Promossi (${nPromossi})` : `Ora cer. (${nPromossi})`;

  populateAnnoNascitaFilter();
  updateAnagraficaFormLabels();

  const filterAnno = document.getElementById('filter-anno-nascita').value;
  const filterParrocchia = document.getElementById('filter-parrocchia')?.value || '';
  const search = document.getElementById('search-chierichetti').value.toLowerCase();
  const statusFilter = anagraficaStatusFilter;

  const statusHint = document.getElementById('anag-status-hint');
  if (statusHint) {
    if (mobile && statusFilter !== 'attivi') {
      const label = statusFilter === 'ex' ? `Ex (${nEx})` : `Promossi (${nPromossi})`;
      statusHint.hidden = false;
      statusHint.innerHTML = `Vista <strong>${esc(label)}</strong> · <button type="button" onclick="setAnagraficaStatusFilter('attivi')">Torna agli attivi</button>`;
    } else {
      statusHint.hidden = true;
      statusHint.textContent = '';
    }
  }

  const filtered = anagChi.filter(c => {
    const promosso = isChierichettoPromosso(c);
    if (statusFilter === 'promossi') {
      if (!promosso) return false;
    } else if (statusFilter === 'ex') {
      if (promosso || isPersonaAttiva(c)) return false;
    } else {
      if (promosso || !isPersonaAttiva(c)) return false;
    }
    const matchAnno = !filterAnno || String(c.annoNascita) === filterAnno;
    const matchParrocchia = !filterParrocchia || c.parrocchia === filterParrocchia;
    const matchSearch = !search ||
      c.nome.toLowerCase().includes(search) ||
      (c.telefono || '').toLowerCase().includes(search) ||
      (c.telefono2 || '').toLowerCase().includes(search) ||
      (c.telefonoChi || '').toLowerCase().includes(search) ||
      (c.telefono2Chi || '').toLowerCase().includes(search);
    return matchAnno && matchParrocchia && matchSearch;
  });

  document.getElementById('chierichetti-count').textContent = filtered.length;

  const container = document.getElementById('chierichetti-list');
  if (!filtered.length) {
    const hasFilters = !!(search || filterAnno || filterParrocchia);
    if (statusFilter === 'promossi') {
      container.innerHTML = `<div class="anag-empty"><p>${hasFilters ? 'Nessun risultato con i filtri scelti.' : 'Nessun chierichetto promosso a cerimoniere.'}</p></div>`;
      syncAnagFab();
      return;
    }
    container.innerHTML = statusFilter !== 'ex'
      ? `<div class="anag-empty">
          <p>${hasFilters ? 'Nessun risultato con i filtri scelti.' : 'Nessun chierichetto attivo.'}</p>
          ${hasFilters
            ? `<button type="button" class="btn btn-secondary" onclick="document.getElementById('search-chierichetti').value='';document.getElementById('filter-anno-nascita').value='';document.getElementById('filter-parrocchia').value='';renderChierichetti()">Azzera filtri</button>`
            : `<button type="button" class="btn btn-primary" onclick="startNewChierichetto()">Aggiungi il primo</button>`}
        </div>`
      : `<div class="anag-empty"><p>Nessun ex. Segna un attivo come «ex» per spostarlo qui.</p></div>`;
    syncAnagFab();
    return;
  }

  const canPromote = isCurrentUserAdmin();
  container.innerHTML = filtered.map(c => {
    const attivo = isPersonaAttiva(c);
    const promosso = isChierichettoPromosso(c);
    const linkedAcc = cerimonieriAccounts.find(a => a.chierichettoUuid === c.uuid);
    const noGroup = !!(attivo && !promosso && !c.gruppo);
    const avatarClass = [
      promosso ? 'is-cer' : (!attivo ? 'is-ex' : ''),
      noGroup && mobile ? 'is-nogroup' : ''
    ].filter(Boolean).join(' ');
    const metaParts = [];
    if (c.parrocchia) metaParts.push(getParrocchiaLabel(c.parrocchia));
    if (promosso) metaParts.push(linkedAcc?.email || 'Ora cerimoniere');
    else if (!attivo) metaParts.push('Ex');
    else if (c.gruppo) metaParts.push(getGruppoLabel(c.gruppo));
    else metaParts.push('Senza gruppo');
    if (c.annoNascita && !mobile) metaParts.push(formatAnnoNascitaLabel(c.annoNascita));
    const metaLine = metaParts.join(' · ');
    const chips = [];
    if (c.parrocchia) chips.push(`<span class="anag-chip">${esc(getParrocchiaLabel(c.parrocchia))}</span>`);
    if (c.annoNascita) chips.push(`<span class="anag-chip">${esc(formatAnnoNascitaLabel(c.annoNascita))}</span>`);
    if (promosso) {
      chips.push('<span class="anag-chip gold">Ora cerimoniere</span>');
      if (linkedAcc?.email) chips.push(`<span class="anag-chip">${esc(linkedAcc.email)}</span>`);
    } else if (attivo) {
      chips.push(c.gruppo
        ? `<span class="anag-chip ok">${esc(getGruppoLabel(c.gruppo))}</span>`
        : '<span class="anag-chip warn">Senza gruppo</span>');
    } else {
      chips.push('<span class="anag-chip">Ex</span>');
    }
    const contacts = [];
    const pushTel = (num, chi) => {
      if (!num) return;
      const label = chi ? `${esc(chi)} · ` : '';
      contacts.push(`<a href="tel:${esc(num.replace(/\s/g, ''))}">${label}${esc(num)}</a>`);
    };
    pushTel(c.telefono, c.telefonoChi);
    pushTel(c.telefono2, c.telefono2Chi);
    const rowAction = `openAnagPersonDetail(${jsStr(c.uuid)})`;
    return `
    <div class="list-item anag-person${attivo && !promosso ? '' : ' is-ex'}" role="button" tabindex="0" onclick="${rowAction}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${rowAction}}">
      <div class="anag-avatar ${avatarClass}" aria-hidden="true">${esc(personInitials(c.nome))}</div>
      <div class="anag-person-body">
        <p class="list-item-title">${chierichettoNomeHtml(c)}</p>
        ${metaLine ? `<p class="anag-person-meta">${esc(metaLine)}</p>` : ''}
        <div class="anag-chips">${chips.join('')}</div>
        ${contacts.length ? `<div class="anag-contact">${contacts.join('')}</div>` : ''}
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-ghost btn-icon anag-person-menu-btn" title="Azioni" aria-label="Azioni per ${esc(c.nome)}" onclick="event.stopPropagation();openAnagPersonMenu(${jsStr(c.uuid)})">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
        </button>
      </div>
    </div>
  `;
  }).join('');
  syncAnagFab();
  syncAnagFiltersToggle();
  if (anagDetailUuid) {
    const stillThere = filtered.some(c => c.uuid === anagDetailUuid) ||
      state.chierichetti.some(c => c.uuid === anagDetailUuid && isAnagraficaChierichetto(c));
    if (stillThere) renderAnagPersonDetail(anagDetailUuid);
    else closeAnagPersonDetail();
  }
}

let anagDetailUuid = null;
let anagMenuUuid = null;
let anagMenuKind = 'chi';

function getChierichettoGruppiHistory(uuid) {
  ensureGruppiConfig();
  const items = [];
  const snaps = (state.gruppiConfig.cronologia || [])
    .filter(e => e.tipo === 'configurazione' && e.snapshot?.gruppi);

  snaps.forEach(entry => {
    const g = (entry.snapshot.gruppi || []).find(gr =>
      (gr.membri || []).some(m => m.uuid === uuid)
    );
    const senza = (entry.snapshot.senzaGruppo || []).some(m => m.uuid === uuid);
    if (!g && !senza) return;
    items.push({
      at: entry.at,
      gruppoNome: g ? g.nome : 'Senza gruppo',
      compagni: g
        ? (g.membri || []).filter(m => m.uuid !== uuid).map(m => m.nome)
        : []
    });
  });

  // Eventi legacy singoli (se presenti)
  (state.gruppiConfig.cronologia || []).forEach(entry => {
    if (!entry.personaNome) return;
    const chi = state.chierichetti.find(c => c.uuid === uuid);
    if (!chi || entry.personaNome !== chi.nome) return;
    if (!['membro_aggiunto', 'membro_spostato', 'membro_rimosso'].includes(entry.tipo)) return;
    items.push({
      at: entry.at,
      gruppoNome: entry.tipo === 'membro_rimosso'
        ? 'Rimosso'
        : (entry.gruppoNome || getGruppoLabel(entry.gruppoId) || 'Squadra'),
      compagni: [],
      legacy: true,
      detail: entry.tipo === 'membro_spostato' && entry.gruppoPrecedente
        ? `da ${entry.gruppoPrecedente}`
        : ''
    });
  });

  items.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return items;
}

function getChierichettoPresenzaHistory(uuid) {
  return state.presenze
    .filter(p => presenzaMatchesChierichetto(p, uuid))
    .sort((a, b) => {
      const d = String(b.data || '').localeCompare(String(a.data || ''));
      if (d) return d;
      return String(b.ora || '').localeCompare(String(a.ora || ''));
    });
}

function formatAnagDetailDate(isoOrDate) {
  if (!isoOrDate) return '—';
  const d = isoOrDate.includes('T')
    ? new Date(isoOrDate)
    : new Date(isoOrDate + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return esc(isoOrDate);
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isAnagDetailOpen() {
  const panel = document.getElementById('anag-person-detail');
  return !!(panel && !panel.hidden && !panel.classList.contains('is-collapsed'));
}

function openAnagPersonDetail(uuid) {
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c || !isAnagraficaChierichetto(c)) return;

  closeAnagPersonMenu();
  if (editingUuid || promotingUuid) {
    if (promotingUuid) cancelPromoteChierichetto();
    else cancelEdit();
  }
  setAnagFormOpen(false);
  setCerFormOpen(false);

  anagDetailUuid = uuid;
  const panel = document.getElementById('anag-person-detail');
  if (!panel) return;
  panel.hidden = false;
  panel.classList.remove('is-collapsed');
  document.body.classList.toggle('anag-sheet-open', isAnagMobile());
  document.body.classList.add('anag-detail-open');
  const overlay = document.getElementById('anag-form-overlay');
  if (overlay) overlay.hidden = !isAnagMobile();

  renderAnagPersonDetail(uuid);
  syncAnagFab();
  if (!isAnagMobile()) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function closeAnagPersonDetail() {
  anagDetailUuid = null;
  const panel = document.getElementById('anag-person-detail');
  if (panel) {
    panel.classList.add('is-collapsed');
    panel.hidden = true;
  }
  document.body.classList.remove('anag-detail-open');
  if (!isAnagSheetOpen()) {
    document.body.classList.remove('anag-sheet-open');
    const overlay = document.getElementById('anag-form-overlay');
    if (overlay) overlay.hidden = true;
  }
  syncAnagFab();
}

function renderAnagPersonDetail(uuid) {
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  const body = document.getElementById('anag-person-detail-body');
  const titleEl = document.getElementById('anag-detail-title');
  const subEl = document.getElementById('anag-detail-sub');
  if (!c || !body) return;

  const attivo = isPersonaAttiva(c);
  const promosso = isChierichettoPromosso(c);
  const linkedAcc = cerimonieriAccounts.find(a => a.chierichettoUuid === c.uuid);
  const statusLabel = promosso ? 'Ora cerimoniere' : (attivo ? 'Attivo' : 'Ex');
  const avatarClass = promosso ? 'is-cer' : (!attivo ? 'is-ex' : '');

  if (titleEl) titleEl.textContent = c.nome;
  if (subEl) {
    subEl.textContent = [
      c.parrocchia ? getParrocchiaLabel(c.parrocchia) : '',
      c.gruppo ? getGruppoLabel(c.gruppo) : (attivo && !promosso ? 'Senza gruppo' : ''),
      statusLabel
    ].filter(Boolean).join(' · ');
  }

  const contacts = [];
  const pushTel = (num, chi) => {
    if (!num) return;
    contacts.push({
      chi: chi || 'Genitore / tutore',
      num,
      href: 'tel:' + num.replace(/\s/g, '')
    });
  };
  pushTel(c.telefono, c.telefonoChi);
  pushTel(c.telefono2, c.telefono2Chi);

  const contactsHtml = contacts.length
    ? `<ul class="anag-detail-contacts">${contacts.map(t => `
        <li>
          <div>
            <p class="anag-detail-contact-chi">${esc(t.chi)}</p>
            <a class="anag-detail-contact-num" href="${esc(t.href)}">${esc(t.num)}</a>
          </div>
          <a class="btn btn-secondary btn-sm" href="${esc(t.href)}">Chiama</a>
        </li>
      `).join('')}</ul>`
    : '<p class="liturgy-meta">Nessun contatto genitori registrato</p>';

  const gruppiHist = getChierichettoGruppiHistory(uuid);
  const currentGruppoHtml = `
    <div class="anag-detail-current-gruppo">
      <span class="anag-chip ${c.gruppo ? 'ok' : 'warn'}">${esc(c.gruppo ? getGruppoLabel(c.gruppo) : 'Senza gruppo')}</span>
      <span class="liturgy-meta">assegnazione attuale</span>
    </div>
  `;
  const gruppiHtml = gruppiHist.length
    ? `<ol class="anag-detail-timeline">${gruppiHist.slice(0, 24).map(item => `
        <li>
          <time>${formatAnagDetailDate(item.at)}</time>
          <div>
            <p class="anag-detail-timeline-title">${esc(item.gruppoNome)}${item.detail ? ` · ${esc(item.detail)}` : ''}</p>
            ${item.compagni?.length
              ? `<p class="anag-detail-timeline-sub">con ${esc(item.compagni.join(', '))}</p>`
              : ''}
          </div>
        </li>
      `).join('')}</ol>`
    : '<p class="liturgy-meta">Nessuna cronologia gruppi ancora — compare dopo «Nuovi gruppi × nuovi turni» o «Aggiorna composizione»</p>';

  const presenze = getChierichettoPresenzaHistory(uuid);
  const nP = presenze.filter(p => p.stato === 'presente').length;
  const nA = presenze.filter(p => p.stato === 'assente').length;
  const tot = nP + nA;
  const rate = tot ? Math.round((nP / tot) * 100) + '%' : '—';
  const presenzeHtml = presenze.length
    ? `<ol class="anag-detail-timeline">${presenze.slice(0, 40).map(p => {
        const sede = p.sede ? (SEDI_LABEL[p.sede] || p.sede) : '';
        const when = [p.ora, sede].filter(Boolean).join(' · ');
        const badge = p.stato === 'presente' ? 'badge-presente' : 'badge-assente';
        const label = p.stato === 'presente' ? 'Presente' : 'Assente';
        return `
          <li>
            <time>${formatAnagDetailDate(p.data)}</time>
            <div class="anag-detail-presenza-row">
              <div>
                <p class="anag-detail-timeline-title">${esc(when || 'Giorno')}</p>
                ${p.motivo ? `<p class="anag-detail-timeline-sub">${esc(p.motivo)}</p>` : ''}
              </div>
              <span class="badge ${badge}">${label}</span>
            </div>
          </li>
        `;
      }).join('')}</ol>`
    : '<p class="liturgy-meta">Nessuna presenza o assenza registrata</p>';

  const canEdit = !promosso;
  const actionsHtml = `
    <div class="anag-detail-actions">
      ${canEdit ? `<button type="button" class="btn btn-primary" onclick="editChierichettoFromDetail(${jsStr(uuid)})">Modifica</button>` : ''}
      <button type="button" class="btn btn-secondary" onclick="openAnagPersonMenu(${jsStr(uuid)})">Altre azioni</button>
    </div>
  `;

  body.innerHTML = `
    <div class="anag-detail-hero">
      <div class="anag-avatar anag-detail-avatar ${avatarClass}" aria-hidden="true">${esc(personInitials(c.nome))}</div>
      <div>
        <p class="anag-detail-name">${chierichettoNomeHtml(c)}</p>
        <div class="anag-chips">
          ${c.parrocchia ? `<span class="anag-chip">${esc(getParrocchiaLabel(c.parrocchia))}</span>` : ''}
          ${c.annoNascita ? `<span class="anag-chip">${esc(formatAnnoNascitaLabel(c.annoNascita))}</span>` : ''}
          <span class="anag-chip${promosso ? ' gold' : ''}">${esc(statusLabel)}</span>
        </div>
        ${linkedAcc?.email ? `<p class="liturgy-meta" style="margin:8px 0 0">${esc(linkedAcc.email)}</p>` : ''}
      </div>
    </div>

    ${actionsHtml}

    <section class="anag-detail-section">
      <h4 class="anag-detail-section-title">Info</h4>
      <dl class="anag-detail-dl">
        <div><dt>Parrocchia</dt><dd>${c.parrocchia ? esc(getParrocchiaLabel(c.parrocchia)) : '—'}</dd></div>
        <div><dt>Anno di nascita</dt><dd>${c.annoNascita ? esc(formatAnnoNascitaLabel(c.annoNascita)) : '—'}</dd></div>
        <div><dt>Gruppo</dt><dd>${c.gruppo ? esc(getGruppoLabel(c.gruppo)) : 'Senza gruppo'}</dd></div>
        <div><dt>Stato</dt><dd>${esc(statusLabel)}</dd></div>
      </dl>
    </section>

    <section class="anag-detail-section">
      <h4 class="anag-detail-section-title">Contatti genitori</h4>
      ${contactsHtml}
    </section>

    <section class="anag-detail-section">
      <h4 class="anag-detail-section-title">Cronologia gruppi</h4>
      ${currentGruppoHtml}
      ${gruppiHtml}
    </section>

    <section class="anag-detail-section">
      <h4 class="anag-detail-section-title">Presenze e assenze</h4>
      <div class="anag-detail-stats" aria-label="Riepilogo">
        <div><span class="anag-detail-stat-val">${nP}</span><span class="anag-detail-stat-lbl">presenti</span></div>
        <div><span class="anag-detail-stat-val">${nA}</span><span class="anag-detail-stat-lbl">assenti</span></div>
        <div><span class="anag-detail-stat-val">${esc(rate)}</span><span class="anag-detail-stat-lbl">presenza</span></div>
      </div>
      ${presenzeHtml}
    </section>
  `;
}

function editChierichettoFromDetail(uuid) {
  closeAnagPersonDetail();
  editChierichetto(uuid);
}

async function openAnagPersonDetailFromGruppi(uuid) {
  const acc = (cerimonieriAccounts || []).find(a => a.uuid === uuid && isCerimoniereAccountStandalone(a));
  if (acc) {
    await showSection('anagrafica');
    switchAnagraficaTab('cerimoniere', true);
    editCerimoniere(uuid);
    return;
  }
  await showSection('anagrafica');
  switchAnagraficaTab('chierichetto', true);
  openAnagPersonDetail(uuid);
}

function closeAnagPersonMenu() {
  anagMenuUuid = null;
  anagMenuKind = 'chi';
  const sheet = document.getElementById('anag-action-sheet');
  const overlay = document.getElementById('anag-action-overlay');
  if (sheet) {
    sheet.classList.remove('is-open');
    sheet.hidden = true;
  }
  if (overlay) {
    overlay.classList.remove('is-open');
    overlay.hidden = true;
  }
}

function openAnagPersonMenu(uuid) {
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c) return;
  anagMenuUuid = uuid;
  anagMenuKind = 'chi';
  const attivo = isPersonaAttiva(c);
  const promosso = isChierichettoPromosso(c);
  const canPromote = isCurrentUserAdmin() && attivo && !promosso;
  const items = [];
  items.push({ action: 'detail', label: 'Vedi scheda', icon: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>' });
  if (!promosso) {
    items.push({ action: 'edit', label: 'Modifica', icon: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' });
  }
  if (canPromote) {
    items.push({ action: 'promote', label: 'Promuovi a cerimoniere', icon: '<path d="M12 19V5M5 12l7-7 7 7"/>' });
  }
  if (!promosso) {
    items.push(attivo
      ? { action: 'ex', label: 'Segna come ex', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>' }
      : { action: 'restore', label: 'Ripristina tra gli attivi', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>' });
    items.push({ action: 'delete', label: 'Elimina definitivamente', danger: true, icon: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' });
  }
  const title = document.getElementById('anag-action-title');
  const box = document.getElementById('anag-action-items');
  if (title) title.textContent = c.nome;
  if (box) {
    box.innerHTML = items.map(it => `
      <button type="button" class="anag-action-item${it.danger ? ' is-danger' : ''}" onclick="runAnagPersonAction(${jsStr(it.action)})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${it.icon}</svg>
        ${esc(it.label)}
      </button>
    `).join('') || '<p class="form-hint" style="padding:8px 12px">Nessuna azione disponibile</p>';
  }
  const sheet = document.getElementById('anag-action-sheet');
  const overlay = document.getElementById('anag-action-overlay');
  if (overlay) {
    overlay.hidden = false;
    overlay.classList.add('is-open');
  }
  if (sheet) {
    sheet.hidden = false;
    sheet.classList.add('is-open');
  }
}

async function runAnagPersonAction(action) {
  const uuid = anagMenuUuid;
  const kind = anagMenuKind;
  closeAnagPersonMenu();
  if (!uuid) return;
  if (kind === 'cer') {
    if (action === 'edit') editCerimoniere(uuid);
    else if (action === 'ex') await setCerimoniereAttivo(uuid, false);
    else if (action === 'restore') await setCerimoniereAttivo(uuid, true);
    else if (action === 'delete') await deleteCerimoniere(uuid);
    return;
  }
  if (action === 'detail') openAnagPersonDetail(uuid);
  else if (action === 'edit') editChierichetto(uuid);
  else if (action === 'promote') startPromoteChierichetto(uuid);
  else if (action === 'ex') await setChierichettoAttivo(uuid, false);
  else if (action === 'restore') await setChierichettoAttivo(uuid, true);
  else if (action === 'delete') await deletePersona(uuid);
}

function openAnagCerMenu(uuid) {
  const c = cerimonieriAccounts.find(ch => ch.uuid === uuid);
  if (!c) return;
  anagMenuUuid = uuid;
  anagMenuKind = 'cer';
  const attivo = isPersonaAttiva(c);
  const isSelf = currentUser?.uuid === c.uuid;
  const isAdminAcc = !!c.admin;
  const canManage = isCurrentUserAdmin();
  const items = [];
  if (canManage || isSelf) {
    items.push({ action: 'edit', label: 'Modifica', icon: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' });
  }
  if (canManage && !isSelf && !isAdminAcc) {
    items.push(attivo
      ? { action: 'ex', label: 'Segna come ex', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" y1="11" x2="16" y2="11"/>' }
      : { action: 'restore', label: 'Ripristina tra gli attivi', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>' });
    items.push({ action: 'delete', label: 'Elimina definitivamente', danger: true, icon: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' });
  }
  const title = document.getElementById('anag-action-title');
  const box = document.getElementById('anag-action-items');
  if (title) title.textContent = c.nome;
  if (box) {
    box.innerHTML = items.map(it => `
      <button type="button" class="anag-action-item${it.danger ? ' is-danger' : ''}" onclick="runAnagPersonAction(${jsStr(it.action)})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${it.icon}</svg>
        ${esc(it.label)}
      </button>
    `).join('') || '<p class="form-hint" style="padding:8px 12px">Nessuna azione disponibile</p>';
  }
  const sheet = document.getElementById('anag-action-sheet');
  const overlay = document.getElementById('anag-action-overlay');
  if (overlay) {
    overlay.hidden = false;
    overlay.classList.add('is-open');
  }
  if (sheet) {
    sheet.hidden = false;
    sheet.classList.add('is-open');
  }
}

async function loadCerimonieriAccounts(force) {
  if (!force && cerimonieriHydrated) return;
  try {
    if (isGAS) {
      cerimonieriAccounts = await gasRun('getCerimonieri') || [];
    } else if (isSupabase) {
      cerimonieriAccounts = await window.ChierichSupabase.getCerimonieri() || [];
    } else {
      const res = await apiFetch('/api/cerimonieri');
      cerimonieriAccounts = res.ok ? await res.json() : [];
    }
    cerimonieriAccounts = (cerimonieriAccounts || []).map(c => ({
      ...c,
      ruolo: c.ruolo === 'prete' ? 'prete' : 'cerimoniere',
      gruppo: c.gruppo || '',
      chierichettoUuid: c.chierichettoUuid || c.chierichetto_uuid || ''
    }));
    cerimonieriHydrated = true;
    if (syncCurrentUserAdminFlag()) updateSidebarUser();
  } catch {
    cerimonieriAccounts = cerimonieriAccounts || [];
  }
}

function onCerimoniereRuoloChange() {
  const ruolo = document.getElementById('cerimoniere-ruolo')?.value || 'cerimoniere';
  const isPrete = ruolo === 'prete';
  const nome = document.getElementById('cerimoniere-nome');
  if (nome && !editingCerimoniereUuid) {
    nome.placeholder = isPrete ? 'Don Mario Rossi' : 'Mario Rossi';
  }
}

function accountRuoloLabel(c) {
  const ruolo = c?.ruolo === 'prete' ? 'prete' : 'cerimoniere';
  return ACCOUNT_RUOLI_LABEL[ruolo] || 'Cerimoniere';
}

function hasCerimoniereLogin(c) {
  return !!(c && String(c.email || '').trim());
}

function renderCerimonieri() {
  if (syncCurrentUserAdminFlag()) updateSidebarUser();
  syncCerimonieriAdminUi();
  syncAnagraficaStatusTabs();
  const mobile = isAnagMobile();
  const nAttivi = cerimonieriAccounts.filter(isPersonaAttiva).length;
  const nEx = cerimonieriAccounts.length - nAttivi;
  const nPreti = cerimonieriAccounts.filter(c => isPersonaAttiva(c) && c.ruolo === 'prete').length;
  document.getElementById('tab-anag-cerimonieri').textContent = mobile
    ? `Cer. e Don (${nAttivi})`
    : `Cerimonieri e Don (${nAttivi})`;
  const cerAttiviBtn = document.getElementById('anag-cer-status-attivi');
  const cerExBtn = document.getElementById('anag-cer-status-ex');
  if (cerAttiviBtn) cerAttiviBtn.textContent = `Attivi (${nAttivi})`;
  if (cerExBtn) cerExBtn.textContent = `Ex (${nEx})`;
  const wantAttivi = anagraficaStatusFilter !== 'ex';
  const searchEl = document.getElementById('search-cerimonieri');
  if (searchEl) searchEl.placeholder = mobile ? 'Cerca…' : 'Cerca per nome o email…';
  const search = (searchEl?.value || '').toLowerCase();

  const statusHint = document.getElementById('anag-cer-status-hint');
  if (statusHint) {
    if (mobile && !wantAttivi) {
      statusHint.hidden = false;
      statusHint.innerHTML = `Vista <strong>Ex (${nEx})</strong> · <button type="button" onclick="setAnagraficaStatusFilter('attivi')">Torna agli attivi</button>`;
    } else {
      statusHint.hidden = true;
      statusHint.textContent = '';
    }
  }

  const filtered = cerimonieriAccounts.filter(c => {
    if (isPersonaAttiva(c) !== wantAttivi) return false;
    if (!search) return true;
    const ruoloLabel = accountRuoloLabel(c).toLowerCase();
    return (c.nome || '').toLowerCase().includes(search)
      || (c.email || '').toLowerCase().includes(search)
      || ruoloLabel.includes(search);
  });

  document.getElementById('cerimonieri-count').textContent = filtered.length;
  const countLabel = document.getElementById('cerimonieri-count-label');
  if (countLabel) {
    countLabel.textContent = wantAttivi
      ? (nPreti ? `attivi · ${nPreti} Don` : 'attivi')
      : 'ex';
  }

  const container = document.getElementById('cerimonieri-list');
  const canManage = isCurrentUserAdmin();
  if (!filtered.length) {
    container.innerHTML = wantAttivi
      ? `<div class="anag-empty"><p>Nessun account attivo.</p>${canManage ? `<button type="button" class="btn btn-primary" onclick="startNewCerimoniere()">Aggiungi il primo</button>` : ''}</div>`
      : '<div class="anag-empty"><p>Nessun ex. Segna un attivo come «ex» per spostarlo qui.</p></div>';
    syncAnagFab();
    syncCerFiltersToggle();
    return;
  }
  container.innerHTML = filtered.map(c => {
    const attivo = isPersonaAttiva(c);
    const isSelf = currentUser?.uuid === c.uuid;
    const isAdminAcc = !!c.admin;
    const isPrete = c.ruolo === 'prete';
    const parrocchia = c.parrocchia ? getParrocchiaLabel(c.parrocchia) : 'Entrambe';
    const linked = c.chierichettoUuid
      ? state.chierichetti.find(ch => ch.uuid === c.chierichettoUuid)
      : null;
    const chips = [
      `<span class="anag-chip${isPrete ? ' gold' : ''}">${esc(accountRuoloLabel(c))}</span>`,
      `<span class="anag-chip">${esc(parrocchia)}</span>`
    ];
    if (isAdminAcc) chips.push('<span class="anag-chip ok">Admin</span>');
    if (isSelf) chips.push('<span class="anag-chip">Tu</span>');
    if (!attivo) chips.push('<span class="anag-chip">Ex</span>');
    if (!hasCerimoniereLogin(c)) chips.push('<span class="anag-chip">Senza login</span>');
    if (!isPrete && linked) chips.push(`<span class="anag-chip">ex chierichetto → ${esc(linked.nome)}</span>`);
    const gruppoEff = linked?.gruppo || c.gruppo || '';
    if (gruppoEff) chips.push(`<span class="anag-chip ok">${esc(getGruppoLabel(gruppoEff))}</span>`);
    else if (attivo && isCerimoniereAccountStandalone(c)) chips.push('<span class="anag-chip warn">Senza gruppo</span>');
    const metaParts = mobile
      ? [accountRuoloLabel(c), hasCerimoniereLogin(c) ? c.email : 'Senza login'].filter(Boolean)
      : [accountRuoloLabel(c), parrocchia];
    if (isAdminAcc) metaParts.push('Admin');
    if (isSelf) metaParts.push('Tu');
    if (!attivo) metaParts.push('Ex');
    if (!hasCerimoniereLogin(c) && !mobile) metaParts.push('Senza login');
    if (gruppoEff && !mobile) metaParts.push(getGruppoLabel(gruppoEff));
    const metaLine = metaParts.join(' · ');
    const avatarClass = !attivo ? 'is-ex' : (isPrete ? 'is-cer' : '');
    const canRowEdit = canManage || isSelf;
    const rowAction = canRowEdit
      ? `editCerimoniere(${jsStr(c.uuid)})`
      : '';
    const showMenu = canManage || isSelf;
    const contactLine = hasCerimoniereLogin(c) ? esc(c.email) : 'Nessun accesso all’app';
    return `
      <div class="list-item anag-person${attivo ? '' : ' is-ex'}"${rowAction ? ` role="button" tabindex="0" onclick="${rowAction}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${rowAction}}"` : ''}>
        <div class="anag-avatar ${avatarClass}" aria-hidden="true">${esc(personInitials(c.nome))}</div>
        <div class="anag-person-body">
          <p class="list-item-title">${esc(c.nome)}</p>
          <p class="anag-person-meta">${esc(metaLine)}</p>
          <div class="anag-chips">${chips.join('')}</div>
          <div class="anag-contact"><span>${contactLine}</span></div>
        </div>
        ${showMenu ? `<div class="list-item-actions">
          <button type="button" class="btn btn-ghost btn-icon anag-person-menu-btn" title="Azioni" aria-label="Azioni per ${esc(c.nome)}" onclick="event.stopPropagation();openAnagCerMenu(${jsStr(c.uuid)})">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>
          </button>
        </div>` : ''}
      </div>
    `;
  }).join('');
  syncAnagFab();
  syncCerFiltersToggle();
}

function editCerimoniere(uuid, opts = {}) {
  const c = cerimonieriAccounts.find(x => x.uuid === uuid);
  if (!c) return;
  const asProfile = !!opts.asProfile || (currentUser?.uuid === uuid && !isCurrentUserAdmin());
  if (!isCurrentUserAdmin() && currentUser?.uuid !== uuid) {
    showToast('Puoi modificare solo il tuo profilo');
    return;
  }
  editingCerimoniereUuid = uuid;
  editingCerimoniereAsProfile = asProfile;
  document.getElementById('cerimoniere-ruolo').value = c.ruolo === 'prete' ? 'prete' : 'cerimoniere';
  document.getElementById('cerimoniere-ruolo').disabled = asProfile && !isCurrentUserAdmin();
  document.getElementById('cerimoniere-nome').value = c.nome;
  document.getElementById('cerimoniere-email').value = c.email;
  document.getElementById('cerimoniere-parrocchia').value = c.parrocchia || '';
  document.getElementById('cerimoniere-password').value = '';
  document.getElementById('cerimoniere-password').required = false;
  const pwd2 = document.getElementById('cerimoniere-password2');
  if (pwd2) pwd2.value = '';
  document.getElementById('edit-cerimoniere-uuid').value = uuid;

  const isSelf = currentUser?.uuid === uuid;
  const canAdmin = isCurrentUserAdmin();
  const hasLogin = hasCerimoniereLogin(c);
  const showAuthPwd = isSupabase && isSelf;
  const showActivateLogin = isSupabase && canAdmin && !isSelf && !hasLogin;
  const loginHint = document.getElementById('cerimoniere-login-hint');

  document.getElementById('cerimoniere-password-wrap').style.display =
    (showAuthPwd || showActivateLogin || (!uuid && !isGAS)) ? '' : (isGAS ? 'none' : '');
  if (isSelf && isSupabase) {
    document.getElementById('cerimoniere-password-wrap').style.display = '';
  }
  document.getElementById('cerimoniere-password2-wrap').style.display = showAuthPwd ? '' : 'none';
  document.getElementById('cerimoniere-profile-hint').style.display = showAuthPwd ? '' : 'none';
  if (loginHint) {
    loginHint.style.display = showActivateLogin ? '' : 'none';
    if (showActivateLogin) {
      loginHint.textContent = 'Ancora senza accesso: inserisci email e password per abilitare il login.';
    }
  }
  const emailPending = document.getElementById('cerimoniere-email-pending');
  if (emailPending && !opts.keepEmailPending) {
    emailPending.style.display = 'none';
    emailPending.textContent = '';
  }

  // Solo modalità profilo esplicita (o non-admin su sé): form ridotto.
  // Admin che apre sé stesso da Accessi → form completo come per gli altri.
  if (asProfile) {
    document.getElementById('form-cerimoniere-title').textContent = 'Il mio profilo';
    document.getElementById('form-cerimoniere-sub').textContent = 'Nome, email e password di accesso';
    document.getElementById('cerimoniere-password-label').textContent = 'Nuova password (opzionale)';
    document.getElementById('btn-save-cerimoniere').textContent = 'Salva profilo';
    document.getElementById('btn-cancel-cerimoniere-edit').style.display = canAdmin ? 'block' : 'none';
  } else {
    document.getElementById('form-cerimoniere-title').textContent = c.ruolo === 'prete' ? 'Modifica Don' : 'Modifica cerimoniere';
    document.getElementById('form-cerimoniere-sub').textContent = isSelf
      ? `${c.nome} (tu)`
      : (hasLogin ? c.nome : `${c.nome} · senza login`);
    document.getElementById('cerimoniere-password-label').textContent = showActivateLogin
      ? 'Password (per attivare il login)'
      : 'Nuova password (opzionale)';
    document.getElementById('btn-save-cerimoniere').textContent = showActivateLogin ? 'Attiva accesso' : 'Aggiorna';
    document.getElementById('btn-cancel-cerimoniere-edit').style.display = 'block';
    // Admin che modifica un altro già con login: niente cambio password Auth da qui
    if (isSupabase && !isSelf && hasLogin) {
      document.getElementById('cerimoniere-password-wrap').style.display = 'none';
      document.getElementById('cerimoniere-password2-wrap').style.display = 'none';
      document.getElementById('cerimoniere-profile-hint').style.display = 'none';
    }
  }
  onCerimoniereRuoloChange();
  setCerFormOpen(true);
  if (!isAnagMobile()) {
    document.getElementById('cerimoniere-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('cerimoniere-nome')?.focus();
}

function cancelCerimoniereEdit() {
  editingCerimoniereUuid = null;
  editingCerimoniereAsProfile = false;
  document.getElementById('cerimoniereForm').reset();
  document.getElementById('edit-cerimoniere-uuid').value = '';
  document.getElementById('cerimoniere-ruolo').value = 'cerimoniere';
  document.getElementById('cerimoniere-ruolo').disabled = false;
  document.getElementById('cerimoniere-password2-wrap').style.display = 'none';
  document.getElementById('cerimoniere-profile-hint').style.display = 'none';
  const loginHint = document.getElementById('cerimoniere-login-hint');
  if (loginHint) {
    loginHint.style.display = '';
    loginHint.textContent = 'Puoi salvare solo nome e ruolo senza email/password: la persona non potrà accedere finché non le imposti.';
  }
  const emailPending = document.getElementById('cerimoniere-email-pending');
  if (emailPending) {
    emailPending.style.display = 'none';
    emailPending.textContent = '';
  }

  if (!isCurrentUserAdmin()) {
    setCerFormOpen(false);
    return;
  }

  document.getElementById('form-cerimoniere-title').textContent = 'Nuovo accesso';
  document.getElementById('form-cerimoniere-sub').textContent = isGAS
    ? 'Autorizzano l\'accesso con Account Google — cerimonieri e sacerdoti'
    : isSupabase
      ? 'Anagrafica subito; email e password solo se vuoi abilitare il login'
      : 'Login app per cerimonieri e sacerdoti (Don)';
  document.getElementById('cerimoniere-password-label').textContent = 'Password (opzionale)';
  document.getElementById('cerimoniere-password').required = false;
  document.getElementById('cerimoniere-password-wrap').style.display = isGAS ? 'none' : '';
  document.getElementById('btn-save-cerimoniere').textContent = 'Salva';
  document.getElementById('btn-cancel-cerimoniere-edit').style.display = 'none';
  onCerimoniereRuoloChange();
  if (isAnagMobile()) setCerFormOpen(false);
}

async function handleCerimoniereFormSubmit(e) {
  e.preventDefault();
  const uuid = document.getElementById('edit-cerimoniere-uuid').value;
  const isSelf = !!(uuid && currentUser?.uuid === uuid);
  const canAdmin = isCurrentUserAdmin();

  if ((isGAS || isSupabase) && !canAdmin && !isSelf) {
    showToast('Puoi modificare solo il tuo profilo');
    return;
  }
  if (!uuid && !canAdmin) {
    showToast('Solo l\'admin può creare nuovi accessi');
    return;
  }

  const ruolo = document.getElementById('cerimoniere-ruolo').value === 'prete' ? 'prete' : 'cerimoniere';
  const password = document.getElementById('cerimoniere-password').value;
  const password2 = document.getElementById('cerimoniere-password2')?.value || '';
  const existingLink = uuid
    ? (cerimonieriAccounts.find(x => x.uuid === uuid)?.chierichettoUuid || '')
    : '';
  const dati = {
    nome: document.getElementById('cerimoniere-nome').value.trim(),
    email: document.getElementById('cerimoniere-email').value.trim(),
    parrocchia: document.getElementById('cerimoniere-parrocchia').value,
    chierichettoUuid: existingLink,
    ruolo,
    password
  };

  if (isSelf && isSupabase && password) {
    if (password.length < 6) {
      showToast('Password di almeno 6 caratteri');
      return;
    }
    if (password !== password2) {
      showToast('Le password non coincidono');
      return;
    }
  }

  const target = uuid ? cerimonieriAccounts.find(x => x.uuid === uuid) : null;
  const targetHasLogin = hasCerimoniereLogin(target);
  const wantsLogin = !!(dati.email || password);

  if (!uuid && !isGAS && wantsLogin) {
    if (!dati.email) {
      showToast('Email obbligatoria per abilitare il login');
      return;
    }
    if (!dati.password || dati.password.length < 6) {
      showToast('Password di almeno 6 caratteri per abilitare il login');
      return;
    }
  }

  // Admin che attiva login su record senza credenziali
  if (uuid && isSupabase && !isSelf && !targetHasLogin && wantsLogin) {
    if (!dati.email) {
      showToast('Email obbligatoria per abilitare il login');
      return;
    }
    if (!password || password.length < 6) {
      showToast('Password di almeno 6 caratteri per abilitare il login');
      return;
    }
  }

  if (isGAS) delete dati.password;
  // Admin che aggiorna un altro già con login: niente password Auth
  if (uuid && isSupabase && !isSelf && targetHasLogin) delete dati.password;

  let result;
  // Profilo self: non-admin sempre; admin solo se ha aperto «Il mio profilo»
  const useProfileApi = isSelf && isSupabase && (editingCerimoniereAsProfile || !canAdmin);

  if (useProfileApi) {
    result = await window.ChierichSupabase.aggiornaIlMioProfilo({
      nome: dati.nome,
      email: dati.email,
      parrocchia: dati.parrocchia,
      chierichettoUuid: canAdmin ? dati.chierichettoUuid : undefined,
      password: password || undefined
    });
    if (result.success && result.user) {
      saveSession(authToken || 'supabase', result.user);
      updateSidebarUser();
    }
  } else if (isSelf && isSupabase && canAdmin) {
    // Admin su sé stesso da Accessi: anagrafica completa + Auth se email/password
    let authResult = null;
    const needsAuth = !!(password || (dati.email && dati.email.toLowerCase() !== String(currentUser.email || '').toLowerCase()));
    if (needsAuth) {
      authResult = await window.ChierichSupabase.aggiornaIlMioProfilo({
        nome: dati.nome,
        email: dati.email,
        parrocchia: dati.parrocchia,
        chierichettoUuid: dati.chierichettoUuid,
        password: password || undefined
      });
      if (!authResult.success) {
        showToast(authResult.message || 'Errore salvataggio');
        return;
      }
      if (authResult.user) {
        saveSession(authToken || 'supabase', authResult.user);
        updateSidebarUser();
      }
    }
    const rowResult = await window.ChierichSupabase.aggiornaCerimoniere(uuid, {
      nome: dati.nome,
      email: dati.email,
      parrocchia: dati.parrocchia,
      chierichettoUuid: dati.chierichettoUuid,
      ruolo: dati.ruolo
    });
    if (!rowResult.success) {
      showToast(rowResult.message || 'Errore salvataggio');
      return;
    }
    result = {
      success: true,
      needsEmailConfirm: !!authResult?.needsEmailConfirm,
      user: authResult?.user,
      message: authResult?.message || 'Account aggiornato'
    };
  } else if (isGAS) {
    result = uuid
      ? await gasRun('aggiornaCerimoniere', uuid, dati)
      : await gasRun('salvaCerimoniere', dati);
  } else if (isSupabase) {
    result = uuid
      ? await window.ChierichSupabase.aggiornaCerimoniere(uuid, dati)
      : await window.ChierichSupabase.salvaCerimoniere(dati);
  } else {
    const res = uuid
      ? await apiFetch(`/api/cerimonieri/${uuid}`, { method: 'PUT', body: dati })
      : await apiFetch('/api/cerimonieri', { method: 'POST', body: dati });
    result = await res.json();
  }

  if (!result.success) {
    showToast(result.message || 'Errore salvataggio');
    return;
  }

  const pendingEl = document.getElementById('cerimoniere-email-pending');
  if (result.needsEmailConfirm && pendingEl) {
    pendingEl.style.display = '';
    pendingEl.textContent = result.message
      || 'Controlla la nuova email e conferma il link. Finché non confermi, l\'accesso resta con l\'email precedente.';
    showToast('Controlla la nuova email per confermare');
    await loadCerimonieriAccounts(true);
    renderCerimonieri();
    if (anagraficaTab === 'chierichetto') renderChierichetti();
    return;
  }
  if (pendingEl) {
    pendingEl.style.display = 'none';
    pendingEl.textContent = '';
  }

  showToast(result.message || (uuid ? (isSelf ? 'Profilo aggiornato' : 'Account aggiornato') : (ruolo === 'prete' ? 'Account Don creato' : 'Account creato')));
  if (canAdmin) cancelCerimoniereEdit();
  else if (isAnagMobile()) setCerFormOpen(false);
  await loadCerimonieriAccounts(true);
  renderCerimonieri();
  if (anagraficaTab === 'chierichetto') renderChierichetti();
}

async function deleteCerimoniere(uuid) {
  if (!requireAdminAction('Solo l\'admin può eliminare gli accessi')) return;
  const c = cerimonieriAccounts.find(x => x.uuid === uuid);
  if (!c || !confirm(`Eliminare l'account di ${c.nome}?`)) return;
  let result;
  if (isGAS) result = await gasRun('eliminaCerimoniere', uuid);
  else if (isSupabase) result = await window.ChierichSupabase.eliminaCerimoniere(uuid);
  else {
    const res = await apiFetch(`/api/cerimonieri/${uuid}`, { method: 'DELETE' });
    result = await res.json();
  }
  if (!result.success) {
    showToast(result.message || 'Eliminazione non riuscita');
    return;
  }
  showToast('Account eliminato');
  await loadCerimonieriAccounts(true);
  renderCerimonieri();
  if (anagraficaTab === 'chierichetto') renderChierichetti();
}

function editChierichetto(uuid) {
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c || !isChierichettoPersona(c)) return;
  if (isChierichettoPromosso(c)) {
    showToast('I promossi si gestiscono da Cerimonieri e Don');
    return;
  }

  closeAnagPersonDetail();
  cancelPromoteChierichetto();
  switchAnagraficaTab('chierichetto', true);

  editingUuid = uuid;
  document.getElementById('nome').value = c.nome;
  populateAnnoNascitaSelect(c.annoNascita || '');
  document.getElementById('parrocchia').value = c.parrocchia || '';
  document.getElementById('telefono').value = c.telefono || '';
  document.getElementById('telefono2').value = c.telefono2 || '';
  document.getElementById('telefono-chi').value = c.telefonoChi || '';
  document.getElementById('telefono2-chi').value = c.telefono2Chi || '';
  document.getElementById('edit-uuid').value = uuid;
  document.getElementById('persona-ruolo').value = getRuoloPersona(c);

  setChierichettoFormMode('create');
  document.getElementById('form-chierichetto-title').textContent = 'Modifica chierichetto';
  document.getElementById('form-chierichetto-sub').textContent = c.nome;
  document.getElementById('btn-save-chierichetto').textContent = 'Aggiorna';
  document.getElementById('btn-cancel-edit').style.display = 'block';

  syncAnagTel2Visibility(c);
  setAnagFormOpen(true);
  if (!isAnagMobile()) {
    document.getElementById('chierichetto-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  document.getElementById('nome').focus();
}

async function deletePersona(uuid) {
  const c = state.chierichetti.find(ch => ch.uuid === uuid);
  if (!c) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentPres = state.presenze.filter(p =>
    (p.chierichettoUuid === uuid || p.nome === c.nome) &&
    new Date(p.data + 'T12:00:00') >= thirtyDaysAgo
  );

  if (recentPres.length) {
    if (!confirm(`${c.nome} ha ${recentPres.length} presenze negli ultimi 30 giorni. Eliminarlo comunque?`)) return;
  } else if (!confirm(`Eliminare ${c.nome}?`)) {
    return;
  }

  const ok = await persistDeletePersona(uuid);
  if (!ok) return;

  state.chierichetti = state.chierichetti.filter(x => x.uuid !== uuid);
  saveData();
  if (editingUuid === uuid) cancelEdit();
  renderChierichetti();
  populateGruppoSelects();
  showToast(`${c.nome} eliminato`);
}

function cancelEdit() {
  editingUuid = null;
  document.getElementById('chierichettoForm').reset();
  populateAnnoNascitaSelect();
  document.getElementById('edit-uuid').value = '';
  document.getElementById('persona-ruolo').value = anagraficaTab;
  setChierichettoFormMode('create');
  syncAnagTel2Visibility(null);
  updateAnagraficaFormLabels();
  document.getElementById('btn-save-chierichetto').textContent = 'Salva';
  document.getElementById('btn-cancel-edit').style.display = 'none';
  if (isAnagMobile() && !promotingUuid) setAnagFormOpen(false);
}

// ── Gruppi ──────────────────────────────────────────────────
async function renderGruppi() {
  await loadCerimonieriAccounts();
  syncGruppiAdminUi();
  updateGruppiPanelMeta();
  renderGruppiVetrinaList();
  renderGruppiGestioneList();
  renderGruppiCronologia();
  updateNuovoGruppoFormDefaults();
  syncNuovoGruppoFormDay();
  syncGruppiFab();
}

function getGruppiAttivi() {
  const slotCount = getTurniSlot().length;
  return getGruppiOrdered().slice(0, slotCount);
}

function buildGruppoVetrinaCardHtml(g) {
  const members = getChierichettiInGruppo(g.id);
  const cerimonieri = members.filter(isAppelloCerimoniere);
  const chierichetti = members.filter(c => !isAppelloCerimoniere(c));
  const current = getCurrentWeekAssignmentForGruppo(g.id);
  const assignments = getTurniAssignmentsForGruppo(g.id);
  const currentWeek = current?.rotationWeek;

  let servizioHtml = '';
  if (isRotazioneAttiva()) {
    if (current) {
      servizioHtml += `
        <div class="gruppo-vetrina-hero">
          <span class="gruppo-vetrina-hero-label">Questa settimana</span>
          <p class="gruppo-vetrina-hero-messa">${esc(formatMessaServizioLabel(current.slot.turnoNum))}</p>
          <p class="gruppo-vetrina-hero-slot">${esc(formatTurnoSlotBrief(current.slot))}</p>
        </div>
      `;
    }
    if (assignments.length) {
      servizioHtml += `
        <div class="gruppo-vetrina-rotazione">
          <p class="gruppo-vetrina-rotazione-title">Ciclo rotazione</p>
          ${assignments.map(({ slot, rotationWeek }) => `
            <div class="gruppo-vetrina-rotazione-row${rotationWeek === currentWeek ? ' is-current' : ''}">
              <span class="gruppo-vetrina-rotazione-turno">${esc(formatRotazioneTurnoLabel(rotationWeek + 1))}</span>
              <span class="gruppo-vetrina-rotazione-messa">${esc(formatMessaServizioShort(slot.turnoNum))}</span>
              <span class="gruppo-vetrina-rotazione-slot">${esc(formatTurnoSlotBrief(slot))}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  } else {
    const turnoNum = getFixedTurnoNumForGruppo(g.id);
    const slot = getTurniSlot().find(s => s.turnoNum === turnoNum);
    if (slot) {
      servizioHtml = `
        <div class="gruppo-vetrina-hero">
          <span class="gruppo-vetrina-hero-label">Servizio fisso</span>
          <p class="gruppo-vetrina-hero-messa">${esc(formatMessaServizioLabel(turnoNum))}</p>
          <p class="gruppo-vetrina-hero-slot">${esc(formatTurnoSlotBrief(slot))}</p>
        </div>
      `;
    }
  }

  const sortByNome = list => list.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  let membersHtml = '';
  if (!members.length) {
    membersHtml = '<p class="gruppo-vetrina-empty">Squadra vuota</p>';
  } else {
    const cerHtml = cerimonieri.length ? `
      <div class="gruppo-vetrina-members-group">
        <p class="gruppo-vetrina-members-label">Cerimonieri</p>
        <div class="gruppo-member-chips">
          ${sortByNome(cerimonieri).map(c => `
            <span class="gruppo-member-chip is-cerimoniere is-readonly">${chierichettoNomeHtml(c)}</span>
          `).join('')}
        </div>
      </div>
    ` : '';
    const chiHtml = chierichetti.length ? `
      <div class="gruppo-vetrina-members-group">
        <p class="gruppo-vetrina-members-label">${cerimonieri.length ? 'Chierichetti' : 'Squadra'}</p>
        <div class="gruppo-member-chips">
          ${sortByNome(chierichetti).map(c => `
            <span class="gruppo-member-chip is-readonly">${chierichettoNomeHtml(c)}</span>
          `).join('')}
        </div>
      </div>
    ` : '';
    membersHtml = `<div class="gruppo-vetrina-members">${cerHtml}${chiHtml}</div>`;
  }

  return `
    <article class="gruppo-vetrina-card">
      <header class="gruppo-vetrina-head">
        <h4 class="gruppo-vetrina-title">${esc(g.nome)}</h4>
        <p class="gruppo-vetrina-meta">${members.length} in squadra${cerimonieri.length ? ' · ' + cerimonieri.length + ' cerim.' : ''}</p>
      </header>
      ${servizioHtml}
      ${membersHtml}
    </article>
  `;
}

function buildGruppoCardHtml(g) {
  const members = getChierichettiInGruppo(g.id);
  const mobile = isPhoneShell();
  const servizioMeta = formatGruppoServizioMeta(g.id, { compact: mobile });
  const nCer = members.filter(isAppelloCerimoniere).length;
  const canManage = isCurrentUserAdmin();

  const membersHtml = members.length
    ? members.map(c => `
      <button type="button" class="gruppo-member-chip is-readonly is-link${isAppelloCerimoniere(c) ? ' is-cerimoniere' : ''}" onclick="openAnagPersonDetailFromGruppi('${esc(c.uuid)}')">
        ${chierichettoNomeHtml(c)}
      </button>
    `).join('')
    : '<span class="liturgy-meta">Squadra vuota</span>';

  return `
    <div class="gruppo-squadra-card">
      <div class="gruppo-squadra-head">
        <div>
          <p class="config-item-title">${esc(g.nome)}</p>
          ${servizioMeta ? `<p class="config-item-meta gruppo-servizio-meta">${esc(servizioMeta)}</p>` : ''}
          <p class="config-item-meta">${nCer ? nCer + ' cerim. · ' : ''}${members.length} in squadra</p>
        </div>
        <div class="config-item-actions">
          ${canManage ? `<button type="button" class="btn btn-ghost btn-icon" title="Aggiorna composizione" aria-label="Aggiorna composizione" onclick="openGruppiEdit('aggiorna')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>` : ''}
        </div>
      </div>
      <div class="gruppo-member-chips">${membersHtml}</div>
    </div>
  `;
}

function renderGruppiVetrinaList() {
  const container = document.getElementById('gruppi-vetrina-list');
  if (!container) return;
  const gruppi = getGruppiAttivi();

  if (!gruppi.length) {
    container.innerHTML = isCurrentUserAdmin()
      ? '<p class="empty-state">Nessuna squadra configurata — vai su Gestione gruppi per crearne una</p>'
      : '<p class="empty-state">Nessuna squadra configurata — chiedi all\'admin di crearne una in Gestione gruppi</p>';
    return;
  }

  container.innerHTML = gruppi.map(g => buildGruppoVetrinaCardHtml(g)).join('');
}

function renderMesseDomenicaliList() {
  const container = document.getElementById('messe-domenicali-list');
  if (!container) return;
  const messe = getMesseDomenicali();
  const prossimaDom = getProssimeDomeniche(1)[0];

  if (!messe.length) {
    container.innerHTML = '<p class="empty-state">Nessuna celebrazione — aggiungine una dal pannello a destra</p>';
    return;
  }

  const groups = [
    { key: -1, label: 'Sabato (vigilia)' },
    { key: 0, label: 'Domenica' }
  ];

  container.innerHTML = groups.map(g => {
    const items = messe.filter(m => m.dayOffset === g.key);
    if (!items.length) return '';
    return `
      <h4 class="turni-messe-group-title">${esc(g.label)}</h4>
      <div class="config-list">
        ${items.map(m => renderMessaDomenicaleItem(m, prossimaDom)).join('')}
      </div>
    `;
  }).join('');
}

function renderMessaDomenicaleItem(m, prossimaDom) {
  const canManage = isCurrentUserAdmin();
  const tipoBadge = m.conTurno
    ? `<span class="messa-tipo-badge con-turno">Con squadra${m.turnoNum ? ' · ' + formatMessaServizioShort(m.turnoNum) : ''}</span>`
    : '<span class="messa-tipo-badge libera">Libera</span>';
  const gruppoId = m.conTurno && prossimaDom && m.turnoNum
    ? getGruppoIdForTurno(m.turnoNum, prossimaDom)
    : null;
  const gruppoOra = gruppoId ? getGruppoLabel(gruppoId) : null;
  const metaExtra = gruppoOra
    ? 'Prossimo: ' + esc(gruppoOra)
    : (m.conTurno
      ? (isRotazioneAttiva() && prossimaDom && !isDomenicaInFinestraRotazione(prossimaDom)
        ? 'Prossima domenica: libera (prima della finestra)'
        : 'Messa di servizio')
      : 'Senza servizio d\'altare');
  const actions = canManage ? `
      <div class="config-item-actions">
        <button type="button" class="btn btn-ghost btn-icon" title="${m.conTurno ? 'Segna come libera' : 'Segna con squadra'}" onclick="toggleMessaDomenicaleTurno('${esc(m.id)}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
        </button>
        <button type="button" class="btn btn-ghost btn-icon" title="Modifica" onclick="editMessaDomenicale('${esc(m.id)}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="btn btn-danger btn-icon" title="Elimina" onclick="deleteMessaDomenicale('${esc(m.id)}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>` : '';
  return `
    <div class="config-item">
      <div class="config-item-main">
        <p class="config-item-title">${esc(m.ora)} · ${esc(SEDI_LABEL[m.sede] || m.sede)} ${tipoBadge}</p>
        <p class="config-item-meta">${m.vigilia ? 'Vigilia · ' : ''}${metaExtra}</p>
      </div>
      ${actions}
    </div>
  `;
}

function setTurniFormMode(editing) {
  const title = document.getElementById('turni-form-title');
  const hint = document.getElementById('turni-form-hint');
  const btn = document.getElementById('btn-save-messa-domenicale');
  const cancel = document.getElementById('btn-cancel-messa-domenicale');
  if (title) title.textContent = editing ? 'Modifica celebrazione' : 'Nuova celebrazione';
  if (hint) hint.textContent = editing ? 'Aggiorna giorno, ora, sede o tipo messa' : 'Aggiungi una messa al turno settimanale';
  if (btn) btn.textContent = editing ? 'Salva modifiche' : 'Aggiungi celebrazione';
  if (cancel) cancel.style.display = editing ? 'inline-flex' : 'none';
  syncMessaDomenicaleFormDay();
}

function syncMessaDomenicaleFormDay() {
  const dayEl = document.getElementById('messa-domenicale-day');
  const vigiliaWrap = document.getElementById('messa-domenicale-vigilia-wrap');
  const vigilia = document.getElementById('messa-domenicale-vigilia');
  if (!dayEl || !vigiliaWrap) return;
  const isSabato = parseInt(dayEl.value, 10) === -1;
  vigiliaWrap.hidden = !isSabato;
  if (!isSabato && vigilia) vigilia.checked = false;
}

function formatRotazioneDateShort(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function formatRotazioneDateLong(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function getRotazioneStatusCopy(rot = null) {
  const r = rot || getRotazioneConfig();
  const phase = getRotazionePhase(r);
  const inizioLabel = formatRotazioneDateLong(r.inizioFinestra);
  const fineLabel = formatRotazioneDateLong(r.fineFinestra);

  if (phase === 'active') {
    return {
      phase,
      badge: 'Rotazione attiva',
      badgeClass: 'rotazione-status aperta',
      text: fineLabel
        ? `Finestra aperta dal ${inizioLabel} al ${fineLabel} (sab 12:00). Ogni sabato i gruppi avanzano di uno slot.`
        : `Finestra aperta dal ${inizioLabel} ore 12:00, senza data di fine. Ogni sabato i gruppi avanzano di uno slot.`
    };
  }
  if (phase === 'scheduled') {
    return {
      phase,
      badge: 'Programmata',
      badgeClass: 'rotazione-status programmata',
      text: fineLabel
        ? `Rotazione programmata dal ${inizioLabel} al ${fineLabel}. Prima dell’inizio le messe di servizio restano libere.`
        : `Rotazione programmata dal ${inizioLabel}. Prima dell’inizio le messe di servizio restano libere.`
    };
  }
  if (phase === 'expired') {
    return {
      phase,
      badge: 'Finestra scaduta',
      badgeClass: 'rotazione-status scaduta',
      text: `La finestra è terminata il ${fineLabel || inizioLabel}. Dopo la fine vale l’assegnazione fissa. Chiudila da Gestione per archiviarla.`
    };
  }
  return {
    phase: 'off',
    badge: 'Rotazione non attiva',
    badgeClass: 'rotazione-status chiusa',
    text: 'Nessuna finestra attiva: vale l’assegnazione fissa (messa 1→Gruppo 1, …). Apri una finestra da Gestione per far ruotare i gruppi.'
  };
}

function applyRotazioneStatusTo(badgeId, textId) {
  const copy = getRotazioneStatusCopy();
  const badge = document.getElementById(badgeId);
  const text = document.getElementById(textId);
  if (badge) {
    badge.textContent = copy.badge;
    badge.className = copy.badgeClass;
  }
  if (text) text.textContent = copy.text;
  return copy;
}

function renderRotazioneAnteprima() {
  applyRotazioneStatusTo('rotazione-anteprima-badge', 'rotazione-anteprima-text');
  renderRotazionePreview();
}

function renderRotazioneGestione() {
  const rot = getRotazioneConfig();
  const inizioInput = document.getElementById('rotazione-inizio');
  const fineInput = document.getElementById('rotazione-fine');
  const fineOpen = document.getElementById('rotazione-fine-open');
  const btnSalva = document.getElementById('btn-salva-rotazione');
  const btnChiudi = document.getElementById('btn-chiudi-rotazione');
  const card = document.getElementById('rotazione-window-card');
  const presets = document.getElementById('rotazione-presets');
  const datesRow = document.querySelector('.rotazione-dates');

  const copy = applyRotazioneStatusTo('rotazione-status-badge', 'rotazione-status-text');
  const attiva = isRotazioneAttiva();

  if (inizioInput && document.activeElement !== inizioInput) {
    inizioInput.value = rot.inizioFinestra || getSabatoRotazioneDefault();
  }
  if (fineOpen && document.activeElement !== fineOpen) {
    fineOpen.checked = !rot.fineFinestra;
  }
  if (fineInput) {
    const openEnded = fineOpen ? fineOpen.checked : !rot.fineFinestra;
    fineInput.disabled = openEnded || attiva;
    if (document.activeElement !== fineInput) {
      fineInput.value = rot.fineFinestra || '';
    }
  }
  if (inizioInput) inizioInput.disabled = attiva;
  if (fineOpen) fineOpen.disabled = attiva;
  if (presets) presets.hidden = attiva;
  if (datesRow) datesRow.hidden = attiva;

  if (btnSalva) {
    btnSalva.hidden = attiva;
    btnSalva.textContent = 'Apri finestra';
  }
  if (btnChiudi) btnChiudi.hidden = !attiva;
  if (card) {
    card.classList.toggle('is-active', copy.phase === 'active');
    card.classList.toggle('is-scheduled', copy.phase === 'scheduled');
    card.classList.toggle('is-expired', copy.phase === 'expired');
    card.classList.toggle('is-closed-form', !attiva);
  }

  if (!attiva) {
    const statusText = document.getElementById('rotazione-status-text');
    if (statusText) {
      statusText.textContent =
        'Imposta inizio e (opzionale) fine, poi apri la finestra. L’anteprima turnistica si aggiorna subito dopo.';
    }
  }
}

function renderRotazioneCronologia() {
  const el = document.getElementById('rotazione-cronologia');
  if (!el) return;

  const rot = getRotazioneConfig();
  const storico = rot.storicoFinestre || [];
  const items = [];

  if (isRotazioneAttiva() && rot.inizioFinestra) {
    const phase = getRotazionePhase(rot);
    const phaseLabel = phase === 'scheduled' ? 'Programmata' : phase === 'expired' ? 'Scaduta' : 'In corso';
    const phaseClass = phase === 'scheduled' ? 'is-scheduled' : phase === 'expired' ? 'is-expired' : 'is-current';
    items.push({
      inizio: rot.inizioFinestra,
      fine: rot.fineFinestra,
      chiusaIl: null,
      current: true,
      phaseLabel,
      phaseClass
    });
  }

  storico.forEach(f => {
    if (!f?.inizio) return;
    items.push({
      inizio: f.inizio,
      fine: f.fine || null,
      chiusaIl: f.chiusaIl || null,
      current: false,
      phaseLabel: 'Chiusa',
      phaseClass: 'is-closed'
    });
  });

  if (!items.length) {
    el.innerHTML = `
      <div class="rotazione-cronologia-empty">
        <p>Nessuna finestra di rotazione ancora registrata.</p>
        <p class="liturgy-meta">Quando apri e chiudi una finestra da Gestione, compare qui lo storico.</p>
      </div>
    `;
    return;
  }

  el.innerHTML = `
    <ul class="rotazione-cronologia-list">
      ${items.map(item => {
        const range = item.fine
          ? `<strong>${esc(formatRotazioneDateShort(item.inizio))}</strong> → <strong>${esc(formatRotazioneDateShort(item.fine))}</strong>`
          : `<strong>${esc(formatRotazioneDateShort(item.inizio))}</strong> · senza data di fine`;
        const meta = item.current
          ? 'Finestra corrente'
          : (item.chiusaIl ? `Chiusa il ${esc(formatRotazioneDateShort(item.chiusaIl))}` : 'Archiviata');
        return `
          <li class="rotazione-cronologia-item ${item.phaseClass}">
            <div class="rotazione-cronologia-main">
              <span class="rotazione-cronologia-badge">${esc(item.phaseLabel)}</span>
              <span class="rotazione-cronologia-range">${range}</span>
            </div>
            <p class="rotazione-cronologia-meta">${meta}</p>
          </li>
        `;
      }).join('')}
    </ul>
  `;
}

/** Compat: aggiorna i pannelli rotazione visibili dopo un salvataggio config. */
function renderRotazionePanel() {
  if (turniTab === 'anteprima') renderRotazioneAnteprima();
  else if (turniTab === 'gestione') renderRotazioneGestione();
  else if (turniTab === 'cronologia') renderRotazioneCronologia();
  else {
    // Aggiorna anteprima in background se il DOM c’è (es. dopo salvataggio da altre sezioni)
    if (document.getElementById('rotazione-preview')) renderRotazioneAnteprima();
  }
}

/** Anteprima turnistica: sempre sulla config salvata. */
function renderRotazionePreview() {
  const container = document.getElementById('rotazione-preview');
  if (!container) return;

  const slots = getTurniSlot().slice().sort((a, b) => a.turnoNum - b.turnoNum);
  const domeniche = getProssimeDomeniche(8);
  const today = getTodayStr();
  const rotForPreview = getRotazioneConfig();

  if (!slots.length || !domeniche.length) {
    container.innerHTML = '<p class="liturgy-meta">Configura almeno una messa con squadra in Struttura messe.</p>';
    return;
  }

  const header = slots.map(s =>
    `${formatMessaServizioLabel(s.turnoNum)}<br><span class="rotazione-th-sub">${esc(SEDI_LABEL[s.sede])} ${esc(s.ora)}</span>`
  ).join('</th><th>');

  container.innerHTML = `
    <table class="rotazione-table">
      <thead>
        <tr>
          <th>Turno</th>
          <th>${header}</th>
        </tr>
      </thead>
      <tbody>
        ${domeniche.map(dom => {
          const inWindow = !isRotazioneAttiva() || isDomenicaInFinestraRotazione(dom, rotForPreview);
          const sabato = addDaysToDateStr(dom, -1);
          const afterEnd = !!(isRotazioneAttiva() && rotForPreview.fineFinestra && sabato > rotForPreview.fineFinestra);
          const beforeStart = !!(isRotazioneAttiva() && sabato < rotForPreview.inizioFinestra);
          const w = getRotationWeekOffset(dom, rotForPreview);
          const isCurrent = dom >= today && dom === domeniche.find(d => d >= today);
          const dateLabel = new Date(dom + 'T12:00:00').toLocaleDateString('it-IT', {
            weekday: 'short', day: 'numeric', month: 'short'
          }).replace('.', '');
          const cells = slots.map(s => {
            const gid = getGruppoIdForTurno(s.turnoNum, dom, rotForPreview);
            return esc(gid ? getGruppoLabel(gid) : 'Libera');
          }).join('</td><td>');
          let turnoHint = '';
          if (isRotazioneAttiva()) {
            if (inWindow && w != null) {
              turnoHint = `<br><span class="rotazione-row-hint">${esc(formatRotazioneTurnoLabel(w + 1).toLowerCase())}</span>`;
            } else if (beforeStart) {
              turnoHint = '<br><span class="rotazione-row-hint">prima · libera</span>';
            } else if (afterEnd) {
              turnoHint = '<br><span class="rotazione-row-hint">dopo · fissa</span>';
            }
          } else {
            turnoHint = '<br><span class="rotazione-row-hint">fissa</span>';
          }
          const rowClass = [
            isCurrent ? 'current' : '',
            beforeStart ? 'out-before' : '',
            afterEnd ? 'out-after' : '',
            inWindow && isRotazioneAttiva() ? 'in-window' : ''
          ].filter(Boolean).join(' ');
          return `<tr class="${rowClass}"><td>Dom ${esc(dateLabel)}${turnoHint}</td><td>${cells}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function onRotazioneDatesChange() {
  // Date solo in Gestione: nessuna anteprima live qui
}

function onRotazioneFineOpenChange() {
  const fineOpen = document.getElementById('rotazione-fine-open');
  const fineInput = document.getElementById('rotazione-fine');
  if (!fineOpen || !fineInput) return;
  fineInput.disabled = fineOpen.checked;
  if (fineOpen.checked) {
    fineInput.value = '';
  } else if (!fineInput.value) {
    const inizio = document.getElementById('rotazione-inizio')?.value;
    if (inizio) {
      fineInput.value = addDaysToDateStr(inizio, 7 * 12);
      if (!isSabatoDate(fineInput.value)) {
        fineInput.value = getNearestSaturdayOnOrBefore(fineInput.value);
      }
    }
  }
}

function setRotazionePreset(kind) {
  if (!requireAdminAction('Solo l\'admin può gestire la rotazione')) return;
  if (isRotazioneAttiva()) return;
  const inizioInput = document.getElementById('rotazione-inizio');
  const fineInput = document.getElementById('rotazione-fine');
  const fineOpen = document.getElementById('rotazione-fine-open');
  if (!inizioInput) return;

  if (kind === 'questo') {
    inizioInput.value = getSabatoRotazioneDefault();
    if (fineOpen) {
      fineOpen.checked = true;
      onRotazioneFineOpenChange();
    }
  } else if (kind === 'prossimo') {
    inizioInput.value = getSabatoProssimo();
    if (fineOpen) {
      fineOpen.checked = true;
      onRotazioneFineOpenChange();
    }
  } else if (kind === 'pastorale') {
    const startY = getPastoralYearStartForDate();
    inizioInput.value = getNearestSaturdayOnOrAfter(`${startY}-09-01`);
    const fine = getNearestSaturdayOnOrBefore(`${startY + 1}-06-30`);
    if (fineOpen) fineOpen.checked = false;
    if (fineInput) {
      fineInput.disabled = false;
      fineInput.value = fine;
    }
  }
}

function readRotazioneFormDates() {
  const inizio = document.getElementById('rotazione-inizio')?.value;
  const fineOpen = document.getElementById('rotazione-fine-open')?.checked;
  const fine = fineOpen ? null : (document.getElementById('rotazione-fine')?.value || null);
  return { inizio, fine, fineOpen: !!fineOpen };
}

function validateRotazioneDates(inizio, fine, fineOpen) {
  if (!inizio) {
    showToast('Seleziona il sabato di inizio');
    return false;
  }
  if (!isSabatoDate(inizio)) {
    showToast('La data di inizio deve essere un sabato');
    return false;
  }
  if (!fineOpen) {
    if (!fine) {
      showToast('Seleziona il sabato di fine, oppure spunta “Senza data di fine”');
      return false;
    }
    if (!isSabatoDate(fine)) {
      showToast('La data di fine deve essere un sabato');
      return false;
    }
    if (fine < inizio) {
      showToast('La fine deve essere successiva all’inizio');
      return false;
    }
  }
  return true;
}

function salvaFinestraRotazione() {
  if (!requireAdminAction('Solo l\'admin può gestire la rotazione')) return;
  if (isRotazioneAttiva()) {
    showToast('Chiudi prima la finestra corrente');
    return;
  }
  const { inizio, fine, fineOpen } = readRotazioneFormDates();
  if (!validateRotazioneDates(inizio, fine, fineOpen)) return;

  const rot = getRotazioneConfig();
  rot.attiva = true;
  rot.inizioFinestra = inizio;
  rot.fineFinestra = fineOpen ? null : fine;
  afterGruppiConfigChange();
  showToast('Finestra rotazione aperta');
}

function apriFinestraRotazione() {
  salvaFinestraRotazione();
}

function chiudiFinestraRotazione() {
  if (!requireAdminAction('Solo l\'admin può gestire la rotazione')) return;
  if (!confirm('Chiudere la finestra di rotazione? Resta l’assegnazione fissa: messa 1→Gruppo 1, messa 2→Gruppo 2, messa 3→Gruppo 3 (ogni turno uguale).')) return;

  const rot = getRotazioneConfig();
  if (rot.inizioFinestra) {
    const oggi = getTodayStr();
    let fineArchivio = rot.fineFinestra;
    if (!fineArchivio || fineArchivio > oggi) {
      fineArchivio = getNearestSaturdayOnOrBefore(oggi);
      if (fineArchivio < rot.inizioFinestra) fineArchivio = rot.inizioFinestra;
    }
    const entry = {
      inizio: rot.inizioFinestra,
      fine: fineArchivio,
      chiusaIl: oggi
    };
    rot.storicoFinestre = [entry, ...(rot.storicoFinestre || [])].slice(0, 24);
  }
  rot.attiva = false;
  afterGruppiConfigChange();
  showToast('Finestra rotazione chiusa');
}

function getChierichettiInGruppo(gruppoId) {
  return getPersoneGruppiPool()
    .filter(c => c.gruppo === gruppoId)
    .sort(sortChierichettiInGruppo);
}

function getChierichettiSenzaGruppo() {
  return getPersoneGruppiPool()
    .filter(c => !c.gruppo)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

function getChierichettiAssegnabiliA(gruppoId) {
  return getPersoneGruppiPool()
    .filter(c => c.gruppo !== gruppoId && chierichettoCanJoinGruppo(c, gruppoId))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

function chierichettoOptionLabel(c) {
  const anno = formatAnnoNascitaLabel(c.annoNascita);
  const par = c.parrocchia ? ` · ${getParrocchiaLabel(c.parrocchia)}` : '';
  const cer = isAppelloCerimoniere(c) ? ' · cerimoniere' : '';
  if (!c.gruppo) return `${c.nome} (${anno}${par}${cer})`;
  return `${c.nome} (${anno}${par}${cer}) · ${getGruppoLabel(c.gruppo)}`;
}

function buildGruppoPersonaSelectOptions(assignable) {
  const byNome = (a, b) => a.nome.localeCompare(b.nome, 'it');
  const cer = assignable.filter(isAppelloCerimoniere).sort(byNome);
  const chi = assignable.filter(c => !isAppelloCerimoniere(c)).sort(byNome);
  const mk = list => list.map(c =>
    `<option value="${esc(c.uuid)}">${esc(chierichettoOptionLabel(c))}</option>`
  ).join('');
  let html = '';
  if (chi.length) html += `<optgroup label="Chierichetti">${mk(chi)}</optgroup>`;
  if (cer.length) html += `<optgroup label="Cerimonieri">${mk(cer)}</optgroup>`;
  return html;
}

function renderGruppoAddRow(gruppoId) {
  const allPersone = getPersoneGruppiPool();
  if (!allPersone.length) {
    return `<p class="liturgy-meta" style="margin:0">Nessuna persona attiva — <button type="button" class="btn btn-ghost-light" style="padding:0;font-size:inherit" onclick="showSection('anagrafica')">registrane una in Anagrafica</button></p>`;
  }
  const assignable = getChierichettiAssegnabiliA(gruppoId);
  if (!assignable.length) {
    return '<p class="liturgy-meta" style="margin:0">Nessun altro chierichetto o cerimoniere da aggiungere a questa squadra</p>';
  }
  const options = buildGruppoPersonaSelectOptions(assignable);
  return `
    <div class="gruppo-add-row">
      <select id="gruppo-add-select-${esc(gruppoId)}" aria-label="Chierichetto o cerimoniere da aggiungere">
        <option value="">Seleziona chierichetto o cerimoniere…</option>
        ${options}
      </select>
      <button type="button" class="btn btn-secondary" style="font-size:0.82rem;padding:8px 12px" onclick="addChierichettoToGruppoFromSelect('${esc(gruppoId)}')">Aggiungi alla squadra</button>
    </div>
  `;
}

function renderUnassignedPanel(unassigned) {
  const hintEl = document.getElementById('gruppi-unassigned-hint');
  const chipsEl = document.getElementById('gruppi-non-assegnati');
  const titleEl = document.querySelector('#gruppi-unassigned-wrap .config-section-title');
  const allPersone = getPersoneGruppiPool();

  if (!allPersone.length) {
    if (titleEl) titleEl.textContent = 'Senza gruppo';
    if (hintEl) hintEl.textContent = 'Prima registra chierichetti o cerimonieri in Anagrafica, poi torna qui per assegnarli.';
    if (chipsEl) chipsEl.innerHTML = '';
    return;
  }

  if (!unassigned.length) {
    if (titleEl) titleEl.textContent = 'Senza gruppo';
    if (hintEl) hintEl.textContent = 'Tutti sono assegnati a una squadra.';
    if (chipsEl) chipsEl.innerHTML = '';
    return;
  }

  if (titleEl) titleEl.textContent = `Senza gruppo · ${unassigned.length}`;
  if (hintEl) {
    hintEl.textContent = isCurrentUserAdmin()
      ? 'Usa «Nuovi gruppi × nuovi turni» o «Aggiorna composizione» per assegnarli.'
      : `${unassigned.length} persone senza gruppo.`;
  }

  const chipHtml = (c) => {
    const label = esc(c.nome);
    const cer = isAppelloCerimoniere(c) ? ' is-cerimoniere' : '';
    return `<button type="button" class="gruppo-member-chip is-readonly is-link${cer}" onclick="openAnagPersonDetailFromGruppi('${esc(c.uuid)}')">${label}</button>`;
  };

  const byParrocchia = (id) => unassigned.filter(c => !isAppelloCerimoniere(c) && c.parrocchia === id);
  const sections = ['vanzago', 'mantegazza'].map(pid => {
    const list = byParrocchia(pid);
    if (!list.length) return '';
    return `
      <div class="gruppi-parrocchia-section">
        <p class="gruppi-parrocchia-title">${esc(getParrocchiaLabel(pid))}</p>
        <div class="gruppo-member-chips">
          ${list.map(chipHtml).join('')}
        </div>
      </div>
    `;
  }).join('');

  const cerList = unassigned.filter(isAppelloCerimoniere);
  const cerSection = cerList.length ? `
    <div class="gruppi-parrocchia-section">
      <p class="gruppi-parrocchia-title">Cerimonieri</p>
      <div class="gruppo-member-chips">
        ${cerList.map(chipHtml).join('')}
      </div>
    </div>
  ` : '';

  const senzaParrocchia = unassigned.filter(c => !isAppelloCerimoniere(c) && !c.parrocchia);
  const extraSection = senzaParrocchia.length ? `
    <div class="gruppi-parrocchia-section">
      <p class="gruppi-parrocchia-title">Parrocchia da impostare</p>
      <div class="gruppo-member-chips">
        ${senzaParrocchia.map(chipHtml).join('')}
      </div>
    </div>
  ` : '';

  if (chipsEl) chipsEl.innerHTML = sections + cerSection + extraSection;
}

async function assignChierichettoToGruppo(uuid, gruppoId) {
  if (!requireAdminAction('Solo l\'admin può assegnare i gruppi')) return;
  const chi = findGruppoPersona(uuid);
  if (!chi) return;
  if (!getGruppi().some(g => g.id === gruppoId)) {
    showToast('Gruppo non valido');
    return;
  }
  if (!chierichettoCanJoinGruppo(chi, gruppoId)) {
    showToast(`${chi.nome} non può servire in nessuna messa del turno`);
    return;
  }
  const prevGruppo = chi.gruppo || '';
  const ok = await persistPersonaGruppo(uuid, gruppoId);
  void persistConfig();
  renderGruppiVetrinaList();
  renderGruppiGestioneList();
  if (document.getElementById('anagrafica').classList.contains('active')) {
    renderChierichetti();
    renderCerimonieri();
  }
  if (!ok) return;
  if (prevGruppo && prevGruppo !== gruppoId) {
    showToast(`${chi.nome} spostato da ${getGruppoLabel(prevGruppo)} a ${getGruppoLabel(gruppoId)}`);
  } else {
    showToast(`${chi.nome} → ${getGruppoLabel(gruppoId)}`);
  }
}

async function unassignChierichettoFromGruppo(uuid) {
  if (!requireAdminAction('Solo l\'admin può modificare i gruppi')) return;
  const chi = findGruppoPersona(uuid);
  if (!chi) return;
  const ok = await persistPersonaGruppo(uuid, '');
  void persistConfig();
  renderGruppiVetrinaList();
  renderGruppiGestioneList();
  if (document.getElementById('anagrafica').classList.contains('active')) {
    renderChierichetti();
    renderCerimonieri();
  }
  if (!ok) return;
  showToast(`${chi.nome} rimosso dal gruppo`);
}

function renderGruppiGestioneList() {
  const container = document.getElementById('gruppi-gestione-list');
  if (!container) return;
  const gruppi = getGruppiAttivi();
  const unassigned = getChierichettiSenzaGruppo();

  if (!gruppi.length) {
    container.innerHTML = isCurrentUserAdmin()
      ? '<p class="empty-state">Nessun gruppo — creane uno</p>'
      : '<p class="empty-state">Nessuna squadra configurata — chiedi all\'admin di crearne una</p>';
  } else {
    container.innerHTML = gruppi.map(g => buildGruppoCardHtml(g)).join('');
  }

  renderUnassignedPanel(unassigned);
  updateGruppiPanelMeta();
  syncGruppiAdminUi();
  if (document.body.classList.contains('gruppi-edit-open')) renderGruppiEditPanel();
}

function getDraftGruppoFor(uuid) {
  if (!gruppiEditDraft) return '';
  return gruppiEditDraft[uuid] || '';
}

function getChierichettiInGruppoDraft(gruppoId) {
  return getPersoneGruppiPool()
    .filter(c => getDraftGruppoFor(c.uuid) === gruppoId)
    .sort(sortChierichettiInGruppo);
}

function getChierichettiSenzaGruppoDraft() {
  return getPersoneGruppiPool()
    .filter(c => !getDraftGruppoFor(c.uuid))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
}

function hasGruppiEditChanges() {
  if (!gruppiEditDraft || !gruppiEditBaseline) return false;
  const keys = new Set([...Object.keys(gruppiEditDraft), ...Object.keys(gruppiEditBaseline)]);
  for (const uuid of keys) {
    if ((gruppiEditDraft[uuid] || '') !== (gruppiEditBaseline[uuid] || '')) return true;
  }
  return false;
}

function openGruppiEdit(mode = 'nuovi') {
  if (!requireAdminAction('Solo l\'admin può modificare i gruppi')) return;
  closeGruppiFormSheet();
  gruppiEditMode = mode === 'aggiorna' ? 'aggiorna' : 'nuovi';
  gruppiEditBaseline = {};
  gruppiEditDraft = {};
  gruppiEditUndoStack = [];
  // Baseline = composizione attuale
  // nuovi: bozza vuota (riassegna tutto) · aggiorna: bozza = attuale
  getPersoneGruppiPool().forEach(c => {
    const g = c.gruppo || '';
    gruppiEditBaseline[c.uuid] = g;
    gruppiEditDraft[c.uuid] = gruppiEditMode === 'aggiorna' ? g : '';
  });
  gruppiEditSelected = new Set();
  document.body.classList.add('gruppi-edit-open');
  document.body.classList.remove('gruppi-edit-selecting');
  const view = document.getElementById('gruppi-gestione-view');
  const panel = document.getElementById('gruppi-edit-panel');
  if (view) view.hidden = true;
  if (panel) panel.hidden = false;
  syncGruppiEditPanelChrome();
  renderGruppiEditPanel();
  syncGruppiFab();
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncGruppiEditPanelChrome() {
  const title = document.getElementById('gruppi-edit-title');
  const sub = document.getElementById('gruppi-edit-sub');
  const saveBtn = document.getElementById('btn-salva-gruppi-config');
  const isAggiorna = gruppiEditMode === 'aggiorna';
  if (title) title.textContent = isAggiorna ? 'Aggiorna composizione' : 'Nuovi gruppi × nuovi turni';
  if (sub) {
    sub.textContent = isAggiorna
      ? 'Modifica le squadre attuali: al salvataggio si aggiorna l’ultimo record in cronologia'
      : 'Parti da squadre vuote: al salvataggio crei una nuova configurazione in cronologia';
  }
  if (saveBtn) {
    saveBtn.textContent = isAggiorna ? 'Aggiorna' : 'Salva nuova configurazione';
  }
}

function closeGruppiEdit(force = false) {
  if (!document.body.classList.contains('gruppi-edit-open') && !gruppiEditDraft) return true;
  if (!force && hasGruppiEditChanges() && !confirm('Scartare le modifiche non salvate?')) return false;
  document.body.classList.remove('gruppi-edit-open', 'gruppi-edit-selecting');
  gruppiEditDraft = null;
  gruppiEditBaseline = null;
  gruppiEditSelected = new Set();
  gruppiEditUndoStack = [];
  gruppiEditMode = 'nuovi';
  const view = document.getElementById('gruppi-gestione-view');
  const panel = document.getElementById('gruppi-edit-panel');
  if (view) view.hidden = false;
  if (panel) panel.hidden = true;
  syncGruppiFab();
  return true;
}

function toggleGruppiEditSelection(uuid) {
  if (!gruppiEditDraft) return;
  const wasEmpty = gruppiEditSelected.size === 0;
  if (gruppiEditSelected.has(uuid)) gruppiEditSelected.delete(uuid);
  else gruppiEditSelected.add(uuid);
  const nowEmpty = gruppiEditSelected.size === 0;
  if (wasEmpty || nowEmpty) {
    renderGruppiEditPanel();
    return;
  }
  syncGruppiEditChrome();
  document.querySelectorAll(`#gruppi-edit-list [data-edit-uuid="${CSS.escape(uuid)}"]`).forEach(el => {
    el.classList.toggle('is-selected', gruppiEditSelected.has(uuid));
  });
}

function clearGruppiEditSelection() {
  if (!gruppiEditSelected.size) return;
  gruppiEditSelected = new Set();
  renderGruppiEditPanel();
}

function selectAllUnassignedInEdit(section) {
  if (!gruppiEditDraft) return;
  const list = getChierichettiSenzaGruppoDraft();
  const filtered = section === 'cerimonieri'
    ? list.filter(isAppelloCerimoniere)
    : section === 'vanzago'
      ? list.filter(c => !isAppelloCerimoniere(c) && c.parrocchia === 'vanzago')
      : section === 'mantegazza'
        ? list.filter(c => !isAppelloCerimoniere(c) && c.parrocchia === 'mantegazza')
        : section === 'altro'
          ? list.filter(c => !isAppelloCerimoniere(c) && c.parrocchia !== 'vanzago' && c.parrocchia !== 'mantegazza')
          : list;
  filtered.forEach(c => gruppiEditSelected.add(c.uuid));
  renderGruppiEditPanel();
}

function buildGruppiEditUnassignedSections(unassigned, hasSelection) {
  const byNome = (a, b) => a.nome.localeCompare(b.nome, 'it');
  const sections = [
    {
      id: 'vanzago',
      title: 'Vanzago',
      list: unassigned.filter(c => !isAppelloCerimoniere(c) && c.parrocchia === 'vanzago').sort(byNome)
    },
    {
      id: 'mantegazza',
      title: 'Mantegazza',
      list: unassigned.filter(c => !isAppelloCerimoniere(c) && c.parrocchia === 'mantegazza').sort(byNome)
    },
    {
      id: 'cerimonieri',
      title: 'Cerimonieri',
      list: unassigned.filter(isAppelloCerimoniere).sort(byNome)
    },
    {
      id: 'altro',
      title: 'Parrocchia da impostare',
      list: unassigned.filter(c => !isAppelloCerimoniere(c) && c.parrocchia !== 'vanzago' && c.parrocchia !== 'mantegazza').sort(byNome)
    }
  ].filter(sec => sec.list.length);

  if (!sections.length) {
    return '<span class="liturgy-meta">Tutti assegnati</span>';
  }

  return sections.map(sec => `
    <div class="gruppi-edit-pool-section">
      <div class="gruppi-edit-pool-head">
        <p class="gruppi-parrocchia-title">${esc(sec.title)} · ${sec.list.length}</p>
        ${!hasSelection && sec.list.length > 1
          ? `<button type="button" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();selectAllUnassignedInEdit('${esc(sec.id)}')">Seleziona</button>`
          : ''}
      </div>
      <div class="gruppo-member-chips">
        ${sec.list.map(c => buildGruppiEditChip(c)).join('')}
      </div>
    </div>
  `).join('');
}

function syncGruppiEditChrome() {
  const n = gruppiEditSelected.size;
  const nChanges = countGruppiEditChanges();
  const toolbar = document.getElementById('gruppi-edit-toolbar');
  const changesBar = document.getElementById('gruppi-edit-changes');
  const countEl = document.getElementById('gruppi-edit-selection-count');
  const hintEl = document.getElementById('gruppi-edit-toolbar-hint');
  const changesText = document.getElementById('gruppi-edit-changes-text');
  const undoBtn = document.getElementById('btn-gruppi-edit-undo');
  const subEl = document.getElementById('gruppi-edit-sub');

  document.body.classList.toggle('gruppi-edit-selecting', n > 0);
  document.getElementById('gruppi-edit-list')?.classList.toggle('has-selection', n > 0);
  document.getElementById('gruppi-edit-panel')?.classList.toggle('has-selection', n > 0);

  const activeCount = state.chierichetti.filter(isChierichettoAttivo).length;
  const unassignedCount = getChierichettiSenzaGruppoDraft().length;
  const atEmptyStart = unassignedCount === activeCount && !gruppiEditUndoStack.length;

  if (toolbar) {
    toolbar.hidden = n === 0;
    toolbar.classList.toggle('is-visible', n > 0);
  }
  if (countEl) countEl.textContent = n === 1 ? '1 selezionato' : `${n} selezionati`;
  if (hintEl) hintEl.textContent = 'Tocca la squadra di destinazione';
  if (subEl) {
    subEl.textContent = n > 0
      ? 'Scegli dove spostarli'
      : atEmptyStart
        ? 'Gruppi vuoti — assegna da Vanzago, Mantegazza e Cerimonieri'
        : (nChanges
          ? `${nChanges} da confermare — salva quando hai finito`
          : 'Tocca i nomi, poi tocca una squadra');
  }

  const showChanges = n === 0 && nChanges > 0 && !atEmptyStart;
  if (changesBar) {
    changesBar.hidden = !showChanges;
    changesBar.classList.toggle('is-visible', showChanges);
  }
  if (changesText && showChanges) {
    changesText.textContent = nChanges === 1
      ? '1 persona spostata — salva per confermare'
      : `${nChanges} persone spostate — salva per confermare`;
  }
  if (undoBtn) {
    undoBtn.hidden = !gruppiEditUndoStack.length;
  }
}

function applyGruppiEditSelection(forcedGruppoId) {
  if (!gruppiEditDraft || !gruppiEditSelected.size) {
    showToast('Seleziona almeno una persona');
    return;
  }
  const gruppoId = forcedGruppoId !== undefined ? forcedGruppoId : '';
  const undoBatch = [];
  let skipped = 0;
  let moved = 0;
  for (const uuid of [...gruppiEditSelected]) {
    const chi = findGruppoPersona(uuid);
    if (!chi) continue;
    if (gruppoId && !chierichettoCanJoinGruppo(chi, gruppoId)) {
      skipped += 1;
      continue;
    }
    const prev = gruppiEditDraft[uuid] || '';
    if (prev === gruppoId) continue;
    undoBatch.push({ uuid, prev });
    gruppiEditDraft[uuid] = gruppoId;
    moved += 1;
  }
  if (undoBatch.length) {
    gruppiEditUndoStack.push(undoBatch);
    if (gruppiEditUndoStack.length > 30) gruppiEditUndoStack.shift();
  }
  gruppiEditSelected = new Set();
  renderGruppiEditPanel();
  if (skipped && !moved) {
    showToast('Nessuno può entrare in quella squadra');
  } else if (skipped) {
    showToast(`${moved} assegnati · ${skipped} non compatibili`);
  } else if (moved && gruppoId) {
    showToast(`${moved} → ${getGruppoLabel(gruppoId)}`);
  } else if (moved) {
    showToast(moved === 1 ? '1 persona senza gruppo' : `${moved} senza gruppo`);
  }
}

function assignSelectedToGruppo(gruppoId) {
  applyGruppiEditSelection(gruppoId);
}

function undoLastGruppiEdit() {
  const batch = gruppiEditUndoStack.pop();
  if (!batch || !gruppiEditDraft) return;
  batch.forEach(({ uuid, prev }) => {
    gruppiEditDraft[uuid] = prev;
  });
  gruppiEditSelected = new Set();
  renderGruppiEditPanel();
  showToast('Ultima modifica annullata');
}

function resetGruppiEditDraft() {
  if (!gruppiEditDraft || !gruppiEditBaseline) return;
  if (!hasGruppiEditChanges()) return;
  if (!confirm('Ripristinare la composizione iniziale?')) return;
  Object.keys(gruppiEditBaseline).forEach(uuid => {
    gruppiEditDraft[uuid] = gruppiEditBaseline[uuid];
  });
  gruppiEditUndoStack = [];
  gruppiEditSelected = new Set();
  renderGruppiEditPanel();
  showToast('Composizione ripristinata');
}

function wereTogetherInBaseline(uuidA, uuidB) {
  if (!gruppiEditBaseline) return false;
  const ga = gruppiEditBaseline[uuidA] || '';
  const gb = gruppiEditBaseline[uuidB] || '';
  return !!(ga && ga === gb);
}

/** Ultime N configurazioni salvate (non la bozza corrente) */
function getGruppiPairHistoryMaps(limit = 2) {
  ensureGruppiConfig();
  return (state.gruppiConfig.cronologia || [])
    .filter(e => e.tipo === 'configurazione' && e.snapshot?.gruppi)
    .slice(0, limit)
    .map(entry => snapshotToPairMap(entry.snapshot));
}

function snapshotToPairMap(snapshot) {
  const byPerson = new Map();
  for (const g of snapshot?.gruppi || []) {
    const ids = (g.membri || []).map(m => m.uuid).filter(Boolean);
    for (const id of ids) {
      byPerson.set(id, new Set(ids.filter(x => x !== id)));
    }
  }
  return byPerson;
}

function countConsecutivePairHistory(uuidA, uuidB, historyMaps) {
  let n = 0;
  for (const map of historyMaps) {
    if (map.get(uuidA)?.has(uuidB)) n += 1;
    else break;
  }
  return n;
}

/**
 * Avvisi solo su coppie NUOVE rispetto alla composizione di partenza.
 * warn = già insieme 1 volta in cronologia; danger = 2 volte consecutive.
 */
function getGruppoMemberPairWarnings(members, historyMaps) {
  const byUuid = new Map();
  if (members.length < 2) return byUuid;

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i];
      const b = members[j];
      // Status quo: già insieme all'apertura → niente colore
      if (wereTogetherInBaseline(a.uuid, b.uuid)) continue;

      let n = countConsecutivePairHistory(a.uuid, b.uuid, historyMaps);
      // Se non c'è ancora cronologia salvata, la "volta precedente" è la baseline
      if (!historyMaps.length && gruppiEditBaseline) {
        // già esclusi se insieme in baseline; niente da segnalare
        n = 0;
      }
      if (n < 1) continue;

      const level = n >= 2 ? 'danger' : 'warn';
      const note = n >= 2
        ? `già insieme nelle ultime ${n} configurazioni`
        : 'già insieme la volta precedente';

      const bump = (person, other) => {
        const prev = byUuid.get(person.uuid) || { level: null, with: [] };
        if (level === 'danger' || prev.level !== 'danger') {
          if (level === 'danger') prev.level = 'danger';
          else if (!prev.level) prev.level = 'warn';
        }
        prev.with.push({ nome: other.nome, level, note });
        byUuid.set(person.uuid, prev);
      };
      bump(a, b);
      bump(b, a);
    }
  }

  byUuid.forEach(info => {
    const danger = info.with.filter(w => w.level === 'danger');
    const warn = info.with.filter(w => w.level === 'warn');
    const parts = [];
    if (danger.length) parts.push(danger.map(w => `${w.nome}: ${w.note}`).join('; '));
    if (warn.length) parts.push(warn.map(w => `${w.nome}: ${w.note}`).join('; '));
    info.title = parts.join(' · ');
  });

  return byUuid;
}

function maxPairWarningLevel(warningsMap) {
  let max = null;
  warningsMap.forEach(info => {
    if (info.level === 'danger') max = 'danger';
    else if (info.level === 'warn' && max !== 'danger') max = 'warn';
  });
  return max;
}

function countGruppiEditChanges() {
  if (!gruppiEditDraft || !gruppiEditBaseline) return 0;
  let n = 0;
  const keys = new Set([...Object.keys(gruppiEditDraft), ...Object.keys(gruppiEditBaseline)]);
  for (const uuid of keys) {
    if ((gruppiEditDraft[uuid] || '') !== (gruppiEditBaseline[uuid] || '')) n += 1;
  }
  return n;
}

function buildGruppiEditChip(c, pairInfo) {
  const selected = gruppiEditSelected.has(c.uuid);
  const pairClass = pairInfo?.level === 'danger'
    ? ' is-pair-danger'
    : pairInfo?.level === 'warn'
      ? ' is-pair-warn'
      : '';
  const baselineG = gruppiEditBaseline?.[c.uuid] || '';
  const draftG = gruppiEditDraft?.[c.uuid] || '';
  const changed = baselineG !== draftG;
  const fromLabel = changed
    ? (baselineG ? getGruppoLabel(baselineG) : 'Senza gruppo')
    : '';
  const titleParts = [];
  if (pairInfo?.title) titleParts.push(pairInfo.title);
  if (fromLabel) titleParts.push('da ' + fromLabel);
  const title = titleParts.length ? ` title="${esc(titleParts.join(' · '))}"` : '';
  return `
    <button type="button"
      class="gruppo-member-chip is-selectable${isAppelloCerimoniere(c) ? ' is-cerimoniere' : ''}${selected ? ' is-selected' : ''}${changed ? ' is-moved' : ''}${pairClass}"
      data-edit-uuid="${esc(c.uuid)}"
      onclick="toggleGruppiEditSelection('${esc(c.uuid)}')"
      aria-pressed="${selected ? 'true' : 'false'}"${title}>
      <span class="gruppi-edit-chip-check" aria-hidden="true"></span>
      <span class="gruppi-edit-chip-label">${esc(c.nome)}</span>
      ${fromLabel ? `<span class="gruppi-edit-chip-from">${esc(fromLabel)}</span>` : ''}
    </button>
  `;
}

function renderGruppiEditPanel() {
  const list = document.getElementById('gruppi-edit-list');
  if (!list || !gruppiEditDraft) return;
  const gruppi = getGruppiAttivi();
  const unassigned = getChierichettiSenzaGruppoDraft();
  const historyMaps = getGruppiPairHistoryMaps(2);
  const hasSelection = gruppiEditSelected.size > 0;
  const nChanges = countGruppiEditChanges();
  let warnCount = 0;

  const groupsHtml = gruppi.length
    ? gruppi.map(g => {
      const members = getChierichettiInGruppoDraft(g.id);
      const nCer = members.filter(isAppelloCerimoniere).length;
      const warnings = getGruppoMemberPairWarnings(members, historyMaps);
      const cardLevel = maxPairWarningLevel(warnings);
      if (cardLevel) warnCount += 1;
      const cardClass = [
        cardLevel === 'danger' ? 'is-pair-danger' : '',
        cardLevel === 'warn' ? 'is-pair-warn' : '',
        hasSelection ? 'is-drop-target' : ''
      ].filter(Boolean).join(' ');
      const pairHint = cardLevel === 'danger'
        ? '<p class="gruppi-pair-card-hint is-danger">Nuove coppie già insieme 2 volte</p>'
        : cardLevel === 'warn'
          ? '<p class="gruppi-pair-card-hint is-warn">Nuove coppie già insieme la volta scorsa</p>'
          : '';
      return `
        <div class="gruppo-squadra-card gruppi-edit-card ${cardClass}" ${hasSelection ? `role="button" tabindex="0" onclick="assignSelectedToGruppo('${esc(g.id)}')"` : ''}>
          <div class="gruppo-squadra-head">
            <div>
              <p class="config-item-title">${esc(g.nome)}</p>
              <p class="config-item-meta">${nCer ? nCer + ' cerim. · ' : ''}${members.length} in squadra</p>
            </div>
            ${hasSelection
              ? '<span class="gruppi-edit-drop-label">Assegna qui</span>'
              : `<span class="gruppi-edit-card-count">${members.length}</span>`}
          </div>
          ${pairHint}
          <div class="gruppo-member-chips" onclick="event.stopPropagation()">
            ${members.length
              ? members.map(c => buildGruppiEditChip(c, warnings.get(c.uuid))).join('')
              : '<span class="liturgy-meta">Squadra vuota</span>'}
          </div>
        </div>
      `;
    }).join('')
    : '<p class="empty-state">Nessun gruppo attivo</p>';

  const legendHtml = warnCount
    ? `<div class="gruppi-pair-legend" role="note">
        <span><span class="gruppi-pair-swatch is-warn" aria-hidden="true"></span> già insieme 1 volta</span>
        <span><span class="gruppi-pair-swatch is-danger" aria-hidden="true"></span> già insieme 2 volte</span>
      </div>`
    : '';

  const unassignedHtml = `
    <div class="gruppi-unassigned-panel gruppi-edit-unassigned${hasSelection ? ' is-drop-target' : ''}"
      ${hasSelection ? `role="button" tabindex="0" onclick="applyGruppiEditSelection('')"` : ''}>
      <div class="gruppo-squadra-head">
        <div>
          <h4 class="config-section-title">Da assegnare${unassigned.length ? ` · ${unassigned.length}` : ''}</h4>
          <p class="liturgy-meta gruppi-unassigned-hint">${hasSelection
            ? 'Tocca per togliere dal gruppo'
            : 'Vanzago, Mantegazza e Cerimonieri — tocca i nomi, poi una squadra'}</p>
        </div>
        ${hasSelection
          ? '<span class="gruppi-edit-drop-label is-warn">Togli</span>'
          : ''}
      </div>
      <div class="gruppi-edit-pool" onclick="event.stopPropagation()">
        ${buildGruppiEditUnassignedSections(unassigned, hasSelection)}
      </div>
    </div>
  `;

  list.innerHTML = unassignedHtml + groupsHtml + legendHtml;
  syncGruppiEditChrome();

  const saveBtn = document.getElementById('btn-salva-gruppi-config');
  if (saveBtn) {
    saveBtn.disabled = nChanges === 0;
    const isAggiorna = gruppiEditMode === 'aggiorna';
    if (!nChanges) {
      saveBtn.textContent = isAggiorna ? 'Aggiorna' : 'Salva nuova configurazione';
    } else {
      saveBtn.textContent = isAggiorna ? `Aggiorna (${nChanges})` : `Salva nuova (${nChanges})`;
    }
  }
}

async function saveGruppiEditConfig() {
  if (!requireAdminAction('Solo l\'admin può modificare i gruppi')) return;
  if (!gruppiEditDraft || !gruppiEditBaseline) return;
  if (!hasGruppiEditChanges()) {
    showToast('Nessuna modifica da salvare');
    return;
  }

  const changes = [];
  const toPersist = [];
  for (const uuid of Object.keys(gruppiEditDraft)) {
    const next = gruppiEditDraft[uuid] || '';
    const prev = gruppiEditBaseline[uuid] || '';
    if (next === prev) continue;
    const chi = findGruppoPersona(uuid);
    if (!chi) continue;
    if (next && !chierichettoCanJoinGruppo(chi, next)) {
      showToast(`${chi.nome} non può entrare in ${getGruppoLabel(next)}`);
      return;
    }
    changes.push({
      personaNome: chi.nome,
      da: prev ? getGruppoLabel(prev) : 'Senza gruppo',
      a: next ? getGruppoLabel(next) : 'Senza gruppo',
      daId: prev,
      aId: next
    });
    toPersist.push({ uuid, chi, next, prev });
  }

  const saveBtn = document.getElementById('btn-salva-gruppi-config');
  if (saveBtn) saveBtn.disabled = true;

  let failed = null;
  for (const { uuid, chi, next } of toPersist) {
    const ok = await persistPersonaGruppo(uuid, next);
    if (!ok) {
      failed = chi.nome;
      break;
    }
  }

  if (failed) {
    if (saveBtn) saveBtn.disabled = false;
    renderGruppiEditPanel();
    showToast(`Salvataggio interrotto su ${failed}`);
    return;
  }

  const payload = {
    changes,
    summary: summarizeGruppiChanges(changes),
    snapshot: buildGruppiSnapshotFromState()
  };
  if (gruppiEditMode === 'aggiorna') {
    const result = updateLastGruppoConfigurazioneCronologia(payload);
    closeGruppiEdit(true);
    afterGruppiConfigChange();
    showToast(result === 'updated'
      ? 'Composizione aggiornata (stesso record in cronologia)'
      : 'Composizione salvata in cronologia');
  } else {
    appendGruppoCronologia('configurazione', '', payload);
    closeGruppiEdit(true);
    afterGruppiConfigChange();
    showToast('Nuova configurazione gruppi salvata');
  }
}

function addChierichettoToGruppoFromSelect(gruppoId) {
  const sel = document.getElementById('gruppo-add-select-' + gruppoId);
  const uuid = sel?.value;
  if (!uuid) {
    showToast('Seleziona un chierichetto o cerimoniere');
    return;
  }
  assignChierichettoToGruppo(uuid, gruppoId);
}

function afterGruppiConfigChange() {
  renumberMesseDomenicali();
  syncGruppiToTurniSlots();
  saveData();
  persistConfig();
  populateGruppoSelects();
  updateTurniPanelMeta();
  updateMesseDomenicaliSummary();
  updateGruppiPanelMeta();
  renderRotazionePanel();
  renderGruppiVetrinaList();
  renderGruppiGestioneList();
  renderGruppiCronologia();
  renderMesseDomenicaliList();

  const active = document.querySelector('.section.active');
  if (active?.id === 'dashboard') renderDashboard();
  else if (active?.id === 'messe') loadMesseAgenda();
  else if (active?.id === 'turni') renderTurni();
  else if (active?.id === 'gruppi') void renderGruppi();
  else if (active?.id === 'anagrafica') renderChierichetti();
  else if (active?.id === 'presenze') renderAppello();
}

function editGruppoSquadra(id) {
  if (!requireAdminAction('Solo l\'admin può modificare i gruppi')) return;
  const g = getGruppi().find(x => x.id === id);
  if (!g) return;
  const nome = prompt('Nome squadra', g.nome);
  if (nome === null) return;
  const trimmed = nome.trim();
  if (!trimmed) {
    showToast('Il nome non può essere vuoto');
    return;
  }
  if (getGruppi().some(x => x.id !== id && x.nome.trim().toLowerCase() === trimmed.toLowerCase())) {
    showToast('Esiste già una squadra con questo nome');
    return;
  }
  const nomePrecedente = g.nome;
  g.nome = trimmed;
  // Rinomina senza nuovo record: aggiorna solo il nome e, se c’è, lo snapshot corrente
  const lastCfg = (state.gruppiConfig.cronologia || []).find(e => e.tipo === 'configurazione');
  if (lastCfg?.snapshot?.gruppi) {
    const snapG = lastCfg.snapshot.gruppi.find(x => x.id === id);
    if (snapG) snapG.nome = trimmed;
    lastCfg.gruppoNome = trimmed;
    lastCfg.updatedAt = new Date().toISOString();
  }
  afterGruppiConfigChange();
  showToast(nomePrecedente !== trimmed ? 'Squadra rinominata' : 'Nessuna modifica');
}

function deleteGruppoSquadra() {
  showToast('I gruppi si generano dalle messe con squadra — configura in Turni');
}

function editMessaDomenicale(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const m = state.gruppiConfig.messeDomenicali.find(x => x.id === id);
  if (!m) return;
  switchTurniTab('messe');
  editingMessaDomenicaleId = id;
  document.getElementById('messa-domenicale-edit-id').value = id;
  document.getElementById('messa-domenicale-day').value = String(m.dayOffset);
  document.getElementById('messa-domenicale-ora').value = m.ora;
  document.getElementById('messa-domenicale-sede').value = m.sede;
  document.getElementById('messa-domenicale-vigilia').checked = !!m.vigilia;
  document.getElementById('messa-domenicale-con-turno').checked = !!m.conTurno;
  setTurniFormMode(true);
  document.querySelector('.turni-form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cancelMessaDomenicaleEdit() {
  editingMessaDomenicaleId = null;
  document.getElementById('messaDomenicaleForm').reset();
  document.getElementById('messa-domenicale-edit-id').value = '';
  document.getElementById('messa-domenicale-day').value = '0';
  document.getElementById('messa-domenicale-ora').value = '10:00';
  document.getElementById('messa-domenicale-con-turno').checked = true;
  setTurniFormMode(false);
}

function toggleMessaDomenicaleTurno(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const m = state.gruppiConfig.messeDomenicali.find(x => x.id === id);
  if (!m) return;
  const currentTurni = getTurniSlot().length;
  if (m.conTurno && currentTurni <= 1) {
    showToast('Serve almeno una messa con squadra');
    return;
  }
  const newCount = m.conTurno ? currentTurni - 1 : currentTurni + 1;
  if (!confirmOrphanGruppi(newCount)) return;
  m.conTurno = !m.conTurno;
  if (m.conTurno && m.dayOffset === -1) m.vigilia = true;
  if (!m.conTurno) m.vigilia = !!m.vigilia;
  afterGruppiConfigChange();
  showToast(m.conTurno ? 'Messa con squadra — gruppo attivato' : 'Messa libera');
}

function deleteMessaDomenicale(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const m = state.gruppiConfig.messeDomenicali.find(x => x.id === id);
  if (!m) return;
  if (getMesseDomenicali().length <= 1) {
    showToast('Serve almeno una celebrazione domenicale');
    return;
  }
  if (m.conTurno && getTurniSlot().length <= 1) {
    showToast('Serve almeno una messa con squadra');
    return;
  }
  const newCount = m.conTurno ? getTurniSlot().length - 1 : getTurniSlot().length;
  if (!confirmOrphanGruppi(newCount)) return;
  if (!confirm('Eliminare questa celebrazione dalla struttura domenicale?')) return;
  state.gruppiConfig.messeDomenicali = state.gruppiConfig.messeDomenicali.filter(x => x.id !== id);
  if (editingMessaDomenicaleId === id) cancelMessaDomenicaleEdit();
  afterGruppiConfigChange();
  showToast('Celebrazione rimossa');
}

function resetGruppiConfig() {
  if (!requireAdminAction('Solo l\'admin può ripristinare la configurazione')) return;
  if (!confirm('Ripristinare la configurazione predefinita (5 celebrazioni, 3 con squadra, 3 gruppi)?')) return;
  state.gruppiConfig = JSON.parse(JSON.stringify(DEFAULT_GRUPPI_CONFIG));
  cancelMessaDomenicaleEdit();
  afterGruppiConfigChange();
  showToast('Configurazione ripristinata');
}

// ── Turni ───────────────────────────────────────────────────
function renderTurni() {
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
  updateTurniPanelMeta();
  if (turniTab === 'anteprima') renderRotazioneAnteprima();
  else if (turniTab === 'gestione') renderRotazioneGestione();
  else if (turniTab === 'cronologia') renderRotazioneCronologia();
}

// ── Presenze ────────────────────────────────────────────────
function getPresenzaOggi(uuid) {
  return getPresenzaFor(uuid, getAppelloDate());
}

function renderAppelloParrocchiaTabsForSlot(slot, primaryGruppo) {
  const slotKey = slot ? getAppelloSlotKey(slot) : '_fallback';
  const activeTab = getAppelloTabForSlot(slotKey, primaryGruppo, slot);
  return renderAppelloParrocchiaTabsHtml(
    primaryGruppo,
    usesGlobalAppelloTabs() ? null : slotKey,
    activeTab,
    slot
  );
}

function toggleTuttiPresentiTab(checked) {
  const dateStr = getAppelloDate();
  const celebrations = getCelebrationsForAppelloDate(dateStr);
  const slot = getSelectedAppelloCelebration(celebrations);
  const chierichetti = getAppelloTabChierichetti(slot);
  if (!chierichetti.length) return;
  chierichetti.forEach(c => setDraftPresente(c.uuid, dateStr, slot, checked));
  renderAppello();
}

async function renderAppello() {
  const container = document.getElementById('appello-list');
  const tabsWrap = document.getElementById('appello-parrocchia-tabs-wrap');
  const subtitle = document.getElementById('appello-subtitle');
  if (!container) return;

  const dateStr = getAppelloDate();
  container.innerHTML = '<p class="empty-state appello-loading">Caricamento…</p>';
  if (subtitle) subtitle.textContent = 'Caricamento…';
  const picker = document.getElementById('appello-messe-picker');
  if (picker) picker.innerHTML = '';
  if (tabsWrap) tabsWrap.innerHTML = '';

  try {
    await ensureCalendarioForYear(dateStr.slice(0, 4));
    await loadCerimonieriAccounts();
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="empty-state">Impossibile caricare l'appello.<br>${esc(err.message || 'Riprova')}</p>`;
    if (subtitle) subtitle.textContent = 'Errore di caricamento';
    updateAppelloSaveBar(dateStr, null, { hasPeople: false });
    return;
  }

  const celebrations = getCelebrationsForAppelloDate(dateStr);
  const slot = getSelectedAppelloCelebration(celebrations);
  const primaryGruppo = slot
    ? getAppelloPrimaryGruppoForSlot(slot)
    : (getAppelloPrimaryGruppo() || getGruppiServizioForDate(dateStr)[0] || '');

  renderAppelloMessePicker(celebrations, dateStr);

  if (!celebrations.length) {
    resetAppelloSummary(dateStr, null);
    if (tabsWrap) tabsWrap.innerHTML = renderAppelloParrocchiaTabsForSlot(null, primaryGruppo);
    const { list } = getAppelloFilteredList();
    const people = getAppelloTabChierichetti(null);
    const isToday = dateStr === getTodayStr();
    if (subtitle) {
      subtitle.textContent = people.length
        ? 'Nessuna messa — appello giornaliero'
        : (isToday ? 'Nessuna messa in agenda per oggi' : 'Nessuna messa in agenda');
    }
    if (people.length) {
      container.innerHTML = renderAppelloFallback(dateStr, list, primaryGruppo);
    } else {
      container.innerHTML = `
        <div class="empty-state appello-empty-messe">
          <p>${isToday
            ? 'Controlla l\'agenda messe o cambia data per fare l\'appello.'
            : 'Seleziona un\'altra data oppure apri l\'agenda messe.'}</p>
          <button type="button" class="btn btn-secondary" onclick="showSection('messe')">Apri agenda messe</button>
        </div>`;
    }
    updateAppelloSaveBar(dateStr, null, { hasPeople: people.length > 0 });
    return;
  }

  if (slot) {
    updateAppelloSummary(dateStr, slot);
    if (tabsWrap) tabsWrap.innerHTML = renderAppelloParrocchiaTabsForSlot(slot, primaryGruppo);
    container.innerHTML = renderAppelloMessaContent(slot, dateStr);
    const people = getAppelloTabChierichetti(slot);
    updateAppelloSaveBar(dateStr, slot, { hasPeople: people.length > 0 });
    return;
  }

  const { list } = getAppelloFilteredList();
  if (!list.length) {
    resetAppelloSummary(dateStr, null);
    if (tabsWrap) tabsWrap.innerHTML = renderAppelloParrocchiaTabsForSlot(null, primaryGruppo);
    if (subtitle) subtitle.textContent = 'Nessun risultato';
    container.innerHTML = '<p class="empty-state">Nessun chierichetto corrisponde alla ricerca.</p>';
    updateAppelloSaveBar(dateStr, null, { hasPeople: false });
    return;
  }

  updateAppelloSummary(dateStr, null);
  if (tabsWrap) tabsWrap.innerHTML = renderAppelloParrocchiaTabsForSlot(null, primaryGruppo);
  if (subtitle) subtitle.textContent = 'Appello giornaliero';
  container.innerHTML = renderAppelloFallback(dateStr, list, primaryGruppo);
  updateAppelloSaveBar(dateStr, null, { hasPeople: getAppelloTabChierichetti(null).length > 0 });
}

// ── Agenda messe (domeniche + eccezioni) ────────────────────
function getMesseAnno() {
  return document.getElementById('anno-messe').value;
}

function getSundaysInYear(anno) {
  const dates = [];
  const d = new Date(anno, 0, 1);
  while (d.getFullYear() === anno) {
    if (d.getDay() === 0) {
      dates.push(formatDateFromDate(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function formatDateFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMessaExtraForDate(dateStr) {
  return (state.messeExtra || []).find(m => m.data === dateStr);
}

function getMessaInfo(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDay() === 0) return { type: 'domenica' };
  const extra = getMessaExtraForDate(dateStr);
  if (extra) return { type: 'extra', extra };
  return null;
}

function getMesseDatesForYear(anno) {
  const set = new Set(getSundaysInYear(anno));
  (state.messeExtra || []).forEach(m => {
    if (m.data.startsWith(String(anno))) set.add(m.data);
  });
  return [...set].sort();
}

function getTurniForDate(dateStr) {
  return state.turni.filter(t => t.data === dateStr);
}

async function loadMesseAgenda() {
  const container = document.getElementById('messe-agenda');
  if (messeState.loading) return;

  messeState.loading = true;
  container.innerHTML = '<div class="cal-loading">Caricamento agenda…</div>';

  await ensureCalendarioForYear(getMesseAnno());
  updateMesseAgendaSummary();
  renderMesseAgenda();

  if (messeState.selectedDate) {
    renderMessaDetail(messeState.selectedDate);
  } else if (isMesseMobile()) {
    ensureNextMessaSelected();
  }

  messeState.loading = false;
  syncMesseFab();
}

function ensureNextMessaSelected() {
  if (!isMesseMobile()) return;
  if (messeState.selectedDate) {
    renderMessaDetail(messeState.selectedDate);
    return;
  }
  const anno = parseInt(getMesseAnno(), 10);
  const today = getTodayStr();
  let dates = getMesseDatesForYear(anno);
  if (!messeState.showPast) dates = dates.filter(d => d >= today);
  const target = dates.find(d => d >= today) || dates[0];
  if (!target) return;
  messeState.selectedDate = target;
  renderMesseAgenda();
  renderMessaDetail(target);
  // Non aprire lo sheet e non scrollare: evita che il titolo mese finisca sotto la topbar
}

function toggleMessePast() {
  messeState.showPast = document.getElementById('messe-show-past').checked;
  renderMesseAgenda();
}

function onMesseYearChange() {
  messeState.selectedDate = null;
  document.getElementById('messa-detail').innerHTML =
    '<p class="day-detail-empty empty-state-inline">Seleziona una messa dall\'agenda</p>';
  loadMesseAgenda();
}

function getMessaAgendaTitle(dateStr, massInfo, primary) {
  if (massInfo?.type === 'extra' && massInfo.extra?.nota) return massInfo.extra.nota;
  if (primary?.nome) return primary.nome;
  return massInfo?.type === 'extra' ? 'Messa straordinaria' : 'Domenica';
}

function buildMessaAgendaItem(dateStr) {
  const todayStr = getTodayStr();
  const massInfo = getMessaInfo(dateStr);
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = primaryEvent(events) || events[0];
  const turni = getTurniForAgendaDate(dateStr);
  const d = new Date(dateStr + 'T12:00:00');
  const isToday = dateStr === todayStr;
  const isPast = dateStr < todayStr;
  const isSelected = dateStr === messeState.selectedDate;
  const title = getMessaAgendaTitle(dateStr, massInfo, primary);
  const typeLabel = massInfo?.type === 'extra' ? 'Eccezione' : 'Domenica';
  const weekday = d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
  const isDomenica = massInfo?.type === 'domenica';
  const nTurni = getTurniPerDomenica();
  const assignedSlots = isDomenica ? countAssignedSlots(dateStr) : turni.length;
  const coverageComplete = isDomenica && nTurni > 0 && assignedSlots >= nTurni;
  const coverageWarn = isDomenica && nTurni > 0 && assignedSlots < nTurni;

  const classes = ['messe-agenda-item'];
  if (isToday) classes.push('today');
  if (isPast) classes.push('past');
  if (isSelected) classes.push('selected');
  if (coverageComplete) classes.push('has-turno', 'is-covered');
  else if (assignedSlots > 0) classes.push('has-turno');
  if (coverageWarn) classes.push('is-uncovered');
  if (massInfo?.type === 'extra') classes.push('extra');

  const metaParts = [typeLabel];
  if (primary?.tipoLabel && primary.tipoLabel !== 'Feriale') metaParts.push(primary.tipoLabel);
  if (isDomenica && nTurni > 0) metaParts.push(`${assignedSlots}/${nTurni} coperte`);
  else if (!isDomenica && turni.length) metaParts.push('Con servizio');
  const metaLine = metaParts.join(' · ');

  return `
    <article class="${classes.join(' ')}" id="messa-item-${dateStr}" data-date="${dateStr}" onclick="selectMessaDay('${dateStr}')">
      <div class="messe-agenda-date">
        <span class="messe-agenda-day">${d.getDate()}</span>
        <span class="messe-agenda-weekday">${esc(weekday)}</span>
      </div>
      <div class="messe-agenda-main">
        <p class="messa-agenda-title">${esc(title)}</p>
        <p class="messa-agenda-meta">${esc(metaLine)}</p>
      </div>
    </article>
  `;
}

function renderMesseAgenda() {
  const container = document.getElementById('messe-agenda');
  const anno = parseInt(getMesseAnno(), 10);
  const today = getTodayStr();
  let dates = getMesseDatesForYear(anno);

  if (!messeState.showPast) {
    dates = dates.filter(d => d >= today);
  }

  if (!dates.length) {
    container.innerHTML = `<p class="empty-state">${messeState.showPast ? 'Nessuna messa in agenda per questo anno' : 'Nessuna messa in programma. Attiva "Mostra messe passate" per vedere quelle già celebrate.'}</p>`;
    return;
  }

  const byMonth = {};
  dates.forEach(dateStr => {
    const monthKey = dateStr.slice(0, 7);
    if (!byMonth[monthKey]) byMonth[monthKey] = [];
    byMonth[monthKey].push(dateStr);
  });

  let html = '';
  Object.keys(byMonth).sort().forEach(monthKey => {
    const [y, m] = monthKey.split('-');
    html += `
      <section class="messe-agenda-group">
        <h4 class="messe-agenda-month-title">${MONTHS[parseInt(m, 10) - 1]} ${y}</h4>
        <div class="messe-agenda-list">
          ${byMonth[monthKey].map(buildMessaAgendaItem).join('')}
        </div>
      </section>
    `;
  });

  container.innerHTML = html;
}

function goMesseToday() {
  const today = getTodayStr();
  document.getElementById('anno-messe').value = today.slice(0, 4);

  loadMesseAgenda().then(() => {
    const anno = parseInt(getMesseAnno(), 10);
    const dates = getMesseDatesForYear(anno);
    const target = dates.find(d => d >= today) || dates[dates.length - 1];
    if (target) selectMessaDay(target, true);
  });
}

function selectMessaDay(dateStr, scrollIntoView) {
  messeState.selectedDate = dateStr;
  closeMesseExtraPanel();
  renderMesseAgenda();
  renderMessaDetail(dateStr);
  openMesseSheet('detail');

  if (scrollIntoView && !isMesseMobile()) {
    requestAnimationFrame(() => {
      const el = document.getElementById('messa-item-' + dateStr);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
}

function isMesseMobile() {
  return isPhoneShell();
}

function syncMesseFab() {
  const fab = document.getElementById('messe-fab');
  if (!fab) return;
  const onMesse = document.getElementById('messe')?.classList.contains('active');
  const show = !!(onMesse && isMesseMobile() && !document.body.classList.contains('messe-sheet-open'));
  fab.hidden = !show;
  fab.classList.toggle('is-visible', show);
}

function openMesseSheet(mode) {
  if (!isMesseMobile()) {
    if (mode === 'add') openMesseExtraPanel();
    return;
  }
  const sheetMode = mode === 'add' ? 'add' : 'detail';
  document.body.classList.add('messe-sheet-open');
  document.body.classList.toggle('messe-sheet-detail', sheetMode === 'detail');
  document.body.classList.toggle('messe-sheet-add', sheetMode === 'add');
  syncMesseFab();
}

function closeMesseSheet() {
  closeMessaNotaModal();
  closeMesseExtraPanel();
  document.body.classList.remove('messe-sheet-open', 'messe-sheet-detail', 'messe-sheet-add');
  syncMesseFab();
}

function openMesseExtraPanel() {
  document.body.classList.add('messe-extra-open');
  const panel = document.getElementById('messe-extra-panel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMesseExtraPanel() {
  document.body.classList.remove('messe-extra-open');
}

function closeMesseExtraUi() {
  closeMesseExtraPanel();
  if (isMesseMobile()) closeMesseSheet();
}

function openMesseExtraSheet() {
  openMesseSheet('add');
  requestAnimationFrame(() => {
    document.getElementById('messa-extra-data')?.focus();
  });
}

function isGruppiMobile() {
  return isPhoneShell();
}

function syncGruppiFab() {
  const fab = document.getElementById('gruppi-fab');
  if (!fab) return;
  const onGruppi = document.getElementById('gruppi')?.classList.contains('active');
  const onGestione = gruppiTab === 'gestione';
  const sheetOpen = document.body.classList.contains('gruppi-sheet-open');
  const editOpen = document.body.classList.contains('gruppi-edit-open');
  const show = !!(onGruppi && onGestione && isGruppiMobile() && !sheetOpen && !editOpen && isCurrentUserAdmin());
  fab.hidden = !show;
  fab.classList.toggle('is-visible', show);
}

function openGruppiFormSheet() {
  if (!isGruppiMobile()) return;
  const wrap = document.getElementById('gruppi-gestione-form-wrap');
  if (!wrap) return;
  wrap.classList.remove('is-collapsed');
  document.body.classList.add('gruppi-sheet-open');
  syncGruppiFab();
  requestAnimationFrame(() => {
    document.getElementById('nuovo-gruppo-nome')?.focus();
  });
}

function closeGruppiFormSheet() {
  const wrap = document.getElementById('gruppi-gestione-form-wrap');
  if (wrap) wrap.classList.add('is-collapsed');
  document.body.classList.remove('gruppi-sheet-open');
  syncGruppiFab();
}

function toggleRegistroFilters() {
  const filters = document.getElementById('registro-filters');
  const btn = document.getElementById('btn-registro-filters');
  if (!filters) return;
  const open = !filters.classList.contains('is-open');
  filters.classList.toggle('is-open', open);
  syncRegistroFiltersToggle();
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncRegistroFiltersToggle() {
  const btn = document.getElementById('btn-registro-filters');
  const filters = document.getElementById('registro-filters');
  if (!btn) return;
  const mese = document.getElementById('registro-filter-mese')?.value;
  const stato = document.getElementById('registro-filter-stato')?.value;
  const gruppo = document.getElementById('registro-filter-gruppo')?.value;
  const sede = document.getElementById('registro-filter-sede')?.value;
  const open = !!filters?.classList.contains('is-open');
  btn.classList.toggle('is-active', open || !!(mese || stato || gruppo || sede));
}

function renderMessaDetail(dateStr) {
  const container = document.getElementById('messa-detail');
  const massInfo = getMessaInfo(dateStr);
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = primaryEvent(events) || events[0];
  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  if (!massInfo) {
    container.innerHTML = `
      <p class="day-detail-date">${esc(dateLabel)}</p>
      <p class="day-detail-empty empty-state-inline">Non è una messa in agenda (solo domeniche e eccezioni).</p>
      <div class="messa-actions">
        <button type="button" class="btn btn-primary" onclick="prefillMessaExtra('${dateStr}')">Aggiungi messa straordinaria</button>
      </div>
    `;
    return;
  }

  const badgeClass = massInfo.type === 'extra' ? 'eccezione' : 'domenica';
  const badgeLabel = massInfo.type === 'extra'
    ? (massInfo.extra.nota ? esc(massInfo.extra.nota) : 'Messa straordinaria')
    : 'Domenica';

  const notaMessaHtml = renderMessaNotaFieldHtml(dateStr, {
    label: 'Indicazioni del don'
  });

  let turniHtml = '';
  if (massInfo.type === 'domenica') {
    const allSlots = getMesseOrdinarieSlots(dateStr);
    const assigned = countAssignedSlots(dateStr);
    const nCelebrazioni = allSlots.length;
    const nTurni = getTurniPerDomenica();
    const nSenza = getMesseSenzaChierichetti().length;
    const sediSenza = [...new Set(getMesseSenzaChierichetti().map(m => SEDI_LABEL[m.sede] || m.sede))].join(', ');
    const senzaLabel = nSenza
      ? `${nSenza} ${nSenza === 1 ? 'libera' : 'libere'} a ${sediSenza}`
      : '';
    turniHtml = `
      <p class="liturgy-meta" style="margin-bottom:10px">${nCelebrazioni} celebrazioni · ${assigned}/${nTurni} messe coperte${senzaLabel ? ' · ' + esc(senzaLabel) : ''}</p>
      ${renderMessaSlotsHtml(allSlots, { withNotes: true, messaDate: dateStr })}
    `;
  } else {
    const ex = massInfo.extra;
    const ora = ex?.ora || '10:00';
    const sede = ex?.sede || 'santuario';
    const extraSlot = {
      data: dateStr,
      ora,
      sede,
      sedeLabel: SEDI_LABEL[sede] || sede,
      conChierichetti: true,
      vigilia: false,
      turno: null,
      gruppo: null,
      gruppoLabel: null
    };
    const turni = getTurniForDate(dateStr);
    let assignedHtml = '';
    if (!turni.length) {
      assignedHtml = '<p class="empty-state" style="margin-top:8px">Nessuna squadra assegnata</p>';
    } else {
      assignedHtml = `<div class="messa-turni-list">${turni.map(t => `
        <div class="messa-turno-item">
          <span><strong>${esc(sedeLabel(t.parrocchia))}</strong> · ${esc(t.oraInizio)}–${esc(t.oraFine)} · ${t.numeroChierichetti} chier.</span>
        </div>
      `).join('')}</div>`;
    }
    turniHtml = `
      ${renderMessaSlotsHtml([extraSlot], { withNotes: true, messaDate: dateStr })}
      ${assignedHtml}
    `;
  }

  container.innerHTML = `
    <span class="messa-type-badge ${badgeClass}">${badgeLabel}</span>
    <p class="day-detail-date">${esc(dateLabel)}</p>
    ${primary ? `
      <p class="today-liturgy-name" style="font-size:1rem;margin:0 0 4px">${esc(primary.nome)}</p>
      <p class="liturgy-meta">${esc(primary.tipoLabel || primary.tipo)}${primary.colore ? ' · Tempo ' + esc(primary.colore) : ''}</p>
    ` : '<p class="liturgy-meta">Nessuna solennità particolare nel calendario liturgico</p>'}
    ${notaMessaHtml}
    <h4 style="font-size:0.82rem;margin:16px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">${massInfo.type === 'domenica' ? 'Messe e celebrazioni' : 'Messe di servizio'}</h4>
    ${turniHtml}
    <div class="messa-actions">
      ${massInfo.type === 'extra' ? `<button type="button" class="btn btn-secondary" onclick="removeMessaExtra('${massInfo.extra.uuid}')">Rimuovi eccezione</button>` : ''}
    </div>
  `;
}

function removeMessaExtra(uuid) {
  if (!confirm('Rimuovere questa messa straordinaria dall\'agenda?')) return;
  const removed = (state.messeExtra || []).find(m => m.uuid === uuid);
  state.messeExtra = state.messeExtra.filter(m => m.uuid !== uuid);
  if (removed?.data) {
    delete ensureMesseIndicazioni()[removed.data];
  }
  saveData();
  void persistConfig();
  showToast('Messa straordinaria rimossa');
  messeState.selectedDate = null;
  loadMesseAgenda();
}

function prefillMessaExtra(dateStr) {
  document.getElementById('messa-extra-data').value = dateStr;
  openMesseSheet('add');
  document.getElementById('messa-extra-nota')?.focus();
}

// ── Calendario (Ambrosiano) ──────────────────────────────────
function getCalAnno() {
  return document.getElementById('anno-calendario').value;
}

function onCalYearChange() {
  calState.selectedDate = null;
  loadCalendario();
}

function changeCalMonth(delta) {
  calState.month += delta;
  const sel = document.getElementById('anno-calendario');
  let anno = parseInt(sel.value, 10);

  if (calState.month < 0) {
    calState.month = 11;
    sel.value = String(anno - 1);
    loadCalendario();
    return;
  }
  if (calState.month > 11) {
    calState.month = 0;
    sel.value = String(anno + 1);
    loadCalendario();
    return;
  }
  renderCalMonth();
}

function goCalToday() {
  const today = new Date();
  document.getElementById('anno-calendario').value = today.getFullYear();
  calState.month = today.getMonth();
  calState.selectedDate = getTodayStr();
  loadCalendario().then(() => selectCalDay(calState.selectedDate));
}

function mapLitCalColor(raw) {
  const c = String(raw || '').toLowerCase();
  if (c.includes('verd')) return 'verde';
  if (c.includes('ross')) return 'rosso';
  if (c.includes('bianc') || c.includes('white')) return 'bianco';
  if (c.includes('viol') || c.includes('morell') || c.includes('ner') || c.includes('rosa') || c.includes('purple')) return 'viola';
  return '';
}

/** Ordinali italiani → numeri romani (solo prima di «domenica» / «settimana»). */
const LIT_ORDINAL_ROMAN = {
  prima: 'I', seconda: 'II', terza: 'III', quarta: 'IV', quinta: 'V',
  sesta: 'VI', settima: 'VII', ottava: 'VIII', nona: 'IX', decima: 'X',
  undicesima: 'XI', dodicesima: 'XII', tredicesima: 'XIII',
  quattordicesima: 'XIV', quindicesima: 'XV', sedicesima: 'XVI',
  diciassettesima: 'XVII', diciottesima: 'XVIII', diciannovesima: 'XIX',
  ventesima: 'XX', ventunesima: 'XXI', ventiduesima: 'XXII',
  ventitreesima: 'XXIII', ventiquattresima: 'XXIV', venticinquesima: 'XXV',
  ventiseiesima: 'XXVI', ventisettesima: 'XXVII', ventottesima: 'XXVIII',
  ventinovesima: 'XXIX', trentesima: 'XXX', trentunesima: 'XXXI',
  trentaduesima: 'XXXII', trentatreesima: 'XXXIII', trentaquattresima: 'XXXIV'
};

/**
 * Normalizza titoli LitCal IT: numeri romani + Martirio completo
 * (LitCal tronca «dopo il Martirio»; Ambrosiano = di San Giovanni Battista).
 */
function formatLiturgicalNome(nome, eventKey) {
  let s = String(nome || '').trim();
  if (!s) return s;

  const key = String(eventKey || '');
  const isMartyrdomSeason = /^AfterPentecostMartyrdom/i.test(key)
    || /^BeheadingStJohnBaptist$/i.test(key)
    || /\b(?:dopo|precede)\s+il\s+Martirio(?!\s+di\b)/i.test(s)
    || /\bMartirio di S\.?\s*Giovanni\b/i.test(s);

  if (isMartyrdomSeason) {
    s = s.replace(/\bMartirio di S\.?\s*Giovanni(?:\s+il\s+Precursore)?\b/gi, 'Martirio di San Giovanni Battista');
    s = s.replace(/\bMartirio di San Giovanni il Precursore\b/gi, 'Martirio di San Giovanni Battista');
    s = s.replace(/\b(dopo|precede)\s+il\s+Martirio(?!\s+di\b)/gi, '$1 il Martirio di San Giovanni Battista');
  }

  s = s.replace(
    /\b(prima|seconda|terza|quarta|quinta|sesta|settima|ottava|nona|decima|undicesima|dodicesima|tredicesima|quattordicesima|quindicesima|sedicesima|diciassettesima|diciottesima|diciannovesima|ventesima|ventunesima|ventiduesima|ventitreesima|ventiquattresima|venticinquesima|ventiseiesima|ventisettesima|ventottesima|ventinovesima|trentesima|trentunesima|trentaduesima|trentatreesima|trentaquattresima)\s+(domenica|settimana)\b/gi,
    (_, ord, noun) => {
      const roman = LIT_ORDINAL_ROMAN[ord.toLowerCase()];
      return roman ? `${roman} ${noun.toLowerCase()}` : `${ord} ${noun}`;
    }
  );

  s = s.replace(/\s+Messa della vigilia\b/i, ' — Messa della vigilia');
  return s;
}

function normalizeCalendarioPack(data) {
  if (!data?.byDate) return data;
  const fix = (ev) => {
    if (!ev || typeof ev !== 'object') return ev;
    const nome = formatLiturgicalNome(ev.nome, ev.eventKey || ev.event_key);
    return nome === ev.nome ? ev : { ...ev, nome };
  };
  const byDate = {};
  Object.keys(data.byDate).forEach((d) => {
    byDate[d] = (data.byDate[d] || []).map(fix);
  });
  const events = Array.isArray(data.events) ? data.events.map(fix) : data.events;
  return { ...data, byDate, events };
}

function mapLitCalEvent(ev, dateStr, anno) {
  const grade = Number(ev.grade);
  let tipo = 'feriale';
  let grado = '';
  let tipoLabel = ev.grade_lcl || '';
  if (grade >= 6) {
    tipo = 'solennita';
    grado = 'S';
    tipoLabel = tipoLabel || 'Solennità';
  } else if (grade >= 4) {
    tipo = 'festa';
    grado = 'F';
    tipoLabel = tipoLabel || 'Festa';
  } else if (grade === 3) {
    tipo = 'memoria';
    grado = 'M';
    tipoLabel = tipoLabel || 'Memoria';
  } else if (grade === 2) {
    tipo = 'memoria';
    grado = 'm';
    tipoLabel = tipoLabel || 'Memoria facoltativa';
  } else {
    tipoLabel = tipoLabel || 'Feriale';
  }

  const colorRaw = Array.isArray(ev.color_lcl) ? ev.color_lcl[0]
    : (ev.color_lcl || (Array.isArray(ev.color) ? ev.color[0] : ev.color) || '');
  const mmdd = dateStr.slice(5).replace('-', '');
  const eventKey = ev.event_key || '';

  return {
    data: dateStr,
    nome: formatLiturgicalNome(ev.name || '', eventKey),
    tipo,
    tipoLabel,
    grado,
    colore: mapLitCalColor(colorRaw),
    url: `https://gcatholic.org/calendar/${anno}/Ambrosian-it#${mmdd}`,
    eventKey: eventKey || undefined
  };
}

async function fetchAmbrosianCalendarYear(anno) {
  const y = String(anno);
  const url = `https://litcal.johnromanodorazio.com/api/dev/calendar/ambrosian/${encodeURIComponent(y)}?locale=it&return_type=JSON`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download calendario non riuscito (HTTP ' + res.status + ')');
  const json = await res.json();
  const rows = Array.isArray(json.litcal) ? json.litcal : [];
  const byDate = {};
  const events = [];
  rows.forEach(ev => {
    const dateStr = String(ev.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const mapped = mapLitCalEvent(ev, dateStr, y);
    if (!mapped.nome) return;
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(mapped);
    events.push(mapped);
  });
  if (!Object.keys(byDate).length) throw new Error('Calendario vuoto per l\'anno ' + y);
  return {
    anno: y,
    events,
    byDate,
    source: `https://gcatholic.org/calendar/${y}/Ambrosian-it`,
    fetchedAt: new Date().toISOString(),
    provider: 'litcal-ambrosian'
  };
}

async function loadCalendario(refresh) {
  const anno = getCalAnno();
  const container = document.getElementById('calendario-container');
  if (calState.loading) return;

  calState.loading = true;
  container.innerHTML = '<div class="cal-loading">Caricamento calendario liturgico…</div>';

  try {
    let data;
    if (isGAS) {
      data = await gasRun('getCalendarioLiturgico', anno, !!refresh);
    } else if (isSupabase) {
      if (refresh) {
        data = await fetchAmbrosianCalendarYear(anno);
        const saved = await window.ChierichSupabase.salvaCalendarioLiturgico(anno, data);
        if (!saved.success) throw new Error(saved.message || 'Salvataggio in cache non riuscito');
      } else {
        data = await window.ChierichSupabase.getCalendarioLiturgico(anno);
        if (!data?.byDate || !Object.keys(data.byDate).length) {
          data = await fetchAmbrosianCalendarYear(anno);
          await window.ChierichSupabase.salvaCalendarioLiturgico(anno, data);
        }
      }
    } else {
      const url = `${API_BASE}/api/calendario/${anno}${refresh ? '?refresh=1' : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Errore HTTP ' + res.status);
      data = await res.json();
    }

    if (!data?.byDate) throw new Error('Dati calendario non validi');
    data = normalizeCalendarioPack(data);
    if (!Object.keys(data.byDate).length) {
      calState.data = data;
      calState.unavailable = true;
      container.innerHTML = `<p class="empty-state">Calendario liturgico non disponibile.<br>Riprova con «Aggiorna» oppure più tardi.</p>`;
      updateCalSource();
      return;
    }
    calState.data = data;
    calState.unavailable = false;
    renderCalMonth();
    ensureCalDaySelected();
    renderProssimeCelebrazioni();
    updateCalSource();

    if (refresh) showToast('Calendario aggiornato');
  } catch (err) {
    console.error(err);
    calState.unavailable = true;
    container.innerHTML = `<p class="empty-state">Calendario liturgico non disponibile.<br>${esc(err.message)}<br><button type="button" class="btn btn-secondary" style="margin-top:12px" onclick="loadCalendario(true)">Riprova</button></p>`;
    showToast('Errore caricamento calendario');
  } finally {
    calState.loading = false;
  }
}

function updateCalSource() {
  const el = document.getElementById('cal-source');
  if (!calState.data?.source) { el.textContent = ''; return; }
  const when = calState.data.fetchedAt
    ? new Date(calState.data.fetchedAt).toLocaleString('it-IT')
    : '';
  el.innerHTML = `Fonte: <a href="${esc(calState.data.source)}" target="_blank" rel="noopener">Calendario Ambrosiano Comune ${esc(calState.data.anno)}</a>${when ? ` · aggiornato ${esc(when)}` : ''}`;
}

function primaryEvent(events) {
  if (!events?.length) return null;
  const important = events.find(e => ['solennita', 'festa', 'memoria'].includes(e.tipo));
  return important || events[0];
}

function liturgyMarkerLetter(primary) {
  if (!primary) return '';
  if (primary.grado === 'S' || primary.tipo === 'solennita') return 'S';
  if (primary.grado === 'F' || primary.tipo === 'festa') return 'F';
  if (primary.grado === 'M' || primary.tipo === 'memoria') return 'M';
  if (primary.grado === 'm') return 'm';
  return '·';
}

function liturgyMarkerClass(primary) {
  if (!primary) return 'feriale';
  if (primary.tipo === 'solennita') return 'solemnity';
  if (primary.tipo === 'festa') return 'festa';
  if (primary.tipo === 'memoria') return 'memoria';
  return 'feriale';
}

function calDayAriaLabel(day, month, primary) {
  const dateLabel = `${day} ${MONTHS[month]}`;
  if (!primary) return dateLabel;
  return `${dateLabel} — ${primary.nome}`;
}

function renderCalMonth() {
  if (!calState.data?.byDate) return;

  const anno = parseInt(getCalAnno(), 10);
  const month = calState.month;
  const todayStr = getTodayStr();
  const filterImportant = document.getElementById('cal-filter-important')?.checked;
  const byDate = calState.data.byDate;

  document.getElementById('cal-month-label').textContent = `${MONTHS[month]} ${anno}`;

  const firstDay = getMondayFirstOffset(new Date(anno, month, 1));
  const daysInMonth = new Date(anno, month + 1, 0).getDate();

  let html = '<div class="calendar-weekdays">';
  WEEKDAYS.forEach(d => { html += `<span>${d}</span>`; });
  html += '</div><div class="calendar-grid">';

  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${anno}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const events = byDate[dateStr] || [];
    const primary = primaryEvent(events);
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === calState.selectedDate;

    const classes = ['calendar-day'];
    if (primary) {
      if (primary.tipo === 'solennita') classes.push('solemnity');
      else if (primary.tipo === 'festa') classes.push('festa');
      else if (primary.tipo === 'memoria') classes.push('memoria');
      if (primary.colore === 'verde') classes.push('col-verde');
      if (primary.colore === 'viola') classes.push('col-viola');
    }
    if (isToday) classes.push('today');
    if (isSelected) classes.push('selected');

    const showLabel = !filterImportant || (primary && ['solennita', 'festa', 'memoria'].includes(primary.tipo));
    const marker = showLabel && primary
      ? `<span class="day-liturgy-marker ${liturgyMarkerClass(primary)}" aria-hidden="true">${esc(liturgyMarkerLetter(primary))}</span>`
      : '';

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}" role="button" tabindex="0" aria-label="${esc(calDayAriaLabel(day, month, showLabel ? primary : null))}" onclick="selectCalDay('${dateStr}')">
      <div class="day-num">${day}</div>
      ${marker}
      ${showLabel && primary ? `<div class="day-feast">${esc(primary.nome)}</div>` : ''}
      ${showLabel && primary?.grado ? `<div class="day-rank">${esc(primary.grado)} · ${esc(primary.tipoLabel || primary.tipo)}</div>` : ''}
    </div>`;
  }

  html += '</div>';
  document.getElementById('calendario-container').innerHTML = html;
}

function selectCalDay(dateStr) {
  calState.selectedDate = dateStr;
  renderCalMonth();
  renderDayDetail(dateStr);
  if (window.matchMedia('(max-width: 1024px)').matches) {
    document.querySelector('#calendario .cal-day-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function ensureCalDaySelected() {
  if (!calState.data?.byDate) return;
  const anno = String(getCalAnno());
  const today = getTodayStr();
  if (!calState.selectedDate || !calState.selectedDate.startsWith(anno)) {
    if (today.startsWith(anno)) {
      calState.selectedDate = today;
      calState.month = new Date(today + 'T12:00:00').getMonth();
    } else {
      const m = String(calState.month + 1).padStart(2, '0');
      calState.selectedDate = `${anno}-${m}-01`;
    }
  }
  renderCalMonth();
  renderDayDetail(calState.selectedDate);
}

function renderDayDetail(dateStr) {
  const container = document.getElementById('day-detail');
  const events = calState.data?.byDate?.[dateStr] || [];
  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const massInfo = getMessaInfo(dateStr);
  const massBtn = massInfo
    ? `<button type="button" class="btn btn-secondary" style="margin-top:16px" onclick="showMassDetails('${dateStr}')">Vedi in agenda messe</button>`
    : '';

  if (!events.length) {
    container.innerHTML = `<p class="day-detail-date">${esc(dateLabel)}</p><p class="day-detail-empty empty-state-inline">Nessuna celebrazione registrata per questa data.</p>${massBtn}`;
    return;
  }

  container.innerHTML = `
    <p class="day-detail-date">${esc(dateLabel)}</p>
    <div class="liturgy-list">
      ${events.map(ev => `
        <div class="liturgy-item">
          <div class="liturgy-item-head">
            <p class="liturgy-item-name">${esc(ev.nome)}</p>
            ${ev.grado ? `<span class="liturgy-rank ${esc(ev.tipo)}">${esc(ev.grado)}</span>` : ''}
          </div>
          <p class="liturgy-meta">${esc(ev.tipoLabel || ev.tipo)}${ev.colore ? ' · Tempo ' + esc(ev.colore) : ''}</p>
          ${ev.url ? `<p class="liturgy-meta"><a href="${esc(ev.url)}" target="_blank" rel="noopener">Scheda GCatholic</a></p>` : ''}
        </div>
      `).join('')}
    </div>
    ${massBtn}
  `;
}

async function renderProssimeCelebrazioni() {
  const container = document.getElementById('prossime-celebrazioni');
  if (!container) return;

  try {
    if (!calState.data?.byDate) await loadCalendario(false);
    const byDate = calState.data?.byDate || {};
    const today = getTodayStr();
    const upcoming = [];
    Object.keys(byDate).sort().forEach(dateStr => {
      if (dateStr < today) return;
      const primary = primaryEvent(byDate[dateStr]);
      if (!primary || !['solennita', 'festa', 'memoria'].includes(primary.tipo)) return;
      upcoming.push({ data: dateStr, ...primary });
    });
    const list = upcoming.slice(0, 12);

    if (!list.length) {
      container.innerHTML = '<p class="empty-state">Nessuna celebrazione in programma</p>';
      return;
    }

    container.innerHTML = list.map(ev => {
      const d = new Date(ev.data + 'T12:00:00');
      const day = d.getDate();
      const monthShort = MONTHS[d.getMonth()].substring(0, 3);
      return `
        <div class="celebration-item" style="cursor:pointer" onclick="selectCalDay('${esc(ev.data)}')">
          <div class="celebration-date">${day}<small>${monthShort}</small></div>
          <div>
            <p class="celebration-name">${esc(ev.nome)}</p>
            <p class="celebration-type">${esc(ev.tipoLabel || ev.tipo)}${ev.grado ? ' · ' + esc(ev.grado) : ''}</p>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<p class="empty-state">Errore caricamento celebrazioni</p>';
  }
}

function showMassDetails(dateStr) {
  showSection('messe');
  document.getElementById('anno-messe').value = dateStr.slice(0, 4);
  loadMesseAgenda().then(() => selectMessaDay(dateStr, true));
}

// ── Form handlers ───────────────────────────────────────────
document.getElementById('messaExtraForm').addEventListener('submit', e => {
  e.preventDefault();

  const data = document.getElementById('messa-extra-data').value;
  const nota = document.getElementById('messa-extra-nota').value.trim();
  const ora = document.getElementById('messa-extra-ora').value || '10:00';
  const sede = document.getElementById('messa-extra-sede').value || 'santuario';

  if (!data) {
    showToast('Seleziona una data');
    return;
  }

  if (getMessaInfo(data)) {
    showToast('Questa data è già in agenda');
    return;
  }

  state.messeExtra.push({
    uuid: 'MES-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
    data,
    nota,
    ora,
    sede,
    createdAt: new Date().toISOString()
  });

  saveData();
  void persistConfig();
  showToast('Messa straordinaria aggiunta');
  e.target.reset();
  closeMesseExtraPanel();
  closeMesseSheet();
  document.getElementById('anno-messe').value = data.slice(0, 4);
  messeState.selectedDate = data;
  loadMesseAgenda().then(() => selectMessaDay(data, true));
});

document.getElementById('chierichettoForm').addEventListener('submit', async e => {
  e.preventDefault();

  const nome = document.getElementById('nome').value.trim();
  const annoNascita = document.getElementById('anno-nascita').value;
  const parrocchia = document.getElementById('parrocchia').value;

  if (!nome) {
    showToast('Inserisci nome e cognome');
    return;
  }
  if (!parrocchia) {
    showToast('Seleziona la parrocchia (Vanzago o Mantegazza)');
    return;
  }

  const existing = editingUuid ? state.chierichetti.find(c => c.uuid === editingUuid) : null;

  const dati = {
    nome,
    email: '',
    telefono: document.getElementById('telefono').value.trim(),
    telefono2: document.getElementById('telefono2').value.trim(),
    telefonoChi: document.getElementById('telefono-chi').value.trim(),
    telefono2Chi: document.getElementById('telefono2-chi').value.trim(),
    ruolo: 'chierichetto',
    annoNascita,
    parrocchia,
    cerimoniereTurno: false,
    promosso: false,
    gruppo: existing?.gruppo || '',
    attivo: existing ? isPersonaAttiva(existing) : true
  };

  if (existing?.gruppo && dati.parrocchia !== existing.parrocchia && !chierichettoCanJoinGruppo({ ...existing, parrocchia: dati.parrocchia }, existing.gruppo)) {
    if (!confirm(`Cambiando parrocchia, ${dati.nome} non sarà più compatibile con ${getGruppoLabel(existing.gruppo)}. Rimuoverlo dal gruppo?`)) return;
    dati.gruppo = '';
  }

  const btn = document.getElementById('btn-save-chierichetto');
  if (btn) btn.disabled = true;
  try {
    if (editingUuid) {
      const idx = state.chierichetti.findIndex(c => c.uuid === editingUuid);
      if (idx === -1) return;
      const prev = state.chierichetti[idx];
      state.chierichetti[idx] = { ...prev, ...dati };
      saveData();
      renderChierichetti();
      showToast('Chierichetto aggiornato');
      cancelEdit();
      const ok = await persistPersona(dati, editingUuid);
      if (!ok) {
        state.chierichetti[idx] = prev;
        saveData();
        renderChierichetti();
      }
    } else {
      const nuovo = {
        uuid: 'CHI-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase(),
        ...dati,
        createdAt: new Date().toISOString()
      };
      state.chierichetti.push(nuovo);
      saveData();
      renderChierichetti();
      showToast('Chierichetto registrato');
      e.target.reset();
      populateAnnoNascitaSelect();
      const ok = await persistPersona({ ...dati, uuid: nuovo.uuid });
      if (!ok) {
        state.chierichetti = state.chierichetti.filter(c => c.uuid !== nuovo.uuid);
        saveData();
        renderChierichetti();
      }
    }
  } finally {
    if (btn) btn.disabled = false;
  }
});

document.getElementById('promoteChierichettoForm')?.addEventListener('submit', handlePromoteChierichettoSubmit);

document.getElementById('nuovoGruppoForm')?.addEventListener('submit', createNuovoGruppoFromForm);

document.getElementById('messaDomenicaleForm').addEventListener('submit', e => {
  e.preventDefault();
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;

  const editId = document.getElementById('messa-domenicale-edit-id').value;
  const dayOffset = parseInt(document.getElementById('messa-domenicale-day').value, 10);
  const ora = document.getElementById('messa-domenicale-ora').value;
  const sede = document.getElementById('messa-domenicale-sede').value;
  const vigilia = document.getElementById('messa-domenicale-vigilia').checked;
  const conTurno = document.getElementById('messa-domenicale-con-turno').checked;

  const duplicate = getMesseDomenicali().find(m =>
    m.id !== editId && m.dayOffset === dayOffset && m.ora === ora && m.sede === sede
  );
  if (duplicate) {
    showToast('Esiste già una celebrazione con stesso giorno, ora e sede');
    return;
  }

  if (editId) {
    const m = state.gruppiConfig.messeDomenicali.find(x => x.id === editId);
    if (!m) return;
    const wasConTurno = !!m.conTurno;
    const currentTurni = getTurniSlot().length;
    let newCount = currentTurni;
    if (wasConTurno && !conTurno) newCount--;
    else if (!wasConTurno && conTurno) newCount++;
    if (wasConTurno && !conTurno && currentTurni <= 1) {
      showToast('Serve almeno una messa con squadra');
      return;
    }
    if (!confirmOrphanGruppi(newCount)) return;
    m.dayOffset = dayOffset;
    m.ora = ora;
    m.sede = sede;
    m.vigilia = vigilia || (dayOffset === -1 && conTurno);
    m.conTurno = conTurno;
    cancelMessaDomenicaleEdit();
    afterGruppiConfigChange();
    showToast('Celebrazione aggiornata');
  } else {
    state.gruppiConfig.messeDomenicali.push({
      id: 'md-' + Date.now(),
      dayOffset,
      ora,
      sede,
      vigilia: vigilia || (dayOffset === -1 && conTurno),
      conTurno
    });
    cancelMessaDomenicaleEdit();
    afterGruppiConfigChange();
    showToast('Celebrazione aggiunta');
  }
});

// ── Utilities ───────────────────────────────────────────────
function formatDate(str) {
  return new Date(str + (str.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('it-IT', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}

function inferToastType(message) {
  const msg = String(message || '');
  if (/errore|fallit|non riuscit|non valid|non puoi|scadut|obbligator|coincid|esiste già|serve almeno|seleziona |inserisci |conferma |non è ancora|non disponibile|spazio esaurit|riloggia|riprova/i.test(msg)) {
    return 'error';
  }
  return 'success';
}

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const kind = type === 'error' || type === 'success' || type === 'info'
    ? type
    : inferToastType(message);

  const toast = document.createElement('div');
  toast.className = `toast is-${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = kind === 'error'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>'
    : kind === 'info'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';

  const text = document.createElement('span');
  text.className = 'toast-msg';
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  const ttl = kind === 'error' ? 4200 : 3000;
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 280);
  }, ttl);
}

// ── Mock API (locale) ───────────────────────────────────────
if (!isGAS) {
  window.mockAPI = {
    getChierichetti: () => state.chierichetti,
    getTurni: () => state.turni,
    getPresenze: () => state.presenze
  };
}

// ── PWA service worker ──────────────────────────────────────
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !isLocal) return;

  let refreshing = false;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('Nuova versione in arrivo…');
            }
          });
        });
      })
      .catch((err) => console.warn('[ChierichApp] SW register failed', err));
  });
})();
