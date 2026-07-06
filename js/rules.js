/* SHIELD — rules.js
 * Pure game logic. No DOM, no timers. Works in browser (window.Shield.rules)
 * and in Node (globalThis.Shield.rules) so tests can run headlessly.
 *
 * Every mutating action returns an ordered list of events — the "script"
 * that the UI plays back with animations.
 */
(function (global) {
  'use strict';

  var SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
  var SUIT_GLYPH = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
  var SUIT_LETTER = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };
  var RANK_LABEL = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

  /* ---------------- RNG (seedable for deterministic tests) ---------------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    return (seed === undefined || seed === null) ? Math.random : mulberry32(seed);
  }

  /* ---------------- Cards & deck ---------------- */

  function rankLabel(rank) {
    return RANK_LABEL[rank] || String(rank);
  }

  function makeCard(rank, suit) {
    return {
      rank: rank,
      suit: suit,
      id: SUIT_LETTER[suit] + rank,
      label: rankLabel(rank),
      glyph: SUIT_GLYPH[suit],
      red: suit === 'hearts' || suit === 'diamonds'
    };
  }

  function buildDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) {
        deck.push(makeCard(r, SUITS[s]));
      }
    }
    return deck;
  }

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ---------------- Players & state ---------------- */

  function hp(player) {
    return player.health[0].rank + player.health[1].rank - player.damage;
  }

  function alivePlayers(state) {
    return state.players.filter(function (p) { return !p.eliminated; });
  }

  function currentPlayer(state) {
    return state.players[state.currentIdx];
  }

  function newGame(names, seed) {
    var rng = makeRng(seed);
    var deck = shuffle(buildDeck(), rng);
    var players = names.map(function (name, i) {
      return {
        id: i,
        name: name,
        shield: deck.pop(),
        health: [deck.pop(), deck.pop()],
        damage: 0,
        charge: null,
        eliminated: false
      };
    });
    return {
      players: players,
      deck: deck,
      discard: [],
      currentIdx: 0,
      pending: null,   // {type:'counter', attackerId, defenderId} while waiting for defender pick
      winnerId: null,
      rng: rng
    };
  }

  /* Single draw choke point: reshuffles discard into deck when empty. */
  function draw(state, events, purpose) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) {
        throw new Error('Shield: deck and discard both empty — impossible with a 52-card deck');
      }
      state.deck = shuffle(state.discard, state.rng);
      state.discard = [];
      events.push({ type: 'reshuffle', count: state.deck.length });
    }
    var card = state.deck.pop();
    events.push({ type: 'draw', card: card, purpose: purpose });
    return card;
  }

  function checkElimination(state, player, events) {
    if (!player.eliminated && hp(player) <= 0) {
      player.eliminated = true;
      if (player.charge) {
        state.discard.push(player.charge);
        events.push({ type: 'chargeLost', playerId: player.id, card: player.charge });
        player.charge = null;
      }
      events.push({ type: 'eliminated', playerId: player.id });
    }
  }

  function checkWin(state, events) {
    var alive = alivePlayers(state);
    if (alive.length === 1 && state.winnerId === null) {
      state.winnerId = alive[0].id;
      events.push({ type: 'win', playerId: alive[0].id });
    }
  }

  /* ---------------- Actions ---------------- */

  function legalActions(state) {
    var me = currentPlayer(state);
    var others = alivePlayers(state).filter(function (p) { return p.id !== me.id; });
    return {
      attack: others.map(function (p) { return p.id; }),
      changeShield: alivePlayers(state).map(function (p) { return p.id; }),
      charge: !me.charge
    };
  }

  function resolveAttack(state, targetId) {
    var events = [];
    var attacker = currentPlayer(state);
    var target = state.players[targetId];
    if (target.eliminated || target.id === attacker.id) {
      throw new Error('Shield: illegal attack target ' + targetId);
    }

    var drawn = draw(state, events, 'attack');
    var value = drawn.rank;
    var chargeCard = null;
    if (attacker.charge) {
      chargeCard = attacker.charge;
      attacker.charge = null;
      value += chargeCard.rank;
      events.push({ type: 'chargeConsumed', playerId: attacker.id, card: chargeCard, total: value });
    }

    events.push({
      type: 'attack',
      attackerId: attacker.id,
      targetId: target.id,
      card: drawn,
      chargeCard: chargeCard,
      value: value,
      shield: target.shield.rank
    });

    state.discard.push(drawn);
    if (chargeCard) state.discard.push(chargeCard);

    if (value > target.shield.rank) {
      var dmg = value - target.shield.rank;
      target.damage += dmg;
      events.push({ type: 'damage', playerId: target.id, amount: dmg, newHp: hp(target), byId: attacker.id });
      checkElimination(state, target, events);
      checkWin(state, events);
    } else {
      state.pending = { type: 'counter', attackerId: attacker.id, defenderId: target.id };
      events.push({ type: 'blocked', attackerId: attacker.id, defenderId: target.id, value: value, shield: target.shield.rank });
      events.push({ type: 'counterRequired', attackerId: attacker.id, defenderId: target.id });
    }
    return events;
  }

  /* Defender picked which of the attacker's health cards (slot 0|1) to scramble. */
  function resolveCounter(state, slot) {
    if (!state.pending || state.pending.type !== 'counter') {
      throw new Error('Shield: no counter pending');
    }
    var pending = state.pending;
    state.pending = null;
    var attacker = state.players[pending.attackerId];
    var events = [];
    var oldCard = attacker.health[slot];
    var oldHp = hp(attacker);
    var drawn = draw(state, events, 'health');
    attacker.health[slot] = drawn;
    state.discard.push(oldCard);
    events.push({
      type: 'healthReplaced',
      playerId: attacker.id,
      slot: slot,
      oldCard: oldCard,
      newCard: drawn,
      oldHp: oldHp,
      newHp: hp(attacker),
      byId: pending.defenderId
    });
    checkElimination(state, attacker, events);
    checkWin(state, events);
    return events;
  }

  function resolveChangeShield(state, targetId) {
    var target = state.players[targetId];
    if (target.eliminated) throw new Error('Shield: illegal shield target ' + targetId);
    var events = [];
    var drawn = draw(state, events, 'shield');
    var oldCard = target.shield;
    target.shield = drawn;
    state.discard.push(oldCard);
    events.push({
      type: 'shieldReplaced',
      playerId: target.id,
      oldCard: oldCard,
      newCard: drawn,
      byId: currentPlayer(state).id
    });
    return events;
  }

  function resolveCharge(state) {
    var me = currentPlayer(state);
    if (me.charge) throw new Error('Shield: charge slot already full');
    var events = [];
    var drawn = draw(state, events, 'charge');
    me.charge = drawn;
    events.push({ type: 'charged', playerId: me.id, card: drawn });
    return events;
  }

  function advanceTurn(state) {
    if (state.winnerId !== null) return [];
    var n = state.players.length;
    var idx = state.currentIdx;
    for (var step = 1; step <= n; step++) {
      var next = (idx + step) % n;
      if (!state.players[next].eliminated) {
        state.currentIdx = next;
        return [{ type: 'turnStart', playerId: next }];
      }
    }
    throw new Error('Shield: no living players to advance to');
  }

  /* Test/debug helper: move a card with the given rank to the top of the deck. */
  function forceNextDraw(state, rank) {
    for (var i = state.deck.length - 1; i >= 0; i--) {
      if (state.deck[i].rank === rank) {
        var card = state.deck.splice(i, 1)[0];
        state.deck.push(card);
        return card;
      }
    }
    return null;
  }

  /* Invariant helper for tests: every card accounted for exactly once. */
  function countAllCards(state) {
    var n = state.deck.length + state.discard.length;
    state.players.forEach(function (p) {
      n += 3;
      if (p.charge) n += 1;
    });
    return n;
  }

  global.Shield = global.Shield || {};
  global.Shield.rules = {
    SUITS: SUITS,
    makeCard: makeCard,
    buildDeck: buildDeck,
    makeRng: makeRng,
    rankLabel: rankLabel,
    hp: hp,
    alivePlayers: alivePlayers,
    currentPlayer: currentPlayer,
    newGame: newGame,
    legalActions: legalActions,
    resolveAttack: resolveAttack,
    resolveCounter: resolveCounter,
    resolveChangeShield: resolveChangeShield,
    resolveCharge: resolveCharge,
    advanceTurn: advanceTurn,
    forceNextDraw: forceNextDraw,
    countAllCards: countAllCards
  };
})(typeof window !== 'undefined' ? window : globalThis);
