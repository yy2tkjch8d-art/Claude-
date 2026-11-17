/*
 * ProjectX site: renders events, lineup, tickets and FAQ from config.js and
 * runs the interactive parts (vibe switch, sound, box office, checkout).
 */
(function () {
  'use strict';

  var CFG = window.PROJECTX;
  if (!CFG) return;

  var doc = document;
  var root = doc.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var snd = window.PXAudio && window.PXAudio.supported ? window.PXAudio : null;
  var stage = null;

  var TZ = 'Asia/Dubai';
  var CUR = (CFG.payments && CFG.payments.currency) || 'AED';
  var VAT = Number(CFG.payments && CFG.payments.vatRate) || 0;
  var MAX_ORDER = (CFG.payments && CFG.payments.maxTicketsPerOrder) || 20;
  var STATUS = { 'on-sale': 'On sale', 'selling-fast': 'Selling fast', 'early-bird': 'Early bird', 'sold-out': 'Sold out' };
  var VIBES = {
    afro: { label: 'Afro House' },
    techno: { label: 'Techno' },
    hiphop: { label: 'Hip-Hop' }
  };

  /* ---------- Helpers ---------- */
  function $(sel, el) { return (el || doc).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || doc).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var store = {
    get: function (k) { try { return JSON.parse(window.sessionStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { window.sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  var partsFmt = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ
  });
  function parts(iso) {
    var o = {};
    partsFmt.formatToParts(new Date(iso)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function dayLabel(iso, withYear) {
    var p = parts(iso);
    return p.weekday + ' ' + p.day + ' ' + p.month + (withYear ? ' ' + p.year : '');
  }
  function timeLabel(iso) { var p = parts(iso); return p.hour + ':' + p.minute; }
  var num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  var num2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(n) { return CUR + ' ' + num.format(n); }

  /* ---------- Events ---------- */
  var EVENTS = (CFG.events || []).slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
  function byId(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return null;
  }
  function isOver(ev, now) { return new Date(ev.end || ev.start).getTime() <= now; }
  function upcoming() {
    var now = Date.now();
    return EVENTS.filter(function (ev) { return !isOver(ev, now); });
  }
  function saleOpen(ev) {
    return ev.status !== 'sold-out' && !isOver(ev, Date.now()) && ev.tiers.some(function (t) { return !t.soldOut; });
  }
  function fromPrice(ev) {
    var open = ev.tiers.filter(function (t) { return !t.soldOut; });
    var list = open.length ? open : ev.tiers;
    return Math.min.apply(null, list.map(function (t) { return t.price; }));
  }
  function code(ev) { return 'EXP.' + ev.number; }

  var first = upcoming()[0] || EVENTS[0];
  if (!first) return;

  var state = {
    eventId: first.id,
    vibe: VIBES[first.vibe] ? first.vibe : 'afro',
    carts: store.get('px-carts') || {},
    total: 0,
    count: 0
  };
  // Drop anything in a saved cart that no longer exists or sold out.
  Object.keys(state.carts).forEach(function (id) {
    var ev = byId(id);
    var c = state.carts[id];
    if (!ev || !c || typeof c !== 'object') { delete state.carts[id]; return; }
    Object.keys(c).forEach(function (tid) {
      var t = ev.tiers.filter(function (x) { return x.id === tid; })[0];
      if (!t || t.soldOut || !(c[tid] > 0)) delete c[tid];
    });
  });
  function cartFor(id) { return state.carts[id] || (state.carts[id] = {}); }
  function maxFor(t) { return Math.min(t.maxPerOrder || 10, MAX_ORDER); }

  /* ---------- Vibe (colours + sound) ---------- */
  function readVibeColours() {
    var cs = getComputedStyle(root);
    Object.keys(VIBES).forEach(function (k) {
      VIBES[k].a1 = cs.getPropertyValue('--' + k + '-1').trim() || '#ff9e2c';
      VIBES[k].a2 = cs.getPropertyValue('--' + k + '-2').trim() || '#ff3d7f';
    });
  }
  function bpmOf(v) { return snd ? snd.bpm(v) : ({ afro: 122, techno: 130, hiphop: 92 })[v]; }

  function setVibe(v) {
    if (!VIBES[v]) return;
    state.vibe = v;
    root.setAttribute('data-mood', v);
    var radio = $('#vibe-' + v);
    if (radio) radio.checked = true;
    if (stage) {
      stage.setColors(VIBES[v].a1, VIBES[v].a2);
      stage.setBpm(bpmOf(v));
    }
    if (snd) snd.setVibe(v);
    var label = $('#meterLabel');
    if (label) label.textContent = VIBES[v].label + ' · ' + bpmOf(v) + ' BPM';
  }

  /* ---------- Hero: next event + countdown ---------- */
  var nextEv = null;
  function renderNext() {
    var el = $('#nextUp');
    nextEv = upcoming()[0] || null;
    if (!nextEv) {
      el.innerHTML = '<p class="next-none">New dates drop soon. Follow us to hear first.</p>';
      return;
    }
    el.innerHTML =
      '<div class="next-meta">' +
        '<span class="next-tag">Next up</span>' +
        '<p class="next-name">' + esc(code(nextEv) + ' ' + nextEv.title) + '</p>' +
        '<p class="next-when">' + esc(dayLabel(nextEv.start) + ' · ' + timeLabel(nextEv.start) + ' · ' + nextEv.area) + '</p>' +
      '</div>' +
      '<div class="countdown" role="timer" aria-label="Time until doors open">' +
        ['Days', 'Hrs', 'Min', 'Sec'].map(function (u) {
          return '<div class="cd"><b>00</b><span>' + u + '</span></div>';
        }).join('') +
      '</div>';
    tick();
  }
  function tick() {
    if (!nextEv) return;
    var now = Date.now();
    var start = new Date(nextEv.start).getTime();
    var end = new Date(nextEv.end || nextEv.start).getTime();
    var box = $('#nextUp .countdown');
    if (!box) return;
    if (now >= end) { renderNext(); return; }
    if (now >= start) {
      if (!box.classList.contains('is-live')) {
        box.classList.add('is-live');
        box.innerHTML = '<p class="live"><i></i>Live now</p>';
      }
      return;
    }
    var s = Math.floor((start - now) / 1000);
    var vals = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
    $$('.cd b', box).forEach(function (b, i) {
      var v = (vals[i] < 10 ? '0' : '') + vals[i];
      if (b.textContent !== v) b.textContent = v;
    });
  }

  /* ---------- Event tickets ---------- */
  function renderEvents() {
    var list = upcoming();
    var el = $('#eventList');
    if (!list.length) {
      el.innerHTML = '<p class="section-lede">No dates on sale right now. New experiments drop on our socials first.</p>';
      return;
    }
    el.innerHTML = list.map(function (ev) {
      var open = saleOpen(ev);
      var cta;
      if (!open) cta = '<span class="btn btn-ghost btn-sm is-static">Sold out</span>';
      else if (ev.ticketUrl) cta = '<a class="btn btn-primary btn-sm" href="' + esc(ev.ticketUrl) + '" target="_blank" rel="noopener">Get tickets</a>';
      else cta = '<a class="btn btn-primary btn-sm" href="#tickets" data-pick="' + esc(ev.id) + '">Get tickets</a>';
      var status = open ? ev.status : 'sold-out';
      return '<article class="ticket" data-vibe="' + esc(ev.vibe) + '">' +
        '<div class="ticket-main">' +
          '<span class="ticket-num" aria-hidden="true">' + esc(ev.number) + '</span>' +
          '<div class="ticket-body">' +
            '<p class="ticket-code">' + esc(code(ev) + ' · ' + ev.genres.join(' · ')) + '</p>' +
            '<h3 class="ticket-title">' + esc(ev.title) + '</h3>' +
            '<p class="ticket-when"><time datetime="' + esc(ev.start) + '">' + esc(dayLabel(ev.start, true)) + '</time> · ' +
              '<span class="nowrap">' + esc(timeLabel(ev.start) + '–' + timeLabel(ev.end)) + '</span></p>' +
            '<p class="ticket-where">' + esc(ev.area) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="ticket-stub">' +
          '<span class="status status-' + esc(status) + '">' + esc(STATUS[status] || 'On sale') + '</span>' +
          '<p class="ticket-from"><span>From</span>' + esc(money(fromPrice(ev))) + '</p>' +
          cta +
        '</div>' +
      '</article>';
    }).join('');
  }

  /* ---------- Event switches (lineup + box office) ---------- */
  function renderSwitches() {
    [['#lineupSwitch', 'lineupEvent'], ['#ticketSwitch', 'ticketEvent']].forEach(function (pair) {
      var el = $(pair[0]);
      el.innerHTML = upcoming().map(function (ev) {
        var id = pair[1] + '-' + ev.id;
        return '<input type="radio" name="' + pair[1] + '" id="' + esc(id) + '" value="' + esc(ev.id) + '"' + (ev.id === state.eventId ? ' checked' : '') + '>' +
          '<label for="' + esc(id) + '"><b>' + esc(code(ev)) + '</b><span>' + esc(dayLabel(ev.start)) + '</span></label>';
      }).join('');
    });
  }

  function setEvent(id) {
    var ev = byId(id);
    if (!ev) return;
    var changed = id !== state.eventId;
    state.eventId = id;
    $$('input[name="lineupEvent"], input[name="ticketEvent"]').forEach(function (r) { r.checked = r.value === id; });
    if (changed) {
      renderLineup();
      renderTiers();
      if (VIBES[ev.vibe]) setVibe(ev.vibe);
    }
  }

  /* ---------- Lineup ---------- */
  var actObserver = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { en.target.classList.toggle('lit', en.isIntersecting); });
  }, { rootMargin: '-42% 0px -42% 0px' }) : null;

  function renderLineup() {
    var ev = byId(state.eventId);
    var el = $('#actList');
    el.innerHTML = (ev.lineup || []).map(function (a) {
      if (a.secret) {
        return '<li class="act is-secret">' +
          '<p class="act-time">' + esc(a.time) + '</p>' +
          '<div class="act-main">' +
            '<p class="act-name"><span class="secret-name">Classified</span></p>' +
            '<p class="act-genre">' + esc(a.genre) + ' · Headliner</p>' +
            '<p class="act-note" hidden>Ticket holders get the name 48 hours before doors. <a href="#tickets">Get tickets</a></p>' +
          '</div>' +
          '<button class="decrypt" type="button">Decrypt</button>' +
        '</li>';
      }
      return '<li class="act">' +
        '<p class="act-time">' + esc(a.time) + '</p>' +
        '<div class="act-main"><p class="act-name">' + esc(a.name) + '</p><p class="act-genre">' + esc(a.genre) + '</p></div>' +
      '</li>';
    }).join('');
    if (actObserver) {
      actObserver.disconnect();
      $$('.act', el).forEach(function (li) { actObserver.observe(li); });
    }
  }

  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&@$';
  function scramble(el, finalText, ms, done) {
    if (!ms) { el.textContent = finalText; done(); return; }
    var t0 = performance.now();
    (function frame(now) {
      var p = Math.min(1, (now - t0) / ms);
      var shown = Math.floor(p * finalText.length);
      var out = '';
      for (var i = 0; i < finalText.length; i++) {
        var ch = finalText.charAt(i);
        out += i < shown || ch === ' ' ? ch : GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
      }
      el.textContent = out;
      if (p < 1) requestAnimationFrame(frame);
      else { el.textContent = finalText; done(); }
    })(t0);
  }

  /* ---------- Box office ---------- */
  function renderTiers() {
    var ev = byId(state.eventId);
    var c = cartFor(ev.id);
    var open = saleOpen(ev);
    var ext = !!ev.ticketUrl;

    $('#officeEvent').innerHTML =
      '<p>' + esc(code(ev) + ' ' + ev.title) + '</p>' +
      '<p>' + esc(dayLabel(ev.start, true) + ' · ' + timeLabel(ev.start) + '–' + timeLabel(ev.end) + ' · ' + ev.area) + '</p>' +
      (ev.locationNote ? '<p>' + esc(ev.locationNote) + '</p>' : '');

    $('#tierList').innerHTML = ev.tiers.map(function (t) {
      var q = c[t.id] || 0;
      var buy = '';
      if (t.soldOut || !open) {
        buy = '<span class="stamp">Sold out</span>';
      } else if (!ext) {
        buy = '<div class="stepper" role="group" aria-label="' + esc(t.name) + ' quantity">' +
          '<button type="button" data-tier="' + esc(t.id) + '" data-step="-1" aria-label="Remove one ' + esc(t.name) + '">−</button>' +
          '<output>' + q + '</output>' +
          '<button type="button" data-tier="' + esc(t.id) + '" data-step="1" aria-label="Add one ' + esc(t.name) + '">+</button>' +
        '</div>';
      }
      return '<li class="tier' + (t.soldOut ? ' is-soldout' : '') + '" data-tier-row="' + esc(t.id) + '">' +
        '<div class="tier-info">' +
          '<h3 class="tier-name">' + esc(t.name) + '</h3>' +
          (t.perks && t.perks.length ? '<ul class="tier-perks">' + t.perks.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>' +
        '<div class="tier-buy"><p class="tier-price"><span>' + esc(CUR) + '</span>' + esc(num.format(t.price)) + '</p>' + buy + '</div>' +
      '</li>';
    }).join('');

    var extEl = $('#officeExternal');
    if (ext && open) {
      extEl.hidden = false;
      extEl.innerHTML = '<p>Tickets for this night are sold on ' + esc(ev.ticketSiteName || 'our ticketing partner') + '.</p>' +
        '<a class="btn btn-primary" href="' + esc(ev.ticketUrl) + '" target="_blank" rel="noopener">Buy on ' + esc(ev.ticketSiteName || 'partner site') + '</a>';
    } else {
      extEl.hidden = true;
      extEl.innerHTML = '';
    }
    syncSteppers();
    renderOrder();
  }

  function syncSteppers() {
    var ev = byId(state.eventId);
    var c = cartFor(ev.id);
    var total = Object.keys(c).reduce(function (s, k) { return s + c[k]; }, 0);
    ev.tiers.forEach(function (t) {
      var row = $('[data-tier-row="' + t.id + '"]');
      if (!row) return;
      var q = c[t.id] || 0;
      row.classList.toggle('is-picked', q > 0);
      var out = $('output', row);
      if (out) out.textContent = q;
      var minus = $('[data-step="-1"]', row), plus = $('[data-step="1"]', row);
      if (minus) minus.disabled = q <= 0;
      if (plus) plus.disabled = q >= maxFor(t) || total >= MAX_ORDER;
    });
  }

  function orderLines() {
    var ev = byId(state.eventId);
    var c = cartFor(ev.id);
    return ev.tiers.filter(function (t) { return c[t.id] > 0; }).map(function (t) {
      return { tier: t, qty: c[t.id], sum: t.price * c[t.id] };
    });
  }

  function renderOrder() {
    var ev = byId(state.eventId);
    var lines = orderLines();
    state.total = lines.reduce(function (s, l) { return s + l.sum; }, 0);
    state.count = lines.reduce(function (s, l) { return s + l.qty; }, 0);
    $('#orderEvent').textContent = code(ev) + ' ' + ev.title + ' · ' + dayLabel(ev.start);
    $('#orderLines').innerHTML = lines.map(function (l) {
      return '<li><span>' + l.qty + ' × ' + esc(l.tier.name) + '</span><span>' + esc(money(l.sum)) + '</span></li>';
    }).join('');
    $('#orderEmpty').hidden = lines.length > 0;
    $('#orderTotal').textContent = money(state.total);
    $('#orderVat').textContent = VAT
      ? 'Includes ' + Math.round(VAT * 100) + '% VAT' + (state.total ? ' (' + CUR + ' ' + num2.format(state.total * VAT / (1 + VAT)) + ')' : '')
      : '';
    $('#checkoutBtn').disabled = !lines.length || !!ev.ticketUrl;
    $('#cartCount').textContent = state.count + (state.count === 1 ? ' item' : ' items') + ' · ' + code(ev);
    $('#cartTotal').textContent = money(state.total);
    updateCartBar();
    store.set('px-carts', state.carts);
  }

  function changeQty(tierId, delta) {
    var ev = byId(state.eventId);
    var t = ev.tiers.filter(function (x) { return x.id === tierId; })[0];
    if (!t || t.soldOut) return;
    var c = cartFor(ev.id);
    var total = Object.keys(c).reduce(function (s, k) { return s + c[k]; }, 0);
    var q = (c[tierId] || 0) + delta;
    if (q < 0 || q > maxFor(t) || (delta > 0 && total >= MAX_ORDER)) return;
    if (q === 0) delete c[tierId]; else c[tierId] = q;
    syncSteppers();
    renderOrder();
  }

  /* ---------- Cart bar ---------- */
  var orderOnScreen = false;
  var dialogOpen = false;
  function updateCartBar() {
    var bar = $('#cartBar');
    var ev = byId(state.eventId);
    bar.hidden = !(state.count > 0 && !orderOnScreen && !dialogOpen && !ev.ticketUrl);
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      orderOnScreen = entries[0].isIntersecting;
      updateCartBar();
    }, { threshold: 0.2 }).observe($('#order'));
  }

  /* ---------- Checkout ---------- */
  var dialog = $('#checkout');
  var form = $('#coForm');
  function waNumber() { return String((CFG.contact && CFG.contact.whatsapp) || '').replace(/\D/g, ''); }
  function waLink(text) {
    var n = waNumber();
    return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(text) : '';
  }

  function openCheckout() {
    var ev = byId(state.eventId);
    var lines = orderLines();
    if (!lines.length || ev.ticketUrl) return;
    $('#coSummary').innerHTML =
      '<p class="co-ev">' + esc(code(ev) + ' ' + ev.title + ' · ' + dayLabel(ev.start, true) + ' · ' + timeLabel(ev.start)) + '</p>' +
      '<ul class="co-lines">' + lines.map(function (l) {
        return '<li><span>' + l.qty + ' × ' + esc(l.tier.name) + '</span><span>' + esc(money(l.sum)) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="co-tot"><span>Total incl. VAT</span><strong>' + esc(money(state.total)) + '</strong></div>';
    $('#coPay').textContent = 'Pay ' + money(state.total);
    $('#coPay').disabled = false;
    $('#coError').hidden = true;
    $('#coFallback').hidden = true;
    dialogOpen = true;
    updateCartBar();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    setTimeout(function () { $('#coName').focus(); }, 40);
  }
  function closeCheckout() {
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); onDialogClose(); }
  }
  function onDialogClose() {
    dialogOpen = false;
    updateCartBar();
  }

  var PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
  function fieldError(input) {
    if (input.type === 'checkbox') return input.checked ? '' : input.id === 'coAge'
      ? 'You need to be ' + (CFG.minAge || 21) + ' or older, with your original ID.'
      : 'Accept the terms and refund policy to continue.';
    var v = input.value.trim();
    if (input.type === 'tel') return PHONE.test(v) ? '' : 'Enter your WhatsApp number with the country code, like +971 50 123 4567.';
    if (input.type === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? '' : 'Enter a valid email. Your ticket goes there.';
    return v.length >= 2 ? '' : 'Enter your full name as it appears on your ID.';
  }
  function validate(scope) {
    var firstBad = null, message = '';
    $$('input[required]', scope).forEach(function (input) {
      var err = fieldError(input);
      input.setAttribute('aria-invalid', err ? 'true' : 'false');
      if (err && !firstBad) { firstBad = input; message = err; }
    });
    if (firstBad) firstBad.focus();
    return message;
  }
  function showError(msg) {
    var el = $('#coError');
    el.textContent = msg;
    el.hidden = !msg;
  }
  function orderText() {
    var ev = byId(state.eventId);
    return 'Hi ProjectX, I want to book ' + code(ev) + ' ' + ev.title + ' (' + dayLabel(ev.start, true) + '):\n' +
      orderLines().map(function (l) { return l.qty + ' × ' + l.tier.name + ' = ' + money(l.sum); }).join('\n') +
      '\nTotal: ' + money(state.total) +
      '\nName: ' + $('#coName').value.trim() +
      '\nEmail: ' + $('#coEmail').value.trim() +
      '\nWhatsApp: ' + $('#coPhone').value.trim();
  }
  function showOffline() {
    var box = $('#coFallback');
    var link = waLink(orderText());
    box.innerHTML = '<p><strong>Card payments aren’t live on this site yet.</strong> ' +
      (link ? 'Send your order on WhatsApp and the team will reply with a payment link.' : 'Try again soon.') + '</p>' +
      (link ? '<a class="btn btn-ghost btn-sm" href="' + esc(link) + '" target="_blank" rel="noopener">Send order on WhatsApp</a>' : '');
    box.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    $('#coFallback').hidden = true;
    var err = validate(form);
    if (err) { showError(err); return; }

    var ev = byId(state.eventId);
    var pay = $('#coPay');
    pay.disabled = true;
    pay.textContent = 'Opening secure checkout…';
    var leaving = false;

    var payload = {
      eventId: ev.id,
      items: orderLines().map(function (l) { return { tierId: l.tier.id, qty: l.qty }; }),
      customer: { name: $('#coName').value.trim(), email: $('#coEmail').value.trim(), phone: $('#coPhone').value.trim() },
      consents: { age: $('#coAge').checked, terms: $('#coTerms').checked }
    };

    fetch(CFG.payments.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok && data.url) {
          leaving = true;
          window.location.assign(data.url);
        } else if (res.status === 400 && data.error) {
          showError(data.error);
        } else if (res.status === 404 || res.status === 405 || res.status === 501 || res.status === 503) {
          showOffline();
        } else {
          showError('The payment page didn’t open. Try again in a minute.');
        }
      });
    }).catch(function () {
      showOffline();
    }).then(function () {
      if (leaving) return;
      pay.disabled = false;
      pay.textContent = 'Pay ' + money(state.total);
    });
  });

  $('#coClose').addEventListener('click', closeCheckout);
  dialog.addEventListener('close', onDialogClose);
  dialog.addEventListener('click', function (e) { if (e.target === dialog) closeCheckout(); });
  $('#checkoutBtn').addEventListener('click', openCheckout);
  $('#cartCheckout').addEventListener('click', openCheckout);

  /* ---------- Guest list + tables ---------- */
  function initGuestList() {
    var gl = CFG.guestList || {};
    var panel = $('#glPanel');
    if (!gl.enabled) { panel.hidden = true; return; }
    if (gl.title) $('#glTitle').textContent = gl.title;
    $('#glText').textContent = gl.text || '';
    $('#glEvent').innerHTML = upcoming().map(function (ev) {
      return '<option value="' + esc(ev.id) + '">' + esc(code(ev) + ' ' + ev.title + ' · ' + dayLabel(ev.start)) + '</option>';
    }).join('');

    var glForm = $('#glForm');
    var status = $('#glStatus');
    glForm.addEventListener('submit', function (e) {
      e.preventDefault();
      status.textContent = '';
      var err = validate(glForm);
      if (err) { status.textContent = err; return; }
      var ev = byId($('#glEvent').value) || first;
      var text = 'Hi ProjectX, guest list request.\nName: ' + $('#glName').value.trim() +
        '\nNight: ' + code(ev) + ' ' + ev.title + ' (' + dayLabel(ev.start, true) + ')' +
        '\nGuests: ' + $('#glCount').value +
        '\nWhatsApp: ' + $('#glPhone').value.trim();
      var link = waLink(text);
      if (!link) {
        status.textContent = 'Guest list requests open soon. Check back in a few days.';
        return;
      }
      var win = window.open(link, '_blank');
      if (win) {
        win.opener = null;
        status.textContent = 'WhatsApp is open. Send the message there to request your spot.';
      } else {
        status.innerHTML = '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open WhatsApp to send your request</a>';
      }
    });

    var concierge = $('#conciergeLink');
    var link = waLink('Hi ProjectX, I want to book a table.');
    if (link) { concierge.href = link; concierge.hidden = false; }
  }

  // Tiers with the id 'table' are listed in the Tables panel, one row per night.
  function renderTablePrices() {
    var list = $('#tablePrices');
    var rows = upcoming().map(function (ev) {
      var t = ev.tiers.filter(function (x) { return x.id === 'table'; })[0];
      if (!t) return '';
      var price = t.soldOut || !saleOpen(ev) ? 'Sold out' : money(t.price);
      return '<li><span>' + esc(code(ev) + ' · ' + dayLabel(ev.start)) + '</span><span>' + esc(price) + '</span></li>';
    }).join('');
    list.innerHTML = rows;
    list.hidden = !rows;
  }

  function flashTier(tierId) {
    var ev = byId(state.eventId);
    var has = ev.tiers.some(function (t) { return t.id === tierId && !t.soldOut; });
    if (!has) {
      var alt = upcoming().filter(function (x) {
        return saleOpen(x) && !x.ticketUrl && x.tiers.some(function (t) { return t.id === tierId && !t.soldOut; });
      })[0];
      if (alt) setEvent(alt.id);
    }
    var row = $('[data-tier-row="' + tierId + '"]');
    if (!row) return;
    row.classList.remove('is-flash');
    void row.offsetWidth;
    row.classList.add('is-flash');
  }

  /* ---------- FAQ + contacts ---------- */
  function renderFaq() {
    $('#faqList').innerHTML = (CFG.faq || []).map(function (f, i) {
      return '<details class="qa"' + (i === 0 ? ' open' : '') + '><summary><span>' + esc(f.q) + '</span><i aria-hidden="true"></i></summary>' +
        '<div class="qa-body"><p>' + esc(f.a) + '</p></div></details>';
    }).join('');
  }
  function renderContacts() {
    var c = CFG.contact || {};
    var items = [];
    var handle = function (s) { return String(s || '').replace(/^@/, '').trim(); };
    if (c.instagram) items.push('<li><a href="https://www.instagram.com/' + encodeURIComponent(handle(c.instagram)) + '/" target="_blank" rel="noopener">Instagram @' + esc(handle(c.instagram)) + '</a></li>');
    if (c.tiktok) items.push('<li><a href="https://www.tiktok.com/@' + encodeURIComponent(handle(c.tiktok)) + '" target="_blank" rel="noopener">TikTok @' + esc(handle(c.tiktok)) + '</a></li>');
    if (waNumber()) items.push('<li><a href="https://wa.me/' + waNumber() + '" target="_blank" rel="noopener">WhatsApp +' + esc(waNumber()) + '</a></li>');
    if (c.email) items.push('<li><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></li>');
    $('#contactList').innerHTML = items.length ? items.join('') : '<li class="dim">Contact details coming soon</li>';
    $('#year').textContent = String(new Date().getFullYear());
  }

  /* ---------- Sound ---------- */
  function initSound() {
    var navBtn = $('#soundToggle');
    var heroBtn = $('#playToggle');
    if (!snd) { navBtn.hidden = true; heroBtn.hidden = true; return; }
    function sync(on) {
      navBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $('.sound-text', navBtn).textContent = on ? 'Sound on' : 'Sound off';
      heroBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      $('.play-text', heroBtn).textContent = on ? 'Pause the vibe' : 'Play the vibe';
      if (stage) stage.setAudioActive(on);
    }
    function toggle() {
      if (snd.isPlaying()) snd.stop();
      else if (!snd.start(state.vibe)) toast('This browser can’t play the beat.');
    }
    navBtn.addEventListener('click', toggle);
    heroBtn.addEventListener('click', toggle);
    snd.onState(sync);
    snd.onBeat(function (type, s) { if (stage) stage.beat(type, s); });
    $$('[data-bpm]').forEach(function (el) { el.textContent = snd.bpm(el.getAttribute('data-bpm')) + ' BPM'; });
  }

  /* ---------- Hero stage + level meter ---------- */
  function initStage() {
    var hero = $('#top');
    var canvas = $('#stage');
    if (window.PXStage && canvas) {
      stage = window.PXStage.init(canvas, {
        reduceMotion: reduce,
        background: getComputedStyle(root).getPropertyValue('--void').trim(),
        a1: VIBES[state.vibe].a1,
        a2: VIBES[state.vibe].a2
      });
    }
    if (!stage) return;
    var meter = initMeter();
    stage.onFrame(function (p) {
      hero.style.setProperty('--beat', p.toFixed(3));
      if (meter) meter(p);
    });
    if (meter) meter(0);
    hero.addEventListener('pointerdown', function (e) {
      if (e.target.closest('a, button, input, label, select, textarea, fieldset')) return;
      stage.burst(e.clientX, e.clientY);
      if (snd && snd.isPlaying()) snd.hit();
    });
    if (finePointer) hero.addEventListener('pointermove', function (e) { stage.aim(e.clientX); }, { passive: true });
  }

  function initMeter() {
    var cv = $('#spectrum');
    if (!cv) return null;
    var cx = cv.getContext('2d');
    if (!cx) return null;
    var data = new Uint8Array(512);
    var bars = 24;
    function size() {
      var r = cv.getBoundingClientRect();
      var d = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * d));
      cv.height = Math.max(1, Math.round(r.height * d));
    }
    size();
    window.addEventListener('resize', size);
    return function draw(pulse) {
      var W = cv.width, H = cv.height;
      cx.clearRect(0, 0, W, H);
      var live = snd && snd.spectrum(data);
      var g = cx.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, VIBES[state.vibe].a1);
      g.addColorStop(1, VIBES[state.vibe].a2);
      cx.fillStyle = g;
      var bw = W / bars;
      var now = performance.now();
      for (var i = 0; i < bars; i++) {
        var v;
        if (live) v = data[1 + Math.floor(Math.pow(i / bars, 1.6) * 180)] / 255;
        else v = 0.14 + 0.06 * Math.sin(now / 320 + i * 0.7) + pulse * 0.4 * (1 - i / bars);
        var bh = Math.max(2, Math.min(1, v) * H);
        cx.fillRect(i * bw + 1, H - bh, Math.max(1, bw - 2), bh);
      }
    };
  }

  /* ---------- Small interactions ---------- */
  var toastTimer = 0;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4200);
  }

  function initNav() {
    var nav = $('#nav');
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        nav.classList.toggle('is-solid', window.scrollY > 24);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var btn = $('#menuToggle');
    var menu = $('#mobileMenu');
    function setMenu(open) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.hidden = !open;
      root.classList.toggle('menu-open', open);
      if (open) { var a = $('a', menu); if (a) a.focus(); }
    }
    btn.addEventListener('click', function () { setMenu(btn.getAttribute('aria-expanded') !== 'true'); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); btn.focus(); }
    });
    window.addEventListener('resize', function () { if (window.innerWidth >= 900 && !menu.hidden) setMenu(false); });
  }

  function initTilt() {
    if (!finePointer || reduce) return;
    var list = $('#eventList');
    list.addEventListener('pointermove', function (e) {
      var card = e.target.closest('.ticket');
      if (!card) return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--rx', ((0.5 - y) * 5).toFixed(2) + 'deg');
      card.style.setProperty('--ry', ((x - 0.5) * 7).toFixed(2) + 'deg');
      card.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
    });
    list.addEventListener('pointerout', function (e) {
      var card = e.target.closest('.ticket');
      if (card && !card.contains(e.relatedTarget)) {
        ['--rx', '--ry'].forEach(function (p) { card.style.removeProperty(p); });
      }
    });
  }

  function fillTapes() {
    $$('.tape-track').forEach(function (track) {
      var unit = track.firstElementChild;
      var need = track.parentElement.offsetWidth * 2.2;
      var guard = 0;
      while (track.scrollWidth < need && guard < 12) {
        track.appendChild(unit.cloneNode(true));
        track.appendChild(unit.cloneNode(true));
        guard += 1;
      }
    });
  }

  /* ---------- Wire up ---------- */
  doc.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]');
    if (pick) setEvent(pick.getAttribute('data-pick'));
    var tier = e.target.closest('[data-pick-tier]');
    if (tier) flashTier(tier.getAttribute('data-pick-tier'));
    var step = e.target.closest('[data-step]');
    if (step && !step.disabled) changeQty(step.getAttribute('data-tier'), Number(step.getAttribute('data-step')));
    var dec = e.target.closest('.decrypt');
    if (dec && !dec.disabled) {
      var act = dec.closest('.act');
      dec.disabled = true;
      act.classList.add('is-decrypting');
      if (snd && snd.isPlaying()) snd.hit();
      scramble($('.secret-name', act), 'Access denied', reduce ? 0 : 1100, function () {
        act.classList.remove('is-decrypting');
        act.classList.add('is-denied');
        $('.act-note', act).hidden = false;
        dec.textContent = 'Locked';
      });
    }
  });
  doc.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'vibe') setVibe(t.value);
    else if (t.name === 'lineupEvent' || t.name === 'ticketEvent') setEvent(t.value);
  });

  readVibeColours();
  initStage();
  initSound();
  setVibe(state.vibe);
  renderNext();
  setInterval(tick, 1000);
  renderEvents();
  renderSwitches();
  renderLineup();
  renderTiers();
  initGuestList();
  renderTablePrices();
  renderFaq();
  renderContacts();
  initNav();
  initTilt();
  fillTapes();

  if (/[?&]cancelled=1/.test(window.location.search)) {
    toast('Payment cancelled. Your order is still here.');
    try { window.history.replaceState(null, '', window.location.pathname + window.location.hash); } catch (e) { /* ignore */ }
  }
})();
