/* SHIELD — sound.js
 * WebAudio-synthesized effects, zero asset files. Fire-and-forget:
 * Shield.sound.play('hit', {power: 5}) — never throws, never blocks.
 */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var muted = false;
  try { muted = localStorage.getItem('shield-muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.4;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  }

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function env(gainNode, t0, peak, attack, decay) {
    var g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function osc(type, freq, t0, dur, peak, endFreq) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), t0 + dur);
    env(g, t0, peak, 0.008, dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(t0, dur, peak, filterType, freq, endFreq) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    var f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t0);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    f.Q.value = 1.2;
    var g = ctx.createGain();
    env(g, t0, peak, 0.01, dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }

  var synths = {
    click: function () {
      osc('triangle', 640, ctx.currentTime, 0.06, 0.12, 380);
    },
    draw: function () {
      noise(ctx.currentTime, 0.22, 0.14, 'bandpass', 900, 2600);
    },
    flip: function () {
      var t = ctx.currentTime;
      osc('sine', 900, t, 0.05, 0.1, 1400);
      noise(t, 0.05, 0.08, 'highpass', 2500);
    },
    hit: function (opts) {
      var p = Math.min((opts && opts.power) || 3, 12) / 12; // 0..1
      var t = ctx.currentTime;
      osc('sine', 150 + 60 * p, t, 0.28, 0.5 + 0.3 * p, 46);
      noise(t, 0.16 + 0.1 * p, 0.3 + 0.25 * p, 'lowpass', 900);
    },
    block: function () {
      var t = ctx.currentTime;
      osc('square', 520, t, 0.16, 0.16, 500);
      osc('square', 684, t, 0.22, 0.13, 660);
      osc('sine', 1750, t, 0.3, 0.08, 1700);
      noise(t, 0.08, 0.14, 'highpass', 4000);
    },
    charge: function () {
      var t = ctx.currentTime;
      osc('sawtooth', 110, t, 0.5, 0.14, 520);
      osc('sine', 220, t + 0.1, 0.45, 0.1, 880);
    },
    scramble: function () {
      var t = ctx.currentTime;
      noise(t, 0.35, 0.2, 'bandpass', 500, 3000);
      osc('triangle', 300, t + 0.05, 0.3, 0.12, 900);
    },
    heal: function () {
      var t = ctx.currentTime;
      osc('sine', 420, t, 0.3, 0.12, 640);
      osc('sine', 640, t + 0.09, 0.32, 0.1, 860);
    },
    eliminate: function () {
      var t = ctx.currentTime;
      osc('sawtooth', 200, t, 0.9, 0.24, 36);
      noise(t, 0.7, 0.2, 'lowpass', 700, 120);
    },
    reshuffle: function () {
      var t = ctx.currentTime;
      for (var i = 0; i < 5; i++) noise(t + i * 0.05, 0.05, 0.1, 'bandpass', 1400 + i * 300);
    },
    win: function () {
      var t = ctx.currentTime;
      var notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
      for (var i = 0; i < notes.length; i++) {
        osc('sine', notes[i], t + i * 0.13, 0.5, 0.16);
        osc('triangle', notes[i] / 2, t + i * 0.13, 0.5, 0.08);
      }
    },
    deal: function () {
      noise(ctx.currentTime, 0.1, 0.1, 'bandpass', 1600, 700);
    }
  };

  function play(name, opts) {
    try {
      if (!ensure()) return;
      if (muted) return;
      if (synths[name]) synths[name](opts || {});
    } catch (e) { /* audio must never break the game */ }
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('shield-muted', muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.4;
    return muted;
  }

  global.Shield = global.Shield || {};
  global.Shield.sound = {
    play: play,
    toggleMute: toggleMute,
    isMuted: function () { return muted; }
  };
})(window);
