/* offerta-head.js — nel <head>, prima di tutto il resto: riconosce telefono e tablet
   (anche l'iPad, che si presenta come Mac) e aggiunge html.m-light prima che la pagina si disegni */
  // telefono o tablet (anche iPad, che si presenta come Mac): versione leggera, vedi .m-light
  (function () {
    var n = navigator, touch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touch || /iPhone|iPad|iPod|Android|Mobile/i.test(n.userAgent) || (n.maxTouchPoints > 1 && /Mac/.test(n.platform)))
      document.documentElement.classList.add('m-light');
  })();
