/**
 * Inject CHIERICH_CONFIG into HTML from env vars.
 * Shared by local dev server and GitHub Actions deploy.
 */
import fs from 'node:fs';

export const CONFIG_MARKER = '<!--CHIERICH_CONFIG_INJECT-->';

export function readEnvConfig(env = process.env) {
  const supabaseUrl = String(env.SUPABASE_URL || '').trim();
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Mancano SUPABASE_URL / SUPABASE_ANON_KEY. Copia .env.example → .env (locale) oppure imposta i secret Actions (produzione).'
    );
  }
  if (supabaseUrl.includes('YOUR_PROJECT')) {
    throw new Error('SUPABASE_URL non configurato (ancora placeholder).');
  }
  return { supabaseUrl, supabaseAnonKey };
}

export function injectConfigHtml(html, cfg) {
  if (!html.includes(CONFIG_MARKER)) {
    throw new Error(`Marker ${CONFIG_MARKER} non trovato in HTML`);
  }
  const inline =
    '<script>window.CHIERICH_CONFIG=' +
    JSON.stringify({
      supabaseUrl: cfg.supabaseUrl,
      supabaseAnonKey: cfg.supabaseAnonKey
    }) +
    ';</script>';
  return html.replace(CONFIG_MARKER, inline);
}

export function injectConfigFile(filePath, cfg) {
  const html = fs.readFileSync(filePath, 'utf8');
  const out = injectConfigHtml(html, cfg);
  fs.writeFileSync(filePath, out);
  return out;
}

/** CLI: node scripts/inject-config.mjs <path-to-html> */
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/inject-config.mjs');
if (isMain) {
  const target = process.argv[2];
  if (!target) {
    console.error('Uso: node scripts/inject-config.mjs <file.html>');
    process.exit(1);
  }
  try {
    injectConfigFile(target, readEnvConfig());
    console.log('Config iniettata in', target);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
