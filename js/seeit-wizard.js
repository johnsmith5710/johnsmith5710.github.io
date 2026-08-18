/* ============================================================
   seeit-wizard.js — product selection state machine for See It.

   Talks to the 3-D (or flat) viewer only through update() / dispose().
   Import DATA from seeit-data.js; call startWizard(DATA) once the DOM
   is ready.

   Enhancements over the original inline script:
     - Module extraction (testable, cacheable)
     - Focus moves into the newly opened step panel
     - URL query state so a build can be shared / bookmarked
   ============================================================ */

import { createViewer, supported } from './seeit-3d.js';

/**
 * @param {object} DATA  catalog from seeit-data.js
 * @param {object} [opts]
 * @param {boolean} [opts.syncUrl=true]  write / read query string
 */
export function startWizard(DATA, opts) {
  opts = opts || {};
  var syncUrl = opts.syncUrl !== false;

function $(id) { return document.getElementById(id); }

    function el(tag, cls, html) {
      var n = document.createElement(tag);
      if (cls) { n.className = cls; }
      if (html !== undefined) { n.innerHTML = html; }
      return n;
    }

    function uniq(a) {
      return a.filter(function (v, i) { return a.indexOf(v) === i; });
    }
    function down(a, b) { return b - a; }

    var railBox = $('seeit-rail');
    var panelBox = $('seeit-panel');
    var buildBox = $('build-list');
    var caption = $('scene-caption');
    var viewBox = $('seeit-view');
    var roomBox = $('seeit-rooms');

    // pending until the library answers, then 3d or flat. The wizard runs
    // the same either way; only the picture changes.
    var mode = 'pending';
    var viewer = null;
    var shot = null;

    var TYPES = ['Bathtub', 'Shower Base', 'Seated Base'];

    // A piece is tall or low. That is what sets the height of the wall over
    // it, and the workbook holds the number: 3-1/2 to 5-1/2 in. for a base
    // you walk into, 16 to 20 in. for a bathtub, a seat, or a garden base.
    var STANDS = {
      tall: {label: 'A bathtub or a seat', note: 'you step over a rim'},
      low: {label: 'A low shower base', note: 'you walk straight in'}
    };

    var STEPS = [
      {id: 'alcove', title: 'Alcove', head: 'Your alcove',
       hint: 'Start here. The opening is the one measurement you cannot change.'},
      {id: 'piece', title: 'Bathtub or base', head: 'Bathtub or base',
       hint: 'Everything below fits that opening, whichever line it comes from.'},
      {id: 'drain', title: 'Drain', head: 'Drain location',
       hint: 'Match the drain that is already in the floor.'},
      {id: 'wall', title: 'Wall', head: 'Wall surround',
       hint: 'A wall can come from another line, as long as it suits the opening and the piece under it.'},
      {id: 'panels', title: 'Grab bars', head: 'Grab bar panels',
       hint: 'This wall is reinforced for grab bars. Take the back panel, the side panels, both, or neither.'},
      {id: 'color', title: 'Color', head: 'Colors',
       hint: 'The bathtub or base and the wall are picked apart, so the two can differ.'}
    ];

    // A step that only exists in some builds. It is left out of the rail
    // rather than shown greyed, because a greyed step you can never reach
    // reads as a fault.
    var SOMETIMES = {drain: true, panels: true};


    var S, at;
    var focusPending = false;  // set when the open step changes
    var urlTimer = null;

    // ── URL state ──────────────────────────────────────────────────────
    // Compact query keys keep the link short. Only settled answers are
    // written; nulls are omitted. replaceState so ordinary clicking does
    // not fill the history stack.
    function stateToParams() {
      var p = new URLSearchParams();
      if (S.shape === 'corner') {
        p.set('shape', 'corner');
        if (S.width != null) p.set('span', String(S.width));
      } else if (S.width != null && S.depth != null) {
        p.set('w', String(S.width));
        p.set('d', String(S.depth));
      }
      if (S.type) p.set('type', S.type);
      if (S.fixKey) p.set('fix', S.fixKey);
      if (S.drain != null && S.drain !== '') p.set('drain', S.drain);
      if (S.over) p.set('over', S.over);
      if (S.wallKey) p.set('wall', S.wallKey);
      if (S.extras && S.extras.length) p.set('bars', S.extras.join(','));
      if (S.baseColor) p.set('bc', S.baseColor);
      if (S.wallColor) p.set('wc', S.wallColor);
      if (S.room) p.set('room', S.room);
      if (at && at !== 'alcove') p.set('step', at);
      return p;
    }

    function writeUrl() {
      if (!syncUrl) return;
      var p = stateToParams();
      var qs = p.toString();
      var url = qs ? (location.pathname + '?' + qs) : location.pathname;
      if (url !== location.pathname + location.search) {
        history.replaceState(null, '', url);
      }
    }

    function scheduleUrl() {
      if (!syncUrl) return;
      clearTimeout(urlTimer);
      urlTimer = setTimeout(writeUrl, 120);
    }

    function readUrl() {
      if (!syncUrl) return false;
      var p = new URLSearchParams(location.search);
      if (![...p.keys()].length) return false;

      blank();
      if (p.get('shape') === 'corner') {
        S.shape = 'corner';
        var span = parseInt(p.get('span'), 10);
        if (span) { S.width = span; S.depth = span; }
      } else {
        var w = parseInt(p.get('w'), 10);
        var d = parseInt(p.get('d'), 10);
        if (w) { S.shape = 'alcove'; S.width = w; }
        if (d) { S.depth = d; }
      }
      if (p.get('type')) S.type = p.get('type');
      if (p.get('fix')) S.fixKey = p.get('fix');
      if (p.has('drain')) S.drain = p.get('drain');
      if (p.get('over')) S.over = p.get('over');
      if (p.get('wall')) S.wallKey = p.get('wall');
      if (p.get('bars')) {
        S.extras = p.get('bars').split(',').filter(Boolean);
        S.panelsSet = true;
      }
      if (p.get('bc')) { S.baseColor = p.get('bc'); S.colorSet = true; }
      if (p.get('wc')) { S.wallColor = p.get('wc'); S.colorSet = true; }
      if (p.get('room')) S.room = p.get('room');

      clamp();
      var want = p.get('step');
      if (want && can(want)) at = want;
      else {
        var list = open();
        at = list.length ? list[list.length - 1].id : 'alcove';
      }
      return true;
    }

    // ── Focus ──────────────────────────────────────────────────────────
    // When the open step changes, move focus into the panel so keyboard
    // and screen-reader users are not left on a now-stale rail button.
    function focusPanel() {
      if (!panelBox) return;
      var heading = panelBox.querySelector('h2');
      if (heading) {
        if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
        try { heading.focus({ preventScroll: true }); }
        catch (e) { heading.focus(); }
        return;
      }
      var first = panelBox.querySelector('button, [href], input, select, textarea');
      if (first) {
        try { first.focus({ preventScroll: true }); }
        catch (e) { first.focus(); }
      }
    }


    function blank() {
      S = {shape: null, width: null, depth: null, type: null, fixKey: null,
           drain: null, over: null, wallKey: null, extras: [],
           baseColor: null, wallColor: null, panelsSet: false,
           colorSet: false,
           // Scenery. null is the plain alcove the viewer draws itself.
           // clamp() leaves it alone: no product answer can invalidate it.
           room: null};
      at = 'alcove';
    }

    // ── What fits ──────────────────────────────────────────────────────
    function here() {
      if (S.width === null || S.depth === null) { return []; }
      return DATA.fixtures.filter(function (m) {
        return m.shape === S.shape && m.w === S.width && m.d === S.depth;
      });
    }

    function typeList() {
      return TYPES.filter(function (t) {
        return here().some(function (f) { return f.category === t; });
      });
    }

    function ofType() {
      return here().filter(function (f) { return f.category === S.type; });
    }

    function fixture() {
      if (!S.type || S.type === 'none') { return null; }
      return ofType().filter(function (f) {
        return f.number === S.fixKey;
      })[0] || null;
    }

    function variant() {
      var f = fixture();
      if (!f || S.drain === null) { return null; }
      return f.variants.filter(function (v) {
        return v.drain === S.drain;
      })[0] || null;
    }

    // With a piece chosen the height follows from it. With none chosen the
    // customer says what is already there.
    function standing() {
      var f = fixture();
      return f ? f.sits : S.over;
    }

    // A wall suits the opening if it is built for it, cuts down to it, or
    // is named as the partner of a piece that fits it.
    function wallsHere() {
      var key = S.width + 'x' + S.depth;
      var mine = here().map(function (f) { return f.number; });
      return DATA.walls.filter(function (w) {
        if (w.shape === S.shape && w.w === S.width && w.d === S.depth) { return true; }
        if (w.fits.indexOf(key) !== -1) { return true; }
        return w.pairs.some(function (p) { return mine.indexOf(p) !== -1; });
      });
    }

    function wallList() {
      if (S.width === null || S.depth === null) { return []; }
      var want = standing();
      return wallsHere().filter(function (w) { return !want || w.over === want; });
    }

    function wallAt(key) {
      return wallList().filter(function (w) { return w.number === key; })[0] || null;
    }

    function wall() {
      return (!S.wallKey || S.wallKey === 'none') ? null : wallAt(S.wallKey);
    }

    function cutToFit(w) {
      return !(w.w === S.width && w.d === S.depth) &&
             w.fits.indexOf(S.width + 'x' + S.depth) !== -1;
    }

    // A grab bar panel belongs to the line of the wall, and to one face of
    // it. The back panel is as wide as the alcove, the side panels as deep.
    function extraList() {
      var w = wall();
      if (!w) { return []; }
      return DATA.extras.filter(function (e) {
        if (e.line !== w.line) { return false; }
        return e.role === 'back' ? e.inches === S.width : e.inches === S.depth;
      });
    }

    function extrasOn() {
      return extraList().filter(function (e) {
        return S.extras.indexOf(e.number) !== -1;
      });
    }

    function baseColors() { var f = fixture(); return f ? f.colors : []; }
    function wallColors() { var w = wall(); return w ? w.colors : []; }

    // Hold every answer that is still on offer, and drop the ones that are
    // not. Clearing the whole tail on each click threw away answers that
    // were still good. Leaving a stale key made a step look answered when
    // nothing was in fact selected.
    function clamp() {
      var f = fixture();
      if (!f) {
        S.drain = null;
      } else {
        var codes = f.variants.map(function (v) { return v.drain; });
        if (codes.indexOf(S.drain) === -1) {
          // One drain position is not a choice. Take it.
          S.drain = codes.length === 1 ? codes[0] : null;
        }
      }

      if (S.wallKey && S.wallKey !== 'none' && !wallAt(S.wallKey)) {
        S.wallKey = null;
      }

      var offered = extraList().map(function (e) { return e.number; });
      S.extras = S.extras.filter(function (n) { return offered.indexOf(n) !== -1; });
      if (!offered.length) { S.panelsSet = false; }

      var b = baseColors(), c = wallColors();
      if (b.indexOf(S.baseColor) === -1) { S.baseColor = b[0] || null; }
      if (c.indexOf(S.wallColor) === -1) { S.wallColor = c[0] || null; }
      if (!b.length && !c.length) { S.colorSet = false; }
    }

    // ── Which steps are open, and which are answered ───────────────────
    function can(id) {
      var sized = S.width !== null && S.depth !== null;
      var skipping = S.type === 'none' && !!S.over;
      if (id === 'alcove') { return true; }
      if (id === 'piece') { return sized; }
      if (id === 'drain') {
        var f = fixture();
        return !!f && f.variants.length > 1;
      }
      if (id === 'wall') { return sized && (skipping || !!fixture()); }
      if (id === 'panels') { return !!wall() && extraList().length > 0; }
      if (id === 'color') { return !!fixture() || !!wall(); }
      return false;
    }

    function answered(id) {
      if (id === 'alcove') { return S.width !== null && S.depth !== null; }
      if (id === 'piece') {
        return (S.type === 'none' && !!S.over) || !!fixture();
      }
      if (id === 'drain') { return S.drain !== null; }
      if (id === 'wall') { return S.wallKey !== null; }
      if (id === 'panels') { return S.panelsSet; }
      if (id === 'color') { return S.colorSet; }
      return false;
    }

    function open() { return STEPS.filter(function (s) { return can(s.id); }); }

    function railSteps() {
      return STEPS.filter(function (s) { return !SOMETIMES[s.id] || can(s.id); });
    }

    function place(list, id) {
      var i = -1;
      list.forEach(function (s, n) { if (s.id === id) { i = n; } });
      return i;
    }

    function hop(delta) {
      var list = open();
      var t = list[place(list, at) + delta];
      if (t) { at = t.id; draw(); }
    }

    // Go to the first step after this one that has no answer yet. Change an
    // answer that leaves the rest of the build standing and you stay put,
    // so two models can be compared. Change one that knocks the rest out
    // and it carries you to the first gap it made.
    function advance(id) {
      var list = open();
      var i = place(list, id);
      if (i < 0) { return; }
      for (var n = i + 1; n < list.length; n++) {
        if (!answered(list[n].id)) { at = list[n].id; return; }
      }
    }

    // ── Pieces of a panel ──────────────────────────────────────────────
    function group(title, node) {
      var g = el('div', 'seeit-group');
      if (title) { g.appendChild(el('h3', null, title)); }
      g.appendChild(node);
      return g;
    }

    function tiles(items, active, pick) {
      if (!items.length) {
        return el('p', 'seeit-empty', 'Nothing is made in this size.');
      }
      var box = el('div', 'seeit-tiles');
      items.forEach(function (it) {
        var on = String(it.key) === String(active);
        var b = el('button', 'tile' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<strong>' + it.label + '</strong>' +
                      (it.note ? '<span>' + it.note + '</span>' : '');
        b.addEventListener('click', function () { pick(it.key); });
        box.appendChild(b);
      });
      return box;
    }

    function cards(items, isOn, pick) {
      if (!items.length) {
        return el('p', 'seeit-empty', 'Nothing is made in this size.');
      }
      var box = el('div', 'seeit-cards');
      items.forEach(function (it) {
        var on = isOn(it);
        var b = el('button', 'mcard' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<span class="mc-line">' + it.line + '</span>' +
                      '<strong class="mc-name">' + it.name + '</strong>' +
                      (it.size ? '<span class="mc-size">' + it.size + '</span>' : '') +
                      (it.part ? '<span class="mc-part">' + it.part + '</span>' : '') +
                      (it.note ? '<span class="mc-note">' + it.note + '</span>' : '') +
                      (it.flag ? '<span class="mc-flag">' + it.flag + '</span>' : '');
        b.addEventListener('click', function () { pick(it.key); });
        box.appendChild(b);
      });
      return box;
    }

    function swatches(names, active, pick) {
      if (!names.length) {
        return el('p', 'seeit-empty', 'Pick a model first.');
      }
      var box = el('div', 'seeit-swatches');
      names.forEach(function (n) {
        var on = n === active;
        var b = el('button', 'swatch' + (on ? ' is-on' : ''));
        b.type = 'button';
        b.title = n;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.innerHTML = '<img src="' + DATA.colorImages[n] + '" alt="">' +
                      '<span>' + n + '</span>';
        b.addEventListener('click', function () { pick(n); });
        box.appendChild(b);
      });
      return box;
    }

    function note(text) { return el('p', 'seeit-note-inline', text); }

    function byKey(key) { return function (it) { return it.key === key; }; }

    // ── The panels ─────────────────────────────────────────────────────
    function widthItems() {
      var ws = uniq(DATA.fixtures.filter(function (m) {
        return m.shape === 'alcove';
      }).map(function (m) { return m.w; })).sort(down);
      var items = ws.map(function (w) {
        return {key: 'a' + w, label: w + '″', note: 'wide'};
      });
      if (DATA.fixtures.some(function (m) { return m.shape === 'corner'; })) {
        items.push({key: 'corner', label: 'Corner', note: 'across the corner'});
      }
      return items;
    }

    function depthItems() {
      if (S.shape === null) { return []; }
      var list = DATA.fixtures.filter(function (m) {
        return m.shape === S.shape && (S.shape === 'corner' || m.w === S.width);
      });
      return uniq(list.map(function (m) {
        return S.shape === 'corner' ? m.w : m.d;
      })).sort(down).map(function (d) {
        return {key: d, label: d + '″',
                note: S.shape === 'corner' ? 'along each wall' : 'deep'};
      });
    }

    function panelAlcove() {
      panelBox.appendChild(group('Width, or a corner', tiles(
        widthItems(),
        S.shape === 'corner' ? 'corner' : (S.width === null ? '' : 'a' + S.width),
        function (k) {
          var shape = k === 'corner' ? 'corner' : 'alcove';
          var width = k === 'corner' ? null : parseInt(k.slice(1), 10);
          // Clicking the answer you already gave must not wipe the build.
          if (S.shape === shape && (shape === 'corner' || S.width === width)) {
            return;
          }
          S.shape = shape; S.width = width;
          S.depth = null; S.type = null; S.fixKey = null; S.over = null;
          S.wallKey = null;
          draw();
        })));

      if (S.shape !== null) {
        panelBox.appendChild(group(
          S.shape === 'corner' ? 'Along each wall' : 'Depth',
          tiles(depthItems(), S.depth === null ? '' : S.depth, function (k) {
            if (S.depth === k) { return; }
            S.depth = k;
            if (S.shape === 'corner') { S.width = k; }
            S.type = null; S.fixKey = null; S.over = null; S.wallKey = null;
            advance('alcove');
            draw();
          })));
      }
    }

    function panelPiece() {
      var items = typeList().map(function (t) {
        var n = here().filter(function (f) { return f.category === t; }).length;
        return {key: t, label: t, note: n + (n === 1 ? ' model' : ' models')};
      });
      // Replacing only the wall is a real job, so it needs a way through.
      items.push({key: 'none', label: 'None', note: 'wall only'});

      panelBox.appendChild(group('Which piece', tiles(
        items, S.type === null ? '' : S.type, function (k) {
          if (S.type === k) { return; }
          S.type = k; S.fixKey = null; S.over = null; S.wallKey = null;
          draw();
        })));

      if (S.type === 'none') {
        // Skipping the piece still leaves a question: the wall has to be
        // the right height for whatever is staying. Ask it here, next to
        // the choice that raised it, not two steps later.
        panelBox.appendChild(group('What is already there', tiles(
          ['tall', 'low'].map(function (k) {
            return {key: k, label: STANDS[k].label, note: STANDS[k].note};
          }), S.over || '', function (k) {
            S.over = k; S.wallKey = null;
            advance('piece');
            draw();
          })));
      } else if (S.type) {
        panelBox.appendChild(group('Model', cards(
          ofType().map(function (f) {
            return {key: f.number, line: f.lineName, name: f.description,
                    size: f.size, part: f.number, note: f.note};
          }), byKey(S.fixKey), function (k) {
            S.fixKey = k;
            advance('piece');
            draw();
          })));
      }
    }

    function panelDrain() {
      var f = fixture();
      panelBox.appendChild(group(null, tiles(
        (f ? f.variants : []).map(function (v) {
          return {key: v.drain, label: v.label, note: v.number};
        }), S.drain === null ? '' : S.drain, function (k) {
          S.drain = k;
          advance('drain');
          draw();
        })));
    }

    function panelWall() {
      var f = fixture();
      var stands = standing();
      panelBox.appendChild(note(f
        ? 'The ' + f.description.toLowerCase() + ' sets the height, so these ' +
          'are the walls that go over ' + STANDS[stands].label.toLowerCase() + '.'
        : 'These are the walls that go over ' +
          STANDS[stands].label.toLowerCase() + '.'));

      // A few openings have a bathtub or a base but no wall made to match.
      // Say so, rather than leave one lonely card with no explanation.
      if (!wallList().length) {
        panelBox.appendChild(note('No surround is made for a ' + S.width +
          '″ × ' + S.depth + '″ opening at this height. Call us and we will ' +
          'go through what else will work.'));
      }

      var list = wallList().map(function (w) {
        return {key: w.number, line: w.lineName, name: w.description,
                size: w.size, part: w.number, note: w.note,
                flag: cutToFit(w) ? 'Cut to fit' : ''};
      });
      list.push({key: 'none', line: 'No surround',
                 name: 'Keep the walls you have', size: '', part: ''});

      panelBox.appendChild(group('Model', cards(list, byKey(S.wallKey),
        function (k) {
          S.wallKey = k;
          advance('wall');
          draw();
        })));

      var w = wall();
      if (w && f && w.line !== f.line) {
        panelBox.appendChild(note('This puts a ' + w.lineName + ' wall over a ' +
          f.lineName + ' ' + f.category.toLowerCase() +
          '. The sizes match, so the two go together.'));
      }
    }

    function panelPanels() {
      // More than one panel can go on a wall, so this list toggles rather
      // than picks. It does not carry you on by itself: use Next when the
      // wall has what you want on it.
      panelBox.appendChild(group(null, cards(
        extraList().map(function (e) {
          return {key: e.number, line: e.lineName, name: e.description,
                  part: e.number};
        }),
        function (it) { return S.extras.indexOf(it.key) !== -1; },
        function (k) {
          var i = S.extras.indexOf(k);
          if (i === -1) { S.extras.push(k); } else { S.extras.splice(i, 1); }
          S.panelsSet = true;
          draw();
        })));
    }

    function panelColor() {
      var f = fixture(), w = wall();
      if (f) {
        panelBox.appendChild(group(f.category + ', ' + f.description,
          swatches(baseColors(), S.baseColor, function (n) {
            S.baseColor = n; S.colorSet = true; advance('color'); draw();
          })));
      }
      if (w) {
        panelBox.appendChild(group('Wall surround, ' + w.description,
          swatches(wallColors(), S.wallColor, function (n) {
            S.wallColor = n; S.colorSet = true; advance('color'); draw();
          })));
      }
      if (f && w) {
        panelBox.appendChild(note('Each list holds the colors that piece is ' +
          'made in. The two do not have to match.'));
      }
    }

    var PANELS = {alcove: panelAlcove, piece: panelPiece, drain: panelDrain,
                  wall: panelWall, panels: panelPanels, color: panelColor};

    // ── The rail, the build, and the drawing ───────────────────────────
    function rail() {
      railBox.innerHTML = '';
      railSteps().forEach(function (s, i) {
        var open_ = s.id === at;
        var done = answered(s.id);
        var b = el('button', (open_ ? 'is-here' : '') + (done ? ' is-done' : ''));
        b.type = 'button';
        b.disabled = !can(s.id);
        if (open_) { b.setAttribute('aria-current', 'step'); }
        b.innerHTML = '<span class="rail-n">' +
                      (done ? '✓' : (i + 1)) + '</span>' + s.title;
        b.addEventListener('click', function () { at = s.id; focusPending = true; draw(); });
        railBox.appendChild(b);
      });
    }

    function navBar() {
      var list = open();
      var i = place(list, at);
      var bar = el('div', 'seeit-nav');

      var back = el('button', 'seeit-btn', '&larr; Back');
      back.type = 'button';
      back.disabled = i <= 0;
      back.addEventListener('click', function () { hop(-1); });

      var again = el('button', 'seeit-btn', 'Start again');
      again.type = 'button';
      again.addEventListener('click', function () { blank(); draw(); });

      var next = el('button', 'seeit-btn seeit-btn-go', 'Next &rarr;');
      next.type = 'button';
      next.disabled = i < 0 || i >= list.length - 1;
      next.addEventListener('click', function () { hop(1); });

      bar.appendChild(back);
      bar.appendChild(again);
      bar.appendChild(el('span', 'spacer'));
      bar.appendChild(next);
      panelBox.appendChild(bar);
    }

    function row(term, main, sub) {
      buildBox.appendChild(el('dt', null, term));
      buildBox.appendChild(el('dd', main ? null : 'is-empty', main
        ? main + (sub ? '<span>' + sub + '</span>' : '')
        : '—'));
    }

    function build() {
      var f = fixture(), w = wall(), v = variant(), x = extrasOn();
      buildBox.innerHTML = '';

      row('Opening', (S.width === null || S.depth === null) ? '' :
        (S.shape === 'corner'
          ? S.width + '″ × ' + S.depth + '″ corner'
          : S.width + '″ × ' + S.depth + '″ alcove'), '');

      if (S.type === 'none') {
        row('Base', 'None', S.over ? 'Wall only, over ' +
            STANDS[S.over].label.toLowerCase() : 'Wall only');
      } else {
        // Until the drain is picked the part number is still the pair, so
        // show the pair. Naming one of them would be a choice nobody made.
        row(f ? f.category : 'Base', f ? (v ? v.number : f.number) : '',
            f ? f.lineName + ' · ' + f.size +
                (v && v.drain ? ' · ' + v.label + ' drain' : '') +
                (S.baseColor ? ' · ' + S.baseColor : '') : '');
      }

      row('Surround', w ? w.number : (S.wallKey === 'none' ? 'None' : ''),
          w ? w.lineName + ' · ' + w.size +
              (S.wallColor ? ' · ' + S.wallColor : '') : '');

      // Triumph is the only line with grab bar panels, so for 39 of the 40
      // walls the step never opens and there is nothing to answer. That is a
      // settled None, not a blank: a dash here reads as a question still
      // outstanding on an otherwise finished list.
      row('Grab bars',
          x.length ? x.map(function (e) { return e.number; }).join('  ')
                   : (S.wallKey !== null &&
                      (S.panelsSet || S.wallKey === 'none' ||
                       !extraList().length) ? 'None' : ''),
          x.length ? x.map(function (e) { return e.description; }).join(', ') : '');
    }

    // ── The viewer ─────────────────────────────────────────────────────
    // Everything above this line is about products. Everything below hands
    // the answer to whatever is drawing it. The whole contract is update()
    // and dispose(), so a hosted configurator could take the same job over
    // without any of the logic above knowing.
    function forViewer() {
      var f = fixture(), w = wall();
      return {
        shape: S.shape || 'alcove',
        opening: {w: S.width || 60, d: S.depth || 32},
        fixture: f ? {part: f.number, box: f.box, category: f.category,
                      sits: f.sits, color: S.baseColor} : null,
        wall: w ? {part: w.number, box: w.box, color: S.wallColor} : null,
        bars: extrasOn().map(function (e) { return e.role; }),
        room: S.room
      };
    }

    // ── The room ───────────────────────────────────────────────────────
    // Scenery, and kept outside the wizard for that reason: it answers no
    // step, joins no build list, and changes nothing about what fits. So it
    // needs no rule in can(), answered(), or clamp().
    //
    // The picker only appears when there is a room to choose and the 3D view
    // is the one running. The flat fallback is a photograph of a part; it has
    // no room to put it in.
    function roomPicker() {
      if (!roomBox) { return; }
      roomBox.innerHTML = '';
      if (mode !== '3d' || !DATA.rooms.length) {
        roomBox.hidden = true;
        return;
      }
      roomBox.hidden = false;
      roomBox.appendChild(el('span', 'seeit-rooms-label', 'Room'));
      var choices = [{id: null, name: 'Plain alcove'}].concat(DATA.rooms);
      choices.forEach(function (c) {
        var b = el('button', 'room-chip', c.name);
        b.type = 'button';
        var on = c.id === S.room;
        if (on) { b.classList.add('is-active'); }
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.addEventListener('click', function () {
          if (c.id === S.room) { return; }
          S.room = c.id;
          roomPicker();
          scene();
        });
        roomBox.appendChild(b);
      });
    }

    // No WebGL, or the library did not load. Fall back to the still that
    // was rendered for this part.
    function flatShot() {
      var f = fixture(), w = wall(), piece = f || w;
      if (!shot) {
        viewBox.innerHTML = '';
        shot = document.createElement('img');
        shot.className = 'seeit-shot';
        shot.addEventListener('error', function () {
          shot.classList.add('is-blank');
        });
        shot.addEventListener('load', function () {
          shot.classList.remove('is-blank');
        });
        viewBox.appendChild(shot);
      }
      shot.alt = piece ? piece.lineName + ' ' + piece.description : '';
      shot.src = '../images/renders/' +
                 (piece ? piece.number.split(' / ')[0] : 'room') + '.jpg';
    }

    function scene() {
      if (mode === '3d' && viewer) { viewer.update(forViewer()); }
      else if (mode === 'flat') { flatShot(); }

      var f = fixture(), w = wall();
      var say = [];
      if (w) {
        say.push(w.lineName + ' ' + w.description.toLowerCase() +
                 (S.wallColor ? ' in ' + S.wallColor : ''));
      }
      if (f) {
        say.push(f.lineName + ' ' + f.description.toLowerCase() +
                 (S.baseColor ? ' in ' + S.baseColor : ''));
      }
      var text = say.length
        ? say.join(', over the ') + '.'
        : 'Pick the size of your opening to start.';
      caption.textContent = text;
      var live = $('seeit-live');
      if (live && text !== live.textContent) {
        live.textContent = text;
      }
    }

    function draw() {
      var prevStep = at;
      clamp();
      // A step can close under you when an earlier answer changes. Fall
      // back to the last step that is still open.
      if (!can(at)) {
        var list = open();
        at = list.length ? list[list.length - 1].id : 'alcove';
      }
      var stepChanged = (prevStep !== at) || focusPending;
      focusPending = false;

      rail();
      var s = STEPS.filter(function (x) { return x.id === at; })[0];
      panelBox.innerHTML = '';
      panelBox.appendChild(el('h2', null, s.head));
      panelBox.appendChild(el('p', 'panel-hint', s.hint));
      PANELS[at]();
      navBar();
      build();
      // Rebuilt with the rest, so that "Start again" cannot leave the old
      // room marked active while the picture has gone back to the plain
      // alcove. blank() clears S.room, and this is what shows that.
      roomPicker();
      scene();
      scheduleUrl();
      if (stepChanged) {
        // Defer so the browser finishes inserting the new controls first.
        requestAnimationFrame(function () { focusPanel(); });
      }
    }

    // Bring the room up if the browser can hold it. Nothing here can stop
    // the wizard: every path ends with a picture and a part number.
    (function start() {
      var loading = $('seeit-loading');
      function settled(next) {
        mode = next;
        if (loading && loading.parentNode) { loading.parentNode.removeChild(loading); }
        roomPicker();
        scene();
      }
      try {
        if (!supported()) { throw new Error('this browser has no WebGL'); }
        viewBox.innerHTML = '';
        createViewer(viewBox, {
          modelPath: '../models/',
          models: DATA.models || [],
          roomPath: '../rooms/',
          rooms: DATA.rooms || [],
          textures: DATA.colorImages || {}
        }).then(function (v) {
          viewer = v;
          settled('3d');
        }).catch(function () {
          settled('flat');
        });
      } catch (err) {
        settled('flat');
      }
    })();

    // Hydrate from the query string when present; otherwise start blank.
    if (!readUrl()) {
      blank();
    }
    draw();
}
