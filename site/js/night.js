/* Remembers what this visitor did tonight: achievements, and the handover note at sunrise.
   Kept in memory only. Nothing is stored or sent anywhere. */
(function () {
  'use strict';

  var BADGES = [
    { id: 'kill', name: 'First casualty', how: 'Kill a container' },
    { id: 'monsoon', name: 'Monsoon season', how: 'Let the storm hit' },
    { id: 'wake', name: 'Wake-up call', how: 'Get me paged' },
    { id: 'pager', name: 'Held the pager', how: 'Finish all five incidents' },
    { id: 'shell', name: 'Root access denied', how: 'Type a command into the shell' },
    { id: 'gate', name: 'Stopped at the gate', how: 'Push something bad through the pipeline' },
    { id: 'poke', name: 'Light sleeper', how: 'Poke me five times on my roof' },
    { id: 'train', name: 'Trainspotter', how: 'Click a local train' },
    { id: 'wish', name: 'Make a wish', how: 'Catch a shooting star', secret: true },
    { id: 'dawn', name: 'Stayed till sunrise', how: 'Reach 07:00' }
  ];

  window.LightsOnNight = function (opts) {
    var got = {};
    var stats = { kills: 0, failures: 0, wakes: 0, fastest: null, pokes: 0, commands: 0, game: null };

    function count() { return Object.keys(got).length; }

    function renderCount() {
      opts.counter.textContent = '★ ' + count() + '/' + BADGES.length;
    }

    function renderList() {
      opts.list.textContent = '';
      BADGES.forEach(function (b) {
        var have = !!got[b.id];
        var li = document.createElement('li');
        li.className = have ? 'got' : '';
        var n = document.createElement('b');
        n.textContent = (have ? '★ ' : '☆ ') + (b.secret && !have ? '???' : b.name);
        var h = document.createElement('span');
        h.textContent = b.secret && !have ? 'Keep watching the sky' : b.how;
        li.appendChild(n); li.appendChild(h);
        opts.list.appendChild(li);
      });
    }

    function unlock(id) {
      if (got[id]) return;
      var b = BADGES.filter(function (x) { return x.id === id; })[0];
      if (!b) return;
      got[id] = true;
      renderCount();
      opts.toast('★ ' + b.name, count() + ' of ' + BADGES.length + ' found tonight', 'badge');
    }

    /* The handover note: what you did to my city, signed off at sunrise. */
    function handover(box) {
      var s = stats, lines = [], title;
      if (s.game && s.game.right === s.game.total) title = 'Take the pager. Seriously.';
      else if (s.wakes > 1) title = 'A menace. You woke me ' + s.wakes + ' times.';
      else if (s.wakes === 1) title = 'Chaos engineer, certified.';
      else if (s.failures > 0) title = 'Careful tester. I slept through it.';
      else if (s.game) title = 'Straight to the on-call. Respect.';
      else title = 'Quiet shift. You broke nothing.';

      if (s.failures) lines.push(['Failures you caused', s.failures]);
      if (s.kills) lines.push(['Containers killed', s.kills]);
      if (s.wakes) lines.push(['Times you woke me', s.wakes + (s.fastest !== null ? ' (fastest ' + Math.round(s.fastest) + 's)' : '')]);
      if (s.game) lines.push(['Pager score', s.game.right + '/' + s.game.total + ', ' + s.game.down + ' min down']);
      if (s.pokes) lines.push(['Times you poked me', s.pokes]);
      lines.push(['Achievements', count() + '/' + BADGES.length]);

      box.textContent = '';
      var label = document.createElement('p'); label.className = 'handover-label'; label.textContent = 'Handover note · 07:00';
      var h = document.createElement('h3'); h.textContent = title;
      var dl = document.createElement('dl');
      lines.forEach(function (l) {
        var row = document.createElement('div');
        var dt = document.createElement('dt'); dt.textContent = l[0];
        var dd = document.createElement('dd'); dd.textContent = l[1];
        row.appendChild(dt); row.appendChild(dd); dl.appendChild(row);
      });
      var sign = document.createElement('p'); sign.className = 'handover-sign';
      sign.textContent = stats.failures || stats.game
        ? 'All systems recovered. Now you know how I work. Your move.'
        : 'Most people click something. You read the whole thing, which I also respect.';
      box.appendChild(label); box.appendChild(h); box.appendChild(dl); box.appendChild(sign);
      box.hidden = false;
    }

    renderCount();
    return { stats: stats, unlock: unlock, renderList: renderList, handover: handover };
  };
})();
