/**
 * Copia questo file come config.js e compila i valori del progetto Supabase.
 * config.js NON va committato (contiene chiavi pubbliche anon, ma è specifico dell'ambiente).
 *
 * Dashboard Supabase → Project Settings → API:
 * - Project URL
 * - anon / public key
 */
window.CHIERICH_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_ANON_KEY'
};
