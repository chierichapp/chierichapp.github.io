---
name: Gap funzionali app
overview: "Chiudere i 5 buchi prioritari emersi dal test locale: reset password completo, feedback conferma email, permessi admin su anagrafica/gruppi, fix etichetta Appello e empty/error state calendario."
todos:
  - id: forgot-password
    content: API + UI forgot/recovery password su auth-gate
    status: completed
  - id: email-confirm-feedback
    content: Hint persistente needsEmailConfirm sul profilo
    status: completed
  - id: admin-rls-ui
    content: Migration RLS admin-write + gate UI chierichetti/gruppi
    status: completed
  - id: appello-gruppo-label
    content: Fix prefisso Gruppo in updateAppelloSummary + CTA empty
    status: completed
  - id: calendario-empty
    content: Empty/error state espliciti se cache/fetch fallisce
    status: completed
isProject: false
---

# Piano: gap funzionali ChierichApp

Scope: i 5 punti prioritari dal test su `localhost:4173`. Default permessi: **solo admin** scrive `chierichetti` e `app_config` (gruppi); **tutti gli utenti app** restano su turni/presenze/appello. Allineato a `cerimonieri_admin_write` già in [`supabase/migrations/001_init.sql`](supabase/migrations/001_init.sql).

## 1. Password dimenticata (login + recovery)

**API** — [`js/supabase-api.js`](js/supabase-api.js):
- `resetPasswordForEmail(email)` → `sb.auth.resetPasswordForEmail` con `redirectTo` = origin+pathname
- `updatePassword(password)` → `sb.auth.updateUser({ password })`
- In bootstrap/`checkAuthAndInit`: rilevare sessione recovery (`onAuthStateChange` `PASSWORD_RECOVERY` o hash/query già gestiti da `detectSessionInUrl`) e esporre flag `isPasswordRecovery`

**UI** — [`index.html`](index.html) `#auth-gate`:
- Link “Password dimenticata?” sotto la password (solo Supabase + `authMode === 'login'`)
- Nuovo `authMode: 'forgot'`: solo email + “Invia link”; successo via `.auth-hint` (non `.auth-error`)
- Nuovo `authMode: 'recovery'`: due campi password + “Salva nuova password”; poi login/shell normale
- Wiring in `setAuthMode` / `handleAuthSubmit` / `prepareSupabaseAuthUi`

Template recovery già presente in [`supabase/templates/recovery.html`](supabase/templates/recovery.html).

## 2. Feedback cambio email profilo

In `handleCerimoniereFormSubmit` quando `result.needsEmailConfirm`:
- Mostrare messaggio persistente su `#cerimoniere-profile-hint` (o banner dedicato nel form profilo), non solo toast 3.2s
- Tenere toast breve; hint resta finché non si chiude/riapre il form
- Copia: conferma link sulla **nuova** email; login resta con la vecchia finché non conferma

API già restituisce `needsEmailConfirm` + `message` in `aggiornaIlMioProfilo`.

## 3. Permessi CRUD chierichetti + gruppi

**Migration nuova** `supabase/migrations/005_admin_write_chierichetti_config.sql`:
- Drop `chierichetti_write` / `config_write` basate su `is_app_user()`
- Recreate: SELECT `is_app_user()`; INSERT/UPDATE/DELETE `is_app_admin()`

**UI** [`index.html`](index.html):
- `persistPersona` / `persistDeletePersona` / form e azioni in `renderChierichetti`: gate con `isCurrentUserAdmin()`
- Gestione gruppi (`persistConfig`, form crea/modifica, assign drag se presente): stessa gate; vetrina/cronologia restano in lettura per tutti
- Messaggio chiaro se non-admin prova a modificare (“Solo l’admin può…”)

Turni/presenze/appello invariati.

## 4. Fix “Gruppo Gruppo” + empty state gruppi

In `updateAppelloSummary` (~9541): non prefissare `Gruppo ` se la label già contiene “gruppo” (anche `gruppo1` / spazi strani); normalizzare con test più robusto (es. `/gruppo/i` all’inizio o id legacy).

Empty state già presenti; rafforzare CTA verso Gestione gruppi solo se admin (coerente col punto 3). Nessun nuovo seed SQL: demo gruppi già in `001_init.sql`.

## 5. Messaggi calendario/cache vuota

Dove oggi si cade in fallback silenzioso (“Domenica” / titoli generici):
- Se dopo `ensureCalendarioForYear` / `loadCalendario` `byDate` è ancora vuoto o fetch fallisce: empty-state esplicito in Oggi / Liturgia (es. “Calendario liturgico non disponibile — riprova da Liturgia”) con CTA refresh se già esiste
- Non inventare nuove fonti dati; riusare `fetchAmbrosianCalendarYear` esistente

## File toccati

- [`js/supabase-api.js`](js/supabase-api.js) — reset/update password + recovery flag
- [`index.html`](index.html) — auth modes, profilo hint, gate CRUD, Appello label, empty calendario
- [`supabase/migrations/005_admin_write_chierichetti_config.sql`](supabase/migrations/005_admin_write_chierichetti_config.sql) — RLS

Applicare la migration sul progetto Supabase locale/develop dopo il merge (come fatto per `004`).

## Fuori scope

- Seed chierichetti demo, PWA offline, cleanup XSS row in DB, flusso invito dedicato.