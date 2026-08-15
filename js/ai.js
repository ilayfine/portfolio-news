/* SHIELD — ai.js
 * CPU opponents. Playable tiers:
 *   easy       — EV heuristics with frequent blunders
 *   medium     — straight EV heuristics (greedy)
 *   hard       — paired flat Monte Carlo: every legal move is evaluated by
 *                simulating complete games against COMMON sampled worlds
 *                (the unseen cards — deck order and everyone's hidden
 *                charges — reshuffled per world, identically for every
 *                candidate move, so shuffle luck cancels between moves and
 *                the bot cannot peek), with rollouts played by a stochastic
 *                softmax policy over one-ply EV scores.
 *   impossible — the same search with a much larger simulation budget.
 * Harness-only tiers (not offered in the UI, used to benchmark generations):
 *   medium-legacy — the previous ad-hoc heuristic, greedy
 *   hard-legacy   — the previous search: ε-greedy rollouts over the ad-hoc
 *                   heuristic, deterministic counter play
 *
 * INFORMATION MODEL (what a bot may know):
 *   Public: every shield, every life card, the discard pile, charge COUNTS.
 *   Hidden from everyone (owners included): deck order and charge CONTENTS.
 *   Bots card-count the unseen multiset = deck + all charge stacks (exactly
 *   what a human could deduce: 54 cards minus everything face-up). They never
 *   read which card sits where: scoring uses only the pooled histogram, and
 *   determinize() sorts the pool canonically before reshuffling, so every
 *   decision is provably invariant to how the unseen cards are partitioned
 *   between the deck and the charge stacks (tested in test/tests.js).
 *
 * SCORING (scoreMoveEV): every action is priced in ONE currency — expected
 * net HP swing (my ΔHP minus opponents' ΔHP), with explicit bonuses for
 * kills/wins — so the softmax sampler compares like with like.
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
    rolloutEps: 0.2,       // legacy rollouts: ε-greedy blunder rate
    softmaxT: 1.2,         // rollout softmax temperature (HP-units scale; tuned by sweep)
    softmaxFloor: 0.02,    // uniform mixture floor: every move stays possible
    rolloutMaxTurns: 50,
    simsPerMove: 150,      // hard: paired-sim budget per root move
    counterSims: 80,       // hard: budget per counter option
    simsPerMoveImpossible: 2200,  // impossible: harness budget (opts.sims/simScale)
    counterSimsImpossible: 1000,
    impossibleTimeMs: 2000,       // real games: impossible thinks 2s flat,
    impossibleCounterTimeMs: 700, // as many sims as the machine gives it
    yieldEvery: 400,       // async: yield to the event loop every N sims
    /* EV-scoring constants (HP units) */
    winValue: 26,          // killing the last rival IS the win
    killValue: 10,         // removing one of several rivals
    slotBonus: 2,          // an extra life slot is a damage buffer
    equityK: 8,            // dying costs your stake in the game, not just HP
    shieldHorizon: 4,      // attacks affected per shield change (tuned by sweep:
                           // greedy play undervalued shields badly, esp. 4p)
    riskWeight: 1,         // weight on the blocked-attack counter risk
    burnWeight: 1          // weight on the charge-burn discount
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
   * players (owners included). Pool them, sort canonically (so the outcome
   * cannot depend on which stack a card happened to sit in), reshuffle, deal
   * back — each simulation then lives in one possible world, never the real
   * one. */
  function determinize(s, rng) {
    var pool = s.deck.slice();
    s.players.forEach(function (p) {
      for (var i = 0; i < p.charge.length; i++) pool.push(p.charge[i]);
    });
    pool.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    shuffle(pool, rng);
    s.players.forEach(function (p) {
      var n = p.charge.length;
      if (n) p.charge = pool.splice(0, n);
    });
    s.deck = pool;
  }

  /* ---------------- card counting (shared observations) ---------------- */

  /* Histogram of the unseen multiset (deck + every charge stack): counts per
   * rank for real cards, jokers tracked separately (a drawn joker chains into
   * a replacement draw, so for value purposes it behaves like ~mean).
   * O(unseen) once per decision; every query below is O(13). */
  function drawStats(state) {
    var counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var n = 0, sum = 0, red = 0, black = 0, jokers = 0;
    function tally(c) {
      if (c.joker) { jokers++; return; }
      counts[c.rank]++; n++; sum += c.rank;
      if (c.red) red++; else black++;
    }
    for (var i = 0; i < state.deck.length; i++) tally(state.deck[i]);
    var ps = state.players;
    for (var p = 0; p < ps.length; p++) {
      for (var j = 0; j < ps[p].charge.length; j++) tally(ps[p].charge[j]);
    }
    var mean = n ? sum / n : 7;
    return { counts: counts, n: n, jokers: jokers, total: n + jokers || 1, mean: mean, red: red, black: black };
  }

  /* P(draw + bonus > shield) over the unseen distribution */
  function probBeat(st, shield, bonus) {
    var hit = 0;
    for (var r = 1; r <= 13; r++) if (r + bonus > shield) hit += st.counts[r];
    if (st.jokers && st.mean + bonus > shield) hit += st.jokers;
    return hit / st.total;
  }

  /* E[max(draw + bonus − shield, 0)] */
  function expDamage(st, shield, bonus) {
    var s = 0;
    for (var r = 1; r <= 13; r++) {
      var d = r + bonus - shield;
      if (d > 0) s += d * st.counts[r];
    }
    var dj = st.mean + bonus - shield;
    if (st.jokers && dj > 0) s += dj * st.jokers;
    return s / st.total;
  }

  /* P(draw + bonus − shield >= hp) */
  function probKill(st, shield, bonus, hp) {
    var k = 0;
    for (var r = 1; r <= 13; r++) if (r + bonus - shield >= hp) k += st.counts[r];
    if (st.jokers && st.mean + bonus - shield >= hp) k += st.jokers;
    return k / st.total;
  }

  /* E over a freshly drawn shield s' (real cards only — a joker never lands
   * as a shield) of expDamage(st, s', bonus): what attacks yield once this
   * shield is replaced by a random one. */
  function expOverNewShield(st, bonus) {
    var sum = 0, n = 0;
    for (var sr = 1; sr <= 13; sr++) {
      var c = st.counts[sr];
      if (!c) continue;
      sum += c * expDamage(st, sr, bonus);
      n += c;
    }
    return n ? sum / n : expDamage(st, 7, bonus);
  }

  function maxLifeValue(p) {
    var m = 0;
    for (var i = 0; i < p.health.length; i++) m = Math.max(m, p.health[i].value);
    return m;
  }

  function countAlive(state) {
    var n = 0;
    for (var i = 0; i < state.players.length; i++) if (!state.players[i].eliminated) n++;
    return n;
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

  /* ---------------- EV scoring: one currency, expected net HP swing ------- */

  function scoreMoveEV(state, pid, mv, st) {
    var me = state.players[pid];
    var alive = countAlive(state);
    var bonus = me.charge.length * st.mean;
    // bloodlust grows as the game drags, so long games always end; applied
    // only to the attack-vs-everything-else margin so it never distorts
    // WHICH target/shield/etc is preferred within a move type. The high cap
    // matters: ~2% of all-searcher 4p games deadlock past turn 200 unless
    // the pressure keeps climbing
    var late = Math.min((state.turn || 0) / 60, 8);

    if (mv.type === 'attack') {
      var t = state.players[mv.target];
      var pB = probBeat(st, t.shield.rank, bonus);
      var eD = expDamage(st, t.shield.rank, bonus);
      var pK = probKill(st, t.shield.rank, bonus, R.hp(t));
      // heads-up a kill IS the win; in a crowd it removes one rival
      var kill = pK * (alive === 2 ? CFG.winValue : CFG.killValue);
      // a blocked attack lets the defender scramble my best life card for a
      // random one — they take that deal whenever it profits them
      var counterLoss = maxLifeValue(me) - st.mean;
      var risk = counterLoss > 0.5 ? (1 - pB) * counterLoss * CFG.riskWeight : 0;
      return eD + kill - risk + 0.3 + late * 1.5;
    }

    if (mv.type === 'shield') {
      var target = state.players[mv.target];
      if (mv.target === pid) {
        // value = expected damage per incoming attack now vs after a random
        // replacement, over the attacks the new shield will face (convex:
        // shield 3→7 blocks far more than 9→13)
        var now = expDamage(st, me.shield.rank, 0);
        var after = expOverNewShield(st, 0);
        return (now - after) * CFG.shieldHorizon - late * 0.6;
      }
      // smashing an enemy shield raises MY expected damage against them —
      // but it is a public good shared with every other attacker
      var nowVs = expDamage(st, target.shield.rank, bonus);
      var afterVs = expOverNewShield(st, bonus);
      var rivals = Math.max(alive - 1, 1);
      return (afterVs - nowVs) * CFG.shieldHorizon / rivals - late * 0.9;
    }

    if (mv.type === 'charge') {
      // marginal value: how much one more hidden card improves my best
      // attack — realized only if the stack survives until I swing
      var bestGain = 0;
      for (var i = 0; i < state.players.length; i++) {
        var p = state.players[i];
        if (p.id === pid || p.eliminated) continue;
        var g = expDamage(st, p.shield.rank, bonus + st.mean) - expDamage(st, p.shield.rank, bonus);
        if (g > bestGain) bestGain = g;
      }
      // charges burn on any life damage: ~one enemy attack lands on me
      // before my next turn with this probability
      var pBurn = Math.min(probBeat(st, me.shield.rank, 0) * CFG.burnWeight, 0.95);
      // a joker hiding in the stack later gifts a life card + replacement
      var jokerBonus = (st.jokers / st.total) * (st.mean + CFG.slotBonus);
      return (1 - pBurn) * bestGain + jokerBonus + 0.4 - late * 0.5;
    }

    // gamble: win = the card joins my life (value + a fresh buffer slot);
    // loss = death, which costs my HP plus my equity in the game
    var colored = st.red + st.black;
    var pWin = colored ? (mv.guess === 'red' ? st.red : st.black) / colored : 0.5;
    return pWin * (st.mean + CFG.slotBonus) - (1 - pWin) * (R.hp(me) + CFG.equityK) + late * 1.1;
  }

  /* ---------------- legacy scoring (benchmark baseline) ---------------- */

  function scoreMoveLegacy(state, pid, mv, st) {
    var me = state.players[pid];
    var chargeBonus = me.charge.length * st.mean;
    var late = Math.min((state.turn || 0) / 60, 3);
    if (mv.type === 'attack') {
      var t = state.players[mv.target];
      var pB = probBeat(st, t.shield.rank, chargeBonus);
      var eD = expDamage(st, t.shield.rank, chargeBonus);
      var pK = probKill(st, t.shield.rank, chargeBonus, R.hp(t));
      var counterRisk = (1 - pB) * Math.max(maxLifeValue(me) - st.mean, 0) * 0.5;
      return eD + pK * 8 - counterRisk + 0.25 + late * 1.5;
    }
    if (mv.type === 'shield') {
      var target = state.players[mv.target];
      if (mv.target === pid) return (st.mean - me.shield.rank) * 1.1 - late * 0.6;
      return (target.shield.rank - st.mean) * 0.75 - late * 0.9;
    }
    if (mv.type === 'charge') {
      var bestNow = 0, bestCharged = 0;
      state.players.forEach(function (p) {
        if (p.id === pid || p.eliminated) return;
        bestNow = Math.max(bestNow, expDamage(st, p.shield.rank, chargeBonus));
        bestCharged = Math.max(bestCharged, expDamage(st, p.shield.rank, chargeBonus + st.mean));
      });
      var exposure = (me.shield.rank < 6 ? 1.3 : 0.4) + me.charge.length * 0.45;
      return (bestCharged - bestNow) * 0.8 + 0.7 - exposure;
    }
    var colored = st.red + st.black;
    var pWin = colored ? (mv.guess === 'red' ? st.red : st.black) / colored : 0.5;
    return pWin * 7 - (1 - pWin) * R.hp(me) * 1.2 - 2 + late * 1.1;
  }

  /* ---------------- stochastic sampler: softmax with a uniform floor ------ */

  /* With prob `floor` pick uniformly (every legal line stays live — vital
   * for unbiased EV analysis later); otherwise Boltzmann-sample exp(s/T). */
  function softmaxIndex(scores, rng, T, floor) {
    var n = scores.length;
    if (n === 1) return 0;
    if (rng() < floor) return Math.floor(rng() * n);
    var max = -Infinity, i;
    for (i = 0; i < n; i++) if (scores[i] > max) max = scores[i];
    var sum = 0, w = new Array(n);
    for (i = 0; i < n; i++) { w[i] = Math.exp((scores[i] - max) / T); sum += w[i]; }
    var r = rng() * sum;
    for (i = 0; i < n; i++) { r -= w[i]; if (r <= 0) return i; }
    return n - 1;
  }

  /* ---------------- policies ---------------- */

  function greedyMove(state, pid, rng, eps, scoreFn) {
    var moves = legalMoves(state);
    if (rng() < eps) return moves[Math.floor(rng() * moves.length)];
    var st = drawStats(state);
    var best = moves[0], bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var sc = scoreFn(state, pid, moves[i], st);
      if (sc > bestScore) { bestScore = sc; best = moves[i]; }
    }
    return best;
  }

  /* kept name: greedy over the EV scores (easy/medium and tools use this) */
  function heuristicMove(state, pid, rng, eps) {
    return greedyMove(state, pid, rng, eps, scoreMoveEV);
  }

  function softmaxMove(state, pid, rng) {
    var moves = legalMoves(state);
    if (moves.length === 1) return moves[0];
    var st = drawStats(state);
    var scores = new Array(moves.length);
    for (var i = 0; i < moves.length; i++) scores[i] = scoreMoveEV(state, pid, moves[i], st);
    return moves[softmaxIndex(scores, rng, CFG.softmaxT, CFG.softmaxFloor)];
  }

  /* deterministic counter (medium tier + legacy rollouts): scramble the
   * attacker's best card if it beats the expected replacement, else decline */
  function counterChoice(state) {
    if (!state.pending) return null;
    var attacker = state.players[state.pending.attackerId];
    var st = drawStats(state);
    var best = -1, bestVal = -Infinity;
    for (var i = 0; i < attacker.health.length; i++) {
      if (attacker.health[i].value > bestVal) { bestVal = attacker.health[i].value; best = i; }
    }
    return bestVal > st.mean + 0.5 ? best : null;
  }

  /* stochastic counter (EV rollouts): softmax over "scramble slot i"
   * (expected HP knocked off the attacker) vs "decline" (0), same sampler
   * as main moves so simulated defenders stay diverse too */
  function softmaxCounter(state, rng) {
    if (!state.pending) return null;
    var attacker = state.players[state.pending.attackerId];
    var st = drawStats(state);
    var n = attacker.health.length;
    var scores = new Array(n + 1);
    for (var i = 0; i < n; i++) scores[i] = attacker.health[i].value - st.mean;
    scores[n] = 0; // decline
    var pick = softmaxIndex(scores, rng, CFG.softmaxT, CFG.softmaxFloor);
    return pick === n ? null : pick;
  }

  /* rollout policies: how simulated players behave inside a world */
  var ROLLOUT_POLICIES = {
    ev: {
      move: function (s, pid, rng) { return softmaxMove(s, pid, rng); },
      counter: function (s, rng) { return softmaxCounter(s, rng); }
    },
    legacy: {
      move: function (s, pid, rng) { return greedyMove(s, pid, rng, CFG.rolloutEps, scoreMoveLegacy); },
      counter: function (s, rng) { return counterChoice(s); }
    }
  };

  /* ---------------- simulation ---------------- */

  function applyMove(state, mv, rng, counterFn) {
    counterFn = counterFn || function (s) { return counterChoice(s); };
    if (mv.type === 'attack') {
      R.resolveAttack(state, mv.target);
      if (state.pending) {
        var pick = counterFn(state, rng);
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

  function rollout(state, rng, policy) {
    var turns = 0;
    while (state.winnerId === null && turns < CFG.rolloutMaxTurns) {
      var mv = policy.move(state, state.currentIdx, rng);
      applyMove(state, mv, rng, policy.counter);
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

  /* One simulation of `prep(simState)` followed by a rollout.
   * `cheat` skips determinization: the sim then runs on the REAL deck order
   * and the REAL charge contents instead of one possible world — that is
   * the ☠️ Hacker tier, which is knowingly playing with the cards face up. */
  function simulate(state, pid, prep, rng, policy, cheat) {
    var sim = cloneState(state, rng);
    if (!cheat) determinize(sim, rng);
    prep(sim, rng, policy);
    rollout(sim, rng, policy);
    return scoreState(sim, pid);
  }

  /* ---------------- ISMCTS: adversarial tree search ----------------
   * Flat Monte Carlo is optimistic: rollout opponents play a fixed softmax
   * policy, so a candidate move with ONE crushing refutation still scores
   * well because the refutation is rarely sampled. Here every decision in
   * the first MAXDEPTH plies — every player's, counters included — is
   * instead chosen by UCB over statistics accumulated across worlds: as
   * soon as a strong reply starts winning for its owner, it gets picked
   * more, and the move above it is credited with the value of being
   * PUNISHED, not the value of being spared. Each player node maximizes
   * that player's own win rate (max^n), so 3-4 player politics stay sound.
   * Beyond the tree horizon, softmax rollouts finish the game as before. */
  var MCTS = { ucb: 0.8, maxDepth: 8 };

  function mvKey(mv) {
    if (mv.type === 'attack') return 'a' + mv.target;
    if (mv.type === 'shield') return 's' + mv.target;
    if (mv.type === 'charge') return 'c';
    return 'g' + mv.guess;
  }

  /* apply a main move but STOP at a blocked attack: the counter is a
   * decision the tree searches, not a policy call */
  function applyMainMove(state, mv, rng) {
    if (mv.type === 'attack') {
      R.resolveAttack(state, mv.target);
      if (state.pending) return; // defender's node comes next
    } else if (mv.type === 'shield') {
      R.resolveChangeShield(state, mv.target);
    } else if (mv.type === 'charge') {
      R.resolveCharge(state);
    } else {
      R.resolveGamble(state, mv.guess);
    }
    if (state.winnerId === null) R.advanceTurn(state);
  }

  /* whose turn is it and what can they do, in this world? */
  function decisionPoint(sim) {
    if (sim.winnerId !== null) return null;
    if (sim.pending) {
      var attacker = sim.players[sim.pending.attackerId];
      var moves = [];
      for (var i = 0; i < attacker.health.length; i++) {
        (function (idx) {
          moves.push({
            key: 'x' + idx,
            apply: function (s) {
              R.resolveCounter(s, idx);
              if (s.winnerId === null) R.advanceTurn(s);
            }
          });
        })(i);
      }
      moves.push({
        key: 'xskip',
        apply: function (s) {
          R.resolveCounterSkip(s);
          if (s.winnerId === null) R.advanceTurn(s);
        }
      });
      return { actor: sim.pending.defenderId, moves: moves };
    }
    var actor = sim.currentIdx;
    return {
      actor: actor,
      moves: legalMoves(sim).map(function (mv) {
        return { key: mvKey(mv), apply: function (s, rng) { applyMainMove(s, mv, rng); } };
      })
    };
  }

  /* one iteration: sample a world, apply the root move, descend the tree by
   * UCB, expand one node, roll out, credit every visited (node, move) with
   * the outcome FOR ITS OWN ACTOR */
  function mctsIterate(state, pid, rootApply, tree, rng, cheat) {
    var sim = cloneState(state, rng);
    if (!cheat) determinize(sim, rng);
    rootApply(sim, rng);
    var visited = [];
    var node = tree;
    for (var depth = 0; depth < MCTS.maxDepth; depth++) {
      var dp = decisionPoint(sim);
      if (!dp) break;
      var kids = node.kids || (node.kids = {});
      var move = null, expand = false;
      var unvisited = [];
      for (var i = 0; i < dp.moves.length; i++) {
        if (!kids[dp.moves[i].key]) unvisited.push(dp.moves[i]);
      }
      if (unvisited.length) {
        move = unvisited[Math.floor(rng() * unvisited.length)];
        expand = true;
      } else {
        var logN = Math.log((node.n || 0) + 1);
        var best = -Infinity;
        for (var m = 0; m < dp.moves.length; m++) {
          var k = kids[dp.moves[m].key];
          var u = k.sum / k.n + MCTS.ucb * Math.sqrt(logN / k.n);
          if (u > best) { best = u; move = dp.moves[m]; }
        }
      }
      var kid = kids[move.key] || (kids[move.key] = { n: 0, sum: 0, kids: null });
      node.n = (node.n || 0) + 1;
      move.apply(sim, rng);
      visited.push({ stat: kid, actor: dp.actor });
      node = kid;
      if (expand) break;
    }
    // a blocked attack left hanging by the horizon: settle it by policy
    if (sim.pending) {
      var pick = softmaxCounter(sim, rng);
      if (pick === null) R.resolveCounterSkip(sim); else R.resolveCounter(sim, pick);
      if (sim.winnerId === null) R.advanceTurn(sim);
    }
    rollout(sim, rng, ROLLOUT_POLICIES.ev);
    for (var v = 0; v < visited.length; v++) {
      var r = scoreState(sim, visited[v].actor);
      visited[v].stat.n++;
      visited[v].stat.sum += r;
    }
    return scoreState(sim, pid);
  }

  /* Root arms get equal budget round-robin (so every action's EV is equally
   * trustworthy for analysis); below the root, UCB sharpens all replies. */
  function mctsRunner(state, pid, arms, simsPerArm, rng, deadline, cheat) {
    var budget = simsPerArm * arms.length;
    var done = 0, armIdx = 0;
    return {
      step: function () {
        var arm = arms[armIdx];
        arm.sum += mctsIterate(state, pid, arm.rootApply, arm.tree, rng, cheat);
        arm.n++;
        done++;
        armIdx = (armIdx + 1) % arms.length;
      },
      remaining: function () {
        if (deadline && armIdx === 0 && done >= arms.length && Date.now() >= deadline) return 0;
        return budget - done;
      },
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

  function mctsArms(state, pid, bothGambleColors) {
    var moves = legalMoves(state);
    if (bothGambleColors) {
      moves.forEach(function (mv) {
        if (mv.type === 'gamble') {
          moves.push({ type: 'gamble', guess: mv.guess === 'red' ? 'black' : 'red' });
        }
      });
    }
    return moves.map(function (mv) {
      return {
        mv: mv, n: 0, sum: 0, tree: { n: 0, kids: null },
        rootApply: function (sim, rng) { applyMainMove(sim, mv, rng); }
      };
    });
  }

  /* counter decision as MCTS roots: each pick (or declining) is an arm */
  function mctsCounterArms(state) {
    var attacker = state.players[state.pending.attackerId];
    var arms = [];
    function counterArm(mv, fn) {
      return {
        mv: mv, n: 0, sum: 0, tree: { n: 0, kids: null },
        rootApply: function (sim) {
          fn(sim);
          if (sim.winnerId === null) R.advanceTurn(sim);
        }
      };
    }
    for (var i = 0; i < attacker.health.length; i++) {
      (function (idx) {
        arms.push(counterArm(idx, function (sim) { R.resolveCounter(sim, idx); }));
      })(i);
    }
    arms.push(counterArm(null, function (sim) { R.resolveCounterSkip(sim); }));
    return arms;
  }

  /* Paired flat Monte Carlo with common random numbers: each "round" deals
   * ONE possible world (same shuffle of the unseen cards, same rollout seed)
   * and evaluates EVERY candidate move against it. Shuffle luck then cancels
   * between moves, so their true difference emerges with far fewer
   * simulations than independent sampling. */
  function mcPick(state, pid, arms, simsPerArm, rng, policy, deadline, cheat) {
    var budget = simsPerArm * arms.length;
    var done = 0;
    var armIdx = 0;
    var worldSeed = 0;
    function oneRound() {
      if (armIdx === 0) worldSeed = Math.floor(rng() * 0x7fffffff);
      var arm = arms[armIdx];
      var worldRng = R.makeRng(worldSeed); // identical world for every arm
      arm.sum += simulate(state, pid, arm.prep, worldRng, policy, cheat);
      arm.n++;
      done++;
      armIdx = (armIdx + 1) % arms.length;
    }
    return {
      step: oneRound,
      remaining: function () {
        // a time-boxed search stops at its deadline, but only between full
        // paired rounds so every arm has seen the same worlds
        if (deadline && armIdx === 0 && done >= arms.length && Date.now() >= deadline) return 0;
        return budget - done;
      },
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

  /* Yield to the event loop WITHOUT setTimeout: browsers clamp nested
   * timers (4ms, and far worse under throttling), which can starve a
   * time-boxed search down to a few percent of its budget. A MessageChannel
   * post is a genuine macrotask with no clamping. */
  var scheduleTick = (function () {
    // browser only: in Node an open MessageChannel port pins the event loop
    if (typeof window !== 'undefined' && typeof MessageChannel !== 'undefined') {
      var ch = new MessageChannel();
      var queue = [];
      ch.port1.onmessage = function () {
        var cb = queue.shift();
        if (cb) cb();
      };
      return function (cb) { queue.push(cb); ch.port2.postMessage(0); };
    }
    return function (cb) { setTimeout(cb, 0); };
  })();

  /* work in ~25ms slices: long enough to be efficient, short enough that
   * animations never stutter */
  function runAsync(runner) {
    return new Promise(function (resolve) {
      (function slice() {
        var sliceEnd = Date.now() + 25;
        while (runner.remaining() > 0 && Date.now() < sliceEnd) runner.step();
        if (runner.remaining() > 0) scheduleTick(slice);
        else resolve(runner.best());
      })();
    });
  }

  /* ---------------- decisions ---------------- */

  function moveArms(state, pid) {
    return legalMoves(state).map(function (mv) {
      return {
        mv: mv, n: 0, sum: 0,
        prep: function (sim, rng, policy) { applyMove(sim, mv, rng, policy.counter); }
      };
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

  /* tier table: how each difficulty decides. Measured tradeoff: flat paired
   * MC is stronger at small sim budgets (variance-efficient), the ISMCTS
   * tree equals it at medium budgets and pulls ahead with volume — so Hard
   * plays flat, Impossible (1s time-box) and evaluate() use the tree. */
  var TIERS = {
    easy: { kind: 'greedy', eps: CFG.easyEps, score: scoreMoveEV },
    medium: { kind: 'greedy', eps: CFG.mediumEps, score: scoreMoveEV },
    'medium-legacy': { kind: 'greedy', eps: CFG.mediumEps, score: scoreMoveLegacy },
    hard: { kind: 'search', policy: 'ev', budget: 'normal', flat: true },
    'hard-mcts': { kind: 'search', policy: 'ev', budget: 'normal' },
    'hard-legacy': { kind: 'search', policy: 'legacy', budget: 'normal', flat: true },
    impossible: { kind: 'search', policy: 'ev', budget: 'huge' },
    /* the cheat: same search, but its simulations run on the REAL deck
     * order and the REAL charge stacks instead of reshuffled possible
     * worlds. It knows what it will draw and what everyone is holding. */
    hacker: { kind: 'search', policy: 'ev', budget: 'huge', cheat: true }
  };

  function tierOf(difficulty) {
    var t = TIERS[difficulty];
    if (!t) throw new Error('Shield.ai: unknown difficulty ' + difficulty);
    return t;
  }

  function moveBudget(tier, opts) {
    if (opts.sims) return opts.sims;
    var base = tier.budget === 'huge' ? CFG.simsPerMoveImpossible : CFG.simsPerMove;
    return Math.max(Math.round(base * (opts.simScale || 1)), 4);
  }

  function counterBudget(tier, opts) {
    if (opts.sims) return opts.sims;
    var base = tier.budget === 'huge' ? CFG.counterSimsImpossible : CFG.counterSims;
    return Math.max(Math.round(base * (opts.simScale || 1)), 4);
  }

  /* Real games (no explicit sims/simScale from a harness): impossible is
   * TIME-boxed — it burns a fixed thinking time and takes every simulation
   * the machine gives it. The sims cap is set far above what any machine
   * reaches inside the deadline. Returns {sims, deadline}. */
  function searchBudget(tier, opts, kind) {
    var timeboxed = tier.budget === 'huge' && !opts.sims && !opts.simScale;
    if (!timeboxed) {
      return {
        sims: kind === 'counter' ? counterBudget(tier, opts) : moveBudget(tier, opts),
        deadline: null
      };
    }
    var ms = kind === 'counter' ? CFG.impossibleCounterTimeMs : CFG.impossibleTimeMs;
    return { sims: 1000000, deadline: Date.now() + ms };
  }

  function moveRunner(state, pid, tier, opts, rng) {
    var b = searchBudget(tier, opts, 'move');
    if (tier.flat) {
      var arms = moveArms(state, pid);
      return arms.length === 1 ? { only: arms[0] }
        : { runner: mcPick(state, pid, arms, b.sims, rng, ROLLOUT_POLICIES[tier.policy], b.deadline, tier.cheat) };
    }
    var marms = mctsArms(state, pid, false);
    return marms.length === 1 ? { only: marms[0] }
      : { runner: mctsRunner(state, pid, marms, b.sims, rng, b.deadline, tier.cheat) };
  }

  function chooseSync(state, pid, difficulty, opts) {
    opts = opts || {};
    var tier = tierOf(difficulty);
    var rng = opts.rng || R.makeRng(opts.seed);
    if (tier.kind === 'greedy') return greedyMove(state, pid, rng, tier.eps, tier.score);
    var r = moveRunner(state, pid, tier, opts, rng);
    return r.only ? r.only.mv : runSync(r.runner).mv;
  }

  function choose(state, pid, difficulty, opts) {
    opts = opts || {};
    var tier = tierOf(difficulty);
    if (tier.kind !== 'search') return Promise.resolve(chooseSync(state, pid, difficulty, opts));
    var rng = opts.rng || R.makeRng(opts.seed);
    var r = moveRunner(state, pid, tier, opts, rng);
    if (r.only) return Promise.resolve(r.only.mv);
    return runAsync(r.runner).then(function (a) { return a.mv; });
  }

  /* ---------------- analysis: EV of every action ----------------
   * Runs the same adversarial ISMCTS as the impossible bot, but keeps ALL
   * the root means instead of only the winner. Root actions share the
   * budget equally (every EV equally trustworthy); below the root every
   * reply — the opponents' included — sharpens toward its owner's best
   * line as iterations accumulate, so a candidate with a strong refutation
   * gets PUNISHED for it rather than scored against average play. Both
   * gamble colors are evaluated (play only ever offers the better-count
   * color). Reports live via opts.onProgress(rows, elapsedMs, totalMs);
   * resolves with rows sorted best-first: {move, ev, sims} where ev is the
   * share of simulated futures the mover goes on to win. */
  function evaluate(state, pid, opts) {
    opts = opts || {};
    var rng = opts.rng || R.makeRng(opts.seed);
    var timeMs = opts.timeMs || 2000;
    var arms = mctsArms(state, pid, true);
    var deadline = Date.now() + timeMs;
    var runner = mctsRunner(state, pid, arms, opts.simsPerMove || 100000000, rng, deadline);
    function snapshot() {
      return arms.map(function (a) {
        return { move: a.mv, ev: a.n ? a.sum / a.n : 0, sims: a.n };
      });
    }
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var lastReport = 0;
      (function slice() {
        var sliceEnd = Date.now() + 25;
        while (runner.remaining() > 0 && Date.now() < sliceEnd) runner.step();
        var now = Date.now();
        if (opts.onProgress && (now - lastReport > 100 || runner.remaining() <= 0)) {
          lastReport = now;
          opts.onProgress(snapshot(), now - t0, timeMs);
        }
        if (runner.remaining() > 0) scheduleTick(slice);
        else resolve(snapshot().sort(function (x, y) { return y.ev - x.ev; }));
      })();
    });
  }

  /* same analysis for a pending counter decision: each option (scramble
   * attacker slot i, or decline = null) gets an equal share of the budget */
  function evaluateCounter(state, opts) {
    opts = opts || {};
    var pid = state.pending.defenderId;
    var rng = opts.rng || R.makeRng(opts.seed);
    var timeMs = opts.timeMs || 2000;
    var arms = mctsCounterArms(state);
    var deadline = Date.now() + timeMs;
    var runner = mctsRunner(state, pid, arms, opts.simsPerMove || 100000000, rng, deadline);
    function snapshot() {
      return arms.map(function (a) {
        return { move: a.mv, ev: a.n ? a.sum / a.n : 0, sims: a.n };
      });
    }
    return new Promise(function (resolve) {
      var t0 = Date.now();
      var lastReport = 0;
      (function slice() {
        var sliceEnd = Date.now() + 25;
        while (runner.remaining() > 0 && Date.now() < sliceEnd) runner.step();
        var now = Date.now();
        if (opts.onProgress && (now - lastReport > 100 || runner.remaining() <= 0)) {
          lastReport = now;
          opts.onProgress(snapshot(), now - t0, timeMs);
        }
        if (runner.remaining() > 0) scheduleTick(slice);
        else resolve(snapshot().sort(function (x, y) { return y.ev - x.ev; }));
      })();
    });
  }

  function chooseCounterSync(state, pid, difficulty, opts) {
    opts = opts || {};
    var tier = tierOf(difficulty);
    var rng = opts.rng || R.makeRng(opts.seed);
    if (difficulty === 'easy') {
      if (rng() < 0.4) return null;
      var attacker = state.players[state.pending.attackerId];
      return Math.floor(rng() * attacker.health.length);
    }
    if (tier.kind === 'greedy') return counterChoice(state);
    var b = searchBudget(tier, opts, 'counter');
    if (tier.flat) {
      return runSync(mcPick(state, pid, counterArms(state, pid), b.sims, rng, ROLLOUT_POLICIES[tier.policy], b.deadline, tier.cheat)).mv;
    }
    return runSync(mctsRunner(state, pid, mctsCounterArms(state), b.sims, rng, b.deadline, tier.cheat)).mv;
  }

  function chooseCounter(state, pid, difficulty, opts) {
    opts = opts || {};
    var tier = tierOf(difficulty);
    if (tier.kind !== 'search') return Promise.resolve(chooseCounterSync(state, pid, difficulty, opts));
    var rng = opts.rng || R.makeRng(opts.seed);
    var b = searchBudget(tier, opts, 'counter');
    if (tier.flat) {
      return runAsync(mcPick(state, pid, counterArms(state, pid), b.sims, rng, ROLLOUT_POLICIES[tier.policy], b.deadline, tier.cheat))
        .then(function (a) { return a.mv; });
    }
    return runAsync(mctsRunner(state, pid, mctsCounterArms(state), b.sims, rng, b.deadline, tier.cheat))
      .then(function (a) { return a.mv; });
  }

  global.Shield = global.Shield || {};
  global.Shield.ai = {
    CFG: CFG,
    choose: choose,
    chooseSync: chooseSync,
    chooseCounter: chooseCounter,
    chooseCounterSync: chooseCounterSync,
    evaluate: evaluate,
    evaluateCounter: evaluateCounter,
    applyMainMove: applyMainMove,
    /* exposed for tests & tools */
    legalMoves: legalMoves,
    cloneState: cloneState,
    determinize: determinize,
    heuristicMove: heuristicMove,
    softmaxMove: softmaxMove,
    scoreMoveEV: scoreMoveEV,
    scoreMoveLegacy: scoreMoveLegacy,
    softmaxIndex: softmaxIndex,
    counterChoice: counterChoice,
    softmaxCounter: softmaxCounter,
    applyMove: applyMove,
    drawStats: drawStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
