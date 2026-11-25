# Touchline Tactics — Design

A turn-based, 11-a-side football game for the browser, on desktop, tablet or phone. Every turn ("beat")
is a short passage of play: the defending side sets its trap, the side in possession
reads the picture and chooses what to do with the ball, then the move plays out on
the pitch. You get unlimited time on every decision.

## 1. Core turn loop: the beat

A Normal match is about 105 beats; a Short match is about 78. On Normal a beat usually
costs 25 to 110 game seconds (median about 50), depending on the action, where it
happens and how much first-time play follows. Build-up in your own half
eats more clock than quick play in the final third.

1. **Shape step (automatic).** Both teams move toward their tactical shape around
   the ball. Each player has a formation slot. The block slides with the ball,
   gets compact when defending and spreads out when attacking. Attackers look for
   pockets of space but stay onside. Defenders blend zonal cover with goal-side
   marking, and the nearest defender steps up to contain the ball carrier.
   Movement per beat is capped by pace, so a team caught upfield after losing the
   ball really is out of shape.
2. **Defensive decision (the side without the ball).** It may choose any of:
   - **Press**: one player closes the carrier down to about 1.5 m. This puts
     pressure on every option the carrier has, but leaves that player's zone empty.
   - **Tackle**: one player within 5 m lunges for the ball *now*. The tackle can be
     won, can give away a foul (a card, or a penalty in the box), or the tackler can
     be beaten and left on the floor for the rest of the beat. Press and Tackle
     can't be combined.
   - **Mark**: one player tightly marks one opponent, goal-side at about 1.2 m.
   - **Line height** (Deep / Normal / High): a persistent setting, and a real
     trade-off (see section 3):
     - **Deep** protects the box. Shots are blocked more, headers in the box are won
       more often, lanes near the box are tighter, and defenders are already set for
       balls in behind. The cost: a few more shots from inside the box and corners
       against, and you win the ball back slightly further from their goal (about
       38 m from your own goal, against 40 m for Normal and 42 m for High). It doesn't
       change possession.
     - **High** squeezes midfield (tighter lanes there) and wins the ball back
       higher, so counters start closer to goal. The cost: defenders have to turn
       and chase balls over the top, and fewer bodies are back to block shots.
   - Or simply **Hold shape**.
3. **Attacking decision (the side with the ball).** The attacker sees the defence's
   final positions before choosing. Options:
   - **Pass** (to feet). The risk comes from defenders near the lane, the pass
     distance, pressure on the passer, and pressure on the receiver.
   - **Through ball** into space. The runner races the defenders and keeper to the
     ball. Offside applies.
   - **Lofted pass / cross** to a player or a spot. It flies over the lines, but the
     landing is contested in the air. A cross into the box that is won becomes a
     header at goal.
   - **Dribble** up to 7.5–12 m, depending on pace. Defenders near the path challenge. A successful
     dribble leaves them beaten and slow to recover.
   - **Shoot**. The chance depends on distance, angle, pressure, blockers in the
     cone and the shooter's finishing. Shots can be blocked, saved and held, parried
     for a corner, parried into a rebound, or go wide.
   - **Clear**: hoof it about 40 m upfield. Where it lands becomes a 50/50.
4. **Resolution (animated).** The ball and players move on the pitch, and the
   commentary and a "why" caption explain what happened and what the odds were.
5. **Quick play (first-time).** After a *completed* pass, the receiver may act again
   immediately, before the defence resets. There is no shape step and no defensive
   decision, but accuracy drops by 5% and dribbling isn't allowed. You can chain up to
   3 of these. Or you can **take a touch** (Space), which ends the beat and lets both
   teams reorganise.
   *Why:* see devlog cycle 1. Each beat allowing only one action made football too
   slow to produce chances inside the time budget. Tempo is also a real football
   decision: one-touch play exploits a defence that is still shifting.
6. **Counter-attack.** Winning the ball cleanly in open play (a tackle or an
   interception by an outfield player, not the keeper) gives the winner one
   immediate first-time action before the opponent regroups. The same rules apply as
   for first-time play: −5% accuracy and no dribbling. A completed counter pass can be
   followed by more first-time play. At most two counters can happen in one beat.
   *Why:* see devlog cycle 5. Before this, a turnover just ended the beat, and the
   shape step gave the team that lost the ball time to get back. Now the winner gets a
   move against a team that is still out of shape. There are about 15 counters per
   match (both sides). Most of their value is in the position they win: the counter
   move itself scores only about 0.1 goals per match.
   *Why no dribbling:* with dribbling allowed, a "dribble only" script went from
   losing to winning, because every ball won came with a free carry.

**Why sequential and not simultaneous?** I prototyped simultaneous orders on paper.
With them, the odds shown to the attacker would be guesses, and readability
(pillar 6) would suffer. With the defence moving first, the attacker always sees
honest numbers, and the defender's job becomes a positional puzzle: you can't cover
everything, so what do you leave open? It's also how football feels. The defence
commits to a press, and the playmaker sees where the gap has opened.

**One decision per beat for the human.** You decide the defence when the CPU has the
ball, and the attack when you have it. This keeps the pace up and the match inside
10 to 20 minutes.

## 2. Rules included

- 11 v 11 with 4 fictional teams, each with its own formation and style.
- **Offside** at the moment of the pass, for passes and through balls. There's no
  offside from throw-ins, corners or goal kicks. The preview always flags it.
- **Set pieces**: kick-off, throw-in, goal kick, corner (cross to any spot), free
  kick (direct shot with a wall if in range), and penalty (a mind game: the taker
  picks left, centre or right and the keeper picks a dive. Nothing is timed).
- **Fouls and cards**: these come from tackles and dribble challenges. Yellow,
  second yellow becomes a red, and a straight red is possible for denying a clear
  chance (last man, in the final third). A sent-off player is not replaced.
- **Two halves of 45 minutes** with stoppage time based on goals, cards and
  set-piece stoppages, shown on the fourth official's board. Last-gasp drama: a
  penalty awarded after time is up is still taken.
- **Left out on purpose**: substitutions, fatigue and injuries. They add menus and
  bookkeeping but little moment-to-moment decision-making in a 15-minute match.
  Also left out: switching ends at half-time. You always attack the same way (left to
  right, or up the screen on an upright phone), for readability.

## 3. Probability model (summary)

Every number shown in the UI comes from the same functions the resolver uses, so
the odds you see are the real odds.

- **Pressure** on a player comes from the nearest opponents within 6 m.
- **Lane interception**: for each defender, the perpendicular distance to the ball's
  path is compared with how far that defender can reach by the time the ball gets
  there (reach grows with ball travel time). Long passes past nearby defenders are
  much riskier than short ones.
- **Through-ball race**: runner arrival time vs the best defender or keeper arrival
  time, put through a sigmoid.
- **Aerial duel**: arrival times plus heading skill. The keeper claims crosses that
  drop in their area.
- **xG**: a distance curve fitted to typical values (about 0.42 from 11 m, 0.19 from
  16 m, 0.09 from 20 m, 0.035 from 25 m), scaled down for tight angles. It's then
  scaled by finishing, pressure, header (×0.27) or foot, set piece, and how far the
  keeper is off his line. Blockers in the shot cone add a block chance.
- **Offside** is certain when a player is more than 1.3 m off, and a probabilistic
  tight call within ±1.3 m. The preview shows "Offside risk X%".
- **Line height** changes the odds directly (`TUNE.line` in `engine.js`), and the
  preview names the effect whenever it applies:

  | | Deep | Normal | High |
  |---|---|---|---|
  | Head start (s) for outfield defenders chasing a through ball | +0.4 | 0 | −0.35 |
  | Shot-block chance | ×1.6 | ×1 | ×0.85 |
  | Lane-interception reach, defenders in their own third | ×1.6 | ×1 | ×1 |
  | Lane-interception reach, defenders in the middle third | ×1 | ×1 | ×1.15 |
  | Head start (s) in aerial duels inside their own box | +0.25 | 0 | −0.1 |

- **Pressing has a cost**: a presser who is bypassed is caught upfield and moves at
  half speed in the next shape step. A player who loses a tackle, or is tackled, is
  down for a beat.
- Small random noise and skill differences leave room for luck and surprise.

## 4. How the CPU thinks

- **Attack**: it generates about 25 to 50 valid candidate actions (passes to every
  teammate, through balls ahead of every runner, lofted passes and crosses into
  four box zones, dribbles in 9 directions, and a shot). It scores each by
  **expected value** over its outcomes, using a positional threat map (similar to
  xT). Keeping the ball in a dangerous spot is worth a lot, and losing it near your
  own goal costs a lot. Team style changes the weights: direct teams value progress,
  possession teams value safety. So does game state: a team trailing late takes more
  risk, and a team leading late protects the ball. It picks with a softmax, which
  gives variety. The temperature depends on difficulty.
- **Defence**: it builds up to about 10 defensive plans (hold; press with the nearest
  1 or 2; tackle with anyone in range; mark the 2 most dangerous receivers; press and
  mark combined; the offside trap unless the line is deep). It
  applies each one hypothetically and asks the attack evaluator how good the
  attacker's best options would be. It picks the plan that minimises the attacker's
  soft-max expected value, counting tackle outcomes too. That way it presses when
  pressing helps and marks the man you were about to find. Line height
  follows style, except late on: deep when leading after 75', high when trailing after
  70'.
- **Hunting the ball**: when the opponent keeps the ball for several beats (and the
  CPU isn't winning), the CPU block pushes up and marks man to man, and press plans
  get a growing bonus. Sterile keep-ball can't safely run the clock down.
- **Counters**: the same rule as quick play decides whether the CPU breaks after
  winning the ball or settles and lets both teams reorganise.
- **Quick play**: the CPU plays first-time only when its best first-time option beats
  the value of settling on the ball.
- **Difficulty**: Easy gives the CPU −7 to all attributes and much noisier choices
  (softmax temperature 0.028). Normal gives ±0 and 0.011. Hard gives +4 and 0.006.

## 5. Design pillars

| Pillar | How it's delivered |
|---|---|
| Space & positioning | Continuous 105×68 m pitch. Every probability is geometric (lanes, races, cones, pressure). The shape engine moves blocks realistically, so turnovers create counter-attack space. |
| Ball flows (and tempo) | Every action animates: passes roll, lofted balls arc with a shadow, runners sprint onto through balls, keepers dive, the net ripples. |
| Risk vs reward | Each option shows its success % and what happens if it fails. Safe recycling is 90%+, while splitting passes might be 35% for a 1-v-1. Expected-value scoring means good choices pay off more often than not. |
| Both phases | Press, tackle, mark and line height, each with visible trade-offs and previews (tackle win/foul %, threat rings on dangerous opponents). |
| Atmosphere | Match clock, stoppage-time board, live commentary, a synthesised crowd that swells with danger and roars on goals, a referee whistle, a GOAL banner with a slow-motion replay, a momentum bar, and a full-time stats screen. |
| Readability | Coloured % badges on every option, lane lines with threatening defenders ringed, an offside warning, a "why" caption after every resolution, a context hint bar and a how-to-play overlay. |

## 6. Tech

- Vanilla JavaScript with no build step and no dependencies. `index.html` opens
  directly from disk. Engine files are plain scripts that attach to a global `FB`
  namespace, so the same code runs in Node for the simulator and the tests.
- `js/core.js` holds the RNG, geometry, teams and constants. `js/engine.js` holds the
  rules and resolution. `js/ai.js` is the CPU. `js/commentary.js` holds the
  commentary. `js/render.js`, `js/audio.js` and `js/game.js` are the browser UI.
- `tools/sim.js` runs headless CPU-vs-CPU batch simulations. `tools/balance.js`
  runs a team round-robin. `tools/exploits.js` pits scripted human strategies against
  the CPU. `tools/timing.js` estimates real-world match length. `tools/lines.js` compares
  deep, normal and high lines over whole matches. `tools/diag.js` breaks matches down by
  mechanic (goals by origin, action mix, shown vs actual odds, loose balls, presses).
  `tools/policies.js` measures fixed habits against the CPU with confidence intervals.
  `test/*.test.js` uses `node:test`.
- **Hosting:** the game is a static site. GitHub Pages serves it from the root of
  `main` at https://snck.github.io/football/, so a push to `main` publishes it.
- A seeded RNG (mulberry32) makes simulations reproducible.

## 7. Phones and tablets

The engine, AI and commentary don't know about screens. All of this is in
`render.js`, `game.js` and `style.css`.

- **Held upright** (portrait, up to 900 px wide): the pitch stands vertically and you
  attack up the screen, with the controls underneath. Geometry is drawn on a rotated
  canvas, while players, badges and text are drawn unrotated so they stay readable. Taps are
  mapped back through the rotation. `FB.VERTICAL_MQ` in `render.js` must match the
  media query in `style.css`.
- **Held sideways:** a compact version of the desktop layout.
- **Minimum sizes:** player discs are at least 14 px across, and badges, labels and
  banners have a floor too, because a phone shows only about 3.5 to 5 px per metre.
- **Touch input** (`pointer: coarse`): a tap counts within 22 px of a player (12 px when
  aiming a through ball, so space near a runner can still be picked). Tapping again
  within 24 px commits. There's a Commit and a Cancel button, and hints say "tap"
  instead of naming keys.
- **No separate mobile build.** Desktop keeps its own layout and behaviour.

## 8. Other decisions

- **You are always the home side, attacking left to right** (or up the screen on an
  upright phone). There's no switching ends, so the direction of play never changes. The opponent's kit is always
  distinguishable.
- **No assets.** The pitch, players and effects are drawn on canvas. The crowd,
  whistle and kicks are synthesised with WebAudio. All names are invented from neutral
  first-name and surname pools.
- **Compression is deliberate.** About 105 beats can't contain about 1,000 real
  events. Stats are tuned to *look* right per match (scores 0–5, about 8.5 shots and
  about 4 on target per side, 1.2 goals per side, possession 30–70%). Fouls (about
  3) and corners (about 2) are lower than real football, because only decisive
  moments are modelled.

## 9. Ideas not built yet

Proposed after the mobile release. Counter-attacks and line height came from the same
list and were built in devlog cycle 5.

- **Teammate runs:** tell one teammate to run in behind, overlap or drop short, taking
  effect on the next beat. The biggest change: it touches shape, the AI and the UI.
- **Jockey, and a CPU that plans for dribbles:** stand off and slow a runner down
  without lunging.
- **Set-piece choices:** short, near-post or far-post corners; short or long goal kicks.
- **Half-time changes:** one decision on formation or attitude.
- **Pressing fatigue:** players who press or tackle a lot lose some pace late on.
- **Penalty memory:** takers and keepers develop habits that can be read.
