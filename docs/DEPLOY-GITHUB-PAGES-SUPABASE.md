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
5. Copia `.env.example` → `.env` **solo in locale** (gitignored) con URL + anon key
6. In produzione: solo secret Actions (niente file di config nel repo)
7. Se il progetto esisteva già: esegui anche `supabase/migrations/003_cerimonieri_ruolo_prete.sql` (account Don)

### Bootstrap primo admin

1. Apri l'app
2. Se non ci sono cerimonieri, crea account (nome + email + password)
3. Quel record diventa `is_admin = true`
4. Per altri utenti: Anagrafica → Cerimonieri (aggiungi email), poi loro si registrano / accedono con la **stessa email** su Auth

Nota: con Confirm email attivo, dopo il signup occorre confermare la mail prima del login.

## Deploy GitHub Pages

1. Repo → **Settings → Pages**
2. **Source: GitHub Actions** (non “Deploy from a branch”)
3. Secrets del repository (Settings → Secrets and variables → Actions):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
4. Push su `main` (o **Actions → Deploy GitHub Pages → Run workflow**)

Nessun `config.js` nel repo né come file pubblico. Al deploy i secret vengono iniettati inline in `index.html` solo nell’artifact (`scripts/inject-config.mjs`).

Se Pages resta su “Deploy from a branch”, il sito non riceve i secret e il login fallisce.

Verifica: apri il sito → DevTools → non deve esserci richiesta a `/config.js`.

URL: `https://chierichapp.github.io/`

Nota: la chiave **anon** finisce comunque nel browser (così funziona Supabase client-side). La protezione reale è RLS. Non committare mai la **service_role**.

## Sviluppo locale

```bash
cp .env.example .env   # poi compila SUPABASE_URL e SUPABASE_ANON_KEY
npm run dev            # http://localhost:4173/
```

La config viene letta da `.env` e iniettata al volo: non serve (e non si usa) `config.js`.

## Limiti rispetto a GAS / Docker

- Il calendario liturgico va in tabella `calendario_cache` (o resta vuoto finché non lo popoliamo)
- Nessun backend Node in produzione: auth/autorizzazione su Auth + RLS
- La chiave anon è pubblica by design: la sicurezza sta nelle policy RLS

## Migrazione dati da CSV / Sheets

Esporta CSV e importa da Supabase Table Editor, oppure uno script one-shot che legge `mock/*.csv` e fa upsert.
