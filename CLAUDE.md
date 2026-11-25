# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Touchline Tactics: a turn-based 11-a-side football game for the browser. Vanilla JavaScript, no build step, no dependencies, no linter. `README.md` is the player manual, `DESIGN.md` the rules and reasoning, `DEVLOG.md` the iteration history, measured numbers and known weaknesses.

**A push to `main` publishes** to https://snck.github.io/football/ (GitHub Pages, from the repo root).

## Commands

```bash
npm test                                                          # all engine tests (node:test)
node --test --test-name-pattern="offside" test/engine.test.js     # tests matching a name
npm run dev                                                       # static server on :8080 (PORT to change); opening index.html directly also works

node tools/sim.js 300 11              # CPU vs CPU stats: [matches] [seed]
node tools/balance.js 1000 830000000 # team round-robin with 95% intervals, all cores: [matches per ordered pair] [seedBase, default 5000]
node tools/mirror.js 16000 830000000 high normal # line v line, same club on both sides, all cores: [matches] [seedBase] [lineA] [lineB]
node tools/exploits.js 300 normal     # scripted "human" strategies vs CPU: [matches per policy] [difficulty]; seeds are fixed
node tools/lines.js 400 3             # deep/normal/high line comparison: [matches per cell] [seed]
node tools/timing.js 40 short         # estimated real-world match length: [matches] [length]
node tools/diag.js 300 910000000      # goals by origin, action mix, shown vs actual odds, loose balls, presses: [matches] [seedBase]
node tools/policies.js 1000 950000000 # fixed habits vs the CPU on Normal, with 95% intervals, all cores: [matches] [seedBase] [name filter]
```

The sims run at roughly 10 matches per second (about 70 on 12 cores for `balance.js`, `mirror.js` and `policies.js`, which use worker threads through `tools/pool.js`). `?seed=123` in the page URL makes a browser match reproducible, and `window.UI` is exposed for debugging and automated playtests (`UI.m` is the match state).

## Architecture

Every file in `js/` is a plain-script IIFE attaching to a global `FB` (`window` in the browser, `globalThis` in Node). Load order matters: `core → commentary → engine → ai`, then the browser-only `audio → render → game`. `tools/load.js` loads the first four into Node, so those must stay free of DOM access. A new engine file has to be added to both `index.html` and `tools/load.js`.

**State.** `FB.createMatch` returns one mutable match object `m` that everything operates on. Player ids are `team * 11 + slot`, so `m.players[id]` works directly. Positions are in metres on a 105×68 pitch. Team 0 (always the human in the browser) attacks toward +x. Most rules work in team-relative coordinates where each team attacks +x: convert with `FB.rel(team, p)`, which is its own inverse (`FB.abs`).

**Beat protocol.** One beat is:
1. `FB.startBeat`: shape step, or restart setup. Returns `needDefense` and `penalty`.
2. `FB.applyDefense` if needed. It may end the beat (tackle won, or foul).
3. `FB.resolveAttack`.
4. While `FB.canQuick(m)`: optionally `FB.startQuick`, then `resolveAttack` again. This covers both first-time play after a completed pass and counter-attacks (`FB.isCounter`).
5. `FB.endBeat`: advances the clock and returns events (`goal`, `halftime`, `fulltime`, `added`).

Three places implement this loop and must stay in step: `beat`/`attackPhase` in `js/game.js`, `playBeat` in `tools/runner.js`, and `tools/timing.js`. Quick and counter options must be evaluated with the first-time penalty on (`m.quick` incremented, by `startQuick` or temporarily as in `AI.chooseQuick` and `runner.js`). This was wrong once in the UI and once in the test harness (DEVLOG cycles 2 and 3).

**Displayed odds are the real odds.** `FB.evaluate(m, action)` is pure, uses no RNG, and returns the outcome distribution (probabilities sum to 1, tested). The UI previews, the CPU and `resolveAttack` all use it (tackles and penalties have `FB.tackleOdds` and `FB.penaltyGoal`). Who wins a loose ball is estimated by `FB.looseKeep`; it must keep matching `looseBall` (tested, and shown by `diag.js`). Put a rule change in `evaluate` and make the resolver roll from its numbers; don't add hidden modifiers at resolution. `TUNE` in `engine.js` holds most of the tunable constants.

**CPU (`ai.js`).** Attack: generate candidates, score each by expected value over `evaluate`'s outcomes using the threat map `V`, then pick by softmax (temperature set by difficulty when facing a human; `createMatch({ human: 0 })` simulates that, `-1` is CPU vs CPU and ignores difficulty). Defence: apply each plan hypothetically (`FB.snapshot` → `applyDefense(m, plan, true)` → score the attacker's best options → `FB.restore`) and take the minimum. The snapshot covers only positions, `beaten`, `marks` and `cover`, so a hypothetical plan that changes other state would leak.

**Animation.** Engine calls return timelines (`tl`): arrays of steps with `dur`, `moves`, `ball`, `owner`, `fx`, `caption`. State has already changed by then. `render.js` plays the timeline and `settle()` reconciles the display with the engine. The engine never waits on the UI; `game.js` waits on promises for human decisions, and `loopToken` invalidates a running loop on restart or quit. After an `await` in the beat loop, check the token.

**Determinism.** All match randomness goes through `m.rng`, and CPU choices draw from it too. Adding, removing or reordering an RNG call changes every seeded match, so compare balance over many matches and don't expect seed-for-seed results.

**Phone layout** lives only in `render.js`, `game.js` and `style.css`. `FB.VERTICAL_MQ` in `render.js` must match the portrait media query in `style.css`. On upright phones geometry is drawn on a rotated canvas, while players and text are drawn unrotated. Use `tx(desktop, touch)` in `game.js` for wording that mentions keys or clicks.

**Squads** are built once at load and cached per team from `teamDef.rating`, so changing `rating` at runtime does nothing. Surnames come from a shared pool in `FB.TEAMS` order, so reordering teams renames players.

## Balance changes

- Use at least 300 matches per cell, and report results on seeds that weren't used for tuning. Compare before and after on the same seeds and match counts. Earlier small-sample tuning put wrong claims into the devlog.
- The CPU optimises expected value, so a boost to one defensive channel shifts its attacks to another. Judge whole-match results.
- Rerun `exploits.js` after gameplay changes. At present every one-note script loses more than it wins on Normal; keep it that way.
- Record the numbers and the commands that produced them in `DEVLOG.md` ("Current numbers"), and keep the odds tables in `DESIGN.md` and the player-facing descriptions in `README.md` current.

## Design constraints

- Nothing is ever timed; every decision waits for the player.
- A Normal match should stay within 10–20 minutes (check with `timing.js`).
- No assets or network calls: art is drawn on canvas and sound is synthesised. All club and player names are invented.
- Left out on purpose: substitutions, fatigue, injuries and switching ends at half-time.
