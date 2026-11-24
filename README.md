# Touchline Tactics

A turn-based, 11-a-side football game for the browser, on desktop, tablet or phone. You get unlimited time
on every decision, but it still plays like a football match: build-up, pressing, line
breaks, near misses, offside traps, stoppage-time drama.

No backend, no accounts, no network calls, no dependencies.

## Run it

**Option 1:** double-click / open `index.html` in Chrome, Firefox, Safari or Edge. That's it.

**Option 2:** with Node.js 18+ installed:

```bash
npm install && npm run dev     # serves on http://localhost:8080 (nothing to install, it's dependency-free)
```

Developer tools:

```bash
npm test             # rules-engine tests (node:test)
npm run sim          # 200 CPU-vs-CPU matches with aggregate stats
npm run balance      # team round-robin
npm run exploits     # scripted "human" strategies (spam shots, park the bus, keep-ball…) vs the CPU
node tools/timing.js # estimated real-world match length
```

## How to play

You are always the home side, attacking **left → right** (on a phone held upright the pitch
stands vertically and you attack **up the screen**). A match is a series of
**beats**. In each beat:

1. Both teams shift into shape automatically.
2. The side **without** the ball sets its defence.
3. The side **with** the ball sees exactly where everyone is and picks one action.
4. The move plays out on the pitch. The caption tells you what happened and what the
   odds were.

You make one decision per beat: attacking when you have the ball, defending when you
don't. Nothing is ever timed.

### With the ball

| Key | Action | How |
|---|---|---|
| `1` | **Pass** | Click a teammate. Every teammate shows a % badge. |
| `2` | **Through ball** | Click space ahead of a runner. He races the defenders and keeper to it. |
| `3` | **Lofted / cross** | Click a teammate or a spot. It goes over the lines but is contested in the air. Into the box from wide, it becomes a cross and a header at goal. |
| `4` | **Dribble** | Click inside the ring. Defenders near your path may tackle (or foul you; in the box that's a penalty). |
| `5` | **Shoot** | Shows your goal chance, block risk and on-target odds first. |
| `6` | **Clear** | Hoof it 40 m upfield when in trouble. |

Click once to preview, then click again (or press `Enter`) to commit. `Esc` cancels.

**Quick play:** after a completed pass you may play **first-time** (up to 3 in a row),
before the defence resets. It's 5% less accurate and you can't dribble. Or press
`Space` to **take a touch** and let everyone reorganise.

**Counter-attack:** when you win the ball with a tackle or an interception, you get
one first-time move straight away, before the opponent can get back into shape. The
CPU can counter you the same way, so a pass that gets cut out is costly.

### Without the ball

| Key | Action |
|---|---|
| `1` **Press** | Click one of your players inside the big ring. He closes the carrier down, making every option harder, but he's out of position if bypassed. |
| `2` **Tackle** | Click one of your players inside the small ring to lunge now. Win / foul (card or penalty) / beaten odds are shown. |
| `3` **Mark** | Click a dangerous opponent (the red rings are who the CPU most wants to find). Your nearest free player tight-marks him. Click your own player first to choose the marker. |
| `T` | **Offside trap**: the back line steps up 4 m. |
| `Q` / `W` / `E` | Line height: deep / normal / high. This setting stays until you change it. **Deep** protects the box: more shots blocked, more headers won, fewer balls in behind, but you win the ball back far from their goal. **High** squeezes midfield and wins it back higher (better counters), but your defenders have to turn and chase balls over the top. |

`Enter` confirms the plan; `Space` just holds shape. You can combine one press *or*
tackle with one mark and the trap.

### Reading the screen

- **Badges:** green is safe, yellow is a gamble, orange and red are long shots.
  `OFFSIDE` means the receiver would be flagged.
- **Red rings** around defenders show who threatens your chosen action.
- **The dashed yellow line** is the offside line.
- **The caption** under the pitch explains every outcome ("Intercepted by Varga, 0.5 m
  from the lane (56%)").
- Commentary, the momentum bar, stoppage-time board, a GOAL! banner with an optional
  slow-motion replay (`R`), and half-time and full-time stats.

Other keys: `H` help, `Esc` pause menu (animation speed, sound, restart, quit).

### On phones and tablets

Everything works by touch. Tap a player or a spot to select it and see the odds, then tap it
again or press **Commit**. **Cancel** clears the choice. The action buttons replace the number
keys. Held upright, a phone shows a vertical pitch with the controls underneath; held sideways,
it uses a compact version of the desktop layout. Sound starts when you tap Kick off, and iPhones
play no sound while the ring/silent switch is on silent.

Penalties are a mind game: pick left, centre or right as the taker or the keeper.

### Options

- **Teams:** four fictional clubs with different formations and styles (4-4-2
  balanced, 4-3-3 high press, 4-2-3-1 possession, 5-3-2 counter).
- **Difficulty:** Easy, Normal or Hard.
- **Length:** Short (~12 min) or Normal (~17 min). The real time depends on how long
  you think.

## Files

- `index.html`, `css/style.css`: the page
- `js/core.js`: constants, RNG, geometry, xG curve, teams and squads
- `js/engine.js`: rules, shape, actions, resolution, set pieces, clock
- `js/ai.js`: CPU attacking and defending brains
- `js/commentary.js`, `js/audio.js` (synthesised sound), `js/render.js` (canvas), `js/game.js` (UI flow)
- `tools/`: simulator, balance, exploit and timing harnesses, and an optional static server
- `test/`: engine tests
- `DESIGN.md`: the design. `DEVLOG.md`: the iteration history and self-assessment.

All art is drawn in code and all sound is synthesised. Every team and player name is
invented.
