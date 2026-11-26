// Estimates real-world match length for a human: animation time (from timelines) + assumed thinking time per decision.
// node tools/timing.js [matches] [length]
const { FB } = require('./runner');
const N = +process.argv[2] || 10, len = process.argv[3] || 'normal';
const THINK = { attack: 7, quick: 4, defend: 4.5, penalty: 6, goal: 3, half: 10, run: 1 }; // run: calling a run when taking a touch
const dur = (tl) => tl.reduce((a, s) => a + (s.dur || 0.3), 0);
let tot = { anim: 0, think: 0, att: 0, q: 0, def: 0, beats: 0 };
for (let i = 0; i < N; i++) {
  const m = FB.createMatch({ home: FB.TEAMS[i % 4], away: FB.TEAMS[(i + 2) % 4], seed: 40 + i, human: 0, length: len });
  while (!m.over) {
    const s = FB.startBeat(m); tot.anim += dur(s.tl) + 0.33; tot.beats++;
    if (s.penalty) { tot.think += THINK.penalty; tot.anim += dur(FB.resolvePenalty(m, 'L', FB.AI.chooseDive(m)).tl); }
    else {
      let ended = false;
      if (s.needDefense) {
        const d = FB.AI.chooseDefense(m);
        if (m.poss === 1) { tot.think += THINK.defend; tot.def++; }
        const r = FB.applyDefense(m, d); tot.anim += dur(r.tl); ended = r.ended;
      }
      if (!ended) {
        const human = m.poss === 0;
        if (human) { tot.think += THINK.attack; tot.att++; } else tot.anim += 0.38;
        const r = FB.resolveAttack(m, FB.AI.chooseAttack(m)); tot.anim += dur(r.tl);
      }
      while (FB.canQuick(m)) { // first-time plays and counter-attacks
        const h = m.poss === 0;
        if (h) { tot.think += THINK.quick; tot.q++; } else tot.anim += 0.22;
        const q = FB.AI.chooseQuick(m);
        if (!q) { const run = FB.AI.chooseRun(m); if (run && FB.orderRun(m, m.poss, run) && h) tot.think += THINK.run; break; }
        FB.startQuick(m); const r = FB.resolveAttack(m, q); tot.anim += dur(r.tl);
      }
    }
    const ev = FB.endBeat(m);
    if (ev.includes('goal')) tot.think += THINK.goal;
    if (ev.includes('halftime')) tot.think += THINK.half;
  }
}
const f = (x) => (x / N / 60).toFixed(1);
console.log(`${len}: beats ${(tot.beats / N).toFixed(0)}, human decisions/match: attack ${(tot.att / N).toFixed(0)}, first-time ${(tot.q / N).toFixed(0)}, defend ${(tot.def / N).toFixed(0)}`);
console.log(`animation ${f(tot.anim)} min + thinking ${f(tot.think)} min = ${f(tot.anim + tot.think)} min per match`);
