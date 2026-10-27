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
  fs.writeFileSync(path.join(outDir, 'shots.json'), JSON.stringify(shots));
  if (errs.length) console.log('Errors in the page:', errs);
} finally {
  await b.close();
  server.kill();
}
