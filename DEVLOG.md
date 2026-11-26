# Devlog: Touchline Tactics

Tools used for judging the game (all in the repo):
`tools/sim.js` (CPU vs CPU stats), `tools/balance.js` (team round-robin),
`tools/exploits.js` (scripted "human" strategies vs the CPU), `tools/timing.js`
(real-time estimate), `tools/lines.js` (line heights, added in cycle 5), `npm test`
(17 engine tests at first, 21 after cycle 5, 58 after cycle 6). Cycle 6 added `tools/diag.js`, `tools/policies.js` and `tools/mirror.js`. I also drove the real UI in
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

## Cycle 6: mechanics (2026-11-25 to 2026-11-26)

A planned pass over the mechanics, done in eight phases, one commit (or a few) each, on branch `mechanics-6`. Every phase
was tuned on one block of seeds and judged on another, with 95% intervals, and compared with the build before it on
the same seeds. The user decided every missed target; those decisions are recorded below.

**New tools.** `tools/diag.js` breaks matches down by mechanic: goals by origin, action mix by zone, the odds shown
against what happened, loose balls, press outcomes, the CPU's plans, corners and how halves end. `tools/policies.js`
plays fixed habits (always press, pass first, take a touch every time…) against the CPU on Normal. `tools/mirror.js` puts one
line against another with the same club on both sides. `tools/pool.js` runs these, and `balance.js`, on every core
(about 70 matches a second on 12 cores).

**What the analysis found** (`diag.js 300 910000000` and `policies.js 1000 950000000` on the cycle 5 build, `bb584d9`):
- 48.6% of goals came in first-time chains, where the defence has no decision to make.
- Corners: 8.3% were scored directly (real football: about 3%), 16.5% of all goals.
- Through balls were 35.7% of all actions and 43.3% in midfield. Not an exploit, though: "through ball first" scored 0.29 points
  a match below a greedy attacker.
- A fixed defence (press + mark + trap every turn) did about as well as the CPU's look-ahead (1.27 against 1.34, ±0.08). A mark
  or a trap cost almost nothing, so there was no reason not to add both.
- `evaluate` guessed loose balls with constants (20–40% kept) where the race really gave 12–74%, so the CPU misjudged risk.
- Every presser was slowed next beat, even one who won the ball. The rule was meant for a presser who is bypassed.
- Text that didn't match the model: the clear said "50/50", the shot preview said −30% for pressure where the model used 22%,
  and the penalty help said the keeper "saves about 2 in 3" (really about 57%, and takers scored about 80%).
- The CPU's penalties were exploitable: its keeper dived centre 8% of the time, so shooting centre scored 86.8% against 62.2%
  for a corner.

### Phase 1: fixes

- **Penalties** (1a). The CPU's mixes are now at equilibrium (`FB.AI.PEN_SHOT`, `PEN_DIVE`): keeper left/right/centre
  0.345/0.345/0.31, taker 0.368/0.368/0.264. Whatever either side does, a goal is about 69% likely. A test checks that the human's
  best and worst choice differ by less than 0.02, as taker and as keeper. The panel prints the four real chances from
  `FB.penaltyGoal`, which `resolvePenalty` also rolls.
- **Honest text** (1a). The shot preview's pressure factor moved to `TUNE.shotPressure` (0.22) and is used in both places. The clear preview
  shows the real chance of keeping it.
- **Press** (1b). Only a bypassed presser is slowed (the attackers keep the ball and the new carrier is nearer the presser's goal
  than he is). A press that wins the ball or forces it back costs nothing.
- **Loose balls** (1b). `FB.looseKeep` runs the same race as the resolver at eight spots the ball may roll to, with a cubic kernel. The
  planned version, "best arrival per side through a sigmoid", missed by up to 12 points. The constants (scatter, noise, the beaten
  player's delay) moved to `TUNE.loose` and are shared with the resolver. Assumed against actual, every case within 2 points (it was up to 41).
  `outcomeValue` had `keep || 0.3`, which turned a certain loss into a 30% chance. Fixed.
- **Dribble skill** (1b) now lowers the heavy-touch risk by 2 points for every 10 points of dribbling.

No tuning was needed: `sim 300 11` goals/team 1.21 → 1.22, and every one-note script in `exploits.js` still loses more than it wins.
The CPU clears less (0.5 → 0.3 a match), and only with someone upfield.

### Phase 2: High line and Redmoor re-tuned

This phase closed two known weaknesses from cycle 5.

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

### Phase 3: Cover

**Why:** half the goals came in first-time chains, where the defence has no say. **Rule:** a new order, Cover. One player
within 14 m stands off the carrier, 3.5 m goal-side (a press gets to 1.5 m). After the next completed ball that could be
played first-time, he slides up to 4 m towards the receiver, before the first-time decision is made, so the odds shown already
include it. He jockeys dribblers (0.7 m more reach, half the fouls) and is never caught upfield. It can't be combined with
a press or a tackle. The slide is done in the `resolveAttack` wrapper, so no beat loop changed.

**Target missed: first-time chains at 35–44% of goals.** Hold-out (4,000 matches, 976000000): **50.9 ±1.0%** with cover, 50.1 ±1.0%
without. 75% of chain goals are a through ball and then a first-time shot, and the receiver is a median 22 m from the covering
player (18 m after the slide). Slides of 4, 7 or 10 m can't be told apart, and even a cover man who teleports to the receiver left
44.8 ±2.0%. No one-defender slide can reach the target. **Decision (user):** keep Cover and drop the target.

**The CPU's look-ahead for the slide made it weaker** (−0.11 ±0.07 points a mirror match). It was replaced by a fixed price,
`FB.AI.PLAN.cover` = 0.002: the CPU covers in 20% of plans, at no measurable cost (+0.046 ±0.046 against the same CPU without cover,
12,000 hold-out matches). Cover habits came out at least 0.25 points below the CPU. Goals/team 1.265 → 1.236 (±0.022).

### Phase 4: lasting marks, a trap with a cost

- **A mark lasts** two more beats (`m.markOrders`). The marker follows his man after the man moves (moving with the other defenders,
  he was tight 14% of the time; this way, 47%). He leaves his zone, and **he doesn't cut out balls meant for anyone else**. Without
  that addition, press + mark was +0.10 to +0.14 over pressing alone. The side can release the mark (key `X`).
- **Trap:** a defender who stepped up needs 0.4 s longer to chase a through ball (0.25 s left the habit +0.05 ahead), and is caught
  upfield if a through ball or lob is completed beyond him.

Hold-out (4,000 matches a row, 985000000, ±0.04): press + trap − press **+0.09 → +0.01** (met). Press + mark − press stayed
**+0.10 ±0.06** here, about +0.06 ±0.03 pooled with tuning (missed: unchanged from before). Press + mark + trap went from 0.07 below the CPU to 0.20
below; every fixed defence was at least 0.16 below. Offsides/team 0.56. The edge of re-marking comes from the extra repositioning; none
of four changes tried removed it beyond the error. **Decision (user):** accept marks as they are.

### Phase 5: teammate runs

**Why:** taking a touch was weak and had no purpose. **Rule:** when you take a touch you may call one run (in behind, overlap,
come short). It's made in the next beat's shape step, before the defence decides, so the defence sees it and the odds stay honest.
A through ball to a player who has just run in behind gets a 0.25 s head start in that beat's first action. The CPU calls runs
by a fixed rule (`AI.chooseRun`), about 22 a match.

**Target missed:** touch + the CPU's runs scored +0.02 ±0.06 over a plain touch (target +0.15). The head start only matters when the
runner, not the ball, is the slower to the spot (26% of such through balls). Even a 1 s head start gave only +0.09 for the best
habit. Taking a touch gives the defence a reset (a shape step and a decision that sees the run), and that costs more than a run
gains. "Run behind every time" came out at 1.39 against the CPU's 1.36 (±0.06, can't be told apart). **Decision (user):** keep runs
and drop the target.

### Phase 6: through balls

Through balls were 36% of all actions. **Rules:** an outfield defender already goal-side of the target and facing the play reacts in
0.45 s instead of 0.8 s (`TUNE.faceReact`); his line's head start is added to either. And a short pass to feet (15 m or less, receiver
under 0.25 pressure) makes the next first-time ball cost 3% instead of 5% (`TUNE.softPass`).

Hold-out (1011000000 and 1010000000): through balls 36.2% → **32.4%** of actions (39.7% in midfield), pass 21.3 → 23.3%, lob 17.5 → 18.6%;
every "… first" habit at least 0.11 below greedy; goals/match 2.51 → 2.40. The soft pass changes nothing measurable in CPU play (it
looks one action ahead); it's a small reward a human can see.

**Deep line got weaker.** The first build let a facing defender ignore his line's head start, which moved High to +0.139 and Deep to
−0.158 against Normal. The final rule adds it, as the spec said. On fresh seeds (16,000 mirror matches, 1015000000): High − Normal
+0.067 → +0.074, Deep − Normal **−0.054 → −0.120 ±0.039**. Not diagnosed. **Decision (user):** accept Deep as it is. The README now
says Deep is weaker.

### Phase 7: shot kinds, corners, last attack, club identity, half-time shape

1. **Shot kinds** (`TUNE.shot`): placed (the old shot, identical numbers), driven (pays from range; more blocks, fewer on target,
   fewer saves held) and a chip (only when the keeper is more than 4 m off his line). By goal chance, placed is best inside 12 m and
   in most of 12–18 m, driven beyond 24 m, chip in 7% of shots.
2. **Corners** (`TUNE.corner`): a short option 11 m from the flag; a header from the delivery scores 0.6 of the same header in open
   play; defending is a setting each side keeps (man, zonal, two up), so no new prompt. **Corners scored directly 8.7% → 3.9%**
   (target 4–5%), and corner goals went from 15.9% to 7.2% of all goals.
3. **Last attack:** when time is up and a team is in the final third, or has a corner or a free kick near the box, play goes on
   until the ball is lost, out or scored, for at most 3 beats. Halves ending with the ball in the attacking third: 17.0% → 0.6%.
4. **Identity:** `style.cross` was dead data; it now biases the CPU towards crosses. Each club defends corners its own way, and has three
   players with a trait (strong in the air, long passer, dribbler) that changes `evaluate`. The previews name them.
5. **Half-time:** each side may change shape once. The CPU goes to 4-3-3 when behind.

Hold-out against the phase 6 build (same seeds): goals/team 1.212 → **1.284** (12,000 matches); open-play direct goals rose (0.71 →
0.91 a match: driven shots and the last attack), corner goals fell. "always tackle/press" went from 80-67-153 to **113-59-128**: it still
loses, but it's much closer. Zonal is a little worse than man (−0.066 ±0.057), and 4-3-3 at half-time measured +0.106 ±0.081 over keeping
the shape (rechecked in phase 8, below). **Decision (user):** keep everything as built.

### Phase 8: the whole cycle, measured

**Before and after the cycle, same seeds** (the cycle 5 build `bb584d9` against the final build; the "before" numbers were
measured in phase 0):

| `policies.js 1000 950000000` (±0.08; a difference ±0.11) | Before | After |
|---|---|---|
| CPU brain | 1.34 | 1.41 |
| hold shape always | 0.67 | 0.65 |
| press nearest | 1.08 | 1.09 |
| mark top threat | 0.76 | 0.80 |
| press + mark | 1.23 | 1.16 |
| press + trap | 1.21 | 1.23 |
| press + mark + trap | **1.27** | **1.17** |
| press + mark, high line | 1.16 | 1.20 |
| greedy attack | 1.89 | 1.83 |
| through ball / pass / lob / dribble first | 1.60 / 1.83 / 1.23 / 1.67 | 1.46 / 1.79 / 1.14 / 1.57 |
| always take a touch | 0.94 | 1.01 |

| `diag.js 300 910000000` | Before | After |
|---|---|---|
| goals/match | 2.34 | 2.61 |
| goals in first-time chains / open play direct / corners direct | 48.6 / 27.5 / 16.5% | 53.4 / 32.4 / 7.9% |
| corners scored directly | 8.3% | 4.6% |
| through balls, share of actions | 35.7% | 32.1% |
| loose balls, worst gap between `evaluate` and the result | 41 points | 3.0 points |
| halves ending with the ball in the attacking third | 17.2% | 0.3% |

`lines.js 300 31`, active defending, W-D-L (GF/GA): deep 96-82-122 (1.00/1.13) → 108-71-121 (1.12/1.18), normal 122-68-110 (1.22/1.16) →
90-79-131 (1.26/1.43), high 106-77-117 (1.31/1.40) → 104-84-112 (1.40/1.45). Each cell is ±0.15 points, so the lines can't be ranked from it;
`mirror.js` (below) does that.

What changed for the player: the CPU's defence now beats every fixed defensive habit by at least 0.14 points on both seed blocks
measured (here 0.18; it was 0.07). Corners are
realistic. The game is a little higher-scoring (goals/team about 1.22 → 1.29 over large samples, mostly from phase 7). Chains still
produce about half of all goals: the target set for Cover was dropped.

**Hold-out on fresh seeds** (all from 1035000000 up, none used before):
- `policies.js 1000 1035000000`: CPU brain 1.41; greedy 1.84; every fixed defence at least 0.14 below the CPU (press + mark 1.27 is the
  closest, press + mark + trap 1.15, hold 0.64); through / pass / lob / dribble first 1.33 / 1.80 / 1.25 / 1.64; always take a touch 1.02, with the
  CPU's runs 0.93, with a run in behind 0.91. Run behind / come short / overlap every time 1.38 / 1.35 / 1.38: below the CPU (in phase 7 two of them
  sat above it, inside the error).
- `diag.js 1000 1036000000`: 2.61 goals/match; chains 50.7%, open play direct 34.5%, corners direct 7.0% (3.8% of corners); shown vs actual within 0.7
  points for every action (through 63.6/63.7, pass 79.4/79.7, placed shot 22.5/22.4, driven 7.2/7.1, chip 38.1/37.9, header 51.9/52.6); loose balls
  within 2.5 points. CPU plans: tackle 17.3%, trap 17.1, press 15.0, mark + press 14.2, mark 14.0, cover 9.3, cover + mark 7.9, hold 2.5.
- `balance.js 1000 1037000000` (12,000 matches, ±0.033): Harbour +0.016, Redmoor +0.017, Kestrel −0.027, Coldforge −0.006 against the mean;
  goals/team 1.291.
- **Lines**, `mirror.js 16000 1038000000 high normal` and `… 1039000000 deep normal` (±0.04): **High − Normal +0.117**, Deep − Normal **−0.134**.
  On the phase 6 build, same seeds: High +0.061, Deep −0.106 (a change within the error for Deep). So phase 7 probably widened High's lead (by about 0.05, at the edge of the
  error); the phase 2 target was ±0.05. Not diagnosed or tuned (see Known weaknesses).
- **Half-time shape** (a scratch mirror tool: same club both sides, one side changes at half-time, the other never does; 8,000 matches,
  ±0.057): 4-3-3 **+0.037** (1040000000), the CPU's rule −0.019 (1041000000). Phase 7's +0.106 from tuning seeds isn't reproduced: switching
  to 4-3-3 is not a dominant choice.
- `sim.js 1000 47`: 1.30 goals/team; `sim.js 300 11`: 1.35 (1.21 after cycle 5).
- `exploits.js 300 normal` is identical to the phase 7 build (fixed seeds, no engine change since); every one-note script loses more than
  it wins. "always tackle/press" (113-59-128) and "dribble only" (99-91-110) are the closest.
- `timing.js 40`: Normal 18.8 min, Short 13.9.

**Browser playthrough.** A script drove headless Chrome over the DevTools protocol and played one full match at each size: desktop
1366×768, a phone upright at 375×667 and sideways at 667×375 (touch emulated). Every decision went through real keys, canvas clicks and
buttons: 136–138 per match, none of them needed a fallback. It covered press, cover, tackle, mark, release, trap, a line change, all three shot kinds, runs,
taking a touch, goals with a replay, a penalty, the pause menu (corner defence set to zonal), a change of shape at half-time, the last attack and
full time. No console messages, no sideways scroll. The only message on the first run was a 404 for `favicon.ico`, so the page now has an
inline icon. Replaying the desktop match on the same `?seed=` gave the identical match. Two things to know on an upright phone: the half-time
shape choice and its button are below the stats (the report scrolls), and the side panel scrolls by up to 31 px while defending.

## Current numbers (after cycle 6)

`node tools/sim.js 300 11`, CPU vs CPU, Normal length:

```
beats/match 106.4 (min 94, max 123)
goals/team 1.35  shots 9.0  onTarget 4.0  xG 1.29  conv 15.0%
passes 56.4  pass% 68.4  corners 2.4  fouls 2.7  yellows 0.94  reds/match 0.167  offsides 0.68
tackles 4.0  interceptions 5.7  poss range 34–66%
goals per team dist {"0":135,"1":213,"2":177,"3":59,"4":15,"5":1}
top scores 1-1:36 1-2:32 1-0:32 2-1:30 2-2:26 0-2:24 2-0:18 0-1:18 1-3:14 2-3:11
goal types {"header":132,"shot":574,"chip":79,"free kick":5,"penalty":19}
```

`node tools/sim.js 1000 47`: goals/team 1.30, shots 9.0, on target 4.0, xG 1.31, corners 2.4, offsides 0.68, possession 30–70%; most
common scores 1-1, 0-1, 2-1, 1-2, 1-0.

`node tools/balance.js 1000 1037000000` (12,000 matches, 6,000 per club, ±0.033):

```
Harbour City       W2264 D1558 L2178  pts 1.392 (+0.016 v mean)  GF/m 1.27 GA/m 1.26
Redmoor Athletic   W2326 D1378 L2296  pts 1.393 (+0.017 v mean)  GF/m 1.38 GA/m 1.36
Kestrel Vale       W2185 D1532 L2283  pts 1.348 (-0.027 v mean)  GF/m 1.24 GA/m 1.28
Coldforge United   W2232 D1518 L2250  pts 1.369 (-0.006 v mean)  GF/m 1.27 GA/m 1.26
```

`node tools/exploits.js 300 normal` (scripted human vs CPU):

```
thoughtful (greedy EV)       W162 D 68 L 70
careless (50% random)        W 11 D 46 L243
random everything            W  0 D 18 L282
shoot on sight               W 73 D 77 L150
dribble only                 W 99 D 91 L110
hoof it (clear/lob)          W 34 D 96 L170
safest pass only             W  0 D156 L144
park the bus (deep, hold)    W 49 D 55 L196
always tackle/press          W113 D 59 L128
high line + trap always      W 55 D 58 L187
```

Easy (`exploits.js 60 easy`): thoughtful W52 D6 L2, and every one-note script except safest pass wins: shoot on sight W43 D10 L7, high line + trap
W38 D13 L9, dribble only W35 D14 L11, always tackle/press W33 D19 L8, park the bus W30 D16 L14, hoof W18 D31 L11. Hard (`exploits.js 60 hard`):
thoughtful W22 D14 L24, and every one-note script loses heavily (the best, dribble only, W14 D16 L30).

Lines, mirror matches (`mirror.js 16000`, same club both sides, ±0.04): High − Normal +0.117 (1038000000), Deep − Normal −0.134 (1039000000).

`node tools/policies.js 1000 1035000000`: see cycle 6, phase 8.

`node tools/timing.js 40`: Normal 107 beats, 50 attacking + 47 first-time + 46 defensive decisions, **18.8 min**. `timing.js 40 short`: 78 beats,
**13.9 min**.

`npm test`: 58 passing.

## Numbers after cycle 5 (superseded)

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

- **Easy rewards shortcuts.** Over 60 matches on Easy (after cycle 6), six one-note scripts win clearly:
  shoot on sight (W43 L7), high line + trap (W38 L9), dribble only (W35 L11), always tackle/press (W33 L8),
  park the bus (W30 L14) and hoof it (W18 L11). Not worked on in cycle 6.
- **High is ahead of Normal again** (+0.117 ±0.041 points per mirror match after cycle 6, against +0.061 on the phase 6
  build on the same seeds; the phase 2 target was ±0.05). Deep is 0.13 behind Normal, which the user accepted in phase 6.
  The README and DESIGN state the measured numbers.
- **Never played on a real phone.** Touch was only simulated (see the mobile release).
- **On an upright phone some controls need a scroll:** the shape choice and Start button on the half-time report, the
  shot-kind buttons at the bottom of the preview, and the side panel (up to 31 px) while defending.

**Accepted in cycle 6 (the user's decisions, with the numbers in the cycle 6 entry):**

- **First-time chains still produce about half the goals** (50.7%). Cover can't reach the receiver in time.
- **Re-marking the top threat every turn** is still worth a little more than pressing alone (about +0.06), though every
  fixed defence is at least 0.14 points below the CPU.
- **Runs barely change results**: taking a touch gives the defence a reset that costs more than a run gains.
- **"always tackle/press" is close on Normal** (W113 D59 L128) since phase 7; it still loses more than it wins.
- **Zonal corner defence is a little weaker than man** (−0.07 ±0.06 points a mirror match).

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
  a little more than it wins (W99 D91 L110 after cycle 6). It's safer than its looks suggest because
  the CPU rarely commits lunges at a runner. Not dominant on Normal, so I left it.
- **No substitutions, fatigue or injuries.** These were cut by design (see DESIGN.md)
  to keep every beat about the ball.
- **Automated browser testing only.** All visual checks were done through headless Chrome
  screenshots or a preview browser. Audio (WebAudio synthesis) couldn't be heard in testing. It is
  best-effort and fails silently.
