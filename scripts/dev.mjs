/**
 * Dev server: legge .env e serve l'app con config iniettata (niente config.js).
 * Uso: npm run dev
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { injectConfigHtml, readEnvConfig } from './inject-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadDotEnv();

let cfg;
try {
  cfg = readEnvConfig();
} catch (err) {
  console.error(err.message || err);
  console.error('\nCrea .env da .env.example e riprova.');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json'
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent((reqPath || '/').split('?')[0]);
  const cleaned = decoded.replace(/^\/+/, '');
  const full = path.normalize(path.join(base, cleaned || 'index.html'));
  if (!full.startsWith(base)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  try {
    let filePath = safeJoin(root, req.url === '/' ? '/index.html' : req.url);
    if (!filePath) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = fs.readFileSync(filePath);
    if (ext === '.html') {
      body = Buffer.from(injectConfigHtml(body.toString('utf8'), cfg), 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500).end('Server error');
  }
});

server.listen(port, () => {
  console.log(`ChierichApp → http://localhost:${port}/`);
  console.log('(config da .env, niente config.js)');
});
