/* SHIELD — main.js
 * Boot: wires screens, buttons, sound toggle, and debug hooks.
 */
(function (global) {
  'use strict';

  var UI = global.Shield.ui;
  var E = global.Shield.engine;
  var S = global.Shield.sound;
  var P = global.Shield.particles;

  function $(id) { return document.getElementById(id); }

  var playerCount = 3;

  function boot() {
    P.init();
    UI.renderNameInputs(playerCount);

    /* title */
    $('btn-play').addEventListener('click', function () {
      S.play('click');
      UI.showScreen('setup');
    });

    /* setup */
    document.querySelectorAll('.count-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        S.play('click');
        document.querySelectorAll('.count-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        playerCount = parseInt(btn.dataset.count, 10);
        UI.renderNameInputs(playerCount);
      });
    });

    $('btn-back').addEventListener('click', function () {
      S.play('click');
      UI.showScreen('title');
    });

    $('btn-begin').addEventListener('click', function () {
      S.play('click');
      E.startMatch(UI.readNames());
    });

    /* table actions */
    $('btn-attack').addEventListener('click', function () { E.chooseAction('attack'); });
    $('btn-shield').addEventListener('click', function () { E.chooseAction('shield'); });
    $('btn-charge').addEventListener('click', function () { E.chooseAction('charge'); });
    $('btn-gamble').addEventListener('click', function () { E.chooseAction('gamble'); });
    $('btn-cancel').addEventListener('click', function () { S.play('click'); E.cancelTarget(); });

    /* victory */
    $('btn-rematch').addEventListener('click', function () {
      S.play('click');
      E.rematch();
    });
    $('btn-newgame').addEventListener('click', function () {
      S.play('click');
      UI.showScreen('setup');
      E.phase = 'SETUP';
    });

    /* sound toggle */
    var soundBtn = $('btn-sound');
    function paintSound() { soundBtn.classList.toggle('muted', S.isMuted()); }
    soundBtn.addEventListener('click', function () { S.toggleMute(); paintSound(); });
    paintSound();

    /* background music: starts on the first user gesture (autoplay policy) */
    var M = global.Shield.music;
    var musicBtn = $('btn-music');
    function paintMusic() { musicBtn.classList.toggle('muted', M.isMuted()); }
    musicBtn.addEventListener('click', function () { M.toggleMute(); paintMusic(); });
    paintMusic();
    document.addEventListener('pointerdown', function firstGesture() {
      document.removeEventListener('pointerdown', firstGesture);
      if (!M.isMuted()) M.start();
    });

    /* debug hooks: ?debug=1&seed=42 */
    var params = new URLSearchParams(global.location.search);
    if (params.get('seed') !== null) E.seed = parseInt(params.get('seed'), 10);
    if (params.get('debug') === '1') {
      global.__shield = {
        engine: E,
        rules: global.Shield.rules,
        ui: UI,
        get state() { return E.state; },
        forceNextDraw: function (rank) { return global.Shield.rules.forceNextDraw(E.state, rank); }
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
