/* deck-mobile.js — after offerta.js. The phone and tablet behaviour is the standard of git-exd/exd-presentazioni
   (shared/assets/offerta-head.js and offerta.js, loaded as they are: thumb arrows, the window measured on the page,
   html.m-light with the slide as large as the screen in portrait, zoom locked, the PDF button). Here only what this
   deck adds on phones and tablets: */
(function () {
  const root = document.documentElement, deck = document.querySelector('deck-stage');
  if (!root.classList.contains('m-light') || !deck) return;
  const portrait = () => matchMedia('(orientation: portrait)').matches;

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

  window.addEventListener('orientationchange', () => setTimeout(() => { cut(); stretch(); }, 300));
  window.addEventListener('resize', () => { cut(); stretch(); });
})();
