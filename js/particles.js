/* SHIELD — particles.js
 * One full-screen canvas (pointer-events: none), object-pooled particles.
 * Ambient rising embers + positional burst presets.
 */
(function (global) {
  'use strict';

  var canvas, ctx2d;
  var W = 0, H = 0, DPR = 1;
  var pool = [];
  var MAX = 420;
  var running = false;
  var ambientOn = true;
  var lastSpawn = 0;
  var reduced = false;
  try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function resize() {
    DPR = Math.min(global.devicePixelRatio || 1, 2);
    W = global.innerWidth;
    H = global.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx2d.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function spawn(props) {
    if (pool.length >= MAX) return;
    pool.push(Object.assign({
      x: 0, y: 0, vx: 0, vy: 0,
      life: 1, decay: 0.02,
      size: 2, hue: 28, sat: 95, lit: 60,
      gravity: 0, drift: 0, flicker: false,
      shape: 'dot', spin: 0, angle: 0
    }, props));
  }

  /* ---------------- ambient embers ---------------- */

  function spawnEmber() {
    spawn({
      x: Math.random() * W,
      y: H + 8,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -(0.35 + Math.random() * 0.75),
      life: 1,
      decay: 0.0016 + Math.random() * 0.002,
      size: 0.8 + Math.random() * 1.9,
      hue: 18 + Math.random() * 26,
      lit: 52 + Math.random() * 16,
      drift: Math.random() * Math.PI * 2,
      flicker: true
    });
  }

  /* small sparks rising from the wall torches */
  function spawnTorchSparks() {
    var flames = document.querySelectorAll('.t-flame');
    for (var i = 0; i < flames.length; i++) {
      if (Math.random() > 0.6) continue;
      var r = flames[i].getBoundingClientRect();
      if (!r.width) continue;
      spawn({
        x: r.left + r.width * (0.3 + Math.random() * 0.4),
        y: r.top + r.height * 0.35,
        vx: (Math.random() - 0.5) * 0.5,
        vy: -(0.5 + Math.random() * 1.1),
        life: 1,
        decay: 0.012 + Math.random() * 0.014,
        size: 0.7 + Math.random() * 1.4,
        hue: 24 + Math.random() * 22,
        lit: 58 + Math.random() * 20,
        drift: Math.random() * Math.PI * 2,
        flicker: true
      });
    }
  }

  /* ---------------- burst presets ---------------- */

  var presets = {
    impact: function (x, y, power) {
      var n = Math.round(18 + power * 3);
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = 1.5 + Math.random() * (3.2 + power * 0.35);
        spawn({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8,
          life: 1, decay: 0.02 + Math.random() * 0.03,
          size: 1 + Math.random() * 2.6,
          hue: Math.random() < 0.25 ? 48 : 16 + Math.random() * 14,
          lit: 55 + Math.random() * 25,
          gravity: 0.07
        });
      }
    },
    block: function (x, y) {
      for (var i = 0; i < 26; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = 1.2 + Math.random() * 3.4;
        spawn({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: 1, decay: 0.03 + Math.random() * 0.03,
          size: 0.8 + Math.random() * 2,
          hue: 205 + Math.random() * 18, sat: 70,
          lit: 68 + Math.random() * 22,
          shape: Math.random() < 0.3 ? 'spark' : 'dot',
          gravity: 0.02
        });
      }
    },
    dissolve: function (x, y) {
      for (var i = 0; i < 22; i++) {
        spawn({
          x: x + (Math.random() - 0.5) * 30,
          y: y + (Math.random() - 0.5) * 42,
          vx: (Math.random() - 0.5) * 1.1,
          vy: -(0.4 + Math.random() * 1.4),
          life: 1, decay: 0.016 + Math.random() * 0.02,
          size: 1 + Math.random() * 2.4,
          hue: 275 + Math.random() * 30, sat: 55,
          lit: 55 + Math.random() * 20
        });
      }
    },
    heal: function (x, y) {
      for (var i = 0; i < 18; i++) {
        spawn({
          x: x + (Math.random() - 0.5) * 44,
          y: y + (Math.random() - 0.5) * 20,
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.6 + Math.random() * 1.2),
          life: 1, decay: 0.018,
          size: 1 + Math.random() * 2,
          hue: 140 + Math.random() * 20, sat: 65,
          lit: 60 + Math.random() * 20
        });
      }
    },
    ash: function (x, y) {
      for (var i = 0; i < 30; i++) {
        spawn({
          x: x + (Math.random() - 0.5) * 60,
          y: y + (Math.random() - 0.5) * 50,
          vx: (Math.random() - 0.5) * 1.6,
          vy: -(0.1 + Math.random() * 0.9),
          life: 1, decay: 0.012 + Math.random() * 0.015,
          size: 1 + Math.random() * 2.2,
          hue: 20, sat: 8,
          lit: 35 + Math.random() * 25,
          gravity: -0.004
        });
      }
    },
    charge: function (x, y) {
      for (var i = 0; i < 16; i++) {
        var a = Math.random() * Math.PI * 2;
        var r = 26 + Math.random() * 16;
        spawn({
          x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
          vx: -Math.cos(a) * 1.2, vy: -Math.sin(a) * 1.2,
          life: 1, decay: 0.035,
          size: 1 + Math.random() * 1.8,
          hue: 40 + Math.random() * 15,
          lit: 62 + Math.random() * 22,
          shape: 'spark'
        });
      }
    },
    victory: function (x, y) {
      for (var i = 0; i < 60; i++) {
        var a = Math.random() * Math.PI * 2;
        var sp = 1 + Math.random() * 5;
        spawn({
          x: x, y: y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.6,
          life: 1, decay: 0.008 + Math.random() * 0.012,
          size: 1.2 + Math.random() * 2.6,
          hue: Math.random() < 0.7 ? 42 + Math.random() * 14 : 18 + Math.random() * 10,
          lit: 58 + Math.random() * 26,
          gravity: 0.045,
          flicker: true
        });
      }
    }
  };

  function burst(x, y, preset, power) {
    if (reduced) return;
    if (presets[preset]) presets[preset](x, y, power || 3);
  }

  /* ---------------- loop ---------------- */

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    ctx2d.clearRect(0, 0, W, H);

    if (ambientOn && !reduced && now - lastSpawn > 380) {
      lastSpawn = now;
      spawnEmber();
      if (Math.random() < 0.4) spawnEmber();
      spawnTorchSparks();
    }

    ctx2d.globalCompositeOperation = 'lighter';
    for (var i = pool.length - 1; i >= 0; i--) {
      var p = pool[i];
      p.life -= p.decay;
      if (p.life <= 0) { pool.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      if (p.drift) { p.drift += 0.02; p.x += Math.sin(p.drift) * 0.3; }
      var alpha = p.life * (p.flicker ? (0.6 + Math.random() * 0.4) : 1);
      ctx2d.fillStyle = 'hsla(' + p.hue + ',' + p.sat + '%,' + p.lit + '%,' + alpha.toFixed(3) + ')';
      if (p.shape === 'spark') {
        ctx2d.fillRect(p.x - p.size * 1.6, p.y - p.size * 0.35, p.size * 3.2, p.size * 0.7);
      } else {
        ctx2d.beginPath();
        ctx2d.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx2d.fill();
      }
    }
    ctx2d.globalCompositeOperation = 'source-over';
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function init() {
    canvas = document.getElementById('particles');
    ctx2d = canvas.getContext('2d');
    resize();
    global.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { running = false; }
      else { start(); }
    });
    start();
  }

  global.Shield = global.Shield || {};
  global.Shield.particles = {
    init: init,
    burst: burst,
    setAmbient: function (on) { ambientOn = on; }
  };
})(window);
