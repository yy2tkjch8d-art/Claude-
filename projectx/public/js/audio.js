/*
 * ProjectX sound engine.
 * A small Web Audio drum machine and synth with one loop per vibe, or your own
 * MP3 mix when config.audio.mixUrl is set. Exposes window.PXAudio.
 * Nothing plays until a visitor presses a button.
 */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var settings = (window.PROJECTX && window.PROJECTX.audio) || {};

  // One character per 16th note. '.' is a rest, 'x' a hit, 'X' an accent and
  // digits 1-9 set a level. perc uses h/m/l for high, mid and low drums.
  // bass uses semitone offsets from the bar's root: 0, 3, 5, 7, a (10), c (12).
  var VIBES = {
    afro: {
      bpm: 122, swing: 0.1, duck: 0.55,
      roots: [45, 41, 38, 40],
      chords: [[57, 60, 64, 67, 71], [53, 57, 60, 64], [50, 53, 57, 60, 64], [52, 55, 59, 62]],
      kick: 'x...x...x...x...',
      clap: '....x.......x...',
      ohat: '..x...x...x...x.',
      shaker: '3636363636363636',
      perc: '...h..lm..h.l.h.',
      bass: '..0..0.7..0..c.5',
      pluck: 'x..x..x...x..x..',
      melody: [76, 74, 72, 69, 72, 76, 79, 76, 74, 72],
      pad: true
    },
    techno: {
      bpm: 130, swing: 0, duck: 0.7,
      roots: [33, 33, 33, 36],
      kick: 'x...x...x...x...',
      clap: '....x.......x...',
      ohat: '..x...x...x...x.',
      chat: '4242424242424242',
      rumble: '.xxx.xxx.xxx.xxx',
      acid: 'x.xX.x.xX.xx.xX.',
      acidRoot: 45,
      acidNotes: [0, 0, 12, 0, 3, 0, 7, 0, 0, 12, 0, 10, 0, 3, 0, 7],
      stab: [57, 60, 64]
    },
    hiphop: {
      bpm: 92, swing: 0.2, duck: 0,
      roots: [33, 38, 41, 40],
      chords: [[57, 60, 64, 67, 71], [50, 53, 57, 60, 64], [53, 57, 60, 64, 67], [52, 56, 59, 62]],
      kick: 'x.....x...x.....',
      snare: '....x.......x...',
      chat: '5.3.5.3.5.3.5.36',
      sub: 'x.....x...x.....',
      keys: true
    }
  };
  var OFFSET = { '0': 0, '3': 3, '5': 5, '7': 7, a: 10, c: 12 };
  var PERC = { h: 392, m: 294, l: 220 };

  var ctx = null;
  var bus = null;
  var noiseBuf = null;
  var playing = false;
  var current = 'afro';
  var pending = null;
  var step = 0;
  var bar = 0;
  var nextTime = 0;
  var timer = 0;
  var melodyIx = 0;
  var queue = [];
  var beatFns = [];
  var stateFns = [];
  var raf = 0;
  var mix = null;
  var resumeOnShow = false;

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function stepDur() { return 60 / VIBES[current].bpm / 4; }
  function level(pattern, i) {
    var c = pattern ? pattern.charAt(i) : '.';
    if (c === '.' || c === '') return 0;
    if (c === 'x') return 0.8;
    if (c === 'X') return 1;
    var n = parseInt(c, 10);
    return isNaN(n) ? 0.8 : n / 9;
  }

  /* ---------- Graph ---------- */
  function gain(v, dest) {
    var g = ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }
  function makeNoise(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function makeImpulse(seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function makeCurve(k) {
    var n = 1024, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i * 2 / n - 1;
      c[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    return c;
  }

  function build() {
    try { ctx = new AC({ latencyHint: 'playback' }); } catch (e) { ctx = new AC(); }

    var master = gain(0);
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.005; comp.release.value = 0.2;
    var limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20;
    limit.attack.value = 0.001; limit.release.value = 0.1;
    var analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.75;
    master.connect(comp);
    comp.connect(limit);
    limit.connect(analyser);
    analyser.connect(ctx.destination);

    var drums = gain(0.9, master);
    var duck = gain(1, master);
    var music = gain(0.7, duck);

    var rev = gain(1);
    var conv = ctx.createConvolver();
    conv.buffer = makeImpulse(2.4, 3);
    rev.connect(conv);
    conv.connect(gain(0.3, master));

    var dly = gain(1);
    var delay = ctx.createDelay(1.5);
    var tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    var feedback = gain(0.36);
    dly.connect(delay);
    delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(delay);
    tone.connect(gain(0.3, master));

    var drive = ctx.createWaveShaper();
    drive.curve = makeCurve(5);
    drive.oversample = '2x';
    drive.connect(gain(0.5, drums));

    var mixBus = gain(0, analyser); // a finished MP3 mix skips the compressor

    noiseBuf = makeNoise(2);
    bus = { master: master, analyser: analyser, drums: drums, duck: duck, music: music, rev: rev, dly: dly, delay: delay, drive: drive, mixBus: mixBus };
  }

  /* ---------- Instruments ---------- */
  function env(t, peak, attack, decay, dest) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(dest);
    return g;
  }
  function osc(type, freq, t, stopAt, dest) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(dest);
    o.start(t);
    o.stop(stopAt);
    return o;
  }
  function noise(t, peak, type, freq, decay, dest, q, send) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q) f.Q.value = q;
    var g = env(t, peak, 0.001, decay, dest);
    if (send) g.connect(send);
    src.connect(f);
    f.connect(g);
    src.start(t, Math.random() * 1.4);
    src.stop(t + decay + 0.05);
  }
  function duckAt(t) {
    var depth = VIBES[current].duck;
    if (!depth) return;
    var p = bus.duck.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(1 - depth, t);
    p.linearRampToValueAtTime(1, t + stepDur() * 3);
  }
  function kick(t, hard) {
    var g = env(t, 0.95, 0.003, hard ? 0.5 : 0.42, bus.drums);
    var o = osc('sine', hard ? 180 : 150, t, t + 0.6, g);
    o.frequency.exponentialRampToValueAtTime(hard ? 48 : 52, t + (hard ? 0.07 : 0.1));
    noise(t, 0.16, 'highpass', 2500, 0.012, bus.drums);
    duckAt(t);
  }
  function clap(t, peak) {
    noise(t, peak * 0.6, 'bandpass', 1400, 0.012, bus.drums, 1.2);
    noise(t + 0.012, peak * 0.6, 'bandpass', 1300, 0.012, bus.drums, 1.2);
    noise(t + 0.024, peak, 'bandpass', 1200, 0.2, bus.drums, 0.9, bus.rev);
  }
  function snare(t, peak) {
    noise(t, peak * 0.7, 'bandpass', 1900, 0.17, bus.drums, 0.8, bus.rev);
    var g = env(t, peak * 0.6, 0.002, 0.12, bus.drums);
    var o = osc('triangle', 220, t, t + 0.2, g);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
  }
  function hat(t, peak, open) {
    noise(t, peak, 'highpass', open ? 7000 : 8500, open ? 0.22 : 0.04, bus.drums);
  }
  function shaker(t, peak) {
    noise(t, peak, 'bandpass', 6500, 0.06, bus.drums, 1.4);
  }
  function perc(t, f, peak) {
    var g = env(t, peak, 0.002, 0.2, bus.drums);
    g.connect(bus.rev);
    var o = osc('sine', f * 1.45, t, t + 0.3, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.025);
  }
  function bass(t, m, dur, peak) {
    var f = mtof(m);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.6, dur * 0.15);
    g.connect(bus.music);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.exponentialRampToValueAtTime(1100, t + 0.015);
    lp.frequency.exponentialRampToValueAtTime(240, t + dur);
    lp.connect(g);
    osc('sawtooth', f, t, t + dur + 0.25, lp);
    osc('sine', f, t, t + dur + 0.25, gain(0.7, g));
  }
  function rumble(t, m, dur) {
    var g = env(t, 0.3, 0.01, dur, bus.music);
    g.connect(bus.rev);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    lp.connect(g);
    osc('triangle', mtof(m), t, t + dur + 0.1, lp);
  }
  function acid(t, m, accent, sd) {
    var sweep = 0.5 - 0.5 * Math.cos((bar % 16) / 16 * Math.PI * 2);
    var base = 260 + sweep * 1500;
    var g = env(t, accent ? 0.13 : 0.09, 0.003, sd * 0.95, bus.music);
    g.connect(bus.dly);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = accent ? 16 : 11;
    lp.frequency.setValueAtTime(base * (accent ? 3.2 : 2.2), t);
    lp.frequency.exponentialRampToValueAtTime(base, t + sd * 0.9);
    lp.connect(g);
    osc('sawtooth', mtof(m), t, t + sd + 0.1, lp);
  }
  function sub808(t, m, dur) {
    var f = mtof(m);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(bus.drive);
    var o = osc('sine', f * 2, t, t + dur + 0.05, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
  }
  function pad(t, notes, dur) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.085, t + 0.45);
    g.gain.setValueAtTime(0.085, t + dur - 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    g.connect(bus.music);
    g.connect(bus.rev);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.Q.value = 0.5;
    lp.connect(g);
    var share = gain(1 / notes.length, lp);
    notes.forEach(function (m) {
      [-7, 7].forEach(function (cents) {
        var o = osc('sawtooth', mtof(m), t, t + dur + 0.35, share);
        o.detune.value = cents;
      });
    });
  }
  function keys(t, notes, dur, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(bus.music);
    g.connect(bus.rev);
    var share = gain(1 / notes.length, g);
    notes.forEach(function (m, i) {
      var f = mtof(m);
      var st = t + i * 0.012;
      var car = osc('sine', f, st, t + dur + 0.1, share);
      var depth = ctx.createGain();
      depth.gain.setValueAtTime(f * 1.2, st);
      depth.gain.exponentialRampToValueAtTime(f * 0.08, st + 0.5);
      depth.connect(car.frequency);
      osc('sine', f, st, t + dur + 0.1, depth);
    });
  }
  function pluck(t, m) {
    var f = mtof(m);
    var g = env(t, 0.12, 0.002, 0.55, bus.music);
    g.connect(bus.dly);
    g.connect(bus.rev);
    osc('sine', f, t, t + 0.7, g);
    osc('sine', f * 5.4, t, t + 0.2, env(t, 0.03, 0.001, 0.08, g));
  }
  function stab(t, notes, peak) {
    var g = env(t, peak || 0.09, 0.004, 0.35, bus.music);
    g.connect(bus.dly);
    g.connect(bus.rev);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    lp.connect(g);
    var share = gain(1 / notes.length, lp);
    notes.forEach(function (m) { osc('sawtooth', mtof(m), t, t + 0.45, share); });
  }
  function riser(t, dur) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    g.connect(bus.drums);
    g.connect(bus.rev);
    src.connect(bp);
    bp.connect(g);
    src.start(t, 0);
    src.stop(t + dur + 0.1);
  }
  function crash(t) {
    noise(t, 0.16, 'highpass', 5000, 1.2, bus.drums, 0, bus.rev);
  }

  /* ---------- Sequencer ---------- */
  function emit(type, t, s) { queue.push({ type: type, t: t, s: s }); }

  function playStep(t0) {
    var v = VIBES[current];
    var sd = stepDur();
    var s = step;
    var t = t0 + (s % 2 ? v.swing * sd : 0);
    var ci = bar % 4;
    var breakdown = bar % 8 === 7 && s >= 8; // half a bar without kick before every 8-bar drop
    var l;

    if (s === 0 && bar % 8 === 0) {
      if (bar > 0) crash(t);
      emit('drop', t, bar > 0 ? 1 : 0.7);
      melodyIx = 0;
    }
    if (bar % 8 === 7 && s === 8) riser(t, sd * 8);

    if (!breakdown && level(v.kick, s)) { kick(t, current === 'techno'); emit('kick', t, 1); }
    if ((l = level(v.clap, s))) clap(t, 0.5 * l);
    if ((l = level(v.snare, s))) snare(t, 0.75 * l);
    if ((l = level(v.ohat, s))) hat(t, 0.15 * l, true);
    if ((l = level(v.chat, s))) hat(t, 0.12 * l, false);
    if ((l = level(v.shaker, s))) shaker(t, 0.09 * l);
    if (v.perc && PERC[v.perc.charAt(s)]) perc(t, PERC[v.perc.charAt(s)], 0.28);
    if (v.bass && !breakdown && OFFSET.hasOwnProperty(v.bass.charAt(s))) bass(t, v.roots[ci] + OFFSET[v.bass.charAt(s)], sd * 1.7, 0.3);
    if (v.rumble && !breakdown && level(v.rumble, s)) rumble(t, v.roots[ci], sd * 0.95);
    if (v.acid && (l = level(v.acid, s))) acid(t, v.acidRoot + v.acidNotes[s], l === 1, sd);
    if (v.sub && !breakdown && level(v.sub, s)) sub808(t, v.roots[ci], sd * 10);
    if (v.pad && s === 0) pad(t, v.chords[ci], sd * 16);
    if (v.keys && (s === 0 || s === 10)) keys(t, v.chords[ci], s === 0 ? sd * 10 : sd * 6, s === 0 ? 0.11 : 0.07);
    if (v.pluck && level(v.pluck, s)) { pluck(t, v.melody[melodyIx % v.melody.length]); melodyIx += 1; }
    if (v.stab && s === 14 && bar % 2 === 1) stab(t, v.stab);
  }

  function tuneDelay(t) { bus.delay.delayTime.setValueAtTime(stepDur() * 3, t); }

  function schedule() {
    var now = ctx.currentTime;
    if (nextTime < now - 0.2) nextTime = now + 0.05; // the tab was throttled: skip ahead, don't burst
    while (nextTime < now + 0.15) {
      if (step === 0 && pending) {
        current = pending;
        pending = null;
        tuneDelay(nextTime);
      }
      playStep(nextTime);
      nextTime += stepDur();
      step = (step + 1) % 16;
      if (step === 0) bar += 1;
    }
  }

  function dispatch() {
    raf = 0;
    if (!ctx) return;
    var heard = ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    while (queue.length && queue[0].t <= heard) {
      var e = queue.shift();
      for (var i = 0; i < beatFns.length; i++) beatFns[i](e.type, e.s);
    }
    if (mix && playing) detectOnset(ctx.currentTime);
    if (playing) raf = requestAnimationFrame(dispatch);
  }

  /* ---------- Own mix (MP3) ---------- */
  function startMix(now) {
    if (!mix) {
      var el = new window.Audio();
      el.src = settings.mixUrl;
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      ctx.createMediaElementSource(el).connect(bus.mixBus);
      mix = { el: el, avg: 0, last: 0, bins: new Uint8Array(bus.analyser.frequencyBinCount) };
    }
    var p = mix.el.play();
    if (p && p.catch) p.catch(function () { stop(); });
    ramp(bus.mixBus.gain, 1, now, 0.15);
  }
  function detectOnset(now) {
    bus.analyser.getByteFrequencyData(mix.bins);
    var e = (mix.bins[1] + mix.bins[2] + mix.bins[3]) / 765;
    mix.avg = mix.avg * 0.92 + e * 0.08;
    if (e > 0.3 && e > mix.avg * 1.18 && now - mix.last > 0.26) {
      mix.last = now;
      for (var i = 0; i < beatFns.length; i++) beatFns[i]('kick', Math.min(1, e * 1.2));
    }
  }

  /* ---------- Transport ---------- */
  function ramp(param, to, now, secs) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + secs);
  }
  function notify() { for (var i = 0; i < stateFns.length; i++) stateFns[i](playing); }

  function start(vibe) {
    if (!AC) return false;
    if (vibe && VIBES[vibe]) { current = vibe; pending = null; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    if (!ctx) {
      try { build(); } catch (e) { ctx = null; return false; }
    }
    if (ctx.state !== 'running') {
      var r = ctx.resume();
      if (r && r.catch) r.catch(function () {});
    }
    if (playing) return true;
    playing = true;
    var now = ctx.currentTime;
    if (settings.mixUrl) {
      startMix(now);
    } else {
      step = 0;
      bar = 0;
      melodyIx = 0;
      nextTime = now + 0.06;
      tuneDelay(now);
      schedule();
      timer = setInterval(schedule, 25);
      ramp(bus.master.gain, 0.9, now, 0.08);
    }
    if (!raf) raf = requestAnimationFrame(dispatch);
    // A browser that refused to start audio leaves the context suspended.
    setTimeout(function () { if (playing && ctx.state !== 'running') stop(); }, 800);
    notify();
    return true;
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    timer = 0;
    queue.length = 0;
    var now = ctx.currentTime;
    ramp(bus.master.gain, 0, now, 0.2);
    ramp(bus.mixBus.gain, 0, now, 0.2);
    setTimeout(function () {
      if (playing) return;
      if (mix) mix.el.pause();
      if (ctx.state === 'running') ctx.suspend();
    }, 700);
    notify();
  }

  function setVibe(v) {
    if (!VIBES[v]) return;
    if (!playing || mix) { current = v; pending = null; return; }
    pending = v === current ? null : v;
  }

  function hit() {
    if (!playing || mix) return;
    var v = VIBES[current];
    var chord = v.stab || (v.chords ? v.chords[bar % 4].slice(0, 4) : [57, 60, 64]);
    stab(Math.max(nextTime, ctx.currentTime + 0.01), chord, 0.11);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (playing) { resumeOnShow = true; stop(); }
    } else if (resumeOnShow) {
      resumeOnShow = false;
      start();
    }
  });

  window.PXAudio = {
    supported: !!AC,
    bpm: function (v) { return (VIBES[v] || VIBES[current]).bpm; },
    start: start,
    stop: stop,
    setVibe: setVibe,
    hit: hit,
    isPlaying: function () { return playing; },
    onBeat: function (fn) { beatFns.push(fn); },
    onState: function (fn) { stateFns.push(fn); },
    spectrum: function (arr) {
      if (!ctx || !playing) return false;
      bus.analyser.getByteFrequencyData(arr);
      return true;
    }
  };
})();
