/* Canvas renderer: pitch, players, ball, animation timelines, previews and effects. */
(function (G) {
  'use strict';
  const FB = G.FB;
  const { L, W } = FB.P;
  const MARGIN = 4;
  const GK_COLORS = ['#f4d03f', '#7fdbca'];
  const MIN_PLAYER_R = 7; // px: keeps players readable when the pitch is small (phones)
  /** Narrow portrait screens draw the pitch upright (home attacks bottom → top). Keep in sync with style.css. */
  FB.VERTICAL_MQ = '(orientation: portrait) and (max-width: 900px)';

  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  class Renderer {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.disp = {};
      this.ball = { x: L / 2, y: W / 2, h: 0 };
      this.owner = null;
      this.anim = null;
      this.queue = [];
      this.fx = [];
      this.particles = [];
      this.speed = 1;
      this.overlay = null; // function(ctx, R) drawn above players
      this.underlay = null;
      this.hover = null;
      this.banner = null;
      this.flash = 0;
      this.rot = false;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      const loop = (ts) => { this.frame(ts); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    setMatch(m) { this.m = m; this.syncAll(); }
    resize() {
      const wrap = this.c.parentElement;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      const rot = window.matchMedia ? window.matchMedia(FB.VERTICAL_MQ).matches : false;
      const viewW = (rot ? W : L) + 2 * MARGIN, viewH = (rot ? L : W) + 2 * MARGIN;
      const s = Math.max(2, Math.min(w / viewW, h / viewH));
      const dpr = window.devicePixelRatio || 1;
      if (s === this.s && rot === this.rot && dpr === this.dpr) return;
      this.s = s;
      this.rot = rot;
      this.pr = Math.max(s * 1.15, MIN_PLAYER_R); // player disc radius in px
      this.k = this.pr / (s * 1.15);              // how much markers are enlarged (1 on big screens)
      this.cssW = Math.round(viewW * s);
      this.cssH = Math.round(viewH * s);
      this.c.width = Math.round(viewW * s * dpr);
      this.c.height = Math.round(viewH * s * dpr);
      this.c.style.width = `${this.cssW}px`;
      this.c.style.height = `${this.cssH}px`;
      this.dpr = dpr;
      this.pitchCache = null;
    }
    /** Pitch-space px (before rotation). Geometry drawn after toPitchSpace() uses these. */
    px(x) { return (x + MARGIN) * this.s; }
    py(y) { return (y + MARGIN) * this.s; }
    /** Screen position (CSS px) of a pitch point, for things that must stay upright (text, discs). */
    screen(x, y) {
      if (this.rot) return { x: (y + MARGIN) * this.s, y: (L + MARGIN - x) * this.s };
      return { x: (x + MARGIN) * this.s, y: (y + MARGIN) * this.s };
    }
    /** Pitch metres visible across the screen (for screen-space effects like confetti). */
    viewW() { return this.rot ? W : L; }
    toPitchSpace(ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.rot) { ctx.translate(0, this.cssH); ctx.rotate(-Math.PI / 2); }
    }
    toScreenSpace(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
    /** Run fn with an unrotated (screen-space) transform, then restore. */
    upright(ctx, fn) { ctx.save(); this.toScreenSpace(ctx); fn(); ctx.restore(); }
    toPitch(ev) {
      const r = this.c.getBoundingClientRect();
      const cx = ev.clientX - r.left, cy = ev.clientY - r.top;
      if (this.rot) return { x: L + MARGIN - cy / this.s, y: cx / this.s - MARGIN };
      return { x: cx / this.s - MARGIN, y: cy / this.s - MARGIN };
    }
    syncAll() {
      const m = this.m;
      for (const p of m.players) this.disp[p.id] = { x: p.x, y: p.y };
      this.owner = m.carrier;
      if (m.carrier == null) { this.ball.x = m.ball.x; this.ball.y = m.ball.y; }
      this.ball.h = 0;
    }
    snapshot() { return { disp: JSON.parse(JSON.stringify(this.disp)), ball: Object.assign({}, this.ball), owner: this.owner }; }
    restoreSnap(s) { this.disp = JSON.parse(JSON.stringify(s.disp)); this.ball = Object.assign({}, s.ball); this.owner = s.owner; }

    /** Play a list of timeline steps; resolves when finished. */
    play(tl, speedMul) {
      return new Promise((resolve) => {
        const steps = (tl || []).slice();
        const sp = (speedMul || 1) * this.speed;
        const next = () => {
          if (!steps.length) { this.anim = null; resolve(); return; }
          const st = steps.shift();
          const from = {}, to = {};
          if (st.moves) for (const id in st.moves) { from[id] = Object.assign({}, this.disp[id]); to[id] = st.moves[id]; }
          const ballFrom = this.ballPos();
          const dur = Math.max(0.05, (st.dur || 0.3) / sp) * 1000;
          if (st.ball) this.owner = null;
          this.anim = { t0: performance.now(), dur, from, to, ballFrom, ballTo: st.ball || null, arc: st.ball ? st.ball.arc || 0 : 0, st, done: next };
          if (st.fx || st.caption) this.addFx(st);
          if (st.sfx && G.Sound) G.Sound.play(st.sfx);
          else if (st.ball && !st.setup && G.Sound) G.Sound.play('kick');
        };
        next();
      });
    }
    /** Smoothly settle display positions onto the engine state. */
    settle(dur) {
      const m = this.m; const moves = {};
      for (const p of m.players) {
        const d = this.disp[p.id];
        if (!d || Math.hypot(d.x - p.x, d.y - p.y) > 0.05) moves[p.id] = { x: p.x, y: p.y };
      }
      const steps = [{ dur: dur || 0.3, moves, owner: m.carrier }];
      if (m.carrier == null) steps[0].ball = { x: m.ball.x, y: m.ball.y, arc: 0 };
      return this.play(steps).then(() => { this.owner = m.carrier; });
    }
    ballPos() {
      if (this.owner != null && this.disp[this.owner]) {
        const p = this.disp[this.owner];
        const dir = this.m.players[this.owner].team === 0 ? 1 : -1;
        return { x: p.x + 0.75 * dir, y: p.y + 0.35, h: 0 };
      }
      return { x: this.ball.x, y: this.ball.y, h: this.ball.h };
    }
    stepAnim(now) {
      const a = this.anim;
      if (!a) return;
      let t = (now - a.t0) / a.dur;
      if (t > 1) t = 1;
      const e = ease(t);
      for (const id in a.to) {
        const f = a.from[id], g = a.to[id];
        this.disp[id] = { x: f.x + (g.x - f.x) * e, y: f.y + (g.y - f.y) * e };
      }
      if (a.ballTo) {
        const lt = a.arc > 0 ? t : 1 - Math.pow(1 - t, 1.6); // ground balls decelerate
        this.ball.x = a.ballFrom.x + (a.ballTo.x - a.ballFrom.x) * lt;
        this.ball.y = a.ballFrom.y + (a.ballTo.y - a.ballFrom.y) * lt;
        const len = Math.hypot(a.ballTo.x - a.ballFrom.x, a.ballTo.y - a.ballFrom.y);
        this.ball.h = a.arc * Math.sin(Math.PI * t) * Math.min(12, len * 0.28);
      }
      if (t >= 1) {
        if (a.st.owner !== undefined) this.owner = a.st.owner;
        if (a.ballTo) this.ball.h = 0;
        this.anim = null;
        a.done();
      }
    }
    addFx(st) {
      const now = performance.now();
      const pos = st.ball ? { x: st.ball.x, y: st.ball.y } : (st.moves && Object.values(st.moves)[0]) || this.ballPos();
      const labels = { intercept: 'INTERCEPTED', tackle: 'TACKLE!', foul: 'FOUL', save: 'SAVE!', block: 'BLOCKED', flag: 'OFFSIDE', nearmiss: 'SO CLOSE!', wide: 'WIDE', beaten: 'BEATEN!', header: 'HEADED CLEAR' };
      if (st.fx && labels[st.fx]) this.fx.push({ text: labels[st.fx], x: pos.x, y: pos.y, t0: now, life: 1400, color: st.fx === 'save' || st.fx === 'nearmiss' ? '#ffd54f' : '#fff' });
      if (st.caption) this.caption = { text: st.caption, t0: now };
      if (st.fx === 'goal') this.flash = now;
    }
    confetti(colors) {
      const now = performance.now();
      for (let i = 0; i < 160; i++) {
        this.particles.push({ x: Math.random() * (this.viewW() + 8) - 4, y: -4 - Math.random() * 10, vx: (Math.random() - 0.5) * 6, vy: 6 + Math.random() * 10,
          c: colors[i % colors.length], t0: now, life: 2600 + Math.random() * 1500, r: 0.3 + Math.random() * 0.4 });
      }
    }

    // ------------------------------------------------------------ drawing
    drawPitch() {
      if (this.pitchCache) return this.pitchCache;
      const cv = document.createElement('canvas');
      cv.width = this.c.width; cv.height = this.c.height;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#2e7d32';
      ctx.fillRect(0, 0, cv.width, cv.height);
      this.toPitchSpace(ctx);
      const s = this.s, X = (x) => this.px(x), Y = (y) => this.py(y);
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = i % 2 ? '#358a3a' : '#2f8034';
        ctx.fillRect(X(i * L / 14), Y(0), L / 14 * s + 1, W * s);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1.2, s * 0.14);
      ctx.strokeRect(X(0), Y(0), L * s, W * s);
      ctx.beginPath(); ctx.moveTo(X(L / 2), Y(0)); ctx.lineTo(X(L / 2), Y(W)); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(L / 2), Y(W / 2), 9.15 * s, 0, Math.PI * 2); ctx.stroke();
      const dot = (x, y) => { ctx.beginPath(); ctx.arc(X(x), Y(y), s * 0.3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill(); };
      dot(L / 2, W / 2);
      for (const side of [0, 1]) {
        const x0 = side ? L - 16.5 : 0, x6 = side ? L - 5.5 : 0;
        ctx.strokeRect(X(x0), Y(W / 2 - 20.16), 16.5 * s, 40.32 * s);
        ctx.strokeRect(X(x6), Y(W / 2 - 9.16), 5.5 * s, 18.32 * s);
        const spot = side ? L - 11 : 11;
        dot(spot, W / 2);
        ctx.beginPath();
        const a = Math.acos(5.5 / 9.15);
        if (side) ctx.arc(X(spot), Y(W / 2), 9.15 * s, Math.PI - a, Math.PI + a);
        else ctx.arc(X(spot), Y(W / 2), 9.15 * s, -a, a);
        ctx.stroke();
        // goal
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        const gx = side ? L : -2;
        ctx.fillRect(X(gx), Y(W / 2 - 3.66), 2 * s, 7.32 * s);
        ctx.strokeRect(X(gx), Y(W / 2 - 3.66), 2 * s, 7.32 * s);
        // net pattern
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
        for (let k = 0; k <= 7; k++) { ctx.beginPath(); ctx.moveTo(X(gx), Y(W / 2 - 3.66 + k * 1.046)); ctx.lineTo(X(gx + 2), Y(W / 2 - 3.66 + k * 1.046)); ctx.stroke(); }
        ctx.restore();
      }
      for (const [cx, cy, a0] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]]) {
        ctx.beginPath(); ctx.arc(X(cx), Y(cy), s, a0, a0 + Math.PI / 2); ctx.stroke();
      }
      this.pitchCache = cv;
      return cv;
    }

    frame(now) {
      if (!this.m) return;
      this.stepAnim(now);
      const ctx = this.ctx, s = this.s;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.drawPitch(), 0, 0);
      this.toPitchSpace(ctx);
      if (this.underlay) this.underlay(ctx, this);
      // players and ball are drawn in screen space so numbers stay upright on a rotated pitch
      this.toScreenSpace(ctx);
      const m = this.m;
      const bp = this.ballPos();
      const order = m.players.filter((p) => !p.off).map((p) => ({ p, S: this.screen(this.disp[p.id].x, this.disp[p.id].y) }))
        .sort((a, b) => a.S.y - b.S.y);
      for (const o of order) this.drawPlayer(ctx, o.p, o.S);
      // ball
      const B = this.screen(bp.x, bp.y), X = B.x, Y = B.y;
      const bs = Math.max(s, 6); // ball size floor for small pitches
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(X + bp.h * s * 0.25, Y + bp.h * s * 0.15, bs * 0.55, bs * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      const r = bs * (0.5 + bp.h * 0.03);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X, Y - bp.h * s * 0.6, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(X, Y - bp.h * s * 0.6, r * 0.35, 0, Math.PI * 2); ctx.fill();
      this.toPitchSpace(ctx);
      if (this.overlay) this.overlay(ctx, this);
      this.toScreenSpace(ctx);
      this.drawFx(ctx, now);
    }

    /** S = screen position (CSS px); called in screen space. */
    drawPlayer(ctx, p, S) {
      const s = this.s, m = this.m;
      const X = S.x, Y = S.y;
      const team = m.teams[p.team];
      const R = this.pr;
      const beaten = m.beaten && m.beaten.has(p.id) && !this.anim;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(X + s * 0.25, Y + s * 0.35, R, R * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = beaten ? 0.55 : 1;
      ctx.fillStyle = p.role === 'GK' ? GK_COLORS[p.team] : team.colors[0];
      ctx.strokeStyle = p.role === 'GK' ? '#222' : team.colors[1];
      ctx.lineWidth = Math.max(1.5, s * 0.22);
      ctx.beginPath(); ctx.arc(X, Y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = p.role === 'GK' ? '#222' : team.colors[1];
      ctx.font = `bold ${Math.max(9, Math.round(s * 1.15))}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(p.num), X, Y + s * 0.05);
      ctx.globalAlpha = 1;
      if (p.yellow && !p.off) { ctx.fillStyle = '#ffeb3b'; ctx.fillRect(X + R * 0.6, Y - R * 1.2, s * 0.6, s * 0.8); }
      if (p.id === this.owner || (this.hover === p.id) || (this.labels && this.labels.has(p.id))) {
        ctx.font = `600 ${Math.max(10, Math.round(s * 1.0))}px system-ui, sans-serif`;
        const txt = p.name;
        const w = ctx.measureText(txt).width + 8, lh = Math.max(s * 1.4, 14);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(X - w / 2, Y + R + 2, w, lh);
        ctx.fillStyle = '#fff';
        ctx.fillText(txt, X, Y + R + 2 + lh / 2);
      }
      if (beaten) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(X - R * 0.6, Y - R * 1.5); ctx.lineTo(X + R * 0.6, Y - R * 1.5); ctx.stroke();
      }
    }

    drawFx(ctx, now) {
      const s = this.s;
      this.fx = this.fx.filter((f) => now - f.t0 < f.life);
      const fitFont = (text, weight, size, maxW) => {
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        const w = ctx.measureText(text).width;
        if (w > maxW) { size = Math.max(9, Math.floor(size * maxW / w)); ctx.font = `${weight} ${size}px system-ui, sans-serif`; }
        return size;
      };
      for (const f of this.fx) {
        const k = (now - f.t0) / f.life;
        const P = this.screen(f.x, f.y);
        ctx.globalAlpha = 1 - k * k;
        ctx.font = `900 ${Math.max(13, Math.round(s * 2.2))}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        const y = P.y - Math.max(s * 3, this.pr + 8) - k * Math.max(s * 3, 10);
        const x = Math.min(Math.max(P.x, 40), this.cssW - 40);
        ctx.strokeText(f.text, x, y);
        ctx.fillStyle = f.color; ctx.fillText(f.text, x, y);
        ctx.globalAlpha = 1;
      }
      if (this.flash && now - this.flash < 600) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - (now - this.flash) / 600)})`;
        ctx.fillRect(0, 0, this.cssW, this.cssH);
      }
      this.particles = this.particles.filter((q) => now - q.t0 < q.life);
      for (const q of this.particles) {
        const t = (now - q.t0) / 1000;
        const x = q.x + q.vx * t + Math.sin(t * 3 + q.r * 10) * 1.5, y = q.y + q.vy * t;
        ctx.fillStyle = q.c;
        ctx.fillRect(this.px(x), this.py(y), q.r * s * 2, q.r * s);
      }
      if (this.caption && now - this.caption.t0 < 3200) {
        const k = (now - this.caption.t0) / 3200;
        ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        const fs = fitFont(this.caption.text, 600, Math.max(13, Math.round(s * 1.35)), this.cssW - 32);
        const w = ctx.measureText(this.caption.text).width + 24, h = Math.max(s * 2.2, fs + 10);
        const X = this.cssW / 2, Y = this.cssH - Math.max(s * 0.5, 4);
        ctx.fillStyle = 'rgba(10,20,30,0.82)';
        ctx.fillRect(X - w / 2, Y - h, w, h);
        ctx.fillStyle = this.caption.warn ? '#ff8a65' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.caption.text, X, Y - h / 2);
        ctx.globalAlpha = 1;
      }
      if (this.banner) {
        const b = this.banner;
        const k = Math.min(1, (now - b.t0) / 250);
        ctx.globalAlpha = k;
        ctx.fillStyle = b.bg || 'rgba(0,0,0,0.6)';
        const u = Math.max(s, 9); // banner unit: never smaller than on a ~9 px/m pitch
        const h = u * 9, cx = this.cssW / 2, cy = this.cssH / 2;
        ctx.fillRect(0, cy - h / 2, this.cssW, h);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = b.color || '#fff';
        fitFont(b.text, 900, Math.round(u * 5.5 * (0.8 + 0.2 * k)), this.cssW - 24);
        ctx.fillText(b.text, cx, cy - u * 1);
        if (b.sub) { fitFont(b.sub, 600, Math.round(u * 1.8), this.cssW - 24); ctx.fillStyle = '#fff'; ctx.fillText(b.sub, cx, cy + u * 2.8); }
        ctx.globalAlpha = 1;
      }
    }
  }
  FB.Renderer = Renderer;
  FB.GK_COLORS = GK_COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
