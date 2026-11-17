/* ProjectX payment confirmation page: shows the order, adds it to a calendar, throws confetti. */
(function () {
  'use strict';

  var CFG = window.PROJECTX || { events: [] };
  var params = new URLSearchParams(window.location.search);
  var sessionId = params.get('session_id') || '';
  var ev = (CFG.events || []).filter(function (e) { return e.id === params.get('event'); })[0] || null;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var fmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Dubai'
  });
  function parts(iso) {
    var o = {};
    fmt.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  if (ev) {
    var p = parts(ev.start);
    if (ev.vibe) document.documentElement.setAttribute('data-mood', ev.vibe);
    document.getElementById('doneEvent').textContent =
      'EXP.' + ev.number + ' ' + ev.title + ' · ' + p.weekday + ' ' + p.day + ' ' + p.month + ' ' + p.year +
      ' · doors ' + p.hour + ':' + p.minute + ' · ' + ev.area;
    try {
      var carts = JSON.parse(window.sessionStorage.getItem('px-carts')) || {};
      delete carts[ev.id];
      window.sessionStorage.setItem('px-carts', JSON.stringify(carts));
    } catch (e) { /* storage blocked */ }
  }

  // Ask the server whether Stripe marked the session as paid.
  if (/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    fetch('/api/session?id=' + encodeURIComponent(sessionId)).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (!data) return;
      var status = document.getElementById('doneStatus');
      status.textContent = data.paid ? 'Payment confirmed' : 'Payment processing';
      if (!data.items || !data.items.length) return;
      var box = document.getElementById('doneOrder');
      box.innerHTML = '<ul class="co-lines">' + data.items.map(function (i) {
        return '<li><span>' + esc(i.qty) + ' × ' + esc(i.name) + '</span></li>';
      }).join('') + '</ul>' +
        (data.total != null ? '<div class="co-tot"><span>Paid</span><strong>' + esc(data.currency + ' ' + data.total.toLocaleString('en-US')) + '</strong></div>' : '');
      box.hidden = false;
    }).catch(function () { /* the generic message stays */ });
  }

  // Calendar file.
  var calBtn = document.getElementById('addCal');
  if (ev && ev.end) {
    calBtn.hidden = false;
    calBtn.addEventListener('click', function () {
      var stamp = function (iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
      var text = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1'); };
      var ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ProjectX//Tickets//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:' + ev.id + '@projectx',
        'DTSTAMP:' + stamp(new Date().toISOString()),
        'DTSTART:' + stamp(ev.start),
        'DTEND:' + stamp(ev.end),
        'SUMMARY:' + text('ProjectX EXP.' + ev.number + ' ' + ev.title),
        'LOCATION:' + text(ev.area),
        'DESCRIPTION:' + text('Bring your Stripe receipt and original ID. ' + (ev.locationNote || '')),
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n') + '\r\n';
      var url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      var a = document.createElement('a');
      a.href = url;
      a.download = 'projectx-' + ev.id + '.ics';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    });
  }

  // Confetti, once.
  var cv = document.getElementById('confetti');
  if (reduce || !cv || !cv.getContext) return;
  var cx = cv.getContext('2d');
  var cs = getComputedStyle(document.documentElement);
  var colours = [cs.getPropertyValue('--a1').trim(), cs.getPropertyValue('--a2').trim(), cs.getPropertyValue('--text').trim()];
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var W = cv.width = Math.round(window.innerWidth * dpr);
  var H = cv.height = Math.round(window.innerHeight * dpr);
  var bits = [];
  for (var i = 0; i < 140; i++) {
    bits.push({
      x: Math.random() * W,
      y: -Math.random() * H * 0.6,
      w: (5 + Math.random() * 7) * dpr,
      h: (2 + Math.random() * 4) * dpr,
      vy: (140 + Math.random() * 260) * dpr,
      vx: (Math.random() - 0.5) * 80 * dpr,
      r: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 8,
      c: colours[i % colours.length]
    });
  }
  var t0 = performance.now(), last = t0;
  (function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    cx.clearRect(0, 0, W, H);
    var alive = false;
    bits.forEach(function (b) {
      b.y += b.vy * dt;
      b.x += b.vx * dt;
      b.r += b.vr * dt;
      if (b.y < H + 20) alive = true;
      cx.save();
      cx.translate(b.x, b.y);
      cx.rotate(b.r);
      cx.fillStyle = b.c;
      cx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      cx.restore();
    });
    if (alive && now - t0 < 6000) requestAnimationFrame(frame);
    else cx.clearRect(0, 0, W, H);
  })(t0);
})();
