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
  var night = window.LightsOnNight({ counter: $('#badges'), list: $('#nl-list'), toast: toast });
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

  var last = { clock: '' }, lastY = window.scrollY;
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
    // Only real scrolling restarts the tick. Recalculating the layout must not touch the time.
    if (Math.abs(y - lastY) > 1) { idle = 0; lastY = y; }
  }
  function toSec(s) { var p = s.split(':'); return +p[0] * 3600 + +p[1] * 60; }
  var clockBase = toSec('03:07'), idle = 0;
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  /* One clock for the page. Scrolling moves the night along; sitting still lets it tick. */
  function storyNow() { return clockBase + idle; }
  function updateClock() {
    var c = Math.floor(storyNow()) % 86400;
    var txt = pad(Math.floor(c / 3600)) + ':' + pad(Math.floor(c / 60) % 60) + ':' + pad(c % 60);
    if (txt !== last.clock) { $('#clock').textContent = txt; last.clock = txt; }
  }

  /* The header is a story. This line is the truth. */
  function realTime() {
    var box = $('#realtime');
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date());
      var hour = parseInt(parts, 10);
      var t = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()).toLowerCase();
      box.textContent = hour < 6 ? 'It really is ' + t + ' in Mumbai right now. I really am asleep. Click gently.'
        : hour < 9 ? 'Real Mumbai time: ' + t + '. I just got up, and nobody called.'
        : hour < 19 ? 'Real Mumbai time: ' + t + '. I’m at work, so this is a replay of last night.'
        : 'Real Mumbai time: ' + t + '. Tonight’s shift starts soon, so here’s last night’s.';
      box.hidden = false;
    } catch (e) { box.hidden = true; }
  }
  realTime();

  /* ---------- Missions: one clear next thing to do ---------- */
  var MISSIONS = [
    { text: 'Mission 1: one floor in the city is blinking. Click it.', next: null },
    { text: 'I slept through that. Mission 2: let the monsoon hit.', next: 'node' },
    { text: 'Still asleep. One failure won’t do it. Mission 3: crash the database, and keep crashing it.', next: 'db' },
    { text: 'You woke me up. That’s the record to beat.', next: null }
  ];
  var mission = -1;
  function setMission(n) {
    if (n <= mission) return;
    mission = n;
    $('#mission').textContent = MISSIONS[n].text;
    $$('.fault').forEach(function (b) { b.classList.toggle('next', b.dataset.fault === MISSIONS[n].next); });
    if (n === 0) {
      var pick = sim.pods.filter(function (p) { return p.state === 'run' && p.node === 2; })[0] || sim.pods[0];
      city.hint = pick ? { node: pick.node, slot: pick.slot } : null;
    } else city.hint = null;
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
      var tries = 0;
      (function arrive() {
        var settled = Math.abs($('#break').getBoundingClientRect().top) < 8;
        if (settled || ++tries > 40) sim.trigger(b.dataset.fault);
        else setTimeout(arrive, 50);
      })();
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
    var stir = Math.min(1, sim.errHot / 6);
    $('#sleep-bar').style.width = (stir * 100) + '%';
    if (!sim.paged) {
      $('#pager-text').textContent = stir > 0.55 ? 'Phone is buzzing…' : stir > 0.15 ? 'Sudhin is tossing…' : 'Sudhin is asleep';
      $('#pager').classList.toggle('stirring', stir > 0.15);
    }
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
  var firstFaultAt = null;
  sim.on('fault', function (id) {
    sound.click();
    var st = night.stats;
    st.failures++;
    if (firstFaultAt === null) firstFaultAt = performance.now();
    if (id === 'kill') { st.kills++; night.unlock('kill'); setMission(1); }
    if (id === 'node') { night.unlock('monsoon'); setMission(2); }
    if (id === 'db' && mission < 2) setMission(2);
  });
  sim.on('page', function () {
    sound.pager();
    var st = night.stats;
    st.wakes++;
    if (firstFaultAt !== null) {
      var took = (performance.now() - firstFaultAt) / 1000;
      st.fastest = st.fastest === null ? took : Math.min(st.fastest, took);
    }
    night.unlock('wake');
    setMission(3);
  });
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
    // Pull in on the one window that matters, then let him speak.
    var f = city.flat(), cv = $('#world');
    root.classList.add('waking');
    if (!reduced) {
      cv.style.transformOrigin = (f.x + f.w / 2) + 'px ' + (f.y + f.h / 2) + 'px';
      cv.style.transform = 'scale(' + (window.innerWidth < 900 ? 3 : 3.6) + ')';
    }
    setTimeout(function () {
      woken.hidden = false;
      $('#woken-reset').focus({ preventScroll: true });
    }, reduced ? 0 : 1500);
  });

  function closeWake() {
    $('#woken').hidden = true;
    root.classList.remove('waking');
    $('#world').style.transform = '';
    $('#pager').classList.remove('awake');
    $('#pager-text').textContent = 'Sudhin is asleep';
    var kept = sim.survived;
    sim.reset(); sim.survived = kept;
    firstFaultAt = null;
    logEl.textContent = '';
  }
  $('#woken-play').addEventListener('click', function () {
    closeWake();
    $('#oncall').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  });
  $('#woken-reset').addEventListener('click', function () {
    closeWake();
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
        e.preventDefault();
        var POKES = ['mmph. five more minutes', 'still asleep', 'who keeps doing this', 'there are other portfolios', 'okay, hire me and i’ll get up', 'i have your click logged (i don’t)', 'this is not an incident', 'fine. i’m awake. happy?'];
        var st = night.stats;
        city.pokeText = POKES[Math.min(st.pokes, POKES.length - 1)];
        st.pokes++;
        city.poke = 2.6;
        sound.tick();
        sim.log('sudhin: ' + city.pokeText, 'out');
        if (st.pokes >= 5) night.unlock('poke');
        return;
      }
      var h = city.hit(e.clientX, e.clientY);
      if (h && sim.killPod(h.node, h.slot)) e.preventDefault();
    });
  });

  /* Small rewards for looking at the scenery. */
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.target.closest('a,button,input,dialog,p,h1,h2,h3,li,pre,dl,.oc-body,.faults,aside')) return;
    if (city.hitStar(e.clientX, e.clientY)) {
      night.unlock('wish');
      toast('Shooting star', 'Wish granted if the wish was “no alerts tonight”.');
      city.shoot = null;
    } else if (city.hitTrain(e.clientX, e.clientY)) {
      night.unlock('train');
      toast('Western Line', 'Running 3 minutes late. Not my incident.');
    }
  });

  /* ---------- Shell ---------- */
  $('#cli').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('#cli-in');
    if (input.value.trim()) { night.stats.commands++; night.unlock('shell'); }
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
    var real = Math.min(1, (now - prev) / 1000);
    var dt = Math.min(0.2, real);
    prev = now;
    idle += real;

    if (city.power < 1) { if (!bootAt) bootAt = now; city.power = Math.min(1, (now - bootAt) / 2200); }
    // Slow machine or not, a four-second outage lasts four seconds.
    sim.clock = storyNow();
    for (var left = real; left > 0; left -= 0.1) sim.step(Math.min(left, 0.1));
    sound.setRain(sim.rain > 0);
    updateClock();
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
    if (name !== 'clean') night.unlock('gate');
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
  window.LightsOnGame($('#oc'), { sim: sim, audio: sound, onChange: function () { if (keys.length) layout(); }, onFinish: function (right, total, down) {
    var prevBest = night.stats.game;
    if (!prevBest || right > prevBest.right) night.stats.game = { right: right, total: total, down: down };
    night.unlock('pager');
  } });
  var refreshFlows = window.LightsOnFlows(reduced);

  /* ---------- The night carries on while you read ---------- */
  var TOASTS = [
    ['.entry:nth-of-type(3)', function () {
      var k = night.stats.kills;
      return k ? ['Incident review', k + ' container' + (k === 1 ? '' : 's') + ' killed tonight, all replaced. Whoever did that: nice work.'] : ['andheri disk at 91%', 'Log rotation ran. Back to 62%. Nobody paged.'];
    }],
    ['#pipeline .rail', function () { return ['Build #212 failed', 'Stopped before deploy. The team can read it at 10 a.m.']; }],
    ['.kit', function () { return ['SSL certificate renewed', '30 days early. Nginx reloaded. Zero connections dropped.']; }],
    ['.path', function () { return ['First locals leave Churchgate', 'Morning traffic is coming. The autoscaler’s ahead of it.']; }]
  ];
  var toastBox = $('#toasts');
  function toast(title, body, kind) {
    while (toastBox.children.length > 1) toastBox.removeChild(toastBox.firstChild);
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
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
        if (es[0].isIntersecting) {
          var c = d[1](), m = Math.floor(storyNow() / 60) % 60;
          toast(pad(Math.floor(storyNow() / 3600)) + ':' + pad(m) + ' · ' + c[0], c[1]);
          o.disconnect();
        }
      }, { threshold: 0.2 });
      o.observe(target);
    });
  }

  /* ---------- Toolkit: each tool answers for itself ---------- */
  var KIT = [
    [ // Use every week
      ['Docker & Compose', 'Multi-stage builds, volumes and networks on all my production projects.', 'How do you keep secrets out of an image?'],
      ['Jenkins', 'Declarative pipelines on GCP agents, with scanning, health checks and rollback.', 'What should make a pipeline stop?'],
      ['Nginx', 'Reverse proxy, SSL, rate limits and upload limits tuned for huge PDFs.', 'What did you change for large file uploads?'],
      ['Linux', 'Ubuntu and CentOS, plus locked-down RHEL servers at a client.', 'What changes when you can only reach a server through a proxy?'],
      ['Bash', 'Deployment automation, and the load-test script behind my auto-scaling project.', 'What’s worth scripting, and what isn’t?'],
      ['Git & GitHub', 'Branching, pull requests, and webhooks that start pipelines.', 'How does a merge turn into a deploy?'],
      ['Certbot', 'Let’s Encrypt certificates that renew themselves on production Nginx.', 'What’s the most common way auto-renewal breaks?']
    ],
    [ // Have run in production
      ['AWS', 'EC2, S3, IAM, CloudWatch, SES and SNS, running real client platforms.', 'How did CloudWatch help on the resume parser?'],
      ['GCP', 'Compute Engine and Cloud Run for the OCR platform, plus Jenkins agents.', 'Why run a Jenkins agent on a separate VM?'],
      ['Prometheus + Grafana', 'Full stack on EC2 with Alertmanager, Node Exporter and cAdvisor.', 'What makes an alert worth waking someone?'],
      ['Trivy + SonarQube', 'Security and quality gates inside the pipeline.', 'What happens when a scan finds something critical?'],
      ['PostgreSQL', 'Dockerised, on persistent volumes, with migrations in the deploy flow.', 'How do you run a schema migration safely?'],
      ['MongoDB + MySQL', 'Deployed and kept running, including volume management.', 'What can go wrong with databases in containers?'],
      ['Cloudflare Tunnel', 'Let Prometheus scrape Jenkins without opening a port.', 'Why a tunnel instead of a firewall rule?']
    ],
    [ // Actively levelling up
      ['Kubernetes', 'Project Nimbus, my Kind lab: Deployments, Services, self-healing and probes.', 'What happened when you deleted a pod on purpose?'],
      ['Terraform', 'Load-balanced EC2 and auto-scaling groups, written as code.', 'What did your first Terraform mistake teach you?'],
      ['Helm', 'Packaged my own portfolio for a Kind cluster.', 'When is Helm worth it over plain manifests?'],
      ['Azure', 'Entra ID, service principals and the Azure DevOps APIs.', 'How does a service principal differ from a user?'],
      ['AWS SAA-C03', 'Preparing now. I already hold AWS Certified AI Practitioner.', 'Which exam topic has been most useful at work?']
    ]
  ];
  $$('.kit-row').forEach(function (row, idx) {
    var p = $('p', row), tools = KIT[idx];
    if (!p || !tools) return;
    var wrap = document.createElement('div'); wrap.className = 'chips';
    var detail = document.createElement('div'); detail.className = 'chip-detail'; detail.hidden = true; detail.setAttribute('aria-live', 'polite');
    tools.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tool'; b.textContent = t[0]; b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var open = b.classList.contains('on');
        $$('.tool', wrap).forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-expanded', 'false'); });
        if (open) { detail.hidden = true; if (keys.length) layout(); return; }
        b.classList.add('on'); b.setAttribute('aria-expanded', 'true');
        detail.textContent = '';
        var a = document.createElement('p'); a.textContent = t[1];
        var q = document.createElement('p'); q.className = 'ask'; q.textContent = 'Ask me: “' + t[2] + '”';
        detail.appendChild(a); detail.appendChild(q);
        detail.hidden = false;
        if (keys.length) layout();
      });
      wrap.appendChild(b);
    });
    var col = document.createElement('div');
    col.appendChild(wrap); col.appendChild(detail);
    p.replaceWith(col);
  });
  $('#kit-sub').hidden = false;

  /* ---------- Night log, missions, sunrise ---------- */
  var nl = $('#nightlog');
  $('#badges').addEventListener('click', function () { night.renderList(); nl.showModal(); });
  $('#nl-close').addEventListener('click', function () { nl.close(); });
  nl.addEventListener('click', function (e) { if (e.target === nl) nl.close(); });

  if ('IntersectionObserver' in window) {
    var missionIO = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) { setMission(0); missionIO.disconnect(); }
    }, { threshold: 0.5 });
    missionIO.observe($('#break'));
    var dawnIO = new IntersectionObserver(function (es) {
      if (es[0].isIntersecting) {
        night.unlock('dawn');
        night.handover($('#handover'));
        layout();
      }
    }, { threshold: 0.35 });
    dawnIO.observe($('#morning'));
  } else setMission(0);

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
