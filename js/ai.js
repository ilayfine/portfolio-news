/* SHIELD — ai.js
 * CPU opponents. Four tiers:
 *   easy       — heuristics with frequent blunders
 *   medium     — straight heuristics
 *   hard       — paired flat Monte Carlo: every legal move is evaluated by
 *                simulating complete games against COMMON sampled worlds
 *                (the unseen cards — deck order and everyone's hidden
 *                charges — reshuffled per world, identically for every
 *                candidate move, so shuffle luck cancels between moves and
 *                the bot cannot peek), with rollouts played by an
 *                ε-randomized heuristic policy.
 *   impossible — the same search with ~14x the simulation budget.
 *
 * Pure logic on top of Shield.rules — no DOM. Works in Node for tests.
 * The async choose()/chooseCounter() wrappers yield to the event loop so
 * long searches never freeze animations.
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;

  /* tuning */
  var CFG = {
    easyEps: 0.5,
    mediumEps: 0.08,
    rolloutEps: 0.2,
    rolloutMaxTurns: 50,
    simsPerMove: 45,       // hard: paired-sim budget per root move
    counterSims: 25,       // hard: budget per counter option
    simsPerMoveImpossible: 650,  // impossible: ~14x the thinking
    counterSimsImpossible: 280,
    ucb: 0.7,
    minPerMove: 6,         // explore every move at least this much first
    yieldEvery: 60         // async: yield to the event loop every N sims
  };

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  /* ---------------- state cloning & determinization ---------------- */

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* card objects are immutable — share them, clone every container */
  function cloneState(s, rng) {
    return {
      players: s.players.map(function (p) {
        return {
          id: p.id,
          name: p.name,
          shield: p.shield,
          health: p.health.map(function (sl) {
            return { card: sl.card, value: sl.value, pending: sl.pending };
          }),
          charge: p.charge.slice(),
          eliminated: p.eliminated
        };
      }),
      deck: s.deck.slice(),
      discard: s.discard.slice(),
      currentIdx: s.currentIdx,
      turn: s.turn,
      pending: s.pending
        ? { type: s.pending.type, attackerId: s.pending.attackerId, defenderId: s.pending.defenderId }
        : null,
      winnerId: s.winnerId,
      rng: rng
    };
  }

  /* The deck's ORDER and every charge stack's CONTENTS are unknown to all
   * players (owners included). Pool them, reshuffle, deal back — each
   * simulation then lives in one possible world instead of the real one. */
  function determinize(s, rng) {
    var pool = s.deck.slice();
    s.players.forEach(function (p) {
      for (var i = 0; i < p.charge.length; i++) pool.push(p.charge[i]);
    });
    shuffle(pool, rng);
    s.players.forEach(function (p) {
      var n = p.charge.length;
      if (n) p.charge = pool.splice(0, n);
    });
    s.deck = pool;
  }

  /* ---------------- shared observations ---------------- */

  function unseenCards(state) {
    var cards = state.deck.slice();
    state.players.forEach(function (p) {
      for (var i = 0; i < p.charge.length; i++) cards.push(p.charge[i]);
    });
    return cards;
  }

  /* distribution of the next unseen draw (jokers valued ~mean: they redraw) */
  function drawStats(state) {
    var cards = unseenCards(state);
    var ranks = [], sum = 0, red = 0, black = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.joker) { ranks.push(7); sum += 7; }
      else {
        ranks.push(c.rank); sum += c.rank;
        if (c.red) red++; else black++;
      }
    }
    if (!ranks.length) { ranks = [7]; sum = 7; }
    return { ranks: ranks, mean: sum / ranks.length, red: red, black: black };
  }

  function probBeat(stats, shield, bonus) {
    var hit = 0;
    for (var i = 0; i < stats.ranks.length; i++) if (stats.ranks[i] + bonus > shield) hit++;
    return hit / stats.ranks.length;
  }

  function expDamage(stats, shield, bonus) {
    var s = 0;
    for (var i = 0; i < stats.ranks.length; i++) {
      var d = stats.ranks[i] + bonus - shield;
      if (d > 0) s += d;
    }
    return s / stats.ranks.length;
  }

  function probKill(stats, shield, bonus, hp) {
    var k = 0;
    for (var i = 0; i < stats.ranks.length; i++) if (stats.ranks[i] + bonus - shield >= hp) k++;
    return k / stats.ranks.length;
  }

  function maxLifeValue(p) {
    var m = 0;
    for (var i = 0; i < p.health.length; i++) m = Math.max(m, p.health[i].value);
    return m;
  }

  /* ---------------- move enumeration ---------------- */

  function legalMoves(state) {
    var la = R.legalActions(state);
    var moves = [];
    la.attack.forEach(function (id) { moves.push({ type: 'attack', target: id }); });
    la.changeShield.forEach(function (id) { moves.push({ type: 'shield', target: id }); });
    if (la.charge) moves.push({ type: 'charge' });
    if (la.gamble) {
      var st = drawStats(state);
      moves.push({ type: 'gamble', guess: st.red >= st.black ? 'red' : 'black' });
    }
    return moves;
  }

  /* ---------------- heuristic policy ---------------- */

  function scoreMove(state, pid, mv, stats) {
    var me = state.players[pid];
    var chargeBonus = me.charge.length * stats.mean;
    // bloodlust grows as the game drags, so long games always end
    var late = Math.min((state.turn || 0) / 60, 3);
    if (mv.type === 'attack') {
      var t = state.players[mv.target];
      var pB = probBeat(stats, t.shield.rank, chargeBonus);
      var eD = expDamage(stats, t.shield.rank, chargeBonus);
      var pK = probKill(stats, t.shield.rank, chargeBonus, R.hp(t));
      // a blocked attack invites a scramble of my best life card
      var counterRisk = (1 - pB) * Math.max(maxLifeValue(me) - stats.mean, 0) * 0.5;
      return eD + pK * 8 - counterRisk + 0.25 + late * 1.5;
    }
    if (mv.type === 'shield') {
      var target = state.players[mv.target];
      if (mv.target === pid) {
        // fish for a better shield when mine is weak (less appealing late)
        return (stats.mean - me.shield.rank) * 1.1 - late * 0.6;
      }
      // smash a strong enemy shield down toward the average (pointless as a
      // way of life: it decays as the game drags, else two players ping-pong
      // smash-and-repair forever)
      return (target.shield.rank - stats.mean) * 0.75 - late * 0.9;
    }
    if (mv.type === 'charge') {
      // worth it when nobody is very hittable right now and I'm not exposed
      var bestNow = 0, bestCharged = 0;
      state.players.forEach(function (p) {
        if (p.id === pid || p.eliminated) return;
        bestNow = Math.max(bestNow, expDamage(stats, p.shield.rank, chargeBonus));
        bestCharged = Math.max(bestCharged, expDamage(stats, p.shield.rank, chargeBonus + stats.mean));
      });
      var exposure = (me.shield.rank < 6 ? 1.3 : 0.4) + me.charge.length * 0.45;
      return (bestCharged - bestNow) * 0.8 + 0.7 - exposure;
    }
    // gamble: ~coin flip for your life — only sane when nearly dead anyway,
    // or when a marathon needs breaking
    var pWin = (stats.red + stats.black) ? (mv.guess === 'red' ? stats.red : stats.black) / (stats.red + stats.black) : 0.5;
    return pWin * 7 - (1 - pWin) * R.hp(me) * 1.2 - 2 + late * 1.1;
  }

  function heuristicMove(state, pid, rng, eps) {
    var moves = legalMoves(state);
    if (rng() < eps) return moves[Math.floor(rng() * moves.length)];
    var stats = drawStats(state);
    var best = moves[0], bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var sc = scoreMove(state, pid, moves[i], stats);
      if (sc > bestScore) { bestScore = sc; best = moves[i]; }
    }
    return best;
  }

  /* counter: scramble the attacker's best card if it beats the expected
   * replacement, otherwise decline. Returns a life-card index or null. */
  function counterChoice(state) {
    if (!state.pending) return null;
    var attacker = state.players[state.pending.attackerId];
    var stats = drawStats(state);
    var best = -1, bestVal = -Infinity;
    for (var i = 0; i < attacker.health.length; i++) {
      if (attacker.health[i].value > bestVal) { bestVal = attacker.health[i].value; best = i; }
    }
    return bestVal > stats.mean + 0.5 ? best : null;
  }

  /* ---------------- simulation ---------------- */

  function applyMove(state, mv, rng) {
    if (mv.type === 'attack') {
      R.resolveAttack(state, mv.target);
      if (state.pending) {
        var pick = counterChoice(state);
        if (pick === null) R.resolveCounterSkip(state);
        else R.resolveCounter(state, pick);
      }
    } else if (mv.type === 'shield') {
      R.resolveChangeShield(state, mv.target);
    } else if (mv.type === 'charge') {
      R.resolveCharge(state);
    } else {
      R.resolveGamble(state, mv.guess);
    }
    if (state.winnerId === null) R.advanceTurn(state);
  }

  function rollout(state, rng) {
    var turns = 0;
    while (state.winnerId === null && turns < CFG.rolloutMaxTurns) {
      var mv = heuristicMove(state, state.currentIdx, rng, CFG.rolloutEps);
      applyMove(state, mv, rng);
      turns++;
    }
  }

  /* win = 1, death = 0, unfinished = soft score by health share */
  function scoreState(state, pid) {
    if (state.winnerId === pid) return 1;
    if (state.winnerId !== null) return 0;
    var me = state.players[pid];
    if (me.eliminated) return 0;
    var total = 0;
    state.players.forEach(function (p) { if (!p.eliminated) total += R.hp(p); });
    return 0.15 + 0.7 * (total ? R.hp(me) / total : 0);
  }

  /* one determinized simulation of `prep(simState)` followed by a rollout */
  function simulate(state, pid, prep, rng) {
    var sim = cloneState(state, rng);
    determinize(sim, rng);
    prep(sim);
    rollout(sim, rng);
    return scoreState(sim, pid);
  }

  /* Paired flat Monte Carlo with common random numbers: each "round" deals
   * ONE possible world (same shuffle of the unseen cards, same rollout seed)
   * and evaluates EVERY candidate move against it. Shuffle luck then cancels
   * between moves, so their true difference emerges with far fewer
   * simulations than independent sampling. */
  function mcPick(state, pid, arms, simsPerArm, rng) {
    var budget = simsPerArm * arms.length;
    var done = 0;
    var armIdx = 0;
    var worldSeed = 0;
    function oneRound() {
      if (armIdx === 0) worldSeed = Math.floor(rng() * 0x7fffffff);
      var arm = arms[armIdx];
      var worldRng = R.makeRng(worldSeed); // identical world for every arm
      arm.sum += simulate(state, pid, arm.prep, worldRng);
      arm.n++;
      done++;
      armIdx = (armIdx + 1) % arms.length;
    }
    return {
      step: oneRound,
      remaining: function () { return budget - done; },
      best: function () {
        var best = arms[0], bestMean = -Infinity;
        for (var i = 0; i < arms.length; i++) {
          var m = arms[i].sum / Math.max(arms[i].n, 1);
          if (m > bestMean) { bestMean = m; best = arms[i]; }
        }
        return best;
      }
    };
  }

  function runSync(runner) {
    while (runner.remaining() > 0) runner.step();
    return runner.best();
  }

  function runAsync(runner) {
    return new Promise(function (resolve) {
      (function slice() {
        var n = 0;
        while (runner.remaining() > 0 && n < CFG.yieldEvery) { runner.step(); n++; }
        if (runner.remaining() > 0) setTimeout(slice, 0);
        else resolve(runner.best());
      })();
    });
  }

  /* ---------------- decisions ---------------- */

  function moveArms(state, pid) {
    return legalMoves(state).map(function (mv) {
      return { mv: mv, n: 0, sum: 0, prep: function (sim) { applyMove(sim, mv, sim.rng); } };
    });
  }

  function counterArms(state, pid) {
    var attacker = state.players[state.pending.attackerId];
    var arms = [];
    for (var i = 0; i < attacker.health.length; i++) {
      (function (idx) {
        arms.push({
          mv: idx, n: 0, sum: 0,
          prep: function (sim) {
            R.resolveCounter(sim, idx);
            if (sim.winnerId === null) R.advanceTurn(sim);
          }
        });
      })(i);
    }
    arms.push({
      mv: null, n: 0, sum: 0,
      prep: function (sim) {
        R.resolveCounterSkip(sim);
        if (sim.winnerId === null) R.advanceTurn(sim);
      }
    });
    return arms;
  }

  function isSearchTier(difficulty) {
    return difficulty === 'hard' || difficulty === 'impossible';
  }

  function moveBudget(difficulty, opts) {
    if (opts.sims) return opts.sims;
    return difficulty === 'impossible' ? CFG.simsPerMoveImpossible : CFG.simsPerMove;
  }

  function counterBudget(difficulty, opts) {
    if (opts.sims) return opts.sims;
    return difficulty === 'impossible' ? CFG.counterSimsImpossible : CFG.counterSims;
  }

  function chooseSync(state, pid, difficulty, opts) {
    opts = opts || {};
    var rng = opts.rng || R.makeRng(opts.seed);
    if (difficulty === 'easy') return heuristicMove(state, pid, rng, CFG.easyEps);
    if (difficulty === 'medium') return heuristicMove(state, pid, rng, CFG.mediumEps);
    var arms = moveArms(state, pid);
    if (arms.length === 1) return arms[0].mv;
    return runSync(mcPick(state, pid, arms, moveBudget(difficulty, opts), rng)).mv;
  }

  function choose(state, pid, difficulty, opts) {
    opts = opts || {};
    if (!isSearchTier(difficulty)) return Promise.resolve(chooseSync(state, pid, difficulty, opts));
    var rng = opts.rng || R.makeRng(opts.seed);
    var arms = moveArms(state, pid);
    if (arms.length === 1) return Promise.resolve(arms[0].mv);
    return runAsync(mcPick(state, pid, arms, moveBudget(difficulty, opts), rng))
      .then(function (a) { return a.mv; });
  }

  function chooseCounterSync(state, pid, difficulty, opts) {
    opts = opts || {};
    var rng = opts.rng || R.makeRng(opts.seed);
    if (difficulty === 'easy') {
      if (rng() < 0.4) return null;
      var attacker = state.players[state.pending.attackerId];
      return Math.floor(rng() * attacker.health.length);
    }
    if (difficulty === 'medium') return counterChoice(state);
    return runSync(mcPick(state, pid, counterArms(state, pid), counterBudget(difficulty, opts), rng)).mv;
  }

  function chooseCounter(state, pid, difficulty, opts) {
    opts = opts || {};
    if (!isSearchTier(difficulty)) return Promise.resolve(chooseCounterSync(state, pid, difficulty, opts));
    var rng = opts.rng || R.makeRng(opts.seed);
    return runAsync(mcPick(state, pid, counterArms(state, pid), counterBudget(difficulty, opts), rng))
      .then(function (a) { return a.mv; });
  }

  global.Shield = global.Shield || {};
  global.Shield.ai = {
    CFG: CFG,
    choose: choose,
    chooseSync: chooseSync,
    chooseCounter: chooseCounter,
    chooseCounterSync: chooseCounterSync,
    /* exposed for tests */
    legalMoves: legalMoves,
    cloneState: cloneState,
    determinize: determinize,
    heuristicMove: heuristicMove,
    counterChoice: counterChoice,
    applyMove: applyMove,
    drawStats: drawStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
