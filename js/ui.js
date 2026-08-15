/* SHIELD — ui.js
 * DOM rendering, screen management, target selection, the gamble modal, and
 * the mapping from rules events to animation sequences (playEvent).
 *
 * The DOM is updated incrementally, event by event, so the table always shows
 * the state as it was at that point of the playback (life rows grow/shrink,
 * cards swap denominations, charges stack face-down, etc.).
 */
(function (global) {
  'use strict';

  var R = global.Shield.rules;
  var A = global.Shield.anim;
  var P = global.Shield.particles;
  var S = global.Shield.sound;

  var ACCENTS = ['#e2504c', '#4ea8de', '#e9b44c', '#52b788'];
  var DEFAULT_NAMES = ['Aria', 'Borin', 'Cyra', 'Dorn'];

  var stageCards = []; // ghosts currently sitting on the center stage: {card, el, rect}
  var targetCleanup = null;
  var bots = [];       // per seat: null | 'easy' | 'medium' | 'hard'
  var seatTypes = [null, null, null, null]; // setup-screen selections

  var SEAT_LABELS = {
    easy: '⚙ CPU · Easy', medium: '⚙ CPU · Medium', hard: '⚙ CPU · Hard',
    impossible: '☠ Impossible', hacker: '👁 Hacker · sees the deck'
  };
  var SEAT_CYCLE = [null, 'easy', 'medium', 'hard', 'impossible', 'hacker'];

  function setBots(b) { bots = b || []; }

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
    var color = card.joker ? 'joker' : (card.red ? 'red' : 'black');
    el.className = 'card ' + color + (faceUp === false ? ' face-down' : '');
    el.dataset.cardId = card.id;
    if (card.joker) {
      el.innerHTML =
        '<div class="card-inner">' +
          '<div class="face joker-face">' +
            '<span class="joker-star">★</span>' +
            '<span class="joker-word">JOKER</span>' +
          '</div>' +
          '<div class="back"></div>' +
        '</div>';
    } else {
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
    }
    return el;
  }

  function ghostCard(card, faceUp) {
    var el = cardEl(card, faceUp);
    el.classList.add('flying');
    $('fx-layer').appendChild(el);
    return el;
  }

  /* ---------------- table construction ---------------- */

  function shieldSlot(pid) { return $('slot-shield-' + pid); }

  /* flight target for a slot: the shield slot is a sideways box, so aim a
   * portrait-card rect at its center to avoid distorting the flying ghost */
  function slotTargetRect(slotEl) {
    var r = A.rect(slotEl);
    if (slotEl.classList.contains('shield-slot')) {
      var w = r.height, h = r.width;
      return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
    }
    return r;
  }
  function lifeRow(pid) { return $('life-row-' + pid); }
  function lifeSlotAt(pid, index) { return lifeRow(pid).children[index] || null; }
  function chargeStack(pid) { return $('charge-' + pid); }

  function makeLifeSlot() {
    var slot = document.createElement('div');
    slot.className = 'slot health-slot';
    return slot;
  }

  /* stamp/refresh the pending "red cross owes a value" look on a life slot */
  function paintPending(slotEl, value) {
    slotEl.classList.add('pending');
    var owe = slotEl.querySelector('.owe');
    if (!owe) {
      owe = document.createElement('div');
      owe.className = 'owe';
      slotEl.appendChild(owe);
    }
    owe.textContent = value;
  }

  function clearPending(slotEl) {
    slotEl.classList.remove('pending');
    var owe = slotEl.querySelector('.owe');
    if (owe) owe.remove();
  }

  function putCardInSlot(slotEl, card) {
    var oldCard = slotEl.querySelector('.card');
    if (oldCard) oldCard.remove();
    var el = cardEl(card, true);
    slotEl.appendChild(el);
    return el;
  }

  /* commit a card into the sideways shield slot with a springy quarter-turn */
  function commitShieldCard(slotEl, card) {
    var el = putCardInSlot(slotEl, card);
    A.animate(el, [
      { transform: 'translate(-50%, -50%) rotate(0deg)' },
      { transform: 'translate(-50%, -50%) rotate(90deg)' }
    ], { duration: 280, easing: 'cubic-bezier(0.22, 1.3, 0.36, 1)', autoCancel: true });
    return el;
  }

  function renderLifeRow(player) {
    var row = lifeRow(player.id);
    row.innerHTML = '';
    player.health.forEach(function (slot) {
      var slotEl = makeLifeSlot();
      slotEl.appendChild(cardEl(slot.card, true));
      if (slot.pending) paintPending(slotEl, slot.value);
      row.appendChild(slotEl);
    });
  }

  function renderChargeStack(player) {
    var wrap = chargeStack(player.id);
    var cardsBox = wrap.querySelector('.cs-cards');
    var count = wrap.querySelector('.cs-count');
    cardsBox.innerHTML = '';
    var n = player.charge.length;
    for (var i = 0; i < Math.min(n, 3); i++) {
      var mini = document.createElement('div');
      mini.className = 'card mini back-only';
      mini.style.setProperty('--stack-i', i);
      cardsBox.appendChild(mini);
    }
    wrap.classList.toggle('filled', n > 0);
    count.textContent = n;
    count.classList.toggle('hidden', n === 0);
  }

  function setChargeCount(pid, n) {
    renderChargeStack({ id: pid, charge: new Array(n) });
  }

  function buildTable(state) {
    var arena = $('arena');
    arena.className = 'players-' + state.players.length;
    arena.classList.remove('dimmed');
    var old = arena.querySelectorAll('.player-zone');
    for (var i = 0; i < old.length; i++) old[i].remove();

    state.players.forEach(function (p) {
      var zone = document.createElement('div');
      zone.className = 'player-zone';
      zone.id = 'zone-' + p.id;
      zone.dataset.playerId = p.id;
      zone.style.setProperty('--accent', accent(p.id));
      zone.innerHTML =
        '<div class="plate">' +
          '<span class="pname">' + (bots[p.id] ? '⚙ ' : '') + escapeHtml(p.name) + '</span>' +
          '<div class="hp-orb" id="hp-' + p.id + '"><span class="hp-num">0</span></div>' +
        '</div>' +
        '<div class="slot shield-slot" id="slot-shield-' + p.id + '"><span class="slot-tag">SHIELD</span></div>' +
        '<div class="zone-body">' +
          '<div class="zone-cards" id="life-row-' + p.id + '"></div>' +
          '<div class="charge-stack" id="charge-' + p.id + '">' +
            '<div class="cs-cards"></div>' +
            '<span class="cs-count hidden">0</span>' +
            '<span class="slot-tag">CHARGE</span>' +
          '</div>' +
        '</div>' +
        '<div class="slain-stamp">SLAIN</div>';
      arena.appendChild(zone);
      // empty life slots for the deal to fill
      var row = lifeRow(p.id);
      p.health.forEach(function () { row.appendChild(makeLifeSlot()); });
      renderChargeStack(p);
    });

    setDiscardTop(null);
    updateDeckCount(state);
    stageCards = [];
    $('log').innerHTML = '';
  }

  /* re-sync every zone from state (debug/tests) */
  function syncAll(state) {
    state.players.forEach(function (p) {
      putCardInSlot(shieldSlot(p.id), p.shield);
      renderLifeRow(p);
      renderChargeStack(p);
      updateHpTo(p.id, R.hp(p), false);
      var zone = $('zone-' + p.id);
      zone.classList.toggle('eliminated', p.eliminated);
    });
    updateDeckCount(state);
    setDiscardTop(state.discard.length ? state.discard[state.discard.length - 1] : null);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

  function updateHpTo(playerId, value, animateIt) {
    var orb = $('hp-' + playerId);
    if (!orb) return Promise.resolve();
    var numEl = orb.querySelector('.hp-num');
    var from = parseInt(numEl.textContent, 10) || 0;
    var to = Math.max(value, 0);
    if (!animateIt) { numEl.textContent = String(to); return Promise.resolve(); }
    A.pulse(orb, 1.28);
    return A.countTo(numEl, from, to);
  }

  /* ---------------- deal ---------------- */

  function dealOne(card, slotEl, delay) {
    var from = A.rect($('deck'));
    var to = slotTargetRect(slotEl);
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
      if (slotEl.classList.contains('shield-slot')) commitShieldCard(slotEl, card);
      else putCardInSlot(slotEl, card);
      ghost.remove();
    });
  }

  function animateDeal(state) {
    var jobs = [];
    var i = 0;
    state.players.forEach(function (p) {
      jobs.push(dealOne(p.shield, shieldSlot(p.id), i++ * A.D.dealStagger));
      p.health.forEach(function (slot, idx) {
        jobs.push(dealOne(slot.card, lifeSlotAt(p.id, idx), i++ * A.D.dealStagger));
      });
    });
    return Promise.all(jobs).then(function () {
      return Promise.all(state.players.map(function (p) {
        return updateHpTo(p.id, R.hp(p), true);
      }));
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
    $('btn-shield').disabled = la.changeShield.length === 0;
    $('btn-charge').disabled = !la.charge;
    $('btn-gamble').disabled = !la.gamble;
    $('btn-cancel').classList.add('hidden');
    $('btn-decline').classList.add('hidden');
    $('btn-attack').classList.remove('hidden');
    $('btn-shield').classList.remove('hidden');
    $('btn-charge').classList.remove('hidden');
    $('btn-gamble').classList.remove('hidden');
    $('action-bar').classList.remove('locked');
  }

  function showCancelOnly() {
    $('btn-attack').classList.add('hidden');
    $('btn-shield').classList.add('hidden');
    $('btn-charge').classList.add('hidden');
    $('btn-gamble').classList.add('hidden');
    $('btn-decline').classList.add('hidden');
    $('btn-cancel').classList.remove('hidden');
    $('action-bar').classList.remove('locked');
  }

  /* counter mode: the defender may pick a life card OR decline */
  function showDeclineOnly() {
    $('btn-attack').classList.add('hidden');
    $('btn-shield').classList.add('hidden');
    $('btn-charge').classList.add('hidden');
    $('btn-gamble').classList.add('hidden');
    $('btn-cancel').classList.add('hidden');
    $('btn-decline').classList.remove('hidden');
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
    showDeclineOnly();
    var col = accent(defender.id);
    setBanner('🛡 Blocked! ' + defender.name + ' — scramble a foe\'s life card, or decline', col);

    var attackerZone = $('zone-' + attackerId);
    attackerZone.classList.add('targetable'); // keeps the zone lit through the arena dim
    attackerZone.style.setProperty('--target-color', col);

    var handlers = [];
    var slots = lifeRow(attackerId).children;
    Array.prototype.forEach.call(slots, function (slotEl, index) {
      slotEl.classList.add('targetable');
      slotEl.style.setProperty('--target-color', col);
      var h = function (e) { e.stopPropagation(); S.play('click'); cb(index); };
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

  /* ---------------- gamble modal ---------------- */

  function showModal(question, buttons) {
    var modal = $('modal');
    $('modal-question').textContent = question;
    var box = $('modal-buttons');
    box.innerHTML = '';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.className = 'btn modal-btn ' + (b.cls || '');
      btn.innerHTML = b.html;
      btn.addEventListener('click', function () {
        S.play('click');
        hideModal();
        b.onPick();
      });
      box.appendChild(btn);
    });
    modal.classList.remove('hidden');
  }

  function hideModal() {
    $('modal').classList.add('hidden');
  }

  function gambleConfirm(onYes, onNo) {
    showModal('Do you want to gamble on the life?', [
      { html: 'Yes — fate decides', cls: 'modal-yes', onPick: onYes },
      { html: 'No, step back', cls: 'modal-no', onPick: onNo }
    ]);
  }

  function gambleColor(onPick) {
    showModal('Call the color of the next card', [
      { html: '<span class="suits-red">♥ ♦</span> Red', cls: 'modal-red', onPick: function () { onPick('red'); } },
      { html: '<span class="suits-black">♠ ♣</span> Black', cls: 'modal-black', onPick: function () { onPick('black'); } }
    ]);
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
      var off = Math.min(indexOffset, 4);
      r = { left: r.left + off * r.width * 0.35, top: r.top - 6 - off * 3, width: r.width, height: r.height };
    }
    return r;
  }

  /* deck -> stage. Cards drawn for a charge stay FACE DOWN (hidden charge). */
  function playDraw(ev, state) {
    updateDeckCount(state);
    var hidden = ev.purpose === 'charge';
    var from = A.rect($('deck'));
    var to = stageRect(stageCards.length);
    var ghost = ghostCard(ev.card, false);
    var inner = ghost.querySelector('.card-inner');
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(180deg)';
    S.play('draw');
    var fly = A.flyGhost(ghost, from, to, { duration: A.D.flyIn, rotFrom: -6, rotTo: 0, arc: 30 });
    var flip = hidden ? Promise.resolve() : A.wait(A.D.flyIn * 0.35).then(function () {
      S.play('flip');
      return A.flipInner(ghost, 180, 0, A.D.flip);
    });
    stageCards.push({ card: ev.card, el: ghost, rect: to, hidden: hidden });
    var pause = ev.purpose === 'attack' ? 1 : ev.purpose === 'gamble' ? 1.4 : ev.purpose === 'chargeReplace' ? 0.6 : hidden ? 0.15 : 0.45;
    return Promise.all([fly, flip]).then(function () {
      return A.wait(A.D.stagePause * pause);
    });
  }

  function playJokerDrawn(ev, state) {
    updateDeckCount(state);
    var from = A.rect($('deck'));
    var to = stageRect(0);
    var ghost = ghostCard(ev.card, false);
    var inner = ghost.querySelector('.card-inner');
    inner.style.transition = 'none';
    inner.style.transform = 'rotateY(180deg)';
    S.play('draw');
    var c = A.center(to);
    return Promise.all([
      A.flyGhost(ghost, from, to, { duration: A.D.flyIn, rotFrom: -6, rotTo: 0, arc: 30 }),
      A.wait(A.D.flyIn * 0.35).then(function () { S.play('flip'); return A.flipInner(ghost, 180, 0, A.D.flip); })
    ]).then(function () {
      S.play('win');
      P.burst(c.x, c.y, 'victory');
      log(state.players[ev.playerId].name + (ev.wasted
        ? ' finds a JOKER — but their life is full!'
        : ' finds a JOKER — an extra life card!'));
      return Promise.all([
        A.floatText(c.x, c.y - 40, ev.wasted ? 'JOKER! (life full)' : 'JOKER!', ev.wasted ? 'info small' : 'info'),
        A.pulse(ghost, 1.18)
      ]);
    }).then(function () {
      return A.flyGhost(ghost, A.rect(ghost), A.rect($('discard')), { duration: A.D.tumble, rotTo: 140 });
    }).then(function () {
      ghost.remove();
      setDiscardTop(ev.card);
    });
  }

  /* a freshly drawn card (waiting on the stage) joins a player's life row */
  function flyStageCardToNewLifeSlot(playerId, card, newHp) {
    var sc = stageCards.pop();
    var row = lifeRow(playerId);
    var slotEl = makeLifeSlot();
    row.appendChild(slotEl); // row re-centers
    var fly = sc
      ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(slotEl), { duration: 380, arc: 30 })
          .then(function () { sc.el.remove(); })
      : Promise.resolve();
    return fly.then(function () {
      var el = putCardInSlot(slotEl, card);
      var c = A.center(A.rect(slotEl));
      S.play('heal');
      P.burst(c.x, c.y, 'heal');
      return Promise.all([
        A.popIn(el),
        A.flashSlot(slotEl, '#5fe79b', 0.7),
        newHp !== undefined ? updateHpTo(playerId, newHp, true) : Promise.resolve()
      ]);
    });
  }

  function playLifeGained(ev, state) {
    return flyStageCardToNewLifeSlot(ev.playerId, ev.card, ev.newHp);
  }

  function playChargesRevealed(ev, state) {
    var stackEl = chargeStack(ev.playerId);
    var from = A.rect(stackEl);
    setChargeCount(ev.playerId, 0);
    var jobs = ev.cards.map(function (card, i) {
      var to = stageRect(stageCards.length);
      var ghost = ghostCard(card, false);
      var inner = ghost.querySelector('.card-inner');
      inner.style.transition = 'none';
      inner.style.transform = 'rotateY(180deg)';
      stageCards.push({ card: card, el: ghost, rect: to });
      return A.flyGhost(ghost, from, to, { duration: 340, arc: 24, rotFrom: 0, rotTo: -6 + i * 4 })
        .then(function () { S.play('flip'); return A.flipInner(ghost, 180, 0, A.D.flip); });
    });
    return Promise.all(jobs).then(function () {
      var c = A.center(stageRect(1));
      S.play('charge');
      P.burst(c.x, c.y, 'charge');
      log(state.players[ev.playerId].name + ' reveals ' + ev.cards.length +
        ' hidden charge' + (ev.cards.length > 1 ? 's' : '') + '!');
      return A.wait(A.D.stagePause * 0.8);
    });
  }

  /* a joker was hiding in the revealed charges: celebrate, burn it — its life
   * card and replacement attack card follow as ordinary draw events */
  function playJokerInCharge(ev, state) {
    var idx = -1;
    for (var i = 0; i < stageCards.length; i++) {
      if (stageCards[i].card.id === ev.card.id) { idx = i; break; }
    }
    var sc = idx >= 0 ? stageCards.splice(idx, 1)[0] : null;
    var c = sc ? A.center(A.rect(sc.el)) : A.center(stageRect(0));
    S.play('win');
    P.burst(c.x, c.y, 'victory');
    log(state.players[ev.playerId].name + '\'s charge hid a JOKER' +
      (ev.wasted ? ' — but their life is full!' : ' — an extra life card!'));
    return Promise.all([
      A.floatText(c.x, c.y - 40, 'JOKER!', 'info'),
      sc ? A.pulse(sc.el, 1.18) : Promise.resolve()
    ]).then(function () {
      if (!sc) return;
      return A.flyGhost(sc.el, A.rect(sc.el), A.rect($('discard')), { duration: A.D.tumble, rotTo: 140 })
        .then(function () { sc.el.remove(); setDiscardTop(ev.card); });
    });
  }

  function playAttack(ev, state) {
    setBanner('⚔ ' + state.players[ev.attackerId].name + ' strikes ' +
      state.players[ev.targetId].name + '!', accent(ev.attackerId));
    if (ev.chargeCards && ev.chargeCards.length) {
      var sc = A.center(stageRect(1));
      A.floatText(sc.x, sc.y - 60, '⚔ ' + ev.value, 'info', { duration: 800 });
    }
    var shieldSlotEl = shieldSlot(ev.targetId);
    var to = A.rect(shieldSlotEl);
    var flights = stageCards.map(function (sc, i) {
      return A.flyGhost(sc.el, A.rect(sc.el), to, {
        duration: A.D.strike,
        rotFrom: 0,
        rotTo: 300 + i * 40,
        arc: 60,
        easing: 'cubic-bezier(0.5, 0, 0.9, 0.4)'
      });
    });
    return Promise.all(flights);
  }

  function disposeStageToDiscard(state) {
    var pile = A.rect($('discard'));
    var jobs = stageCards.map(function (sc, i) {
      return A.flyGhost(sc.el, A.rect(sc.el), pile, {
        duration: A.D.tumble,
        rotFrom: 0, rotTo: 160 + i * 30
      }).then(function () { sc.el.remove(); });
    });
    stageCards = [];
    return Promise.all(jobs).then(function () {
      if (state.discard.length) setDiscardTop(state.discard[state.discard.length - 1]);
    });
  }

  function playDamage(ev, state) {
    var target = state.players[ev.playerId];
    var shieldSlotEl = shieldSlot(ev.playerId);
    var c = A.center(A.rect(shieldSlotEl));
    S.play('hit', { power: ev.amount });
    P.burst(c.x, c.y, 'impact', ev.amount);
    var zoneC = A.center(A.rect($('zone-' + ev.playerId)));
    log(target.name + ' takes ' + ev.amount + ' damage.');
    return Promise.all([
      A.shakeTable(3 + ev.amount * 0.8),
      A.flashSlot(shieldSlotEl, '#ff9a4a', 0.85),
      A.floatText(zoneC.x, zoneC.y - 20, '-' + ev.amount, 'damage'),
      updateHpTo(ev.playerId, ev.newHp, true)
    ]).then(function () {
      return disposeStageToDiscard(state);
    });
  }

  function playBlocked(ev, state) {
    var shieldSlotEl = shieldSlot(ev.defenderId);
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
      return A.wait(160);
    });
  }

  /* a life card is destroyed outright */
  function playLifeCardLost(ev, state) {
    var slotEl = lifeSlotAt(ev.playerId, ev.index);
    if (!slotEl) return Promise.resolve();
    var cardIn = slotEl.querySelector('.card');
    var from = cardIn ? A.rect(cardIn) : A.rect(slotEl);
    var ghost = ghostCard(ev.card, true);
    slotEl.remove(); // row re-centers
    var c = A.center(from);
    P.burst(c.x, c.y, 'dissolve');
    S.play('scramble');
    return A.flyGhost(ghost, from, A.rect($('discard')), { duration: A.D.tumble, rotTo: 150 })
      .then(function () {
        ghost.remove();
        setDiscardTop(ev.card);
      });
  }

  /* a life card drops to a lower denomination */
  function playLifeCardDown(ev, state) {
    var slotEl = lifeSlotAt(ev.playerId, ev.index);
    if (!slotEl) return Promise.resolve();
    var c = A.center(A.rect(slotEl));
    if (ev.newCard) {
      // the burnt pile had the owed denomination: old card out, new card in
      var cardIn = slotEl.querySelector('.card');
      var oldGhost = ghostCard(ev.oldCard, true);
      var from = cardIn ? A.rect(cardIn) : A.rect(slotEl);
      if (cardIn) cardIn.remove();
      clearPending(slotEl);
      S.play('scramble');
      var out = A.flyGhost(oldGhost, from, A.rect($('discard')), { duration: A.D.tumble, rotTo: 140 })
        .then(function () { oldGhost.remove(); setDiscardTop(state.discard[state.discard.length - 1] || ev.oldCard); });
      var inGhost = ghostCard(ev.newCard, true);
      var inFly = A.flyGhost(inGhost, A.rect($('discard')), A.rect(slotEl), { duration: 360, arc: 26 })
        .then(function () {
          inGhost.remove();
          var el = putCardInSlot(slotEl, ev.newCard);
          return A.popIn(el);
        });
      return Promise.all([out, inFly]).then(function () {
        return A.flashSlot(slotEl, '#ff5f52', 0.6);
      });
    }
    // no card of that value burnt yet: red cross + owed value
    paintPending(slotEl, ev.newValue);
    S.play('scramble');
    return Promise.all([
      A.flashSlot(slotEl, '#ff5f52', 0.75),
      A.pulse(slotEl, 1.1),
      A.floatText(c.x, c.y - 30, '→ ' + ev.newValue, 'damage small')
    ]);
  }

  /* a pending (red cross) card finally swaps for its owed denomination */
  function playPendingResolved(ev, state) {
    var slotEl = lifeSlotAt(ev.playerId, ev.index);
    if (!slotEl) return Promise.resolve();
    var cardIn = slotEl.querySelector('.card');
    var from = cardIn ? A.rect(cardIn) : A.rect(slotEl);
    var oldGhost = ghostCard(ev.oldCard, true);
    if (cardIn) cardIn.remove();
    clearPending(slotEl);
    S.play('flip');
    log(state.players[ev.playerId].name + "'s crossed " + ev.oldCard.label +
      ' swaps for the ' + ev.newCard.label + ' from the burnt pile.');
    var out = A.flyGhost(oldGhost, from, A.rect($('discard')), { duration: A.D.tumble, rotTo: 140 })
      .then(function () { oldGhost.remove(); setDiscardTop(state.discard[state.discard.length - 1] || ev.oldCard); });
    var inGhost = ghostCard(ev.newCard, true);
    var inFly = A.flyGhost(inGhost, A.rect($('discard')), A.rect(slotEl), { duration: 360, arc: 26 })
      .then(function () {
        inGhost.remove();
        var el = putCardInSlot(slotEl, ev.newCard);
        return Promise.all([A.popIn(el), A.flashSlot(slotEl, '#5fe79b', 0.5)]);
      });
    return Promise.all([out, inFly]);
  }

  function playHealthReplaced(ev, state) {
    var player = state.players[ev.playerId];
    var slotEl = lifeSlotAt(ev.playerId, ev.index);
    if (!slotEl) return Promise.resolve();
    var oldCardEl = slotEl.querySelector('.card');
    var c = A.center(A.rect(slotEl));

    S.play('scramble');
    P.burst(c.x, c.y, 'dissolve');
    var out = oldCardEl ? A.dissolveCard(oldCardEl) : Promise.resolve();

    return out.then(function () {
      if (oldCardEl) oldCardEl.remove();
      clearPending(slotEl);
      var sc = stageCards.pop();
      return sc
        ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(slotEl), { duration: 380, arc: 30 })
            .then(function () { sc.el.remove(); })
        : Promise.resolve();
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
        updateHpTo(ev.playerId, ev.newHp, true)
      ]);
    });
  }

  function playShieldReplaced(ev, state) {
    setBanner('⛨ ' + state.players[ev.byId].name + ' reforges ' +
      (ev.byId === ev.playerId ? 'their own' : state.players[ev.playerId].name + "'s") +
      ' shield', accent(ev.byId));
    var slotEl = shieldSlot(ev.playerId);
    var oldCardEl = slotEl.querySelector('.card');
    var pile = A.rect($('discard'));

    var out = Promise.resolve();
    if (oldCardEl) {
      var ghost = ghostCard(ev.oldCard, true);
      var from = A.rect(oldCardEl);
      oldCardEl.remove();
      out = A.flyGhost(ghost, from, pile, { duration: A.D.tumble, rotTo: 140 })
        .then(function () { ghost.remove(); setDiscardTop(ev.oldCard); });
    }

    var sc = stageCards.pop();
    var inFly = sc
      ? A.flyGhost(sc.el, A.rect(sc.el), slotTargetRect(slotEl), { duration: 400, arc: 36 })
          .then(function () { sc.el.remove(); })
      : Promise.resolve();

    return Promise.all([out, inFly]).then(function () {
      commitShieldCard(slotEl, ev.newCard);
      S.play('block');
      log(state.players[ev.byId].name + ' reforges ' + state.players[ev.playerId].name +
        "'s shield: " + ev.oldCard.label + ' → ' + ev.newCard.label + '.');
      var c = A.center(A.rect(slotEl));
      P.burst(c.x, c.y, 'block');
      return A.flashSlot(slotEl, '#bcdcf5', 0.8);
    });
  }

  /* a hidden charge slides face-down onto the player's charge stack */
  function playCharged(ev, state) {
    var stackEl = chargeStack(ev.playerId);
    var sc = stageCards.pop();
    var fly = sc
      ? A.flyGhost(sc.el, A.rect(sc.el), A.rect(stackEl), { duration: 380, arc: 26 })
          .then(function () { sc.el.remove(); })
      : Promise.resolve();
    return fly.then(function () {
      setChargeCount(ev.playerId, ev.count);
      S.play('charge');
      var c = A.center(A.rect(stackEl));
      P.burst(c.x, c.y, 'charge');
      log(state.players[ev.playerId].name + ' hides a charge (' + ev.count + ' held).');
      return A.pulse(stackEl, 1.15);
    });
  }

  /* burnt charges are revealed on the stage for a beat, so everyone sees what
   * was lost, then they tumble to the pile */
  function playChargesLost(ev, state) {
    var stackEl = chargeStack(ev.playerId);
    var from = A.rect(stackEl);
    setChargeCount(ev.playerId, 0);
    log(state.players[ev.playerId].name + "'s charges burn away!");
    var ghosts = ev.cards.map(function (card, i) {
      var ghost = ghostCard(card, false);
      var inner = ghost.querySelector('.card-inner');
      inner.style.transition = 'none';
      inner.style.transform = 'rotateY(180deg)';
      return { ghost: ghost, to: stageRect(i) };
    });
    return Promise.all(ghosts.map(function (g, i) {
      return A.flyGhost(g.ghost,
        { left: from.left + i * 6, top: from.top, width: from.width, height: from.height },
        g.to, { duration: 340, arc: 22, rotTo: -4 + i * 4 })
        .then(function () { S.play('flip'); return A.flipInner(g.ghost, 180, 0, A.D.flip); });
    })).then(function () {
      var c = A.center(stageRect(Math.min(ghosts.length - 1, 1)));
      P.burst(c.x, c.y, 'dissolve');
      return Promise.all([
        A.floatText(c.x, c.y - 44, 'CHARGES LOST', 'damage small'),
        A.wait(A.D.stagePause)
      ]);
    }).then(function () {
      var pile = A.rect($('discard'));
      return Promise.all(ghosts.map(function (g, i) {
        return A.flyGhost(g.ghost, A.rect(g.ghost), pile, { duration: A.D.tumble, rotTo: 140 + i * 25 })
          .then(function () { g.ghost.remove(); });
      }));
    }).then(function () {
      if (state.discard.length) setDiscardTop(state.discard[state.discard.length - 1]);
    });
  }

  function playCounterDeclined(ev, state) {
    var defender = state.players[ev.defenderId];
    var zoneC = A.center(A.rect($('zone-' + ev.defenderId)));
    log(defender.name + ' declines the counter.');
    return A.floatText(zoneC.x, zoneC.y - 30, 'DECLINED', 'block small');
  }

  function playGamble(ev, state) {
    var me = state.players[ev.playerId];
    S.play('charge');
    log(me.name + ' gambles on the life — calling ' + ev.guess + '.');
    return setBanner('🎲 ' + me.name + ' gambles on the life… ' +
      (ev.guess === 'red' ? '♥ RED' : '♠ BLACK'), accent(ev.playerId));
  }

  function playGambleResult(ev, state) {
    var me = state.players[ev.playerId];
    if (ev.win && ev.full) {
      log('Fate smiles, but ' + me.name + "'s life is already full — the card burns.");
      return disposeStageToDiscard(state);
    }
    if (ev.win) {
      log('Fate smiles — the ' + ev.card.label + ' joins ' + me.name + "'s life!");
      return flyStageCardToNewLifeSlot(ev.playerId, ev.card, ev.newHp);
    }
    var zoneC = A.center(A.rect($('zone-' + ev.playerId)));
    log('Fate frowns — ' + me.name + ' pays with their life.');
    S.play('eliminate');
    return Promise.all([
      A.shakeTable(7),
      A.floatText(zoneC.x, zoneC.y - 30, '☠ DOOMED', 'damage')
    ]).then(function () {
      return disposeStageToDiscard(state);
    });
  }

  function playSuddenDeath(ev, state) {
    var winner = state.players[ev.playerId];
    log('The deck runs dry — ' + winner.name + ' holds the most life!');
    setBanner('The deck runs dry!', accent(ev.playerId));
    var c = { x: global.innerWidth / 2, y: global.innerHeight / 2 };
    S.play('reshuffle');
    return A.floatText(c.x, c.y - 60, 'SUDDEN DEATH', 'info');
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
      ], { duration: 500, autoCancel: true })
    ]).then(function () {
      zone.classList.add('eliminated');
      updateHpTo(ev.playerId, R.hp(player), false);
      return A.wait(600);
    });
  }

  function playReshuffle(ev, state) {
    S.play('reshuffle');
    setDiscardTop(null);
    updateDeckCount(state);
    var deckC = A.center(A.rect($('deck')));
    P.burst(deckC.x, deckC.y, 'dissolve');
    log('The burnt pile is shuffled back into the deck.');
    return Promise.all([
      A.pulse($('deck'), 1.14),
      A.floatText(deckC.x, deckC.y - 50, 'RESHUFFLE', 'info small')
    ]);
  }

  function playEvent(ev, state) {
    switch (ev.type) {
      case 'reshuffle': return playReshuffle(ev, state);
      case 'draw': return playDraw(ev, state);
      case 'jokerDrawn': return playJokerDrawn(ev, state);
      case 'lifeGained': return playLifeGained(ev, state);
      case 'chargesRevealed': return playChargesRevealed(ev, state);
      case 'jokerInCharge': return playJokerInCharge(ev, state);
      case 'counterDeclined': return playCounterDeclined(ev, state);
      case 'attack': return playAttack(ev, state);
      case 'damage': return playDamage(ev, state);
      case 'blocked': return playBlocked(ev, state);
      case 'lifeCardLost': return playLifeCardLost(ev, state);
      case 'lifeCardDown': return playLifeCardDown(ev, state);
      case 'pendingResolved': return playPendingResolved(ev, state);
      case 'healthReplaced': return playHealthReplaced(ev, state);
      case 'shieldReplaced': return playShieldReplaced(ev, state);
      case 'charged': return playCharged(ev, state);
      case 'chargesLost': return playChargesLost(ev, state);
      case 'gamble': return playGamble(ev, state);
      case 'gambleResult': return playGambleResult(ev, state);
      case 'suddenDeath': return playSuddenDeath(ev, state);
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

  function paintSeatBtn(btn, type) {
    btn.textContent = type ? SEAT_LABELS[type] : '⚔ Human';
    btn.className = 'seat-btn' + (type ? ' cpu-' + type : '');
  }

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
        DEFAULT_NAMES[i] + '" value="' + (existing[i] ? escapeHtml(existing[i]) : '') + '">' +
        '<button class="seat-btn" data-idx="' + i + '"></button>';
      wrap.appendChild(row);
      var btn = row.querySelector('.seat-btn');
      paintSeatBtn(btn, seatTypes[i]);
      btn.addEventListener('click', (function (idx, b) {
        return function () {
          S.play('click');
          var next = SEAT_CYCLE[(SEAT_CYCLE.indexOf(seatTypes[idx]) + 1) % SEAT_CYCLE.length];
          seatTypes[idx] = next;
          paintSeatBtn(b, next);
        };
      })(i, btn));
    }
  }

  function readSeats() {
    var n = document.querySelectorAll('.name-input').length;
    return seatTypes.slice(0, n);
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
    cardEl: cardEl,
    setBots: setBots,
    readSeats: readSeats,
    showScreen: showScreen,
    buildTable: buildTable,
    syncAll: syncAll,
    animateDeal: animateDeal,
    announceTurn: announceTurn,
    setBanner: setBanner,
    lockActions: lockActions,
    unlockActions: unlockActions,
    enterTargetMode: enterTargetMode,
    enterCounterMode: enterCounterMode,
    exitTargetMode: exitTargetMode,
    gambleConfirm: gambleConfirm,
    gambleColor: gambleColor,
    hideModal: hideModal,
    playEvent: playEvent,
    showVictory: showVictory,
    renderNameInputs: renderNameInputs,
    readNames: readNames,
    updateDeckCount: updateDeckCount,
    log: log,
    accent: accent
  };
})(window);
