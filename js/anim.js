/* SHIELD — anim.js
 * Awaitable animation toolkit built on the Web Animations API.
 * Every function returns a Promise; game logic awaits them to sequence combat.
 * Only transform/opacity/filter are animated (compositor-friendly).
 */
(function (global) {
  'use strict';

  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* central pacing config — tuned light & snappy */
  var D = {
    deal: 240,
    dealStagger: 70,
    flyIn: 320,      // deck -> stage
    flip: 240,
    stagePause: 340, // short beat while the drawn card is revealed
    strike: 380,     // stage -> target
    shake: 280,
    floatText: 850,
    tumble: 330,     // card -> discard
    dissolve: 380,
    banner: 600,
    hpTween: 450
  };

  function dur(ms) { return reduced ? Math.min(ms, 60) : ms; }

  function wait(ms) {
    return new Promise(function (r) { setTimeout(r, dur(ms)); });
  }

  function animate(el, frames, opts) {
    opts = opts || {};
    try {
      var a = el.animate(frames, {
        duration: dur(opts.duration || 300),
        easing: opts.easing || 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: opts.fill || 'both',
        delay: opts.delay ? dur(opts.delay) : 0
      });
      return a.finished.then(function () {
        // effects that end at the element's natural state release their fill,
        // so CSS idle animations (card wobble etc.) resume afterwards
        if (opts.autoCancel) a.cancel();
      }).catch(function () {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  function rect(el) { return el.getBoundingClientRect(); }

  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  /* ---------------- flying ghost cards ---------------- */

  /* Position a ghost (already appended to #fx-layer) at `from` and fly it to `to`.
   * opts: {duration, arc (px of perpendicular bow), rotFrom, rotTo, fadeOut, easing}
   */
  function flyGhost(ghost, from, to, opts) {
    opts = opts || {};
    ghost.style.width = from.width + 'px';
    ghost.style.height = from.height + 'px';
    ghost.style.transformOrigin = '0 0';
    var sx = to.width / from.width;
    var sy = to.height / from.height;
    var rotF = opts.rotFrom || 0;
    var rotT = opts.rotTo || 0;

    var frames = [{
      transform: 'translate(' + from.left + 'px,' + from.top + 'px) rotate(' + rotF + 'deg) scale(1)',
      opacity: 1
    }];

    if (opts.arc) {
      var mx = (from.left + to.left) / 2;
      var my = (from.top + to.top) / 2;
      var dx = to.left - from.left;
      var dy = to.top - from.top;
      var len = Math.max(Math.hypot(dx, dy), 1);
      // perpendicular bow
      var nx = -dy / len * opts.arc;
      var ny = dx / len * opts.arc;
      frames.push({
        transform: 'translate(' + (mx + nx) + 'px,' + (my + ny) + 'px) rotate(' + ((rotF + rotT) / 2) + 'deg) scale(' + ((1 + sx) / 2) + ',' + ((1 + sy) / 2) + ')',
        opacity: 1,
        offset: 0.5
      });
    }

    frames.push({
      transform: 'translate(' + to.left + 'px,' + to.top + 'px) rotate(' + rotT + 'deg) scale(' + sx + ',' + sy + ')',
      opacity: opts.fadeOut ? 0 : 1
    });

    return animate(ghost, frames, {
      duration: opts.duration || D.flyIn,
      easing: opts.easing || 'cubic-bezier(0.32, 0.72, 0.24, 1)'
    });
  }

  /* Flip a ghost's inner face mid-flight (or in place). fromDeg -> toDeg on rotateY. */
  function flipInner(ghost, fromDeg, toDeg, duration) {
    var inner = ghost.querySelector('.card-inner');
    if (!inner) return Promise.resolve();
    inner.style.transition = 'none';
    return animate(inner, [
      { transform: 'rotateY(' + fromDeg + 'deg)' },
      { transform: 'rotateY(' + toDeg + 'deg)' }
    ], { duration: duration || D.flip, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
  }

  /* ---------------- combat feedback ---------------- */

  function floatText(x, y, text, cls, opts) {
    opts = opts || {};
    var el = document.createElement('div');
    el.className = 'float-text ' + (cls || 'info');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.getElementById('fx-layer').appendChild(el);
    var drift = (Math.random() - 0.5) * 30;
    return animate(el, [
      { transform: 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
      { transform: 'translate(calc(-50% + ' + drift * 0.3 + 'px), -68%) scale(1.15)', opacity: 1, offset: 0.18 },
      { transform: 'translate(calc(-50% + ' + drift + 'px), calc(-50% - 85px)) scale(1)', opacity: 0 }
    ], { duration: opts.duration || D.floatText, easing: 'cubic-bezier(0.22, 0.9, 0.36, 1)' })
      .then(function () { el.remove(); });
  }

  function shakeTable(intensity) {
    var el = document.getElementById('table-shake');
    var i = Math.min(intensity || 4, 12);
    var frames = [{ transform: 'translate(0,0)' }];
    for (var k = 0; k < 6; k++) {
      var f = 1 - k / 6;
      frames.push({
        transform: 'translate(' + ((Math.random() - 0.5) * 2 * i * f).toFixed(1) + 'px,' +
          ((Math.random() - 0.5) * 2 * i * f).toFixed(1) + 'px)'
      });
    }
    frames.push({ transform: 'translate(0,0)' });
    return animate(el, frames, { duration: D.shake, easing: 'linear', autoCancel: true });
  }

  /* flash a slot's overlay in a given color */
  function flashSlot(slotEl, color, peak) {
    var flash = slotEl.querySelector('.slot-flash');
    if (!flash) {
      flash = document.createElement('div');
      flash.className = 'slot-flash';
      slotEl.appendChild(flash);
    }
    flash.style.setProperty('--flash-color', color);
    return animate(flash, [
      { opacity: 0 },
      { opacity: peak || 0.9, offset: 0.25 },
      { opacity: 0 }
    ], { duration: 420, easing: 'ease-out', autoCancel: true });
  }

  /* scale/blur a card out of existence (counter scramble) */
  function dissolveCard(cardEl) {
    return animate(cardEl, [
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0px) brightness(1)' },
      { transform: 'scale(1.15)', opacity: 0.9, filter: 'blur(0px) brightness(2.2)', offset: 0.3 },
      { transform: 'scale(0.55) rotate(6deg)', opacity: 0, filter: 'blur(6px) brightness(0.6)' }
    ], { duration: D.dissolve, easing: 'ease-in' });
  }

  function popIn(el) {
    return animate(el, [
      { transform: 'scale(1.35)', opacity: 0, filter: 'brightness(2.4)' },
      { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }
    ], { duration: 260, easing: 'cubic-bezier(0.22, 1.3, 0.36, 1)', autoCancel: true });
  }

  function pulse(el, scale) {
    return animate(el, [
      { transform: 'scale(1)' },
      { transform: 'scale(' + (scale || 1.22) + ')', offset: 0.4 },
      { transform: 'scale(1)' }
    ], { duration: 380, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', autoCancel: true });
  }

  /* animated number ticker for HP orbs */
  function countTo(el, from, to, ms) {
    ms = dur(ms || D.hpTween);
    return new Promise(function (resolve) {
      if (from === to || ms <= 60) { el.textContent = String(to); return resolve(); }
      var t0 = performance.now();
      (function frame(now) {
        var t = Math.min((now - t0) / ms, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(from + (to - from) * eased));
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      })(t0);
    });
  }

  function bannerIn(el) {
    return animate(el, [
      { transform: 'translateY(-16px) scale(0.92)', opacity: 0 },
      { transform: 'translateY(0) scale(1)', opacity: 1 }
    ], { duration: 380, easing: 'cubic-bezier(0.22, 1.3, 0.36, 1)', autoCancel: true });
  }

  global.Shield = global.Shield || {};
  global.Shield.anim = {
    D: D,
    dur: dur,
    wait: wait,
    animate: animate,
    rect: rect,
    center: center,
    flyGhost: flyGhost,
    flipInner: flipInner,
    floatText: floatText,
    shakeTable: shakeTable,
    flashSlot: flashSlot,
    dissolveCard: dissolveCard,
    popIn: popIn,
    pulse: pulse,
    countTo: countTo,
    bannerIn: bannerIn
  };
})(window);
