# Plan: mechanics cycle 6

Working document, written 2026-11-25 against commit `bb584d9`. It holds everything needed to resume with no
earlier context. The user agreed to the proposals and the order below. Delete it (or fold it into DEVLOG.md)
when the cycle is done.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Branch, commit tools, baseline | **done** (`ecd0847`) |
| 1a | Fixes with no balance effect (clear text, shot text, penalty mix) | **done** |
| 1b | Fixes that move balance (press penalty, loose balls, dribble skill) | todo, **next** |
| 2 | Re-tune Redmoor and the High line | todo, **needs numbers shown to the user before editing** |
| 3 | A. Cover / jockey | todo |
| 4 | B. Lasting marks, costlier trap | todo |
| 5 | C. Teammate runs | todo |
| 6 | D. Through balls (variety only; may be dropped after 3–5) | todo |
| 7 | Extras: shot types, corners, last attack, identity, half-time choice | todo |
| 8 | Final docs, full balance pass, ask about publishing | todo |

Update this table and the log at the bottom at the end of every phase.

## How to resume

1. Read CLAUDE.md (auto-loaded), this file, then only the files named in the phase you are starting.
2. `git status`, `git branch`, `npm test`.
3. Do **one phase per session**: each is independent once the one before is committed. End by updating this
   file, so context can be cleared again.

Standing rules:
- Work on branch `mechanics-6`. One local commit per phase. **Never push or merge to `main` without asking: that
  publishes the site.** Don't republish the old Claude Artifact.
- Balance numbers: CLAUDE.md rules. Quote the 95% interval. Standard error of points per match is about 1.3/√n,
  so 300 matches = ±0.15, 1,000 = ±0.08, 4,000 = ±0.04. Tune on one seed block, report on another.
- Any effect goes in `FB.evaluate` (or `tackleOdds` etc.), never only in the resolver. Anything a hypothetical
  defensive plan changes must be added to `FB.snapshot` / `FB.restore`.
- No hidden guesses, no timers. No new mandatory prompts: Normal is at 18.6 of 20 minutes.
- "Before" numbers can always be regenerated: `git worktree add <scratchpad>/base bb584d9`, copy in
  `tools/diag.js` and `tools/policies.js`, run with the same seeds.

### Seed ledger (add to it whenever seeds are used)

| Seeds | Used for |
|---|---|
| sim 11, 21–23; lines 3, 7; balance 5000+; exploits 9000+; round-robin 20000+ | cycle 5 |
| 500000000+, 600000000+ | Redmoor diagnosis |
| 700000000+, 710000000+ | High-line tuning |
| 910000000+ (300), 920000000+ (300), 930000000+ (400), 940000000+ (200) | analysis behind this plan |
| 950000000+ (1000), lines 31 | baseline below |
| **800000000+ unused** | reserved: High-line hold-out (phase 2) |
| **960…, 970…, 980…, 990… (×10⁶) unused** | reserved: phases 1b, 3, 4, 5 (first half tuning, +5,000,000 hold-out) |

### Tools added for this cycle

- `node tools/diag.js [matches] [seedBase]`: goals by origin, action mix by zone, shown vs actual odds, loose
  balls, press outcomes, plan mix, corners, half ends. Wraps the engine; uses `runner.js`.
- `node tools/policies.js [matches] [seedBase] [name filter]`: fixed habits vs the CPU on Normal with intervals.
  Things not overridden use the CPU brain. `exploits.js` differs: its scripts pick random first-time plays.

## Baseline (commit bb584d9)

`node tools/diag.js 300 910000000`, 2.34 goals/match (both sides):

- Goals by origin: first-time chain **48.6%**, open play direct 27.5%, corner direct **16.5%**, penalty 2.9%,
  free kick direct 2.7%, counter move 1.7%.
- Corners 4.7/match, **8.3%** scored directly (real football about 3%). Throw-ins 0.3/match.
- Action mix: through **35.7%** (midfield **43.3%**), pass 21.8%, lob 17.6%, dribble 15.7%, shoot 9.0%.
- Shown vs actual: pass 79.6/79.8, through 64.0/63.8, lob 65.6/65.3, header 50.0/49.3, dribble 67.1/66.8,
  shot 13.7/12.6. Sound; keep it so.
- Loose ball kept, assumed by `evaluate` vs actual: dribble touch 35 vs **73.5**; pass bad touch 35 vs **71.9**;
  pass misplaced 25 vs **66.4**; through bad touch 40 vs **60.6**; lob bad touch 40 vs **59.9**; lob misplaced
  25 vs **48.9**; through misplaced 20 vs **39.7**; clear 40 vs **11.9** (23% when forced from a 200-match test).
- Presses: ball kept and moved forward 40.6%, sideways/back 14.0%, presser wins it 11.0%, team wins it 24.3%.
- CPU plans: press 25.9, press+mark 23.1, mark 19.3, tackle 14.4, trap 13.0, hold 4.3.
- Halves ending with the ball in the attacking third 17.2%, dangerous set piece pending 3.8%.

`node tools/policies.js 1000 950000000` and `node tools/lines.js 300 31`:

```
baseline (CPU brain)       W367 D235 L398  pts 1.34 ±0.08  GF 1.24 GA 1.29
hold shape always          W162 D182 L656  pts 0.67 ±0.07  GF 0.91 GA 1.98
press nearest              W269 D275 L456  pts 1.08 ±0.08  GF 1.05 GA 1.37
mark top threat            W193 D182 L625  pts 0.76 ±0.07  GF 0.89 GA 1.88
press + mark               W331 D233 L436  pts 1.23 ±0.08  GF 1.16 GA 1.34
press + trap               W320 D247 L433  pts 1.21 ±0.08  GF 1.09 GA 1.29
press + mark + trap        W341 D249 L410  pts 1.27 ±0.08  GF 1.18 GA 1.29
press + mark, high line    W311 D226 L463  pts 1.16 ±0.08  GF 1.21 GA 1.54
through ball first         W456 D228 L316  pts 1.60 ±0.08  GF 1.42 GA 1.17
greedy attack              W558 D219 L223  pts 1.89 ±0.08  GF 1.67 GA 0.99
pass first                 W531 D236 L233  pts 1.83 ±0.08  GF 1.62 GA 1.01
lob first                  W306 D313 L381  pts 1.23 ±0.08  GF 0.89 GA 1.07
dribble first              W473 D250 L277  pts 1.67 ±0.08  GF 1.45 GA 1.07
always take a touch        W221 D275 L504  pts 0.94 ±0.07  GF 0.75 GA 1.26

lines 31: 300 matches per cell. "against" = what the opponent did vs the team holding that line.
mode     line    W-D-L        GF    GA    shots in/out box  xGA   thr% vs  corners A  opp poss  ball won at  lost at
active   deep    96-82-122    1.00  1.13   5.8 / 4.3        1.03    54%     2.4      49%      37.8 m    62.5 m
active   normal  122-68-110   1.22  1.16   5.7 / 4.6        1.26    62%     2.4      49%      39.9 m    63.9 m
active   high    106-77-117   1.31  1.40   5.2 / 5.0        1.32    66%     2.3      49%      42.4 m    64.7 m
passive  deep    35-54-211    0.73  1.99   8.4 / 6.3        1.89    61%     3.5      53%      33.0 m    60.6 m
passive  normal  43-44-213    0.88  2.04   7.7 / 6.8        1.96    66%     3.2      51%      34.8 m    61.6 m
passive  high    60-52-188    1.12  2.20   7.6 / 7.5        2.15    71%     3.1      51%      37.3 m    61.8 m
"ball won at" = distance from own goal where the team wins the ball; "lost at" = same for where it loses it.
```

Reading (95% interval of a difference between two rows is about ±0.11):
- Defence habits compare with the CPU brain (1.34). "press + mark + trap" 1.27 is inside the error: a rote habit is
  about as good as look-ahead. Marking **does** help a presser (1.08 → 1.23) and so does the trap (1.08 → 1.21). Mark
  alone is barely better than hold (0.76 vs 0.67). (A 400-match run had wrongly said marking adds nothing.)
- Attack habits compare with **greedy attack (1.89)**, not with the CPU brain, whose choice is deliberately noisy.
  Through-first is 0.29 worse than greedy, so through balls are common but **not** an exploit (an earlier comparison
  with the noisy CPU suggested they were). Pass-first (1.83) can't be told apart from greedy: the type of the *first*
  action matters little, and much of the attack's value is in the first-time chain that follows.
- Always taking a touch is weak (0.94 vs 1.34).

`sim 300 11`, `exploits 300 normal`, `timing 40`: see DEVLOG "Current numbers". Engine tests: 21 passing.

---

## Phase 0: setup

1. `git switch -c mechanics-6`, commit `PLAN.md`, `tools/diag.js`, `tools/policies.js`.
2. Add both tools to the command lists in CLAUDE.md and DESIGN section 6.

## Phase 1a: fixes with no balance effect

Read: `js/ai.js` end, `js/game.js` 303–360 and 555–585.

1. **Penalty mix** (`ai.js:233-234`). Keeper dives centre 8%, so shooting centre scores 86.8% vs 62.2% for a
   corner. Equilibrium from `FB.penaltyOdds`: keeper L/R/C = 0.345/0.345/0.31, taker 0.368/0.368/0.264 (goal
   chance about 69% whatever either does). Test: from the odds table and the CPU mixes, the human's best minus
   worst choice is under 0.02, as taker and as keeper. Put the mixes in named constants so the test can read
   them. Check the penalty help text still reads right.
2. **Clear preview** (`game.js:346`) says "50/50". Show the estimate from phase 1b's loose-ball function. Until
   then say "Usually lost" and drop the number.
3. **Shot preview** (`game.js:341`) prints `−30% × pressure`; the model uses 0.22. Move 0.22 into `TUNE` and use
   it in both places.

## Phase 1b: fixes that move balance

Read: `engine.js` `looseBall`, `FB.evaluate`, top of `resolveAttackInner`; `ai.js` `outcomeValue`.

1. **Press penalty** (`engine.js:1117-1118`). Every presser is slowed next beat unless the attacker shoots, even
   one who wins the ball. Intended rule (DESIGN section 3): only a *bypassed* presser. Apply it after resolution:
   attacking team still has the ball and the new carrier is nearer the presser's goal than the presser is.
   Applies once per beat, including first-time moves. Tests: backward pass → no slowdown; presser intercepts →
   none; forward pass past the presser → slowed.
2. **Loose balls.** `evaluate` uses constants `keep: 0.2–0.4`; `looseBall` runs a race (distance/speed +
   U(0, 0.9), beaten +0.8). Add pure `FB.looseKeep(m, pos, team, { exclude, spread })`: best arrival time per
   side, converted by a sigmoid with a width fitted to the noise plus scatter (12/8/4/3 m by case). Passer is
   excluded on misplaced balls; keepers only in their own box. Use it for every `k: 'loose'` outcome. Target:
   `diag.js` assumed vs actual within 5 points for every row with n over 300. If the race can't get there, use
   per-case constants from the baseline. Probabilities must still sum to 1 (they don't change, only `keep`).
   Watch speed: it runs in every `evaluate`; sims should stay above about 10 matches/second.
   Then show `looseKeep` in the clear preview
   (`describeAction`, now a plain "Usually lost"). Expect the CPU to become bolder; `outcomeValue` weights may need a small offset to hold goals/team.
3. **Dribble touch** (`engine.js:856`): add `- (c.attrs.dribble - 72) * 0.002`, keep the clamp.

Check: `npm test`; `sim 300 11` + one fresh seed; `exploits 300 normal`; `diag`; `policies 1000` on 960000000
before and after. Accept if goals/team 1.10–1.35, every one-note exploit still loses more than it wins, and
"always tackle/press" hasn't climbed (pressing gets stronger here).

## Phase 2: re-tune Redmoor and High

Background: High beats Normal by about +0.18 points per mirror match, and about half of Redmoor's lead
(+0.13 ±0.04) is its High line; the rest is the 4-3-3 shape. `midThird` alone can't fix it (1.0 still leaves
+0.10). `TUNE.line.high.react` 0.35 → 0.5 gave +0.02 ±0.04 (16,000 matches, one block, unconfirmed); 0.65 gave
−0.075. Those were on bb584d9 and **must be re-measured after phase 1b**.

1. Mirror matches (same club both sides, High vs Normal, test side alternating) for react 0.35/0.45/0.5/0.55.
2. Confirm the pick on hold-out 800000000+. Target: High − Normal within ±0.05; Deep also within about 0.1.
3. Then Redmoor: `rating` (edit `core.js`; squads are cached at load, so no runtime change) until every club is
   within about ±0.06 of the mean over at least 2,000 matches per club.
4. **Show the user the numbers and get a yes before editing `engine.js`/`core.js`.** The user approved this
   step, but earlier asked to see results before any change and hasn't approved a react value.
5. Update the DESIGN line table, README line text, DEVLOG (it lists 1.55 for Redmoor, which wasn't reproduced:
   1.475).

## Phase 3: A. Cover / jockey (highest value)

Read: `engine.js` `applyDefense`, `evaluate` dribble branch, `resolveAttack`, `turnover`, `startBeat`,
snapshot; `ai.js` `chooseDefense`; `game.js` `humanDefense` … `describePlan`, `drawDefenseOverlay`, `onKey`.

**Why:** 48.6% of goals come in first-time chains, where the defence has no move.

**Rule.** New order `cover: id`, exclusive with press and tackle, combinable with mark, trap and line.
- Range 14 m, moves up to 7.5 m to a point **3.5 m** goal-side of the carrier (press is 1.5 m). Pressure on
  the carrier follows from the distance (about 0.44 vs 0.89), no new constant.
- **Slide:** once per beat, after a *completed* pass, through ball or lob that leaves first-time play possible,
  the cover defender moves up to `TUNE.coverSlide` = 4 m towards 3.5 m goal-side of the new carrier. No RNG.
- **Jockey:** against dribbles, challenge radius +0.7 m and foul chance ×0.5 for the cover defender. Their tackle
  chance is unchanged.
- No "caught upfield" slowdown. Cost: the zone they left, little pressure on the passer, and no ball-winning.
- Intended triangle: Press beats slow play, Cover beats quick play, Tackle is the gamble.

**Engine.**
- `m.cover = { id, used: false }` set in `applyDefense` (hypothetical too, so add to `snapshot`/`restore`; copy
  the object). Clear in `startBeat` and `turnover`.
- Do the slide in the `FB.resolveAttack` wrapper, after `resolveAttackInner`, when `m.quickOk`, still the same
  attacking team, cover unused, defender not beaten or off. Push a timeline step (`dur` about 0.25). This place
  matters: `AI.chooseQuick` runs *before* `FB.startQuick` in all three beat loops, so sliding in `startQuick`
  would show stale odds. Done this way, **no beat loop needs changing**. Sliding when the player then takes a
  touch is fine.
- `defenseOptions` gains `cover` (same list as press). Commentary key `coverSlide` (sparingly), caption on slide.

**CPU.** Add cover plans for the nearest 1–2 and cover + mark. `chooseDefense` looks one action ahead, so it
can't see the slide. For hold, nearest press and nearest cover only: take the attacker's two best pass/through
options, place the receiver there hypothetically, apply the slide, score the best first-time follow-up with
`m.quick + 1`, and add `0.3 × p × max(0, follow-up − keep value)`. This touches carrier, poss, ball and quick:
save and restore them explicitly. If it costs more than about half the sim speed, use a constant bonus
instead, tuned on seeds. `describePlan` text: "X stands off and covers".

**UI.** Mode `4 Cover` (keep 1/2/3 as they are), big ring as for press, distinct arrow colour, and a faint 4 m circle
round the cover defender. Mutual exclusion in `defenseClick`, `commitDefense` whitelist, key `4`, how-to text in
`index.html`. Check portrait at 375 px: the control panel already scrolls a little when defending.
`commitDefense` drops unknown keys, so forgetting the whitelist silently loses the order.

**Tests.** Slide happens once, only after a completed pass, only up to 4 m; the next `evaluate` sees the new
position; cleared on turnover; snapshot/restore round-trip; dribble odds vs cover sum to 1 with lower foul chance.

**Accept** (hold-out, 1,000+ matches per cell): chain share of goals 35–44%; goals/team 1.10–1.35; CPU uses cover in
10–35% of plans and no plan exceeds 40%; add "cover", "cover + mark", "cover + mark + trap" to
`policies.js`, and every fixed habit sits at least 0.10 points below the CPU baseline (press + mark + trap
included; if that one still ties, it's phase 4's job); one-note exploits still lose; timing Normal at most 19.5 min.

## Phase 4: B. Marks and traps

**Why:** press + mark + trap every beat is about as good as the CPU's full look-ahead (1.27 vs 1.34, within error), and a
mark or trap costs almost nothing, so there's no reason not to add both.

1. **Lasting mark.** `m.markOrders[team] = { d, a, left }`, 2 further beats. While active, `shapeTargets` takes `d` out
   of zone/marking duty and targets 1.2 m goal-side of `a`; `startBeat` (which now clears `m.marks`) re-adds
   `m.marks[a] = d` when within 2.2 m after the shape step. Cancelled on turnover, restart, red card, or a new
   order for the same defender. The cost is the hole in the zone, which should come out of geometry. Show the
   remaining beats in the UI and let the player cancel it. One live order per team.
2. **Trap cost.** `m.trapped` = set of defenders who stepped up this beat (in `snapshot`). In `evaluate` through
   balls, they get `TUNE.trapReact` = +0.25 s (only those who really moved); add to the preview note. If a through ball or
   lob is completed beyond them, `recover = 1`.
3. CPU: price the lasting mark in `chooseDefense` (start with no extra value, then fit), and drop its flat `+0.002` trap cost if
   the real cost replaces it.

Accept: pressing with a mark or trap is no longer automatically better than pressing alone; "press + mark + trap" at least 0.10 below the CPU;
"high line + trap" still loses; offsides/team 0.4–1.0.

## Phase 5: C. Teammate runs

**Why:** off-ball movement is automatic and partly random. Always taking a touch is weak, so the
safe choice needs a purpose.

**Rule.** When you take a touch you may call **one** run: `behind`, `overlap` or `short`. It's carried out in the next
beat's shape step, before the defensive decision, so the defence sees it and odds stay honest.
- `m.runs[team] = { id, kind }`, used up in `startBeat`; cancelled on turnover or restart.
- In `shapeTargets` (in possession): `behind` = toward goal through the widest gap, stops at the offside limit; `overlap` =
  outside and 8–10 m beyond the carrier on that flank; `short` = 9–11 m from the carrier, on the free side. Runner gets
  ×1.25 distance that step and skips the random pocket search.
- `behind` also gives a running start: in the next `evaluate` of a through ball to that runner, `runT − 0.25 s` (floor
  at 0), shown in the preview. Nothing else is modified, so a marked run can be a pure decoy.
- API: `FB.orderRun(m, team, run)` (validates). In all three loops (`game.js` attackPhase, `runner.js`, `timing.js`),
  when quick play is declined: `const run = …; if (run) FB.orderRun(...)`.
- CPU: `AI.chooseRun(m)`, deterministic heuristic, **no RNG and no hypothetical shape step** (`shapeTargets` draws
  RNG). `behind` for the forward with most room behind the line; `short` when the carrier is pressed and no pass is over 0.8;
  `overlap` when the carrier is wide past halfway; else none.
- UI: first-time phase only, optional, never blocks Space/Take a touch. A `Run` row: pick kind, tap teammate, arrow
  overlay; on touch one tap for the kind and one for the player. The defending human sees the CPU's run arrow.

Accept: "always take a touch" + `chooseRun` beats plain "always take a touch" by at least 0.15; baseline CPU vs CPU
goals/team 1.10–1.40; no "run behind every time" habit at or above the CPU; timing at most 19.5 min (add 1 s for a
share of touches to `timing.js`).

## Phase 6: D. Through balls (check first)

A variety problem (35.7% of actions, 43.3% in midfield), not an exploit: the habit is already 0.29 below greedy. Run
`diag.js` after phase 5 and stop here if through is under 30% of all actions. Otherwise, in order, measured
separately, keeping every "… first" habit at or below greedy:
1. The 0.8 s defender reaction in `evaluate` is for turning. Use 0.45 s when the target is in front of the chaser
   (chaser is goal-side of it).
2. Passes to feet of up to 15 m to a receiver with pressure under 0.25: next first-time penalty 0.03 instead of 0.05
   (store on `m`, show in UI text, respect the quick rule in CLAUDE.md).

## Phase 7: extras (independent, each its own commit)

1. **Shot type:** `shoot` gains `kind`: placed (default, today's numbers), driven (better from over 18 m, more blocks and
   rebounds, less on target), chip (only when the keeper is over 4 m off the line). All in `shotModel`. Fit so no
   kind is best everywhere. Skip headers. CPU adds the kinds to its candidates.
2. **Corners:** attacker near/far/short (short needs a receiver placed 10–12 m from the flag). Defender
   man / zonal / leave two up. Needs `needDefense` for corners (`engine.js:489`) or a setting kept between corners
   (preferred: no extra prompt). Bring direct conversion from 8.3% to about 4–5%, and recheck goals/team.
3. **Last attack:** at time, if the team in possession is past rel x 70 or has a corner/dangerous free kick, play on
   until the ball is lost, cleared, out or scored, at most 3 beats (extend `penPending`, `engine.js:1446`). Announce it.
4. **Identity:** `style.cross` is dead data: use it (CPU cross bias) or delete it. One visible trait for 2–3 players per
   club that changes `evaluate` (e.g. long passer, aerial, dribbler).
5. **Half-time choice:** one optional change on the half-time report: line/attitude or shape. CPU may change too.
6. **Also worth a look:** Easy rewards shortcuts (DEVLOG known weaknesses); not agreed as work, so raise it only.
7. **Penalty xG** (found in 1a, not agreed as work, raise it only): `resolvePenalty` credits a fixed 0.76 xG, but with the
   mixes at equilibrium an average taker scores about 0.62 (0.688 × 0.9, the factor the engine applies). About 0.06
   penalties per match, so it barely shows in the totals.

## Not doing

Pressing fatigue (fatigue is out by design), hidden defensive guesses (break the honest odds), separate throw-in rules
(0.3 per match), bigger momentum effect (about 0.4 points at present; cosmetic by choice).

## Phase 8: finish

Full numbers at 1,000+ matches on hold-out seeds; DEVLOG cycle 6 (what, why, before/after, commands, seeds, what
failed); DESIGN sections 1, 3, 4, 9; README; CLAUDE.md (new state in snapshot, new tools); a browser playthrough
(desktop + 375 px portrait + landscape), zero console errors; then ask about merging and publishing.

## Log

- 2026-11-25: analysis done, tools written, plan agreed. No game code changed. The 1,000-match baseline corrected two
  claims made to the user from 400 matches (marking adds nothing; through-first is an exploit); the user was told.
- 2026-11-25: phases 0 and 1a. Mixes are `FB.AI.PEN_SHOT` / `PEN_DIVE`; `TUNE.shotPressure` = 0.22. One addition to the
  spec: the old penalty help text was wrong ("saves about 2 in 3", "almost always score": really about 57% saved and
  80% scored), so the panel now prints the four real chances from a new `FB.penaltyGoal(m, dir, dive)`, which
  `resolvePenalty` also rolls. Three tests added, 24 passing. Before → after on the same seeds: `sim 300 11` goals/team 1.21 →
  1.21, xG 1.19 → 1.20, penalties scored 14 → 11; `exploits 300 normal` moves by at most 5 results in any
  row and every one-note script still loses more than it wins. No fresh seeds used. UI text checked by running the functions in
  Node, not in a browser (that's in phase 8). The DEVLOG entry waits for phase 8.
