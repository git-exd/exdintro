/* ============================================================================
   offerta.js — comportamenti dei deck di offerta .exd (dopo deck-stage.js e deck.js)
   film delle fasi · frecce per il pollice · PDF scaricabile · misura stabile della
   finestra · versione per telefono e tablet. Istruzioni: shared/template-offerta/LEGGIMI.md
   ============================================================================ */
// Film delle fasi: ogni slide .s-film ha data-phases="da-a". Entrando, il film riparte dallo stato
// della fase precedente e anima le fasi della slide, poi si ferma. Clic sul film: se sta ancora
// animando salta alla fine della fase, altrimenti passa alla slide successiva.
// Con data-hold="N" il film si ferma alla fase N e aspetta un clic (o →) per mostrare il resto.
// Fuori dalla slide (griglia, stampa) il film mostra lo stato finale della sua fase.
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const deck = document.querySelector('deck-stage');
  // ogni passo in avanti chiesto dall'utente passa prima dal film della slide attiva
  const go = deck._go.bind(deck);
  deck._go = (i, reason) => {
    const cur = deck._slides && deck._slides[deck._index];
    if (reason !== 'api' && i === deck._index + 1 && cur && cur._advance && cur._advance()) return;
    return go(i, reason);
  };
  document.querySelectorAll('.s-film').forEach((slide) => {
    const vis = slide.querySelector('.flowv'); if (!vis) return;
    const [A, B] = slide.dataset.phases.split('-').map(Number);
    const mobile = document.documentElement.classList.contains('m-light');
    const H = slide.dataset.hold != null ? +slide.dataset.hold : B;   // dove il film aspetta il clic
    const PH = JSON.parse(vis.dataset.ph);
    const stage = vis.querySelector('.fs'), cap = vis.querySelector('.fs-cap'), cnts = [...stage.querySelectorAll('.cnt')];
    const items = [...stage.querySelectorAll('[data-p]')], dims = [...stage.querySelectorAll('[data-dim]')];
    const paths = [...stage.querySelectorAll('.fs-lines path')], pts = [...stage.querySelectorAll('.fs-pt')];
    const real = paths.map((p) => { const c = p.cloneNode(); c.removeAttribute('pathLength'); return c; });
    if (real.length) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.style.display = 'none'; real.forEach((c) => g.appendChild(c)); stage.querySelector('.fs-lines').appendChild(g); }
    let lens = null; const st = { k: 0, t: 0, raf: 0, drift: 0 }; let t0 = performance.now(); const off = pts.map((_, i) => (i * 0.37) % 1);
    const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');   // 2.140 (it-IT non separa le migliaia sotto 10.000)
    const tick = (now) => {
      if (!lens) lens = real.map((c) => c.getTotalLength());
      pts.forEach((c, i) => { if (!c.classList.contains('on') || !real[i]) return;
        if (now - (+c.dataset.at || 0) < 1150) { c.style.opacity = '0'; return; }
        const f = ((now - t0) / 1800 + off[i]) % 1, pt = real[i].getPointAtLength(f * lens[i]);
        c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1)); c.style.opacity = Math.min(1, f * 8, (1 - f) * 8).toFixed(2); });
      st.raf = requestAnimationFrame(tick);
    };
    const frame = (cx, cy, z) => { const W = vis.clientWidth || 900, H = vis.clientHeight || 640, sc = Math.min(H / 500, W / (W < 600 ? 700 : 700)) * z;
      return `translate(${(W / 2 - cx * sc).toFixed(1)}px, ${(H / 2 - cy * sc + 16).toFixed(1)}px) scale(${sc.toFixed(4)})`; };
    const cam = (ph, instant, settled) => { clearTimeout(st.drift); const z = ph.z || 1, MOVE = 1500;
      stage.style.transition = instant ? 'none' : `transform ${MOVE}ms cubic-bezier(.65,0,.2,1)`;
      stage.style.transform = settled ? frame(ph.dx ?? ph.cx, ph.dy ?? ph.cy ?? 250, z * (ph.dz || 1.06)) : frame(ph.cx, ph.cy || 250, z);
      if (reduced || instant) return;
      st.drift = setTimeout(() => { stage.style.transition = `transform ${Math.max(400, ph.t - MOVE)}ms cubic-bezier(.3,0,.7,1)`; stage.style.transform = frame(ph.dx ?? ph.cx, ph.dy ?? ph.cy ?? 250, z * (ph.dz || 1.06)); }, MOVE); };
    const show = (k, instant, settled) => {
      st.k = k; const ph = PH[k];
      // già visibili prima di questa slide: nessuna animazione d'ingresso; quelli nuovi entrano animati
      items.forEach((el) => { const on = +el.dataset.p <= k, fresh = on && !el.classList.contains('on');
        if (fresh) el.dataset.at = performance.now() + (instant ? -5000 : 0);
        if (instant) el.classList.toggle('no-anim', on); else if (fresh) el.classList.remove('no-anim');
        el.classList.toggle('on', on); });
      dims.forEach((el) => el.classList.toggle('dim', k >= +el.dataset.dim));
      vis.classList.toggle('celebrate', !!ph.end && !instant);
      if (ph.end) { cap.querySelector('span').textContent = '✓'; } else if (ph.s != null) cap.querySelector('span').textContent = String(ph.s + 1).padStart(2, '0');
      cap.querySelector('b').textContent = ph.cap || ''; cap.classList.add('on');
      cam(ph, instant, settled);
      // i contatori salgono una volta, quando compare la loro fase, e finiscono la corsa anche se il film va avanti
      cnts.forEach((cnt) => { const to = +cnt.dataset.to, at = +cnt.dataset.k;
        if (k < at) { cnt._roll = null; cnt.textContent = '0'; }
        else if (k === at && !instant && !reduced) {
          const tok = cnt._roll = {}, a = performance.now() + (cnt.dataset.dur ? 200 : 500), dur = +cnt.dataset.dur || 1300;
          const roll = (now) => { if (cnt._roll !== tok) return; const f = Math.max(0, Math.min(1, (now - a) / dur));
            cnt.textContent = fmt(Math.round(to * (1 - Math.pow(1 - f, 3)))); if (f < 1) requestAnimationFrame(roll); else cnt._roll = null; };
          requestAnimationFrame(roll); }
        else if (instant || !cnt._roll) { cnt._roll = null; cnt.textContent = fmt(to); } });
    };
    let released = false;
    const limit = () => (released ? B : H);
    const playing = () => st.k < limit();
    const next = () => { if (st.k < limit()) { show(st.k + 1); st.t = setTimeout(next, PH[st.k].t); } };
    // un passo avanti: finisce l'animazione in corso, poi mostra la parte dopo la pausa, poi cambia slide
    const step = () => {
      if (playing()) { clearTimeout(st.t); show(limit()); return true; }
      if (!released && H < B) { released = true; clearTimeout(st.t); show(H + 1); st.t = setTimeout(next, PH[st.k].t); return true; }
      return false;
    };
    // stato di partenza della slide: fine della fase precedente (o film vuoto per la prima fase)
    const prepare = () => {
      clearTimeout(st.t); clearTimeout(st.leave);
      if (A > 0) show(A - 1, true, true);
      else { items.forEach((el) => el.classList.remove('on', 'no-anim')); cnts.forEach((c) => { c._roll = null; c.textContent = '0'; }); cam(PH[A], true); }
      st.ready = true;
    };
    slide._prepare = () => { if (!slide.hasAttribute('data-deck-active')) prepare(); };
    const start = () => {
      clearTimeout(st.t); clearTimeout(st.leave); cancelAnimationFrame(st.raf); t0 = performance.now(); released = false;
      if (reduced) { show(B, true); return; }
      if (!st.ready) prepare();
      st.ready = false;
      // se si è andati avanti a metà movimento, si riparte dall'inquadratura di quell'istante
      const pv = slide.previousElementSibling, pfs = pv && pv.classList.contains('s-film') && pv.querySelector('.fs');
      if (pfs) { const m = getComputedStyle(pfs).transform; if (m && m !== 'none') { stage.style.transition = 'none'; stage.style.transform = m; } }
      st.raf = requestAnimationFrame(tick);
      requestAnimationFrame(() => requestAnimationFrame(() => { show(A); st.t = setTimeout(next, PH[A].t); }));
      // la slide successiva si prepara adesso, mentre questa è a schermo, così il passaggio non scatta
      const nx = slide.nextElementSibling;
      if (nx && nx._prepare) setTimeout(() => nx._prepare(), 900);
    };
    // uscendo: niente cambi durante la dissolvenza; dopo, stato finale (per griglia e stampa)
    const stop = () => { clearTimeout(st.t); clearTimeout(st.drift); cancelAnimationFrame(st.raf);
      st.leave = setTimeout(() => { if (!slide.hasAttribute('data-deck-active')) { show(B, true, true); st.ready = false; } }, 500); };
    vis.addEventListener('click', (e) => { e.stopPropagation(); if (!step() && !mobile) deck.next(); });
    // "avanti" (tasti, tocco, pulsanti): se c'è una pausa, prima il resto del film, poi la slide successiva
    slide._advance = () => { if (H >= B || released || reduced) return false; step(); return true; };
    new MutationObserver(() => (slide.hasAttribute('data-deck-active') ? start() : stop())).observe(slide, { attributes: true, attributeFilter: ['data-deck-active'] });
    requestAnimationFrame(() => (slide.hasAttribute('data-deck-active') ? start() : show(B, true, true)));
  });
})();
// frecce per il pollice: stessa logica dei tasti (rispettano la pausa del film), si spengono agli estremi
(function () {
  const deck = document.querySelector('deck-stage'), nav = document.querySelector('.thumbnav'); if (!deck || !nav) return;
  const prev = nav.querySelector('.tn-prev'), next = nav.querySelector('.tn-next');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  prev.addEventListener('click', (e) => { stop(e); deck._go(deck._index - 1, 'tap'); });
  next.addEventListener('click', (e) => { stop(e); deck._go(deck._index + 1, 'tap'); });
  const bar = nav.querySelector('.tn-bar');
  const sync = () => { const n = deck._slides ? deck._slides.length : 0; prev.disabled = deck._index <= 0; next.disabled = deck._index >= n - 1;
    const sl = deck._slides && deck._slides[deck._index];
    if (bar && sl) { const scrolls = getComputedStyle(sl).overflowY !== 'hidden' && sl.scrollHeight > sl.clientHeight + 2;
      bar.style.setProperty('--tn-bg', scrolls ? getComputedStyle(sl).backgroundColor : 'transparent'); } };
  deck.addEventListener('slidechange', sync); requestAnimationFrame(sync);
})();
// "PDF" (pulsante o tasto P) scarica il PDF già pronto, impaginato con Chrome, invece di aprire la stampa
// del browser (Safari la impagina male). Cmd/Ctrl+P apre comunque la stampa.
(function () {
  const deck = document.querySelector('deck-stage'), file = document.getElementById('pdf-file'); if (!deck || !file) return;
  deck._exportPdf = () => { if (deck._closeGrid) deck._closeGrid(); file.click(); };
  const btn = deck.shadowRoot && deck.shadowRoot.querySelector('.btn.pdf');
  if (btn) { btn.title = 'Scarica PDF (P)'; btn.setAttribute('aria-label', 'Scarica PDF'); }
})();
// Zoom da mobile: si può ingrandire con le dita per leggere meglio. Il deck però misurava la finestra con
// innerWidth/innerHeight, che sul telefono seguono la parte ingrandita: zoomando la slide si ridimensionava
// e si scomponeva. Qui la misura è quella della pagina (clientWidth/clientHeight), che lo zoom non cambia,
// e durante lo zoom il deck non si ricalcola.
(function () {
  const deck = document.querySelector('deck-stage'); if (!deck || !deck._fit) return;
  const vv = window.visualViewport;
  deck._fit = function () {
    if (!this._canvas) return;
    if (vv && vv.scale > 1.01) return;   // ingrandito: la slide resta com'è, si ingrandisce e basta
    // stessa logica di deck-stage.js (_fit), con le misure della pagina al posto di innerWidth/innerHeight
    const el = document.documentElement, W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
    const full = this._isFullscreen();
    const edge = full || W < 900 || window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.toggleAttribute('fullscreen', full); this.toggleAttribute('edge', edge);
    const gx = edge ? 0 : 96, gy = edge ? 0 : 48;
    const s = Math.min(Math.max(0, W - gx * 2) / this.designWidth, Math.max(0, H - gy * 2) / this.designHeight);
    this._canvas.style.transform = `scale(${s})`;
    if (this._syncBackdrop) this._syncBackdrop();
  };
  if (vv) vv.addEventListener('resize', () => { if (vv.scale <= 1.01) deck._fit(); });
  deck._fit();
})();
// Telefono e tablet (classe m-light): una slide alla volta, con le frecce grandi, come su computer; ma la slide
// è grande quanto lo schermo (anche in verticale) e il contenuto si reimpagina per stare dentro, con testi leggibili.
// Lo zoom è bloccato: non serve (e su iPhone lo zoom del deck esauriva la memoria).
(function () {
  const root = document.documentElement, deck = document.querySelector('deck-stage');
  if (!root.classList.contains('m-light') || !deck) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let last = 0;   // doppio tocco
  document.addEventListener('touchend', (e) => { const t = Date.now(); if (t - last < 280 && !e.target.closest('a, button')) e.preventDefault(); last = t; }, { passive: false });
  // il deck: la slide occupa tutto lo schermo senza scala; niente barra, zone di tocco, frecce laterali né invito a ruotare
  const st = document.createElement('style');
  st.textContent = '@media (orientation: portrait) { .canvas { transform: none !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; } }'
    + '.canvas { will-change: auto !important; } .overlay, .tapzones, .sidenav, .rotate { display: none !important; }';
  deck.shadowRoot.appendChild(st);
  // in verticale la slide non si scala; in orizzontale si scala come su computer
  const fitLandscape = deck._fit.bind(deck);
  deck._fit = () => { if (!matchMedia('(orientation: portrait)').matches) fitLandscape(); };
  window.addEventListener('orientationchange', () => setTimeout(() => deck._fit(), 300));
})();
