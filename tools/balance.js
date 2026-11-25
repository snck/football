// Round-robin balance check: every ordered pair of teams, N matches each, with 95% intervals.
// node tools/balance.js [matches per ordered pair] [seedBase]
const { pool, work, ci, isMainThread } = require('./pool');
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 10, seed0 = +process.argv[3] || 5000;
const T = FB.TEAMS, pairs = [];
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) pairs.push([i, j]);

if (!isMainThread) {
  work(({ from, to, n, seed }) => {
    const rows = [];
    for (let k = from; k < to; k++) {
      const [i, j] = pairs[Math.floor(k / n)];
      const m = playMatch({ home: T[i], away: T[j], seed: seed + k });
      rows.push({ i, j, f: m.score[0], g: m.score[1], si: m.stats[0].shots, sj: m.stats[1].shots });
    }
    return rows;
  });
} else {
  pool(__filename, pairs.length * N, { n: N, seed: seed0 }).then((chunks) => {
    const rows = chunks.flat();
    const pts = (f, g) => (f > g ? 3 : f === g ? 1 : 0);
    const all = T.map((t, c) => {
      const rs = rows.filter((r) => r.i === c || r.j === c).map((r) => (r.i === c ? [r.f, r.g, r.si] : [r.g, r.f, r.sj]));
      return { t, rs, p: ci(rs.map(([f, g]) => pts(f, g))) };
    });
    const mean = all.reduce((s, c) => s + c.p.mean, 0) / all.length;
    for (const { t, rs, p } of all) {
      const wdl = [1, 0, -1].map((s) => rs.filter(([f, g]) => Math.sign(f - g) === s).length);
      const avg = (k, d) => (rs.reduce((s, r) => s + r[k], 0) / rs.length).toFixed(d);
      const off = p.mean - mean;
      console.log(t.name.padEnd(18), `W${wdl[0]} D${wdl[1]} L${wdl[2]}  pts ${p.mean.toFixed(3)} ±${p.half.toFixed(3)} (${off >= 0 ? '+' : ''}${off.toFixed(3)} v mean)`,
        ` GF/m ${avg(0, 2)} GA/m ${avg(1, 2)} shots/m ${avg(2, 1)}`);
    }
    console.log(`goals/team ${(rows.reduce((s, r) => s + r.f + r.g, 0) / rows.length / 2).toFixed(3)}, ${rows.length} matches from ${seed0}`);
  });
}
