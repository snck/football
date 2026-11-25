// CPU-vs-CPU batch simulation: node tools/sim.js [matches] [seed]
const { FB, playMatch } = require('./runner');
const N = +process.argv[2] || 200;
const seed0 = +process.argv[3] || 1;
const T = FB.TEAMS;
const agg = { goals: [], beats: [], shots: [], onT: [], xg: [], poss: [], passes: [], passPct: [], corners: [], fouls: [], yel: [], reds: 0, off: [], tackles: [], ints: [] };
const scoreDist = {};
const teamRec = {};
const counts = {};
const goalHow = {};
let t0 = Date.now();
for (let i = 0; i < N; i++) {
  const h = T[i % 4], a = T[(i + 1 + Math.floor(i / 4)) % 4 === i % 4 ? (i + 2) % 4 : (i + 1 + Math.floor(i / 4)) % 4];
  const m = playMatch({ home: h, away: a, seed: seed0 * 100003 + i });
  agg.beats.push(m.beat);
  for (const t of [0, 1]) {
    const s = m.stats[t];
    agg.goals.push(m.score[t]); agg.shots.push(s.shots); agg.onT.push(s.onTarget); agg.xg.push(s.xg);
    agg.poss.push(s.poss / (m.stats[0].poss + m.stats[1].poss)); agg.passes.push(s.passes); agg.passPct.push(s.passesOk / Math.max(1, s.passes));
    agg.corners.push(s.corners); agg.fouls.push(s.fouls); agg.yel.push(s.yellows); agg.reds += s.reds; agg.off.push(s.offsides);
    agg.tackles.push(s.tackles); agg.ints.push(s.interceptions);
  }
  const k = m.score.join('-'); scoreDist[k] = (scoreDist[k] || 0) + 1;
  for (const [t, def] of [[0, h], [1, a]]) {
    const r = teamRec[def.name] || (teamRec[def.name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 });
    const gf = m.score[t], ga = m.score[1 - t];
    r.gf += gf; r.ga += ga; if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
  }
  for (const g of m.goals) goalHow[g.how] = (goalHow[g.how] || 0) + 1;
  for (const k2 in m._counts) counts[k2] = (counts[k2] || 0) + m._counts[k2];
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const f = (x, d = 2) => x.toFixed(d);
console.log(`${N} matches in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`beats/match ${f(mean(agg.beats), 1)} (min ${Math.min(...agg.beats)}, max ${Math.max(...agg.beats)})`);
console.log(`goals/team ${f(mean(agg.goals))}  shots ${f(mean(agg.shots), 1)}  onTarget ${f(mean(agg.onT), 1)}  xG ${f(mean(agg.xg))}  conv ${f(100 * mean(agg.goals) / mean(agg.shots), 1)}%`);
console.log(`passes ${f(mean(agg.passes), 1)}  pass% ${f(100 * mean(agg.passPct), 1)}  corners ${f(mean(agg.corners), 1)}  fouls ${f(mean(agg.fouls), 1)}  yellows ${f(mean(agg.yel), 2)}  reds/match ${f(agg.reds / N, 3)}  offsides ${f(mean(agg.off), 2)}`);
console.log(`tackles ${f(mean(agg.tackles), 1)}  interceptions ${f(mean(agg.ints), 1)}  poss range ${f(Math.min(...agg.poss) * 100, 0)}–${f(Math.max(...agg.poss) * 100, 0)}%`);
const gd = {}; for (const g of agg.goals) gd[g] = (gd[g] || 0) + 1;
console.log('goals per team dist', JSON.stringify(gd));
console.log('top scores', Object.entries(scoreDist).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(' '));
console.log('goal types', JSON.stringify(goalHow));
console.log('teams', Object.entries(teamRec).map(([k, r]) => `${k} W${r.w} D${r.d} L${r.l} GF${r.gf} GA${r.ga}`).join(' | '));
const act = ['pass', 'through', 'lob', 'dribble', 'shoot', 'penalty', 'press', 'cover', 'tackleNow', 'mark', 'trap', 'quick', 'counter', 'counterDeclined', 'counterGoal'];
console.log('actions/match', act.map((k) => `${k}:${f((counts[k] || 0) / N, 1)}`).join(' '));
const res = Object.entries(counts).filter(([k]) => k.startsWith('r_')).sort();
console.log('results', res.map(([k, v]) => `${k.slice(2)}:${f(v / N, 1)}`).join(' '));
