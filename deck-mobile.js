/* deck-mobile.js — phones and tablets, after deck-stage.js and the other deck scripts.
   The standard of git-exd/exd-presentazioni (shared/assets/offerta.js, October 2026):
   · thumb arrows, with the same logic as the keys (film steps included), off at the two ends
   · the window is measured on the page, not on the zoomed area
   · html.m-light: one slide at a time; in portrait the slide is as large as the screen, not scaled, and its
     content reflows (deck-mobile.css); in landscape the desktop slide, scaled. Zoom locked (on iPhone the
     zoomed deck ran out of memory) */

// thumb arrows
(function () {
  const deck = document.querySelector('deck-stage'), nav = document.querySelector('.thumbnav'); if (!deck || !nav) return;
  const prev = nav.querySelector('.tn-prev'), next = nav.querySelector('.tn-next');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  prev.addEventListener('click', (e) => { stop(e); deck._go(deck._index - 1, 'tap'); });
  next.addEventListener('click', (e) => { stop(e); deck._go(deck._index + 1, 'tap'); });
  const bar = nav.querySelector('.tn-bar');
  const sync = () => {
    const n = deck._slides ? deck._slides.length : 0; prev.disabled = deck._index <= 0; next.disabled = deck._index >= n - 1;
    const sl = deck._slides && deck._slides[deck._index];
    if (bar && sl) {
      const scrolls = getComputedStyle(sl).overflowY !== 'hidden' && sl.scrollHeight > sl.clientHeight + 2;
      // the slide's own colour; a slide whose colour is only an image or gradient gives ink
      const bg = getComputedStyle(sl).backgroundColor, clear = !bg || bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg);
      bar.style.setProperty('--tn-bg', scrolls ? (clear ? '#0d0f1e' : bg) : 'transparent');
    }
  };
  // on a light slide the glass of the arrows turns darker, so the arrows stay readable
  const tone = () => {
    const sl = deck._slides && deck._slides[deck._index]; if (!sl) return;
    const m = getComputedStyle(sl).backgroundColor.match(/[\d.]+/g) || [], a = m.length > 3 ? +m[3] : 1;
    nav.classList.toggle('on-light', a > 0 && (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) > 160);
  };
  deck.addEventListener('slidechange', () => { sync(); tone(); }); requestAnimationFrame(() => { sync(); tone(); });
})();

// the window measured on the page (clientWidth/clientHeight), which zoom does not change
(function () {
  const deck = document.querySelector('deck-stage'); if (!deck || !deck._fit) return;
  const vv = window.visualViewport;
  deck._fit = function () {
    if (!this._canvas) return;
    if (vv && vv.scale > 1.01) return;
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

// phones and tablets
(function () {
  const root = document.documentElement, deck = document.querySelector('deck-stage');
  if (!root.classList.contains('m-light') || !deck) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  const stop = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, stop, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  let last = 0;   // double tap
  document.addEventListener('touchend', (e) => { const t = Date.now(); if (t - last < 280 && !e.target.closest('a, button')) e.preventDefault(); last = t; }, { passive: false });
  // the deck: the slide fills the screen, not scaled; no bar, tap zones, side arrows or "rotate" prompt
  const st = document.createElement('style');
  st.textContent = '@media (orientation: portrait) { .canvas { transform: none !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; } }'
    + '.canvas { will-change: auto !important; } .overlay, .tapzones, .sidenav, .rotate { display: none !important; }';
  deck.shadowRoot.appendChild(st);
  const portrait = () => matchMedia('(orientation: portrait)').matches;
  const fitLandscape = deck._fit.bind(deck);
  deck._fit = () => { if (!portrait()) fitLandscape(); };

  // the client cases: the vertical cut of each film (and its poster) in portrait, as on the site
  const films = [...document.querySelectorAll('.s-case .cp-video')].map((v) => {
    const bg = v.parentElement, src = v.getAttribute('src'), poster = v.getAttribute('poster');
    return { v, bg, src, poster, srcM: src.replace(/\.mp4$/, '-m.mp4'), posterM: poster.replace(/\.webp$/, '-m.webp') };
  });
  const cut = () => films.forEach((f) => {
    const p = portrait(), want = p ? f.srcM : f.src;
    if (f.v.getAttribute('src') === want) return;
    const playing = !f.v.paused;
    f.v.classList.remove('is-on');
    f.v.setAttribute('poster', p ? f.posterM : f.poster);
    f.bg.style.backgroundImage = `url('${p ? f.posterM : f.poster}')`;
    f.v.setAttribute('src', want);
    f.v.addEventListener('playing', () => f.v.classList.add('is-on'), { once: true });
    if (playing) f.v.play().catch(() => {});
  });
  cut();

  // slide 3: the chart follows the width of the screen in portrait, at a readable height
  const chart = document.querySelector('.s-problem-line .erratic');
  const stretch = () => { if (chart) chart.setAttribute('preserveAspectRatio', portrait() ? 'none' : 'xMidYMid meet'); };
  stretch();

  // slide 4: its steps follow the keyboard, not the arrows; on the phone the slide arrives in its last step,
  // with the four tiles (in portrait the CSS also keeps the opening title and the paragraph)
  document.querySelectorAll('section.s-design').forEach((sec) => {
    const last = () => { sec.dataset.step = String(sec.querySelectorAll('.vp').length + 1); sec.querySelectorAll('.vp').forEach((v) => v.classList.add('on')); };
    new MutationObserver(() => { if (sec.hasAttribute('data-deck-active')) setTimeout(last, 0); }).observe(sec, { attributes: true, attributeFilter: ['data-deck-active'] });
    last();
  });

  window.addEventListener('orientationchange', () => setTimeout(() => { deck._fit(); cut(); stretch(); }, 300));
  window.addEventListener('resize', () => { cut(); stretch(); });
})();
