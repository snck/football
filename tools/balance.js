// Round-robin balance check: every ordered pair of teams, N matches each.
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 10;
const T = FB.TEAMS; const rec = {};
for (const t of T) rec[t.name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, sh: 0, n: 0 };
let k = 0;
for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) for (let n = 0; n < N; n++) {
  const m = playMatch({ home: T[i], away: T[j], seed: 5000 + k++ });
  for (const [t, def] of [[0, T[i]], [1, T[j]]]) {
    const r = rec[def.name]; const gf = m.score[t], ga = m.score[1 - t];
    r.gf += gf; r.ga += ga; r.sh += m.stats[t].shots; r.n++; if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
  }
}
for (const [name, r] of Object.entries(rec)) console.log(name.padEnd(18), `W${r.w} D${r.d} L${r.l}  GF/m ${(r.gf / r.n).toFixed(2)} GA/m ${(r.ga / r.n).toFixed(2)} shots/m ${(r.sh / r.n).toFixed(1)}`);
