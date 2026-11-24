// Compares defensive line heights: one team is forced to a line (deep/normal/high) for the whole
// match, both when defending actively (CPU press/tackle/mark choices) and passively (hold shape).
// node tools/lines.js [matchesPerCell] [seed]
const { FB, playMatch } = require('./runner');
const { rel, L } = Object.assign({}, FB, FB.P);
const N = +process.argv[2] || 80;
const seed0 = +process.argv[3] || 1;

// instrument the engine (this process only) to see shots and ball wins
let cur = null; // { test: team index under test, rec: per-cell record }
const origAttack = FB.resolveAttack, origDef = FB.applyDefense;
function noteWin(m, before) {
  if (!cur || m.carrier == null || m.poss === before) return;
  const x = rel(m.poss, FB.carrier(m)).x;
  const k = m.poss === cur.test ? 'won' : 'lost';
  cur.rec[k + 'X'] += x; cur.rec[k + 'N']++;
}
FB.resolveAttack = function (m, a) {
  const before = m.poss;
  const c = FB.carrier(m);
  const atk = c.team;
  const out = origAttack(m, a);
  if (cur && atk !== cur.test) {
    const r = cur.rec;
    if (a.type === 'shoot') {
      const p = rel(atk, c);
      if (FB.inOppBox(p)) r.shotsIn++; else r.shotsOut++;
      r.xga += out.ev.shot.goal;
    } else if (out.ev.header) { r.shotsIn++; r.xga += out.ev.shot.goal * out.ev.p; }
    if (a.type === 'through') { r.thr++; if (out.result === 'ok') r.thrOk++; }
    if (m.quick) { r.q++; }
  }
  noteWin(m, before);
  return out;
};
FB.applyDefense = function (m, act, hyp) {
  const before = m.poss;
  const out = origDef(m, act, hyp);
  if (!hyp) noteWin(m, before);
  return out;
};

const blank = () => ({ n: 0, gf: 0, ga: 0, w: 0, d: 0, l: 0, shotsIn: 0, shotsOut: 0, xga: 0, thr: 0, thrOk: 0, q: 0, cornersA: 0,
  wonX: 0, wonN: 0, lostX: 0, lostN: 0, possA: 0 });
const T = FB.TEAMS;
const rows = [];
for (const mode of ['active', 'passive']) {
  for (const line of ['deep', 'normal', 'high']) {
    const rec = blank();
    for (let i = 0; i < N; i++) {
      const test = i % 2; // alternate home/away
      const a = T[i % 4], b = T[(i + 1 + (i >> 2)) % 4 === i % 4 ? (i + 2) % 4 : (i + 1 + (i >> 2)) % 4];
      const def = mode === 'active' ? (m) => Object.assign(FB.AI.chooseDefense(m), { line }) : () => ({ line });
      const policy = { defense: { [test]: def } };
      cur = { test, rec };
      const m = playMatch({ home: a, away: b, seed: seed0 * 7919 + i }, policy);
      cur = null;
      const gf = m.score[test], ga = m.score[1 - test];
      rec.n++; rec.gf += gf; rec.ga += ga;
      if (gf > ga) rec.w++; else if (gf === ga) rec.d++; else rec.l++;
      rec.cornersA += m.stats[1 - test].corners;
      rec.possA += m.stats[1 - test].poss / (m.stats[0].poss + m.stats[1].poss);
    }
    rows.push({ mode, line, rec });
  }
}
const f = (x, d = 2) => x.toFixed(d);
console.log(`${N} matches per cell. "against" = what the opponent did vs the team holding that line.`);
console.log('mode     line    W-D-L        GF    GA    shots in/out box  xGA   thr% vs  corners A  opp poss  ball won at  lost at');
for (const { mode, line, rec: r } of rows) {
  const n = r.n;
  console.log(`${mode.padEnd(8)} ${line.padEnd(7)} ${`${r.w}-${r.d}-${r.l}`.padEnd(12)} ${f(r.gf / n)}  ${f(r.ga / n)}  ${f(r.shotsIn / n, 1).padStart(4)} / ${f(r.shotsOut / n, 1).padEnd(9)}  ${f(r.xga / n)}  ${f(100 * r.thrOk / Math.max(1, r.thr), 0).padStart(4)}%    ${f(r.cornersA / n, 1).padStart(4)}      ${f(100 * r.possA / n, 0)}%     ${f(r.wonX / Math.max(1, r.wonN), 1).padStart(5)} m    ${f(L - r.lostX / Math.max(1, r.lostN), 1)} m`);
}
console.log('"ball won at" = distance from own goal where the team wins the ball; "lost at" = same for where it loses it.');
