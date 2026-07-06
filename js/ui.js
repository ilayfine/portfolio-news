/* SHIELD — ui.js
 * DOM rendering, screen management, target selection, and the mapping from
 * rules events to animation sequences (playEvent).
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;
  var A = global.Shield.anim;
  var P = global.Shield.particles;
  var S = global.Shield.sound;

  var ACCENTS = ['#e2504c', '#4ea8de', '#e9b44c', '#52b788'];
  var DEFAULT_NAMES = ['Aria', 'Borin', 'Cyra', 'Dorn'];

  var stageCards = []; // ghosts currently sitting on the center stage: {card, el}
  var targetCleanup = null;

  function $(id) { return document.getElementById(id); }

  function accent(playerId) { return ACCENTS[playerId % ACCENTS.length]; }

  /* ---------------- screens ---------------- */

  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    $('screen-' + name).classList.add('active');
  }

  /* ---------------- card elements ---------------- */

  function cardEl(card, faceUp) {
    var el = document.createElement('div');
    el.className = 'card ' + (card.red ? 'red' : 'black') + (faceUp === false ? ' face-down' : '');
    el.dataset.cardId = card.id;
    el.innerHTML =
      '<div class="card-inner">' +
        '<div class="face">' +
          '<span class="corner tl"><b>' + card.label + '</b><i>' + card.glyph + '</i></span>' +
          '<span class="rank-big">' + card.label + '</span>' +
          '<span class="suit-big">' + card.glyph + '</span>' +
          '<span class="corner br"><b>' + card.label + '</b><i>' + card.glyph + '</i></span>' +
        '</div>' +
        '<div class="back"></div>' +
      '</div>';
    return el;
  }

  function ghostCard(card, faceUp) {
    var el = cardEl(card, faceUp);
    el.classList.add('flying');
    $('fx-layer').appendChild(el);
    return el;
  }

  /* ---------------- table construction ---------------- */

  function slotIds(playerId) {
    return {
      shield: 'slot-shield-' + playerId,
      health0: 'slot-health-' + playerId + '-0',
      health1: 'slot-health-' + playerId + '-1',
      charge: 'slot-charge-' + playerId
    };
  }

  function healthSlot(playerId, slot) { return $('slot-health-' + playerId + '-' + slot); }

  function buildTable(state) {
    var arena = $('arena');
    arena.className = 'players-' + state.players.length;
    arena.classList.remove('dimmed');
    // remove old zones
    var old = arena.querySelectorAll('.player-zone');
    for (var i = 0; i < old.length; i++) old[i].remove();

    state.players.forEach(function (p) {
      var ids = slotIds(p.id);
      var zone = document.createElement('div');
      zone.className = 'player-zone';
      zone.id = 'zone-' + p.id;
      zone.dataset.playerId = p.id;
      zone.style.setProperty('--accent', accent(p.id));
      zone.innerHTML =
        '<div class="plate">' +
          '<span class="pname">' + escapeHtml(p.name) + '</span>' +
          '<div class="hp-orb" id="hp-' + p.id + '"><span class="hp-num">0</span></div>' +
        '</div>' +
        '<div class="zone-cards">' +
          '<div class="slot shield-slot" id="' + ids.shield + '"><span class="slot-tag">SHIELD</span></div>' +
          '<div class="slot health-slot" id="' + ids.health0 + '" data-player="' + p.id + '" data-slot="0"><span class="slot-tag">LIFE</span></div>' +
          '<div class="slot health-slot" id="' + ids.health1 + '" data-player="' + p.id + '" data-slot="1"><span class="slot-tag">LIFE</span></div>' +
          '<div class="slot charge-slot" id="' + ids.charge + '"><span class="slot-tag">CHARGE</span></div>' +
        '</div>' +
        '<div class="slain-stamp">SLAIN</div>';
      arena.appendChild(zone);
    });

    setDiscardTop(null);
    updateDeckCount(state);
    stageCards = [];
    $('log').innerHTML = '';
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function putCardInSlot(slotEl, card) {
    var oldCard = slotEl.querySelector('.card');
    if (oldCard) oldCard.remove();
    var el = cardEl(card, true);
    slotEl.appendChild(el);
    return el;
  }

  function setChargeSlot(playerId, card) {
    var slot = $('slot-charge-' + playerId);
    var oldCard = slot.querySelector('.card');
    if (oldCard) oldCard.remove();
    var oldAura = slot.querySelector('.charge-aura');
    if (oldAura) oldAura.remove();
    if (card) {
      slot.classList.add('filled');
      var aura = document.createElement('div');
      aura.className = 'charge-aura';
      slot.appendChild(aura);
      slot.appendChild(cardEl(card, true));
    } else {
      slot.classList.remove('filled');
    }
  }

  function setDiscardTop(card) {
    var pile = $('discard');
    var oldCard = pile.querySelector('.card');
    if (oldCard) oldCard.remove();
    if (card) pile.appendChild(cardEl(card, true));
  }

  function updateDeckCount(state) {
    $('deck-count').textContent = state.deck.length;
  }

  function updateHp(player, animateIt) {
    var orb = $('hp-' + player.id);
    if (!orb) return Promise.resolve();
    var numEl = orb.querySelector('.hp-num');
    var from = parseInt(numEl.textContent, 10) || 0;
    var to = Math.max(R.hp(player), 0);
    if (!animateIt) { numEl.textContent = String(to); return Promise.resolve(); }
    A.pulse(orb, 1.28);
    return A.countTo(numEl, from, to);
  }

  /* ---------------- deal ---------------- */

  function dealOne(state, card, slotEl, delay) {
    var from = A.rect($('deck'));
    var to = A.rect(slotEl);
    var ghost = ghostCard(card, false);
    var inner = ghost.querySelector('.card-inner');
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(180deg)';
    ghost.style.opacity = '0';
    return A.wait(delay).then(function () {
      ghost.style.opacity = '1';
      S.play('deal');
      var fly = A.flyGhost(ghost, from, to, { duration: A.D.deal + 160, rotFrom: -8, rotTo: 0, arc: 26 });
      var flip = A.wait(90).then(function () { return A.flipInner(ghost, 180, 0, A.D.flip); });
      return Promise.all([fly, flip]);
    }).then(function () {
      putCardInSlot(slotEl, card);
      ghost.remove();
    });
  }

  function animateDeal(state) {
    var jobs = [];
    var i = 0;
    state.players.forEach(function (p) {
      var ids = slotIds(p.id);
      jobs.push(dealOne(state, p.shield, $(ids.shield), i++ * A.D.dealStagger));
      jobs.push(dealOne(state, p.health[0], $(ids.health0), i++ * A.D.dealStagger));
      jobs.push(dealOne(state, p.health[1], $(ids.health1), i++ * A.D.dealStagger));
    });
    return Promise.all(jobs).then(function () {
      return Promise.all(state.players.map(function (p) { return updateHp(p, true); }));
    });
  }

  /* ---------------- turn banner & action bar ---------------- */

  function setBanner(text, color) {
    var banner = $('banner-text');
    banner.textContent = text;
    document.getElementById('turn-banner').style.setProperty('--banner-color', color || '');
    banner.style.setProperty('--banner-color', color || '');
    return A.bannerIn(banner);
  }

  function announceTurn(player, state) {
    document.querySelectorAll('.player-zone').forEach(function (z) { z.classList.remove('active-zone'); });
    var zone = $('zone-' + player.id);
    if (zone) zone.classList.add('active-zone');
    return setBanner('⚔ ' + player.name + "'s turn", accent(player.id));
  }

  function lockActions() {
    $('action-bar').classList.add('locked');
  }

  function unlockActions(state) {
    var la = R.legalActions(state);
    $('btn-attack').disabled = la.attack.length === 0;
    $('btn-charge').disabled = !la.charge;
    $('btn-charge').title = la.charge ? '' : 'A charge is already held';
    $('btn-shield').disabled = la.changeShield.length === 0;
    $('btn-cancel').classList.add('hidden');
    $('btn-attack').classList.remove('hidden');
    $('btn-shield').classList.remove('hidden');
    $('btn-charge').classList.remove('hidden');
    $('action-bar').classList.remove('locked');
  }

  function showCancelOnly() {
    $('btn-attack').classList.add('hidden');
    $('btn-shield').classList.add('hidden');
    $('btn-charge').classList.add('hidden');
    $('btn-cancel').classList.remove('hidden');
    $('action-bar').classList.remove('locked');
  }

  /* ---------------- target selection ---------------- */

  function enterTargetMode(targetIds, pickerColor, hint, cb) {
    var arena = $('arena');
    arena.classList.add('dimmed');
    showCancelOnly();
    setBanner(hint, pickerColor);

    var handlers = [];
    targetIds.forEach(function (id) {
      var zone = $('zone-' + id);
      zone.classList.add('targetable');
      zone.style.setProperty('--target-color', pickerColor);
      var h = function () { S.play('click'); cb(id); };
      zone.addEventListener('click', h);
      handlers.push({ el: zone, h: h });
    });

    targetCleanup = function () {
      arena.classList.remove('dimmed');
      handlers.forEach(function (x) {
        x.el.removeEventListener('click', x.h);
        x.el.classList.remove('targetable');
      });
      targetCleanup = null;
    };
  }

  function enterCounterMode(attackerId, defender, cb) {
    var arena = $('arena');
    arena.classList.add('dimmed');
    lockActions();
    var col = accent(defender.id);
    setBanner('🛡 Blocked! ' + defender.name + ' — scramble one of the foe\'s life cards', col);

    var attackerZone = $('zone-' + attackerId);
    attackerZone.classList.add('targetable'); // keeps the zone lit through the arena dim
    attackerZone.style.setProperty('--target-color', col);

    var handlers = [];
    [0, 1].forEach(function (slot) {
      var slotEl = healthSlot(attackerId, slot);
      slotEl.classList.add('targetable');
      slotEl.style.setProperty('--target-color', col);
      var h = function (e) { e.stopPropagation(); S.play('click'); cb(slot); };
      slotEl.addEventListener('click', h);
      handlers.push({ el: slotEl, h: h });
    });

    targetCleanup = function () {
      arena.classList.remove('dimmed');
      attackerZone.classList.remove('targetable');
      handlers.forEach(function (x) {
        x.el.removeEventListener('click', x.h);
        x.el.classList.remove('targetable');
      });
      targetCleanup = null;
    };
  }

  function exitTargetMode() {
    if (targetCleanup) targetCleanup();
  }

  /* ---------------- log ---------------- */

  function log(msg) {
    var el = $('log');
    var line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = msg;
    el.appendChild(line);
    while (el.children.length > 3) el.removeChild(el.firstChild);
  }

  /* ---------------- event playback ---------------- */

  function stageRect(indexOffset) {
    var r = A.rect($('stage'));
    if (indexOffset) {
      r = { left: r.left + indexOffset * r.width * 0.45, top: r.top - 6, width: r.width, height: r.height };
    }
    return r;
  }

  function playDraw(ev, state) {
    updateDeckCount(state);
    var from = A.rect($('deck'));
    var to = stageRect(stageCards.length);
    var ghost = ghostCard(ev.card, false);
    var inner = ghost.querySelector('.card-inner');
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(180deg)';
    S.play('draw');
    var fly = A.flyGhost(ghost, from, to, { duration: A.D.flyIn, rotFrom: -6, rotTo: 0, arc: 30 });
    var flip = A.wait(A.D.flyIn * 0.35).then(function () {
      S.play('flip');
      return A.flipInner(ghost, 180, 0, A.D.flip);
    });
    stageCards.push({ card: ev.card, el: ghost, rect: to });
    return Promise.all([fly, flip]).then(function () {
      return A.wait(A.D.stagePause * (ev.purpose === 'attack' ? 1 : 0.45));
    });
  }

  function playChargeConsumed(ev) {
    var slot = $('slot-charge-' + ev.playerId);
    var from = A.rect(slot);
    var to = stageRect(stageCards.length);
    setChargeSlot(ev.playerId, null);
    var ghost = ghostCard(ev.card, true);
    stageCards.push({ card: ev.card, el: ghost, rect: to });
    S.play('charge');
    return A.flyGhost(ghost, from, to, { duration: 360, rotFrom: 0, rotTo: -8, arc: 20 })
      .then(function () {
        var c = A.center(stageRect(0.5));
        P.burst(c.x, c.y, 'charge');
        return A.floatText(c.x, c.y - 60, '⚔ ' + ev.total, 'info small', { duration: 800 });
      });
  }

  function playAttack(ev, state) {
    setBanner('⚔ ' + state.players[ev.attackerId].name + ' strikes ' +
      state.players[ev.targetId].name + '!', accent(ev.attackerId));
    var shieldSlotEl = $('slot-shield-' + ev.targetId);
    var to = A.rect(shieldSlotEl);
    var flights = stageCards.map(function (sc, i) {
      return A.flyGhost(sc.el, sc.rect, to, {
        duration: A.D.strike,
        rotFrom: 0,
        rotTo: 300 + i * 40,
        arc: 60,
        easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)' // accelerate into the target
      });
    });
    return Promise.all(flights);
  }

  function disposeStageToDiscard(state) {
    var pile = A.rect($('discard'));
    var jobs = stageCards.map(function (sc, i) {
      return A.flyGhost(sc.el, A.rect(sc.el), pile, {
        duration: A.D.tumble,
        rotFrom: 0, rotTo: 160 + i * 30,
        fadeOut: false
      }).then(function () { sc.el.remove(); });
    });
    var last = stageCards.length ? stageCards[stageCards.length - 1].card : null;
    stageCards = [];
    return Promise.all(jobs).then(function () {
      if (state.discard.length) setDiscardTop(state.discard[state.discard.length - 1]);
      else if (last) setDiscardTop(last);
    });
  }

  function playDamage(ev, state) {
    var target = state.players[ev.playerId];
    var shieldSlotEl = $('slot-shield-' + ev.playerId);
    var c = A.center(A.rect(shieldSlotEl));
    S.play('hit', { power: ev.amount });
    P.burst(c.x, c.y, 'impact', ev.amount);
    var zoneC = A.center(A.rect($('zone-' + ev.playerId)));
    log(target.name + ' takes ' + ev.amount + ' damage.');
    return Promise.all([
      A.shakeTable(3 + ev.amount * 0.8),
      A.flashSlot(shieldSlotEl, '#ff9a4a', 0.85),
      A.floatText(zoneC.x, zoneC.y - 20, '-' + ev.amount, 'damage'),
      updateHp(target, true)
    ]).then(function () {
      return disposeStageToDiscard(state);
    });
  }

  function playBlocked(ev, state) {
    var shieldSlotEl = $('slot-shield-' + ev.defenderId);
    var c = A.center(A.rect(shieldSlotEl));
    S.play('block');
    P.burst(c.x, c.y, 'block');
    var defender = state.players[ev.defenderId];
    log(defender.name + ' blocks: ' + ev.value + ' vs shield ' + ev.shield + '.');
    return Promise.all([
      A.shakeTable(3),
      A.flashSlot(shieldSlotEl, '#bcdcf5', 1),
      A.pulse(shieldSlotEl, 1.12),
      A.floatText(c.x, c.y - 30, 'BLOCKED', 'block small')
    ]).then(function () {
      return disposeStageToDiscard(state);
    }).then(function () {
      return A.wait(180);
    });
  }

  function playHealthReplaced(ev, state) {
    var player = state.players[ev.playerId];
    var slotEl = healthSlot(ev.playerId, ev.slot);
    var oldCardEl = slotEl.querySelector('.card');
    var c = A.center(A.rect(slotEl));

    S.play('scramble');
    P.burst(c.x, c.y, 'dissolve');
    var out = oldCardEl ? A.dissolveCard(oldCardEl) : Promise.resolve();

    return out.then(function () {
      if (oldCardEl) oldCardEl.remove();
      // the freshly drawn card is waiting on the stage — fly it into the slot
      var sc = stageCards.pop();
      var fly = sc
        ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(slotEl), { duration: 380, arc: 30 })
            .then(function () { sc.el.remove(); })
        : Promise.resolve();
      return fly;
    }).then(function () {
      var el = putCardInSlot(slotEl, ev.newCard);
      A.popIn(el);
      var delta = ev.newHp - ev.oldHp;
      var healed = delta > 0;
      if (healed) { S.play('heal'); P.burst(c.x, c.y, 'heal'); }
      log(state.players[ev.byId].name + ' scrambles ' + player.name + "'s life: " +
        ev.oldCard.label + ' → ' + ev.newCard.label + '.');
      return Promise.all([
        A.floatText(c.x, c.y - 40, (delta >= 0 ? '+' : '') + delta, healed ? 'heal' : 'damage'),
        A.flashSlot(slotEl, healed ? '#5fe79b' : '#ff5f52', 0.7),
        updateHp(player, true)
      ]);
    });
  }

  function playShieldReplaced(ev, state) {
    setBanner('⛨ ' + state.players[ev.byId].name + ' reforges ' +
      (ev.byId === ev.playerId ? 'their own' : state.players[ev.playerId].name + "'s") +
      ' shield', accent(ev.byId));
    var slotEl = $('slot-shield-' + ev.playerId);
    var oldCardEl = slotEl.querySelector('.card');
    var pile = A.rect($('discard'));

    // old shield tumbles away
    var out = Promise.resolve();
    if (oldCardEl) {
      var ghost = ghostCard(ev.oldCard, true);
      var from = A.rect(oldCardEl);
      oldCardEl.remove();
      out = A.flyGhost(ghost, from, pile, { duration: A.D.tumble, rotTo: 140 })
        .then(function () { ghost.remove(); setDiscardTop(ev.oldCard); });
    }

    // new shield flies in from the stage
    var sc = stageCards.pop();
    var inFly = sc
      ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(slotEl), { duration: 400, arc: 36 })
          .then(function () { sc.el.remove(); })
      : Promise.resolve();

    return Promise.all([out, inFly]).then(function () {
      var el = putCardInSlot(slotEl, ev.newCard);
      S.play('block');
      log(state.players[ev.byId].name + ' reforges ' + state.players[ev.playerId].name +
        "'s shield: " + ev.oldCard.label + ' → ' + ev.newCard.label + '.');
      var c = A.center(A.rect(slotEl));
      P.burst(c.x, c.y, 'block');
      return Promise.all([A.popIn(el), A.flashSlot(slotEl, '#bcdcf5', 0.8)]);
    });
  }

  function playCharged(ev, state) {
    var slotEl = $('slot-charge-' + ev.playerId);
    var sc = stageCards.pop();
    var fly = sc
      ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(slotEl), { duration: 400, arc: 30 })
          .then(function () { sc.el.remove(); })
      : Promise.resolve();
    return fly.then(function () {
      setChargeSlot(ev.playerId, ev.card);
      S.play('charge');
      var c = A.center(A.rect(slotEl));
      P.burst(c.x, c.y, 'charge');
      log(state.players[ev.playerId].name + ' charges a ' + ev.card.label + '.');
      return A.pulse(slotEl, 1.15);
    });
  }

  function playChargeLost(ev, state) {
    var slotEl = $('slot-charge-' + ev.playerId);
    var cardIn = slotEl.querySelector('.card');
    var out = Promise.resolve();
    if (cardIn) {
      var ghost = ghostCard(ev.card, true);
      var from = A.rect(cardIn);
      setChargeSlot(ev.playerId, null);
      out = A.flyGhost(ghost, from, A.rect($('discard')), { duration: A.D.tumble, rotTo: 120, fadeOut: true })
        .then(function () { ghost.remove(); });
    } else {
      setChargeSlot(ev.playerId, null);
    }
    return out;
  }

  function playEliminated(ev, state) {
    var player = state.players[ev.playerId];
    var zone = $('zone-' + ev.playerId);
    var c = A.center(A.rect(zone));
    S.play('eliminate');
    P.burst(c.x, c.y, 'ash');
    log(player.name + ' has fallen.');
    zone.classList.remove('active-zone', 'targetable');
    return Promise.all([
      A.shakeTable(6),
      A.animate(zone, [
        { transform: 'translate(-50%, -50%)', filter: 'none' },
        { transform: 'translate(calc(-50% + 4px), -50%)', offset: 0.2 },
        { transform: 'translate(calc(-50% - 4px), -50%)', offset: 0.4 },
        { transform: 'translate(-50%, -50%)' }
      ], { duration: 500 })
    ]).then(function () {
      zone.classList.add('eliminated');
      return A.wait(650);
    });
  }

  function playReshuffle(ev, state) {
    S.play('reshuffle');
    setDiscardTop(null);
    updateDeckCount(state);
    var deckC = A.center(A.rect($('deck')));
    P.burst(deckC.x, deckC.y, 'dissolve');
    log('The discard pile is shuffled back into the deck.');
    return Promise.all([
      A.pulse($('deck'), 1.14),
      A.floatText(deckC.x, deckC.y - 50, 'RESHUFFLE', 'info small')
    ]);
  }

  function playEvent(ev, state) {
    switch (ev.type) {
      case 'reshuffle': return playReshuffle(ev, state);
      case 'draw': return playDraw(ev, state);
      case 'chargeConsumed': return playChargeConsumed(ev);
      case 'attack': return playAttack(ev, state);
      case 'damage': return playDamage(ev, state);
      case 'blocked': return playBlocked(ev, state);
      case 'healthReplaced': return playHealthReplaced(ev, state);
      case 'shieldReplaced': return playShieldReplaced(ev, state);
      case 'charged': return playCharged(ev, state);
      case 'chargeLost': return playChargeLost(ev, state);
      case 'eliminated': return playEliminated(ev, state);
      case 'win': return A.wait(500);
      case 'turnStart': return Promise.resolve();
      case 'counterRequired': return Promise.resolve(); // engine handles the handoff
      default: return Promise.resolve();
    }
  }

  /* ---------------- victory ---------------- */

  function showVictory(player) {
    var nameEl = $('victory-name');
    nameEl.textContent = player.name;
    nameEl.style.setProperty('--accent', accent(player.id));
    showScreen('victory');
    S.play('win');
    var W = global.innerWidth, H = global.innerHeight;
    var i = 0;
    (function boom() {
      if (i++ >= 6) return;
      P.burst(W * (0.25 + Math.random() * 0.5), H * (0.2 + Math.random() * 0.4), 'victory');
      setTimeout(boom, 380);
    })();
    return A.wait(400);
  }

  /* ---------------- setup screen ---------------- */

  function renderNameInputs(count) {
    var wrap = $('name-inputs');
    var existing = [];
    wrap.querySelectorAll('.name-input').forEach(function (inp) { existing.push(inp.value); });
    wrap.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var row = document.createElement('div');
      row.className = 'name-row';
      row.style.setProperty('--accent', accent(i));
      row.innerHTML =
        '<span class="name-sigil"></span>' +
        '<input class="name-input" data-idx="' + i + '" maxlength="14" placeholder="' +
        DEFAULT_NAMES[i] + '" value="' + (existing[i] ? escapeHtml(existing[i]) : '') + '">';
      wrap.appendChild(row);
    }
  }

  function readNames() {
    var names = [];
    document.querySelectorAll('.name-input').forEach(function (inp, i) {
      var v = inp.value.trim();
      names.push(v || DEFAULT_NAMES[i]);
    });
    return names;
  }

  global.Shield.ui = {
    ACCENTS: ACCENTS,
    showScreen: showScreen,
    buildTable: buildTable,
    animateDeal: animateDeal,
    announceTurn: announceTurn,
    setBanner: setBanner,
    lockActions: lockActions,
    unlockActions: unlockActions,
    enterTargetMode: enterTargetMode,
    enterCounterMode: enterCounterMode,
    exitTargetMode: exitTargetMode,
    playEvent: playEvent,
    showVictory: showVictory,
    renderNameInputs: renderNameInputs,
    readNames: readNames,
    updateDeckCount: updateDeckCount,
    log: log,
    accent: accent
  };
})(window);
