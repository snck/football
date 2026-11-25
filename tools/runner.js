// Headless match driver shared by the simulator and tests.
const FB = require('./load');

/** Play one beat with CPU brains on both sides (or policy overrides). */
function playBeat(m, policy = {}) {
  const s = FB.startBeat(m);
  const counts = m._counts || (m._counts = {});
  if (s.penalty) {
    const dir = (policy.penalty || FB.AI.choosePenalty)(m);
    FB.resolvePenalty(m, dir, FB.AI.chooseDive(m));
    counts.penalty = (counts.penalty || 0) + 1;
  } else {
    let ended = false;
    if (s.needDefense) {
      const defTeam = 1 - m.poss;
      const d = (policy.defense && policy.defense[defTeam]) ? policy.defense[defTeam](m) : FB.AI.chooseDefense(m);
      const r = FB.applyDefense(m, d);
      ended = r.ended;
      if (d.tackle != null) counts.tackleNow = (counts.tackleNow || 0) + 1;
      if (d.press != null) counts.press = (counts.press || 0) + 1;
      if (d.cover != null) counts.cover = (counts.cover || 0) + 1;
      if (d.mark) counts.mark = (counts.mark || 0) + 1;
      if (d.trap) counts.trap = (counts.trap || 0) + 1;
    }
    if (!ended) {
      const t = m.poss;
      const a = (policy.attack && policy.attack[t]) ? policy.attack[t](m) : FB.AI.chooseAttack(m);
      const res = FB.resolveAttack(m, a);
      counts[a.type] = (counts[a.type] || 0) + 1;
      counts['r_' + a.type + '_' + res.result] = (counts['r_' + a.type + '_' + res.result] || 0) + 1;
    }
    // first-time plays after a completed pass, or a counter-attack after winning the ball
    while (FB.canQuick(m)) {
      const t2 = m.poss;
      const ctr = FB.isCounter(m);
      let q;
      if (policy.quick && policy.quick[t2]) { m.quick++; q = policy.quick[t2](m); m.quick--; } else q = FB.AI.chooseQuick(m);
      if (!q) { if (ctr) counts.counterDeclined = (counts.counterDeclined || 0) + 1; break; }
      FB.startQuick(m);
      const res = FB.resolveAttack(m, q);
      const pre = ctr ? 'r_c' : 'r_q';
      counts[ctr ? 'counter' : 'quick'] = (counts[ctr ? 'counter' : 'quick'] || 0) + 1;
      counts[pre + q.type + '_' + res.result] = (counts[pre + q.type + '_' + res.result] || 0) + 1;
      if (ctr && res.result === 'goal') counts.counterGoal = (counts.counterGoal || 0) + 1;
    }
  }
  return FB.endBeat(m);
}

function playMatch(opts = {}, policy = {}) {
  const teams = FB.TEAMS;
  const m = FB.createMatch({ home: opts.home || teams[0], away: opts.away || teams[1], seed: opts.seed, human: opts.human != null ? opts.human : -1, difficulty: opts.difficulty, length: opts.length });
  let guard = 0;
  while (!m.over) {
    playBeat(m, policy);
    if (++guard > 800) throw new Error('match did not finish');
  }
  return m;
}
module.exports = { FB, playBeat, playMatch };
