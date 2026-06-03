import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import { findUser } from './lib/sheets.js';
import { notifyLogin } from './lib/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = 'exd_session';
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 7);

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required'); process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(cookieParser());

// Public static assets: brand CSS, fonts, images, deck-stage runtime.
// These are not sensitive — only the deck markup (views/deck.html) is gated.
app.use('/exd', express.static(path.join(__dirname, 'exd'), { maxAge: '7d' }));
app.get('/deck-stage.js', (req, res) => {
  res.set('Cache-Control', 'public, max-age=604800');
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'deck-stage.js'));
});

function signSession(user) {
  return jwt.sign(
    { sub: user.email, name: user.name || '' },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

function verifySession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Troppi tentativi. Riprova tra qualche minuto.' },
});

// ── routes ─────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (verifySession(req)) return res.redirect('/deck');
  res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/deck', (req, res) => {
  if (!verifySession(req)) return res.redirect('/');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'views', 'deck.html'));
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const email = (req.body?.email || '').toString().trim();
  const password = (req.body?.password || '').toString();
  if (!email || !password) {
    return res.status(400).json({ error: 'Inserisci email e password.' });
  }
  try {
    const user = await findUser(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Credenziali non valide.' });
    }
    setSessionCookie(res, signSession(user));

    // Fire-and-forget notification: a mail failure must not block login.
    notifyLogin({
      user,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }).catch((err) => console.error('notifyLogin failed:', err.message));

    res.json({ ok: true });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Errore interno. Riprova.' });
  }
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`exdintro listening on :${PORT}`));
