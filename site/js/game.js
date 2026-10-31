/* "Now you hold the pager": five incidents against the clock. Wrong calls hurt the city. */
(function () {
  'use strict';

  var ROUNDS = 5, SECONDS = 25;

  var POOL = [
    {
      title: '502s on every page, two minutes after a release',
      lines: ['nginx: connect() failed (111: Connection refused) upstream api', 'api-7f9c2   Restarting (1) 8 seconds ago', 'last deploy: app:44, 2m ago'],
      options: [
        { t: 'Roll back to app:43, then investigate', k: 'best', why: 'Users first, curiosity later. The rollback takes a minute, and the bug will still be there after breakfast.' },
        { t: 'Read the logs and hot-fix it forward', k: 'ok', why: 'It might work, but you’re debugging at 3 a.m. while the site is down. Roll back, then fix it calmly.' },
        { t: 'Restart Nginx', k: 'bad', why: 'Nginx is only the messenger. It’s reporting that the app won’t start, and restarting it changes nothing.' }
      ]
    },
    {
      title: 'Disk at 97% on the database server',
      lines: ['/dev/sda1   97%   4.1G free', '/var/lib/docker/containers/9ac1.../9ac1-json.log   41G', 'postgres: warning: running low on disk'],
      options: [
        { t: 'docker system prune -a --volumes', k: 'bad', why: 'You just deleted the database. That --volumes flag removes unused volumes, and this is how people end up in post-mortems.' },
        { t: 'Truncate that log and set Docker log limits', k: 'best', why: 'One runaway log was the whole problem. Setting max-size means it can’t happen again.' },
        { t: 'Resize the disk', k: 'ok', why: 'That buys time, but the log keeps growing and now you’re paying for it.' }
      ]
    },
    {
      title: 'Browsers are warning that the site is not secure',
      lines: ['NET::ERR_CERT_DATE_INVALID', 'certbot: Timeout during connect (likely firewall problem)', 'ufw: 80/tcp DENY   (changed yesterday)'],
      options: [
        { t: 'Reboot the server', k: 'bad', why: 'The certificate is still expired after the reboot, and now you’ve had an outage as well.' },
        { t: 'Issue a new cert by hand with a DNS challenge', k: 'ok', why: 'The site’s back, but automatic renewal is still broken. See you again in 90 days.' },
        { t: 'Reopen port 80, renew, reload Nginx', k: 'best', why: 'Yesterday’s firewall change blocked the renewal. Fix the cause and auto-renewal works again.' }
      ]
    },
    {
      title: 'API returning 500s. Database refusing connections',
      lines: ['FATAL: sorry, too many clients already', 'pg_stat_activity: 97 idle connections, all from api', 'max_connections = 100'],
      options: [
        { t: 'Cap the API’s connection pool and restart the API', k: 'best', why: 'The database is fine. The app is hoarding idle connections, so that’s where the fix belongs.' },
        { t: 'Set max_connections = 10000', k: 'bad', why: 'Every connection costs memory. You’ve swapped this error for the database running out of RAM.' },
        { t: 'Restart Postgres', k: 'ok', why: 'It clears the connections, and they’ll be back within the hour. It also kills anything in flight.' }
      ]
    },
    {
      title: 'Upload queue climbing and nothing is finishing',
      lines: ['queue depth: 12,480 and rising', 'workers: 8/8 busy', 'job a91f: attempt 214, corrupt-scan.pdf'],
      options: [
        { t: 'Purge the queue', k: 'bad', why: 'You just deleted 12,480 people’s uploads to get rid of one bad file.' },
        { t: 'Restart the workers', k: 'ok', why: 'They’ll pick up the same poisoned file and jam again in a few minutes.' },
        { t: 'Dead-letter that job and add a retry limit', k: 'best', why: 'One corrupt file was jamming the line. Move it aside to inspect later, and the queue drains itself.' }
      ]
    },
    {
      title: 'Monitoring says Jenkins is DOWN',
      lines: ['prometheus: target jenkins DOWN (6m)', 'cloudflared: connection lost', 'site: 200 OK, errors 0.02%'],
      options: [
        { t: 'Ack it, fix it after sleep, stop this alert paging at night', k: 'best', why: 'Users are fine and nothing’s on fire. A page should mean a human is needed right now, so fix the alert too.' },
        { t: 'Restart the tunnel now, then go back to bed', k: 'ok', why: 'It’s harmless, but this alert will wake you again next week.' },
        { t: 'Silence all alerts for a week', k: 'bad', why: 'Nice and quiet, right up until the real outage that nobody hears about.' }
      ]
    },
    {
      title: 'GitHub says an AWS key was pushed to a public repo',
      lines: ['secret scanning: AWS access key detected', 'pushed 4 minutes ago', 'CloudTrail: RunInstances x12 from an unknown IP'],
      options: [
        { t: 'Force-push to remove the commit', k: 'bad', why: 'Bots scraped it within seconds, and someone is already using it. The key is still live.' },
        { t: 'Terminate the 12 instances first', k: 'ok', why: 'Good instinct, wrong order. While the key works, they can launch 12 more.' },
        { t: 'Deactivate the key, then audit and clean up', k: 'best', why: 'Cut off access first. Then read CloudTrail, remove what they launched, and rotate properly.' }
      ]
    },
    {
      title: 'Traffic is 40 times normal, and all of it hits /login',
      lines: ['rps: 41,200', 'top source: one /24 = 81% of requests', 'POST /login: 99% returning 401'],
      options: [
        { t: 'Rate-limit and block that range at the edge', k: 'best', why: 'This isn’t popularity, it’s credential stuffing. Stop it before it reaches your servers.' },
        { t: 'Scale up and keep watching', k: 'ok', why: 'The site stays up, and you’re now paying to serve your attacker.' },
        { t: 'Take the site down until morning', k: 'bad', why: 'Congratulations, you’ve done the attacker’s job for them.' }
      ]
    }
  ];

  var DOWNTIME = { best: 4, ok: 18, bad: 45, late: 30 };
  var VERDICT = { best: 'Good call.', ok: 'It works, but…', bad: 'Oh no.', late: 'Too slow. You froze.' };

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  window.LightsOnGame = function (root, opts) {
    var sim = opts.sim, audio = opts.audio;
    var state = null, timer = null;

    function show(nodes, focus) {
      clearInterval(timer);
      root.textContent = '';
      nodes.forEach(function (n) { root.appendChild(n); });
      if (focus) focus.focus({ preventScroll: true });
      opts.onChange();
    }

    function button(text, cls, fn) {
      var b = el('button', 'btn ' + (cls || ''), text);
      b.type = 'button';
      b.addEventListener('click', fn);
      return b;
    }

    function intro() {
      var p = el('p', 'oc-intro', 'Five incidents. ' + SECONDS + ' seconds each. Every wrong call hits the city on the right, and users are watching the clock.');
      var go = button('Answer the page', 'btn-primary', start);
      show([p, go]);
    }

    function start() {
      state = { list: shuffle(POOL).slice(0, ROUNDS), i: 0, right: 0, down: 0 };
      round();
    }

    function round() {
      var q = state.list[state.i], left = SECONDS;
      audio.pager();

      var head = el('div', 'oc-head');
      head.appendChild(el('span', '', 'Incident ' + (state.i + 1) + ' of ' + ROUNDS));
      var clock = el('b', 'oc-clock', left + 's');
      head.appendChild(clock);
      var track = el('div', 'oc-track'), bar = el('i');
      track.appendChild(bar);

      var title = el('h3', 'oc-title', q.title);
      title.tabIndex = -1;
      var pre = el('pre', 'oc-lines', q.lines.join('\n'));
      var choices = el('div', 'oc-choices');
      shuffle(q.options).forEach(function (o) {
        choices.appendChild(button(o.t, 'oc-choice', function () { answer(o); }));
      });
      show([head, track, title, pre, choices], title);

      var began = performance.now();
      timer = setInterval(function () {
        var t = (performance.now() - began) / 1000, remain = Math.max(0, SECONDS - t);
        bar.style.width = (remain / SECONDS * 100) + '%';
        clock.textContent = Math.ceil(remain) + 's';
        root.classList.toggle('urgent', remain < 7);
        if (remain <= 0) answer({ k: 'late', t: '', why: 'While you were deciding, the site stayed down. At 3 a.m., a safe rollback now beats a perfect plan later.' });
      }, 100);
    }

    function answer(o) {
      clearInterval(timer);
      root.classList.remove('urgent');
      state.down += DOWNTIME[o.k];
      if (o.k === 'best') { state.right++; audio.good(); }
      else {
        audio.bad();
        sim.scare(o.k === 'ok' ? 1 : 4);
      }

      var result = el('p', 'oc-result ' + o.k, VERDICT[o.k]);
      result.tabIndex = -1;
      var q = state.list[state.i];
      var title = el('h3', 'oc-title small', q.title);
      var why = el('p', 'oc-why', o.why);
      var best = q.options.filter(function (x) { return x.k === 'best'; })[0];
      var nodes = [title, result, why];
      if (o.k !== 'best') nodes.push(el('p', 'oc-best', 'What I’d do: ' + best.t + '.'));
      var last = state.i === ROUNDS - 1;
      nodes.push(el('p', 'oc-down', 'Downtime so far: ' + state.down + ' min'));
      nodes.push(button(last ? 'See how you did' : 'Next incident', 'btn-primary', function () {
        if (last) finish(); else { state.i++; round(); }
      }));
      show(nodes, result);
    }

    function finish() {
      var r = state.right, title, line;
      if (r === ROUNDS) { title = 'You can have my pager.'; line = 'A clean sweep. If you’re hiring, we should talk. If you’re job hunting too, well, this is awkward.'; }
      else if (r >= 3) { title = 'You’d survive the night.'; line = 'Tired, but employed. The ones you missed are the ones you only learn by getting them wrong once.'; }
      else { title = 'Go back to bed. I’ve got it.'; line = 'No shame in that. Most of these rules come from somebody’s terrible night, which is why teams hire people who’ve already had them.'; }

      var stamp = el('p', 'oc-score', r + '/' + ROUNDS + ' best calls · ' + state.down + ' min of downtime');
      var h = el('h3', 'oc-title', title); h.tabIndex = -1;
      var p = el('p', 'oc-why', line);
      var row = el('div', 'oc-actions');
      var text = 'I held the pager on Sudhin Swain’s portfolio: ' + r + '/' + ROUNDS + ' best calls, ' + state.down + ' min of downtime. Can you beat it? ' + location.href.split('#')[0];
      var share = button('Copy my score', '', function () {
        var done = function (m) { share.textContent = m; };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { done('Copied'); }, function () { done('Couldn’t copy'); });
        else done('Couldn’t copy');
      });
      var mail = el('a', 'btn btn-primary', 'Tell Sudhin your score');
      mail.href = 'mailto:sudhinswain@gmail.com?subject=' + encodeURIComponent('I held your pager: ' + r + '/' + ROUNDS) + '&body=' + encodeURIComponent(text);
      row.appendChild(mail);
      row.appendChild(share);
      row.appendChild(button('Play again', '', start));
      show([stamp, h, p, row], h);
    }

    intro();
    return { start: start };
  };
})();
