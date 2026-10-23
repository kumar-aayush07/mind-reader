# Claude handoff prompt — audit and perfect Mind Reader

Audit the supplied `index.html`, fix logic and usability flaws, test it, and return the complete project ZIP and source. Do not merely make cosmetic changes.

## Goal
The player secretly chooses an integer in 1–50, 1–100, 1–250, or 1–1000. The computer identifies it through mathematical-property questions. Never ask “Is it N?”, “Is it greater/less than N?”, or any direct question that reveals the exact number. Permitted examples: parity, primality, squares/cubes, divisibility, digit properties, and remainders.

## Required guarantees
1. If every answer is truthful, the secret number must never be removed from candidates.
2. Announce success only when exactly one candidate remains.
3. Never make a random guess and present it as deduction.
4. Let users correct any prior answer; rebuild candidates and all displayed counts accurately.
5. If a guess is rejected, exclude it and provide an undo/recovery action for accidental clicks.
6. “Not sure” must not narrow candidates and should be visibly recorded as uncertain.
7. Avoid repeating questions and prefer questions that split remaining candidates as evenly as possible.
8. If no candidates remain, explain the contradiction and provide correction controls.
9. Ensure keyboard accessibility, visible focus, contrast, responsive layout, and clear instructions.
10. Run fully offline: no network calls, analytics, external scripts, or dependencies. Never ask the player to type their secret number.

## Testing requirements
- Exhaustively test every secret number from 1–1000 with truthful answers and verify it is eventually identified.
- Test all supported range sizes, edge values (1, 2, 9, 10, 99, 100, 101, 999, 1000 when in range), answer correction, “Not sure,” contradictory answers, wrong guesses, and undoing a wrong-guess click.
- Ensure truthful answers never produce an empty candidate set.
- Check browser console errors and verify the game opens locally.
- Include an automated test script and document actual results. Do not claim a test passed unless it was run.

## Implementation guidance
Separate question generation, candidate filtering, question selection, game state, and UI. Generate additional mathematical questions adaptively if the fixed question bank cannot distinguish candidates. Use deterministic tie-breaking in tests. Avoid unsafe HTML interpolation where practical. Do not disguise an arbitrary candidate as a solved answer. If the permitted question family cannot distinguish candidates, say so clearly and add legitimate mathematical questions instead of guessing.

## Deliverables
1. Complete, polished project ZIP.
2. All final source files.
3. Concise changelog.
4. Test instructions and real test results/limitations.
5. No TODO placeholders.

Inspect the existing implementation first, list its actual logic flaws, then fix and test them. Preserve its visual style unless a redesign materially improves usability.
