# ⚔ SHIELD

A medieval castle card game for **2–4 players on one screen** (hot-seat), played with a
54-card deck (jokers included) — mossy castle walls, flickering torches, a round wooden table, and
chunky parchment cards with playful, snappy animations. Pure HTML/CSS/JS — no build step, no dependencies, no server.

## Play it

- **On your computer:** just open `index.html` in any modern browser (double-click it).
- **On the web:** host the folder anywhere that serves static files —
  - **GitHub Pages:** repo Settings → Pages → deploy from branch → done.
  - **Netlify / Vercel:** drag-and-drop the folder or import the repo. No build command,
    output directory is the repo root.

Sound can be toggled with the ♪ button (bottom-right); the preference is remembered.

## Rules

Played with a standard deck **plus two jokers** (54 cards). Card values: **A = 1**,
2–10 face value, **J = 11, Q = 12, K = 13**. Suits only matter when gambling.

Every player starts with a sideways **Shield** card and two **Life** cards. Your
life IS the cards: your total health is the sum of your life cards' values.
Lose them all and you're out. **Last one standing wins.**

On your turn, do exactly one of:

- **⚔ Attack** — pick a target and draw a card; that's your attack value (plus any
  hidden charges you hold, which are revealed and spent).
  - If it **beats** the target's shield, they take the difference as damage. Damage
    hits their **lowest life card first**: the card swaps to its reduced
    denomination (a 6 that takes 4 becomes a 2). The replacement comes from the
    burnt pile if it's there — otherwise the card is marked with a **red cross**
    and owes that value until one turns up in the burnt pile, then swaps
    automatically. A card reduced to nothing is destroyed, and leftover damage
    spills onto the next-lowest card. Taking any life damage also **burns all your
    hidden charges**.
  - If it's **equal or lower**, the attack is *blocked* — and the defender strikes
    back: they pick one of **your** life cards, which is replaced by a random card
    from the deck.
- **⛨ Change Shield** — replace anyone's shield (yours included) with a random card
  from the deck.
- **⚡ Charge** — draw a card **face down** into your charge stack. Nobody sees it
  (not even you) until your next attack adds every held charge to the drawn card.
  Charges stack without limit — but you lose them all if someone lands a hit on you.
- **◆ The sigil button** — *gamble on the life*. Call **red or black**; if the next
  card matches, it joins your life. If it doesn't, you die on the spot.

**Jokers:** any draw that turns up a joker grants the drawer an **extra life card**
(the next card off the deck), and then the draw continues for its original purpose.
This applies to every action — even mid-gamble (the color call stays locked) and
counters (there it's the defender doing the drawing who benefits).

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
