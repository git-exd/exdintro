import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import { findUser } from './lib/sheets.js';
import { logLastAccess } from './lib/access-log.js';

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
// The styles and scripts of the deck (October 2026, site v2.1 style and phone version). Short cache: they change
// with the deck, and a stale copy would not match the new markup.
const DECK_FILES = [
  'deck-stage-051026.js', 'deck-v2.css', 'deck-v2.js', 'deck-v3.css', 'deck-v3.js', 'films.css',
  'deck-mobile-head.js', 'deck-mobile.css', 'deck-mobile.js',
];
for (const f of DECK_FILES) {
  app.get('/' + f, (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.sendFile(path.join(__dirname, f));
  });
}

function signSession(user) {
  return jwt.sign(
    {
      sub: user.email,
      name: user.name || '',
      industry: user.industry || '',
      cp: user.casePriorities || {},
      ch: user.caseHidden || [],
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

const DECK_PATH = path.join(__dirname, 'views', 'deck.html');
let deckTemplateCache = null;
async function getDeckTemplate() {
  if (deckTemplateCache) return deckTemplateCache;
  deckTemplateCache = await fs.readFile(DECK_PATH, 'utf8');
  return deckTemplateCache;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Reorder the five case studies according to the per-user priorities in the session, in two places: the case
// slides (between <!-- CASES:START --> and <!-- CASES:END --> in deck.html) and their cards on the clients slide
// (between <!-- CARDS:START --> and <!-- CARDS:END -->). Cases listed in `hidden` are dropped from both; of the
// rest, cases with a priority come first, sorted ascending, and cases without a priority keep their original
// order at the end. The case slides are then numbered again, (01), (02)…, and the cards enter in the new order.
const CASE_NAME_TO_KEY = {
  'Luxardo': 'luxardo',
  'Pasticceria Giotto': 'giotto',
  'DAB Pumps': 'dab',
  'vVardis': 'vvardis',
  'Crédit Agricole': 'credit_agricole',
};

function sortBlocks(blocks, priorities, hiddenSet) {
  return blocks
    .map((b, originalIdx) => {
      const key = CASE_NAME_TO_KEY[b.name];
      const p = key ? priorities[key] : undefined;
      const priority = (typeof p === 'number' && Number.isFinite(p) && p > 0) ? p : null;
      return { ...b, key, priority, originalIdx };
    })
    .filter((b) => !(b.key && hiddenSet.has(b.key)))
    .sort((a, b) => {
      if (a.priority != null && b.priority != null) return a.priority - b.priority || a.originalIdx - b.originalIdx;
      if (a.priority != null) return -1;
      if (b.priority != null) return 1;
      return a.originalIdx - b.originalIdx;
    });
}

// the region between two markers, split into blocks that each start with `opener` and carry the case name
function splitRegion(html, start, end, opener, nameRe) {
  const si = html.indexOf(start), ei = html.indexOf(end);
  if (si === -1 || ei === -1 || ei <= si) return null;
  const from = si + start.length;
  const region = html.slice(from, ei);
  const parts = region.split(new RegExp(`(?=${opener})`)).filter((p) => p.trimStart().startsWith(opener));
  const blocks = parts.map((text) => { const m = text.match(nameRe); return { text, name: m ? m[1] : '' }; });
  return { from, to: ei, blocks };
}

function reorderCaseStudies(html, priorities = {}, hidden = []) {
  const hiddenSet = new Set(hidden);
  const slides = splitRegion(html, '<!-- CASES:START', '<!-- CASES:END -->',
    '<section class="s-case', /data-label="Case · ([^"]+)"/);
  const cards = splitRegion(html, '<!-- CARDS:START -->', '<!-- CARDS:END -->',
    '<div class="cs-card', /data-target="Case · ([^"]+)"/);
  if (!slides) return html;
  const headEnd = html.indexOf('-->', html.indexOf('<!-- CASES:START')) + 3;   // keep the marker comment whole
  const order = sortBlocks(slides.blocks, priorities, hiddenSet);
  const slideHtml = order.map((b, i) => b.text
    .replace(/<span class="n">\(\d+\)<\/span>/, `<span class="n">(${String(i + 1).padStart(2, '0')})</span>`)
    .trimEnd() + '\n\n  ').join('');
  let out = html.slice(0, headEnd) + '\n  ' + slideHtml + html.slice(slides.to);
  if (cards) {
    // positions shift after the slides were rewritten: find the cards again in the new html
    const c = splitRegion(out, '<!-- CARDS:START -->', '<!-- CARDS:END -->', '<div class="cs-card', /data-target="Case · ([^"]+)"/);
    const sorted = sortBlocks(c.blocks, priorities, hiddenSet);
    const cardHtml = sorted.map((b, i) => b.text.replace(/style="--i: \d+"/, `style="--i: ${i + 2}"`).trimEnd() + '\n        ').join('');
    const ctaIdx = sorted.length + 2;
    out = out.slice(0, c.from) + '\n        ' + cardHtml + out.slice(c.to);
    out = out.replace(/(<a class="cs-card cs-more rv" style="--i: )\d+/, `$1${ctaIdx}`);
  }
  return out;
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

app.get('/deck', async (req, res) => {
  const session = verifySession(req);
  if (!session) return res.redirect('/');
  try {
    const tmpl = await getDeckTemplate();
    // Slide 18 reads "We track <phrase> closely." With an industry set it's
    // "the <industry> industry" (industry name emphasized); when empty it
    // falls back to a generic "your industry".
    const rawIndustry = (session.industry || '').trim();
    const industryPhrase = rawIndustry
      ? `<span style="font-weight: 300;">the</span> ${escapeHtml(rawIndustry)} industry`
      : 'your industry';
    let html = tmpl.replaceAll('{{INDUSTRY_PHRASE}}', industryPhrase);
    html = reorderCaseStudies(html, session.cp || {}, session.ch || []);
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html);
  } catch (err) {
    console.error('deck render error:', err);
    res.status(500).type('text').send('Internal error');
  }
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

    // Fire-and-forget: a webhook failure must not block login.
    logLastAccess({ user })
      .catch((err) => console.error('logLastAccess failed:', err.message));

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
