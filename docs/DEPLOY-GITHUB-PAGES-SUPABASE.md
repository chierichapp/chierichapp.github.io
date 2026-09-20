# ChierichApp — GitHub Pages + Supabase

Sito di produzione previsto: **https://chierichapp.github.io** (repo dedicato).

## Perché funziona

| Pezzo | Ruolo |
|-------|--------|
| **GitHub Pages** | Hosting statico (`index.html` = app) + JS (nessun server Node) |
| **Supabase Auth** | Login email/password dei cerimonieri |
| **Supabase Postgres** | Anagrafica, turni, presenze, config |
| **RLS** | Solo utenti in tabella `cerimonieri` (attivi) leggono/scrivono |

Non serve Google Apps Script né Docker. Il browser parla direttamente con Supabase (chiave **anon** + Row Level Security).

## Setup Supabase (una volta)

1. Crea un progetto su [supabase.com](https://supabase.com)
2. **Authentication → Providers → Email**: abilita Email (disattiva "Confirm email" in sviluppo se vuoi bootstrap immediato)
3. **SQL Editor**: esegui in ordine:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_fix_bootstrap.sql` (se hai già applicato solo la 001)
4. **Project Settings → API**: copia URL e `anon` key
5. Copia `config.example.js` → `config.js` e inserisci URL + anon key

### Bootstrap primo admin

1. Apri l'app
2. Se non ci sono cerimonieri, crea account (nome + email + password)
3. Quel record diventa `is_admin = true`
4. Per altri utenti: Anagrafica → Cerimonieri (aggiungi email), poi loro si registrano / accedono con la **stessa email** su Auth

Nota: con Confirm email attivo, dopo il signup occorre confermare la mail prima del login.

## Deploy GitHub Pages

1. Repo → **Settings → Pages**
2. Source: **GitHub Actions**
3. Push su questo branch (o `main` dopo il merge): il workflow `.github/workflows/deploy-pages.yml` pubblica il sito
4. Secrets del repository (Settings → Secrets and variables → Actions):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

Il workflow genera `config.js` dai secret al momento del deploy (non resta nel repo).

URL tipico: `https://<user>.github.io/<repo>/`

## Sviluppo locale

```bash
# Servi la cartella statica (qualsiasi static server)
npx --yes serve -l 4173 .
# Apri http://localhost:4173/
```

Su questo branch `index.html` è l’entry point (stesso contenuto di `webapp.html`).

Serve un `config.js` locale (non committato).

## Limiti rispetto a GAS / Docker

- Il calendario liturgico va in tabella `calendario_cache` (o resta vuoto finché non lo popoliamo)
- Nessun backend Node: tutta la logica di auth/autorizzazione è su Auth + RLS
- La chiave anon è pubblica by design: la sicurezza sta nelle policy RLS

## Migrazione dati da CSV / Sheets

Esporta CSV e importa da Supabase Table Editor, oppure uno script one-shot che legge `mock/*.csv` e fa upsert.
