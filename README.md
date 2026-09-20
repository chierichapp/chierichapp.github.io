# ChierichApp — GitHub Pages + Supabase

Sito statico: [chierichapp.github.io](https://chierichapp.github.io)

Stack: frontend statico + Supabase Auth/Postgres (RLS).  
Sorgente sviluppo: repo `chierich-app` (branch `feat/github-pages-supabase`).

## Setup rapido

1. Supabase → SQL Editor: esegui `supabase/migrations/001_init.sql` poi `002_fix_bootstrap.sql`
2. Copia `config.example.js` → `config.js` e inserisci URL + anon key (locale)
3. Secret GitHub (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) per il deploy Actions
4. Repo → Settings → Pages → Source: **GitHub Actions**

Guida completa: [`docs/DEPLOY-GITHUB-PAGES-SUPABASE.md`](docs/DEPLOY-GITHUB-PAGES-SUPABASE.md)

## Locale

```bash
npx --yes serve -l 4173 .
# http://localhost:4173/
```
