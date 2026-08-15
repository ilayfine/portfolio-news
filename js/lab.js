/* SHIELD — lab.js
 * The War Council: a GTO-style analysis table. Looks like the real game —
 * seats around the table, game-face cards — with the oracle's analytics in
 * the center. Three ways in:
 *   Setup   — click cards to build any position, then Weigh Every Action.
 *   Explore — ▶ plays a move with real random draws (counters included) so
 *             you can walk a line deeper; undo/reset at will.
 *   Review  — after a real game, replay every recorded move through the
 *             oracle and see each one's EV loss vs the best line.
 *
 * The oracle is the ☠ Impossible bot's adversarial tree search (ISMCTS):
 * replies converge on every player's strongest line as it thinks.
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;
  var AI = global.Shield.ai;
  var UI = global.Shield.ui;

  var RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  var SUITS = ['spades', 'hearts', 'clubs', 'diamonds'];
  /* seat positions (% of the arena), mirroring the game's table */
  var SEATS = {
    2: [[50, 79], [50, 21]],
    3: [[50, 79], [22, 24], [78, 24]],
    4: [[50, 80], [17, 50], [50, 20], [83, 50]]
  };
  /* portrait phones: seats are wider than the screen allows two-across, so
   * they stack in one column (mover last); the piles dock to the right of a
   * row (CSS positions #lab-table-center via .seats-N) */
  var SEATS_PHONE = {
    2: [[50, 78], [50, 22]],
    3: [[40, 81], [40, 15], [40, 48]],
    4: [[40, 88], [40, 12], [40, 38], [40, 64]]
  };
  var PHONE_MQ = window.matchMedia ? window.matchMedia('(max-width: 600px)') : null;
  function seatPos(count, i) {
    return (PHONE_MQ && PHONE_MQ.matches ? SEATS_PHONE : SEATS)[count][i];
  }
  var REVIEW_MS = 600;        // per-move budget when reviewing a full game
  var GRADES = [              // EV loss (win-% points) -> label
    { max: 1.5, cls: 'best', label: 'best' },
    { max: 4, cls: 'good', label: 'good' },
    { max: 9, cls: 'inacc', label: 'inaccuracy' },
    { max: 18, cls: 'mistake', label: 'mistake' },
    { max: 101, cls: 'blunder', label: 'blunder' }
  ];

  /* ---------------- state ---------------- */

  function C(rank, suit) { return { rank: rank, suit: suit }; }

  var model = {
    count: 2,
    toMove: 0,
    players: [
      { shield: C(7, 'spades'), life: [C(6, 'hearts'), C(9, 'clubs')], charges: 0 },
      { shield: C(5, 'diamonds'), life: [C(4, 'spades'), C(11, 'diamonds')], charges: 0 },
      { shield: C(8, 'hearts'), life: [C(3, 'diamonds'), C(10, 'spades')], charges: 0 },
      { shield: C(4, 'clubs'), life: [C(7, 'hearts'), C(7, 'diamonds')], charges: 0 }
    ],
    burnt: []
  };

  var live = null;      // {state, undo: [states], line: [labels]} once a move is played
  var running = false;  // an evaluate() is in flight
  var runToken = 0;     // bumped to orphan stale async results
  var reviewing = null; // {entries, results, i, token} while a game review runs

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function toCard(spec) { return spec.joker ? R.makeJoker(1) : R.makeCard(spec.rank, spec.suit); }
  function key(spec) { return spec.joker ? 'X' : toCard(spec).id; }
  function mvk(mv) {
    if (mv.type === 'attack') return 'a' + mv.target;
    if (mv.type === 'shield') return 's' + mv.target;
    if (mv.type === 'charge') return 'c';
    return 'g' + mv.guess;
  }

  function curState() { return live ? live.state : null; }

  /* ---------------- used cards & picker (setup mode) ---------------- */

  function usedCards() {
    var used = {}, jokers = 0;
    for (var i = 0; i < model.count; i++) {
      var pm = model.players[i];
      used[key(pm.shield)] = true;
      pm.life.forEach(function (c) { used[key(c)] = true; });
    }
    model.burnt.forEach(function (c) {
      if (c.joker) jokers++; else used[key(c)] = true;
    });
    return { used: used, jokers: jokers };
  }

  function openPicker(opts) {
    closePicker();
    var u = usedCards();
    var overlay = el('div', null);
    overlay.id = 'lab-picker';
    var panel = el('div', 'lab-picker-panel');
    panel.appendChild(el('p', 'lab-picker-title', opts.current ? 'Swap the card' : 'Pick a card'));
    SUITS.forEach(function (suit) {
      var row = el('div', 'lab-picker-row');
      RANKS.forEach(function (rank) {
        var spec = C(rank, suit);
        var k = key(spec);
        var isCurrent = opts.current && !opts.current.joker && key(opts.current) === k;
        var taken = u.used[k] && !isCurrent;
        var slot = el('button', 'lab-pick-card' + (taken ? ' taken' : '') + (isCurrent ? ' current' : ''));
        slot.appendChild(UI.cardEl(toCard(spec), true));
        if (!taken) {
          slot.addEventListener('click', function () { closePicker(); opts.onPick(spec); });
        }
        row.appendChild(slot);
      });
      panel.appendChild(row);
    });
    if (opts.allowJoker) {
      var row = el('div', 'lab-picker-row jokers');
      var jokerTaken = u.jokers >= 2;
      var slot = el('button', 'lab-pick-card' + (jokerTaken ? ' taken' : ''));
      slot.appendChild(UI.cardEl(R.makeJoker(1), true));
      if (!jokerTaken) {
        slot.addEventListener('click', function () { closePicker(); opts.onPick({ joker: true }); });
      }
      row.appendChild(slot);
      row.appendChild(el('span', 'lab-hint-inline', 'two jokers per deck'));
      panel.appendChild(row);
    }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePicker(); });
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }

  function closePicker() {
    var p = $('lab-picker');
    if (p) p.remove();
  }

  function miniCard(card, opts) {
    var wrap = el('span', 'lab-mini' + (opts.sideways ? ' sideways' : ''));
    var inner;
    if (opts.onPick) {
      inner = el('button', 'lab-mini-btn');
      inner.title = opts.title || 'click to change';
      inner.addEventListener('click', function () {
        openPicker({ allowJoker: !!opts.allowJoker, current: opts.spec, onPick: opts.onPick });
      });
    } else {
      inner = el('span', 'lab-mini-btn still');
    }
    inner.appendChild(UI.cardEl(card, opts.faceUp !== false));
    wrap.appendChild(inner);
    if (opts.badge !== undefined) wrap.appendChild(el('span', 'lab-val-badge', String(opts.badge)));
    if (opts.onRemove) {
      var x = el('button', 'lab-mini-x', '×');
      x.title = 'remove';
      x.addEventListener('click', opts.onRemove);
      wrap.appendChild(x);
    }
    return wrap;
  }

  /* ---------------- building a legal state from the editor ---------------- */

  function buildState() {
    var seen = {}, jokersPlaced = 0;
    function place(spec, what) {
      if (spec.joker) {
        jokersPlaced++;
        if (jokersPlaced > 2) throw new Error('Only two jokers exist — the ' + what + ' holds a third.');
        return R.makeJoker(jokersPlaced);
      }
      var card = toCard(spec);
      if (seen[card.id]) {
        throw new Error('The ' + card.label + card.glyph + ' is placed twice (' + what + ') — each card exists once.');
      }
      seen[card.id] = true;
      return card;
    }
    var players = [];
    for (var i = 0; i < model.count; i++) {
      var pm = model.players[i];
      if (!pm.life.length) throw new Error('Player ' + (i + 1) + ' has no life cards — they would already be out.');
      players.push({
        id: i,
        name: 'Player ' + (i + 1),
        shield: place(pm.shield, 'shields'),
        health: pm.life.map(function (c) { return R.lifeSlot(place(c, 'life cards')); }),
        charge: [],
        eliminated: false
      });
    }
    var discard = model.burnt.map(function (c) { return place(c, 'burnt pile'); });
    var pool = R.buildDeck().filter(function (c) { return !c.joker && !seen[c.id]; });
    for (var j = jokersPlaced; j < 2; j++) pool.push(R.makeJoker(j + 1));
    var totalCharges = 0;
    for (var c = 0; c < model.count; c++) totalCharges += model.players[c].charges;
    if (pool.length <= totalCharges) {
      throw new Error('Too few unseen cards left to hold ' + totalCharges + ' charges and a deck.');
    }
    // charges come out of the unseen pool (their identity is irrelevant:
    // every simulation reshuffles them anyway)
    var rng = R.makeRng();
    for (var s = pool.length - 1; s > 0; s--) {
      var r2 = Math.floor(rng() * (s + 1));
      var t = pool[s]; pool[s] = pool[r2]; pool[r2] = t;
    }
    for (var k = 0; k < model.count; k++) {
      for (var n = 0; n < model.players[k].charges; n++) players[k].charge.push(pool.pop());
    }
    return {
      players: players,
      deck: pool,
      discard: discard,
      currentIdx: model.toMove,
      turn: 12,
      pending: null,
      winnerId: null,
      rng: rng
    };
  }

  /* ---------------- labels ---------------- */

  function pname(state, id) { return state ? state.players[id].name : 'Player ' + (id + 1); }

  function moveLabel(mv, state, pid) {
    if (mv === null) return '✋ Decline the counter';
    if (typeof mv === 'number') {
      var att = state.players[state.pending.attackerId];
      var slot = att.health[mv];
      return '🗡 Scramble their ' + slot.card.label + slot.card.glyph + ' (' + slot.value + ')';
    }
    if (mv.type === 'attack') return '⚔ Attack ' + pname(state, mv.target);
    if (mv.type === 'shield') {
      return mv.target === pid ? '⛨ Reforge my shield' : "⛨ Smash " + pname(state, mv.target) + "'s shield";
    }
    if (mv.type === 'charge') return '⚡ Charge (face-down power)';
    return '🎲 Gamble on ' + mv.guess;
  }

  /* ---------------- seats (the table) ---------------- */

  function seatViews() {
    if (live) {
      return {
        count: live.state.players.length,
        toMove: live.state.pending ? live.state.pending.defenderId : live.state.currentIdx,
        editable: false,
        players: live.state.players.map(function (p) {
          return {
            name: p.name,
            hp: R.hp(p),
            eliminated: p.eliminated,
            shield: p.shield,
            life: p.health.map(function (sl) {
              return { card: sl.card, value: sl.value, pending: sl.pending };
            }),
            charges: p.charge.length
          };
        })
      };
    }
    return {
      count: model.count,
      toMove: model.toMove,
      editable: true,
      players: model.players.slice(0, model.count).map(function (pm, i) {
        return {
          name: 'Player ' + (i + 1),
          hp: pm.life.reduce(function (a, b) { return a + b.rank; }, 0),
          eliminated: false,
          shield: toCard(pm.shield),
          life: pm.life.map(function (c) { return { card: toCard(c), value: c.rank, pending: false, spec: c }; }),
          charges: pm.charges
        };
      })
    };
  }

  /* a labelled group of cards under the plate, like the game's slot tags */
  function group(tag, cards) {
    var g = el('div', 'lab-group');
    var box = el('div', 'lab-group-cards');
    cards.forEach(function (c) { box.appendChild(c); });
    g.appendChild(box);
    g.appendChild(el('span', 'lab-group-tag', tag));
    return g;
  }

  function renderSeats() {
    var arena = $('lab-arena');
    Array.prototype.forEach.call(arena.querySelectorAll('.lab-seat'), function (z) { z.remove(); });
    var view = seatViews();
    arena.classList.remove('seats-2', 'seats-3', 'seats-4');
    arena.classList.add('seats-' + view.count);
    view.players.forEach(function (p, i) {
      var pm = model.players[i];
      var zone = el('div', 'lab-seat' + (p.eliminated ? ' dead' : '') + (view.toMove === i ? ' mover' : ''));
      var pos = seatPos(view.count, i);
      zone.style.left = pos[0] + '%';
      zone.style.top = pos[1] + '%';
      zone.style.setProperty('--accent', UI.ACCENTS[i]);

      var plate = el('div', 'lab-plate');
      if (view.toMove === i && !p.eliminated) plate.appendChild(el('span', 'lab-mover-flag', '⚔'));
      var nm = el('span', 'lab-pname', p.name);
      if (view.editable) {
        nm.classList.add('clickable');
        nm.title = 'click: this player is to move';
        nm.addEventListener('click', function () { model.toMove = i; renderSeats(); });
      }
      plate.appendChild(nm);
      var orb = el('div', 'lab-hp-orb');
      orb.appendChild(el('span', 'lab-hp-num', String(p.hp)));
      plate.appendChild(orb);
      zone.appendChild(plate);

      var row = el('div', 'lab-seat-cards');

      // shield — laid sideways, as on the real table
      row.appendChild(group('SHIELD', [miniCard(p.shield, view.editable ? {
        sideways: true, spec: pm.shield, title: 'shield — click to change',
        onPick: function (spec) { pm.shield = spec; renderSeats(); }
      } : { sideways: true })]));

      // life
      var lifeCards = p.life.map(function (sl, idx) {
        var opts = view.editable ? {
          spec: pm.life[idx],
          onPick: function (nv) { pm.life[idx] = nv; renderSeats(); },
          onRemove: function () { pm.life.splice(idx, 1); renderSeats(); }
        } : {};
        if (sl.value !== sl.card.rank) opts.badge = sl.value; // damaged slot
        return miniCard(sl.card, opts);
      });
      if (view.editable && pm.life.length < R.MAX_LIFE) {
        var add = el('button', 'lab-add-card', '+');
        add.title = 'add a life card';
        add.addEventListener('click', function () {
          openPicker({ onPick: function (spec) { pm.life.push(spec); renderSeats(); } });
        });
        lifeCards.push(add);
      }
      row.appendChild(group('LIFE', lifeCards));

      // charges — face-down, count only
      var stack = el('div', 'lab-charge-stack');
      if (p.charges) {
        for (var s = 0; s < Math.min(p.charges, 5); s++) {
          var fd = el('span', 'lab-mini');
          fd.appendChild(UI.cardEl(R.makeCard(2, 'spades'), false));
          stack.appendChild(fd);
        }
      } else {
        stack.appendChild(el('span', 'lab-charge-none'));
      }
      var chGroup = group('CHARGE' + (p.charges > 5 ? ' ×' + p.charges : ''), [stack]);
      if (view.editable) {
        var stepper = el('div', 'lab-stepper');
        var minus = el('button', 'lab-step', '−');
        minus.addEventListener('click', function () { if (pm.charges > 0) { pm.charges--; renderSeats(); } });
        var plus = el('button', 'lab-step', '+');
        plus.addEventListener('click', function () { if (pm.charges < 6) { pm.charges++; renderSeats(); } });
        stepper.appendChild(minus);
        stepper.appendChild(el('span', 'lab-step-n', String(p.charges)));
        stepper.appendChild(plus);
        chGroup.insertBefore(stepper, chGroup.lastChild);
      }
      row.appendChild(chGroup);

      zone.appendChild(row);
      arena.appendChild(zone);
    });
    renderBurnt();
    renderDeckCount();
    renderBanner();
    renderTurn();
    renderLine();
  }

  /* reseat everyone when the viewport crosses the phone breakpoint */
  if (PHONE_MQ && PHONE_MQ.addEventListener) {
    PHONE_MQ.addEventListener('change', function () { renderSeats(); });
  }

  function renderDeckCount() {
    var n = live ? live.state.deck.length : null;
    $('lab-deck-count').textContent = n === null ? '' : n + ' left';
  }

  /* who is on the clock, in the panel's own voice */
  function renderTurn() {
    var box = $('lab-turn');
    var view = seatViews();
    var id = view.toMove;
    if (live && live.state.winnerId !== null) {
      box.textContent = '👑 ' + pname(live.state, live.state.winnerId) + ' wins';
      box.style.setProperty('--accent', UI.ACCENTS[live.state.winnerId]);
      return;
    }
    var counter = live && live.state.pending;
    box.textContent = (counter ? '🛡 ' : '⚔ ') + view.players[id].name +
      (counter ? ' — counter?' : ' to move');
    box.style.setProperty('--accent', UI.ACCENTS[id]);
  }

  function renderBurnt() {
    var chips = $('lab-burnt-chips');
    chips.innerHTML = '';
    if (live) {
      var d = live.state.discard;
      d.slice(-10).forEach(function (card) { chips.appendChild(miniCard(card, {})); });
      if (d.length > 10) chips.appendChild(el('span', 'lab-hint-inline', '+' + (d.length - 10)));
      if (!d.length) chips.appendChild(el('span', 'lab-hint-inline', 'empty'));
      return;
    }
    model.burnt.forEach(function (spec, idx) {
      chips.appendChild(miniCard(toCard(spec), {
        spec: spec, allowJoker: true, title: 'burnt card — click to change',
        onPick: function (nv) { model.burnt[idx] = nv; renderBurnt(); },
        onRemove: function () { model.burnt.splice(idx, 1); renderBurnt(); }
      }));
    });
    var add = el('button', 'lab-add-card', '+');
    add.title = 'add a card to the burnt pile';
    add.addEventListener('click', function () {
      openPicker({ allowJoker: true, onPick: function (spec) { model.burnt.push(spec); renderBurnt(); } });
    });
    chips.appendChild(add);
  }

  function renderBanner() {
    var b = $('lab-banner');
    $('lab-count').classList.toggle('hidden', !!live || !!reviewing);
    if (reviewing) { b.textContent = 'Reviewing the battle — step with ← → , weigh any position'; return; }
    if (live) {
      b.textContent = live.state.winnerId !== null
        ? 'This line is decided — undo to try another'
        : (live.state.pending
          ? 'An attack was blocked — weigh the counter'
          : 'Exploring a line — ▶ plays a move with real draws');
      return;
    }
    b.textContent = 'Click any card to change it, then weigh every action';
  }

  function renderLine() {
    var box = $('lab-line');
    box.innerHTML = '';
    // while reviewing, the nav bar replaces undo — stepping IS the history
    $('lab-undo').classList.toggle('hidden', !live || !!reviewing);
    $('lab-reset').classList.toggle('hidden', !live && !reviewing);
    $('lab-explore').classList.toggle('hidden', !reviewing || !live);
    if (!live || !live.line.length) return;
    box.appendChild(el('span', 'lab-line-tag', 'line:'));
    live.line.forEach(function (lbl) { box.appendChild(el('span', 'lab-line-step', lbl)); });
  }

  /* ---------------- analysis ---------------- */

  function clearResults() {
    $('lab-results').innerHTML = '';
    $('lab-meta').textContent = '';
    $('lab-error').textContent = '';
    $('lab-progress').classList.remove('on');
    $('lab-progress-fill').style.width = '0';
  }

  /* colour a row by what kind of move it is (matches the game's buttons) */
  function moveClass(mv) {
    if (mv === null) return 'decline';
    if (typeof mv === 'number') return 'counter';
    return mv.type;
  }

  function renderResults(rows, final, state, pid, counterMode) {
    var box = $('lab-results');
    box.innerHTML = '';
    var sorted = rows.slice().sort(function (a, b) { return b.ev - a.ev; });
    var best = sorted.length ? sorted[0].ev : 0;
    var alive = state.players.filter(function (p) { return !p.eliminated; }).length;
    var fair = 1 / alive;
    var totalSims = 0;
    sorted.forEach(function (row, idx) {
      totalSims += row.sims;
      var r = el('div', 'lab-row ' + moveClass(row.move) + (idx === 0 ? ' best' : ''));
      var top = el('div', 'lab-row-top');
      var play = el('button', 'lab-play', '▶');
      play.title = 'play this move with real draws and keep exploring';
      play.addEventListener('click', function () {
        counterMode ? playCounter(row.move) : playMove(row.move);
      });
      top.appendChild(play);
      top.appendChild(el('span', 'lab-row-label', (idx === 0 ? '★ ' : '') + moveLabel(row.move, state, pid)));
      top.appendChild(el('span', 'lab-row-ev', (row.ev * 100).toFixed(1) + '%'));
      r.appendChild(top);
      var track = el('div', 'lab-bar-track');
      var fill = el('div', 'lab-bar-fill');
      fill.style.width = (row.ev * 100).toFixed(1) + '%';
      track.appendChild(fill);
      var marker = el('div', 'lab-bar-fair');
      marker.style.left = (fair * 100).toFixed(1) + '%';
      marker.title = 'an even share would be ' + Math.round(fair * 100) + '%';
      track.appendChild(marker);
      r.appendChild(track);
      r.appendChild(el('span', 'lab-row-loss',
        idx === 0 ? 'the best line' : 'costs ' + ((best - row.ev) * 100).toFixed(1) + '% vs the best'));
      box.appendChild(r);
    });
    $('lab-meta').textContent = totalSims.toLocaleString() + ' games simulated' + (final ? ' · done' : '…');
  }

  function analyze() {
    if (running) return;
    if (!reviewing) closeReviewPanel();  // deep-think in place while reviewing
    clearResults();
    var state, pid, counterMode = false;
    if (live) {
      if (live.state.winnerId !== null) return;
      state = live.state;
      counterMode = !!state.pending;
      pid = counterMode ? state.pending.defenderId : state.currentIdx;
    } else {
      try { state = buildState(); } catch (e) { $('lab-error').textContent = e.message; return; }
      pid = state.currentIdx;
    }
    running = true;
    var token = ++runToken;
    var btn = $('lab-analyze');
    btn.disabled = true;
    btn.textContent = 'The oracle ponders…';
    $('lab-progress').classList.add('on');
    var timeMs = parseInt($('lab-think').value, 10);
    var fn = counterMode ? AI.evaluateCounter : AI.evaluate;
    var args = counterMode ? [state, { timeMs: timeMs }] : [state, pid, { timeMs: timeMs }];
    args[args.length - 1].onProgress = function (rows, elapsed, total) {
      if (token !== runToken) return;
      $('lab-progress-fill').style.width = Math.min(100 * elapsed / total, 100) + '%';
      renderResults(rows, false, state, pid, counterMode);
    };
    fn.apply(null, args).then(function (rows) {
      if (token !== runToken) return;
      renderResults(rows, true, state, pid, counterMode);
      $('lab-progress-fill').style.width = '100%';
      done();
    });
    function done() {
      btn.disabled = false;
      btn.textContent = '⚖ Weigh Every Action';
      running = false;
    }
  }

  /* ---------------- exploring lines ---------------- */

  function ensureLive() {
    if (live) return true;
    try {
      live = { state: buildState(), undo: [], line: [] };
    } catch (e) {
      $('lab-error').textContent = e.message;
      return false;
    }
    return true;
  }

  /* playing a move from a reviewed position leaves the review behind and
   * continues as a live line — that IS exploring the road not taken */
  function leaveReviewIfPlaying() {
    if (!reviewing) return;
    reviewing = null;
    closeReviewPanel();
  }

  function playMove(mv) {
    if (!ensureLive()) return;
    leaveReviewIfPlaying();
    var s = live.state;
    if (s.pending || s.winnerId !== null) return;
    runToken++; running = false;
    live.undo.push(AI.cloneState(s, null));
    live.line.push(moveLabel(mv, s, s.currentIdx).replace(/^[^ ]+ /, ''));
    s.rng = s.rng || R.makeRng();
    AI.applyMainMove(s, mv, s.rng);
    clearResults();
    renderSeats();
    if (s.winnerId === null) analyze();
  }

  function playCounter(pick) {
    var s = live && live.state;
    if (!s || !s.pending) return;
    leaveReviewIfPlaying();
    runToken++; running = false;
    live.undo.push(AI.cloneState(s, null));
    live.line.push(pick === null ? 'decline' : 'scramble');
    if (pick === null) R.resolveCounterSkip(s);
    else R.resolveCounter(s, pick);
    if (s.winnerId === null) R.advanceTurn(s);
    clearResults();
    renderSeats();
    if (s.winnerId === null) analyze();
  }

  function undo() {
    if (!live) return;
    runToken++; running = false;
    if (live.undo.length) {
      live.state = live.undo.pop();
      live.state.rng = R.makeRng();
      live.line.pop();
    }
    if (!live.undo.length && !live.line.length) live = null;
    clearResults();
    renderSeats();
  }

  function reset() {
    runToken++; running = false;
    live = null;
    reviewing = null;
    closeReviewPanel();
    clearResults();
    renderSeats();
  }

  /* ---------------- full-game review ---------------- */

  function closeReviewPanel() {
    $('lab-review').classList.add('hidden');
    $('lab-navbar').classList.add('hidden');
    $('lab-frame-info').classList.add('hidden');
    $('lab-explore').classList.add('hidden');
  }

  function gradeOf(lossPct) {
    for (var i = 0; i < GRADES.length; i++) if (lossPct <= GRADES[i].max) return GRADES[i];
    return GRADES[GRADES.length - 1];
  }

  function openReview() {
    var E = global.Shield.engine;
    var frames = (E && E.history || []).slice();
    reset();
    if (!frames.filter(function (f) { return f.mv; }).length) {
      $('lab-error').textContent = 'No battle on record — finish a game first, then return here.';
      renderSeats();
      return;
    }
    reviewing = {
      frames: frames,
      results: {},   // frame index -> {loss, grade, best, played}
      rows: {},      // frame index -> DOM row
      index: 0,
      token: ++runToken
    };
    var panel = $('lab-review');
    panel.classList.remove('hidden');
    panel.innerHTML = '';
    panel.appendChild(el('p', 'lab-review-title', '⚖ The battle, move by move'));
    var status = el('p', 'lab-hint');
    panel.appendChild(status);
    var list = el('div', 'lab-review-list');
    panel.appendChild(list);
    reviewGoto(0);
    reviewStep(list, status, 0, reviewing.token);
  }

  /* grade every move in the background at a small budget; the deep think is
   * on demand, per position, via the Weigh button */
  function reviewStep(list, status, i, token) {
    if (!reviewing || reviewing.token !== token) return;
    var frames = reviewing.frames;
    if (i >= frames.length) {
      status.textContent = 'Every move weighed — step through with ← → or click a move.';
      showSummary($('lab-review'));
      return;
    }
    var entry = frames[i];
    if (!entry.mv) { reviewStep(list, status, i + 1, token); return; } // final position
    var moveNo = countMovesUpTo(i);
    status.textContent = 'Weighing move ' + moveNo + ' of ' + totalMoves() + '…';
    AI.evaluate(entry.state, entry.pid, { timeMs: REVIEW_MS }).then(function (rows) {
      if (!reviewing || reviewing.token !== token) return;
      var played = null, best = rows[0];
      rows.forEach(function (r) { if (mvk(r.move) === mvk(entry.mv)) played = r; });
      var loss = played ? (best.ev - played.ev) * 100 : 0;
      var grade = gradeOf(loss);
      reviewing.results[i] = { loss: loss, grade: grade, best: best, played: played };

      var row = el('div', 'lab-review-row ' + grade.cls + (reviewing.index === i ? ' on' : ''));
      row.style.setProperty('--accent', UI.ACCENTS[entry.pid]);
      row.appendChild(el('span', 'lab-review-num', '#' + moveNo));
      row.appendChild(el('span', 'lab-review-mv',
        pname(entry.state, entry.pid) + ': ' + moveLabel(entry.mv, entry.state, entry.pid)));
      row.appendChild(el('span', 'lab-review-tag',
        grade.cls === 'best' ? grade.label : grade.label + ' −' + loss.toFixed(1) + '%'));
      if (grade.cls !== 'best') {
        row.appendChild(el('span', 'lab-review-note',
          'better: ' + moveLabel(best.move, entry.state, entry.pid) +
          ' (' + (best.ev * 100).toFixed(0) + '%)'));
      }
      row.title = 'click to see this position on the table';
      row.addEventListener('click', function () { reviewGoto(i); });
      reviewing.rows[i] = row;
      list.appendChild(row);
      if (reviewing.index === i) renderFrameInfo();
      reviewStep(list, status, i + 1, token);
    });
  }

  function totalMoves() {
    return reviewing.frames.filter(function (f) { return f.mv; }).length;
  }
  function countMovesUpTo(i) {
    var n = 0;
    for (var k = 0; k <= i; k++) if (reviewing.frames[k].mv) n++;
    return n;
  }

  /* ---- chess-style navigation through the recorded game ---- */

  function reviewGoto(i) {
    if (!reviewing) return;
    i = Math.max(0, Math.min(i, reviewing.frames.length - 1));
    reviewing.index = i;
    runToken++; running = false;
    var frame = reviewing.frames[i];
    live = { state: AI.cloneState(frame.state, R.makeRng()), undo: [], line: [] };
    Object.keys(reviewing.rows).forEach(function (k) {
      reviewing.rows[k].classList.toggle('on', +k === i);
    });
    var row = reviewing.rows[i];
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    clearResults();
    renderSeats();
    renderFrameInfo();
  }

  function reviewStepBy(d) {
    if (!reviewing) return;
    reviewGoto(reviewing.index + d);
  }

  /* the strip above the Weigh button: what was played here, and how it rated */
  function renderFrameInfo() {
    var nav = $('lab-navbar'), info = $('lab-frame-info');
    if (!reviewing) {
      nav.classList.add('hidden');
      info.classList.add('hidden');
      return;
    }
    nav.classList.remove('hidden');
    info.classList.remove('hidden');
    var i = reviewing.index;
    var frame = reviewing.frames[i];
    $('lab-move-num').textContent = frame.mv
      ? 'move ' + countMovesUpTo(i) + ' / ' + totalMoves()
      : 'final position';
    $('lab-first').disabled = $('lab-prev').disabled = i === 0;
    $('lab-next').disabled = $('lab-last').disabled = i === reviewing.frames.length - 1;

    info.innerHTML = '';
    if (!frame.mv) {
      var w = frame.state.winnerId;
      info.className = 'lab-frame-info best';
      info.appendChild(el('span', null, w === null ? 'End of the record.'
        : '👑 ' + pname(frame.state, w) + ' won.'));
      return;
    }
    var res = reviewing.results[i];
    info.className = 'lab-frame-info' + (res ? ' ' + res.grade.cls : '');
    info.appendChild(el('span', 'lab-frame-played',
      pname(frame.state, frame.pid) + ' played ' + moveLabel(frame.mv, frame.state, frame.pid)));
    if (res) {
      info.appendChild(el('span', 'lab-frame-tag',
        res.grade.cls === 'best' ? '★ ' + res.grade.label
          : res.grade.label + ' −' + res.loss.toFixed(1) + '% · best was ' +
            moveLabel(res.best.move, frame.state, frame.pid)));
    } else {
      info.appendChild(el('span', 'lab-frame-tag', 'weighing…'));
    }
  }

  function showSummary(panel) {
    var per = {};
    Object.keys(reviewing.results).forEach(function (k) {
      var frame = reviewing.frames[k];
      var nm = pname(frame.state, frame.pid);
      (per[nm] = per[nm] || []).push(reviewing.results[k].loss);
    });
    var box = el('div', 'lab-review-summary');
    Object.keys(per).forEach(function (nm) {
      var l = per[nm];
      var avg = l.reduce(function (a, b) { return a + b; }, 0) / l.length;
      var blunders = l.filter(function (x) { return x > 18; }).length;
      box.appendChild(el('div', null, nm + ' — average cost ' + avg.toFixed(1) + '% per move' +
        (blunders ? ', ' + blunders + ' blunder' + (blunders > 1 ? 's' : '') : '')));
    });
    panel.appendChild(box);
  }

  /* leave the review and take the current position over as a live line you
   * can play moves from */
  function exploreFromHere() {
    if (!live) return;
    reviewing = null;
    closeReviewPanel();
    clearResults();
    renderSeats();
    analyze();
  }

  /* ---------------- wiring ---------------- */

  function renderThink() {
    $('lab-think-label').textContent = (parseInt($('lab-think').value, 10) / 1000).toFixed(1) + 's';
  }

  function openLab() {
    UI.showScreen('lab');
    closeReviewPanel();
    clearResults();
    renderThink();
    renderSeats();
  }

  function boot() {
    $('btn-lab').addEventListener('click', function () { reset(); openLab(); });
    var reviewBtn = $('btn-review');
    if (reviewBtn) {
      reviewBtn.addEventListener('click', function () { openLab(); openReview(); });
    }
    $('lab-back').addEventListener('click', function () {
      runToken++; running = false;
      closePicker();
      UI.showScreen('title');
    });
    var countBox = $('lab-count');
    Array.prototype.forEach.call(countBox.querySelectorAll('.count-btn'), function (btn) {
      btn.addEventListener('click', function () {
        countBox.querySelector('.active').classList.remove('active');
        btn.classList.add('active');
        model.count = parseInt(btn.dataset.count, 10);
        if (model.toMove >= model.count) model.toMove = 0;
        renderSeats();
      });
    });
    $('lab-think').addEventListener('input', renderThink);
    $('lab-analyze').addEventListener('click', analyze);
    $('lab-explore').addEventListener('click', exploreFromHere);
    $('lab-undo').addEventListener('click', undo);
    $('lab-reset').addEventListener('click', reset);
    $('lab-first').addEventListener('click', function () { reviewGoto(0); });
    $('lab-prev').addEventListener('click', function () { reviewStepBy(-1); });
    $('lab-next').addEventListener('click', function () { reviewStepBy(1); });
    $('lab-last').addEventListener('click', function () {
      if (reviewing) reviewGoto(reviewing.frames.length - 1);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closePicker(); return; }
      if (!reviewing || $('lab-picker')) return;
      if (!document.getElementById('screen-lab').classList.contains('active')) return;
      if (e.key === 'ArrowLeft') { reviewStepBy(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { reviewStepBy(1); e.preventDefault(); }
      else if (e.key === 'Home') { reviewGoto(0); e.preventDefault(); }
      else if (e.key === 'End') { reviewGoto(reviewing.frames.length - 1); e.preventDefault(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
