/**
 * <deck-stage> — reusable web component for HTML decks.
 *
 * Handles:
 *  (a) speaker notes — reads <script type="application/json" id="speaker-notes">
 *      and posts {slideIndexChanged: N} to the parent window on nav.
 *  (b) keyboard navigation — ←/→, PgUp/PgDn, Space, Home/End, number keys.
 *  (c) press R to reset to slide 0 (with a tasteful keyboard hint).
 *  (d) bottom-center overlay showing slide count + hints, fades out on idle.
 *  (e) auto-scaling — inner canvas is a fixed design size (default 1920×1080)
 *      scaled with `transform: scale()` to fit the viewport, letterboxed.
 *      Set the `noscale` attribute to render at authored size (1:1) — the
 *      PPTX exporter sets this so its DOM capture sees unscaled geometry.
 *  (f) print — `@media print` lays every slide out as its own page at the
 *      design size, so the browser's Print → Save as PDF produces a clean
 *      one-page-per-slide PDF with no extra setup.
 *
 * Slides are HIDDEN, not unmounted. Non-active slides stay in the DOM with
 * `visibility: hidden` + `opacity: 0`, so their state (videos, iframes,
 * form inputs, React trees) is preserved across navigation.
 *
 * Lifecycle event — the component dispatches a `slidechange` CustomEvent on
 * itself whenever the active slide changes (including the initial mount).
 * The event bubbles and composes out of shadow DOM, so you can listen on
 * the <deck-stage> element or on document:
 *
 *   document.querySelector('deck-stage').addEventListener('slidechange', (e) => {
 *     e.detail.index         // new 0-based index
 *     e.detail.previousIndex // previous index, or -1 on init
 *     e.detail.total         // total slide count
 *     e.detail.slide         // the new active slide element
 *     e.detail.previousSlide // the prior slide element, or null on init
 *     e.detail.reason        // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
 *   });
 *
 * Persistence: none at the deck level. The host app keeps the current slide
 * in its own URL (?slide=) and re-delivers it via location.hash on load, so a
 * bare load with no hash always starts at slide 1.
 *
 * Usage:
 *   <deck-stage width="1920" height="1080">
 *     <section data-label="Title">...</section>
 *     <section data-label="Agenda">...</section>
 *   </deck-stage>
 *
 * Aggiunte (dal kit deck di offerta, adattate anche ai deck che mostrano i
 *  contenuti solo sotto [data-deck-active]):
 *  (g) vista a griglia di tutte le slide (tasto G o pulsante nella barra)
 *  (h) schermo intero (tasto F o pulsante): la slide riempie lo schermo, senza
 *      margini né angoli arrotondati; le eventuali fasce prendono il colore di
 *      sfondo della slide corrente, così la cornice nera sparisce. Lo stesso
 *      "a tutto schermo" vale sui dispositivi touch e sugli schermi stretti.
 *  (i) dispositivi touch in verticale: animazione che invita a ruotare lo
 *      smartphone (il web non può bloccare l'orientamento su iOS); su Android,
 *      entrando a schermo intero si prova a bloccare l'orizzontale.
 *  (j) esporta in PDF (tasto P o pulsante "PDF"): apre la stampa del browser,
 *      dove si sceglie "Salva come PDF"; una slide per pagina alla misura del
 *      deck, con le animazioni ferme nello stato finale.
 *
 * Slides are the direct element children of <deck-stage>. Each slide is
 * automatically tagged with:
 *   - data-screen-label="NN Label"   (1-indexed, for comment flow)
 *   - data-om-validate="no_overflowing_text,no_overlapping_text,slide_sized_text"
 */

(() => {
  const DESIGN_W_DEFAULT = 1920;
  const DESIGN_H_DEFAULT = 1080;
  const OVERLAY_HIDE_MS = 1800;
  const VALIDATE_ATTR = 'no_overflowing_text,no_overlapping_text,slide_sized_text';
  // Visual margin around the canvas in viewer mode (px on each side).
  const VIEWER_MARGIN = 48;
  // Space reserved for side nav buttons (button width + gap).
  const VIEWER_SIDE_GUTTER = 96;

  /** Proprietà che le miniature della griglia copiano dalla slide originale
   *  (vedi _openGrid). */
  const THUMB_COPY = ['box-sizing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'color', 'overflow'];

  const pad2 = (n) => String(n).padStart(2, '0');

  const stylesheet = `
    :host {
      position: fixed;
      inset: 0;
      display: block;
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
      overflow: hidden;
    }

    .stage {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .canvas {
      position: relative;
      transform-origin: center center;
      flex-shrink: 0;
      /* black, not white: at fractional zoom the slide edge is anti-aliased and
         lets the canvas show through as a hairline; black blends with the frame */
      background: #000;
      will-change: transform;
      border-radius: 24px;
      overflow: hidden;
    }

    /* Slides live in light DOM (via <slot>) so authored CSS still applies.
       We absolutely position each slotted child to stack them. */
    ::slotted(*) {
      position: absolute !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      box-sizing: border-box !important;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
    }
    ::slotted([data-deck-active]) {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
    }

    /* Side navigation arrows — always-visible circular buttons. */
    .sidenav {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      width: 56px;
      height: 56px;
      border-radius: 999px;
      background: rgba(255,255,255,0.10);
      color: rgba(255,255,255,0.85);
      border: 0;
      padding: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: background 160ms ease, color 160ms ease, transform 160ms ease, opacity 160ms ease;
      z-index: 2147482500;
      -webkit-tap-highlight-color: transparent;
    }
    .sidenav:hover { background: rgba(255,255,255,0.20); color: #fff; }
    .sidenav:active { background: rgba(255,255,255,0.28); }
    .sidenav:focus { outline: none; }
    .sidenav:focus-visible { outline: none; }
    .sidenav:disabled {
      opacity: 0.3;
      cursor: default;
      pointer-events: none;
    }
    .sidenav svg { width: 22px; height: 22px; display: block; }
    .sidenav.prev { left: 16px; }
    .sidenav.next { right: 16px; }
    /* A tutto schermo (schermo intero, touch, schermi stretti): niente angoli né frecce */
    :host([edge]) .canvas { border-radius: 0; }
    :host([edge]) .sidenav { display: none; }

    /* Dispositivi touch in verticale: invito a ruotare lo smartphone */
    .rotate {
      display: none; position: fixed; inset: 0; z-index: 2147483400;
      flex-direction: column; align-items: center; justify-content: center; gap: 26px;
      padding: 24px; text-align: center; color: #fff;
      background: radial-gradient(ellipse 80% 55% at 50% 45%, rgba(107,31,122,0.5), rgba(13,15,30,0) 70%), #0d0f1e;
      font-family: var(--exd-sans, -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif);
      font-weight: 300; font-size: 18px; letter-spacing: 0.02em;
    }
    .rotate svg { width: 104px; height: 104px; overflow: visible; }
    .rotate .phone { transform-origin: 52px 52px; animation: rotate-phone 3s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
    .rotate .arc { stroke-dasharray: 70; stroke-dashoffset: 70; animation: rotate-arc 3s ease-in-out infinite; }
    @keyframes rotate-phone {
      0%, 22%   { transform: rotate(0deg); }
      48%, 78%  { transform: rotate(-90deg); }
      96%, 100% { transform: rotate(0deg); }
    }
    @keyframes rotate-arc {
      0%, 18%  { stroke-dashoffset: 70; opacity: 0; }
      26%      { opacity: 1; }
      46%      { stroke-dashoffset: 0; opacity: 1; }
      70%, 100% { stroke-dashoffset: 0; opacity: 0; }
    }
    @media (orientation: portrait) and (hover: none) and (pointer: coarse) {
      .rotate { display: flex; }
    }
    /* Hide side nav on touch devices — tap zones already cover navigation. */
    @media (hover: none) and (pointer: coarse) {
      .sidenav { display: none; }
    }

    /* Tap zones for mobile — back/forward thirds like Stories.
       Transparent, no visible UI, don't block the overlay. */
    .tapzones {
      position: fixed;
      inset: 0;
      display: flex;
      z-index: 2147482000;
      pointer-events: none;
    }
    .tapzone {
      flex: 1;
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
    }
    /* Only activate tap zones on coarse pointers (touch devices). */
    @media (hover: hover) and (pointer: fine) {
      .tapzones { display: none; }
    }

    .overlay {
      position: fixed;
      left: 50%;
      bottom: 22px;
      transform: translate(-50%, 6px) scale(0.92);
      filter: blur(6px);
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      background: #000;
      color: #fff;
      border-radius: 999px;
      font-size: 12px;
      font-feature-settings: "tnum" 1;
      letter-spacing: 0.01em;
      opacity: 0;
      pointer-events: none;
      transition: opacity 260ms ease, transform 260ms cubic-bezier(.2,.8,.2,1), filter 260ms ease;
      transform-origin: center bottom;
      z-index: 2147483000;
      user-select: none;
    }
    .overlay[data-visible] {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0) scale(1);
      filter: blur(0);
    }

    .btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      cursor: default;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 28px;
      min-width: 28px;
      border-radius: 999px;
      color: rgba(255,255,255,0.72);
      transition: background 140ms ease, color 140ms ease;
      -webkit-tap-highlight-color: transparent;
    }
    .btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .btn:active { background: rgba(255,255,255,0.18); }
    .btn:focus { outline: none; }
    .btn:focus-visible { outline: none; }
    .btn::-moz-focus-inner { border: 0; }
    .btn svg { width: 14px; height: 14px; display: block; }
    .btn.icon { width: 28px; }
    .btn.fs .i-exit { display: none; }
    :host([fullscreen]) .btn.fs .i-enter { display: none; }
    :host([fullscreen]) .btn.fs .i-exit { display: block; }
    .btn.pdf { gap: 5px; padding: 0 10px 0 8px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; }
    .btn.reset {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      padding: 0 10px 0 12px;
      gap: 6px;
      color: rgba(255,255,255,0.72);
    }
    .btn.reset .kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 10px;
      line-height: 1;
      color: rgba(255,255,255,0.88);
      background: rgba(255,255,255,0.12);
      border-radius: 4px;
    }

    .count {
      font-variant-numeric: tabular-nums;
      color: #fff;
      font-weight: 500;
      padding: 0 8px;
      min-width: 42px;
      text-align: center;
      font-size: 12px;
    }
    .count .sep { color: rgba(255,255,255,0.45); margin: 0 3px; font-weight: 400; }
    .count .total { color: rgba(255,255,255,0.55); }

    .divider {
      width: 1px;
      height: 14px;
      background: rgba(255,255,255,0.18);
      margin: 0 2px;
    }

    /* ── Print: one page per slide, no chrome ────────────────────────────
       The screen layout stacks every slide at inset:0 inside a scaled
       canvas; for print we want them in document flow at the authored
       design size so the browser paginates one slide per sheet. The
       @page size is set from the width/height attributes via the inline
       <style id="deck-stage-print-page"> that connectedCallback injects
       into <head> (the @page at-rule has no effect inside shadow DOM). */
    @media print {
      :host {
        position: static;
        inset: auto;
        background: none;
        overflow: visible;
        color: inherit;
      }
      .stage { position: static; display: block; }
      .canvas {
        transform: none !important;
        width: auto !important;
        height: auto !important;
        background: none;
        will-change: auto;
      }
      ::slotted(*) {
        position: relative !important;
        inset: auto !important;
        width: var(--deck-design-w) !important;
        height: var(--deck-design-h) !important;
        box-sizing: border-box !important;
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto;
        break-after: page;
        page-break-after: always;
        break-inside: avoid;
        overflow: hidden;
      }
      ::slotted(*:last-child) {
        break-after: auto;
        page-break-after: auto;
      }
      .overlay, .tapzones, .sidenav, .rotate { display: none !important; }
    }
  `;

  class DeckStage extends HTMLElement {
    static get observedAttributes() { return ['width', 'height', 'noscale']; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: 'open' });
      this._index = 0;
      this._slides = [];
      this._notes = [];
      this._hideTimer = null;
      this._mouseIdleTimer = null;

      this._onKey = this._onKey.bind(this);
      this._onResize = this._onResize.bind(this);
      this._onSlotChange = this._onSlotChange.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onTapBack = this._onTapBack.bind(this);
      this._onTapForward = this._onTapForward.bind(this);
      this._onGridKey = this._onGridKey.bind(this);
      this._grid = null;
      this._onBeforePrint = this._onBeforePrint.bind(this);
      this._onAfterPrint = this._onAfterPrint.bind(this);
      this._printShadows = [];
      this._printActivated = [];
      this._printFrozen = [];
    }

    get designWidth() {
      return parseInt(this.getAttribute('width'), 10) || DESIGN_W_DEFAULT;
    }
    get designHeight() {
      return parseInt(this.getAttribute('height'), 10) || DESIGN_H_DEFAULT;
    }

    connectedCallback() {
      this._render();
      this._loadNotes();
      this._syncPrintPageRule();
      window.addEventListener('keydown', this._onKey);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('mousemove', this._onMouseMove, { passive: true });
      document.addEventListener('fullscreenchange', this._onResize);
      document.addEventListener('webkitfullscreenchange', this._onResize);
      window.addEventListener('beforeprint', this._onBeforePrint);
      window.addEventListener('afterprint', this._onAfterPrint);
      this._injectGridStyle();
      // Initial collection + layout happens via slotchange, which fires on mount.
    }

    disconnectedCallback() {
      window.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      window.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('fullscreenchange', this._onResize);
      document.removeEventListener('webkitfullscreenchange', this._onResize);
      window.removeEventListener('beforeprint', this._onBeforePrint);
      window.removeEventListener('afterprint', this._onAfterPrint);
      this._closeGrid();
      if (this._hideTimer) clearTimeout(this._hideTimer);
      if (this._mouseIdleTimer) clearTimeout(this._mouseIdleTimer);
    }

    attributeChangedCallback() {
      if (this._canvas) {
        this._canvas.style.width = this.designWidth + 'px';
        this._canvas.style.height = this.designHeight + 'px';
        this._canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
        this._canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');
        this._fit();
        this._syncPrintPageRule();
      }
    }

    _render() {
      const style = document.createElement('style');
      style.textContent = stylesheet;

      const stage = document.createElement('div');
      stage.className = 'stage';

      const canvas = document.createElement('div');
      canvas.className = 'canvas';
      canvas.style.width = this.designWidth + 'px';
      canvas.style.height = this.designHeight + 'px';
      canvas.style.setProperty('--deck-design-w', this.designWidth + 'px');
      canvas.style.setProperty('--deck-design-h', this.designHeight + 'px');

      const slot = document.createElement('slot');
      slot.addEventListener('slotchange', this._onSlotChange);
      canvas.appendChild(slot);
      stage.appendChild(canvas);

      // Tap zones (mobile): left third = back, right third = forward.
      const tapzones = document.createElement('div');
      tapzones.className = 'tapzones export-hidden';
      tapzones.setAttribute('aria-hidden', 'true');
      tapzones.setAttribute('data-noncommentable', '');
      const tzBack = document.createElement('div');
      tzBack.className = 'tapzone tapzone--back';
      const tzMid = document.createElement('div');
      tzMid.className = 'tapzone tapzone--mid';
      tzMid.style.pointerEvents = 'none';
      const tzFwd = document.createElement('div');
      tzFwd.className = 'tapzone tapzone--fwd';
      tzBack.addEventListener('click', this._onTapBack);
      tzFwd.addEventListener('click', this._onTapForward);
      tapzones.append(tzBack, tzMid, tzFwd);

      // Overlay: compact, solid black, with clickable controls.
      const overlay = document.createElement('div');
      overlay.className = 'overlay export-hidden';
      overlay.setAttribute('role', 'toolbar');
      overlay.setAttribute('aria-label', 'Deck controls');
      overlay.setAttribute('data-noncommentable', '');
      overlay.innerHTML = `
        <button class="btn prev" type="button" aria-label="Previous slide" title="Previous (←)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>
        </button>
        <span class="count" aria-live="polite"><span class="current">1</span><span class="sep">/</span><span class="total">1</span></span>
        <button class="btn next" type="button" aria-label="Next slide" title="Next (→)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>
        </button>
        <span class="divider"></span>
        <button class="btn reset" type="button" aria-label="Reset to first slide" title="Reset (R)">Reset<span class="kbd">R</span></button>
        <span class="divider"></span>
        <button class="btn icon grid" type="button" aria-label="Griglia delle slide" title="Griglia delle slide (G)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
        </button>
        <button class="btn icon fs" type="button" aria-label="Schermo intero" title="Schermo intero (F)">
          <svg class="i-enter" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"/></svg>
          <svg class="i-exit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4"/></svg>
        </button>
        <button class="btn pdf" type="button" aria-label="Esporta in PDF" title="Esporta in PDF (P)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13.5h10"/></svg>PDF
        </button>
      `;

      overlay.querySelector('.prev').addEventListener('click', () => this._go(this._index - 1, 'click'));
      overlay.querySelector('.next').addEventListener('click', () => this._go(this._index + 1, 'click'));
      overlay.querySelector('.reset').addEventListener('click', () => this._go(0, 'click'));
      overlay.querySelector('.grid').addEventListener('click', () => this._openGrid());
      overlay.querySelector('.fs').addEventListener('click', () => this._toggleFullscreen());
      overlay.querySelector('.pdf').addEventListener('click', () => this._exportPdf());

      // Persistent side navigation arrows (visible by default on desktop).
      const navPrev = document.createElement('button');
      navPrev.type = 'button';
      navPrev.className = 'sidenav prev export-hidden';
      navPrev.setAttribute('aria-label', 'Previous slide');
      navPrev.setAttribute('title', 'Previous (←)');
      navPrev.setAttribute('data-noncommentable', '');
      navPrev.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
      navPrev.addEventListener('click', () => this._go(this._index - 1, 'click'));

      const navNext = document.createElement('button');
      navNext.type = 'button';
      navNext.className = 'sidenav next export-hidden';
      navNext.setAttribute('aria-label', 'Next slide');
      navNext.setAttribute('title', 'Next (→)');
      navNext.setAttribute('data-noncommentable', '');
      navNext.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
      navNext.addEventListener('click', () => this._go(this._index + 1, 'click'));

      // Invito a ruotare (visibile solo su touch in verticale, via CSS)
      const rotate = document.createElement('div');
      rotate.className = 'rotate export-hidden';
      rotate.setAttribute('role', 'status');
      rotate.innerHTML = `
        <svg viewBox="0 0 104 104" fill="none" aria-hidden="true">
          <g class="arc" stroke="#e9193e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M92 46A40 40 0 0 0 58 12"/><path d="M65 7l-7 5 6 6"/>
          </g>
          <g class="phone" stroke="#fff" stroke-width="3" stroke-linecap="round">
            <rect x="33" y="16" width="38" height="72" rx="8"/><path d="M47 25h10"/>
          </g>
        </svg>
        <span>Ruota lo smartphone</span>`;

      this._root.append(style, stage, tapzones, navPrev, navNext, overlay, rotate);
      this._canvas = canvas;
      this._slot = slot;
      this._overlay = overlay;
      this._navPrev = navPrev;
      this._navNext = navNext;
      this._countEl = overlay.querySelector('.current');
      this._totalEl = overlay.querySelector('.total');
    }

    /** @page must live in the document stylesheet — it's a no-op inside
     *  shadow DOM. Inject/update a single <head> style tag so the print
     *  sheet matches the design size and Save-as-PDF yields one slide per
     *  page with no margins. */
    _syncPrintPageRule() {
      const id = 'deck-stage-print-page';
      let tag = document.getElementById(id);
      if (!tag) {
        tag = document.createElement('style');
        tag.id = id;
        document.head.appendChild(tag);
      }
      tag.textContent =
        '@page { size: ' + this.designWidth + 'px ' + this.designHeight + 'px; margin: 0; } ' +
        '@media print { html, body { margin: 0 !important; padding: 0 !important; background: none !important; overflow: visible !important; height: auto !important; } ' +
        '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; } ' +
        // Nel PDF niente transizioni; le animazioni le porta allo stato finale _onBeforePrint
        '*, *::before, *::after { transition: none !important; } }';
    }

    _onSlotChange() {
      this._collectSlides();
      this._restoreIndex();
      this._applyIndex({ showOverlay: false, broadcast: true, reason: 'init' });
      this._fit();
    }

    _collectSlides() {
      const assigned = this._slot.assignedElements({ flatten: true });
      this._slides = assigned.filter((el) => {
        // Skip template/style/script nodes even if someone slots them.
        const tag = el.tagName;
        return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE';
      });

      this._slides.forEach((slide, i) => {
        const n = i + 1;
        // Determine a label for comment flow: prefer explicit data-label,
        // then an existing data-screen-label, then first heading, else "Slide".
        let label = slide.getAttribute('data-label');
        if (!label) {
          const existing = slide.getAttribute('data-screen-label');
          if (existing) {
            // Strip any leading number the author may have included.
            label = existing.replace(/^\s*\d+\s*/, '').trim() || existing;
          }
        }
        if (!label) {
          const h = slide.querySelector('h1, h2, h3, [data-title]');
          if (h) label = (h.textContent || '').trim().slice(0, 40);
        }
        if (!label) label = 'Slide';
        slide.setAttribute('data-screen-label', `${pad2(n)} ${label}`);

        // Validation attribute for comment flow / auto-checks.
        if (!slide.hasAttribute('data-om-validate')) {
          slide.setAttribute('data-om-validate', VALIDATE_ATTR);
        }

        slide.setAttribute('data-deck-slide', String(i));
      });

      if (this._totalEl) this._totalEl.textContent = String(this._slides.length || 1);
      if (this._index >= this._slides.length) this._index = Math.max(0, this._slides.length - 1);
    }

    _loadNotes() {
      const tag = document.getElementById('speaker-notes');
      if (!tag) { this._notes = []; return; }
      try {
        const parsed = JSON.parse(tag.textContent || '[]');
        if (Array.isArray(parsed)) this._notes = parsed;
      } catch (e) {
        console.warn('[deck-stage] Failed to parse #speaker-notes JSON:', e);
        this._notes = [];
      }
    }

    _restoreIndex() {
      // The host's ?slide= param is delivered as a #<int> hash (1-indexed) on
      // the iframe src. No hash → slide 1; the deck itself keeps no position
      // state across loads.
      const h = (location.hash || '').match(/^#(\d+)$/);
      if (h) {
        const n = parseInt(h[1], 10) - 1;
        if (n >= 0 && n < this._slides.length) this._index = n;
      }
    }

    _applyIndex({ showOverlay = true, broadcast = true, reason = 'init' } = {}) {
      if (!this._slides.length) return;
      const prev = this._prevIndex == null ? -1 : this._prevIndex;
      const curr = this._index;
      // Keep the iframe's own hash in sync so an in-iframe location.reload()
      // (reload banner path in viewer-handle.ts) lands on the current slide,
      // not the stale deep-link hash from initial load.
      try { history.replaceState(null, '', '#' + (curr + 1)); } catch (e) {}
      this._slides.forEach((s, i) => {
        if (i === curr) s.setAttribute('data-deck-active', '');
        else s.removeAttribute('data-deck-active');
      });
      if (this._countEl) this._countEl.textContent = String(curr + 1);
      this._syncBackdrop();
      // Dim side nav arrows at the deck edges.
      if (this._navPrev) this._navPrev.disabled = curr <= 0;
      if (this._navNext) this._navNext.disabled = curr >= this._slides.length - 1;
      const gated = !!(this._slides[curr] && this._slides[curr].hasAttribute('data-deck-gate'));
      if (this._navNext) this._navNext.style.visibility = gated ? 'hidden' : '';

      if (broadcast) {
        // (1) Legacy: host-window postMessage for speaker-notes renderers.
        try { window.postMessage({ slideIndexChanged: curr }, '*'); } catch (e) {}

        // (2) In-page CustomEvent on the <deck-stage> element itself.
        //     Bubbles and composes out of shadow DOM so slide code can listen:
        //       document.querySelector('deck-stage').addEventListener('slidechange', e => {
        //         e.detail.index, e.detail.previousIndex, e.detail.total, e.detail.slide, e.detail.reason
        //       });
        const detail = {
          index: curr,
          previousIndex: prev,
          total: this._slides.length,
          slide: this._slides[curr] || null,
          previousSlide: prev >= 0 ? (this._slides[prev] || null) : null,
          reason: reason, // 'init' | 'keyboard' | 'click' | 'tap' | 'api'
        };
        this.dispatchEvent(new CustomEvent('slidechange', {
          detail,
          bubbles: true,
          composed: true,
        }));
      }

      this._prevIndex = curr;
      if (showOverlay) this._flashOverlay();
    }

    _flashOverlay() {
      if (!this._overlay) return;
      this._overlay.setAttribute('data-visible', '');
      if (this._hideTimer) clearTimeout(this._hideTimer);
      this._hideTimer = setTimeout(() => {
        this._overlay.removeAttribute('data-visible');
      }, OVERLAY_HIDE_MS);
    }

    _fit() {
      if (!this._canvas) return;
      // PPTX export sets noscale so the DOM capture sees authored-size
      // geometry — the scaled canvas is in shadow DOM, so the exporter's
      // resetTransformSelector can't reach .canvas.style.transform directly.
      if (this.hasAttribute('noscale')) {
        this._canvas.style.transform = 'none';
        return;
      }
      // Reserve room for the visual margin (top/bottom) and side gutters
      // where the always-visible nav arrows live, so the slide canvas never
      // sits flush to the viewport edge or under the buttons.
      // A schermo intero, sui dispositivi touch e sugli schermi stretti (dove le
      // frecce laterali non servono) la slide usa tutto lo spazio: niente margini.
      const full = this._isFullscreen();
      const edge = full || window.innerWidth < 900 ||
        window.matchMedia('(hover: none) and (pointer: coarse)').matches;
      this.toggleAttribute('fullscreen', full);
      this.toggleAttribute('edge', edge);
      const gx = edge ? 0 : VIEWER_SIDE_GUTTER;
      const gy = edge ? 0 : VIEWER_MARGIN;
      const vw = Math.max(0, window.innerWidth - gx * 2);
      const vh = Math.max(0, window.innerHeight - gy * 2);
      const s = Math.min(vw / this.designWidth, vh / this.designHeight);
      this._canvas.style.transform = `scale(${s})`;
      this._syncBackdrop();
    }

    _onResize() { this._fit(); }

    _onMouseMove() {
      // Keep overlay visible while mouse moves; hide after idle.
      this._flashOverlay();
    }

    _onTapBack(e) {
      e.preventDefault();
      this._go(this._index - 1, 'tap');
    }

    _onTapForward(e) {
      e.preventDefault();
      this._go(this._index + 1, 'tap');
    }

    _onKey(e) {
      // Ignore when the user is typing.
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;
      let handled = true;

      if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
        this._go(this._index + 1, 'keyboard');
      } else if (key === 'ArrowLeft' || key === 'PageUp') {
        this._go(this._index - 1, 'keyboard');
      } else if (key === 'Home') {
        this._go(0, 'keyboard');
      } else if (key === 'End') {
        this._go(this._slides.length - 1, 'keyboard');
      } else if (key === 'r' || key === 'R') {
        this._go(0, 'keyboard');
      } else if (key === 'f' || key === 'F') {
        this._toggleFullscreen();
      } else if (key === 'g' || key === 'G') {
        this._openGrid();
      } else if (key === 'p' || key === 'P') {
        this._exportPdf();
      } else if (/^[0-9]$/.test(key)) {
        // 1..9 jump to that slide; 0 jumps to 10.
        const n = key === '0' ? 9 : parseInt(key, 10) - 1;
        if (n < this._slides.length) this._go(n, 'keyboard');
      } else {
        handled = false;
      }

      if (handled) {
        e.preventDefault();
        this._flashOverlay();
      }
    }

    _go(i, reason = 'api') {
      if (!this._slides.length) return;
      const clamped = Math.max(0, Math.min(this._slides.length - 1, i));
      // A slide marked data-deck-gate stops forward navigation (keys, taps, the
      // arrows): the viewer has to pick a path from the slide itself. The slide
      // gets a 'deckgate' event so it can point at the choices.
      const cur = this._slides[this._index];
      if (clamped > this._index && cur && cur.hasAttribute('data-deck-gate') &&
          (reason === 'keyboard' || reason === 'tap' || reason === 'click')) {
        cur.dispatchEvent(new CustomEvent('deckgate', { bubbles: true }));
        return;
      }
      // A slide can play an exit before the deck moves on to the next one:
      // slide._beforeNext() returns a promise (or nothing, to skip it). If the
      // promise resolves to false the deck stays on the slide.
      if (this._leaving) return;
      if (clamped === this._index + 1 && cur && typeof cur._beforeNext === 'function') {
        const p = cur._beforeNext(reason);
        if (p && typeof p.then === 'function') {
          this._leaving = true;
          p.then((ok) => {
            this._leaving = false;
            if (ok === false) return;
            this._index = clamped;
            this._applyIndex({ showOverlay: true, broadcast: true, reason });
          });
          return;
        }
      }
      if (clamped === this._index) {
        this._flashOverlay();
        return;
      }
      this._index = clamped;
      this._applyIndex({ showOverlay: true, broadcast: true, reason });
    }

    // Schermo intero ---------------------------------------------------------

    _isFullscreen() {
      // Also the browser window in macOS full screen (green button, ctrl+cmd+F):
      // the Fullscreen API does not see it, but the viewport fills the screen.
      return !!(document.fullscreenElement || document.webkitFullscreenElement) ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        (Math.abs(window.innerWidth - screen.width) <= 1 && Math.abs(window.innerHeight - screen.height) <= 1);
    }

    _toggleFullscreen() {
      const d = document;
      const el = d.documentElement;
      let p;
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        p = (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      } else if (el.requestFullscreen || el.webkitRequestFullscreen) {
        p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        // Dove è consentito (Android), a schermo intero si blocca l'orizzontale
        if (p && p.then) {
          p = p.then(() => {
            if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape').catch(() => {});
          });
        }
      }
      if (p && p.catch) p.catch(() => {});
    }

    /** A tutto schermo le fasce attorno alla slide (schermi non 16:9) prendono
     *  il colore di sfondo della slide corrente: nessuna cornice nera. */
    _syncBackdrop() {
      const slide = this._slides[this._index];
      this.style.background = this.hasAttribute('edge') && slide
        ? getComputedStyle(slide).backgroundColor : '';
    }

    // Esporta in PDF --------------------------------------------------------
    // È la stampa del browser con "Salva come PDF": il layout di stampa (sopra)
    // mette una slide per pagina. All'evento beforeprint (che parte anche con
    // Cmd/Ctrl+P) tutte le slide diventano attive e le loro animazioni vengono
    // portate allo stato finale: così funzionano sia i deck in cui lo stato
    // statico è quello finale, sia quelli in cui i contenuti compaiono solo
    // sotto [data-deck-active].

    _exportPdf() {
      this._closeGrid();
      window.print();
    }

    /** Le ombre sfumate che Chrome mette nel PDF, Anteprima di macOS le disegna
     *  come rettangoli grigi: durante la stampa si tolgono solo i livelli d'ombra
     *  con sfocatura; restano quelli senza (bordi e aloni fatti con box-shadow). */
    _onBeforePrint() {
      this._onAfterPrint();
      this._slides.forEach((slide) => {
        if (slide.hasAttribute('data-deck-active')) return;
        slide.setAttribute('data-deck-active', '');
        this._printActivated.push(slide);
      });
      this._printFrozen = this._freezeAnimations(this);
      document.querySelectorAll('deck-stage > *, deck-stage > * *').forEach((el) => {
        const shadow = getComputedStyle(el).boxShadow;
        if (!shadow || shadow === 'none') return;
        const layers = shadow.split(/,(?![^(]*\))/);
        const kept = layers.filter((layer) => {
          const lengths = layer.replace(/[a-z-]+\([^)]*\)|inset/gi, '').trim().split(/\s+/).map(parseFloat);
          return !(lengths[2] > 0);
        });
        if (kept.length === layers.length) return;
        this._printShadows.push([el, el.style.getPropertyValue('box-shadow'), el.style.getPropertyPriority('box-shadow')]);
        el.style.setProperty('box-shadow', kept.length ? kept.join(',') : 'none', 'important');
      });
    }

    _onAfterPrint() {
      this._printShadows.forEach(([el, value, priority]) => {
        if (value) el.style.setProperty('box-shadow', value, priority);
        else el.style.removeProperty('box-shadow');
      });
      this._printShadows = [];
      this._printActivated.forEach((slide) => {
        if (this._slides[this._index] !== slide) slide.removeAttribute('data-deck-active');
      });
      this._printActivated = [];
      // Le animazioni infinite (blob, nastri) ripartono; quelle finite restano allo stato finale
      this._printFrozen.forEach((a) => { try { a.play(); } catch (e) {} });
      this._printFrozen = [];
    }

    /** Porta le animazioni CSS sotto `root` al loro stato finale; quelle infinite
     *  si fermano a metà del primo giro. Restituisce le animazioni infinite messe
     *  in pausa, da far ripartire. */
    _freezeAnimations(root) {
      const paused = [];
      if (!root.getAnimations) return paused;
      root.getAnimations({ subtree: true }).forEach((a) => {
        try {
          const t = a.effect.getComputedTiming();
          if (t.iterations === Infinity || t.endTime === Infinity) {
            a.currentTime = (t.delay || 0) + (Number(t.duration) || 0) / 2;
            a.pause();
            paused.push(a);
          } else {
            a.finish();
          }
        } catch (e) {}
      });
      return paused;
    }

    // Vista a griglia -------------------------------------------------------
    // Le miniature sono copie delle slide messe fuori da <deck-stage>, ridotte
    // con transform; le copie sono "attive" e le loro animazioni ferme nello
    // stato finale. Gli stili scritti come `deck-stage section {…}` non valgono
    // fuori dal componente: sfondo, padding e colore si copiano dall'originale.

    _injectGridStyle() {
      if (document.getElementById('deck-stage-grid-style')) return;
      const tag = document.createElement('style');
      tag.id = 'deck-stage-grid-style';
      tag.textContent = `
        .deck-grid { position: fixed; inset: 0; z-index: 2147483600; overflow-y: auto; box-sizing: border-box;
          padding: 40px 48px 56px; background: #080717;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 32px 24px;
          justify-items: center; align-content: start;
          font: 500 12px/1.3 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif; }
        .deck-grid-head { grid-column: 1 / -1; justify-self: stretch; display: flex; justify-content: space-between;
          color: rgba(255,255,255,0.55); letter-spacing: 0.04em; }
        .deck-grid-item { appearance: none; -webkit-appearance: none; border: 0; padding: 0; margin: 0; background: none;
          cursor: pointer; display: flex; flex-direction: column; gap: 10px; text-align: left;
          font: inherit; color: rgba(255,255,255,0.72); letter-spacing: 0.02em; }
        .deck-grid-item:focus { outline: none; }
        .deck-grid-thumb { position: relative; overflow: hidden; border-radius: 10px;
          box-shadow: 0 0 0 1px rgba(255,255,255,0.14); transition: box-shadow .15s ease, transform .15s ease; }
        .deck-grid-item:hover .deck-grid-thumb,
        .deck-grid-item:focus-visible .deck-grid-thumb { box-shadow: 0 0 0 2px rgba(255,255,255,0.7); transform: translateY(-2px); }
        .deck-grid-item.is-current .deck-grid-thumb { box-shadow: 0 0 0 3px #e9193e; }
        .deck-grid-item.is-current { color: #fff; }
        .deck-grid-thumb *, .deck-grid-thumb *::before, .deck-grid-thumb *::after { transition: none !important; }
        .deck-grid-thumb .rv { opacity: 1 !important; transform: none !important; }
        @media print { .deck-grid { display: none !important; } }
      `;
      document.head.appendChild(tag);
    }

    _openGrid() {
      if (this._grid || !this._slides.length) return;
      const W = 320;
      const scale = W / this.designWidth;
      const grid = document.createElement('div');
      grid.className = 'deck-grid';
      grid.setAttribute('role', 'dialog');
      grid.setAttribute('aria-label', 'Tutte le slide');
      const head = document.createElement('div');
      head.className = 'deck-grid-head';
      head.innerHTML = '<span>Tutte le slide</span><span>Esc o G per chiudere</span>';
      grid.appendChild(head);
      this._slides.forEach((slide, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'deck-grid-item' + (i === this._index ? ' is-current' : '');
        const thumb = document.createElement('div');
        thumb.className = 'deck-grid-thumb';
        thumb.style.width = W + 'px';
        thumb.style.height = Math.round(this.designHeight * scale) + 'px';
        const clone = slide.cloneNode(true);
        clone.setAttribute('data-deck-active', '');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('inert', '');
        const cs = getComputedStyle(slide);
        THUMB_COPY.forEach((prop) => { if (!clone.style.getPropertyValue(prop)) clone.style.setProperty(prop, cs.getPropertyValue(prop)); });
        clone.style.cssText += ';position:absolute;left:0;top:0;width:' + this.designWidth + 'px;height:' +
          this.designHeight + 'px;transform:scale(' + scale + ');transform-origin:0 0;';
        // I <canvas> non si copiano con cloneNode: si ridisegna il loro contenuto attuale
        const srcCanvases = slide.querySelectorAll('canvas');
        clone.querySelectorAll('canvas').forEach((c, k) => {
          try { c.getContext('2d').drawImage(srcCanvases[k], 0, 0); } catch (e) {}
        });
        // Contenuti animati via script: nelle miniature vanno nello stato finale.
        clone.querySelectorAll('[data-typewriter]').forEach((el) => { el.textContent = el.dataset.typewriter; });
        clone.querySelectorAll('[data-count-to]').forEach((el) => { el.textContent = el.dataset.countTo; });
        thumb.appendChild(clone);
        const label = document.createElement('span');
        label.textContent = slide.getAttribute('data-screen-label') || String(i + 1);
        item.append(thumb, label);
        item.addEventListener('click', () => { this._closeGrid(); this._go(i, 'click'); });
        grid.appendChild(item);
      });
      grid.addEventListener('click', (e) => { if (e.target === grid) this._closeGrid(); });
      document.body.appendChild(grid);
      this._freezeAnimations(grid);
      this._grid = grid;
      window.addEventListener('keydown', this._onGridKey, true);
      const current = grid.querySelector('.is-current');
      if (current) { current.scrollIntoView({ block: 'center' }); current.focus({ preventScroll: true }); }
    }

    _closeGrid() {
      if (!this._grid) return;
      this._grid.remove();
      this._grid = null;
      window.removeEventListener('keydown', this._onGridKey, true);
    }

    /** Con la griglia aperta i tasti non arrivano al deck: Esc o G chiudono,
     *  Tab/Invio/Spazio restano per muoversi e scegliere tra le miniature. */
    _onGridKey(e) {
      e.stopImmediatePropagation();
      if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        this._closeGrid();
      } else if (!['Tab', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
      }
    }

    // Public API ------------------------------------------------------------

    /** Current slide index (0-based). */
    get index() { return this._index; }
    /** Total slide count. */
    get length() { return this._slides.length; }
    /** Programmatically navigate. */
    goTo(i) { this._go(i, 'api'); }
    next() { this._go(this._index + 1, 'api'); }
    prev() { this._go(this._index - 1, 'api'); }
    reset() { this._go(0, 'api'); }
  }

  if (!customElements.get('deck-stage')) {
    customElements.define('deck-stage', DeckStage);
  }
})();
