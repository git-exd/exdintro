import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import puppeteer from 'puppeteer';

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

function signSession(user) {
  return jwt.sign(
    {
      sub: user.email,
      name: user.name || '',
      industry: user.industry || '',
      cp: user.casePriorities || {},
    },
    process.env.JWT_SECRET,
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

const DECK_PATH = path.join(__dirname, 'views', 'deck.html');
const DEFAULT_INDUSTRY = 'food';
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

// Reorder the five case-study sections inside the deck HTML according to the
// per-user priorities in the session. Cases with a priority come first,
// sorted ascending; cases without a priority keep their original order at
// the end. The region is identified by its leading and trailing comments
// (kept stable in deck.html on purpose).
const CASE_NAME_TO_KEY = {
  'Luxardo': 'luxardo',
  'Pasticceria Giotto': 'giotto',
  'DAB Pumps': 'dab',
  'vVardis': 'vvardis',
  'Crédit Agricole': 'credit_agricole',
};
const CASE_REGION_START = '  <!-- 10 · Case Study · Luxardo -->';
const CASE_REGION_END   = "  <!-- 14 · Statement · Let's dive in -->";

function reorderCaseStudies(html, priorities = {}) {
  const si = html.indexOf(CASE_REGION_START);
  const ei = html.indexOf(CASE_REGION_END);
  if (si === -1 || ei === -1 || ei <= si) return html;
  const region = html.slice(si, ei);
  const parts = region.split(/(?=  <!-- \d+ · Case Study · )/).filter((p) => p.trim());
  if (parts.length === 0) return html;

  const blocks = parts.map((block, originalIdx) => {
    const m = block.match(/<!-- \d+ · Case Study · ([^\n]+?) -->/);
    const key = m ? CASE_NAME_TO_KEY[m[1].trim()] : null;
    const p = key ? priorities[key] : undefined;
    const priority = (typeof p === 'number' && Number.isFinite(p) && p > 0) ? p : null;
    return { block, originalIdx, priority };
  });

  blocks.sort((a, b) => {
    if (a.priority != null && b.priority != null) {
      return a.priority - b.priority || a.originalIdx - b.originalIdx;
    }
    if (a.priority != null) return -1;
    if (b.priority != null) return 1;
    return a.originalIdx - b.originalIdx;
  });

  return html.slice(0, si) + blocks.map((b) => b.block).join('') + html.slice(ei);
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
    const industry = escapeHtml((session.industry || '').trim() || DEFAULT_INDUSTRY);
    let html = tmpl.replaceAll('{{INDUSTRY}}', industry);
    html = reorderCaseStudies(html, session.cp || {});
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

// Lazily-launched shared Puppeteer instance. Kept around so subsequent PDFs
// don't pay the cold-start cost (~1s for Chromium boot). Each request still
// opens its own page so they're isolated.
let _pdfBrowser = null;
async function getPdfBrowser() {
  if (_pdfBrowser && _pdfBrowser.connected) return _pdfBrowser;
  _pdfBrowser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return _pdfBrowser;
}

function rewriteAssetPaths(html, baseUrl) {
  return html
    .replaceAll('href="/exd/', `href="${baseUrl}/exd/`)
    .replaceAll('src="/exd/',  `src="${baseUrl}/exd/`)
    .replaceAll('src="/deck-stage.js"', `src="${baseUrl}/deck-stage.js"`)
    .replaceAll("url('/exd/", `url('${baseUrl}/exd/`)
    .replaceAll('url("/exd/', `url("${baseUrl}/exd/`)
    .replaceAll('url(/exd/',  `url(${baseUrl}/exd/`);
}

app.get('/api/pdf', async (req, res) => {
  const session = verifySession(req);
  if (!session) return res.status(401).type('text').send('Unauthorized');

  let page;
  try {
    const tmpl = await getDeckTemplate();
    const industry = escapeHtml((session.industry || '').trim() || DEFAULT_INDUSTRY);
    let html = tmpl.replaceAll('{{INDUSTRY}}', industry);
    html = reorderCaseStudies(html, session.cp || {});

    // Puppeteer renders setContent in a blank navigation context, so relative
    // URLs would 404. Rewrite the static asset paths to absolute URLs of this
    // same server, so Chromium fetches them over HTTP from us.
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    html = rewriteAssetPaths(html, baseUrl);

    const browser = await getPdfBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    // Freeze every running CSS animation at half its cycle so the PDF
    // captures the visually rich midpoint (orbs spread out, gradients drifted)
    // rather than the 0%/100% rest state.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (!cs.animationName || cs.animationName === 'none') continue;
        const durations = cs.animationDuration.split(',').map((s) => parseFloat(s) || 0);
        if (durations.every((d) => d === 0)) continue;
        el.style.animationDelay = durations.map((d) => `${(-d / 2).toFixed(3)}s`).join(',');
        el.style.animationPlayState = 'paused';
      }
    });
    // Give the JS-driven particle generators (slides 6/8) a moment to spawn
    // their dots after the freeze takes effect.
    await new Promise((r) => setTimeout(r, 400));

    const pdfBuffer = await page.pdf({
      width: '1920px',
      height: '1080px',
      printBackground: true,
      preferCSSPageSize: false,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="exd-intro.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error('pdf render error:', err);
    res.status(500).type('text').send('PDF generation failed: ' + err.message);
  } finally {
    if (page) page.close().catch(() => {});
  }
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.listen(PORT, () => console.log(`exdintro listening on :${PORT}`));
