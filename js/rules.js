/* SHIELD — rules.js
 * Pure game logic. No DOM, no timers. Works in browser (window.Shield.rules)
 * and in Node (globalThis.Shield.rules) so tests can run headlessly.
 *
 * Every mutating action returns an ordered list of events — the "script"
 * that the UI plays back with animations.
 *
 * Core model:
 * - 54-card deck (52 + 2 jokers). Jokers are excluded from the initial deal.
 * - A player's life is a list of slots {card, value, pending}. Damage reduces
 *   the LOWEST-value slot first: the card is swapped for one of the new value
 *   from the burnt pile if available, otherwise it is marked pending ("red
 *   cross") and swaps automatically once such a card reaches the burnt pile.
 * - Charges stack, stay hidden until an attack reveals them, and are all lost
 *   when the holder takes life damage.
 * - Any draw that turns up a joker grants the acting player an extra life
 *   card, then the draw continues for its original purpose.
 * - Gamble: guess red/black on the next card — right adds it to your life,
 *   wrong kills you on the spot.
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
      red: suit === 'hearts' || suit === 'diamonds',
      joker: false
    };
  }

  function makeJoker(n) {
    return {
      rank: 0,
      suit: 'joker',
      id: 'X' + n,
      label: '★',
      glyph: '★',
      red: false,
      joker: true
    };
  }

  function buildDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 1; r <= 13; r++) {
        deck.push(makeCard(r, SUITS[s]));
      }
    }
    deck.push(makeJoker(1));
    deck.push(makeJoker(2));
    return deck;
  }

  var DECK_SIZE = 54;

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ---------------- Players & state ---------------- */

  function lifeSlot(card) {
    return { card: card, value: card.rank, pending: false };
  }

  function hp(player) {
    var sum = 0;
    for (var i = 0; i < player.health.length; i++) sum += player.health[i].value;
    return sum;
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
    // jokers sit out of the initial deal, then get shuffled back in
    var jokers = deck.filter(function (c) { return c.joker; });
    deck = deck.filter(function (c) { return !c.joker; });
    var players = names.map(function (name, i) {
      return {
        id: i,
        name: name,
        shield: deck.pop(),
        health: [lifeSlot(deck.pop()), lifeSlot(deck.pop())],
        charge: [],          // stack of hidden charge cards
        eliminated: false
      };
    });
    deck.push(jokers[0], jokers[1]);
    shuffle(deck, rng);
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

  /* Single draw choke point.
   * - Reshuffles the burnt pile into the deck when empty.
   * - A joker grants `beneficiaryId` an extra life card, then the draw
   *   continues for its original purpose (jokers can chain).
   * Returns a non-joker card.
   */
  function draw(state, events, purpose, beneficiaryId) {
    for (;;) {
      if (state.deck.length === 0) {
        if (state.discard.length === 0) {
          throw new Error('Shield: deck and discard both empty');
        }
        state.deck = shuffle(state.discard, state.rng);
        state.discard = [];
        events.push({ type: 'reshuffle', count: state.deck.length });
      }
      var card = state.deck.pop();
      // a joker drawn for a CHARGE stays hidden in the stack; it only triggers
      // when the charge is revealed by an attack
      if (card.joker && purpose !== 'charge' && beneficiaryId !== undefined && beneficiaryId !== null) {
        state.discard.push(card);
        events.push({ type: 'jokerDrawn', card: card, playerId: beneficiaryId, purpose: purpose });
        var lifeCard = draw(state, events, 'life', beneficiaryId); // recursion handles joker chains
        addLifeCard(state, beneficiaryId, lifeCard, events);
        continue; // redraw for the original purpose
      }
      events.push({ type: 'draw', card: card, purpose: purpose });
      return card;
    }
  }

  function addLifeCard(state, playerId, card, events) {
    var p = state.players[playerId];
    p.health.push(lifeSlot(card));
    events.push({ type: 'lifeGained', playerId: playerId, card: card, newHp: hp(p) });
  }

  function loseCharges(state, player, events, reason) {
    if (!player.charge.length) return;
    var cards = player.charge;
    player.charge = [];
    for (var i = 0; i < cards.length; i++) state.discard.push(cards[i]);
    events.push({ type: 'chargesLost', playerId: player.id, cards: cards, reason: reason });
  }

  function eliminate(state, player, events) {
    if (player.eliminated) return;
    player.eliminated = true;
    loseCharges(state, player, events, 'eliminated');
    events.push({ type: 'eliminated', playerId: player.id });
  }

  function checkWin(state, events) {
    var alive = alivePlayers(state);
    if (alive.length === 1 && state.winnerId === null) {
      state.winnerId = alive[0].id;
      events.push({ type: 'win', playerId: alive[0].id });
    }
  }

  /* find a non-joker card of the given rank in the burnt pile */
  function takeFromDiscard(state, rank) {
    for (var i = 0; i < state.discard.length; i++) {
      if (!state.discard[i].joker && state.discard[i].rank === rank) {
        return state.discard.splice(i, 1)[0];
      }
    }
    return null;
  }

  /* Damage cascade: hits the LOWEST-value life card first.
   * A partially damaged card swaps to its new denomination (from the burnt
   * pile if possible, else marked pending). A fully spent card is lost.
   * Taking any life damage also burns all held charges.
   */
  function applyDamage(state, target, amount, events, byId) {
    if (amount <= 0) return;
    events.push({
      type: 'damage',
      playerId: target.id,
      amount: amount,
      newHp: Math.max(hp(target) - amount, 0),
      byId: byId
    });
    loseCharges(state, target, events, 'hit');
    var remaining = amount;
    while (remaining > 0 && target.health.length) {
      var idx = 0;
      for (var i = 1; i < target.health.length; i++) {
        if (target.health[i].value < target.health[idx].value) idx = i;
      }
      var slot = target.health[idx];
      if (remaining >= slot.value) {
        remaining -= slot.value;
        target.health.splice(idx, 1);
        state.discard.push(slot.card);
        events.push({ type: 'lifeCardLost', playerId: target.id, index: idx, card: slot.card });
      } else {
        var newValue = slot.value - remaining;
        remaining = 0;
        var oldCard = slot.card;
        var swap = takeFromDiscard(state, newValue);
        if (swap) {
          slot.card = swap;
          slot.value = newValue;
          slot.pending = false;
          state.discard.push(oldCard);
        } else {
          slot.value = newValue;
          slot.pending = true;
        }
        events.push({
          type: 'lifeCardDown',
          playerId: target.id,
          index: idx,
          oldCard: oldCard,
          newValue: newValue,
          newCard: swap,
          pending: !swap
        });
      }
    }
    if (!target.health.length) {
      eliminate(state, target, events);
      checkWin(state, events);
    }
  }

  /* Sweep all pending ("red cross") life cards: once the burnt pile holds a
   * card of the owed denomination, swap it in. Swapping releases the old card
   * to the pile, which can satisfy further pendings — loop until stable.
   */
  function resolvePendingSwaps(state, events) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var p = 0; p < state.players.length; p++) {
        var player = state.players[p];
        if (player.eliminated) continue;
        for (var i = 0; i < player.health.length; i++) {
          var slot = player.health[i];
          if (!slot.pending) continue;
          var swap = takeFromDiscard(state, slot.value);
          if (swap) {
            var oldCard = slot.card;
            slot.card = swap;
            slot.pending = false;
            state.discard.push(oldCard);
            events.push({
              type: 'pendingResolved',
              playerId: player.id,
              index: i,
              oldCard: oldCard,
              newCard: swap
            });
            changed = true;
          }
        }
      }
    }
  }

  /* ---------------- Actions ---------------- */

  function legalActions(state) {
    var me = currentPlayer(state);
    var others = alivePlayers(state).filter(function (p) { return p.id !== me.id; });
    return {
      attack: others.map(function (p) { return p.id; }),
      changeShield: alivePlayers(state).map(function (p) { return p.id; }),
      charge: true,
      gamble: true
    };
  }

  function resolveAttack(state, targetId) {
    var events = [];
    var attacker = currentPlayer(state);
    var target = state.players[targetId];
    if (target.eliminated || target.id === attacker.id) {
      throw new Error('Shield: illegal attack target ' + targetId);
    }

    var drawn = draw(state, events, 'attack', attacker.id);
    var value = drawn.rank;
    var charges = attacker.charge;
    var burnt = [drawn];
    if (charges.length) {
      attacker.charge = [];
      events.push({ type: 'chargesRevealed', playerId: attacker.id, cards: charges });
      for (var i = 0; i < charges.length; i++) {
        var c = charges[i];
        if (c.joker) {
          // a joker hiding in the charge: revealed only now — grants its life
          // card, and an extra card is drawn to take its place in the attack
          state.discard.push(c);
          events.push({ type: 'jokerInCharge', playerId: attacker.id, card: c });
          var lifeCard = draw(state, events, 'life', attacker.id);
          addLifeCard(state, attacker.id, lifeCard, events);
          var repl = draw(state, events, 'chargeReplace', attacker.id);
          value += repl.rank;
          burnt.push(repl);
        } else {
          value += c.rank;
          burnt.push(c);
        }
      }
    }

    events.push({
      type: 'attack',
      attackerId: attacker.id,
      targetId: target.id,
      card: drawn,
      chargeCards: charges,
      value: value,
      shield: target.shield.rank
    });

    for (var b = 0; b < burnt.length; b++) state.discard.push(burnt[b]);

    if (value > target.shield.rank) {
      applyDamage(state, target, value - target.shield.rank, events, attacker.id);
    } else {
      state.pending = { type: 'counter', attackerId: attacker.id, defenderId: target.id };
      events.push({ type: 'blocked', attackerId: attacker.id, defenderId: target.id, value: value, shield: target.shield.rank });
      events.push({ type: 'counterRequired', attackerId: attacker.id, defenderId: target.id });
    }
    resolvePendingSwaps(state, events);
    return events;
  }

  /* The defender declines the counter: nothing happens, play moves on. */
  function resolveCounterSkip(state) {
    if (!state.pending || state.pending.type !== 'counter') {
      throw new Error('Shield: no counter pending');
    }
    var pending = state.pending;
    state.pending = null;
    return [{ type: 'counterDeclined', attackerId: pending.attackerId, defenderId: pending.defenderId }];
  }

  /* Defender picked which of the attacker's life cards (by index) to scramble.
   * A joker on this draw benefits the DEFENDER (the one performing it). */
  function resolveCounter(state, index) {
    if (!state.pending || state.pending.type !== 'counter') {
      throw new Error('Shield: no counter pending');
    }
    var pending = state.pending;
    state.pending = null;
    var attacker = state.players[pending.attackerId];
    if (index < 0 || index >= attacker.health.length) {
      throw new Error('Shield: bad counter index ' + index);
    }
    var events = [];
    var oldSlot = attacker.health[index];
    var oldHp = hp(attacker);
    var drawn = draw(state, events, 'health', pending.defenderId);
    attacker.health[index] = lifeSlot(drawn);
    state.discard.push(oldSlot.card);
    events.push({
      type: 'healthReplaced',
      playerId: attacker.id,
      index: index,
      oldCard: oldSlot.card,
      oldValue: oldSlot.value,
      newCard: drawn,
      oldHp: oldHp,
      newHp: hp(attacker),
      byId: pending.defenderId
    });
    resolvePendingSwaps(state, events);
    return events;
  }

  function resolveChangeShield(state, targetId) {
    var target = state.players[targetId];
    if (target.eliminated) throw new Error('Shield: illegal shield target ' + targetId);
    var events = [];
    var actor = currentPlayer(state);
    var drawn = draw(state, events, 'shield', actor.id);
    var oldCard = target.shield;
    target.shield = drawn;
    state.discard.push(oldCard);
    events.push({
      type: 'shieldReplaced',
      playerId: target.id,
      oldCard: oldCard,
      newCard: drawn,
      byId: actor.id
    });
    resolvePendingSwaps(state, events);
    return events;
  }

  function resolveCharge(state) {
    var me = currentPlayer(state);
    var events = [];
    var drawn = draw(state, events, 'charge', me.id);
    me.charge.push(drawn);
    events.push({ type: 'charged', playerId: me.id, card: drawn, count: me.charge.length });
    resolvePendingSwaps(state, events);
    return events;
  }

  /* Gamble on the life: guess 'red' or 'black' for the next card.
   * Right: the card joins your life. Wrong: you die on the spot.
   * A joker still grants its extra life first, then the NEXT card decides
   * (the color pick cannot change mid-gamble). */
  function resolveGamble(state, guess) {
    if (guess !== 'red' && guess !== 'black') throw new Error('Shield: bad guess ' + guess);
    var me = currentPlayer(state);
    var events = [];
    events.push({ type: 'gamble', playerId: me.id, guess: guess });
    var card = draw(state, events, 'gamble', me.id);
    var win = (card.red ? 'red' : 'black') === guess;
    if (win) {
      me.health.push(lifeSlot(card));
      events.push({ type: 'gambleResult', playerId: me.id, card: card, guess: guess, win: true, newHp: hp(me) });
    } else {
      state.discard.push(card);
      events.push({ type: 'gambleResult', playerId: me.id, card: card, guess: guess, win: false });
      eliminate(state, me, events);
      checkWin(state, events);
    }
    resolvePendingSwaps(state, events);
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

  /* Test/debug helper: move a card with the given rank (0 = joker) to the top
   * of the deck. */
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
      n += 1;                    // shield
      n += p.health.length;      // life cards (incl. pending/red-cross ones)
      n += p.charge.length;      // hidden charges
    });
    return n;
  }

  global.Shield = global.Shield || {};
  global.Shield.rules = {
    SUITS: SUITS,
    DECK_SIZE: DECK_SIZE,
    makeCard: makeCard,
    makeJoker: makeJoker,
    buildDeck: buildDeck,
    makeRng: makeRng,
    rankLabel: rankLabel,
    lifeSlot: lifeSlot,
    hp: hp,
    alivePlayers: alivePlayers,
    currentPlayer: currentPlayer,
    newGame: newGame,
    legalActions: legalActions,
    resolveAttack: resolveAttack,
    resolveCounter: resolveCounter,
    resolveCounterSkip: resolveCounterSkip,
    resolveChangeShield: resolveChangeShield,
    resolveCharge: resolveCharge,
    resolveGamble: resolveGamble,
    advanceTurn: advanceTurn,
    forceNextDraw: forceNextDraw,
    countAllCards: countAllCards
  };
})(typeof window !== 'undefined' ? window : globalThis);
