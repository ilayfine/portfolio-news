/* SHIELD — tests.js
 * Logic tests for rules.js. Runs in the browser (test.html) or Node:
 *   node test/tests.js
 */
(function (global) {
  'use strict';

  if (typeof require === 'function' && typeof window === 'undefined') {
    require('../js/rules.js'); // Node: load rules into globalThis.Shield
  }
  var R = global.Shield.rules;

  var results = [];
  function assert(cond, msg) {
    results.push({ pass: !!cond, msg: msg });
    if (!cond && typeof console !== 'undefined') console.error('FAIL: ' + msg);
  }

  function has(events, type) {
    return events.some(function (e) { return e.type === type; });
  }

  function find(events, type) {
    return events.filter(function (e) { return e.type === type; })[0];
  }

  function findAll(events, type) {
    return events.filter(function (e) { return e.type === type; });
  }

  /* put specific cards on top of the deck; last array item is drawn FIRST */
  function stackDeck(state, cards) {
    var ids = {};
    cards.forEach(function (c) { ids[c.id] = true; });
    state.deck = state.deck.filter(function (c) { return !ids[c.id]; });
    for (var i = cards.length - 1; i >= 0; i--) state.deck.push(cards[i]);
  }

  function findCard(state, rank, opts) {
    opts = opts || {};
    for (var i = 0; i < state.deck.length; i++) {
      var c = state.deck[i];
      if (c.joker) { if (rank === 0) return c; continue; }
      if (c.rank === rank && (opts.red === undefined || c.red === opts.red)) return c;
    }
    return null;
  }

  /* ---------------- deck & setup ---------------- */

  (function () {
    var deck = R.buildDeck();
    assert(deck.length === 54, 'deck has 54 cards (52 + 2 jokers)');
    var jokers = deck.filter(function (c) { return c.joker; });
    assert(jokers.length === 2, 'two jokers in the deck');
    var ids = {};
    deck.forEach(function (c) { ids[c.id] = true; });
    assert(Object.keys(ids).length === 54, 'all 54 cards unique');
  })();

  (function () {
    var s = R.newGame(['A', 'B', 'C', 'D'], 1);
    assert(s.players.length === 4, 'four players created');
    assert(s.deck.length === 54 - 12, 'deck has 42 cards after dealing 4 players');
    var dealtJoker = false;
    s.players.forEach(function (p) {
      if (p.shield.joker) dealtJoker = true;
      p.health.forEach(function (sl) { if (sl.card.joker) dealtJoker = true; });
      assert(!!p.shield && p.health.length === 2, p.name + ' has shield + 2 life cards');
      assert(R.hp(p) === p.health[0].value + p.health[1].value, p.name + ' hp = sum of life values');
      assert(p.charge.length === 0, p.name + ' starts with no charges');
    });
    assert(!dealtJoker, 'jokers are never dealt at setup');
    assert(R.countAllCards(s) === 54, 'card conservation after deal');
  })();

  /* ---------------- damage denominations ---------------- */

  (function () {
    // user's example: life 10 & 6, take 4 damage -> the 6 becomes a 2
    var s = R.newGame(['A', 'B'], 2);
    var b = s.players[1];
    b.shield = R.makeCard(5, 'spades');
    b.health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(6, 'clubs'))];
    var two = findCard(s, 2);
    s.discard.push(two); // a 2 is waiting in the burnt pile
    s.deck = s.deck.filter(function (c) { return c.id !== two.id; });
    stackDeck(s, [findCard(s, 9)]); // attack 9 vs shield 5 = 4 damage
    var ev = R.resolveAttack(s, 1);
    var down = find(ev, 'lifeCardDown');
    assert(!!down, 'partial damage changes a life card');
    assert(down.newValue === 2 && down.oldCard.rank === 6, 'the LOWER card (6) becomes a 2');
    assert(down.newCard && down.newCard.rank === 2, 'the 2 is taken from the burnt pile');
    assert(!down.pending, 'no red cross when the pile has the card');
    assert(b.health[1].card.id === two.id && b.health[1].value === 2, 'slot now holds the real 2');
    assert(s.discard.some(function (c) { return c.rank === 6; }), 'the old 6 was burnt');
    assert(R.hp(b) === 12, 'hp is 10 + 2');
    assert(R.countAllCards(s) === 54, 'card conservation after swap');
  })();

  (function () {
    // no 2 in the pile -> red cross (pending), resolved by a later burn
    var s = R.newGame(['A', 'B'], 3);
    var b = s.players[1];
    b.shield = R.makeCard(5, 'spades');
    b.health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(6, 'clubs'))];
    var atk = findCard(s, 9);
    var two = findCard(s, 2);
    stackDeck(s, [atk]);
    s.deck = s.deck.filter(function (c) { return c.id !== two.id; }); // ensure no accidental 2s
    var ev = R.resolveAttack(s, 1);
    var down = find(ev, 'lifeCardDown');
    assert(down.pending && !down.newCard, 'red cross when the pile lacks the denomination');
    assert(b.health[1].pending && b.health[1].value === 2 && b.health[1].card.rank === 6,
      'crossed 6 owes a 2');
    assert(R.hp(b) === 12, 'pending value still counts toward hp');

    // now a 2 gets burnt via a shield change
    R.advanceTurn(s);
    var oldShield = s.players[0].shield;
    s.players[0].shield = two;  // plant the 2 as the shield about to be burnt
    s.deck.push(oldShield);     // keep the card count intact
    var ev2 = R.resolveChangeShield(s, 0);
    var res = find(ev2, 'pendingResolved');
    assert(!!res, 'pending swap resolves when a 2 hits the burnt pile');
    assert(b.health[1].card.rank === 2 && !b.health[1].pending, 'the crossed 6 became a real 2');
    assert(s.discard.some(function (c) { return c.rank === 6; }), 'the 6 finally burnt');
    assert(R.countAllCards(s) === 54, 'card conservation after pending swap');
  })();

  (function () {
    // overflow: life 10 & 6, take 8 -> the 6 dies, the 10 becomes an 8
    var s = R.newGame(['A', 'B'], 4);
    var b = s.players[1];
    b.shield = R.makeCard(5, 'spades');
    b.health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(6, 'clubs'))];
    stackDeck(s, [findCard(s, 13)]); // K vs 5 = 8 damage
    var ev = R.resolveAttack(s, 1);
    var lost = find(ev, 'lifeCardLost');
    assert(lost && lost.card.rank === 6, 'the 6 is destroyed first');
    var down = find(ev, 'lifeCardDown');
    assert(down && down.oldCard.rank === 10 && down.newValue === 8, 'overflow: the 10 owes an 8');
    assert(b.health.length === 1 && R.hp(b) === 8, 'one life card left, hp 8');
  })();

  (function () {
    // lethal damage empties all life cards -> eliminated -> win (2p)
    var s = R.newGame(['A', 'B'], 5);
    var b = s.players[1];
    b.shield = R.makeCard(1, 'spades');
    b.health = [R.lifeSlot(R.makeCard(2, 'clubs')), R.lifeSlot(R.makeCard(3, 'clubs'))];
    b.charge = [s.deck.pop(), s.deck.pop()]; // held charges burn on the hit
    stackDeck(s, [findCard(s, 13)]); // 13 vs 1 = 12 >= 5 total
    var ev = R.resolveAttack(s, 1);
    assert(findAll(ev, 'lifeCardLost').length === 2, 'both life cards destroyed');
    assert(has(ev, 'eliminated') && b.eliminated, 'player eliminated when life runs out');
    assert(has(ev, 'chargesLost'), 'charges burn when the holder is hit');
    assert(b.health.length === 0 && b.charge.length === 0, 'no cards left in play for the dead');
    assert(has(ev, 'win') && s.winnerId === 0, 'last one standing wins');
    assert(R.countAllCards(s) === 54, 'card conservation after elimination');
  })();

  /* ---------------- charges: hidden, stackable, fragile ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 6);
    var a = s.players[0];
    stackDeck(s, [findCard(s, 6), findCard(s, 4)]);
    R.resolveCharge(s);
    var ev2 = R.resolveCharge(s);
    assert(a.charge.length === 2, 'charges stack (two held)');
    assert(find(ev2, 'charged').count === 2, 'charged event reports the stack size');
    assert(R.legalActions(s).charge === true, 'charging stays legal with charges held');

    s.players[1].shield = R.makeCard(5, 'spades');
    s.players[1].health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(9, 'clubs'))];
    stackDeck(s, [findCard(s, 7)]);
    var ev = R.resolveAttack(s, 1);
    var rev = find(ev, 'chargesRevealed');
    assert(rev && rev.cards.length === 2, 'attack reveals all hidden charges');
    assert(find(ev, 'attack').value === 7 + 6 + 4, 'attack value = drawn + all charges');
    assert(find(ev, 'damage').amount === 12, 'damage 17 - 5 = 12');
    assert(a.charge.length === 0, 'charges consumed by the attack');
    assert(R.countAllCards(s) === 54, 'card conservation after charged attack');
  })();

  (function () {
    // taking a hit burns your charges; a blocked attack does not
    var s = R.newGame(['A', 'B'], 7);
    var b = s.players[1];
    b.charge = [s.deck.pop()];
    b.shield = R.makeCard(13, 'spades');
    b.health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(9, 'clubs'))];
    stackDeck(s, [findCard(s, 4)]);
    var ev = R.resolveAttack(s, 1); // 4 vs K -> blocked
    assert(has(ev, 'blocked') && !has(ev, 'chargesLost'), 'blocked attack leaves target charges alone');
    assert(b.charge.length === 1, 'charge survives a block');
    R.resolveCounter(s, 0);

    b.shield = R.makeCard(2, 'spades');
    R.advanceTurn(s); R.advanceTurn(s); // back to A
    stackDeck(s, [findCard(s, 9)]);
    var ev2 = R.resolveAttack(s, 1); // 9 vs 2 -> hit
    var cl = find(ev2, 'chargesLost');
    assert(cl && cl.reason === 'hit', 'life hit burns ALL held charges');
    assert(b.charge.length === 0, 'charge stack emptied by the hit');
  })();

  /* ---------------- counter (index-based, defender benefits) -------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 8);
    var a = s.players[0];
    a.health = [R.lifeSlot(R.makeCard(10, 'clubs')), R.lifeSlot(R.makeCard(9, 'clubs')), R.lifeSlot(R.makeCard(4, 'clubs'))];
    s.players[1].shield = R.makeCard(13, 'spades');
    stackDeck(s, [findCard(s, 3)]);
    R.resolveAttack(s, 1);
    assert(s.pending && s.pending.defenderId === 1, 'counter pending for the defender');
    stackDeck(s, [findCard(s, 12)]);
    var ev = R.resolveCounter(s, 2); // scramble the third card (the 4)
    var hr = find(ev, 'healthReplaced');
    assert(hr && hr.index === 2 && hr.oldCard.rank === 4, 'defender picks any life card by index');
    assert(a.health[2].card.rank === 12 && a.health[2].value === 12, 'scrambled card at face value');
    assert(!s.pending, 'pending cleared after counter');
  })();

  /* ---------------- jokers grant extra life ---------------- */

  (function () {
    // attack draw hits a joker: attacker gains a life card, next card attacks
    var s = R.newGame(['A', 'B'], 9);
    var a = s.players[0];
    s.players[1].shield = R.makeCard(5, 'spades');
    var joker = findCard(s, 0);
    var lifeC = findCard(s, 7);
    var atkC = findCard(s, 9);
    stackDeck(s, [joker, lifeC, atkC]); // joker drawn first
    var ev = R.resolveAttack(s, 1);
    var jd = find(ev, 'jokerDrawn');
    assert(jd && jd.playerId === 0, 'joker on an attack draw favors the attacker');
    var lg = find(ev, 'lifeGained');
    assert(lg && lg.card.id === lifeC.id, 'the next card joins the attacker\'s life');
    assert(a.health.length === 3, 'attacker now has three life cards');
    assert(find(ev, 'attack').card.id === atkC.id, 'the card after that is the attack card');
    assert(s.discard.some(function (c) { return c.joker; }), 'the joker is burnt');
    assert(R.countAllCards(s) === 54, 'card conservation with jokers');
  })();

  (function () {
    // joker during a counter benefits the DEFENDER performing it
    var s = R.newGame(['A', 'B'], 10);
    var b = s.players[1];
    b.shield = R.makeCard(13, 'spades');
    stackDeck(s, [findCard(s, 3)]);
    R.resolveAttack(s, 1);
    var joker = findCard(s, 0);
    var lifeC = findCard(s, 8);
    var replC = findCard(s, 5);
    stackDeck(s, [joker, lifeC, replC]);
    var ev = R.resolveCounter(s, 0);
    assert(find(ev, 'jokerDrawn').playerId === 1, 'joker in a counter favors the defender');
    assert(b.health.length === 3, 'defender gained the extra life card');
    assert(find(ev, 'healthReplaced').newCard.id === replC.id, 'the card after feeds the scramble');
  })();

  (function () {
    // two jokers chain: two extra life cards, then the action card
    var s = R.newGame(['A', 'B'], 11);
    var a = s.players[0];
    var j1 = findCard(s, 0);
    s.deck = s.deck.filter(function (c) { return c.id !== j1.id; });
    var j2 = findCard(s, 0);
    s.deck.push(j1);
    var l1 = findCard(s, 6), l2 = findCard(s, 9), chg = findCard(s, 3);
    stackDeck(s, [j1, l1, j2, l2, chg]);
    var ev = R.resolveCharge(s);
    assert(findAll(ev, 'jokerDrawn').length === 2, 'jokers can chain');
    assert(findAll(ev, 'lifeGained').length === 2, 'each joker grants a life card');
    assert(a.health.length === 4, 'two extra life cards gained');
    assert(a.charge.length === 1 && a.charge[0].id === chg.id, 'the action still completes');
  })();

  /* ---------------- gamble on the life ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 12);
    var a = s.players[0];
    stackDeck(s, [findCard(s, 8, { red: true })]);
    var ev = R.resolveGamble(s, 'red');
    var gr = find(ev, 'gambleResult');
    assert(gr && gr.win, 'correct color wins the gamble');
    assert(a.health.length === 3, 'won card joins your life');
    assert(R.hp(a) === a.health[0].value + a.health[1].value + 8, 'hp includes the won card');
    assert(R.countAllCards(s) === 54, 'card conservation after gamble win');
  })();

  (function () {
    var s = R.newGame(['A', 'B'], 13);
    stackDeck(s, [findCard(s, 8, { red: false })]);
    var ev = R.resolveGamble(s, 'red');
    assert(!find(ev, 'gambleResult').win, 'wrong color loses the gamble');
    assert(has(ev, 'eliminated') && s.players[0].eliminated, 'losing the gamble kills you immediately');
    assert(has(ev, 'win') && s.winnerId === 1, 'the survivor wins');
    assert(R.countAllCards(s) === 54, 'card conservation after gamble death');
  })();

  (function () {
    // joker mid-gamble: extra life first, then the next card decides -> 2 cards
    var s = R.newGame(['A', 'B'], 14);
    var a = s.players[0];
    var joker = findCard(s, 0);
    var lifeC = findCard(s, 5);
    var redC = findCard(s, 11, { red: true });
    stackDeck(s, [joker, lifeC, redC]);
    var ev = R.resolveGamble(s, 'red');
    assert(has(ev, 'jokerDrawn') && has(ev, 'lifeGained'), 'joker grants its life inside the gamble');
    assert(find(ev, 'gambleResult').win, 'the card after the joker decides the color');
    assert(a.health.length === 4, 'joker + won gamble = 2 extra life cards');
  })();

  /* ---------------- misc ---------------- */

  (function () {
    var s = R.newGame(['A', 'B', 'C', 'D'], 15);
    s.players[1].eliminated = true;
    s.players[2].eliminated = true;
    var ev = R.advanceTurn(s);
    assert(ev[0].playerId === 3, 'turn skips eliminated players');
    var la = R.legalActions(s);
    assert(la.attack.length === 1 && la.attack[0] === 0, 'attack targets exclude eliminated + self');
    assert(la.charge === true && la.gamble === true, 'charge and gamble always available');
  })();

  (function () {
    var s = R.newGame(['A', 'B'], 16);
    var sawReshuffle = false;
    for (var i = 0; i < 140; i++) {
      var ev = R.resolveChangeShield(s, i % 2);
      if (has(ev, 'reshuffle')) sawReshuffle = true;
      assert(R.countAllCards(s) === 54, 'card conservation during churn #' + i);
      if (sawReshuffle && i > 60) break;
    }
    assert(sawReshuffle, 'deck reshuffles from the burnt pile when exhausted');
  })();

  /* ---------------- fuzz: 400 random games ---------------- */

  (function () {
    var games = 400;
    var ok = true, terminated = true, maxTurns = 0, msg = '';
    for (var g = 0; g < games; g++) {
      var nPlayers = 2 + (g % 3);
      var names = [];
      for (var i = 0; i < nPlayers; i++) names.push('P' + i);
      var s = R.newGame(names, 2000 + g);
      var rng = R.makeRng(9000 + g);
      var turns = 0;
      while (s.winnerId === null && turns < 5000) {
        turns++;
        var la = R.legalActions(s);
        var roll = rng();
        if (roll < 0.55 && la.attack.length) {
          R.resolveAttack(s, la.attack[Math.floor(rng() * la.attack.length)]);
          if (s.pending) {
            var attacker = s.players[s.pending.attackerId];
            R.resolveCounter(s, Math.floor(rng() * attacker.health.length));
          }
        } else if (roll < 0.75) {
          R.resolveChangeShield(s, la.changeShield[Math.floor(rng() * la.changeShield.length)]);
        } else if (roll < 0.92) {
          R.resolveCharge(s);
        } else {
          R.resolveGamble(s, rng() < 0.5 ? 'red' : 'black');
        }
        if (R.countAllCards(s) !== 54) { ok = false; msg = 'conservation game ' + g; break; }
        var aliveOk = s.players.every(function (p) {
          return p.eliminated || (p.health.length > 0 && R.hp(p) > 0);
        });
        if (!aliveOk) { ok = false; msg = 'alive-but-dead game ' + g; break; }
        if (s.winnerId === null) R.advanceTurn(s);
      }
      if (s.winnerId === null) { terminated = false; msg = 'game ' + g + ' never ended'; }
      if (turns > maxTurns) maxTurns = turns;
      if (!ok || !terminated) break;
    }
    assert(ok, 'fuzz: invariants held across ' + games + ' random games ' + msg);
    assert(terminated, 'fuzz: every random game terminated (max turns: ' + maxTurns + ') ' + msg);
  })();

  /* ---------------- report ---------------- */

  var passed = results.filter(function (r) { return r.pass; }).length;
  var failed = results.length - passed;
  var summary = passed + '/' + results.length + ' passed' + (failed ? ' — ' + failed + ' FAILED' : '');

  if (typeof document !== 'undefined') {
    var root = document.getElementById('results');
    results.forEach(function (r) {
      var li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      li.textContent = (r.pass ? '✔ ' : '✘ ') + r.msg;
      root.appendChild(li);
    });
    document.getElementById('summary').textContent = summary;
    document.getElementById('summary').className = failed ? 'pass' : 'pass';
    document.getElementById('summary').className = failed ? 'fail' : 'pass';
  } else {
    console.log(summary);
    if (failed) {
      if (typeof process !== 'undefined') process.exitCode = 1;
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
