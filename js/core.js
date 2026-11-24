/* Core: constants, RNG, geometry, teams. Works in browser and Node (attaches to global FB). */
(function (G) {
  'use strict';
  const FB = G.FB || (G.FB = {});

  const L = 105, W = 68;
  FB.P = { L, W, GOAL_HALF: 3.66, BOX_D: 16.5, BOX_HALF: 20.16, SIX_D: 5.5, SIX_HALF: 9.16, PEN: 11 };

  FB.rng = function (seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  FB.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  FB.lerp = (a, b, t) => a + (b - a) * t;
  FB.dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  FB.sigmoid = (x) => 1 / (1 + Math.exp(-x));
  /** Distance from point p to segment a-b. Returns {d, t, q} with t in [0,1]. */
  FB.segDist = function (a, b, p) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    return { d: Math.hypot(p.x - q.x, p.y - q.y), t, q };
  };
  /** Team-relative coords: each team attacks toward +x in its own frame. Team 1 is rotated 180°. */
  FB.rel = (team, p) => (team === 0 ? { x: p.x, y: p.y } : { x: L - p.x, y: W - p.y });
  FB.abs = FB.rel; // involution
  FB.inPitch = (p) => p.x >= 0 && p.x <= L && p.y >= 0 && p.y <= W;

  /** Angle subtended by the goal mouth from rel point p (attacking goal at x = L). */
  FB.goalAngle = function (p) {
    const gx = L, y1 = W / 2 - 3.66, y2 = W / 2 + 3.66;
    if (p.x >= gx) return 0;
    const a1 = Math.atan2(y1 - p.y, gx - p.x), a2 = Math.atan2(y2 - p.y, gx - p.x);
    return Math.abs(a2 - a1);
  };
  /** Base xG (before finishing skill / pressure) at rel point p: a distance curve fitted to typical
   *  open-play values (≈0.42 from 11 m, ≈0.19 from 16 m, ≈0.09 from 20 m, ≈0.035 from 25 m), scaled down for tight angles. */
  FB.XG_SCALE = 1.75;
  FB.xgBase = function (p) {
    const th = FB.goalAngle(p);
    const d = Math.hypot(L - p.x, W / 2 - p.y);
    if (d < 0.5) return 0.8;
    const f = 0.8 / (1 + Math.exp((d - 10) / 3.5)) + 0.12 * Math.exp(-(d - 12) / 8);
    const thc = 2 * Math.atan(3.66 / d);
    const g = Math.min(1.1, Math.pow(th / thc, 1.2));
    return Math.min(0.8, f * g * FB.XG_SCALE);
  };
  /** In the penalty box that team (rel frame) is attacking. */
  FB.inOppBox = (r) => r.x >= L - 16.5 && Math.abs(r.y - W / 2) <= 20.16;

  // ---------------------------------------------------------------- formations
  // [u (depth 0=own goal .. ~0.7 forward), v (0..1 width, left->right in own frame), role]
  FB.FORMATIONS = {
    '4-4-2': [
      [0, 0.5, 'GK'], [0.2, 0.1, 'DF'], [0.16, 0.37, 'DF'], [0.16, 0.63, 'DF'], [0.2, 0.9, 'DF'],
      [0.45, 0.1, 'MF'], [0.4, 0.38, 'MF'], [0.4, 0.62, 'MF'], [0.45, 0.9, 'MF'],
      [0.68, 0.4, 'FW'], [0.66, 0.6, 'FW']],
    '4-3-3': [
      [0, 0.5, 'GK'], [0.21, 0.1, 'DF'], [0.16, 0.37, 'DF'], [0.16, 0.63, 'DF'], [0.21, 0.9, 'DF'],
      [0.34, 0.5, 'MF'], [0.46, 0.3, 'MF'], [0.46, 0.7, 'MF'],
      [0.64, 0.12, 'FW'], [0.7, 0.5, 'FW'], [0.64, 0.88, 'FW']],
    '4-2-3-1': [
      [0, 0.5, 'GK'], [0.21, 0.1, 'DF'], [0.16, 0.37, 'DF'], [0.16, 0.63, 'DF'], [0.21, 0.9, 'DF'],
      [0.34, 0.38, 'MF'], [0.34, 0.62, 'MF'],
      [0.53, 0.13, 'MF'], [0.55, 0.5, 'MF'], [0.53, 0.87, 'MF'],
      [0.7, 0.5, 'FW']],
    '5-3-2': [
      [0, 0.5, 'GK'], [0.25, 0.07, 'DF'], [0.16, 0.3, 'DF'], [0.15, 0.5, 'DF'], [0.16, 0.7, 'DF'], [0.25, 0.93, 'DF'],
      [0.42, 0.28, 'MF'], [0.39, 0.5, 'MF'], [0.42, 0.72, 'MF'],
      [0.66, 0.4, 'FW'], [0.66, 0.6, 'FW']],
  };

  // ---------------------------------------------------------------- names (fictional)
  const FIRST = ['Aldo', 'Bram', 'Caius', 'Dario', 'Emeka', 'Fynn', 'Goran', 'Hugo', 'Ilyas', 'Jory', 'Kofi', 'Luca',
    'Matias', 'Niko', 'Oskar', 'Pavel', 'Quin', 'Rafa', 'Soren', 'Teo', 'Ugo', 'Viktor', 'Wale', 'Xavi', 'Yann',
    'Zeno', 'Anders', 'Bastien', 'Cormac', 'Dmitri', 'Elio', 'Femi', 'Gael', 'Hamid', 'Ivo', 'Jonas', 'Kenji',
    'Lasse', 'Milo', 'Nuno', 'Orrin', 'Pim', 'Ruben', 'Sami', 'Tobi', 'Vasco', 'Wim', 'Yusuf'];
  const LAST = ['Achterberg', 'Brindle', 'Castellar', 'Dunmore', 'Eskola', 'Ferrow', 'Galloway', 'Hartigan', 'Ibsen',
    'Jandro', 'Kettering', 'Lowe', 'Marlow', 'Nkemelu', 'Ostrander', 'Pellow', 'Quarrie', 'Redvers', 'Stellan',
    'Tamsin', 'Underhill', 'Varga', 'Whitlock', 'Yarrow', 'Zabala', 'Okoro', 'Brannagh', 'Dossou', 'Ferreira',
    'Halloran', 'Ivanic', 'Kowal', 'Lindqvist', 'Moreau', 'Novak', 'Oduya', 'Pires', 'Rasmus', 'Sorensen', 'Tavares',
    'Vidal', 'Wexley', 'Adebayo', 'Calloway', 'Dragan', 'Esposti', 'Grieve', 'Hollis', 'Kanté-Moss', 'Mbeki-Rowe'];

  // Style: risk (progress appetite 0..1), press (0..1), line, temp (decision variety)
  FB.TEAMS = [
    { id: 'harbour', name: 'Harbour City', short: 'HAR', formation: '4-4-2', colors: ['#1f4fa8', '#ffffff'],
      rating: 78, style: { risk: 0.5, press: 0.5, line: 'normal', cross: 0.5 }, blurb: 'Balanced 4-4-2. Solid, honest, good in the air.' },
    { id: 'redmoor', name: 'Redmoor Athletic', short: 'RED', formation: '4-3-3', colors: ['#c62828', '#fff3e0'],
      rating: 74, style: { risk: 0.6, press: 0.75, line: 'high', cross: 0.35 }, blurb: 'High-pressing 4-3-3. Wins it high, plays fast.' },
    { id: 'kestrel', name: 'Kestrel Vale', short: 'KES', formation: '4-2-3-1', colors: ['#2e7d32', '#f1f8e9'],
      rating: 77, style: { risk: 0.35, press: 0.45, line: 'normal', cross: 0.3 }, blurb: 'Patient possession 4-2-3-1. Great passers.' },
    { id: 'coldforge', name: 'Coldforge United', short: 'COL', formation: '5-3-2', colors: ['#212121', '#ffb300'],
      rating: 77, style: { risk: 0.7, press: 0.4, line: 'normal', cross: 0.6 }, blurb: 'Compact 5-3-2 on the counter. Fast forwards.' },
  ];

  const ROLE_PROFILE = {
    GK: { pace: -20, pass: -8, shoot: -40, tackle: -30, dribble: -30, head: -10, gk: 8 },
    DF: { pace: -2, pass: -4, shoot: -18, tackle: 8, dribble: -10, head: 6, gk: -60 },
    MF: { pace: 0, pass: 6, shoot: -4, tackle: 0, dribble: 4, head: -4, gk: -60 },
    FW: { pace: 5, pass: -2, shoot: 8, tackle: -15, dribble: 5, head: 3, gk: -60 },
  };
  const TEAM_BIAS = {
    harbour: { head: 4, tackle: 2 }, redmoor: { pace: 3, tackle: 3 }, kestrel: { pass: 5, dribble: 3 },
    coldforge: { pace: 5, tackle: 2, pass: -3 },
  };

  const SQUADS = {};
  const USED_NAMES = new Set();
  FB.buildSquad = function (teamDef) {
    if (SQUADS[teamDef.id]) return SQUADS[teamDef.id].map((p) => Object.assign({}, p, { attrs: Object.assign({}, p.attrs) }));
    const seed = teamDef.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const r = FB.rng(seed);
    const slots = FB.FORMATIONS[teamDef.formation];
    const used = USED_NAMES;
    const nums = { GK: [1], DF: [2, 5, 4, 3, 6], MF: [8, 6, 10, 7, 11, 14], FW: [9, 11, 7, 10] };
    const usedNums = new Set();
    const squad = slots.map((s, i) => {
      const role = s[2];
      let name;
      do { name = LAST[Math.floor(r() * LAST.length)]; } while (used.has(name));
      used.add(name);
      const first = FIRST[Math.floor(r() * FIRST.length)];
      let num = nums[role].find((n) => !usedNums.has(n));
      if (num === undefined) { num = 12; while (usedNums.has(num)) num++; }
      usedNums.add(num);
      const attrs = {};
      for (const k of ['pace', 'pass', 'shoot', 'tackle', 'dribble', 'head', 'gk']) {
        const v = teamDef.rating + ROLE_PROFILE[role][k] + ((TEAM_BIAS[teamDef.id] || {})[k] || 0) + Math.round((r() - 0.5) * 14);
        attrs[k] = FB.clamp(v, 20, 95);
      }
      return { slot: i, role, u: s[0], v: s[1], num, name, first, attrs };
    });
    SQUADS[teamDef.id] = squad;
    return FB.buildSquad(teamDef);
  };
  FB.TEAMS.forEach((t) => FB.buildSquad(t)); // deterministic: unique surnames across all clubs
})(typeof window !== 'undefined' ? window : globalThis);
