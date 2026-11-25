// Mechanics breakdown, CPU vs CPU: where goals come from, action and plan mix, whether shown odds match
// results, what happens to loose balls and pressers, corners, and how halves end.
// node tools/diag.js [matches] [seedBase]
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 300;
const seed0 = +process.argv[3] || 1;

// instrument the engine (this process only), like lines.js
const C = {}, cal = {}, zone = {}, loose = {}, plans = {}, gaps = [];
const press = { n: 0, presserWon: 0, forwardKept: 0, sidewaysOrBackKept: 0, teamWon: 0 };
const corner = { n: 0, goals: 0 }, ends = { n: 0, attThird: 0, setPiecePending: 0 };
const inc = (k, v = 1) => { C[k] = (C[k] || 0) + v; };
let chain = 0, counter = false, sp = null, presser = null;
// what evaluate() assumes about keeping a loose ball, read from its outcomes
const looseKind = { misplaced: 'last', badtouch: 'first', touch: 'first', cleared: 'first' };
const assumed = (ev, res) => { const l = ev.outcomes.filter((o) => o.k === 'loose'); return l.length ? l[looseKind[res] === 'last' ? l.length - 1 : 0].keep : null; };

const start = FB.startBeat, def = FB.applyDefense, att = FB.resolveAttack, quick = FB.startQuick, end = FB.endBeat, choose = FB.AI.chooseDefense, pen = FB.resolvePenalty;
FB.startBeat = (m) => { const r = start(m); chain = 0; counter = false; presser = null; sp = m.setPiece && m.setPiece.type; if (sp) inc('set_' + sp); return r; };
FB.AI.chooseDefense = (m) => {
  const d = choose(m), R = d._results;
  const hold = R.find((r) => !Object.keys(r.plan).length).A;
  gaps.push(hold - Math.min(...R.map((r) => r.A)));
  const k = Object.keys(d).filter((x) => x !== 'line' && x !== '_results').sort().join('+') || 'hold';
  plans[k] = (plans[k] || 0) + 1;
  return d;
};
FB.applyDefense = (m, act, hyp) => { const r = def(m, act, hyp); if (!hyp && !r.ended && act && act.press != null) { press.n++; presser = act.press; } return r; };
FB.startQuick = (m) => { quick(m); chain++; counter = m.counter; presser = null; };
FB.resolvePenalty = (m, a, b) => { const g = m.score[0] + m.score[1]; const r = pen(m, a, b); if (m.score[0] + m.score[1] > g) inc('goal_penalty'); return r; };
FB.resolveAttack = (m, a) => {
  const t = m.poss, x0 = FB.rel(t, FB.carrier(m)).x, g0 = m.score[0] + m.score[1];
  const shown = FB.evaluate(m, a);
  const out = att(m, a), res = out.result;
  const kept = m.carrier != null ? m.players[m.carrier].team === t : !!(m.restart && m.restart.team === t);
  const k = a.type + (shown.header ? ' (header)' : '');
  const o = cal[k] || (cal[k] = { n: 0, shown: 0, actual: 0 });
  o.n++; o.shown += shown.p;
  if (a.type === 'shoot' ? res === 'goal' : shown.header ? ['goal', 'saved', 'wide'].includes(res) : a.type === 'clear' ? res === 'cleared' : res === 'ok') o.actual++;
  const z = x0 < 35 ? 'own' : x0 < 70 ? 'mid' : 'final';
  (zone[z] = zone[z] || {})[a.type] = (zone[z][a.type] || 0) + 1;
  const keepP = res === 'misplaced' || res === 'badtouch' || res === 'touch' || (a.type === 'clear' && res === 'cleared') ? assumed(shown, res) : null;
  if (keepP != null) { const l = loose[a.type + '/' + res] || (loose[a.type + '/' + res] = { n: 0, kept: 0, assumed: 0 }); l.n++; l.assumed += keepP; if (kept) l.kept++; }
  if (presser != null && chain === 0) {
    if (m.carrier === presser) press.presserWon++;
    if (m.carrier != null && !kept) press.teamWon++;
    if (res === 'ok' && kept) { if (FB.rel(t, m.players[m.carrier]).x > x0 + 0.5) press.forwardKept++; else press.sidewaysOrBackKept++; }
  }
  const goal = m.score[0] + m.score[1] > g0;
  if (chain === 0 && sp === 'corner') { corner.n++; if (goal) corner.goals++; }
  if (goal) inc(chain === 0 ? 'goal_direct_' + (sp || 'open') : counter ? 'goal_counter' : 'goal_firstTimeChain');
  if (chain) inc(counter ? 'counterMoves' : 'firstTimeMoves');
  counter = false;
  return out;
};
FB.endBeat = (m) => {
  const c = FB.carrier(m), poss = m.poss, R = m.restart;
  const ev = end(m);
  if (ev.includes('halftime') || ev.includes('fulltime')) {
    ends.n++;
    if (c && FB.rel(poss, c).x > 70) ends.attThird++;
    if (R && (R.type === 'corner' || (R.type === 'freekick' && FB.rel(R.team, R.pos).x > 74))) ends.setPiecePending++;
  }
  return ev;
};

let goals = 0;
for (let i = 0; i < N; i++) {
  const m = playMatch({ home: FB.TEAMS[i % 4], away: FB.TEAMS[(i % 4 + 1 + ((i >> 2) % 3)) % 4], seed: seed0 + i });
  goals += m.score[0] + m.score[1];
}
const f = (x, d = 2) => +x.toFixed(d);
const pct = (a, b) => `${f(100 * a / Math.max(1, b), 1)}%`;
const map = (o, fn) => Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, fn(v)]));
console.log(`${N} matches from seed ${seed0}; ${f(goals / N)} goals/match (both sides)`);
console.log('goals by origin:', map(Object.fromEntries(Object.entries(C).filter(([k]) => k.startsWith('goal_'))), (v) => `${f(v / N, 3)}/match = ${pct(v, goals)}`));
console.log('per match:', map(Object.fromEntries(Object.entries(C).filter(([k]) => !k.startsWith('goal_'))), (v) => f(v / N)));
console.log('corners:', corner.n, 'scored directly', pct(corner.goals, corner.n));
console.log('calibration (shown vs actual):', map(cal, (v) => `${f(v.n / N, 1)}/match ${pct(v.shown, v.n)} vs ${pct(v.actual, v.n)}`));
const acts = {}; let all = 0; for (const z in zone) for (const k in zone[z]) { acts[k] = (acts[k] || 0) + zone[z][k]; all += zone[z][k]; }
console.log('action mix, all zones:', map(acts, (v) => pct(v, all)));
for (const z of ['own', 'mid', 'final']) { const s = Object.values(zone[z]).reduce((a, b) => a + b, 0); console.log(`action mix, ${z}:`, map(zone[z], (v) => pct(v, s))); }
console.log('loose ball kept (assumed by evaluate vs actual):', map(loose, (v) => `n${v.n} ${pct(v.assumed, v.n)} vs ${pct(v.kept, v.n)}`));
console.log('press:', press.n, map(Object.fromEntries(Object.entries(press).filter(([k]) => k !== 'n')), (v) => pct(v, press.n)));
console.log('defensive plans:', map(plans, (v) => pct(v, gaps.length)));
gaps.sort((a, b) => a - b);
console.log('value of best plan over hold: mean', f(gaps.reduce((a, b) => a + b, 0) / gaps.length, 4), 'median', f(gaps[gaps.length >> 1], 4), 'p90', f(gaps[Math.floor(gaps.length * 0.9)], 4));
console.log('half ends:', ends.n, 'ball in attacking third', pct(ends.attThird, ends.n), 'dangerous set piece pending', pct(ends.setPiecePending, ends.n));
