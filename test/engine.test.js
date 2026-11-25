// Rules-engine tests: run with `npm test` (node:test, no dependencies).
const test = require('node:test');
const assert = require('node:assert/strict');
const { FB, playMatch, playBeat } = require('../tools/runner');

const T = FB.TEAMS;
function fresh(seed = 1) {
  const m = FB.createMatch({ home: T[0], away: T[1], seed, human: -1 });
  FB.startBeat(m); // kickoff setup
  return m;
}
/** Park everyone far away so a scenario can be staged precisely. */
function clearPitch(m) {
  m.players.forEach((p, i) => { p.x = p.team === 0 ? 3 + (i % 11) * 0.5 : 102 - (i % 11) * 0.5; p.y = p.team === 0 ? 2 : 66; });
  m.setPiece = null; m.beaten.clear(); m.marks = {};
}
function give(m, id, x, y) { const p = m.players[id]; p.x = x; p.y = y; m.carrier = id; m.poss = p.team; m.ball = { x, y }; }
const sumP = (ev) => ev.outcomes.reduce((a, o) => a + o.p, 0);

test('rng is deterministic per seed', () => {
  const a = FB.rng(42), b = FB.rng(42), c = FB.rng(43);
  const xa = [a(), a(), a()], xb = [b(), b(), b()];
  assert.deepEqual(xa, xb);
  assert.notDeepEqual(xa, [c(), c(), c()]);
});

test('segment distance geometry', () => {
  const r = FB.segDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 });
  assert.equal(r.d, 3); assert.equal(r.t, 0.5);
  assert.equal(FB.segDist({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: -4, y: 3 }).d, 5);
});

test('squads: 11 a side, unique fictional surnames across clubs', () => {
  const names = new Set();
  for (const t of T) { const sq = FB.buildSquad(t); assert.equal(sq.length, 11); assert.equal(sq.filter((p) => p.role === 'GK').length, 1); sq.forEach((p) => names.add(p.name)); }
  assert.equal(names.size, 44);
});

test('kick-off: carrier on the centre spot, every player in his own half', () => {
  const m = fresh();
  const c = FB.carrier(m);
  assert.ok(Math.abs(c.x - 52.5) < 1 && Math.abs(c.y - 34) < 1);
  for (const p of m.players) {
    if (p.team === 0) assert.ok(p.x <= 53, `${p.name} x=${p.x}`); else assert.ok(p.x >= 52, `${p.name} x=${p.x}`);
  }
  const al = FB.allowedActions(m);
  assert.equal(al.shoot, false); assert.equal(al.dribble, false);
});

test('outcome probabilities of every action sum to 1', () => {
  const m = fresh(3);
  clearPitch(m);
  give(m, 7, 72, 30);
  m.players[9].x = 84; m.players[9].y = 40; // team-mate
  m.players[16].x = 78; m.players[16].y = 33; // defender
  for (const a of [{ type: 'pass', to: 9 }, { type: 'through', target: { x: 92, y: 40 }, runner: 9 }, { type: 'lob', target: { x: 95, y: 38 } },
    { type: 'dribble', target: { x: 79, y: 31 } }, { type: 'shoot' }, { type: 'clear' }]) {
    const ev = FB.evaluate(m, a);
    assert.ok(ev.valid, a.type + ' ' + ev.reason);
    assert.ok(Math.abs(sumP(ev) - 1) < 1e-9, `${a.type} sums to ${sumP(ev)}`);
    assert.ok(ev.p >= 0 && ev.p <= 1);
  }
});

test('a defender standing in the passing lane makes the pass riskier', () => {
  const m = fresh(4);
  clearPitch(m);
  give(m, 7, 40, 34);
  m.players[9].x = 60; m.players[9].y = 34;
  const clear = FB.evaluate(m, { type: 'pass', to: 9 }).p;
  m.players[15].x = 50; m.players[15].y = 34.8;
  const blocked = FB.evaluate(m, { type: 'pass', to: 9 });
  assert.ok(blocked.p < clear - 0.2, `${blocked.p} vs ${clear}`);
  assert.ok(blocked.threats.includes(15));
});

test('offside: beyond the second-last defender in the opponent half is flagged; not from a throw-in', () => {
  const m = fresh(5);
  clearPitch(m);
  give(m, 7, 60, 34);
  // away GK at 102 and one defender at 80 (the rest further back) -> offside line 80
  for (const p of FB.active(m, 1)) if (p.role !== 'GK') { p.x = 56; p.y = 10; }
  m.players[12].x = 80; m.players[12].y = 30;
  m.players[9].x = 85; m.players[9].y = 34;
  assert.equal(FB.offsideProb(m, m.players[9]), 1);
  m.players[9].x = 75;
  assert.equal(FB.offsideProb(m, m.players[9]), 0);
  m.players[9].x = 80.1;
  const tight = FB.offsideProb(m, m.players[9]);
  assert.ok(tight > 0.2 && tight < 0.8, 'level is a tight call: ' + tight);
  m.players[9].x = 85;
  m.setPiece = { type: 'throwin', team: 0 };
  assert.equal(FB.offsideProb(m, m.players[9]), 0);
  // own half is never offside
  m.setPiece = null; give(m, 7, 20, 34); m.players[12].x = 30; m.players[9].x = 45;
  assert.equal(FB.offsideProb(m, m.players[9]), 0);
});

test('shot quality falls with distance and with blockers in the cone', () => {
  const m = fresh(6);
  clearPitch(m);
  give(m, 9, 94, 34);
  const near = FB.evaluate(m, { type: 'shoot' }).shot;
  give(m, 9, 80, 34);
  const far = FB.evaluate(m, { type: 'shoot' }).shot;
  assert.ok(near.xg > far.xg * 2, `${near.xg} vs ${far.xg}`);
  m.players[13].x = 83; m.players[13].y = 34;
  const blocked = FB.evaluate(m, { type: 'shoot' }).shot;
  assert.ok(blocked.pBlock > 0.1 && blocked.goal < far.goal);
  // no shooting from your own half
  give(m, 9, 40, 34);
  assert.equal(FB.evaluate(m, { type: 'shoot' }).valid, false);
});

test('tackle odds are a proper distribution and closer is better', () => {
  const m = fresh(7);
  clearPitch(m);
  give(m, 7, 50, 34);
  m.players[15].x = 51.5; m.players[15].y = 34;
  const close = FB.tackleOdds(m, 15);
  assert.ok(Math.abs(close.pWin + close.pFoul + close.pBeat - 1) < 1e-9);
  m.players[15].x = 54.5;
  const far = FB.tackleOdds(m, 15);
  assert.ok(close.pWin > far.pWin);
});

test('goal: score increments and the other team kicks off', () => {
  const m = fresh(8);
  clearPitch(m);
  give(m, 9, 100, 34);
  m.players[11].x = 104; m.players[11].y = 10; // keeper stranded
  let scored = false;
  for (let i = 0; i < 40 && !scored; i++) {
    const snapT = m.score[0];
    const r = FB.resolveAttack(m, { type: 'shoot' });
    if (m.score[0] === snapT + 1) { scored = true; assert.equal(r.result, 'goal'); assert.deepEqual(m.restart, { type: 'kickoff', team: 1 }); }
    else { clearPitch(m); give(m, 9, 100, 34); m.players[11].x = 104; m.players[11].y = 10; m.restart = null; }
  }
  assert.ok(scored);
  assert.equal(m.goals.length, 1);
});

test('ball over the touchline gives a throw-in to the other team; over the goal line a corner or goal kick', () => {
  const m = fresh(9);
  clearPitch(m);
  give(m, 7, 50, 2);
  m.players[9].x = 60; m.players[9].y = 2;
  const seq = [0.999, 0.75, 0.9]; let k = 0; // misplace it, scatter towards the touchline
  m.rng = () => (k < seq.length ? seq[k++] : 0.5);
  FB.resolveAttack(m, { type: 'pass', to: 9 });
  assert.deepEqual([m.restart.type, m.restart.team], ['throwin', 1]);
  const m2 = fresh(10);
  clearPitch(m2);
  give(m2, 9, 95, 20);
  // force a wide shot: rolls past block and on-target thresholds
  m2.rng = () => 0.995;
  FB.resolveAttack(m2, { type: 'shoot' });
  assert.ok(['goalkick', 'corner'].includes(m2.restart.type));
});

test('penalty: guessing the right way saves far more often', () => {
  let same = 0, diff = 0;
  for (let i = 0; i < 400; i++) {
    const a = fresh(100 + i); a.restart = { type: 'penalty', team: 0, pos: { x: 94, y: 34 } }; FB.startBeat(a);
    if (FB.resolvePenalty(a, 'L', 'L').result === 'goal') same++;
    const b = fresh(1000 + i); b.restart = { type: 'penalty', team: 0, pos: { x: 94, y: 34 } }; FB.startBeat(b);
    if (FB.resolvePenalty(b, 'L', 'R').result === 'goal') diff++;
  }
  assert.ok(diff > same + 150, `same ${same} diff ${diff}`);
});

test('penalty: the CPU mixes leave a human taker or keeper nothing to exploit', () => {
  const odds = FB.penaltyOdds(), D = ['L', 'C', 'R'];
  const goal = (shot, dive) => (shot === dive ? odds.same[shot] : odds.diff[shot]);
  const { PEN_SHOT: shot, PEN_DIVE: dive } = FB.AI;
  for (const mix of [shot, dive]) assert.ok(Math.abs(mix.L + mix.C + mix.R - 1) < 1e-9);
  const spread = (v) => Math.max(...v) - Math.min(...v);
  const asTaker = D.map((s) => D.reduce((a, d) => a + dive[d] * goal(s, d), 0));
  const asKeeper = D.map((d) => D.reduce((a, s) => a + shot[s] * goal(s, d), 0));
  assert.ok(spread(asTaker) < 0.02, `taker ${asTaker}`);
  assert.ok(spread(asKeeper) < 0.02, `keeper ${asKeeper}`);
  const m = fresh(3), n = { choosePenalty: { L: 0, C: 0, R: 0 }, chooseDive: { L: 0, C: 0, R: 0 } };
  for (const f in n) for (let i = 0; i < 4000; i++) n[f][FB.AI[f](m)]++;
  for (const d of D) {
    assert.ok(Math.abs(n.choosePenalty[d] / 4000 - shot[d]) < 0.03, `shot ${d}`);
    assert.ok(Math.abs(n.chooseDive[d] / 4000 - dive[d]) < 0.03, `dive ${d}`);
  }
});

test('penalty: the goal chance shown is the one rolled', () => {
  for (const [s, d] of [['L', 'L'], ['L', 'R'], ['C', 'C'], ['C', 'L']]) {
    let goals = 0, shown = 0;
    for (let i = 0; i < 1500; i++) {
      const m = fresh(5000 + i); m.restart = { type: 'penalty', team: 0, pos: { x: 94, y: 34 } }; FB.startBeat(m);
      shown += FB.penaltyGoal(m, s, d);
      if (FB.resolvePenalty(m, s, d).result === 'goal') goals++;
    }
    assert.ok(Math.abs(goals - shown) / 1500 < 0.04, `${s}/${d}: ${goals} vs ${shown}`);
  }
});

test('shot pressure costs the share of the goal chance the preview quotes', () => {
  const m = fresh(); clearPitch(m); give(m, 9, 88, 34);
  Object.assign(m.players[11], { x: 104, y: 34 }); // keeper on his line
  const s = m.players[9];
  const at = (pressure) => FB.shotModel(m, s, s, { pressure }).xg;
  assert.ok(Math.abs(at(1) / at(0) - (1 - FB.TUNE.shotPressure)) < 1e-9);
  assert.ok(Math.abs(at(0.5) / at(0) - (1 - FB.TUNE.shotPressure / 2)) < 1e-9);
});

test('loose balls: the keep chance evaluate() assumes is what the race gives', () => {
  // [action, rolls that make it go loose, which loose outcome of evaluate() that is]
  const cases = [
    [{ type: 'pass', to: 9 }, [0.999], -1], [{ type: 'pass', to: 9 }, [0, 0.999], 0],
    [{ type: 'through', target: { x: 74, y: 40 }, runner: 9 }, [0.999], -1], [{ type: 'through', target: { x: 74, y: 40 }, runner: 9 }, [0, 0, 0.999], 0],
    [{ type: 'lob', to: 10 }, [0.999, 0.999], -1], [{ type: 'lob', to: 10 }, [0.999, 0, 0.999, 0, 0.999], 0],
    [{ type: 'dribble', target: { x: 58, y: 31 } }, [0], 0], [{ type: 'clear' }, [0.999], 0]];
  const stage = (seed) => {
    const m = fresh(seed); clearPitch(m); give(m, 7, 50, 30);
    for (const [id, x, y] of [[9, 66, 38], [10, 60, 14], [6, 44, 44], [13, 64, 31], [15, 70, 46], [16, 58, 22], [18, 54, 36]]) Object.assign(m.players[id], { x, y });
    return m;
  };
  for (const [a, rolls, which] of cases) {
    let kept = 0, n = 1500;
    const loose = FB.evaluate(stage(1), a).outcomes.filter((o) => o.k === 'loose').at(which);
    for (let i = 0; i < n; i++) {
      const m = stage(1), r = FB.rng(i + 1);
      let k = 0;
      m.rng = () => (k < rolls.length ? rolls[k++] : r());
      const res = FB.resolveAttack(m, a).result;
      assert.ok(['misplaced', 'badtouch', 'touch', 'cleared'].includes(res), `${a.type} ${res}`);
      if (m.carrier != null && m.poss === 0) kept++;
    }
    assert.ok(Math.abs(kept / n - loose.keep) < 0.07, `${a.type} ${rolls}: assumed ${loose.keep.toFixed(3)}, really ${(kept / n).toFixed(3)}`);
  }
});

test('loose balls: a ball run out of play is lost, and the estimate changes nothing', () => {
  const m = fresh(2); clearPitch(m); give(m, 7, 50, 34);
  const before = JSON.stringify(m.players);
  assert.equal(FB.looseKeep(m, { x: 50, y: -9 }, 0, { spread: 4 }), 0);
  assert.ok(FB.looseKeep(m, { x: 50, y: 34 }, 0, { spread: 4 }) > 0.95);
  assert.ok(FB.looseKeep(m, { x: 50, y: 34 }, 1, { spread: 4 }) < 0.05);
  assert.equal(JSON.stringify(m.players), before);
});

test('press: only a presser who is bypassed is slowed next beat', () => {
  const stage = () => {
    const m = fresh(3); clearPitch(m); give(m, 7, 50, 34);
    m.players[6].x = 40; m.players[6].y = 34; // square/back option
    m.players[9].x = 64; m.players[9].y = 34; // ahead of the presser
    m.players[15].x = 54; m.players[15].y = 34;
    for (const p of m.players) p.recover = 0;
    FB.applyDefense(m, { press: 15 });
    return m;
  };
  let m = stage();
  m.rng = () => 0.5; // accurate, not cut out, controlled
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 6 }).result, 'ok');
  assert.equal(m.players[15].recover, 0, 'a backward pass does not bypass him');
  // ... until a first-time ball goes past him in the same beat
  FB.startQuick(m);
  m.players[8].x = 64; m.players[8].y = 60;
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 8 }).result, 'ok');
  assert.equal(m.players[15].recover, 1, 'a first-time ball past him does');
  m = stage();
  m.players[15].y = 40; // off the lane
  m.rng = () => 0.5;
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'ok');
  assert.equal(m.players[15].recover, 1, 'a forward pass past him does');
  m = stage();
  let n = 0;
  m.rng = () => (n++ ? 0 : 0.5); // accurate, then cut out
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'intercepted');
  assert.equal(m.carrier, 15);
  assert.equal(m.players[15].recover, 0, 'winning the ball costs him nothing');
});

/** Player 15 covers the carrier (7 at 50,34); 6 is a square option, 9 a forward one. Everyone else is out of the way. */
function coverStage(act = { cover: 15 }) {
  const m = fresh(3); clearPitch(m); give(m, 7, 50, 34);
  Object.assign(m.players[6], { x: 48, y: 50 });
  Object.assign(m.players[9], { x: 60, y: 46 });
  Object.assign(m.players[15], { x: 54, y: 30 });
  FB.applyDefense(m, act);
  return m;
}

test('cover: stands off goal-side at less pressure than a press, and gives way to press or tackle', () => {
  const m = coverStage(), d = m.players[15];
  assert.ok(Math.abs(FB.dist(d, m.players[7]) - FB.TUNE.coverGap) < 1e-9);
  assert.ok(d.x > 50, 'goal-side');
  const p = FB.pressureOn(m, m.players[7]);
  assert.ok(p > 0.3 && p < FB.pressureOn(coverStage({ press: 15 }), m.players[7]) - 0.3);
  assert.equal(coverStage({ cover: 15, press: 16 }).cover, null);
  assert.deepEqual(coverStage().cover, { id: 15, used: false });
  assert.deepEqual(FB.defenseOptions(m).cover, FB.defenseOptions(m).press);
});

test('cover: slides once, up to 4 m towards the receiver of a completed ball, and the next odds include it', () => {
  const m = coverStage(), d = m.players[15];
  m.rng = () => 0.5; // accurate, not cut out, controlled
  const b = { x: d.x, y: d.y };
  const out = FB.resolveAttack(m, { type: 'pass', to: 9 });
  assert.equal(out.result, 'ok');
  assert.ok(Math.abs(FB.dist(d, b) - FB.TUNE.coverSlide) < 1e-9, `moved ${FB.dist(d, b)}`);
  assert.equal(m.cover.used, true);
  const step = out.tl[out.tl.length - 1];
  assert.deepEqual(step.moves[15], { x: d.x, y: d.y });
  // the first-time odds are those of the new position
  FB.startQuick(m);
  const at = FB.evaluate(m, { type: 'pass', to: 7 });
  Object.assign(d, b);
  assert.notEqual(FB.evaluate(m, { type: 'pass', to: 7 }).lane.p.toFixed(6), at.lane.p.toFixed(6));
  Object.assign(d, step.moves[15]);
  // not again in the same beat
  Object.assign(m.players[8], { x: 62, y: 60 });
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 8 }).result, 'ok');
  assert.deepEqual({ x: d.x, y: d.y }, step.moves[15]);
  FB.startBeat(m);
  assert.equal(m.cover, null, 'one beat only');
});

test('cover: no slide after a dribble, a turnover, once beaten, or when no first-time move is left', () => {
  let m = coverStage(), d = m.players[15], b = { x: d.x, y: d.y };
  m.rng = () => 0.99; // no heavy touch, not tackled
  assert.equal(FB.resolveAttack(m, { type: 'dribble', target: { x: 46, y: 34 } }).result, 'ok');
  assert.deepEqual({ x: d.x, y: d.y }, b);
  m = coverStage(); d = m.players[15];
  m.rng = () => 0.5;
  m.players[16].x = 55; m.players[16].y = 40.4; // in the lane to 9
  let n = 0; m.rng = () => (n++ ? 0 : 0.5);
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'intercepted');
  assert.equal(m.cover, null, 'a turnover ends it');
  m = coverStage(); d = m.players[15]; b = { x: d.x, y: d.y };
  m.rng = () => 0.5; m.beaten.add(15);
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'ok');
  assert.deepEqual({ x: d.x, y: d.y }, b);
  m = coverStage(); d = m.players[15]; b = { x: d.x, y: d.y };
  m.rng = () => 0.5; m.quick = FB.TUNE.quickMax;
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'ok');
  assert.deepEqual({ x: d.x, y: d.y }, b);
});

test('cover: jockeying a dribble reaches further and fouls half as much; odds still sum to 1', () => {
  const m = coverStage();
  const a = { type: 'dribble', target: { x: 56, y: 37 } };
  const cov = FB.evaluate(m, a);
  m.cover = null;
  const plain = FB.evaluate(m, a);
  const x = cov.challengers.find((y) => y.id === 15), y = plain.challengers.find((z) => z.id === 15);
  assert.ok(x && y && x.jockey && !y.jockey);
  assert.ok(Math.abs(sumP(cov) - 1) < 1e-9);
  assert.ok(x.pT > y.pT, 'closer to the middle of a longer reach');
  assert.ok(x.pF < y.pF, `${x.pF} vs ${y.pF}`);
  // same share of the reach: same tackle chance, half the foul chance
  assert.ok(Math.abs((x.pF / x.pT) / (y.pF / y.pT) - 0.5) < 1e-9);
});

test('cover: a hypothetical plan leaves no trace after restore', () => {
  const m = coverStage({});
  const before = JSON.stringify([m.players.map((p) => [p.x, p.y]), m.marks, m.cover]);
  const s = FB.snapshot(m);
  FB.applyDefense(m, { cover: 15, mark: { d: 16, a: 9 } }, true);
  assert.equal(m.cover.id, 15);
  FB.restore(m, s);
  assert.equal(JSON.stringify([m.players.map((p) => [p.x, p.y]), m.marks, m.cover]), before);
  m.cover = { id: 15, used: false };
  const s2 = FB.snapshot(m);
  m.cover.used = true;
  FB.restore(m, s2);
  assert.deepEqual(m.cover, { id: 15, used: false });
});

/** 7 (team 0) has it at 50,34. 9 stands at 60,46 and 15 is ready to mark him; 16 is spare. Everyone else is out of the way. */
function markStage(act = { mark: { d: 15, a: 9 } }) {
  const m = fresh(3); clearPitch(m); m.restart = null; give(m, 7, 50, 34);
  Object.assign(m.players[6], { x: 46, y: 50 });
  Object.assign(m.players[9], { x: 60, y: 46 });
  Object.assign(m.players[15], { x: 63, y: 44 });
  Object.assign(m.players[16], { x: 70, y: 30 });
  if (act) FB.applyDefense(m, act);
  return m;
}

test('lasting mark: the marker follows his man for two more beats, then goes back to his zone', () => {
  const m = markStage(), d = m.players[15], a = m.players[9];
  assert.deepEqual(FB.liveMark(m, 1), { d: 15, a: 9, left: FB.TUNE.markBeats });
  for (let left = FB.TUNE.markBeats - 1; left >= 0; left--) {
    const from = { x: d.x, y: d.y };
    FB.startBeat(m);
    assert.deepEqual(FB.liveMark(m, 1), { d: 15, a: 9, left });
    assert.equal(m.marks[9], 15);
    const u = FB.dist(a, { x: 105, y: 34 });
    const spot = { x: a.x + ((105 - a.x) / u) * FB.TUNE.markGap, y: a.y + ((34 - a.y) / u) * FB.TUNE.markGap };
    const reach = FB.speed(d) * FB.TUNE.defShapeSecs;
    assert.ok(FB.dist(d, spot) < 1e-9 || Math.abs(FB.dist(d, from) - reach) < 1e-9, 'goal-side of where his man went, or as near as one step gets him');
    assert.ok(FB.dist(d, spot) <= FB.dist(from, spot));
  }
  FB.startBeat(m);
  assert.equal(FB.liveMark(m, 1), null);
  assert.deepEqual(m.marks, {});
});

test('lasting mark: only a marker close to his man counts as tight', () => {
  const m = markStage(), d = m.players[15];
  const near = FB.evaluate(m, { type: 'pass', to: 9 });
  assert.equal(near.markedBy, 15);
  m.marks = {};
  assert.ok(FB.evaluate(m, { type: 'pass', to: 9 }).ctrl > near.ctrl);
  m.marks = { 9: 15 };
  d.x += 3;
  assert.equal(FB.evaluate(m, { type: 'pass', to: 9 }).markedBy, null);
});

test('lasting mark: a marker does not cut out balls meant for someone else', () => {
  const m = markStage(null);
  Object.assign(m.players[15], { x: 57, y: 41 }); // between 7 and 9, and in the lane to 8 behind him
  Object.assign(m.players[8], { x: 64, y: 49 });
  const inLane = (to) => FB.evaluate(m, { type: 'pass', to }).lane.list.some((x) => x.id === 15);
  assert.ok(inLane(8) && inLane(9));
  m.marks = { 9: 15 };
  assert.ok(!inLane(8) && inLane(9));
  const through = { type: 'through', target: { x: 66, y: 52 }, runner: 8 };
  const ev = FB.evaluate(m, through);
  assert.ok(Math.abs(sumP(ev) - 1) < 1e-9);
  m.marks = {};
  assert.ok(FB.evaluate(m, through).lane.p >= ev.lane.p);
  m.marks = { 7: 15 }; // his man is the one on the ball
  assert.ok(inLane(8));
});

test('lasting mark: ends on a turnover, a restart or a red card', () => {
  let m = markStage();
  let n = 0; m.rng = () => (n++ ? 0 : 0.5); // accurate, then cut out
  Object.assign(m.players[16], { x: 55, y: 40.4 });
  assert.equal(FB.resolveAttack(m, { type: 'pass', to: 9 }).result, 'intercepted');
  assert.equal(FB.liveMark(m, 1), null);
  m = markStage();
  m.restart = { type: 'throwin', team: 0, pos: { x: 50, y: 0.3 } };
  FB.startBeat(m);
  assert.equal(FB.liveMark(m, 1), null);
  m = markStage(null);
  Object.assign(m.players[16], { x: 51, y: 34, yellow: 1 });
  FB.applyDefense(m, { mark: { d: 15, a: 9 } });
  const o = FB.tackleOdds(m, 16), seq = [o.pWin + o.pFoul / 2, 0];
  m.rng = () => (seq.length ? seq.shift() : 0.5);
  FB.applyDefense(m, { tackle: 16 });
  assert.ok(m.players[16].off && m.restart);
  m.rng = FB.rng(1);
  FB.startBeat(m);
  assert.equal(FB.liveMark(m, 1), null);
});

test('lasting mark: one at a time; released on request or when the marker gets another job; it survives other orders', () => {
  const after = (act) => { const m = markStage(); FB.applyDefense(m, act); return m; };
  assert.deepEqual(FB.liveMark(after({ press: 16 }), 1), { d: 15, a: 9, left: 2 });
  assert.deepEqual(FB.liveMark(after({}), 1), { d: 15, a: 9, left: 2 }, 'holding shape keeps it');
  for (const act of [{ unmark: true }, { press: 15 }, { cover: 15 }]) {
    const m = after(act);
    assert.equal(FB.liveMark(m, 1), null, JSON.stringify(act));
    assert.deepEqual(m.marks, {}, 'and he stops marking at once');
  }
  const m = after({ mark: { d: 16, a: 6 } });
  assert.deepEqual(FB.liveMark(m, 1), { d: 16, a: 6, left: 2 });
  assert.deepEqual(m.marks, { 6: 16 }, 'the old man is not marked as well');
  assert.equal(FB.markerAfter(markStage(), { press: 15 }), null);
  assert.equal(FB.markerAfter(markStage(), { press: 16 }), 15);
});

test('marks and the trap: a hypothetical plan leaves no trace after restore', () => {
  const m = markStage();
  const state = () => JSON.stringify([m.players.map((p) => [p.x, p.y]), m.marks, m.markOrders, m.trapped && [...m.trapped], m.cover]);
  const before = state();
  for (const act of [{ unmark: true }, { press: 15, trap: true }, { mark: { d: 16, a: 6 }, trap: true }, { trap: true }]) {
    const s = FB.snapshot(m);
    FB.applyDefense(m, act, true);
    FB.restore(m, s);
    assert.equal(state(), before, JSON.stringify(act));
  }
});

/** 7 (team 0) at 55,34 looks for 9 at 66,30; defender 13 will step up from 72,33 with the trap. */
function trapStage(act) {
  const m = fresh(3); clearPitch(m); m.restart = null; give(m, 7, 55, 34);
  Object.assign(m.players[9], { x: 66, y: 30 });
  const d = m.players.find((p) => p.team === 1 && p.role === 'DF');
  Object.assign(d, { x: 72, y: 33 });
  for (const p of m.players) p.recover = 0;
  FB.applyDefense(m, act);
  return { m, d };
}
const behind = { type: 'through', target: { x: 80, y: 30 }, runner: 9 };

test('trap: a defender who stepped up turns later, only for that beat, and the preview says so', () => {
  const { m, d } = trapStage({ trap: true });
  assert.ok(m.trapped.has(d.id) && d.x < 72);
  const ev = FB.evaluate(m, behind);
  assert.equal(ev.chaser, d.id);
  assert.equal(ev.trapReact, FB.TUNE.trapReact);
  assert.ok(Math.abs(sumP(ev) - 1) < 1e-9);
  m.trapped = null; // same positions, no step
  const plain = FB.evaluate(m, behind);
  assert.equal(plain.trapReact, 0);
  assert.ok(Math.abs(ev.defT - plain.defT - FB.TUNE.trapReact) < 1e-9 && ev.pRace > plain.pRace);
  assert.equal(trapStage({}).m.trapped, null);
  // a defender with no room to step (level with the ball) is not slowed, and the marker stays with his man
  const t = trapStage({});
  t.d.x = 56;
  FB.applyDefense(t.m, { trap: true });
  assert.ok(!t.m.trapped.has(t.d.id));
  const k = trapStage({ mark: { d: t.d.id, a: 9 }, trap: true });
  assert.ok(!k.m.trapped.has(k.d.id));
  FB.startBeat(m);
  assert.equal(m.trapped, null);
});

test('trap: a through ball or lob completed beyond the line leaves it caught upfield; a pass to feet does not', () => {
  const run = (a, act, pos) => {
    const { m, d } = trapStage(act);
    if (pos) Object.assign(m.players[9], pos);
    const ev = FB.evaluate(m, a);
    let n = 0; m.rng = () => { n++; return ev.lane || ev.charge ? pick(ev, n) : 0; };
    return [FB.resolveAttack(m, a).result, d.recover];
  };
  // rolls: accuracy low = fine; lane / charge / offside / claim high = none; race, duel and touch low = won
  const pick = (ev, n) => {
    const lanes = ev.lane ? ev.lane.list.length : 1;
    const off = ev.offP > 0 ? 1 : 0;
    if (ev.type === 'lob') return n === 1 ? 0.999 : n === 2 ? 0 : n <= 2 + off ? 0.9999 : n === 3 + off ? 0.999 : 0;
    return n === 1 ? 0 : n <= 1 + lanes + off ? 0.9999 : 0;
  };
  assert.deepEqual(run(behind, { trap: true }), ['ok', 1]);
  assert.deepEqual(run(behind, {}), ['ok', 0]);
  assert.deepEqual(run({ type: 'pass', to: 9 }, { trap: true }), ['ok', 0]);
  assert.deepEqual(run({ type: 'through', target: { x: 62, y: 20 }, runner: 9 }, { trap: true }, { x: 60, y: 24 }), ['ok', 0], 'in front of him');
  assert.deepEqual(run({ type: 'lob', target: { x: 80, y: 32 } }, { trap: true }, { x: 69, y: 31 }), ['ok', 1]);
});

test('dribble: a better dribbler takes fewer heavy touches', () => {
  const m = fresh(4); clearPitch(m); give(m, 7, 50, 34);
  const at = (d) => { m.players[7].attrs.dribble = d; return FB.evaluate(m, { type: 'dribble', target: { x: 58, y: 34 } }).lose; };
  assert.ok(Math.abs(at(62) - at(82) - 0.04) < 1e-9, `${at(62)} ${at(82)}`);
  assert.equal(at(99), 0.02); // floor
});

test('quick play: allowed after a completed pass, never allows dribbling', () => {
  const m = fresh(11);
  clearPitch(m);
  give(m, 7, 40, 34);
  m.players[9].x = 50; m.players[9].y = 34;
  m.rng = () => 0.01; // everything succeeds
  const r = FB.resolveAttack(m, { type: 'pass', to: 9 });
  assert.equal(r.result, 'ok');
  assert.ok(FB.canQuick(m));
  FB.startQuick(m);
  assert.equal(FB.allowedActions(m).dribble, false);
  assert.equal(FB.evaluate(m, { type: 'dribble', target: { x: 55, y: 34 } }).valid, false);
});

test('counter-attack: an interception lets the winners break at once, under first-time rules', () => {
  const m = fresh(12);
  clearPitch(m);
  give(m, 7, 40, 34);
  m.players[9].x = 60; m.players[9].y = 34;
  m.players[15].x = 50; m.players[15].y = 34; // standing in the lane
  m.rng = () => 0.01; // the pass is accurate and the defender cuts it out
  const r = FB.resolveAttack(m, { type: 'pass', to: 9 });
  assert.equal(r.result, 'intercepted');
  assert.equal(m.poss, 1);
  assert.ok(FB.canQuick(m) && FB.isCounter(m), 'counter offered');
  FB.startQuick(m);
  assert.equal(m.quick, 1);
  assert.equal(FB.allowedActions(m).dribble, false);
  assert.ok(m.feed.some((f) => f.kind === 'good' && /counter|break|spring|go!/i.test(f.text)), 'commentary calls the counter');
  FB.endBeat(m);
  assert.equal(FB.canQuick(m), false, 'an unused counter does not carry into the next beat');
});

test('counter-attack: a tackle won counts too, and the tackled player stays down', () => {
  const m = fresh(13);
  clearPitch(m);
  give(m, 7, 50, 34);
  m.players[15].x = 51; m.players[15].y = 34;
  m.rng = () => 0.01; // tackle won
  const r = FB.applyDefense(m, { tackle: 15 });
  assert.ok(r.ended);
  assert.equal(m.poss, 1);
  assert.ok(FB.canQuick(m) && FB.isCounter(m));
  assert.ok(m.beaten.has(7), 'the tackled player cannot intercept the counter');
});

test('counter-attack: at most two per beat (no endless ping-pong)', () => {
  const m = fresh(14);
  m.rng = () => 0.01;
  for (let i = 0; i < 3; i++) {
    clearPitch(m);
    const atk = m.poss === 0 ? [7, 9, 15] : [18, 20, 4]; // carrier, team-mate, opponent in the lane
    give(m, atk[0], 40, 34);
    m.players[atk[1]].x = 60; m.players[atk[1]].y = 34;
    m.players[atk[2]].x = 50; m.players[atk[2]].y = 34;
    if (i) FB.startQuick(m);
    assert.equal(FB.resolveAttack(m, { type: 'pass', to: atk[1] }).result, 'intercepted');
    assert.equal(FB.canQuick(m), i < 2, `turnover ${i + 1}`);
  }
});

test('line height: a deep block blocks more shots, a high line loses more races in behind', () => {
  const m = fresh(15);
  clearPitch(m);
  give(m, 9, 80, 34);
  m.players[13].x = 84; m.players[13].y = 34.3;
  m.lines[1] = 'normal';
  const nBlock = FB.evaluate(m, { type: 'shoot' }).shot.pBlock;
  m.lines[1] = 'deep';
  const dBlock = FB.evaluate(m, { type: 'shoot' }).shot.pBlock;
  assert.ok(dBlock > nBlock * 1.3, `${dBlock} vs ${nBlock}`);
  // through ball: runner and an outfield defender race for the same space
  give(m, 7, 55, 34);
  m.players[9].x = 66; m.players[9].y = 30;
  m.players[13].x = 76; m.players[13].y = 38;
  const a = { type: 'through', target: { x: 78, y: 30 }, runner: 9 };
  m.lines[1] = 'normal';
  const nRace = FB.evaluate(m, a).pRace;
  m.lines[1] = 'high';
  const hi = FB.evaluate(m, a);
  m.lines[1] = 'deep';
  const dRace = FB.evaluate(m, a).pRace;
  assert.ok(hi.pRace > nRace && nRace > dRace, `high ${hi.pRace} normal ${nRace} deep ${dRace}`);
  assert.ok(hi.lineReact > 0);
});

test('red card removes a player; a sent-off keeper is replaced in goal', () => {
  const m = fresh(12);
  const gk = m.players.find((p) => p.team === 1 && p.role === 'GK');
  gk.yellow = 1;
  clearPitch(m);
  give(m, 9, 80, 34);
  gk.x = 82; gk.y = 34;
  // stage a lunge foul by the keeper: force rng so tackle -> foul, card -> yellow
  const seq = [0.5, 0.0]; let k = 0;
  m.rng = () => (k < seq.length ? seq[k++] : 0.5);
  const o = FB.tackleOdds(m, gk.id);
  seq[0] = o.pWin + o.pFoul / 2; // land in the foul band
  FB.applyDefense(m, { tackle: gk.id });
  assert.equal(gk.off, true);
  assert.equal(FB.active(m, 1).length, 10);
  assert.equal(FB.active(m, 1).filter((p) => p.role === 'GK').length, 1);
});

test('determinism: same seed, same match', () => {
  const a = playMatch({ home: T[2], away: T[3], seed: 77 });
  const b = playMatch({ home: T[2], away: T[3], seed: 77 });
  assert.deepEqual(a.score, b.score);
  assert.equal(a.beat, b.beat);
});

test('a full CPU-vs-CPU match always reaches full time with sane numbers', () => {
  for (let i = 0; i < 12; i++) {
    const m = playMatch({ home: T[i % 4], away: T[(i + 1) % 4], seed: 500 + i });
    assert.equal(m.over, true);
    assert.equal(m.half, 2);
    assert.ok(m.time >= 5400, 'played at least 90 minutes');
    assert.ok(m.beat > 90 && m.beat < 200, `beats ${m.beat}`);
    for (const t of [0, 1]) {
      assert.ok(m.score[t] >= 0 && m.score[t] <= 9);
      assert.ok(m.stats[t].onTarget <= m.stats[t].shots);
      assert.ok(m.stats[t].passesOk <= m.stats[t].passes);
    }
    assert.equal(m.goals.length, m.score[0] + m.score[1]);
  }
});

test('stoppage time is announced in both halves', () => {
  const m = FB.createMatch({ home: T[0], away: T[2], seed: 31 });
  while (!m.over) playBeat(m);
  assert.ok(m.added[0] >= 1 && m.added[0] <= 4);
  assert.ok(m.added[1] >= 1 && m.added[1] <= 6);
  assert.ok(m.feed.some((f) => f.kind === 'added'));
});
