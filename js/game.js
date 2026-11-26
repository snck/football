/* Browser game controller: menus, turn flow, input, previews, HUD, atmosphere. */
(function () {
  'use strict';
  const FB = window.FB;
  const $ = (id) => document.getElementById(id);
  const { L, W } = FB.P;
  const pct = (p) => `${Math.round(p * 100)}%`;
  const HUMAN = 0, CPU = 1;
  /** Touchscreen (finger) input: tap wording, bigger tap targets, no keyboard hints. */
  const isTouch = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const tx = (desktop, touch) => (isTouch() ? touch : desktop);
  const TAP_PX = 22;      // finger tap radius around a player
  const TAP_AIM_PX = 12;  // smaller radius when aiming at space (through balls), so taps near a runner still pick the spot
  const RETAP_PX = 24;    // a second tap this close to the selected spot commits it

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tt_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tt_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  const UI = {
    m: null, R: null, wait: null, mode: 'pass', sel: null, hover: null, hoverPt: null, plan: {}, markFrom: null, run: null, runKind: null,
    phase: 'menu', quick: false, feedIdx: 0, badges: null, threat: null, rec: [], cur: null, started: 0,
    opts: { team: store.get('team', 0), opp: store.get('opp', 1), diff: store.get('diff', 'normal'), len: store.get('len', 'normal') },
    speed: store.get('speed', 1), sound: store.get('sound', true), paused: false,
  };
  window.UI = UI; // handy for debugging / automated playtests

  // ------------------------------------------------------------------ menu
  function buildMenu() {
    const tp = $('teamPick'), op = $('oppPick');
    tp.innerHTML = ''; op.innerHTML = '';
    FB.TEAMS.forEach((t, i) => {
      const card = (small) => {
        const d = document.createElement('div');
        d.className = 'card';
        d.innerHTML = `<div class="nm"><span class="chip" style="background:${t.colors[0]};border-color:${t.colors[1]}"></span>${t.name}</div>` +
          (small ? '' : `<div class="meta">${t.formation} · ${t.blurb}</div>`);
        return d;
      };
      const a = card(false); a.onclick = () => { UI.opts.team = i; if (UI.opts.opp === i) UI.opts.opp = (i + 1) % 4; refreshMenu(); };
      const b = card(true); b.onclick = () => { if (i !== UI.opts.team) { UI.opts.opp = i; refreshMenu(); } };
      a.dataset.i = i; b.dataset.i = i;
      tp.appendChild(a); op.appendChild(b);
    });
    seg($('diffPick'), [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], () => UI.opts.diff, (v) => { UI.opts.diff = v; });
    seg($('lenPick'), [['short', 'Short ~14 min'], ['normal', 'Normal ~19 min']], () => UI.opts.len, (v) => { UI.opts.len = v; });
    refreshMenu();
  }
  function refreshMenu() {
    if (UI.opts.opp === UI.opts.team) UI.opts.opp = (UI.opts.team + 1) % 4;
    [...$('teamPick').children].forEach((c) => c.classList.toggle('sel', +c.dataset.i === UI.opts.team));
    [...$('oppPick').children].forEach((c) => { c.classList.toggle('sel', +c.dataset.i === UI.opts.opp); c.classList.toggle('disabled', +c.dataset.i === UI.opts.team); });
  }
  function seg(el, items, get, set) {
    el.innerHTML = '';
    for (const [v, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => { set(v); [...el.children].forEach((x, i) => x.classList.toggle('on', items[i][0] === get())); };
      el.appendChild(b);
    }
    [...el.children].forEach((x, i) => x.classList.toggle('on', items[i][0] === get()));
  }

  // ------------------------------------------------------------------ start
  function startMatch() {
    window.Sound.init();
    window.Sound.setOn(UI.sound);
    store.set('team', UI.opts.team); store.set('opp', UI.opts.opp); store.set('diff', UI.opts.diff); store.set('len', UI.opts.len);
    const home = FB.TEAMS[UI.opts.team], away = FB.TEAMS[UI.opts.opp];
    const qs = new URLSearchParams(location.search);
    const seed = qs.get('seed') ? +qs.get('seed') : undefined; // ?seed=123 for reproducible matches
    UI.m = FB.createMatch({ home, away, human: HUMAN, difficulty: UI.opts.diff, length: UI.opts.len, seed });
    UI.feedIdx = 0; $('feed').innerHTML = '';
    UI.rec = []; UI.started = performance.now(); UI.pausedMs = 0;
    UI.R.setMatch(UI.m);
    UI.lastMinute = 0;
    $('menu').classList.add('hidden');
    $('chipH').style.background = home.colors[0]; $('chipH').style.borderColor = home.colors[1];
    $('chipA').style.background = away.colors[0]; $('chipA').style.borderColor = away.colors[1];
    $('nameH').textContent = home.name; $('nameA').textContent = away.name;
    $('nameH').dataset.short = home.short; $('nameA').dataset.short = away.short; // compact header on phones
    UI.phase = 'play';
    updateHud();
    if (!store.get('seenHelp', false)) { store.set('seenHelp', true); showHelp(true).then(() => loop()); }
    else loop();
  }

  // ------------------------------------------------------------------ flow
  let loopToken = 0;
  async function loop() {
    const token = ++loopToken;
    const m = UI.m;
    window.Sound.play('whistle');
    while (!m.over && token === loopToken) {
      await beat(token);
      if (token !== loopToken) return;
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitUnpaused() { while (UI.paused) await sleep(100); }
  async function play(tl, sp) { await waitUnpaused(); if (UI.cur) UI.cur.tls.push(tl); await UI.R.play(tl, sp); }

  async function beat(token) {
    const m = UI.m;
    UI.cur = { snap: UI.R.snapshot(), tls: [] };
    UI.rec.push(UI.cur); if (UI.rec.length > 3) UI.rec.shift();
    const s = FB.startBeat(m);
    await play(s.tl);
    await UI.R.settle(0.15);
    flushFeed();
    if (token !== loopToken) return;
    if (s.penalty) {
      await penaltyFlow();
    } else {
      let ended = false;
      if (s.needDefense) {
        if (m.poss === HUMAN) {
          const d = FB.AI.chooseDefense(m);
          UI.cpuPlanText = describePlan(m, d, false);
          const r = FB.applyDefense(m, d);
          await play(r.tl);
          ended = r.ended;
        } else {
          const d = await humanDefense();
          if (token !== loopToken) return;
          const r = FB.applyDefense(m, d);
          await play(r.tl);
          ended = r.ended;
        }
        flushFeed();
      } else UI.cpuPlanText = m.setPiece ? setPieceText(m) : '';
      if (!ended) await attackPhase(token);
      else if (FB.canQuick(m)) await attackPhase(token, true); // ball won with a tackle: counter-attack chance
    }
    if (token !== loopToken) return;
    const evs = FB.endBeat(m);
    await UI.R.settle(0.18);
    flushFeed();
    updateHud();
    if (evs.includes('goal')) await goalCelebration();
    if (evs.includes('halftime')) { window.Sound.play('whistle3'); await report('half'); UI.R.syncAll(); }
    if (evs.includes('fulltime')) { window.Sound.play('whistle3'); await report('full'); }
    if (evs.includes('added')) window.Sound.play('cheer');
  }

  async function attackPhase(token, counterStart) {
    const m = UI.m;
    let first = !counterStart;
    UI.quick = false;
    while (true) {
      if (token !== loopToken) return;
      let a;
      if (m.poss === HUMAN) {
        if (!first) { FB.startQuick(m); flushFeed(); } // enter first-time mode before showing options/odds
        a = await humanAttack(!first);
        if (token !== loopToken) return;
        if (!a) { if (UI.run) FB.orderRun(m, HUMAN, UI.run); UI.run = null; UI.runKind = null; return; } // took a touch
      } else {
        const ctr = !first && FB.isCounter(m);
        setPhase(first ? 'CPU in possession…' : ctr ? 'CPU won the ball. Counter-attack?' : 'CPU plays it quick…', 'wait');
        hint('The opponent is on the ball. Watch how the move plays out. The caption explains the odds.');
        $('modes').innerHTML = ''; $('extra').innerHTML = ''; $('preview').innerHTML = cpuThinkingText();
        setButtons(null, null);
        await sleep(first ? 380 : 220);
        a = first ? FB.AI.chooseAttack(m) : FB.AI.chooseQuick(m);
        if (!a) { const run = FB.AI.chooseRun(m); if (run) FB.orderRun(m, m.poss, run); return; } // took a touch
      }
      if (!first && m.poss !== HUMAN) { FB.startQuick(m); flushFeed(); }
      const res = FB.resolveAttack(m, a);
      excite(m, a, res);
      await play(res.tl);
      flushFeed();
      updateHud();
      first = false;
      if (!FB.canQuick(m)) return;
      await UI.R.settle(0.15);
    }
  }

  function excite(m, a, res) {
    const S = window.Sound;
    if (res.result === 'saved' || (res.result === 'wide' && res.ev && res.ev.shot && res.ev.shot.xg > 0.12)) S.play('ooh');
    if (res.result === 'intercepted' && m.poss === HUMAN) S.play('cheer');
  }

  function crowdLevel() {
    const m = UI.m;
    if (!m || m.carrier == null) return 0.2;
    const c = FB.carrier(m);
    const x = FB.rel(c.team, c).x;
    return Math.max(0, (x - 55) / 50) + (m.time > 5100 ? 0.25 : 0) + Math.abs(m.momentum) * 0.2;
  }

  // ------------------------------------------------------------------ human attack
  const MODES = [
    ['pass', '1', 'Pass'], ['through', '2', 'Through'], ['lob', '3', 'Lofted'],
    ['dribble', '4', 'Dribble'], ['shoot', '5', 'Shoot'], ['clear', '6', 'Clear'],
  ];

  function humanAttack(quick) {
    const m = UI.m;
    UI.quick = quick;
    UI.phase = 'attack';
    UI.sel = null; UI.hover = null; UI.hoverPt = null;
    const allowed = FB.allowedActions(m);
    if (!allowed[UI.mode] && UI.mode !== 'clear') UI.mode = 'pass';
    if (UI.mode === 'shoot' && !allowed.shoot) UI.mode = 'pass';
    if (UI.mode === 'dribble' && !allowed.dribble) UI.mode = 'pass';
    const c = FB.carrier(m);
    const counter = quick && FB.isCounter(m);
    setPhase(counter ? `⚡ COUNTER-ATTACK — ${c.name}` : quick ? `⚡ FIRST-TIME CHANCE — ${c.name}` : `YOUR BALL — ${c.name} (#${c.num})`, 'attack');
    const modes = $('modes'); modes.innerHTML = ''; modes.classList.remove('four');
    for (const [k, key, label] of MODES) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${key}</kbd>${label}`;
      b.disabled = k !== 'clear' && !allowed[k];
      b.onclick = () => setMode(k);
      b.dataset.mode = k;
      modes.appendChild(b);
    }
    UI.run = null; UI.runKind = null;
    // on a phone the first-time rule goes in the preview box instead, so the run row fits on one line
    $('extra').innerHTML = isTouch() && quick ? ''
      : counter ? '<span>You won it! Break before they regroup: first-time rules (−5% accuracy, no dribbling). <b>Space</b> = take a touch instead.</span>'
      : quick ? '<span>Playing first-time: −5% accuracy, no dribbling. <b>Space</b> = take a touch instead.</span>'
      : (UI.cpuPlanText ? `<span>Opponent: ${UI.cpuPlanText}</span>` : '');
    if (quick) buildRunRow();
    setMode(UI.mode, true);
    hint(counter ? tx('Counter-attack: their players are still upfield. Play it now, or press Space / "Take a touch" to settle (they get to regroup).',
      'Counter-attack: their players are still upfield. Play it now, or tap "Take a touch" to settle (they get to regroup).')
      : quick ? tx('First-time: pick an action now, or press Space / "Take a touch" to settle (the defence resets).',
      'First-time: pick an action now, or tap "Take a touch" to settle (the defence resets).')
      : tx('Hover to preview, click to select, click again or Enter to commit. Number keys switch action.',
        'Tap to select and see the odds, then tap again or press Commit. The buttons switch action.'));
    return new Promise((resolve) => { UI.wait = { kind: 'attack', resolve }; });
  }

  // ------------------------------------------------------------------ runs (called when taking a touch)
  const RUNS = [['behind', 'B', 'In behind'], ['overlap', 'O', 'Overlap'], ['short', 'S', 'Come short']];
  const RUN_TXT = { behind: 'runs in behind', overlap: 'overlaps', short: 'comes short' };
  function buildRunRow() {
    const ex = $('extra');
    const row = document.createElement('span'); row.className = 'seg'; row.id = 'runSeg';
    ex.appendChild(document.createTextNode(tx('Run when you take a touch:', 'Run:')));
    for (const [k, key, label] of RUNS) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${key}</kbd>${isTouch() && k === 'short' ? 'Short' : label}`;
      b.dataset.run = k;
      b.onclick = () => setRunKind(k);
      row.appendChild(b);
    }
    ex.appendChild(row);
    const info = document.createElement('span'); info.id = 'runInfo'; ex.appendChild(info);
    refreshRunRow();
  }
  function refreshRunRow() {
    const row = $('runSeg'); if (!row) return;
    const on = UI.runKind || (UI.run && UI.run.kind);
    [...row.children].forEach((b) => b.classList.toggle('on', b.dataset.run === on));
    $('runInfo').innerHTML = UI.runKind ? `${tx('Click', 'Tap')} the runner` : UI.run ? `${nm(UI.run.id)} ${RUN_TXT[UI.run.kind]}` : '';
  }
  /** Pick a kind of run, then the teammate (picking the same kind again cancels). */
  function setRunKind(k) {
    if (!UI.quick || !UI.wait || UI.wait.kind !== 'attack') return;
    if (UI.runKind === k || !UI.runKind && UI.run && UI.run.kind === k) { UI.runKind = null; UI.run = null; }
    else { UI.runKind = k; if (UI.run) UI.run = { id: UI.run.id, kind: k }; }
    refreshRunRow();
    window.Sound.play('click');
  }
  const canRun = (id) => id != null && UI.m.players[id].team === HUMAN && id !== UI.m.carrier && UI.m.players[id].role !== 'GK';
  function pickRunner(id) {
    if (!canRun(id)) { flashHint('Pick a teammate to make the run (not the keeper).'); return; }
    UI.run = { id, kind: UI.runKind }; UI.runKind = null;
    refreshRunRow();
    flashHint(`${nm(id)} ${RUN_TXT[UI.run.kind]} if you take a touch${tx('. Space to go with it, or play first-time and forget it.', '.')}`);
    window.Sound.play('click');
  }

  function setMode(k, silent) {
    const m = UI.m;
    const allowed = FB.allowedActions(m);
    if (k !== 'clear' && !allowed[k]) return;
    UI.mode = k; UI.sel = null;
    [...$('modes').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === k));
    computeBadges();
    if (k === 'shoot' || k === 'clear') UI.sel = { type: k };
    refreshPreview();
    if (!silent) window.Sound.play('click');
  }

  function computeBadges() {
    const m = UI.m;
    UI.badges = null;
    if (UI.phase !== 'attack') return;
    if (UI.mode === 'pass' || UI.mode === 'lob') {
      UI.badges = {};
      for (const p of FB.active(m, HUMAN)) {
        if (p.id === m.carrier) continue;
        const ev = FB.evaluate(m, { type: UI.mode, to: p.id });
        UI.badges[p.id] = ev.valid ? ev : null;
      }
    }
  }

  function candidateAt(pt, id) {
    const m = UI.m;
    const c = FB.carrier(m);
    switch (UI.mode) {
      case 'pass': return id != null && m.players[id].team === HUMAN && id !== m.carrier ? { type: 'pass', to: id } : null;
      case 'lob': if (id != null && m.players[id].team === HUMAN && id !== m.carrier) return { type: 'lob', to: id };
        return pt ? { type: 'lob', target: clampPt(pt) } : null;
      case 'through': {
        if (id != null && m.players[id].team === HUMAN && id !== m.carrier) {
          const p = m.players[id];
          return { type: 'through', target: clampPt({ x: p.x + 9, y: p.y + (34 - p.y) * 0.15 }), runner: id };
        }
        return pt ? { type: 'through', target: clampPt(pt) } : null;
      }
      case 'dribble': {
        if (!pt) return null;
        const max = FB.dribbleMax(c);
        const d = Math.hypot(pt.x - c.x, pt.y - c.y);
        const k = d > max ? max / d : 1;
        return { type: 'dribble', target: clampPt({ x: c.x + (pt.x - c.x) * k, y: c.y + (pt.y - c.y) * k }) };
      }
      case 'shoot': return { type: 'shoot' };
      case 'clear': return { type: 'clear' };
    }
    return null;
  }
  const clampPt = (p) => ({ x: Math.max(0.6, Math.min(L - 0.6, p.x)), y: Math.max(0.6, Math.min(W - 0.6, p.y)) });

  function sameAction(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.to != null || b.to != null) return a.to === b.to;
    const tol = isTouch() ? Math.max(2.5, RETAP_PX / UI.R.s) : 2.5;
    if (a.target && b.target) return Math.hypot(a.target.x - b.target.x, a.target.y - b.target.y) < tol;
    return true;
  }

  function riskClass(p) { return p >= 0.8 ? 'risk-low' : p >= 0.6 ? 'risk-mid' : p >= 0.4 ? 'risk-high' : 'risk-vhigh'; }
  function riskWord(p) { return p >= 0.85 ? 'Safe' : p >= 0.7 ? 'Some risk' : p >= 0.5 ? 'Risky' : p >= 0.3 ? 'Gamble' : 'Long shot'; }
  const nm = (id) => (id == null ? '?' : UI.m.players[id].name);
  const prLabel = (pr) => (pr < 0.25 ? 'free' : pr < 0.6 ? 'some pressure' : pr < 0.9 ? 'under pressure' : 'swarmed');

  function describeAction(a, ev) {
    const m = UI.m;
    if (!ev.valid) return `<div class="lbl">${labelOf(a)}</div><div class="risk-vhigh">${ev.reason}</div>`;
    const lines = [];
    let head = '', big = '';
    const off = ev.offP || 0;
    if (a.type === 'pass') {
      head = `Pass to ${nm(a.to)} · ${Math.round(ev.d)} m`;
      big = pct(ev.p);
      lines.push(`Accuracy ${pct(ev.exec)}${FB.pressureOn(m, FB.carrier(m)) > 0.5 ? ' (you are being pressed)' : ''}`);
      lines.push(ev.lane.p > 0.03 ? `Lane: ${ev.lane.list.filter((x) => x.p > 0.03).map((x) => `${nm(x.id)} ${pct(x.p)}`).join(', ')} could cut it out` : 'Lane is clear');
      lines.push(`Receiver is ${prLabel(ev.recvPressure)}${ev.markedBy != null ? `, tightly marked by ${nm(ev.markedBy)}` : ''} → first touch ${pct(ev.ctrl)}`);
    } else if (a.type === 'through') {
      head = `Through ball for ${nm(ev.runner)}`;
      big = pct(ev.p);
      lines.push(`Race: ${nm(ev.runner)} ${ev.runT.toFixed(1)}s vs ${ev.chaser != null ? nm(ev.chaser) : 'nobody'} ${ev.defT < 50 ? ev.defT.toFixed(1) + 's' : ''} → wins ${pct(ev.pRace)}`);
      lines.push(`Accuracy ${pct(ev.exec)} · lane ${ev.lane.p > 0.03 ? pct(ev.lane.p) + ' intercept risk' : 'clear'}`);
      if (ev.trapReact) lines.push(`${nm(ev.chaser)} stepped up for the trap: +${ev.trapReact}s to turn`);
      if (ev.runStart) lines.push(`${nm(ev.runner)} is already running in behind: ${ev.runStart}s head start`);
      const tr = FB.rel(HUMAN, ev.target);
      if (tr.x > 85) lines.push('Gets in behind — big chance if it comes off');
    } else if (a.type === 'lob') {
      head = ev.header ? `Cross for ${nm(ev.recv)}` : `Lofted ball to ${nm(ev.recv)}`;
      big = pct(ev.p);
      lines.push(`Delivery ${pct(ev.exec)}`);
      lines.push(`Aerial duel${ev.duel != null ? ' vs ' + nm(ev.duel) : ''}: ${pct(ev.pWin)}`);
      if (ev.pClaim > 0.02) lines.push(`Keeper may claim: ${pct(ev.pClaim)}`);
      if (ev.header) lines.push(`<b>Header at goal</b> if won → scores ${pct(ev.shot.xg)} (overall goal ~${pct(ev.p * ev.shot.xg)})`);
    } else if (a.type === 'dribble') {
      head = `Dribble ${Math.round(ev.d)} m`;
      big = pct(ev.p);
      if (!ev.challengers.length) lines.push('Nobody can get near you — free carry');
      for (const x of ev.challengers) lines.push(`${nm(x.id)} challenges${x.jockey ? ' (covering: longer reach, half the fouls)' : ''}: tackle ${pct(x.pT)}, foul ${pct(x.pF)}`);
      lines.push(`Heavy touch risk ${pct(ev.lose)}`);
      if (ev.pFoul > 0.02) lines.push(`Win a free kick: ${pct(ev.pFoul)}${FB.inOppBox(FB.rel(HUMAN, ev.target)) ? ' — PENALTY if fouled in the box!' : ''}`);
    } else if (a.type === 'shoot') {
      const s = ev.shot;
      head = 'Shoot!';
      big = pct(s.goal);
      lines.push(`Goal chance ${pct(s.goal)} · on target ${pct((1 - s.pBlock) * s.pOn)}`);
      lines.push(`Angle/distance quality ${pct(s.base)}${s.pressure > 0.4 ? ` · ${prLabel(s.pressure)} (−${Math.round(100 * FB.TUNE.shotPressure * Math.min(1, s.pressure))}%)` : ''}`);
      lines.push(s.pBlock > 0.03 ? `Block risk ${pct(s.pBlock)} (${s.blockers.map((b) => nm(b.id)).join(', ')})` : 'Clear sight of goal');
      if (m.setPiece && m.setPiece.type === 'freekick') lines.push('Direct free kick: bend it over the wall');
    } else if (a.type === 'clear') {
      head = 'Clear it long';
      const keep = ev.outcomes[0].keep;
      big = `Kept ${pct(ev.p * keep)}`;
      lines.push(`Hoofs the ball ~40 m upfield, out of danger. A teammate gets to it first ${pct(keep)} of the time.`);
      if (ev.charge.p > 0.02) lines.push(`Charge-down risk ${pct(ev.charge.p)}`);
    }
    if (m.cover && !m.cover.used && m.quick < FB.TUNE.quickMax && (a.type === 'pass' || a.type === 'through' || a.type === 'lob' && !ev.header)) {
      lines.push(`${nm(m.cover.id)} is covering: if this comes off he slides up to ${FB.TUNE.coverSlide} m towards ${nm(ev.recv != null ? ev.recv : ev.runner)}`);
    }
    const ln = lineNote(a, ev);
    if (ln) lines.push(ln);
    if (off > 0.01) lines.unshift(`<b class="risk-vhigh">⚑ Offside risk ${pct(off)}</b> — the receiver is ${off > 0.9 ? 'clearly' : 'near'} beyond the line`);
    const pv = a.type === 'shoot' ? ev.shot.goal * 2.2 : a.type === 'clear' ? 0.5 : ev.p;
    const label = a.type === 'shoot' ? (ev.shot.goal > 0.3 ? 'Big chance' : ev.shot.goal > 0.12 ? 'Decent chance' : ev.shot.goal > 0.05 ? 'Half chance' : 'Speculative') : a.type === 'clear' ? 'Safety first' : riskWord(ev.p);
    const failTxt = { pass: 'If it fails: turnover where it is cut out.', through: 'If it fails: they win it and can counter.', lob: ev.header ? 'If it fails: cleared, maybe a corner.' : 'If it fails: they win the header.', dribble: 'If it fails: dispossessed, and you are out of position.', shoot: 'If it misses: goal kick, a corner or a rebound.', clear: '' }[a.type];
    return `<div class="lbl">${head}</div><div><span class="big ${riskClass(pv)}">${big}</span> <span class="${riskClass(pv)}">${label}</span></div><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>${failTxt ? `<div class="muted">${failTxt}</div>` : ''}`;
  }
  /** One line on how the defending side's line height changes these odds (null when it doesn't). */
  function lineNote(a, ev) {
    const m = UI.m;
    const c = FB.carrier(m);
    const line = m.lines[1 - c.team];
    if (line === 'normal') return null;
    const deep = line === 'deep';
    const secs = (x) => String(+Math.abs(x).toFixed(2));
    if (a.type === 'through' && ev.lineReact) return deep ? `Their deep line is already set: defenders react ${secs(ev.lineReact)}s sooner` : `Their high line has to turn and chase: +${secs(ev.lineReact)}s for defenders`;
    if (a.type === 'lob' && ev.aerial) return deep ? 'Their deep block is packed in the box: harder to win it in the air' : 'Their high line is running back: easier to win it in the air';
    if (a.type === 'shoot' && ev.shot.lineBlock !== 1 && !(m.setPiece && m.setPiece.type === 'freekick')) return deep ? 'Their deep block puts bodies in the way: more shots get blocked' : 'Their high line has fewer bodies back: fewer blocks';
    if (a.type === 'pass') {
      const tx2 = FB.rel(c.team, m.players[a.to]).x;
      if (deep && tx2 > 70) return 'Their deep block crowds the final third: lanes near the box are tighter';
      if (!deep && tx2 > 35 && tx2 < 70) return 'Their high line squeezes midfield: lanes there are tighter';
    }
    return null;
  }
  function labelOf(a) { return { pass: 'Pass', through: 'Through ball', lob: 'Lofted ball', dribble: 'Dribble', shoot: 'Shot', clear: 'Clear' }[a.type] || a.type; }

  function refreshPreview() {
    const m = UI.m;
    if (UI.phase === 'attack') {
      const a = UI.sel || candidateAt(UI.hoverPt, UI.hover);
      UI.prevAction = a;
      UI.prevEval = a ? FB.evaluate(m, a) : null;
      if (!a) {
        const rule = UI.quick ? `<div>${FB.isCounter(UI.m) ? 'Counter-attack' : 'First-time'}: −5% accuracy, no dribbling.</div>` : '';
        $('preview').innerHTML = `<div class="lbl">${labelOf({ type: UI.mode })}</div>${rule}<div class="muted">${modeHelp(UI.mode)}</div>`;
      } else $('preview').innerHTML = (UI.sel ? `<div class="lbl" style="color:#4fc3f7">${tx('Selected — click again or Enter', 'Selected — tap again or press Commit')}</div>` : '') + describeAction(a, UI.prevEval);
      setButtons(UI.sel && UI.prevEval && UI.prevEval.valid ? `Commit ${labelOf(UI.sel)} (Enter)` : 'Select an action first',
        UI.quick ? 'Take a touch (Space)' : canCancel() && isTouch() ? 'Cancel' : null);
      $('btnGo').disabled = !(UI.sel && UI.prevEval && UI.prevEval.valid);
    } else if (UI.phase === 'defend') {
      $('preview').innerHTML = describeDefense();
    }
  }
  function modeHelp(k) {
    const v = tx('Hover over', 'Tap');
    return {
      pass: `${v} a teammate to see the odds. The badges show every option.`,
      through: `${v} ${tx('space', 'the space')} ahead of a teammate. They will run onto it. Watch the offside line.`,
      lob: `${v} a teammate or a spot. Aim into the box from wide to cross.`,
      dribble: `${v} inside the ring to carry the ball. Ringed defenders may challenge.`,
      shoot: 'Shoot from here.',
      clear: 'Launch it upfield.',
    }[k];
  }
  /** A pitch selection that can be cleared (Esc / Cancel). Shoot and clear are always "selected". */
  const canCancel = () => !!UI.sel && UI.mode !== 'shoot' && UI.mode !== 'clear';
  function cancelSel() { if (canCancel()) { UI.sel = null; refreshPreview(); } }

  // ------------------------------------------------------------------ human defense
  const DMODES = [['press', '1', 'Press'], ['tackle', '2', 'Tackle'], ['mark', '3', 'Mark'], ['cover', '4', 'Cover']];
  function humanDefense() {
    const m = UI.m;
    UI.phase = 'defend';
    UI.plan = { line: m.lines[HUMAN] };
    UI.markFrom = null;
    if (!DMODES.some((x) => x[0] === UI.dmode)) UI.dmode = 'press';
    UI.threat = FB.AI.threatMap(m);
    UI.opts_def = FB.defenseOptions(m);
    const c = FB.carrier(m);
    setPhase(`DEFENDING — ${c.name} (#${c.num}) has it`, 'defend');
    const modes = $('modes'); modes.innerHTML = ''; modes.classList.add('four');
    for (const [k, key, label] of DMODES) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${key}</kbd>${label}`;
      b.dataset.mode = k;
      b.onclick = () => setDMode(k);
      modes.appendChild(b);
    }
    const ex = $('extra');
    ex.innerHTML = '';
    const live = FB.liveMark(m, HUMAN);
    const short = live && isTouch(); // with a third control the row only fits a phone with short labels
    const tb = document.createElement('button'); tb.id = 'trapBtn'; tb.innerHTML = `<kbd>T</kbd>${short ? 'Trap' : 'Offside trap'}`; tb.onclick = () => toggleTrap(); ex.appendChild(tb);
    const lineWrap = document.createElement('span'); lineWrap.className = 'seg'; lineWrap.id = 'lineSeg';
    if (live) { const rb = document.createElement('button'); rb.id = 'releaseBtn'; rb.innerHTML = `<kbd>X</kbd>${short ? 'Release' : 'Release mark'}`; rb.onclick = toggleRelease; ex.appendChild(rb); }
    if (!short) ex.appendChild(document.createTextNode(' Line:'));
    ex.appendChild(lineWrap);
    seg(lineWrap, [['deep', 'Deep (Q)'], ['normal', 'Normal (W)'], ['high', 'High (E)']].map(([v, t]) => [v, stripKeys(t)]), () => UI.plan.line, (v) => { UI.plan.line = v; refreshPreview(); });
    setDMode(UI.dmode, true);
    setButtons('Confirm plan (Enter)', 'Hold shape (Space)');
    $('btnGo').disabled = false;
    hint('Choose how to defend: press, tackle or cover the carrier, tight-mark a threat (red rings), or just hold shape. You can combine one press, tackle or cover with one mark. A mark stays on for ' + turns(FB.TUNE.markBeats) + '.');
    return new Promise((resolve) => { UI.wait = { kind: 'defend', resolve }; });
  }
  function setDMode(k, silent) {
    UI.dmode = k; UI.markFrom = null;
    [...$('modes').children].forEach((b) => b.classList.toggle('on', b.dataset.mode === k));
    refreshPreview();
    if (!silent) window.Sound.play('click');
  }
  function toggleTrap() { UI.plan.trap = !UI.plan.trap; const b = $('trapBtn'); if (b) b.classList.toggle('on', !!UI.plan.trap); refreshPreview(); }

  /** Take the marker off his man (the standing mark from an earlier turn). */
  function toggleRelease() {
    if (!FB.liveMark(UI.m, HUMAN)) return;
    UI.plan.unmark = !UI.plan.unmark;
    const b = $('releaseBtn'); if (b) b.classList.toggle('on', UI.plan.unmark);
    refreshPreview();
  }
  const turns = (n) => (n === 1 ? '1 more turn' : `${n} more turns`);
  /** What happens to a standing mark under the plan so far: null if there is none. */
  function liveMarkText() {
    const m = UI.m, P = UI.plan, o = FB.liveMark(m, HUMAN);
    if (!o) return null;
    if (P.mark) return P.mark.d === o.d && P.mark.a === o.a ? null : `${nm(o.d)} leaves ${nm(o.a)} (one mark at a time).`;
    if (P.unmark) return `${nm(o.d)} is released from ${nm(o.a)} and goes back to his zone next turn.`;
    if (FB.markerAfter(m, P) == null) return `${nm(o.d)} has another job, so he stops marking ${nm(o.a)}.`;
    return `${nm(o.d)} is marking ${nm(o.a)}: ${o.left ? `this turn and ${turns(o.left)}` : 'last turn'}. ${tx('<b>X</b> releases him', 'Tap <b>Release</b> to take him off')}.`;
  }

  const LINE_TXT = {
    deep: 'deep. Protects the box: more shots blocked, more headers won, harder to play through. But you win the ball back far from their goal, so your counters start deep.',
    normal: 'normal. Balanced.',
    high: 'high. Squeezes midfield and wins the ball back higher, so your counters start closer to goal. But balls over the top are dangerous: your defenders have to turn and chase.',
  };
  function describeDefense() {
    const m = UI.m, P = UI.plan;
    const c = FB.carrier(m);
    const lines = [];
    const v = tx('Click', 'Tap');
    const modeTxt = {
      press: `${v} one of your players inside the <b>big ring</b> to close the carrier down.`,
      tackle: `${v} one of your players inside the <b>small ring</b> to lunge for the ball now.`,
      cover: `${v} one of your players inside the <b>big ring</b> to stand off the carrier and slide to whoever gets the next ball.`,
      mark: `${v} a dangerous opponent (red rings) to tight-mark them. ${v} your own player first to choose who marks.`,
    }[UI.dmode];
    if (P.press != null) lines.push(`<b>Press:</b> ${nm(P.press)} closes ${c.name} down. Every option gets harder for them, but ${nm(P.press)} leaves his zone and is caught upfield if bypassed.`);
    if (P.cover != null) lines.push(`<b>Cover:</b> ${nm(P.cover)} stands off ${c.name}, then steps up to ${FB.TUNE.coverSlide} m towards whoever receives the next completed ball, before they can play it first-time. Harder to dribble past and half the fouls, but he puts less pressure on the pass.`);
    if (P.tackle != null) {
      const o = FB.tackleOdds(m, P.tackle);
      lines.push(`<b>Tackle:</b> ${nm(P.tackle)} lunges. <span class="risk-low">Win ${pct(o.pWin)}</span> · <span class="risk-high">foul ${pct(o.pFoul)}${FB.inOppBox(FB.rel(c.team, c)) ? ' = PENALTY' : ' (card risk)'}</span> · <span class="risk-vhigh">beaten ${pct(o.pBeat)}</span>`);
    }
    if (P.mark) lines.push(`<b>Mark:</b> ${nm(P.mark.d)} tight on ${nm(P.mark.a)}, and follows him for ${turns(FB.TUNE.markBeats)}, until you win the ball or play stops. Passes to him get much harder, but ${nm(P.mark.d)} leaves his zone and won't cut out balls to anyone else.`);
    const lm = liveMarkText();
    if (lm) lines.push(`<b>Standing mark:</b> ${lm}`);
    const rm = m.runMade;
    if (rm && rm.team !== HUMAN) lines.push(`<b>Their run:</b> ${nm(rm.id)} ${RUN_TXT[rm.kind]}${rm.kind === 'behind' ? `. A through ball to him now gets a ${FB.TUNE.runStart}s head start, unless you mark him or catch him offside` : ''}.`);
    if (UI.markFrom != null) lines.push(`<i>${nm(UI.markFrom)} selected. Now click the opponent to mark.</i>`);
    if (P.trap) lines.push('<b>Offside trap:</b> the back line steps up 4 m. Runners on the line are caught, but whoever steps up needs ' + FB.TUNE.trapReact + 's longer to chase a ball in behind, and is slow next turn if a through ball or lob beats him.');
    lines.push(`<b>Line:</b> ${LINE_TXT[P.line] || P.line}`);
    const top = Object.entries(UI.threat || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => nm(+id));
    return `<div class="lbl">Your plan</div><div class="muted" style="margin-bottom:4px">${modeTxt}</div><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` +
      (top.length ? `<div class="muted">Biggest threats: ${top.join(', ')}</div>` : '');
  }

  function defenseClick(pt, id) {
    const m = UI.m, P = UI.plan, o = UI.opts_def;
    if (id == null) return;
    const p = m.players[id];
    if (UI.dmode === 'press' && p.team === HUMAN) {
      if (o.press.includes(id)) { P.press = P.press === id ? undefined : id; P.tackle = undefined; P.cover = undefined; if (P.mark && P.mark.d === id) P.mark = undefined; }
      else flashHint(`${p.name} is too far away to press (must be inside the big ring).`);
    } else if (UI.dmode === 'cover' && p.team === HUMAN) {
      if (o.cover.includes(id)) { P.cover = P.cover === id ? undefined : id; P.press = undefined; P.tackle = undefined; if (P.mark && P.mark.d === id) P.mark = undefined; }
      else flashHint(`${p.name} is too far away to cover (must be inside the big ring).`);
    } else if (UI.dmode === 'tackle' && p.team === HUMAN) {
      if (o.tackle.includes(id)) { P.tackle = P.tackle === id ? undefined : id; P.press = undefined; P.cover = undefined; if (P.mark && P.mark.d === id) P.mark = undefined; }
      else flashHint(`${p.name} is too far away to tackle (must be inside the small ring).`);
    } else if (UI.dmode === 'mark') {
      if (p.team === HUMAN && p.role !== 'GK' && !m.beaten.has(id)) { UI.markFrom = id; }
      else if (p.team === CPU && id !== m.carrier && p.role !== 'GK') {
        let d = UI.markFrom;
        if (d == null) {
          const busy = new Set([P.press, P.tackle, P.cover]);
          d = FB.active(m, HUMAN).filter((q) => q.role !== 'GK' && !busy.has(q.id) && !m.beaten.has(q.id))
            .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0].id;
        }
        if (P.press === d) P.press = undefined;
        if (P.tackle === d) P.tackle = undefined;
        if (P.cover === d) P.cover = undefined;
        P.mark = P.mark && P.mark.a === id && P.mark.d === d ? undefined : { d, a: id };
        UI.markFrom = null;
      }
    }
    window.Sound.play('click');
    refreshPreview();
  }

  function commitDefense(hold) {
    if (!UI.wait || UI.wait.kind !== 'defend') return;
    const P = UI.plan;
    const act = hold ? { unmark: P.unmark, line: P.line } : { unmark: P.unmark, press: P.press, tackle: P.tackle, cover: P.cover, mark: P.mark, trap: P.trap, line: P.line };
    for (const k of Object.keys(act)) if (act[k] === undefined || k === 'unmark' && !act[k]) delete act[k];
    const w = UI.wait; UI.wait = null;
    UI.phase = 'resolve';
    setPhase('Defending…', 'wait');
    setButtons(null, null);
    w.resolve(act);
  }
  function commitAttack(a) {
    if (!UI.wait || UI.wait.kind !== 'attack') return;
    const ev = FB.evaluate(UI.m, a);
    if (!ev.valid) { flashHint(ev.reason); return; }
    const w = UI.wait; UI.wait = null;
    UI.phase = 'resolve'; UI.sel = null; UI.badges = null;
    setPhase('…', 'wait'); setButtons(null, null);
    w.resolve(a);
  }
  function settleQuick() {
    if (!UI.wait || UI.wait.kind !== 'attack' || !UI.quick) return;
    const w = UI.wait; UI.wait = null; UI.phase = 'resolve'; UI.badges = null;
    w.resolve(null);
  }

  function describePlan(m, d, mine) {
    const parts = [];
    if (d.press != null) parts.push(`${nm(d.press)} presses you`);
    if (d.tackle != null) parts.push(`${nm(d.tackle)} lunges in!`);
    if (d.cover != null) parts.push(`${nm(d.cover)} stands off and covers`);
    const lm = FB.liveMark(m, 1 - m.poss); // asked before the plan is applied
    if (d.mark) parts.push(`${nm(d.mark.d)} marks ${nm(d.mark.a)}`);
    else if (lm && FB.markerAfter(m, d) != null) parts.push(`${nm(lm.d)} still marks ${nm(lm.a)}`);
    if (d.trap) parts.push('back line steps up (offside trap)');
    if (d.line && d.line !== 'normal') parts.push(`${d.line} line`);
    void mine;
    return parts.length ? parts.join(' · ') : 'holding shape';
  }
  function setPieceText(m) {
    const t = m.setPiece.type;
    return { corner: 'Corner! Cross it into a zone or play it short.', freekick: m.setPiece.direct ? 'Free kick in range. Shoot over the wall or cross.' : 'Free kick.', kickoff: 'Kick-off.', penalty: 'Penalty!' }[t] || '';
  }
  function cpuThinkingText() {
    const m = UI.m;
    const c = FB.carrier(m);
    return `<div class="lbl">Opponent's move</div><div>${c ? c.name : ''} is deciding…</div>`;
  }

  // ------------------------------------------------------------------ penalty
  function penaltyFlow() {
    const m = UI.m;
    const shooting = m.poss === HUMAN;
    const c = FB.carrier(m);
    $('penTitle').textContent = shooting ? 'PENALTY to you!' : 'PENALTY against you!';
    $('penText').textContent = shooting ? `${c.name} places the ball on the spot. Where will he put it? The keeper is guessing too.` : `${c.name} steps up. Which way will your keeper dive?`;
    const g = (dir, dive) => pct(FB.penaltyGoal(m, dir, dive));
    $('penOdds').textContent = `Chance of a goal. Into a corner: ${g('L', 'L')} if the keeper guesses right, ${g('L', 'R')} if not. Down the middle: ${g('C', 'C')} if the keeper stays put, ${g('C', 'L')} if not.`;
    setPhase(shooting ? 'PENALTY — choose your side' : 'PENALTY — choose your dive', shooting ? 'attack' : 'defend');
    $('penalty').classList.remove('hidden');
    return new Promise((resolve) => {
      UI.wait = {
        kind: 'penalty',
        resolve: async (dir) => {
          $('penalty').classList.add('hidden');
          const shot = shooting ? dir : FB.AI.choosePenalty(m);
          const dive = shooting ? FB.AI.chooseDive(m) : dir;
          const r = FB.resolvePenalty(m, shot, dive);
          const sideTxt = { L: 'left', C: 'centre', R: 'right' };
          UI.R.caption = null;
          await play(r.tl, 0.7);
          UI.R.caption = { text: `Shot ${sideTxt[shot]}, keeper went ${sideTxt[dive]} → ${r.result.toUpperCase()}`, t0: performance.now() };
          flushFeed();
          resolve();
        },
      };
    });
  }

  // ------------------------------------------------------------------ goal / replay
  async function goalCelebration() {
    const m = UI.m;
    const g = m.goals[m.goals.length - 1];
    const mine = g.team === HUMAN;
    const team = m.teams[g.team];
    window.Sound.play('goal');
    UI.R.confetti(team.colors.concat(['#ffffff']));
    UI.R.flash = 0;
    UI.R.banner = { text: 'GOAL!', sub: `${g.scorer}${g.assist ? ' (assist ' + g.assist + ')' : ''} · ${g.min} · ${m.teams[0].short} ${m.score[0]}–${m.score[1]} ${m.teams[1].short}`, color: mine ? '#ffd54f' : '#ffffff', bg: team.colors[0] + 'dd', t0: performance.now() };
    updateHud();
    setPhase(mine ? 'GOAL! You scored!' : 'Goal conceded…', mine ? 'attack' : 'defend');
    $('modes').innerHTML = ''; $('extra').innerHTML = '';
    $('preview').innerHTML = `<div class="big">${g.scorer}</div><div class="muted">${g.how} · ${g.min}</div>`;
    setButtons('Continue (Enter)', 'Watch replay (R)');
    $('btnGo').disabled = false;
    hint(tx('Press R to watch a slow-motion replay, or Enter to continue.', 'Tap Watch replay for a slow-motion replay, or Continue.'));
    const choice = await new Promise((resolve) => { UI.wait = { kind: 'goal', resolve }; });
    UI.R.banner = null;
    if (choice === 'replay') await replay();
  }
  async function replay() {
    const recs = UI.rec.slice(-2).filter((r) => r.tls.length);
    if (!recs.length) return;
    const after = UI.R.snapshot();
    UI.R.banner = { text: 'REPLAY', color: '#80deea', bg: 'rgba(0,0,0,0.35)', t0: performance.now() };
    setTimeout(() => { if (UI.R.banner && UI.R.banner.text === 'REPLAY') UI.R.banner = { text: '', sub: 'REPLAY', bg: 'rgba(0,0,0,0)', t0: performance.now() }; }, 900);
    UI.R.restoreSnap(recs[0].snap);
    for (const r of recs) for (const tl of r.tls) await UI.R.play(tl.filter((s) => !s.setup), 0.45);
    await sleep(500);
    UI.R.banner = null;
    UI.R.restoreSnap(after);
  }

  // ------------------------------------------------------------------ report screens
  function statsRows(m) {
    const a = m.stats[0], b = m.stats[1];
    const tp = a.poss + b.poss || 1;
    const rows = [
      ['Possession', `${Math.round((100 * a.poss) / tp)}%`, `${Math.round((100 * b.poss) / tp)}%`],
      ['Shots', a.shots, b.shots], ['On target', a.onTarget, b.onTarget], ['Expected goals (xG)', a.xg.toFixed(2), b.xg.toFixed(2)],
      ['Passes (completed)', `${a.passes} (${a.passesOk})`, `${b.passes} (${b.passesOk})`],
      ['Pass accuracy', `${Math.round((100 * a.passesOk) / Math.max(1, a.passes))}%`, `${Math.round((100 * b.passesOk) / Math.max(1, b.passes))}%`],
      ['Tackles won', a.tackles, b.tackles], ['Interceptions', a.interceptions, b.interceptions],
      ['Corners', a.corners, b.corners], ['Fouls', a.fouls, b.fouls], ['Offsides', a.offsides, b.offsides],
      ['Yellow / red cards', `${a.yellows} / ${a.reds}`, `${b.yellows} / ${b.reds}`], ['Saves', a.saves, b.saves],
    ];
    return `<tr><td>${m.teams[0].name}</td><td></td><td>${m.teams[1].name}</td></tr>` + rows.map(([k, x, y]) => `<tr><td>${x}</td><td>${k}</td><td>${y}</td></tr>`).join('');
  }
  function report(kind) {
    const m = UI.m;
    $('repTitle').textContent = kind === 'half' ? 'Half-time' : 'Full time';
    $('repScore').innerHTML = `<span style="color:${m.teams[0].colors[0] === '#212121' ? '#ffb300' : '#fff'}">${m.teams[0].name}</span> ${m.score[0]} – ${m.score[1]} <span>${m.teams[1].name}</span>`;
    const gl = (t) => m.goals.filter((g) => g.team === t).map((g) => `⚽ ${g.scorer} ${g.min}${g.how === 'penalty' ? ' (pen)' : ''}`).join('<br>') || '&nbsp;';
    $('repGoals').innerHTML = `<div>${gl(0)}</div><div>${gl(1)}</div>`;
    $('repStats').innerHTML = statsRows(m);
    const realMin = ((performance.now() - UI.started - (UI.pausedMs || 0)) / 60000).toFixed(1);
    let note = '';
    if (kind === 'full') {
      const d = m.score[0] - m.score[1];
      note = (d > 0 ? '🏆 Victory! ' : d < 0 ? 'Defeat. ' : 'A draw. ') + `Real time played: ${realMin} min · ${m.beat} turns.`;
      const xgd = m.stats[0].xg - m.stats[1].xg;
      note += xgd > 0.5 && d <= 0 ? ' You created the better chances. The finishing let you down.' : xgd < -0.5 && d >= 0 ? ' You rode your luck today.' : '';
    } else note = `Real time so far: ${realMin} min.`;
    $('repNote').textContent = note;
    const btns = $('repBtns'); btns.innerHTML = '';
    $('report').classList.remove('hidden');
    return new Promise((resolve) => {
      const b = document.createElement('button');
      b.className = 'primary';
      if (kind === 'half') {
        b.textContent = 'Start second half ▶';
        b.onclick = () => { $('report').classList.add('hidden'); UI.wait = null; resolve(); };
        UI.wait = { kind: 'report', resolve: () => b.onclick() };
        btns.appendChild(b);
      } else {
        const again = document.createElement('button'); again.textContent = 'Rematch'; again.onclick = () => { $('report').classList.add('hidden'); startMatch(); };
        b.textContent = 'Main menu'; b.onclick = () => { $('report').classList.add('hidden'); toMenu(); };
        btns.appendChild(again); btns.appendChild(b);
        UI.wait = { kind: 'report', resolve: () => again.onclick() };
        resolve();
      }
    });
  }
  function toMenu() { loopToken++; UI.wait = null; UI.phase = 'menu'; UI.paused = false; $('pause').classList.add('hidden'); $('report').classList.add('hidden'); $('penalty').classList.add('hidden'); $('menu').classList.remove('hidden'); refreshMenu(); }

  // ------------------------------------------------------------------ HUD
  function setPhase(t, cls) { const el = $('phase'); el.textContent = t; el.className = 'phase ' + (cls || ''); }
  const stripKeys = (t) => (t && isTouch() ? t.replace(/\s*\((Enter|Space|Esc|R|[QWE])\)/g, '') : t);
  function setButtons(go, alt) {
    const g = $('btnGo'), a = $('btnAlt');
    go = stripKeys(go); alt = stripKeys(alt);
    g.classList.toggle('hidden', !go); a.classList.toggle('hidden', !alt);
    if (go) g.textContent = go;
    if (alt) a.textContent = alt;
  }
  function hint(t) { $('hint').innerHTML = t; UI.hintBase = t; }
  function flashHint(t) {
    $('hint').innerHTML = `<span style="color:#ff8a65">${t}</span>`; clearTimeout(UI.hintT); UI.hintT = setTimeout(() => { $('hint').innerHTML = UI.hintBase || ''; }, 2500);
    // compact layouts hide the hint bar: show the message on the pitch instead
    if (UI.R && getComputedStyle($('hint')).display === 'none') UI.R.caption = { text: t, t0: performance.now(), warn: true };
  }
  function flushFeed() {
    const m = UI.m; const feed = $('feed');
    while (UI.feedIdx < m.feed.length) {
      const f = m.feed[UI.feedIdx++];
      const d = document.createElement('div');
      d.className = 'k-' + f.kind;
      d.innerHTML = `<b>${f.min}</b>${f.text}`;
      feed.insertBefore(d, feed.firstChild);
      if (feed.children.length > 60) feed.removeChild(feed.lastChild);
    }
    window.Sound.excite(crowdLevel());
  }
  function updateHud() {
    const m = UI.m;
    $('scoreH').textContent = m.score[0]; $('scoreA').textContent = m.score[1];
    $('clock').textContent = FB.clockText(m);
    $('half').textContent = m.half === 1 ? '1st half' : '2nd half';
    const add = m.added[m.half - 1];
    $('added').classList.toggle('hidden', add == null);
    if (add != null) $('added').textContent = `+${add}`;
    const mo = m.momentum;
    const f = $('mfill');
    f.style.background = (mo >= 0 ? m.teams[0] : m.teams[1]).colors[0] === '#212121' ? '#ffb300' : (mo >= 0 ? m.teams[0] : m.teams[1]).colors[0];
    f.style.width = `${Math.abs(mo) * 50}%`;
    f.style.left = mo >= 0 ? `${50 - Math.abs(mo) * 50}%` : '50%';
    const a = m.stats[0], b = m.stats[1];
    const tp = a.poss + b.poss || 1;
    $('mini').innerHTML = `<span>Shots ${a.shots} (${a.onTarget}) – ${b.shots} (${b.onTarget})</span><span>Possession ${Math.round((100 * a.poss) / tp)}%</span>`;
  }

  // ------------------------------------------------------------------ pitch overlays
  function overlay(ctx, R) {
    const m = UI.m; if (!m || R.anim) return;
    const s = R.s, X = (x) => R.px(x), Y = (y) => R.py(y);
    const c = FB.carrier(m);
    const now = performance.now();
    if (c && (UI.phase === 'attack' || UI.phase === 'defend')) {
      // offside line for the team in possession
      if (!m.setPiece || m.setPiece.type === 'freekick') {
        const ox = FB.offsideLine(m, m.poss);
        if (ox > 1 && ox < L - 1 && FB.rel(m.poss, { x: ox, y: 0 }).x > 52.5) {
          ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,235,59,0.55)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(X(ox), Y(0)); ctx.lineTo(X(ox), Y(W)); ctx.stroke(); ctx.restore();
        }
      }
      // carrier pulse
      const d = R.disp[c.id];
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * Math.sin(now / 200)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), s * 1.9 * R.k, 0, Math.PI * 2); ctx.stroke();
    }
    if (UI.phase === 'attack') drawAttackOverlay(ctx, R, c);
    if (UI.phase === 'defend') drawDefenseOverlay(ctx, R, c);
  }
  function ring(ctx, R, id, color, r) {
    const d = R.disp[id]; if (!d) return;
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(R.px(d.x), R.py(d.y), R.s * (r || 1.8) * R.k, 0, Math.PI * 2); ctx.stroke();
  }
  function badge(ctx, R, x, y, text, p) {
    const s = R.s, S = R.screen(x, y);
    R.upright(ctx, () => { // text stays upright on a rotated pitch
      const fs = Math.max(10, Math.round(s * 1.05));
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const w = ctx.measureText(text).width + 8, h = Math.max(s * 1.5, fs + 4);
      const X = S.x - w / 2, Y = S.y - Math.max(s * 3.6, R.pr + h + 3);
      ctx.fillStyle = p == null ? 'rgba(60,60,60,0.85)' : p >= 0.8 ? 'rgba(46,125,50,0.95)' : p >= 0.6 ? 'rgba(249,168,37,0.95)' : p >= 0.4 ? 'rgba(230,81,0,0.95)' : 'rgba(183,28,28,0.95)';
      ctx.fillRect(X, Y, w, h);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, X + w / 2, Y + h / 2 + 0.5);
    });
  }
  function colorFor(p) { return p >= 0.8 ? '#66bb6a' : p >= 0.6 ? '#ffca28' : p >= 0.4 ? '#ff7043' : '#ef5350'; }
  function arrow(ctx, R, a, b, color, dash, w) {
    const X1 = R.px(a.x), Y1 = R.py(a.y), X2 = R.px(b.x), Y2 = R.py(b.y);
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w || 3; if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(X1, Y1); ctx.lineTo(X2, Y2); ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(Y2 - Y1, X2 - X1), h = Math.max(R.s * 1.4, 8);
    ctx.beginPath(); ctx.moveTo(X2, Y2); ctx.lineTo(X2 - h * Math.cos(ang - 0.4), Y2 - h * Math.sin(ang - 0.4)); ctx.lineTo(X2 - h * Math.cos(ang + 0.4), Y2 - h * Math.sin(ang + 0.4)); ctx.fill();
    ctx.restore();
  }
  function drawAttackOverlay(ctx, R, c) {
    const m = UI.m; if (!c) return;
    const cd = R.disp[c.id];
    if (m.cover && !m.cover.used) drawSlide(ctx, R, m.cover.id);
    if (UI.quick && UI.runKind) for (const p of FB.active(m, HUMAN)) if (canRun(p.id)) ring(ctx, R, p.id, 'rgba(255,245,157,0.8)', 1.6);
    if (UI.quick && UI.run) { const T = FB.runTarget(m, HUMAN, UI.run); if (T) { arrow(ctx, R, R.disp[UI.run.id], T, '#fff59d', [3, 4], 2); ring(ctx, R, UI.run.id, '#fff59d', 1.7); } }
    drawRunMade(ctx, R);
    if (UI.mode === 'dribble') {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(R.px(cd.x), R.py(cd.y), FB.dribbleMax(c) * R.s, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (UI.badges) {
      for (const id in UI.badges) {
        const ev = UI.badges[id]; const d = R.disp[id];
        if (!ev) continue;
        badge(ctx, R, d.x, d.y, ev.offP > 0.5 ? 'OFFSIDE' : pct(ev.p), ev.offP > 0.5 ? 0 : ev.p);
      }
    }
    const a = UI.prevAction, ev = UI.prevEval;
    if (!a || !ev || !ev.valid) return;
    if (a.type === 'pass') { arrow(ctx, R, cd, R.disp[a.to], colorFor(ev.p)); }
    else if (a.type === 'lob') { arrow(ctx, R, cd, ev.target, colorFor(ev.p), [10, 6]); ring(ctx, R, ev.recv, '#fff', 1.6); drawCircle(ctx, R, ev.target, 1.2, colorFor(ev.p)); }
    else if (a.type === 'through') {
      arrow(ctx, R, cd, ev.target, colorFor(ev.p));
      arrow(ctx, R, R.disp[ev.runner], ev.target, 'rgba(255,255,255,0.8)', [4, 4], 2);
      if (ev.chaser != null) arrow(ctx, R, R.disp[ev.chaser], ev.target, 'rgba(239,83,80,0.8)', [4, 4], 2);
      drawCircle(ctx, R, ev.target, 1.2, colorFor(ev.p));
    } else if (a.type === 'dribble') { arrow(ctx, R, cd, ev.target, colorFor(ev.p), [8, 4]); }
    else if (a.type === 'shoot') {
      const g1 = { x: L, y: 34 - 3.66 }, g2 = { x: L, y: 34 + 3.66 };
      ctx.save(); ctx.fillStyle = 'rgba(255,213,79,0.18)';
      ctx.beginPath(); ctx.moveTo(R.px(cd.x), R.py(cd.y)); ctx.lineTo(R.px(g1.x), R.py(g1.y)); ctx.lineTo(R.px(g2.x), R.py(g2.y)); ctx.closePath(); ctx.fill(); ctx.restore();
      badge(ctx, R, cd.x, cd.y - 1, `xG ${pct(ev.shot.goal)}`, Math.min(1, ev.shot.goal * 2.2));
    } else if (a.type === 'clear') { arrow(ctx, R, cd, ev.target, 'rgba(255,255,255,0.5)', [10, 8]); }
    for (const id of ev.threats || []) ring(ctx, R, id, '#ef5350', 1.9);
  }
  /** The run made in this beat's shape step, faint, from where it started. */
  function drawRunMade(ctx, R) {
    const r = UI.m.runMade;
    if (!r || UI.phase === 'attack' && UI.quick) return;
    arrow(ctx, R, r.from, R.disp[r.id], r.team === HUMAN ? 'rgba(255,245,157,0.6)' : 'rgba(255,171,145,0.85)', [3, 4], 2);
  }
  function drawCircle(ctx, R, p, r, color) { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(R.px(p.x), R.py(p.y), r * R.s, 0, Math.PI * 2); ctx.stroke(); }
  /** How far the covering player may slide to the next receiver. */
  function drawSlide(ctx, R, id) {
    ctx.save(); ctx.setLineDash([3, 4]); drawCircle(ctx, R, R.disp[id], FB.TUNE.coverSlide, 'rgba(128,203,196,0.55)'); ctx.restore();
  }
  function drawDefenseOverlay(ctx, R, c) {
    const m = UI.m; if (!c) return;
    const cd = R.disp[c.id];
    const big = UI.dmode === 'press' || UI.dmode === 'cover', small = UI.dmode === 'tackle';
    ctx.save();
    ctx.setLineDash([5, 5]); ctx.lineWidth = big ? 2 : 1;
    ctx.strokeStyle = big ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)';
    ctx.beginPath(); ctx.arc(R.px(cd.x), R.py(cd.y), FB.TUNE.pressRange * R.s, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = small ? 2 : 1;
    ctx.strokeStyle = small ? 'rgba(255,138,101,0.9)' : 'rgba(255,138,101,0.3)';
    ctx.beginPath(); ctx.arc(R.px(cd.x), R.py(cd.y), FB.TUNE.tackleRange * R.s, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    drawRunMade(ctx, R);
    const o = UI.opts_def || { press: [], tackle: [], cover: [] };
    const elig = UI.dmode === 'mark' ? [] : o[UI.dmode];
    for (const id of elig) ring(ctx, R, id, 'rgba(129,212,250,0.9)', 1.6);
    // threats
    // the three receivers the CPU most wants to find (brightest = most dangerous)
    const top = Object.entries(UI.threat || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    top.forEach(([id], i) => ring(ctx, R, +id, `rgba(239,83,80,${0.95 - i * 0.25})`, 2.4 - i * 0.3));
    const P = UI.plan;
    if (P.press != null) arrow(ctx, R, R.disp[P.press], cd, '#81d4fa');
    if (P.cover != null) { arrow(ctx, R, R.disp[P.cover], cd, '#80cbc4', [2, 5]); drawSlide(ctx, R, P.cover); }
    if (P.tackle != null) arrow(ctx, R, R.disp[P.tackle], cd, '#ff8a65');
    const lm = FB.liveMark(m, HUMAN);
    if (lm && !P.mark && FB.markerAfter(m, P) != null) {
      if (FB.dist(R.disp[lm.d], R.disp[lm.a]) * R.s > R.pr * 4) arrow(ctx, R, R.disp[lm.d], R.disp[lm.a], '#ce93d8', [2, 4], 2);
      ring(ctx, R, lm.a, '#ce93d8', 2.0); ring(ctx, R, lm.d, '#ce93d8', 1.6);
    }
    if (P.mark) { arrow(ctx, R, R.disp[P.mark.d], R.disp[P.mark.a], '#ce93d8', [6, 4]); ring(ctx, R, P.mark.a, '#ce93d8', 2.2); }
    if (UI.markFrom != null) ring(ctx, R, UI.markFrom, '#ce93d8', 2.0);
    if (P.trap) for (const p of FB.active(m, HUMAN)) if (p.role === 'DF') { const d = R.disp[p.id]; arrow(ctx, R, d, { x: d.x + 4, y: d.y }, 'rgba(255,235,59,0.8)', null, 2); }
    if (UI.hover != null && m.players[UI.hover].team === HUMAN && UI.dmode === 'tackle' && o.tackle.includes(UI.hover)) {
      const od = FB.tackleOdds(m, UI.hover); const d = R.disp[UI.hover];
      badge(ctx, R, d.x, d.y, `win ${pct(od.pWin)}`, od.pWin + 0.3);
    }
  }

  // ------------------------------------------------------------------ input
  /** Tap/click radius in pitch metres: 2.4 m with a mouse, at least a fingertip wide on touch. */
  function pickRadius() {
    if (!isTouch()) return 2.4;
    const aiming = UI.wait && UI.wait.kind === 'attack' && UI.mode === 'through';
    return Math.max(2.4, (aiming ? TAP_AIM_PX : TAP_PX) / UI.R.s);
  }
  function nearestPlayer(pt, maxD) {
    let best = null, bd = maxD || 2.4;
    for (const p of UI.m.players) {
      if (p.off) continue;
      const d = UI.R.disp[p.id];
      const dd = Math.hypot(d.x - pt.x, d.y - pt.y);
      if (dd < bd) { bd = dd; best = p.id; }
    }
    return best;
  }
  function onMove(e) {
    if (!UI.m || UI.phase === 'menu') return;
    const pt = UI.R.toPitch(e);
    UI.hoverPt = pt;
    const id = nearestPlayer(pt);
    UI.hover = id;
    UI.R.hover = id;
    if (UI.phase === 'attack' && !UI.sel) refreshPreview();
  }
  function onClick(e) {
    if (!UI.m || !UI.wait) return;
    const pt = UI.R.toPitch(e);
    const id = nearestPlayer(pt, pickRadius());
    if (UI.wait.kind === 'attack') {
      if (UI.runKind) { pickRunner(id); return; }
      if (UI.mode === 'shoot' || UI.mode === 'clear') { commitAttack({ type: UI.mode }); return; }
      const a = candidateAt(pt, id);
      if (!a) return;
      if (UI.sel && sameAction(UI.sel, a)) { commitAttack(UI.sel); return; }
      const ev = FB.evaluate(UI.m, a);
      if (!ev.valid) { flashHint(ev.reason); return; }
      UI.sel = a;
      window.Sound.play('click');
      refreshPreview();
    } else if (UI.wait.kind === 'defend') defenseClick(pt, id);
  }
  function onKey(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.key;
    if (!$('help').classList.contains('hidden')) { if (k === 'Escape' || k === 'Enter' || k === 'h' || k === 'H') closeHelp(); return; }
    if (UI.phase === 'menu') { if (k === 'Enter') startMatch(); return; }
    if (k === 'Escape') {
      if (UI.wait && UI.wait.kind === 'attack' && UI.runKind) { UI.runKind = null; refreshRunRow(); return; }
      if (UI.wait && UI.wait.kind === 'attack' && canCancel()) { cancelSel(); return; }
      if (UI.wait && UI.wait.kind === 'defend' && UI.markFrom != null) { UI.markFrom = null; refreshPreview(); return; }
      togglePause(); return;
    }
    if (k === 'h' || k === 'H') { showHelp(); return; }
    if (UI.paused) return;
    const w = UI.wait; if (!w) return;
    if (w.kind === 'attack') {
      const md = MODES.find((x) => x[1] === k);
      if (md) { setMode(md[0]); return; }
      const rk = RUNS.find((x) => x[1] === k.toUpperCase());
      if (rk && UI.quick) { setRunKind(rk[0]); return; }
      if (k === 'Enter') { const a = UI.sel || UI.prevAction; if (a) commitAttack(a); e.preventDefault(); return; }
      if (k === ' ') { settleQuick(); e.preventDefault(); return; }
    } else if (w.kind === 'defend') {
      const md = DMODES.find((x) => x[1] === k);
      if (md) { setDMode(md[0]); return; }
      if (k === 't' || k === 'T') { toggleTrap(); return; }
      if (k === 'x' || k === 'X') { toggleRelease(); return; }
      const lines = { q: 'deep', w: 'normal', e: 'high' };
      if (lines[k.toLowerCase()]) { UI.plan.line = lines[k.toLowerCase()]; const sg = $('lineSeg'); if (sg) [...sg.children].forEach((b, i) => b.classList.toggle('on', ['deep', 'normal', 'high'][i] === UI.plan.line)); refreshPreview(); return; }
      if (k === 'Enter') { commitDefense(false); e.preventDefault(); return; }
      if (k === ' ') { commitDefense(true); e.preventDefault(); return; }
    } else if (w.kind === 'goal') {
      if (k === 'r' || k === 'R') { UI.wait = null; w.resolve('replay'); return; }
      if (k === 'Enter' || k === ' ') { UI.wait = null; w.resolve('go'); e.preventDefault(); return; }
    } else if (w.kind === 'penalty') {
      const map = { ArrowLeft: 'L', ArrowUp: 'C', ArrowRight: 'R', a: 'L', s: 'C', d: 'R' };
      if (map[k]) { UI.wait = null; w.resolve(map[k]); }
    } else if (w.kind === 'report') {
      if (k === 'Enter') { UI.wait = null; w.resolve(); }
    }
  }

  // ------------------------------------------------------------------ overlays (help / pause)
  function showHelp(first) {
    $('help').classList.remove('hidden');
    UI.helpWasPaused = UI.paused; UI.paused = true; UI.pauseT0 = UI.pauseT0 || performance.now();
    return new Promise((r) => { UI.helpClose = r; void first; });
  }
  function closeHelp() {
    $('help').classList.add('hidden');
    if (!UI.helpWasPaused) { UI.paused = false; if (UI.pauseT0) { UI.pausedMs = (UI.pausedMs || 0) + performance.now() - UI.pauseT0; UI.pauseT0 = 0; } }
    if (UI.helpClose) { const r = UI.helpClose; UI.helpClose = null; r(); }
  }
  function togglePause() {
    if (UI.phase === 'menu') return;
    UI.paused = !UI.paused;
    $('pause').classList.toggle('hidden', !UI.paused);
    if (UI.paused) {
      UI.pauseT0 = performance.now();
      const realMin = ((performance.now() - UI.started - (UI.pausedMs || 0)) / 60000).toFixed(1);
      $('pauseInfo').textContent = `${UI.m.teams[0].name} ${UI.m.score[0]}–${UI.m.score[1]} ${UI.m.teams[1].name} · ${FB.clockText(UI.m)} · ${realMin} min played`;
    } else if (UI.pauseT0) { UI.pausedMs = (UI.pausedMs || 0) + performance.now() - UI.pauseT0; UI.pauseT0 = 0; }
  }

  // ------------------------------------------------------------------ boot
  function boot() {
    UI.R = new FB.Renderer($('pitch'));
    UI.R.speed = UI.speed;
    UI.R.overlay = overlay;
    // a decorative idle pitch behind the menu
    const demo = FB.createMatch({ home: FB.TEAMS[0], away: FB.TEAMS[1], seed: 1 });
    FB.startBeat(demo);
    UI.R.setMatch(demo);
    buildMenu();
    const c = $('pitch');
    c.addEventListener('mousemove', onMove);
    c.addEventListener('click', onClick);
    c.addEventListener('mouseleave', () => { UI.hover = null; UI.hoverPt = null; UI.R.hover = null; if (UI.phase === 'attack' && !UI.sel) refreshPreview(); });
    window.addEventListener('keydown', onKey);
    $('btnStart').onclick = startMatch;
    $('btnHow').onclick = () => showHelp();
    $('btnHelp').onclick = () => showHelp();
    $('btnHelpClose').onclick = closeHelp;
    $('btnPause').onclick = togglePause;
    $('btnResume').onclick = togglePause;
    $('btnPauseHelp').onclick = () => showHelp();
    $('btnRestart').onclick = () => { togglePause(); loopToken++; UI.wait = null; startMatch(); };
    $('btnQuit').onclick = toMenu;
    $('btnGo').onclick = () => {
      const w = UI.wait; if (!w) return;
      if (w.kind === 'attack' && UI.sel) commitAttack(UI.sel);
      else if (w.kind === 'defend') commitDefense(false);
      else if (w.kind === 'goal') { UI.wait = null; w.resolve('go'); }
    };
    $('btnAlt').onclick = () => {
      const w = UI.wait; if (!w) return;
      if (w.kind === 'attack') { if (UI.quick) settleQuick(); else cancelSel(); }
      else if (w.kind === 'defend') commitDefense(true);
      else if (w.kind === 'goal') { UI.wait = null; w.resolve('replay'); }
    };
    document.querySelectorAll('#penalty button').forEach((b) => { b.onclick = () => { const w = UI.wait; if (w && w.kind === 'penalty') { UI.wait = null; w.resolve(b.dataset.dir); } }; });
    seg($('speedPick'), [[0.6, 'Slow'], [1, 'Normal'], [1.8, 'Fast']], () => UI.speed, (v) => { UI.speed = v; UI.R.speed = v; store.set('speed', v); });
    seg($('soundPick'), [[true, 'On'], [false, 'Off']], () => UI.sound, (v) => { UI.sound = v; window.Sound.setOn(v); store.set('sound', v); });
    setPhase('Choose your teams', 'wait');
    setButtons(null, null);
    hint('Pick a team and press Kick off.');
  }
  window.addEventListener('DOMContentLoaded', boot);
})();
