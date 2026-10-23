# Changelog

## 2.1.0 — Division Calculator panel

**Added**
- A compact **Division Calculator** beside the game (right side on wide screens, below the game on narrow ones).
  Two labelled fields (Dividend, Divisor); Quotient and Remainder update as you type; all four values are shown, plus
  the identity line, e.g. `58 = 7 × 8 + 2`. A **Clear** button resets it. There is no Calculate button.
- Integer (Euclidean) division with exact BigInt arithmetic: `dividend = divisor × quotient + remainder`, remainder
  always `0 ≤ r < |divisor|`. Examples: 58 ÷ 7 → 8 r 2; -58 ÷ 7 → -9 r 5; 58 ÷ -7 → -8 r 2.
- Validation: zero divisor (clear message, no result), empty input (prompt), invalid text (decimals, exponents,
  commas, letters, spaces, stray signs), and values outside ±9,007,199,254,740,991 are refused with an explanation.
  `NaN`, `Infinity`, `-0` and rounded results can never be displayed; every result is re-verified against the identity.
- New files: `js/calculator.js` (pure logic), `js/calculator-ui.js` (panel wiring), CSS block marked
  "Division Calculator", and `tests/calculator-test.js`.

**Changed (minimal)**
- `css/style.css`: `.app` became a one-column grid (this lets the panel sit beside the game); existing rules otherwise untouched.
- `js/ui.js`: **one added line** so the game's Y / N / S shortcuts never fire from inside the calculator panel.
- `index.html`: the `<aside>` panel and two `<script>` tags.
- Two existing test assertions that said "the page has no `<input>` at all" now say "no input in the game area; the
  only inputs are the two calculator fields" (same intent: nowhere to type the secret).
- `mind_reader_standalone.html` was regenerated with `tools/build-standalone.js` (no separate implementation).

**Not changed (verified byte-for-byte against 2.0.0)**
- `js/questions.js`, `js/engine.js`, `js/game.js`: question generation, selection, candidate filtering, undo,
  correction, contradiction and confirmation logic. A test now fails if any of them is edited.

## 2.0.0 — audit and rewrite

**Logic**
- Removed the disguised range/cutoff questions (`twoDigits`, `threeDigits`) and digit-sum threshold questions.
  Every question is now validated against the full range: ≥ 3 numbers on each side and ≥ 3 separate stretches per
  side, so "is it N?" and "higher/lower" can never appear, even via adaptive generation.
- Exact integer arithmetic for squares and cubes (no floating-point roots).
- Redundant questions (identical or complementary splits) are removed from the bank.
- Selection is now the most even split by a cost function (y² + n²), ties broken by simplicity then id.
  "Varied" order randomises only among questions within 2 % of the best.
- Adaptive generation of extra residue and digit-sum questions when the standard bank cannot split the candidates;
  these are labelled "Extra question". If even that fails the game says so and **does not guess**.
- The computer can name a number only when exactly one candidate remains (guess phase), and announces success only
  after the player confirms.
- Rejecting a guess no longer dead-ends: it shows why no number fits, offers single-change repairs, and can be undone.

**Game state**
- State is derived from *answers + rejected numbers + confirmation*, so corrections and undo cannot desynchronise
  candidates or counts. Every row's "possibilities left" equals an independent recount.
- Undo stack (answer, correction, reject, confirm, restore, re-ask Not sure).
- "Not sure" never narrows, is marked ❓ Uncertain, counted in the header, and can be re-asked on request.
- Rejected numbers are listed with a Restore button.

**Interface**
- Per-answer Yes / No / Not sure buttons on every history row replace the hidden dropdown panel.
- Contradiction panel lists every repair that would leave at least one candidate (first five inline, rest in a
  "More possible repairs" disclosure).
- Visible 3 px focus ring, skip link, aria-live status, `aria-pressed` on answer toggles, keyboard shortcuts
  (Y / N / S), focus moves sensibly after each action and never on page load, 44 px buttons, reduced-motion support,
  responsive down to 320 px, clear "How to play" instructions.
- Range and order are locked during a round (no silent abandonment).
- DOM built with `createElement` / `textContent`; no `innerHTML`.
- Visual style (dark panel, gold accents) preserved.

**Project**
- Split into `questions.js` (generation), `engine.js` (filtering + selection), `game.js` (state), `ui.js` (DOM).
- `tools/build-standalone.js` produces a single-file `mind_reader_standalone.html`.
- Tests: `tests/run-tests.js` (Node, no dependencies) and `tests/browser-test.py` (Chromium via Playwright).
