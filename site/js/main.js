/* Wires the simulation and the city to the page: scroll, panels, pipeline, résumé. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var root = document.documentElement;
  root.classList.add('js');

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sim = new window.LightsOnSim();
  var FAULTS = window.LightsOnFaults;
  var city = new window.LightsOnCity($('#world'), sim, { reduced: reduced });
  var sound = new window.LightsOnSound();
  if (reduced) city.power = 1;

  /* ---------- Camera: each section declares a stage; the camera eases between them. ---------- */
  var sections = $$('main > section');
  var keys = [];

  function layout() {
    city.resize();
    var unit = window.LightsOnCity.TOWER_UNIT, vh = window.innerHeight, vw = window.innerWidth;
    var sy = window.scrollY;
    keys = sections.map(function (sec) {
      var r = sec.getBoundingClientRect(), top = r.top + sy;
      var stage = $('[data-stage]', sec);
      var k = { y: top, h: r.height, t: parseFloat(sec.dataset.sky), time: sec.dataset.time, day: sec.id === 'morning' };
      if (stage) {
        var s = stage.getBoundingClientRect();
        var fitW = stage.dataset.stage === 'wide' ? 1.32 : 0.98; // hero and morning may bleed past the stage
        var scale = Math.min(s.width * fitW / unit.width, s.height * 0.96 / unit.height, vw < 760 ? 0.82 : 1.7);
        k.cam = { cx: s.left + s.width / 2, horizon: s.bottom - r.top, scale: Math.max(0.42, scale) };
      } else {
        k.cam = { cx: vw / 2, horizon: vh * 1.42, scale: 0.9 };
      }
      return k;
    });
    onScroll();
  }

  var last = { clock: '' };
  function ease(x) { return x * x * (3 - 2 * x); }

  function onScroll() {
    if (!keys.length) return;
    var y = window.scrollY, i = 0;
    while (i < keys.length - 2 && y >= keys[i + 1].y) i++;
    var a = keys[i], b = keys[i + 1];

    // The camera holds through a tall section, then moves in the last viewport before the next.
    var vh = window.innerHeight;
    var start = Math.max(a.y, b.y - vh);
    var f = ease(clamp((y - start) / Math.max(1, b.y - start), 0, 1));
    city.cam.cx = a.cam.cx + (b.cam.cx - a.cam.cx) * f;
    city.cam.horizon = a.cam.horizon + (b.cam.horizon - a.cam.horizon) * f;
    city.cam.scale = a.cam.scale + (b.cam.scale - a.cam.scale) * f;
    if (b.day) {
      city.cam.cx = b.cam.cx; city.cam.scale = b.cam.scale;
      city.cam.horizon = Math.min(a.cam.horizon, b.cam.horizon + (b.y - y));
    }
    // Sky always creeps forward with reading progress; dawn itself arrives with the last section.
    var g = clamp((y - a.y) / Math.max(1, b.y - a.y), 0, 1);
    city.t = a.t + (b.t - a.t) * (b.day ? ease(clamp((y - start) / Math.max(1, b.y - start), 0, 1)) : g);
    root.classList.toggle('is-day', city.t > 0.68);

    // Clock follows the sky.
    var tA = toSec(a.time), tB = toSec(b.time);
    clockBase = tA + (tB - tA) * g;
  }
  function toSec(s) { var p = s.split(':'); return +p[0] * 3600 + +p[1] * 60; }
  var clockBase = toSec('03:07');

  function updateClock(now) {
    var c = Math.floor(clockBase + (reduced ? 0 : (now / 1000) % 60));
    var h = Math.floor(c / 3600), m = Math.floor(c / 60) % 60, s = c % 60;
    var txt = '0' + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    if (txt !== last.clock) { $('#clock').textContent = txt; last.clock = txt; }
  }

  /* ---------- Fault buttons ---------- */
  var faultsEl = $('#faults');
  Object.keys(FAULTS).forEach(function (id) {
    var f = FAULTS[id], b = document.createElement('button');
    b.type = 'button'; b.className = 'fault'; b.dataset.fault = id;
    b.innerHTML = '<span class="fault-label"></span><span class="fault-hint"></span>';
    b.firstChild.textContent = f.label; b.lastChild.textContent = f.hint;
    b.addEventListener('click', function () { sim.trigger(id); });
    faultsEl.appendChild(b);
  });

  /* Project entries jump up to the sim and pull the trigger. */
  $$('.try').forEach(function (b) {
    b.addEventListener('click', function () {
      $('#break').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
      setTimeout(function () { sim.trigger(b.dataset.fault); }, reduced ? 0 : 750);
    });
  });

  /* ---------- Metrics panel ---------- */
  var METRICS = [
    { k: 'rps', label: 'Requests / s', fmt: function (v) { return Math.round(v).toLocaleString('en-US'); }, color: '#ffc572', min: 0 },
    { k: 'err', label: 'Errors', fmt: function (v) { return v.toFixed(v < 1 ? 2 : 1) + '%'; }, color: '#ff6a5e', min: 0, floor: 6 },
    { k: 'p95', label: 'p95 latency', fmt: function (v) { return Math.round(v) + ' ms'; }, color: '#8fd3ff', min: 0, floor: 120 },
    { k: 'pods', label: 'Containers', fmt: function (v) { return String(Math.round(v)); }, color: '#9be3a8', min: 0, floor: 20 }
  ];
  var metricsEl = $('#metrics');
  METRICS.forEach(function (m) {
    var d = document.createElement('div');
    d.className = 'metric';
    d.innerHTML = '<span class="metric-label"></span><b class="metric-value">–</b><canvas width="240" height="56" aria-hidden="true"></canvas>';
    d.firstChild.textContent = m.label;
    metricsEl.appendChild(d);
    m.val = $('b', d); m.cv = $('canvas', d); m.ctx = m.cv.getContext('2d'); m.el = d;
  });

  function renderMetrics() {
    METRICS.forEach(function (m) {
      var data = sim.history[m.k]; if (!data.length) return;
      var v = data[data.length - 1];
      m.val.textContent = m.fmt(v);
      if (m.k === 'err') m.el.classList.toggle('hot', v >= 1);
      var c = m.ctx, W = m.cv.width, H = m.cv.height;
      c.clearRect(0, 0, W, H);
      var max = Math.max.apply(null, data.concat([m.floor || 1])) * 1.15;
      c.beginPath();
      for (var i = 0; i < data.length; i++) {
        var x = W - (data.length - 1 - i) * (W / 89), y = H - 3 - (data[i] / max) * (H - 8);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = m.color; c.lineWidth = 2; c.stroke();
      c.lineTo(W, H); c.lineTo(W - (data.length - 1) * (W / 89), H); c.closePath();
      c.globalAlpha = 0.14; c.fillStyle = m.color; c.fill(); c.globalAlpha = 1;
    });
    $('#budget').textContent = sim.budget.toFixed(1) + '%';
    $('#budget-bar').style.width = sim.budget + '%';
    var q = $('#queue');
    if (sim.queue > 0) {
      q.hidden = false;
      $('#queue-n').textContent = Math.ceil(sim.queue).toLocaleString('en-US');
      $('#queue-bar').style.width = (sim.queue / sim.queueMax * 100) + '%';
    } else if (!q.hidden) q.hidden = true;

    // Busy state on the buttons that can't stack.
    $$('.fault', faultsEl).forEach(function (b) {
      var id = b.dataset.fault;
      var busy = (id === 'spike' && sim.spike > 0) || (id === 'flood' && sim.queue > 0) ||
        (id === 'deploy' && sim.effects.deployBusy) || (id === 'node' && sim.effects.nodeBusy);
      b.classList.toggle('busy', !!busy);
      b.setAttribute('aria-disabled', busy ? 'true' : 'false');
    });
  }

  /* ---------- Log ---------- */
  var logEl = $('#log-lines');
  sim.on('log', function (e) {
    var li = document.createElement('li');
    li.className = e.kind;
    var t = document.createElement('time'); t.textContent = e.t;
    var s = document.createElement('span'); s.textContent = e.msg;
    li.appendChild(t); li.appendChild(s);
    logEl.appendChild(li);
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  });
  sim.on('clear', function () { logEl.textContent = ''; });
  sim.on('metrics', renderMetrics);
  sim.on('lightning', function () { if (!reduced) city.flash = 1; sound.thunder(); });
  sim.on('fault', function () { sound.click(); });
  sim.on('page', function () { sound.pager(); });
  sim.on('survived', function (n) { $('#survived').textContent = n; });

  /* ---------- Explanations ---------- */
  sim.on('fault', function (id) {
    var f = FAULTS[id], box = $('#explain');
    box.textContent = '';
    [['explain-title', f.title], ['explain-body', f.body], ['explain-where', f.where]].forEach(function (p) {
      var el = document.createElement('p'); el.className = p[0]; el.textContent = p[1]; box.appendChild(el);
    });
    box.classList.remove('pop'); void box.offsetWidth; box.classList.add('pop');
    if (window.innerWidth < 900) layout();
  });

  /* ---------- The page ---------- */
  sim.on('page', function (info) {
    var woken = $('#woken'), n = info.failures;
    $('#pager').classList.add('awake');
    $('#pager-text').textContent = 'Sudhin is awake';
    $('#woken-time').textContent = info.stamp.slice(0, 5) + ' · PAGE SENT';
    $('#woken-body').textContent =
      'It took ' + n + ' failure' + (n === 1 ? '' : 's') + ' in 30 seconds to keep errors above 5%. ' +
      'One failure is the system’s problem. This many is mine, and getting the right person out of bed within seconds is exactly what the alerting is for.';
    woken.hidden = false;
    $('#woken-reset').focus({ preventScroll: true });
  });
  $('#woken-reset').addEventListener('click', function () {
    $('#woken').hidden = true;
    $('#pager').classList.remove('awake');
    $('#pager-text').textContent = 'Sudhin is asleep';
    var kept = sim.survived;
    sim.reset(); sim.survived = kept;
    logEl.textContent = '';
    sim.log('incident closed. Going back to sleep', 'ok');
    $('#explain').innerHTML = '<p class="explain-title">Round two?</p><p class="explain-body">The system’s back to normal. So am I.</p>';
  });

  /* ---------- Direct manipulation: click a lit floor to kill it. ---------- */
  [$('#sim-stage'), $('#hero-stage')].forEach(function (stageEl) {
    stageEl.addEventListener('pointermove', function (e) {
      if (e.target !== stageEl) { city.hover = null; stageEl.style.cursor = ''; return; }
      var overFlat = city.hitFlat(e.clientX, e.clientY);
      var h = overFlat ? null : city.hit(e.clientX, e.clientY);
      var live = h && sim.pods.some(function (p) { return p.node === h.node && p.slot === h.slot && p.state === 'run'; });
      city.hover = live ? h : null;
      stageEl.style.cursor = overFlat ? 'pointer' : live ? 'crosshair' : '';
    });
    stageEl.addEventListener('pointerleave', function () { city.hover = null; });
    stageEl.addEventListener('click', function (e) {
      if (e.target !== stageEl) return;
      if (city.hitFlat(e.clientX, e.clientY)) {
        city.poke = 2.6;
        sound.tick();
        sim.log('sudhin: mmph. five more minutes', 'out');
        return;
      }
      var h = city.hit(e.clientX, e.clientY);
      if (h) sim.killPod(h.node, h.slot);
    });
  });

  /* ---------- Shell ---------- */
  $('#cli').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#cli-in');
    sim.exec(input.value);
    input.value = '';
  });

  /* ---------- Main loop ---------- */
  var prev = performance.now(), frames = 0, cost = 0;
  var hidden = false, bootAt = 0;
  document.addEventListener('visibilitychange', function () { hidden = document.hidden; prev = performance.now(); });

  function frame(now) {
    requestAnimationFrame(frame);
    if (hidden) return;
    // Slower tiers also draw less often, which leaves the main thread free for scrolling and clicks.
    var gap = reduced && city.power === 1 ? 200 : city.quality === 1 ? 0 : city.quality === 0.5 ? 25 : 50;
    if (now - prev < gap) return;
    var dt = Math.min(0.2, (now - prev) / 1000);
    prev = now;

    if (city.power < 1) { if (!bootAt) bootAt = now; city.power = Math.min(1, (now - bootAt) / 2200); }
    sim.step(dt);
    sound.setRain(sim.rain > 0);
    updateClock(now);
    var t0 = performance.now();
    city.draw(dt);
    cost += performance.now() - t0;

    // Drop detail rather than responsiveness: judge by what a frame actually costs.
    frames++;
    if (frames >= 30 || cost > 300) {
      var avg = cost / frames;
      if (city.quality === 1 && avg > 11) { city.quality = 0.5; city.resize(); }
      else if (city.quality === 0.5 && avg > 16) city.quality = 0.25;
      frames = 0; cost = 0;
    }
  }

  /* ---------- Pipeline ---------- */
  var STAGES = [
    { id: 'push', name: 'Git push', tool: 'GitHub webhook' },
    { id: 'build', name: 'Build', tool: 'Jenkins + Docker' },
    { id: 'scan', name: 'Scan', tool: 'Trivy · SonarQube' },
    { id: 'deploy', name: 'Deploy', tool: 'Compose / Kubernetes' },
    { id: 'health', name: 'Health check', tool: 'curl /health' },
    { id: 'watch', name: 'Watch', tool: 'Prometheus + Grafana' }
  ];
  var RUNS = {
    clean: [
      ['push', 'ok', ['$ git push origin main', 'webhook delivered to Jenkins']],
      ['build', 'ok', ['[gcp-agent] building frontend image (multi-stage)', '[gcp-agent] building backend image', 'secrets injected at runtime, none baked in']],
      ['scan', 'ok', ['trivy image app:42 ... CRITICAL: 0  HIGH: 0', 'sonar quality gate: PASSED']],
      ['deploy', 'ok', ['pushed app:42 to registry', 'rolling out, old version still serving']],
      ['health', 'ok', ['GET /health 200 in 38 ms', 'new version takes traffic']],
      ['watch', 'ok', ['dashboards updated, alerts armed', 'Finished: SUCCESS. Nobody woke up.']]
    ],
    vuln: [
      ['push', 'ok', ['$ git push origin main', 'webhook delivered to Jenkins']],
      ['build', 'ok', ['[gcp-agent] building backend image (multi-stage)']],
      ['scan', 'fail', ['trivy image app:43 ... CRITICAL: 1', 'pipeline stopped at the security gate', 'Finished: FAILURE. It never left the build server.']]
    ],
    broken: [
      ['push', 'ok', ['$ git push origin main', 'webhook delivered to Jenkins']],
      ['build', 'ok', ['[gcp-agent] building images']],
      ['scan', 'ok', ['trivy image app:44 ... CRITICAL: 0', 'sonar quality gate: PASSED']],
      ['deploy', 'ok', ['pushed app:44 to registry', 'rolling out, old version still serving']],
      ['health', 'fail', ['GET /health 503', 'GET /health 503', 'GET /health 503', 'health check failed three times, rolling back to app:43', 'Finished: ROLLED BACK. Users saw nothing.']]
    ]
  };

  var rail = $('#rail'), pipeLog = $('#pipe-log code');
  STAGES.forEach(function (s) {
    var li = document.createElement('li');
    li.dataset.step = s.id;
    li.innerHTML = '<b></b><span></span>';
    li.firstChild.textContent = s.name; li.lastChild.textContent = s.tool;
    rail.appendChild(li);
  });

  var runToken = 0;
  function runPipeline(name) {
    var token = ++runToken, script = RUNS[name];
    $$('[data-run]').forEach(function (b) { b.classList.toggle('on', b.dataset.run === name); });
    $$('li', rail).forEach(function (li) { li.className = ''; });
    pipeLog.textContent = '';
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, reduced ? 0 : ms); }); };
    var write = function (line, kind) {
      var s = document.createElement('span');
      s.textContent = line + '\n';
      if (kind) s.className = kind;
      pipeLog.appendChild(s);
      pipeLog.parentNode.scrollTop = pipeLog.parentNode.scrollHeight;
    };
    (async function () {
      for (var i = 0; i < script.length; i++) {
        var step = script[i], li = $('[data-step="' + step[0] + '"]', rail);
        if (token !== runToken) return;
        li.className = 'running';
        for (var j = 0; j < step[2].length; j++) {
          await wait(380);
          if (token !== runToken) return;
          var line = step[2][j], last2 = j === step[2].length - 1;
          write(line, last2 && step[1] === 'fail' ? 'bad' : /^Finished: SUCCESS/.test(line) ? 'good' : '');
        }
        li.className = step[1];
      }
    })();
  }
  $$('[data-run]').forEach(function (b) { b.addEventListener('click', function () { runPipeline(b.dataset.run); }); });

  /* ---------- Sound, game, diagrams ---------- */
  var soundBtn = $('#sound');
  soundBtn.addEventListener('click', function () {
    var on = sound.toggle();
    soundBtn.textContent = on ? '♪ on' : '♪ off';
    soundBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  window.LightsOnGame($('#oc'), { sim: sim, audio: sound, onChange: function () { if (keys.length) layout(); } });
  var refreshFlows = window.LightsOnFlows(reduced);

  /* ---------- The night carries on while you read ---------- */
  var TOASTS = [
    ['.entry:nth-of-type(3)', '04:02 · andheri disk at 91%', 'Log rotation ran. Back to 62%. Nobody paged.'],
    ['#pipeline .rail', '04:31 · Build #212 failed', 'Stopped before deploy. The team can read it at 10 a.m.'],
    ['.kit', '05:16 · SSL certificate renewed', '30 days early. Nginx reloaded. Zero connections dropped.'],
    ['.path', '06:11 · First locals leave Churchgate', 'Morning traffic is coming. The autoscaler’s ahead of it.']
  ];
  var toastBox = $('#toasts');
  function toast(title, body) {
    var t = document.createElement('div');
    t.className = 'toast';
    var a = document.createElement('b'); a.textContent = title;
    var b = document.createElement('span'); b.textContent = body;
    t.appendChild(a); t.appendChild(b);
    toastBox.appendChild(t);
    sound.tick();
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 400); }, 5200);
  }
  if ('IntersectionObserver' in window) {
    TOASTS.forEach(function (d) {
      var target = $(d[0]);
      if (!target) return;
      var o = new IntersectionObserver(function (es) {
        if (es[0].isIntersecting) { toast(d[1], d[2]); o.disconnect(); }
      }, { threshold: 0.2 });
      o.observe(target);
    });
  }

  /* ---------- Reveal on scroll, and first pipeline run ---------- */
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    $$('.section-head, .entry, .more li, .kit-row, .path li').forEach(function (el) { el.classList.add('reveal'); io.observe(el); });
  }
  if ('IntersectionObserver' in window) {
    var once = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { runPipeline('clean'); once.disconnect(); }
    }, { threshold: 0.45 });
    once.observe(rail);
  }

  /* ---------- Résumé dialog, print, copy ---------- */
  var dlg = $('#quick');
  $$('[data-open-quick]').forEach(function (b) { b.addEventListener('click', function () { dlg.showModal(); }); });
  $('#q-close').addEventListener('click', function () { dlg.close(); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  $$('[data-print]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });

  $('#copy-email').addEventListener('click', function (e) {
    var b = e.currentTarget, old = b.textContent;
    var done = function (msg) { b.textContent = msg; setTimeout(function () { b.textContent = old; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText('sudhinswain@gmail.com').then(function () { done('Copied'); }, function () { done('sudhinswain@gmail.com'); });
    else done('sudhinswain@gmail.com');
  });

  /* ---------- Boot ---------- */
  var resizeT;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { refreshFlows(); layout(); }, 120); });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('load', layout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  layout();
  // Text first, city second: the words must never wait for the canvas.
  var start = function () { prev = performance.now(); requestAnimationFrame(frame); };
  if (document.readyState === 'complete') setTimeout(start, 60);
  else window.addEventListener('load', function () { setTimeout(start, 60); });

  window.LightsOn = { sim: sim, city: city };
  if (window.console) {
    console.log('%cStill reading at this hour? Good sign.', 'font:600 14px monospace;color:#ffc572');
    console.log('Try LightsOn.sim.trigger("db"), or just email sudhinswain@gmail.com');
  }
})();
