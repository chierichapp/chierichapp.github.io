---
name: Mobile UX Appello
overview: Passata mobile concreta, centrata su Appello in chiesa (persistenza, chrome, sticky context) più tablet nav e touch target minimi — senza redesign completo dell’app.
todos:
  - id: appello-autosave
    content: Auto-save debounced Appello + dirty guard + stati barra
    status: completed
  - id: appello-chrome
    content: Sticky header Appello, hide tabbar, stats cer, compact
    status: completed
  - id: tablet-shell
    content: Mobile shell + menu-toggle fino a 1024px
    status: completed
  - id: touch-anag
    content: Touch 44px + Anagrafica lista-first mobile
    status: completed
isProject: false
---

# Piano: UX/UI mobile (focus Appello)

Default: migliorare l’uso **sul telefono durante la messa**, non un restyle globale. File unico: [`index.html`](index.html) (CSS + JS). Nessuna nuova dipendenza.

## 1. Appello: non perdere i segni

Oggi i check sono draft fino a «Salva appello», senza guard se si cambia sezione/messa.

- Debounce **auto-save** (~800ms) dopo ogni `setDraftPresente`, riusando `saveAppello` esistente
- Se auto-save fallisce: banner/toast «Non salvato» + resta dirty
- `beforeunload` / blocco `showSection` se dirty e save in corso
- Barra salva: stato «Salvato» / «Salvataggio…» / «Riprova» (il tap manuale resta come fallback)

## 2. Appello: più lista, meno chrome

- Rendere sticky `.appello-shell-head` + picker messe sotto la topbar (`top` = altezza topbar, `z-index` sotto tabbar)
- Su `#presenze` mobile: **nascondere la bottom tab bar** mentre si fa appello (recupero ~64px); swipe/back o tap topbar «Altro» per uscire non cambia — l’utente torna da topbar/sidebar se serve, oppure mostrare solo un’icona «Menu» minimale nella topbar
- Compattare header (padding/stats densità); **ripristinare** `.appello-stats-cer` su mobile (oggi `display: none`)

Scelta UI: tab bar nascosta solo su Appello attivo ≤768px; altre sezioni invariate.

## 3. Tablet 769–1024

Oggi né drawer né hamburger.

- Estendere il blocco mobile shell (sidebar off-canvas + `.mobile-tabbar` + padding main) fino a **1024px**
- Mostrare `.menu-toggle` in topbar in quel range (apre `openSidebar`)

## 4. Touch e Anagrafica leggera

- `.section-tab`, `.anag-status-tab`, `.auth-forgot-link`: `min-height: 44px`
- Anagrafica mobile: **lista prima**, form in pannello collassabile / link «Nuovo / Modifica» che scrolla al form (niente modal nuovo se evitabile) — invertire ordine DOM con `flex-direction: column-reverse` sul `.split-grid` ≤768 oppure CSS `order`

## Fuori scope (questa passata)

- Sostituire tutti i `confirm`/`prompt` con modal
- Redesign Gruppi/Liturgia/Turni oltre al breakpoint tablet
- PWA offline

## Verifica

Ricaricare `localhost:4173` a ~390px e ~900px: Appello sticky + auto-save, tab bar assente in Appello, hamburger/tab bar a 900px, Anagrafica lista-first.