# Devlog: Touchline Tactics

Tools used for judging the game (all in the repo):
`tools/sim.js` (CPU vs CPU stats), `tools/balance.js` (team round-robin),
`tools/exploits.js` (scripted "human" strategies vs the CPU), `tools/timing.js`
(real-time estimate), `npm test` (17 engine tests). I also drove the real UI in
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

---

## Final numbers (evidence)

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

## Known weaknesses I chose not to fix

- **The match-length figure is a model.** I couldn't watch a real first-time player.
  A very deliberate player could run past 20 minutes on Normal. Short exists for that.
- **Compressed stats.** About 112 beats can't hold real football's event count. Shots
  (≈7) and fouls (≈3) and corners (≈2) per side are below real-world levels. Pass
  accuracy (≈67%) is low because ambitious through balls count as passes. I tuned for
  scorelines and shot quality, the things a player actually notices.
- **Defensive line height matters less than press, tackle and mark decisions.** Deep,
  normal and high lines concede similar amounts when you defend passively. The real
  lever is your active choices, which is the right emphasis but means "park the bus"
  is a weak plan rather than a viable one.
- **Dribble-heavy play is a legitimate, roughly break-even style** vs the CPU. It's a
  little safer than its looks suggest because the CPU rarely commits lunges at a
  runner. Not dominant, so I left it.
- **No substitutions, fatigue or injuries.** These were cut by design (see DESIGN.md)
  to keep every beat about the ball.
- **Headless testing only.** All visual checks were done through headless Chrome
  screenshots. Audio (WebAudio synthesis) couldn't be heard in testing. It is
  best-effort and fails silently.
