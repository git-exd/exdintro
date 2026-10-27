/* deck-mobile-head.js — in the <head>, before everything else (as offerta-head.js in git-exd/exd-presentazioni):
   recognises phones and tablets (the iPad too, which presents itself as a Mac) and adds html.m-light
   before the page is drawn. See deck-mobile.css and deck-mobile.js */
(function () {
  var n = navigator, touch = window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
  // ?mobile in the address: the phone version on a computer too, to preview it in a narrow window
  if (/[?&]mobile\b/.test(location.search) || touch || /iPhone|iPad|iPod|Android|Mobile/i.test(n.userAgent) || (n.maxTouchPoints > 1 && /Mac/.test(n.platform)))
    document.documentElement.classList.add('m-light');
})();
