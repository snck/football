/* Synthesised match audio (no asset files): crowd bed, whistle, kicks, roars, groans. */
(function (G) {
  'use strict';
  const S = {
    ctx: null, on: true, crowd: null, crowdGain: null, master: null, level: 0.12,
    init() {
      if (this.ctx) return;
      const AC = G.AudioContext || G.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.8 : 0; this.master.connect(ctx.destination);
      // brown-ish noise crowd bed
      const len = ctx.sampleRate * 3;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch); let last = 0;
        for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      }
      this.noiseBuf = buf;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.6;
      this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = this.level;
      src.connect(bp); bp.connect(this.crowdGain); this.crowdGain.connect(this.master);
      src.start();
      // mobile browsers (iOS especially) suspend audio when the page is hidden or the phone locks
      const resume = () => { if (this.ctx && this.ctx.state !== 'running' && !document.hidden) this.ctx.resume().catch(() => {}); };
      document.addEventListener('visibilitychange', resume);
      window.addEventListener('pointerdown', resume);
    },
    setOn(v) { this.on = v; if (this.master) this.master.gain.value = v ? 0.8 : 0; },
    /** Crowd excitement 0..1 */
    excite(x) {
      if (!this.ctx) return;
      const g = 0.08 + 0.32 * Math.max(0, Math.min(1, x));
      this.crowdGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.6);
    },
    noiseBurst(dur, freq, gain, q) {
      const ctx = this.ctx; const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.7;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + dur * 0.15); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + dur + 0.05);
      return f;
    },
    tone(freq, dur, type, gain, vib) {
      const ctx = this.ctx; const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.setValueAtTime(gain, t + dur - 0.05); g.gain.linearRampToValueAtTime(0, t + dur);
      if (vib) { const l = ctx.createOscillator(); l.frequency.value = vib; const lg = ctx.createGain(); lg.gain.value = freq * 0.06; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur); }
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    },
    play(name) {
      if (!this.ctx || !this.on) return;
      try {
        if (name === 'whistle') { this.tone(2900, 0.32, 'sine', 0.12, 38); }
        else if (name === 'whistle3') { this.tone(2900, 0.3, 'sine', 0.12, 38); setTimeout(() => this.tone(2900, 0.3, 'sine', 0.12, 38), 420); setTimeout(() => this.tone(2900, 0.9, 'sine', 0.12, 38), 840); }
        else if (name === 'kick') { this.tone(110, 0.08, 'triangle', 0.25); this.noiseBurst(0.06, 1800, 0.12, 1.2); }
        else if (name === 'goal') { this.noiseBurst(3.5, 900, 0.9, 0.4); this.noiseBurst(3.0, 1600, 0.4, 0.5); }
        else if (name === 'ooh' || name === 'save') { const f = this.noiseBurst(1.4, 500, 0.5, 2); f.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 1.2); }
        else if (name === 'groan') { const f = this.noiseBurst(1.2, 400, 0.35, 2.5); f.frequency.linearRampToValueAtTime(220, this.ctx.currentTime + 1.0); }
        else if (name === 'cheer') { this.noiseBurst(1.2, 1100, 0.4, 0.6); }
        else if (name === 'click') { this.tone(880, 0.04, 'square', 0.03); }
      } catch (e) { /* audio is best-effort */ }
    },
  };
  G.Sound = S;
})(typeof window !== 'undefined' ? window : globalThis);
