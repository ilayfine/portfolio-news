/* SHIELD — ladder.js
 * Head-to-head bot tournament: measures which tier/generation is stronger.
 *
 *   node test/ladder.js            quick ladder (reduced sim budgets)
 *   node test/ladder.js full       full in-game sim budgets (slow)
 *   node test/ladder.js 200        quick ladder with 200 games per matchup
 *
 * Seats alternate every game and each game gets a fresh seed, so first-move
 * and shuffle luck cancel out. Search tiers use `simScale` to shrink their
 * budgets for quick runs — the RATIO between tiers is preserved.
 */
'use strict';
require('../js/rules.js');
require('../js/ai.js');

var R = globalThis.Shield.rules;
var AI = globalThis.Shield.ai;

var arg = process.argv[2];
var FULL = arg === 'full';
var GAMES = (arg && arg !== 'full') ? parseInt(arg, 10) : 120;
var SCALE = FULL ? 1 : 0.25; // quick mode: search tiers think at quarter budget

/* play one full game; diffs = per-seat tier names; returns winner seat */
function botGame(diffs, gameSeed, aiSeed) {
  var s = R.newGame(diffs.map(function (_, i) { return 'P' + i; }), gameSeed);
  var rng = R.makeRng(aiSeed);
  var opts = { rng: rng, simScale: SCALE };
  var turns = 0;
  while (s.winnerId === null && turns < 600) {
    turns++;
    var pid = s.currentIdx;
    var mv = AI.chooseSync(s, pid, diffs[pid], opts);
    if (mv.type === 'attack') {
      R.resolveAttack(s, mv.target);
      if (s.pending) {
        var did = s.pending.defenderId;
        var pick = AI.chooseCounterSync(s, did, diffs[did], opts);
        if (pick === null) R.resolveCounterSkip(s);
        else R.resolveCounter(s, pick);
      }
    } else if (mv.type === 'shield') {
      R.resolveChangeShield(s, mv.target);
    } else if (mv.type === 'charge') {
      R.resolveCharge(s);
    } else {
      R.resolveGamble(s, mv.guess);
    }
    if (s.winnerId === null) R.advanceTurn(s);
  }
  if (s.winnerId === null) throw new Error('game never ended');
  return s.winnerId;
}

function match(tierA, tierB, games, baseSeed) {
  var winsA = 0;
  var t0 = Date.now();
  for (var g = 0; g < games; g++) {
    var seatA = g % 2; // alternate who goes first
    var diffs = seatA === 0 ? [tierA, tierB] : [tierB, tierA];
    var w = botGame(diffs, baseSeed + g * 7919, baseSeed + g * 104729 + 1);
    if (w === seatA) winsA++;
  }
  var secs = ((Date.now() - t0) / 1000).toFixed(1);
  var pct = (100 * winsA / games).toFixed(1);
  // ±2 SE binomial interval, roughly 95%
  var se = Math.sqrt(0.25 / games) * 2 * 100;
  console.log(
    pad(tierA + ' vs ' + tierB, 34) +
    pad(winsA + '/' + games, 10) +
    pad(pct + '% ±' + se.toFixed(0), 14) +
    secs + 's'
  );
  return winsA / games;
}

function pad(s, n) { while (s.length < n) s += ' '; return s; }

console.log('SHIELD bot ladder — ' + GAMES + ' games/matchup, simScale=' + SCALE);
console.log(pad('matchup', 34) + pad('wins', 10) + pad('win rate', 14) + 'time');
console.log('-'.repeat(66));

/* new generation vs old generation (the interesting comparisons) */
match('medium', 'medium-legacy', GAMES, 1000);
match('hard-mcts', 'hard', GAMES, 1500);   // ISMCTS vs flat paired MC, same budget
match('hard', 'hard-legacy', GAMES, 2000);

/* the playable ladder: each tier vs the one below */
match('medium', 'easy', GAMES, 3000);
match('hard', 'medium', GAMES, 4000);
match('impossible', 'hard', Math.max(Math.round(GAMES / 3), 20), 5000);

/* cross-generation sanity: new search vs old greedy */
match('hard', 'medium-legacy', GAMES, 6000);

/* 4-player free-for-all: one seat per tier, rotated so every tier sits in
 * every chair equally; fair share is 25% */
(function () {
  var tiers = ['easy', 'medium', 'hard', 'impossible'];
  var games = Math.max(Math.round(GAMES / 2), 40);
  var wins = { easy: 0, medium: 0, hard: 0, impossible: 0 };
  var t0 = Date.now();
  for (var g = 0; g < games; g++) {
    var seats = tiers.map(function (_, i) { return tiers[(i + g) % 4]; });
    var w = botGame(seats, 9000 + g * 7919, 9000 + g * 104729 + 1);
    wins[seats[w]]++;
  }
  var secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('-'.repeat(66));
  console.log('4-player free-for-all (' + games + ' games, fair share 25%):');
  tiers.forEach(function (t) {
    console.log('  ' + pad(t, 12) + wins[t] + '/' + games + '  (' + (100 * wins[t] / games).toFixed(1) + '%)');
  });
  console.log('  time ' + secs + 's');
})();
