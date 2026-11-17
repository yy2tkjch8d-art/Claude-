/*
 * ProjectX light show: a canvas of laser fans, haze and dust that pulses on
 * the beat, crosses into an X on every drop and bursts where you tap.
 * Exposes window.PXStage.init(canvas, options).
 */
(function () {
  'use strict';

  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16);
    if (isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  }

  function init(canvas, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    var still = !!opts.reduceMotion;
    var bg = hexToRgb(opts.background || '#07070b');
    var c1 = hexToRgb(opts.a1), c2 = hexToRgb(opts.a2);
    var t1 = c1.slice(), t2 = c2.slice();
    var dpr = 1, w = 1, h = 1;
    var pulse = 0, xFlash = 0, time = 0, last = 0;
    var running = false, onScreen = true, raf = 0;
    var aim = 0, aimTarget = 0;
    var audioOn = false;
    var idle = { bpm: 122, phase: 0, count: 0 };
    var dust = [], sparks = [], rings = [];
    var frameFns = [];

    function resize() {
      var r = canvas.getBoundingClientRect();
      var cssW = Math.max(1, r.width), cssH = Math.max(1, r.height);
      dpr = Math.min(window.devicePixelRatio || 1, cssW < 700 ? 1.5 : 2);
      w = Math.round(cssW * dpr);
      h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      seedDust();
      paintSolid();
      draw(0);
    }
    function seedDust() {
      var n = Math.round(Math.min(110, (w * h) / (dpr * dpr) / 9000));
      dust = [];
      for (var i = 0; i < n; i++) {
        dust.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (0.4 + Math.random() * 1.4) * dpr,
          v: (4 + Math.random() * 16) * dpr,
          a: 0.1 + Math.random() * 0.35,
          ph: Math.random() * 6.28
        });
      }
    }
    function paintSolid() {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(bg, 1);
      ctx.fillRect(0, 0, w, h);
    }

    function line(x1, y1, x2, y2) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    function beam(x1, y1, x2, y2, col, e) {
      var g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, rgba(col, 0.9 * e));
      g.addColorStop(0.45, rgba(col, 0.32 * e));
      g.addColorStop(1, rgba(col, 0));
      ctx.strokeStyle = g;
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = 9 * dpr;
      line(x1, y1, x2, y2);
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.3 * dpr;
      line(x1, y1, x2, y2);
    }
    function fan(ex, ey, n, phase, ca, cb, e) {
      var center = Math.sin(phase) * 0.55 + aim * 0.6; // radians from straight down
      var spread = 0.28 + 0.18 * Math.sin(phase * 0.7 + 1.3);
      var len = Math.hypot(w, h) * 1.2;
      for (var i = 0; i < n; i++) {
        var f = n === 1 ? 0 : i / (n - 1) - 0.5;
        var a = center + f * spread * 2;
        beam(ex, ey, ex + Math.sin(a) * len, ey + Math.cos(a) * len, i % 2 ? cb : ca, e);
      }
      var r = 70 * dpr;
      var g = ctx.createRadialGradient(ex, ey, 0, ex, ey, r);
      g.addColorStop(0, rgba(ca, 0.4 * e));
      g.addColorStop(1, rgba(ca, 0));
      ctx.fillStyle = g;
      ctx.fillRect(ex - r, ey - r, r * 2, r * 2);
    }
    function haze(x, y, r, col, a) {
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(col, a));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    function drawX(a) {
      var cx = w * (w / dpr > 900 ? 0.7 : 0.5);
      var cy = h * 0.42;
      var L = Math.hypot(w, h);
      [[1, 1, c1], [1, -1, c2]].forEach(function (d) {
        var dx = d[0] * L * 0.7, dy = d[1] * L * 0.7 * 0.8;
        ctx.strokeStyle = rgba(d[2], 0.16 * a);
        ctx.lineWidth = 22 * dpr;
        line(cx - dx, cy - dy, cx + dx, cy + dy);
        ctx.strokeStyle = rgba(d[2], 0.95 * a);
        ctx.lineWidth = 2.4 * dpr;
        line(cx - dx, cy - dy, cx + dx, cy + dy);
      });
      haze(cx, cy, 160 * dpr, c1, 0.35 * a);
    }

    function draw(dt) {
      var k = Math.min(1, dt * 3);
      for (var i = 0; i < 3; i++) {
        c1[i] += (t1[i] - c1[i]) * k;
        c2[i] += (t2[i] - c2[i]) * k;
      }
      aim += (aimTarget - aim) * Math.min(1, dt * 2.5);

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = rgba(bg, still ? 1 : 0.42); // a little trail makes the sweep read as volume
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      var e = 0.55 + pulse * 0.45;
      var big = Math.max(w, h);

      haze(w * (0.3 + 0.1 * Math.sin(time * 0.13)), h * 0.15, big * 0.6, c2, 0.05 + pulse * 0.05);
      haze(w * (0.75 + 0.08 * Math.cos(time * 0.11)), h * 0.05, big * 0.5, c1, 0.05 + pulse * 0.04);

      var narrow = w / dpr < 700;
      var n = narrow ? 5 : 7;
      fan(w * 0.2, -10 * dpr, n, time * 0.55, c1, c2, e);
      fan(w * 0.8, -10 * dpr, n, time * 0.47 + 2.1, c2, c1, e);
      if (w / dpr >= 1000) fan(w * 0.5, -10 * dpr, 5, time * 0.39 + 4.2, c1, c2, e * 0.8);

      if (xFlash > 0.01) drawX(xFlash);

      var dustCol = [
        (c1[0] + 255) / 2,
        (c1[1] + 255) / 2,
        (c1[2] + 255) / 2
      ];
      for (var d = 0; d < dust.length; d++) {
        var p = dust[d];
        if (!still) {
          p.y -= p.v * dt;
          p.x += Math.sin(time * 0.5 + p.ph) * 6 * dpr * dt;
          if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
        }
        ctx.fillStyle = rgba(dustCol, p.a * (0.35 + pulse * 0.65));
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }

      for (var s = sparks.length - 1; s >= 0; s--) {
        var sp = sparks[s];
        sp.life -= dt;
        if (sp.life <= 0) { sparks.splice(s, 1); continue; }
        var drag = Math.exp(-dt * 2.8);
        sp.vx *= drag;
        sp.vy *= drag;
        sp.x += sp.vx * dt;
        sp.y += sp.vy * dt;
        var la = sp.life / sp.max;
        ctx.fillStyle = rgba(sp.c, la);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r * (0.4 + la), 0, 6.2832);
        ctx.fill();
      }
      for (var q = rings.length - 1; q >= 0; q--) {
        var ring = rings[q];
        ring.life -= dt;
        if (ring.life <= 0) { rings.splice(q, 1); continue; }
        var ra = ring.life / ring.max;
        ctx.strokeStyle = rgba(c1, 0.7 * ra);
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, (1 - ra) * 260 * dpr, 0, 6.2832);
        ctx.stroke();
      }
    }

    function idleBeat(dt) {
      if (audioOn) return;
      idle.phase += dt * idle.bpm / 60;
      if (idle.phase >= 1) {
        idle.phase -= 1;
        idle.count += 1;
        pulse = Math.max(pulse, 0.3);
        if (idle.count % 16 === 0) xFlash = Math.max(xFlash, 0.7);
      }
    }

    function loop(now) {
      raf = 0;
      if (!running) return;
      var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      time += dt;
      idleBeat(dt);
      draw(dt);
      pulse *= Math.exp(-dt * 5.5);
      xFlash *= Math.exp(-dt * 1.4);
      for (var i = 0; i < frameFns.length; i++) frameFns[i](pulse);
      raf = requestAnimationFrame(loop);
    }
    function play() {
      if (still || running || !onScreen || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
    function pause() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      for (var i = 0; i < frameFns.length; i++) frameFns[i](0);
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) play(); else pause();
      }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pause(); else play();
    });
    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    });

    resize();
    play();

    return {
      setColors: function (a, b) {
        t1 = hexToRgb(a);
        t2 = hexToRgb(b);
        if (still) { c1 = t1.slice(); c2 = t2.slice(); draw(0); }
      },
      setBpm: function (bpm) { if (bpm > 0) idle.bpm = bpm; },
      setAudioActive: function (on) { audioOn = !!on; },
      beat: function (type, strength) {
        if (type === 'kick') pulse = Math.max(pulse, 0.78 * (strength || 1));
        else if (type === 'drop') { pulse = 1; xFlash = Math.max(xFlash, strength || 1); }
        if (still && type === 'drop') draw(0);
      },
      burst: function (clientX, clientY) {
        if (still) return;
        var r = canvas.getBoundingClientRect();
        var x = (clientX - r.left) * dpr, y = (clientY - r.top) * dpr;
        for (var i = 0; i < 28; i++) {
          var a = Math.random() * Math.PI * 2;
          var v = (120 + Math.random() * 380) * dpr;
          var life = 0.6 + Math.random() * 0.5;
          sparks.push({
            x: x, y: y,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            r: (1.2 + Math.random() * 2.2) * dpr,
            c: i % 3 === 0 ? [255, 255, 255] : (i % 2 ? c1.slice() : c2.slice()),
            life: life, max: life
          });
        }
        rings.push({ x: x, y: y, life: 0.7, max: 0.7 });
        pulse = Math.max(pulse, 0.6);
      },
      aim: function (clientX) {
        aimTarget = ((clientX / (window.innerWidth || 1)) - 0.5) * 1.1;
      },
      onFrame: function (fn) { frameFns.push(fn); }
    };
  }

  window.PXStage = { init: init };
})();
