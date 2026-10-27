// Deck v3: the motion of the site v2.1, played when a slide arrives instead of on scroll.
// Loaded before deck-v2.js, so the rotating words are already rolls when deck-v2.js looks for glitches.
// · labels "(01)  Name  ───": every letter shuffles through glyphs and settles (text scramble, site ui.js)
// · key words: start light and wide, turn heavy; each word keeps the box of its bold width (site vfx.js)
// · rotating key word: letters roll up and out, the next word rolls in (site roll.js)
// · numbers: counted in (site ui.js)
// In the PDF (deck-stage print) every slide shows its final state. With prefers-reduced-motion nothing moves.
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let printing = false;
  const onActive = (section, start, stop) => {
    const sync = () => (section.hasAttribute('data-deck-active') ? start() : stop && stop());
    new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['data-deck-active'] });
    sync();
  };
  // fonts.ready alone can resolve before the variable font is fetched (text on hidden slides): ask for it explicitly
  const fontsReady = document.fonts ? document.fonts.load('300 40px "Zalando Sans VF"').catch(() => {}).then(() => document.fonts.ready) : Promise.resolve();

  /* ── labels ── */
  const GL = '&!1@Y0?#:Z+=E%/<>';
  const labels = [];
  document.querySelectorAll('deck-stage > section .eyebrow, deck-stage > section .wr-tag, .s-cover-intro .intro-sub').forEach((el) => {
    const text = el.textContent.trim();
    if (!text) return;
    el.textContent = '';
    if (el.dataset.n) { const n = document.createElement('span'); n.className = 'n'; n.textContent = `(${el.dataset.n})`; el.appendChild(n); }
    const t = document.createElement('span'); t.className = 'sh-t';
    const i = document.createElement('i'); i.textContent = text; t.appendChild(i); el.appendChild(t);
    el.classList.add('sh');
    labels.push({ el, i, text });
  });
  // the line only where the label runs along a column, as on the site; not on centred or short labels
  fontsReady.then(() => labels.forEach(({ el }) => {
    const cs = getComputedStyle(el);
    if (cs.textAlign === 'center' || el.offsetWidth < 700 || el.closest('.cs-card') || el.classList.contains('intro-sub')) return;
    const r = document.createElement('span'); r.className = 'rule'; el.appendChild(r);
  }));
  const scramble = (i, final, delay) => {
    const n = final.length, per = 45, spin = 380, start = performance.now() + delay;
    i.style.minWidth = i.offsetWidth + 'px';
    const tick = (now) => {
      if (printing) { i.textContent = final; return; }
      const t = now - start; let html = '';
      for (let k = 0; k < n; k++) {
        const c = final[k];
        if (c === ' ') { html += ' '; continue; }
        const at = k * per;
        if (t < at) html += '<span class="scr" style="opacity:0">' + c + '</span>';
        else if (t < at + spin) html += '<span class="scr">' + GL[(Math.random() * GL.length) | 0] + '</span>';
        else html += c.replace('&', '&amp;').replace('<', '&lt;');
      }
      i.innerHTML = html;
      if (t < (n - 1) * per + spin) requestAnimationFrame(tick); else { i.textContent = final; i.style.minWidth = ''; }
    };
    requestAnimationFrame(tick);
  };
  labels.forEach(({ el, i, text }) => {
    const section = el.closest('section');
    if (!section || reduced) return;
    // the cover subtitle decodes once "hello" is turning heavy
    const delay = el.classList.contains('intro-sub') ? 1000 : 200;
    onActive(section, () => { if (!printing) scramble(i, text, delay); });
  });

  /* ── rotating key words (were glitching words): .hero-tw becomes a roll ── */
  document.querySelectorAll('deck-stage .hero-tw').forEach((el) => {
    const words = (el.dataset.words || '').split('|').filter(Boolean);
    if (!words.length) return;
    el.className = 'key roll';
    el.removeAttribute('data-words');
    el.setAttribute('aria-label', words[0]);
    el.textContent = '';
    // the words stay, invisible, as a mould: the block always takes the room of its longest word
    words.forEach((w) => { const p = document.createElement('span'); p.className = 'roll-w pre'; p.setAttribute('aria-hidden', 'true'); p.textContent = w; el.appendChild(p); });
    const nodes = words.map((w) => {
      const s = document.createElement('span'); s.className = 'roll-w'; s.setAttribute('aria-hidden', 'true');
      let i = 0;
      w.split(' ').forEach((word, wi, list) => {
        const g = document.createElement('span'); g.className = 'rw';
        [...word].forEach((c) => { const ch = document.createElement('span'); ch.className = 'ch'; ch.textContent = c; ch.style.setProperty('--i', i++); g.appendChild(ch); });
        s.appendChild(g);
        if (wi < list.length - 1) { s.appendChild(document.createTextNode(' ')); i++; }
      });
      el.appendChild(s); return s;
    });
    const section = el.closest('section');
    let n = 0, timer = 0;
    const HOLD = 2200;
    const show = (k, roll) => {
      nodes.forEach((s, j) => { if (j !== k) { s.classList.remove('is-on'); if (!roll) s.classList.remove('is-off'); } });
      nodes[k].classList.remove('is-off'); nodes[k].classList.add('is-on');
    };
    const step = () => {
      const cur = nodes[n]; n = (n + 1) % nodes.length; const next = nodes[n];
      cur.classList.remove('is-on'); cur.classList.add('is-off');
      next.classList.remove('is-off'); next.classList.add('is-on');
      setTimeout(() => cur.classList.remove('is-off'), 700);
      timer = setTimeout(step, HOLD + next.textContent.length * 30);
    };
    if (reduced) { show(0); return; }
    onActive(section, () => {
      clearTimeout(timer); n = 0;
      nodes.forEach((s) => s.classList.remove('is-on', 'is-off'));
      if (printing) { show(0); return; }
      timer = setTimeout(() => { nodes[0].classList.add('is-on'); if (nodes.length > 1) timer = setTimeout(step, HOLD + 450); }, 450);
    }, () => { clearTimeout(timer); timer = 0; });
  });

  /* ── key words that turn bold: each word locked to its bold width ── */
  const kws = [];
  document.querySelectorAll('deck-stage :is(.h-title, .h-display, .h-h2, .wr-lead, .diff-lead, .cp-title) .key:not(.roll)').forEach((el) => {
    const parts = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    parts.forEach((p, k) => {
      const w = document.createElement('span'); w.className = 'kw-w'; w.textContent = p; w.style.setProperty('--k', k);
      el.appendChild(w); kws.push(w);
      if (k < parts.length - 1) el.appendChild(document.createTextNode(' '));
    });
  });
  const lock = (w) => {
    // offsetWidth: the layout width, unaffected by the scale of the stage
    // the entrance animation off first: while it runs, its first frame (light and wide) would be measured
    w.style.width = ''; w.style.animation = 'none';
    const bw = w.offsetWidth, cs = getComputedStyle(w), wide = parseFloat(cs.fontStretch) || 100;
    w.style.fontWeight = '220'; w.style.fontStretch = '125%';
    const w1 = w.offsetWidth; let ls = 125;
    if (w1 > bw + 0.5) {
      w.style.fontStretch = wide + '%';
      const w0 = w.offsetWidth;
      ls = w1 > w0 ? Math.min(125, Math.max(wide, wide + (125 - wide) * (bw - w0) / (w1 - w0))) : wide;
    }
    w.style.animation = ''; w.style.fontWeight = ''; w.style.fontStretch = '';
    w.style.width = bw + 'px'; w.style.setProperty('--ls', ls.toFixed(1) + '%');
  };
  fontsReady.then(() => kws.forEach(lock));
  // measured again when the slide arrives, before its animation starts: nothing can be measured on a font still loading
  new Set(kws.map((w) => w.closest('section'))).forEach((section) => section && onActive(section, () => fontsReady.then(() => { if (!printing) section.querySelectorAll('.kw-w').forEach(lock); })));

  /* ── cover: "hello" turns heavy like the key words. SVG text: textLength holds the bold width while the
     weight changes, so the word never moves against "we are .exd" ── */
  document.querySelectorAll('.s-cover-intro .intro-txt').forEach((t) => fontsReady.then(() => {
    t.removeAttribute('textLength'); t.style.animation = 'none';
    const bw = t.getComputedTextLength(), wide = parseFloat(getComputedStyle(t).fontStretch) || 100;
    t.style.fontWeight = '220'; t.style.fontStretch = '125%';
    const w1 = t.getComputedTextLength(); let ls = 125;
    if (w1 > bw + 0.5) {
      t.style.fontStretch = wide + '%';
      const w0 = t.getComputedTextLength();
      ls = w1 > w0 ? Math.min(125, Math.max(wide, wide + (125 - wide) * (bw - w0) / (w1 - w0))) : wide;
    }
    t.style.animation = ''; t.style.fontWeight = ''; t.style.fontStretch = '';
    t.style.setProperty('--ls', ls.toFixed(1) + '%');
    t.setAttribute('textLength', bw.toFixed(1)); t.setAttribute('lengthAdjust', 'spacing');
  }));

  /* ── numbers counted in ── */
  const finishers = [];
  document.querySelectorAll('deck-stage .v2-stats').forEach((box) => {
    const items = [...box.querySelectorAll('b')];
    [...box.children].forEach((li, i) => li.style.setProperty('--i', i));
    const finals = items.map((b) => b.textContent);
    let raf = 0;
    const done = () => { cancelAnimationFrame(raf); items.forEach((b, i) => { b.textContent = finals[i]; }); };
    finishers.push(done);
    onActive(box.closest('section'), () => {
      if (reduced || printing) return done();
      const t0 = performance.now() + 500, dur = 1600;
      const tick = (now) => {
        if (printing) return done();
        let more = false;
        items.forEach((b, i) => {
          const k = Math.min(1, Math.max(0, (now - t0 - i * 120) / dur)), e = 1 - Math.pow(1 - k, 4);
          if (k < 1) more = true;
          b.textContent = finals[i].replace(/\d+/g, (m) => { const to = +m, from = to > 1000 ? to - 40 : 0; return String(Math.round(from + (to - from) * e)); });
        });
        if (more) raf = requestAnimationFrame(tick); else done();
      };
      raf = requestAnimationFrame(tick);
    }, done);
  });

  /* ── 05 · what we do: the goals run through the window by themselves, one at a time, and loop (site vfx.js).
     The list is written three times (copy, goals, copy), so the loop never jumps. The row in the middle opens up:
     wide and light, full colour; the others stay narrow, heavy and dim. Runs only while the slide is on. ── */
  document.querySelectorAll('.s-what .goals-win').forEach((win) => {
    const list = win.querySelector('.goals'), all = [...list.children];
    const n = all.filter((li) => !li.classList.contains('clone')).length;
    const st = all.map(() => ({ v: -1 }));
    let pos = n, from = n, to = n, t0 = 0, raf = 0, timer = 0, on = false, tops = [];
    const HOLD = 560, DUR = 420;
    const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const measure = () => { tops = all.map((li) => li.offsetTop + li.offsetHeight / 2); };
    const centre = (q) => { const i = Math.floor(q), f = q - i; return tops[i] + ((tops[i + 1] ?? tops[i]) - tops[i]) * f; };
    const paint = () => {
      if (!tops.length || !tops[n]) measure();
      if (pos >= 2 * n) { pos -= n; from -= n; to -= n; }
      list.style.transform = `translate3d(0, ${(win.clientHeight / 2 - centre(pos)).toFixed(2)}px, 0)`;
      all.forEach((li, i) => {
        const t = Math.max(0, 1 - Math.abs(i - pos) / 1.1), o = st[i];
        if (Math.abs(t - o.v) < 0.002) return;
        o.v = t;
        const g = li.querySelector('.g');
        g.style.fontStretch = (94 + 22 * t).toFixed(1) + '%';
        g.style.fontWeight = (600 - 250 * t).toFixed(0);
        li.style.setProperty('--f', t.toFixed(3));
      });
    };
    const frame = (now) => {
      raf = 0;
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / DUR);
      pos = from + (to - from) * inOut(k);
      paint();
      if (k < 1) raf = requestAnimationFrame(frame); else if (on) timer = setTimeout(step, HOLD);
    };
    const step = () => { timer = 0; if (!on || printing) return; from = pos; to = Math.round(pos) + 1; t0 = 0; raf = requestAnimationFrame(frame); };
    const stop = () => { clearTimeout(timer); timer = 0; cancelAnimationFrame(raf); raf = 0; };
    fontsReady.then(() => { measure(); paint(); });
    finishers.push(() => { stop(); pos = Math.round(pos); paint(); });
    if (reduced) return;
    onActive(win.closest('section'), () => { on = true; stop(); measure(); paint(); timer = setTimeout(step, 900); }, () => { on = false; stop(); });
  });
  // "See our clients" opens the clients slide
  document.querySelectorAll('deck-stage a[data-target]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const deck = document.querySelector('deck-stage'), i = deck._slides.findIndex((s) => s.dataset.label === a.dataset.target);
    if (i >= 0) deck.goTo(i);
  }));

  /* ── blobs (site blobs.js): on top of the slow CSS drift, each blob wanders on its own and leans slowly
     towards the pointer; two chained low-pass filters give a soft, late response. Only while the slide is on.
     Uses `translate`, which adds to the drift on `transform`. ── */
  // not on phones and tablets: there the blobs stay still (deck-mobile.css)
  if (!reduced && !document.documentElement.classList.contains('m-light')) document.querySelectorAll('deck-stage .blobs').forEach((box) => {
    const section = box.closest('section');
    const CFG = [
      { k: 0.012, r: 170, tx: 23, ty: 31, ph: 0.0, pull: 0.9 },
      { k: 0.008, r: 210, tx: 29, ty: 19, ph: 2.1, pull: 0.7 },
      { k: 0.005, r: 240, tx: 37, ty: 27, ph: 4.2, pull: 0.5 },
      { k: 0.007, r: 200, tx: 41, ty: 23, ph: 1.3, pull: 0.6 },
    ];
    // a little quicker than on the site: a slide stays on screen for less time than a section
    const speed = box.classList.contains('blobs-contact') ? 2.2 : 1.6;
    const st = [...box.querySelectorAll('i')].map((el, i) => { const c = CFG[i % CFG.length]; return { el, c: { ...c, k: c.k * speed, tx: c.tx / speed, ty: c.ty / speed }, ax: 0, ay: 0, x: 0, y: 0 }; });
    let pointer = null, raf = 0, t0 = 0, on = false;
    section.addEventListener('pointermove', (e) => {
      const r = box.getBoundingClientRect(), sc = r.width / box.offsetWidth || 1;
      pointer = { x: (e.clientX - (r.left + r.width / 2)) / sc, y: (e.clientY - (r.top + r.height / 2)) / sc };
    });
    section.addEventListener('pointerleave', () => { pointer = null; });
    const tick = (now) => {
      if (!t0) t0 = now;
      const t = (now - t0) / 1000, TAU = Math.PI * 2;
      st.forEach((o) => {
        const { c } = o, q = pointer || { x: 0, y: 0 };
        const wx = c.r * Math.sin(TAU * t / c.tx + c.ph) + c.r * 0.4 * Math.sin(TAU * t / (c.tx * 0.43) + c.ph * 1.7);
        const wy = c.r * 0.7 * Math.cos(TAU * t / c.ty + c.ph) + c.r * 0.3 * Math.sin(TAU * t / (c.ty * 0.51) + c.ph);
        o.ax += (q.x * c.pull + wx - o.ax) * c.k; o.ay += (q.y * c.pull + wy - o.ay) * c.k;
        o.x += (o.ax - o.x) * c.k * 2; o.y += (o.ay - o.y) * c.k * 2;
        o.el.style.translate = `${o.x.toFixed(1)}px ${o.y.toFixed(1)}px`;
      });
      raf = on ? requestAnimationFrame(tick) : 0;
    };
    onActive(section, () => { on = true; if (!raf) raf = requestAnimationFrame(tick); }, () => { on = false; });
  });

  /* ── client cases: the film plays while its slide is on; the poster stays until the film really moves ── */
  document.querySelectorAll('deck-stage .s-case .cp-video').forEach((v) => {
    if (reduced) return;
    v.muted = true; v.defaultMuted = true; v.playsInline = true;
    v.addEventListener('playing', () => v.classList.add('is-on'), { once: true });
    onActive(v.closest('section'), () => { if (printing) return; v.preload = 'auto'; v.play().catch(() => {}); }, () => v.pause());
  });

  /* ── page numbers follow the real order of the slides ── */
  const deckEl = document.querySelector('deck-stage');
  [...(deckEl ? deckEl.children : [])].filter((x) => x.tagName === 'SECTION').forEach((sec, i) => sec.querySelectorAll('.chrome .pgno').forEach((p) => { p.textContent = String(i + 1).padStart(2, '0'); }));

  // the PDF capture (pdf-intro.mjs) brings every moving part to a still, final frame before each shot
  window.__deckSettle = () => finishers.forEach((f) => f());

  /* ── PDF: final states ── */
  window.addEventListener('beforeprint', () => {
    printing = true;
    finishers.forEach((f) => f());
    labels.forEach(({ i, text }) => { i.textContent = text; i.style.minWidth = ''; });
    document.querySelectorAll('deck-stage .roll').forEach((r) => {
      const ws = [...r.querySelectorAll('.roll-w:not(.pre)')];
      ws.forEach((s, j) => { s.classList.toggle('is-on', j === 0); s.classList.remove('is-off'); });
    });
  });
  window.addEventListener('afterprint', () => { printing = false; });
})();
