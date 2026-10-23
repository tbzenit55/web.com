// ZENIT XMD — Pairing web (host this on Render).
// Only job: link a WhatsApp device and hand back a session ID for the main bot.
// Nothing is stored after pairing; temp auth folders are deleted.
import express from 'express';
import pino from 'pino';
import QRCode from 'qrcode';
import * as B from '@whiskeysockets/baileys';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const SESSION_PREFIX = 'ZenitXMD!'; // same format the main bot restores from SESSIONS
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE || 20);
const PAIR_TIMEOUT_MS = 3 * 60 * 1000;
const RESULT_TTL_MS = 5 * 60 * 1000;
const TMP_ROOT = path.join(os.tmpdir(), 'zenit-pair');
fs.mkdirSync(TMP_ROOT, { recursive: true });

const makeWASocket = B.default?.default || B.default || B.makeWASocket;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = B.default?.useMultiFileAuthState ? B.default : B;
const logger = pino({ level: 'silent' });
logger.child = () => logger;

const jobs = new Map(); // id -> job

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', active: jobs.size }));

// ── tiny per-IP rate limit ────────────────────────────────────────────────
const hits = new Map();
function limited(ip, max = 6, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) { const f = v.filter((t) => now - t < 600000); f.length ? hits.set(k, f) : hits.delete(k); } }, 60000).unref();

// ── pairing job ───────────────────────────────────────────────────────────
function cleanup(job) {
  clearTimeout(job.timer);
  try { job.sock?.end(undefined); } catch {}
  setTimeout(() => { try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch {} }, 5000);
  setTimeout(() => jobs.delete(job.id), RESULT_TTL_MS).unref?.();
}

function fail(job, message) {
  if (job.state === 'linked' || job.state === 'failed') return;
  job.state = 'failed'; job.error = message; cleanup(job);
}

async function startJob(job) {
  const { state, saveCreds } = await useMultiFileAuthState(job.dir);
  let version;
  try {
    const v = await Promise.race([fetchLatestBaileysVersion(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000))]);
    version = v?.version;
  } catch {}

  job.timer = setTimeout(() => fail(job, 'Timed out. Please try again.'), PAIR_TIMEOUT_MS);

  const spawn = () => {
    if (job.state === 'failed' || job.state === 'linked') return;
    const sock = makeWASocket({
      ...(version ? { version } : {}),
      logger,
      printQRInTerminal: false,
      browser: Browsers?.macOS ? Browsers.macOS('Safari') : ['Mac OS X', 'Safari', '17.4.1'],
      auth: state,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      getMessage: async () => undefined,
    });
    job.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr && !state.creds.registered) {
        if (job.mode === 'qr') {
          try { job.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 }); job.state = 'qr'; } catch {}
        } else if (!job.codeRequested) {
          job.codeRequested = true;
          try {
            const raw = await sock.requestPairingCode(job.number);
            job.code = raw.match(/.{1,4}/g)?.join('-') || raw;
            job.codeAt = Date.now();
            job.state = 'code';
          } catch (e) { fail(job, 'Could not get a pairing code. Check the number and try again.'); }
        }
      }

      if (connection === 'open') {
        try {
          await saveCreds();
          const credsRaw = fs.readFileSync(path.join(job.dir, 'creds.json'));
          const sessionId = SESSION_PREFIX + zlib.gzipSync(credsRaw).toString('base64');
          const plain = credsRaw.toString('base64');
          const me = (sock.user?.id || '').split(':')[0].split('@')[0];
          job.result = { number: me, sessionId, sessionBase64: plain };
          job.state = 'linked';
          // send the session to the user's own WhatsApp chat as well
          try {
            const jid = me + '@s.whatsapp.net';
            await new Promise((r) => setTimeout(r, 2500));
            await sock.sendMessage(jid, { text: sessionId });
            await sock.sendMessage(jid, { text: '*ZENIT XMD* — device linked ✅\n\nCopy the message above (your Session ID) and put it in your bot panel.\n⚠️ Never share it with anyone.' });
          } catch {}
        } catch (e) { fail(job, 'Linked, but could not build the session. Try again.'); return; }
        setTimeout(() => cleanup(job), 6000);
      }

      if (connection === 'close' && job.state !== 'linked' && job.state !== 'failed') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut || code === 401 || code === 403) return fail(job, 'WhatsApp refused the link. Try again.');
        if (++job.reconnects > 6) return fail(job, 'Connection failed. Please try again.');
        setTimeout(spawn, 1000); // 515 restartRequired etc. is normal right after the code is entered
      }
    });
  };
  spawn();
}

function newJob(mode, number) {
  const id = crypto.randomBytes(12).toString('hex');
  const job = { id, mode, number, dir: path.join(TMP_ROOT, id), state: 'starting', reconnects: 0, codeRequested: false, createdAt: Date.now() };
  fs.mkdirSync(job.dir, { recursive: true });
  jobs.set(id, job);
  startJob(job).catch(() => fail(job, 'Could not start. Please try again.'));
  return job;
}

function waitFor(job, states, ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (states.includes(job.state) || Date.now() - t0 > ms ? resolve() : setTimeout(tick, 250));
    tick();
  });
}

function guard(req, res) {
  if (limited(req.ip)) { res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' }); return false; }
  if (jobs.size >= MAX_ACTIVE) { res.status(503).json({ error: 'Server is busy. Try again shortly.' }); return false; }
  return true;
}

app.post('/api/pair', async (req, res) => {
  const number = String(req.body?.number || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(number)) return res.status(400).json({ error: 'Enter a valid number with country code, e.g. 919876543210' });
  if (!guard(req, res)) return;
  const job = newJob('code', number);
  await waitFor(job, ['code', 'failed'], 30000);
  if (job.state === 'failed') return res.status(502).json({ error: job.error });
  if (job.state !== 'code') { fail(job, 'No code received.'); return res.status(504).json({ error: 'WhatsApp did not respond. Try again.' }); }
  res.json({ id: job.id, code: job.code, expiresIn: 60 });
});

app.post('/api/qr', async (req, res) => {
  if (!guard(req, res)) return;
  const job = newJob('qr', null);
  await waitFor(job, ['qr', 'failed'], 30000);
  if (job.state === 'failed') return res.status(502).json({ error: job.error });
  if (job.state !== 'qr') { fail(job, 'No QR.'); return res.status(504).json({ error: 'WhatsApp did not respond. Try again.' }); }
  res.json({ id: job.id, qr: job.qr });
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ state: 'gone' });
  if (job.state === 'linked') return res.json({ state: 'linked', ...job.result });
  if (job.state === 'failed') return res.json({ state: 'failed', error: job.error });
  res.json({ state: job.state, ...(job.mode === 'qr' && job.qr ? { qr: job.qr } : {}) });
});

app.listen(PORT, () => console.log(`ZENIT XMD pair server on :${PORT}`));
