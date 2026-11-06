// Photographs every slide of the deck at full screen (2880×1620), once its animation is over.
// Used by tools/pdf.py: node tools/pdf-capture.mjs <out-dir>
// As tools/pdf-capture.mjs in git-exd/exd-presentazioni, with two differences: the deck is behind the login, so it is
// read from server.js started here on a free port, with a session signed by JWT_SECRET (.env); and slide 4, whose
// steps follow the keyboard, is photographed twice, at its first and at its last step.
// Writes <slide>.jpg files and shots.json ([{ label, files, alt }]) in the order of the deck; alt: the case slides
// without their number (NNn.jpg).
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'server.js'));
require('dotenv').config({ path: path.join(ROOT, '.env') });
const jwt = require('jsonwebtoken');
if (!process.env.JWT_SECRET) { console.error('JWT_SECRET is required (.env)'); process.exit(1); }

const [, , outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
const PORT = 3199;
const server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: chrome });
try {
  // a computer (not touch) under 900 px: the deck goes full screen, without the frame; 880×495 × 3.27 = 2880×1620
  const ctx = await b.newContext({ viewport: { width: 880, height: 495 }, deviceScaleFactor: 2880 / 880 });
  const token = jwt.sign({ sub: 'pdf@exdpeople.org', cp: {}, ch: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await ctx.addCookies([{ name: 'exd_session', value: token, domain: '127.0.0.1', path: '/' }]);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://127.0.0.1:${PORT}/deck`, { waitUntil: 'load' }); await p.waitForTimeout(2000);
  // no page numbers on the photographs: with each visitor's own order of the cases they would not match the pages
  // (the PDF reader numbers the pages anyway)
  await p.addStyleTag({ content: '.chrome .pgno { display: none !important; }' });
  const n = await p.evaluate(() => document.querySelector('deck-stage')._slides.length);
  const shots = [];
  const shoot = async (name) => {
    await p.evaluate(() => window.__deckSettle && window.__deckSettle());
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 88 });
    return name;
  };
  for (let i = 0; i < n; i++) {
    await p.evaluate((k) => document.querySelector('deck-stage').goTo(k), i);
    const info = await p.evaluate(() => { const d = document.querySelector('deck-stage'), s = d._slides[d._index];
      return { label: s.dataset.label, wait: +s.dataset.wait || 2500, steps: s.classList.contains('s-design') ? s.querySelectorAll('.vp').length + 1 : 0 }; });
    await p.waitForTimeout(info.wait);
    const base = String(i + 1).padStart(2, '0');
    const files = [await shoot(base + '.jpg')];
    // the cases also without their number, for the visitors who see them in another order (server.js)
    if (info.label.startsWith('Case · ')) {
      await p.evaluate(() => { const d = document.querySelector('deck-stage'); d._slides[d._index].querySelector('.cp-eyebrow .n').style.display = 'none'; });
      files.alt = [await shoot(base + 'n.jpg')];
      await p.evaluate(() => { const d = document.querySelector('deck-stage'); d._slides[d._index].querySelector('.cp-eyebrow .n').style.display = ''; });
    }
    if (info.steps) {
      for (let k = 0; k < info.steps; k++) { await p.keyboard.press('ArrowRight'); await p.waitForTimeout(900); }
      await p.waitForTimeout(1500);
      files.push(await shoot(base + 'b.jpg'));
    }
    shots.push({ label: info.label, files: [...files], alt: files.alt || null });
    console.log(`${i + 1}/${n} ${info.label}`);
  }
  // the alternative versions (views/variants/<name>.html): only the slides they change, with a session of that variant
  const variants = {};
  const vdir = path.join(ROOT, 'views', 'variants');
  for (const f of fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((x) => x.endsWith('.html')) : []) {
    const name = f.slice(0, -5);
    const markers = [...fs.readFileSync(path.join(vdir, f), 'utf8').matchAll(/<!-- REPLACE: (.+?) -->/g)].map((m) => m[1].trim());
    let labels = markers.filter((m) => !m.startsWith('card:'));
    if (markers.some((m) => m.startsWith('card:'))) labels.push('06 Cases · selector');
    // a version with its own order of the cases: every case slide (their numbers change) and the grid
    const vctx = await b.newContext({ viewport: { width: 880, height: 495 }, deviceScaleFactor: 2880 / 880 });
    await vctx.addCookies([{ name: 'exd_session', value: jwt.sign({ sub: 'pdf@exdpeople.org', cp: {}, ch: [], v: name }, process.env.JWT_SECRET, { expiresIn: '1h' }), domain: '127.0.0.1', path: '/' }]);
    const vp = await vctx.newPage();
    vp.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await vp.goto(`http://127.0.0.1:${PORT}/deck`, { waitUntil: 'load' }); await vp.waitForTimeout(2000);
    await vp.addStyleTag({ content: '.chrome .pgno { display: none !important; }' });
    if (/<!-- ORDER: /.test(fs.readFileSync(path.join(vdir, f), 'utf8'))) {
      const cases = await vp.evaluate(() => document.querySelector('deck-stage')._slides.map((s) => s.dataset.label).filter((l) => l.startsWith('Case · ')));
      labels = [...new Set([...cases, '06 Cases · selector', ...labels])];
    }
    variants[name] = [];
    for (const label of labels) {
      const k = await vp.evaluate((l) => document.querySelector('deck-stage')._slides.findIndex((s) => s.dataset.label === l), label);
      if (k < 0) continue;
      await vp.evaluate((i) => document.querySelector('deck-stage').goTo(i), k);
      await vp.waitForTimeout(2500);
      const base = `${name}-${String(k + 1).padStart(2, '0')}`;
      const shot = async (file) => { await vp.evaluate(() => window.__deckSettle && window.__deckSettle()); await vp.waitForTimeout(300);
        await vp.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 88 }); return file; };
      const entry = { label, files: [await shot(base + '.jpg')], alt: null };
      if (label.startsWith('Case · ')) {
        await vp.evaluate(() => { const d = document.querySelector('deck-stage'); d._slides[d._index].querySelector('.cp-eyebrow .n').style.display = 'none'; });
        entry.alt = [await shot(base + 'n.jpg')];
      }
      variants[name].push(entry);
      console.log(`${name}: ${label}`);
    }
    await vctx.close();
  }
  fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify({ shots, variants }));
  if (errs.length) console.log('Errors in the page:', errs);
} finally {
  await b.close();
  server.kill();
}
