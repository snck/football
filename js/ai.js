/* CPU brain: expected-value attack selection and minimax-ish defensive planning. */
(function (G) {
  'use strict';
  const FB = G.FB;
  const { L } = FB.P;
  const { clamp, dist, rel, abs } = FB;

  const TEMP = { easy: 0.028, normal: 0.011, hard: 0.006 };

  /** Threat of having the ball at abs pos for team t. */
  function V(t, pos) {
    const r = rel(t, pos);
    return 0.003 + 0.03 * Math.pow(clamp(r.x, 0, L) / L, 2) + 0.18 * Math.min(0.25, FB.xgBase(r));
  }
  const loss = (t, pos) => V(1 - t, pos) + 0.006;

  function context(m, t) {
    const style = m.teams[t].style;
    const min = FB.minute(m);
    const diff = m.score[t] - m.score[1 - t];
    let lossW = 1.15 - 0.4 * style.risk;
    let shotBias = 0;
    if (min > 70 && diff > 0) lossW += 0.25 + (min - 70) * 0.01;
    if (min > 65 && diff < 0) { lossW -= 0.25 + (min - 65) * 0.008; shotBias = 0.01; }
    if (min > 85 && diff < 0) { lossW -= 0.2; shotBias = 0.02; }
    return { lossW: clamp(lossW, 0.35, 1.8), shotBias, style, prog: 0.1 + 0.08 * style.risk, x0: rel(t, FB.carrier(m)).x };
  }

  function outcomeValue(m, t, o, ctx) {
    switch (o.k) {
      case 'keep': return 0.85 * V(t, o.pos) * (1 - 0.15 * Math.min(1, o.pressure || 0)) + ctx.prog * Math.max(0, rel(t, o.pos).x - ctx.x0) / L;
      case 'loose': return o.keep * V(t, o.pos) * 0.9 - (1 - o.keep) * loss(t, o.pos) * ctx.lossW;
      case 'lose': return -loss(t, o.pos) * ctx.lossW;
      case 'clear': return -0.02 * ctx.lossW;
      case 'offside': return -loss(t, o.pos) * 0.6 * ctx.lossW;
      case 'goal': return 1;
      case 'saved': return 0.02;
      case 'wide': return -0.008;
      case 'blocked': return 0.012;
      case 'foulFor': return FB.inOppBox(rel(t, o.pos)) ? 0.7 : V(t, o.pos) * 1.2 + 0.01;
      default: return 0;
    }
  }

  function evOf(m, a, ev, ctx) {
    const t = FB.carrier(m).team;
    let s = 0;
    for (const o of ev.outcomes) if (o.p > 0) s += o.p * outcomeValue(m, t, o, ctx);
    if (a.type === 'shoot') s += ev.shot.base > 0.05 ? ctx.shotBias + 0.02 : ctx.shotBias * 0.5;
    if (a.type === 'pass' && m.lastPasser === a.to) s -= 0.003;
    return s;
  }

  function candidates(m) {
    const c = FB.carrier(m);
    const t = c.team;
    const cr = rel(t, c);
    const out = [];
    const allowed = FB.allowedActions(m);
    const mates = FB.active(m, t).filter((p) => p !== c);
    for (const p of mates) {
      if (p.role === 'GK' && cr.x > 35) continue;
      const d = dist(c, p);
      if (allowed.pass && d <= 48) out.push({ type: 'pass', to: p.id });
      if (allowed.lob && d >= 20 && p.role !== 'GK') out.push({ type: 'lob', to: p.id });
      if (allowed.through && p.role !== 'GK') {
        const pr = rel(t, p);
        if (pr.x >= cr.x - 4) {
          for (const [len, side] of [[8, 0], [13, 0], [10, -1], [10, 1]]) {
            const gx = L - pr.x, gy = 34 - pr.y;
            const gl = Math.hypot(gx, gy) || 1;
            let dx = 0.55 * gx / gl + 0.45, dy = 0.55 * gy / gl + side * 0.45;
            const dl = Math.hypot(dx, dy);
            dx /= dl; dy /= dl;
            const T = { x: pr.x + dx * len, y: pr.y + dy * len };
            if (T.x > L - 1 || T.y < 1 || T.y > 67) continue;
            out.push({ type: 'through', target: abs(t, T), runner: p.id });
          }
        }
      }
    }
    if (allowed.lob && (cr.x > 68 && Math.abs(cr.y - 34) > 12 || m.setPiece && m.setPiece.type === 'corner')) {
      const s = cr.y < 34 ? -1 : 1;
      for (const T of [{ x: 99.5, y: 34 + s * 3.5 }, { x: 94, y: 34 }, { x: 99, y: 34 - s * 5 }, { x: 96, y: 34 - s * 1 }]) out.push({ type: 'lob', target: abs(t, T) });
    }
    if (allowed.dribble) {
      const max = FB.dribbleMax(c) * 0.92;
      for (const ang of [-1.4, -0.8, -0.35, 0, 0.35, 0.8, 1.4, 2.6, -2.6]) {
        const gx = L - cr.x, gy = 34 - cr.y;
        const base = Math.atan2(gy * 0.5, gx);
        const T = { x: cr.x + Math.cos(base + ang) * max, y: cr.y + Math.sin(base + ang) * max };
        if (T.x < 1 || T.x > L - 1 || T.y < 1 || T.y > 67) continue;
        out.push({ type: 'dribble', target: abs(t, T) });
      }
    }
    if (allowed.shoot) out.push({ type: 'shoot' });
    if (cr.x < 45) out.push({ type: 'clear' });
    return out;
  }

  function scored(m, temp) {
    const c = FB.carrier(m);
    const ctx = context(m, c.team);
    const list = [];
    for (const a of candidates(m)) {
      const ev = FB.evaluate(m, a);
      if (!ev.valid) continue;
      list.push({ a, ev, v: evOf(m, a, ev, ctx) });
    }
    list.sort((x, y) => y.v - x.v);
    void temp;
    return list;
  }

  function softPick(m, list, temp) {
    if (!list.length) return null;
    const top = list[0].v;
    const w = list.map((x) => Math.exp((x.v - top) / temp));
    const s = w.reduce((a, b) => a + b, 0);
    let r = m.rng() * s;
    for (let i = 0; i < list.length; i++) { r -= w[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  function softValue(list, temp) {
    if (!list.length) return -0.05;
    const top = list[0].v;
    let s = 0, sv = 0;
    for (const x of list) { const w = Math.exp((x.v - top) / temp); s += w; sv += w * x.v; }
    return sv / s;
  }

  function tempFor(m, t) {
    if (m.human >= 0 && t !== m.human) return TEMP[m.diff] || TEMP.normal;
    return TEMP.normal;
  }

  /**
   * What the CPU charges itself for an order on top of what it can see one action ahead (tuned on match results). Cover's slide
   * is out of its sight (looking ahead to the first-time move made it play worse), and so are a mark's later beats. The trap's
   * cost is in evaluate(), so it needs none.
   */
  const PLAN = { cover: 0.002, mark: 0.001 };

  /** chooseRun's thresholds: best pass chance that still counts as "no safe pass", metres of space a forward needs behind the line
   * (and between the line and the goal), and how far from the centre a carrier counts as wide. */
  const RUN = { safePass: 0.8, room: 8, depth: 8, wide: 18 };

  const pickSide = (m, mix) => { const r = m.rng(); return r < mix.L ? 'L' : r < mix.L + mix.R ? 'R' : 'C'; };

  FB.AI = {
    V, candidates, scored, evOf, context, PLAN, RUN,
    chooseAttack(m) {
      const t = FB.carrier(m).team;
      const list = scored(m);
      const pick = softPick(m, list, tempFor(m, t));
      return pick ? pick.a : { type: 'clear' };
    },
    /** Play first-time? Returns an action or null (take a touch, let the defence reset). */
    chooseQuick(m) {
      const c = FB.carrier(m);
      const t = c.team;
      const ctx = context(m, t);
      const settle = 0.85 * V(t, c) * (1 - 0.15 * Math.min(1, FB.pressureOn(m, c)));
      m.quick++; // evaluate with the first-time penalty applied
      const list = scored(m);
      m.quick--;
      if (!list.length) return null;
      const pick = softPick(m, list, tempFor(m, t));
      void ctx;
      // only go first-time when it clearly beats settling on the ball
      return pick.v > settle + 0.001 ? pick.a : null;
    },
    /**
     * Which run to call when taking a touch (null for none). A plain rule, with no RNG and no look-ahead (the shape step that
     * makes the run draws from the RNG): come short when pressed with no safe pass; else send the forward with the most room
     * behind the line in behind; else, when wide past halfway, overlap with the nearest teammate behind the ball.
     */
    chooseRun(m) {
      const c = FB.carrier(m);
      if (!c || m.restart) return null;
      const t = c.team, cr = rel(t, c);
      const mates = FB.active(m, t).filter((p) => p !== c && p.role !== 'GK');
      if (!mates.length) return null;
      if (FB.pressureOn(m, c) > 0.5) {
        const q = m.quick; m.quick = 0; // the next beat's odds, without the first-time penalty
        let safe = 0;
        for (const p of mates) { const ev = FB.evaluate(m, { type: 'pass', to: p.id }); if (ev.valid) safe = Math.max(safe, ev.p); }
        m.quick = q;
        if (safe <= RUN.safePass) return { id: mates.slice().sort((a, b) => dist(a, c) - dist(b, c))[0].id, kind: 'short' };
      }
      const offL = rel(t, { x: FB.offsideLine(m, t), y: 0 }).x;
      const opps = FB.active(m, 1 - t).map((o) => rel(t, o));
      let best = null, room = RUN.room;
      if (L - 6 - offL > RUN.depth) {
        for (const p of mates) {
          const pr = rel(t, p);
          if (p.role !== 'FW' || pr.x < offL - 15) continue;
          const q = { x: Math.min(offL + 10, L - 6), y: pr.y };
          let md = 99;
          for (const o of opps) md = Math.min(md, Math.hypot(o.x - q.x, o.y - q.y));
          if (md > room) { room = md; best = p; }
        }
      }
      if (best) return { id: best.id, kind: 'behind' };
      if (cr.x > L / 2 && Math.abs(cr.y - 34) > RUN.wide) {
        const side = cr.y < 34 ? -1 : 1;
        const back = mates.filter((p) => rel(t, p).x < cr.x + 2 && (rel(t, p).y - 34) * side > 0).sort((a, b) => dist(a, c) - dist(b, c));
        if (back.length && dist(back[0], c) < 25) return { id: back[0].id, kind: 'overlap' };
      }
      return null;
    },
    /** Rank attack options for UI hints (top n). */
    topAttacks(m, n) { return scored(m).slice(0, n); },
    lineFor(m, t) {
      const st = m.teams[t].style;
      const min = FB.minute(m);
      const diff = m.score[t] - m.score[1 - t];
      if (min > 75 && diff > 0) return 'deep';
      if (min > 70 && diff < 0) return 'high';
      return st.line;
    },
    chooseDefense(m) {
      const c = FB.carrier(m);
      const t = 1 - c.team;
      const style = m.teams[t].style;
      const opts = FB.defenseOptions(m);
      const temp = TEMP.normal;
      const plans = [{}];
      const near = opts.press.map((id) => m.players[id]).sort((a, b) => dist(a, c) - dist(b, c));
      near.slice(0, 2).forEach((p) => plans.push({ press: p.id }));
      near.slice(0, 2).forEach((p) => plans.push({ cover: p.id }));
      opts.tackle.forEach((id) => plans.push({ tackle: id }));
      // most dangerous receivers
      const base = scored(m);
      const recvVal = {};
      for (const x of base) {
        const id = x.a.to != null ? x.a.to : x.a.runner;
        if (id == null) continue;
        recvVal[id] = Math.max(recvVal[id] || -1, x.v);
      }
      const danger = Object.keys(recvVal).map(Number).sort((a, b) => recvVal[b] - recvVal[a]).slice(0, 2);
      for (const aid of danger) {
        const a = m.players[aid];
        const d = FB.active(m, t).filter((p) => p.role !== 'GK' && p.id !== (near[0] && near[0].id))
          .sort((x, y) => dist(x, a) - dist(y, a))[0];
        if (d && dist(d, a) < 14) {
          plans.push({ mark: { d: d.id, a: aid } });
          if (near[0]) plans.push({ press: near[0].id, mark: { d: d.id, a: aid } }, { cover: near[0].id, mark: { d: d.id, a: aid } });
        }
      }
      if (m.lines[t] !== 'deep') plans.push({ trap: true });
      if (FB.liveMark(m, t)) { // is the standing mark worth keeping?
        plans.push({ unmark: true });
        if (near[0]) plans.push({ press: near[0].id, unmark: true });
      }
      let best = null;
      const results = [];
      for (const plan of plans) {
        const snap = FB.snapshot(m);
        let A;
        if (plan.tackle != null) {
          const o = FB.tackleOdds(m, plan.tackle);
          const tk = m.players[plan.tackle];
          m.beaten.add(tk.id);
          const vBeat = softValue(scored(m), temp);
          FB.restore(m, snap);
          const inBox = FB.inOppBox(rel(c.team, c));
          const foulV = inBox ? 0.7 : V(c.team, c) * 1.2 + 0.01;
          A = o.pWin * -(V(t, c) + 0.012) + o.pFoul * foulV + o.pBeat * vBeat;
        } else {
          FB.applyDefense(m, plan, true);
          A = softValue(scored(m), temp);
          FB.restore(m, snap);
        }
        if (plan.cover != null) A += PLAN.cover;
        if (plan.press != null) A += 0.007 - style.press * 0.006;
        // the longer they keep it, the more we need to go and win it back (more so when not winning)
        const urgency = Math.max(0, (m.possStreak || 0) - 2) * (m.score[t] > m.score[c.team] ? 0.0015 : 0.003);
        if (plan.press != null || plan.tackle != null) A -= urgency;
        if (plan.mark) A += PLAN.mark;
        A += (m.rng() - 0.5) * 0.003;
        results.push({ plan, A });
        if (!best || A < best.A) best = { plan, A };
      }
      const act = Object.assign({}, best.plan);
      act.line = FB.AI.lineFor(m, t);
      act._results = results;
      return act;
    },
    /** Equilibrium of FB.penaltyOdds (tested): against these no choice beats another, so there's no CPU habit to exploit. */
    PEN_SHOT: { L: 0.368, C: 0.264, R: 0.368 },
    PEN_DIVE: { L: 0.344, C: 0.312, R: 0.344 },
    choosePenalty(m) { return pickSide(m, FB.AI.PEN_SHOT); },
    chooseDive(m) { return pickSide(m, FB.AI.PEN_DIVE); },
    /** Threat each opponent poses as a receiver (for human defending UI). */
    threatMap(m) {
      const list = scored(m);
      const map = {};
      for (const x of list) {
        const id = x.a.to != null ? x.a.to : x.a.runner;
        if (id == null) continue;
        map[id] = Math.max(map[id] || 0, x.v);
      }
      return map;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
