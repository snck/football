# Devlog: Touchline Tactics

Tools used for judging the game (all in the repo):
`tools/sim.js` (CPU vs CPU stats), `tools/balance.js` (team round-robin),
`tools/exploits.js` (scripted "human" strategies vs the CPU), `tools/timing.js`
(real-time estimate), `tools/lines.js` (line heights, added in cycle 5), `npm test`
(17 engine tests at first, 21 since cycle 5). I also drove the real UI in
headless Chrome with Playwright from a scratch folder. That covered full matches from
kickoff to full time, screenshots of every screen, and a hand-played session where I
read each screenshot and chose each move myself (via a `?seed=` URL for
reproducibility).

---

## Cycle 0: design and first build

- Wrote `DESIGN.md`: an 11-a-side continuous pitch, a sequential "defence sets,
  attack reads" beat, and geometric probabilities (lanes, races, duels, cones).
  Sequential beat over simultaneous orders: shown odds stay honest, and the defence
  becomes a positional puzzle.
- Built the core loop headless first (`core.js`, `engine.js`, `ai.js`) with the
  simulator, before any UI.

## Cycle 1: "it runs, but it isn't football" (sim-driven)

First 20-match sim: **0.38 goals and 1.5 shots per team, 171 beats, 8 of 15 goals
were penalties, dribbling was 40% of all actions, 0 offsides.**

What felt wrong, and the change for each:

| Problem (evidence) | Change |
|---|---|
| CPU dribbled near the box instead of shooting (diagnostic print: dribble EV 0.06 vs shot 0.05) | Rebuilt the CPU value map. Keeping the ball is capped below the shot value at that spot, and keeping it is discounted. |
| Endless sideways play (avg forward Δ of a midfield pass: **−4.4 m**) | The cost of losing the ball was too large compared with the value of gaining ground, so I added a progress bonus. Pushed the in-possession shape up so options exist ahead of the ball. |
| Presser at 1.5 m blocked *every* forward lane | Close-range lane interceptions scale down ("bend it round him"). |
| CPU pressed 80% of beats at no cost | A presser who is bypassed is caught upfield (half speed next beat). Press plans carry a cost in CPU planning. |
| Tackle ping-pong (tackled player instantly tackled back) | A tackled player is down for a beat. |
| Too many penalties | Fewer fouls inside the box (defenders are careful in the box). |
| 0 offsides (CPU could see the line perfectly) | Offside became a tight call within ±1.3 m ("Offside risk 40%"), and a CPU/human **offside-trap** step-up was added. |
| Duplicate player names across clubs; "skips away from !" | Global unique surname pool; separate commentary for a dribble past a player vs a free carry. |
| No valid action in rare spots | Added a **Clear** action, always available. |

After many rounds of tuning I hit a wall: **shots stayed at about 2–3 per team no
matter how weak I made the defence.** The possession analysis explained it. The game
had about 15 possessions per team and 16% of them ended in a shot, which is a
*realistic* per-possession rate. But one action per beat and about 120 beats can't
contain enough possessions. Parameter tuning was the wrong tool.

**Redesign:** added **quick play (first-time actions)**. After a completed pass, the
receiver can act again before the defence resets, at −5% accuracy and with no
dribbling. Or he can take a touch and let it reset. This is real football tempo,
makes "the ball flows" literal, and adds a risk/reward decision to every completed
pass. Result: **1.29 goals and 9.6 shots per team, and 0-0 dropped from 37% to 5%.**
I also made build-up in your own half cost more clock than final-third play, and
rebalanced team ratings.

## Cycle 2: exploits (scripted human strategies vs the CPU)

`tools/exploits.js`, normal difficulty, 24 matches each. First run:

- **Always lunge-tackle/press: W15 D2 L7. The best strategy in the game.** Fix:
  lower tackle win odds, higher foul odds, more yellow cards for lunges. Now W5–7 out
  of 20–24, losing more than winning.
- **Shoot on sight** (28 m+ efforts): matched thoughtful play. 45% of all CPU shots
  were from 28 m+. Fix: steep long-range decay in xG, and the CPU only gets a
  shot-appetite bonus for decent chances. Now W3–5 L11–15.
- **Keep-ball (safest pass only, never shoot): D16 out of 24.** The CPU never won the
  ball back, so it was an unlosable bore. Fix: a CPU **"hunt" mode**. When the
  opponent keeps it for several beats, the block pushes up and goes man to man, and
  press plans gain urgency. Now it loses 7–14 of 20–24 and never wins (it can't score).
- The test harness itself had a bug (scripted first-time plays evaluated outside
  quick mode), which I fixed in `runner.js`.

## Cycle 3: in the browser (headless Chrome, screenshots and a hand-played session)

The Claude-in-Chrome extension wasn't connected, so I drove the real page with
Playwright and headless Chrome. I played full matches through actual keyboard and
mouse events, and read screenshots.

| Found | Fix |
|---|---|
| After a goal the ball snapped back to the corner flag | `syncBall()` after every resolution; the ball rests where it went (net, touchline, keeper's hands). |
| GOAL banner washed out by the white flash | Removed the flash on goals. |
| Grey "—" badges on unreachable team-mates (noise) | Hide invalid badges; offside receivers say `OFFSIDE`. |
| Stale "Choose how to defend…" hint while the CPU attacked | Phase-specific hint. |
| Defence view rang **every** opponent red, which told you nothing | Only the top 3 threats, brightest = most wanted. |
| **First-time screen showed odds without the quick penalty, and through balls were disabled after a kick-off** (found while hand-playing) | Enter quick mode *before* showing options. |
| Penalty credited an assist; spot-kick crowd stood in one rigid line | Fixed both. |
| A goalkeeper red card crashed the next goal kick (found by the sim) | An outfielder goes in goal. |
| A match took **~22 min** (timing model: 7 s per attack decision, 4 s per first-time decision, 4.5 s per defensive decision, plus the measured animation time) | Fewer beats (about 112), shorter animations. **Now ~19 min Normal and ~13.5 min Short** with deliberately generous thinking times. |

Hand-played notes (seed 2024): kicked off, recycled to Kettering, took a touch,
switched to the free right winger (97% badge), then tried a first-time through ball.
It was cut out, and the caption said exactly why: *"Intercepted by Wexley — 0.5 m
from the lane (56%)"*. On defence I pressed with Mbeki-Rowe and marked the top threat
Zabala. My presser intercepted at once. Next beat the CPU sprang its offside trap,
and my two strikers were badged **OFFSIDE**, so I had to go another way. That
sequence is the experience I was aiming for: readable, risky, positional.

## Cycle 4: realism pass on xG and team balance

- **Problem:** "park the bus" (deep line) conceded *more* than other lines, and
  Coldforge (the deep 5-3-2) lost 32 of 60. The old angle-only xG curve, inflated to
  compensate for cycle 1, made 20–25 m shots far too good.
- **Change:** a new xG curve fitted to typical values (0.42 at 11 m, 0.19 at 16 m,
  0.09 at 20 m, 0.035 at 25 m). Headers ×0.27, which brought headers from 31% of
  goals to 21–24%. Less shot-pressure penalty. Coldforge rating +2.
- Then the final xG scale nudge (+17%) made deep blocks even worse: Coldforge fell to
  W13 L31. Its default changed from a deep line to a normal line, keeping the 5-3-2
  counter identity (high risk appetite, fast forwards).
- **Result:** team round-robin is now W18–23 for every club out of 60.

## Mobile release (2026-11-23, between cycles 4 and 5)

The desktop layout was unusable on a phone: the fixed 340 px sidebar left about 50 px
for the pitch in portrait, players were about 5 px across, the tap radius was about
11 px, and a double tap zoomed the page.

- **Layouts:** an upright pitch with controls underneath in portrait, and a compact
  desktop layout in landscape. Turning the phone mid-match switches at once.
- **Readability:** minimum sizes for players, badges, labels, captions and banners.
- **Touch:** fingertip-sized targets, tap-again or Commit to confirm, a new Cancel
  button, and tap wording in hints and help. No double-tap zoom.
- **Audio** resumes after an app switch or a phone lock.
- The engine, AI and teams weren't touched, and the desktop pitch size and scale are
  unchanged.

**Tested:** iPhone 12 Pro and iPhone SE sizes, upright and sideways, in a preview
browser. That browser has a mouse, so touch was faked for the script and the
touch-only CSS was never triggered. **Not tested on a real phone.** On an iPhone SE held
upright, the control panel scrolls a little when defending.

**Publishing:** this version went out as a Claude Artifact. The code then went into git.

## Cycle 5: counter-attacks and a line height that matters

Two weaknesses from the list below: a turnover simply ended the beat, and line height
barely changed anything. A new tool, `tools/lines.js`, forces one team to a line for
whole matches, defending actively (CPU press/tackle/mark choices) or passively (hold
shape), and reports goals, shot locations, through-ball success against, and where
the ball is won.

**Before** (800 matches per line: `node tools/lines.js 400 3` and `400 7` on the version
before this cycle, active defending):

| Line | W-D-L | Points/match | GF | GA | Through balls vs | Corners against | Ball won at |
|---|---|---|---|---|---|---|---|
| Deep | 202-234-364 | 1.05 | 0.84 | 1.24 | 60–61% | 2.5 | 38 m |
| Normal | 251-221-328 | 1.22 | 0.99 | 1.14 | 59–60% | 2.1 | 41 m |
| High | 299-213-288 | 1.39 | 1.08 | 1.05 | 61–62% | 2.1 | 43 m |

Deep was simply worse and High had no cost: through balls beat it about as often as they
beat a deep line.

**Changes:**
- **Counter-attack.** A tackle or interception by an outfield player lets the winner
  play first-time at once (the tackled player stays down). The UI shows
  "⚡ COUNTER-ATTACK" with a Take-a-touch option, and the CPU decides with the same
  rule it uses for first-time play.
- **Line effects in the odds** (`TUNE.line`). Through-ball reaction time, shot
  blocks, lane interceptions by third, and aerial duels in the box all depend on the
  defending team's line. The preview panel names the effect whenever it changes the
  shown odds.
- **Deep needed more than I expected.** The first version cut neither goals nor xG
  against a deep line, because the expected-value attacker just switched channels.
  When headers got harder it crossed less and shot or passed more. A goal breakdown
  showed deep lines inviting 40% more crosses (4.5 vs 3.3 per match). Only a combined
  boost worked: blocks ×1.6, box-area lanes ×1.6, a 0.4 s head start on through
  balls, and +0.25 s in aerial duels.
- **Counters with dribbling were exploitable.** At first a counter allowed a
  dribble. Over 60 matches the "dribble only" script went from W17 D15 L28 (counters
  off) to W25 D21 L14. Counters now follow first-time rules (no dribbling).
- **Team ratings re-balanced.** Counters favoured the pressing club (Redmoor) and the
  counter club (Coldforge): over 240 matches per club, points per match spread from
  1.16 to 1.64. New ratings: Harbour 76→78, Redmoor 74 (unchanged), Kestrel 76→77,
  Coldforge 78→77.

**After** (same seeds and match counts):

| Line | W-D-L | Points/match | GF | GA | Through balls vs | Corners against | Ball won at |
|---|---|---|---|---|---|---|---|
| Deep | 271-203-326 | 1.27 | 0.98 | 1.04 | 54–55% | 2.8 | 38 m |
| Normal | 281-188-331 | 1.29 | 1.12 | 1.21 | 61–62% | 2.4 | 40 m |
| High | 319-198-283 | 1.44 | 1.48 | 1.36 | 67% | 2.4 | 42 m |

- **Deep is fixed.** It's now level with Normal, with fewer goals at both ends.
- **High now has a cost** (goals against 1.05 → 1.36) but scores more too, so **it's
  still the strongest line**. Its lead over Normal is 0.16 points per match, about the
  same as before (error about ±0.07).
- Passive "hold shape" is still poor on every line (GA 1.9–2.2). Active defending is the
  main lever.

**Other effects:**
- Goals per team rose from 1.10 to 1.21 and shots from 7.2 to 8.3 (sim 300, seed 11).
  There are about 15 counters per match (both sides), about 4 more are declined, and the
  counter move itself scores about 0.1 goals per match.
- Match length is about 18.6 min (Normal) and 13.7 min (Short), up from 18 and 13.5.
- **Normal is not harder.** Over 300 matches the greedy "thoughtful" script went from
  W159 D81 L60 to W178 D57 L65: fewer draws and slightly more points.
- On Normal, every scripted shortcut still loses more than it wins (300 matches each,
  below).
- **Clubs: Redmoor is too strong.** Points per match over 1,410 matches per club (sim 300
  seed 11, sim 600 seeds 21–23, `balance.js 60`), error about ±0.04:

  | Club | Before (600 matches, sim seeds 11 and 21) | After |
  |---|---|---|
  | Redmoor | 1.44 | **1.55** |
  | Kestrel | 1.38 | 1.33 |
  | Harbour | 1.25 | 1.32 |
  | Coldforge | 1.34 | 1.31 |

  Redmoor was already the best club, and the new ratings didn't fix it. Its default high
  line is a likely reason, since High is the strongest line, but that's untested.

**Corrections (2026-11-25).** The first write-up of this cycle had these wrong:
- It said all three lines had similar records and that the CPU did better than any fixed
  line. High beats the CPU.
- It compared before and after on different seeds and match counts (120 and 400).
- It said Normal got harder because CPU counters punish intercepted passes. That came
  from one 60-match run (L8 → L16) and the cause was never tested.
- It said clubs were even to within ±0.1 points per match. The ratings had been tuned on
  small samples, and the sim run that showed Redmoor ahead was played down.
- **Lesson:** use at least 300 matches per cell, and check on seeds that weren't used for
  tuning.

## Release (2026-11-24)

Pushed to https://github.com/snck/football and published with GitHub Pages at
https://snck.github.io/football/ (from `main`, root folder). Checked the live page in a
browser: all files load and a match starts with no errors. The Claude Artifact still has
the mobile version without counters and line effects.

---

## Cycle 6 (in progress): High line and Redmoor re-tuned (2026-11-25)

The rest of the cycle is logged in `PLAN.md` until it's finished. This part closes two known weaknesses from cycle 5.

**High line.** `TUNE.line.high.react` (how much later defenders turn to chase a ball in behind) went from 0.35 to
**0.5 s**. Points of High minus points of Normal per match, same club on both sides:

| react | Tuning, `mirror.js 16000 720000000 high normal` | Hold-out, `mirror.js 32000 800000000 high normal` |
|---|---|---|
| 0.35 (before) | +0.172 ±0.041 | +0.189 ±0.029 |
| 0.45 | +0.080 ±0.041 | not run |
| **0.5** | +0.055 ±0.041 | **+0.035 ±0.029** |
| 0.55 | −0.037 ±0.041 | −0.028 ±0.029 |

Deep v Normal was left alone: −0.101 ±0.028 (`mirror.js 32000 800000000 deep normal`). `midThird`, tried first on
the cycle 5 engine, couldn't close the gap by itself.

**Redmoor.** More than half of its lead went with the line change, and its rating went from 74 to **73**. Points per match
against the four-club mean:

| | Before, `balance.js 1000 730000000` (±0.034) | 0.5, rating 74, `balance.js 2000 820000000` (±0.024) | **0.5, rating 73**, same hold-out (±0.024) |
|---|---|---|---|
| Harbour | −0.031 | −0.002 | +0.028 |
| Redmoor | +0.135 | +0.058 | −0.028 |
| Kestrel | −0.065 | −0.020 | −0.003 |
| Coldforge | −0.039 | −0.036 | +0.002 |

Also tried: Kestrel 77→78 on top (Kestrel +0.109, worse). Cycle 5 recorded 1.55 points for Redmoor; that wasn't reproduced (1.475 on
12,000 matches of the cycle 5 engine, 1.512 just before this change).

**Whole-game effect** (before → after, same seeds): `sim 300 11` goals/team 1.22 → 1.27; `sim 1000 43` after only, 1.23. No row of
`exploits.js 300 normal` moved beyond its error, and every one-note script still loses more than it wins ("high line + trap" W82 D64
L154 → W68 D57 L175). `policies.js 1000 965000000`: "press + mark, high line" 1.24 → 1.22, CPU brain 1.38 → 1.33, greedy 1.84 → 1.85 (each ±0.08);
no row changed beyond its error (±0.11) except "press + trap", 1.26 → 1.37, right at it and equal to the CPU brain, which phase 4 of
the plan is meant to price. Match length 18.5 → 18.4 min.

## Current numbers (after cycle 5)

`node tools/sim.js 300 11`, CPU vs CPU, Normal length:

```
beats/match 105.0 (min 92, max 117)
goals/team 1.21  shots 8.3  onTarget 4.0  xG 1.19  conv 14.5%
passes 57.5  pass% 68.1  corners 2.1  fouls 2.7  yellows 0.90  reds/match 0.173  offsides 0.63
possession range 30–70%
goals per team: 0:172 1:209 2:159 3:46 4:11 5:3
top scores 1-1 0-1 2-0 0-2 2-1 1-0 1-2 2-2 0-0 3-1
goal types: shot 540, header 162, penalty 14, free kick 8
```

`node tools/balance.js 60` (360 matches per club): Harbour W123 D93 L144 ·
Redmoor W172 D80 L108 · Kestrel W123 D102 L135 · Coldforge W124 D81 L155.

`node tools/exploits.js 300 normal` (scripted human vs CPU):

```
thoughtful (greedy EV)       W178 D 57 L 65
careless (50% random)        W 11 D 40 L249
random everything            W  0 D 15 L285
shoot on sight               W 82 D 75 L143
dribble only                 W 94 D 85 L121
hoof it (clear/lob)          W 46 D 99 L155
safest pass only             W  0 D145 L155
park the bus (deep, hold)    W 38 D 49 L213
always tackle/press          W 90 D 78 L132
high line + trap always      W 69 D 65 L166
```

Difficulty ladder (thoughtful policy): Easy W47 D8 L5 and Hard W26 D12 L22 (60 each),
Normal as above.

`node tools/timing.js 40`: Normal 105 beats, 49 attacking + 49 first-time + 45 defensive
decisions, **18.6 min**. `node tools/timing.js 40 short`: 78 beats, **13.7 min**.

`npm test`: 21 passing.

## Final numbers (evidence, before cycle 5)

`node tools/sim.js 300 11`, CPU vs CPU, Normal length (final build):

```
beats/match 111.6 (min 101, max 127)
goals/team 1.10  shots 7.2  onTarget 3.6  xG 1.10  conv 15.2%
passes 51.6  pass% 66.9  corners 1.9  fouls 2.7  yellows 0.80  reds/match 0.130  offsides 0.71
possession range 34–66%
goals per team: 0:188 1:238 2:118 3:40 4:14 5:2
top scores 1-1 1-0 0-0 0-1 2-1 1-2 0-2 2-0 3-0 0-3
goal types: shot 496, header 138, penalty 18, free kick 8
```

`node tools/balance.js 10` (60 matches per club, final build): Harbour W18 D22 L20 ·
Redmoor W21 D20 L19 · Kestrel W23 D15 L22 · Coldforge W21 D17 L22.

`node tools/exploits.js 20 normal` (scripted human vs CPU, final build):

```
thoughtful (greedy EV)       W 14 D  4 L  2
careless (50% random)        W  0 D  3 L 17
random everything            W  0 D  1 L 19
shoot on sight               W  2 D  7 L 11
dribble only                 W  9 D  3 L  8   (60-match recheck: W18 D20 L22; not dominant)
hoof it (clear/lob)          W  3 D  5 L 12
safest pass only             W  0 D 10 L 10
park the bus (deep, hold)    W  1 D  4 L 15
always tackle/press          W  4 D  4 L 12
high line + trap always      W  4 D  1 L 15
```

Difficulty ladder (thoughtful policy): Easy W13 D3 L0 out of 16 · Normal ≈ W15 D4 L1
out of 20 · Hard W5 D5 L6 out of 16.

`node tools/timing.js`: Normal ≈ 112 beats, ≈ 54 attacking + 33 first-time + 48
defensive decisions, **≈ 18 min**. Short ≈ 82 beats, **≈ 13.5 min**.

`npm test`: 17 passing. Headless UI runs: several complete matches kickoff → final
whistle with 0 page errors, plus forced penalties for and against.

## Definition of done: self-assessment

Written after cycle 4; the numbers in it are from the section above. See "Current
numbers" for the present build.

- [x] **Full match with no bugs or dead ends.** Several full matches were played
  through the real UI (keyboard and mouse events) with zero page errors. That covered
  half-time, full time, goals with replay, and penalties both ways. A sim of 300+
  matches and an engine test assert every match reaches full time. Every phase has a
  button and a key, and Esc always opens a menu (restart / quit).
- [x] **Nothing depends on reaction speed.** No input is ever timed. Every decision
  waits on a promise until you commit. Animations only play *after* a commitment, and
  the pause menu works at any time.
- [x] **10–20 minutes.** Modelled at ~18 min (Normal) and ~13.5 min (Short) with
  generous thinking time, and less if you play briskly. This is a model, not a
  stopwatch of a real person. See the weaknesses below.
- [x] **Fair, varied CPU.** Careless or random play loses heavily (0–17 and 0–19).
  Thoughtful play wins on Normal, and Hard is roughly even for the thoughtful policy.
  The CPU builds with expected-value choices, presses and marks via look-ahead, hunts
  the ball against keep-ball, protects leads late, and chases games when behind.
  Softmax choices plus 4 team styles give variety.
- [x] **Stats look like football.** Scores 0–5 with 1-1 and 1-0 the most common,
  1.10 goals per side, 7.2 shots and 3.6 on target, possession 34–66%, a realistic
  shot-distance spread, headers 21% of goals, penalties about 0.06 per match.
- [x] **Every pillar is present.**
  - Space: every probability is geometric.
  - Flow: animated passes and arcs, runners, first-time chains.
  - Risk/reward: % on everything, safe 95% vs 30% through balls.
  - Both phases: press, tackle, mark, trap and line height, each with previews.
  - Atmosphere: clock, stoppage board, commentary, synthesised crowd, GOAL banner,
    replay, momentum.
  - Readability: badges, threat rings, the offside line, "why" captions.
- [x] **Learnable in a couple of minutes.** A how-to overlay on the first match, a
  context hint bar on every phase, number keys shown on every button, and tooltips in
  the preview panel.
- [x] **Would I play a second match?** Yes. Hand-playing, the moments that worked
  were spotting a free winger, gambling on a first-time ball, and getting caught by
  the trap. Four distinct opponents, three difficulties and a rematch button help.

## Known weaknesses

**Open, worth fixing:**

- **Easy rewards shortcuts.** Over 60 matches on Easy, five one-note scripts win clearly:
  high line + trap (W42 L8), dribble only (W40 L3), always tackle (W35 L10), park the bus
  (W28 L13) and shoot on sight (W25 L8).
- **Never played on a real phone.** Touch was only simulated (see the mobile release).

**Accepted:**

- **The match-length figure is a model.** I couldn't watch a real first-time player.
  A very deliberate player could run past 20 minutes on Normal. Short exists for that.
- **Compressed stats.** About 105 beats can't hold real football's event count. Shots
  (≈8) and fouls (≈3) and corners (≈2) per side are below real-world levels. Pass
  accuracy (≈68%) is low because ambitious through balls count as passes. I tuned for
  scorelines and shot quality, the things a player actually notices.
- *(Mostly fixed in cycle 5; kept for the record.)* **Defensive line height matters less than press, tackle and mark decisions.** Deep,
  normal and high lines concede similar amounts when you defend passively. The real
  lever is your active choices, which is the right emphasis but means "park the bus"
  is a weak plan rather than a viable one.
- **Dribble-heavy play is a legitimate style** vs the CPU, though on Normal it now loses
  a little more than it wins (W94 D85 L121). It's safer than its looks suggest because
  the CPU rarely commits lunges at a runner. Not dominant on Normal, so I left it.
- **No substitutions, fatigue or injuries.** These were cut by design (see DESIGN.md)
  to keep every beat about the ball.
- **Automated browser testing only.** All visual checks were done through headless Chrome
  screenshots or a preview browser. Audio (WebAudio synthesis) couldn't be heard in testing. It is
  best-effort and fails silently.
