// AgentSphere server: serves the site, the shared data API (Neon Postgres or a local file) and the AI proxy.
// Needs Node 20+. `npm install` only matters when DATABASE_URL is set (it adds the Neon driver).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Load .env without any package
try {
  const txt = await fs.readFile(path.join(dir, '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file: fine */ }

const { handle, ai, HttpError, store } = await import('./lib/backend.js');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req, max = 4 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'too_large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const ip = req.socket.remoteAddress || 'local';
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await fs.readFile(path.join(dir, 'index.html')), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && /^\/zips\/[a-z-]+\.zip\.txt$/.test(url.pathname)) {
      return send(res, 200, await fs.readFile(path.join(dir, url.pathname)), 'text/plain; charset=utf-8');
    }
    if (req.method === 'POST' && url.pathname === '/api/ai') {
      let prompt = '';
      try { prompt = String(JSON.parse(await readBody(req, 65536)).prompt || ''); } catch { return send(res, 400, { error: 'bad_request' }); }
      return send(res, 200, await ai(prompt, ip));
    }
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' ? '' : await readBody(req);
      if (url.pathname === '/api/health') {
        const out = await handle({ method: 'GET', pathname: '/api/health', headers: req.headers, ip });
        return send(res, 200, { ...out, ai: Boolean(process.env.ANTHROPIC_API_KEY) });
      }
      const out = await handle({ method: req.method, pathname: url.pathname, body, headers: req.headers, ip, query: url.searchParams });
      return out && out.__html ? send(res, 200, out.__html, 'text/html; charset=utf-8') : send(res, 200, out);
    }
    send(res, 404, { error: 'not_found' });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
    console.error(e);
    send(res, 500, { error: 'server_error' });
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`AgentSphere running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  try { const st = await store(); console.log(st.kind === 'neon' ? 'Database: Neon Postgres (DATABASE_URL)' : 'Database: local file data/kv.json (set DATABASE_URL to use Neon)'); }
  catch (e) { console.error('Database error:', e.message); }
  console.log(process.env.ANTHROPIC_API_KEY ? 'AI agents: ON' : 'AI agents: OFF (add ANTHROPIC_API_KEY to .env to turn them on)');
});
