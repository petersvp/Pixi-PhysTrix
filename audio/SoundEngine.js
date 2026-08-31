/**
 * Generates game sound effects with the Web Audio API.
 *
 * This module is part of the audio layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class SoundEngine {
  constructor(settings) {
    this.settings = settings;
    this.context = null;
  }
  beep(f = 440, d = 0.06, type = "square", gain = 0.08, slide = 0) {
    try {
      this.context ??= new (window.AudioContext || window.webkitAudioContext)();
      const t = this.context.currentTime,
        o = this.context.createOscillator(),
        g = this.context.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(Math.max(30, f + slide), t + d);
      g.gain.setValueAtTime(
        gain * this.settings.master * this.settings.effects,
        t,
      );
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g).connect(this.context.destination);
      o.start(t);
      o.stop(t + d);
    } catch {}
  }
  move() {
    this.beep(180, 0.025, "square", 0.035, 20);
  }
  rotate() {
    this.beep(510, 0.055, "triangle", 0.06, 110);
  }
  drop() {
    this.beep(100, 0.09, "sawtooth", 0.08, -45);
  }
  clear(n) {
    this.beep(420 + n * 100, 0.14, "square", 0.09, 180);
  }
  hold() {
    this.beep(260, 0.08, "sine", 0.07, 120);
  }
}
