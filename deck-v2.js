// Deck v2: the live parts taken from the site.
// · glitching words (hero headline, "Not a …" in The difference)
// · "What we do": one goal pill lights up at a time
// · the challenge films: entering the slide shows the first phase; each click on the film or → shows
//   the next phase (nothing moves on by itself); after the last one → goes to the next slide;
//   ← goes back a slide as usual; a step on the left jumps to that phase.
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onActive = (section, start, stop) => {
    const sync = () => (section.hasAttribute('data-deck-active') ? start() : stop());
    new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['data-deck-active'] });
    sync();
  };

  /* glitching words */
  document.querySelectorAll('.v2 .hero-tw').forEach((el) => {
    const words = (el.dataset.words || '').split('|');
    const GLYPHS = 'abcdefghijklmnopqrstuvwxyz#%&*+=<>/\\|';
    const set = (t) => { el.textContent = t; el.dataset.g = t; };
    let w = 0, timer = 0; set(words[0]);
    const glitch = (to) => new Promise((done) => {
      el.classList.add('glitching');
      const from = el.textContent, len = Math.max(from.length, to.length), t0 = performance.now(), D = 520;
      const step = (now) => {
        const p = Math.min(1, (now - t0) / D); let out = '';
        for (let i = 0; i < len; i++) { const settle = (i / len) * 0.7 + 0.25; out += p > settle ? (to[i] || '') : (Math.random() < 0.85 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : (from[i] || '')); }
        set(out.replace(/\s+$/, ''));
        if (p < 1) requestAnimationFrame(step); else { set(to); setTimeout(() => { el.classList.remove('glitching'); done(); }, 120); }
      };
      requestAnimationFrame(step);
    });
    const loop = async () => { w = (w + 1) % words.length; if (reduced) set(words[w]); else await glitch(words[w]); timer = setTimeout(loop, 2600); };
    onActive(el.closest('section'), () => { clearTimeout(timer); timer = setTimeout(loop, 2600); }, () => clearTimeout(timer));
  });

  /* goal pills */
  document.querySelectorAll('.v2-goals').forEach((box) => {
    let timer = 0, last = null;
    const pick = () => {
      const r = box.getBoundingClientRect(), mid = r.left + r.width / 2, span = r.width * 0.3;
      const seen = [...box.querySelectorAll('li')].filter((li) => { const q = li.getBoundingClientRect(); return Math.abs(q.left + q.width / 2 - mid) < span && li !== last; });
      if (last) last.classList.remove('hl'); last = seen[Math.floor(Math.random() * seen.length)] || null; if (last) last.classList.add('hl');
    };
    onActive(box.closest('section'), () => { clearInterval(timer); pick(); timer = setInterval(pick, 2200); }, () => clearInterval(timer));
  });

  /* challenge films */
  document.querySelectorAll('.v2-film').forEach((slide) => {
    const vis = slide.querySelector('.flowv'); if (!vis) return;
    const PH = JSON.parse(vis.dataset.ph);
    const stage = vis.querySelector('.fs'), cap = vis.querySelector('.fs-cap'), cnts = [...stage.querySelectorAll('.cnt')];
    const items = [...stage.querySelectorAll('[data-p]')], dims = [...stage.querySelectorAll('[data-dim]')];
    const steps = [...slide.querySelectorAll('.wr-steps li')];
    const paths = [...stage.querySelectorAll('.fs-lines path')], pts = [...stage.querySelectorAll('.fs-pt')];
    const real = paths.map((p) => { const c = p.cloneNode(); c.removeAttribute('pathLength'); return c; });
    const holder = document.createElementNS('http://www.w3.org/2000/svg', 'g'); holder.style.display = 'none'; real.forEach((c) => holder.appendChild(c)); stage.querySelector('.fs-lines').appendChild(holder);
    let lens = null;
    const st = { k: 0, t: 0, raf: 0, drift: 0, paused: false, playing: false };
    let t0 = performance.now(); const off = pts.map((_, i) => (i * 0.37) % 1);
    const tick = (now) => {
      if (!lens) lens = real.map((c) => c.getTotalLength());
      pts.forEach((c, i) => {
        if (!c.classList.contains('on')) return;
        if (now - (+c.dataset.at || 0) < 1150) { c.style.opacity = '0'; return; }
        const f = ((now - t0) / 1800 + off[i]) % 1, pt = real[i].getPointAtLength(f * lens[i]);
        c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1)); c.style.opacity = Math.min(1, f * 8, (1 - f) * 8).toFixed(2);
      });
      st.raf = requestAnimationFrame(tick);
    };
    const frame = (cx, cy, z) => {
      const W = vis.clientWidth, H = vis.clientHeight, sc = Math.min(H / 500, W / 700) * z;
      return `translate(${(W / 2 - cx * sc).toFixed(1)}px, ${(H / 2 - cy * sc + 16).toFixed(1)}px) scale(${sc.toFixed(4)})`;
    };
    const cam = (ph, instant) => {
      clearTimeout(st.drift);
      const z = ph.z || 1, MOVE = 1500;
      stage.style.transition = instant ? 'none' : `transform ${MOVE}ms cubic-bezier(.65,0,.2,1)`;
      stage.style.transform = frame(ph.cx, ph.cy || 250, z);
      if (reduced) return;
      st.driftTo = () => { stage.style.transition = `transform ${Math.max(400, st.driftLeft)}ms cubic-bezier(.3,0,.7,1)`; stage.style.transform = frame(ph.dx ?? ph.cx, ph.dy ?? ph.cy ?? 250, z * (ph.dz || 1.06)); };
      st.driftLeft = ph.t - (instant ? 0 : MOVE);
      st.drift = setTimeout(st.driftTo, instant ? 30 : MOVE);
    };
    const show = (k, instant) => {
      st.k = k; const ph = PH[k];
      items.forEach((el) => { const on = +el.dataset.p <= k; if (on && !el.classList.contains('on')) el.dataset.at = performance.now() + (instant ? -5000 : 0); el.classList.toggle('on', on); });
      dims.forEach((el) => el.classList.toggle('dim', k >= +el.dataset.dim));
      vis.classList.toggle('celebrate', !!ph.end);
      const si = ph.s ?? -1;
      steps.forEach((li, i) => li.classList.toggle('now', i === si));
      if (ph.end) { cap.querySelector('span').textContent = '✓'; cap.querySelector('b').textContent = ph.cap || ''; }
      else if (si >= 0) { cap.querySelector('span').textContent = String(si + 1).padStart(2, '0'); cap.querySelector('b').textContent = ph.cap || (steps[si] ? steps[si].querySelector('b').textContent : ''); }
      cap.classList.toggle('on', si >= 0 || !!ph.end);
      cam(ph, instant);
      cnts.forEach((cnt) => { const to = +cnt.dataset.to, at = +cnt.dataset.k, fmt = (n) => n.toLocaleString('en-GB');
        if (k < at) cnt.textContent = '0';
        else if (k === at && !instant && !reduced) { const a = performance.now() + (+cnt.dataset.delay || 500); const roll = (now) => { const f = Math.max(0, Math.min(1, (now - a) / 1300)); cnt.textContent = fmt(Math.round(to * (1 - Math.pow(1 - f, 3)))); if (f < 1 && st.k === at) requestAnimationFrame(roll); }; requestAnimationFrame(roll); }
        else cnt.textContent = fmt(to); });
    };
    const schedule = (fn, ms) => { clearTimeout(st.t); st.fn = fn; st.due = performance.now() + ms; st.t = setTimeout(fn, ms); };
    // plays through once and holds on the result (a presenter talks over it, no loop)
    const next = () => { if (st.k + 1 < PH.length) { show(st.k + 1); schedule(next, PH[st.k].t); } };
    // the film moves on only on a click or →: each one shows the next phase (the camera still drifts slowly inside it)
    const run = (from) => { show(from, from === 0); };
    const pause = () => { st.paused = true; clearTimeout(st.t); clearTimeout(st.drift); const m = getComputedStyle(stage).transform; stage.style.transition = 'none'; stage.style.transform = m; st.left = Math.max(0, st.due - performance.now()); st.driftLeft = Math.max(400, st.left); st.pausedAt = performance.now(); cancelAnimationFrame(st.raf); vis.classList.add('paused'); };
    const resume = () => { st.paused = false; t0 += performance.now() - st.pausedAt; vis.classList.remove('paused'); st.due = performance.now() + st.left; st.t = setTimeout(st.fn, st.left); if (st.driftTo) st.driftTo(); if (!reduced) st.raf = requestAnimationFrame(tick); };
    vis.addEventListener('click', (e) => { e.stopPropagation(); if (st.k < PH.length - 1) run(st.k + 1); else document.querySelector('deck-stage').next(); });
    steps.forEach((li, i) => li.addEventListener('click', (e) => { e.stopPropagation(); if (st.paused) resume(); clearTimeout(st.t); run(Math.max(0, PH.findIndex((p) => p.s === i))); }));
    // → steps the film; at the end it lets the deck move on
    slide._beforeNext = () => {
      if (st.k >= PH.length - 1) return undefined;
      if (st.paused) resume();
      clearTimeout(st.t); run(st.k + 1);
      return Promise.resolve(false);
    };
    onActive(slide, () => {
      if (st.playing) return; st.playing = true; st.paused = false; vis.classList.remove('paused');
      t0 = performance.now(); if (!reduced) st.raf = requestAnimationFrame(tick);
      if (reduced) show(PH.length - 1, true); else run(0);
    }, () => { st.playing = false; clearTimeout(st.t); clearTimeout(st.drift); cancelAnimationFrame(st.raf); });
  });
  /* Inside our systems: each challenge opens its film */
  document.querySelectorAll('.v2-inside .in-list li[data-target]').forEach((li) => {
    const open = (e) => { e.stopPropagation(); const deck = document.querySelector('deck-stage'); const i = deck._slides.findIndex((s) => s.dataset.label === li.dataset.target); if (i >= 0) deck.goTo(i); };
    li.addEventListener('click', open);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
  });
})();
