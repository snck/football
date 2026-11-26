# Plan: mechanics cycle 6

Working document, written 2026-11-25 against commit `bb584d9`. It holds everything needed to resume with no
earlier context. The user agreed to the proposals and the order below. Delete it (or fold it into DEVLOG.md)
when the cycle is done.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Branch, commit tools, baseline | **done** (`ecd0847`) |
| 1a | Fixes with no balance effect (clear text, shot text, penalty mix) | **done** |
| 1b | Fixes that move balance (press penalty, loose balls, dribble skill) | **done** |
| 2 | Re-tune Redmoor and the High line | **done** (user approved react 0.5, Redmoor 73) |
| 3 | A. Cover / jockey | **done** (user dropped the chain-share target, see "Phase 3 result") |
| 4 | B. Lasting marks, costlier trap | **done** (mark target missed, user accepted it, see "Phase 4 result") |
| 5 | C. Teammate runs | **done** (user dropped the +0.15 run target, see "Phase 5 result") |
| 6 | D. Through balls (variety only; may be dropped after 3–5) | todo, **next** (through is 36.1% of actions, so it goes ahead) |
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
| 720000000+ (16,000), 730000000+ (12,000), 725000000+ (1000 diag) | phase 2 tuning |
| 800000000+ (32,000) | phase 2 High/Deep line hold-out |
| 820000000+ (24,000) | phase 2 clubs hold-out |
| sim 42, 43 | phase 2 |
| 960000000+, 965000000+ (1000 each), 962000000+ (200) and 963000000+ (100) for the loose-ball fit, sim 41 | phase 1b |
| 970000000–973000000 blocks (970.0–970.4, 971.0, 971.1, 971.5, 972.0, 973.0 ×10⁶) | phase 3 tuning |
| 975, 976, 977, 978 ×10⁶ | phase 3 hold-out |
| 980, 981, 982, 983, 984 ×10⁶ | phase 4 tuning |
| 985 (policies), 986 (diag), 987 (mirror), 988 (balance) ×10⁶; sim 44 | phase 4 hold-out, both engines |
| 990, 991 ×10⁶ | phase 5 tuning |
| 995 (policies), 996 (diag) ×10⁶; sim 44 again | phase 5 hold-out, both engines |
| **1000000000+ unused** | |

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

### After phase 1b (superseded by the phase 2 column below)

`node tools/policies.js 1000 965000000` (before = 1a, same seeds; every change is within the error of a difference, ±0.11):

```
                        1a     1b
baseline (CPU brain)    1.36   1.38 ±0.08  GF 1.26 GA 1.21
hold shape always       0.63   0.68 ±0.07  GF 0.94 GA 1.97
press nearest           1.23   1.19 ±0.08  GF 1.12 GA 1.35
mark top threat         0.73   0.71 ±0.07  GF 0.91 GA 1.95
press + mark            1.22   1.22 ±0.08  GF 1.14 GA 1.31
press + trap            1.23   1.26 ±0.08  GF 1.13 GA 1.25
press + mark + trap     1.27   1.22 ±0.08  GF 1.15 GA 1.32
press + mark, high line 1.25   1.24 ±0.08  GF 1.31 GA 1.47
greedy attack           1.90   1.84 ±0.08  GF 1.72 GA 1.05
through ball first      1.54   1.46 ±0.08  GF 1.43 GA 1.30
pass first              1.81   1.79 ±0.08  GF 1.61 GA 1.01
lob first               1.24   1.19 ±0.08  GF 0.91 GA 1.11
dribble first           1.56   1.66 ±0.08  GF 1.43 GA 1.05
always take a touch     0.93   0.97 ±0.07  GF 0.75 GA 1.25
```

`node tools/diag.js 1000 965000000`: 2.51 goals/match (2.52 before); first-time chain 49.3% of goals, open play direct 27.5%,
corner direct 16.0% (960000000: 2.52, 50.8%, 26.0%, 15.9%). Plans: press 24.9, press+mark 22.4, mark 18.9, tackle 15.8, trap 12.9, hold 5.1.

### After phase 2: compare phases 3–5 with this

`node tools/policies.js 1000 965000000`, same seeds as the 1b column:

```
baseline (CPU brain)       W357 D261 L382  pts 1.33 ±0.08  GF 1.23 GA 1.28
hold shape always          W160 D204 L636  pts 0.68 ±0.07  GF 0.94 GA 1.94
press nearest              W328 D227 L445  pts 1.21 ±0.08  GF 1.12 GA 1.30
mark top threat            W189 D185 L626  pts 0.75 ±0.07  GF 0.95 GA 1.91
press + mark               W338 D258 L404  pts 1.27 ±0.08  GF 1.15 GA 1.29
press + trap               W375 D242 L383  pts 1.37 ±0.08  GF 1.18 GA 1.16
press + mark + trap        W327 D251 L422  pts 1.23 ±0.08  GF 1.19 GA 1.32
press + mark, high line    W326 D237 L437  pts 1.22 ±0.08  GF 1.29 GA 1.49
greedy attack              W542 D229 L229  pts 1.85 ±0.08  GF 1.71 GA 1.03
through ball first         W421 D223 L356  pts 1.49 ±0.08  GF 1.45 GA 1.32
pass first                 W534 D207 L259  pts 1.81 ±0.08  GF 1.57 GA 1.02
lob first                  W325 D254 L421  pts 1.23 ±0.08  GF 0.94 GA 1.15
dribble first              W450 D246 L304  pts 1.60 ±0.08  GF 1.43 GA 1.12
always take a touch        W246 D258 L496  pts 1.00 ±0.08  GF 0.79 GA 1.27
```

"press + trap" equals the CPU brain (1.26 before, at the edge of the error): watch it in phases 3 and 4.
`node tools/diag.js 1000 965000000`: 2.47 goals/match; first-time chain 49.8% of goals, open play direct 28.7%, corner direct 15.0%.
`exploits 300 normal` (W-D-L): thoughtful 175-64-61, shoot on sight 74-69-157, dribble only 73-100-127, hoof 39-76-185, safest pass
0-153-147, park the bus 42-63-195, always tackle/press 74-80-146, high line + trap 68-57-175. `sim 300 11` 1.27 goals/team, `sim 1000 43`
1.23, `timing 40` 18.4 min. `balance 60`: Harbour +0.047, Redmoor −0.011, Kestrel −0.047, Coldforge +0.011 (each ±0.14).
`lines 400 3` active W-D-L: deep 148-118-134, normal 161-105-134, high 152-87-161.

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

**Accept** (hold-out, 1,000+ matches per cell): chain share of goals 35–44% (dropped by the user, see the result below); goals/team 1.10–1.35; CPU uses cover in
10–35% of plans and no plan exceeds 40%; add "cover", "cover + mark", "cover + mark + trap" to
`policies.js`, and every fixed habit sits at least 0.10 points below the CPU baseline (press + mark + trap
included; if that one still ties, it's phase 4's job); one-note exploits still lose; timing Normal at most 19.5 min.

### Phase 3 result (2026-11-25)

Built as specified except two things:
- **No look-ahead in `chooseDefense`.** The specified one (coefficient 0.3) made the CPU weaker: the plan without it took +0.111 ±0.066 points
  per mirror match with cover switched off and +0.089 ±0.066 with it on (6,000 each, same seeds, 971100000). Not diagnosed. The spec's
  fallback is in: a constant, `FB.AI.PLAN.cover` = 0.002. With it the CPU uses cover in 20% of plans, at no measurable cost (+0.030 ±0.057 tuning,
  **+0.046 ±0.046** on 12,000 hold-out matches, against the same CPU with cover off). 0.001 gives 30% of plans, 0.003 12%; points can't be told apart.
- The slide is skipped when the defender is already goal-side and within 3.5 m. Its timeline caption keeps the pass's own caption.

| Target | Result (hold-out) | |
|---|---|---|
| Chain share 35–44% | **50.9 ±1.0%** with cover, 50.1 ±1.0% on the phase 2 engine (4,000 matches each, 976000000) | missed, **target dropped** |
| Goals/team 1.10–1.35 | 1.236 ±0.022 (1.265 ±0.022 before) | ok |
| CPU uses cover 10–35%, no plan over 40% | 19.6%; biggest plan 17.7% | ok |
| Every habit 0.10 below the CPU (1.37 ±0.04) | press nearest 1.18, press + trap **1.29**, press + mark + trap **1.27**, cover + mark + trap 1.11 (±0.04 each, 4,000 matches, 978000000); on 1,000 matches cover 0.98, cover + mark 1.03 | cover habits ok; press + trap 0.08 and press + mark + trap 0.10 below, so phase 4's job |
| One-note exploits lose | `exploits 300 normal`: thoughtful 171-62-67; shoot on sight 70-83-147, dribble only 97-90-113, hoof 36-97-167, safest pass 0-152-148, park the bus 59-40-201, always tackle/press 72-71-157, high line + trap 70-46-184 | ok |
| Timing ≤ 19.5 min | 18.5 (18.4 before) | ok |

Calibration on 975000000 (`diag.js 1000`): pass 79.4/79.3, through 64.6/64.4, lob 65.8/65.5, dribble 70.2/70.4, shot 13.7/14.1 (shown/actual). Speed
11.0 → 8.7 matches/s on one core (more plans). Engine tests 28 → 33.

**Why the target was missed (measured):** 75% of chain goals are a through ball followed by a first-time shot (509 chain goals, 400 matches). The
receiver is a median of 22 m from the covering player before the slide and 18 m after (100 matches), so 4 m can't reach him. Slides of
4, 7 and 10 m can't be told apart (forced cover, 2,000 matches: 1.36, 1.29, 1.28 chain goals per match, against 1.40 for hold or press).
Letting the nearest defender slide instead, or the whole block slide, gave 46–48% of goals (1,000 matches each, ±2). Even a cover man who teleports to
the receiver still left **44.8 ±2.0%**, so no one-defender slide gets to 35–44%.

These diagnostics ran on tuning seeds. The slide variants and the teleport used the discarded look-ahead CPU, which covered in 40–50% of plans;
the final CPU covers in 20%, so it would move even less.

**Decision (user, 2026-11-25):** keep Cover as it is and drop the chain-share target. First-time shots stay as they are. Found on the way, for reference:
first-time *passes* cost 5% accuracy but first-time **shots carry no penalty at all**. Scaling only their chance (tuning seeds, 2,000 matches each):
×1 48.5% / 1.253 goals per team; ×0.85 46.7% / 1.176; ×0.7 41.3% / 1.078 (under the 1.10 floor). Not in the plan, not applied.

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

### Phase 4 result (2026-11-25)

What was built differs from the spec in these ways:
- **The marker moves after his man** in the shape step, not with the other defenders. In the spec's order attackers run away from him: the mark
  was tight on 14% of follow-up beats, against 47% this way (60 matches).
- **Addition to the spec: a marker doesn't cut out balls meant for anyone else** (left out of `laneRisk`, unless his man has the ball). The
  hole in the zone was not enough: without this rule press + mark was +0.10 over press (8,000 matches) and +0.14 (4,000), more than before the phase.
- **`trapReact` is 0.4**, not 0.25 (at 0.25 the habit kept about +0.05 over press). A marker doesn't step up with the trap.
- A new mark removes the old one at once (otherwise two men counted as marked in the turn of the change).
- CPU: the flat trap charge is gone, the mark charge stays 0.001, and with a mark standing it also weighs releasing it. 8,000 mirror matches against the
  default (984000000, ±0.057): mark 0 +0.001, 0.003 −0.054, 0.006 −0.121, never mark −0.174, trap charge 0.002 +0.019, no release −0.042.
- `m.markOrders` is only written for real plans, so it isn't in the snapshot; `m.trapped` is.

Hold-out, 4,000 matches per row (985000000, ±0.04; "before" is the phase 3 engine on the same seeds):

| | Before | After |
|---|---|---|
| CPU brain | 1.36 | 1.40 |
| hold | 0.68 | 0.65 |
| press nearest | 1.22 | 1.14 |
| mark top threat | 0.73 | 0.79 |
| press + mark (new mark every turn) | 1.26 | 1.24 |
| press + mark, left on | | 1.17 |
| mark, then press | | 0.94 |
| press + trap | 1.31 | 1.15 |
| press + mark + trap | 1.29 | 1.20 |
| press + mark, high line | 1.22 | 1.18 |
| cover / + mark / + mark + trap | 1.01 / 1.10 / 1.12 | 1.00 / 1.06 / 1.04 |
| greedy | not run | 1.86 |
| through / pass / lob / dribble first | not run | 1.52 / 1.74 / 1.19 / 1.62 |
| always take a touch | not run | 0.91 |

| Target | Result | |
|---|---|---|
| Trap no longer automatically better | press + trap − press: +0.01 ±0.06 (before +0.09) | **met** |
| Mark no longer automatically better | press + mark − press: **+0.10 ±0.06** here; about **+0.06 ±0.03** pooled with tuning (before: also +0.06 ±0.03) | **missed** |
| Same, marking once and leaving it on | press + mark, left on − press: +0.03 ±0.06 | ok |
| press + mark + trap 0.10 below the CPU | 0.20 below; every fixed defence habit is at least 0.16 below | met |
| "high line + trap" still loses | 57-53-190 (before 70-46-184) | met |
| Offsides/team 0.4–1.0 | 0.56 (before 0.58) | met |

Whole game, same seeds before → after: goals/team 1.24 → 1.25 (`balance.js 1000 988000000`, 12,000 matches), 1.22 → 1.23 (`sim 1000 44`). Chain share of goals
51.8 → 51.3% (`diag.js 1000 986000000`), calibration within 0.7 points everywhere, loose balls within 2.4. Plans: trap 11 → 16%, anything with a mark 42 →
36%, release 2.6%. Clubs within ±0.01 of the mean (±0.033). `mirror.js 16000 987000000`: High − Normal +0.036 → **+0.056 ±0.041** (the phase 2 target was
±0.05, so it sits at the edge; the two can't be told apart), Deep − Normal −0.107 → −0.072 ±0.039. `exploits 300 normal`: thoughtful 175-62-63, shoot on sight 74-82-144,
dribble only 90-88-122, hoof 39-96-165, safest pass 0-149-151, park the bus 39-51-210, always tackle/press 84-64-152: all one-note scripts lose.
`timing 40` 18.4 min. `sim 300 11` 1.27 goals/team. Speed 8.5 → 8.0 matches/s on one core. Engine tests 33 → 41.

**Where the mark's edge comes from** (tuning seeds, 8,000 matches each, press + mark − press): no move this turn (`markMove` 0) −0.01, no follow-up turns +0.07, no
first-touch bonus +0.04. So it's the extra repositioning. These didn't remove it: moves of 4–6 m (+0.03 to +0.07), slower chasing of other runners (0.4 s +0.03, 0.8 s +0.06), reach for
other balls halved. Each is ±0.045 to ±0.06, so they can't be ranked; the pick from tuning (+0.05) came out at +0.10 on the hold-out. `markMove` 0 also takes the CPU's mark away.

**Decision (user, 2026-11-25):** accept marks as they are. Re-marking the top threat each turn uses the threat rings, and the habit is 0.16 below the CPU. The
alternative, not letting a *new* mark be combined with a press, tackle or cover, was offered and not taken; it was never built or measured.

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

### Phase 5 result (2026-11-26)

Built as specified, with these details:
- The runner is left out of the box runs, the search for space and the short-outlet rule, then sent to the run's spot (`runSpot` in `engine.js`,
  no RNG, also used by the UI preview as `FB.runTarget`). Defenders still move first, so the run is made after their step and before their decision.
- The head start counts only in the **first action of the beat** (not first-time play). `m.runMade` holds the run for the beat (display and head start);
  `m.runs` is cleared in `startBeat` and on turnovers and restarts. Neither is touched by a hypothetical plan, so nothing new in the snapshot.
- `AI.chooseRun` order: short (pressed above 0.5 and no pass over 0.8), behind (a forward within 15 m of the line with at least 8 m of space
  10 m beyond it, and 8 m between line and goal), overlap (carrier past halfway and over 18 m from the centre, nearest teammate behind the ball on that side).
  Thresholds in `FB.AI.RUN`. It calls about 22 runs a match in CPU v CPU, 19.6 of them in behind.
- UI: a `Run` row only during a first-time chance (desktop text "Run when you take a touch:", keys B/O/S, then click the runner; touch: tap kind,
  tap runner). Yellow dotted arrow to the projected spot; the made run is drawn faintly next beat; the defending human sees the CPU's run in orange and a
  "Their run" line. On a phone the first-time rule moved from the row into the preview box so the row fits on one line (portrait side panel 246 against 221 px,
  as in phases 3–4). `timing.js` adds 1 s when a human calls a run.

Hold-out, 4,000 matches per row (995000000, ±0.04; "before" is the phase 4 engine on the same seeds):

| | Before | After |
|---|---|---|
| CPU brain | 1.36 | 1.36 |
| always take a touch (no runs) | 0.92 | 0.92 |
| touch + CPU runs | | 0.94 |
| touch + run behind (furthest-forward teammate) | | 0.95 |
| CPU brain, no runs | | 1.35 |
| run behind every time / come short every time / overlap every time | | 1.39 / 1.31 / 1.34 |
| greedy attack | 1.87 | 1.94 |

| Target | Result | |
|---|---|---|
| touch + chooseRun at least 0.15 over touch | **+0.02 ±0.06** | **missed** |
| CPU v CPU goals/team 1.10–1.40 | `sim 1000 44` 1.26 (1.23 before); `sim 300 11` 1.26 (1.27) | met |
| No "run behind every time" habit at or above the CPU | **1.39 against 1.36** (+0.03 ±0.06, can't be told apart) | **missed on the point estimate** |
| Timing ≤ 19.5 min | 18.4 (18.4 before) | met |

`exploits 300 normal`: thoughtful 181-62-57, shoot on sight 87-69-144, dribble only 89-79-132, hoof 36-95-169, safest pass 0-138-162, park the bus 40-56-204,
always tackle/press 88-63-149, high line + trap 67-56-177: every one-note script still loses. Engine tests 41 → 46.
`diag.js 1000 996000000`: 2.54 goals/match, first-time chain 49.0% of goals, corner direct 15.4% (8.8% of corners); calibration within 0.9 points everywhere
(through 65.3/65.5, pass 79.6/79.6, shot 14.0/14.0). Action mix: **through 36.1%**, pass 21.1%, lob 17.6%, dribble 16.0%, shoot 9.0%, so phase 6's check
(stop if through is under 30%) says go ahead.

**Why runs do so little (measured, tuning seeds):** the head start only matters when the runner, not the ball, is the slower to the spot: 26% of through
balls open to the runner, and it adds 0.2 percentage points to their success on average (200 matches). The CPU's attack picks a through ball to the runner
1.7 times a match, though one is available 16 times. Bigger or different head starts, 2,000 matches each on 991000000 (touch + CPU runs / touch + run behind;
plain touch 0.91): spec 0.25 s 0.91 / 0.95; 0.25 s against the chaser instead of the runner's time 0.93 / 0.95; 0.5 s against the chaser 0.89 / 0.97; 0.6 s
off the runner's time 0.92 / 0.96; **1 s against the chaser 0.92 / 1.00**. So even an implausible head start gives about +0.09 for the best habit and nothing
for the CPU's own choice: the head start is not the lever. Taking a touch gives the defence a reset (a shape step and a decision that sees the run, so it
can mark the runner or trap him), and that costs more than a run gains.

**Decision (user, 2026-11-26):** keep runs as they are and drop the +0.15 target. The CPU's run rule stays as built (the alternative, always sending the
furthest-forward player in behind, was offered and not taken; never measured as the CPU's rule).

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
- 2026-11-25: phase 1b. Accepted with **no tuning** (the `outcomeValue` offset wasn't needed). Press: `catchPresser` in the `resolveAttack`
  wrapper, distance to the presser's goal, shots included (a rebound the attackers keep past him counts). Loose balls: the planned
  "best arrival per side through a sigmoid" missed by up to 12 points, so `FB.looseKeep` runs the race at eight scatter points with a
  cubic kernel instead; scatter sizes, noise and the beaten delay moved to `TUNE.loose`, shared with the resolver. Also: `outcomeValue`
  had `keep || 0.3`, which would have turned a certain loss into 30%; `FB.active` is now a plain loop (same result, faster).
  Assumed vs actual on 965000000, every row within 2 points: dribble touch 75.6/75.9, lob bad touch 62.2/62.5, lob misplaced 51.5/51.4, pass bad
  touch 71.9/73.1, pass misplaced 65.8/66.7, through bad touch 62.1/62.6, through misplaced 41.4/42.4, clear 55.3/57.3 (n 260). The CPU
  now clears less (0.5 → 0.3 per match) and only with someone upfield, so its clears are kept more than half the time; over
  all positions where clearing is allowed it's about 24%.
  Before → after, same seeds: `sim 300 11` goals/team 1.21 → 1.22, `sim 1000 41` 1.18 → 1.26 (diag blocks 2.40 → 2.52 and 2.52 → 2.51 goals/match, so no
  clear rise). `exploits 300 normal` (W-D-L): shoot on sight 82-76-142 → 80-82-138, dribble only 91-90-119 → 83-95-122, hoof
  45-99-156 → 37-79-184, park the bus 37-50-213 → 36-75-189, always tackle/press 92-74-134 → 78-77-145, high line + trap
  69-65-166 → 82-64-154, safest pass 0-144-156 → 0-155-145, thoughtful 177-57-66 → 162-69-69: every one-note script still loses more than it wins.
  Dribble success shown 66.9 → 68.9 (and as accurate). `timing 40` 18.6 → 18.5 min. Four tests added, 28 passing. Speed: about 16 → 10.5 matches/s
  with the machine quiet (`sim`), which is what phase 3's "half the sim speed" now means. Clear preview shows "Kept X%"; not checked in a browser (phase 8).
- 2026-11-25: phase 2. User was shown the numbers and chose react 0.5 + Redmoor 73. Tables are in DEVLOG ("Cycle 6 (in progress)"). Hold-out: High −
  Normal +0.035 ±0.029 (was +0.189 ±0.029), Deep − Normal −0.101 ±0.028 (unchanged code), every club within ±0.03 of the mean over 12,000
  matches each. Redmoor 74 (no rating change) was also within the target but at its edge (+0.058 ±0.024). Trying Kestrel 78 as well was worse.
  Added `tools/mirror.js` and `tools/pool.js` (worker threads); `balance.js` now takes a seed base, uses all cores and prints intervals (default
  results are identical to the old tool). Only two constants changed in `js/`. Correction: the message to the user said the greedy script improved
  (W162 L69 → W180 L58) "because balls behind Redmoor's line work more often". That cause was never tested and the change is within the error
  (final build W175 L61); the user was told. 28 tests passing. Not checked in a browser (phase 8).
- 2026-11-25: phase 3, see "Phase 3 result" above. `policies.js` runs on all cores now (results match the old tool) and has the cover habits. Checked the new
  UI with a script driving headless Chrome from the scratchpad: desktop, 375×667 portrait and 667×375 landscape, no console errors, the four
  mode buttons fit (the side panel scrolls by 25 px in portrait, 246 against 221). Click, key 4 (desktop) and commit deliver the order; switching between press, tackle and cover in one turn wasn't exercised (phase 8).
  DEVLOG entry waits for phase 8; DESIGN, README, how-to text and CLAUDE.md are current.
- 2026-11-25: the user took the recommendation: Cover stays, the chain-share target is dropped, no change to first-time shots. They asked not to
  start phase 4 yet. Documentation only, no game code changed.
- 2026-11-25: phase 4, see "Phase 4 result" above. The user asked for the next phase. `policies.js` has two new habits ("press + mark, left on", "mark, then press").
  UI: standing mark drawn in purple, Release button / key X, trap and mark notes in the previews, "still marks" in the CPU's plan. Checked with a script driving headless Chrome
  (desktop, 375×667, 667×375): ordering a mark, seeing it stand, releasing it (key and button), hold shape delivering the release, trap, the CPU's mark text; no console errors.
  The row with the extra button first pushed Confirm off a portrait phone, so touch uses short labels while a mark stands (panel height 246 px again, as in phase 3).
  DEVLOG entry waits for phase 8; DESIGN, README, how-to text and CLAUDE.md are current.
- 2026-11-25: the user accepted the mark result (press + a new mark every turn stays worth more than pressing alone). Phase 4 closed; documentation only, no game code changed.
- 2026-11-26: phase 5, see "Phase 5 result" above. The user asked for the next phase. Checked with a script driving headless Chrome (desktop, 375×667,
  667×375): calling a run by key and by button, switching kind, the click on the runner, delivery on Take a touch, the head-start line, the CPU's run in the
  defence panel; no console errors. DESIGN, README, how-to text and CLAUDE.md are current; DEVLOG entry waits for phase 8. Waiting for the user to decide
  on the missed targets before phase 6.
- 2026-11-26: the user kept runs as they are and dropped the +0.15 target. Phase 5 closed; documentation only, no game code changed.
