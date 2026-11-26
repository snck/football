/* Rules engine: match state, shape, defensive actions, attacking actions, resolution. No DOM. */
(function (G) {
  'use strict';
  const FB = G.FB;
  const { L, W } = FB.P;
  const { clamp, lerp, dist, segDist, rel, abs, sigmoid } = FB;
  const HALF = 2700;

  const TUNE = FB.TUNE = {
    shapeSecs: 1.5,        // seconds of attacking movement per shape step
    defShapeSecs: 1.0,     // defenders react: they shift less per beat, so quick switches open space
    react: 0.15,
    reach0: 0.8, reachRate: 2.5, intBase: 0.7,
    passMax: 48, throughMax: 42, lobMax: 62, throwMax: 28,
    drTk: 0.36, drFoul: 0.22,
    shotPressure: 0.22,    // share of the goal chance lost when shooting under full pressure
    // Shot kinds. Placed is the plain shot. Driven: goal chance × (1 + range × (metres from goal − from)), kept within
    // [min, max]; block chance × block, on-target chance − onTarget. Chip: only over a keeper more than `off` m off his line;
    // goal chance × (base + perM × (metres he is off − off)), up to max, in place of the plain shot's bonus for a keeper
    // off his line; block chance × block; on target = goal chance + saves. save = [held, pushed out for a corner] share of
    // saves, the rest fall loose in the box.
    shot: {
      placed: { save: [0.52, 0.28] },
      driven: { from: 18, range: 0.025, min: 0.8, max: 1.35, block: 1.4, onTarget: 0.06, save: [0.36, 0.34] },
      chip: { off: 4, base: 0.4, perM: 0.15, max: 2.2, block: 0.3, saves: 0.1, save: [0.7, 0.15] },
    },
    shotKinds: ['placed', 'driven', 'chip'],
    cost: { pass: 34, through: 36, lob: 38, dribble: 31, shot: 34, tackle: 27, restart: 20, goal: 60, penalty: 50 },
    quickPenalty: 0.05, quickMax: 3, quickCost: 0.35,
    // A short pass to feet (at most `softPass.max` m, receiver under `softPass.pressure`) sets up the next first-time
    // ball: its accuracy penalty is `softPass.penalty` instead of `quickPenalty`.
    softPass: { max: 15, pressure: 0.25, penalty: 0.03 },
    pressRange: 14, tackleRange: 5, pressMove: 7.5, markMove: 10,
    // A mark stays on for `markBeats` more beats: the marker follows his man instead of holding his zone (`markGap` m
    // goal-side; within `markTight` m it counts as tight and adds `markPress` to the pressure on a pass to him).
    markBeats: 2, markGap: 1.2, markTight: 2.2, markPress: 0.15,
    // Through balls: an outfield defender needs `turnReact` s to turn and chase a ball played in behind him, but only
    // `faceReact` s when he is already goal-side of the target, facing the play. His line's `react` is added to both.
    turnReact: 0.8, faceReact: 0.45,
    // Offside trap: defenders who stepped up need this much longer (s) to turn and chase a ball played in behind.
    trapReact: 0.4,
    // Cover: stand off the carrier (`coverGap` m goal-side), step across (`coverSlide` m) to whoever receives the next
    // completed ball, and jockey dribblers (longer reach, fewer fouls).
    coverGap: 3.5, coverSlide: 4, jockeyReach: 0.7, jockeyFoul: 0.5,
    // Teammate runs, called when taking a touch and made in the next shape step: the runner covers `runBoost` times the
    // usual distance and skips the search for space. A run in behind gives `runStart` s of head start on a through ball to
    // him in the first action of that beat.
    runBoost: 1.25, runStart: 0.25, runKinds: ['behind', 'overlap', 'short'],
    // Loose balls: the first to arrive gets it (distance / speed + up to `noise` s of luck, + `down` s if beaten).
    // `reach` fits looseKeep()'s estimate to that race; `scatter` is how far (m) the ball runs loose.
    loose: { noise: 0.9, down: 0.8, reach: 1,
      scatter: { passMiss: 8, passTouch: 3.5, throughMiss: 12, throughTouch: 4, lobMiss: 12, lobTouch: 4, dribble: 3, clear: 10 } },
    counterMax: 2,         // counter-attacks allowed per beat (stops endless ping-pong)
    // Last attack: when time is up and a team is on the ball past `fromX` m (its own frame), or has a corner or a free kick
    // past `fkX` m, the referee lets it finish: play on until the ball is lost, out, scored or played back behind `backX` m,
    // for at most `beats` beats. A penalty is always taken.
    lastAttack: { beats: 3, fromX: 70, fkX: 74, backX: 60 },
    // Corners. A header from the delivery scores `header` times the usual chance (a crowded six-yard box). One attacker
    // waits `short` m from the flag for a short corner. How a team defends them is a setting it keeps (FB.setCornerDef):
    // man = a defender goal-side of each attacker in the box; zonal = defenders hold spots in and around the six-yard box
    // and get `zonalAerial` s of head start in the air, but nobody follows the attackers; up2 = two players stay upfield
    // and the attackers keep one more man back to watch them.
    corner: { header: 0.6, short: 11, zonalAerial: 0.25, defs: ['man', 'zonal', 'up2'] },
    // Line height trade-offs (the defending team's line):
    //  react: extra seconds an outfield defender needs to turn and chase a ball played in behind
    //  block: multiplier on shot-block chances (a set deep block has bodies in the way)
    //  ownThird / midThird: reach multiplier for lane interceptions by defenders standing in their
    //  own third (0-35 m from goal) or the middle third (35-70 m): deep = crowded box, high = squeezed midfield
    //  aerial: head start (seconds) defenders get in aerial duels inside their own box (set and facing the ball)
    line: {
      deep: { react: -0.4, block: 1.6, ownThird: 1.6, midThird: 1, aerial: 0.25 },
      normal: { react: 0, block: 1, ownThird: 1, midThird: 1, aerial: 0 },
      high: { react: 0.5, block: 0.85, ownThird: 1, midThird: 1.15, aerial: -0.1 },
    },
  };
  const lineFx = (m, t) => TUNE.line[m.lines[t]] || TUNE.line.normal;
  FB.lineFx = lineFx;

  // ------------------------------------------------------------------ helpers
  const active = (m, t) => { // ids are team * 11 + slot; a plain loop because evaluate leans on this
    const out = [];
    for (let i = t * 11; i < t * 11 + 11; i++) if (!m.players[i].off) out.push(m.players[i]);
    return out;
  };
  const opp = (t) => 1 - t;
  const speed = (p) => (p.role === 'GK' ? 5.4 : 5.6 + (p.attrs.pace - 50) * 0.045);
  const unit = (a, b) => { const d = dist(a, b) || 1; return { x: (b.x - a.x) / d, y: (b.y - a.y) / d }; };
  const ownGoal = (t) => (t === 0 ? { x: 0, y: W / 2 } : { x: L, y: W / 2 });
  const oppGoal = (t) => ownGoal(opp(t));
  const clampPitch = (p) => ({ x: clamp(p.x, 0.5, L - 0.5), y: clamp(p.y, 0.5, W - 0.5) });
  const P = (m, id) => m.players[id];
  const carrierP = (m) => (m.carrier == null ? null : m.players[m.carrier]);
  const shortName = (p) => p.name;
  FB.active = active; FB.speed = speed;

  function mkStats() {
    return { poss: 0, passes: 0, passesOk: 0, shots: 0, onTarget: 0, xg: 0, corners: 0, fouls: 0, yellows: 0, reds: 0,
      offsides: 0, tackles: 0, interceptions: 0, saves: 0, dribbles: 0, crosses: 0 };
  }

  FB.createMatch = function (o) {
    const seed = o.seed != null ? o.seed : Math.floor(Math.random() * 2147483647);
    const m = {
      seed, rng: FB.rng(seed), human: o.human != null ? o.human : -1, diff: o.difficulty || 'normal',
      timeScale: o.length === 'short' ? 1.62 : o.length === 'long' ? 0.9 : 1.2,
      teams: [o.home, o.away].map((def, t) => ({ def, t, name: def.name, short: def.short, colors: def.colors, style: def.style })),
      players: [], time: 0, half: 1, added: [null, null], score: [0, 0], poss: 0, carrier: null,
      ball: { x: L / 2, y: W / 2 }, restart: null, setPiece: null, lines: [o.home.style.line, o.away.style.line],
      cornerDef: [o.home.style.corner || 'man', o.away.style.corner || 'man'],
      stats: [mkStats(), mkStats()], feed: [], goals: [], beat: 0, over: false, momentum: 0,
      beaten: new Set(), marks: {}, markOrders: [null, null], runs: [null, null], runMade: null, trapped: null, cover: null, lastPasser: null, lastTouch: 0, halfEvents: { goals: 0, cards: 0, stops: 0 },
      phase: 'idle', history: [],
    };
    const diffAdj = { easy: -7, normal: 0, hard: 4 }[m.diff] || 0;
    [o.home, o.away].forEach((def, t) => {
      FB.buildSquad(def).forEach((s) => {
        const attrs = Object.assign({}, s.attrs);
        if (m.human >= 0 && t !== m.human) for (const k in attrs) attrs[k] = clamp(attrs[k] + diffAdj, 20, 97);
        m.players.push(Object.assign({}, s, { id: t * 11 + s.slot, team: t, attrs, x: 0, y: 0, yellow: 0, off: false, recover: 0 }));
      });
    });
    if (m.human >= 0) { m.lines[m.human] = 'normal'; m.cornerDef[m.human] = 'man'; }
    m.restart = { type: 'kickoff', team: 0 };
    m.firstKick = 0;
    return m;
  };

  function say(m, key, ctx, kind) {
    const text = FB.say(key, Object.assign({ seed: m.beat }, ctx));
    m.feed.push({ min: FB.clockText(m), text, kind: kind || key, team: ctx && ctx.team != null ? ctx.team : null });
    return text;
  }
  const ctxP = (p) => (p ? `${p.name}` : '');

  FB.clockText = function (m) {
    const hEnd = HALF * m.half;
    if (m.time >= hEnd) return `${m.half * 45}+${Math.floor((m.time - hEnd) / 60) + 1}'`;
    return `${Math.floor(m.time / 60) + 1}'`;
  };
  FB.minute = (m) => m.time / 60;

  // ------------------------------------------------------------------ pressure / offside
  function pressureOn(m, p, at) {
    const pos = at || p;
    let d1 = 99, d2 = 99;
    for (const o of active(m, opp(p.team))) {
      if (m.beaten.has(o.id)) continue;
      const d = dist(o, pos);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return Math.min(1.2, clamp((5.5 - d1) / 4.5, 0, 1) + 0.3 * clamp((5.5 - d2) / 4.5, 0, 1));
  }
  FB.pressureOn = pressureOn;

  function offsideLine(m, atkTeam) {
    const xs = active(m, opp(atkTeam)).map((o) => rel(atkTeam, o).x).sort((a, b) => b - a);
    return xs.length > 1 ? xs[1] : L;
  }
  /** Probability the assistant referee flags r offside if the ball is played now (tight calls are uncertain). */
  function offsideProb(m, r) {
    const sp = m.setPiece && m.setPiece.type;
    if (sp === 'throwin' || sp === 'goalkick' || sp === 'corner' || sp === 'kickoff') return 0;
    const rr = rel(r.team, r), b = rel(r.team, m.ball);
    if (rr.x <= 52.5 || rr.x <= b.x + 0.2) return 0;
    const over = rr.x - offsideLine(m, r.team);
    if (over < -1.3) return 0;
    if (over > 1.3) return 1;
    return sigmoid(over / 0.33);
  }
  const isOffside = (m, r) => offsideProb(m, r) >= 0.5;
  FB.offsideProb = offsideProb;
  FB.isOffside = isOffside;
  /** Pressure at a point T for team t's player, ignoring beaten defenders and given challengers (who will be beaten). */
  FB.pressureAt = function (m, t, T, ch) {
    const skip = new Set((ch || []).map((x) => x.id));
    let d1 = 99;
    for (const o of active(m, opp(t))) { if (m.beaten.has(o.id) || skip.has(o.id)) continue; d1 = Math.min(d1, dist(o, T)); }
    return clamp((6 - d1) / 5, 0, 1);
  };
  FB.offsideLine = (m, t) => abs(t, { x: offsideLine(m, t), y: 0 }).x;

  // ------------------------------------------------------------------ shape
  function shapeTargets(m, t) {
    const inPoss = m.poss === t;
    const b = rel(t, m.ball);
    const line = m.lines[t];
    const out = {};
    const run = inPoss && m.runs[t] && !P(m, m.runs[t].id).off ? m.runs[t] : null; // a run called by the player on the ball
    const runId = run ? run.id : -1;
    // CPU teams go hunting for the ball when the opponent keeps it for a long spell
    let hunt = 0;
    if (!inPoss && t !== m.human) {
      hunt = clamp(((m.possStreak || 0) - 3) / 5, 0, 1) * (m.score[t] > m.score[opp(t)] ? 0.5 : 1);
    }
    let defLine, front, span, cy;
    if (inPoss) {
      defLine = clamp(b.x - 20, 14, 62);
      front = clamp(b.x + 36, defLine + 40, 99);
      span = 60; cy = 34 + (b.y - 34) * 0.2;
    } else {
      const adj = (line === 'high' ? 9 : line === 'deep' ? -8 : 0) + hunt * 12;
      defLine = clamp(b.x - 22 + adj, 6, 36 + adj * 1.2);
      if (defLine > b.x - 3) defLine = Math.max(6, b.x - 3);
      front = defLine + (line === 'deep' ? 30 : 36);
      span = 50; cy = 34 + (b.y - 34) * 0.4;
    }
    const ps = active(m, t);
    for (const p of ps) {
      if (p.id === m.carrier) continue;
      let r;
      if (p.role === 'GK') r = { x: clamp(2 + b.x * 0.1, 2, inPoss ? 16 : 11), y: 34 + (b.y - 34) * 0.18 };
      else {
        const k = (p.u - 0.15) / 0.55;
        r = { x: lerp(defLine, front, k), y: cy + (p.v - 0.5) * span };
        // out of possession, strikers stay up as an outlet for the counter
        if (!inPoss && p.role === 'FW') r.x = Math.max(r.x, Math.min(b.x + 6, line === 'deep' ? 50 : 46));
      }
      out[p.id] = r;
    }
    const others = active(m, opp(t));
    if (inPoss && b.x > 66) {
      // attack the box: strikers and advanced midfielders make runs into crossing zones
      const s = b.y < 34 ? -1 : 1;
      const zones = [{ x: 99, y: 34 + s * 4 }, { x: 94, y: 34 - s * 1 }, { x: 98, y: 34 - s * 6 }, { x: 87, y: 34 - s * 2 }];
      const runners = ps.filter((p) => p.id !== m.carrier && p.id !== runId && (p.role === 'FW' || (p.role === 'MF' && p.u >= 0.45)));
      const nZones = b.x > 80 ? 4 : 3;
      const taken = new Set();
      for (const z of zones.slice(0, nZones)) {
        let best = null, bd = 1e9;
        for (const p of runners) {
          if (taken.has(p.id)) continue;
          const d = Math.hypot(out[p.id].x - z.x, out[p.id].y - z.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (!best) break;
        taken.add(best.id);
        out[best.id] = { x: z.x + (m.rng() - 0.5) * 3, y: z.y + (m.rng() - 0.5) * 3 };
      }
    }
    if (inPoss) {
      const offL = offsideLine(m, t);
      const lim = Math.max(offL, b.x) - 0.5;
      const oppRel = others.map((o) => rel(t, o));
      for (const p of ps) {
        if (p.id === m.carrier || p.role === 'GK' || p.id === runId) continue;
        let r = out[p.id];
        if (r.x > lim) r.x = lim;
        // look for a pocket of space near the target
        let best = r, bestS = -1e9;
        for (let i = 0; i < 9; i++) {
          const ang = (i / 9) * Math.PI * 2 + m.rng() * 0.6;
          const c = i === 0 ? r : { x: r.x + Math.cos(ang) * 5, y: r.y + Math.sin(ang) * 5 };
          if (c.x > lim) c.x = lim - m.rng() * 0.8 + 0.3;
          let md = 12;
          for (const o of oppRel) md = Math.min(md, Math.hypot(o.x - c.x, o.y - c.y));
          const s = md - 0.3 * Math.hypot(c.x - r.x, c.y - r.y) + m.rng() * 0.6;
          if (s > bestS) { bestS = s; best = c; }
        }
        out[p.id] = best;
      }
      // guarantee a short outlet
      const c = carrierP(m);
      if (c) {
        const cr = rel(t, c);
        let nearest = null, nd = 1e9;
        for (const p of ps) {
          if (p.id === m.carrier || p.role === 'GK' || p.id === runId) continue;
          const d = Math.hypot(out[p.id].x - cr.x, out[p.id].y - cr.y);
          if (d < nd) { nd = d; nearest = p; }
        }
        if (nearest && nd > 14) {
          const r = out[nearest.id];
          const k = 11 / nd;
          out[nearest.id] = { x: cr.x + (r.x - cr.x) * k, y: cr.y + (r.y - cr.y) * k };
        }
      }
      if (run) out[runId] = runSpot(m, t, P(m, runId), run.kind, lim);
    } else {
      // defending: blend zone with goal-side marking
      const atk = others.filter((o) => o.id !== m.carrier && o.role !== 'GK')
        .map((o) => ({ o, r: rel(t, o) }))
        .sort((a, b2) => a.r.x - b2.r.x);
      const free = new Set(ps.filter((p) => p.role !== 'GK').map((p) => p.id));
      const c = carrierP(m);
      const mo = m.markOrders[t]; // the marker has left his zone to follow his man (shapeStep moves him)
      if (mo) { free.delete(mo.d); delete out[mo.d]; }
      let container = null;
      if (c && !(mo && mo.a === c.id)) {
        let nd = 1e9;
        for (const p of ps) {
          if (p.role === 'GK' || mo && p.id === mo.d) continue;
          const d = dist(p, c);
          if (d < nd) { nd = d; container = p; }
        }
        // only step out to contain once the ball is in a threatening area (or for pressing teams)
        const cRel = rel(opp(t), c).x;
        const engage = cRel > 48 - m.teams[t].style.press * 20;
        if (container && nd < 16 && engage) free.delete(container.id); else container = null;
      }
      for (const a of atk) {
        if (mo && a.o.id === mo.a) continue;
        const danger = clamp(1 - a.r.x / 55, 0, 1);
        let best = null, bd = 18 + hunt * 14;
        for (const id of free) {
          const z = out[id];
          const d = Math.hypot(z.x - a.r.x, z.y - a.r.y);
          if (d < bd) { bd = d; best = id; }
        }
        if (best == null) continue;
        free.delete(best);
        const g = { x: 0, y: 34 };
        const dd = Math.hypot(g.x - a.r.x, g.y - a.r.y) || 1;
        const gs = { x: a.r.x + ((g.x - a.r.x) / dd) * 2.0, y: a.r.y + ((g.y - a.r.y) / dd) * 2.0 };
        let w = 0.15 + 0.55 * danger;
        w += (0.9 - w) * hunt;
        const z = out[best];
        out[best] = { x: lerp(z.x, gs.x, w), y: lerp(z.y, gs.y, w) };
      }
      if (container) {
        const cr = rel(t, c);
        const g = { x: 0, y: 34 };
        const dd = Math.hypot(g.x - cr.x, g.y - cr.y) || 1;
        out[container.id] = { x: cr.x + ((g.x - cr.x) / dd) * 6.5, y: cr.y + ((g.y - cr.y) / dd) * 6.5 };
      }
    }
    const res = {};
    for (const id in out) res[id] = clampPitch(abs(t, out[id]));
    return res;
  }

  /**
   * Where a called run goes (team-relative; no RNG, so the UI can preview it). lim is the offside limit.
   * behind: up to the line through the widest gap near the runner; overlap: outside the carrier and 9 m beyond him;
   * short: 10 m from the carrier, wherever is furthest from an opponent.
   */
  function runSpot(m, t, p, kind, lim) {
    const cr = rel(t, carrierP(m)), pr = rel(t, p);
    const opps = active(m, opp(t)).map((o) => ({ o, r: rel(t, o) }));
    if (kind === 'behind') {
      const offL = offsideLine(m, t);
      const ys = opps.filter((x) => x.o.role !== 'GK' && x.r.x > offL - 12).map((x) => x.r.y).concat([0, W]).sort((a, b) => a - b);
      let y = pr.y, bs = -1e9;
      for (let i = 1; i < ys.length; i++) {
        const mid = (ys[i] + ys[i - 1]) / 2, s = ys[i] - ys[i - 1] - 0.5 * Math.abs(mid - pr.y);
        if (s > bs) { bs = s; y = mid; }
      }
      return { x: lim, y: clamp(y, 4, W - 4) };
    }
    if (kind === 'overlap') {
      const s = cr.y < W / 2 ? -1 : 1;
      return { x: Math.min(lim, cr.x + 9), y: clamp(cr.y + s * 7, 3, W - 3) };
    }
    let best = { x: Math.min(pr.x, lim), y: pr.y }, bs = -1e9;
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const q = { x: cr.x + Math.cos(ang) * 10, y: cr.y + Math.sin(ang) * 10 };
      if (q.x < 2 || q.x > Math.min(lim, L - 2) || q.y < 2 || q.y > W - 2) continue;
      let md = 12;
      for (const x of opps) md = Math.min(md, Math.hypot(x.r.x - q.x, x.r.y - q.y));
      const s = md - 0.1 * Math.hypot(q.x - pr.x, q.y - pr.y);
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }
  /** Where the run called for team t would head if it were made now (absolute; the real one is worked out after the defence moves). */
  FB.runTarget = function (m, t, run) {
    const p = run && P(m, run.id), c = carrierP(m);
    if (!p || !c || c.team !== t) return null;
    const lim = Math.max(offsideLine(m, t), rel(t, m.ball).x) - 0.5;
    return clampPitch(abs(t, runSpot(m, t, p, run.kind, lim)));
  };
  /** Call a run for the next beat (when taking a touch). Returns false and changes nothing if it isn't allowed. */
  FB.orderRun = function (m, team, run) {
    if (!run || !TUNE.runKinds.includes(run.kind)) return false;
    const p = P(m, run.id);
    if (!p || p.team !== team || p.off || p.role === 'GK' || p.id === m.carrier || m.poss !== team || m.carrier == null || m.restart || m.over) return false;
    m.runs[team] = { id: p.id, kind: run.kind };
    return true;
  };

  function moveTowards(p, tgt, maxD) {
    const d = dist(p, tgt);
    if (d <= maxD) { p.x = tgt.x; p.y = tgt.y; } else { p.x += ((tgt.x - p.x) / d) * maxD; p.y += ((tgt.y - p.y) / d) * maxD; }
  }

  /** Where a tight marker of team t stands: just goal-side of p. */
  function markSpot(p, t) {
    const u = unit(p, ownGoal(t));
    return clampPitch({ x: p.x + u.x * TUNE.markGap, y: p.y + u.y * TUNE.markGap });
  }

  function shapeStep(m) {
    const moves = {};
    const def = opp(m.poss);
    const run = m.runs[m.poss], runner = run && P(m, run.id);
    const from = runner ? { x: runner.x, y: runner.y } : null;
    for (const t of [def, m.poss]) { // defenders move first; attackers then react onside
      const tg = shapeTargets(m, t);
      for (const id in tg) {
        const p = P(m, +id);
        const maxD = speed(p) * (t === m.poss ? TUNE.shapeSecs : TUNE.defShapeSecs) * (p.recover > 0 ? 0.5 : 1) * (p === runner ? TUNE.runBoost : 1);
        moveTowards(p, tg[id], maxD);
        moves[id] = { x: p.x, y: p.y };
      }
    }
    if (runner && !runner.off && moves[runner.id]) {
      m.runMade = { id: runner.id, kind: run.kind, team: m.poss, from, to: { x: runner.x, y: runner.y } };
      say(m, 'run_' + run.kind, { a: ctxP(runner), b: ctxP(carrierP(m)), team: m.poss }, 'quiet');
    }
    const mo = m.markOrders[def];
    if (mo) { // a marker goes where his man went
      const d = P(m, mo.d), a = P(m, mo.a);
      moveTowards(d, markSpot(a, def), speed(d) * TUNE.defShapeSecs * (d.recover > 0 ? 0.5 : 1));
      m.marks[a.id] = d.id; // evaluate() checks whether he's close enough to count as tight
      moves[d.id] = { x: d.x, y: d.y };
    }
    for (const p of m.players) if (p.recover > 0) p.recover--;
    return moves;
  }

  // ------------------------------------------------------------------ restarts
  function setCarrier(m, p) {
    m.carrier = p ? p.id : null;
    if (p) { m.poss = p.team; m.ball = { x: p.x, y: p.y }; }
  }

  function kickoffPositions(m, t) {
    const moves = {};
    for (const team of [0, 1]) {
      for (const p of active(m, team)) {
        let r;
        if (p.role === 'GK') r = { x: 4, y: 34 };
        else {
          const k = (p.u - 0.15) / 0.55;
          r = { x: lerp(14, 47, k), y: 34 + (p.v - 0.5) * 50 };
        }
        const a = abs(team, r);
        p.x = a.x; p.y = a.y;
      }
    }
    const fws = active(m, t).filter((p) => p.role === 'FW');
    const mfs = active(m, t).filter((p) => p.role === 'MF');
    const k1 = fws[0] || mfs[0] || active(m, t)[1];
    const k2 = fws[1] || mfs.sort((a, b) => b.u - a.u)[0];
    const c = abs(t, { x: 52.3, y: 34 });
    k1.x = c.x; k1.y = c.y;
    if (k2 && k2 !== k1) { const c2 = abs(t, { x: 50.5, y: 38 }); k2.x = c2.x; k2.y = c2.y; }
    for (const p of active(m, opp(t))) {
      const d = dist(p, { x: L / 2, y: W / 2 });
      if (d < 9.6) { const u = unit({ x: L / 2, y: W / 2 }, p); p.x = L / 2 + u.x * 9.6; p.y = W / 2 + u.y * 9.6; }
    }
    for (const p of m.players) moves[p.id] = { x: p.x, y: p.y };
    setCarrier(m, k1);
    return moves;
  }

  function nearestOf(list, pos) {
    let best = null, bd = 1e9;
    for (const p of list) { const d = dist(p, pos); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  function pushOut(m, team, center, radius) {
    for (const p of active(m, team)) {
      const d = dist(p, center);
      if (d < radius) {
        const u = d > 0.01 ? unit(center, p) : unit(center, ownGoal(team));
        const np = clampPitch({ x: center.x + u.x * radius, y: center.y + u.y * radius });
        p.x = np.x; p.y = np.y;
      }
    }
  }

  function setupRestart(m) {
    const R = m.restart;
    m.restart = null;
    m.setPiece = R;
    const t = R.team, o = opp(t);
    let moves = {};
    m.beaten.clear();
    if (R.type === 'kickoff') return kickoffPositions(m, t);
    if (R.type === 'penalty') {
      const taker = active(m, t).filter((p) => p.role !== 'GK').sort((a, b) => b.attrs.shoot - a.attrs.shoot)[0];
      const spot = abs(t, { x: L - 11, y: 34 });
      for (const team of [t, o]) {
        let i = 0;
        for (const p of active(m, team)) {
          if (p === taker) continue;
          if (p.role === 'GK' && team === o) { const g = abs(t, { x: L - 0.3, y: 34 }); p.x = g.x; p.y = g.y; continue; }
          if (p.role === 'GK') { const g = abs(t, { x: 40, y: 34 }); p.x = g.x; p.y = g.y; continue; }
          const ang = -1.2 + (i++ / 9) * 2.4 + (team === t ? 0.08 : -0.08);
          const r = { x: L - 18 - (i % 3) * 2.5 - Math.abs(Math.sin(ang)) * 6, y: 34 + Math.sin(ang) * 22 };
          const a = abs(t, r); p.x = a.x; p.y = a.y;
        }
      }
      taker.x = spot.x; taker.y = spot.y;
      setCarrier(m, taker);
      for (const p of m.players) moves[p.id] = { x: p.x, y: p.y };
      return moves;
    }
    if (R.type === 'corner') {
      const top = R.pos.y < W / 2;
      const fy = top ? 0.6 : W - 0.6;
      const spot = { x: R.pos.x < L / 2 ? 0.6 : L - 0.6, y: fy };
      const sRel = rel(t, spot);
      const near = sRel.y < 34 ? -1 : 1; // which side in rel frame
      const def = m.cornerDef[o];
      const atk = active(m, t).filter((p) => p.role !== 'GK');
      const taker = atk.filter((p) => p.role !== 'DF').sort((a, b) => b.attrs.pass - a.attrs.pass)[0];
      const rest = atk.filter((p) => p !== taker).sort((a, b) => b.attrs.head - a.attrs.head);
      const shortMan = rest.length > 6 ? rest.splice(6, 1)[0] : null; // the best header not needed in the box
      // against two left upfield the attackers keep one more back: one fewer in the box
      const zones = [{ x: 99, y: 34 + near * 3.5 }, { x: 98, y: 34 - near * 3 }, { x: 94, y: 34 }, { x: 97.5, y: 34 - near * 8 }, { x: 92, y: 34 + near * 6 }, { x: 86, y: 34 - near * 2 }]
        .filter((z, i) => def !== 'up2' || i !== 4);
      const back = [{ x: 62, y: 22 }, { x: 62, y: 46 }, { x: 74, y: 34 }, { x: 80, y: 18 }];
      rest.forEach((p, i) => {
        const r = i < zones.length ? zones[i] : back[(i - zones.length) % back.length];
        const a = abs(t, { x: r.x + (m.rng() - 0.5), y: r.y + (m.rng() - 0.5) * 1.5 });
        p.x = a.x; p.y = a.y;
      });
      if (shortMan) { const a = abs(t, { x: L - 8, y: sRel.y - near * 7.5 }); shortMan.x = a.x; shortMan.y = a.y; }
      const gkA = active(m, t).find((p) => p.role === 'GK');
      if (gkA) { const a = abs(t, { x: 30, y: 34 }); gkA.x = a.x; gkA.y = a.y; }
      // defenders
      const defs = active(m, o).filter((p) => p.role !== 'GK');
      const gk = active(m, o).find((p) => p.role === 'GK');
      if (gk) { const a = abs(t, { x: L - 0.8, y: 34 + near * 0.8 }); gk.x = a.x; gk.y = a.y; }
      const pool = defs.slice().sort((a, b) => b.attrs.head - a.attrs.head);
      if (def === 'up2') { // the two quickest who aren't defenders wait on halfway
        const up = pool.filter((p) => p.role !== 'DF').sort((a, b) => b.attrs.pace - a.attrs.pace).slice(0, 2);
        up.forEach((p, i) => { const a = abs(t, { x: 54, y: 34 + (i ? 9 : -9) }); p.x = a.x; p.y = a.y; pool.splice(pool.indexOf(p), 1); });
      }
      const postMan = pool.pop();
      if (postMan) { const a = abs(t, { x: L - 0.8, y: 34 + near * 4.2 }); postMan.x = a.x; postMan.y = a.y; }
      if (def === 'zonal') { // best headers on the spots nearest the goal
        const spots = [{ x: L - 3, y: 34 + near * 2 }, { x: L - 3, y: 34 - near * 2 }, { x: L - 3.5, y: 34 - near * 5.5 }, { x: L - 8, y: 34 + near * 1 },
          { x: L - 8.5, y: 34 - near * 4 }, { x: L - 12, y: 34 + near * 3 }, { x: L - 13, y: 34 - near * 6 }];
        for (const sp of spots) { const d = pool.shift(); if (!d) break; const a = abs(t, sp); d.x = a.x; d.y = a.y; }
      } else {
        const inBox = rest.filter((p) => FB.inOppBox(rel(t, p)));
        for (const ap of inBox) {
          const d = pool.shift();
          if (!d) break;
          const ar = rel(t, ap);
          const a = abs(t, { x: ar.x + 1.1, y: ar.y + (34 - ar.y) * 0.08 });
          d.x = a.x; d.y = a.y;
        }
      }
      pool.forEach((d, i) => {
        const r = i < 2 ? { x: 88, y: 34 + (i ? 8 : -8) } : { x: 66 + i * 2, y: 34 + (i % 2 ? 10 : -10) };
        const a = abs(t, r); d.x = a.x; d.y = a.y;
      });
      taker.x = spot.x; taker.y = spot.y;
      setCarrier(m, taker);
      for (const p of m.players) moves[p.id] = { x: p.x, y: p.y };
      return moves;
    }
    // throwin / goalkick / freekick: place carrier then run shape (uncapped-ish)
    let carrier;
    if (R.type === 'goalkick') {
      carrier = active(m, t).find((p) => p.role === 'GK');
      const a = abs(t, { x: 5.5, y: 34 + (R.pos && rel(t, R.pos).y < 34 ? -6 : 6) });
      carrier.x = a.x; carrier.y = a.y;
    } else {
      const cands = active(m, t).filter((p) => p.role !== 'GK' || R.type === 'freekick' && rel(t, R.pos).x < 20);
      carrier = nearestOf(cands, R.pos);
      carrier.x = R.pos.x; carrier.y = R.pos.y;
    }
    setCarrier(m, carrier);
    for (const team of [o, t]) {
      const tg = shapeTargets(m, team);
      for (const id in tg) { const p = P(m, +id); moveTowards(p, tg[id], speed(p) * 3.2); }
    }
    if (R.type === 'goalkick') {
      for (const p of active(m, o)) {
        const r = rel(t, p);
        if (r.x < 18 && Math.abs(r.y - 34) < 21) { const a = abs(t, { x: 18.5, y: r.y }); p.x = a.x; p.y = a.y; }
      }
    }
    if (R.type === 'throwin') pushOut(m, o, m.ball, 2.5);
    if (R.type === 'freekick') {
      pushOut(m, o, m.ball, 9.15);
      const br = rel(t, m.ball);
      if (br.x >= 74 && Math.abs(br.y - 34) <= 22 && !FB.inOppBox(br)) {
        const g = { x: L, y: 34 };
        const u = { x: (g.x - br.x) / Math.hypot(g.x - br.x, g.y - br.y), y: (g.y - br.y) / Math.hypot(g.x - br.x, g.y - br.y) };
        const wc = { x: br.x + u.x * 9.15, y: br.y + u.y * 9.15 };
        const n = Math.abs(br.y - 34) < 10 ? 4 : 3;
        const wallers = active(m, o).filter((p) => p.role !== 'GK').sort((a, b) => dist(a, abs(t, wc)) - dist(b, abs(t, wc))).slice(0, n);
        wallers.forEach((p, i) => {
          const off = (i - (n - 1) / 2) * 0.75;
          const a = abs(t, { x: wc.x - u.y * off * 0, y: wc.y + off });
          const a2 = abs(t, { x: wc.x + -u.y * off, y: wc.y + u.x * off });
          p.x = a2.x; p.y = a2.y; void a;
        });
        R.direct = true;
        m.wall = wallers.map((p) => p.id);
      }
    }
    for (const p of m.players) moves[p.id] = { x: p.x, y: p.y };
    return moves;
  }

  // ------------------------------------------------------------------ beat flow
  FB.startBeat = function (m) {
    m.beat++;
    m.runMade = null;
    m.beaten.clear();
    if (m.downed != null) { m.beaten.add(m.downed); m.downed = null; }
    m.marks = {};
    m.trapped = null;
    m.cover = null;
    m.wall = null;
    m.setPiece = null;
    m.possStreak = m.lastPossTeam === m.poss ? (m.possStreak || 0) + 1 : 0;
    m.lastPossTeam = m.poss;
    m.beatStart = { time: m.time, poss: m.poss };
    m.quick = 0; m.quickOk = false; m.softPass = false;
    m.counter = false; m.counterOk = false; m.counters = 0;
    m.defAct = null;
    const tl = [];
    let needDefense = true;
    if (m.restart) {
      const type = m.restart.type;
      const team = m.restart.team;
      m.markOrders = [null, null];
      if (type === 'kickoff') say(m, m.half === 2 && m.time === HALF && m.score[0] + m.score[1] === m.goalsAtHalf ? 'kickoff2' : (m.goals.length && m.lastGoalTeam !== team ? 'restartGoal' : 'kickoff'), { t: m.teams[team].name, team });
      const moves = setupRestart(m);
      tl.push({ dur: type === 'kickoff' ? 0.4 : 0.9, moves, owner: m.carrier, ball: { x: m.ball.x, y: m.ball.y, arc: 0 }, setup: true });
      needDefense = type === 'throwin' || type === 'goalkick';
    } else {
      m.markOrders = m.markOrders.map((o) => (o && o.left > 0 ? { d: o.d, a: o.a, left: o.left - 1 } : null));
      const moves = shapeStep(m);
      tl.push({ dur: 0.6, moves, owner: m.carrier });
    }
    m.runs = [null, null]; // a called run lasts one shape step (and a restart cancels it)
    m.phase = needDefense ? 'defense' : (m.setPiece && m.setPiece.type === 'penalty' ? 'penalty' : 'attack');
    return { tl, needDefense, penalty: m.phase === 'penalty' };
  };

  // ------------------------------------------------------------------ defense
  FB.defenseOptions = function (m) {
    const c = carrierP(m);
    const t = opp(m.poss);
    const ps = active(m, t).filter((p) => p.role !== 'GK' && !m.beaten.has(p.id));
    return {
      press: ps.filter((p) => dist(p, c) <= TUNE.pressRange).map((p) => p.id),
      cover: ps.filter((p) => dist(p, c) <= TUNE.pressRange).map((p) => p.id),
      tackle: ps.filter((p) => dist(p, c) <= TUNE.tackleRange).map((p) => p.id),
      mark: ps.map((p) => p.id),
      targets: active(m, m.poss).filter((p) => p.id !== m.carrier && p.role !== 'GK').map((p) => p.id),
    };
  };

  function tackleOdds(m, d, c) {
    const dd = dist(d, c);
    const pWin = clamp(0.4 - 0.05 * dd + (d.attrs.tackle - c.attrs.dribble) * 0.007, 0.08, 0.52);
    const pFoul = clamp(0.17 + 0.02 * dd, 0.14, 0.3);
    return { pWin, pFoul, pBeat: 1 - pWin - pFoul, dist: dd };
  }
  FB.tackleOdds = (m, id) => tackleOdds(m, P(m, id), carrierP(m));

  function lastMan(m, d, c) {
    // no other outfield defender goal-side of the carrier
    const t = d.team;
    const cr = rel(t, c);
    return !active(m, t).some((p) => p !== d && p.role !== 'GK' && rel(t, p).x < cr.x - 1);
  }

  /** Where a covering player of team t stands: goal-side of p, at arm's length from a press. */
  function coverSpot(p, t) {
    const u = unit(p, ownGoal(t));
    return clampPitch({ x: p.x + u.x * TUNE.coverGap, y: p.y + u.y * TUNE.coverGap });
  }

  /** Team t's standing mark ({ d, a, left: beats it goes on after this one }), or null. */
  FB.liveMark = (m, t) => m.markOrders[t];
  /**
   * Who the defending side has marking a man once this plan is given, or null. One mark at a time: a new order replaces the
   * old one, and giving the marker another job (or act.unmark) ends it.
   */
  FB.markerAfter = function (m, act) {
    const o = m.markOrders[opp(m.poss)];
    const d = act.mark && act.mark.d != null && act.mark.a != null ? act.mark.d : o && !act.unmark ? o.d : null;
    return d != null && d !== act.press && d !== act.tackle && d !== act.cover ? d : null;
  };

  /** Apply defensive moves (no randomness except tackle). Returns {tl, ended} */
  FB.applyDefense = function (m, act, hypothetical) {
    act = act || {};
    const c = carrierP(m);
    const t = opp(m.poss);
    const moves = {};
    const tl = [];
    if (act.line && !hypothetical) m.lines[t] = act.line;
    const marker = FB.markerAfter(m, act), old = m.markOrders[t];
    if (old && (marker !== old.d || act.mark && act.mark.a !== old.a)) delete m.marks[old.a];
    if (act.trap) {
      m.trapped = new Set();
      for (const p of active(m, t)) {
        if (p.role !== 'DF' || p.id === marker) continue; // a marker stays with his man
        const r = rel(t, p);
        const cr = rel(t, c);
        const nx = Math.min(r.x + 4, cr.x - 1.5);
        if (nx > r.x) { const a = abs(t, { x: nx, y: r.y }); p.x = a.x; p.y = a.y; moves[p.id] = { x: p.x, y: p.y }; m.trapped.add(p.id); }
      }
    }
    if (act.mark && act.mark.d != null && act.mark.a != null) {
      const d = P(m, act.mark.d), a = P(m, act.mark.a);
      moveTowards(d, markSpot(a, t), TUNE.markMove);
      m.marks[a.id] = d.id;
      moves[d.id] = { x: d.x, y: d.y };
    }
    if (act.press != null) {
      const d = P(m, act.press);
      const u = unit(c, ownGoal(t));
      const tgt = clampPitch({ x: c.x + u.x * 1.5, y: c.y + u.y * 1.5 });
      moveTowards(d, tgt, TUNE.pressMove);
      moves[d.id] = { x: d.x, y: d.y };
    }
    if (act.cover != null && act.press == null && act.tackle == null) {
      const d = P(m, act.cover);
      moveTowards(d, coverSpot(c, t), TUNE.pressMove);
      m.cover = { id: d.id, used: false };
      moves[d.id] = { x: d.x, y: d.y };
    }
    if (hypothetical) return null;
    if (marker == null) m.markOrders[t] = null;
    else if (act.mark) m.markOrders[t] = { d: act.mark.d, a: act.mark.a, left: TUNE.markBeats };
    m.defAct = act;
    if (Object.keys(moves).length) tl.push({ dur: 0.5, moves, owner: m.carrier });
    let ended = false;
    if (act.tackle != null) {
      const d = P(m, act.tackle);
      const o = tackleOdds(m, d, c);
      const r = m.rng();
      const contact = { x: lerp(d.x, c.x, 0.85), y: lerp(d.y, c.y, 0.85) };
      if (r < o.pWin) {
        d.x = c.x; d.y = c.y;
        m.stats[t].tackles++;
        say(m, 'tackleWon', { c: ctxP(d), a: ctxP(c), team: t }, 'good');
        tl.push({ dur: 0.55, moves: { [d.id]: { x: c.x, y: c.y }, [c.id]: { x: c.x - unit(c, d).x * 1.5, y: c.y - unit(c, d).y * 1.5 } }, owner: d.id, fx: 'tackle', caption: `Tackle won (${pct(o.pWin)} chance)` });
        c.x -= unit(c, d).x * 1.5; c.y -= unit(c, d).y * 1.5;
        c.recover = 2; m.downed = c.id;
        turnover(m, d, 'tackle');
        momentum(m, t, 0.05);
        ended = true;
        m.cost = TUNE.cost.tackle;
      } else if (r < o.pWin + o.pFoul) {
        d.x = contact.x; d.y = contact.y;
        tl.push({ dur: 0.55, moves: { [d.id]: contact }, owner: c.id, fx: 'foul', sfx: 'whistle', caption: `Foul! (${pct(o.pFoul)} risk)` });
        foul(m, d, c, { x: c.x, y: c.y }, 'lunge');
        ended = true;
        m.cost = TUNE.cost.tackle;
      } else {
        d.x = contact.x; d.y = contact.y;
        m.beaten.add(d.id); d.recover = 2;
        say(m, 'tackleBeat', { c: ctxP(d), a: ctxP(c), team: m.poss }, 'bad');
        tl.push({ dur: 0.55, moves: { [d.id]: contact }, owner: c.id, fx: 'beaten', fxId: d.id, caption: `${d.name} beaten! (${pct(o.pBeat)})` });
      }
    }
    m.phase = ended ? 'done' : 'attack';
    syncBall(m, tl);
    return { tl, ended };
  };

  // ------------------------------------------------------------------ lane / shot models
  /** A marker watches his man: he doesn't cut out a ball meant for anyone else (`to`). Returns his id, or -1. */
  function busyMarker(m, to) {
    for (const a in m.marks) if (+a !== to && +a !== m.carrier) return m.marks[a];
    return -1;
  }
  function laneRisk(m, from, to, atkTeam, ballSpeed, opt) {
    opt = opt || {};
    const D = dist(from, to);
    const list = [];
    const endT = opt.endT != null ? opt.endT : 0.97;
    const marker = opt.to != null ? busyMarker(m, opt.to) : -1;
    for (const o of active(m, opp(atkTeam))) {
      if (m.beaten.has(o.id) || o.id === marker) continue;
      if (opt.exclude && opt.exclude.has(o.id)) continue;
      const sd = segDist(from, to, o);
      if (sd.t >= endT) continue;
      if (opt.startT != null && sd.t < opt.startT) continue;
      const s = sd.t * D;
      const T = s / ballSpeed + TUNE.react;
      let R = TUNE.reach0 + T * TUNE.reachRate;
      if (o.role === 'GK') { if (!FB.inOppBox(rel(atkTeam, sd.q))) continue; R *= 1.15; }
      else {
        const ox = rel(o.team, o).x, lf = lineFx(m, o.team);
        R *= ox < 35 ? lf.ownThird : ox < 70 ? lf.midThird : 1;
      }
      if (opt.maxR) R = Math.min(R, opt.maxR);
      if (sd.d >= R) continue;
      let pi = TUNE.intBase * Math.pow(1 - sd.d / R, 1.5) * (0.8 + o.attrs.tackle * 0.004);
      if (s < 3.5) pi *= Math.max(0.2, s / 3.5); // passer can bend it round a close presser
      list.push({ id: o.id, p: clamp(pi, 0, 0.92), t: sd.t, q: sd.q, d: sd.d });
    }
    list.sort((a, b) => a.t - b.t);
    let keep = 1;
    for (const x of list) keep *= 1 - x.p;
    return { p: 1 - keep, list };
  }

  function shotModel(m, s, pos, o) {
    o = o || {};
    const t = s.team;
    const r = rel(t, pos);
    const base = FB.xgBase(r);
    const pr = o.pressure != null ? o.pressure : pressureOn(m, s, pos);
    const skill = o.header ? s.attrs.head : s.attrs.shoot;
    const kind = o.header ? 'header' : o.kind || 'placed';
    const K = TUNE.shot[kind] || TUNE.shot.placed;
    let xg = base * (0.8 + 0.01 * (skill - 65)) * (1 - TUNE.shotPressure * Math.min(1, pr));
    if (o.header) xg *= 0.27 * (o.corner ? TUNE.corner.header : 1);
    if (o.setPiece) xg *= 0.85;
    const dGoal = Math.hypot(L - r.x, 34 - r.y);
    if (kind === 'driven') xg *= clamp(1 + K.range * (dGoal - K.from), K.min, K.max);
    const gk = active(m, opp(t)).find((p) => p.role === 'GK');
    const off = gk ? keeperOff(gk, t) : 0;
    if (gk) {
      xg *= 1 - (gk.attrs.gk - 72) * 0.008;
      if (kind === 'chip') xg *= Math.min(K.max, K.base + K.perM * (off - K.off));
      // keeper off his line → lob/empty-net bonus
      else if (off > 7) xg = Math.min(0.9, xg * (1 + (off - 7) * 0.08));
    } else xg = Math.min(0.95, xg * 2.5);
    xg = clamp(xg, 0.003, 0.9);
    // blockers
    const g = abs(t, { x: L, y: 34 });
    const lineBlock = lineFx(m, opp(t)).block;
    let keep = 1; const blockers = [];
    if (!o.header) {
      for (const d of active(m, opp(t))) {
        if (d.role === 'GK' || m.beaten.has(d.id)) continue;
        const sd = segDist(pos, g, d);
        const along = sd.t * dist(pos, g);
        if (along < 0.6 || along > 14) continue;
        const width = 0.9 + along * 0.06;
        if (sd.d > width) continue;
        let pb = 0.3 * (1 - sd.d / width) * (along < 3 ? 1 : 3 / along * 0.6 + 0.4);
        if (o.setPiece) pb *= 0.35; else pb *= lineBlock;
        if (K.block) pb = Math.min(0.6, pb * K.block);
        blockers.push({ id: d.id, p: pb });
        keep *= 1 - pb;
      }
    }
    const pBlock = Math.min(0.5, 1 - keep);
    let pOn = clamp(0.27 + 1.35 * xg + 0.003 * (skill - 65), xg + 0.05, 0.93);
    if (kind === 'driven') pOn = clamp(pOn - K.onTarget, xg + 0.03, 0.93);
    else if (kind === 'chip') pOn = Math.min(0.93, xg + K.saves);
    const save = (K.save || TUNE.shot.placed.save);
    return { xg, pBlock, pOn, blockers, base, pressure: pr, goal: (1 - pBlock) * xg, lineBlock, kind, keeperOff: off, dGoal,
      held: save[0], pushed: save[1], rebound: 1 - save[0] - save[1] };
  }
  FB.shotModel = shotModel;
  /** How a team defends corners from now on: 'man', 'zonal' or 'up2' (two left upfield). Returns false if not allowed. */
  FB.setCornerDef = function (m, team, def) {
    if (!TUNE.corner.defs.includes(def) || (team !== 0 && team !== 1)) return false;
    m.cornerDef[team] = def;
    return true;
  };
  /** How far (m) a keeper stands off his line, from the middle of his goal. */
  function keeperOff(gk, atkTeam) { const gr = rel(atkTeam, gk); return Math.hypot(L - gr.x, 34 - gr.y); }
  /** Which shot kinds the carrier can try now (null when he can't shoot). A chip needs the keeper off his line. */
  FB.shotKinds = function (m) {
    if (!FB.allowedActions(m).shoot) return null;
    const c = carrierP(m);
    const gk = active(m, opp(c.team)).find((p) => p.role === 'GK');
    const chip = !!gk && !m.setPiece && keeperOff(gk, c.team) > TUNE.shot.chip.off;
    return TUNE.shotKinds.filter((k) => k !== 'chip' || chip);
  };

  const pct = (p) => `${Math.round(p * 100)}%`;
  FB.pct = pct;

  // ------------------------------------------------------------------ loose balls
  /** Eight points standing in for scatter(): angles all round, radii from its 0.4-1.2 range. */
  const SCATTER_PTS = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI * 2 * (i + 0.5)) / 8, r = i % 2 ? 0.6 : 1;
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
  // scratch, reused between calls (evaluate runs this very often)
  const RUN = { x: new Float64Array(22), y: new Float64Array(22), v: new Float64Array(22), wait: new Float64Array(22), t: new Float64Array(22), near: new Int32Array(22) };
  /**
   * Chance that `team` (who touched it last) comes out with a ball running loose around pos. Pure: an estimate of the
   * race in looseBall(). o.spread = scatter (m), o.exclude = id of a player who can't go for it, o.at = [[player, position]]
   * for up to two players who will have moved by then. A ball out of play counts as lost.
   */
  FB.looseKeep = function (m, pos, team, o) {
    const [a, b] = o.at || [];
    return keepRace(m, pos, team, o.spread || 0, o.exclude, a && a[0], a && a[1], b && b[0], b && b[1]);
  };
  function keepRace(m, pos, team, spread, exclude, p1, at1, p2, at2) {
    const { x, y, v, wait, t, near } = RUN, reach = TUNE.loose.reach;
    const players = m.players, N = players.length, anyBeaten = m.beaten.size > 0;
    const px = pos.x, py = pos.y;
    let first = 1e9;
    for (let i = 0; i < N; i++) {
      const p = players[i];
      t[i] = 1e9;
      if (p.off || i === exclude) continue;
      const pt = p === p1 ? at1 : p === p2 ? at2 : p;
      const gk = p.role === 'GK';
      const ax = pt.x, ay = pt.y, dx = ax - px, dy = ay - py;
      const iv = 1 / speed(p), w = anyBeaten && m.beaten.has(i) ? TUNE.loose.down : 0;
      const ti = Math.sqrt(dx * dx + dy * dy) * iv + w;
      x[i] = ax; y[i] = ay; v[i] = iv; wait[i] = w; t[i] = ti;
      if (!gk && ti < first) first = ti;
    }
    const limit = first + (1.2 * spread) / 5.5 + reach; // leaving out anyone slower makes no difference
    let n = 0;
    for (let i = 0; i < N; i++) if (t[i] < limit) near[n++] = i;
    let sum = 0;
    for (let k = 0; k < SCATTER_PTS.length; k++) {
      const qx = px + SCATTER_PTS[k][0] * spread, qy = py + SCATTER_PTS[k][1] * spread;
      if (qx < 0 || qx > L || qy < 0 || qy > W) continue;
      let best = 1e9;
      for (let j = 0; j < n; j++) {
        const i = near[j], p = players[i];
        if (p.role === 'GK' && !FB.inOppBox(rel(opp(p.team), { x: qx, y: qy }))) { t[i] = 1e9; continue; }
        const dx = x[i] - qx, dy = y[i] - qy;
        const ti = Math.sqrt(dx * dx + dy * dy) * v[i] + wait[i];
        t[i] = ti;
        if (ti < best) best = ti;
      }
      let ours = 0, all = 0;
      for (let j = 0; j < n; j++) {
        const i = near[j], z = reach + best - t[i];
        if (z <= 0) continue;
        const w = z * z * z;
        all += w;
        if (i < 11 === (team === 0)) ours += w;
      }
      if (all > 0) sum += ours / all;
    }
    return sum / SCATTER_PTS.length;
  }
  // how evaluate() uses it: the same spots, scatter and movement as the resolver
  const missKeep = (m, c, T, spread) => keepRace(m, T, c.team, spread, c.id);
  const touchKeep = (m, r, T, spread, rival, k) => keepRace(m, T, r.team, spread, -1, r, T, rival, rival ? lerp2(rival, T, k) : null);

  // ------------------------------------------------------------------ attack options
  FB.allowedActions = function (m) {
    const sp = m.setPiece && m.setPiece.type;
    const c = carrierP(m);
    const cr = rel(c.team, c);
    const canShoot = cr.x > 68 && (!sp || (sp === 'freekick' && m.setPiece.direct));
    if (sp === 'throwin' || sp === 'goalkick' || sp === 'corner') return { pass: true, through: sp !== 'corner', lob: true, dribble: false, shoot: false };
    if (sp === 'kickoff') return { pass: true, through: false, lob: true, dribble: false, shoot: false };
    if (sp === 'freekick') return { pass: true, through: true, lob: true, dribble: false, shoot: canShoot };
    if (m.quick) return { pass: true, through: true, lob: true, dribble: false, shoot: canShoot };
    return { pass: true, through: true, lob: true, dribble: true, shoot: canShoot };
  };

  /** Evaluate an attacking action. Pure (no state change). */
  FB.evaluate = function (m, a) {
    const c = carrierP(m);
    if (!c) return { valid: false, reason: 'No carrier' };
    const allowed = FB.allowedActions(m);
    if (a.type !== 'clear' && !allowed[a.type === 'cross' ? 'lob' : a.type]) return { valid: false, reason: 'Not allowed from this restart' };
    const mom = (c.team === 0 ? m.momentum : -m.momentum) * 0.02 - (m.quick ? FB.quickPenalty(m) : 0);
    const pc = pressureOn(m, c);
    const sp = m.setPiece && m.setPiece.type;
    const SC = TUNE.loose.scatter;
    if (a.type === 'pass') {
      const r = P(m, a.to);
      if (!r || r.team !== c.team || r === c || r.off) return { valid: false, reason: 'Pick a teammate' };
      const d = dist(c, r);
      const max = sp === 'throwin' ? TUNE.throwMax : TUNE.passMax;
      if (d > max) return { valid: false, reason: `Too far for a ground pass (${Math.round(d)} m). Try a lofted pass.` };
      const offP = offsideProb(m, r);
      const exec = clamp(1.0 - 0.003 * d - 0.07 * pc + (c.attrs.pass - 70) * 0.003 + mom, 0.45, 0.99);
      const lane = laneRisk(m, c, r, c.team, 17, { to: r.id });
      let pr = pressureOn(m, r);
      const markedBy = m.marks[r.id] != null && dist(P(m, m.marks[r.id]), r) < TUNE.markTight ? m.marks[r.id] : null;
      if (markedBy != null) pr = Math.min(1.2, pr + TUNE.markPress);
      const ctrl = clamp(0.975 - 0.2 * pr - Math.max(0, d - 28) * 0.004 + (r.attrs.dribble - 70) * 0.002, 0.5, 0.99);
      const pClean = exec * (1 - lane.p);
      const pSucc = pClean * ctrl * (1 - offP);
      const outcomes = [
        { p: pSucc, k: 'keep', pos: { x: r.x, y: r.y }, pressure: pr, id: r.id },
        { p: pClean * (1 - ctrl) * (1 - offP), k: 'loose', pos: { x: r.x, y: r.y }, keep: touchKeep(m, r, r, SC.passTouch) },
        { p: pClean * offP, k: 'offside', pos: { x: r.x, y: r.y } },
        { p: (1 - exec), k: 'loose', pos: { x: r.x, y: r.y }, keep: missKeep(m, c, r, SC.passMiss) },
        { p: exec * lane.p, k: 'lose', pos: lane.list[0] ? lane.list[0].q : r }];
      return { valid: true, type: 'pass', p: pSucc, exec, lane, ctrl, recvPressure: pr, markedBy, offP, d, outcomes, target: { x: r.x, y: r.y }, recv: r.id,
        threats: lane.list.filter((x) => x.p > 0.05).map((x) => x.id) };
    }
    if (a.type === 'through') {
      const T = a.target;
      if (!T || !FB.inPitch(T) || T.x < 0.5 || T.x > L - 0.5) return { valid: false, reason: 'Aim inside the pitch' };
      const dP = dist(c, T);
      if (dP > TUNE.throughMax) return { valid: false, reason: 'Too far for a through ball' };
      if (dP < 6) return { valid: false, reason: 'Too short — just pass it' };
      // runner: given or best candidate
      let r = a.runner != null ? P(m, a.runner) : null;
      const cands = active(m, c.team).filter((p) => p !== c && p.role !== 'GK');
      if (!r) {
        let best = 1e9;
        for (const p of cands) {
          const tt = dist(p, T) / speed(p) + offsideProb(m, p) * 3;
          if (tt < best) { best = tt; r = p; }
        }
      }
      if (!r) return { valid: false, reason: 'Nobody to run onto it' };
      const dRun = dist(r, T);
      if (dRun > 20) return { valid: false, reason: 'No teammate can reach that space' };
      const offP = offsideProb(m, r);
      const ballT = dP / 18 + 0.1;
      const runStart = m.runMade && m.runMade.kind === 'behind' && m.runMade.id === r.id && !m.quick ? TUNE.runStart : 0;
      const runT = Math.max(0, dRun / (speed(r) * 1.08) - runStart);
      let defT = 99, chaser = null, facing = false;
      const lineReact = lineFx(m, opp(c.team)).react;
      const dGoal = ownGoal(opp(c.team)), tGoal = dist(T, dGoal);
      for (const o of active(m, opp(c.team))) {
        if (m.beaten.has(o.id)) continue;
        let tt, face = false;
        if (o.role === 'GK') {
          if (!FB.inOppBox(rel(c.team, T))) continue;
          tt = dist(o, T) / 6.2 + 0.25 - (o.attrs.gk - 70) * 0.004;
        } else {
          face = dist(o, dGoal) < tGoal; // goal-side of the target: he needn't turn
          tt = dist(o, T) / speed(o) + (face ? TUNE.faceReact : TUNE.turnReact) + lineReact + (m.trapped && m.trapped.has(o.id) ? TUNE.trapReact : 0);
        }
        if (tt < defT) { defT = tt; chaser = o; facing = face; }
      }
      const arrive = Math.max(ballT, runT);
      const pRace = sigmoid((defT - arrive) / 0.32);
      const lane = laneRisk(m, c, T, c.team, 16, { to: r.id, endT: 0.8, exclude: chaser ? new Set([chaser.id]) : null });
      const exec = clamp(0.985 - 0.003 * dP - 0.08 * pc + (c.attrs.pass - 70) * 0.004 + mom, 0.45, 0.975);
      const ctrl = clamp(0.92 + (r.attrs.dribble - 70) * 0.002 - (runT > ballT + 1 ? 0.08 : 0), 0.6, 0.97);
      const pClean = exec * (1 - lane.p);
      const on = 1 - offP;
      const pSucc = pClean * pRace * ctrl * on;
      const outcomes = [
        { p: pSucc, k: 'keep', pos: T, pressure: chaser ? clamp((6 - Math.max(0, (defT - arrive) * 6)) / 5, 0, 1) : 0, id: r.id },
        { p: pClean * pRace * (1 - ctrl) * on, k: 'loose', pos: T, keep: touchKeep(m, r, T, SC.throughTouch, chaser, 0.7) },
        { p: pClean * (1 - pRace) * on, k: 'lose', pos: T },
        { p: pClean * offP, k: 'offside', pos: { x: r.x, y: r.y } }];
      outcomes.push({ p: 1 - exec, k: 'loose', pos: T, keep: missKeep(m, c, T, SC.throughMiss) });
      outcomes.push({ p: exec * lane.p, k: 'lose', pos: lane.list[0] ? lane.list[0].q : T });
      return { valid: true, type: 'through', p: pSucc, exec, lane, pRace, ctrl, offP, runner: r.id, chaser: chaser && chaser.id,
        runT, runStart, defT, ballT, d: dP, outcomes, target: T, facing, lineReact: chaser && chaser.role !== 'GK' ? lineReact : 0,
        trapReact: chaser && m.trapped && m.trapped.has(chaser.id) ? TUNE.trapReact : 0, threats: lane.list.filter((x) => x.p > 0.05).map((x) => x.id).concat(chaser ? [chaser.id] : []) };
    }
    if (a.type === 'lob' || a.type === 'cross') {
      let T = a.target, r = null;
      if (a.to != null) { r = P(m, a.to); if (!r || r.team !== c.team || r === c) return { valid: false, reason: 'Pick a teammate' }; T = { x: r.x, y: r.y }; }
      if (!T || !FB.inPitch(T)) return { valid: false, reason: 'Aim inside the pitch' };
      const dP = dist(c, T);
      const max = sp === 'throwin' ? TUNE.throwMax : TUNE.lobMax;
      if (dP > max) return { valid: false, reason: 'Too far' };
      if (dP < 10) return { valid: false, reason: 'Too short for a lofted ball' };
      if (!r) {
        let bd = 1e9;
        for (const p of active(m, c.team)) {
          if (p === c || p.role === 'GK') continue;
          const d = dist(p, T); if (d < bd) { bd = d; r = p; }
        }
        if (!r || dist(r, T) > 13) return { valid: false, reason: 'No teammate near that spot' };
      }
      const offP = offsideProb(m, r);
      const on = 1 - offP;
      const hang = dP / 14 + 0.6;
      const tA = Math.max(0, dist(r, T) - 1) / speed(r);
      let tD = 99, duel = null;
      const corner = sp === 'corner';
      const zonal = corner && m.cornerDef[opp(c.team)] === 'zonal';
      const aerial = FB.inOppBox(rel(c.team, T)) ? lineFx(m, opp(c.team)).aerial + (zonal ? TUNE.corner.zonalAerial : 0) : 0;
      for (const o of active(m, opp(c.team))) {
        if (o.role === 'GK' || m.beaten.has(o.id)) continue;
        const tt = Math.max(0, dist(o, T) - 1) / speed(o) + 0.12 - aerial;
        if (tt < tD) { tD = tt; duel = o; }
      }
      let pWin;
      if (tD > hang + 0.7 && tA <= hang + 0.3) pWin = 0.95;
      else pWin = clamp(sigmoid((tD - tA) / 0.45 + (r.attrs.head - (duel ? duel.attrs.head : 60)) * 0.03), 0.05, 0.95);
      const Tr = rel(c.team, T);
      let pClaim = 0;
      const gk = active(m, opp(c.team)).find((p) => p.role === 'GK');
      if (gk && FB.inOppBox(Tr)) {
        const dG = dist(gk, T);
        pClaim = clamp((Tr.x > L - 6 && Math.abs(Tr.y - 34) < 10 ? 0.75 : 0.5) - dG * 0.075 + (gk.attrs.gk - 70) * 0.005, 0, 0.75);
      }
      const exec = clamp(0.95 - 0.003 * dP - 0.06 * pc + (c.attrs.pass - 70) * 0.004 + mom, 0.4, 0.95);
      const charge = laneRisk(m, c, T, c.team, 14, { endT: 0.1, maxR: 2.5 });
      const header = FB.inOppBox(Tr) && Tr.x >= 89 && sp !== 'throwin';
      const pc0 = exec * (1 - charge.p);
      const outcomes = [];
      let shot = null, pSucc, ctrl = 1;
      if (offP > 0) outcomes.push({ p: pc0 * offP, k: 'offside', pos: { x: r.x, y: r.y } });
      if (header) {
        shot = shotModel(m, r, T, { header: true, corner, pressure: duel ? clamp((6 - dist(duel, T)) / 5, 0, 1) * 0.6 : 0 });
        const pH = pc0 * on * (1 - pClaim) * pWin;
        pSucc = pH; // winning the header
        outcomes.push({ p: pH * shot.xg, k: 'goal' });
        outcomes.push({ p: pH * (shot.pOn - shot.xg), k: 'saved' });
        outcomes.push({ p: pH * (1 - shot.pOn), k: 'wide' });
        outcomes.push({ p: pc0 * on * pClaim, k: 'lose', pos: T, gk: true });
        outcomes.push({ p: pc0 * on * (1 - pClaim) * (1 - pWin), k: 'clear', pos: T });
      } else {
        ctrl = clamp(0.88 - 0.15 * pressureOn(m, r, T) + (r.attrs.dribble - 70) * 0.002, 0.55, 0.95);
        pSucc = pc0 * on * (1 - pClaim) * pWin * ctrl;
        outcomes.push({ p: pSucc, k: 'keep', pos: T, pressure: pressureOn(m, r, T), id: r.id });
        outcomes.push({ p: pc0 * on * (1 - pClaim) * pWin * (1 - ctrl), k: 'loose', pos: T, keep: touchKeep(m, r, T, SC.lobTouch, duel, 0.75) });
        outcomes.push({ p: pc0 * on * pClaim, k: 'lose', pos: T, gk: true });
        outcomes.push({ p: pc0 * on * (1 - pClaim) * (1 - pWin), k: 'clear', pos: T });
      }
      outcomes.push({ p: 1 - exec, k: 'loose', pos: T, keep: missKeep(m, c, T, SC.lobMiss) });
      outcomes.push({ p: exec * charge.p, k: 'lose', pos: c });
      return { valid: true, type: 'lob', p: pSucc, exec, charge, pWin, pClaim, ctrl, header, shot, offP, recv: r.id, duel: duel && duel.id, aerial, corner, zonal,
        d: dP, outcomes, target: T, threats: (duel ? [duel.id] : []).concat(pClaim > 0.1 && gk ? [gk.id] : []) };
    }
    if (a.type === 'dribble') {
      const T = a.target;
      if (!T || T.x < 0.5 || T.x > L - 0.5 || T.y < 0.5 || T.y > W - 0.5) return { valid: false, reason: 'Stay on the pitch' };
      const dd = dist(c, T);
      const max = FB.dribbleMax(c);
      if (dd > max + 0.01) return { valid: false, reason: 'Too far to carry in one go' };
      if (dd < 1.5) return { valid: false, reason: 'Too short' };
      const ch = [];
      let keep = 1, pFoulT = 0;
      for (const o of active(m, opp(c.team))) {
        if (m.beaten.has(o.id) || o.role === 'GK' && !FB.inOppBox(rel(c.team, T))) continue;
        const sd = segDist(c, T, o);
        const jockey = m.cover && m.cover.id === o.id;
        const R = 2.3 + (o.attrs.pace - 60) * 0.02 + (jockey ? TUNE.jockeyReach : 0);
        if (sd.d >= R) continue;
        const s = 1 - sd.d / R;
        const pT = clamp(TUNE.drTk * s * (1 + (o.attrs.tackle - c.attrs.dribble) * 0.015), 0.02, 0.62);
        const pF = TUNE.drFoul * s * (FB.inOppBox(rel(c.team, sd.q)) ? 0.6 : 1) * (jockey ? TUNE.jockeyFoul : 1);
        ch.push({ id: o.id, pT, pF, t: sd.t, q: sd.q, jockey });
      }
      ch.sort((a2, b) => a2.t - b.t);
      const lose = clamp(0.03 + dd * 0.003 + 0.05 * pc - (c.attrs.dribble - 72) * 0.002, 0.02, 0.2);
      let surv = 1 - lose;
      const outcomes = [{ p: lose, k: 'loose', pos: T, keep: keepRace(m, lerp2(c, T, 1.3), c.team, SC.dribble, -1, c, lerp2(c, T, 0.8)) }];
      for (const x of ch) {
        outcomes.push({ p: surv * x.pT, k: 'lose', pos: x.q });
        outcomes.push({ p: surv * x.pF, k: 'foulFor', pos: x.q });
        pFoulT += surv * x.pF;
        surv *= 1 - x.pT - x.pF;
      }
      keep = surv;
      outcomes.push({ p: keep, k: 'keep', pos: T, pressure: FB.pressureAt(m, c.team, T, ch), id: c.id });
      return { valid: true, type: 'dribble', p: keep, pFoul: pFoulT, challengers: ch, lose, d: dd, outcomes, target: T, threats: ch.map((x) => x.id) };
    }
    if (a.type === 'clear') {
      const cr = rel(c.team, c);
      const T = abs(c.team, { x: clamp(cr.x + 42, 30, L - 8), y: clamp(cr.y + (34 - cr.y) * 0.4, 6, 62) });
      const charge = laneRisk(m, c, T, c.team, 14, { endT: 0.06, maxR: 2.2 });
      return { valid: true, type: 'clear', p: 1 - charge.p, charge, target: T, d: dist(c, T),
        outcomes: [{ p: 1 - charge.p, k: 'loose', pos: T, keep: missKeep(m, c, T, SC.clear) }, { p: charge.p, k: 'lose', pos: c }], threats: [] };
    }
    if (a.type === 'shoot') {
      if (!allowed.shoot) return { valid: false, reason: 'Too far to shoot' };
      const kind = a.kind || 'placed';
      if (!FB.shotKinds(m).includes(kind)) return { valid: false, reason: kind === 'chip' ? 'The keeper is on his line: no room to chip him' : 'Unknown kind of shot' };
      const s = shotModel(m, c, c, { setPiece: sp === 'freekick', kind });
      const outcomes = [
        { p: s.goal, k: 'goal' },
        { p: (1 - s.pBlock) * (s.pOn - s.xg), k: 'saved', rebound: s.rebound },
        { p: (1 - s.pBlock) * (1 - s.pOn), k: 'wide' },
        { p: s.pBlock, k: 'blocked', pos: c },
      ];
      return { valid: true, type: 'shoot', kind, p: s.goal, shot: s, outcomes, threats: s.blockers.map((b) => b.id) };
    }
    return { valid: false, reason: 'Unknown action' };
  };

  FB.dribbleMax = (c) => clamp(9.5 + (c.attrs.pace - 65) * 0.08, 7.5, 12);

  // ------------------------------------------------------------------ state transitions
  function momentum(m, team, amt) {
    m.momentum = clamp(m.momentum + (team === 0 ? amt : -amt), -1, 1);
  }

  function turnover(m, newP, how) {
    m.lastPasser = null;
    m.softPass = false;
    m.cover = null;
    m.trapped = null;
    m.markOrders = [null, null];
    m.runs = [null, null]; m.runMade = null;
    setCarrier(m, newP);
    if (how === 'intercept') m.stats[newP.team].interceptions++;
    // Winning the ball cleanly in open play (tackle or interception, not the keeper) lets the new
    // side break at once, before the opponent can regroup: one immediate action, no shape step.
    if ((how === 'tackle' || how === 'intercept') && newP.role !== 'GK' && (m.counters || 0) < TUNE.counterMax) {
      m.counterOk = true;
      m.quickOk = false; m.quick = 0;
      m.defAct = null; m.marks = {};
      m.beaten.clear();
      if (m.downed != null) m.beaten.add(m.downed); // the player who was tackled is still on the floor
    }
  }

  function foul(m, d, c, pos, kind) {
    const t = d.team;
    m.stats[t].fouls++;
    m.halfEvents.stops++;
    const inBox = FB.inOppBox(rel(c.team, pos));
    const dogso = lastMan(m, d, c) && rel(c.team, pos).x > 78 && Math.abs(rel(c.team, pos).y - 34) < 20;
    say(m, inBox ? 'penalty' : 'foul', { c: ctxP(d), a: ctxP(c), team: c.team }, inBox ? 'big' : 'foul');
    let card = null;
    const r = m.rng();
    if (dogso && r < 0.3) card = 'red';
    else if (r < (kind === 'lunge' ? 0.42 : 0.2) + (inBox ? 0.15 : 0)) card = 'yellow';
    if (card === 'yellow') {
      d.yellow++;
      m.stats[t].yellows++;
      m.halfEvents.cards++;
      if (d.yellow >= 2) card = 'red2';
      else say(m, 'yellow', { c: ctxP(d), team: t }, 'card');
    }
    if (card === 'red' || card === 'red2') {
      d.off = true; m.stats[t].reds++; m.halfEvents.cards++;
      d.x = L / 2; d.y = -6;
      say(m, 'red', { c: ctxP(d), team: t }, 'card');
      if (d.role === 'GK') {
        // an outfielder goes in goal
        const sub = active(m, t).sort((a2, b2) => a2.u - b2.u)[0];
        if (sub) { sub.role = 'GK'; sub.attrs.gk = 42; sub.u = 0; sub.v = 0.5; m.feed.push({ min: FB.clockText(m), text: `${sub.name} pulls on the goalkeeper gloves!`, kind: 'card' }); }
      }
    }
    m.lastCard = card ? { id: d.id, card } : null;
    m.restart = { type: inBox ? 'penalty' : 'freekick', team: c.team, pos: clampPitch(pos) };
    if (!inBox) say(m, 'freekick', { t: m.teams[c.team].name, team: c.team }, 'quiet');
    m.carrier = null;
    momentum(m, c.team, inBox ? 0.2 : 0.03);
  }

  function ballOut(m, pos, lastTeam) {
    m.ball = { x: clamp(pos.x, -1.5, L + 1.5), y: clamp(pos.y, -1, W + 1) };
    if (pos.y < 0 || pos.y > W) {
      const t = opp(lastTeam);
      m.restart = { type: 'throwin', team: t, pos: { x: clamp(pos.x, 1, L - 1), y: pos.y < 0 ? 0.3 : W - 0.3 } };
      say(m, 'throwin', { t: m.teams[t].name, team: t }, 'quiet');
    } else {
      const lineTeam = pos.x < 0 ? 0 : 1; // whose goal line
      if (lastTeam === lineTeam) {
        const t = opp(lineTeam);
        m.restart = { type: 'corner', team: t, pos: { x: pos.x < 0 ? 0 : L, y: pos.y < W / 2 ? 0 : W } };
        m.stats[t].corners++;
        say(m, 'corner', { t: m.teams[t].name, team: t }, 'quiet');
      } else {
        m.restart = { type: 'goalkick', team: lineTeam, pos: { x: pos.x < 0 ? 5 : L - 5, y: pos.y } };
        say(m, 'goalkick', { t: m.teams[lineTeam].name, team: lineTeam }, 'quiet');
      }
    }
    m.carrier = null;
    m.halfEvents.stops++;
  }

  /** Resolve a loose ball at pos. Returns step. lastTeam = team that touched it last. */
  function looseBall(m, pos, lastTeam, tl, exclude, keepBias) {
    if (!FB.inPitch(pos)) {
      tl.push({ dur: 0.5, ball: { x: pos.x, y: pos.y, arc: 1 }, owner: null });
      ballOut(m, pos, lastTeam);
      return null;
    }
    let best = null, bt = 1e9;
    for (const p of m.players) {
      if (p.off || (exclude && exclude.has(p.id))) continue;
      if (p.role === 'GK' && !FB.inOppBox(rel(opp(p.team), pos))) continue;
      let tt = dist(p, pos) / speed(p) + m.rng() * TUNE.loose.noise + (m.beaten.has(p.id) ? TUNE.loose.down : 0);
      if (keepBias && p.team === lastTeam) tt -= keepBias;
      if (tt < bt) { bt = tt; best = p; }
    }
    const moves = { [best.id]: { x: pos.x, y: pos.y } };
    best.x = pos.x; best.y = pos.y;
    tl.push({ dur: 0.45, moves, owner: best.id, ball: { x: pos.x, y: pos.y, arc: 0 } });
    if (best.team !== m.poss) { turnover(m, best, 'loose'); say(m, 'loose', { a: ctxP(best), t: m.teams[best.team].name, team: best.team }, 'bad'); }
    else { setCarrier(m, best); say(m, 'loose', { a: ctxP(best), t: m.teams[best.team].name, team: best.team }, 'quiet'); }
    return best;
  }

  function scatter(m, p, amount) {
    const a = m.rng() * Math.PI * 2, r = amount * (0.4 + m.rng() * 0.8);
    return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
  }

  function goalScored(m, scorer, tl, how) {
    const t = scorer.team;
    m.score[t]++;
    m.halfEvents.goals++;
    m.lastGoalTeam = t;
    const assist = m.lastPasser && m.lastPasser !== scorer.id && P(m, m.lastPasser).team === t ? P(m, m.lastPasser) : null;
    m.goals.push({ team: t, scorer: scorer.name, num: scorer.num, assist: assist ? assist.name : null, min: FB.clockText(m), how });
    const late = m.time > 2700 * 2 - 300;
    const equal = m.score[0] === m.score[1];
    say(m, late ? 'goalLate' : equal ? 'goalEqualiser' : 'goal', { a: ctxP(scorer), t: m.teams[t].name, team: t }, 'goal');
    momentum(m, t, 0.35);
    m.restart = { type: 'kickoff', team: opp(t) };
    m.carrier = null;
    m.justScored = { team: t, scorer: scorer.name };
    m.cost += TUNE.cost.goal;
  }

  /** Shot resolution (shared by shots and headers). */
  function resolveShot(m, s, pos, model, tl, opts) {
    const t = s.team;
    const st = m.stats[t];
    st.shots++; st.xg += model.goal;
    momentum(m, t, 0.06 + model.xg * 0.3);
    say(m, opts.header ? 'header' : model.kind === 'driven' ? 'shotDriven' : model.kind === 'chip' ? 'shotChip' : 'shot', { a: ctxP(s), b: ctxP(s), team: t }, 'shot');
    const gk = active(m, opp(t)).find((p) => p.role === 'GK');
    const r = m.rng();
    const g = abs(t, { x: L, y: 34 });
    // pick an aim point on the goal
    const aimY = 34 + (m.rng() - 0.5) * 6.4;
    const aimIn = abs(t, { x: L + 0.6, y: aimY });
    if (r < model.pBlock) {
      // blocked
      const b = model.blockers.length ? P(m, model.blockers.reduce((a, x) => (x.p > a.p ? x : a)).id) : null;
      const bp = b ? { x: b.x, y: b.y } : { x: lerp(pos.x, g.x, 0.15), y: pos.y };
      tl.push({ dur: 0.35, ball: { x: bp.x, y: bp.y, arc: 0.2 }, owner: null, fx: 'block', caption: `Blocked (${pct(model.pBlock)} block risk)` });
      say(m, 'blocked', { c: ctxP(b), team: opp(t) }, 'bad');
      if (m.rng() < 0.5) {
        const out = abs(t, { x: L + 1, y: rel(t, bp).y < 34 ? 10 : 58 });
        tl.push({ dur: 0.5, ball: { x: out.x, y: out.y, arc: 1 }, owner: null });
        ballOut(m, out, opp(t));
      } else {
        const lp = scatter(m, bp, 9);
        tl.push({ dur: 0.4, ball: { x: lp.x, y: lp.y, arc: 0.6 }, owner: null });
        looseBall(m, lp, opp(t), tl, null, 0);
      }
      return 'blocked';
    }
    const r2 = (r - model.pBlock) / (1 - model.pBlock);
    if (r2 < model.xg) {
      st.onTarget++;
      if (gk) tl.push({ dur: 0.0, moves: {} });
      const dive = gk ? { x: lerp(gk.x, aimIn.x, 0.6), y: lerp(gk.y, aimIn.y, 0.45) } : null;
      const step = { dur: 0.55, ball: { x: aimIn.x, y: aimIn.y, arc: opts.header ? 0.4 : 0.25 }, owner: null, fx: 'goal', sfx: 'goal',
        caption: `GOAL! (${pct(model.goal)} chance)`, moves: {} };
      if (dive) { step.moves[gk.id] = dive; gk.x = dive.x; gk.y = dive.y; }
      tl.push(step);
      m.ball = { x: aimIn.x, y: aimIn.y };
      goalScored(m, s, tl, opts.header ? 'header' : opts.setPiece ? 'free kick' : model.kind === 'chip' ? 'chip' : 'shot');
      return 'goal';
    }
    if (r2 < model.pOn) {
      st.onTarget++;
      if (gk) m.stats[gk.team].saves++;
      const sp = abs(t, { x: L - 0.8, y: clamp(aimY, 31, 37) });
      const step = { dur: 0.5, ball: { x: sp.x, y: sp.y, arc: 0.25 }, owner: null, fx: 'save', sfx: 'save',
        caption: `Saved! (${pct(model.pOn)} on target, ${pct(model.goal)} goal)`, moves: {} };
      if (gk) { step.moves[gk.id] = { x: sp.x, y: sp.y }; gk.x = sp.x; gk.y = sp.y; }
      tl.push(step);
      momentum(m, t, 0.05);
      const r3 = m.rng();
      if (!gk || r3 < model.held) {
        say(m, 'saved', { c: ctxP(gk), team: opp(t) }, 'save');
        if (gk) { m.restart = { type: 'goalkick', team: gk.team, pos: { x: gk.x, y: gk.y } }; m.carrier = null; m.ball = { x: gk.x, y: gk.y }; }
      } else if (r3 < model.held + model.pushed) {
        say(m, 'parried', { c: ctxP(gk), team: opp(t) }, 'save');
        const out = abs(t, { x: L + 1, y: aimY < 34 ? 28 : 40 });
        tl.push({ dur: 0.4, ball: { x: out.x, y: out.y, arc: 0.5 }, owner: null });
        ballOut(m, out, opp(t));
      } else {
        say(m, 'rebound', { c: ctxP(gk), team: opp(t) }, 'big');
        const lp = abs(t, { x: L - 6 - m.rng() * 6, y: 34 + (m.rng() - 0.5) * 16 });
        tl.push({ dur: 0.4, ball: { x: lp.x, y: lp.y, arc: 0.3 }, owner: null });
        looseBall(m, lp, opp(t), tl, gk ? new Set([gk.id]) : null, 0.25);
      }
      return 'saved';
    }
    // wide
    const wy = m.rng() < 0.5 ? 34 - 3.66 - 0.3 - m.rng() * 4 : 34 + 3.66 + 0.3 + m.rng() * 4;
    const wp = abs(t, { x: L + 2, y: wy });
    const close = Math.abs(wy - 34) < 5.2 && model.xg > 0.12;
    tl.push({ dur: 0.55, ball: { x: wp.x, y: wp.y, arc: 0.6 }, owner: null, fx: close ? 'nearmiss' : 'wide', sfx: close ? 'ooh' : null,
      caption: `Off target (${pct(1 - model.pOn)} miss risk)` });
    say(m, close ? 'nearMiss' : 'wide', { team: t }, close ? 'big' : 'quiet');
    ballOut(m, wp, m.rng() < 0.2 ? opp(t) : t); // some go out off a defender
    return 'wide';
  }

  /** Resolve the attacking action; mutates state; returns {tl, result} */
  FB.resolveAttack = function (m, a) {
    const out = resolveAttackInner(m, a);
    m.softPass = out.result === 'ok' && FB.isSoftPass(out.ev);
    catchPresser(m);
    catchTrapped(m, a, out.result);
    coverSlide(m, out.tl);
    m.counter = false; // the counter move has been played (a completed pass may still go first-time)
    syncBall(m, out.tl);
    return out;
  };
  /** A presser who gets bypassed is caught upfield: half speed in the next shape step. */
  function catchPresser(m) {
    const d = m.defAct && m.defAct.press != null ? P(m, m.defAct.press) : null;
    const c = carrierP(m);
    if (!d || !c || d.off || c.team === d.team) return;
    const g = ownGoal(d.team);
    if (dist(c, g) < dist(d, g)) d.recover = Math.max(d.recover, 1);
  }
  /** Defenders who stepped up for the trap and see a through ball or lob completed beyond them are caught upfield too. */
  function catchTrapped(m, a, result) {
    const c = carrierP(m);
    if (!m.trapped || !c || result !== 'ok' || a.type === 'pass' || a.type === 'dribble') return;
    const g = ownGoal(opp(c.team));
    for (const id of m.trapped) {
      const d = P(m, id);
      if (!d.off && dist(c, g) < dist(d, g)) d.recover = Math.max(d.recover, 1);
    }
  }
  /**
   * Once per beat, after a completed ball that could be played on first-time, the covering player steps across towards
   * the receiver. It happens here, before anyone decides on the first-time move, so its odds already include it.
   */
  function coverSlide(m, tl) {
    const cv = m.cover;
    if (!cv || cv.used || !m.quickOk || !FB.canQuick(m)) return;
    const d = P(m, cv.id), c = carrierP(m);
    if (c.team === d.team || d.off || m.beaten.has(d.id)) return;
    cv.used = true;
    const g = ownGoal(d.team), from = { x: d.x, y: d.y };
    if (dist(d, c) > TUNE.coverGap || dist(d, g) > dist(c, g)) moveTowards(d, coverSpot(c, d.team), TUNE.coverSlide); // else goal-side and close already
    if (dist(d, from) < 0.05) return;
    const why = tl.length && tl[tl.length - 1].caption; // keep the reason for the pass on screen
    tl.push({ dur: 0.25, moves: { [d.id]: { x: d.x, y: d.y } }, owner: c.id, caption: `${why ? why + ' · ' : ''}${d.name} slides across` });
    if (m.beat % 3 === 0) say(m, 'coverSlide', { c: ctxP(d), b: ctxP(c), team: d.team }, 'quiet');
  }
  function syncBall(m, tl) {
    if (m.carrier != null) { m.ball = { x: P(m, m.carrier).x, y: P(m, m.carrier).y }; return; }
    for (let i = tl.length - 1; i >= 0; i--) if (tl[i].ball) { m.ball = { x: tl[i].ball.x, y: tl[i].ball.y }; return; }
  }
  FB.syncBall = syncBall;
  function resolveAttackInner(m, a) {
    const ev = FB.evaluate(m, a);
    const tl = [];
    const c = carrierP(m);
    const t = c.team;
    const st = m.stats[t];
    m.cost = TUNE.cost[a.type === 'cross' || a.type === 'clear' ? 'lob' : a.type === 'shoot' ? 'shot' : a.type] || 30;
    // build-up in your own half eats the clock; final-third play is quick and urgent
    m.cost *= lerp(1.4, 0.55, clamp((rel(c.team, c).x - 20) / 70, 0, 1));
    if (m.setPiece) m.cost += TUNE.cost.restart;
    if (!ev.valid) throw new Error('Invalid action: ' + ev.reason);
    m.lastAction = { a, ev, team: t };
    if (m.quick) m.cost *= TUNE.quickCost;
    m.totalCost = (m.totalCost || 0) + 0;
    const SC = TUNE.loose.scatter;
    let result = null;
    const roll = () => m.rng();
    if (a.type === 'pass' || a.type === 'through') {
      st.passes++;
      const r = P(m, a.type === 'pass' ? a.to : ev.runner);
      const target = a.type === 'pass' ? { x: r.x, y: r.y } : ev.target;
      const spd = a.type === 'pass' ? 24 : 22;
      if (roll() > ev.exec) {
        // misplaced
        const lp = scatter(m, target, a.type === 'through' ? SC.throughMiss : SC.passMiss);
        tl.push({ dur: dist(c, lp) / spd, ball: { x: lp.x, y: lp.y, arc: 0 }, owner: null, caption: `Misplaced (${pct(1 - ev.exec)} risk)` });
        say(m, 'misplaced', { a: ctxP(c), team: t }, 'bad');
        looseBall(m, lp, t, tl, new Set([c.id]), 0);
        return { tl, result: 'misplaced', ev };
      }
      for (const x of ev.lane.list) {
        if (roll() < x.p) {
          const ip = P(m, x.id);
          tl.push({ dur: Math.max(0.25, dist(c, x.q) / spd), ball: { x: x.q.x, y: x.q.y, arc: 0 }, moves: { [ip.id]: { x: x.q.x, y: x.q.y } }, owner: ip.id, fx: 'intercept',
            caption: `Intercepted by ${ip.name} — ${x.d.toFixed(1)} m from the lane (${pct(x.p)})` });
          ip.x = x.q.x; ip.y = x.q.y;
          say(m, 'intercepted', { a: ctxP(c), b: ctxP(ip), team: ip.team }, 'bad');
          turnover(m, ip, 'intercept');
          momentum(m, ip.team, 0.03);
          return { tl, result: 'intercepted', ev };
        }
      }
      if (ev.offP > 0 && roll() < ev.offP) {
        const moves = a.type === 'through' ? { [r.id]: lerp2(r, target, 0.5) } : {};
        tl.push({ dur: dist(c, target) / spd, ball: { x: target.x, y: target.y, arc: 0 }, moves, owner: null });
        offsideCall(m, r, ev.offP, tl);
        return { tl, result: 'offside', ev };
      }
      if (a.type === 'through') {
        const ch = ev.chaser != null ? P(m, ev.chaser) : null;
        const won = roll() < ev.pRace;
        const moves = { [r.id]: won ? { x: target.x, y: target.y } : lerp2(r, target, 0.8) };
        if (ch) moves[ch.id] = won ? lerp2(ch, target, 0.7) : { x: target.x, y: target.y };
        tl.push({ dur: dist(c, target) / spd + 0.15, ball: { x: target.x, y: target.y, arc: 0 }, moves, owner: won ? r.id : ch ? ch.id : null,
          caption: won ? `${r.name} wins the race (${pct(ev.pRace)})` : `${ch ? ch.name : 'Defender'} wins the race (${pct(1 - ev.pRace)})` });
        for (const id in moves) { P(m, +id).x = moves[id].x; P(m, +id).y = moves[id].y; }
        if (!won) {
          if (ch.role === 'GK') say(m, 'throughGk', { c: ctxP(ch), team: ch.team }, 'save');
          else say(m, 'throughLost', { a: ctxP(c), b: ctxP(r), c: ctxP(ch), team: ch.team }, 'bad');
          turnover(m, ch, 'intercept');
          return { tl, result: 'lost', ev };
        }
        if (roll() > ev.ctrl) {
          say(m, 'badTouch', { a: ctxP(r), team: t }, 'bad');
          looseBall(m, scatter(m, target, SC.throughTouch), t, tl, null, 0);
          return { tl, result: 'badtouch', ev };
        }
        st.passesOk++;
        m.lastPasser = c.id;
        setCarrier(m, r);
        const deep = rel(t, target).x > 70;
        say(m, deep ? 'through' : 'throughSpace', { a: ctxP(c), b: ctxP(r), team: t }, deep ? 'good' : 'quiet');
        momentum(m, t, 0.06);
        m.quickOk = true;
        return { tl, result: 'ok', ev };
      }
      // ground pass reaches receiver
      tl.push({ dur: Math.max(0.3, dist(c, target) / spd), ball: { x: target.x, y: target.y, arc: 0 }, owner: r.id });
      if (roll() > ev.ctrl) {
        tl[tl.length - 1].caption = `Heavy touch under pressure (${pct(1 - ev.ctrl)} risk)`;
        say(m, 'badTouch', { a: ctxP(r), team: t }, 'bad');
        looseBall(m, scatter(m, target, SC.passTouch), t, tl, null, 0);
        return { tl, result: 'badtouch', ev };
      }
      st.passesOk++;
      m.lastPasser = c.id;
      const prog = rel(t, r).x - rel(t, c).x;
      setCarrier(m, r);
      say(m, prog > 12 ? 'passProg' : prog < -6 ? 'passBack' : 'pass', { a: ctxP(c), b: ctxP(r), team: t }, prog > 12 ? 'good' : 'quiet');
      m.quickOk = true;
      return { tl, result: 'ok', ev };
    }
    if (a.type === 'lob' || a.type === 'cross') {
      st.passes++;
      const r = P(m, ev.recv);
      const T = ev.target;
      const dur = clamp(ev.d / 20, 0.6, 1.6);
      const isCross = ev.header || FB.inOppBox(rel(t, T));
      if (isCross) { st.crosses++; say(m, 'cross', { a: ctxP(c), team: t }, 'shot'); }
      if (roll() < ev.charge.p) {
        const b = ev.charge.list[0] ? P(m, ev.charge.list[0].id) : null;
        tl.push({ dur: 0.3, ball: { x: c.x, y: c.y, arc: 0 }, owner: null, caption: 'Charged down' });
        say(m, 'blocked', { c: ctxP(b), team: opp(t) }, 'bad');
        looseBall(m, scatter(m, c, 5), opp(t), tl, null, 0);
        return { tl, result: 'blocked', ev };
      }
      if (roll() > ev.exec) {
        const lp = scatter(m, T, SC.lobMiss);
        tl.push({ dur, ball: { x: lp.x, y: lp.y, arc: 1 }, owner: null, caption: `Overhit (${pct(1 - ev.exec)} risk)` });
        say(m, 'misplaced', { a: ctxP(c), team: t }, 'bad');
        looseBall(m, lp, t, tl, new Set([c.id]), 0);
        return { tl, result: 'misplaced', ev };
      }
      if (ev.offP > 0 && roll() < ev.offP) {
        tl.push({ dur, ball: { x: T.x, y: T.y, arc: 1 }, owner: null });
        offsideCall(m, r, ev.offP, tl);
        return { tl, result: 'offside', ev };
      }
      const gk = active(m, opp(t)).find((p) => p.role === 'GK');
      if (roll() < ev.pClaim) {
        tl.push({ dur, ball: { x: T.x, y: T.y, arc: 1 }, moves: { [gk.id]: { x: T.x, y: T.y }, [r.id]: lerp2(r, T, 0.7) }, owner: gk.id, fx: 'save',
          caption: `Keeper claims (${pct(ev.pClaim)})` });
        gk.x = T.x; gk.y = T.y;
        say(m, 'crossClaim', { c: ctxP(gk), team: gk.team }, 'save');
        m.restart = { type: 'goalkick', team: gk.team, pos: { x: gk.x, y: gk.y } };
        m.carrier = null;
        return { tl, result: 'claimed', ev };
      }
      const duel = ev.duel != null ? P(m, ev.duel) : null;
      const won = roll() < ev.pWin;
      const moves = { [r.id]: won ? { x: T.x, y: T.y } : lerp2(r, T, 0.75) };
      if (duel) moves[duel.id] = won ? lerp2(duel, T, 0.75) : { x: T.x, y: T.y };
      for (const id in moves) { P(m, +id).x = moves[id].x; P(m, +id).y = moves[id].y; }
      tl.push({ dur, ball: { x: T.x, y: T.y, arc: 1 }, moves, owner: null, fx: won ? null : 'header',
        caption: won ? `${r.name} wins it in the air (${pct(ev.pWin)})` : `${duel ? duel.name : 'Defender'} wins the header (${pct(1 - ev.pWin)})` });
      if (!won) {
        say(m, isCross ? 'crossCleared' : 'lobLost', { a: ctxP(c), c: ctxP(duel), team: opp(t) }, 'bad');
        // clearance
        const clr = abs(t, { x: rel(t, T).x - 15 - m.rng() * 20, y: rel(t, T).y + (m.rng() - 0.5) * 40 });
        if (isCross && m.rng() < 0.42) {
          const out = abs(t, { x: L + 1, y: rel(t, T).y < 34 ? 5 : 63 });
          tl.push({ dur: 0.5, ball: { x: out.x, y: out.y, arc: 0.6 }, owner: null });
          ballOut(m, out, opp(t));
          return { tl, result: 'cleared', ev };
        }
        tl.push({ dur: 0.6, ball: { x: clr.x, y: clr.y, arc: 0.8 }, owner: null });
        looseBall(m, clr, opp(t), tl, null, 0);
        return { tl, result: 'cleared', ev };
      }
      if (ev.header) {
        m.lastPasser = c.id;
        st.passesOk++;
        const res = resolveShot(m, r, T, ev.shot, tl, { header: true });
        return { tl, result: res, ev };
      }
      if (roll() > ev.ctrl) {
        say(m, 'badTouch', { a: ctxP(r), team: t }, 'bad');
        looseBall(m, scatter(m, T, SC.lobTouch), t, tl, null, 0);
        return { tl, result: 'badtouch', ev };
      }
      st.passesOk++;
      m.lastPasser = c.id;
      setCarrier(m, r);
      tl[tl.length - 1].owner = r.id;
      say(m, 'lob', { a: ctxP(c), b: ctxP(r), team: t }, 'good');
      m.quickOk = true;
      return { tl, result: 'ok', ev };
    }
    if (a.type === 'dribble') {
      st.dribbles++;
      const T = ev.target;
      if (roll() < ev.lose) {
        const lp = scatter(m, lerp2(c, T, 1.3), SC.dribble);
        tl.push({ dur: 0.6, moves: { [c.id]: lerp2(c, T, 0.8) }, ball: { x: lp.x, y: lp.y, arc: 0 }, owner: null, caption: `Heavy touch (${pct(ev.lose)} risk)` });
        c.x = lerp(c.x, T.x, 0.8); c.y = lerp(c.y, T.y, 0.8);
        say(m, 'loseTouch', { a: ctxP(c), team: t }, 'bad');
        looseBall(m, lp, t, tl, null, 0);
        return { tl, result: 'touch', ev };
      }
      let last = { x: c.x, y: c.y };
      const beatenNames = [];
      for (const x of ev.challengers) {
        const d = P(m, x.id);
        const r = roll();
        if (r < x.pT) {
          tl.push({ dur: 0.45, moves: { [c.id]: { x: x.q.x, y: x.q.y }, [d.id]: { x: x.q.x, y: x.q.y } }, owner: d.id, fx: 'tackle',
            caption: `Tackled by ${d.name} (${pct(x.pT)} tackle chance)` });
          c.x = x.q.x - unit(x.q, T).x * 1.2; c.y = x.q.y - unit(x.q, T).y * 1.2; d.x = x.q.x; d.y = x.q.y;
          m.stats[d.team].tackles++;
          c.recover = 2; m.downed = c.id;
          say(m, 'dribbleTk', { a: ctxP(c), c: ctxP(d), team: d.team }, 'bad');
          turnover(m, d, 'tackle');
          return { tl, result: 'tackled', ev };
        }
        if (r < x.pT + x.pF) {
          tl.push({ dur: 0.45, moves: { [c.id]: { x: x.q.x, y: x.q.y }, [d.id]: { x: x.q.x, y: x.q.y } }, owner: c.id, fx: 'foul', sfx: 'whistle', caption: `Fouled by ${d.name}` });
          c.x = x.q.x; c.y = x.q.y; d.x = x.q.x; d.y = x.q.y;
          m.ball = { x: c.x, y: c.y };
          foul(m, d, c, { x: x.q.x, y: x.q.y }, 'normal');
          return { tl, result: 'fouled', ev };
        }
        m.beaten.add(d.id); d.recover = 2;
        beatenNames.push(d);
        last = x.q;
      }
      void last;
      const moves = { [c.id]: { x: T.x, y: T.y } };
      for (const d of beatenNames) moves[d.id] = { x: lerp(d.x, c.x, 0.5), y: lerp(d.y, c.y, 0.5) };
      tl.push({ dur: 0.75, moves, owner: c.id, caption: beatenNames.length ? `Beats ${beatenNames.map((d) => d.name).join(' & ')} (${pct(ev.p)})` : null });
      for (const d of beatenNames) { d.x = moves[d.id].x; d.y = moves[d.id].y; }
      c.x = T.x; c.y = T.y;
      m.ball = { x: c.x, y: c.y };
      say(m, beatenNames.length ? 'dribblePast' : 'dribble', { a: ctxP(c), c: ctxP(beatenNames[0]), team: t }, beatenNames.length ? 'good' : 'quiet');
      return { tl, result: 'ok', ev };
    }
    if (a.type === 'clear') {
      if (roll() < ev.charge.p) {
        const b = P(m, ev.charge.list[0].id);
        tl.push({ dur: 0.3, ball: { x: c.x, y: c.y, arc: 0 }, owner: null, caption: 'Charged down' });
        say(m, 'blocked', { c: ctxP(b), team: opp(t) }, 'bad');
        looseBall(m, scatter(m, c, 5), opp(t), tl, null, 0);
        return { tl, result: 'blocked', ev };
      }
      const lp = scatter(m, ev.target, SC.clear);
      tl.push({ dur: 1.2, ball: { x: lp.x, y: lp.y, arc: 1.2 }, owner: null, caption: 'Cleared long' });
      say(m, 'clear', { a: ctxP(c), team: t }, 'quiet');
      looseBall(m, lp, t, tl, new Set([c.id]), 0);
      return { tl, result: 'cleared', ev };
    }
    if (a.type === 'shoot') {
      const res = resolveShot(m, c, { x: c.x, y: c.y }, ev.shot, tl, { setPiece: m.setPiece && m.setPiece.type === 'freekick' });
      return { tl, result: res, ev };
    }
    throw new Error('unknown action');
  }

  function offsideCall(m, r, offP, tl) {
    const t = r.team;
    m.stats[t].offsides++;
    const last = tl[tl.length - 1];
    last.fx = 'flag'; last.sfx = 'whistle';
    last.caption = offP > 0.9 ? `Offside — ${r.name} was clearly beyond the line` : `Offside — tight call on ${r.name} (${pct(offP)} risk)`;
    say(m, 'offside', { b: ctxP(r), team: opp(t) }, 'bad');
    m.restart = { type: 'freekick', team: opp(t), pos: { x: r.x, y: r.y } };
    m.carrier = null;
  }

  /** Accuracy penalty on a first-time or counter action now: smaller straight after a short pass to a free receiver. */
  FB.quickPenalty = (m) => (m.softPass ? TUNE.softPass.penalty : TUNE.quickPenalty);
  /** Is this evaluated pass short and to an unpressed receiver, so the next first-time ball is easier? */
  FB.isSoftPass = (ev) => !!ev && ev.type === 'pass' && ev.d <= TUNE.softPass.max && ev.recvPressure < TUNE.softPass.pressure;
  /** After a completed pass the receiver may play first-time, before the defence resets. */
  FB.canQuick = (m) => !m.over && m.carrier != null && !m.restart && (!!m.counterOk || (!!m.quickOk && m.quick < TUNE.quickMax));
  /** True when the next quick action is a counter-attack (ball just won), not a first-time pass. */
  FB.isCounter = (m) => !!(m.counterOk || m.counter);
  FB.startQuick = function (m) {
    m.counter = !!m.counterOk;
    if (m.counter) {
      m.counters = (m.counters || 0) + 1;
      const c = carrierP(m);
      say(m, 'counter', { a: ctxP(c), t: m.teams[c.team].name, team: c.team }, 'good');
    }
    m.counterOk = false;
    m.quick++; m.quickOk = false; m.setPiece = null; m.carryCost = (m.carryCost || 0) + (m.cost || 0); m.cost = 0;
  };

  const lerp2 = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

  /** Penalty: dir in 'L','C','R' from the taker's view; dive likewise. */
  FB.penaltyOdds = function () {
    return { same: { L: 0.32, C: 0.15, R: 0.32 }, diff: { L: 0.88, C: 0.93, R: 0.88 } };
  };
  /** Goal chance of the penalty about to be taken, for one shot/dive pair. */
  FB.penaltyGoal = function (m, dir, dive) {
    const c = carrierP(m);
    const gk = active(m, opp(c.team)).find((p) => p.role === 'GK');
    const odds = FB.penaltyOdds();
    return (dir === dive ? odds.same[dir] : odds.diff[dir]) * (0.9 + (c.attrs.shoot - 70) * 0.004) * (gk ? 1 - (gk.attrs.gk - 72) * 0.004 : 1.1);
  };
  FB.resolvePenalty = function (m, dir, dive) {
    const c = carrierP(m);
    const t = c.team;
    const gk = active(m, opp(t)).find((p) => p.role === 'GK');
    const pGoal = FB.penaltyGoal(m, dir, dive);
    const st = m.stats[t];
    st.shots++; st.xg += 0.76;
    m.cost = TUNE.cost.penalty;
    const yOf = (d) => (d === 'L' ? 34 - 2.6 : d === 'R' ? 34 + 2.6 : 34);
    // taker's L is the left side when facing goal; in rel frame facing +x, left is -y
    const aim = abs(t, { x: L + 0.5, y: yOf(dir) });
    const gkTo = abs(t, { x: L - 0.4, y: yOf(dive) });
    const tl = [];
    const r = m.rng();
    let result;
    if (r < pGoal) {
      st.onTarget++;
      tl.push({ dur: 0.55, ball: { x: aim.x, y: aim.y, arc: 0.2 }, moves: gk ? { [gk.id]: gkTo } : {}, owner: null, fx: 'goal', sfx: 'goal', caption: `GOAL! (${pct(pGoal)})` });
      if (gk) { gk.x = gkTo.x; gk.y = gkTo.y; }
      say(m, 'penScored', { a: ctxP(c), team: t }, 'goal');
      m.cost += 0;
      m.ball = { x: aim.x, y: aim.y };
      m.lastPasser = null;
      goalScored(m, c, tl, 'penalty');
      m.feed.pop();
      result = 'goal';
    } else if (dir === dive && r < pGoal + (1 - pGoal) * 0.8) {
      st.onTarget++;
      if (gk) m.stats[gk.team].saves++;
      tl.push({ dur: 0.55, ball: { x: gkTo.x, y: gkTo.y, arc: 0.2 }, moves: gk ? { [gk.id]: gkTo } : {}, owner: null, fx: 'save', sfx: 'save', caption: 'SAVED!' });
      if (gk) { gk.x = gkTo.x; gk.y = gkTo.y; }
      say(m, 'penSaved', { c: ctxP(gk), team: opp(t) }, 'save');
      const out = abs(t, { x: L + 1, y: dive === 'L' ? 26 : 42 });
      tl.push({ dur: 0.4, ball: { x: out.x, y: out.y, arc: 0.5 }, owner: null });
      ballOut(m, out, opp(t));
      result = 'saved';
    } else {
      const wide = abs(t, { x: L + 2, y: dir === 'L' ? 28.5 : dir === 'R' ? 39.5 : 34 });
      if (dir === 'C') wide.y = W / 2;
      tl.push({ dur: 0.55, ball: { x: wide.x, y: wide.y, arc: dir === 'C' ? 1.4 : 0.6 }, moves: gk ? { [gk.id]: gkTo } : {}, owner: null, fx: 'nearmiss', caption: 'MISSED!' });
      if (gk) { gk.x = gkTo.x; gk.y = gkTo.y; }
      say(m, 'penMissed', { a: ctxP(c), team: t }, 'big');
      m.restart = { type: 'goalkick', team: opp(t), pos: abs(t, { x: L - 5, y: 34 }) };
      m.carrier = null;
      result = 'missed';
    }
    syncBall(m, tl);
    return { tl, result, pGoal };
  };

  /** Close the beat: time, stats, halves. Returns list of event strings. */
  FB.endBeat = function (m) {
    const ev = [];
    const cost = ((m.cost || 0) + (m.carryCost || 0) || 30) * m.timeScale * (0.85 + m.rng() * 0.3);
    m.cost = 0; m.carryCost = 0; m.quickOk = false; m.counterOk = false; m.counter = false;
    if (m.beatStart) m.stats[m.beatStart.poss].poss += cost;
    m.time += cost;
    m.momentum *= 0.9;
    if (m.carrier != null) m.ball = { x: P(m, m.carrier).x, y: P(m, m.carrier).y };
    const hEnd = HALF * m.half;
    const hi = m.half - 1;
    if (m.added[hi] == null && m.time >= hEnd - 40) {
      const he = m.halfEvents;
      let add = Math.round(1 + he.goals * 0.5 + he.cards * 0.5 + he.stops * 0.04 + m.rng() * 1.5) + (m.half === 2 ? 1 : 0);
      add = clamp(add, 1, m.half === 1 ? 4 : 6);
      m.added[hi] = add;
      say(m, 'added', { p: add }, 'added');
      ev.push('added');
    }
    if (m.added[hi] != null && m.time >= hEnd + m.added[hi] * 60) {
      let playOn = !!(m.restart && m.restart.type === 'penalty');
      const la = m.lastAttack;
      if (!playOn && la) playOn = --la.left > 0 && attacking(m, la.team);
      else if (!playOn && !m.lastAttackDone) {
        const t = m.restart ? m.restart.team : m.poss;
        if ((m.restart || m.carrier != null) && attacking(m, t, true)) {
          m.lastAttack = { team: t, left: TUNE.lastAttack.beats };
          say(m, 'lastAttack', { t: m.teams[t].name, team: t }, 'added');
          ev.push('lastAttack');
          playOn = true;
        }
      }
      if (!playOn) {
        if (m.lastAttack) { m.lastAttack = null; m.lastAttackDone = true; } // one last attack per half
        const sc = `${m.teams[0].name} ${m.score[0]}–${m.score[1]} ${m.teams[1].name}`;
        if (m.half === 1) {
          say(m, 'halftime', { p: sc }, 'whistle');
          m.half = 2; m.time = HALF; m.halfEvents = { goals: 0, cards: 0, stops: 0 }; m.lastAttackDone = false;
          m.goalsAtHalf = m.score[0] + m.score[1];
          m.restart = { type: 'kickoff', team: 1 - m.firstKick };
          m.carrier = null;
          ev.push('halftime');
        } else {
          say(m, 'fulltime', { p: sc }, 'whistle');
          m.over = true;
          ev.push('fulltime');
        }
      }
    }
    if (m.justScored) { ev.push('goal'); m.justScored = null; }
    m.phase = 'idle';
    return ev;
  };

  /**
   * Is team t still on the attack, for the last-attack rule? A dangerous restart for t counts (a corner only to start one: once
   * it's going, the ball going out ends it), and so does t on the ball in open play far enough upfield.
   */
  function attacking(m, t, start) {
    const A = TUNE.lastAttack, R = m.restart;
    if (R) return R.team === t && (R.type === 'freekick' && rel(t, R.pos).x > A.fkX || start && R.type === 'corner');
    const c = carrierP(m);
    return !!c && c.team === t && rel(t, c).x > (start ? A.fromX : A.backX);
  }
  FB.lastAttack = (m) => m.lastAttack;

  // snapshot helpers for AI look-ahead
  FB.snapshot = (m) => ({ pos: m.players.map((p) => [p.x, p.y]), beaten: new Set(m.beaten), marks: Object.assign({}, m.marks),
    cover: m.cover && Object.assign({}, m.cover), trapped: m.trapped });
  FB.restore = (m, s) => { m.players.forEach((p, i) => { p.x = s.pos[i][0]; p.y = s.pos[i][1]; }); m.beaten = s.beaten; m.marks = s.marks; m.cover = s.cover; m.trapped = s.trapped; };
  FB.carrier = carrierP;
  FB.HALF = HALF;
})(typeof window !== 'undefined' ? window : globalThis);
