# ⚔ SHIELD

A dark-fantasy card game for **2–4 players on one screen** (hot-seat), played with a
standard 52-card deck. Pure HTML/CSS/JS — no build step, no dependencies, no server.

## Play it

- **On your computer:** just open `index.html` in any modern browser (double-click it).
- **On the web:** host the folder anywhere that serves static files —
  - **GitHub Pages:** repo Settings → Pages → deploy from branch → done.
  - **Netlify / Vercel:** drag-and-drop the folder or import the repo. No build command,
    output directory is the repo root.

Sound can be toggled with the ♪ button (bottom-right); the preference is remembered.

## Rules

Card values: **A = 1**, 2–10 face value, **J = 11, Q = 12, K = 13**. Suits don't matter.

Every player starts with three face-up cards: one **Shield** and two **Life** cards.
Your health is the **sum of your two life cards**; damage subtracts from that pool.
Reach 0 and you're out. **Last one standing wins.**

On your turn, do exactly one of:

- **⚔ Attack** — pick a target and draw a card from the deck; that's your attack value.
  - If it's **higher** than the target's shield, they take the difference as damage.
  - If it's **equal or lower**, the attack is *blocked* — and the defender strikes back:
    they pick one of **your** life cards, which is replaced by a random card from the
    deck. That can leave you weaker, healthier… or dead.
- **⛨ Change Shield** — replace anyone's shield (yours included) with a random card
  from the deck.
- **⚡ Charge** — draw a card into your charge slot. Your next attack adds it to the
  drawn attack card, then it's spent. You can hold only one charge at a time.

The discard pile is shuffled back into the deck whenever the deck runs out.

## Project layout

```
index.html        screens & markup (plain <script> tags — works over file://)
css/              theme, layout, cards, effects
js/rules.js       pure game logic (no DOM) — emits event lists
js/engine.js      turn/phase state machine
js/ui.js          rendering + event→animation playback
js/anim.js        Web-Animations-API toolkit (flips, flights, shakes, floats)
js/particles.js   canvas embers & burst effects
js/sound.js       WebAudio-synthesized sound effects (no audio files)
test/test.html    logic test suite — open in a browser, or: node test/tests.js
```

## Development notes

- Logic tests: `node test/tests.js` (or open `test/test.html`) — includes a 500-game
  fuzz test asserting card conservation and termination.
- Debug hooks: open `index.html?debug=1&seed=42` to get a deterministic deal and a
  `window.__shield` handle (`.state`, `.forceNextDraw(rank)`, `.engine`).
- Honors `prefers-reduced-motion`.
