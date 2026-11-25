// Rule-of-thumb human policies vs the CPU on Normal: is a fixed habit as good as thinking?
// Anything not overridden (attack, defence or first-time choices) is played by the CPU brain.
// node tools/policies.js [matches] [seedBase] [name filter]      (uses all cores)
const { pool, work, isMainThread } = require('./pool');
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 400;
const seed0 = +process.argv[3] || 1;
const only = process.argv[4];
const nearest = (m) => { const c = FB.carrier(m); return FB.defenseOptions(m).press.map((i) => m.players[i]).sort((a, b) => FB.dist(a, c) - FB.dist(b, c))[0]; };
function markTop(m, busy) {
  const th = FB.AI.threatMap(m);
  for (const id of Object.keys(th).map(Number).sort((a, b) => th[b] - th[a])) {
    const a = m.players[id];
    const d = FB.active(m, 1 - m.poss).filter((p) => p.role !== 'GK' && p !== busy).sort((x, y) => FB.dist(x, a) - FB.dist(y, a))[0];
    if (d && FB.dist(d, a) < 14) return { d: d.id, a: id };
  }
  return null;
}
/** keep: leave a standing mark alone instead of giving a new one every turn; swap: press only while a mark is standing. */
function plan(m, { press, cover, mark, keep, swap, extra }) {
  if (swap && FB.liveMark(m, 1 - m.poss)) mark = 0; else if (swap) press = 0;
  const o = Object.assign({}, extra);
  const n = press || cover ? nearest(m) : null;
  if (n) o[cover ? 'cover' : 'press'] = n.id;
  const k = mark && !(keep && FB.liveMark(m, 1 - m.poss)) ? markTop(m, n) : null;
  if (k) o.mark = k;
  return o;
}
/** Best option of one type whenever there is one; shoots when shooting is best overall. */
function first(m, type) {
  const l = FB.AI.scored(m);
  if (!l.length) return { type: 'clear' };
  if (!type || l[0].a.type === 'shoot') return l[0].a;
  return (l.find((x) => x.a.type === type) || l[0]).a;
}
const P = {
  'baseline (CPU brain)': {},
  'hold shape always': { defense: () => ({}) },
  'press nearest': { defense: (m) => plan(m, { press: 1 }) },
  'mark top threat': { defense: (m) => plan(m, { mark: 1 }) },
  'press + mark': { defense: (m) => plan(m, { press: 1, mark: 1 }) },
  'press + mark, left on': { defense: (m) => plan(m, { press: 1, mark: 1, keep: 1 }) },
  'mark, then press': { defense: (m) => plan(m, { press: 1, mark: 1, swap: 1 }) },
  'press + trap': { defense: (m) => plan(m, { press: 1, extra: { trap: true } }) },
  'press + mark + trap': { defense: (m) => plan(m, { press: 1, mark: 1, extra: { trap: true } }) },
  'press + mark, high line': { defense: (m) => plan(m, { press: 1, mark: 1, extra: { line: 'high' } }) },
  'cover': { defense: (m) => plan(m, { cover: 1 }) },
  'cover + mark': { defense: (m) => plan(m, { cover: 1, mark: 1 }) },
  'cover + mark + trap': { defense: (m) => plan(m, { cover: 1, mark: 1, extra: { trap: true } }) },
  // the CPU picks with some randomness; 'greedy attack' is the fair reference for the '... first' habits
  'greedy attack': { attack: (m) => first(m, null) },
  'through ball first': { attack: (m) => first(m, 'through') },
  'pass first': { attack: (m) => first(m, 'pass') },
  'lob first': { attack: (m) => first(m, 'lob') },
  'dribble first': { attack: (m) => first(m, 'dribble') },
  'always take a touch': { quick: () => null },
};
if (!isMainThread) {
  work(({ from, to, name, seed }) => {
    const pol = {}, rows = [];
    for (const k in P[name]) pol[k] = { 0: P[name][k] };
    for (let i = from; i < to; i++) {
      const m = playMatch({ home: FB.TEAMS[i % 4], away: FB.TEAMS[(i % 4 + 1 + ((i >> 2) % 3)) % 4], seed: seed + i, human: 0, difficulty: 'normal' }, pol);
      rows.push(m.score);
    }
    return rows;
  });
} else (async () => {
  for (const name of Object.keys(P)) {
    if (only && !name.includes(only)) continue;
    const rows = (await pool(__filename, N, { name, seed: seed0 }, 20)).flat();
    const w = rows.filter(([f, a]) => f > a).length, d = rows.filter(([f, a]) => f === a).length;
    const avg = (k) => (rows.reduce((s, r) => s + r[k], 0) / N).toFixed(2);
    const pts = (3 * w + d) / N, se = Math.sqrt(Math.max(0, (9 * w + d) / N - pts * pts) / N);
    console.log(`${name.padEnd(26)} W${w} D${d} L${N - w - d}  pts ${pts.toFixed(2)} ±${(1.96 * se).toFixed(2)}  GF ${avg(0)} GA ${avg(1)}`);
  }
})();
