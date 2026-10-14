// Vercel serverless function. vercel.json rewrites every /api/* request here (data, sign-in, AI).
import { handle, ai, HttpError } from '../lib/backend.js';

export const config = { maxDuration: 60 };

async function rawBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  let s = ''; for await (const c of req) s += c; return s;
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'vercel';
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (url.pathname === '/api/ai' && req.method === 'POST') {
      let prompt = ''; try { prompt = String(JSON.parse(await rawBody(req)).prompt || ''); } catch {}
      return res.status(200).json(await ai(prompt, ip));
    }
    const body = req.method === 'GET' ? '' : await rawBody(req);
    const out = await handle({ method: req.method, pathname: url.pathname, body, headers: req.headers, ip, query: url.searchParams });
    if (out && out.__html) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(200).send(out.__html); }
    if (url.pathname === '/api/health') out.ai = Boolean(process.env.ANTHROPIC_API_KEY);
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.code, message: e.message });
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
}
