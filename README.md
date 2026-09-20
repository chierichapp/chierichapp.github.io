# ChierichApp — GitHub Pages + Supabase

Sito: [chierichapp.github.io](https://chierichapp.github.io)

Stack: frontend statico + Supabase Auth/Postgres (RLS).

## Setup rapido

1. Supabase → SQL Editor: `supabase/migrations/001_init.sql` poi `002_fix_bootstrap.sql`
2. Copia `.env.example` → `.env` e inserisci URL + anon key (**solo locale**, gitignored)
3. Secret GitHub: `SUPABASE_URL`, `SUPABASE_ANON_KEY`
4. Settings → Pages → Source: **GitHub Actions**

Guida: [`docs/DEPLOY-GITHUB-PAGES-SUPABASE.md`](docs/DEPLOY-GITHUB-PAGES-SUPABASE.md)

## Locale

```bash
npm run dev
# http://localhost:4173/
```

Niente `config.js`: la config arriva da `.env` e viene iniettata dal server di sviluppo.
