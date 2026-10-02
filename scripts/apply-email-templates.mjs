/**
 * Applica template email Auth + Site URL produzione su Supabase (progetto hosted).
 *
 * Uso:
 *   set SUPABASE_ACCESS_TOKEN=sbp_...
 *   node scripts/apply-email-templates.mjs
 *
 * Token: https://supabase.com/dashboard/account/tokens
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'zxqpxhqkksfkatiwvvbh';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Manca SUPABASE_ACCESS_TOKEN. Crealo da https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => readFileSync(join(root, 'supabase', 'templates', name), 'utf8');
const SITE = 'https://chierichapp.github.io';

const body = {
  site_url: SITE,
  uri_allow_list: `${SITE},${SITE}/,${SITE}/**,http://localhost:4173,http://localhost:4173/**`,
  mailer_subjects_confirmation: 'Conferma email — ChierichApp',
  mailer_templates_confirmation_content: load('confirmation.html'),
  mailer_subjects_recovery: 'Reimposta password — ChierichApp',
  mailer_templates_recovery_content: load('recovery.html'),
  mailer_subjects_invite: 'Invito a ChierichApp',
  mailer_templates_invite_content: load('invite.html'),
};

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error('Errore', res.status, text);
  process.exit(1);
}

console.log('OK: Site URL →', SITE);
console.log('OK: template email (confirm / recovery / invite) con link diretti a github.io');
