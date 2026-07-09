/* SHIELD — engine.js
 * Turn/phase state machine. Bridges rules (pure logic) and ui (animated DOM).
 * Phases: TITLE, SETUP, DEALING, TURN_START, CHOOSE_ACTION,
 *         TARGET_ATTACK, TARGET_SHIELD, RESOLVING, COUNTER_PICK, VICTORY
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;
  var UI = global.Shield.ui;

  var engine = {
    phase: 'TITLE',
    state: null,
    names: [],
    seed: undefined, // set by main.js in debug mode

    async startMatch(names) {
      this.names = names.slice();
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
      this.phase = 'CHOOSE_ACTION';
      UI.unlockActions(this.state);
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
        this.resolve(function () { return R.resolveAttack(state, targetId); });
      } else {
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

    async endTurn() {
      if (this.state.winnerId !== null) {
        this.phase = 'VICTORY';
        await UI.showVictory(this.state.players[this.state.winnerId]);
        return;
      }
      R.advanceTurn(this.state);
      await this.turnStart();
    },

    rematch() {
      this.startMatch(this.names);
    }
  };

  global.Shield.engine = engine;
})(window);
