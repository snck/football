// Rule-of-thumb human policies vs the CPU on Normal: is a fixed habit as good as thinking?
// Anything not overridden (attack, defence or first-time choices) is played by the CPU brain.
// node tools/policies.js [matches] [seedBase] [name filter]
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
function plan(m, { press, mark, extra }) {
  const o = Object.assign({}, extra);
  const n = press ? nearest(m) : null;
  if (n) o.press = n.id;
  const k = mark ? markTop(m, n) : null;
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
  'press + trap': { defense: (m) => plan(m, { press: 1, extra: { trap: true } }) },
  'press + mark + trap': { defense: (m) => plan(m, { press: 1, mark: 1, extra: { trap: true } }) },
  'press + mark, high line': { defense: (m) => plan(m, { press: 1, mark: 1, extra: { line: 'high' } }) },
  // the CPU picks with some randomness; 'greedy attack' is the fair reference for the '... first' habits
  'greedy attack': { attack: (m) => first(m, null) },
  'through ball first': { attack: (m) => first(m, 'through') },
  'pass first': { attack: (m) => first(m, 'pass') },
  'lob first': { attack: (m) => first(m, 'lob') },
  'dribble first': { attack: (m) => first(m, 'dribble') },
  'always take a touch': { quick: () => null },
};
for (const [name, p] of Object.entries(P)) {
  if (only && !name.includes(only)) continue;
  const pol = {};
  for (const k in p) pol[k] = { 0: p[k] };
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (let i = 0; i < N; i++) {
    const m = playMatch({ home: FB.TEAMS[i % 4], away: FB.TEAMS[(i % 4 + 1 + ((i >> 2) % 3)) % 4], seed: seed0 + i, human: 0, difficulty: 'normal' }, pol);
    gf += m.score[0]; ga += m.score[1];
    if (m.score[0] > m.score[1]) w++; else if (m.score[0] === m.score[1]) d++; else l++;
  }
  const pts = (3 * w + d) / N, se = Math.sqrt(Math.max(0, (9 * w + d) / N - pts * pts) / N);
  console.log(`${name.padEnd(26)} W${w} D${d} L${l}  pts ${pts.toFixed(2)} ±${(1.96 * se).toFixed(2)}  GF ${(gf / N).toFixed(2)} GA ${(ga / N).toFixed(2)}`);
}
