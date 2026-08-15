/* SHIELD — music.js
 * Epic medieval background music, synthesized live with WebAudio — no audio
 * files. A 16-bar loop in D minor: low drone, harp-like arpeggios over a
 * Dm–Bb–F–C progression, a horn melody with vibrato and echo, and a deep
 * war-drum pulse. Starts on the first user gesture (autoplay policy);
 * toggled with Shield.music.toggleMute(), persisted to localStorage.
 */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var echo = null;
  var muted = false;
  var started = false;
  var timer = null;
  var step = 0;
  var nextTime = 0;

  try { muted = localStorage.getItem('shield-music-muted') === '1'; } catch (e) {}

  var BPM = 88;
  var STEP = 60 / BPM / 2;      // eighth notes
  var SPB = 8;                  // steps per bar
  var BARS = 16;
  var TOTAL = SPB * BARS;
  var LOOKAHEAD = 1.2;          // schedule ahead (survives background-tab throttling)
  var VOLUME = 0.20;

  /* note name -> frequency */
  function nf(name) {
    var m = /^([A-G])(b|#)?(\d)$/.exec(name);
    var semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    if (m[2] === 'b') semis -= 1;
    if (m[2] === '#') semis += 1;
    var midi = semis + 12 * (parseInt(m[3], 10) + 1);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  /* one chord per bar: Dm Dm Bb Bb F F C C | Dm Dm Bb Bb F C Dm Dm */
  var CHORDS = [
    ['D3', 'A3', 'D4', 'F4'], ['D3', 'A3', 'D4', 'F4'],
    ['Bb2', 'F3', 'Bb3', 'D4'], ['Bb2', 'F3', 'Bb3', 'D4'],
    ['F3', 'C4', 'F4', 'A4'], ['F3', 'C4', 'F4', 'A4'],
    ['C3', 'G3', 'C4', 'E4'], ['C3', 'G3', 'C4', 'E4'],
    ['D3', 'A3', 'D4', 'F4'], ['D3', 'A3', 'D4', 'F4'],
    ['Bb2', 'F3', 'Bb3', 'D4'], ['Bb2', 'F3', 'Bb3', 'D4'],
    ['F3', 'C4', 'F4', 'A4'], ['C3', 'G3', 'C4', 'E4'],
    ['D3', 'A3', 'D4', 'F4'], ['D3', 'A3', 'D4', 'F4']
  ];

  /* harp arpeggio pattern: chord-tone index per step of a bar */
  var ARP = [0, 1, 2, 3, 2, 1, 2, 1];

  /* melody: [bar, step, note, lengthInSteps] */
  var MELODY = [
    [0, 0, 'D4', 4], [0, 4, 'F4', 2], [0, 6, 'G4', 2],
    [1, 0, 'A4', 6],
    [2, 0, 'Bb4', 4], [2, 4, 'A4', 4],
    [3, 0, 'G4', 4], [3, 4, 'F4', 2], [3, 6, 'D4', 2],
    [4, 0, 'A4', 4], [4, 4, 'C5', 4],
    [5, 0, 'A4', 6], [5, 6, 'G4', 2],
    [6, 0, 'G4', 4], [6, 4, 'E4', 2], [6, 6, 'F4', 2],
    [7, 0, 'D4', 8],
    [8, 0, 'D5', 4], [8, 4, 'C5', 2], [8, 6, 'A4', 2],
    [9, 0, 'Bb4', 4], [9, 4, 'C5', 4],
    [10, 0, 'D5', 6], [10, 6, 'C5', 2],
    [11, 0, 'Bb4', 4], [11, 4, 'A4', 4],
    [12, 0, 'A4', 4], [12, 4, 'F4', 2], [12, 6, 'G4', 2],
    [13, 0, 'G4', 4], [13, 4, 'E5', 4],
    [14, 0, 'A4', 4], [14, 4, 'F4', 4],
    [15, 0, 'D4', 8]
  ];

  function ensure() {
    if (ctx) return true;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : VOLUME;
    master.connect(ctx.destination);

    // simple hall: feedback delay, low-passed so echoes soften
    echo = ctx.createDelay(1.5);
    echo.delayTime.value = 0.42;
    var fb = ctx.createGain();
    fb.gain.value = 0.32;
    var damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1600;
    echo.connect(damp); damp.connect(fb); fb.connect(echo);
    echo.connect(master);
    return true;
  }

  /* ---------------- voices ---------------- */

  function drone(t, dur) {
    ['D2', 'A2'].forEach(function (n, v) {
      [-4, 4].forEach(function (cents) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = nf(n);
        o.detune.value = cents;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 240;
        var g = ctx.createGain();
        var peak = v === 0 ? 0.055 : 0.035;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.2);
        g.gain.setValueAtTime(peak, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f); f.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.1);
      });
    });
  }

  function harp(t, freq) {
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); g.connect(master);
    var send = ctx.createGain();
    send.gain.value = 0.18;
    g.connect(send); send.connect(echo);
    o.start(t); o.stop(t + 0.7);
  }

  function horn(t, freq, dur) {
    var o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    var o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq / 2; // octave-below body
    // gentle vibrato
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 4.6;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = freq * 0.004;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2100;
    var g = ctx.createGain();
    var g2 = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.09);
    g.gain.setValueAtTime(0.11, t + Math.max(dur - 0.18, 0.1));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g2.gain.value = 0.4;
    o.connect(f); o2.connect(g2); g2.connect(f);
    f.connect(g); g.connect(master);
    var send = ctx.createGain();
    send.gain.value = 0.3;
    g.connect(send); send.connect(echo);
    lfo.start(t); o.start(t); o2.start(t);
    var stop = t + dur + 0.1;
    lfo.stop(stop); o.stop(stop); o2.stop(stop);
  }

  function drum(t, strong) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(strong ? 95 : 75, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 0.5 : 0.28, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.5);

    // skin/wood texture
    var len = Math.floor(ctx.sampleRate * 0.12);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var nf2 = ctx.createBiquadFilter();
    nf2.type = 'lowpass';
    nf2.frequency.value = 500;
    var ng = ctx.createGain();
    ng.gain.value = strong ? 0.16 : 0.09;
    src.connect(nf2); nf2.connect(ng); ng.connect(master);
    src.start(t);
  }

  /* ---------------- sequencer ---------------- */

  function scheduleStep(s, t) {
    var bar = Math.floor(s / SPB);
    var inBar = s % SPB;

    if (inBar === 0 && bar % 4 === 0) drone(t, STEP * SPB * 4 + 0.2);

    var chord = CHORDS[bar];
    harp(t, nf(chord[ARP[inBar]]));

    if (inBar === 0) drum(t, bar % 2 === 0);
    else if (inBar === 4) drum(t, false);
    // little roll leading back into the loop and into the B section
    if ((bar === 7 || bar === 15) && inBar >= 6) drum(t + STEP * 0.5, false);

    for (var i = 0; i < MELODY.length; i++) {
      var m = MELODY[i];
      if (m[0] === bar && m[1] === inBar) {
        horn(t, nf(m[2]), m[3] * STEP * 0.95);
      }
    }
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      step = (step + 1) % TOTAL;
      nextTime += STEP;
    }
    timer = setTimeout(scheduler, 250);
  }

  /* ---------------- public API ---------------- */

  function start() {
    try {
      if (started) {
        if (ctx && ctx.state === 'suspended') ctx.resume();
        return;
      }
      if (!ensure()) return;
      if (ctx.state === 'suspended') ctx.resume();
      started = true;
      step = 0;
      nextTime = ctx.currentTime + 0.1;
      scheduler();
    } catch (e) { /* music must never break the game */ }
  }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('shield-music-muted', muted ? '1' : '0'); } catch (e) {}
    if (muted) {
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    } else {
      start();
      if (master) master.gain.setTargetAtTime(VOLUME, ctx.currentTime, 0.3);
    }
    return muted;
  }

  global.Shield = global.Shield || {};
  global.Shield.music = {
    start: start,
    toggleMute: toggleMute,
    isMuted: function () { return muted; },
    _debug: function () { return { started: started, state: ctx ? ctx.state : 'none' }; },
    _nodes: function () { return { ctx: ctx, master: master }; }
  };
})(window);
