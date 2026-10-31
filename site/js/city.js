/* Paints Mumbai on one canvas: sky, sea, the Sea Link and the towers that are the cluster. */
(function () {
  'use strict';

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function mixA(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function css(c, alpha) {
    return alpha === undefined
      ? 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
      : 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + alpha + ')';
  }

  /* Colour script of the night. Four stops, top of sky to horizon. */
  var SKY = [
    { t: 0.00, s: ['#04060e', '#080d20', '#141632', '#33263c'] },
    { t: 0.30, s: ['#060a1a', '#0e1433', '#23204a', '#4a2f4d'] },
    { t: 0.50, s: ['#0c1436', '#232454', '#55346a', '#a85a63'] },
    { t: 0.72, s: ['#3f608f', '#a981a1', '#ef9e78', '#ffc98c'] },
    { t: 1.00, s: ['#c6dfee', '#e3ece6', '#f9ecd6', '#fde2bb'] }
  ].map(function (k) { return { t: k.t, s: k.s.map(rgb) }; });

  function skyAt(t) {
    for (var i = 0; i < SKY.length - 1; i++) {
      var a = SKY[i], b = SKY[i + 1];
      if (t <= b.t) {
        var f = smooth(a.t, b.t, t);
        return a.s.map(function (c, j) { return mixA(c, b.s[j], f); });
      }
    }
    return SKY[SKY.length - 1].s;
  }

  /* Seeded RNG so the skyline is the same city on every visit. */
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

  /* Tower unit geometry. */
  var CW = 7.5, FH = 7.5, COLS = 7, TW = CW * COLS + 6, GAP = 14;
  var ORDER = [2, 3, 4, 5, 1, 6, 0, 7]; // node index -> position. First five sit in the middle.

  function City(canvas, sim, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.sim = sim;
    this.reduced = opts.reduced;
    this.t = 0;              // 0 night, 1 full morning
    this.cam = { cx: 0, horizon: 0, scale: 1 };
    this.veil = 0;
    this.power = 0;          // intro: the city switches on
    this.clockT = 0;
    this.flash = 0;
    this.quality = 1;
    this.hover = null;
    this.cars = [];
    this.carT = 0;
    this.drops = [];
    this.build();
    this.resize();
  }

  City.prototype.build = function () {
    var r = rng(7907);
    // Towers: floors, slots and window jitter fixed once.
    this.towers = [];
    var SLOTS = window.LightsOnSlots;
    for (var i = 0; i < 8; i++) {
      var floors = 24 + Math.floor(r() * 12);
      var usable = [];
      for (var f = 2; f + 1 < floors - 1; f += 2) usable.push(f);
      for (var u = usable.length - 1; u > 0; u--) { var x = Math.floor(r() * (u + 1)); var tmp = usable[u]; usable[u] = usable[x]; usable[x] = tmp; }
      var slotFloor = usable.slice(0, SLOTS);
      var win = [];
      for (var fl = 0; fl < floors; fl++) {
        var row = [];
        for (var c = 0; c < COLS; c++) row.push({ a: 0.62 + r() * 0.38, off: r(), decor: r() < 0.14, warm: r() });
        win.push(row);
      }
      var slotOf = {};
      slotFloor.forEach(function (fl2, s) { slotOf[fl2] = s; slotOf[fl2 + 1] = s; });
      this.towers.push({
        floors: floors, win: win, slotOf: slotOf,
        crown: Math.floor(r() * 3), blink: r() * 6
      });
    }
    // Two parallax silhouette layers, in fractions of screen width.
    this.far = []; this.mid = [];
    var x2 = -0.05;
    while (x2 < 1.05) { var w = 0.014 + r() * 0.03; this.far.push({ x: x2, w: w, h: 0.06 + r() * 0.15, lit: [] }); x2 += w * (0.7 + r() * 0.5); }
    x2 = -0.05;
    while (x2 < 1.05) {
      var w2 = 0.018 + r() * 0.036, h2 = 0.05 + r() * 0.17, n = 4 + Math.floor(r() * 10), lit = [];
      for (var k = 0; k < n; k++) lit.push({ x: r(), y: r(), o: r() });
      this.mid.push({ x: x2, w: w2, h: h2, lit: lit }); x2 += w2 * (1 + r() * 0.8);
    }
    this.stars = [];
    for (var s = 0; s < 170; s++) this.stars.push({ x: r(), y: r() * 0.72, a: 0.15 + r() * 0.75, p: r() * 6, z: r() < 0.12 ? 1.6 : 1 });
    this.boats = [
      { x: 0.1, y: 0.3, s: 1, v: 0.0035, p: 0 },
      { x: 0.46, y: 0.62, s: 1.5, v: -0.0024, p: 2 },
      { x: 0.86, y: 0.2, s: 0.8, v: 0.0028, p: 4 }
    ];
    this.plane = { x: -1, wait: 7 };
    this.shoot = null; this.shootWait = 9;
    this.train = { x: -9999, wait: 4 };
    this.zs = []; this.zT = 0; this.poke = 0;
    this.towers[1].crown = 3; // this roof is taken
    this.glints = [];
    for (var g = 0; g < 70; g++) this.glints.push({ x: r(), y: r(), l: 6 + r() * 34, p: r() * 6 });
  };

  City.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, this.quality < 1 ? 1 : 1.75);
    if (this.w === window.innerWidth && this.h === window.innerHeight && this.dpr === dpr) return;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.dpr = dpr;
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.small = this.w < 760;
  };

  /* Screen position of a tower for the current camera. */
  City.prototype.towerX = function (nodeId) {
    var total = 8 * TW + 7 * GAP, pos = ORDER[nodeId];
    return this.cam.cx + (pos * (TW + GAP) - total / 2) * this.cam.scale;
  };

  City.prototype.hit = function (mx, my) {
    var s = this.cam.scale, hor = this.deckY();
    for (var n = 0; n < 8; n++) {
      var node = this.sim.nodes[n];
      if (!node.active || node.rise < 0.9) continue;
      var x = this.towerX(n), tw = this.towers[n];
      if (mx < x || mx > x + TW * s) continue;
      var fl = Math.floor((hor - my) / (FH * s));
      if (fl < 0 || fl >= tw.floors) continue;
      var slot = tw.slotOf[fl];
      if (slot === undefined) return null;
      return { node: n, slot: slot };
    }
    return null;
  };

  /* Sudhin's flat: a shack on the roof of tower 1, on its own UPS, naturally. */
  City.prototype.flat = function () {
    var s = this.cam.scale, x = this.towerX(1), roof = this.deckY() - this.towers[1].floors * FH * s, w = 50 * s, h = 27 * s;
    return { x: x + (TW * s - w) / 2, y: roof - h, w: w, h: h };
  };
  City.prototype.hitFlat = function (mx, my) {
    var f = this.flat();
    return mx >= f.x - 6 && mx <= f.x + f.w + 6 && my >= f.y - 6 && my <= f.y + f.h + 6;
  };

  City.prototype.drawFlat = function (ctx, sil, nightLight, ck, dt) {
    var f = this.flat(), s = this.cam.scale, paged = this.sim.paged, morning = this.t > 0.6;
    this.poke = Math.max(0, this.poke - dt);
    var wake = paged || morning || this.poke > 0;

    ctx.fillStyle = css(sil);
    ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.fillRect(f.x - 2 * s, f.y - 1.5 * s, f.w + 4 * s, 1.8 * s); // roof slab

    var wx = f.x + 3 * s, wy = f.y + 3 * s, ww = f.w - 6 * s, wh = f.h - 5 * s;
    ctx.fillStyle = paged ? '#ffd58a' : morning ? '#dbe6ea' : this.poke > 0 ? '#ffbe73' : '#141d44';
    ctx.fillRect(wx, wy, ww, wh);

    ctx.fillStyle = morning ? '#39465a' : '#05060e';
    var r = Math.max(1.4, 1.9 * s);
    if (wake) {
      // Sitting up. The phone is the brightest thing in the room.
      ctx.beginPath(); ctx.arc(wx + ww * 0.42, wy + wh * 0.32, r, 0, 7); ctx.fill();
      ctx.fillRect(wx + ww * 0.42 - r, wy + wh * 0.32 + r * 0.8, r * 2, wh);
      if (!morning) { ctx.fillStyle = '#d7efff'; ctx.fillRect(wx + ww * 0.42 + r * 1.4, wy + wh * 0.42, Math.max(1, r * 0.7), r * 1.2); }
    } else {
      // Horizontal, as intended.
      ctx.fillRect(wx + 1.5 * s, wy + wh * 0.68, ww - 3 * s, wh * 0.32);
      ctx.beginPath(); ctx.arc(wx + ww * 0.24, wy + wh * 0.58, r, 0, 7); ctx.fill();
      // The charging phone on the bedside table.
      if (Math.sin(ck * 2) > 0) { ctx.fillStyle = '#7fe0a0'; ctx.fillRect(wx + ww - 2.4 * s, wy + wh * 0.6, 1, 1); }
    }

    if (f.y > this.h) { this.zs.length = 0; return; } // camera has moved on

    // Zzz.
    this.zT -= dt;
    if (!wake && this.zT <= 0 && !this.reduced) { this.zT = 1.5; this.zs.push({ x: f.x + f.w * 0.72, y: f.y - 2, life: 0 }); }
    ctx.textAlign = 'left';
    for (var i = this.zs.length - 1; i >= 0; i--) {
      var z = this.zs[i];
      z.life += dt / 3.6;
      if (z.life >= 1 || wake) { this.zs.splice(i, 1); continue; }
      ctx.fillStyle = 'rgba(220,228,255,' + (Math.sin(z.life * Math.PI) * 0.85) + ')';
      ctx.font = 'italic ' + (9 + z.life * 11) * Math.max(0.8, s * 0.8) + 'px Newsreader, serif';
      ctx.fillText('z', z.x + z.life * 20 + Math.sin(z.life * 7) * 4, z.y - z.life * 44 * Math.max(0.8, s * 0.8));
    }

    if (this.small && s < 0.7) return;
    ctx.font = '10.5px Plex, monospace';
    var label = paged ? 'sudhin · AWAKE' : morning ? 'sudhin · up. nobody called.' : this.poke > 0 ? 'sudhin · mmph. five more minutes' : 'sudhin · asleep';
    // Label sits in the clear sky above the roof.
    ctx.textAlign = 'right';
    ctx.fillStyle = paged ? '#ff8d83' : morning ? '#2d3748' : 'rgba(226,231,248,0.95)';
    ctx.fillText(label, f.x + f.w * 0.62, f.y - 9);
    ctx.textAlign = 'left';
  };

  /* Things that happen whether or not you're watching. */
  City.prototype.drawSkyLife = function (ctx, nightLight, dt) {
    var w = this.w, h = this.h, hor = this.cam.horizon, move = this.reduced ? 0 : dt;

    // A plane on approach to Mumbai airport.
    var pl = this.plane;
    if (pl.x < 0 && !this.reduced) { pl.wait -= move; if (pl.wait <= 0) { pl.x = 0; pl.dir = Math.random() < 0.5 ? 1 : -1; } }
    if (pl.x >= 0 && !this.reduced) {
      pl.x += move * 0.036;
      var px = pl.dir > 0 ? pl.x * (w + 40) - 20 : w + 20 - pl.x * (w + 40), py = h * (0.09 + pl.x * 0.17);
      var strobe = Math.floor(this.clockT * 1.4) % 2 === 0;
      ctx.fillStyle = nightLight > 0.4 ? (strobe ? '#ff5a4e' : '#dfe8ff') : '#5b6776';
      ctx.fillRect(px, py, nightLight > 0.4 ? 2.2 : 9, nightLight > 0.4 ? 2.2 : 1.6);
      if (nightLight > 0.4) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(px - 7 * pl.dir, py + 0.5, 1.2, 1.2); }
      if (pl.x > 1) { pl.x = -1; pl.wait = 16 + Math.random() * 16; }
    }

    // Shooting star, for the patient.
    if (nightLight > 0.8 && !this.reduced) {
      this.shootWait -= move;
      if (!this.shoot && this.shootWait <= 0) {
        this.shoot = { x: Math.random() * w * 0.8 + w * 0.1, y: Math.random() * h * 0.28, life: 0 };
        this.shootWait = 18 + Math.random() * 26;
      }
      if (this.shoot) {
        var st = this.shoot; st.life += move / 0.8;
        var sx = st.x + st.life * 240, sy = st.y + st.life * 90;
        var sg = ctx.createLinearGradient(sx - 70, sy - 26, sx, sy);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,' + Math.sin(st.life * Math.PI) + ')');
        ctx.strokeStyle = sg; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(sx - 70, sy - 26); ctx.lineTo(sx, sy); ctx.stroke();
        if (st.life >= 1) this.shoot = null;
      }
    }

    // Birds, when it's morning.
    if (nightLight < 0.35 && hor < h * 1.1) {
      ctx.strokeStyle = 'rgba(38,46,60,' + (0.7 * (1 - nightLight / 0.35)) + ')'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (var b = 0; b < 7; b++) {
        var bx = ((this.clockT * 11 + b * 26 + (b % 2) * 10) % (w + 200)) - 100;
        var by = hor - h * 0.34 + (b % 3) * 11 + b * 3;
        var flap = Math.sin(this.clockT * 5 + b) * 2.6;
        ctx.moveTo(bx - 5, by - flap); ctx.quadraticCurveTo(bx - 2, by - 1, bx, by); ctx.quadraticCurveTo(bx + 2, by - 1, bx + 5, by - flap);
      }
      ctx.stroke();
    }
  };

  /* The Western Line, running behind the towers. */
  City.prototype.drawTrain = function (ctx, silMid, nightLight, dt) {
    var w = this.w, y = this.cam.horizon - (this.small ? 13 : 18), carW = this.small ? 26 : 46, tr = this.train, cars = 9;
    ctx.fillStyle = css(silMid);
    ctx.fillRect(0, y + 8, w, 1.2);
    if (this.reduced) return;
    if (tr.x < -9000) { tr.wait -= dt; if (tr.wait <= 0) { tr.dir = Math.random() < 0.5 ? 1 : -1; tr.x = tr.dir > 0 ? -cars * carW : w; } return; }
    tr.x += tr.dir * dt * (this.small ? 70 : 125);
    var lit = nightLight > 0.3;
    for (var i = 0; i < cars; i++) {
      var cx = tr.x + i * carW;
      if (cx > w || cx + carW < 0) continue;
      ctx.fillStyle = lit ? '#232544' : '#7d4a3e';
      ctx.fillRect(cx, y, carW - 2, 8);
      ctx.fillStyle = lit ? '#ffe2ae' : '#e8c86b';
      if (lit) { for (var k = 3; k < carW - 6; k += 6) ctx.fillRect(cx + k, y + 2, 3.6, 2.4); }
      else ctx.fillRect(cx, y + 4.6, carW - 2, 1.4);
    }
    if ((tr.dir > 0 && tr.x > w) || (tr.dir < 0 && tr.x + cars * carW < 0)) { tr.x = -9999; tr.wait = 18 + Math.random() * 22; }
  };

  City.prototype.drawBoats = function (ctx, nightLight, ck, dt) {
    var w = this.w, h = this.h, hor = this.cam.horizon, sea = h - hor;
    for (var i = 0; i < this.boats.length; i++) {
      var b = this.boats[i];
      b.x += b.v * (this.reduced ? 0 : dt);
      if (b.x > 1.06) b.x = -0.06; if (b.x < -0.06) b.x = 1.06;
      var x = b.x * w, y = hor + 8 + b.y * (sea - 12) + Math.sin(ck + b.p) * 1.2, s = b.s * (0.6 + b.y);
      if (y > h) continue;
      ctx.fillStyle = nightLight > 0.4 ? '#0a0c18' : '#3d4d5c';
      ctx.beginPath();
      ctx.moveTo(x - 11 * s, y - 2 * s); ctx.lineTo(x + 12 * s, y - 2.6 * s); ctx.lineTo(x + 7 * s, y + 2 * s); ctx.lineTo(x - 7 * s, y + 2 * s);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 0.5, y - 12 * s, 1, 10 * s);
      if (nightLight > 0.05) {
        // Lantern, and its long smear on the water.
        var flick = 0.8 + 0.2 * Math.sin(ck * 7 + b.p);
        ctx.fillStyle = 'rgba(255,190,110,' + 0.16 * nightLight * flick + ')';
        ctx.fillRect(x - 1.5, y + 2 * s, 3, 15 * s);
        ctx.fillStyle = 'rgba(255,210,140,' + nightLight * flick + ')';
        ctx.fillRect(x - 1, y - 7 * s, 2.2, 2.2);
      }
    }
  };

  City.prototype.deckY = function () { return this.cam.horizon - 4; };

  /* ---- The frame ---- */
  City.prototype.draw = function (dt) {
    var ctx = this.ctx, w = this.w, h = this.h, t = this.t, cam = this.cam, sim = this.sim;
    this.clockT += this.reduced ? 0 : dt;
    var ck = this.clockT;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    var stops = skyAt(t);
    var hor = cam.horizon;
    var skyH = Math.max(hor, h * 0.6);

    var g = ctx.createLinearGradient(0, 0, 0, skyH);
    g.addColorStop(0, css(stops[0])); g.addColorStop(0.45, css(stops[1]));
    g.addColorStop(0.8, css(stops[2])); g.addColorStop(1, css(stops[3]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, Math.min(h, hor + 1));
    if (hor >= h) { /* sky fills all */ }

    // Stars.
    var starA = 1 - smooth(0.34, 0.66, t);
    if (starA > 0.01) {
      ctx.fillStyle = '#e8edff';
      for (var i = 0; i < this.stars.length; i++) {
        var st = this.stars[i];
        var a = st.a * starA * (0.7 + 0.3 * Math.sin(ck * 1.3 + st.p));
        ctx.globalAlpha = a;
        ctx.fillRect(st.x * w, st.y * h, st.z, st.z);
      }
      ctx.globalAlpha = 1;
    }

    this.drawSkyLife(ctx, 1 - smooth(0.5, 0.86, t), dt);

    // Sun.
    var sunUp = smooth(0.5, 1, t);
    if (sunUp > 0.01) {
      var sx = w * 0.72, sy = lerp(hor + 30, hor - h * 0.3, sunUp);
      var rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.75);
      rg.addColorStop(0, 'rgba(255,230,180,' + 0.85 * sunUp + ')');
      rg.addColorStop(0.09, 'rgba(255,214,150,' + 0.55 * sunUp + ')');
      rg.addColorStop(1, 'rgba(255,210,150,0)');
      ctx.fillStyle = rg; ctx.fillRect(0, 0, w, Math.min(h, hor));
      ctx.fillStyle = 'rgba(255,246,224,' + Math.min(1, sunUp * 1.3) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, Math.min(w, h) * 0.038, 0, 7); ctx.fill();
    }

    if (hor - h * 0.45 < h) {
      var nightLight = 1 - smooth(0.5, 0.86, t);
      var silFar = mixA(mixA(rgb('#121330'), rgb('#5d4a68'), smooth(0.3, 0.7, t)), rgb('#c9cfd2'), smooth(0.7, 1, t));
      var silMid = mixA(mixA(rgb('#0b0d22'), rgb('#3f3350'), smooth(0.3, 0.7, t)), rgb('#a4b0b9'), smooth(0.7, 1, t));
      var silTop = mixA(mixA(rgb('#070917'), rgb('#2a2440'), smooth(0.3, 0.7, t)), rgb('#7d8d9c'), smooth(0.7, 1, t));
      var unit = this.small ? h * 0.75 : h;
      var pan = (cam.cx - w / 2) * 0.12;

      // City glow on the underside of the haze: dims as containers die.
      var serving = sim.running();
      var glowA = nightLight * this.power * clamp(0.1 + serving / 90, 0, 0.5);
      if (glowA > 0.01) {
        var gg = ctx.createRadialGradient(cam.cx, hor, 0, cam.cx, hor, Math.max(w * 0.5, 480));
        gg.addColorStop(0, 'rgba(255,170,90,' + glowA + ')');
        gg.addColorStop(1, 'rgba(255,150,80,0)');
        ctx.fillStyle = gg; ctx.fillRect(0, 0, w, Math.min(h, hor));
      }

      // Far silhouettes.
      ctx.fillStyle = css(silFar);
      for (i = 0; i < this.far.length; i++) {
        var fb = this.far[i];
        ctx.fillRect(fb.x * w + pan * 0.5, hor - fb.h * unit, fb.w * w, fb.h * unit);
      }
      // Mid layer with a few lit windows.
      for (i = 0; i < this.mid.length; i++) {
        var mb = this.mid[i], mx = mb.x * w + pan, mw = mb.w * w, mh = mb.h * unit;
        ctx.fillStyle = css(silMid);
        ctx.fillRect(mx, hor - mh, mw, mh);
        if (nightLight > 0.02) {
          ctx.fillStyle = '#d9a366';
          for (var j = 0; j < mb.lit.length; j++) {
            var L = mb.lit[j];
            ctx.globalAlpha = Math.max(0, nightLight * this.power - L.o * (1 - nightLight)) * 0.5;
            ctx.fillRect(mx + L.x * (mw - 3), hor - mh + 3 + L.y * (mh - 6), 2, 2.5);
          }
          ctx.globalAlpha = 1;
        }
      }

      this.drawTrain(ctx, silMid, nightLight, this.reduced ? 0 : dt);
      this.drawTowers(ctx, silTop, nightLight, ck);
      this.drawFlat(ctx, silTop, nightLight, ck, dt);
      this.drawBridge(ctx, silTop, nightLight, ck, dt);

      // Horizon haze, sold by morning.
      var hz = ctx.createLinearGradient(0, hor - 60, 0, hor);
      hz.addColorStop(0, css(stops[3], 0));
      hz.addColorStop(1, css(stops[3], 0.22 + 0.25 * smooth(0.6, 1, t)));
      ctx.fillStyle = hz; ctx.fillRect(0, hor - 60, w, 60);

      if (hor < h) { this.drawSea(ctx, stops, nightLight, ck); this.drawBoats(ctx, nightLight, ck, dt); }
    }

    // Monsoon.
    if (!this.reduced) this.drawRain(ctx, dt);
    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(214,226,255,' + (this.flash * this.flash * 0.5) + ')';
      ctx.fillRect(0, 0, w, h);
      this.flash = Math.max(0, this.flash - dt * 2.8);
    }
  };

  City.prototype.drawTowers = function (ctx, sil, nightLight, ck) {
    var sim = this.sim, s = this.cam.scale, base = this.deckY();
    // Pod lookup for this frame.
    var map = {};
    for (var i = 0; i < sim.pods.length; i++) { var p = sim.pods[i]; map[p.node + ':' + p.slot] = p; }
    var hv = this.hover;

    for (var n = 0; n < 8; n++) {
      var node = sim.nodes[n];
      if (node.rise < 0.01) continue;
      var tw = this.towers[n], x = this.towerX(n);
      var fullH = tw.floors * FH * s, H = fullH * node.rise, y = base - H, W = TW * s;

      ctx.fillStyle = css(sil);
      ctx.fillRect(x, y, W, H);
      if (tw.crown === 0) ctx.fillRect(x + W * 0.25, y - 7 * s, W * 0.5, 7 * s);
      else if (tw.crown === 1) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + W / 2, y - 12 * s); ctx.lineTo(x + W, y); ctx.fill(); }
      else if (tw.crown === 2) ctx.fillRect(x + W * 0.46, y - 22 * s, Math.max(1, W * 0.05), 22 * s);

      if (nightLight > 0.015 && node.rise > 0.12) {
        // Aircraft warning light: the one thing that stays on when a building dies.
        var bl = Math.sin(ck * 1.8 + tw.blink);
        if (bl > 0.25 && node.up && n !== 1) {
          ctx.fillStyle = 'rgba(255,70,60,' + nightLight * (bl - 0.25) + ')';
          ctx.fillRect(x + W / 2 - 1, y - (tw.crown === 2 ? 23 : tw.crown === 1 ? 13 : 8) * s, 2, 2);
        }

        // Windows.
        var cw = CW * s, fh = FH * s, ww = Math.max(1, cw * 0.62), wh = Math.max(1, fh * 0.56);
        var visible = Math.ceil(tw.floors * node.rise);
        for (var f = 0; f < visible; f++) {
          var slot = tw.slotOf[f], pod = slot === undefined ? null : map[n + ':' + slot];
          var wy = base - (f + 1) * fh + (fh - wh) / 2;
          var isHover = hv && hv.node === n && hv.slot === slot;
          for (var c = 0; c < COLS; c++) {
            var wn = tw.win[f][c], alpha = 0, col = null;
            var offAt = 1 - wn.off * 0.7; // each window has its own moment to switch off at dawn
            var lightHere = clamp((nightLight - (1 - offAt)) / offAt + 0.1, 0, 1);
            if (pod && node.up) {
              if (pod.state === 'run') {
                col = pod.ver === 'v42' ? '#7fd0ff' : wn.warm > 0.78 ? '#ffe4b8' : wn.warm > 0.3 ? '#ffc572' : '#f7a94f';
                alpha = wn.a;
                if (isHover) { col = '#fff2d8'; alpha = 1; }
              } else if (pod.state === 'pend') {
                col = pod.ver === 'v42' ? '#7fd0ff' : '#bfe0ff';
                alpha = 0.3 + 0.55 * Math.abs(Math.sin(ck * 6 + c * 0.6));
              } else {
                col = '#ff3b30';
                alpha = 0.55 + 0.45 * Math.abs(Math.sin(ck * 18));
              }
            } else if (wn.decor && node.up) {
              col = '#7f88a8'; alpha = 0.42;
            }
            if (!col) continue;
            // Intro: the building powers on from the ground up.
            var pow = clamp(this.power * 2.4 - (f / tw.floors) - wn.off * 0.4, 0, 1);
            ctx.globalAlpha = alpha * lightHere * pow * clamp(node.rise * 1.2, 0, 1);
            if (ctx.globalAlpha < 0.01) continue;
            ctx.fillStyle = col;
            ctx.fillRect(x + 3 * s + c * cw + (cw - ww) / 2, wy, ww, wh);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  };

  City.prototype.drawBridge = function (ctx, sil, nightLight, ck, dt) {
    var w = this.w, deck = this.deckY() + 3, sim = this.sim;
    var tall = this.small ? 54 : 92;
    var pylons = [w * 0.17, w * 0.83];

    // At night the bridge is drawn in light: faint cables, uplit pylons, a string of deck lamps.
    var cable = mixA(sil, [176, 170, 205], nightLight * 0.62);
    ctx.strokeStyle = css(cable, 0.34 + 0.5 * (1 - nightLight)); ctx.lineWidth = 0.7;
    ctx.beginPath();
    pylons.forEach(function (px) {
      for (var i = 1; i <= 9; i++) {
        var d = i * (w < 760 ? 12 : 26), ty = deck - tall + i * 3.2;
        ctx.moveTo(px, ty); ctx.lineTo(px - d, deck);
        ctx.moveTo(px, ty); ctx.lineTo(px + d, deck);
      }
    });
    ctx.stroke();
    ctx.fillStyle = css(mixA(sil, [120, 112, 150], nightLight * 0.7));
    pylons.forEach(function (px) {
      // Waisted diamond pylon, the Sea Link's signature.
      ctx.beginPath();
      ctx.moveTo(px - 1, deck - tall); ctx.lineTo(px + 1, deck - tall);
      ctx.lineTo(px + 6, deck - tall * 0.34); ctx.lineTo(px + 2.5, deck + 3);
      ctx.lineTo(px - 2.5, deck + 3); ctx.lineTo(px - 6, deck - tall * 0.34);
      ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = css(mixA(sil, [52, 50, 78], nightLight));
    ctx.fillRect(0, deck, w, 2.4);
    if (nightLight > 0.02) {
      ctx.fillStyle = '#ffbe73';
      ctx.globalAlpha = 0.75 * nightLight * this.power;
      for (var lamp = 8; lamp < w; lamp += this.small ? 24 : 34) ctx.fillRect(lamp, deck - 3, 1.4, 1.4);
      ctx.globalAlpha = 1;
    }

    // Cars: one for a fixed slice of requests.
    var speed = this.small ? 90 : 150;
    if (!this.reduced) {
      this.carT += dt * sim.rps / 160;
      while (this.carT > 1 && this.cars.length < 170) {
        this.carT -= 1;
        this.cars.push({
          x: Math.random() < 0.5 ? -8 : w + 8, v: 0, bad: Math.random() * 100 < sim.err * 2.2,
          lane: Math.random()
        });
        var cc = this.cars[this.cars.length - 1];
        cc.v = (cc.x < 0 ? 1 : -1) * speed * (0.8 + Math.random() * 0.5);
      }
      if (this.carT > 3) this.carT = 3;
    }
    var day = 1 - nightLight;
    for (var i = this.cars.length - 1; i >= 0; i--) {
      var c = this.cars[i];
      c.x += c.v * dt;
      if (c.x < -12 || c.x > w + 12) { this.cars.splice(i, 1); continue; }
      var outbound = c.v < 0;
      var lit = c.bad ? '#ff4a3d' : outbound ? '#ff8a6b' : '#fff0d4';
      if (day > 0.6) { lit = c.bad ? '#c9352c' : '#3e4a58'; ctx.globalAlpha = 0.6; }
      var carY = deck - 1.6 + (outbound ? 0 : 0.8);
      if (day <= 0.6) {
        // A soft trail makes movement readable at this tiny size.
        ctx.fillStyle = lit;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(c.v > 0 ? c.x - 11 : c.x + 3, carY, 11, 1.5);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = lit;
      ctx.fillRect(c.x, carY, day > 0.6 ? 4 : 3, 1.7);
      ctx.globalAlpha = 1;
    }
  };

  City.prototype.drawSea = function (ctx, stops, nightLight, ck) {
    var w = this.w, h = this.h, hor = this.cam.horizon, dpr = this.dpr, sea = h - hor;
    var top = mixA(stops[3], rgb('#0a0e20'), 0.55 * (1 - smooth(0.5, 1, this.t)));
    var bot = mixA(mixA(rgb('#04060e'), rgb('#1b2038'), smooth(0, 0.5, this.t)), rgb('#a7c1c9'), smooth(0.65, 1, this.t));
    var g = ctx.createLinearGradient(0, hor, 0, h);
    g.addColorStop(0, css(top)); g.addColorStop(1, css(bot));

    // Reflection: squeeze what's above the waterline into wavy strips.
    var step = this.quality < 1 ? 6 : 3;
    var srcH = Math.min(hor, sea / 0.55);
    ctx.fillStyle = g; ctx.fillRect(0, hor + 2, w, sea);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var calm = this.reduced ? 0 : 1, storm = 1 + Math.min(1, this.sim.rain) * 1.6;
    // The lowest tier skips the reflection: it's the most expensive thing on the page.
    for (var y = 0; this.quality >= 0.5 && y < sea - 2; y += step) {
      var f = y / sea;
      var sy = hor - (y / 0.55);
      if (sy < hor - srcH || sy < 0) break;
      var wave = calm * Math.sin(ck * 1.4 + y * 0.16) * (0.5 + f * 3.4) * storm;
      ctx.globalAlpha = (0.78 - 0.62 * f) * (0.4 + 0.6 * nightLight);
      ctx.drawImage(this.cv,
        0, Math.max(0, (sy - step / 0.55)) * dpr, this.cv.width, (step / 0.55) * dpr,
        wave * dpr, (hor + 2 + y) * dpr, this.cv.width, step * dpr);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Glints on the swell.
    ctx.fillStyle = smooth(0.6, 1, this.t) > 0.5 ? '#fff6e0' : '#a9b6e0';
    for (var i = 0; i < this.glints.length; i++) {
      var gl = this.glints[i];
      ctx.globalAlpha = 0.14 * (0.5 + 0.5 * Math.sin(ck * 0.9 + gl.p));
      ctx.fillRect(gl.x * w, hor + 8 + gl.y * (sea - 8), gl.l, 1);
    }
    ctx.globalAlpha = 1;
  };

  City.prototype.drawRain = function (ctx, dt) {
    var want = this.sim.rain > 0 ? (this.small ? 110 : 240) : 0, w = this.w, h = this.h;
    while (this.drops.length < want) this.drops.push({ x: Math.random() * w * 1.2, y: Math.random() * h, v: 650 + Math.random() * 420, l: 10 + Math.random() * 16 });
    if (!this.drops.length) return;
    if (want === 0) this.drops.length = Math.max(0, this.drops.length - 8);
    ctx.strokeStyle = 'rgba(190,210,245,0.26)'; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (var i = 0; i < this.drops.length; i++) {
      var d = this.drops[i];
      d.y += d.v * dt; d.x -= d.v * dt * 0.14;
      if (d.y > h) { d.y = -20; d.x = Math.random() * w * 1.2; }
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.14, d.y + d.l);
    }
    ctx.stroke();
  };

  City.TOWER_UNIT = { width: 8 * TW + 7 * GAP, height: 36 * FH };
  window.LightsOnCity = City;
})();
