/* Small live system diagrams for the projects: requests travel the happy path, and the
   coloured packets show where trouble gets diverted. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  var FLOWS = {
    resume: {
      caption: 'Bad files leave the line instead of jamming it.',
      nodes: [['Upload', 'HR, in bulk'], ['S3', 'file storage'], ['Queue', 'waits safely'], ['Workers', '8 at a time'], ['Parsed', 'candidate data']],
      branch: { from: 3, label: 'Dead-letter', sub: 're-queue via API', tone: 'bad' },
      action: 'Send a corrupt file',
      result: 'corrupt-scan.pdf failed, moved aside. The other files never noticed.'
    },
    client: {
      caption: 'Every package and every deploy goes through the client’s proxy.',
      nodes: [['Deploy', 'from outside'], ['Proxy', 'client firewall'], ['Web server', 'Nginx + HTTPS'], ['App server', 'Node.js'], ['Database', 'Postgres, Redis']],
      branch: { from: 0, label: 'Open internet', sub: 'blocked', tone: 'bad' },
      action: 'Try a direct download',
      result: 'Connection refused by the firewall. So everything goes through the proxy instead.'
    },
    observe: {
      caption: 'A human gets woken only when a human is needed.',
      nodes: [['Exporters', 'host, container'], ['Prometheus', 'scrapes, stores'], ['Alertmanager', 'decides'], ['On-call', 'one phone']],
      branch: { from: 1, label: 'Grafana', sub: 'everyone can look', tone: 'good' },
      action: 'Open the dashboard',
      result: 'Everyone gets the graphs. Only a real alert reaches the phone.'
    },
    ocr: {
      caption: 'Oversized files stop at the door. Keys never enter the image.',
      nodes: [['PDF upload', 'handwritten'], ['Nginx', 'size limits'], ['Django', 'in Docker'], ['Gemini', 'key at runtime'], ['Logs', 'tokens, timing']],
      branch: { from: 1, label: 'Too large', sub: 'rejected early', tone: 'bad' },
      action: 'Upload a 2 GB PDF',
      result: '413 Request Entity Too Large. It never reached Django, or the AI bill.'
    }
  };

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function box(svg, x, y, w, h, node, cls) {
    svgEl('rect', { x: x, y: y, width: w, height: h, rx: 3, class: 'flow-box ' + (cls || '') }, svg);
    var a = svgEl('text', { x: x + w / 2, y: y + h / 2 - 3, class: 'flow-name' }, svg); a.textContent = node[0];
    var b = svgEl('text', { x: x + w / 2, y: y + h / 2 + 12, class: 'flow-sub' }, svg); b.textContent = node[1];
  }

  function packet(svg, path, dur, begin, cls, reduced) {
    if (reduced) return;
    var c = svgEl('circle', { r: 3.4, class: 'flow-packet ' + cls }, svg);
    svgEl('animateMotion', { path: path, dur: dur + 's', begin: begin + 's', repeatCount: 'indefinite', fill: 'freeze' }, c);
  }

  function render(host, reduced) {
    var flow = FLOWS[host.dataset.flow], W = host.clientWidth;
    if (!W) return;
    var n = flow.nodes.length, wide = W >= 620, br = flow.branch, svg, main, side, i, from, to;
    host.textContent = '';
    if (wide) {
      var gap = 26, bw = (W - gap * (n - 1)) / n, bh = 50, H = 128;
      svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': flow.caption }, host);
      var cx = function (k) { return k * (bw + gap) + bw / 2; };
      main = 'M' + cx(0) + ' 25 L' + cx(n - 1) + ' 25';
      side = 'M' + cx(br.from) + ' 25 L' + cx(br.from) + ' 104';
      svgEl('path', { d: main, class: 'flow-line' }, svg);
      svgEl('path', { d: side, class: 'flow-line dashed ' + br.tone }, svg);
      for (i = 0; i < 3; i++) packet(svg, main, 5.4, -i * 1.8, 'main', reduced);
      for (i = 0; i < n; i++) box(svg, i * (bw + gap), 0, bw, bh, flow.nodes[i]);
      packet(svg, side, 3.2, -1, br.tone, reduced);
      box(svg, br.from * (bw + gap), 78, bw, bh, [br.label, br.sub], br.tone);
      from = [cx(br.from), 25]; to = [cx(br.from), 104];
    } else {
      var bw2 = Math.min(158, W * 0.48), bh2 = 46, step = 62, H2 = n * step, x0 = 0, sideX = W - Math.min(132, W * 0.38);
      var bw3 = W - sideX;
      svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H2, width: W, height: H2, role: 'img', 'aria-label': flow.caption }, host);
      var cy = function (k) { return k * step + bh2 / 2; };
      main = 'M' + (x0 + bw2 / 2) + ' ' + cy(0) + ' L' + (x0 + bw2 / 2) + ' ' + cy(n - 1);
      side = 'M' + (x0 + bw2 / 2) + ' ' + cy(br.from) + ' L' + (sideX + bw3 / 2) + ' ' + cy(br.from);
      svgEl('path', { d: main, class: 'flow-line' }, svg);
      svgEl('path', { d: side, class: 'flow-line dashed ' + br.tone }, svg);
      for (i = 0; i < 3; i++) packet(svg, main, 5.4, -i * 1.8, 'main', reduced);
      for (i = 0; i < n; i++) box(svg, x0, i * step, bw2, bh2, flow.nodes[i]);
      packet(svg, side, 3.2, -1, br.tone, reduced);
      box(svg, sideX, br.from * step, bw3, bh2, [br.label, br.sub], br.tone);
      from = [x0 + bw2 / 2, cy(br.from)]; to = [sideX + bw3 / 2, cy(br.from)];
    }
    var cap = document.createElement('p');
    cap.className = 'flow-caption';
    cap.textContent = flow.caption;
    var fire = document.createElement('button');
    fire.type = 'button'; fire.className = 'flow-try'; fire.textContent = flow.action;
    fire.addEventListener('click', function () { strike(svg, from, to, br.tone, cap, flow, reduced); });
    host.appendChild(fire);
    host.appendChild(cap);
    return svg;
  }

  /* The visitor sends one through by hand. The diverted box answers. */
  function strike(svg, from, to, tone, cap, flow, reduced) {
    var dot = svgEl('circle', { r: 6, class: 'flow-packet ' + tone }, svg);
    var target = svg.querySelector('.flow-box.' + tone);
    var began = performance.now();
    function arrive() {
      dot.remove();
      target.classList.add('hit');
      setTimeout(function () { target.classList.remove('hit'); }, 900);
      cap.textContent = flow.result;
      cap.classList.add('said');
    }
    if (reduced) { arrive(); return; }
    (function move() {
      var f = Math.min(1, (performance.now() - began) / 520);
      dot.setAttribute('cx', from[0] + (to[0] - from[0]) * f);
      dot.setAttribute('cy', from[1] + (to[1] - from[1]) * f);
      if (f < 1) requestAnimationFrame(move); else arrive();
    })();
  }

  window.LightsOnFlows = function (reduced) {
    var hosts = Array.prototype.slice.call(document.querySelectorAll('[data-flow]'));
    var svgs = new Map();
    var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var s = e.target.querySelector('svg');
        if (s) { if (e.isIntersecting) s.unpauseAnimations(); else s.pauseAnimations(); }
      });
    }) : null;
    function all() {
      hosts.forEach(function (h) {
        if (svgs.get(h) === h.clientWidth) return;
        svgs.set(h, h.clientWidth);
        render(h, reduced);
      });
    }
    hosts.forEach(function (h) { if (io) io.observe(h); });
    all();
    return all;
  };
})();
