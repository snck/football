// Mirror matches: the same club on both sides, one side holding lineA all match and the other lineB, so the
// only difference is the line. Clubs and the side that holds lineA alternate evenly.
// node tools/mirror.js [matches] [seedBase] [lineA] [lineB]      (line "cpu" = the club's own choice)
const { pool, work, ci, isMainThread } = require('./pool');
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 4000, seed0 = +process.argv[3] || 1;
const A = process.argv[4] || 'high', B = process.argv[5] || 'normal';

if (!isMainThread) {
  let held = null;
  const create = FB.createMatch, lineFor = FB.AI.lineFor;
  FB.createMatch = (o) => { const m = create(o); held.forEach((l, t) => { if (l !== 'cpu') m.lines[t] = l; }); return m; };
  FB.AI.lineFor = (m, t) => (held[t] === 'cpu' ? lineFor(m, t) : held[t]);
  work(({ from, to, a, b, seed }) => {
    const rows = [];
    for (let i = from; i < to; i++) {
      const test = i % 2, def = FB.TEAMS[(i >> 1) % 4];
      held = test ? [b, a] : [a, b];
      const m = playMatch({ home: def, away: def, seed: seed + i });
      rows.push([m.score[test], m.score[1 - test], (i >> 1) % 4]);
    }
    return rows;
  });
} else {
  pool(__filename, N, { a: A, b: B, seed: seed0 }).then((chunks) => {
    const rows = chunks.flat();
    const diff = ([f, g]) => 3 * Math.sign(f - g); // points of the test side minus the other side's
    const show = (rs) => { const d = ci(rs.map(diff)); return `${d.mean >= 0 ? '+' : ''}${d.mean.toFixed(3)} ±${d.half.toFixed(3)}`; };
    const wdl = [1, 0, -1].map((s) => rows.filter(([f, g]) => Math.sign(f - g) === s).length);
    const avg = (k) => (rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
    console.log(`${A} v ${B}, ${N} mirror matches from ${seed0}: ${show(rows)} points  W${wdl[0]} D${wdl[1]} L${wdl[2]}  GF ${avg(0)} GA ${avg(1)}`
      + `  | ${FB.TEAMS.map((t, k) => `${t.short} ${show(rows.filter((r) => r[2] === k))}`).join('  ')}`);
  });
}
