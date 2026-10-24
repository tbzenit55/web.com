// ZENIT XMD — Pairing website (Render). No WhatsApp code runs here.
// It only forwards requests to the main bot, which links the device itself.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const BOT_URL = (process.env.BOT_URL || '').replace(/\/+$/, '');
const PAIR_KEY = process.env.PAIR_KEY || '';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', configured: Boolean(BOT_URL && PAIR_KEY) }));

const hits = new Map();
function limited(ip, max = 6, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) { const f = v.filter((t) => n - t < 600000); f.length ? hits.set(k, f) : hits.delete(k); } }, 60000).unref();

async function forward(method, route, body, timeoutMs) {
  const r = await fetch(BOT_URL + route, {
    method,
    headers: { 'content-type': 'application/json', 'x-pair-key': PAIR_KEY },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j };
}

app.post('/api/pair', async (req, res) => {
  if (!BOT_URL || !PAIR_KEY) return res.status(503).json({ error: 'Pairing is not configured yet.' });
  const number = String(req.body?.number || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(number)) return res.status(400).json({ error: 'Enter a valid number with country code, e.g. 919876543210' });
  if (limited(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
  try {
    const { status, json } = await forward('POST', '/web-pair/code', { number }, 50000);
    if (status === 401 || status === 503) return res.status(502).json({ error: 'Bot is not set up for web pairing.' });
    if (status === 402 || json.premiumRequired) {
      return res.status(402).json({ premiumRequired: true, error: json.error || 'Premium required.', contactUrl: json.contactUrl || 'https://t.me/zenitx0' });
    }
    res.status(status).json(json.error ? { error: json.error } : json);
  } catch { res.status(504).json({ error: 'Bot is not reachable right now. Try again shortly.' }); }
});

app.get('/api/status/:id', async (req, res) => {
  if (!/^[a-f0-9]{24}$/.test(req.params.id)) return res.status(404).json({ state: 'gone' });
  try {
    const { status, json } = await forward('GET', '/web-pair/status/' + req.params.id, null, 15000);
    res.json(status === 404 ? { state: 'gone' } : json);
  } catch { res.json({ state: 'pending' }); }
});

app.listen(PORT, () => console.log(`ZENIT XMD pairing web on :${PORT}`));
