/* All sound is synthesised, so there are no audio files. Off until the visitor turns it on. */
(function () {
  'use strict';

  function Sound() { this.ctx = null; this.on = false; this.rainOn = false; }

  Sound.prototype.noise = function (seconds) {
    var c = this.ctx, buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate), d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < d.length; i++) { // brown noise: closer to sea and distant city than hiss
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return buf;
  };

  Sound.prototype.init = function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    var c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(c.destination);

    // The sea and the far-off city.
    var buf = this.noise(4);
    var sea = c.createBufferSource(); sea.buffer = buf; sea.loop = true;
    var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    var g = c.createGain(); g.gain.value = 0.5;
    var lfo = c.createOscillator(); lfo.frequency.value = 0.11;
    var lg = c.createGain(); lg.gain.value = 0.2;
    lfo.connect(lg); lg.connect(g.gain); lfo.start();
    sea.connect(lp); lp.connect(g); g.connect(this.master); sea.start();

    // Rain waits on a closed gain.
    var rain = c.createBufferSource(); rain.buffer = buf; rain.loop = true; rain.playbackRate.value = 3.2;
    var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
    rain.connect(hp); hp.connect(this.rainGain); this.rainGain.connect(this.master); rain.start();
    return true;
  };

  Sound.prototype.toggle = function () {
    if (!this.ctx && !this.init()) return false;
    this.on = !this.on;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.setTargetAtTime(this.on ? 0.55 : 0, this.ctx.currentTime, 0.25);
    return this.on;
  };

  Sound.prototype.setRain = function (raining) {
    if (!this.on || raining === this.rainOn) return;
    this.rainOn = raining;
    this.rainGain.gain.setTargetAtTime(raining ? 0.75 : 0, this.ctx.currentTime, 0.8);
  };

  Sound.prototype.tone = function (freq, at, len, type, vol) {
    if (!this.on) return;
    var c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.2, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + len + 0.02);
  };

  Sound.prototype.pager = function () {
    for (var i = 0; i < 3; i++) {
      this.tone(1880, i * 0.42, 0.11, 'square', 0.1);
      this.tone(1880, i * 0.42 + 0.16, 0.11, 'square', 0.1);
    }
  };
  Sound.prototype.click = function () { this.tone(170, 0, 0.09, 'triangle', 0.3); };
  Sound.prototype.tick = function () { this.tone(1320, 0, 0.1, 'sine', 0.1); this.tone(1760, 0.09, 0.14, 'sine', 0.08); };
  Sound.prototype.good = function () { this.tone(660, 0, 0.2, 'sine', 0.2); this.tone(990, 0.12, 0.3, 'sine', 0.18); };
  Sound.prototype.bad = function () { this.tone(110, 0, 0.42, 'sawtooth', 0.16); this.tone(82, 0.04, 0.5, 'sawtooth', 0.16); };
  Sound.prototype.thunder = function () {
    if (!this.on) return;
    var c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + 0.12;
    s.buffer = this.noise(2.4); f.type = 'lowpass'; f.frequency.value = 170;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.5, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  };

  window.LightsOnSound = Sound;
})();
