/* deck-mobile-head.js — in the <head>, after offerta-head.js (which recognises phones and tablets, as in
   git-exd/exd-presentazioni). Only a preview aid: ?mobile in the address gives the phone version on a computer
   too, in a narrow window */
(function () {
  if (/[?&]mobile\b/.test(location.search)) document.documentElement.classList.add('m-light');
})();
