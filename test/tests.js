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

  function eventTypes(events) {
    return events.map(function (e) { return e.type; });
  }

  function has(events, type) {
    return events.some(function (e) { return e.type === type; });
  }

  function find(events, type) {
    return events.filter(function (e) { return e.type === type; })[0];
  }

  /* ---------------- deck & setup ---------------- */

  (function () {
    var deck = R.buildDeck();
    assert(deck.length === 52, 'deck has 52 cards');
    var ids = {};
    deck.forEach(function (c) { ids[c.id] = true; });
    assert(Object.keys(ids).length === 52, 'all 52 cards unique');
    assert(deck.every(function (c) { return c.rank >= 1 && c.rank <= 13; }), 'ranks 1..13');
  })();

  (function () {
    var s = R.newGame(['A', 'B', 'C', 'D'], 1);
    assert(s.players.length === 4, 'four players created');
    assert(s.deck.length === 52 - 12, 'deck has 40 cards after dealing 4 players');
    s.players.forEach(function (p) {
      assert(!!p.shield && p.health.length === 2, p.name + ' has shield + 2 health');
      assert(R.hp(p) === p.health[0].rank + p.health[1].rank, p.name + ' hp = sum of health cards');
    });
    assert(R.countAllCards(s) === 52, 'card conservation after deal');
  })();

  /* ---------------- attack: hit ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 2);
    s.players[1].shield = R.makeCard(5, 'spades'); // fix shield for determinism
    R.forceNextDraw(s, 8);
    var ev = R.resolveAttack(s, 1);
    var dmg = find(ev, 'damage');
    assert(!!dmg, 'attack 8 vs shield 5 deals damage');
    assert(dmg.amount === 3, 'damage amount is attack - shield = 3');
    assert(s.players[1].damage === 3, 'target damage accumulated');
    assert(dmg.newHp === R.hp(s.players[1]), 'damage event reports new hp');
    assert(!s.pending, 'no counter pending after a hit');
  })();

  /* ---------------- attack: blocked -> counter ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 3);
    s.players[1].shield = R.makeCard(13, 'spades'); // K blocks everything
    R.forceNextDraw(s, 4);
    var ev = R.resolveAttack(s, 1);
    assert(has(ev, 'blocked'), 'attack 4 vs shield K is blocked');
    assert(has(ev, 'counterRequired'), 'blocked attack requires a counter');
    assert(!has(ev, 'damage'), 'blocked attack deals no damage');
    assert(s.pending && s.pending.type === 'counter', 'counter is pending');
    assert(s.pending.attackerId === 0 && s.pending.defenderId === 1, 'counter roles correct');

    // equal value is also blocked
    var s2 = R.newGame(['A', 'B'], 4);
    s2.players[1].shield = R.makeCard(7, 'hearts');
    R.forceNextDraw(s2, 7);
    var ev2 = R.resolveAttack(s2, 1);
    assert(has(ev2, 'blocked'), 'attack equal to shield is blocked');
  })();

  /* ---------------- counter: replaces attacker health, recomputes pool ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 5);
    s.players[0].health = [R.makeCard(10, 'clubs'), R.makeCard(9, 'clubs')];
    s.players[0].damage = 4; // pool = 15
    s.players[1].shield = R.makeCard(13, 'spades');
    R.forceNextDraw(s, 2);
    R.resolveAttack(s, 1);
    R.forceNextDraw(s, 1); // counter draws an Ace
    var ev = R.resolveCounter(s, 0);
    var hr = find(ev, 'healthReplaced');
    assert(!!hr, 'counter replaces a health card');
    assert(hr.playerId === 0 && hr.byId === 1, 'defender scrambles the ATTACKER\'s card');
    assert(s.players[0].health[0].rank === 1, 'chosen slot got the drawn card');
    assert(R.hp(s.players[0]) === 1 + 9 - 4, 'pool recomputed: newCard + other - damage');
    assert(hr.newHp === 6 && hr.oldHp === 15, 'event reports old/new hp');
    assert(!s.pending, 'pending cleared after counter');
  })();

  /* ---------------- counter can eliminate the attacker ---------------- */

  (function () {
    var s = R.newGame(['A', 'B', 'C'], 6);
    s.players[0].health = [R.makeCard(13, 'clubs'), R.makeCard(1, 'clubs')];
    s.players[0].damage = 13; // pool = 1, kept alive by the King
    s.players[1].shield = R.makeCard(13, 'spades');
    R.forceNextDraw(s, 3);
    R.resolveAttack(s, 1);
    R.forceNextDraw(s, 5); // K replaced by 5 -> pool = 5 + 1 - 13 = -7
    var ev = R.resolveCounter(s, 0);
    assert(has(ev, 'eliminated'), 'counter can eliminate the attacker');
    assert(find(ev, 'eliminated').playerId === 0, 'the attacker is the one eliminated');
    assert(s.players[0].eliminated, 'attacker flagged eliminated');
    assert(s.winnerId === null, 'no winner yet with 2 players remaining');
  })();

  /* ---------------- defender wins via counter (2 players) ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 7);
    s.players[0].health = [R.makeCard(13, 'clubs'), R.makeCard(1, 'clubs')];
    s.players[0].damage = 13;
    s.players[1].shield = R.makeCard(13, 'spades');
    R.forceNextDraw(s, 2);
    R.resolveAttack(s, 1);
    R.forceNextDraw(s, 4);
    var ev = R.resolveCounter(s, 0);
    assert(has(ev, 'win'), 'defender wins when counter eliminates last opponent');
    assert(find(ev, 'win').playerId === 1, 'winner is the defender');
    assert(s.winnerId === 1, 'winnerId set');
    assert(R.advanceTurn(s).length === 0, 'no turn advance after win');
  })();

  /* ---------------- charge ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 8);
    R.forceNextDraw(s, 6);
    var ev = R.resolveCharge(s);
    assert(has(ev, 'charged'), 'charge event emitted');
    assert(s.players[0].charge && s.players[0].charge.rank === 6, 'charge slot holds the card');
    assert(R.legalActions(s).charge === false, 'cannot charge while holding a charge');

    var threw = false;
    try { R.resolveCharge(s); } catch (e) { threw = true; }
    assert(threw, 'double charge throws');

    s.players[1].shield = R.makeCard(5, 'spades');
    R.forceNextDraw(s, 7);
    var ev2 = R.resolveAttack(s, 1);
    var atk = find(ev2, 'attack');
    assert(has(ev2, 'chargeConsumed'), 'charge consumed on attack');
    assert(atk.value === 13, 'attack value = charge 6 + drawn 7');
    assert(find(ev2, 'damage').amount === 8, 'damage 13 - 5 = 8');
    assert(s.players[0].charge === null, 'charge slot empty after attack');
    assert(R.countAllCards(s) === 52, 'card conservation after charged attack');
  })();

  /* ---------------- change shield (self and opponent) ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 9);
    var oldOwn = s.players[0].shield;
    var ev = R.resolveChangeShield(s, 0);
    assert(has(ev, 'shieldReplaced'), 'self shield change works');
    assert(s.players[0].shield.id !== oldOwn.id, 'shield actually replaced');
    assert(s.discard.indexOf(oldOwn) !== -1, 'old shield went to discard');

    var oldOpp = s.players[1].shield;
    R.resolveChangeShield(s, 1);
    assert(s.players[1].shield.id !== oldOpp.id, 'opponent shield change works');
    assert(R.countAllCards(s) === 52, 'card conservation after shield changes');
  })();

  /* ---------------- turn order skips eliminated ---------------- */

  (function () {
    var s = R.newGame(['A', 'B', 'C', 'D'], 10);
    s.players[1].eliminated = true;
    s.players[2].eliminated = true;
    var ev = R.advanceTurn(s);
    assert(ev[0].playerId === 3, 'turn skips eliminated players');
    var la = R.legalActions(s);
    assert(la.attack.length === 1 && la.attack[0] === 0, 'attack targets exclude eliminated + self');
    assert(la.changeShield.indexOf(1) === -1 && la.changeShield.indexOf(2) === -1,
      'shield targets exclude eliminated');
    assert(la.changeShield.indexOf(3) !== -1, 'shield targets include self');
  })();

  /* ---------------- reshuffle when deck empties ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 11);
    // burn the deck down with shield changes (each recycles a card to discard)
    var sawReshuffle = false;
    for (var i = 0; i < 120; i++) {
      var ev = R.resolveChangeShield(s, i % 2);
      if (has(ev, 'reshuffle')) sawReshuffle = true;
      assert(R.countAllCards(s) === 52, 'card conservation during churn #' + i);
      if (sawReshuffle && i > 60) break;
    }
    assert(sawReshuffle, 'deck reshuffles from discard when exhausted');
    assert(s.deck.length + s.discard.length === 52 - 6, 'deck+discard = 52 - table cards');
  })();

  /* ---------------- eliminated player loses their charge ---------------- */

  (function () {
    var s = R.newGame(['A', 'B'], 12);
    s.players[1].health = [R.makeCard(1, 'clubs'), R.makeCard(1, 'spades')];
    s.players[1].damage = 0; // pool = 2
    s.players[1].shield = R.makeCard(1, 'hearts');
    s.players[1].charge = s.deck.pop(); // give B a held charge
    R.forceNextDraw(s, 13);
    var ev = R.resolveAttack(s, 1);
    assert(has(ev, 'eliminated'), 'B eliminated by big attack');
    assert(has(ev, 'chargeLost'), 'eliminated player\'s charge is discarded');
    assert(s.players[1].charge === null, 'charge slot cleared');
    assert(has(ev, 'win'), 'last player standing wins');
    assert(R.countAllCards(s) === 52, 'card conservation after elimination');
  })();

  /* ---------------- fuzz: 500 random games, invariants hold, games end ---------------- */

  (function () {
    var games = 500;
    var ok = true, terminated = true, maxTurns = 0;
    for (var g = 0; g < games; g++) {
      var nPlayers = 2 + (g % 3);
      var names = [];
      for (var i = 0; i < nPlayers; i++) names.push('P' + i);
      var s = R.newGame(names, 1000 + g);
      var rng = R.makeRng(9000 + g);
      var turns = 0;
      while (s.winnerId === null && turns < 5000) {
        turns++;
        var la = R.legalActions(s);
        var options = [];
        if (la.attack.length) options.push('attack');
        if (la.changeShield.length) options.push('shield');
        if (la.charge) options.push('charge');
        var pick = options[Math.floor(rng() * options.length)];
        var ev;
        if (pick === 'attack') {
          var t = la.attack[Math.floor(rng() * la.attack.length)];
          ev = R.resolveAttack(s, t);
          if (s.pending) R.resolveCounter(s, Math.floor(rng() * 2));
        } else if (pick === 'shield') {
          var t2 = la.changeShield[Math.floor(rng() * la.changeShield.length)];
          ev = R.resolveChangeShield(s, t2);
        } else {
          ev = R.resolveCharge(s);
        }
        if (R.countAllCards(s) !== 52) { ok = false; break; }
        var aliveOk = s.players.every(function (p) {
          return p.eliminated ? true : R.hp(p) > 0;
        });
        if (!aliveOk) { ok = false; break; }
        if (s.winnerId === null) R.advanceTurn(s);
      }
      if (s.winnerId === null) terminated = false;
      if (turns > maxTurns) maxTurns = turns;
      if (!ok) break;
    }
    assert(ok, 'fuzz: invariants held across ' + games + ' random games');
    assert(terminated, 'fuzz: every random game terminated (max turns seen: ' + maxTurns + ')');
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
    document.getElementById('summary').className = failed ? 'fail' : 'pass';
  } else {
    console.log(summary);
    if (failed) {
      if (typeof process !== 'undefined') process.exitCode = 1;
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
