/* SHIELD — engine.js
 * Turn/phase state machine. Bridges rules (pure logic) and ui (animated DOM).
 * Phases: TITLE, SETUP, DEALING, TURN_START, CHOOSE_ACTION,
 *         TARGET_ATTACK, TARGET_SHIELD, RESOLVING, COUNTER_PICK, VICTORY
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;
  var UI = global.Shield.ui;

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var engine = {
    phase: 'TITLE',
    state: null,
    names: [],
    bots: [],        // per seat: null | 'easy' | 'medium' | 'hard' | 'impossible'
    seed: undefined, // set by main.js in debug mode

    isBot(id) { return !!this.bots[id]; },

    /* snapshot the position + move about to be played (War Council review) */
    record(mv) {
      if (!global.Shield.ai) return;
      this.history.push({
        state: global.Shield.ai.cloneState(this.state, null),
        pid: this.state.currentIdx,
        mv: mv
      });
    },

    async startMatch(names, bots) {
      this.names = names.slice();
      this.bots = (bots || []).slice();
      this.history = []; // every main move with its pre-move state, for review
      UI.setBots(this.bots);
      this.state = R.newGame(names, this.seed);
      UI.buildTable(this.state);
      UI.lockActions();
      UI.setBanner('The cards are dealt…', null);
      UI.showScreen('table');
      this.phase = 'DEALING';
      await UI.animateDeal(this.state);
      await this.turnStart();
    },

    async turnStart() {
      this.phase = 'TURN_START';
      var p = R.currentPlayer(this.state);
      await UI.announceTurn(p, this.state);
      if (this.isBot(p.id)) return this.botTurn(p);
      this.phase = 'CHOOSE_ACTION';
      UI.unlockActions(this.state);
    },

    /* a CPU seat takes its turn through the exact same resolve paths */
    async botTurn(p) {
      this.phase = 'BOT_TURN';
      UI.lockActions();
      await wait(650); // a beat of "thinking"
      var mv = await global.Shield.ai.choose(this.state, p.id, this.bots[p.id]);
      if (this.phase !== 'BOT_TURN') return;
      this.record(mv);
      var state = this.state;
      if (mv.type === 'attack') {
        await this.resolve(function () { return R.resolveAttack(state, mv.target); });
      } else if (mv.type === 'shield') {
        await this.resolve(function () { return R.resolveChangeShield(state, mv.target); });
      } else if (mv.type === 'charge') {
        await this.resolve(function () { return R.resolveCharge(state); });
      } else {
        await this.resolve(function () { return R.resolveGamble(state, mv.guess); });
      }
    },

    chooseAction(kind) {
      if (this.phase !== 'CHOOSE_ACTION') return;
      var la = R.legalActions(this.state);
      var me = R.currentPlayer(this.state);
      var color = UI.accent(me.id);
      var self = this;

      if (kind === 'attack') {
        if (!la.attack.length) return;
        this.phase = 'TARGET_ATTACK';
        UI.enterTargetMode(la.attack, color, '⚔ ' + me.name + ' — choose a target', function (id) {
          self.targetPicked(id);
        });
      } else if (kind === 'shield') {
        if (!la.changeShield.length) return;
        this.phase = 'TARGET_SHIELD';
        UI.enterTargetMode(la.changeShield, color, '⛨ ' + me.name + ' — whose shield is reforged?', function (id) {
          self.targetPicked(id);
        });
      } else if (kind === 'charge') {
        if (!la.charge) return;
        var state = this.state;
        this.record({ type: 'charge' });
        this.resolve(function () { return R.resolveCharge(state); });
      } else if (kind === 'gamble') {
        if (!la.gamble) return;
        this.phase = 'GAMBLE_CONFIRM';
        UI.lockActions();
        UI.gambleConfirm(function () {
          if (self.phase !== 'GAMBLE_CONFIRM') return;
          self.phase = 'GAMBLE_COLOR';
          UI.gambleColor(function (guess) {
            if (self.phase !== 'GAMBLE_COLOR') return;
            var st = self.state;
            self.record({ type: 'gamble', guess: guess });
            self.resolve(function () { return R.resolveGamble(st, guess); });
          });
        }, function () {
          if (self.phase !== 'GAMBLE_CONFIRM') return;
          self.phase = 'CHOOSE_ACTION';
          UI.unlockActions(self.state);
        });
      }
    },

    cancelTarget() {
      if (this.phase !== 'TARGET_ATTACK' && this.phase !== 'TARGET_SHIELD') return;
      UI.exitTargetMode();
      var p = R.currentPlayer(this.state);
      UI.announceTurn(p, this.state);
      this.phase = 'CHOOSE_ACTION';
      UI.unlockActions(this.state);
    },

    targetPicked(targetId) {
      var kind = this.phase;
      if (kind !== 'TARGET_ATTACK' && kind !== 'TARGET_SHIELD') return;
      UI.exitTargetMode();
      var state = this.state;
      if (kind === 'TARGET_ATTACK') {
        this.record({ type: 'attack', target: targetId });
        this.resolve(function () { return R.resolveAttack(state, targetId); });
      } else {
        this.record({ type: 'shield', target: targetId });
        this.resolve(function () { return R.resolveChangeShield(state, targetId); });
      }
    },

    async resolve(fn) {
      this.phase = 'RESOLVING';
      UI.lockActions();
      var events = fn();
      var counter = null;
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev.type === 'counterRequired') { counter = ev; continue; }
        await UI.playEvent(ev, this.state);
      }
      if (counter && this.state.winnerId === null) {
        this.phase = 'COUNTER_PICK';
        var self = this;
        var defender = this.state.players[counter.defenderId];
        if (this.isBot(defender.id)) {
          UI.setBanner('\u{1F6E1} ' + defender.name + ' weighs a counter\u2026', UI.accent(defender.id));
          await wait(800);
          var pick = await global.Shield.ai.chooseCounter(this.state, defender.id, this.bots[defender.id]);
          if (this.phase !== 'COUNTER_PICK') return;
          if (pick === null) await this.counterDeclined();
          else await this.counterPicked(pick);
          return;
        }
        UI.enterCounterMode(counter.attackerId, defender, function (slot) {
          self.counterPicked(slot);
        });
        return; // waiting for the defender's pick
      }
      await this.endTurn();
    },

    async counterDeclined() {
      if (this.phase !== 'COUNTER_PICK') return;
      this.phase = 'RESOLVING';
      UI.exitTargetMode();
      UI.lockActions();
      var events = R.resolveCounterSkip(this.state);
      for (var i = 0; i < events.length; i++) {
        await UI.playEvent(events[i], this.state);
      }
      await this.endTurn();
    },

    async counterPicked(index) {
      if (this.phase !== 'COUNTER_PICK') return;
      this.phase = 'RESOLVING';
      UI.exitTargetMode();
      UI.lockActions();
      var events = R.resolveCounter(this.state, index);
      for (var i = 0; i < events.length; i++) {
        await UI.playEvent(events[i], this.state);
      }
      await this.endTurn();
    },

    /* the position after the last move, so a review can show the finish */
    recordFinal() {
      if (!global.Shield.ai) return;
      var last = this.history[this.history.length - 1];
      if (last && !last.mv) return; // already stamped
      this.history.push({
        state: global.Shield.ai.cloneState(this.state, null),
        pid: null,
        mv: null
      });
    },

    async endTurn() {
      if (this.state.winnerId !== null) {
        this.phase = 'VICTORY';
        this.recordFinal();
        await UI.showVictory(this.state.players[this.state.winnerId]);
        return;
      }
      var events = R.advanceTurn(this.state);
      for (var i = 0; i < events.length; i++) {
        await UI.playEvent(events[i], this.state);
      }
      if (this.state.winnerId !== null) {
        this.phase = 'VICTORY';
        this.recordFinal();
        await UI.showVictory(this.state.players[this.state.winnerId]);
        return;
      }
      await this.turnStart();
    },

    rematch() {
      this.startMatch(this.names, this.bots);
    }
  };

  global.Shield.engine = engine;
})(window);
