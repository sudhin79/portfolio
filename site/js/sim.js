/* The simulation. No drawing here: city.js renders this state, main.js wires it to the page.
   Everything is a small, deterministic-ish control loop, the same shape as the real thing:
   observe -> compare to desired state -> act. */
(function () {
  'use strict';

  var NODE_NAMES = ['worli', 'bandra', 'parel', 'andheri', 'powai', 'bkc', 'dadar', 'colaba'];
  var SLOTS_PER_NODE = 10;
  var RPS_PER_POD = 72;
  var BASE_RPS = 900;
  var BASE_REPLICAS = 20;
  var MAX_REPLICAS = 56;
  var PAGE_THRESHOLD = 5;   // % errors
  var PAGE_AFTER = 6;       // seconds sustained

  var FAULTS = {
    kill: {
      label: 'Kill a container',
      hint: 'One app instance dies',
      title: 'A container just died. Nobody had to do anything.',
      body: 'Health checks caught it, traffic moved to the others, and a replacement started in seconds.',
      where: 'Project Nimbus, my Kubernetes lab, where I delete pods on purpose to test this.'
    },
    spike: {
      label: 'Send a traffic spike',
      hint: '3× the normal load',
      title: 'Three times the traffic, and the city built more floors.',
      body: 'Nginx limits protected the app while new containers came up. When the rush passes, the extra capacity shuts down so you stop paying for it.',
      where: 'AWS auto-scaling with Terraform and CloudWatch alarms, plus Nginx rate limits on the Interview Portal.'
    },
    node: {
      label: 'Let the monsoon hit',
      hint: 'A whole server goes dark',
      title: 'A whole building lost power. Its work moved next door.',
      body: 'Running apps on several servers means losing one is an inconvenience. Its containers restart on the buildings still standing.',
      where: 'Load-balanced EC2 instances defined in Terraform, on my AWS projects.'
    },
    deploy: {
      label: 'Ship a broken release',
      hint: 'Bad code reaches a server',
      title: 'The bad release reached one container, then got sent back.',
      body: 'The blue floor failed its health check, so the rollout stopped and rolled back. The old version never stopped serving users.',
      where: 'Jenkins pipelines with post-deploy health checks and rollback.'
    },
    flood: {
      label: 'Upload 5,000 resumes',
      hint: 'A huge batch job arrives',
      title: 'Five thousand files, and the site didn’t slow down.',
      body: 'Work waits in a queue while a fixed number of workers process it. Failed files go to a dead-letter queue to retry instead of vanishing.',
      where: 'The bulk resume parser, which uses this exact pattern in production.'
    },
    db: {
      label: 'Crash the database',
      hint: 'The one that really hurts',
      title: 'This one hurt. Some requests failed, and no data was lost.',
      body: 'I’d rather be honest: for a few seconds, users would see errors. The database restarted on its persistent volume. If it hadn’t come back, this is the alert that wakes me.',
      where: 'PostgreSQL on persistent volumes in the Interview Portal.'
    },
    cert: {
      label: 'Let the SSL cert expire',
      hint: 'A classic 3 a.m. outage',
      title: 'It never expired. That’s the whole trick.',
      body: 'Certbot renews weeks in advance and Nginx reloads without dropping a connection. Most certificate outages are really a missing cron job.',
      where: 'Let’s Encrypt with Certbot on my production Nginx deployments.'
    }
  };

  function randId() {
    var c = '0123456789abcdef', s = '';
    for (var i = 0; i < 5; i++) s += c[Math.floor(Math.random() * 16)];
    return 'api-' + s;
  }

  function Sim() {
    this.listeners = {};
    this.reset();
  }

  Sim.prototype.on = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
  Sim.prototype.emit = function (ev, a) { (this.listeners[ev] || []).forEach(function (f) { f(a); }); };

  Sim.prototype.reset = function () {
    this.time = 0;
    this.clock = 3 * 3600 + 12 * 60;     // simulated wall clock, seconds
    this.nodes = NODE_NAMES.map(function (name, i) {
      return { id: i, name: name, active: i < 5, up: true, rise: i < 5 ? 1 : 0, flash: 0 };
    });
    this.pods = [];
    this.desired = BASE_REPLICAS;
    this.rps = BASE_RPS;
    this.err = 0.02;
    this.p95 = 42;
    this.budget = 100;
    this.errHot = 0;
    this.paged = false;
    this.survived = this.survived || 0;
    this.effects = {};        // active fault effects, name -> seconds remaining
    this.timers = [];
    this.recent = [];         // [time, faultId] for telling the visitor what it took
    this.pending = {};        // faults in progress, to count as survived once they end
    this.queue = 0; this.queueMax = 0; this.dlq = 0;
    this.spike = 0;
    this.rain = 0;
    this.cool = 0; this.tickHpa = 0;
    this.history = { rps: [], err: [], p95: [], pods: [] };
    this.histT = 0;
    this.version = 'v41';
    for (var i = 0; i < BASE_REPLICAS; i++) this.addPod(true);
  };

  Sim.prototype.after = function (sec, fn) { this.timers.push({ at: this.time + sec, fn: fn }); };

  Sim.prototype.stamp = function () {
    var c = Math.floor(this.clock), h = Math.floor(c / 3600), m = Math.floor(c / 60) % 60, s = c % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };

  Sim.prototype.log = function (msg, kind) { this.emit('log', { t: this.stamp(), msg: msg, kind: kind || '' }); };

  /* Scheduler: pick the live node with the fewest pods, raising a new building if all are full. */
  Sim.prototype.placement = function () {
    var self = this, best = null, bestN = 1e9;
    this.nodes.forEach(function (n) {
      if (!n.active || !n.up) return;
      var c = self.pods.filter(function (p) { return p.node === n.id; }).length;
      if (c < bestN) { best = n; bestN = c; }
    });
    if (best && bestN < 7) return best;
    var spare = this.nodes.filter(function (n) { return !n.active; })[0];
    if (spare) {
      spare.active = true; spare.up = true;
      this.log('autoscaler: added node ' + spare.name, 'ok');
      return spare;
    }
    return bestN < SLOTS_PER_NODE ? best : null;
  };

  Sim.prototype.addPod = function (instant, version) {
    var node = this.placement();
    if (!node) return null;
    var used = {}, self = this;
    this.pods.forEach(function (p) { if (p.node === node.id) used[p.slot] = 1; });
    var free = [];
    for (var s = 0; s < SLOTS_PER_NODE; s++) if (!used[s]) free.push(s);
    var pod = {
      id: randId(), node: node.id, slot: free[Math.floor(Math.random() * free.length)],
      state: instant ? 'run' : 'pend', ready: instant ? 0 : 1.6 + Math.random() * 1.2,
      ver: version || self.version, age: 0, doomed: false, killT: 0
    };
    this.pods.push(pod);
    return pod;
  };

  Sim.prototype.running = function () {
    return this.pods.filter(function (p) { return p.state === 'run'; }).length;
  };

  /* Controller loop: runs every frame. */
  Sim.prototype.step = function (dt) {
    var self = this;
    dt = Math.min(dt, 0.2);
    this.time += dt;
    this.clock += dt * 1.0;

    this.timers = this.timers.filter(function (t) {
      if (self.time >= t.at) { t.fn(); return false; }
      return true;
    });

    Object.keys(this.effects).forEach(function (k) {
      self.effects[k] -= dt;
      if (self.effects[k] <= 0) delete self.effects[k];
    });
    this.spike = Math.max(0, this.spike - dt);
    this.rain = Math.max(0, this.rain - dt);

    // Pods.
    this.pods.forEach(function (p) {
      p.age += dt;
      if (p.state === 'pend') {
        p.ready -= dt;
        if (p.ready <= 0) {
          if (p.doomed) { p.state = 'crash'; p.killT = 1.2; }
          else p.state = 'run';
        }
      } else if (p.state === 'crash') {
        p.killT -= dt;
      }
    });
    this.pods = this.pods.filter(function (p) { return p.state !== 'crash' || p.killT > 0; });

    // Replica reconciliation.
    var live = this.pods.filter(function (p) { return p.state !== 'crash' && !p.doomed; }).length;
    if (live < this.desired) {
      var need = Math.min(this.desired - live, 6);
      for (var i = 0; i < need; i++) this.addPod(false);
    } else if (live > this.desired) {
      var extra = this.pods.filter(function (p) { return p.state === 'run'; });
      var drop = extra[extra.length - 1];
      if (drop) this.pods.splice(this.pods.indexOf(drop), 1);
    }

    // Traffic and errors.
    var target = BASE_RPS * (this.spike > 0 ? 3.2 : 1) * (1 + 0.05 * Math.sin(this.time * 0.9) + 0.03 * Math.sin(this.time * 2.7));
    this.rps += (target - this.rps) * Math.min(1, dt * 2);
    var run = Math.max(1, this.running());
    var cap = run * RPS_PER_POD;
    var util = this.rps / cap;
    var overload = Math.max(0, util - 1);
    var errTarget = 0.02 + Math.min(3.5, overload * 5);
    if (this.effects.nodeLoss) errTarget += 3;
    if (this.effects.badRelease) errTarget += 1.5;
    if (this.effects.dbDown) errTarget += 9;
    this.err += (errTarget - this.err) * Math.min(1, dt * 2.4);
    var p95Target = 40 + 26 * util * util * util + (this.effects.dbDown ? 300 : 0) + (this.effects.nodeLoss ? 40 : 0);
    this.p95 += (Math.min(1400, p95Target) - this.p95) * Math.min(1, dt * 2);
    this.budget = Math.max(0, this.budget - this.err * dt * 0.06);
    this.util = util;

    // Horizontal autoscaler.
    this.tickHpa -= dt;
    if (this.tickHpa <= 0) {
      this.tickHpa = 1;
      if (util > 0.75 && this.desired < MAX_REPLICAS) {
        var want = Math.min(MAX_REPLICAS, Math.ceil(this.rps / (RPS_PER_POD * 0.62)));
        var next = Math.min(want, this.desired + 6);
        if (next > this.desired) {
          this.desired = next;
          this.cool = 6;
          this.log('autoscaler: load high, replicas -> ' + next);
        }
      } else if (util < 0.5 && this.desired > BASE_REPLICAS) {
        this.cool -= 1;
        if (this.cool <= 0) {
          this.desired = Math.max(BASE_REPLICAS, this.desired - 2);
          if (this.desired === BASE_REPLICAS) {
            this.log('autoscaler: back to ' + BASE_REPLICAS + ' replicas', 'ok');
            this.retireSpareNodes();
          }
        }
      }
    }

    // Tower construction.
    this.nodes.forEach(function (n) {
      n.rise += ((n.active ? 1 : 0) - n.rise) * Math.min(1, dt * 2.2);
      n.flash = Math.max(0, n.flash - dt);
    });

    // Queue workers: fixed concurrency, so the backlog drains at a flat rate.
    if (this.queue > 0) {
      var rate = 420;
      var before = this.queue;
      this.queue = Math.max(0, this.queue - rate * dt);
      if (before > 2600 && this.queue <= 2600 && !this.dlq) {
        this.dlq = 37;
        this.log('worker: 37 corrupt files moved to dead-letter queue', 'warn');
      }
      if (this.queue === 0) {
        this.log('queue drained. 4,963 parsed, 37 re-queued for retry', 'ok');
        this.finish('flood');
      }
    }

    // Alerting.
    if (this.err >= PAGE_THRESHOLD) this.errHot += dt; else this.errHot = Math.max(0, this.errHot - dt * 2);
    if (!this.paged && this.errHot >= PAGE_AFTER) this.page();

    // Metric history, 4 samples per second.
    this.histT += dt;
    if (this.histT >= 0.25) {
      this.histT = 0;
      var h = this.history, cap2 = 90;
      h.rps.push(this.rps); h.err.push(this.err); h.p95.push(this.p95); h.pods.push(this.running());
      Object.keys(h).forEach(function (k) { if (h[k].length > cap2) h[k].shift(); });
      this.emit('metrics');
    }
  };

  Sim.prototype.retireSpareNodes = function () {
    var self = this;
    this.nodes.forEach(function (n) {
      if (n.id < 5 || !n.active) return;
      // Move anything left on it, then remove the building.
      self.pods.filter(function (p) { return p.node === n.id; }).forEach(function (p) { p.state = 'crash'; p.killT = 0.01; });
      n.active = false;
      self.log('autoscaler: removed node ' + n.name, 'ok');
    });
  };

  /* A fault "finishes" when the system has recovered from it without needing a human. */
  Sim.prototype.finish = function (id) {
    if (!this.pending[id]) return;
    this.pending[id]--;
    if (!this.paged) { this.survived++; this.emit('survived', this.survived); }
  };

  Sim.prototype.page = function () {
    this.paged = true;
    var self = this, now = this.time;
    var kinds = {};
    this.recent.forEach(function (r) { if (now - r[0] < 30) kinds[r[1]] = 1; });
    var labels = Object.keys(kinds).map(function (k) { return FAULTS[k].label.toLowerCase(); });
    this.log('ALERT: error rate above ' + PAGE_THRESHOLD + '% for ' + PAGE_AFTER + 's. Paging on-call.', 'alert');
    this.emit('page', { failures: this.recent.filter(function (r) { return now - r[0] < 30; }).length, labels: labels, stamp: self.stamp() });
  };

  /* ---- Faults ---- */
  Sim.prototype.trigger = function (id, arg) {
    if (!FAULTS[id]) return false;
    if (id === 'spike' && this.spike > 0) return false;
    if (id === 'flood' && this.queue > 0) return false;
    if (id === 'deploy' && this.effects.deployBusy) return false;
    if (id === 'node' && this.effects.nodeBusy) return false;
    this.recent.push([this.time, id]);
    this.pending[id] = (this.pending[id] || 0) + 1;
    this.emit('fault', id);
    this['f_' + id](arg);
    return true;
  };

  Sim.prototype.f_kill = function (pod) {
    var self = this;
    var list = this.pods.filter(function (p) { return p.state === 'run'; });
    pod = pod || list[Math.floor(Math.random() * list.length)];
    if (!pod) { this.finish('kill'); return; }
    pod.state = 'crash'; pod.killT = 1.1;
    this.log('container ' + pod.id + ' on ' + this.nodes[pod.node].name + ' exited (137)', 'warn');
    this.log('health check removed ' + pod.id + ' from the load balancer');
    this.after(2.6, function () {
      self.log('replacement ready. ' + self.running() + '/' + self.desired + ' serving', 'ok');
      self.finish('kill');
    });
  };

  Sim.prototype.f_spike = function () {
    var self = this;
    this.spike = 18;
    this.log('traffic at 3x normal. Nginx rate limit engaged', 'warn');
    this.after(18, function () {
      self.log('traffic back to normal', 'ok');
      self.finish('spike');
    });
  };

  Sim.prototype.f_node = function (target) {
    var self = this;
    var candidates = this.nodes.filter(function (n) { return n.active && n.up; });
    if (candidates.length < 2) { this.finish('node'); return; }
    var node = target || candidates[Math.floor(Math.random() * candidates.length)];
    node.up = false; node.flash = 0.5;
    this.rain = 15;
    this.effects.nodeBusy = 13;
    this.effects.nodeLoss = 3.2;
    this.emit('lightning');
    this.pods = this.pods.filter(function (p) { return p.node !== node.id; });
    this.log('node ' + node.name + ' NotReady: power lost', 'alert');
    this.log('rescheduling its containers onto healthy nodes');
    this.after(13, function () {
      node.up = true;
      self.log('node ' + node.name + ' Ready', 'ok');
      self.finish('node');
    });
  };

  Sim.prototype.f_deploy = function () {
    var self = this;
    this.effects.deployBusy = 7;
    this.log('jenkins: rolling out v42 to 1 of ' + this.desired);
    var canary = this.addPod(false, 'v42');
    if (canary) { canary.doomed = true; canary.ready = 2; }
    this.effects.badRelease = 3.6;
    this.after(2, function () { self.log('health check failed: v42 returned 503', 'warn'); });
    this.after(3.2, function () { self.log('rollout halted. Rolling back to v41', 'warn'); });
    this.after(5, function () {
      self.log('rollback complete. v41 never stopped serving', 'ok');
      self.finish('deploy');
    });
  };

  Sim.prototype.f_flood = function () {
    this.queue = 5000; this.queueMax = 5000; this.dlq = 0;
    this.log('5,000 uploads queued. Workers capped at 8 concurrent');
  };

  Sim.prototype.f_db = function () {
    var self = this;
    this.effects.dbDown = 4;
    this.log('postgres: connection refused', 'alert');
    this.after(2.2, function () { self.log('postgres: restarted, replaying WAL from persistent volume'); });
    this.after(4, function () {
      if (self.effects.dbDown > 0.1) { self.finish('db'); return; }
      self.log('postgres: ready. No committed data lost', 'ok');
      self.finish('db');
    });
  };

  Sim.prototype.f_cert = function () {
    var self = this;
    this.log('cert check: 30 days left, certbot renewal timer fired');
    this.after(1.4, function () { self.log('certbot: certificate renewed', 'ok'); });
    this.after(2.2, function () { self.log('nginx -s reload: 0 connections dropped', 'ok'); self.finish('cert'); });
  };

  /* Consequences from the on-call game. Not a chaos test, so it can't page anyone. */
  Sim.prototype.scare = function (n) {
    var list = this.pods.filter(function (p) { return p.state === 'run'; });
    for (var i = 0; i < n && list.length; i++) {
      var p = list.splice(Math.floor(Math.random() * list.length), 1)[0];
      p.state = 'crash'; p.killT = 1.4;
    }
    if (n > 1) { this.rain = Math.max(this.rain, 4); this.emit('lightning'); }
  };

  /* Direct manipulation from the canvas. */
  Sim.prototype.killPod = function (nodeId, slot) {
    var pod = this.pods.filter(function (p) { return p.node === nodeId && p.slot === slot && p.state === 'run'; })[0];
    if (!pod) return false;
    return this.trigger('kill', pod);
  };

  /* A tiny shell for the people who will definitely try it. */
  Sim.prototype.exec = function (raw) {
    var self = this, cmd = raw.trim().replace(/\s+/g, ' '), m;
    if (!cmd) return;
    this.log('$ ' + cmd, 'cmd');
    var out = function (s) { self.log(s, 'out'); };
    if (cmd === 'help') {
      out('kubectl get pods | get nodes | delete pod [name]');
      out('kubectl scale --replicas=N | rollout undo');
      out('curl -I localhost | whoami | clear');
    } else if (cmd === 'clear') {
      this.emit('clear');
    } else if (cmd === 'whoami') {
      out('sudhin: devops engineer, currently asleep');
    } else if (/^kubectl get (pods?|po)\b/.test(cmd)) {
      this.pods.slice(0, 6).forEach(function (p) { out(p.id + '  ' + p.state.padEnd(5) + '  ' + p.ver + '  ' + self.nodes[p.node].name); });
      if (this.pods.length > 6) out('... and ' + (this.pods.length - 6) + ' more');
    } else if (/^kubectl get (nodes?|no)\b/.test(cmd)) {
      this.nodes.filter(function (n) { return n.active; }).forEach(function (n) {
        out(n.name.padEnd(8) + (n.up ? 'Ready' : 'NotReady') + '  ' + self.pods.filter(function (p) { return p.node === n.id; }).length + ' pods');
      });
    } else if ((m = cmd.match(/^kubectl delete (?:pods?|po)(?: (\S+))?/))) {
      var pod = m[1] && m[1] !== '--all' ? this.pods.filter(function (p) { return p.id === m[1]; })[0] : null;
      if (m[1] === '--all') {
        out('nice try. deleting them one at a time instead');
        for (var i = 0; i < 3; i++) this.trigger('kill');
      } else if (m[1] && !pod) out('Error: pod "' + m[1] + '" not found');
      else this.trigger('kill', pod || undefined);
    } else if ((m = cmd.match(/^kubectl scale .*--replicas[= ](\d+)/))) {
      var n = Math.max(1, Math.min(MAX_REPLICAS, parseInt(m[1], 10)));
      this.desired = n;
      out('deployment scaled to ' + n + (parseInt(m[1], 10) > MAX_REPLICAS ? ' (cluster limit)' : ''));
    } else if (/^kubectl rollout undo/.test(cmd)) {
      out('already on the last good version: ' + this.version);
    } else if (/^curl\b/.test(cmd)) {
      out('HTTP/2 200  server: nginx  x-on-call: asleep');
    } else if (/rm -rf/.test(cmd)) {
      out('permission denied. Good instinct testing it, though');
    } else if (/^sudo\b/.test(cmd)) {
      out('sudhin is not in the sudoers file. This incident will be reported.');
    } else {
      out(cmd.split(' ')[0] + ': command not found. Try: help');
    }
  };

  window.LightsOnSim = Sim;
  window.LightsOnFaults = FAULTS;
  window.LightsOnSlots = SLOTS_PER_NODE;
})();
