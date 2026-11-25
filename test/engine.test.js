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
