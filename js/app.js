// ── Config ──────────────────────────────────────────────────
const isSupabase = !!(window.CHIERICH_CONFIG?.supabaseUrl && window.CHIERICH_CONFIG?.supabaseAnonKey
  && !String(window.CHIERICH_CONFIG.supabaseUrl).includes('YOUR_PROJECT'));
const isGAS = !isSupabase && typeof google !== 'undefined' && google.script && google.script.host;
const STORAGE_KEY = 'chierichetti_data';
const MESSE_EXTRA_PENDING_KEY = 'chierichapp_messe_extra_pending';
const LITURGICAL_CONFIG_PENDING_KEY = 'chierichapp_liturgical_config_pending';
const CALENDAR_CACHE_PREFIX = 'chierichapp_calendario_';
const DATA_SCHEMA_VERSION = 6;

const PAGE_META = {
  dashboard:  { title: 'Oggi',       subtitle: 'Prossima messa, turni e scorciatoie' },
  presenze:   { title: 'Appello',    subtitle: 'Segna presenti e assenti al servizio' },
  registro:   { title: 'Registro',   subtitle: 'Storico presenze per anno pastorale' },
  messe:      { title: 'Messe',      subtitle: 'Agenda e calendario delle celebrazioni' },
  turni:      { title: 'Turni',      subtitle: 'Messe di servizio e rotazione squadre' },
  gruppi:     { title: 'Gruppi',     subtitle: 'Squadre di turno e assegnazioni' },
  anagrafica: { title: 'Anagrafica', subtitle: 'Chierichetti ed ex' },
  cerimonieri:{ title: 'Cerimonieri', subtitle: 'Gestione degli account e dei ruoli' },
  accessi:    { title: 'Accessi',    subtitle: 'Log di ogni login all’app' },
  calendario: { title: 'Struttura liturgica', subtitle: 'Calendario ambrosiano e modelli delle celebrazioni' },
  'strutture-messe': { title: 'Struttura liturgica', subtitle: 'Calendario → modelli → correzioni (servizio altare)' },
  info:       { title: 'Info sull’app', subtitle: 'Terminologia e struttura dell’app' },
  account:    { title: 'Account',    subtitle: 'Il tuo profilo e accesso' }
};

const GRUPPI_LABEL_LEGACY = {
  gruppo1: 'Gruppo 1',
  gruppo2: 'Gruppo 2',
  gruppo3: 'Gruppo 3',
  centrale: 'Centrale', nord: 'Nord', sud: 'Sud', est: 'Est', ovest: 'Ovest'
};
const SEDI_LABEL = {
  santuario: 'Santuario',
  vanzago: 'Vanzago',
  mantegazza: 'Mantegazza',
  cimitero: 'Cimitero Vanzago'
};
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
let registroLiturgicalDayIndex = 0;
let registroScope = 'giorno';
let registroOpenSlotKey = '';
let registroOpenGroupId = '';
let registroMassDetails = new Map();

/** Mesi dell'anno pastorale: agosto (apertura) + settembre … giugno */
const REGISTRO_PASTORAL_MONTHS = [7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5];
/** Primo anno pastorale gestito dall'app (2026/27) */
const REGISTRO_MIN_PASTORAL_START = 2026;
/** Giorni prima del 1° settembre in cui apre la finestra dell'anno pastorale */
const REGISTRO_PASTORAL_OPEN_DAYS_BEFORE = 14;

const DEFAULT_MESSE_DOMENICALI = [
  { id: 'slot1', dayOffset: -1, ora: '18:00', sede: 'santuario', vigilia: true, conTurno: true, turnoNum: 1 },
  { id: 'slot2', dayOffset: 0, ora: '08:30', sede: 'vanzago', vigilia: false, conTurno: true, turnoNum: 2 },
  { id: 'slot3', dayOffset: 0, ora: '11:15', sede: 'santuario', vigilia: false, conTurno: true, turnoNum: 3 },
  { id: 'msc1', dayOffset: 0, ora: '10:00', sede: 'mantegazza', vigilia: false, conTurno: false },
  { id: 'msc2', dayOffset: 0, ora: '18:00', sede: 'mantegazza', vigilia: false, conTurno: false }
];

/** Orario festivo di un solo giorno (senza vigilia) — Natale, Pasqua, 1 gen, Santo Stefano… */
const DEFAULT_MESSE_FESTIVE_GIORNO = [
  { id: 'fes1', dayOffset: 0, ora: '08:30', sede: 'vanzago', vigilia: false, conTurno: true, turnoNum: 1 },
  { id: 'fes2', dayOffset: 0, ora: '10:00', sede: 'mantegazza', vigilia: false, conTurno: false },
  { id: 'fes3', dayOffset: 0, ora: '11:15', sede: 'santuario', vigilia: false, conTurno: true, turnoNum: 2 }
];

/** Pattern domenicale con messa vigiliare la sera prima (Tutti i Santi, Epifania…) */
const DEFAULT_MESSE_CON_VIGILIA = [
  { id: 'vig1', dayOffset: -1, ora: '18:00', sede: 'santuario', vigilia: true, conTurno: true, turnoNum: 1 },
  { id: 'vig2', dayOffset: 0, ora: '08:30', sede: 'vanzago', vigilia: false, conTurno: true, turnoNum: 2 },
  { id: 'vig3', dayOffset: 0, ora: '10:00', sede: 'mantegazza', vigilia: false, conTurno: false },
  { id: 'vig4', dayOffset: 0, ora: '11:15', sede: 'santuario', vigilia: false, conTurno: true, turnoNum: 3 }
];

/** Metadati strutture messe (tempi liturgici + festivo generico) */
const STRUTTURA_KINDS = {
  domenicale: {
    id: 'domenicale',
    configKey: 'strutturaDomenicaleOrdinaria',
    label: 'Domenicale ordinario',
    shortLabel: 'Domenica',
    hint: 'Si applica a ogni domenica ordinaria (e alla vigilia del sabato)'
  },
  natalizio: {
    id: 'natalizio',
    configKey: 'strutturaTempoNatalizio',
    label: 'Tempo natalizio',
    shortLabel: 'Natale',
    hint: 'Preset e ferie del tempo; ha priorità sul domenicale ordinario'
  },
  pasquale: {
    id: 'pasquale',
    configKey: 'strutturaTempoPasquale',
    label: 'Tempo pasquale',
    shortLabel: 'Pasqua',
    hint: 'Triduo, Pasqua e ferie; ha priorità sul domenicale ordinario'
  },
  defunti: {
    id: 'defunti',
    configKey: 'strutturaTempoDefunti',
    label: 'Defunti / Tutti i Santi',
    shortLabel: 'Defunti',
    hint: '1–2 novembre e ferie della finestra; ha priorità sul domenicale'
  },
  festivo: {
    id: 'festivo',
    configKey: 'strutturaFestivoGenerico',
    label: 'Festivo generico',
    shortLabel: 'Festivo',
    hint: 'Solennità e feste a giorno singolo (anche se cadono di domenica)'
  }
};

/** Giorni-modello (= preset) mostrati in Modelli, raggruppati per categoria.
 *  `celebrationKey` = blocco celebrazione distinto sullo stesso giorno liturgico (`eventKey`).
 *  `dayPreset` = preset giorno usato in detectFestivityPreset / merge slot.
 */
const STRUTTURA_GIORNI_SPECIALI = {
  natalizio: [
    { presetId: 'christmasVigilEve', label: 'Vigilia', eventKey: 'Christmas_vigil', celebrationKey: 'vigilia', dayPreset: 'christmasVigil', dateHint: '24 dicembre' },
    { presetId: 'christmasNight', label: 'Notte', eventKey: 'Christmas_vigil', celebrationKey: 'notte', dayPreset: 'christmasVigil', dateHint: '24 dicembre' },
    { presetId: 'christmasDay', label: 'Natale', eventKey: 'Christmas', dateHint: '25 dicembre' },
    { presetId: 'stephen', label: 'Santo Stefano', eventKey: 'Stephen', dateHint: '26 dicembre' },
    { presetId: 'newYearEve', label: '31 dicembre', eventKey: 'NewYearEve', dateHint: 'Te Deum' },
    { presetId: 'newYearDay', label: '1° gennaio', eventKey: 'MaryMotherOfGod', dateHint: 'Ottava di Natale' },
    { presetId: 'epiphanyVigil', label: 'Vigilia Epifania', eventKey: 'Epiphany_vigil', dateHint: '5 gennaio' },
    { presetId: 'epiphanyDay', label: 'Epifania', eventKey: 'Epiphany', dateHint: '6 gennaio' },
    { presetId: 'seasonFallback', label: 'Ferie del tempo', eventKey: null, dateHint: 'Solo feriali lun–sab (non le domeniche)', usesSeasonTemplate: true, seasonKind: 'natalizio' }
  ],
  pasquale: [
    { presetId: 'holyThursLavanda', label: 'Lavanda dei Piedi', eventKey: 'HolyThurs', celebrationKey: 'lavanda', dayPreset: 'holyThurs', dateHint: 'Giovedì Santo' },
    { presetId: 'holyThursCena', label: 'Cena Domini', eventKey: 'HolyThurs', celebrationKey: 'cena', dayPreset: 'holyThurs', dateHint: 'Giovedì Santo' },
    { presetId: 'goodFriPassione', label: 'Passione del Signore', eventKey: 'GoodFri', celebrationKey: 'passione', dayPreset: 'goodFri', dateHint: 'Venerdì Santo' },
    { presetId: 'goodFriViaCrucis', label: 'Via Crucis', eventKey: 'GoodFri', celebrationKey: 'viaCrucis', dayPreset: 'goodFri', dateHint: 'Venerdì Santo' },
    { presetId: 'easterVigil', label: 'Veglia Pasquale', eventKey: 'EasterVigil', dateHint: 'Sabato Santo' },
    { presetId: 'easterDay', label: 'Pasqua', eventKey: 'Easter', dateHint: 'Domenica di Risurrezione' },
    { presetId: 'seasonFallback', label: 'Ferie del tempo', eventKey: null, dateHint: 'Solo feriali lun–sab (non le domeniche)', usesSeasonTemplate: true, seasonKind: 'pasquale' }
  ],
  defunti: [
    { presetId: 'allSaintsVigil', label: 'Vigilia Tutti i Santi', eventKey: 'AllSaints', celebrationKey: 'vigilia', dayPreset: 'allSaints', dateHint: '31 ottobre' },
    { presetId: 'allSaintsDay', label: 'Messe del giorno', eventKey: 'AllSaints', celebrationKey: 'giorno', dayPreset: 'allSaints', dateHint: '1 novembre' },
    { presetId: 'allSoulsVigil', label: 'Vespri dei Defunti', eventKey: 'AllSouls', celebrationKey: 'vespri', dayPreset: 'allSouls', dateHint: '1 novembre' },
    { presetId: 'allSoulsDay', label: 'Messe del giorno', eventKey: 'AllSouls', celebrationKey: 'giorno', dayPreset: 'allSouls', dateHint: '2 novembre' },
    { presetId: 'seasonFallback', label: 'Altri giorni della finestra', eventKey: null, dateHint: 'Solo feriali fuori dalle feste (non le domeniche)', usesSeasonTemplate: true, seasonKind: 'defunti' }
  ],
  festivo: [
    { presetId: 'solennita', label: 'Orario festivo', eventKey: null, dateHint: 'Giorno singolo senza vigilia', usesSeasonTemplate: true, seasonKind: 'festivo' },
    { presetId: 'solennitaConVigilia', label: 'Festivo con vigilia', eventKey: 'SolennitaConVigilia', dateHint: 'Vigilia 18 + giorno' }
  ]
};

const DEFAULT_GRUPPI_CONFIG = {
  gruppi: [
    { id: 'gruppo1', nome: 'Gruppo 1', ordine: 0 },
    { id: 'gruppo2', nome: 'Gruppo 2', ordine: 1 },
    { id: 'gruppo3', nome: 'Gruppo 3', ordine: 2 }
  ],
  /** @deprecated migrato in strutturaDomenicaleOrdinaria */
  messeDomenicali: JSON.parse(JSON.stringify(DEFAULT_MESSE_DOMENICALI)),
  /** @deprecated migrato in strutturaFestivoGenerico */
  messeFestive: JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO)),
  strutturaDomenicaleOrdinaria: JSON.parse(JSON.stringify(DEFAULT_MESSE_DOMENICALI)),
  strutturaTempoNatalizio: JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO)),
  strutturaTempoPasquale: JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO)),
  strutturaTempoDefunti: JSON.parse(JSON.stringify(DEFAULT_MESSE_CON_VIGILIA)),
  strutturaFestivoGenerico: JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO)),
  giorniLiturgici: {},
  festivitaEscluse: [],
  festivitaModelli: [],
  /** Date effettive per anno civile: { AllSaints: { '2026': '2026-10-31' }, ... } */
  festivitaDateOverrides: {},
  /** Se true: lun–sab senza servizio salvo tempi Natale/Pasqua/Defunti e solennità */
  escludiFerialiIntrasettimanali: false,
  rotazione: { attiva: false, inizioFinestra: null, fineFinestra: null, storicoFinestre: [] },
  cronologia: []
};

let editingMessaDomenicaleId = null;
/** Chiave in STRUTTURA_KINDS */
let strutturaMesseKind = 'domenicale';
/** Mese corrente in Correzioni (`YYYY-MM`), null = auto (primo mese con giorni / mese odierno). */
let strutturaCorrezioniMonthKey = null;
/** Tab hub calendario (legacy, non più usato in UI) */
let calendarioHubTab = 'ambrosiano';
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
  reloadQueued: false,
  showPast: false,
  view: localStorage.getItem('messe_view') === 'calendario' ? 'calendario' : 'agenda',
  month: new Date().getMonth()
};

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  moveStrutturaMesseToMesse();
  document.getElementById('auth-login-form').addEventListener('submit', handleAuthSubmit);
  document.getElementById('cerimoniereForm').addEventListener('submit', handleCerimoniereFormSubmit);
  document.getElementById('accountForm')?.addEventListener('submit', handleAccountFormSubmit);
  if (isGAS) prepareGoogleAuthUi();
  else if (isSupabase) prepareSupabaseAuthUi();
  initMobileMoreGestures();
  checkAuthAndInit();
});

// Navigazione a pagine: ogni sezione ha un proprio indirizzo condivisibile.
// Usiamo hash per mantenere il deploy statico compatibile con GitHub Pages.
const SECTION_ROUTES = {
  dashboard: 'oggi', presenze: 'appello', registro: 'registro', messe: 'messe',
  calendario: 'calendario', gruppi: 'gruppi', turni: 'turni',
  'strutture-messe': 'strutture-messe', anagrafica: 'anagrafica', cerimonieri: 'cerimonieri', accessi: 'accessi', info: 'info', account: 'account'
};
const ROUTE_SECTIONS = Object.fromEntries(Object.entries(SECTION_ROUTES).map(([section, route]) => [route, section]));
let lastNavigationUrl = location.href;

function sectionFromRoute() {
  const route = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/')[0];
  return ROUTE_SECTIONS[route] || null;
}

function restoreSectionFromLocation() {
  if (lastNavigationUrl === location.href) return;
  lastNavigationUrl = location.href;
  const section = sectionFromRoute();
  if (section && document.getElementById(section)) void showSection(section, { syncUrl: false });
}

window.addEventListener('hashchange', restoreSectionFromLocation);
window.addEventListener('popstate', restoreSectionFromLocation);

window.addEventListener('online', async () => {
  if (!currentUser) return;
  let pending = false;
  if (localStorage.getItem(MESSE_EXTRA_PENDING_KEY) === '1') {
    pending = true;
    if (!await persistMesseExtra()) return;
  }
  if (localStorage.getItem(LITURGICAL_CONFIG_PENDING_KEY) === '1') {
    pending = true;
    if (!await persistConfig()) return;
  }
  if (pending) {
    setSyncBanner('');
    const status = document.getElementById('sync-status');
    if (status) status.textContent = isSupabase ? 'Modifiche sincronizzate con Supabase' : 'Modifiche sincronizzate';
    refreshVisibleUi();
  }
});

function moveStrutturaMesseToMesse() {
  const panel = document.getElementById('turni-panel-messe');
  const target = document.getElementById('strutture-messe-slot');
  const tab = document.getElementById('tab-turni-messe');
  if (!panel || !target) return;
  target.appendChild(panel);
  panel.classList.remove('turni-tab-panel');
  panel.classList.add('messe-struttura-panel');
  panel.hidden = false;
  panel.style.removeProperty('display');
  if (tab) tab.hidden = true;
}

function setStrutturaLiturgicaTab(tab) {
  // 'applica' resta raggiungibile via codice ma non ha più tab UI
  const allowed = ['calendario', 'modelli', 'applica', 'correzioni'];
  let active = allowed.includes(tab) ? tab : 'calendario';
  if (active === 'applica' && !document.getElementById('tab-struttura-applica')) {
    // deep-link legacy: mostra panel senza tab
  }
  const panels = {
    calendario: document.getElementById('calendario'),
    modelli: document.getElementById('struttura-liturgica-modelli'),
    applica: document.getElementById('struttura-liturgica-applica'),
    correzioni: document.getElementById('struttura-liturgica-correzioni')
  };
  const tabs = {
    calendario: document.getElementById('tab-struttura-calendario'),
    modelli: document.getElementById('tab-struttura-modelli'),
    correzioni: document.getElementById('tab-struttura-correzioni')
  };
  allowed.forEach(id => {
    if (panels[id]) panels[id].hidden = id !== active;
  });
  Object.keys(tabs).forEach(id => {
    if (!tabs[id]) return;
    const on = id === active;
    tabs[id].classList.toggle('active', on);
    tabs[id].setAttribute('aria-pressed', String(on));
  });
  const stepKey = active === 'applica' ? 'correzioni' : active;
  document.querySelectorAll('.struttura-pipeline-step').forEach(el => {
    const on = el.dataset.step === stepKey;
    el.classList.toggle('is-active', on);
    if (on) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
  if (active === 'calendario') {
    const anno = getCalAnno();
    if (!calState.data || calState.data.anno !== anno) void loadCalendario();
    else {
      renderCalMonth();
      ensureCalDaySelected();
    }
  } else if (active === 'modelli') {
    setStrutturaMesseKind(strutturaMesseKind);
    renderMesseDomenicaliList();
    void ensureStrutturaFestivitaLoaded();
  } else if (active === 'applica') {
    syncStrutturaAnnoSelects();
    void renderStrutturaApplicaPanel();
  } else if (active === 'correzioni') {
    syncStrutturaAnnoSelects();
    void renderStrutturaCorrezioniPanel();
  }
}

function showMesseLocalPanel(panelName) {
  if (panelName === 'strutture') {
    void showSection('strutture-messe');
    return;
  }
  setMesseView(panelName === 'calendario' ? 'calendario' : 'agenda');
}

/** @deprecated mantiene compatibilità link vecchi → Messe */
function openCalendarioHub(tab) {
  if (tab === 'strutture') {
    void showSection('strutture-messe');
  } else if (tab === 'locale') {
    void showSection('messe').then(() => showMesseLocalPanel('agenda'));
  } else {
    void showSection('calendario');
  }
}

function setCalendarioHubTab() {
  /* no-op: hub tripartito rimosso */
}

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

function toggleAuthPassword(inputId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(inputId + '-toggle');
  if (!input || !btn) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  btn.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
  btn.title = show ? 'Nascondi password' : 'Mostra password';
}

function resetAuthPasswordVisibility() {
  ['auth-password', 'auth-password2'].forEach(id => {
    const input = document.getElementById(id);
    const btn = document.getElementById(id + '-toggle');
    if (input) input.type = 'password';
    if (btn) {
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Mostra password');
      btn.title = 'Mostra password';
    }
  });
}

function setAuthMode(mode, extra = {}) {
  authMode = mode;
  resetAuthPasswordVisibility();
  const isBootstrap = mode === 'bootstrap';
  const isUnauthorized = mode === 'unauthorized';
  const waitGoogle = mode === 'google-wait';
  const isForgot = mode === 'forgot';
  const isRecovery = mode === 'recovery';
  const isInvite = mode === 'invite';
  const isForcePassword = mode === 'force-password';
  const googleEmail = extra.googleEmail || '';

  showAuthError('');
  if (!extra.keepInfo) showAuthInfo('');

  document.getElementById('auth-subtitle').textContent = isBootstrap
    ? 'Configurazione iniziale'
    : isUnauthorized
      ? 'Accesso non autorizzato'
      : isForgot
        ? 'Recupero password'
        : (isRecovery || isForcePassword || isInvite)
          ? 'Nuova password'
          : 'Accesso riservato a cerimonieri e sacerdoti';

  const hint = document.getElementById('auth-bootstrap-hint');
  if (isBootstrap && isGAS) {
    hint.style.display = '';
    hint.textContent = 'Primo avvio: questo Account Google diventa il primo accesso. Poi potrai autorizzare cerimonieri e Don dalla pagina Cerimonieri.';
  } else if (isBootstrap) {
    hint.style.display = '';
    hint.textContent = 'Primo avvio: crea l\'account del responsabile. Potrai aggiungere cerimonieri e Don dalla pagina Cerimonieri.';
  } else if (isForgot) {
    hint.style.display = '';
    hint.textContent = 'Inserisci l\'email dell\'account: ti invieremo un link per scegliere una nuova password.';
  } else if (isRecovery || isForcePassword || isInvite) {
    hint.style.display = '';
    hint.textContent = isInvite
      ? 'Imposta la password per attivare il tuo accesso a ChierichApp.'
      : isForcePassword
      ? 'Per motivi di sicurezza devi sostituire la password iniziale prima di usare l’app.'
      : 'Scegli una nuova password (almeno 6 caratteri), poi potrai accedere.';
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
    if (emailWrap) emailWrap.style.display = (isRecovery || isForcePassword || isInvite) ? 'none' : '';
    if (passwordWrap) passwordWrap.style.display = (isForgot ? 'none' : '');
    if (password2Wrap) password2Wrap.style.display = (isRecovery || isForcePassword || isInvite) ? '' : 'none';
    if (forgotLink) forgotLink.style.display = (isSupabase && mode === 'login') ? '' : 'none';
    if (backLogin) backLogin.style.display = (isForgot || isRecovery || isInvite) ? '' : 'none';
    if (emailInput) {
      emailInput.required = !isRecovery && !isForcePassword && !isInvite;
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
    if (password2Input) password2Input.required = isRecovery || isForcePassword || isInvite;
    document.getElementById('auth-nome-wrap').style.display = isBootstrap ? '' : 'none';
    document.getElementById('auth-submit-btn').textContent = isBootstrap
      ? 'Crea account'
      : isForgot
        ? 'Invia link'
        : (isRecovery || isForcePassword || isInvite)
          ? (isInvite ? 'Attiva account' : 'Salva nuova password')
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
  const tab = document.getElementById('tab-anag-cerimonieri');
  const canAdmin = isCurrentUserAdmin();
  if (tab) tab.hidden = !canAdmin;
  if (grid) grid.style.display = canAdmin && anagraficaTab === 'cerimoniere' ? '' : 'none';
  const chiGrid = document.getElementById('anag-panel-chierichetti');
  if (chiGrid) chiGrid.style.display = anagraficaTab === 'cerimoniere' ? 'none' : '';
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
  syncAdminOnlyNav();
  const label = currentUser ? (currentUser.nome || currentUser.email || '—') : '—';
  const nameEl = document.getElementById('sidebar-user-name');
  if (nameEl) nameEl.textContent = label;
  const moreName = document.getElementById('mobile-more-user-name');
  if (moreName) moreName.textContent = label;
}

function syncAdminOnlyNav() {
  const canAdmin = isCurrentUserAdmin();
  document.body.classList.toggle('is-admin', canAdmin);
  document.querySelectorAll('.nav-admin-only').forEach(el => {
    el.hidden = !canAdmin;
  });
  if (!canAdmin && ['accessi', 'strutture-messe', 'cerimonieri'].some(id => document.getElementById(id)?.classList.contains('active'))) {
    void showSection('dashboard');
  }
}

let accessiLogCache = null;

function formatAccessoWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Oggi · ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Ieri · ${time}`;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) + ` · ${time}`;
}

function accessiMetodoLabel(metodo) {
  if (metodo === 'bootstrap') return 'Primo avvio';
  if (metodo === 'google') return 'Google';
  if (metodo === 'password') return 'Email / password';
  return 'Altro';
}

async function renderAccessiLog(force = false) {
  const listEl = document.getElementById('accessi-list');
  const summaryEl = document.getElementById('accessi-summary');
  if (!listEl) return;
  if (!isCurrentUserAdmin()) {
    listEl.innerHTML = '<p class="empty-state">Solo l\'admin può vedere questo log.</p>';
    if (summaryEl) summaryEl.textContent = '';
    return;
  }

  if (force || !accessiLogCache) {
    listEl.innerHTML = '<p class="liturgy-meta">Caricamento…</p>';
    if (!isSupabase) {
      accessiLogCache = [];
      listEl.innerHTML = '<p class="empty-state">Log accessi disponibile con Supabase. Applica la migration 014_accessi_log.sql.</p>';
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
    try {
      const res = await window.ChierichSupabase.getAccessiLog({ limit: 200 });
      if (!res.success) {
        accessiLogCache = [];
        listEl.innerHTML = `<p class="empty-state">${esc(res.message || 'Impossibile caricare il log')}</p>`;
        if (summaryEl) summaryEl.textContent = '';
        return;
      }
      accessiLogCache = res.items || [];
    } catch (e) {
      accessiLogCache = [];
      listEl.innerHTML = `<p class="empty-state">${esc(e.message || 'Errore di rete')}</p>`;
      if (summaryEl) summaryEl.textContent = '';
      return;
    }
  }

  const q = (document.getElementById('accessi-search')?.value || '').trim().toLowerCase();
  const items = !q
    ? accessiLogCache
    : accessiLogCache.filter(row =>
      (row.nome || '').toLowerCase().includes(q) ||
      (row.email || '').toLowerCase().includes(q)
    );

  if (summaryEl) {
    summaryEl.textContent = items.length
      ? `${items.length} accessi mostrati${q ? ' (filtro attivo)' : ''}`
      : (q ? 'Nessun risultato per la ricerca' : 'Nessun accesso registrato ancora');
  }

  if (!items.length) {
    listEl.innerHTML = q
      ? '<p class="empty-state">Nessun accesso corrisponde alla ricerca.</p>'
      : '<p class="empty-state">Ancora nessun login registrato. Compariranno al prossimo accesso.</p>';
    return;
  }

  listEl.innerHTML = items.map(row => `
    <article class="accessi-item">
      <div class="accessi-item-main">
        <p class="accessi-item-name">${esc(row.nome || '—')}</p>
        <p class="accessi-item-meta">${esc(row.email || 'senza email')} · ${esc(accessiMetodoLabel(row.metodo))}</p>
      </div>
      <time class="accessi-item-when" datetime="${esc(row.at || '')}">${esc(formatAccessoWhen(row.at))}</time>
    </article>
  `).join('');
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
    if (typeof window.ChierichSupabase.consumeEmailLinkFromUrl === 'function') {
      const link = await window.ChierichSupabase.consumeEmailLinkFromUrl();
      if (link?.consumed && link.success === false) {
        clearSession();
        showAuthGate();
        setAuthMode('login');
        showAuthError(link.message || 'Link non valido o scaduto');
        return;
      }
    }
    // Breve attesa perché detectSessionInUrl / PASSWORD_RECOVERY possano settarsi
    await new Promise(r => setTimeout(r, 80));
    if (window.ChierichSupabase.isPasswordInvite()) {
      const inviteStatus = await fetchAuthStatus();
      if (!inviteStatus.authenticated || !inviteStatus.user) {
        clearSession();
        showAuthGate();
        setAuthMode('login');
        showAuthError(inviteStatus.message || 'Account non attivo o non autorizzato');
        return;
      }
      // Dopo link invito: sempre form attivazione / nuova password
      saveSession(inviteStatus.token || 'supabase', inviteStatus.user);
      showAuthGate();
      setAuthMode('invite');
      return;
    }
    if (window.ChierichSupabase.isPasswordRecovery()) {
      const recoveryStatus = await fetchAuthStatus();
      if (!recoveryStatus.authenticated || !recoveryStatus.user) {
        clearSession();
        showAuthGate();
        setAuthMode('login');
        showAuthError(recoveryStatus.message || 'Account non attivo o non autorizzato');
        return;
      }
      // Dopo link recovery/invito: sempre form nuova password (anche se passwordChanged era già true)
      saveSession(recoveryStatus.token || 'supabase', recoveryStatus.user);
      showAuthGate();
      setAuthMode(recoveryStatus.user?.inviteAccepted === false ? 'invite' : 'recovery');
      return;
    }
    const status = await fetchAuthStatus();
    if (window.ChierichSupabase.isPasswordInvite()) {
      clearSession();
      showAuthGate();
      setAuthMode('invite');
      return;
    }
    if (window.ChierichSupabase.isPasswordRecovery()) {
      clearSession();
      showAuthGate();
      setAuthMode('recovery');
      return;
    }
    if (status.pendingActivation || status.mustChangePassword) {
      clearSession();
      showAuthGate();
      setAuthMode(status.user?.inviteAccepted === false ? 'invite' : 'force-password');
      return;
    }
    if (status.authenticated && status.user) {
      if (status.user.accountActivated !== true || status.user.inviteAccepted !== true) {
        clearSession();
        showAuthGate();
        setAuthMode(status.user.inviteAccepted !== true ? 'invite' : 'force-password');
        return;
      }
      if (status.mustChangePassword) {
        showAuthGate();
        setAuthMode('force-password');
        return;
      }
      saveSession(status.token || 'supabase', status.user);
      showAppShell();
      initApp();
      return;
    }
    // Sessione forse ancora in hydration: un secondo tentativo prima di mostrare il login
    if (!status.needsBootstrap && !status.unauthorized) {
      await new Promise(r => setTimeout(r, 350));
      const again = await fetchAuthStatus();
      if (again.authenticated && again.user
        && again.user.accountActivated === true
        && again.user.inviteAccepted === true
        && !again.mustChangePassword
        && !again.pendingActivation) {
        saveSession(again.token || 'supabase', again.user);
        showAppShell();
        initApp();
        return;
      }
      if (again.needsBootstrap) {
        clearSession();
        showAuthGate();
        setAuthMode('bootstrap');
        return;
      }
      if (again.unauthorized) {
        clearSession();
        showAuthGate();
        setAuthMode('login');
        showAuthError(again.message || 'Account non autorizzato');
        return;
      }
    }
    clearSession();
    showAuthGate();
    if (status.needsBootstrap) setAuthMode('bootstrap');
    else if (status.unauthorized) {
      setAuthMode('login');
      showAuthError(status.message || 'Account non autorizzato');
    } else setAuthMode('login');
  } catch (err) {
    console.error('[ChierichApp] checkAuthAndInit', err);
    // Riprova una volta: spesso è solo hydration sessione / rete momentanea
    let retryErr = null;
    try {
      await new Promise(r => setTimeout(r, 400));
      const retry = await fetchAuthStatus();
      if (retry.authenticated && retry.user
        && retry.user.accountActivated === true
        && retry.user.inviteAccepted === true
        && !retry.mustChangePassword
        && !retry.pendingActivation) {
        saveSession(retry.token || 'supabase', retry.user);
        showAppShell();
        initApp();
        return;
      }
      clearSession();
      showAuthGate();
      if (retry.needsBootstrap) setAuthMode('bootstrap');
      else {
        setAuthMode('login');
        if (retry.unauthorized) showAuthError(retry.message || 'Account non autorizzato');
      }
      return;
    } catch (err2) {
      retryErr = err2;
      console.error('[ChierichApp] checkAuthAndInit retry', err2);
    }
    showAuthGate();
    setAuthMode('login');
    const msg = String(err?.message || retryErr?.message || '');
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    showAuthError(
      offline || /failed to fetch|network|fetch|timeout/i.test(msg)
        ? 'Supabase non raggiungibile — riprova tra poco'
        : (msg || 'Accesso non riuscito — ricarica la pagina')
    );
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

    if (authMode === 'recovery' || authMode === 'invite') {
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

    if (authMode === 'force-password') {
      if (!isSupabase) {
        showAuthError('Cambio password non disponibile');
        return;
      }
      if (password.length < 6) {
        showAuthError('La nuova password deve avere almeno 6 caratteri');
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
      saveSession(result.token || 'supabase', result.user);
      showAppShell();
      initApp();
      showToast('Password aggiornata');
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
    if (result.mustChangePassword) {
      saveSession(result.token || 'supabase', result.user);
      showAuthGate();
      setAuthMode(result.user?.inviteAccepted === false ? 'invite' : 'force-password');
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
  syncStrutturaAnnoSelects(getStrutturaPastoralStartForDate());

  const launchSection = getLaunchSection();
  if (launchSection === 'presenze') openAppello();
  else if (launchSection === 'account') openAccountPage();
  else showSection(launchSection || 'dashboard');
  syncMessaDomenicaleFormDay();
  void (async () => {
    if (navigator.onLine !== false) {
      const hasPendingWrites = localStorage.getItem(MESSE_EXTRA_PENDING_KEY) === '1'
        || localStorage.getItem(LITURGICAL_CONFIG_PENDING_KEY) === '1';
      if (localStorage.getItem(MESSE_EXTRA_PENDING_KEY) === '1' && !await persistMesseExtra()) {
        setSyncBanner('Messa locale in attesa di sincronizzazione', true);
        refreshVisibleUi();
        return;
      }
      if (localStorage.getItem(LITURGICAL_CONFIG_PENDING_KEY) === '1' && !await persistConfig()) {
        setSyncBanner('Configurazione locale in attesa di sincronizzazione', true);
        refreshVisibleUi();
        return;
      }
      if (hasPendingWrites) {
        setSyncBanner('');
        const status = document.getElementById('sync-status');
        if (status) status.textContent = isSupabase ? 'Modifiche sincronizzate con Supabase' : 'Modifiche sincronizzate';
        refreshVisibleUi();
        return;
      }
    }
    await bootstrapFromServer();
    if (calState.data?.byDate) {
      if (document.getElementById('dashboard').classList.contains('active')) renderDashboard();
    } else {
      void ensureCalendarioForToday();
    }
  })();
}

function getLaunchSection() {
  try {
    const routeSection = sectionFromRoute();
    if (routeSection) return routeSection;
    const params = new URLSearchParams(location.search);
    const section = params.get('section');
    const allowed = new Set([
      'dashboard', 'presenze', 'registro', 'messe',
      'calendario', 'strutture-messe', 'cerimonieri', 'gruppi', 'turni', 'anagrafica', 'account'
      , 'accessi', 'info'
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

/** Unisce più pack LitCal (anno liturgico ambrosiano ≠ anno civile). */
function mergeCalendarioPacks(packs, civilAnno) {
  const list = (packs || []).filter(p => p?.byDate && Object.keys(p.byDate).length);
  const byDate = {};
  list.forEach(pack => {
    Object.keys(pack.byDate).forEach(dateStr => {
      if (!byDate[dateStr]) byDate[dateStr] = [];
      (pack.byDate[dateStr] || []).forEach(ev => {
        const key = ev.eventKey || ev.nome;
        if (key && byDate[dateStr].some(x => (x.eventKey || x.nome) === key)) return;
        byDate[dateStr].push(ev);
      });
    });
  });
  const events = [];
  Object.keys(byDate).sort().forEach(d => events.push(...byDate[d]));
  const primary = list[0] || {};
  return {
    anno: String(civilAnno),
    civilAnno: String(civilAnno),
    litYears: list.map(p => String(p.anno)).filter(Boolean),
    byDate,
    events,
    source: primary.source || list.find(p => p.source)?.source || '',
    fetchedAt: new Date().toISOString(),
    provider: primary.provider || list.find(p => p.provider)?.provider || ''
  };
}

function calendarioCoversCivilYear(data, anno) {
  if (!data?.byDate) return false;
  const keys = Object.keys(data.byDate);
  if (!keys.length) return false;
  const y = String(anno);
  // Pack singolo ambrosiano finisce ~14 nov: serve anche Avvento (da metà nov)
  const hasLate = keys.some(d => d >= `${y}-11-15`);
  const hasYearBody = keys.some(d => d.startsWith(`${y}-`) && d < `${y}-11-15`);
  return hasYearBody && hasLate;
}

async function loadCalendarioPackYear(anno, { refresh = false } = {}) {
  anno = String(anno);
  const cached = readCalendarioLocal(anno);
  try {
    if (isGAS) {
      const data = await gasRun('getCalendarioLiturgico', anno, !!refresh);
      if (data?.byDate) saveCalendarioLocal(anno, data);
      return data?.byDate ? data : cached;
    }
    if (isSupabase) {
      if (refresh) {
        const data = await fetchAmbrosianCalendarYear(anno);
        const saved = await window.ChierichSupabase.salvaCalendarioLiturgico(anno, data);
        if (!saved.success) throw new Error(saved.message || 'Salvataggio in cache non riuscito');
        saveCalendarioLocal(anno, data);
        return data;
      }
      let data = await window.ChierichSupabase.getCalendarioLiturgico(anno);
      if (!data?.byDate || !Object.keys(data.byDate).length) {
        data = await fetchAmbrosianCalendarYear(anno);
        await window.ChierichSupabase.salvaCalendarioLiturgico(anno, data);
      }
      if (data?.byDate) saveCalendarioLocal(anno, data);
      return data?.byDate ? data : cached;
    }
    const url = `${API_BASE}/api/calendario/${anno}${refresh ? '?refresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Errore HTTP ' + res.status);
    const data = await res.json();
    if (data?.byDate) saveCalendarioLocal(anno, data);
    return data?.byDate ? data : cached;
  } catch (err) {
    console.warn('[ChierichApp] loadCalendarioPackYear', anno, err);
    return cached;
  }
}

function readCalendarioLocal(anno) {
  try {
    const raw = localStorage.getItem(CALENDAR_CACHE_PREFIX + String(anno));
    const data = raw ? JSON.parse(raw) : null;
    return data?.byDate && Object.keys(data.byDate).length ? data : null;
  } catch { return null; }
}

function saveCalendarioLocal(anno, data) {
  if (!data?.byDate) return;
  try { localStorage.setItem(CALENDAR_CACHE_PREFIX + String(anno), JSON.stringify(data)); }
  catch (err) { console.warn('[ChierichApp] calendario locale non salvato', err); }
}

async function ensureCalendarioForYear(anno) {
  anno = String(anno);
  const nextAnno = String(Number(anno) + 1);
  if (
    calState.data?.civilAnno === anno
    && Object.keys(calState.data.byDate || {}).length
    && calendarioCoversCivilYear(calState.data, anno)
  ) {
    calState.unavailable = false;
    return calState.data;
  }
  if (
    calState.data?.anno === anno
    && !calState.data?.civilAnno
    && calendarioCoversCivilYear(calState.data, anno)
  ) {
    calState.unavailable = false;
    return calState.data;
  }

  try {
    const packs = await Promise.all([
      loadCalendarioPackYear(anno),
      loadCalendarioPackYear(nextAnno)
    ]);
    const merged = mergeCalendarioPacks(packs, anno);
    if (Object.keys(merged.byDate).length) {
      calState.data = normalizeCalendarioPack(merged);
      calState.unavailable = false;
      return calState.data;
    }
  } catch { /* offline ok */ }
  calState.unavailable = true;
  return null;
}

function isCalendarioUnavailable() {
  return !!calState.unavailable;
}

function calendarioUnavailableHtml(opts = {}) {
  const withCta = opts.withCta !== false && isCurrentUserAdmin();
  const cta = withCta
    ? `<div class="today-agenda-footer"><button type="button" class="btn-ghost-light" onclick="showSection('calendario')">Apri Calendario e aggiorna</button></div>`
    : '';
  return `<p class="today-empty empty-state-inline">Calendario liturgico non disponibile — riprova da Calendario.</p>${cta}`;
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
  if (!document.getElementById('struttura-modello-modal')?.classList.contains('hidden')) {
    closeStrutturaModelloModal();
    return;
  }
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

async function showSection(sectionId, options = {}) {
  const openCalendarTab = sectionId === 'calendario';
  if (sectionId === 'calendario') {
    sectionId = 'strutture-messe';
  }
  if (sectionId === 'cerimonieri') {
    if (!isCurrentUserAdmin()) {
      showToast('Questa sezione è riservata all\'admin');
      return;
    }
    await showSection('anagrafica', { ...options, syncUrl: true });
    switchAnagraficaTab('cerimoniere', true);
    return;
  }
  const current = document.querySelector('.section.active')?.id;
  if (current === 'presenze' && sectionId !== 'presenze') {
    const ok = await flushAppelloIfNeeded();
    if (!ok) return;
  }

  if (['accessi', 'strutture-messe'].includes(sectionId) && !isCurrentUserAdmin()) {
    showToast('Questa sezione è riservata all\'admin');
    return;
  }
  if (openCalendarTab) setStrutturaLiturgicaTab('calendario');

  const next = document.getElementById(sectionId);
  if (!next) return;

  if (options.syncUrl !== false) {
    const route = SECTION_ROUTES[sectionId];
    if (route && location.hash !== `#/${route}`) {
      history.pushState({ section: sectionId }, '', `${location.pathname}${location.search}#/${route}`);
      lastNavigationUrl = location.href;
    }
  }

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
  if (sectionId === 'anagrafica') {
    anagraficaTab = 'chierichetto';
    document.getElementById('tab-anag-chierichetti')?.classList.add('active');
    document.getElementById('tab-anag-cerimonieri')?.classList.remove('active');
    syncCerimonieriAdminUi();
  }
  if (sectionId !== 'gruppi') {
    closeGruppiFormSheet();
    closeGruppiEdit(true);
  }
  syncAnagFab();
  syncMesseFab();
  syncGruppiFab();

  if (sectionId === 'dashboard') renderDashboard();
  else if (sectionId === 'anagrafica') {
    anagraficaTab = 'chierichetto';
    syncAnagFab();
    updateAnagraficaFormLabels();
    renderChierichetti();
  }
  else if (sectionId === 'turni') renderTurni();
  else if (sectionId === 'gruppi') void renderGruppi();
  else if (sectionId === 'messe') loadMesseAgenda();
  else if (sectionId === 'strutture-messe') {
    const activeTab = document.getElementById('tab-struttura-calendario')?.classList.contains('active') ? 'calendario'
      : document.getElementById('tab-struttura-modelli')?.classList.contains('active') ? 'modelli'
      : document.getElementById('tab-struttura-applica')?.classList.contains('active') ? 'applica'
      : document.getElementById('tab-struttura-correzioni')?.classList.contains('active') ? 'correzioni'
      : 'calendario';
    setStrutturaLiturgicaTab(activeTab);
  }
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
  else if (sectionId === 'accessi') {
    void renderAccessiLog(true);
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
    if (!m.tipo) {
      m.tipo = m.usaOrarioDomenicale ? 'festiva' : 'straordinaria';
    }
    if (m.tipo === 'festiva' && m.usaOrarioDomenicale == null) {
      m.usaOrarioDomenicale = true;
    }
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
  if (sede === 'cimitero') return 'vanzago';
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
  invalidateLiturgyCaches();
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
    if (!isGAS && !isSupabase && !apiOnline) throw new Error('Connessione al server non disponibile');
    if (isGAS) {
      mutationFailed(await gasRun('salvaConfig', body), 'Salvataggio configurazione non riuscito');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaConfig(body), 'Salvataggio configurazione non riuscito');
    } else {
      await persistToApi('/api/config', body);
    }
    localStorage.removeItem(LITURGICAL_CONFIG_PENDING_KEY);
    return true;
  } catch (e) {
    showToast(e.message || 'Salvataggio configurazione non riuscito');
    return false;
  }
}

async function persistMesseExtra() {
  saveDataLocal();
  const body = { messeExtra: state.messeExtra || [] };
  try {
    if (!isGAS && !isSupabase && !apiOnline) throw new Error('Connessione al server non disponibile');
    if (isGAS) {
      mutationFailed(await gasRun('salvaConfig', body), 'Salvataggio Messe straordinarie non riuscito');
    } else if (isSupabase) {
      mutationFailed(await window.ChierichSupabase.salvaConfig(body), 'Salvataggio Messe straordinarie non riuscito');
    } else {
      await persistToApi('/api/config', body);
    }
    localStorage.removeItem(MESSE_EXTRA_PENDING_KEY);
    return true;
  } catch (e) {
    if (navigator.onLine !== false) showToast(e.message || 'Salvataggio Messe straordinarie non riuscito');
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
  } else if (info?.type === 'festiva') {
    getFestivaTurniSlots(dateStr).forEach(s => { if (s.gruppo) gruppi.add(s.gruppo); });
  } else if (info?.type === 'extra') {
    state.turni.filter(t => t.data === dateStr).forEach(t => { if (t.gruppo) gruppi.add(t.gruppo); });
    const ora = info.extra?.ora || '10:00';
    const sede = info.extra?.sede || 'santuario';
    const slotGruppo = state.turni.find(t => t.data === dateStr && t.oraInizio === ora && t.parrocchia === sede);
    if (slotGruppo?.gruppo) gruppi.add(slotGruppo.gruppo);
  }
  const d = new Date(dateStr + 'T12:00:00');
  if (d.getDay() === 6) {
    const next = addDaysToDateStr(dateStr, 1);
    const nextInfo = getMessaInfo(next);
    if (nextInfo?.type === 'domenica') {
      getMesseOrdinarieSlots(next).filter(s => s.conChierichetti && s.data === dateStr).forEach(s => {
        if (s.gruppo) gruppi.add(s.gruppo);
      });
    } else if (nextInfo?.type === 'festiva') {
      getFestivaSlots(next).filter(s => s.conChierichetti && s.data === dateStr).forEach(s => {
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
      ${notes.length ? renderMessaNotesListHtml(notes, messaDateStr, key) : ''}
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

  const pushFestivaSlotsForDate = (festivaRef, slotDate) => {
    getFestivaSlots(festivaRef)
      .filter(s => s.data === slotDate)
      .forEach(s => slots.push({ ...s, key: messaSlotKey(s), isFestiva: true }));
  };

  if (info?.type === 'domenica' || (day === 0 && info?.type !== 'festiva')) {
    const domenicaRef = info?.type === 'domenica'
      ? getDomenicaRefFromMassInfo(dateStr, info)
      : dateStr;
    pushSlotsForDate(domenicaRef, dateStr);
  }

  if (info?.type === 'festiva') {
    pushFestivaSlotsForDate(dateStr, dateStr);
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
      key: messaSlotKey({ data: dateStr, ora, sede })
    };
    if (!slots.some(x => x.key === slot.key)) slots.push(slot);
  }

  // Vigilia domenicale anche se oggi c’è già una straordinaria (es. Cresime + 18:00)
  if (Array.isArray(info?.vigilSlots)) {
    info.vigilSlots.forEach(s => {
      const key = messaSlotKey(s);
      if (!slots.some(x => x.key === key)) slots.push({ ...s, key });
    });
  } else {
    const next = addDaysToDateStr(dateStr, 1);
    const nextInfo = getMessaInfo(next);
    if (nextInfo?.type === 'festiva') {
      getFestivaSlots(next)
        .filter(s => s.data === dateStr)
        .forEach(s => {
          const key = messaSlotKey(s);
          if (!slots.some(x => x.key === key)) slots.push({ ...s, key, isFestiva: true });
        });
    } else if (day === 6 && nextInfo?.type === 'domenica') {
      pushSlotsForDate(next, dateStr);
    }
  }

  return slots.sort((a, b) => compareOraSlot(a.ora, b.ora) || (a.sede || '').localeCompare(b.sede || ''));
}

function compareOraSlot(a, b) {
  const norm = o => (String(o || '') === '00:00' ? '24:00' : String(o || ''));
  return norm(a).localeCompare(norm(b));
}

function sedeOptionsHtml(selected) {
  return Object.entries(SEDI_LABEL).map(([id, label]) =>
    `<option value="${id}"${selected === id ? ' selected' : ''}>${esc(label)}</option>`
  ).join('');
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
  if (ensureGruppiConfig._ready) return;
  if (ensureGruppiConfig._busy) return;
  ensureGruppiConfig._busy = true;
  try {
    if (!state.gruppiConfig) {
      state.gruppiConfig = JSON.parse(JSON.stringify(DEFAULT_GRUPPI_CONFIG));
    }
    if (!state.gruppiConfig.giorniLiturgici || typeof state.gruppiConfig.giorniLiturgici !== 'object' || Array.isArray(state.gruppiConfig.giorniLiturgici)) {
      state.gruppiConfig.giorniLiturgici = {};
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
      const turni = state.gruppiConfig.turniSlot || DEFAULT_MESSE_DOMENICALI.filter(m => m.conTurno);
      const libere = state.gruppiConfig.messeSenzaChierichetti || DEFAULT_MESSE_DOMENICALI.filter(m => !m.conTurno);
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
        : JSON.parse(JSON.stringify(DEFAULT_MESSE_DOMENICALI));
      delete state.gruppiConfig.turniSlot;
      delete state.gruppiConfig.messeSenzaChierichetti;
    }
    normalizeRotazioneConfig();
    if (!Array.isArray(state.gruppiConfig.cronologia)) {
      state.gruppiConfig.cronologia = [];
    }
    if (!Array.isArray(state.gruppiConfig.messeFestive)) {
      state.gruppiConfig.messeFestive = [];
    }
    if (!Array.isArray(state.gruppiConfig.festivitaEscluse)) {
      state.gruppiConfig.festivitaEscluse = [];
    }
    if (!Array.isArray(state.gruppiConfig.festivitaModelli)) {
      state.gruppiConfig.festivitaModelli = [];
    }
    if (typeof state.gruppiConfig.escludiFerialiIntrasettimanali !== 'boolean') {
      state.gruppiConfig.escludiFerialiIntrasettimanali = false;
    }
    if (!state.gruppiConfig.festivitaDateOverrides || typeof state.gruppiConfig.festivitaDateOverrides !== 'object' || Array.isArray(state.gruppiConfig.festivitaDateOverrides)) {
      state.gruppiConfig.festivitaDateOverrides = {};
    }
    migrateStruttureMesseConfig();
    renumberMesseDomenicali();
    renumberAllStruttureMesse();
    repairGruppiConfig();
    syncGruppiToTurniSlots();
    ensureGruppiConfig._ready = true;
  } finally {
    ensureGruppiConfig._busy = false;
  }
}

/** Invalida cache liturgiche dopo mutazioni a modelli / calendario / extras. */
function invalidateLiturgyCaches() {
  ensureGruppiConfig._ready = false;
  _messaInfoCache.clear();
  _displacedFestivityCache = { anno: null, set: null };
  clearCorrezioniCivilDayCache();
  clearMesseDatesYearCache();
}

const _messaInfoCache = new Map();
let _displacedFestivityCache = { anno: null, set: null };
let _messeDatesYearCache = { anno: null, dates: null };

function clearMesseDatesYearCache() {
  _messeDatesYearCache = { anno: null, dates: null };
}

/** Migra messeDomenicali/messeFestive → 5 strutture tempi liturgici */
function migrateStruttureMesseConfig() {
  const cfg = state.gruppiConfig;
  if (!Array.isArray(cfg.strutturaDomenicaleOrdinaria) || !cfg.strutturaDomenicaleOrdinaria.length) {
    cfg.strutturaDomenicaleOrdinaria = Array.isArray(cfg.messeDomenicali) && cfg.messeDomenicali.length
      ? JSON.parse(JSON.stringify(cfg.messeDomenicali))
      : JSON.parse(JSON.stringify(DEFAULT_MESSE_DOMENICALI));
  }
  // Solo se la chiave manca: [] vuoto è una scelta esplicita («nessuna messa»).
  if (!Array.isArray(cfg.strutturaFestivoGenerico)) {
    cfg.strutturaFestivoGenerico = Array.isArray(cfg.messeFestive) && cfg.messeFestive.length
      ? JSON.parse(JSON.stringify(cfg.messeFestive))
      : JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO));
  }
  if (!Array.isArray(cfg.strutturaTempoNatalizio)) {
    cfg.strutturaTempoNatalizio = JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO));
  }
  if (!Array.isArray(cfg.strutturaTempoPasquale)) {
    cfg.strutturaTempoPasquale = JSON.parse(JSON.stringify(DEFAULT_MESSE_FESTIVE_GIORNO));
  }
  if (!Array.isArray(cfg.strutturaTempoDefunti)) {
    cfg.strutturaTempoDefunti = JSON.parse(JSON.stringify(DEFAULT_MESSE_CON_VIGILIA));
  }
  // Alias legacy per codice/API che ancora legge i vecchi campi
  cfg.messeDomenicali = cfg.strutturaDomenicaleOrdinaria;
  cfg.messeFestive = cfg.strutturaFestivoGenerico;
}

function getStrutturaMeta(kind) {
  return STRUTTURA_KINDS[kind] || STRUTTURA_KINDS.domenicale;
}

/** True se la stringa è un nome di struttura (non va usato come titolo celebrazione/giorno). */
function isStrutturaDisplayName(name) {
  if (!name) return false;
  const n = String(name).trim().toLowerCase();
  if (!n) return false;
  return Object.values(STRUTTURA_KINDS).some(m => {
    const label = String(m.label || '').trim().toLowerCase();
    const shortLabel = String(m.shortLabel || '').trim().toLowerCase();
    return (label && label === n) || (shortLabel && shortLabel === n);
  });
}

function getLiturgicalDisplayTitle(dateStr, fallback = 'Celebrazione') {
  if (!dateStr) return fallback;
  const ev = getLiturgicalDayEvent(dateStr);
  const nome = ev?.nome ? String(ev.nome).trim() : '';
  if (nome && !isStrutturaDisplayName(nome)) return nome;
  const events = calState.data?.byDate?.[dateStr] || [];
  for (const e of events) {
    const n = e?.nome ? String(e.nome).trim() : '';
    if (n && !isStrutturaDisplayName(n)) return n;
  }
  if (fallback == null) return null;
  return isStrutturaDisplayName(fallback) ? 'Celebrazione' : fallback;
}

function sanitizeAwayStrutturaName(title, dateStr, fallback = 'Celebrazione') {
  const t = title ? String(title).trim() : '';
  if (t && !isStrutturaDisplayName(t)) return t;
  if (dateStr) {
    const lit = getLiturgicalDisplayTitle(dateStr, null);
    if (lit && !isStrutturaDisplayName(lit)) return lit;
  }
  const fb = fallback != null ? String(fallback).trim() : '';
  if (fb && !isStrutturaDisplayName(fb)) return fb;
  return 'Celebrazione';
}

function getStrutturaConfigKey(kind) {
  return getStrutturaMeta(kind).configKey;
}

function getStrutturaSlots(kind) {
  ensureGruppiConfig();
  const key = getStrutturaConfigKey(kind);
  const list = state.gruppiConfig[key];
  return (Array.isArray(list) ? list : []).slice()
    .sort((a, b) => a.dayOffset - b.dayOffset || compareOraSlot(a.ora, b.ora));
}

function getStrutturaSlotsMutable(kind) {
  ensureGruppiConfig();
  const key = getStrutturaConfigKey(kind);
  if (!Array.isArray(state.gruppiConfig[key])) state.gruppiConfig[key] = [];
  return state.gruppiConfig[key];
}

function hasStrutturaConfig(kind) {
  ensureGruppiConfig();
  const key = getStrutturaConfigKey(kind);
  const list = state.gruppiConfig?.[key];
  return Array.isArray(list) && list.length > 0;
}

function renumberStrutturaSlots(kind) {
  const cfg = state.gruppiConfig;
  if (!cfg) return;
  const key = getStrutturaConfigKey(kind);
  if (!Array.isArray(cfg[key])) cfg[key] = [];
  const list = cfg[key];
  let n = 1;
  list.forEach(m => {
    if (m.conTurno) m.turnoNum = n++;
    else delete m.turnoNum;
  });
  if (kind === 'domenicale') {
    cfg.messeDomenicali = list;
  } else if (kind === 'festivo') {
    cfg.messeFestive = list;
  }
}

function renumberAllStruttureMesse() {
  Object.keys(STRUTTURA_KINDS).forEach(renumberStrutturaSlots);
}

function cloneStrutturaSlots(kind) {
  return getStrutturaSlots(kind).map(m => ({
    id: m.id || ('slot-' + Math.random().toString(36).slice(2, 8)),
    dayOffset: m.dayOffset === -1 ? -1 : 0,
    ora: m.ora,
    sede: m.sede,
    vigilia: !!m.vigilia || m.dayOffset === -1,
    conTurno: !!m.conTurno,
    turnoNum: m.conTurno ? m.turnoNum : undefined,
    titolo: m.titolo ? String(m.titolo).trim() : undefined
  }));
}

/** Ripara id duplicati o mancanti (es. due volte gruppo2 senza gruppo1) */
function repairGruppiConfig() {
  if (!state.gruppiConfig?.gruppi) return;
  const n = getStrutturaSlots('domenicale').filter(m => m.conTurno).length;
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
  return getStrutturaSlots('domenicale');
}

function getMesseFestive() {
  return getStrutturaSlots('festivo');
}

function hasOrarioFestivoConfig() {
  return hasStrutturaConfig('festivo');
}

function renumberMesseDomenicali() {
  renumberStrutturaSlots('domenicale');
}

function renumberMesseFestive() {
  renumberStrutturaSlots('festivo');
}

function getStrutturaMesseList() {
  return getStrutturaSlots(strutturaMesseKind);
}

function getStrutturaMesseMutable() {
  return getStrutturaSlotsMutable(strutturaMesseKind);
}

/** I gruppi sono fissi: uno per ogni messa domenicale con turno */
function syncGruppiToTurniSlots() {
  if (!state.gruppiConfig?.gruppi) return;
  const n = getStrutturaSlots('domenicale').filter(m => m.conTurno).length;
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
    conChierichetti: !!m.conTurno,
    titolo: m.titolo ? String(m.titolo).trim() : undefined
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

function dayOffsetLabel(offset, festivo = false) {
  if (festivo) return offset === -1 ? 'Vigilia (giorno prima)' : 'Giorno di festa';
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
  const meta = getStrutturaMeta(strutturaMesseKind);
  const list = getStrutturaMesseList();
  const modelli = STRUTTURA_GIORNI_SPECIALI[strutturaMesseKind] || [];
  const nTurni = list.filter(m => m.conTurno).length;
  const nLibere = list.length - nTurni;
  if (el) {
    if (modelli.length) {
      el.textContent = `${modelli.length} giorni · tocca per modificare`;
    } else if (strutturaMesseKind === 'domenicale') {
      el.textContent = list.length
        ? `${countDomenicheOrdinarieAnno()} domeniche · ${list.length} messe`
        : 'Aggiungi le messe del modello domenicale';
    } else if (!list.length) {
      el.textContent = meta.hint || 'Nessun modello in questa categoria';
    } else {
      el.textContent = `${list.length} messe · ${nTurni} con squadra`;
    }
  }
  updateMesseAgendaSummary();
}

function setStrutturaMesseKind(kind) {
  strutturaMesseKind = STRUTTURA_KINDS[kind] ? kind : 'domenicale';
  if (!document.getElementById('struttura-modello-modal')?.classList.contains('hidden')) {
    closeStrutturaModelloModal();
  } else {
    cancelMessaDomenicaleEdit({ keepModal: true });
  }
  document.querySelectorAll('.struttura-chip[data-struttura]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.struttura === strutturaMesseKind);
  });
  document.getElementById('chip-struttura-domenicale')?.classList.toggle('active', strutturaMesseKind === 'domenicale');
  document.getElementById('chip-struttura-festivo')?.classList.toggle('active', strutturaMesseKind === 'festivo');
  syncStrutturaMesseFormLabels();
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
}

function syncStrutturaMesseFormLabels() {
  const meta = getStrutturaMeta(strutturaMesseKind);
  const isDom = strutturaMesseKind === 'domenicale';
  const hasModelli = !!(STRUTTURA_GIORNI_SPECIALI[strutturaMesseKind] || []).length;
  const title = document.getElementById('turni-struttura-title');
  const summary = document.getElementById('messe-domenicali-summary');
  const daySel = document.getElementById('messa-domenicale-day');
  const vigiliaTitle = document.querySelector('#messa-domenicale-vigilia-wrap .form-check-title');
  const vigiliaDesc = document.querySelector('#messa-domenicale-vigilia-wrap .form-check-desc');
  const applicaBtn = document.getElementById('btn-applica-modello');
  const addBtn = document.getElementById('btn-struttura-add-messa');
  if (title) title.textContent = isDom ? 'Domeniche ordinarie' : (meta.shortLabel || meta.label);
  if (summary) {
    summary.textContent = isDom
      ? 'Stesso orario ogni domenica ordinaria'
      : 'Default ambrosiano · personalizza ciò che celebrate qui';
  }
  if (addBtn) addBtn.hidden = !(isCurrentUserAdmin() && isDom);
  if (daySel) {
    daySel.options[0].textContent = isDom ? 'Sabato (vigilia)' : 'Vigilia (giorno prima)';
    daySel.options[1].textContent = isDom ? 'Domenica' : 'Giorno';
  }
  if (vigiliaTitle) vigiliaTitle.textContent = isDom ? 'Vigilia domenicale' : 'Vigilia';
  if (vigiliaDesc) vigiliaDesc.textContent = isDom ? 'Messa del sabato sera' : 'Messa della vigilia';
  if (applicaBtn) {
    applicaBtn.hidden = !isCurrentUserAdmin();
    applicaBtn.textContent = 'Riapplica';
  }
  // hasModelli reserved for future empty-state copy
  void hasModelli;
}

function getStrutturaFestivitaAnno() {
  const applica = document.getElementById('anno-struttura-applica');
  if (applica?.value) return String(applica.value);
  const corr = document.getElementById('anno-struttura-correzioni');
  if (corr?.value) return String(corr.value);
  return String(getStrutturaPastoralStartForDate());
}

function populateStrutturaPastoralSelects(selectedStart) {
  const preferred = String(selectedStart || getStrutturaPastoralStartForDate());
  const options = getStrutturaPastoralOptionStarts();
  const value = options.includes(parseInt(preferred, 10)) ? preferred : String(options[options.length - 1] || REGISTRO_MIN_PASTORAL_START);
  ['anno-struttura-applica', 'anno-struttura-correzioni'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = options.map(y =>
      `<option value="${y}"${String(y) === value ? ' selected' : ''}>${formatPastoralYearLabel(y)}</option>`
    ).join('');
    el.value = value;
  });
}

function syncStrutturaAnnoSelects(anno) {
  const startY = String(anno || getStrutturaFestivitaAnno() || getStrutturaPastoralStartForDate());
  populateStrutturaPastoralSelects(startY);
  // Calendario / Messe restano anno civile: allinea al start pastorale (set–dic)
  ['anno-calendario', 'anno-messe'].forEach(id => {
    const el = document.getElementById(id);
    if (el && [...el.options].some(o => o.value === startY)) el.value = startY;
  });
}

function onStrutturaApplicaAnnoChange() {
  syncStrutturaAnnoSelects(document.getElementById('anno-struttura-applica')?.value);
  void renderStrutturaApplicaPanel();
}

function onStrutturaCorrezioniAnnoChange() {
  syncStrutturaAnnoSelects(document.getElementById('anno-struttura-correzioni')?.value);
  strutturaCorrezioniMonthKey = null;
  void renderStrutturaCorrezioniPanel();
}

/** Mesi YYYY-MM dell’anno pastorale Struttura (set → ago). */
function getStrutturaCorrezioniMonthKeys(anno) {
  const { from, to } = getStrutturaPastoralBounds(anno);
  const keys = [];
  let y = parseInt(from.slice(0, 4), 10);
  let m = parseInt(from.slice(5, 7), 10);
  const endY = parseInt(to.slice(0, 4), 10);
  const endM = parseInt(to.slice(5, 7), 10);
  while (y < endY || (y === endY && m <= endM)) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return keys;
}

function ensureStrutturaCorrezioniMonthKey(anno, monthKeysWithDays) {
  const allKeys = getStrutturaCorrezioniMonthKeys(anno);
  if (!allKeys.length) return null;
  const preferred = monthKeysWithDays?.length ? monthKeysWithDays : allKeys;
  if (strutturaCorrezioniMonthKey && allKeys.includes(strutturaCorrezioniMonthKey)) {
    return strutturaCorrezioniMonthKey;
  }
  const today = typeof getTodayStr === 'function' ? getTodayStr() : formatDateFromDate(new Date());
  const todayKey = today.slice(0, 7);
  if (preferred.includes(todayKey)) {
    strutturaCorrezioniMonthKey = todayKey;
    return todayKey;
  }
  if (allKeys.includes(todayKey)) {
    strutturaCorrezioniMonthKey = todayKey;
    return todayKey;
  }
  strutturaCorrezioniMonthKey = preferred[0] || allKeys[0];
  return strutturaCorrezioniMonthKey;
}

function shiftStrutturaCorrezioniMonth(delta) {
  const anno = getStrutturaFestivitaAnno();
  const keys = getStrutturaCorrezioniMonthKeys(anno);
  if (!keys.length) return;
  const current = ensureStrutturaCorrezioniMonthKey(anno, keys);
  const idx = keys.indexOf(current);
  const next = keys[Math.max(0, Math.min(keys.length - 1, idx + delta))];
  if (!next || next === current) return;
  strutturaCorrezioniMonthKey = next;
  void renderStrutturaCorrezioniPanel();
}

function getFestivitaListForAnno(anno) {
  const startY = String(anno || getStrutturaFestivitaAnno());
  return (state.messeExtra || [])
    .filter(m => m.data && dateInStrutturaPastoralYear(m.data, startY) && isExtraFestiva(m))
    .slice()
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

async function ensureStrutturaFestivitaLoaded() {
  const anno = getStrutturaFestivitaAnno();
  try {
    await ensureCalendarioForPastoralYear(anno);
  } catch (err) {
    console.error(err);
  }
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
}

async function syncFestivitaFromStruttura() {
  return applicaStruttureAnno();
}

/** Applica i modelli all'anno pastorale (set–ago). `{ quiet: true }` = dopo salvataggio modello. */
async function applicaStruttureAnno(opts = {}) {
  const quiet = !!opts.quiet;
  if (!requireAdminAction('Solo l\'admin può sincronizzare le festività')) return;
  const hasAny = ['domenicale', 'natalizio', 'pasquale', 'defunti', 'festivo'].some(hasStrutturaConfig)
    || Object.keys(STRUTTURA_GIORNI_SPECIALI).some(k => (STRUTTURA_GIORNI_SPECIALI[k] || []).length);
  if (!hasAny && !hasStrutturaConfig('domenicale')) {
    if (!quiet) {
      showToast('Configura almeno un modello');
      setStrutturaLiturgicaTab('modelli');
    }
    return;
  }
  const anno = getStrutturaFestivitaAnno();
  const label = formatPastoralYearLabel(anno);
  try {
    await ensureCalendarioForPastoralYear(anno);
  } catch (err) {
    if (!quiet) showToast(err.message || 'Calendario non disponibile');
    return;
  }
  const { added, updated, removed } = syncFestivitaAnno(anno);
  if (added > 0 || updated > 0 || removed > 0) {
    saveData();
    void persistConfig();
    if (quiet) {
      showToast(`Modello applicato a Messe (${label})`);
    } else {
      const parts = [];
      if (added) parts.push(added === 1 ? '1 aggiunta' : `${added} aggiunte`);
      if (updated) parts.push(updated === 1 ? '1 aggiornata' : `${updated} aggiornate`);
      if (removed) parts.push(removed === 1 ? '1 rimossa' : `${removed} rimosse`);
      showToast(`Festività ${label}: ${parts.join(', ')}`);
    }
  } else if (!quiet) {
    showToast('Agenda già allineata ai modelli');
  } else {
    showToast('Modello salvato e applicato');
  }
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
  void renderStrutturaApplicaPanel();
  void renderStrutturaCorrezioniPanel();
  renderMesseAgenda();
}

/** Anteprima giorni che Messe mostrerà / sync materializzerà per l'anno. */
function previewStrutturaApplicaAnno(anno) {
  anno = String(anno);
  const bounds = getStrutturaPastoralBounds(anno);
  const counts = {
    domenicale: 0,
    natalizio: 0,
    pasquale: 0,
    defunti: 0,
    festivo: 0,
    preset: 0,
    materialize: 0
  };
  const days = [];
  const missingKinds = new Set();
  const byDate = calState.data?.byDate || {};
  const dates = Object.keys(byDate)
    .filter(d => dateInStrutturaPastoralYear(d, anno))
    .sort();
  dates.forEach(dateStr => {
    if (isFestivitaEsclusa(dateStr)) return;
    if (isGiornoIntrasettimanaleEscluso(dateStr)) return;
    const ctx = getLiturgicalContext(dateStr);
    const kind = ctx.strutturaKind;
    const massInfo = getMessaInfo(dateStr);
    // Stesso criterio di Messe: se c’è orario (anche sintetico di stagione), entra in Correzioni
    const willShow = !!(massInfo || isSundayDate(dateStr) || (ctx.preset && ctx.preset !== 'solennita') || isSolennitaFestivaDay(dateStr));
    if (!willShow && !(ctx.strutturaKind === 'festivo' && !isSundayDate(dateStr))) return;
    if (!kind && !massInfo) return;
    const effectiveKind = kind || massInfo?.context?.strutturaKind || massInfo?.extra?.strutturaKind || null;
    if (effectiveKind && counts[effectiveKind] != null) counts[effectiveKind]++;
    if (ctx.preset && ctx.preset !== 'solennita') counts.preset++;
    const needsPersist = (ctx.preset && ctx.preset !== 'solennita')
      || isSolennitaFestivaDay(dateStr)
      || (ctx.strutturaKind === 'festivo' && !isSundayDate(dateStr) && hasStrutturaConfig('festivo'));
    if (needsPersist && !getMessaExtraForDate(dateStr)) {
      counts.materialize++;
      if (effectiveKind && !hasStrutturaConfig(effectiveKind) && !hasOrarioFestivoConfig() && !hasStrutturaConfig('domenicale')) {
        missingKinds.add(effectiveKind);
      }
    }
    if (massInfo || isSundayDate(dateStr) || needsPersist || getMessaExtraForDate(dateStr) || (ctx.preset && ctx.preset !== 'solennita')) {
      days.push({
        data: dateStr,
        label: sanitizeAwayStrutturaName(
          (ctx.preset && ctx.preset !== 'solennita' ? ctx.label : null) || ctx.primary?.nome || ctx.label,
          dateStr,
          'Celebrazione'
        ),
        kind: effectiveKind,
        preset: ctx.preset,
        materialize: needsPersist && !getMessaExtraForDate(dateStr),
        existing: !!getMessaExtraForDate(dateStr)
      });
    }
  });
  days.filter(d => d.materialize).forEach(d => {
    if (d.kind && !hasStrutturaConfig(d.kind) && !hasOrarioFestivoConfig()) {
      if (d.kind !== 'domenicale' || !hasStrutturaConfig('domenicale')) missingKinds.add(d.kind);
    }
  });
  const requiredEmpty = [...missingKinds].filter(k => !hasStrutturaConfig(k));
  return { anno, label: formatPastoralYearLabel(anno), bounds, counts, days, missingKinds: requiredEmpty };
}

async function renderStrutturaApplicaPanel() {
  const summaryEl = document.getElementById('struttura-applica-summary');
  const listEl = document.getElementById('struttura-applica-list');
  const btn = document.getElementById('btn-applica-strutture-anno');
  if (!summaryEl || !listEl) return;
  const anno = getStrutturaFestivitaAnno();
  const label = formatPastoralYearLabel(anno);
  syncStrutturaAnnoSelects(anno);
  if (btn) btn.textContent = `Applica strutture a ${label}`;
  try {
    await ensureCalendarioForPastoralYear(anno);
  } catch (err) {
    summaryEl.innerHTML = `<p class="empty-state">${esc(err.message || 'Calendario non disponibile')}</p>`;
    listEl.innerHTML = '';
    if (btn) btn.disabled = true;
    return;
  }
  const preview = previewStrutturaApplicaAnno(anno);
  const kindChips = Object.keys(STRUTTURA_KINDS).map(k => {
    const n = preview.counts[k] || 0;
    const ok = hasStrutturaConfig(k);
    return `<span class="struttura-applica-stat${!ok && n ? ' is-warn' : ''}">${esc(getStrutturaMeta(k).label)} <strong>${n}</strong>${!ok ? ' · vuota' : ''}</span>`;
  }).join('');
  summaryEl.innerHTML = `
    <div class="struttura-applica-stats">${kindChips}
      <span class="struttura-applica-stat">Preset speciali <strong>${preview.counts.preset}</strong></span>
      <span class="struttura-applica-stat">Da materializzare <strong>${preview.counts.materialize}</strong></span>
    </div>
    ${preview.missingKinds.length
      ? `<p class="liturgy-meta struttura-applica-warn">Configura in Modelli: ${preview.missingKinds.map(k => esc(getStrutturaMeta(k).label)).join(', ')}.
          <button type="button" class="btn btn-ghost-light btn-inline-link" onclick="setStrutturaLiturgicaTab('modelli')">Apri Modelli</button></p>`
      : `<p class="liturgy-meta">Le domeniche di stagione restano automatiche dai modelli; Sync crea le solennità e i giorni speciali.</p>`}
  `;
  if (btn) btn.disabled = !isCurrentUserAdmin();
  const showDays = preview.days.filter(d => d.materialize || d.existing || (d.preset && d.preset !== 'solennita') || (!isSundayDate(d.data) && d.kind === 'festivo'));
  if (!showDays.length) {
    listEl.innerHTML = '<p class="empty-state">Nessun giorno speciale da materializzare per questo anno.</p>';
    return;
  }
  listEl.innerHTML = `
    <h4 class="turni-messe-group-title">Giorni in agenda (${showDays.length})</h4>
    <div class="config-list">
      ${showDays.slice(0, 80).map(d => `
        <div class="config-item">
          <div class="config-item-main">
            <p class="config-item-title">${esc(formatFestivitaDateShort(d.data))} · ${esc(d.label)}</p>
            <p class="config-item-meta">${esc(getStrutturaMeta(d.kind).label)}${d.preset && d.preset !== 'solennita' ? ' · ' + esc(getFestivityPresetMeta(d.preset).label) : ''}${d.materialize ? ' · da applicare' : d.existing ? ' · già in agenda' : ''}</p>
          </div>
          ${isCurrentUserAdmin() ? `
            <div class="config-item-actions">
              <button type="button" class="btn btn-secondary" onclick="editCorrezioneAnno(${jsStr(d.data)})">Modifica</button>
            </div>` : ''}
        </div>
      `).join('')}
    </div>
    ${showDays.length > 80 ? `<p class="liturgy-meta">…e altri ${showDays.length - 80} giorni</p>` : ''}
  `;
}

function openFestivitaFromStruttura(dateStr) {
  void showSection('messe').then(() => {
    showMesseLocalPanel('agenda');
    void loadMesseAgenda().then(() => selectMessaDay(dateStr, true));
  });
}

function formatFestivitaDateShort(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
}

function renderStrutturaFestivitaSection() {
  const anno = getStrutturaFestivitaAnno();
  const list = getFestivitaListForAnno(anno);
  const escluse = getFestivitaEscluse();
  const canManage = isCurrentUserAdmin();
  const items = list.length
    ? list.map(extra => {
      const preset = getFestivityPresetMeta(extra.preset || detectFestivityPreset(extra.data));
      const n = getFestivaTemplateSlots(extra).length;
      const nTurni = getFestivaTurniCount(extra);
      const actions = canManage ? `
        <div class="config-item-actions" onclick="event.stopPropagation()">
          <button type="button" class="btn btn-danger" onclick="escludiFestivita(${jsStr(extra.uuid)})">Senza servizio</button>
        </div>` : '';
      return `
        <div class="config-item struttura-festivita-item">
          <div class="config-item-main">
            <p class="config-item-title">${esc(formatFestivitaDateShort(extra.data))} · ${esc(extra.nota || 'Festività')}</p>
            <p class="config-item-meta">${esc(preset.label)} · ${n} celebrazioni · ${nTurni} con squadra</p>
          </div>
          ${actions}
        </div>`;
    }).join('')
    : `<p class="empty-state" style="margin:0">Nessuna festività in agenda per il ${esc(anno)}.</p>`;

  const escluseHtml = escluse.length ? `
    <h4 class="turni-messe-group-title" style="margin-top:18px">Senza servizio all’altare</h4>
    <p class="liturgy-meta" style="margin:-4px 0 10px">Escluse dallo sync automatico (niente squadra chierichetti)</p>
    <div class="config-list">
      ${escluse.map(ex => `
        <div class="config-item">
          <div class="config-item-main">
            <p class="config-item-title">${esc(ex.nome || ex.eventKey || ex.data || 'Festività')}</p>
            <p class="config-item-meta">${ex.eventKey ? 'Tutti gli anni' : esc(ex.data || '')}</p>
          </div>
          ${canManage ? `
            <div class="config-item-actions">
              <button type="button" class="btn btn-ghost" onclick="ripristinaFestivitaEsclusa(${jsStr(ex.eventKey || ex.data)})">Ripristina</button>
            </div>` : ''}
        </div>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="struttura-festivita-block">
      <h4 class="turni-messe-group-title">Festività ${esc(formatPastoralYearLabel(anno))}</h4>
      <p class="liturgy-meta" style="margin:-4px 0 10px">I modelli si applicano al salvataggio. Usa <strong>Correzioni</strong> per sedi/orari dell’anno pastorale o giorni senza servizio all’altare.</p>
      <div class="config-list">${items}</div>
      ${canManage ? `
        <div class="messa-actions" style="margin-top:12px;justify-content:flex-start;flex-wrap:wrap;gap:8px">
          <button type="button" class="btn btn-secondary" onclick="setStrutturaLiturgicaTab('correzioni')">Vai a Correzioni</button>
        </div>` : ''}
      ${escluseHtml}
    </div>
  `;
}

function ensureFestivaExtraMaterialized(dateStr) {
  if (!Array.isArray(state.messeExtra)) state.messeExtra = [];
  let extra = getMessaExtraForDate(dateStr);
  if (extra) return extra;
  const info = getMessaInfo(dateStr);
  if (info?.type === 'festiva' && info.extra) {
    extra = buildFestivaExtraRecord(dateStr, { source: 'manual' });
    state.messeExtra.push(extra);
    return extra;
  }
  if (info?.type === 'domenica') {
    const ctx = info.context || getLiturgicalContext(dateStr);
    extra = buildFestivaExtraRecord(dateStr, { source: 'manual' });
    extra.nota = sanitizeAwayStrutturaName(ctx.primary?.nome || ctx.label, dateStr, 'Domenica');
    extra.strutturaKind = 'domenicale';
    applyDomenicaleStrutturaToFestivaExtra(extra);
    state.messeExtra.push(extra);
    return extra;
  }
  extra = buildFestivaExtraRecord(dateStr, { source: 'manual' });
  state.messeExtra.push(extra);
  return extra;
}

/** Deep-link: apre Correzioni per sedi di quest’anno pastorale (o lista). */
function openCorrezioneOrari(dateStr) {
  if (dateStr) syncStrutturaAnnoSelects(getPastoralStartForDateStr(dateStr));
  void showSection('strutture-messe').then(() => {
    setStrutturaLiturgicaTab('correzioni');
    if (dateStr) setTimeout(() => editCorrezioneAnno(dateStr), 0);
  });
}

function closeStrutturaCorrezioniEditor() {
  closeStrutturaModelloModal();
  void renderStrutturaCorrezioniPanel();
}

/** Giorni in agenda Correzioni: allineati a ciò che compare in Messe. */
function isCorrezioniListedDay(d, extra) {
  if (extra && extra.tipo === 'straordinaria' && !isExtraFestiva(extra)) return true;
  if (extra?.orarioPersonalizzato) return true;
  if (d?.displaced || isFestivityDisplacedFromDate(d?.data)) return true;
  if (isGiornoIntrasettimanaleEscluso(d.data)) return false;
  if (['natalizio', 'pasquale', 'defunti'].includes(d.kind)) return true;
  if (d.preset && d.preset !== 'solennita') return true;
  if (isVigiliaDomenicaleLiturgica(d.data)) return false;
  if (isSundayDate(d.data)) {
    const ctx = getLiturgicalContext(d.data);
    if (ctx.strutturaKind === 'domenicale' || d.kind === 'domenicale') return true;
    if (['natalizio', 'pasquale', 'defunti'].includes(ctx.strutturaKind)) return true;
    if (ctx.preset && ctx.preset !== 'solennita') return true;
    if (ctx.primary?.tipo === 'solennita' || ctx.strutturaKind === 'festivo') return true;
    return false;
  }
  if (isSolennitaFestivaDay(d.data)) return true;
  if (d.kind === 'festivo') return true;
  const primary = getLiturgicalDayEvent(d.data);
  if (primary?.tipo === 'festa') return true;
  // Fallback: se Messe lo mostra, Correzioni lo elenca
  if (d.data && getMessaInfo(d.data)) return true;
  return false;
}

function applyDomenicaleStrutturaToFestivaExtra(extra) {
  if (!extra) return;
  const template = getStrutturaSlots('domenicale');
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  extra.strutturaKind = 'domenicale';
  extra.preset = extra.preset || 'solennita';
  extra.slots = renumberFestivaSlots(template.map(s => {
    const row = {
      id: newFestivaSlotId(),
      dayOffset: s.dayOffset === -1 ? -1 : 0,
      ora: s.ora || '10:00',
      sede: s.sede || 'santuario',
      vigilia: !!s.vigilia || s.dayOffset === -1,
      conTurno: !!s.conTurno
    };
    if (s.titolo) row.titolo = String(s.titolo).trim();
    return row;
  }));
}

function getCorrezioniDaysForAnno(anno) {
  anno = String(anno || getStrutturaFestivitaAnno());
  const preview = previewStrutturaApplicaAnno(anno);
  const byDate = new Map();

  const upsert = (d) => {
    const extra = getMessaExtraForDate(d.data);
    if (!isCorrezioniListedDay(d, extra)) return;
    const prev = byDate.get(d.data);
    if (prev) {
      if (d.preset && d.preset !== 'solennita') prev.preset = d.preset;
      if (d.kind) prev.kind = d.kind;
      if (d.label) prev.label = d.label;
      if (d.existing) prev.existing = true;
      if (d.materialize && !extra) prev.materialize = true;
      if (d.straordinaria) prev.straordinaria = true;
      if (d.displaced) {
        prev.displaced = true;
        if (d.displacedTo) prev.displacedTo = d.displacedTo;
        if (d.displacedEventKey) prev.displacedEventKey = d.displacedEventKey;
      }
      return;
    }
    byDate.set(d.data, { ...d });
  };

  preview.days.forEach(d => {
    upsert({
      data: d.data,
      label: d.label,
      kind: d.kind,
      preset: d.preset,
      existing: !!getMessaExtraForDate(d.data) || !!d.existing,
      materialize: !!d.materialize && !getMessaExtraForDate(d.data),
      straordinaria: false
    });
  });

  // Garantisce le date effettive dei modelli festa
  ensureCorrezioniModelAnchorDays(anno).forEach(upsert);

  // Giorni LitCal dove la festa è celebrata altrove dalla comunità
  ensureCorrezioniDisplacedDays(anno).forEach(upsert);

  getSundaysInStrutturaPastoralYear(parseInt(anno, 10)).forEach(dateStr => {
    if (isFestivitaEsclusa(dateStr)) return;
    if (byDate.has(dateStr)) return;
    const ctx = getLiturgicalContext(dateStr);
    upsert({
      data: dateStr,
      label: sanitizeAwayStrutturaName(
        (ctx.preset && ctx.preset !== 'solennita' ? ctx.label : null) || ctx.primary?.nome || ctx.label,
        dateStr,
        'Domenica'
      ),
      kind: ctx.strutturaKind,
      preset: ctx.preset,
      existing: !!getMessaExtraForDate(dateStr),
      materialize: false,
      straordinaria: false
    });
  });

  (state.messeExtra || []).forEach(m => {
    if (!m?.data || !dateInStrutturaPastoralYear(m.data, anno)) return;
    const isStraord = m.tipo === 'straordinaria' && !isExtraFestiva(m);
    const ctx = getLiturgicalContext(m.data);
    const preferredLabel = resolveCorrezioneCelebrationLabel(
      { group: null, slots: [] },
      m.eventKey || getPrimaryFestivityEventKey(m.data),
      (ctx.preset && ctx.preset !== 'solennita' ? getFestivityPresetMeta(ctx.preset).label : null)
        || m.nota
        || (isStraord ? 'Messa straordinaria' : 'Celebrazione')
    );
    upsert({
      data: m.data,
      label: preferredLabel,
      kind: m.strutturaKind || ctx.strutturaKind || null,
      preset: m.preset || ctx.preset,
      existing: true,
      materialize: false,
      straordinaria: isStraord
    });
  });

  return [...byDate.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

/**
 * Ancore Correzioni dai modelli: data effettiva di ogni festa configurata.
 * Così 1 nov / 2 nov restano visibili anche se LitCal le ha spostate.
 */
function ensureCorrezioniModelAnchorDays(anno) {
  anno = String(anno);
  const out = [];
  const seen = new Set();
  Object.entries(FESTIVITA_EVENTKEY_BY_PRESET).forEach(([presetId, eventKey]) => {
    const civilAnno = resolveFestivitaAnnoForEventKey(eventKey, anno);
    const effective = getFestivitaDateForAnno(eventKey, civilAnno);
    if (!effective || !dateInStrutturaPastoralYear(effective, anno) || seen.has(effective)) return;
    if (isFestivitaEsclusa(effective)) return;
    seen.add(effective);
    const ctx = getLiturgicalContext(effective);
    const meta = getFestivityPresetMeta(presetId);
    const label = sanitizeAwayStrutturaName(
      resolveCorrezioneCelebrationLabel(
        { group: null, slots: [] },
        eventKey,
        meta?.label || ctx.label || 'Celebrazione'
      ),
      effective,
      meta?.label || 'Celebrazione'
    );
    out.push({
      data: effective,
      label,
      kind: ctx.strutturaKind || (['allSaints', 'allSouls'].includes(presetId) ? 'defunti' : null),
      preset: presetId || ctx.preset,
      existing: !!getMessaExtraForDate(effective),
      materialize: !getMessaExtraForDate(effective),
      straordinaria: false
    });
  });
  return out;
}

/** Giorni LitCal in cui la festa è stata spostata dalla comunità (restano in Correzioni). */
function ensureCorrezioniDisplacedDays(anno) {
  anno = String(anno);
  const byDate = calState.data?.byDate || {};
  const out = [];
  Object.keys(byDate).filter(d => dateInStrutturaPastoralYear(d, anno)).sort().forEach(dateStr => {
    const info = getDisplacedFestivityInfo(dateStr);
    if (!info) return;
    if (isFestivitaEsclusa(dateStr)) return;
    out.push({
      data: dateStr,
      label: info.label,
      kind: null,
      preset: null,
      displaced: true,
      displacedTo: info.effective,
      displacedEventKey: info.eventKey,
      existing: !!getMessaExtraForDate(dateStr),
      materialize: false,
      straordinaria: false
    });
  });
  return out;
}

/** Info festa LitCal presente qui ma celebrata altrove dalla comunità. */
function getDisplacedFestivityInfo(dateStr) {
  if (!isFestivityDisplacedFromDate(dateStr)) return null;
  const fromLit = detectFestivityPresetFromAmbrosian(dateStr);
  if (!fromLit) return null;
  const eventKey = FESTIVITA_EVENTKEY_BY_PRESET[fromLit];
  if (!eventKey) return null;
  const anno = dateStr.slice(0, 4);
  const effective = getFestivitaDateForAnno(eventKey, anno);
  if (!effective || effective === dateStr) return null;
  const primary = primaryEvent(calState.data?.byDate?.[dateStr] || []);
  const meta = getFestivityPresetMeta(fromLit);
  return {
    presetId: fromLit,
    eventKey,
    effective,
    label: resolveCorrezioneCelebrationLabel(
      { group: null, slots: [] },
      eventKey,
      meta?.label || primary?.nome || 'Celebrazione'
    ),
    litName: primary?.nome || meta?.label || null
  };
}

/** Slot concreti di un giorno-ancora (festività/domenica) espansi sulle date civili. */
function expandCorrezioneAnchorSlots(anchor) {
  const extra = getMessaExtraForDate(anchor.data);
  const out = [];
  const pushGroup = (civil, celebration, slots, meta = {}) => {
    if (!civil || !slots?.length) return;
    out.push({
      civil,
      celebration,
      slots,
      sourceDate: anchor.data,
      sourceUuid: meta.sourceUuid || extra?.uuid || null,
      sourceType: meta.sourceType || (extra && isExtraFestiva(extra) ? 'festiva' : (anchor.straordinaria ? 'straordinaria' : 'modello')),
      kind: meta.kind || anchor.kind,
      personalized: !!meta.personalized || !!extra?.orarioPersonalizzato,
      materialize: !!meta.materialize
    });
  };

  const pushFestivityCivilGroups = (byCivil, fallbackLabel, meta) => {
    const eventKey = extra?.eventKey
      || getPrimaryFestivityEventKey(anchor.data)
      || (anchor.preset ? FESTIVITA_EVENTKEY_BY_PRESET[anchor.preset] : null)
      || null;
    byCivil.forEach((slots, civil) => {
      partitionCorrezioneSlotsByCelebration(eventKey, slots).forEach(part => {
        pushGroup(
          civil,
          resolveCorrezioneCelebrationLabel(part, eventKey, fallbackLabel),
          part.slots,
          meta
        );
      });
    });
  };

  if (extra && isExtraFestiva(extra)) {
    const concrete = getFestivaSlots(anchor.data);
    const byCivil = new Map();
    concrete.forEach(s => {
      if (!byCivil.has(s.data)) byCivil.set(s.data, []);
      byCivil.get(s.data).push({
        ora: s.ora,
        sede: s.sede,
        conTurno: !!s.conChierichetti,
        turnoNum: s.turno,
        titolo: s.titolo || null,
        vigilia: !!s.vigilia,
        dayOffset: s.data === anchor.data ? 0 : -1,
        sourceDate: anchor.data,
        sourceUuid: extra.uuid
      });
    });
    pushFestivityCivilGroups(byCivil, extra.nota || anchor.label, {
      sourceUuid: extra.uuid,
      sourceType: 'festiva',
      personalized: !!extra.orarioPersonalizzato
    });
    if (!concrete.length && Array.isArray(extra.slots) && extra.slots.length === 0) {
      const eventKey = extra.eventKey || getPrimaryFestivityEventKey(anchor.data);
      pushGroup(
        anchor.data,
        resolveCorrezioneCelebrationLabel({ group: null, slots: [] }, eventKey, extra.nota || anchor.label),
        [],
        { sourceUuid: extra.uuid, sourceType: 'festiva', personalized: true }
      );
    }
    return out;
  }

  if (extra && extra.tipo === 'straordinaria' && !isExtraFestiva(extra)) {
    pushGroup(anchor.data, extra.nota || 'Messa straordinaria', [{
      ora: extra.ora || '10:00',
      sede: extra.sede || 'santuario',
      conTurno: true,
      titolo: extra.nota || null,
      dayOffset: 0,
      sourceDate: anchor.data,
      sourceUuid: extra.uuid
    }], { sourceUuid: extra.uuid, sourceType: 'straordinaria' });
    return out;
  }

  const isDomOrd = isSundayDate(anchor.data)
    && (anchor.kind === 'domenicale' || getLiturgicalContext(anchor.data).strutturaKind === 'domenicale');
  if (isDomOrd && hasStrutturaConfig('domenicale')) {
    const byCivil = new Map();
    getMesseOrdinarieSlots(anchor.data).forEach(s => {
      if (!byCivil.has(s.data)) byCivil.set(s.data, []);
      byCivil.get(s.data).push({
        ora: s.ora,
        sede: s.sede,
        conTurno: !!s.conChierichetti,
        turnoNum: s.turno,
        titolo: s.titolo || (s.vigilia ? 'Vigilia' : null),
        vigilia: !!s.vigilia,
        dayOffset: s.data === anchor.data ? 0 : -1,
        sourceDate: anchor.data,
        sourceUuid: null
      });
    });
    byCivil.forEach((slots, civil) => {
      // Titolo = nome LitCal del giorno civile (es. Dedicazione del Duomo), non «Domenicale ordinario»
      const litName = getCorrezioneDomenicaleTitle(civil, anchor.data);
      pushGroup(civil, litName, slots, { sourceType: 'domenicale', kind: 'domenicale' });
    });
    return out;
  }

  if (anchor.materialize || (anchor.preset && anchor.preset !== 'solennita')) {
    const eventKey = getPrimaryFestivityEventKey(anchor.data);
    const modello = getFestivitaModello(eventKey);
    let template = modello?.slots || null;
    if (!template) {
      const built = buildFestivityPresetSlots(anchor.preset || detectFestivityPreset(anchor.data));
      template = Array.isArray(built) ? built : getFestivaTemplateSlots({
        strutturaKind: anchor.kind,
        preset: anchor.preset
      });
    }
    const byCivil = new Map();
    (template || []).forEach(s => {
      const civil = addDaysToDateStr(anchor.data, s.dayOffset === -1 ? -1 : 0);
      if (!byCivil.has(civil)) byCivil.set(civil, []);
      byCivil.get(civil).push({
        ora: s.ora,
        sede: s.sede,
        conTurno: !!s.conTurno,
        turnoNum: s.turnoNum,
        titolo: s.titolo || null,
        vigilia: !!s.vigilia || s.dayOffset === -1,
        dayOffset: s.dayOffset === -1 ? -1 : 0,
        sourceDate: anchor.data,
        sourceUuid: null
      });
    });
    pushFestivityCivilGroups(byCivil, anchor.label, { sourceType: 'modello', materialize: true });
  }

  // Feriali di stagione (Natale/Pasqua/Defunti/festivo) senza extra persistito: stesso orario di Messe
  if (!out.length) {
    const seasonKind = anchor.kind || getLiturgicalContext(anchor.data).strutturaKind;
    if (seasonKind && ['natalizio', 'pasquale', 'defunti', 'festivo'].includes(seasonKind)
      && hasStrutturaConfig(seasonKind)) {
      const info = getMessaInfo(anchor.data);
      const synExtra = info?.type === 'festiva' ? info.extra : null;
      const concrete = synExtra
        ? getFestivaSlots(synExtra.data || anchor.data, {
          extra: synExtra,
          civilDate: info.civilDate || null
        })
        : null;
      if (concrete?.length) {
        const byCivil = new Map();
        concrete.forEach(s => {
          if (!byCivil.has(s.data)) byCivil.set(s.data, []);
          byCivil.get(s.data).push({
            ora: s.ora,
            sede: s.sede,
            conTurno: !!s.conChierichetti,
            turnoNum: s.turno,
            titolo: s.titolo || null,
            vigilia: !!s.vigilia,
            dayOffset: s.data === anchor.data ? 0 : -1,
            sourceDate: anchor.data,
            sourceUuid: synExtra?.uuid || null
          });
        });
        byCivil.forEach((slots, civil) => {
          pushGroup(
            civil,
            sanitizeAwayStrutturaName(anchor.label, civil, getLiturgicalDisplayTitle(civil, 'Celebrazione')),
            slots,
            { sourceType: 'modello', kind: seasonKind, materialize: true }
          );
        });
      } else {
        const template = getFestivaTemplateSlots({ strutturaKind: seasonKind });
        const byCivil = new Map();
        (template || []).forEach(s => {
          const civil = addDaysToDateStr(anchor.data, s.dayOffset === -1 ? -1 : 0);
          if (!byCivil.has(civil)) byCivil.set(civil, []);
          byCivil.get(civil).push({
            ora: s.ora,
            sede: s.sede,
            conTurno: !!s.conTurno,
            turnoNum: s.turnoNum,
            titolo: s.titolo || null,
            vigilia: !!s.vigilia || s.dayOffset === -1,
            dayOffset: s.dayOffset === -1 ? -1 : 0,
            sourceDate: anchor.data,
            sourceUuid: null
          });
        });
        byCivil.forEach((slots, civil) => {
          pushGroup(
            civil,
            sanitizeAwayStrutturaName(anchor.label, civil, getLiturgicalDisplayTitle(civil, 'Celebrazione')),
            slots,
            { sourceType: 'modello', kind: seasonKind, materialize: true }
          );
        });
      }
    }
  }

  return out;
}

/** Titolo celebrazione domenicale in Correzioni/Messe: nome LitCal, mai il nome struttura. */
function getCorrezioneDomenicaleTitle(civilDateStr, sundayDateStr) {
  const fromCivil = sanitizeAwayStrutturaName(null, civilDateStr, null);
  if (fromCivil) return fromCivil;
  const fromSunday = sanitizeAwayStrutturaName(null, sundayDateStr || civilDateStr, null);
  if (fromSunday) return fromSunday;
  return getLiturgicalDisplayTitle(sundayDateStr || civilDateStr, 'Domenica');
}

/** Spezza gli slot Correzioni per blocco celebrazione (Modelli). */
function partitionCorrezioneSlotsByCelebration(eventKey, slots) {
  const list = Array.isArray(slots) ? slots : [];
  const celebGroups = getStrutturaGiornoGroupsForEventKey(eventKey).filter(g => g.celebrationKey);
  if (!celebGroups.length || !list.length) {
    return [{ group: null, slots: list.slice() }];
  }
  const assigned = new Set();
  const parts = [];
  celebGroups.forEach(g => {
    const matched = [];
    list.forEach((s, i) => {
      if (assigned.has(i)) return;
      if (!slotMatchesCelebrationKey(s, g.celebrationKey)) return;
      matched.push(s);
      assigned.add(i);
    });
    if (matched.length) parts.push({ group: g, slots: matched });
  });
  const rest = list.filter((_, i) => !assigned.has(i));
  if (rest.length) parts.push({ group: null, slots: rest });
  return parts.length ? parts : [{ group: null, slots: list.slice() }];
}

/** Titolo celebrazione in Correzioni: priorità nome comunità (Modelli) sul LitCal. */
function resolveCorrezioneCelebrationLabel(part, eventKey, fallback) {
  let label = null;
  if (part?.group) label = getStrutturaGiornoDisplayLabel(part.group);
  else if (eventKey) {
    const customMono = getFestivitaModelli().find(m =>
      m.eventKey === eventKey && !m.celebrationKey && m.label && String(m.label).trim()
    );
    if (customMono?.label) label = String(customMono.label).trim();
    else {
      const groups = getStrutturaGiornoGroupsForEventKey(eventKey).filter(g => !g.usesSeasonTemplate);
      if (groups.length === 1) label = getStrutturaGiornoDisplayLabel(groups[0]);
      else {
        const presetId = Object.keys(FESTIVITA_EVENTKEY_BY_PRESET)
          .find(id => FESTIVITA_EVENTKEY_BY_PRESET[id] === eventKey);
        if (presetId) {
          const meta = getFestivityPresetMeta(presetId);
          if (meta?.label) label = meta.label;
        }
      }
    }
  }
  if (!label) label = fallback || 'Celebrazione';
  if (isStrutturaDisplayName(label)) {
    // Mai restituire un nome struttura; preferisci fallback non-struttura o «Celebrazione»
    if (fallback && !isStrutturaDisplayName(fallback)) return fallback;
    return 'Celebrazione';
  }
  return label;
}

/** Giorni civili Correzioni: tutte le celebrazioni/messe che cadono in quella data civile. */
function getCorrezioniCivilDaysForAnno(anno) {
  anno = String(anno || getStrutturaFestivitaAnno());
  const byCivil = new Map();

  const ensure = (civil) => {
    if (byCivil.has(civil)) return byCivil.get(civil);
    const ctx = getLiturgicalContext(civil);
    const day = {
      data: civil,
      label: sanitizeAwayStrutturaName(
        ctx.primary?.nome || ctx.label,
        civil,
        'Giorno'
      ),
      kind: ctx.strutturaKind || null,
      celebrations: [],
      slots: [],
      personalized: false,
      materialize: false,
      straordinaria: false,
      senzaMesse: false
    };
    byCivil.set(civil, day);
    return day;
  };

  getCorrezioniDaysForAnno(anno).forEach(anchor => {
    const displacedInfo = anchor.displaced
      ? {
          effective: anchor.displacedTo,
          eventKey: anchor.displacedEventKey,
          label: anchor.label
        }
      : getDisplacedFestivityInfo(anchor.data);

    if (displacedInfo) {
      const day = ensure(anchor.data);
      day.displaced = true;
      day.displacedTo = displacedInfo.effective || null;
      day.senzaMesse = day.slots.length === 0;
      const movedLabel = displacedInfo.effective
        ? `Spostata dalla comunità → ${formatFestivitaDateShort(displacedInfo.effective)}`
        : 'Spostata dalla comunità';
      day.celebrations.push({
        label: displacedInfo.label || anchor.label || 'Celebrazione',
        kind: null,
        slots: [],
        sourceDate: anchor.data,
        sourceType: 'displaced',
        displacedTo: displacedInfo.effective || null,
        note: movedLabel
      });
      if (!day.label || day.label === 'Giorno') {
        day.label = displacedInfo.label || anchor.label || day.label;
      }
      // Continua: eventuali altre messe (domenicale/extra) sullo stesso giorno
    }

    const groups = expandCorrezioneAnchorSlots(anchor);
    if (!groups.length && isFestivitaEsclusa(anchor.data)) {
      const day = ensure(anchor.data);
      day.senzaMesse = true;
      day.celebrations.push({
        label: anchor.label,
        kind: anchor.kind,
        slots: [],
        sourceDate: anchor.data,
        sourceType: 'esclusa'
      });
      return;
    }
    if (!groups.length && displacedInfo) return;
    groups.forEach(g => {
      if (!dateInStrutturaPastoralYear(g.civil, anno)) return;
      const day = ensure(g.civil);
      if (g.personalized) day.personalized = true;
      if (g.materialize) day.materialize = true;
      if (g.sourceType === 'straordinaria') day.straordinaria = true;
      if (g.kind && !day.kind) day.kind = g.kind;
      day.celebrations.push({
        label: g.celebration,
        kind: g.kind,
        slots: g.slots,
        sourceDate: g.sourceDate,
        sourceUuid: g.sourceUuid,
        sourceType: g.sourceType,
        personalized: g.personalized,
        materialize: g.materialize
      });
      day.slots.push(...g.slots);
    });
  });

  byCivil.forEach(day => {
    day.slots.sort((a, b) => compareOraSlot(a.ora, b.ora) || String(a.sede).localeCompare(String(b.sede)));
    day.senzaMesse = day.slots.length === 0;
    day.celebrations.forEach(c => {
      c.label = sanitizeAwayStrutturaName(c.label, day.data, c.label || 'Celebrazione');
    });
    // Titolo giorno: se una sola celebrazione, usa quella; altrimenti nome liturgico del giorno civile
    if (day.celebrations.length === 1) {
      day.label = day.celebrations[0].label || day.label;
    } else if (day.celebrations.length > 1) {
      const names = [...new Set(day.celebrations.map(c => c.label).filter(Boolean))];
      if (names.length) day.label = names.join(' · ');
    }
    day.label = sanitizeAwayStrutturaName(day.label, day.data, 'Giorno');
  });

  return [...byCivil.values()].sort((a, b) => String(a.data).localeCompare(String(b.data)));
}

/** Cache giorni civili Correzioni per render Messe (per anno pastorale). */
const _correzioniCivilDayCacheByAnno = new Map();

function clearCorrezioniCivilDayCache() {
  _correzioniCivilDayCacheByAnno.clear();
}

function getCorrezioniCivilDaysCached(anno) {
  anno = String(anno || getStrutturaFestivitaAnno());
  let entry = _correzioniCivilDayCacheByAnno.get(anno);
  if (!entry) {
    const days = getCorrezioniCivilDaysForAnno(anno);
    entry = {
      days,
      map: new Map(days.map(d => [d.data, d]))
    };
    _correzioniCivilDayCacheByAnno.set(anno, entry);
  }
  return entry.days;
}

function getCorrezioniCivilDayCached(dateStr) {
  if (!dateStr) return null;
  const anno = String(getPastoralStartForDateStr(dateStr));
  getCorrezioniCivilDaysCached(anno);
  return _correzioniCivilDayCacheByAnno.get(anno)?.map.get(dateStr) || null;
}

/**
 * Titolo Messe = stesso label di Correzioni per il giorno civile
 * (blocchi modello con messe; es. 31 ott vigilia, 1 nov Santi + vespri).
 */
function getMessaCivilDayTitleFromCorrezioni(dateStr) {
  const day = getCorrezioniCivilDayCached(dateStr);
  if (!day) return null;
  const celebs = (day.celebrations || []).filter(c =>
    c.sourceType !== 'displaced' && c.sourceType !== 'esclusa' && (c.slots || []).length
  );
  if (celebs.length === 1) return celebs[0].label || null;
  if (celebs.length > 1) {
    const names = [...new Set(celebs.map(c => c.label).filter(Boolean))];
    if (names.length) return names.join(' · ');
  }
  if (day.displaced && !(day.slots || []).length) return null;
  if ((day.slots || []).length && day.label) return day.label;
  return null;
}

async function renderStrutturaCorrezioniPanel() {
  const listEl = document.getElementById('struttura-correzioni-list');
  if (!listEl) return;

  const anno = getStrutturaFestivitaAnno();
  const pastoralLabel = formatPastoralYearLabel(anno);
  syncStrutturaAnnoSelects(anno);
  ensureGruppiConfig();
  try {
    await ensureCalendarioForPastoralYear(anno);
  } catch (err) {
    listEl.innerHTML = '<p class="empty-state">' + esc(err.message || 'Calendario non disponibile') + '</p>';
    return;
  }

  const canManage = isCurrentUserAdmin();

  const days = getCorrezioniCivilDaysCached(anno);
  const nDom = days.filter(d => isSundayDate(d.data) && d.kind === 'domenicale').length;
  const nOverride = days.filter(d => d.personalized).length;
  const nSenza = days.filter(d => d.senzaMesse).length;
  const nDisplaced = days.filter(d => d.displaced).length;
  const nMesse = days.reduce((sum, d) => sum + d.slots.length, 0);

  const sub = document.getElementById('struttura-correzioni-sub');
  if (sub) {
    const bits = [
      `${days.length} giorni`,
      formatMesseCountLabel(nMesse),
      nDom ? `${nDom} domeniche` : null,
      nOverride ? `${nOverride} personalizzati` : null,
      nDisplaced ? `${nDisplaced} spostate` : null,
      nSenza ? `${nSenza} senza messe` : null
    ].filter(Boolean);
    sub.textContent = bits.join(' · ') + ' · ' + formatStrutturaPastoralRangeLabel(anno);
  }

  if (!days.length) {
    listEl.innerHTML = `
      <div class="struttura-correzioni-empty">
        <p class="empty-state">Nessun giorno con messe per ${esc(pastoralLabel)}. Applica i modelli o configura le strutture.</p>
        ${canManage ? `<button type="button" class="btn btn-secondary" onclick="setStrutturaLiturgicaTab('modelli')">Apri Modelli</button>` : ''}
      </div>`;
    return;
  }

  const byMonth = {};
  days.forEach(d => {
    const key = String(d.data).slice(0, 7);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(d);
  });
  const monthKeysWithDays = Object.keys(byMonth).sort();
  const allMonthKeys = getStrutturaCorrezioniMonthKeys(anno);
  const monthKey = ensureStrutturaCorrezioniMonthKey(anno, monthKeysWithDays);
  const monthIdx = allMonthKeys.indexOf(monthKey);
  const canPrev = monthIdx > 0;
  const canNext = monthIdx >= 0 && monthIdx < allMonthKeys.length - 1;
  const monthLabel = new Date(monthKey + '-15T12:00:00').toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric'
  });
  const monthDays = byMonth[monthKey] || [];

  let html = `
    <div class="struttura-correzioni-month-nav month-nav" role="navigation" aria-label="Mese correzioni">
      <button type="button" class="btn btn-ghost btn-icon" onclick="shiftStrutturaCorrezioniMonth(-1)" ${canPrev ? '' : 'disabled'} aria-label="Mese precedente">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <h4>${esc(monthLabel)}</h4>
      <button type="button" class="btn btn-ghost btn-icon" onclick="shiftStrutturaCorrezioniMonth(1)" ${canNext ? '' : 'disabled'} aria-label="Mese successivo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>
  `;

  if (!monthDays.length) {
    html += `<p class="empty-state">Nessun giorno in ${esc(monthLabel)}</p>`;
  } else {
    html += '<div class="struttura-days struttura-correzioni-days">';
    html += monthDays.map(d => renderCorrezioneCivilDayCard(d, canManage)).join('');
    html += '</div>';
  }

  listEl.innerHTML = html;
}

function renderCorrezioneCivilDayCard(d, canManage) {
  const celebLabels = [...new Set((d.celebrations || []).map(c => c.label).filter(Boolean))];
  const metaBits = [
    d.displaced ? 'spostata dalla comunità' : null,
    d.displacedTo ? `→ ${formatFestivitaDateShort(d.displacedTo)}` : null,
    d.personalized ? 'quest’anno' : (d.displaced && d.senzaMesse ? null : 'da modello'),
    d.senzaMesse ? 'senza messe' : formatMesseCountLabel(d.slots.length),
    celebLabels.length > 1 ? `${celebLabels.length} celebrazioni` : null
  ].filter(Boolean).join(' · ');

  const openAttrs = canManage
    ? `role="button" tabindex="0" onclick="editCorrezioneAnno(${jsStr(d.data)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editCorrezioneAnno(${jsStr(d.data)})}"`
    : '';

  const celebBlocks = (d.celebrations || []).map(c => {
    const rows = (c.slots || []).map(s => {
      const servizio = s.conTurno
        ? (s.turnoNum ? formatMessaServizioShort(s.turnoNum) : 'Squadra')
        : 'Libera';
      const titolo = s.titolo ? `<span class="struttura-sched-title">${esc(s.titolo)}</span>` : '';
      return `<li class="struttura-sched-row${s.conTurno ? ' has-squadra' : ' is-libera'}">
        <span class="struttura-sched-ora">${esc(s.ora || '—')}</span>
        <span class="struttura-sched-main">
          ${titolo}
          <span class="struttura-sched-sede">${esc(SEDI_LABEL[s.sede] || s.sede || '')}</span>
        </span>
        <span class="struttura-sched-servizio">${esc(servizio)}</span>
      </li>`;
    }).join('');
    const emptyCopy = c.sourceType === 'displaced'
      ? (c.note || (c.displacedTo
        ? `Spostata dalla comunità → ${formatFestivitaDateShort(c.displacedTo)}`
        : 'Spostata dalla comunità'))
      : 'Nessuna messa';
    return `
      <div class="struttura-correzione-celeb${c.sourceType === 'displaced' ? ' is-displaced' : ''}">
        <h5 class="struttura-correzione-celeb-title">${esc(c.label || 'Celebrazione')}</h5>
        ${rows
          ? `<ul class="struttura-sched">${rows}</ul>`
          : `<p class="empty-state struttura-day-empty">${esc(emptyCopy)}</p>`}
      </div>`;
  }).join('');

  return `
    <article class="struttura-day is-card is-civil-day${canManage ? ' is-clickable' : ''}${d.personalized ? ' is-customized' : ''}${d.senzaMesse ? ' is-senza-messe' : ''}${d.displaced ? ' is-displaced' : ''}" ${openAttrs}>
      <header class="struttura-day-head">
        <div class="struttura-day-copy">
          <h4 class="struttura-day-title">${esc(formatFestivitaDateShort(d.data))}</h4>
          <p class="struttura-day-meta">${esc(d.label)} · ${esc(metaBits)}</p>
        </div>
        ${canManage ? `
          <div class="struttura-day-actions" onclick="event.stopPropagation()">
            <button type="button" class="btn btn-secondary" onclick="editCorrezioneAnno(${jsStr(d.data)})">Modifica</button>
          </div>` : ''}
      </header>
      ${celebBlocks || '<p class="empty-state struttura-day-empty">Nessuna celebrazione</p>'}
    </article>`;
}

/** Editor giorno civile: modello applicato + messe (solo anno pastorale). */
function editCorrezioneAnno(civilDateStr) {
  if (!requireAdminAction('Solo l\'admin può correggere le sedi dell\'anno')) return;
  const anno = getPastoralStartForDateStr(civilDateStr);
  const dayPlan = getCorrezioniCivilDaysForAnno(anno).find(d => d.data === civilDateStr)
    || { data: civilDateStr, label: getLiturgicalContext(civilDateStr).primary?.nome || 'Giorno', celebrations: [], slots: [] };

  // Materializza le fonti necessarie così il salvataggio ha uuid stabili
  const sourceDates = [...new Set((dayPlan.celebrations || [])
    .filter(c => c.sourceType !== 'displaced' && c.sourceType !== 'esclusa')
    .map(c => c.sourceDate)
    .filter(Boolean))];
  if (!sourceDates.length && !dayPlan.displaced) sourceDates.push(civilDateStr);
  sourceDates.forEach(src => {
    if (isFestivityDisplacedFromDate(src)) return;
    const info = getMessaInfo(src);
    if (info?.type === 'domenica' || info?.type === 'festiva' || !getMessaExtraForDate(src)) {
      ensureFestivaExtraMaterialized(src);
    }
  });

  // Ricarica piano dopo materializzazione
  const refreshed = getCorrezioniCivilDaysForAnno(anno).find(d => d.data === civilDateStr) || dayPlan;
  const hostExtra = ensureFestivaExtraMaterialized(civilDateStr);
  const editorSlots = (refreshed.slots || []).map(s => {
    const sourceDate = s.sourceDate || civilDateStr;
    const sourceExtra = getMessaExtraForDate(sourceDate);
    return {
      ora: s.ora,
      sede: s.sede,
      conTurno: !!s.conTurno,
      titolo: s.titolo || '',
      dayOffset: 0,
      sourceDate,
      sourceUuid: s.sourceUuid || sourceExtra?.uuid || hostExtra.uuid,
      vigilia: !!s.vigilia
    };
  });

  const host = document.getElementById('struttura-slots-editor-host');
  if (!host) return;
  const pastoralLabel = formatPastoralYearLabel(anno);
  const ctx = getLiturgicalContext(civilDateStr);
  const primary = getLiturgicalDayEvent(civilDateStr);
  const override = getLiturgicalDayOverride(civilDateStr) || {};
  const currentKind = hostExtra.strutturaKind || override.strutturaKind || ctx.strutturaKind || 'domenicale';
  const currentTipo = override.tipo || (primary?.grado === 'm' ? 'memoria-facoltativa' : primary?.tipo) || 'feriale';
  const currentNome = override.nome || refreshed.label || primary?.nome || '';
  const assignedKey = findEventKeyForDateOverride(civilDateStr) || hostExtra.eventKey || '';
  const kindOptions = Object.values(STRUTTURA_KINDS).map(meta => {
    const configured = hasStrutturaConfig(meta.id);
    return `<option value="${esc(meta.id)}" ${currentKind === meta.id ? 'selected' : ''}${!configured ? ' disabled' : ''}>${esc(meta.shortLabel || meta.label)}${!configured ? ' (non configurato)' : ''}</option>`;
  }).join('');
  const festivityOptions = Object.entries(FESTIVITA_DEFAULT_MD).map(([key, md]) => {
    const group = Object.values(STRUTTURA_GIORNI_SPECIALI).flat().find(g => g.eventKey === key && !g.usesSeasonTemplate);
    const label = group ? getStrutturaGiornoDisplayLabel(group) : (getFestivityPresetMeta(
      Object.keys(FESTIVITA_EVENTKEY_BY_PRESET).find(id => FESTIVITA_EVENTKEY_BY_PRESET[id] === key) || ''
    ).label || key);
    return `<option value="${esc(key)}" ${assignedKey === key ? 'selected' : ''}>${esc(label)} · def. ${esc(md)}</option>`;
  }).join('');

  host.innerHTML = `
    <div class="struttura-modello-editor" data-correzione-civil="${esc(civilDateStr)}">
      <p class="form-hint struttura-layer-hint">
        Correzioni per <strong>${esc(pastoralLabel)}</strong>: puoi cambiare modello orario, festa assegnata e messe.
        I <strong>Modelli</strong> globali non vengono modificati.
      </p>
      <div class="struttura-correzione-day-config">
        <h4>Giorno e modello</h4>
        <div class="form-group">
          <label for="correzione-day-nome">Nome celebrazione</label>
          <input type="text" id="correzione-day-nome" maxlength="160" value="${esc(currentNome)}" placeholder="Es. Dedicazione del Duomo di Milano">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="correzione-day-tipo">Tipo</label>
            <select id="correzione-day-tipo">
              <option value="solennita" ${currentTipo === 'solennita' ? 'selected' : ''}>Solennità</option>
              <option value="festa" ${currentTipo === 'festa' ? 'selected' : ''}>Festa</option>
              <option value="memoria" ${currentTipo === 'memoria' ? 'selected' : ''}>Memoria</option>
              <option value="memoria-facoltativa" ${currentTipo === 'memoria-facoltativa' ? 'selected' : ''}>Memoria facoltativa</option>
              <option value="feriale" ${currentTipo === 'feriale' ? 'selected' : ''}>Feriale</option>
            </select>
          </div>
          <div class="form-group">
            <label for="correzione-day-struttura">Modello orario</label>
            <select id="correzione-day-struttura">${kindOptions}</select>
          </div>
        </div>
        <div class="form-group">
          <label for="correzione-day-festa">Festa modello su questa data</label>
          <select id="correzione-day-festa">
            <option value="">— nessuna —</option>
            ${festivityOptions}
          </select>
          <p class="form-hint">Sposta qui Tutti i Santi, Defunti, Natale… per quest’anno (indipendente da LitCal).</p>
        </div>
        <div class="form-actions" style="margin-bottom:12px">
          <button type="button" class="btn btn-secondary" onclick="ricaricaMesseCorrezioneDalModello(${jsStr(civilDateStr)})">Ricarica messe dal modello</button>
        </div>
      </div>
      <div class="struttura-modello-slots-head"><h4>Messe del giorno</h4></div>
      <div id="festiva-slots-editor" data-mount="anno-civile" data-civil-date="${esc(civilDateStr)}" data-host-uuid="${esc(hostExtra.uuid)}">
        ${festivaSlotEditorRowsHtml(editorSlots, { civilMode: true }) || '<p class="empty-state">Nessuna messa</p>'}
      </div>
    </div>
  `;
  openStrutturaModelloModal({
    title: formatFestivitaDateShort(civilDateStr),
    sub: sanitizeAwayStrutturaName(currentNome, civilDateStr, 'Giorno') + ' · ' + pastoralLabel,
    mode: 'slots'
  });
  const personalized = !!(refreshed.personalized || hostExtra.orarioPersonalizzato
    || (refreshed.celebrations || []).some(c => c.personalized));
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="addFestivaSlotRow()">+ Messa</button>
      ${personalized || override.nome || override.strutturaKind || assignedKey
        ? `<button type="button" class="btn btn-ghost" onclick="ripristinaCorrezioneCivilDay(${jsStr(civilDateStr)})">Torna al modello</button>`
        : ''}
      <button type="button" class="btn btn-secondary" onclick="closeStrutturaCorrezioniEditor()">Annulla</button>
      <button type="button" class="btn btn-primary" onclick="saveCorrezioneCivilDay(${jsStr(civilDateStr)})">Salva</button>
    `;
  }
}

/** Applica il modello orario scelto e ricarica le messe nell’editor (solo quest’anno). */
function ricaricaMesseCorrezioneDalModello(civilDateStr) {
  if (!requireAdminAction('Solo l\'admin può correggere le sedi dell\'anno')) return;
  const kind = document.getElementById('correzione-day-struttura')?.value;
  if (!kind || !STRUTTURA_KINDS[kind]) {
    showToast('Scegli un modello orario');
    return;
  }
  if (!hasStrutturaConfig(kind)) {
    showToast('Configura prima questo modello in Modelli');
    return;
  }
  if (!confirm('Sostituire le messe di questo giorno con quelle del modello «' + (getStrutturaMeta(kind).shortLabel || getStrutturaMeta(kind).label) + '»?\n\nSolo per quest’anno.')) return;

  // Persisti subito nome/tipo/modello/festa scelti, poi ricarica messe
  if (!saveCorrezioneDayConfig(civilDateStr)) return;

  const festivityKey = document.getElementById('correzione-day-festa')?.value || '';
  const extra = ensureFestivaExtraMaterialized(civilDateStr);
  applyStrutturaToFestivaExtra(extra.uuid, kind, { yearOnly: true, quiet: true });
  if (festivityKey && FESTIVITA_DEFAULT_MD[festivityKey]) {
    extra.eventKey = festivityKey;
    const presetId = Object.keys(FESTIVITA_EVENTKEY_BY_PRESET).find(id => FESTIVITA_EVENTKEY_BY_PRESET[id] === festivityKey);
    if (presetId) {
      const modello = getFestivitaModello(festivityKey);
      if (modello?.slots?.length) {
        extra.slots = renumberFestivaSlots(cloneFestivaSlotsForModello(modello.slots) || []);
        extra.preset = modello.preset || presetId;
      } else {
        applyPresetToFestivaExtra(extra, presetId);
      }
    }
  } else {
    // Senza festa: riempi dagli slot della struttura scelta
    const template = getStrutturaSlots(kind);
    extra.slots = renumberFestivaSlots(template.map((s, i) => ({
      id: newFestivaSlotId(),
      dayOffset: s.dayOffset === -1 ? -1 : 0,
      ora: s.ora || '10:00',
      sede: s.sede || 'santuario',
      vigilia: !!s.vigilia || s.dayOffset === -1,
      conTurno: !!s.conTurno,
      titolo: s.titolo
    })));
  }
  extra.orarioPersonalizzato = false;
  saveData();
  void persistConfig();
  invalidateLiturgyCaches();
  editCorrezioneAnno(civilDateStr);
  showToast('Messe ricaricate dal modello');
}

/** Salva nome/tipo/modello/festa assegnata per il giorno (solo anno). */
function saveCorrezioneDayConfig(civilDateStr) {
  const nome = (document.getElementById('correzione-day-nome')?.value || '').trim();
  const tipo = document.getElementById('correzione-day-tipo')?.value;
  const strutturaKind = document.getElementById('correzione-day-struttura')?.value;
  const festivityKey = document.getElementById('correzione-day-festa')?.value || '';
  if (!nome) {
    showToast('Indica il nome della celebrazione');
    return false;
  }
  if (!STRUTTURA_KINDS[strutturaKind] || !['solennita', 'festa', 'memoria', 'memoria-facoltativa', 'feriale'].includes(tipo)) {
    showToast('Indica tipo e modello orario validi');
    return false;
  }
  ensureGruppiConfig();
  state.gruppiConfig.giorniLiturgici[civilDateStr] = {
    nome,
    tipo,
    strutturaKind,
    updatedAt: new Date().toISOString()
  };

  const anno = civilDateStr.slice(0, 4);
  Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
    const map = getFestivitaDateOverridesMap();
    if (map[key]?.[anno] === civilDateStr && key !== festivityKey) {
      clearFestivitaDateForAnno(key, anno);
    }
  });
  if (festivityKey && FESTIVITA_DEFAULT_MD[festivityKey]) {
    setFestivitaDateForAnno(festivityKey, civilDateStr);
  } else {
    Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
      if (getFestivitaDateOverridesMap()[key]?.[anno] === civilDateStr) {
        clearFestivitaDateForAnno(key, anno);
      }
    });
  }

  const extra = getMessaExtraForDate(civilDateStr) || ensureFestivaExtraMaterialized(civilDateStr);
  if (extra) {
    extra.strutturaKind = strutturaKind;
    extra.nota = nome;
    if (festivityKey) extra.eventKey = festivityKey;
    else if (extra.eventKey && getFestivitaDateForAnno(extra.eventKey, anno) !== civilDateStr) {
      delete extra.eventKey;
    }
  }
  clearLiturgicalSeasonCache();
  invalidateLiturgyCaches();
  return true;
}

function saveCorrezioneCivilDay(civilDateStr) {
  if (!requireAdminAction('Solo l\'admin può correggere le sedi dell\'anno')) return;
  if (document.getElementById('correzione-day-nome') && !saveCorrezioneDayConfig(civilDateStr)) return;
  const editor = document.getElementById('festiva-slots-editor');
  if (!editor || editor.dataset.mount !== 'anno-civile') return;
  const hostUuid = editor.dataset.hostUuid || '';
  const rows = [...editor.querySelectorAll('.festiva-slot-edit')].map((row, i) => {
    const ora = row.querySelector('[data-field="ora"]')?.value || '10:00';
    const sede = row.querySelector('[data-field="sede"]')?.value || 'santuario';
    const conTurno = row.querySelector('[data-field="conTurno"]')?.value === '1';
    const titolo = (row.querySelector('[data-field="titolo"]')?.value || '').trim();
    const sourceDate = row.dataset.sourceDate || civilDateStr;
    const sourceUuid = row.dataset.sourceUuid || hostUuid;
    const slot = {
      id: 'anno-slot-' + i + '-' + Date.now().toString(36),
      dayOffset: 0,
      ora,
      sede,
      vigilia: false,
      conTurno,
      _sourceDate: sourceDate,
      _sourceUuid: sourceUuid
    };
    if (titolo) slot.titolo = titolo;
    return slot;
  });

  if (!rows.length) {
    if (!confirm('Salvare senza messe per questo giorno civile?\n\nResterà senza servizio all’altare finché non le ripristini dal modello.')) return;
  }

  // Rimuovi dalle fonti gli slot che cadevano su questo giorno civile
  const touched = new Map();
  const touch = (extra) => {
    if (!extra) return;
    touched.set(extra.uuid, extra);
  };

  const anno = getPastoralStartForDateStr(civilDateStr);
  getCorrezioniDaysForAnno(anno).forEach(anchor => {
    const extra = getMessaExtraForDate(anchor.data);
    if (!extra || !isExtraFestiva(extra) || !Array.isArray(extra.slots)) return;
    const before = extra.slots.length;
    extra.slots = extra.slots.filter(s => {
      const civil = addDaysToDateStr(extra.data, s.dayOffset === -1 ? -1 : 0);
      return civil !== civilDateStr;
    });
    if (extra.slots.length !== before) touch(extra);
  });

  // Distribuisci i nuovi slot: stesso giorno civile → dayOffset 0 sull’extra della data civile;
  // se la fonte era il giorno dopo (vigilia), dayOffset -1 su quell’extra.
  const hostExtra = (state.messeExtra || []).find(m => m.uuid === hostUuid)
    || ensureFestivaExtraMaterialized(civilDateStr);
  touch(hostExtra);

  const bySource = new Map();
  rows.forEach(slot => {
    let extra = (state.messeExtra || []).find(m => m.uuid === slot._sourceUuid);
    if (!extra || !isExtraFestiva(extra)) extra = hostExtra;
    const sourceDate = extra.data;
    const dayOffset = sourceDate === civilDateStr ? 0 : (addDaysToDateStr(sourceDate, -1) === civilDateStr ? -1 : 0);
    // Se non combacia con la fonte, metti sull’host civile
    const target = (dayOffset === 0 && sourceDate !== civilDateStr && addDaysToDateStr(sourceDate, -1) !== civilDateStr)
      ? hostExtra
      : extra;
    const finalOffset = target.data === civilDateStr ? 0 : -1;
    if (!bySource.has(target.uuid)) bySource.set(target.uuid, { extra: target, slots: [] });
    bySource.get(target.uuid).slots.push({
      id: slot.id,
      dayOffset: finalOffset,
      ora: slot.ora,
      sede: slot.sede,
      vigilia: finalOffset === -1 || !!slot.vigilia,
      conTurno: !!slot.conTurno,
      titolo: slot.titolo
    });
    touch(target);
  });

  bySource.forEach(({ extra, slots }) => {
    if (!Array.isArray(extra.slots)) extra.slots = [];
    extra.slots = renumberFestivaSlots([
      ...extra.slots,
      ...slots.map(s => {
        const row = {
          id: s.id,
          dayOffset: s.dayOffset,
          ora: s.ora,
          sede: s.sede,
          vigilia: !!s.vigilia,
          conTurno: !!s.conTurno
        };
        if (s.titolo) row.titolo = s.titolo;
        return row;
      })
    ]);
    extra.orarioPersonalizzato = true;
    extra.tipo = 'festiva';
    extra.usaOrarioDomenicale = true;
  });

  touched.forEach(extra => {
    extra.orarioPersonalizzato = true;
    if (!Array.isArray(extra.slots)) extra.slots = [];
    extra.slots = renumberFestivaSlots(extra.slots);
    if (isVigilOnlySlotList(extra.slots)) extra.vigilOnly = true;
    else delete extra.vigilOnly;
  });

  // Host civile senza altre messe: se vuoto e non aveva celebrazioni proprie, ok
  if (!rows.length && hostExtra) {
    // già ripulito sopra; assicurati host abbia slots [] se era la sola fonte
    const stillHas = (hostExtra.slots || []).some(s => {
      const civil = addDaysToDateStr(hostExtra.data, s.dayOffset === -1 ? -1 : 0);
      return civil === civilDateStr;
    });
    if (!stillHas && hostExtra.data === civilDateStr) hostExtra.slots = hostExtra.slots || [];
  }

  saveData();
  void persistConfig();
  try {
    syncFestivitaAnno(anno);
  } catch (_) { /* ignore */ }
  invalidateLiturgyCaches();
  showToast(rows.length
    ? ('Correzioni salvate · ' + formatFestivitaDateShort(civilDateStr) + ' · ' + formatPastoralYearLabel(anno))
    : ('Nessuna messa · ' + formatFestivitaDateShort(civilDateStr)));
  closeStrutturaModelloModal();
  void renderStrutturaCorrezioniPanel();
  renderMesseAgenda();
  if (messeState.selectedDate === civilDateStr) renderMessaDetail(civilDateStr);
}

function ripristinaCorrezioneCivilDay(civilDateStr) {
  if (!requireAdminAction('Solo l\'admin può ripristinare dal modello')) return;
  if (!confirm('Ripristinare questo giorno (modello, festa e messe) dalla fonte?\n\nLe modifiche di quest’anno andranno perse.')) return;
  const anno = getPastoralStartForDateStr(civilDateStr);
  const before = getCorrezioniCivilDaysForAnno(anno).find(d => d.data === civilDateStr);
  const sourceDates = [...new Set((before?.celebrations || []).map(c => c.sourceDate).filter(Boolean))];
  if (!sourceDates.includes(civilDateStr)) sourceDates.push(civilDateStr);

  ensureGruppiConfig();
  if (state.gruppiConfig.giorniLiturgici?.[civilDateStr]) {
    delete state.gruppiConfig.giorniLiturgici[civilDateStr];
  }
  const civilAnno = civilDateStr.slice(0, 4);
  Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
    if (getFestivitaDateOverridesMap()[key]?.[civilAnno] === civilDateStr) {
      clearFestivitaDateForAnno(key, civilAnno);
    }
  });
  clearLiturgicalSeasonCache();
  invalidateLiturgyCaches();

  sourceDates.forEach(src => {
    const extra = getMessaExtraForDate(src);
    if (!extra || !isExtraFestiva(extra)) return;
    const eventKey = getPrimaryFestivityEventKey(src) || extra.eventKey;
    const modello = getFestivitaModello(eventKey);
    if (modello) applyFestivitaModelloToExtra(extra, modello);
    else if (extra.strutturaKind === 'domenicale' || getLiturgicalContext(src).strutturaKind === 'domenicale') {
      applyDomenicaleStrutturaToFestivaExtra(extra);
    } else {
      applyPresetToFestivaExtra(extra, detectFestivityPreset(src));
    }
    extra.orarioPersonalizzato = false;
    const ctx = getLiturgicalContext(src);
    if (ctx.strutturaKind) extra.strutturaKind = ctx.strutturaKind;
    if (ctx.label) extra.nota = sanitizeAwayStrutturaName(ctx.label, src, extra.nota || 'Celebrazione');
  });

  try {
    syncFestivitaAnno(anno);
  } catch (_) { /* ignore */ }

  saveData();
  void persistConfig();
  showToast('Ripristinato dal modello');
  editCorrezioneAnno(civilDateStr);
}

/** @deprecated alias */
function saveCorrezioneAnno(uuid) {
  const editor = document.getElementById('festiva-slots-editor');
  if (editor?.dataset.mount === 'anno-civile' && editor.dataset.civilDate) {
    return saveCorrezioneCivilDay(editor.dataset.civilDate);
  }
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (extra?.data) return saveCorrezioneCivilDay(extra.data);
}

function ripristinaCorrezioneAnno(uuid) {
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (extra?.data) return ripristinaCorrezioneCivilDay(extra.data);
}

function festivaSlotEditorRowsHtml(slots, opts = {}) {
  const civilMode = !!opts.civilMode;
  return slots.map((s, idx) => `
    <div class="festiva-slot-edit" data-idx="${idx}" data-source-uuid="${esc(s.sourceUuid || '')}" data-source-date="${esc(s.sourceDate || '')}">
      <div class="form-group festiva-slot-title">
        <label>Titolo / celebrazione <span class="form-optional">(opzionale)</span></label>
        <input type="text" data-field="titolo" maxlength="80" value="${esc(s.titolo || '')}" placeholder="Es. Vigilia, Lavanda dei Piedi">
      </div>
      <div class="form-row festiva-slot-grid${civilMode ? ' is-civil-mode' : ''}">
        ${civilMode ? '' : `
        <div class="form-group">
          <label>Giorno</label>
          <select data-field="dayOffset">
            <option value="-1"${s.dayOffset === -1 ? ' selected' : ''}>Vigilia (giorno prima)</option>
            <option value="0"${s.dayOffset !== -1 ? ' selected' : ''}>Giorno di festa</option>
          </select>
        </div>`}
        <div class="form-group">
          <label>Ora</label>
          <input type="time" data-field="ora" value="${esc(s.ora)}">
        </div>
        <div class="form-group">
          <label>Sede</label>
          <select data-field="sede">
            ${sedeOptionsHtml(s.sede)}
          </select>
        </div>
        <div class="form-group">
          <label>Tipo</label>
          <select data-field="conTurno">
            <option value="1"${s.conTurno ? ' selected' : ''}>Con squadra</option>
            <option value="0"${!s.conTurno ? ' selected' : ''}>Libera</option>
          </select>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-icon" title="Elimina" onclick="removeFestivaSlotRow(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `).join('');
}

function editFestivaSlotsInStruttura(uuid) {
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  const kind = extra?.strutturaKind || 'festivo';
  void showSection('strutture-messe').then(() => {
    setStrutturaLiturgicaTab('modelli');
    setStrutturaMesseKind(STRUTTURA_KINDS[kind] ? kind : 'festivo');
    showToast('Modifica le messe nel modello corrispondente');
  });
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
  else if (tab === 'messe') {
    syncStrutturaMesseFormLabels();
    renderMesseDomenicaliList();
    updateMesseDomenicaliSummary();
  }
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
    const titolo = slot.titolo || null;
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
      titolo,
      label: titolo
        ? `${titolo} · ${slot.ora} ${SEDI_LABEL[slot.sede]}`
        : `${slot.ora} ${SEDI_LABEL[slot.sede]}`
    };
  });
}

function getTurniSlots(domenicaDateStr) {
  return getMesseOrdinarieSlots(domenicaDateStr).filter(s => s.conChierichetti);
}

/** Ancora liturgica (domenica) per un giorno civile, incl. sabato vigiliare. */
function getDomenicaRefFromMassInfo(dateStr, massInfo) {
  if (!massInfo || massInfo.type !== 'domenica') return dateStr;
  return massInfo.domenicaRef || massInfo.fromVigilOf || dateStr;
}

/** Messe ordinarie del solo giorno civile (sabato vigilia vs domenica). */
function getMesseOrdinarieSlotsOnCivil(domenicaRef, civilDateStr) {
  return getMesseOrdinarieSlots(domenicaRef).filter(s => s.data === civilDateStr);
}

function getTurniSlotsOnCivil(domenicaRef, civilDateStr) {
  return getTurniSlots(domenicaRef).filter(s => s.data === civilDateStr);
}

function countAssignedSlotsOnCivil(domenicaRef, civilDateStr) {
  return getTurniSlotsOnCivil(domenicaRef, civilDateStr).filter(isSlotCoperto).length;
}

/**
 * Vigilia sul giorno civile proveniente dalla domenica/festa del giorno dopo.
 * Se la domenica ha orario personalizzato senza slot sabato, ripiega sul modello domenicale.
 */
function resolveCivilDayVigilFromNext(dateStr) {
  if (!dateStr) return null;
  const nextDate = addDaysToDateStr(dateStr, 1);
  if (isFestivitaEsclusa(nextDate)) return null;

  const nextExtra = getMessaExtraForDate(nextDate);
  if (nextExtra && isExtraFestiva(nextExtra) && !isFestivityDisplacedFromDate(nextDate)) {
    const festVigil = festivaConcreteSlotsOnCivilDate(nextExtra, dateStr);
    if (festVigil.length) {
      return {
        kind: 'festiva',
        fromVigilOf: nextDate,
        extra: nextExtra,
        slots: festVigil,
        context: getLiturgicalContext(nextDate)
      };
    }
  }

  if (!isSundayDate(nextDate) || !hasStrutturaConfig('domenicale')) return null;

  // Evita getMessaInfo(next) se stiamo già calcolando next → usa tipo diretto
  let nextIsDomenicaLike = false;
  if (nextExtra && isExtraFestiva(nextExtra)) {
    // Festiva domenicale personalizzata senza vigilia sul sabato: ripiega sul modello
    nextIsDomenicaLike = true;
  } else if (!nextExtra) {
    const nextCtx = getLiturgicalContext(nextDate);
    nextIsDomenicaLike = nextCtx.strutturaKind === 'domenicale'
      || (isSundayDate(nextDate) && !nextCtx.preset);
  }

  if (!nextIsDomenicaLike) {
    // next potrebbe essere domenica sintetica: controlla senza ricorsione infinita
    if (_messaInfoCache.has(nextDate)) {
      const cached = _messaInfoCache.get(nextDate);
      nextIsDomenicaLike = cached?.type === 'domenica' || cached?.type === 'festiva';
    } else {
      // Calcola next (non dipende dal sabato per tipo domenica/festiva del giorno)
      const nextInfo = getMessaInfo(nextDate);
      nextIsDomenicaLike = nextInfo?.type === 'domenica' || nextInfo?.type === 'festiva';
    }
  }

  if (!nextIsDomenicaLike) return null;

  const slots = getMesseOrdinarieSlotsOnCivil(nextDate, dateStr);
  if (!slots.length) return null;
  return {
    kind: 'domenicale',
    fromVigilOf: nextDate,
    domenicaRef: nextDate,
    slots,
    context: getLiturgicalContext(nextDate)
  };
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
    const domenicaRef = getDomenicaRefFromMassInfo(dateStr, info);
    const turniSlots = getTurniSlotsOnCivil(domenicaRef, dateStr);
    return state.turni.filter(t =>
      turniSlots.some(s => s.data === t.data && s.sede === t.parrocchia && s.ora === t.oraInizio)
    );
  }
  if (info?.type === 'festiva') {
    const turniSlots = getFestivaTurniSlots(info.extra?.data || dateStr, {
      extra: info.extra,
      civilDate: info.civilDate || dateStr
    });
    const vigil = Array.isArray(info.vigilSlots) ? info.vigilSlots.filter(s => s.conChierichetti !== false) : [];
    const all = [...turniSlots, ...vigil];
    return state.turni.filter(t =>
      all.some(s => s.data === t.data && s.sede === t.parrocchia && s.ora === t.oraInizio)
    );
  }
  if (info?.type === 'extra' && Array.isArray(info.vigilSlots) && info.vigilSlots.length) {
    const vigil = info.vigilSlots.filter(s => s.conChierichetti !== false);
    return state.turni.filter(t =>
      (t.data === dateStr && t.parrocchia === (info.extra?.sede || 'santuario') && t.oraInizio === (info.extra?.ora || '10:00'))
      || vigil.some(s => s.data === t.data && s.sede === t.parrocchia && s.ora === t.oraInizio)
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
      const domenicaRef = getDomenicaRefFromMassInfo(dateStr, info);
      getTurniSlotsOnCivil(domenicaRef, dateStr).forEach(s => {
        slots.push({ ...s, massInfo: info });
      });
    } else if (info?.type === 'festiva') {
      getFestivaTurniSlots(dateStr, {
        extra: info.extra,
        civilDate: info.civilDate || dateStr
      }).forEach(s => {
        slots.push({ ...s, massInfo: info, isFestiva: true });
      });
      (info.vigilSlots || []).filter(s => s.conChierichetti !== false).forEach(s => {
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
      (info.vigilSlots || []).filter(s => s.conChierichetti !== false).forEach(s => {
        slots.push({ ...s, massInfo: info });
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
      const domenicaRef = getDomenicaRefFromMassInfo(dateStr, info);
      getMesseOrdinarieSlotsOnCivil(domenicaRef, dateStr).forEach(s => {
        slots.push({ ...s, massInfo: info });
      });
    } else if (info?.type === 'festiva') {
      getFestivaSlots(info.extra?.data || dateStr, {
        extra: info.extra,
        civilDate: info.civilDate || dateStr
      }).forEach(s => {
        slots.push({ ...s, massInfo: info, isFestiva: true });
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
              <div class="messa-slot-time">${esc(slot.titolo || 'Messa libera')} · ${esc(slot.ora)} · ${esc(slot.sedeLabel)}</div>
              <div class="messa-slot-meta">${esc(dayLabel)}${slot.titolo ? '' : ' · Messa libera'}</div>
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
            <div class="messa-slot-time">${esc(slot.titolo || formatMessaServizioLabel(slot.turno) || 'Messa')} · ${esc(slot.ora)} · ${esc(slot.sedeLabel)}</div>
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

/** Literal JS string for inline handlers (onclick / onchange), safe in "…" or '…' HTML attrs */
function jsStr(value) {
  return JSON.stringify(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
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
          ${slot.titolo ? `<span class="today-messa-sede">${esc(slot.titolo)}</span>` : `<span class="today-messa-sede">${esc(slot.sedeLabel)}</span>`}
          ${slot.titolo ? `<span class="today-messa-m" style="opacity:.75">${esc(slot.sedeLabel)}</span>` : ''}
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
    ? `<p class="today-empty empty-state-inline today-cal-banner">Calendario liturgico non disponibile — i titoli delle messe possono essere generici. <button type="button" class="btn-ghost-light btn-inline-link" onclick="showSection('calendario')">Apri Calendario</button></p>`
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
  const y = parseInt(startY, 10);
  if (!Number.isFinite(y)) return String(startY || '');
  return `${y}/${String(y + 1).slice(2)}`;
}

function formatPastoralYearRangeLabel(startY) {
  const y = parseInt(startY, 10);
  const from = getPastoralYearWindowStart(y);
  const d = new Date(from + 'T12:00:00');
  const openLabel = d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }).replace('.', '');
  return `${openLabel} ${y} – Giu ${y + 1}`;
}

function getRegistroPastoralBounds(startY) {
  const y = parseInt(startY, 10);
  return {
    from: getPastoralYearWindowStart(y),
    to: `${y + 1}-06-30`
  };
}

/** Bounds Struttura: settembre → agosto (es. 2026/27 = 2026-09-01 … 2027-08-31). */
function getStrutturaPastoralBounds(startY) {
  const y = parseInt(startY, 10);
  return {
    from: `${y}-09-01`,
    to: `${y + 1}-08-31`,
    openFrom: getPastoralYearWindowStart(y)
  };
}

/** Start year pastorale Struttura per una data (set–ago; apertura ~2 sett. prima di set). */
function getStrutturaPastoralStartForDate(d = new Date()) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const today = typeof getTodayStr === 'function' ? getTodayStr() : formatDateFromDate(d);
  const earlyOpen = getPastoralYearWindowStart(y);
  if (today >= earlyOpen && today < `${y}-09-01`) {
    return Math.max(y, REGISTRO_MIN_PASTORAL_START);
  }
  const start = m >= 8 ? y : y - 1;
  return Math.max(start, REGISTRO_MIN_PASTORAL_START);
}

function getPastoralStartForDateStr(dateStr) {
  if (!dateStr || dateStr.length < 10) return getStrutturaPastoralStartForDate();
  return getStrutturaPastoralStartForDate(new Date(dateStr + 'T12:00:00'));
}

function dateInStrutturaPastoralYear(dateStr, startY) {
  if (!dateStr) return false;
  const { from, to } = getStrutturaPastoralBounds(startY);
  return dateStr >= from && dateStr <= to;
}

function getStrutturaPastoralOptionStarts() {
  const max = Math.max(getStrutturaPastoralStartForDate(new Date()) + 1, REGISTRO_MIN_PASTORAL_START);
  const starts = [];
  for (let y = REGISTRO_MIN_PASTORAL_START; y <= max; y++) starts.push(y);
  return starts;
}

function formatStrutturaPastoralRangeLabel(startY) {
  const y = parseInt(startY, 10);
  return `Set ${y} – Ago ${y + 1}`;
}

function getSundaysInStrutturaPastoralYear(startY) {
  const { from, to } = getStrutturaPastoralBounds(startY);
  const dates = [];
  const d = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (d <= end) {
    if (d.getDay() === 0) dates.push(formatDateFromDate(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function ensureCalendarioForPastoralYear(startY) {
  startY = String(startY);
  // Pack startY+startY+1 copre set→ago del pastorale
  return ensureCalendarioForYear(startY);
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
  syncRegistroScopeControls();
}

function setRegistroScope(scope) {
  registroScope = scope === 'anno' || scope === 'mese' ? scope : 'giorno';
  registroLiturgicalDayIndex = 0;
  syncRegistroScopeControls();
  renderRegistro();
}

function syncRegistroScopeControls() {
  document.querySelectorAll('input[name="registro-scope"]').forEach(input => {
    input.checked = input.value === registroScope;
  });
  const navigators = {
    anno: '.registro-month-nav:not(.registro-calendar-nav):not(.registro-liturgical-day-nav)',
    mese: '.registro-calendar-nav',
    giorno: '.registro-liturgical-day-nav'
  };
  const enabled = {
    giorno: new Set(['anno', 'mese', 'giorno']),
    mese: new Set(['anno', 'mese']),
    anno: new Set(['anno'])
  }[registroScope];
  Object.entries(navigators).forEach(([level, selector]) => {
    const nav = document.querySelector(`#registro .registro-toolbar ${selector}`);
    if (!nav) return;
    const isEnabled = enabled.has(level);
    nav.classList.toggle('is-disabled', !isEnabled);
    nav.querySelectorAll('button').forEach(button => { button.disabled = !isEnabled; });
  });
}

function toggleRegistroMass(slotKey) {
  openRegistroMassDetail(slotKey);
  return;
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
    .map(s => ({ ...s, slotKey: s.key || messaSlotKey(s) }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.ora.localeCompare(b.ora));
}

function getRegistroRows(slotsOverride = null) {
  ensureRegistroPeriod();
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

  return rows;
}

function changeRegistroPastoralYear(delta) {
  ensureRegistroPeriod();
  // Mantiene la navigazione mensile attiva anche quando si cambia anno.
  if (registroMonth == null) registroMonth = new Date().getMonth();
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
  registroMonth = null;
  renderRegistro();
}

function changeRegistroMonth(delta) {
  ensureRegistroPeriod();
  const current = registroMonth == null ? new Date().getMonth() : registroMonth;
  let month = current + delta;
  if (month < 0) {
    registroPastoralStart -= 1;
    month = 11;
  } else if (month > 11) {
    registroPastoralStart += 1;
    month = 0;
  }
  const max = getMaxPastoralYearStart();
  if (registroPastoralStart > max) {
    registroPastoralStart = max;
    month = 11;
  }
  if (registroPastoralStart < REGISTRO_MIN_PASTORAL_START) {
    registroPastoralStart = REGISTRO_MIN_PASTORAL_START;
    month = 0;
  }
  registroMonth = month;
  registroLiturgicalDayIndex = 0;
  renderRegistro();
}

function goRegistroThisMonth() {
  const t = new Date();
  registroPastoralStart = getPastoralYearStartForDate(t);
  registroMonth = t.getMonth();
  registroLiturgicalDayIndex = 0;
  renderRegistro();
}

function openRegistroMassDetail(slotKey) {
  const detail = registroMassDetails.get(slotKey);
  const modal = document.getElementById('registro-mass-modal');
  if (!detail || !modal) return;
  document.getElementById('registro-mass-modal-title').textContent = `${(detail.slot.ora || '').slice(0, 5)} · ${detail.slot.sedeLabel}`;
  document.getElementById('registro-mass-modal-sub').textContent = `${new Date(detail.slot.data + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · ${detail.nP} presenti · ${detail.nA} assenti${detail.nP + detail.nA ? ` · ${detail.pct}%` : ''}`;
  document.getElementById('registro-mass-modal-body').innerHTML = detail.people.length
    ? detail.people.map(renderRegistroPersonRow).join('')
    : '<p class="registro-empty-mass">Nessun appello registrato per questa Messa.</p>';
  document.getElementById('registro-mass-modal-appello').onclick = () => openAppello(detail.slot.data, detail.slot.slotKey);
  modal.classList.remove('hidden');
}

function closeRegistroMassDetail() {
  document.getElementById('registro-mass-modal')?.classList.add('hidden');
}

function getRegistroYearSlots() {
  ensureRegistroPeriod();
  const { from, to } = getRegistroPastoralBounds(registroPastoralStart);
  return getAllSlotsForYear(registroPastoralStart)
    .concat(getAllSlotsForYear(registroPastoralStart + 1))
    .filter(s => s.data >= from && s.data <= to)
    .map(s => ({ ...s, slotKey: s.key || messaSlotKey(s) }))
    .sort((a, b) => a.data.localeCompare(b.data) || a.ora.localeCompare(b.ora));
}

function changeRegistroLiturgicalDay(delta) {
  // La navigazione del giorno liturgico segue sempre il mese selezionato.
  const slots = getRegistroMonthSlots();
  const groups = groupMassesByLiturgicalDay(slots);
  if (!groups.length) return;
  registroLiturgicalDayIndex = Math.max(0, Math.min(groups.length - 1, registroLiturgicalDayIndex + delta));
  renderRegistro();
}

function getLiturgicalDayKey(messa) {
  const date = new Date(`${messa.data}T12:00:00`);
  if (messa.vigilia || messa.dayOffset === -1) date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function groupMassesByLiturgicalDay(masses) {
  const groups = new Map();
  masses.forEach(messa => {
    const key = getLiturgicalDayKey(messa);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(messa);
  });
  return [...groups.values()];
}

function formatLiturgicalDayLabel(masses) {
  if (!masses.length) return 'Nessun giorno liturgico';
  const dateKey = getLiturgicalDayKey(masses[0]);
  const events = calState.data?.byDate?.[dateKey] || [];
  const event = primaryEvent(events) || events[0];
  if (event?.nome) return event.nome;
  const date = new Date(`${dateKey}T12:00:00`);
  return date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
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
  const monthLabel = document.getElementById('registro-calendar-month-label');
  if (monthLabel) {
    const month = registroMonth == null ? new Date().getMonth() : registroMonth;
    monthLabel.textContent = `${MONTHS[month]} ${calendarYearForPastoralMonth(registroPastoralStart, month)}`;
  }

  const slots = registroScope === 'anno' ? getRegistroYearSlots() : getRegistroMonthSlots();
  const liturgicalDays = groupMassesByLiturgicalDay(slots);
  registroLiturgicalDayIndex = liturgicalDays.length ? Math.min(registroLiturgicalDayIndex, liturgicalDays.length - 1) : 0;
  const activeSlots = liturgicalDays[registroLiturgicalDayIndex] || [];
  const displaySlots = registroScope === 'giorno' ? activeSlots : slots;
  const activeKeys = new Set(activeSlots.map(s => s.slotKey));
  const allRows = getRegistroRows(slots);
  const rows = registroScope === 'giorno'
    ? allRows.filter(r => activeKeys.has(r.slotKey))
    : allRows;
  const liturgicalDayLabel = document.getElementById('registro-liturgical-day-label');
  if (liturgicalDayLabel) liturgicalDayLabel.textContent = liturgicalDays.length
    ? formatLiturgicalDayLabel(activeSlots)
    : 'Nessun giorno liturgico';
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

  renderRegistroByMessa(displaySlots, rows);
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
  registroMassDetails = new Map();
  rows.forEach(r => {
    const key = r.slotKey || `${r.data}|${r.sede}|${r.ora}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(r);
  });

  const statoF = document.getElementById('registro-filter-stato')?.value || '';
  const gruppoF = document.getElementById('registro-filter-gruppo')?.value || '';
  const q = (document.getElementById('registro-search')?.value || '').trim().toLowerCase();
  const hasPersonFilters = !!(statoF || gruppoF || q);

  // Senza filtri, la vista mostra tutte le messe del periodo; ogni riga
  // indica poi presenze, assenze o appello ancora da compilare.
  const visibleSlots = slots;

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
      : '<p class="empty-state">Nessuna messa passata in questo periodo</p>';
    return;
  }

  const byDate = new Map();
  visibleSlots.forEach(slot => {
    if (!byDate.has(slot.data)) byDate.set(slot.data, []);
    byDate.get(slot.data).push(slot);
  });

  const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));

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
      registroMassDetails.set(slotKey, { slot, people, nP, nA, pct });
      const open = registroOpenSlotKey === slotKey;
      const gruppoBadge = isLibera
        ? '<span class="badge badge-libera">Libera</span>'
        : (slot.gruppoLabel ? esc(slot.gruppoLabel) : '');
      const countsLabel = isLibera
        ? (nP ? `${nP} presenti` : 'Nessun appello')
        : `${nP} P · ${nA} A`;
      const rateBar = !isLibera && tot
        ? `<span class="registro-mass-rate-wrap"><span class="registro-mass-rate" title="${pct}%"><span style="width:${pct}%"></span></span><small>${pct}%</small></span>`
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
              <button type="button" class="btn btn-ghost" onclick='openAppello(${jsStr(slot.data)}, ${jsStr(slotKey)})'>Apri appello</button>
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
    const personaGruppo = r.chi?.gruppo || '';
    // La vista «Per gruppo» segue il gruppo della persona, non quello della
    // messa: anche nelle messe libere ogni persona resta nel proprio gruppo.
    const id = personaGruppo || '_none';
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
  // Include anche il profilo autenticato (Cerimoniere/Don) mostrato nel
  // riquadro personale «Tu», che può non appartenere a state.chierichetti.
  getPersoneGruppiPool().forEach(c => {
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
      const chi = findGruppoPersona(id);
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
      const chi = findGruppoPersona(id);
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
  // L'utente autenticato può prestare servizio e deve poter segnare anche
  // la propria presenza nell'appello.
  return list.slice().sort(sortChierichettiAppello);
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
  if (ruolo === 'cerimoniere') {
    if (!isCurrentUserAdmin()) return;
    anagraficaTab = 'cerimoniere';
    document.getElementById('tab-anag-chierichetti')?.classList.remove('active');
    document.getElementById('tab-anag-cerimonieri')?.classList.add('active');
    syncCerimonieriAdminUi();
    syncAnagraficaStatusTabs();
    syncAnagFab();
    void loadCerimonieriAccounts().then(() => renderCerimonieri());
    return;
  }
  anagraficaTab = 'chierichetto';
  document.getElementById('tab-anag-chierichetti')?.classList.add('active');
  document.getElementById('tab-anag-cerimonieri')?.classList.remove('active');
  document.getElementById('anag-panel-chierichetti').style.display = '';
  syncCerimonieriAdminUi();
  syncAnagFab();
  syncAnagraficaStatusTabs();
  document.getElementById('persona-ruolo').value = 'chierichetto';
  if (!keepForm) {
    cancelPromoteChierichetto();
    cancelEdit();
  } else {
    updateAnagraficaFormLabels();
  }
  renderChierichetti();
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
  const onCerimonieri = document.getElementById('cerimonieri')?.classList.contains('active');
  const canAddCer = (onCerimonieri || (onAnag && anagraficaTab === 'cerimoniere')) && isCurrentUserAdmin();
  const sheetBusy = isAnagSheetOpen();
  const show = !!(isAnagMobile() && !sheetBusy && ((onAnag && anagraficaTab === 'chierichetto') || canAddCer));
  fab.hidden = !show;
  fab.classList.toggle('is-visible', show);
  fab.setAttribute('aria-label', anagraficaTab === 'cerimoniere' ? 'Aggiungi accesso' : 'Aggiungi chierichetto');
}

function onAnagFabClick() {
  if (document.getElementById('cerimonieri')?.classList.contains('active') || anagraficaTab === 'cerimoniere') startNewCerimoniere();
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
    <div class="list-item anag-person${attivo && !promosso ? '' : ' is-ex'}" role="button" tabindex="0" onclick='${rowAction}' onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${rowAction}}">
      <div class="anag-avatar ${avatarClass}" aria-hidden="true">${esc(personInitials(c.nome))}</div>
      <div class="anag-person-body">
        <p class="list-item-title">${chierichettoNomeHtml(c)}</p>
        ${metaLine ? `<p class="anag-person-meta">${esc(metaLine)}</p>` : ''}
        <div class="anag-chips">${chips.join('')}</div>
        ${contacts.length ? `<div class="anag-contact">${contacts.join('')}</div>` : ''}
      </div>
      <div class="list-item-actions">
        <button type="button" class="btn btn-ghost btn-icon anag-person-menu-btn" title="Azioni" aria-label="Azioni per ${esc(c.nome)}" onclick='event.stopPropagation();openAnagPersonMenu(${jsStr(c.uuid)})'>
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
      ${canEdit ? `<button type="button" class="btn btn-primary" onclick='editChierichettoFromDetail(${jsStr(uuid)})'>Modifica</button>` : ''}
      <button type="button" class="btn btn-secondary" onclick='openAnagPersonMenu(${jsStr(uuid)})'>Altre azioni</button>
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
      <button type="button" class="anag-action-item${it.danger ? ' is-danger' : ''}" onclick='runAnagPersonAction(${jsStr(it.action)})'>
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
    else if (action === 'resend') await resendCerimoniereInvite(uuid);
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
  if (canManage && hasCerimoniereLogin(c)) {
    items.push({
      action: 'resend',
      label: c.inviteAccepted === true ? 'Invia cambio password' : 'Reinvia invito accesso',
      icon: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/>'
    });
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
      <button type="button" class="anag-action-item${it.danger ? ' is-danger' : ''}" onclick='runAnagPersonAction(${jsStr(it.action)})'>
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
      <div class="list-item anag-person${attivo ? '' : ' is-ex'}"${rowAction ? ` role="button" tabindex="0" onclick='${rowAction}' onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${rowAction}}"` : ''}>
        <div class="anag-avatar ${avatarClass}" aria-hidden="true">${esc(personInitials(c.nome))}</div>
        <div class="anag-person-body">
          <p class="list-item-title">${esc(c.nome)}</p>
          <p class="anag-person-meta">${esc(metaLine)}</p>
          <div class="anag-chips">${chips.join('')}</div>
          <div class="anag-contact"><span>${contactLine}</span></div>
        </div>
        ${showMenu ? `<div class="list-item-actions">
          <button type="button" class="btn btn-ghost btn-icon anag-person-menu-btn" title="Azioni" aria-label="Azioni per ${esc(c.nome)}" onclick='event.stopPropagation();openAnagCerMenu(${jsStr(c.uuid)})'>
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
    // Senza password viene inviato un invito Supabase: la sceglierà l'utente.
  }

  // Admin che attiva login su record senza credenziali
  if (uuid && isSupabase && !isSelf && !targetHasLogin && wantsLogin) {
    if (!dati.email) {
      showToast('Email obbligatoria per abilitare il login');
      return;
    }
    // Con la sola email l’utente riceve un invito Supabase e sceglie la password.
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

function countDomenicheOrdinarieAnno(anno) {
  anno = String(anno || getStrutturaFestivitaAnno());
  return getSundaysInStrutturaPastoralYear(parseInt(anno, 10)).filter(dateStr => {
    if (isFestivitaEsclusa(dateStr)) return false;
    const ctx = getLiturgicalContext(dateStr);
    return ctx.strutturaKind === 'domenicale';
  }).length;
}

function renderMesseDomenicaliList() {
  const container = document.getElementById('messe-domenicali-list');
  if (!container) return;
  const isDom = strutturaMesseKind === 'domenicale';
  const messe = getStrutturaMesseList();
  const prossimaDom = getProssimeDomeniche(1)[0];
  const meta = getStrutturaMeta(strutturaMesseKind);
  const modelliHtml = renderStrutturaGiorniSpecialiHtml(strutturaMesseKind);
  const anno = getStrutturaFestivitaAnno();

  if (modelliHtml) {
    container.innerHTML = `<div class="struttura-days">${modelliHtml}</div>`;
    return;
  }

  if (isDom) {
    const nDom = countDomenicheOrdinarieAnno(anno);
    if (!messe.length) {
      container.innerHTML = `
        <div class="struttura-festivo-empty">
          <p class="empty-state">Nessuna messa nel modello · ${nDom} domeniche nell’anno</p>
          ${isCurrentUserAdmin() ? `<button type="button" class="btn btn-primary" onclick="openMessaDomenicaleModal()">Aggiungi messa</button>` : ''}
        </div>`;
      return;
    }

    const groups = [
      { key: -1, label: 'Sabato (vigilia)' },
      { key: 0, label: 'Domenica' }
    ];
    container.innerHTML = `
      <p class="struttura-modelli-count">${nDom} domeniche · ${messe.length} messe</p>
      <div class="struttura-days struttura-days-domenicale">
        ${groups.map(g => {
          const items = messe.filter(m => m.dayOffset === g.key);
          if (!items.length) return '';
          return `
            <article class="struttura-day">
              <header class="struttura-day-head">
                <div class="struttura-day-copy">
                  <h4 class="struttura-day-title">${esc(g.label)}</h4>
                </div>
              </header>
              <ul class="struttura-sched">
                ${items.map(m => renderMessaDomenicaleSchedRow(m, prossimaDom)).join('')}
              </ul>
            </article>`;
        }).join('')}
      </div>`;
    return;
  }

  if (!messe.length) {
    container.innerHTML = `
      <div class="struttura-festivo-empty">
        <p class="empty-state">${esc(meta.hint || 'Nessuna messa')}</p>
      </div>`;
    return;
  }

  const groups = [
    { key: -1, label: 'Vigilia (giorno prima)' },
    { key: 0, label: 'Giorno' }
  ];
  container.innerHTML = `<div class="struttura-days">${groups.map(g => {
    const items = messe.filter(m => m.dayOffset === g.key);
    if (!items.length) return '';
    return `
      <article class="struttura-day">
        <header class="struttura-day-head">
          <div class="struttura-day-copy"><h4 class="struttura-day-title">${esc(g.label)}</h4></div>
        </header>
        <ul class="struttura-sched">
          ${items.map(m => renderMessaDomenicaleSchedRow(m, prossimaDom)).join('')}
        </ul>
      </article>`;
  }).join('')}</div>`;
}

function renderMessaDomenicaleSchedRow(m, prossimaDom) {
  const canManage = isCurrentUserAdmin();
  const servizio = m.conTurno
    ? (m.turnoNum ? formatMessaServizioShort(m.turnoNum) : 'Squadra')
    : 'Libera';
  const titolo = m.titolo ? `<span class="struttura-sched-title">${esc(m.titolo)}</span>` : '';
  const editAttrs = canManage
    ? `role="button" tabindex="0" onclick="editMessaDomenicale(${jsStr(m.id)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editMessaDomenicale(${jsStr(m.id)})}"`
    : '';
  return `
    <li class="struttura-sched-row is-editable${m.conTurno ? ' has-squadra' : ' is-libera'}" ${editAttrs}>
      <span class="struttura-sched-ora">${esc(m.ora || '—')}</span>
      <span class="struttura-sched-main">
        ${titolo}
        <span class="struttura-sched-sede">${esc(SEDI_LABEL[m.sede] || m.sede)}</span>
      </span>
      <span class="struttura-sched-servizio">${esc(servizio)}</span>
      ${canManage ? `
        <span class="struttura-sched-row-actions" onclick="event.stopPropagation()">
          <button type="button" class="btn btn-ghost btn-icon" title="Elimina" onclick="deleteMessaDomenicale(${jsStr(m.id)})">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </span>` : ''}
    </li>
  `;
}

function slotMatchesCelebrationKey(slot, celebrationKey) {
  if (!celebrationKey) return true;
  const titolo = String(slot?.titolo || '').toLowerCase();
  const dayOffset = slot?.dayOffset === -1 ? -1 : 0;
  switch (celebrationKey) {
    case 'vigilia':
      return dayOffset === -1 || /vigilia/.test(titolo);
    case 'notte':
      return /notte/.test(titolo);
    case 'lavanda':
      return /lavanda/.test(titolo);
    case 'cena':
      return /cena/.test(titolo);
    case 'passione':
      return /passione/.test(titolo);
    case 'viaCrucis':
      return /via\s*crucis|viacrucis/.test(titolo);
    case 'vespri':
      return dayOffset === -1 || /vespri|processione|vigilia\s*dei\s*defunti/.test(titolo);
    case 'giorno':
      return dayOffset !== -1
        && !/vigilia|notte|lavanda|cena|via\s*crucis|vespri|processione/.test(titolo);
    default:
      return true;
  }
}

function getStrutturaGiornoGroupsForEventKey(eventKey) {
  if (!eventKey) return [];
  return Object.values(STRUTTURA_GIORNI_SPECIALI)
    .flat()
    .filter(g => g.eventKey === eventKey && !g.usesSeasonTemplate);
}

function festivitaModelloMatches(m, eventKey, celebrationKey) {
  if (!m || m.eventKey !== eventKey) return false;
  if (!celebrationKey) return !m.celebrationKey;
  if (m.celebrationKey === celebrationKey) return true;
  // Legacy: vespri Defunti erano salvati come vigilia
  if (eventKey === 'AllSouls' && celebrationKey === 'vespri' && m.celebrationKey === 'vigilia') return true;
  if (eventKey === 'AllSaints' && celebrationKey === 'vespri' && m.celebrationPreset === 'allSaintsVespers') return true;
  return false;
}

function getFestivitaModelloCelebrazione(eventKey, celebrationKey) {
  if (!eventKey) return null;
  const all = getFestivitaModelli();
  const exact = all.find(m => festivitaModelloMatches(m, eventKey, celebrationKey));
  if (exact) return exact;
  // Legacy: un solo modello per eventKey senza celebrationKey
  if (celebrationKey) {
    const legacy = all.find(m => m.eventKey === eventKey && !m.celebrationKey);
    if (legacy?.disabled) {
      return { ...legacy, celebrationKey, slots: [], disabled: true, _fromLegacy: true };
    }
    if (legacy && Array.isArray(legacy.slots)) {
      const filtered = legacy.slots.filter(s => slotMatchesCelebrationKey(s, celebrationKey));
      if (filtered.length) {
        return { ...legacy, celebrationKey, slots: filtered, _fromLegacy: true };
      }
    }
  }
  return null;
}

/** Default ambrosiano (preset) per un blocco celebrazione. */
function getAmbrosianDefaultSlotsForGroup(group) {
  if (!group) return [];
  if (group.usesSeasonTemplate) {
    const kind = group.seasonKind || strutturaMesseKind;
    return cloneStrutturaSlots(kind).map(s => ({ ...s, titolo: s.titolo || undefined }));
  }
  const built = buildFestivityPresetSlots(group.presetId);
  return Array.isArray(built) ? built : [];
}

/**
 * Stato del modello comunità rispetto al default ambrosiano.
 * `ambrosiano` = segue il preset; `comunita` = orario locale; `disabilitato` = non celebriamo.
 */
function getCommunityCelebrationState(group) {
  if (!group) return { mode: 'ambrosiano', slots: [], modello: null };
  if (group.usesSeasonTemplate) {
    const slots = getAmbrosianDefaultSlotsForGroup(group);
    // I template di stagione sono già il modello comunità (feriali del tempo)
    return { mode: 'comunita', slots, modello: null, isSeasonTemplate: true };
  }
  const celebrationKey = group.celebrationKey || null;
  const modello = group.eventKey
    ? getFestivitaModelloCelebrazione(group.eventKey, celebrationKey)
    : null;
  if (modello?.disabled) {
    return { mode: 'disabilitato', slots: [], modello };
  }
  if (modello && Array.isArray(modello.slots) && !modello._fromLegacy) {
    return {
      mode: 'comunita',
      slots: renumberFestivaSlots(modello.slots.map(s => ({
        id: s.id || newFestivaSlotId(),
        dayOffset: s.dayOffset === -1 ? -1 : 0,
        ora: s.ora || '10:00',
        sede: s.sede || 'santuario',
        vigilia: !!s.vigilia || s.dayOffset === -1,
        conTurno: !!s.conTurno,
        turnoNum: s.turnoNum,
        titolo: s.titolo ? String(s.titolo).trim() : undefined
      }))),
      modello
    };
  }
  return {
    mode: 'ambrosiano',
    slots: getAmbrosianDefaultSlotsForGroup(group),
    modello: modello?._fromLegacy ? modello : null
  };
}

function getSlotsForStrutturaGiornoSpeciale(group) {
  return getCommunityCelebrationState(group).slots;
}

function communityModeLabel(mode) {
  if (mode === 'disabilitato') return 'Non celebriamo';
  if (mode === 'comunita') return 'Modello comunità';
  return 'Default ambrosiano';
}

function formatMesseCountLabel(n) {
  const count = Number(n) || 0;
  if (count === 1) return '1 messa';
  return `${count} messe`;
}

/** Nome visualizzato del blocco celebrazione (override comunità o label di default). */
function getStrutturaGiornoDisplayLabel(group) {
  if (!group) return '';
  if (group.eventKey) {
    const celeb = getFestivitaModelloCelebrazione(group.eventKey, group.celebrationKey || null);
    const custom = celeb && !celeb._fromLegacy && celeb.label ? String(celeb.label).trim() : '';
    if (custom) return custom;
  }
  // «Messe del giorno» → nome festa (Tutti i Santi / Defunti)
  if (group.celebrationKey === 'giorno' && group.dayPreset) {
    const meta = getFestivityPresetMeta(group.dayPreset);
    if (meta?.label) return meta.label;
  }
  return group.label || '';
}

function renderStrutturaGiornoSpecialeSlotItem(slot) {
  const sede = SEDI_LABEL[slot.sede] || slot.sede;
  const servizio = slot.conTurno
    ? (slot.turnoNum ? formatMessaServizioShort(slot.turnoNum) : 'Squadra')
    : 'Libera';
  const titolo = slot.titolo ? `<span class="struttura-sched-title">${esc(slot.titolo)}</span>` : '';
  const vigilia = slot.dayOffset === -1 ? '<span class="struttura-sched-vigilia">Vigilia</span>' : '';
  return `
    <li class="struttura-sched-row${slot.conTurno ? ' has-squadra' : ' is-libera'}">
      <span class="struttura-sched-ora">${esc(slot.ora || '—')}</span>
      <span class="struttura-sched-main">
        ${titolo}
        <span class="struttura-sched-sede">${esc(sede)}</span>
        ${vigilia}
      </span>
      <span class="struttura-sched-servizio">${esc(servizio)}</span>
    </li>
  `;
}

function renderStrutturaGiorniSpecialiHtml(kind) {
  const groups = STRUTTURA_GIORNI_SPECIALI[kind];
  if (!groups?.length) return '';
  const canManage = isCurrentUserAdmin();
  const anno = getStrutturaFestivitaAnno();
  return groups.map(g => {
    const stateCeleb = getCommunityCelebrationState(g);
    const slots = stateCeleb.slots;
    const celebrationKey = g.celebrationKey || null;
    const mode = stateCeleb.mode;
    const customized = mode === 'comunita' && !stateCeleb.isSeasonTemplate;
    const disabled = mode === 'disabilitato';
    const civilOff = getCelebrationCivilDayOffset(g, stateCeleb.slots);
    const meta = g.eventKey ? getFestivitaModelloDateMeta(g.eventKey, anno, civilOff) : null;
    const dateMoved = meta?.source === 'correzione';
    const displayLabel = getStrutturaGiornoDisplayLabel(g);
    const dayTitle = meta?.effective
      ? formatFestivitaDayMonthLabel(meta.effective)
      : (g.dateHint || null);
    const title = dayTitle ? `${dayTitle} · ${displayLabel}` : displayLabel;
    const dateBits = [];
    if (g.usesSeasonTemplate) {
      dateBits.push(g.dateHint || 'Feriali del tempo');
    } else if (meta) {
      if (meta.ambrosian) {
        dateBits.push(`Ambrosiano ${meta.ambrosianLabel}`);
      } else if (meta.civilDefault) {
        dateBits.push(`Civile ${formatShortFestivitaDate(meta.civilDefault)}`);
      } else {
        dateBits.push('Non nel calendario ambrosiano');
      }
      if (dateMoved) dateBits.push(`Comunità ${meta.effectiveLabel}`);
      else if (meta.effective && meta.source === 'ambrosiano') {
        /* già in Ambrosiano */
      } else if (meta.effective && meta.source === 'civile') {
        dateBits.push(`Applicato ${meta.effectiveLabel}`);
      }
    }
    const metaBits = [
      ...dateBits,
      disabled ? null : formatMesseCountLabel(slots.length),
      customized ? 'orario locale' : null
    ].filter(Boolean);
    const openAttrs = canManage
      ? `role="button" tabindex="0" onclick="editStrutturaGiornoSpeciale(${jsStr(kind)}, ${jsStr(g.presetId)})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();editStrutturaGiornoSpeciale(${jsStr(kind)}, ${jsStr(g.presetId)})}"`
      : '';
    const emptyCopy = disabled
      ? 'La comunità non celebra · il calendario ambrosiano la prevede'
      : (g.usesSeasonTemplate
        ? 'Nessuna messa nel modello feriale'
        : 'Nessuna messa');
    return `
      <article class="struttura-day is-card${customized || dateMoved || disabled ? ' is-customized' : ''}${disabled ? ' is-disabled' : ''}${canManage ? ' is-clickable' : ''}" data-preset="${esc(g.presetId)}" data-celebration="${esc(g.celebrationKey || '')}" data-mode="${esc(mode)}" ${openAttrs}>
        <header class="struttura-day-head">
          <div class="struttura-day-copy">
            <p class="struttura-day-badge struttura-day-badge--${esc(mode)}">${esc(communityModeLabel(mode))}</p>
            <h4 class="struttura-day-title">${esc(title)}</h4>
            <p class="struttura-day-meta">${esc(metaBits.join(' · '))}</p>
          </div>
          ${canManage ? `
            <div class="struttura-day-actions" onclick="event.stopPropagation()">
              ${disabled || customized ? `<button type="button" class="btn btn-ghost" onclick="ripristinaStrutturaGiornoSpeciale(${jsStr(g.eventKey)}, ${jsStr(celebrationKey || '')})">Default ambrosiano</button>` : ''}
              ${!disabled && g.eventKey && !g.usesSeasonTemplate ? `<button type="button" class="btn btn-ghost" onclick="disabilitaStrutturaGiornoSpeciale(${jsStr(g.eventKey)}, ${jsStr(celebrationKey || '')}, ${jsStr(g.presetId)})">Non celebriamo</button>` : ''}
              <button type="button" class="btn btn-secondary" onclick="editStrutturaGiornoSpeciale(${jsStr(kind)}, ${jsStr(g.presetId)})">${disabled ? 'Attiva' : 'Modifica'}</button>
            </div>` : ''}
        </header>
        ${slots.length
          ? `<ul class="struttura-sched">${slots.map(renderStrutturaGiornoSpecialeSlotItem).join('')}</ul>`
          : `<p class="empty-state struttura-day-empty">${esc(emptyCopy)}</p>`}
      </article>
    `;
  }).join('');
}

function openStrutturaModelloModal({ title, sub, mode }) {
  const overlay = document.getElementById('struttura-modello-modal');
  const titleEl = document.getElementById('struttura-modello-modal-title');
  const subEl = document.getElementById('struttura-modello-modal-sub');
  const form = document.getElementById('messaDomenicaleForm');
  const host = document.getElementById('struttura-slots-editor-host');
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (!overlay || !form || !host || !actions) return;
  if (titleEl) titleEl.textContent = title || 'Modifica';
  if (subEl) {
    subEl.textContent = sub || '';
    subEl.hidden = !sub;
  }
  form.hidden = mode !== 'domenicale';
  host.hidden = mode !== 'slots';
  if (mode !== 'slots') host.innerHTML = '';
  overlay.classList.remove('hidden');
  document.body.classList.add('struttura-modal-open');
}

function closeStrutturaModelloModal() {
  const overlay = document.getElementById('struttura-modello-modal');
  const host = document.getElementById('struttura-slots-editor-host');
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (overlay) overlay.classList.add('hidden');
  document.body.classList.remove('struttura-modal-open');
  if (host) host.innerHTML = '';
  if (actions) actions.innerHTML = '';
  cancelMessaDomenicaleEdit({ keepModal: true });
}

function openMessaDomenicaleModal() {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  cancelMessaDomenicaleEdit({ keepModal: true });
  setTurniFormMode(false);
  openStrutturaModelloModal({
    title: 'Nuova messa',
    sub: getStrutturaMeta(strutturaMesseKind).hint || 'Aggiungi una messa al modello',
    mode: 'domenicale'
  });
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="btn btn-secondary" onclick="closeStrutturaModelloModal()">Annulla</button>
      <button type="submit" form="messaDomenicaleForm" class="btn btn-primary" id="btn-save-messa-domenicale">Aggiungi celebrazione</button>
    `;
  }
  document.getElementById('messa-domenicale-ora')?.focus();
}

function editStrutturaGiornoSpeciale(kind, presetId) {
  if (!requireAdminAction('Solo l\'admin può modificare i modelli')) return;
  const group = (STRUTTURA_GIORNI_SPECIALI[kind] || []).find(g => g.presetId === presetId);
  if (!group) return;
  const celebState = getCommunityCelebrationState(group);
  const ambrosianSlots = getAmbrosianDefaultSlotsForGroup(group);
  // Se era disabilitato, apri con il default ambrosiano così si può riattivare
  const slots = celebState.mode === 'disabilitato' ? ambrosianSlots : celebState.slots;
  const seasonKind = group.seasonKind || kind;
  const host = document.getElementById('struttura-slots-editor-host');
  if (!host) return;
  const pastoralAnno = getStrutturaFestivitaAnno();
  const civilAnno = group.eventKey
    ? resolveFestivitaAnnoForEventKey(group.eventKey, pastoralAnno)
    : pastoralAnno;
  const civilDayOffset = getCelebrationCivilDayOffset(group, slots);
  const dateMeta = group.eventKey ? getFestivitaModelloDateMeta(group.eventKey, pastoralAnno, civilDayOffset) : null;
  const currentDate = dateMeta?.effective || '';
  const displayLabel = getStrutturaGiornoDisplayLabel(group);
  const civilDefaultHint = dateMeta?.civilDefault
    ? formatShortFestivitaDate(dateMeta.civilDefault)
    : (group.dateHint || '—');
  const ambrosianHint = dateMeta?.ambrosian
    ? formatShortFestivitaDate(dateMeta.ambrosian)
    : null;
  const nameField = !group.usesSeasonTemplate ? `
    <div class="form-group struttura-celeb-name-field">
      <label for="struttura-celeb-nome">Nome celebrazione</label>
      <input type="text" id="struttura-celeb-nome" maxlength="60" value="${esc(displayLabel)}" placeholder="${esc(group.label || 'Celebrazione')}">
    </div>
  ` : '';
  const dateField = group.eventKey && !group.usesSeasonTemplate ? `
    <div class="struttura-giorno-date-panel">
      <div class="form-group struttura-giorno-date-field">
        <label for="struttura-giorno-data">Giorno civile delle messe · ${esc(formatPastoralYearLabel(pastoralAnno))}</label>
        <input type="date" id="struttura-giorno-data" value="${esc(currentDate || '')}" data-civil-day-offset="${civilDayOffset}">
      </div>
      <dl class="struttura-date-facts">
        <div><dt>Riferimento civile</dt><dd>${esc(civilDefaultHint)}</dd></div>
        <div><dt>Calendario ambrosiano</dt><dd>${esc(ambrosianHint || 'non trovato')}</dd></div>
      </dl>
      <p class="form-hint">${civilDayOffset === -1
        ? 'Questa è la sera/giorno civile della celebrazione (es. 31 ott). La festa liturgica resta il giorno dopo; spostare questa data sposta anche la festa.'
        : 'Cambia la data solo se celebrate in un altro giorno rispetto al riferimento.'}</p>
    </div>
  ` : '';
  const layerHint = group.usesSeasonTemplate
    ? `<p class="form-hint struttura-layer-hint">Solo feriali (lun–sab) senza festa specifica. Le domeniche del tempo usano il modello domenicale ordinario (modificabile in Correzioni).</p>`
    : `<p class="form-hint struttura-layer-hint">
        Default ambrosiano: <strong>${formatMesseCountLabel(ambrosianSlots.length)}</strong>.
        Salva per sovrascrivere con l’orario della comunità; nessuna messa = «non celebriamo».
      </p>`;
  host.innerHTML = `
    <div class="struttura-modello-editor">
      ${nameField}
      ${dateField}
      ${layerHint}
      <div class="struttura-modello-slots-head">
        <h4>Messe</h4>
      </div>
      <div id="festiva-slots-editor" data-mount="struttura-giorno" data-event-key="${esc(group.eventKey || '')}" data-celebration-key="${esc(group.celebrationKey || '')}" data-preset="${esc(group.presetId)}" data-day-preset="${esc(group.dayPreset || group.presetId)}" data-season-template="${group.usesSeasonTemplate ? '1' : '0'}" data-season-kind="${esc(seasonKind)}" data-civil-anno="${esc(civilAnno)}" data-civil-day-offset="${civilDayOffset}" data-default-label="${esc(group.label || '')}">
        ${festivaSlotEditorRowsHtml(slots) || '<p class="empty-state">Nessuna messa</p>'}
      </div>
    </div>
  `;
  openStrutturaModelloModal({
    title: group.dateHint ? `${group.dateHint} · ${displayLabel}` : displayLabel,
    sub: [
      communityModeLabel(celebState.mode),
      ambrosianHint ? `ambrosiano ${ambrosianHint}` : null,
      dateMeta?.source === 'correzione' ? `comunità ${dateMeta.effectiveLabel}` : null
    ].filter(Boolean).join(' · '),
    mode: 'slots'
  });
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="btn btn-ghost" onclick="addFestivaSlotRow()">+ Messa</button>
      <button type="button" class="btn btn-secondary" onclick="closeStrutturaModelloModal()">Annulla</button>
      <button type="button" class="btn btn-primary" onclick="saveStrutturaGiornoSpeciale(${jsStr(group.eventKey || '')}, ${jsStr(group.presetId)})">Salva</button>
    `;
  }
  document.getElementById('struttura-celeb-nome')?.focus();
}

function saveStrutturaGiornoSpeciale(eventKey, presetId) {
  if (!requireAdminAction('Solo l\'admin può modificare i modelli')) return;
  const editor = document.getElementById('festiva-slots-editor');
  if (!editor) return;
  const celebrationKey = editor.dataset.celebrationKey || '';
  const slots = [...editor.querySelectorAll('.festiva-slot-edit')].map((row, i) => {
    const dayOffset = parseInt(row.querySelector('[data-field="dayOffset"]')?.value, 10) === -1 ? -1 : 0;
    const ora = row.querySelector('[data-field="ora"]')?.value || '10:00';
    const sede = row.querySelector('[data-field="sede"]')?.value || 'santuario';
    const conTurno = row.querySelector('[data-field="conTurno"]')?.value === '1';
    const titolo = (row.querySelector('[data-field="titolo"]')?.value || '').trim();
    const sameDayVigil = celebrationKey === 'vigilia' || celebrationKey === 'notte'
      || /^(vigilia|notte)\b/i.test(titolo);
    const slot = {
      id: 'mod-slot-' + i + '-' + Date.now().toString(36),
      dayOffset,
      ora,
      sede,
      vigilia: dayOffset === -1 || sameDayVigil,
      conTurno
    };
    if (titolo) slot.titolo = titolo;
    return slot;
  });
  ensureGruppiConfig();
  const usesSeason = editor.dataset.seasonTemplate === '1';
  const seasonKind = editor.dataset.seasonKind || strutturaMesseKind;
  const defaultLabel = editor.dataset.defaultLabel
    || (STRUTTURA_GIORNI_SPECIALI[strutturaMesseKind] || []).find(g => g.presetId === presetId)?.label
    || getFestivityPresetMeta(presetId).label;
  const customName = (document.getElementById('struttura-celeb-nome')?.value || '').trim();
  const label = customName || defaultLabel;

  if (usesSeason) {
    if (!slots.length) {
      if (!confirm('Nessuna messa: i feriali del tempo (lun–sab senza festa) non avranno orari.\n\nContinuare?')) return;
    }
    const key = getStrutturaConfigKey(seasonKind);
    state.gruppiConfig[key] = renumberFestivaSlots(slots.map((s, i) => ({
      id: s.id || ('st-' + seasonKind.slice(0, 3) + '-' + i),
      dayOffset: s.dayOffset,
      ora: s.ora,
      sede: s.sede,
      vigilia: !!s.vigilia,
      conTurno: !!s.conTurno,
      titolo: s.titolo
    })));
    if (seasonKind === 'festivo') state.gruppiConfig.messeFestive = state.gruppiConfig[key];
    if (seasonKind === 'domenicale') state.gruppiConfig.messeDomenicali = state.gruppiConfig[key];
    renumberStrutturaSlots(seasonKind);
    afterGruppiConfigChange();
    renderMesseDomenicaliList();
    updateMesseDomenicaliSummary();
    closeStrutturaModelloModal();
    showToast(slots.length ? 'Modello salvato' : 'Feriali senza messe');
    return;
  }

  if (!eventKey) {
    showToast('Modello non salvabile');
    return;
  }
  const dayPreset = editor.dataset.dayPreset || presetId;
  const dateEl = document.getElementById('struttura-giorno-data');
  if (dateEl) {
    const newCivilDate = (dateEl.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newCivilDate)) {
      showToast('Indica una data valida');
      return;
    }
    // Il campo mostra il giorno civile delle messe; per vigilia/vespri (offset -1)
    // la data salvata sull’eventKey è il giorno liturgico successivo.
    const civilOff = parseInt(dateEl.dataset.civilDayOffset || editor.dataset.civilDayOffset || '0', 10) === -1 ? -1 : 0;
    const anchorDate = civilOff === -1 ? addDaysToDateStr(newCivilDate, 1) : newCivilDate;
    setFestivitaDateForAnno(eventKey, anchorDate);
  }
  if (!Array.isArray(state.gruppiConfig.festivitaModelli)) state.gruppiConfig.festivitaModelli = [];
  // Rimuovi legacy monolitico sullo stesso eventKey quando si salva per celebrazione
  if (celebrationKey) {
    state.gruppiConfig.festivitaModelli = state.gruppiConfig.festivitaModelli.filter(m =>
      !(m.eventKey === eventKey && !m.celebrationKey)
    );
  }
  const disabled = slots.length === 0;
  if (disabled) {
    if (!confirm('Nessuna messa: la comunità non celebrerà questa celebrazione (anche se il calendario ambrosiano la prevede).\n\nContinuare?')) return;
  }
  const entry = {
    eventKey,
    celebrationKey: celebrationKey || undefined,
    preset: dayPreset,
    celebrationPreset: presetId,
    strutturaKind: strutturaMesseKind,
    slots: renumberFestivaSlots(cloneFestivaSlotsForModello(slots) || []),
    disabled: disabled || undefined,
    label: (customName && customName !== defaultLabel) ? customName : undefined,
    nota: label,
    updatedFrom: null,
    updatedAt: new Date().toISOString()
  };
  if (!disabled) delete entry.disabled;
  if (!entry.label) delete entry.label;
  const idx = state.gruppiConfig.festivitaModelli.findIndex(m =>
    festivitaModelloMatches(m, eventKey, celebrationKey || null)
  );
  if (idx >= 0) state.gruppiConfig.festivitaModelli[idx] = entry;
  else state.gruppiConfig.festivitaModelli.push(entry);
  saveData();
  void persistConfig();
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
  void applicaStruttureAnno({ quiet: true });
  closeStrutturaModelloModal();
  showToast(disabled ? 'Celebrazione disattivata per la comunità' : 'Modello comunità salvato');
}

function disabilitaStrutturaGiornoSpeciale(eventKey, celebrationKey, presetId) {
  if (!requireAdminAction('Solo l\'admin può modificare i modelli')) return;
  if (!eventKey) return;
  if (!confirm('La comunità non celebrerà questa celebrazione (il calendario ambrosiano può continuare a mostrarla).\n\nConfermi?')) return;
  ensureGruppiConfig();
  if (!Array.isArray(state.gruppiConfig.festivitaModelli)) state.gruppiConfig.festivitaModelli = [];
  if (celebrationKey) {
    state.gruppiConfig.festivitaModelli = state.gruppiConfig.festivitaModelli.filter(m =>
      !(m.eventKey === eventKey && !m.celebrationKey)
    );
  }
  const dayPreset = (STRUTTURA_GIORNI_SPECIALI[strutturaMesseKind] || [])
    .find(g => g.presetId === presetId)?.dayPreset || presetId;
  const entry = {
    eventKey,
    celebrationKey: celebrationKey || undefined,
    preset: dayPreset,
    celebrationPreset: presetId,
    strutturaKind: strutturaMesseKind,
    slots: [],
    disabled: true,
    nota: 'Non celebriamo',
    updatedFrom: null,
    updatedAt: new Date().toISOString()
  };
  const idx = state.gruppiConfig.festivitaModelli.findIndex(m =>
    festivitaModelloMatches(m, eventKey, celebrationKey || null)
  );
  if (idx >= 0) state.gruppiConfig.festivitaModelli[idx] = entry;
  else state.gruppiConfig.festivitaModelli.push(entry);
  saveData();
  void persistConfig();
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
  void applicaStruttureAnno({ quiet: true });
  showToast('Celebrazione disattivata per la comunità');
}

function ripristinaStrutturaGiornoSpeciale(eventKey, celebrationKey) {
  if (!requireAdminAction('Solo l\'admin può modificare i modelli')) return;
  if (!eventKey) return;
  const label = celebrationKey ? 'questa celebrazione' : 'questo modello';
  if (!confirm(`Ripristinare il default ambrosiano di ${label}?`)) return;
  ensureGruppiConfig();
  if (celebrationKey) {
    state.gruppiConfig.festivitaModelli = getFestivitaModelli().filter(m =>
      !(m.eventKey === eventKey && m.celebrationKey === celebrationKey)
    );
  } else {
    state.gruppiConfig.festivitaModelli = getFestivitaModelli().filter(m => m.eventKey !== eventKey);
  }
  saveData();
  void persistConfig();
  renderMesseDomenicaliList();
  updateMesseDomenicaliSummary();
  void applicaStruttureAnno({ quiet: true });
  showToast('Ripristinato il default ambrosiano');
}

function renderStraordinarieSection() {
  const anno = getStrutturaFestivitaAnno();
  const label = formatPastoralYearLabel(anno);
  const list = (state.messeExtra || [])
    .filter(m => m.data && dateInStrutturaPastoralYear(m.data, anno) && m.tipo === 'straordinaria')
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  if (!list.length) return '';
  return `
    <div class="struttura-festivita-block">
      <h4 class="turni-messe-group-title">Straordinarie ${esc(label)}</h4>
      <p class="liturgy-meta" style="margin:-4px 0 10px">Celebrazioni aggiunte a mano (non da struttura)</p>
      <div class="config-list">
        ${list.map(ex => `
          <div class="config-item struttura-festivita-item" role="button" tabindex="0" onclick="openFestivitaFromStruttura(${jsStr(ex.data)})">
            <div class="config-item-main">
              <p class="config-item-title">${esc(formatFestivitaDateShort(ex.data))} · ${esc(ex.nota || 'Straordinaria')}</p>
              <p class="config-item-meta">${esc(ex.ora || '')} · ${esc(SEDI_LABEL[ex.sede] || ex.sede || '')}</p>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMessaDomenicaleItem(m, prossimaDom) {
  const canManage = isCurrentUserAdmin();
  const isDom = strutturaMesseKind === 'domenicale';
  const tipoBadge = m.conTurno
    ? `<span class="messa-tipo-badge con-turno">Con squadra${m.turnoNum ? ' · ' + formatMessaServizioShort(m.turnoNum) : ''}</span>`
    : '<span class="messa-tipo-badge libera">Libera</span>';
  const gruppoId = isDom && m.conTurno && prossimaDom && m.turnoNum
    ? getGruppoIdForTurno(m.turnoNum, prossimaDom)
    : null;
  const gruppoOra = gruppoId ? getGruppoLabel(gruppoId) : null;
  const metaExtra = !isDom
    ? (m.conTurno ? 'Servizio d\'altare' : 'Senza servizio d\'altare')
    : (gruppoOra
      ? 'Prossimo: ' + esc(gruppoOra)
      : (m.conTurno
        ? (isRotazioneAttiva() && prossimaDom && !isDomenicaInFinestraRotazione(prossimaDom)
          ? 'Prossima domenica: libera (prima della finestra)'
          : 'Messa di servizio')
        : 'Senza servizio d\'altare'));
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
        <p class="config-item-title">${m.titolo ? esc(m.titolo) + ' · ' : ''}${esc(m.ora)} · ${esc(SEDI_LABEL[m.sede] || m.sede)} ${tipoBadge}</p>
        <p class="config-item-meta">${m.vigilia ? 'Vigilia · ' : ''}${metaExtra}</p>
      </div>
      ${actions}
    </div>
  `;
}

function setTurniFormMode(editing) {
  const meta = getStrutturaMeta(strutturaMesseKind);
  const title = document.getElementById('struttura-modello-modal-title');
  const sub = document.getElementById('struttura-modello-modal-sub');
  const btn = document.getElementById('btn-save-messa-domenicale');
  if (title && document.getElementById('messaDomenicaleForm') && !document.getElementById('messaDomenicaleForm').hidden) {
    title.textContent = editing ? 'Modifica messa' : 'Nuova messa';
  }
  if (sub && document.getElementById('messaDomenicaleForm') && !document.getElementById('messaDomenicaleForm').hidden) {
    sub.textContent = editing
      ? 'Aggiorna giorno, ora, sede o tipo'
      : (meta.hint || 'Aggiungi una messa al modello');
    sub.hidden = false;
  }
  if (btn) btn.textContent = editing ? 'Salva modifiche' : 'Aggiungi celebrazione';
  syncMessaDomenicaleFormDay();
}

function editMessaDomenicale(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const m = getStrutturaMesseMutable().find(x => x.id === id);
  if (!m) return;
  editingMessaDomenicaleId = id;
  document.getElementById('messa-domenicale-edit-id').value = id;
  const titoloEl = document.getElementById('messa-domenicale-titolo');
  if (titoloEl) titoloEl.value = m.titolo || '';
  document.getElementById('messa-domenicale-day').value = String(m.dayOffset);
  document.getElementById('messa-domenicale-ora').value = m.ora;
  document.getElementById('messa-domenicale-sede').value = m.sede;
  document.getElementById('messa-domenicale-vigilia').checked = !!m.vigilia;
  document.getElementById('messa-domenicale-con-turno').checked = !!m.conTurno;
  openStrutturaModelloModal({
    title: 'Modifica messa',
    sub: 'Aggiorna giorno, ora, sede o tipo',
    mode: 'domenicale'
  });
  setTurniFormMode(true);
  const actions = document.getElementById('struttura-modello-modal-actions');
  if (actions) {
    actions.innerHTML = `
      <button type="button" class="btn btn-secondary" onclick="closeStrutturaModelloModal()">Annulla</button>
      <button type="submit" form="messaDomenicaleForm" class="btn btn-primary" id="btn-save-messa-domenicale">Salva modifiche</button>
    `;
  }
}

function cancelMessaDomenicaleEdit(opts = {}) {
  editingMessaDomenicaleId = null;
  const form = document.getElementById('messaDomenicaleForm');
  if (form) form.reset();
  const editId = document.getElementById('messa-domenicale-edit-id');
  if (editId) editId.value = '';
  const titoloEl = document.getElementById('messa-domenicale-titolo');
  if (titoloEl) titoloEl.value = '';
  const day = document.getElementById('messa-domenicale-day');
  if (day) day.value = '0';
  const ora = document.getElementById('messa-domenicale-ora');
  if (ora) ora.value = '10:00';
  const conTurno = document.getElementById('messa-domenicale-con-turno');
  if (conTurno) conTurno.checked = true;
  if (!opts.keepModal) setTurniFormMode(false);
}

function applicaModelloCorrente() {
  if (!requireAdminAction('Solo l\'admin può applicare i modelli')) return;
  void applicaStruttureAnno({ quiet: true });
}

function applicaModelloGiornoSpeciale(kind, presetId) {
  if (!requireAdminAction('Solo l\'admin può applicare i modelli')) return;
  if (kind && STRUTTURA_KINDS[kind]) strutturaMesseKind = kind;
  void applicaStruttureAnno({ quiet: true });
}

function copiaOrarioFestivoDaDomenicale() {
  // Legacy: sostituito da Applica modello
  applicaModelloCorrente();
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
  invalidateLiturgyCaches();
  renumberAllStruttureMesse();
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
  else if (active?.id === 'messe') {
    loadMesseAgenda();
  }
  else if (active?.id === 'turni') renderTurni();
  else if (active?.id === 'gruppi') void renderGruppi();
  else if (active?.id === 'anagrafica') renderChierichetti();
  else if (active?.id === 'presenze') renderAppello();
  else if (active?.id === 'strutture-messe') {
    void applicaStruttureAnno({ quiet: true });
  }
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
  showToast('I gruppi si generano dalle Messe con squadra — configura in Struttura liturgica');
}

function toggleMessaDomenicaleTurno(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const isDom = strutturaMesseKind === 'domenicale';
  const m = getStrutturaMesseMutable().find(x => x.id === id);
  if (!m) return;
  if (isDom) {
    const currentTurni = getTurniSlot().length;
    if (m.conTurno && currentTurni <= 1) {
      showToast('Serve almeno una messa con squadra');
      return;
    }
    const newCount = m.conTurno ? currentTurni - 1 : currentTurni + 1;
    if (!confirmOrphanGruppi(newCount)) return;
  }
  m.conTurno = !m.conTurno;
  if (m.conTurno && m.dayOffset === -1) m.vigilia = true;
  if (!m.conTurno) m.vigilia = !!m.vigilia;
  afterGruppiConfigChange();
  showToast(m.conTurno ? 'Messa con squadra' : 'Messa libera');
}

function deleteMessaDomenicale(id) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe di servizio')) return;
  const isDom = strutturaMesseKind === 'domenicale';
  const list = getStrutturaMesseMutable();
  const m = list.find(x => x.id === id);
  if (!m) return;
  if (isDom) {
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
  }
  if (!confirm('Eliminare questa celebrazione dalla struttura?')) return;
  const key = getStrutturaConfigKey(strutturaMesseKind);
  state.gruppiConfig[key] = list.filter(x => x.id !== id);
  if (strutturaMesseKind === 'domenicale') state.gruppiConfig.messeDomenicali = state.gruppiConfig[key];
  if (strutturaMesseKind === 'festivo') state.gruppiConfig.messeFestive = state.gruppiConfig[key];
  if (editingMessaDomenicaleId === id) cancelMessaDomenicaleEdit();
  afterGruppiConfigChange();
  updateMesseFestivoBanner(!hasOrarioFestivoConfig());
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

function isExtraFestiva(extra) {
  return !!(extra && (extra.tipo === 'festiva' || extra.usaOrarioDomenicale));
}

function isSundayDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDay() === 0;
}

/** Cache bounds stagione per anno civile */
const liturgicalSeasonBoundsCache = {};

function clearLiturgicalSeasonCache(anno) {
  if (anno) delete liturgicalSeasonBoundsCache[String(anno)];
  else Object.keys(liturgicalSeasonBoundsCache).forEach(k => delete liturgicalSeasonBoundsCache[k]);
}

function findDateWithEventKey(anno, predicate) {
  anno = String(anno);
  const byDate = calState.data?.byDate || {};
  const dates = Object.keys(byDate).filter(d => d.startsWith(anno)).sort();
  for (const d of dates) {
    const keys = (byDate[d] || []).map(e => e.eventKey).filter(Boolean);
    if (keys.some(predicate)) return d;
  }
  return null;
}

function getLiturgicalSeasonBounds(anno) {
  anno = String(anno);
  if (liturgicalSeasonBoundsCache[anno]) return liturgicalSeasonBoundsCache[anno];
  const byDate = calState.data?.byDate || {};
  const keysFor = (d) => (byDate[d] || []).map(e => e.eventKey).filter(Boolean);

  let nataleStart = findDateWithEventKey(anno, k => k === 'Christmas_vigil' || k === 'Christmas')
    || `${anno}-12-24`;
  let nataleEnd = findDateWithEventKey(anno, k => /Baptism|Battesimo/i.test(k))
    || findDateWithEventKey(anno, k => k === 'Epiphany')
    || `${anno}-01-13`;
  // Se Battesimo/Epifania è a gennaio, l'inizio Natale è a dicembre dell'anno precedente — per anno civile
  // tempo natalizio di anno Y include gen Y (da 1/1) e dic Y (da 24/12).
  const nataleStartJan = `${anno}-01-01`;
  const nataleEndJan = nataleEnd && nataleEnd.startsWith(anno) && nataleEnd.slice(5) <= '02-01'
    ? nataleEnd
    : `${anno}-01-13`;
  const nataleStartDec = `${anno}-12-24`;
  const nataleEndDec = `${anno}-12-31`;

  let pasquaStart = findDateWithEventKey(anno, k => k === 'Easter' || k === 'EasterVigil');
  if (pasquaStart) {
    // EasterVigil è il sabato: tempo pasquale dalla domenica di Pasqua
    const events = byDate[pasquaStart] || [];
    if (events.some(e => e.eventKey === 'EasterVigil') && !events.some(e => e.eventKey === 'Easter')) {
      pasquaStart = addDaysToDateStr(pasquaStart, 1);
    }
  }
  let pasquaEnd = findDateWithEventKey(anno, k => k === 'Pentecost' || /^Pentecost$/i.test(k));
  if (!pasquaEnd && pasquaStart) pasquaEnd = addDaysToDateStr(pasquaStart, 49);

  let defuntiStart = getFestivitaDateForAnno('AllSaints', anno) || `${anno}-11-01`;
  let defuntiEnd = getFestivitaDateForAnno('AllSouls', anno) || `${anno}-11-02`;
  if (defuntiEnd < defuntiStart) {
    const tmp = defuntiStart;
    defuntiStart = defuntiEnd;
    defuntiEnd = tmp;
  }

  const bounds = {
    nataleRanges: [
      { start: nataleStartJan, end: nataleEndJan },
      { start: nataleStartDec, end: nataleEndDec }
    ],
    pasqua: pasquaStart && pasquaEnd ? { start: pasquaStart, end: pasquaEnd } : null,
    defunti: { start: defuntiStart, end: defuntiEnd }
  };
  liturgicalSeasonBoundsCache[anno] = bounds;
  return bounds;
}

function getStrutturaForContext(ctxOrDate) {
  const ctx = typeof ctxOrDate === 'string' ? getLiturgicalContext(ctxOrDate) : (ctxOrDate || {});
  const kind = ctx.strutturaKind;
  if (!kind) return [];
  if (hasStrutturaConfig(kind)) return getStrutturaSlots(kind);
  if (kind !== 'domenicale' && hasStrutturaConfig('festivo')) return getStrutturaSlots('festivo');
  if (hasStrutturaConfig('domenicale')) return getStrutturaSlots('domenicale');
  return [];
}

/**
 * Priorità modelli: stagione / festivo sui feriali; le domeniche usano sempre il domenicale
 * (il template «ferie del tempo» non si applica alla domenica).
 * @param {'natalizio'|'pasquale'|'defunti'|'festivo'} preferredKind
 * @param {{ allowDomenicale?: boolean, isSunday?: boolean }} [opts]
 */
function resolveStrutturaKindPreferNonDomenicale(preferredKind, opts = {}) {
  const allowDomenicale = opts.allowDomenicale !== false;
  const isSunday = !!opts.isSunday;
  // Domenica: mai il modello feriale di stagione
  if (isSunday && hasStrutturaConfig('domenicale')) return 'domenicale';
  if (preferredKind && hasStrutturaConfig(preferredKind)) return preferredKind;
  if (preferredKind !== 'festivo' && hasStrutturaConfig('festivo')) return 'festivo';
  if (allowDomenicale && hasStrutturaConfig('domenicale')) return 'domenicale';
  return preferredKind || 'festivo';
}

function dateInRange(dateStr, range) {
  if (!range?.start || !range?.end) return false;
  return dateStr >= range.start && dateStr <= range.end;
}

/**
 * Contesto liturgico per risolvere la struttura messe.
 * @returns {{ stagione, strutturaKind, preset, label }}
 */
function getLiturgicalDayOverride(dateStr) {
  return state.gruppiConfig?.giorniLiturgici?.[dateStr] || null;
}

function getLiturgicalDayEvent(dateStr) {
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = primaryEvent(events) || events[0] || null;
  const override = getLiturgicalDayOverride(dateStr);
  if (!override) return primary;
  const tipoValue = ['solennita', 'festa', 'memoria', 'memoria-facoltativa', 'feriale'].includes(override.tipo) ? override.tipo : (primary?.tipo || 'feriale');
  const tipo = tipoValue === 'memoria-facoltativa' ? 'memoria' : tipoValue;
  const grado = tipoValue === 'memoria-facoltativa' ? 'm' : tipo === 'solennita' ? 'S' : tipo === 'festa' ? 'F' : tipo === 'memoria' ? 'M' : 'm';
  const tipoLabel = tipoValue === 'memoria-facoltativa' ? 'Memoria facoltativa' : tipo === 'solennita' ? 'Solennità' : tipo === 'festa' ? 'Festa' : tipo === 'memoria' ? 'Memoria' : 'Feriale';
  return {
    ...(primary || {}),
    nome: String(override.nome || primary?.nome || 'Giorno liturgico'),
    tipo,
    grado,
    tipoLabel
  };
}

function getLiturgicalContext(dateStr) {
  const override = getLiturgicalDayOverride(dateStr);
  if (override) {
    const primary = getLiturgicalDayEvent(dateStr);
    const kind = STRUTTURA_KINDS[override.strutturaKind] ? override.strutturaKind : null;
    return {
      stagione: kind,
      strutturaKind: kind,
      preset: null,
      label: sanitizeAwayStrutturaName(primary?.nome, dateStr, 'Giorno liturgico'),
      primary
    };
  }
  const preset = detectFestivityPreset(dateStr);
  const specialPreset = preset && preset !== 'solennita' ? preset : null;
  const anno = dateStr.slice(0, 4);
  const bounds = getLiturgicalSeasonBounds(anno);
  const primary = primaryEvent(calState.data?.byDate?.[dateStr] || []);
  const keys = getEventKeysForDate(dateStr);

  if (specialPreset) {
    const natalizioPresets = ['christmasVigil', 'christmasDay', 'stephen', 'newYearEve', 'newYearDay', 'epiphanyVigil', 'epiphanyDay'];
    const pasqualePresets = ['easterVigil', 'easterDay', 'holyThurs', 'goodFri'];
    const defuntiPresets = ['allSaints', 'allSouls'];
    let strutturaKind = null;
    let stagione = null;
    if (natalizioPresets.includes(specialPreset)) {
      stagione = 'natalizio';
      strutturaKind = resolveStrutturaKindPreferNonDomenicale('natalizio', { allowDomenicale: false });
    } else if (pasqualePresets.includes(specialPreset)) {
      stagione = 'pasquale';
      strutturaKind = resolveStrutturaKindPreferNonDomenicale('pasquale', { allowDomenicale: false });
    } else if (defuntiPresets.includes(specialPreset)) {
      stagione = 'defunti';
      strutturaKind = resolveStrutturaKindPreferNonDomenicale('defunti', { allowDomenicale: false });
    }
    return {
      stagione,
      strutturaKind,
      preset: specialPreset,
      label: getFestivityPresetMeta(specialPreset).label,
      primary
    };
  }

  if (bounds.nataleRanges.some(r => dateInRange(dateStr, r))
    || keys.some(k => /Christmas|Epiphany|Baptism|Nativity/i.test(k) && !/Weekday|SundayAfter/i.test(k))) {
    if (bounds.nataleRanges.some(r => dateInRange(dateStr, r))) {
      const isSun = isSundayDate(dateStr);
      const kind = resolveStrutturaKindPreferNonDomenicale('natalizio', {
        allowDomenicale: isSun,
        isSunday: isSun
      });
      return {
        stagione: 'natalizio',
        strutturaKind: kind,
        preset: null,
        label: sanitizeAwayStrutturaName(primary?.nome, dateStr, isSun ? 'Domenica' : 'Celebrazione'),
        primary
      };
    }
  }

  if (bounds.pasqua && dateInRange(dateStr, bounds.pasqua)) {
    const isSun = isSundayDate(dateStr);
    const kind = resolveStrutturaKindPreferNonDomenicale('pasquale', {
      allowDomenicale: isSun,
      isSunday: isSun
    });
    return {
      stagione: 'pasquale',
      strutturaKind: kind,
      preset: null,
      label: sanitizeAwayStrutturaName(primary?.nome, dateStr, isSun ? 'Domenica' : 'Celebrazione'),
      primary
    };
  }

  // Anche nella finestra defunti: se è solo il giorno LitCal “vuoto” (festa spostata), non usare modello stagione
  if (dateInRange(dateStr, bounds.defunti) && !isFestivityDisplacedFromDate(dateStr)) {
    const isSun = isSundayDate(dateStr);
    const kind = resolveStrutturaKindPreferNonDomenicale('defunti', {
      allowDomenicale: isSun,
      isSunday: isSun
    });
    return {
      stagione: 'defunti',
      strutturaKind: kind,
      preset: null,
      label: sanitizeAwayStrutturaName(primary?.nome, dateStr, isSun ? 'Domenica' : 'Celebrazione'),
      primary
    };
  }

  // Domeniche fuori da tempi speciali → sempre domenicale ordinario
  // (Avvento, Cristo Re, tempo ordinario: non usare il modello festivo)
  if (isSundayDate(dateStr)) {
    const dayEvent = getLiturgicalDayEvent(dateStr) || primary;
    return {
      stagione: null,
      strutturaKind: 'domenicale',
      preset: null,
      label: sanitizeAwayStrutturaName(dayEvent?.nome, dateStr, 'Domenica'),
      primary: dayEvent || primary
    };
  }

  // Festa LitCal spostata dalla comunità: non attivare orario festivo qui
  if (isFestivityDisplacedFromDate(dateStr)) {
    return {
      stagione: null,
      strutturaKind: null,
      preset: null,
      label: sanitizeAwayStrutturaName(primary?.nome, dateStr, null),
      primary,
      displaced: true
    };
  }

  if (primary?.tipo === 'solennita' || primary?.tipo === 'festa') {
    const kind = resolveStrutturaKindPreferNonDomenicale('festivo', { allowDomenicale: false });
    return {
      stagione: null,
      strutturaKind: kind,
      preset: 'solennita',
      label: sanitizeAwayStrutturaName(primary?.nome, dateStr, 'Celebrazione'),
      primary
    };
  }

  return {
    stagione: null,
    strutturaKind: null,
    preset: null,
    label: null,
    primary
  };
}

function buildSyntheticFestivaExtra(dateStr, ctx) {
  const eventKey = getPrimaryFestivityEventKey(dateStr);
  const nota = sanitizeAwayStrutturaName(
    resolveCorrezioneCelebrationLabel(
      { group: null, slots: [] },
      eventKey,
      (ctx.preset && ctx.preset !== 'solennita' ? getFestivityPresetMeta(ctx.preset).label : null)
        || ctx.label
        || 'Celebrazione'
    ),
    dateStr,
    'Celebrazione'
  );
  const extra = {
    uuid: 'SYN-' + dateStr,
    data: dateStr,
    nota,
    tipo: 'festiva',
    usaOrarioDomenicale: true,
    strutturaKind: ctx.strutturaKind || undefined,
    preset: ctx.preset || undefined,
    eventKey: eventKey || undefined,
    source: 'struttura',
    synthetic: true
  };
  const modello = getFestivitaModello(eventKey);
  if (modello) applyFestivitaModelloToExtra(extra, modello);
  else if (ctx.preset) applyPresetToFestivaExtra(extra, ctx.preset);
  return extra;
}

/** Solennità feriali (Natale, Assunzione, …) — Pasqua resta domenica. */
function isSolennitaFestivaDay(dateStr) {
  if (isSundayDate(dateStr)) return false;
  // Vigilia di una domenica (Avvento1_vigil, Lent2_vigil, Cristo Re…) → già coperta
  // dal turno domenicale; non creare una festività separata. Eccezione: Veglia Pasquale.
  if (isVigiliaDomenicaleLiturgica(dateStr)) return false;
  // Festa ambrosiana spostata dalla comunità su un altro giorno civile
  if (isFestivityDisplacedFromDate(dateStr)) return false;
  const primary = getLiturgicalDayEvent(dateStr);
  return primary?.tipo === 'solennita';
}

/**
 * Vigilia di domenica sul sabato (o giorno prima): eventKey *_vigil con giorno successivo = domenica.
 * Non include la Veglia Pasquale (Triduo).
 */
function isVigiliaDomenicaleLiturgica(dateStr) {
  const keys = getEventKeysForDate(dateStr);
  const vigilKey = keys.find(k => k === 'EasterVigil')
    ? null
    : keys.find(k => /(?:_vigil|Vigil)$/i.test(k));
  if (!vigilKey) return false;
  if (vigilKey === 'EasterVigil') return false;
  return isSundayDate(addDaysToDateStr(dateStr, 1));
}

function getFestivitaEscluse() {
  ensureGruppiConfig();
  return state.gruppiConfig.festivitaEscluse || [];
}

function isEscludiFerialiIntrasettimanaliEnabled() {
  ensureGruppiConfig();
  return !!state.gruppiConfig.escludiFerialiIntrasettimanali;
}

/** Lun–sab: consentiti solo tempi speciali e solennità (se il flag è attivo). */
function isGiornoIntrasettimanaleConsentito(dateStr) {
  if (!dateStr) return false;
  const ctx = getLiturgicalContext(dateStr);
  if (['natalizio', 'pasquale', 'defunti'].includes(ctx.stagione)) return true;
  if (['natalizio', 'pasquale', 'defunti'].includes(ctx.strutturaKind)) return true;
  if (ctx.preset && ctx.preset !== 'solennita') return true;
  const primary = ctx.primary || getLiturgicalDayEvent(dateStr);
  if (primary?.tipo === 'solennita') return true;
  return false;
}

function isGiornoIntrasettimanaleEscluso(dateStr) {
  if (!isEscludiFerialiIntrasettimanaliEnabled()) return false;
  if (!dateStr || isSundayDate(dateStr)) return false;
  const day = new Date(dateStr + 'T12:00:00').getDay();
  if (day < 1 || day > 6) return false;
  return !isGiornoIntrasettimanaleConsentito(dateStr);
}

function syncEscludiFerialiIntrasettimanaliUi() {
  const el = document.getElementById('cal-escludi-feriali');
  if (el) el.checked = isEscludiFerialiIntrasettimanaliEnabled();
}

function pruneAutoFestivitaIntrasettimanaliEscluse() {
  if (!Array.isArray(state.messeExtra)) return 0;
  const before = state.messeExtra.length;
  state.messeExtra = state.messeExtra.filter(extra => {
    if (!extra?.data || !isExtraFestiva(extra)) return true;
    if (extra.source !== 'auto') return true;
    if (extra.orarioPersonalizzato) return true;
    if (!isGiornoIntrasettimanaleEscluso(extra.data)) return true;
    return false;
  });
  return before - state.messeExtra.length;
}

/** Rimuove festività auto sul giorno LitCal quando la festa è stata spostata dalla comunità. */
function pruneDisplacedFestivitaExtras(anno) {
  if (!Array.isArray(state.messeExtra)) return 0;
  anno = String(anno);
  const before = state.messeExtra.length;
  state.messeExtra = state.messeExtra.filter(extra => {
    if (!extra?.data || !dateInStrutturaPastoralYear(extra.data, anno) || !isExtraFestiva(extra)) return true;
    const info = getDisplacedFestivityInfo(extra.data);
    if (info) {
      const ek = extra.eventKey || FESTIVITA_EVENTKEY_BY_PRESET[extra.preset];
      // Togli il record della festa LitCal spostata (anche se aveva slot salvati)
      if (!ek || ek === info.eventKey) return false;
    }
    const eventKey = extra.eventKey || FESTIVITA_EVENTKEY_BY_PRESET[extra.preset];
    if (eventKey) {
      const effective = getFestivitaDateForAnno(eventKey, extra.data.slice(0, 4));
      if (effective && effective !== extra.data) {
        // Festa sul giorno sbagliato rispetto alla data comunità
        if (extra.source === 'auto' || !extra.orarioPersonalizzato) return false;
        // Anche personalizzato se coincide con la festa spostata
        if (ekMatchesDisplacedFeast(extra, eventKey, effective)) return false;
      }
    }
    if (extra.source !== 'auto' || extra.orarioPersonalizzato) return true;
    if (isFestivityDisplacedFromDate(extra.data)) return false;
    return true;
  });
  return before - state.messeExtra.length;
}

function ekMatchesDisplacedFeast(extra, eventKey, effective) {
  if (!extra?.data || !eventKey || !effective) return false;
  return effective !== extra.data;
}

async function onEscludiFerialiIntrasettimanaliChange() {
  if (!requireAdminAction('Solo l\'admin può modificare questa opzione')) {
    syncEscludiFerialiIntrasettimanaliUi();
    return;
  }
  ensureGruppiConfig();
  const el = document.getElementById('cal-escludi-feriali');
  state.gruppiConfig.escludiFerialiIntrasettimanali = !!el?.checked;
  const pruned = pruneAutoFestivitaIntrasettimanaliEscluse();
  saveData();
  void persistConfig();
  try {
    const anno = getStrutturaFestivitaAnno();
    await ensureCalendarioForPastoralYear(anno);
    syncFestivitaAnno(anno);
  } catch (_) { /* calendario non disponibile */ }
  void renderStrutturaCorrezioniPanel();
  void renderStrutturaApplicaPanel();
  if (typeof renderMesseAgenda === 'function') renderMesseAgenda();
  showToast(el?.checked
    ? ('Feriali lun–sab esclusi' + (pruned ? ` · ${pruned} auto rimosse` : '') + ' · restano tempi speciali e solennità')
    : 'Feriali lun–sab di nuovo inclusi');
}

function getEventKeysForDate(dateStr) {
  const events = calState.data?.byDate?.[dateStr] || [];
  return events.map(e => e.eventKey).filter(Boolean);
}

function isFestivitaEsclusa(dateStr) {
  const list = getFestivitaEscluse();
  if (!list.length) return false;
  const keys = new Set(getEventKeysForDate(dateStr));
  return list.some(ex => {
    if (ex?.eventKey && keys.has(ex.eventKey)) return true;
    if (ex?.data && ex.data === dateStr) return true;
    return false;
  });
}

/** Toglie «senza servizio» per questa data (e eventKey liturgici del giorno). */
function clearFestivitaEsclusaForDate(dateStr) {
  ensureGruppiConfig();
  if (!dateStr || !Array.isArray(state.gruppiConfig.festivitaEscluse)) return false;
  const before = state.gruppiConfig.festivitaEscluse.length;
  const keys = new Set(getEventKeysForDate(dateStr));
  state.gruppiConfig.festivitaEscluse = state.gruppiConfig.festivitaEscluse.filter(ex => {
    if (ex?.data && ex.data === dateStr) return false;
    if (ex?.eventKey && keys.has(ex.eventKey)) return false;
    return true;
  });
  return state.gruppiConfig.festivitaEscluse.length !== before;
}

function findFestivitaEsclusaIndex({ eventKey, data } = {}) {
  const list = getFestivitaEscluse();
  return list.findIndex(ex => {
    if (eventKey && ex.eventKey && ex.eventKey === eventKey) return true;
    if (data && ex.data && ex.data === data) return true;
    return false;
  });
}

function addFestivitaEsclusa(dateStr, { nome, permanent = true } = {}) {
  ensureGruppiConfig();
  if (!Array.isArray(state.gruppiConfig.festivitaEscluse)) {
    state.gruppiConfig.festivitaEscluse = [];
  }
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = getLiturgicalDayEvent(dateStr);
  const eventKey = permanent ? (primary?.eventKey || null) : null;
  const label = nome || primary?.nome || dateStr;
  const idx = permanent
    ? findFestivitaEsclusaIndex({ eventKey, data: dateStr })
    : state.gruppiConfig.festivitaEscluse.findIndex(ex => ex.yearOnly && ex.data === dateStr);
  const entry = {
    eventKey: eventKey || undefined,
    data: dateStr,
    nome: label,
    yearOnly: permanent ? undefined : true,
    excludedAt: new Date().toISOString()
  };
  if (idx >= 0) state.gruppiConfig.festivitaEscluse[idx] = entry;
  else state.gruppiConfig.festivitaEscluse.push(entry);
  return entry;
}

function ripristinaFestivitaEsclusa(eventKeyOrData) {
  if (!requireAdminAction('Solo l\'admin può gestire le festività escluse')) return;
  ensureGruppiConfig();
  const key = String(eventKeyOrData || '');
  state.gruppiConfig.festivitaEscluse = getFestivitaEscluse().filter(ex =>
    ex.eventKey !== key && ex.data !== key
  );
  saveData();
  void persistConfig();
  showToast('Di nuovo in agenda (con servizio)');
  void renderStrutturaCorrezioniPanel();
  if (strutturaMesseKind === 'festivo') {
    renderMesseDomenicaliList();
    updateMesseDomenicaliSummary();
  }
  void applicaStruttureAnno({ quiet: true });
}

/**
 * Toglie le messe del giorno per quest’anno (senza servizio).
 * Il modello resta; in Correzioni si possono ripristinare.
 */
function escludiFestivita(uuidOrDate) {
  if (!requireAdminAction('Solo l\'admin può modificare le messe')) return;
  let extra = null;
  let dateStr = null;
  if (typeof uuidOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(uuidOrDate)) {
    dateStr = uuidOrDate;
    extra = getMessaExtraForDate(dateStr) || ensureFestivaExtraMaterialized(dateStr);
  } else {
    extra = (state.messeExtra || []).find(m => m.uuid === uuidOrDate);
    dateStr = extra?.data;
  }
  if (!dateStr || !extra) {
    showToast('Giorno non trovato');
    return;
  }
  const nome = extra?.nota || primaryEvent(calState.data?.byDate?.[dateStr] || [])?.nome || dateStr;
  if (!confirm(`Togliere tutte le messe di «${nome}» per quest’anno?\n\nIl giorno resta senza servizio finché non le ripristini in Correzioni.`)) return;

  extra.slots = [];
  extra.orarioPersonalizzato = true;
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  clearFestivitaEsclusaForDate(dateStr);
  saveData();
  void persistConfig();
  showToast('Nessuna messa · senza servizio per quest’anno');
  void renderStrutturaCorrezioniPanel();
  if (messeState.selectedDate === dateStr) renderMessaDetail(dateStr);
  loadMesseAgenda();
}

/** Preset orario per festività speciali (Triduo, Natale, Defunti, Capodanno, Epifania…). */
const FESTIVITY_PRESETS = {
  solennita: {
    id: 'solennita',
    label: 'Orario festivo',
    hint: 'Giorno singolo senza vigilia (8.30 / 10 / 11.15)'
  },
  solennitaConVigilia: {
    id: 'solennitaConVigilia',
    label: 'Festivo con vigilia',
    hint: 'Vigilia 18.00 + orario festivo del giorno'
  },
  christmasVigil: {
    id: 'christmasVigil',
    label: 'Vigilia e Notte di Natale',
    hint: '24 dic: vigilia + messe della notte'
  },
  christmasVigilEve: {
    id: 'christmasVigilEve',
    label: 'Vigilia di Natale',
    hint: '24 dic ore 18'
  },
  christmasNight: {
    id: 'christmasNight',
    label: 'Notte di Natale',
    hint: '24 dic — messe della notte'
  },
  christmasDay: {
    id: 'christmasDay',
    label: 'Natale (giorno)',
    hint: 'Orario festivo del 25 dicembre'
  },
  stephen: {
    id: 'stephen',
    label: 'Santo Stefano',
    hint: 'Orario festivo del 26 dicembre'
  },
  holyThurs: {
    id: 'holyThurs',
    label: 'Giovedì Santo',
    hint: 'Lavanda dei Piedi + Cena Domini'
  },
  holyThursLavanda: {
    id: 'holyThursLavanda',
    label: 'Lavanda dei Piedi',
    hint: 'Giovedì Santo'
  },
  holyThursCena: {
    id: 'holyThursCena',
    label: 'Cena Domini',
    hint: 'Giovedì Santo'
  },
  goodFri: {
    id: 'goodFri',
    label: 'Venerdì Santo',
    hint: 'Passione e Via Crucis'
  },
  goodFriPassione: {
    id: 'goodFriPassione',
    label: 'Passione del Signore',
    hint: 'Venerdì Santo'
  },
  goodFriViaCrucis: {
    id: 'goodFriViaCrucis',
    label: 'Via Crucis',
    hint: 'Venerdì Santo'
  },
  easterVigil: {
    id: 'easterVigil',
    label: 'Veglia Pasquale',
    hint: 'Sabato Santo — Notte Santa'
  },
  easterDay: {
    id: 'easterDay',
    label: 'Pasqua',
    hint: 'Orario festivo della Domenica di Risurrezione'
  },
  allSaints: {
    id: 'allSaints',
    label: 'Tutti i Santi',
    hint: 'Vigilia + orario festivo + vespri al cimitero'
  },
  allSaintsVigil: {
    id: 'allSaintsVigil',
    label: 'Vigilia di Tutti i Santi',
    hint: 'Sera precedente'
  },
  allSaintsDay: {
    id: 'allSaintsDay',
    label: 'Tutti i Santi — messe',
    hint: 'Messe del giorno'
  },
  allSaintsVespers: {
    id: 'allSaintsVespers',
    label: 'Vespri e processione',
    hint: 'Cimitero'
  },
  allSouls: {
    id: 'allSouls',
    label: 'Commemorazione dei Defunti',
    hint: 'Vigilia + messe del giorno (anche cimitero)'
  },
  allSoulsVigil: {
    id: 'allSoulsVigil',
    label: 'Vespri dei Defunti',
    hint: '1 novembre (pomeriggio, vigilia civile del 2 nov)'
  },
  allSoulsDay: {
    id: 'allSoulsDay',
    label: 'Defunti — messe',
    hint: 'Messe del giorno'
  },
  newYearEve: {
    id: 'newYearEve',
    label: '31 dicembre',
    hint: 'Messa vigiliare con Te Deum'
  },
  newYearDay: {
    id: 'newYearDay',
    label: '1° gennaio',
    hint: 'Ottava di Natale — orario festivo'
  },
  epiphanyVigil: {
    id: 'epiphanyVigil',
    label: 'Vigilia dell’Epifania',
    hint: '5 gen ore 18 Santuario'
  },
  epiphanyDay: {
    id: 'epiphanyDay',
    label: 'Epifania',
    hint: '6 gen — messe del giorno'
  }
};

function hasCustomFestivaSlots(extra) {
  return Array.isArray(extra?.slots);
}

function festivityHasEventKey(dateStr, ...keys) {
  const set = new Set(keys.filter(Boolean));
  if (!set.size) return false;
  const events = calState.data?.byDate?.[dateStr] || [];
  return events.some(e => set.has(e.eventKey));
}

function festivityHasEventKeyMatch(dateStr, regex) {
  const events = calState.data?.byDate?.[dateStr] || [];
  return events.some(e => regex.test(String(e.eventKey || '')));
}

function detectFestivityPreset(dateStr) {
  // 1) Correzione civile comunità (una sola data effettiva)
  const fromOverride = detectFestivityPresetFromCivilOverride(dateStr);
  if (fromOverride) return fromOverride;

  // 2) Tutti i Santi / Defunti: date civili 1 e 2 nov (battono LitCal spostato)
  const fromDefuntiCivil = detectDefuntiCivilPreset(dateStr);
  if (fromDefuntiCivil) return fromDefuntiCivil;

  // 3) Giorno liturgico ambrosiano — solo se non spostato altrove
  const fromLit = detectFestivityPresetFromAmbrosian(dateStr);
  if (fromLit) {
    const eventKey = FESTIVITA_EVENTKEY_BY_PRESET[fromLit];
    const effective = eventKey
      ? getFestivitaDateForAnno(eventKey, dateStr.slice(0, 4))
      : null;
    if (!effective || effective === dateStr) return fromLit;
  }

  // 4) Fallback date civili di default
  return detectFestivityPresetFromCivilDefault(dateStr) || 'solennita';
}

/** 1 nov = Tutti i Santi, 2 nov = Defunti (rispetto alle date effettive comunità). */
function detectDefuntiCivilPreset(dateStr) {
  if (!dateStr || dateStr.length < 10) return null;
  const anno = dateStr.slice(0, 4);
  const md = dateStr.slice(5);
  if (md === '11-01' && getFestivitaDateForAnno('AllSaints', anno) === dateStr) return 'allSaints';
  if (md === '11-02' && getFestivitaDateForAnno('AllSouls', anno) === dateStr) return 'allSouls';
  return null;
}

function detectFestivityPresetFromAmbrosian(dateStr) {
  if (festivityHasEventKey(dateStr, 'HolyThurs')) return 'holyThurs';
  if (festivityHasEventKey(dateStr, 'GoodFri')) return 'goodFri';
  if (festivityHasEventKey(dateStr, 'EasterVigil')) return 'easterVigil';
  if (festivityHasEventKey(dateStr, 'Easter')) return 'easterDay';
  if (festivityHasEventKeyMatch(dateStr, /AllSaints.*vigil|AllSaints_vigil/i)) return 'allSaints';
  if (festivityHasEventKeyMatch(dateStr, /AllSouls/i) && !festivityHasEventKeyMatch(dateStr, /AllSaints/i)) return 'allSouls';
  if (festivityHasEventKeyMatch(dateStr, /AllSaints/i)) return 'allSaints';
  if (festivityHasEventKey(dateStr, 'Christmas_vigil')) return 'christmasVigil';
  if (festivityHasEventKey(dateStr, 'Christmas')) return 'christmasDay';
  if (festivityHasEventKeyMatch(dateStr, /Stephen|StStephen|SantoStefano/i)) return 'stephen';
  if (festivityHasEventKeyMatch(dateStr, /Epiphany.*vigil|Epiphany_vigil/i)) return 'epiphanyVigil';
  if (festivityHasEventKey(dateStr, 'Epiphany') || festivityHasEventKeyMatch(dateStr, /^Epiphany$/i)) return 'epiphanyDay';
  if (festivityHasEventKeyMatch(dateStr, /MaryMother|MotherOfGod|Circumcision|NewYear|OctaveChristmas/i)) {
    return 'newYearDay';
  }
  return null;
}

function detectFestivityPresetFromCivilOverride(dateStr) {
  const anno = dateStr.slice(0, 4);
  for (const [presetId, eventKey] of Object.entries(FESTIVITA_EVENTKEY_BY_PRESET)) {
    if (getFestivitaDateOverrideOnly(eventKey, anno) === dateStr) return presetId;
  }
  return null;
}

/**
 * True se LitCal ha la festa qui ma la comunità la celebra altrove,
 * e questo giorno non è già la data civile di un’altra festa (es. 2 nov Defunti).
 */
function isFestivityDisplacedFromDate(dateStr) {
  if (!dateStr) return false;
  const anno = dateStr.slice(0, 4);
  if (_displacedFestivityCache.anno !== anno || !_displacedFestivityCache.set) {
    const displaced = new Set();
    const effectiveByKey = {};
    Object.keys(FESTIVITA_DEFAULT_MD || {}).forEach(ek => {
      effectiveByKey[ek] = getFestivitaDateForAnno(ek, anno);
    });
    const byDate = calState.data?.byDate || {};
    Object.keys(byDate).forEach(d => {
      if (!d.startsWith(anno)) return;
      const fromLit = detectFestivityPresetFromAmbrosian(d);
      if (!fromLit) return;
      const eventKey = FESTIVITA_EVENTKEY_BY_PRESET[fromLit];
      if (!eventKey) return;
      const effective = effectiveByKey[eventKey];
      if (!effective || effective === d) return;
      if (detectDefuntiCivilPreset(d)) return;
      let otherFestivityHere = false;
      for (const ek of Object.keys(effectiveByKey)) {
        if (ek === eventKey) continue;
        if (effectiveByKey[ek] === d) {
          otherFestivityHere = true;
          break;
        }
      }
      if (!otherFestivityHere) displaced.add(d);
    });
    _displacedFestivityCache = { anno, set: displaced };
  }
  return _displacedFestivityCache.set.has(dateStr);
}

function detectFestivityPresetFromCivilDefault(dateStr) {
  const anno = dateStr.slice(0, 4);
  const md = dateStr.slice(5);
  const byMd = {
    '12-24': 'christmasVigil',
    '12-25': 'christmasDay',
    '12-26': 'stephen',
    '12-31': 'newYearEve',
    '01-01': 'newYearDay',
    '01-05': 'epiphanyVigil',
    '01-06': 'epiphanyDay',
    '11-01': 'allSaints',
    '11-02': 'allSouls'
  };
  // AllSaints/AllSouls: gestiti da detectDefuntiCivilPreset; non annullare per ambrosiano altrove
  for (const [presetId, eventKey] of Object.entries(FESTIVITA_EVENTKEY_BY_PRESET)) {
    if (eventKey === 'AllSaints' || eventKey === 'AllSouls') continue;
    if (getFestivitaDateOverrideOnly(eventKey, anno)) continue;
    if (getAmbrosianFestivitaDate(eventKey, anno)) continue;
    if (getDefaultFestivitaDate(eventKey, anno) === dateStr) return presetId;
  }
  const presetId = byMd[md];
  if (!presetId) return null;
  const eventKey = FESTIVITA_EVENTKEY_BY_PRESET[presetId];
  if (eventKey === 'AllSaints' || eventKey === 'AllSouls') {
    return detectDefuntiCivilPreset(dateStr);
  }
  if (eventKey) {
    if (getFestivitaDateOverrideOnly(eventKey, anno)) return null;
    if (getAmbrosianFestivitaDate(eventKey, anno)) return null;
  }
  return presetId;
}

function newFestivaSlotId(prefix = 'fest') {
  return prefix + '-' + Math.random().toString(36).slice(2, 8);
}

function makeFestivaPresetSlot({ ora, sede = 'santuario', dayOffset = 0, vigilia = false, conTurno = true, titolo }) {
  const off = dayOffset === -1 ? -1 : 0;
  const slot = {
    id: newFestivaSlotId(),
    dayOffset: off,
    ora: ora || '10:00',
    sede,
    vigilia: !!vigilia || off === -1,
    conTurno: !!conTurno
  };
  if (titolo) slot.titolo = titolo;
  return slot;
}

function cloneFestiveDayPresetSlots(titolo) {
  return renumberFestivaSlots(
    DEFAULT_MESSE_FESTIVE_GIORNO.map(s => makeFestivaPresetSlot({
      ora: s.ora,
      sede: s.sede,
      dayOffset: s.dayOffset,
      vigilia: s.vigilia,
      conTurno: s.conTurno,
      titolo
    }))
  );
}

function cloneVigiliaFestivoPresetSlots(titoloGiorno) {
  return renumberFestivaSlots(
    DEFAULT_MESSE_CON_VIGILIA.map(s => makeFestivaPresetSlot({
      ora: s.ora,
      sede: s.sede,
      dayOffset: s.dayOffset,
      vigilia: s.vigilia,
      conTurno: s.conTurno,
      titolo: s.dayOffset === -1 ? 'Vigilia' : titoloGiorno
    }))
  );
}

/**
 * Slot del preset. `null` = usa l’orario festivo configurato (senza slots salvati).
 * Array (anche vuoto) = orario personalizzato del preset.
 */
function buildFestivityPresetSlots(presetId) {
  switch (presetId) {
    case 'holyThurs':
      return [
        ...buildFestivityPresetSlots('holyThursLavanda'),
        ...buildFestivityPresetSlots('holyThursCena')
      ];
    case 'holyThursLavanda':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '17:00', sede: 'mantegazza', conTurno: true, titolo: 'Lavanda dei Piedi' })
      ]);
    case 'holyThursCena':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '21:00', conTurno: true, titolo: 'Cena Domini' })
      ]);
    case 'goodFri':
      return [
        ...buildFestivityPresetSlots('goodFriPassione'),
        ...buildFestivityPresetSlots('goodFriViaCrucis')
      ];
    case 'goodFriPassione':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '15:00', conTurno: false, titolo: 'Passione del Signore' }),
        makeFestivaPresetSlot({ ora: '15:00', sede: 'mantegazza', conTurno: false, titolo: 'Passione del Signore' })
      ]);
    case 'goodFriViaCrucis':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '21:00', sede: 'mantegazza', conTurno: false, titolo: 'Via Crucis' })
      ]);
    case 'easterVigil':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '21:00', vigilia: true, conTurno: true, titolo: 'Veglia Pasquale' })
      ]);
    case 'easterDay':
      return cloneFestiveDayPresetSlots('Pasqua');
    case 'christmasVigil':
      return [
        ...buildFestivityPresetSlots('christmasVigilEve'),
        ...buildFestivityPresetSlots('christmasNight')
      ];
    case 'christmasVigilEve':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '18:00', vigilia: true, conTurno: true, titolo: 'Vigilia' })
      ]);
    case 'christmasNight':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '22:00', sede: 'mantegazza', vigilia: true, conTurno: true, titolo: 'Notte' }),
        makeFestivaPresetSlot({ ora: '00:00', vigilia: true, conTurno: true, titolo: 'Notte' })
      ]);
    case 'christmasDay':
      return cloneFestiveDayPresetSlots('Natale');
    case 'stephen':
      return cloneFestiveDayPresetSlots('Santo Stefano');
    case 'allSaints':
      return [
        ...buildFestivityPresetSlots('allSaintsVigil'),
        ...buildFestivityPresetSlots('allSaintsDay')
      ];
    case 'allSaintsVigil':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '18:00', dayOffset: -1, vigilia: true, conTurno: true, titolo: 'Vigilia Tutti i Santi' })
      ]);
    case 'allSaintsDay':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '08:30', sede: 'vanzago', conTurno: true, titolo: 'Tutti i Santi' }),
        makeFestivaPresetSlot({ ora: '10:00', sede: 'mantegazza', conTurno: false, titolo: 'Tutti i Santi' }),
        makeFestivaPresetSlot({ ora: '11:15', conTurno: true, titolo: 'Tutti i Santi' })
      ]);
    case 'allSaintsVespers':
      // Legacy: vespri spostati sui Defunti (1 nov)
      return buildFestivityPresetSlots('allSoulsVigil');
    case 'allSouls':
      return [
        ...buildFestivityPresetSlots('allSoulsVigil'),
        ...buildFestivityPresetSlots('allSoulsDay')
      ];
    case 'allSoulsVigil':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '15:00', dayOffset: -1, conTurno: false, titolo: 'Vespri e processione al Cimitero' })
      ]);
    case 'allSoulsDay':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '08:30', sede: 'vanzago', conTurno: true, titolo: 'Defunti' }),
        makeFestivaPresetSlot({ ora: '10:00', sede: 'mantegazza', conTurno: false, titolo: 'Defunti' }),
        makeFestivaPresetSlot({ ora: '11:15', sede: 'cimitero', conTurno: true, titolo: 'Defunti' }),
        makeFestivaPresetSlot({ ora: '18:00', sede: 'mantegazza', conTurno: false, titolo: 'Defunti' })
      ]);
    case 'newYearEve':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '18:00', conTurno: true, titolo: 'Messa vigiliare con Te Deum' })
      ]);
    case 'newYearDay':
      return cloneFestiveDayPresetSlots('1° gennaio');
    case 'epiphanyVigil':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '18:00', vigilia: true, conTurno: true, titolo: 'Vigilia Epifania' })
      ]);
    case 'epiphanyDay':
      return renumberFestivaSlots([
        makeFestivaPresetSlot({ ora: '08:30', sede: 'vanzago', conTurno: true, titolo: 'Epifania' }),
        makeFestivaPresetSlot({ ora: '11:15', conTurno: true, titolo: 'Epifania' })
      ]);
    case 'solennitaConVigilia':
      return cloneVigiliaFestivoPresetSlots('Solennità');
    case 'solennita':
    default: {
      return null;
    }
  }
}

function getFestivityPresetMeta(presetId) {
  return FESTIVITY_PRESETS[presetId] || FESTIVITY_PRESETS.solennita;
}

/** Date civili di default per i modelli con eventKey (MM-DD). */
const FESTIVITA_DEFAULT_MD = {
  AllSaints: '11-01',
  AllSouls: '11-02',
  Christmas_vigil: '12-24',
  Christmas: '12-25',
  Stephen: '12-26',
  NewYearEve: '12-31',
  MaryMotherOfGod: '01-01',
  Epiphany_vigil: '01-05',
  Epiphany: '01-06'
};

const FESTIVITA_EVENTKEY_BY_PRESET = {
  allSaints: 'AllSaints',
  allSouls: 'AllSouls',
  christmasVigil: 'Christmas_vigil',
  christmasDay: 'Christmas',
  stephen: 'Stephen',
  newYearEve: 'NewYearEve',
  newYearDay: 'MaryMotherOfGod',
  epiphanyVigil: 'Epiphany_vigil',
  epiphanyDay: 'Epiphany'
};

const FESTIVITA_AMBROSIAN_MATCHERS = {
  AllSaints: k => /AllSaints/i.test(k) && !/AllSouls/i.test(k),
  AllSouls: k => /AllSouls/i.test(k),
  // Solo la vigilia di Natale: evita SundayAfterChristmas_vigil / Christmas2_vigil (es. sab 3 gen)
  Christmas_vigil: k => k === 'Christmas_vigil' || /^Christmas_vigil$/i.test(k),
  Christmas: k => k === 'Christmas' || /^Christmas$/i.test(k),
  Stephen: k => /Stephen|StStephen|SantoStefano/i.test(k),
  NewYearEve: k => /NewYearEve|Dec31|TeDeum/i.test(k),
  MaryMotherOfGod: k => /MaryMother|MotherOfGod|Circumcision|OctaveChristmas/i.test(k),
  Epiphany_vigil: k => k === 'Epiphany_vigil' || /^Epiphany_vigil$/i.test(k),
  Epiphany: k => k === 'Epiphany' || /^Epiphany$/i.test(k)
};

function getDefaultFestivitaDate(eventKey, anno) {
  const md = FESTIVITA_DEFAULT_MD[eventKey];
  if (!md) return null;
  const y = parseInt(anno, 10);
  return `${y}-${md}`;
}

function getFestivitaDateOverridesMap() {
  ensureGruppiConfig();
  if (!state.gruppiConfig.festivitaDateOverrides || typeof state.gruppiConfig.festivitaDateOverrides !== 'object') {
    state.gruppiConfig.festivitaDateOverrides = {};
  }
  return state.gruppiConfig.festivitaDateOverrides;
}

/** Solo correzione esplicita (senza default). */
function getFestivitaDateOverrideOnly(eventKey, anno) {
  if (!eventKey) return null;
  anno = String(anno);
  const override = getFestivitaDateOverridesMap()[eventKey]?.[anno];
  return override && /^\d{4}-\d{2}-\d{2}$/.test(override) ? override : null;
}

/** Data dal calendario ambrosiano LitCal per l’anno civile. */
function getAmbrosianFestivitaDate(eventKey, anno) {
  if (!eventKey || !calState.data?.byDate) return null;
  anno = String(anno);
  const matcher = FESTIVITA_AMBROSIAN_MATCHERS[eventKey];
  const md = FESTIVITA_DEFAULT_MD[eventKey];
  // Preferisci la data civile tipica (es. 12-24) se presente nel calendario
  if (md) {
    const preferred = `${anno}-${md}`;
    const keys = getEventKeysForDate(preferred);
    if (keys.length && (matcher ? keys.some(matcher) : keys.includes(eventKey))) {
      return preferred;
    }
  }
  if (!matcher) {
    return findDateWithEventKey(anno, k => k === eventKey);
  }
  // Preferisci il giorno principale (non solo vigilia) per AllSaints
  if (eventKey === 'AllSaints') {
    return findDateWithEventKey(anno, k => /AllSaints/i.test(k) && !/vigil/i.test(k) && !/AllSouls/i.test(k))
      || findDateWithEventKey(anno, k => /AllSaints/i.test(k) && !/AllSouls/i.test(k));
  }
  if (eventKey === 'AllSouls') {
    return findDateWithEventKey(anno, k => /AllSouls/i.test(k) && !/vigil/i.test(k))
      || findDateWithEventKey(anno, k => /AllSouls/i.test(k));
  }
  // Natale/Epifania: cerca vicino al default civile, non la prima occorrenza dell’anno
  if (eventKey === 'Christmas_vigil' || eventKey === 'Christmas' || eventKey === 'Stephen'
    || eventKey === 'Epiphany_vigil' || eventKey === 'Epiphany' || eventKey === 'NewYearEve') {
    return findDateWithEventKeyNearMd(anno, md, matcher);
  }
  return findDateWithEventKey(anno, matcher);
}

/** Prima data che matcha vicino a MM-DD (stesso mese), altrimenti qualsiasi nell’anno. */
function findDateWithEventKeyNearMd(anno, md, predicate) {
  anno = String(anno);
  const byDate = calState.data?.byDate || {};
  const dates = Object.keys(byDate).filter(d => d.startsWith(anno)).sort();
  const month = md ? md.slice(0, 2) : null;
  const sameMonth = month ? dates.filter(d => d.slice(5, 7) === month) : dates;
  for (const list of [sameMonth, dates]) {
    for (const d of list) {
      const keys = (byDate[d] || []).map(e => e.eventKey).filter(Boolean);
      if (keys.some(predicate)) return d;
    }
  }
  return null;
}

/**
 * Data effettiva per UI/bounds:
 * correzione civile → (per Defunti: civile fisso 1/2 nov) → ambrosiano → default civile
 */
function getFestivitaDateForAnno(eventKey, anno) {
  if (!eventKey) return null;
  anno = String(anno);
  const override = getFestivitaDateOverrideOnly(eventKey, anno);
  if (override) return override;
  // Tutti i Santi / Defunti: in parrocchia si segue il calendario civile (31 ott / 1 / 2 nov)
  if (eventKey === 'AllSaints' || eventKey === 'AllSouls') {
    return getDefaultFestivitaDate(eventKey, anno)
      || getAmbrosianFestivitaDate(eventKey, anno);
  }
  return getAmbrosianFestivitaDate(eventKey, anno)
    || getDefaultFestivitaDate(eventKey, anno);
}

/** Se AllSaints era stato salvato per errore sul giorno della vigilia (31 ott), ripristina. */
function sanitizeDefuntiDateOverrides(anno) {
  anno = String(anno);
  const civilSaints = getDefaultFestivitaDate('AllSaints', anno);
  const overrideSaints = getFestivitaDateOverrideOnly('AllSaints', anno);
  if (civilSaints && overrideSaints && overrideSaints === addDaysToDateStr(civilSaints, -1)) {
    clearFestivitaDateForAnno('AllSaints', anno);
  }
}

function setFestivitaDateForAnno(eventKey, dateStr) {
  if (!eventKey || !dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const anno = dateStr.slice(0, 4);
  const map = getFestivitaDateOverridesMap();
  if (!map[eventKey] || typeof map[eventKey] !== 'object') map[eventKey] = {};
  const ambrosian = getAmbrosianFestivitaDate(eventKey, anno);
  const def = getDefaultFestivitaDate(eventKey, anno);
  // Se coincide con ambrosiano o default, togli override
  if ((ambrosian && dateStr === ambrosian) || (!ambrosian && def && dateStr === def)) {
    delete map[eventKey][anno];
    if (!Object.keys(map[eventKey]).length) delete map[eventKey];
  } else {
    map[eventKey][anno] = dateStr;
  }
  clearLiturgicalSeasonCache();
  return true;
}

function clearFestivitaDateForAnno(eventKey, anno) {
  if (!eventKey) return;
  anno = String(anno);
  const map = getFestivitaDateOverridesMap();
  if (!map[eventKey]) return;
  delete map[eventKey][anno];
  if (!Object.keys(map[eventKey]).length) delete map[eventKey];
  clearLiturgicalSeasonCache();
}

function formatShortFestivitaDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatFestivitaDayMonthLabel(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long'
  });
}

function formatFestivitaDateHint(eventKey, anno) {
  const dateStr = getFestivitaDateForAnno(eventKey, anno);
  if (!dateStr) return '';
  const overridden = !!getFestivitaDateOverrideOnly(eventKey, anno);
  const ambrosian = getAmbrosianFestivitaDate(eventKey, anno);
  const label = formatShortFestivitaDate(dateStr);
  if (overridden) return `${label} · correzione civile`;
  if (ambrosian && ambrosian === dateStr) return `${label} · ambrosiano`;
  return `${label} · civile`;
}

/**
 * Offset civile della celebrazione rispetto al giorno liturgico (eventKey).
 * Vigilia/vespri con messe dayOffset -1 → giorno civile precedente.
 */
function getCelebrationCivilDayOffset(group, slots) {
  if (!group) return 0;
  const key = group.celebrationKey || null;
  if (key === 'vigilia' || key === 'vespri') return -1;
  const list = Array.isArray(slots) ? slots : [];
  if (list.length && list.every(s => s.dayOffset === -1)) return -1;
  // Preset vigiliare senza slot ancora caricati
  if (/Vigil$/i.test(group.presetId || '') || /Vigil$/i.test(group.dayPreset || '')) {
    if (key === 'vigilia' || key === 'vespri' || key === 'notte') return -1;
  }
  return 0;
}

function shiftFestivitaDateStr(dateStr, days) {
  if (!dateStr || !days) return dateStr || null;
  return addDaysToDateStr(dateStr, days);
}

/** Meta date per card Modelli: ambrosiano + civile/correzione (opz. giorno civile celebrazione). */
function getFestivitaModelloDateMeta(eventKey, pastoralStartY, civilDayOffset = 0) {
  if (!eventKey) return null;
  const anno = resolveFestivitaAnnoForEventKey(eventKey, pastoralStartY);
  const ambrosianAnchor = getAmbrosianFestivitaDate(eventKey, anno);
  const overrideAnchor = getFestivitaDateOverrideOnly(eventKey, anno);
  const civilDefaultAnchor = getDefaultFestivitaDate(eventKey, anno);
  const effectiveAnchor = overrideAnchor || (
    (eventKey === 'AllSaints' || eventKey === 'AllSouls')
      ? (civilDefaultAnchor || ambrosianAnchor)
      : (ambrosianAnchor || civilDefaultAnchor)
  );
  const off = civilDayOffset === -1 ? -1 : 0;
  const ambrosian = shiftFestivitaDateStr(ambrosianAnchor, off);
  const override = shiftFestivitaDateStr(overrideAnchor, off);
  const civilDefault = shiftFestivitaDateStr(civilDefaultAnchor, off);
  const effective = shiftFestivitaDateStr(effectiveAnchor, off);
  let source = 'civile';
  if (overrideAnchor) source = 'correzione';
  else if (effectiveAnchor && ambrosianAnchor && effectiveAnchor === ambrosianAnchor) source = 'ambrosiano';
  else if (effectiveAnchor && civilDefaultAnchor && effectiveAnchor === civilDefaultAnchor) source = 'civile';
  else if (ambrosianAnchor) source = 'ambrosiano';
  return {
    anno,
    civilDayOffset: off,
    anchorEffective: effectiveAnchor,
    ambrosian,
    override,
    civilDefault,
    effective,
    ambrosianLabel: ambrosian ? formatShortFestivitaDate(ambrosian) : 'non in calendario',
    effectiveLabel: effective ? formatShortFestivitaDate(effective) : '—',
    source
  };
}

/** Anno civile della festa rispetto all’anno pastorale (set–ago). */
function resolveFestivitaAnnoForEventKey(eventKey, pastoralStartY) {
  const md = FESTIVITA_DEFAULT_MD[eventKey];
  const startY = parseInt(pastoralStartY, 10);
  if (!md || !Number.isFinite(startY)) return String(pastoralStartY || new Date().getFullYear());
  const month = parseInt(md.slice(0, 2), 10);
  return String(month >= 9 ? startY : startY + 1);
}

function findEventKeyForDateOverride(dateStr) {
  if (!dateStr) return null;
  const anno = dateStr.slice(0, 4);
  for (const eventKey of Object.keys(FESTIVITA_DEFAULT_MD)) {
    if (getFestivitaDateOverrideOnly(eventKey, anno) === dateStr) return eventKey;
  }
  // Anche data effettiva (ambrosiano/default) per il selettore calendario
  for (const eventKey of Object.keys(FESTIVITA_DEFAULT_MD)) {
    if (getFestivitaDateForAnno(eventKey, anno) === dateStr) return eventKey;
  }
  return null;
}

function getPrimaryFestivityEventKey(dateStr) {
  // 1) correzione civile comunità
  const fromOverride = findEventKeyForDateOverride(dateStr);
  if (fromOverride && getFestivitaDateOverrideOnly(fromOverride, dateStr.slice(0, 4)) === dateStr) {
    return fromOverride;
  }
  // 2) Defunti civili (1/2 nov) prima del LitCal spostato
  const defuntiPreset = detectDefuntiCivilPreset(dateStr);
  if (defuntiPreset) return FESTIVITA_EVENTKEY_BY_PRESET[defuntiPreset] || null;
  // 3) giorno liturgico ambrosiano (se non spostato)
  const fromLit = detectFestivityPresetFromAmbrosian(dateStr);
  if (fromLit) {
    const eventKey = FESTIVITA_EVENTKEY_BY_PRESET[fromLit];
    const effective = eventKey
      ? getFestivitaDateForAnno(eventKey, dateStr.slice(0, 4))
      : null;
    if (eventKey && (!effective || effective === dateStr)) return eventKey;
  }
  // 4) data effettiva (ambrosiano/default) per il selettore calendario
  for (const eventKey of Object.keys(FESTIVITA_DEFAULT_MD)) {
    if (getFestivitaDateForAnno(eventKey, dateStr.slice(0, 4)) === dateStr) return eventKey;
  }
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = primaryEvent(events) || events[0];
  return primary?.eventKey || null;
}

function getFestivitaModelli() {
  ensureGruppiConfig();
  return state.gruppiConfig.festivitaModelli || [];
}

/** Modello giorno completo: unisce tutte le celebrazioni (o legacy monolitico). */
function getFestivitaModello(eventKey) {
  if (!eventKey) return null;
  const groups = getStrutturaGiornoGroupsForEventKey(eventKey);
  const celebrationGroups = groups.filter(g => g.celebrationKey);
  if (celebrationGroups.length) {
    const slots = [];
    let anyCustom = false;
    let allDisabled = true;
    let strutturaKind = null;
    let dayPreset = celebrationGroups[0].dayPreset || celebrationGroups[0].presetId;
    celebrationGroups.forEach(g => {
      const celeb = getFestivitaModelloCelebrazione(eventKey, g.celebrationKey);
      if (celeb?.disabled && !celeb._fromLegacy) {
        anyCustom = true;
        if (celeb.strutturaKind) strutturaKind = celeb.strutturaKind;
        if (celeb.preset) dayPreset = celeb.preset;
        return; // comunità: non celebriamo questa parte
      }
      allDisabled = false;
      if (celeb && Array.isArray(celeb.slots) && !celeb._fromLegacy) {
        anyCustom = true;
        if (celeb.strutturaKind) strutturaKind = celeb.strutturaKind;
        if (celeb.preset) dayPreset = celeb.preset;
        slots.push(...(celeb.slots || []));
      } else {
        const defaults = buildFestivityPresetSlots(g.presetId);
        if (Array.isArray(defaults)) slots.push(...defaults);
      }
    });
    if (!anyCustom) {
      return getFestivitaModelli().find(m => m.eventKey === eventKey && !m.celebrationKey) || null;
    }
    return {
      eventKey,
      preset: dayPreset,
      strutturaKind,
      slots: renumberFestivaSlots(cloneFestivaSlotsForModello(slots) || []),
      disabled: allDisabled || undefined,
      nota: celebrationGroups.map(g => g.label).join(' + ')
    };
  }
  const mono = getFestivitaModelli().find(m => m.eventKey === eventKey && !m.celebrationKey)
    || getFestivitaModelli().find(m => m.eventKey === eventKey)
    || null;
  return mono;
}

function cloneFestivaSlotsForModello(slots) {
  if (!Array.isArray(slots)) return null;
  return slots.map(s => {
    const row = {
      dayOffset: s.dayOffset === -1 ? -1 : 0,
      ora: s.ora || '10:00',
      sede: s.sede || 'santuario',
      vigilia: !!s.vigilia || s.dayOffset === -1,
      conTurno: !!s.conTurno
    };
    if (s.titolo) row.titolo = String(s.titolo).trim();
    return row;
  });
}

/** Salva orario/preset della festa per gli anni successivi (chiave LitCal). */
function saveFestivitaModelloFromExtra(extra) {
  if (!extra?.data) return null;
  const eventKey = getPrimaryFestivityEventKey(extra.data);
  if (!eventKey) return null;
  ensureGruppiConfig();
  if (!Array.isArray(state.gruppiConfig.festivitaModelli)) {
    state.gruppiConfig.festivitaModelli = [];
  }
  const entry = {
    eventKey,
    preset: extra.preset || detectFestivityPreset(extra.data),
    strutturaKind: extra.strutturaKind || null,
    slots: Array.isArray(extra.slots) ? cloneFestivaSlotsForModello(extra.slots) : null,
    nota: extra.nota || null,
    updatedFrom: extra.data,
    updatedAt: new Date().toISOString()
  };
  const idx = state.gruppiConfig.festivitaModelli.findIndex(m => m.eventKey === eventKey);
  if (idx >= 0) state.gruppiConfig.festivitaModelli[idx] = entry;
  else state.gruppiConfig.festivitaModelli.push(entry);
  extra.eventKey = eventKey;
  return entry;
}

function applyFestivitaModelloToExtra(extra, modello) {
  if (!extra || !modello) return false;
  const preset = modello.preset || detectFestivityPreset(extra.data);
  extra.preset = preset;
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  extra.eventKey = modello.eventKey || extra.eventKey;
  if (modello.strutturaKind && STRUTTURA_KINDS[modello.strutturaKind]) {
    extra.strutturaKind = modello.strutturaKind;
  }
  extra.inheritedFrom = modello.updatedFrom || null;
  if (Array.isArray(modello.slots)) {
    extra.slots = renumberFestivaSlots(modello.slots.map(s => {
      const row = {
        id: newFestivaSlotId(),
        dayOffset: s.dayOffset === -1 ? -1 : 0,
        ora: s.ora || '10:00',
        sede: s.sede || 'santuario',
        vigilia: !!s.vigilia || s.dayOffset === -1,
        conTurno: !!s.conTurno
      };
      if (s.titolo) row.titolo = String(s.titolo).trim();
      return row;
    }));
  } else {
    const built = buildFestivityPresetSlots(preset);
    if (Array.isArray(built)) extra.slots = built;
    else delete extra.slots;
  }
  if (isVigilOnlySlotList(extra.slots)) extra.vigilOnly = true;
  else delete extra.vigilOnly;
  return true;
}

/** Se manca il modello, lo crea dalle festività già personalizzate in quest’anno pastorale. */
function backfillFestivitaModelliFromExtras(anno) {
  anno = String(anno);
  let n = 0;
  (state.messeExtra || []).forEach(extra => {
    if (!extra?.data || !dateInStrutturaPastoralYear(extra.data, anno) || !isExtraFestiva(extra)) return;
    if (!hasCustomFestivaSlots(extra) && !(extra.preset && extra.preset !== 'solennita')) return;
    const key = getPrimaryFestivityEventKey(extra.data);
    if (!key || getFestivitaModello(key)) return;
    saveFestivitaModelloFromExtra(extra);
    n++;
  });
  return n;
}

function applyPresetToFestivaExtra(extra, presetId) {
  if (!extra) return;
  const id = FESTIVITY_PRESETS[presetId] ? presetId : detectFestivityPreset(extra.data);
  extra.preset = id;
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  delete extra.inheritedFrom;
  const slots = buildFestivityPresetSlots(id);
  if (Array.isArray(slots)) {
    extra.slots = slots;
    if (isVigilOnlySlotList(slots)) extra.vigilOnly = true;
    else delete extra.vigilOnly;
  } else {
    delete extra.slots;
    delete extra.vigilOnly;
  }
}

/** True se tutte le messe sono della vigilia (giorno civile precedente), nessuna del giorno. */
function isVigilOnlySlotList(slots) {
  if (!Array.isArray(slots) || !slots.length) return false;
  return slots.every(s => s.dayOffset === -1);
}

function festivaConcreteSlotsOnCivilDate(extra, civilDateStr) {
  if (!extra?.data || !civilDateStr) return [];
  return getFestivaSlots(extra.data).filter(s => s.data === civilDateStr);
}

/**
 * Il giorno liturgico si attiva solo se c’è almeno una messa del giorno (dayOffset 0).
 * Solo vigilia → non applicare orario festivo / non mostrare il giorno come celebrato.
 */
function festivityDayIsActivatedBySlots(slots) {
  if (!Array.isArray(slots)) return true; // template stagione/festivo implicito
  if (!slots.length) return false;
  return slots.some(s => s.dayOffset !== -1);
}

function resolveFestivityScheduleSlots(dateStr) {
  const eventKey = getPrimaryFestivityEventKey(dateStr);
  const modello = getFestivitaModello(eventKey);
  if (modello?.disabled) return [];
  if (modello && Array.isArray(modello.slots)) return cloneFestivaSlotsForModello(modello.slots) || [];
  const preset = detectFestivityPreset(dateStr);
  if (preset && preset !== 'solennita') {
    const built = buildFestivityPresetSlots(preset);
    if (Array.isArray(built)) return built;
  }
  return null;
}

function buildFestivaExtraRecord(dateStr, { source = 'auto' } = {}) {
  const events = calState.data?.byDate?.[dateStr] || [];
  const primary = primaryEvent(events) || events[0];
  const eventKey = getPrimaryFestivityEventKey(dateStr);
  const preset = detectFestivityPreset(dateStr);
  const ctx = getLiturgicalContext(dateStr);
  const presetLabel = preset && preset !== 'solennita' ? getFestivityPresetMeta(preset).label : null;
  const communityLabel = resolveCorrezioneCelebrationLabel(
    { group: null, slots: [] },
    eventKey,
    presetLabel || primary?.nome || ctx.label || 'Festività'
  );
  const extra = {
    uuid: newMessaExtraUuid('MES-FEST'),
    data: dateStr,
    nota: communityLabel,
    tipo: 'festiva',
    usaOrarioDomenicale: true,
    preset,
    eventKey: eventKey || undefined,
    strutturaKind: ctx.strutturaKind || undefined,
    source,
    createdAt: new Date().toISOString()
  };
  const modello = getFestivitaModello(eventKey);
  if (modello) {
    applyFestivitaModelloToExtra(extra, modello);
  } else {
    applyPresetToFestivaExtra(extra, preset);
  }
  // Solo vigilia: non riempire con orario festivo del giorno
  const schedule = Array.isArray(extra.slots) ? extra.slots : resolveFestivityScheduleSlots(dateStr);
  if (isVigilOnlySlotList(schedule)) {
    extra.slots = renumberFestivaSlots(cloneFestivaSlotsForModello(schedule) || []);
    extra.vigilOnly = true;
  } else {
    delete extra.vigilOnly;
  }
  return extra;
}

function cloneOrarioDomenicaleSlots() {
  return cloneStrutturaSlots('domenicale');
}

function cloneOrarioFestivoSlots() {
  if (hasStrutturaConfig('festivo')) return cloneStrutturaSlots('festivo');
  return cloneStrutturaSlots('domenicale');
}

function getFestivaTemplateSlots(extra) {
  if (Array.isArray(extra?.slots)) {
    return extra.slots
      .map(m => ({
        id: m.id || ('slot-' + Math.random().toString(36).slice(2, 8)),
        dayOffset: m.dayOffset === -1 ? -1 : 0,
        ora: m.ora || '10:00',
        sede: m.sede || 'santuario',
        vigilia: !!m.vigilia || m.dayOffset === -1,
        conTurno: !!m.conTurno,
        turnoNum: m.conTurno ? (m.turnoNum || null) : undefined,
        titolo: m.titolo ? String(m.titolo).trim() : undefined
      }))
      .sort((a, b) => a.dayOffset - b.dayOffset || compareOraSlot(a.ora, b.ora));
  }
  // Solo vigilia configurata: non cadere sull’orario festivo del giorno
  if (extra?.vigilOnly) return [];
  if (extra?.preset && extra.preset !== 'solennita') {
    const built = buildFestivityPresetSlots(extra.preset);
    if (Array.isArray(built)) {
      if (isVigilOnlySlotList(built)) return built;
      return built;
    }
  }
  const schedule = extra?.data ? resolveFestivityScheduleSlots(extra.data) : null;
  if (isVigilOnlySlotList(schedule)) return schedule;
  const kind = extra?.strutturaKind || 'festivo';
  if (hasStrutturaConfig(kind)) return cloneStrutturaSlots(kind);
  if (hasStrutturaConfig('festivo')) return cloneStrutturaSlots('festivo');
  return cloneStrutturaSlots('domenicale');
}

function renumberFestivaSlots(slots) {
  let n = 1;
  slots.forEach(m => {
    if (m.conTurno) m.turnoNum = n++;
    else delete m.turnoNum;
  });
  return slots;
}

/** Slot concreti per una festività (stessa logica della domenica, ancorati al giorno di festa). */
function getFestivaSlots(festivaDateStr, opts = {}) {
  const extra = opts.extra || getMessaExtraForDate(festivaDateStr);
  const template = getFestivaTemplateSlots(extra);
  const anchor = extra?.data || festivaDateStr;
  const weekOffset = isRotazioneAttiva() ? getRotationWeekOffset(anchor) : null;
  const civilFilter = opts.civilDate || null;
  return template.map(slot => {
    const data = addDaysToDateStr(anchor, slot.dayOffset);
    const turno = slot.conTurno ? slot.turnoNum : null;
    const gruppo = turno ? getGruppoIdForTurno(turno, anchor) : null;
    const titolo = slot.titolo ? String(slot.titolo).trim() : null;
    return {
      data,
      ora: slot.ora,
      sede: slot.sede,
      sedeLabel: SEDI_LABEL[slot.sede] || slot.sede,
      vigilia: !!slot.vigilia,
      turno: turno || null,
      gruppo,
      gruppoLabel: gruppo ? getGruppoLabel(gruppo) : null,
      conChierichetti: !!slot.conTurno,
      domenicaRef: anchor,
      festivaRef: anchor,
      rotazioneSettimana: weekOffset,
      titolo,
      label: titolo
        ? `${titolo} · ${slot.ora} ${SEDI_LABEL[slot.sede] || slot.sede}`
        : `${slot.ora} ${SEDI_LABEL[slot.sede] || slot.sede}`,
      slotId: slot.id
    };
  }).filter(s => !civilFilter || s.data === civilFilter);
}

function getFestivaTurniSlots(festivaDateStr, opts = {}) {
  return getFestivaSlots(festivaDateStr, opts).filter(s => s.conChierichetti);
}

function getFestivaSlotsForMassInfo(dateStr, massInfo) {
  if (massInfo?.type !== 'festiva' || !massInfo.extra) return getFestivaSlots(dateStr);
  return getFestivaSlots(massInfo.extra.data || dateStr, {
    extra: massInfo.extra,
    civilDate: massInfo.civilDate || dateStr
  });
}

function countAssignedFestivaSlots(festivaDateStr, opts = {}) {
  return getFestivaTurniSlots(festivaDateStr, opts).filter(isSlotCoperto).length;
}

function getFestivaTurniCount(extra) {
  return getFestivaTemplateSlots(extra).filter(s => s.conTurno).length;
}

function newMessaExtraUuid(prefix = 'MES') {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

/**
 * Sincronizza festività auto dell’anno dalle strutture liturgiche.
 * Non materializza ogni giorno di stagione (restano sintetici via getMessaInfo).
 * Crea/aggiorna record solo per solennità/feste e preset giorno, rispettando esclusioni.
 */
function syncFestivitaAnno(anno) {
  anno = String(anno);
  invalidateLiturgyCaches();
  if (!isCurrentUserAdmin()) return { added: 0, needsConfig: false, updated: 0, removed: 0 };
  if (!calState.data?.byDate) return { added: 0, needsConfig: false, updated: 0, removed: 0 };
  const hasAnySeason = ['natalizio', 'pasquale', 'defunti', 'festivo'].some(hasStrutturaConfig);
  if (!hasOrarioFestivoConfig() && !hasAnySeason) {
    return { added: 0, needsConfig: true, updated: 0, removed: 0 };
  }
  if (!Array.isArray(state.messeExtra)) state.messeExtra = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  // Rimuovi festività auto create per sbaglio sulle vigilie domenicali
  const before = state.messeExtra.length;
  state.messeExtra = state.messeExtra.filter(extra => {
    if (!extra?.data || !dateInStrutturaPastoralYear(extra.data, anno) || !isExtraFestiva(extra)) return true;
    if (extra.source !== 'auto') return true;
    if (!isVigiliaDomenicaleLiturgica(extra.data)) return true;
    removed++;
    return false;
  });
  if (state.messeExtra.length !== before) removed = before - state.messeExtra.length;
  removed += pruneAutoFestivitaIntrasettimanaliEscluse();
  sanitizeDefuntiDateOverrides(anno);
  removed += pruneDisplacedFestivitaExtras(anno);
  // Rimuovi festività auto obsolete: domeniche ora domenicali, o giorni senza più bisogno di persist
  {
    const beforeObs = state.messeExtra.length;
    state.messeExtra = state.messeExtra.filter(extra => {
      if (!extra?.data || !dateInStrutturaPastoralYear(extra.data, anno) || !isExtraFestiva(extra)) return true;
      if (extra.source !== 'auto' || extra.orarioPersonalizzato) return true;
      if (isFestivityDisplacedFromDate(extra.data)) return false;
      const eventKey = extra.eventKey || FESTIVITA_EVENTKEY_BY_PRESET[extra.preset];
      if (eventKey) {
        const effective = getFestivitaDateForAnno(eventKey, extra.data.slice(0, 4));
        if (effective && effective !== extra.data) return false;
      }
      const ctx = getLiturgicalContext(extra.data);
      if (isSundayDate(extra.data) && ctx.strutturaKind === 'domenicale') return false;
      const needsPersist = (ctx.preset && ctx.preset !== 'solennita')
        || isSolennitaFestivaDay(extra.data)
        || (ctx.strutturaKind === 'festivo' && !isSundayDate(extra.data) && hasStrutturaConfig('festivo'));
      return needsPersist;
    });
    removed += beforeObs - state.messeExtra.length;
  }
  backfillFestivitaModelliFromExtras(anno);
  Object.keys(calState.data.byDate).forEach(dateStr => {
    if (!dateInStrutturaPastoralYear(dateStr, anno)) return;
    if (isFestivitaEsclusa(dateStr)) return;
    if (isGiornoIntrasettimanaleEscluso(dateStr)) return;
    if (getMessaExtraForDate(dateStr)) return;
    const ctx = getLiturgicalContext(dateStr);
    const needsPersist = (ctx.preset && ctx.preset !== 'solennita')
      || isSolennitaFestivaDay(dateStr)
      || (ctx.strutturaKind === 'festivo' && !isSundayDate(dateStr) && hasStrutturaConfig('festivo'));
    if (!needsPersist) return;
    const kind = ctx.strutturaKind;
    if (kind && !hasStrutturaConfig(kind) && !hasOrarioFestivoConfig() && !hasStrutturaConfig('domenicale')) return;
    state.messeExtra.push(buildFestivaExtraRecord(dateStr, { source: 'auto' }));
    added++;
  });
  (state.messeExtra || []).forEach(extra => {
    if (!extra?.data || !dateInStrutturaPastoralYear(extra.data, anno) || !isExtraFestiva(extra)) return;
    if (isFestivitaEsclusa(extra.data)) return;
    const ctx = getLiturgicalContext(extra.data);
    if (!extra.strutturaKind && ctx.strutturaKind) {
      extra.strutturaKind = ctx.strutturaKind;
      updated++;
    }
    if (extra.orarioPersonalizzato) {
      if (!extra.preset) extra.preset = detectFestivityPreset(extra.data);
      return;
    }
    const detected = detectFestivityPreset(extra.data);
    if (detected && detected !== 'solennita' && extra.preset !== detected) {
      extra.preset = detected;
      updated++;
    }
    if (ctx.strutturaKind && extra.strutturaKind !== ctx.strutturaKind) {
      extra.strutturaKind = ctx.strutturaKind;
      updated++;
    }
    const eventKey = getPrimaryFestivityEventKey(extra.data);
    if (eventKey && extra.eventKey !== eventKey) {
      extra.eventKey = eventKey;
      updated++;
    }
    const communityNota = sanitizeAwayStrutturaName(
      resolveCorrezioneCelebrationLabel(
        { group: null, slots: [] },
        eventKey || extra.eventKey,
        (ctx.preset && ctx.preset !== 'solennita' ? getFestivityPresetMeta(ctx.preset).label : null)
          || ctx.label
          || extra.nota
      ),
      extra.data,
      'Celebrazione'
    );
    if (communityNota && extra.nota !== communityNota) {
      extra.nota = communityNota;
      updated++;
    }
    const modello = getFestivitaModello(eventKey);
    if (modello) {
      const beforeModello = JSON.stringify(extra);
      applyFestivitaModelloToExtra(extra, modello);
      if (JSON.stringify(extra) !== beforeModello) updated++;
      return;
    }
    if (extra.preset && extra.preset !== 'solennita' && hasCustomFestivaSlots(extra)) return;
    if (!hasCustomFestivaSlots(extra) && detected !== 'solennita') {
      applyPresetToFestivaExtra(extra, detected);
      updated++;
    } else if (!extra.preset) {
      extra.preset = detected;
      updated++;
    }
  });
  return { added, needsConfig: false, updated, removed };
}

function getMessaInfo(dateStr) {
  if (!dateStr) return null;
  if (_messaInfoCache.has(dateStr)) return _messaInfoCache.get(dateStr);
  const info = computeMessaInfo(dateStr);
  _messaInfoCache.set(dateStr, info);
  return info;
}

function computeMessaInfo(dateStr) {
  // Festa LitCal sul giorno ma celebrata altrove: niente orario festivo qui (come in Correzioni)
  if (isFestivityDisplacedFromDate(dateStr)) {
    const extraHere = getMessaExtraForDate(dateStr);
    if (extraHere && !isExtraFestiva(extraHere) && extraHere.tipo === 'straordinaria') {
      const vigil = resolveCivilDayVigilFromNext(dateStr);
      return {
        type: 'extra',
        extra: extraHere,
        context: getLiturgicalContext(dateStr),
        ...(vigil ? {
          fromVigilOf: vigil.fromVigilOf,
          domenicaRef: vigil.domenicaRef || vigil.fromVigilOf,
          vigilSlots: vigil.slots,
          vigilKind: vigil.kind
        } : {})
      };
    }
    // Vigilia di un’altra festa communauté sul giorno dopo può comunque cadere qui
    const vigil = resolveCivilDayVigilFromNext(dateStr);
    if (vigil?.kind === 'festiva') {
      return {
        type: 'festiva',
        extra: vigil.extra,
        context: vigil.context,
        civilDate: dateStr,
        fromVigilOf: vigil.fromVigilOf
      };
    }
    if (isSundayDate(dateStr) && hasStrutturaConfig('domenicale')) {
      const ctx = getLiturgicalContext(dateStr);
      return { type: 'domenica', context: ctx.strutturaKind === 'domenicale' ? ctx : { ...ctx, strutturaKind: 'domenicale' } };
    }
    return null;
  }

  const extra = getMessaExtraForDate(dateStr);
  if (extra) {
    if (isExtraFestiva(extra)
      && isGiornoIntrasettimanaleEscluso(dateStr)
      && extra.source === 'auto'
      && !extra.orarioPersonalizzato) {
      return null;
    }
    if (isExtraFestiva(extra)) {
      // Extra della festa sul giorno sbagliato rispetto alla data effettiva comunità
      const ek = extra.eventKey || FESTIVITA_EVENTKEY_BY_PRESET[extra.preset];
      if (ek) {
        const effective = getFestivitaDateForAnno(ek, dateStr.slice(0, 4));
        if (effective && effective !== dateStr) {
          const onThisCivilDay = festivaConcreteSlotsOnCivilDate(extra, dateStr);
          if (!onThisCivilDay.length) return null;
        }
      }
      const ctx = getLiturgicalContext(dateStr);
      if (!extra.strutturaKind && ctx.strutturaKind) extra.strutturaKind = ctx.strutturaKind;
      const template = getFestivaTemplateSlots(extra);
      const onThisCivilDay = festivaConcreteSlotsOnCivilDate(extra, dateStr);
      if (!onThisCivilDay.length && isVigilOnlySlotList(template)) {
        return null;
      }
      if (!onThisCivilDay.length && template.length > 0 && !template.some(s => s.dayOffset !== -1)) {
        return null;
      }
      // Festiva sul sabato + eventuale altra vigilia del giorno dopo
      const vigil = resolveCivilDayVigilFromNext(dateStr);
      const sameExtraVigil = vigil?.extra && vigil.extra.uuid && vigil.extra.uuid === extra.uuid;
      return {
        type: 'festiva',
        extra,
        context: ctx,
        civilDate: dateStr,
        ...(vigil && !sameExtraVigil ? {
          fromVigilOf: vigil.fromVigilOf,
          domenicaRef: vigil.domenicaRef || vigil.fromVigilOf,
          vigilSlots: vigil.slots,
          vigilKind: vigil.kind
        } : {})
      };
    }
    // Straordinaria: tieni anche la vigilia domenicale/festiva del giorno dopo
    const vigil = resolveCivilDayVigilFromNext(dateStr);
    return {
      type: 'extra',
      extra,
      context: getLiturgicalContext(dateStr),
      ...(vigil ? {
        fromVigilOf: vigil.fromVigilOf,
        domenicaRef: vigil.domenicaRef || vigil.fromVigilOf,
        vigilSlots: vigil.slots,
        vigilKind: vigil.kind
      } : {})
    };
  }

  // Vigilia civile dal giorno liturgico successivo (festiva o domenicale)
  const vigil = resolveCivilDayVigilFromNext(dateStr);
  if (vigil?.kind === 'festiva') {
    return {
      type: 'festiva',
      extra: vigil.extra,
      context: vigil.context,
      civilDate: dateStr,
      fromVigilOf: vigil.fromVigilOf
    };
  }
  if (vigil?.kind === 'domenicale') {
    return {
      type: 'domenica',
      context: vigil.context,
      civilDate: dateStr,
      fromVigilOf: vigil.fromVigilOf,
      domenicaRef: vigil.domenicaRef
    };
  }

  const nextDate = addDaysToDateStr(dateStr, 1);
  const ctx = getLiturgicalContext(dateStr);
  if (isFestivitaEsclusa(dateStr)) return null;
  if (isGiornoIntrasettimanaleEscluso(dateStr)) return null;

  // Ai cerimoniere mostriamo solo domeniche e celebrazioni già confermate
  // dall'admin come Messe extra; i giorni liturgici senza Messa restano admin-only.
  if (!isCurrentUserAdmin() && !isSundayDate(dateStr)) return null;

  if (ctx.preset && ctx.preset !== 'solennita') {
    const syn = buildSyntheticFestivaExtra(dateStr, ctx);
    const template = getFestivaTemplateSlots(syn);
    if (isVigilOnlySlotList(template) || !festivityDayIsActivatedBySlots(template)) {
      return null;
    }
    if (!festivaConcreteSlotsOnCivilDate(syn, dateStr).length) return null;
    return { type: 'festiva', extra: syn, context: ctx };
  }

  // Sintetico: vigilia da preset del giorno successivo
  const nextCtx = getLiturgicalContext(nextDate);
  if (nextCtx.preset && nextCtx.preset !== 'solennita' && !isFestivityDisplacedFromDate(nextDate)) {
    const synNext = buildSyntheticFestivaExtra(nextDate, nextCtx);
    const vigilSlots = festivaConcreteSlotsOnCivilDate(synNext, dateStr);
    if (vigilSlots.length) {
      return {
        type: 'festiva',
        extra: synNext,
        context: nextCtx,
        civilDate: dateStr,
        fromVigilOf: nextDate
      };
    }
  }

  if (ctx.strutturaKind === 'domenicale' && hasStrutturaConfig('domenicale')) {
    return { type: 'domenica', context: ctx };
  }

  if (ctx.strutturaKind && hasStrutturaConfig(ctx.strutturaKind)) {
    return { type: 'festiva', extra: buildSyntheticFestivaExtra(dateStr, ctx), context: ctx };
  }

  // Fallback: domenica civile anche senza struttura classificata
  if (isSundayDate(dateStr) && hasStrutturaConfig('domenicale')) {
    return { type: 'domenica', context: ctx };
  }

  return null;
}

function getMesseDatesForYear(anno) {
  anno = String(anno);
  if (_messeDatesYearCache.anno === anno && Array.isArray(_messeDatesYearCache.dates)) {
    return _messeDatesYearCache.dates.slice();
  }
  const set = new Set();
  getSundaysInYear(parseInt(anno, 10)).forEach(d => {
    set.add(d);
    // Sabato vigiliare del modello domenicale
    const vigil = addDaysToDateStr(d, -1);
    if (vigil.startsWith(anno) && getMessaInfo(vigil)) set.add(vigil);
  });
  (state.messeExtra || []).forEach(m => {
    if (m.data && m.data.startsWith(anno)) set.add(m.data);
    // Vigilia sul giorno civile precedente
    if (m.data && isExtraFestiva(m)) {
      const vigil = addDaysToDateStr(m.data, -1);
      if (vigil.startsWith(anno) && festivaConcreteSlotsOnCivilDate(m, vigil).length) set.add(vigil);
    }
  });
  // Giorni civili già in Correzioni (con messe) per gli anni pastorali che toccano l’anno civile
  const y = parseInt(anno, 10);
  [String(y - 1), String(y)].forEach(pastoralStart => {
    try {
      getCorrezioniCivilDaysCached(pastoralStart).forEach(day => {
        if (!day?.data || !day.data.startsWith(anno)) return;
        if ((day.slots || []).length) set.add(day.data);
      });
    } catch (_) { /* calendario non pronto */ }
  });
  // Solo i range di stagione (non tutto l’anno civile)
  try {
    const bounds = getLiturgicalSeasonBounds(anno);
    const addRange = (range) => {
      if (!range?.start || !range?.end) return;
      for (let d = range.start; d <= range.end; d = addDaysToDateStr(d, 1)) {
        if (!d.startsWith(anno) || set.has(d)) continue;
        if (getMessaInfo(d)) set.add(d);
      }
    };
    (bounds.nataleRanges || []).forEach(addRange);
    addRange(bounds.pasqua);
    addRange(bounds.defunti);
  } catch (_) { /* ignore */ }
  const dates = [...set].sort();
  _messeDatesYearCache = { anno, dates };
  return dates.slice();
}

function getTurniForDate(dateStr) {
  return state.turni.filter(t => t.data === dateStr);
}

async function loadMesseAgenda() {
  const container = document.getElementById('messe-agenda');
  if (messeState.loading) {
    messeState.reloadQueued = true;
    return;
  }

  messeState.loading = true;
  container.innerHTML = '<div class="cal-loading">Caricamento agenda…</div>';

  try {
    const anno = getMesseAnno();
    await ensureCalendarioForYear(anno);
    updateMesseFestivoBanner(false);
    updateMesseAgendaSummary();
    renderMesseAgenda();

    if (messeState.selectedDate) {
      renderMessaDetail(messeState.selectedDate);
    } else if (isMesseMobile()) {
      ensureNextMessaSelected();
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = `<p class="empty-state">Impossibile caricare l'agenda.<br>${esc(err.message || 'Riprova')}</p>`;
  } finally {
    messeState.loading = false;
    syncMesseFab();
    if (messeState.reloadQueued) {
      messeState.reloadQueued = false;
      void loadMesseAgenda();
    }
  }
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
  const fromCorrezioni = getMessaCivilDayTitleFromCorrezioni(dateStr);
  if (fromCorrezioni && !isStrutturaDisplayName(fromCorrezioni)) return fromCorrezioni;
  if (massInfo?.fromVigilOf) {
    const groups = getStrutturaGiornoGroupsForEventKey(massInfo.extra?.eventKey || getPrimaryFestivityEventKey(massInfo.fromVigilOf))
      .filter(g => g.celebrationKey === 'vigilia' || g.celebrationKey === 'vespri');
    if (groups.length === 1) {
      const lab = getStrutturaGiornoDisplayLabel(groups[0]);
      if (lab && !isStrutturaDisplayName(lab)) return lab;
    }
    // Vigilia domenicale / festa: titolo del giorno liturgico (domenica o festa)
    const sunPrimary = getLiturgicalDayEvent(massInfo.fromVigilOf);
    if (sunPrimary?.nome && !isStrutturaDisplayName(sunPrimary.nome)) {
      return sanitizeAwayStrutturaName(sunPrimary.nome, massInfo.fromVigilOf, 'Domenica');
    }
  }
  if ((massInfo?.type === 'extra' || massInfo?.type === 'festiva') && massInfo.extra?.nota
    && !isStrutturaDisplayName(massInfo.extra.nota)) {
    return massInfo.extra.nota;
  }
  return sanitizeAwayStrutturaName(primary?.nome, dateStr,
    massInfo?.type === 'festiva' ? 'Festività'
      : massInfo?.type === 'extra' ? 'Messa straordinaria'
        : 'Domenica');
}

function buildMessaAgendaItem(dateStr) {
  const todayStr = getTodayStr();
  const massInfo = getMessaInfo(dateStr);
  const litRef = massInfo?.fromVigilOf || dateStr;
  const primary = getLiturgicalDayEvent(litRef) || getLiturgicalDayEvent(dateStr);
  const turni = getTurniForAgendaDate(dateStr);
  const d = new Date(dateStr + 'T12:00:00');
  const isToday = dateStr === todayStr;
  const isPast = dateStr < todayStr;
  const isSelected = dateStr === messeState.selectedDate;
  const title = getMessaAgendaTitle(dateStr, massInfo, primary);
  const isExtra = massInfo?.type === 'extra';
  const isFestiva = massInfo?.type === 'festiva';
  const weekday = d.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
  const isDomenica = massInfo?.type === 'domenica';
  const domenicaRef = isDomenica ? getDomenicaRefFromMassInfo(dateStr, massInfo) : dateStr;
  const vigilSlots = Array.isArray(massInfo?.vigilSlots) ? massInfo.vigilSlots : [];
  const nTurni = isFestiva
    ? getFestivaTurniCount(massInfo.extra)
    : ((isDomenica || vigilSlots.length) ? getTurniPerDomenica() : 0);
  const assignedVigil = vigilSlots.length
    ? vigilSlots.filter(s => s.conChierichetti !== false && isSlotCoperto(s)).length
    : 0;
  const assignedSlots = isDomenica
    ? countAssignedSlotsOnCivil(domenicaRef, dateStr)
    : (isFestiva
      ? countAssignedFestivaSlots(massInfo.extra?.data || dateStr, {
        extra: massInfo.extra,
        civilDate: massInfo.civilDate || dateStr
      }) + assignedVigil
      : assignedVigil);
  const coverageComplete = nTurni > 0 && assignedSlots >= nTurni
    && (isDomenica || isFestiva || vigilSlots.length);
  const litColor = primary?.colore || '';

  const classes = ['messe-agenda-item'];
  if (isToday) classes.push('today');
  if (isPast) classes.push('past');
  if (isSelected) classes.push('selected');
  if (litColor) classes.push(`lit-${litColor}`);

  const metaParts = [];
  if (primary?.tipoLabel && primary.tipoLabel !== 'Feriale') metaParts.push(primary.tipoLabel);
  let slots = isDomenica
    ? getMesseOrdinarieSlotsOnCivil(domenicaRef, dateStr)
    : (isFestiva ? getFestivaSlots(massInfo.extra?.data || dateStr, {
      extra: massInfo.extra,
      civilDate: massInfo.civilDate || dateStr
    }) : []);
  if (isExtra && massInfo.extra) {
    slots = [{
      data: dateStr,
      ora: massInfo.extra.ora || '10:00',
      sede: massInfo.extra.sede || 'santuario',
      sedeLabel: SEDI_LABEL[massInfo.extra.sede] || massInfo.extra.sede || '',
      titolo: massInfo.extra.nota || null,
      conChierichetti: true
    }];
  }
  // Unisci vigilia (es. 18:00 domenicale) a straordinaria/festiva sullo stesso sabato
  if (vigilSlots.length) {
    const keys = new Set(slots.map(s => `${s.ora}|${s.sede}`));
    vigilSlots.forEach(s => {
      const k = `${s.ora}|${s.sede}`;
      if (!keys.has(k)) {
        keys.add(k);
        slots.push(s);
      }
    });
    slots.sort((a, b) => compareOraSlot(a.ora, b.ora) || String(a.sede).localeCompare(String(b.sede)));
  }
  if (slots.length) {
    metaParts.push(slots.map(slot => `${slot.ora || ''} ${SEDI_LABEL[slot.sede] || slot.sede || ''}`.trim()).join(' · '));
  }
  const metaLine = metaParts.filter(Boolean).join(' · ');

  const badges = [];
  if (litColor) {
    const litLabel = litColor.charAt(0).toUpperCase() + litColor.slice(1);
    badges.push(`<span class="messe-agenda-badge lit-${litColor}" title="Colore liturgico">${esc(litLabel)}</span>`);
  }
  if (isFestiva) {
    const personalized = hasCustomFestivaSlots(massInfo.extra);
    const emptySlots = personalized && !(massInfo.extra.slots || []).length;
    badges.push(`<span class="messe-agenda-badge is-festiva">${emptySlots ? 'Nessuna celebrazione' : (personalized ? 'Orario personalizzato' : 'Da modello')}</span>`);
  } else if (isExtra) {
    badges.push('<span class="messe-agenda-badge is-extra">Straordinaria</span>');
  }
  if (nTurni > 0 && (isDomenica || isFestiva || vigilSlots.length)) {
    const covClass = coverageComplete ? 'is-covered' : 'is-uncovered';
    badges.push(`<span class="messe-agenda-badge ${covClass}">${assignedSlots}/${nTurni} coperte</span>`);
  } else if (!isDomenica && !isFestiva && !vigilSlots.length && turni.length) {
    badges.push('<span class="messe-agenda-badge is-covered">Con servizio</span>');
  }

  return `
    <article class="${classes.join(' ')}" id="messa-item-${dateStr}" data-date="${dateStr}" onclick="selectMessaDay('${dateStr}')">
      <div class="messe-agenda-date">
        <span class="messe-agenda-day">${d.getDate()}</span>
        <span class="messe-agenda-weekday">${esc(weekday)}</span>
      </div>
      <div class="messe-agenda-main">
        <p class="messa-agenda-title">${esc(title)}</p>
        <p class="messa-agenda-meta">
          ${metaLine ? `<span class="messa-agenda-meta-text">${esc(metaLine)}</span>` : ''}
          ${badges.length ? `<span class="messe-agenda-badges">${badges.join('')}</span>` : ''}
        </p>
      </div>
    </article>
  `;
}

function renderMesseAgenda() {
  const container = document.getElementById('messe-agenda');
  const anno = parseInt(getMesseAnno(), 10);
  const today = getTodayStr();
  document.querySelectorAll('[data-messe-view]').forEach(btn => {
    const active = btn.dataset.messeView === messeState.view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  if (messeState.view === 'calendario') {
    renderMesseMonth();
    return;
  }
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

function setMesseView(view) {
  messeState.view = view === 'calendario' ? 'calendario' : 'agenda';
  localStorage.setItem('messe_view', messeState.view);
  document.querySelectorAll('[data-messe-view]').forEach(btn => {
    const active = btn.dataset.messeView === messeState.view;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  renderMesseAgenda();
}

function shiftMesseMonth(delta) {
  const date = new Date(parseInt(getMesseAnno(), 10), messeState.month + delta, 1);
  document.getElementById('anno-messe').value = String(date.getFullYear());
  messeState.month = date.getMonth();
  void ensureCalendarioForYear(String(date.getFullYear())).then(() => loadMesseAgenda());
}

function renderMesseMonth() {
  const container = document.getElementById('messe-agenda');
  const year = parseInt(getMesseAnno(), 10);
  const month = messeState.month;
  const today = getTodayStr();
  const dates = getMesseDatesForYear(year).filter(dateStr =>
    dateStr.slice(5, 7) === String(month + 1).padStart(2, '0')
      && (messeState.showPast || dateStr >= today)
  );
  const firstOffset = getMondayFirstOffset(new Date(year, month, 1));
  const days = new Date(year, month + 1, 0).getDate();
  let html = `<div class="messe-calendar-shell"><div class="messe-calendar-nav">
    <button type="button" class="btn btn-secondary btn-icon" onclick="shiftMesseMonth(-1)" aria-label="Mese precedente">‹</button>
    <h4>${MONTHS[month]} ${year}</h4>
    <button type="button" class="btn btn-secondary btn-icon" onclick="shiftMesseMonth(1)" aria-label="Mese successivo">›</button>
  </div><div class="calendar-weekdays">${WEEKDAYS.map(day => `<span>${day}</span>`).join('')}</div><div class="calendar-grid messe-calendar-grid">`;
  for (let i = 0; i < firstOffset; i++) html += '<div class="calendar-day empty"></div>';
  for (let day = 1; day <= days; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const hasMass = dates.includes(dateStr);
    const info = hasMass ? getMessaInfo(dateStr) : null;
    const liturgicalDay = getLiturgicalDayEvent(dateStr);
    const title = hasMass ? getMessaAgendaTitle(dateStr, info, liturgicalDay) : '';
    const classes = ['calendar-day', 'messe-calendar-day'];
    if (liturgicalDay) {
      if (liturgicalDay.tipo === 'solennita') classes.push('solemnity');
      else if (liturgicalDay.tipo === 'festa') classes.push('festa');
      else if (liturgicalDay.tipo === 'memoria') classes.push('memoria');
      if (liturgicalDay.colore === 'verde') classes.push('col-verde');
      else if (liturgicalDay.colore === 'viola') classes.push('col-viola');
      else if (liturgicalDay.colore === 'rosso') classes.push('col-rosso');
      else if (liturgicalDay.colore === 'bianco') classes.push('col-bianco');
    }
    if (hasMass) classes.push('has-messa');
    if (dateStr === today) classes.push('today');
    if (dateStr === messeState.selectedDate) classes.push('selected');
    html += `<button type="button" class="${classes.join(' ')}" ${hasMass ? `onclick="selectMessaDay('${dateStr}', true)"` : 'disabled'} aria-label="${day}${hasMass ? `, ${esc(title)}` : ''}">
      <span class="day-num">${day}</span>${hasMass ? `<span class="messe-calendar-dot" aria-hidden="true"></span><span class="messe-calendar-title">${esc(title)}</span>` : ''}
    </button>`;
  }
  html += '</div>';
  if (!dates.length) html += '<p class="empty-state">Nessuna Messa in questo mese.</p>';
  html += '</div>';
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
  const festCheck = document.getElementById('messa-extra-orario-domenicale');
  if (festCheck) festCheck.checked = false;
  toggleMessaExtraOrarioFields();
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
  const litRef = massInfo?.fromVigilOf || dateStr;
  const primary = getLiturgicalDayEvent(litRef) || getLiturgicalDayEvent(dateStr);
  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const canManage = isCurrentUserAdmin();

  if (!massInfo) {
    const canFest = isSolennitaFestivaDay(dateStr);
    const esclusa = canFest && isFestivitaEsclusa(dateStr);
    container.innerHTML = `
      <p class="day-detail-date">${esc(dateLabel)}</p>
      <p class="day-detail-empty empty-state-inline">${esclusa
        ? 'Senza messe per quest’anno (senza servizio). Puoi ripristinarle in Correzioni o aggiungere una messa straordinaria.'
        : 'Non è una messa in agenda (solo domeniche, festività e eccezioni).'}</p>
      <div class="messa-actions">
        ${esclusa && canManage ? `<button type="button" class="btn btn-primary" onclick="openCorrezioneOrari(${jsStr(dateStr)})">Modifica in Correzioni</button>` : ''}
        ${canFest && !esclusa && canManage ? `<button type="button" class="btn btn-primary" onclick="addFestivitaFromDate(${jsStr(dateStr)})">Aggiungi come festività</button>` : ''}
        <button type="button" class="btn ${canFest || esclusa ? 'btn-secondary' : 'btn-primary'}" onclick="prefillMessaExtra(${jsStr(dateStr)})">Aggiungi messa straordinaria</button>
      </div>
    `;
    return;
  }

  let badgeClass = 'domenica';
  let badgeLabel = 'Domenica';
  if (massInfo.type === 'festiva') {
    badgeClass = 'festiva';
    badgeLabel = esc(getMessaAgendaTitle(dateStr, massInfo, primary) || massInfo.extra?.nota || 'Festività');
  } else if (massInfo.type === 'extra') {
    badgeClass = 'eccezione';
    badgeLabel = esc(getMessaAgendaTitle(dateStr, massInfo, primary) || massInfo.extra?.nota || 'Messa straordinaria');
  } else if (massInfo.fromVigilOf) {
    badgeLabel = 'Vigilia';
  }

  const notaMessaHtml = renderMessaNotaFieldHtml(dateStr, {
    label: 'Indicazioni del don'
  });

  let turniHtml = '';
  let sectionTitle = 'Messe di servizio';
  if (massInfo.type === 'domenica' || massInfo.type === 'festiva') {
    const domenicaRef = massInfo.type === 'domenica'
      ? getDomenicaRefFromMassInfo(dateStr, massInfo)
      : dateStr;
    const allSlots = massInfo.type === 'festiva'
      ? getFestivaSlotsForMassInfo(dateStr, massInfo)
      : getMesseOrdinarieSlotsOnCivil(domenicaRef, dateStr);
    const assigned = massInfo.type === 'festiva'
      ? countAssignedFestivaSlots(massInfo.extra?.data || dateStr, {
        extra: massInfo.extra,
        civilDate: massInfo.civilDate || dateStr
      })
      : countAssignedSlotsOnCivil(domenicaRef, dateStr);
    const nCelebrazioni = allSlots.length;
    const nTurni = massInfo.type === 'festiva'
      ? getFestivaTurniCount(massInfo.extra)
      : getTurniPerDomenica();
    const personalized = massInfo.type === 'festiva' && hasCustomFestivaSlots(massInfo.extra);
    const presetMeta = massInfo.type === 'festiva'
      ? getFestivityPresetMeta(massInfo.extra?.preset || detectFestivityPreset(dateStr))
      : null;
    const inherited = massInfo.type === 'festiva' && massInfo.extra?.inheritedFrom;
    const orarioHint = massInfo.type === 'festiva'
      ? (personalized
        ? (nCelebrazioni
          ? `Preset «${presetMeta.label}» (modificabile)${inherited ? ' · da anno scorso' : ''}`
          : `Preset «${presetMeta.label}» — nessuna celebrazione`)
        : (hasOrarioFestivoConfig()
          ? `Preset «${presetMeta.label}» · orario festivo tipico${inherited ? ' · da anno scorso' : ''}`
          : 'Orario festivo non configurato — usa la domenica'))
      : (massInfo.fromVigilOf ? 'Messa vigiliare del sabato' : '');
    turniHtml = `
      <p class="liturgy-meta" style="margin-bottom:10px">${nCelebrazioni} celebrazioni · ${assigned}/${nTurni} messe coperte${orarioHint ? ' · ' + esc(orarioHint) : ''}</p>
      ${nCelebrazioni
        ? renderMessaSlotsHtml(allSlots, { withNotes: true, messaDate: dateStr })
        : '<p class="empty-state" style="margin-bottom:10px">Nessuna celebrazione in questo giorno</p>'}
      ${massInfo.type === 'festiva' && canManage ? renderFestivaOrarioActions(massInfo.extra) : ''}
    `;
    sectionTitle = massInfo.type === 'festiva' ? 'Orario festivo' : 'Messe e celebrazioni';
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
      gruppoLabel: null,
      titolo: ex?.nota || null
    };
    const vigilSlots = Array.isArray(massInfo.vigilSlots) ? massInfo.vigilSlots : [];
    const allSlots = [extraSlot];
    vigilSlots.forEach(s => {
      if (!allSlots.some(x => x.ora === s.ora && x.sede === s.sede)) allSlots.push(s);
    });
    allSlots.sort((a, b) => compareOraSlot(a.ora, b.ora) || String(a.sede).localeCompare(String(b.sede)));
    const nTurni = vigilSlots.length ? getTurniPerDomenica() : 0;
    const assigned = vigilSlots.length
      ? vigilSlots.filter(s => s.conChierichetti !== false && isSlotCoperto(s)).length
      : 0;
    const turni = getTurniForDate(dateStr);
    let assignedHtml = '';
    if (!turni.length && !vigilSlots.length) {
      assignedHtml = '<p class="empty-state" style="margin-top:8px">Nessuna squadra assegnata</p>';
    } else if (turni.length) {
      assignedHtml = `<div class="messa-turni-list">${turni.map(t => `
        <div class="messa-turno-item">
          <span><strong>${esc(sedeLabel(t.parrocchia))}</strong> · ${esc(t.oraInizio)}–${esc(t.oraFine)} · ${t.numeroChierichetti} chier.</span>
        </div>
      `).join('')}</div>`;
    }
    turniHtml = `
      <p class="liturgy-meta" style="margin-bottom:10px">${allSlots.length} celebrazioni${nTurni ? ` · ${assigned}/${nTurni} messe coperte (vigilia)` : ''}${vigilSlots.length ? ' · include vigilia domenicale' : ''}</p>
      ${renderMessaSlotsHtml(allSlots, { withNotes: true, messaDate: dateStr })}
      ${assignedHtml}
    `;
    sectionTitle = vigilSlots.length ? 'Messe e celebrazioni' : 'Messa straordinaria';
  }

  const actions = [];
  if (massInfo.type === 'festiva' && canManage && massInfo.extra?.uuid) {
    actions.push(`<button type="button" class="btn btn-secondary" onclick="openCorrezioneOrari(${jsStr(dateStr)})">Modifica messe</button>`);
    actions.push(`<button type="button" class="btn btn-ghost" onclick="removeMessaExtra(${jsStr(massInfo.extra.uuid)})">Togli messe quest’anno</button>`);
  }
  if (massInfo.type === 'extra' && massInfo.extra?.uuid) {
    if (canManage) {
      actions.push(`<button type="button" class="btn btn-secondary" onclick="convertExtraToFestiva(${jsStr(massInfo.extra.uuid)})">Usa orario domenicale</button>`);
    }
    actions.push(`<button type="button" class="btn btn-secondary" onclick="removeMessaExtra(${jsStr(massInfo.extra.uuid)})">Rimuovi eccezione</button>`);
  }

  container.innerHTML = `
    <span class="messa-type-badge ${badgeClass}">${badgeLabel}</span>
    <p class="day-detail-date">${esc(dateLabel)}</p>
    ${primary ? `
      <p class="today-liturgy-name" style="font-size:1rem;margin:0 0 4px">${esc(primary.nome)}</p>
      <p class="liturgy-meta">${esc(primary.tipoLabel || primary.tipo)}${primary.colore ? ' · Tempo ' + esc(primary.colore) : ''}</p>
    ` : '<p class="liturgy-meta">Nessuna solennità particolare nel calendario liturgico</p>'}
    ${notaMessaHtml}
    <h4 style="font-size:0.82rem;margin:16px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em">${esc(sectionTitle)}</h4>
    ${turniHtml}
    ${actions.length ? `<div class="messa-actions">${actions.join('')}</div>` : ''}
  `;
}

function renderFestivaPresetChips(extra) {
  if (!extra?.uuid) return '';
  const current = extra.strutturaKind || getLiturgicalContext(extra.data).strutturaKind || '';
  const order = ['domenicale', 'natalizio', 'pasquale', 'defunti', 'festivo'];
  const chips = order.map(kind => {
    const meta = getStrutturaMeta(kind);
    const active = current === kind;
    const configured = hasStrutturaConfig(kind);
    return `<button type="button" class="struttura-chip festiva-preset-chip${active ? ' active' : ''}"${!configured ? ' disabled' : ''} title="${esc(!configured ? 'Configura prima in Struttura liturgica' : (meta.hint || meta.label))}" onclick="applyStrutturaToFestivaExtra(${jsStr(extra.uuid)}, ${jsStr(kind)})">${esc(meta.shortLabel || meta.label)}</button>`;
  }).join('');
  return `
    <div class="festiva-preset-block">
      <p class="liturgy-meta" style="margin-bottom:8px">Cambia struttura applicata</p>
      <div class="festiva-preset-chips" role="group" aria-label="Struttura Messe locali">${chips}</div>
    </div>
  `;
}

function applyStrutturaToFestivaExtra(uuid, kind, opts = {}) {
  if (!requireAdminAction('Solo l\'admin può modificare gli orari')) return;
  if (!STRUTTURA_KINDS[kind] || !hasStrutturaConfig(kind)) {
    showToast('Configura prima questa struttura in Struttura liturgica');
    return;
  }
  if (!Array.isArray(state.messeExtra)) state.messeExtra = [];
  let extra = state.messeExtra.find(m => m.uuid === uuid);
  // Giorno derivato da struttura (SYN-…): crea il record locale e poi applica
  if (!extra && String(uuid || '').startsWith('SYN-')) {
    const dateStr = String(uuid).slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    if (getMessaExtraForDate(dateStr)) {
      extra = getMessaExtraForDate(dateStr);
    } else {
      extra = buildFestivaExtraRecord(dateStr, { source: 'manual' });
      state.messeExtra.push(extra);
    }
  }
  if (!extra) {
    showToast('Impossibile aggiornare questa celebrazione');
    return;
  }
  extra.strutturaKind = kind;
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  extra.orarioPersonalizzato = false;
  delete extra.inheritedFrom;
  delete extra.preset;
  // Nessuno snapshot: l’orario segue la struttura scelta
  delete extra.slots;
  // Da Correzioni: solo quest’anno — non sovrascrivere i Modelli
  if (!opts.yearOnly) {
    saveFestivitaModelloFromExtra(extra);
  }
  saveData();
  void persistConfig();
  if (!opts.quiet) showToast(`Modello «${getStrutturaMeta(kind).shortLabel || getStrutturaMeta(kind).label}» applicato`);
  if (extra.data && !opts.quiet) {
    renderMessaDetail(extra.data);
    renderMesseAgenda();
  } else if (!opts.quiet) {
    renderMesseAgenda();
  }
}

function renderFestivaOrarioActions(extra) {
  if (!extra?.uuid) return '';
  const dateStr = extra.data || '';
  const kind = extra.strutturaKind || getLiturgicalContext(dateStr).strutturaKind || 'festivo';
  const annoBit = extra.orarioPersonalizzato ? ' · sedi di quest’anno' : '';
  return `
    <div class="festiva-orario-actions">
      ${renderFestivaPresetChips(extra)}
      <p class="liturgy-meta">Struttura nei <strong>Modelli</strong>. Per quest’anno: modifica messe in <strong>Correzioni</strong> (senza messe = senza servizio)${annoBit}.</p>
      <div class="messa-actions" style="flex-wrap:wrap;gap:8px;justify-content:flex-start">
        <button type="button" class="btn btn-secondary" onclick="openCorrezioneOrari(${jsStr(dateStr)})">Modifica messe</button>
        <button type="button" class="btn btn-ghost" onclick="void showSection('strutture-messe').then(() => { setStrutturaLiturgicaTab('modelli'); setStrutturaMesseKind(${jsStr(kind)}); })">Modello</button>
      </div>
    </div>
  `;
}

function applyFestivityPresetToExtra(uuid, presetId) {
  if (!requireAdminAction('Solo l\'admin può modificare gli orari')) return;
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!extra) return;
  applyPresetToFestivaExtra(extra, presetId);
  extra.orarioPersonalizzato = true;
  saveFestivitaModelloFromExtra(extra);
  saveData();
  void persistConfig();
  const meta = getFestivityPresetMeta(extra.preset);
  showToast(`Applicato preset «${meta.label}» (vale anche per gli anni successivi)`);
  if (extra.data) renderMessaDetail(extra.data);
  renderMesseAgenda();
}

function addFestivitaFromDate(dateStr) {
  if (!requireAdminAction('Solo l\'admin può gestire le festività')) return;
  if (!hasOrarioFestivoConfig()) {
    showToast('Prima indica le celebrazioni tipiche delle feste in Struttura messe');
    goConfiguraOrarioFestivo();
    return;
  }
  if (getMessaInfo(dateStr)) {
    showToast('Questa data è già in agenda');
    return;
  }
  if (isFestivitaEsclusa(dateStr)) {
    clearFestivitaEsclusaForDate(dateStr);
  }
  const extra = buildFestivaExtraRecord(dateStr, { source: 'manual' });
  state.messeExtra.push(extra);
  saveData();
  void persistConfig();
  const meta = getFestivityPresetMeta(extra.preset);
  showToast(`Festività aggiunta · preset «${meta.label}»`);
  messeState.selectedDate = dateStr;
  renderMesseAgenda();
  renderMessaDetail(dateStr);
  openMesseSheet('detail');
}

function ripristinaEAggiungiFestivita(dateStr) {
  if (!requireAdminAction('Solo l\'admin può gestire le festività')) return;
  clearFestivitaEsclusaForDate(dateStr);
  addFestivitaFromDate(dateStr);
}

function convertExtraToFestiva(uuid) {
  if (!requireAdminAction('Solo l\'admin può gestire le festività')) return;
  if (!hasOrarioFestivoConfig()) {
    showToast('Prima indica le celebrazioni tipiche delle feste in Struttura messe');
    goConfiguraOrarioFestivo();
    return;
  }
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!extra) return;
  extra.source = 'manual';
  const modello = getFestivitaModello(getPrimaryFestivityEventKey(extra.data));
  if (modello) applyFestivitaModelloToExtra(extra, modello);
  else applyPresetToFestivaExtra(extra, detectFestivityPreset(extra.data));
  saveFestivitaModelloFromExtra(extra);
  saveData();
  void persistConfig();
  showToast('Ora usa l\'orario festivo');
  if (extra.data) renderMessaDetail(extra.data);
  renderMesseAgenda();
}

function personalizzaOrarioFestiva(uuid) {
  if (!requireAdminAction('Solo l\'admin può modificare gli orari')) return;
  let extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!extra && String(uuid || '').startsWith('SYN-')) {
    const dateStr = String(uuid).slice(4);
    extra = ensureFestivaExtraMaterialized(dateStr);
  }
  if (!extra?.data) {
    showToast('Impossibile personalizzare questa celebrazione');
    return;
  }
  openCorrezioneOrari(extra.data);
}

function ripristinaOrarioFestiva(uuid) {
  if (!requireAdminAction('Solo l\'admin può modificare gli orari')) return;
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!extra?.data) return;
  if (!confirm('Ripristinare le sedi dal modello per quest’anno?')) return;
  const eventKey = getPrimaryFestivityEventKey(extra.data);
  const modello = getFestivitaModello(eventKey);
  if (modello) applyFestivitaModelloToExtra(extra, modello);
  else applyPresetToFestivaExtra(extra, detectFestivityPreset(extra.data));
  extra.orarioPersonalizzato = false;
  saveData();
  void persistConfig();
  showToast('Ripristinato dal modello');
  if (extra.data) {
    renderMessaDetail(extra.data);
    renderMesseAgenda();
  }
}

function editFestivaSlots(uuid) {
  editFestivaSlotsInStruttura(uuid);
}

function removeFestivaSlotRow(btn) {
  const editor = btn.closest('#festiva-slots-editor') || document.getElementById('festiva-slots-editor');
  btn.closest('.festiva-slot-edit')?.remove();
  if (editor && !editor.querySelector('.festiva-slot-edit') && !editor.querySelector('.empty-state')) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Nessuna messa';
    editor.appendChild(p);
  }
}

function addFestivaSlotRow() {
  const editor = document.getElementById('festiva-slots-editor');
  if (!editor) return;
  const empty = editor.querySelector('.empty-state');
  if (empty) empty.remove();
  const civilMode = editor.dataset.mount === 'anno-civile';
  const civilDate = editor.dataset.civilDate || '';
  const hostUuid = editor.dataset.hostUuid || '';
  const wrap = document.createElement('div');
  wrap.className = 'festiva-slot-edit';
  if (civilMode) {
    wrap.dataset.sourceUuid = hostUuid;
    wrap.dataset.sourceDate = civilDate;
  }
  wrap.innerHTML = `
      <div class="form-group festiva-slot-title">
        <label>Titolo / celebrazione <span class="form-optional">(opzionale)</span></label>
        <input type="text" data-field="titolo" maxlength="80" value="" placeholder="Es. Vigilia, Lavanda dei Piedi">
      </div>
      <div class="form-row festiva-slot-grid${civilMode ? ' is-civil-mode' : ''}">
        ${civilMode ? '' : `
        <div class="form-group">
          <label>Giorno</label>
          <select data-field="dayOffset">
            <option value="-1">Vigilia (giorno prima)</option>
            <option value="0" selected>Giorno di festa</option>
          </select>
        </div>`}
        <div class="form-group">
          <label>Ora</label>
          <input type="time" data-field="ora" value="10:00">
        </div>
        <div class="form-group">
          <label>Sede</label>
          <select data-field="sede">
            ${sedeOptionsHtml('santuario')}
          </select>
        </div>
        <div class="form-group">
          <label>Tipo</label>
          <select data-field="conTurno">
            <option value="1" selected>Con squadra</option>
            <option value="0">Libera</option>
          </select>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-icon" title="Elimina" onclick="removeFestivaSlotRow(this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>`;
  editor.appendChild(wrap);
}

function saveFestivaSlotsEditor(uuid) {
  if (!requireAdminAction('Solo l\'admin può modificare gli orari')) return;
  const editor = document.getElementById('festiva-slots-editor');
  if (!editor) return;
  if (editor.dataset.mount === 'anno') {
    saveCorrezioneAnno(uuid);
    return;
  }
  const extra = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!extra) return;
  const slots = [...editor.querySelectorAll('.festiva-slot-edit')].map((row, i) => {
    const dayOffset = parseInt(row.querySelector('[data-field="dayOffset"]')?.value, 10) === -1 ? -1 : 0;
    const ora = row.querySelector('[data-field="ora"]')?.value || '10:00';
    const sede = row.querySelector('[data-field="sede"]')?.value || 'santuario';
    const conTurno = row.querySelector('[data-field="conTurno"]')?.value === '1';
    const titolo = (row.querySelector('[data-field="titolo"]')?.value || '').trim();
    const slot = {
      id: 'fest-slot-' + i + '-' + Date.now().toString(36),
      dayOffset,
      ora,
      sede,
      vigilia: dayOffset === -1,
      conTurno
    };
    if (titolo) slot.titolo = titolo;
    return slot;
  });
  if (!slots.length) {
    if (!confirm('Salvare senza celebrazioni? (es. Venerdì Santo)')) return;
    extra.slots = [];
  } else {
    extra.slots = renumberFestivaSlots(slots);
  }
  extra.tipo = 'festiva';
  extra.usaOrarioDomenicale = true;
  extra.orarioPersonalizzato = true;
  delete extra.inheritedFrom;
  saveFestivitaModelloFromExtra(extra);
  saveData();
  void persistConfig();
  void applicaStruttureAnno({ quiet: true });
  const mountedInStruttura = editor.dataset.mount === 'struttura';
  if (mountedInStruttura) {
    closeStrutturaCorrezioniEditor();
  } else if (extra.data) {
    renderMessaDetail(extra.data);
  }
  renderMesseAgenda();
}

function removeMessaExtra(uuid) {
  const removed = (state.messeExtra || []).find(m => m.uuid === uuid);
  if (!removed) return;

  // Festività: svuota le messe dell’anno (senza servizio) senza toccare il modello
  if (isExtraFestiva(removed)) {
    if (!requireAdminAction('Solo l\'admin può modificare le messe')) return;
    if (!confirm('Togliere tutte le messe per quest’anno?\n\nIl giorno resta senza servizio finché non le ripristini in Correzioni.')) return;
    removed.slots = [];
    removed.orarioPersonalizzato = true;
    removed.tipo = 'festiva';
    removed.usaOrarioDomenicale = true;
    clearFestivitaEsclusaForDate(removed.data);
    saveData();
    void persistConfig();
    showToast('Nessuna messa · senza servizio per quest’anno');
    if (messeState.selectedDate === removed.data) renderMessaDetail(removed.data);
    void renderStrutturaCorrezioniPanel();
    loadMesseAgenda();
    return;
  }

  const label = 'messa straordinaria';
  if (!confirm(`Rimuovere questa ${label} dall'agenda?`)) return;
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
  const festCheck = document.getElementById('messa-extra-orario-domenicale');
  if (festCheck) {
    festCheck.checked = isSolennitaFestivaDay(dateStr);
    toggleMessaExtraOrarioFields();
  }
  if (isSolennitaFestivaDay(dateStr)) {
    const events = calState.data?.byDate?.[dateStr] || [];
    const primary = primaryEvent(events) || events[0];
    const nota = document.getElementById('messa-extra-nota');
    if (nota && primary?.nome) nota.value = primary.nome;
  }
  openMesseSheet('add');
  document.getElementById('messa-extra-nota')?.focus();
}

function toggleMessaExtraOrarioFields() {
  const on = !!document.getElementById('messa-extra-orario-domenicale')?.checked;
  document.querySelectorAll('.messa-extra-single-slot').forEach(el => {
    el.hidden = on;
    el.querySelectorAll('input,select').forEach(inp => {
      if (on) inp.removeAttribute('required');
      else if (inp.id === 'messa-extra-ora' || inp.id === 'messa-extra-sede') inp.required = true;
    });
  });
}

async function syncFestivitaAnnoManual() {
  syncStrutturaAnnoSelects(getStrutturaPastoralStartForDate());
  void showSection('strutture-messe').then(() => {
    setStrutturaLiturgicaTab('applica');
    void applicaStruttureAnno();
  });
}

function updateMesseFestivoBanner(needsConfig) {
  const el = document.getElementById('messe-festivo-banner');
  if (!el) return;
  const show = !!(isCurrentUserAdmin() && (needsConfig || !hasOrarioFestivoConfig()));
  el.hidden = !show;
}

function goConfiguraOrarioFestivo() {
  void showSection('strutture-messe').then(() => {
    setStrutturaLiturgicaTab('modelli');
    setStrutturaMesseKind('festivo');
  });
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

async function resendCerimoniereInvite(uuid) {
  const c = cerimonieriAccounts.find(x => x.uuid === uuid);
  if (!c?.email || !isSupabase) return;
  if (!isCurrentUserAdmin()) {
    showToast('Solo l\'admin può reinviare inviti o link password', 'error');
    return;
  }
  let result = c.inviteAccepted !== true
    ? await window.ChierichSupabase.ricreaInvitoAccesso(c.email)
    : await window.ChierichSupabase.reinviaInvito(c.email);
  // Dopo il primo click l'utente esiste già in Auth: Supabase non consente
  // un secondo inviteUserByEmail, quindi inviamo un link di recupero che
  // viene comunque presentato come «Attiva account» finché invite_accepted è false.
  showToast(result.message || (result.success ? 'Email inviata' : 'Invio non riuscito'), result.success ? 'success' : 'error');
}

// Nel calendario ambrosiano il periodo dopo Pentecoste in preparazione/
// memoria del Martirio di San Giovanni Battista è rosso. Alcune risposte
// LitCal riportano invece il colore del tempo romano (verde); per questi
// eventi prevale quindi la classificazione ambrosiana di GCatholic.
function mapAmbrosianEventColor(raw, eventKey, nome) {
  const key = String(eventKey || '');
  const title = String(nome || '');
  if (/^AfterPentecostMartyrdom/i.test(key)
    || /\b(?:dopo|precede)\s+il\s+Martirio\b/i.test(title)) {
    return 'rosso';
  }
  return mapLitCalColor(raw);
}

function unfoldIcs(text) {
  return String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function parseGcatholicIcsColors(text) {
  const colors = {};
  let date = '';
  let raw = '';
  let inEvent = false;
  for (const line of unfoldIcs(text)) {
    if (line === 'BEGIN:VEVENT') { inEvent = true; date = ''; raw = ''; continue; }
    if (line === 'END:VEVENT') {
      if (date) {
        const color = mapLitCalColor(raw);
        if (color) colors[date] = color;
      }
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    if (/^DTSTART(?:;[^:]*)?:(\d{8})/.test(line)) {
      const m = line.match(/^DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})/);
      if (m) date = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (/^(?:SUMMARY|DESCRIPTION|CATEGORIES|COLOR|X-.*COLOR)/i.test(line)) raw += ` ${line}`;
  }
  return colors;
}

async function fetchGcatholicIcsColors(anno) {
  const url = `https://gcatholic.org/calendar/ics/${encodeURIComponent(anno)}-it-Ambrosian.ics?v=3`;
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('iCal GCatholic non disponibile (HTTP ' + res.status + ')');
  return parseGcatholicIcsColors(await res.text());
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

  s = s.replace(/(?:\s*[—–-]\s*)?\bMessa della vigilia\b/i, ' — Messa della vigilia');
  s = s.replace(/\s*[—–-]\s*[—–-]+/g, ' — ');
  return s;
}

function normalizeCalendarioPack(data) {
  if (!data?.byDate) return data;
  const fix = (ev) => {
    if (!ev || typeof ev !== 'object') return ev;
    const eventKey = ev.eventKey || ev.event_key;
    const nome = formatLiturgicalNome(ev.nome, eventKey);
    const colore = mapAmbrosianEventColor(ev.colore, eventKey, nome);
    return nome === ev.nome && colore === ev.colore ? ev : { ...ev, nome, colore };
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
    colore: mapAmbrosianEventColor(colorRaw, eventKey, ev.name),
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
  let gcatholicColors = {};
  try { gcatholicColors = await fetchGcatholicIcsColors(y); } catch (err) {
    console.warn('[ChierichApp] iCal GCatholic non disponibile, uso LitCal', err);
  }
  const byDate = {};
  const events = [];
  rows.forEach(ev => {
    const dateStr = String(ev.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    const mapped = mapLitCalEvent(ev, dateStr, y);
    if (!mapped.nome) return;
    if (gcatholicColors[dateStr]) mapped.colore = gcatholicColors[dateStr];
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
  const nextAnno = String(Number(anno) + 1);
  const container = document.getElementById('calendario-container');
  if (calState.loading) return;

  calState.loading = true;
  container.innerHTML = '<div class="cal-loading">Caricamento calendario liturgico…</div>';

  try {
    const packs = await Promise.all([
      loadCalendarioPackYear(anno, { refresh: !!refresh }),
      loadCalendarioPackYear(nextAnno, { refresh: !!refresh })
    ]);
    let data = mergeCalendarioPacks(packs, anno);

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
    clearLiturgicalSeasonCache();
    invalidateLiturgyCaches();
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
  const rank = { solennita: 0, festa: 1, memoria: 2 };
  let best = null;
  let bestRank = 99;
  for (const e of events) {
    const r = rank[e.tipo];
    if (r == null) continue;
    if (r < bestRank) {
      best = e;
      bestRank = r;
    }
  }
  return best || events[0];
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
  syncEscludiFerialiIntrasettimanaliUi();

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
    const primary = getLiturgicalDayEvent(dateStr);
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
  const sourceEvents = calState.data?.byDate?.[dateStr] || [];
  const sourcePrimary = primaryEvent(sourceEvents) || sourceEvents[0];
  const primary = getLiturgicalDayEvent(dateStr);
  const events = getLiturgicalDayOverride(dateStr) && primary
    ? [primary, ...sourceEvents.filter(event => event !== sourcePrimary)]
    : sourceEvents;
  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const massInfo = getMessaInfo(dateStr);
  const massBtn = massInfo
    ? `<button type="button" class="btn btn-secondary" style="margin-top:16px" onclick="showMassDetails('${dateStr}')">Vedi in agenda messe</button>`
    : '';
  const adminEditor = renderLiturgicalDayAdmin(dateStr, primary);

  if (!events.length) {
    container.innerHTML = `<p class="day-detail-date">${esc(dateLabel)}</p><p class="day-detail-empty empty-state-inline">Nessuna celebrazione registrata per questa data.</p>${massBtn}${adminEditor}`;
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
    ${adminEditor}
  `;
}

function renderLiturgicalDayAdmin(dateStr, primary) {
  if (!isCurrentUserAdmin()) return '';
  const override = getLiturgicalDayOverride(dateStr) || {};
  const kindOptions = Object.values(STRUTTURA_KINDS).map(meta =>
    `<option value="${meta.id}" ${(override.strutturaKind || getLiturgicalContext(dateStr).strutturaKind) === meta.id ? 'selected' : ''}>${esc(meta.label)}</option>`
  ).join('');
  const type = override.tipo || (primary?.grado === 'm' ? 'memoria-facoltativa' : primary?.tipo) || 'feriale';
  const assignedKey = findEventKeyForDateOverride(dateStr) || '';
  const festivityOptions = Object.entries(FESTIVITA_DEFAULT_MD).map(([key, md]) => {
    const group = Object.values(STRUTTURA_GIORNI_SPECIALI).flat().find(g => g.eventKey === key);
    const label = group?.label || key;
    return `<option value="${esc(key)}" ${assignedKey === key ? 'selected' : ''}>${esc(label)} (default ${esc(md)})</option>`;
  }).join('');
  return `<div class="liturgical-day-admin">
    <h4>Configurazione del giorno</h4>
    <div class="form-group"><label for="liturgical-day-name">Giorno liturgico</label><input id="liturgical-day-name" type="text" value="${esc(override.nome || primary?.nome || '')}" placeholder="Es. Domenica delle Palme" maxlength="160"></div>
    <div class="form-row">
      <div class="form-group"><label for="liturgical-day-type">Tipo</label><select id="liturgical-day-type">
        <option value="solennita" ${type === 'solennita' ? 'selected' : ''}>Solennità</option><option value="festa" ${type === 'festa' ? 'selected' : ''}>Festa</option><option value="memoria" ${type === 'memoria' ? 'selected' : ''}>Memoria</option><option value="memoria-facoltativa" ${type === 'memoria-facoltativa' ? 'selected' : ''}>Memoria facoltativa</option><option value="feriale" ${type === 'feriale' ? 'selected' : ''}>Feriale</option>
      </select></div>
      <div class="form-group"><label for="liturgical-day-structure">Struttura Messa</label><select id="liturgical-day-structure" required>${kindOptions}</select></div>
    </div>
    <div class="form-group">
      <label for="liturgical-day-festivity">Modello festa su questa data</label>
      <select id="liturgical-day-festivity">
        <option value="">— non assegnato —</option>
        ${festivityOptions}
      </select>
      <p class="form-hint">Sposta qui Tutti i Santi, Defunti, Natale… per quest’anno (indipendente da LitCal).</p>
    </div>
    <div class="form-actions"><button type="button" class="btn btn-primary" onclick="saveLiturgicalDay('${dateStr}')">Salva giorno</button><button type="button" class="btn btn-secondary" onclick="openCorrezioneOrari('${dateStr}')">Modifica messe</button>${override.nome || override.strutturaKind || assignedKey ? `<button type="button" class="btn btn-ghost" onclick="clearLiturgicalDay('${dateStr}')">Ripristina fonte</button>` : ''}</div>
  </div>`;
}

async function saveLiturgicalDay(dateStr) {
  if (!requireAdminAction('Solo l’admin può modificare il calendario liturgico')) return;
  const nome = document.getElementById('liturgical-day-name')?.value.trim();
  const tipo = document.getElementById('liturgical-day-type')?.value;
  const strutturaKind = document.getElementById('liturgical-day-structure')?.value;
  const festivityKey = document.getElementById('liturgical-day-festivity')?.value || '';
  if (!nome || !STRUTTURA_KINDS[strutturaKind] || !['solennita', 'festa', 'memoria', 'memoria-facoltativa', 'feriale'].includes(tipo)) {
    showToast('Indica giorno liturgico, tipo e struttura');
    return;
  }
  ensureGruppiConfig();
  state.gruppiConfig.giorniLiturgici[dateStr] = { nome, tipo, strutturaKind, updatedAt: new Date().toISOString() };

  const anno = dateStr.slice(0, 4);
  // Rimuovi eventuali override che puntavano a questa data, poi assegna il nuovo
  Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
    const map = getFestivitaDateOverridesMap();
    if (map[key]?.[anno] === dateStr && key !== festivityKey) {
      clearFestivitaDateForAnno(key, anno);
    }
  });
  if (festivityKey && FESTIVITA_DEFAULT_MD[festivityKey]) {
    setFestivitaDateForAnno(festivityKey, dateStr);
  } else if (!festivityKey) {
    Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
      if (getFestivitaDateOverridesMap()[key]?.[anno] === dateStr) {
        clearFestivitaDateForAnno(key, anno);
      }
    });
  }

  saveDataLocal();
  const saved = await persistConfig();
  if (!saved) localStorage.setItem(LITURGICAL_CONFIG_PENDING_KEY, '1');
  clearLiturgicalSeasonCache();
  try {
    const sync = syncFestivitaAnno(getPastoralStartForDateStr(dateStr));
    if (sync.added || sync.updated || sync.removed) saveData();
  } catch (_) { /* ignore */ }
  renderCalMonth();
  renderDayDetail(dateStr);
  renderMesseAgenda();
  void renderStrutturaCorrezioniPanel();
  showToast(saved ? 'Giorno liturgico aggiornato' : 'Modifica salvata sul dispositivo; sincronizzazione in attesa');
}

async function clearLiturgicalDay(dateStr) {
  if (!requireAdminAction('Solo l’admin può modificare il calendario liturgico')) return;
  ensureGruppiConfig();
  delete state.gruppiConfig.giorniLiturgici[dateStr];
  const anno = dateStr.slice(0, 4);
  Object.keys(FESTIVITA_DEFAULT_MD).forEach(key => {
    if (getFestivitaDateOverridesMap()[key]?.[anno] === dateStr) {
      clearFestivitaDateForAnno(key, anno);
    }
  });
  saveDataLocal();
  const saved = await persistConfig();
  if (!saved) localStorage.setItem(LITURGICAL_CONFIG_PENDING_KEY, '1');
  clearLiturgicalSeasonCache();
  renderCalMonth();
  renderDayDetail(dateStr);
  renderMesseAgenda();
  void renderStrutturaCorrezioniPanel();
  showToast(saved ? 'Giorno ripristinato alla fonte liturgica' : 'Ripristino salvato sul dispositivo; sincronizzazione in attesa');
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
document.getElementById('messaExtraForm').addEventListener('submit', async e => {
  e.preventDefault();

  const data = document.getElementById('messa-extra-data').value;
  const nota = document.getElementById('messa-extra-nota').value.trim();
  const usaOrarioDomenicale = !!document.getElementById('messa-extra-orario-domenicale')?.checked;
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

  if (usaOrarioDomenicale && !hasOrarioFestivoConfig()) {
    showToast('Prima configura l\'orario festivo in Struttura liturgica');
    goConfiguraOrarioFestivo();
    return;
  }

  if (isSundayDate(data)) {
    showToast('Le domeniche sono già in agenda con l\'orario settimanale');
    return;
  }

  const restoredServizio = isFestivitaEsclusa(data) && clearFestivitaEsclusaForDate(data);

  const entry = {
    uuid: newMessaExtraUuid(usaOrarioDomenicale ? 'MES-FEST' : 'MES'),
    data,
    nota: nota || (usaOrarioDomenicale ? 'Festività' : ''),
    tipo: usaOrarioDomenicale ? 'festiva' : 'straordinaria',
    usaOrarioDomenicale,
    source: 'manual',
    createdAt: new Date().toISOString()
  };
  if (!usaOrarioDomenicale) {
    entry.ora = ora;
    entry.sede = sede;
  }
  state.messeExtra.push(entry);

  saveDataLocal();
  // Se abbiamo tolto «senza servizio», persistConfig salva anche festivitaEscluse
  const saved = restoredServizio ? await persistConfig() : await persistMesseExtra();
  if (!saved && navigator.onLine !== false && apiOnline) {
    state.messeExtra = state.messeExtra.filter(item => item.uuid !== entry.uuid);
    if (restoredServizio) {
      // best-effort: non ripristiniamo l’esclusione; l’utente può ri-escludere
    }
    saveDataLocal();
    return;
  }
  if (!saved) {
    localStorage.setItem(MESSE_EXTRA_PENDING_KEY, '1');
    if (restoredServizio) localStorage.setItem(LITURGICAL_CONFIG_PENDING_KEY, '1');
  }
  showToast(!saved
    ? 'Messa salvata sul dispositivo; verrà sincronizzata al ritorno della rete'
    : (usaOrarioDomenicale
      ? (restoredServizio ? 'Festività aggiunta · di nuovo in servizio' : 'Festività aggiunta')
      : (restoredServizio ? 'Messa straordinaria aggiunta · giorno di nuovo in servizio' : 'Messa straordinaria aggiunta')));
  e.target.reset();
  toggleMessaExtraOrarioFields();
  closeMesseExtraPanel();
  closeMesseSheet();
  document.getElementById('anno-messe').value = data.slice(0, 4);
  messeState.selectedDate = data;
  void renderStrutturaCorrezioniPanel();
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

  const isDom = strutturaMesseKind === 'domenicale';
  const list = getStrutturaMesseMutable();
  const editId = document.getElementById('messa-domenicale-edit-id').value;
  const titolo = (document.getElementById('messa-domenicale-titolo')?.value || '').trim();
  const dayOffset = parseInt(document.getElementById('messa-domenicale-day').value, 10);
  const ora = document.getElementById('messa-domenicale-ora').value;
  const sede = document.getElementById('messa-domenicale-sede').value;
  const vigilia = document.getElementById('messa-domenicale-vigilia').checked;
  const conTurno = document.getElementById('messa-domenicale-con-turno').checked;

  const duplicate = getStrutturaMesseList().find(m =>
    m.id !== editId && m.dayOffset === dayOffset && m.ora === ora && m.sede === sede
  );
  if (duplicate) {
    showToast('Esiste già una celebrazione con stesso giorno, ora e sede');
    return;
  }

  if (editId) {
    const m = list.find(x => x.id === editId);
    if (!m) return;
    if (isDom) {
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
    }
    m.dayOffset = dayOffset;
    m.ora = ora;
    m.sede = sede;
    m.vigilia = vigilia || (dayOffset === -1 && conTurno);
    m.conTurno = conTurno;
    if (titolo) m.titolo = titolo;
    else delete m.titolo;
    cancelMessaDomenicaleEdit({ keepModal: true });
    closeStrutturaModelloModal();
    afterGruppiConfigChange();
    updateMesseFestivoBanner(!hasOrarioFestivoConfig());
    showToast('Celebrazione aggiornata');
  } else {
    const row = {
      id: 'st-' + strutturaMesseKind.slice(0, 3) + '-' + Date.now(),
      dayOffset,
      ora,
      sede,
      vigilia: vigilia || (dayOffset === -1 && conTurno),
      conTurno
    };
    if (titolo) row.titolo = titolo;
    list.push(row);
    cancelMessaDomenicaleEdit({ keepModal: true });
    closeStrutturaModelloModal();
    afterGruppiConfigChange();
    updateMesseFestivoBanner(!hasOrarioFestivoConfig());
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
  const lower = msg.toLowerCase();
  if (/password di almeno \d+ caratteri|nessuna modifica|nessuna nuova|già |gia /i.test(lower)) {
    return 'warning';
  }
  if (/errore|fallit|failed|failure|non riuscit|request.*status|non valid|invalid|non puoi|cannot|scadut|expired|obbligator|required|coincid|esiste già|already|serve almeno|seleziona |select |inserisci |enter |conferma |confirm |non disponibile|unavailable|spazio esaurit|quota|riloggia|session.*missing|unauthori[sz]ed|access denied/i.test(lower)) {
    return 'error';
  }
  if (/email .*inviat|link .*inviat|invito .*inviat|controlla .*email|account .*attivat|password aggiornat|salvataggio completat/i.test(lower)) {
    return 'info';
  }
  return 'success';
}

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const kind = type === 'error' || type === 'success' || type === 'info' || type === 'warning'
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
    : kind === 'info' || kind === 'warning'
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
