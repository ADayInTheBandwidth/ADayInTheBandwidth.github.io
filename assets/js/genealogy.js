/* ==========================================================================
   Academic genealogy as a 9-stage CMOS ring oscillator.
   Vanilla JS + SVG. Data comes from _data/genealogy.yml via _includes/genealogy.html.

   Desktop: the ring is folded like a real schematic: X1..X5 left to right on
   top (M.S. lineage up to the common ancestor), X6..X9 right to left below
   (Ph.D. lineage back down), feedback up the left side. Phones: one column.
   Scroll scrubs a pulse through the chain (reversible). At the end the output
   rings, the sheet zooms out, the pulse whooshes back along the feedback wire
   and the ring free-runs until you scroll back up.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('.geno');
  if (!root || !window.SVGElement || !window.requestAnimationFrame) return;

  var people;
  try {
    people = JSON.parse(root.querySelector('.geno-data').textContent);
  } catch (e) {
    return;
  }
  // The last entry repeats the first one: it only marks where the loop closes.
  if (people.length > 1 && people[people.length - 1].name === people[0].name) {
    people = people.slice(0, -1);
  }
  var N = people.length;
  if (N < 3) return;

  var APEX = people.findIndex(function (p) { return p.direction === 'apex'; });
  var NS = 'http://www.w3.org/2000/svg';
  var q = function (s) { return root.querySelector(s); };
  var track = q('.geno-track'), pane = q('.geno-pane'), world = q('.geno-world'),
      svg = q('.geno-svg'), cardsBox = q('.geno-cards'), scopeSvg = q('.geno-scope__svg'),
      probeLbl = q('.geno-scope__probe'), timeLbl = q('.geno-scope__time'), scopeEl = q('.geno-scope'),
      caption = q('.geno-caption'), replayBtn = q('.geno-replay'), heading = q('.geno__heading');

  var NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven'];
  var CAPTION = (APEX >= 0 ? 'Both lineages meet at ' + people[APEX].name + '. ' : '') +
      (NUM[N] || N) + ' stages, one loop — it oscillates.';

  // Finale timeline (ms) and free-run lap time.
  var ZOOM_AT = 650, RING_DRAW = 900, WHOOSH_AT = 1350, WHOOSH = 620, LAP = 4200;
  var WIRE_UNITS = 400;   // wire length (svg units) that counts as one unit of scroll weight

  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* ---------- small helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function el(tag, attrs, parent, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function line(p, x1, y1, x2, y2, cls) {
    return el('line', { x1: x1, y1: y1, x2: x2, y2: y2, 'class': cls || 'geno-s' }, p);
  }
  function txt(p, x, y, s, cls, extra) {
    var a = { x: x, y: y, 'class': 'geno-t ' + (cls || '') };
    for (var k in extra || {}) a[k] = extra[k];
    return el('text', a, p, s);
  }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function initials(name) {
    return name.split(/\s+/).filter(function (w) { return !/^[A-Z]\.$/.test(w); })
      .map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
  }
  function lastName(name) { var w = name.split(/\s+/); return w[w.length - 1]; }

  /* ---------- geometry ---------- */
  var G, S;
  // Each stage: X = drain/source spine, T = top of the stage, D = +1 (input on the
  // left) or -1 (mirrored: input on the right, used for the return row).
  function makeGeom(wide) {
    var g;
    if (wide) {
      g = { wide: true, P: 260, top: 290, bot: 550 };
      g.n1 = Math.ceil(N / 2);                       // stages on the top row
      g.col = function (i) { return i < g.n1 ? i : N - 1 - i; };
      g.SX = function (i) { return 220 + g.col(i) * g.P; };
      g.T = function (i) { return i < g.n1 ? g.top : g.bot; };
      g.D = function (i) { return i < g.n1 ? 1 : -1; };
      g.FBX = g.SX(0) - 130;                         // feedback column, left edge
      g.TURN = g.SX(g.n1 - 1) + 110;                 // turn-around column, right edge
      g.W = g.SX(g.n1 - 1) + 200;
      g.H = 900;
    } else {
      g = { wide: false, P: 390, top: 120 };
      g.SX = function () { return 236; };
      g.T = function (i) { return g.top + i * g.P; };
      g.D = function () { return 1; };
      g.JOG = 236 - 110;                             // inter-stage jog column
      g.FBX = 236 - 160;                             // feedback column (left edge)
      g.RY = 192;                                    // routing row below each stage
      g.W = 420;
      g.H = g.T(N - 1) + 520;
    }
    return g;
  }
  // instance box of stage i: { x, w } in sheet units
  function boxOf(i) {
    var X = G.SX(i), d = G.D(i);
    return { x: d > 0 ? X - 86 : X - 44, w: 130, cx: X - 21 * d };
  }

  /* ---------- drawing ---------- */
  function build() {
    G = makeGeom(track.clientWidth >= 960);
    S = { stages: [], cards: [], routes: {} };
    svg.textContent = '';
    cardsBox.textContent = '';
    svg.setAttribute('viewBox', '0 0 ' + G.W + ' ' + G.H);
    svg.setAttribute('width', G.W);
    svg.setAttribute('height', G.H);
    world.style.width = G.W + 'px';
    world.style.height = G.H + 'px';
    root.classList.toggle('geno--wide', G.wide);

    var defs = el('defs', {}, svg);
    var pat = el('pattern', { id: 'geno-dots', width: 10, height: 10, patternUnits: 'userSpaceOnUse' }, defs);
    el('circle', { cx: 1, cy: 1, r: 0.8, 'class': 'geno-gdot' }, pat);
    var f = el('filter', { id: 'geno-glow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, defs);
    el('feGaussianBlur', { stdDeviation: 3.5, result: 'b' }, f);
    var m = el('feMerge', {}, f);
    el('feMergeNode', { 'in': 'b' }, m);
    el('feMergeNode', { 'in': 'SourceGraphic' }, m);

    el('rect', { x: 0, y: 0, width: G.W, height: G.H, 'class': 'geno-paper' }, svg);
    el('rect', { x: 10, y: 10, width: G.W - 20, height: G.H - 20, fill: 'url(#geno-dots)' }, svg);

    drawFrame();
    drawHeader();
    S.wires = el('g', { 'class': 'geno-wires' }, svg);
    for (var i = 0; i < N; i++) S.stages.push(drawStage(i));
    drawRoutes();
    drawTitleBlock();
    drawOverviewLabels();

    S.pulse = el('g', { 'class': 'geno-pulse' }, svg);
    S.trail = [];
    for (var j = 0; j < 6; j++) {
      S.trail.push(el('circle', { r: 4.5 - j * 0.55, 'class': 'geno-pulse__trail', opacity: 0 }, svg));
    }
    S.pGlow = el('circle', { r: 9, 'class': 'geno-pulse__glow', filter: 'url(#geno-glow)' }, S.pulse);
    S.pCore = el('circle', { r: 3.6, 'class': 'geno-pulse__core' }, S.pulse);

    buildCards();
    buildSegments();
    buildScope();
    placeScope();
    S.kStroke = 0;
  }

  function drawFrame() {
    var g = el('g', { 'class': 'geno-frame' }, svg);
    var o = 10, n = 24, W = G.W, H = G.H, c, r, x, y;
    el('rect', { x: o, y: o, width: W - 2 * o, height: H - 2 * o, 'class': 'geno-s geno-s--frame' }, g);
    el('rect', { x: n, y: n, width: W - 2 * n, height: H - 2 * n, 'class': 'geno-s geno-s--thin' }, g);
    var cols = G.wide ? Math.round(W / 400) : 3;
    for (c = 0; c < cols; c++) {
      x = n + (W - 2 * n) * c / cols;
      if (c > 0) { line(g, x, o, x, n, 'geno-s geno-s--thin'); line(g, x, H - n, x, H - o, 'geno-s geno-s--thin'); }
      var xm = n + (W - 2 * n) * (c + 0.5) / cols;
      txt(g, xm, o + 10, String(c + 1), 'geno-t--zone', { 'text-anchor': 'middle' });
      txt(g, xm, H - o - 4, String(c + 1), 'geno-t--zone', { 'text-anchor': 'middle' });
    }
    var rows = Math.max(3, Math.round((H - 2 * n) / (G.wide ? 420 : 560)));
    for (r = 0; r < rows; r++) {
      y = n + (H - 2 * n) * r / rows;
      if (r > 0) { line(g, o, y, n, y, 'geno-s geno-s--thin'); line(g, W - n, y, W - o, y, 'geno-s geno-s--thin'); }
      var ym = n + (H - 2 * n) * (r + 0.5) / rows + 3;
      var L = String.fromCharCode(65 + r);
      txt(g, o + 7, ym, L, 'geno-t--zone', { 'text-anchor': 'middle' });
      txt(g, W - o - 7, ym, L, 'geno-t--zone', { 'text-anchor': 'middle' });
    }
  }

  function drawHeader() {
    var g = el('g', {}, svg);
    if (G.wide) {
      txt(g, 44, 56, 'LIB  genealogy     CELL  ring_osc_' + N + 'stg     VIEW  schematic', 'geno-t--muted');
      txt(g, G.W - 44, 56, N + ' inverting stages · odd → no stable state', 'geno-t--muted', { 'text-anchor': 'end' });
      txt(g, 44, 84, 'ACADEMIC GENEALOGY', 'geno-t--title');
    } else {
      txt(g, 36, 52, 'genealogy / ring_osc_' + N + 'stg / schematic', 'geno-t--muted');
      txt(g, 36, 80, 'ACADEMIC GENEALOGY', 'geno-t--title');
    }
  }

  function drawStage(i) {
    var T = G.T(i), X = G.SX(i), d = G.D(i), apex = i === APEX, p = people[i], bx = boxOf(i);
    var x = function (o) { return X + d * o; };      // offset along the signal direction
    var anc = d > 0 ? 'start' : 'end';
    var g = el('g', { 'class': 'geno-stage' + (apex ? ' geno-stage--apex' : '') }, svg);
    var box = el('rect', { x: bx.x, y: T - 6, width: bx.w, height: 176, rx: 3, 'class': 'geno-inst' }, g);
    var lbl = txt(g, bx.x, T - 12, null, 'geno-t--inst');
    el('tspan', { 'class': 'geno-t--b' }, lbl, 'X' + (i + 1));
    el('tspan', { dx: 7 }, lbl, p.name);
    if (apex) txt(g, bx.x, T - 30, '◆ COMMON ANCESTOR', 'geno-t--note');

    // VDD rail
    line(g, X, T + 8, X, T + 30);
    line(g, X - 12, T + 8, X + 12, T + 8, 'geno-s geno-s--rail');
    txt(g, x(16), T + 11, 'VDD', 'geno-t--sm', { 'text-anchor': anc });
    // PMOS (bubble on gate)
    line(g, x(-20), T + 30, X, T + 30);
    line(g, x(-20), T + 60, X, T + 60);
    line(g, x(-20), T + 25, x(-20), T + 65, 'geno-s geno-s--ch');
    line(g, x(-27), T + 30, x(-27), T + 60);
    el('circle', { cx: x(-31), cy: T + 45, r: 4, 'class': 'geno-s geno-bub' }, g);
    line(g, x(-35), T + 45, x(-70), T + 45);
    // output spine
    line(g, X, T + 60, X, T + 100);
    // NMOS
    line(g, x(-20), T + 100, X, T + 100);
    line(g, x(-20), T + 130, X, T + 130);
    line(g, x(-20), T + 95, x(-20), T + 135, 'geno-s geno-s--ch');
    line(g, x(-27), T + 100, x(-27), T + 130);
    line(g, x(-27), T + 115, x(-70), T + 115);
    // GND
    line(g, X, T + 130, X, T + 150);
    line(g, X - 12, T + 150, X + 12, T + 150, 'geno-s geno-s--rail');
    line(g, X - 7, T + 155, X + 7, T + 155);
    line(g, X - 2.5, T + 160, X + 2.5, T + 160);
    // shared gate node
    line(g, x(-70), T + 45, x(-70), T + 115);
    el('circle', { cx: x(-70), cy: T + 80, r: 2.6, 'class': 'geno-jn' }, g);
    el('circle', { cx: X, cy: T + 80, r: 2.6, 'class': 'geno-jn' }, g);
    // device labels
    txt(g, x(8), T + 43, 'MP' + (i + 1), 'geno-t--xs', { 'text-anchor': anc });
    txt(g, x(8), T + 53, '2u/30n', 'geno-t--xs geno-t--muted', { 'text-anchor': anc });
    txt(g, x(8), T + 115, 'MN' + (i + 1), 'geno-t--xs', { 'text-anchor': anc });
    txt(g, x(8), T + 125, '1u/30n', 'geno-t--xs geno-t--muted', { 'text-anchor': anc });

    // accent copies: the conducting device lights up
    var pAcc = el('g', { 'class': 'geno-acc', opacity: 0 }, g);
    line(pAcc, x(-20), T + 25, x(-20), T + 65, 'geno-acc__ch');
    line(pAcc, x(-20), T + 30, X, T + 30); line(pAcc, x(-20), T + 60, X, T + 60);
    line(pAcc, X, T + 8, X, T + 30); line(pAcc, X, T + 60, X, T + 80);
    var nAcc = el('g', { 'class': 'geno-acc', opacity: 0 }, g);
    line(nAcc, x(-20), T + 95, x(-20), T + 135, 'geno-acc__ch');
    line(nAcc, x(-20), T + 100, X, T + 100); line(nAcc, x(-20), T + 130, X, T + 130);
    line(nAcc, X, T + 80, X, T + 100); line(nAcc, X, T + 130, X, T + 150);

    // net label with logic level
    var net = txt(g, x(10), T + 75, null, 'geno-t--net', { 'text-anchor': anc });
    el('tspan', {}, net, 'N' + (i + 1));
    var val = el('tspan', { dx: 5, 'class': 'geno-t--val' }, net, '');

    // the instance box opens the person's page (e.g. IEEE Xplore) in a new tab
    if (p.link) {
      g.classList.add('is-link');
      var a = el('a', { href: p.link, target: '_blank', rel: 'noopener', tabindex: -1, 'class': 'geno-inst-link' }, g);
      el('title', {}, a, p.name + ' — open profile');
      el('rect', { x: bx.x, y: T - 26, width: bx.w, height: 196, 'class': 'geno-hit' }, a);
      // hint sits on the gate side, away from the ground symbol
      txt(g, x(-80), T + 165, /ieeexplore/.test(p.link) ? 'IEEE Xplore ↗' : 'profile ↗', 'geno-t--xs geno-t--hint',
          { 'text-anchor': anc });
    }

    // "Deeper" button: continues this person's lineage on another page
    if (p.deeper) {
      var dx0 = bx.x + bx.w + 10, dl = el('a', { href: p.deeper, tabindex: -1, 'class': 'geno-deeper' }, g);
      el('title', {}, dl, 'Deeper genealogy: ' + p.name + ' back to 1622');
      el('rect', { x: dx0, y: T + 12, width: 96, height: 40, rx: 4, 'class': 'geno-deeper__box' }, dl);
      txt(dl, dx0 + 48, T + 30, 'DEEPER ↑', 'geno-t--deeper', { 'text-anchor': 'middle' });
      txt(dl, dx0 + 48, T + 44, 'back to 1622', 'geno-t--xs geno-t--deeper2', { 'text-anchor': 'middle' });
    }

    return { g: g, box: box, pAcc: pAcc, nAcc: nAcc, val: val, init: (i + 1) % 2,
             gate: { x: x(-70), y: T + 80 }, out: { x: X, y: T + 80 }, last: {} };
  }

  function drawRoutes() {
    var T = G.T, SX = G.SX, FBX = G.FBX, i, last = N - 1;
    var lit = el('g', { 'class': 'geno-litg' }, svg);
    function route(key, d, cls) {
      el('path', { d: d, 'class': 'geno-w ' + (cls || '') }, S.wires);
      var lp = el('path', { d: d, 'class': 'geno-lit' }, lit);
      var len = lp.getTotalLength();
      lp.style.strokeDasharray = len + ' ' + len;
      lp.style.strokeDashoffset = len;
      S.routes[key] = { el: lp, len: len, lit: -1, alpha: -1 };
      return S.routes[key];
    }
    var y0 = T(0) + 80;
    route('lead', 'M' + FBX + ' ' + y0 + ' H' + (SX(0) - 70));
    if (G.wide) {
      // top row left->right, turn around on the right, bottom row right->left
      var yb = G.bot + 80, n1 = G.n1;
      for (i = 0; i < last; i++) {
        var a = SX(i), yA = T(i) + 80;
        if (i < n1 - 1) route('r' + i, 'M' + a + ' ' + yA + ' H' + (SX(i + 1) - 70));
        else if (i === n1 - 1) route('r' + i, 'M' + a + ' ' + yA + ' H' + G.TURN + ' V' + yb + ' H' + (SX(i + 1) + 70));
        else route('r' + i, 'M' + a + ' ' + yb + ' H' + (SX(i + 1) + 70));
      }
      route('out', 'M' + SX(last) + ' ' + yb + ' H' + FBX, 'geno-w--fb');
      route('fb', 'M' + FBX + ' ' + yb + ' V' + y0, 'geno-w--fb');
      var my = (y0 + yb) / 2;
      txt(S.wires, FBX - 8, my, 'FEEDBACK · N' + N + ' → X1', 'geno-t--muted geno-t--fbl',
          { 'text-anchor': 'middle', transform: 'rotate(-90 ' + (FBX - 8) + ' ' + my + ')' });
    } else {
      var X = SX(0), RX = X + 70, RY = G.RY;
      for (i = 0; i < last; i++) {
        route('r' + i, 'M' + X + ' ' + (T(i) + 80) + ' H' + RX + ' V' + (T(i) + RY) + ' H' + G.JOG +
              ' V' + (T(i + 1) + 80) + ' H' + (X - 70));
      }
      route('out', 'M' + X + ' ' + (T(last) + 80) + ' H' + RX + ' V' + (T(last) + RY) + ' H' + FBX, 'geno-w--fb');
      route('fb', 'M' + FBX + ' ' + (T(last) + RY) + ' V' + y0, 'geno-w--fb');
      var midY = (y0 + T(last) + RY) / 2;
      txt(S.wires, FBX - 8, midY, 'FEEDBACK  ·  N' + N + ' → X1', 'geno-t--muted geno-t--fbl',
          { 'text-anchor': 'middle', transform: 'rotate(-90 ' + (FBX - 8) + ' ' + midY + ')' });
    }
    txt(S.wires, FBX + 8, y0 - 5, 'N' + N, 'geno-t--net');
  }

  function drawTitleBlock() {
    var g = el('g', { 'class': 'geno-tb' }, svg);
    var rev = root.getAttribute('data-rev-date') || '';
    if (G.wide) {
      // compact block under the scope, bottom-right corner of the sheet
      var s = slot(), w = s.w, x0 = s.x, y0 = G.H - 24 - 8 - 52;
      el('rect', { x: x0, y: y0, width: w, height: 52, 'class': 'geno-s geno-s--frame geno-tb__box' }, g);
      line(g, x0, y0 + 26, x0 + w, y0 + 26, 'geno-s geno-s--thin');
      line(g, x0 + w - 64, y0, x0 + w - 64, y0 + 26, 'geno-s geno-s--thin');
      txt(g, x0 + 8, y0 + 18, 'ACADEMIC GENEALOGY', 'geno-t--tbtitle');
      txt(g, x0 + w - 56, y0 + 17, 'SHEET 1/1', 'geno-t--xs');
      txt(g, x0 + 8, y0 + 43, people[0].name + ' · ring_osc_' + N + 'stg · rev A · ' + rev, 'geno-t--xs');
      return;
    }
    var w = G.W - 48, x0 = G.W - 24 - w;
    var h = 116, y0 = G.T(N - 1) + 366;
    el('rect', { x: x0, y: y0, width: w, height: h, 'class': 'geno-s geno-s--frame geno-tb__box' }, g);
    var rows = [y0 + 34, y0 + 61, y0 + 88];
    rows.forEach(function (y) { line(g, x0, y, x0 + w, y, 'geno-s geno-s--thin'); });
    var cx = x0 + w * 0.64;
    line(g, cx, rows[0], cx, y0 + h, 'geno-s geno-s--thin');
    line(g, x0 + w - 74, y0, x0 + w - 74, rows[0], 'geno-s geno-s--thin');
    txt(g, x0 + 10, y0 + 23, 'ACADEMIC GENEALOGY', 'geno-t--tbtitle');
    txt(g, x0 + w - 66, y0 + 14, 'SHEET', 'geno-t--xs geno-t--muted');
    txt(g, x0 + w - 66, y0 + 28, '1 of 1', 'geno-t--sm');
    var cells = [
      ['DESIGNER', people[0].name, 'REV', 'A'],
      ['CELL', 'ring_osc_' + N + 'stg', 'DATE', rev],
      ['DESC', N + '-stage ring oscillator', 'STAGES', N + (N % 2 ? ' (odd)' : '')]
    ];
    cells.forEach(function (c, k) {
      var y = rows[k] + 17;
      txt(g, x0 + 8, y - 6, c[0], 'geno-t--xs geno-t--muted');
      txt(g, x0 + 8, y + 6, c[1], 'geno-t--sm');
      txt(g, cx + 8, y - 6, c[2], 'geno-t--xs geno-t--muted');
      txt(g, cx + 8, y + 6, c[3], 'geno-t--sm');
    });
  }
  // desktop: the empty bottom-right slot of the folded ring (under X5, right of the bottom row)
  function slot() {
    var x = boxOf(G.n1).cx + 122 + 14;               // right edge of the first bottom-row card + gap
    return { x: x, y: G.bot + 96, w: G.W - 30 - x };
  }

  function drawOverviewLabels() {
    var g = el('g', { 'class': 'geno-ov' }, svg);
    S.ov = g;
    people.forEach(function (p, i) {
      var t;
      if (G.wide) {
        var cx = boxOf(i).cx, y = i < G.n1 ? G.top - 84 : G.bot + 206;
        t = txt(g, cx, y, null, 'geno-t--ov geno-t--ovw', { 'text-anchor': 'middle' });
        el('tspan', { x: cx, 'class': 'geno-t--b' }, t, 'X' + (i + 1));
        el('tspan', { x: cx, dy: 24 }, t, p.name);
      } else t = txt(g, G.W / 2, G.T(i) + 296, 'X' + (i + 1) + ' ' + lastName(p.name), 'geno-t--ov geno-t--ovn',
              { 'text-anchor': 'middle' });
      if (i === APEX) t.classList.add('geno-t--ovapex');
    });
  }

  function buildCards() {
    people.forEach(function (p, i) {
      var side = G.wide ? (i < G.n1 ? 'a' : 'u') : 'b';   // above the top row / under the bottom row / phones
      var c = document.createElement('div');
      c.className = 'geno-card geno-card--' + side + (i === APEX ? ' geno-card--apex' : '');
      var left, top, width;
      if (G.wide) {
        width = 244;
        left = boxOf(i).cx;                        // centre of the stage (CSS shifts by -50%)
        top = side === 'a' ? G.top - 46 : G.bot + 190;
      } else {
        left = G.JOG + 18;
        width = G.W - 30 - left;
        top = G.T(i) + 206;
      }
      c.style.left = left + 'px';
      c.style.top = top + 'px';
      c.style.width = width + 'px';

      var ph = document.createElement('div');
      ph.className = 'geno-card__photo';
      if (p.photo) {
        var img = document.createElement('img');
        img.src = p.photo;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = function () { ph.textContent = initials(p.name); };
        ph.appendChild(img);
      } else {
        ph.textContent = initials(p.name);
      }
      c.appendChild(ph);

      var b = document.createElement('div');
      b.className = 'geno-card__body';
      var prev = people[i - 1];
      var roleLc = (p.role || '').toLowerCase();
      var tag = /^(advisor|student) of/.test(roleLc)
        ? (p.direction === 'up' ? 'M.S. lineage' : 'Ph.D. lineage') : p.role;
      var rel = '';
      if (p.direction === 'up' || p.direction === 'apex') rel = '↑ advisor of ' + prev.name;
      else if (p.direction === 'down') rel = '↓ student of ' + prev.name;
      else if (i === 0) rel = 'start · M.S. lineage goes up ↑';
      add(b, 'geno-card__tag', 'X' + (i + 1) + (tag ? ' · ' + tag : ''));
      var nm = add(b, 'geno-card__name', '');
      if (p.link) {
        var a = document.createElement('a');
        a.href = p.link; a.textContent = p.name; a.tabIndex = -1; a.rel = 'noopener'; a.target = '_blank';
        nm.appendChild(a);
      } else {
        nm.textContent = p.name;
      }
      add(b, 'geno-card__org', p.institution);
      var meta = [p.degree_year, p.phd_institution ? 'Ph.D., ' + p.phd_institution : ''].filter(Boolean).join(' · ');
      if (meta) add(b, 'geno-card__meta', meta);
      if (rel) add(b, 'geno-card__rel', rel);
      if (p.deeper) {
        var dlink = document.createElement('a');
        dlink.className = 'geno-card__deeper';
        dlink.href = p.deeper; dlink.tabIndex = -1;
        dlink.textContent = 'Deeper genealogy → 1622';
        b.appendChild(dlink);
      }
      c.appendChild(b);
      cardsBox.appendChild(c);
      S.cards.push({ el: c, on: null, cur: null });
    });
    function add(parent, cls, text) {
      var d = document.createElement('div');
      d.className = cls; d.textContent = text; parent.appendChild(d);
      return d;
    }
  }

  function placeScope() {
    if (G.wide) {
      var sl = slot();
      world.appendChild(scopeEl);                   // scales and pans with the sheet: never covers a card
      scopeEl.classList.add('geno-scope--sheet');
      scopeEl.style.left = sl.x + 'px';
      scopeEl.style.top = sl.y + 'px';
      scopeEl.style.width = sl.w + 'px';
    } else {
      pane.insertBefore(scopeEl, q('.geno-finale'));
      scopeEl.classList.remove('geno-scope--sheet');
      scopeEl.style.left = scopeEl.style.top = scopeEl.style.width = '';
    }
  }

  /* ---------- timeline segments ---------- */
  function buildSegments() {
    function wire(key) { var r = S.routes[key]; return { type: 'wire', route: r, w: r.len / WIRE_UNITS }; }
    function stage(i, scrub) {
      var long = scrub && i === APEX;
      return { type: 'stage', i: i, w: long ? 1.1 : 0.32, flip: long ? 0.125 : 0.5,
               sw: long ? function (f) { return clamp(f / 0.25, 0, 1); } : function (f) { return f; } };
    }
    var a = [wire('lead')], b = [], i;
    for (i = 0; i < N; i++) {
      a.push(stage(i, true));
      b.push(stage(i, false));
      if (i < N - 1) { a.push(wire('r' + i)); b.push(wire('r' + i)); }
    }
    a.push(wire('out'));
    b.push(wire('out'), wire('fb'), wire('lead'));
    S.scrub = finish(a);
    S.free = finish(b);
    function finish(list) {
      var t = 0;
      list.forEach(function (s) { s.a = t; t += s.w; s.b = t; });
      list.total = t;
      list.stageSeg = [];
      list.forEach(function (s) { if (s.type === 'stage') list.stageSeg[s.i] = s; });
      return list;
    }
    // scope edge positions for the scrub trace: input edge, then one per stage
    S.edges = [0.004 * S.scrub.total];
    for (i = 0; i < N; i++) {
      var sg = S.scrub.stageSeg[i];
      S.edges.push(sg.a + sg.w * sg.flip);
    }
  }
  function locate(list, pos) {
    for (var k = 0; k < list.length; k++) {
      if (pos < list[k].b || k === list.length - 1) {
        return { k: k, f: clamp((pos - list[k].a) / list[k].w, 0, 1) };
      }
    }
    return { k: 0, f: 0 };
  }

  /* ---------- state setters (write DOM only on change) ---------- */
  function setLit(r, frac, alpha) {
    frac = Math.round(frac * 1000) / 1000;
    alpha = Math.round(alpha * 100) / 100;
    if (r.lit !== frac) { r.el.style.strokeDashoffset = r.len * (1 - frac); r.lit = frac; }
    if (r.alpha !== alpha) { r.el.style.opacity = alpha; r.alpha = alpha; }
  }
  function setStage(i, level, switched, hot) {
    var st = S.stages[i], L = st.last;
    var on = switched ? (level ? 'p' : 'n') : '';
    hot = Math.round(hot * 100) / 100;
    var po = on === 'p' ? hot : 0, no = on === 'n' ? hot : 0;
    if (L.po !== po) { st.pAcc.setAttribute('opacity', po); L.po = po; }
    if (L.no !== no) { st.nAcc.setAttribute('opacity', no); L.no = no; }
    if (L.level !== level) { st.val.textContent = '= ' + level; L.level = level; }
    if (L.sw !== switched) { st.g.classList.toggle('is-sw', switched); L.sw = switched; }
    var cur = hot > 0.95;
    if (L.cur !== cur) { st.g.classList.toggle('is-cur', cur); L.cur = cur; }
  }
  function setCard(i, on, cur) {
    var c = S.cards[i];
    if (c.on !== on) { c.el.classList.toggle('is-on', on); c.on = on; }
    if (c.cur !== cur) { c.el.classList.toggle('is-cur', cur); c.cur = cur; }
  }
  function pointOn(route, d) {
    var p = route.el.getPointAtLength(clamp(d, 0, route.len));
    return { x: p.x, y: p.y };
  }
  function placePulse(pt, scale, op) {
    S.pulse.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ') scale(' + scale.toFixed(3) + ')');
    S.pulse.style.opacity = op;
  }
  function hideTrail() { S.trail.forEach(function (c) { c.setAttribute('opacity', 0); }); }
  var lastProbe = '';
  function setProbe(s, time) {
    if (s !== lastProbe) { probeLbl.textContent = s; lastProbe = s; }
    if (time && timeLbl.textContent !== time) timeLbl.textContent = time;
  }

  /* ---------- scrub (scroll driven) ---------- */
  function renderScrub(p) {
    var list = S.scrub, pos = p * list.total, loc = locate(list, pos), k = loc.k, f = loc.f;
    var cur = -1, reached = -1, pt;

    list.forEach(function (sg, j) {
      var ff = j < k ? 1 : j > k ? 0 : f;
      if (sg.type === 'wire') setLit(sg.route, ff, ff > 0 ? 0.9 : 0);
      else {
        sg.s = sg.sw(ff);
        if (sg.s >= 0.5) cur = sg.i;
        if (j < k || (j === k)) reached = sg.i;
      }
    });
    setLit(S.routes.fb, 0, 0);

    for (var i = 0; i < N; i++) {
      var sw = list.stageSeg[i].s >= 0.5;
      setStage(i, sw ? 1 - S.stages[i].init : S.stages[i].init, sw, i === cur ? 1 : 0.35);
      setCard(i, i <= reached, i === reached);
    }

    var sg = list[k];
    if (sg.type === 'wire') {
      pt = pointOn(sg.route, f * sg.route.len);
      placePulse(pt, 1, 1);
    } else {
      var st = S.stages[sg.i], s = sg.s;
      pt = s < 0.5 ? st.gate : st.out;
      placePulse(pt, 1, 0.3 + 0.7 * Math.abs(s - 0.5) * 2);
    }
    hideTrail();
    drawScrubScope(pos);
    setProbe(cur >= 0 ? 'probe N' + (cur + 1) : 'probe N' + N + ' (in)', '50 ps/div');
    return pt;
  }

  /* ---------- finale ---------- */
  var mode = 'scrub', finT = 0, freeT = -1;

  function enterFinale() {
    mode = 'finale';
    finT = 0;
    freeT = -1;
    renderScrub(1);
    setLit(S.routes.lead, 0, 0);
    root.classList.add('is-finale');
  }
  function exitFinale() {
    mode = 'scrub';
    finT = 0;
    freeT = -1;
    root.classList.remove('is-finale', 'is-overview', 'is-closing', 'is-closed');
    caption.textContent = '';
    if (document.activeElement === replayBtn) heading.focus({ preventScroll: true });
    replayBtn.hidden = true;
  }
  function closeLoop() {
    root.classList.add('is-closed');
    caption.textContent = CAPTION;
    replayBtn.hidden = false;
    var b = S.stages[0].g;
    b.classList.remove('is-bump');
    void b.getBoundingClientRect();
    b.classList.add('is-bump');
  }

  function renderFinale(dt) {
    var t = finT, pt, outR = S.routes.out, fb = S.routes.fb, lead = S.routes.lead;
    if (t >= ZOOM_AT && !root.classList.contains('is-overview')) root.classList.add('is-overview');

    if (t < WHOOSH_AT) {
      // the output rings at the bottom of the chain
      pt = pointOn(outR, outR.len);
      var ring = Math.exp(-t / 260) * Math.sin(2 * Math.PI * t / 150);
      placePulse(pt, (1 + 0.8 * ring) * pulseBoost(), 1);
      hideTrail();
      drawRingScope(t);
      setProbe('probe N' + N + ' · ringing', '20 ps/div');
    } else if (t < WHOOSH_AT + WHOOSH) {
      if (!root.classList.contains('is-closing')) root.classList.add('is-closing');
      var u = (t - WHOOSH_AT) / WHOOSH, tot = fb.len + lead.len;
      var at = function (uu) {
        var d = easeInOutCubic(clamp(uu, 0, 1)) * tot;
        return d < fb.len ? pointOn(fb, d) : pointOn(lead, d - fb.len);
      };
      var d = easeInOutCubic(u) * tot;
      setLit(fb, clamp(d / fb.len, 0, 1), 1);
      setLit(lead, clamp((d - fb.len) / lead.len, 0, 1), 1);
      pt = at(u);
      var boost = pulseBoost();
      placePulse(pt, 1.25 * boost, 1);
      S.trail.forEach(function (c, j) {
        var tp = at(u - (j + 1) * 0.03);
        c.setAttribute('cx', tp.x); c.setAttribute('cy', tp.y);
        c.setAttribute('r', (4.5 - j * 0.55) * boost);
        c.setAttribute('opacity', (0.55 - j * 0.08).toFixed(2));
      });
    } else {
      if (freeT < 0) { freeT = 0; hideTrail(); closeLoop(); }
      else freeT += dt * 1000;
      pt = renderFree(freeT);
    }
    return pt;
  }
  function pulseBoost() { return clamp(0.85 / view.s, 1, 6); }

  /* ---------- free-running ring ---------- */
  function renderFree(tau) {
    var list = S.free, tot = list.total;
    var pos = ((tau % LAP) / LAP) * tot, loc = locate(list, pos), k = loc.k, f = loc.f, pt;
    list.forEach(function (sg, j) {
      if (sg.type !== 'wire') return;
      if (j === k) setLit(sg.route, f, 1);
      else {
        var since = (((pos - sg.b) % tot + tot) % tot) / tot * LAP;
        setLit(sg.route, 1, clamp(1 - since / 900, 0, 1) * 0.9);
      }
    });
    for (var i = 0; i < N; i++) {
      var r = flipState(i, tau);
      setStage(i, r.level, true, 0.3 + 0.7 * Math.exp(-r.since / 450));
    }
    var sg = list[k], boost = pulseBoost();
    if (sg.type === 'wire') {
      pt = pointOn(sg.route, f * sg.route.len);
      placePulse(pt, boost, 1);
    } else {
      var st = S.stages[sg.i];
      pt = f < 0.5 ? st.gate : st.out;
      placePulse(pt, boost, 0.3 + 0.7 * Math.abs(f - 0.5) * 2);
    }
    drawFreeScope(tau);
    setProbe('probe N1 · free-running', '500 ps/div');
    return pt;
  }
  // stage i flipped once during the scroll, then once per lap while free-running
  function flipState(i, tau) {
    var sg = S.free.stageSeg[i], tf = (sg.a + sg.w * 0.5) / S.free.total * LAP;
    var n = tau >= tf ? Math.floor((tau - tf) / LAP) + 1 : 0;
    var since = tau >= tf ? (tau - tf) % LAP : 1e9;
    return { level: S.stages[i].init ^ ((1 + n) & 1), since: since, edgeT: tau >= tf ? tau - since : null, n: n };
  }

  /* ---------- oscilloscope ---------- */
  var SC = { W: 240, H: 100 };
  function vy(v) { return (80 - v * 58).toFixed(1); }
  function buildScope() {
    scopeSvg.textContent = '';
    var g = el('g', { 'class': 'geno-sc-grid' }, scopeSvg);
    for (var x = 0; x <= 10; x++) line(g, x * 24, 0, x * 24, SC.H, x === 5 ? 'geno-sc-axis' : 'geno-sc-div');
    for (var y = 0; y <= 8; y++) line(g, 0, y * 12.5, SC.W, y * 12.5, y === 4 ? 'geno-sc-axis' : 'geno-sc-div');
    S.scTrace = el('path', { 'class': 'geno-sc-trace', d: '' }, scopeSvg);
    S.scHead = el('circle', { r: 2.2, 'class': 'geno-sc-head' }, scopeSvg);
  }
  // one edge with a small overshoot: prev -> now, dt since edge start
  function edge(prev, now, dt, ramp, dec, per) {
    if (dt < ramp) return prev + (now - prev) * easeInOutCubic(dt / ramp);
    var x = dt - ramp;
    return now + (now - prev) * 0.12 * Math.exp(-x / dec) * Math.sin(2 * Math.PI * x / per);
  }
  function setTrace(pts) {
    var d = 'M' + pts[0][0].toFixed(1) + ' ' + vy(pts[0][1]);
    for (var i = 1; i < pts.length; i++) d += 'L' + pts[i][0].toFixed(1) + ' ' + vy(pts[i][1]);
    S.scTrace.setAttribute('d', d);
    var h = pts[pts.length - 1];
    S.scHead.setAttribute('cx', h[0].toFixed(1));
    S.scHead.setAttribute('cy', vy(h[1]));
  }
  function drawScrubScope(pos) {
    var tot = S.scrub.total, x0 = 8, span = 226;
    var xc = x0 + (pos / tot) * span, pts = [[0, 0]], ramp = 0.006 * tot, dec = 0.01 * tot, per = 0.016 * tot;
    for (var x = 0; x <= xc + 0.01; x += 1.5) {
      var u = (x - x0) / span * tot, v = 0;
      for (var j = S.edges.length - 1; j >= 0; j--) {
        if (u >= S.edges[j]) {
          var now = j % 2 === 0 ? 1 : 0;
          v = edge(1 - now, now, u - S.edges[j], ramp, dec, per);
          break;
        }
      }
      pts.push([x, v]);
    }
    if (pts.length < 2) pts.push([xc, 0]);
    setTrace(pts);
  }
  function drawRingScope(t) {
    var xe = 70, xc = xe + clamp(t / RING_DRAW, 0, 1) * (SC.W - xe), pts = [];
    for (var x = 0; x <= xc; x += 1.5) {
      var v;
      if (x < xe) v = 1;
      else {
        var dx = x - xe;
        v = dx < 6 ? 1 - easeInOutCubic(dx / 6) : -0.42 * Math.exp(-(dx - 6) / 38) * Math.sin(2 * Math.PI * (dx - 6) / 24);
      }
      pts.push([x, v]);
    }
    setTrace(pts);
  }
  // N1 in steady state (periodic, also before the loop closed) so the scope
  // shows a full square wave at once, like a triggered display; the right edge is "now".
  function drawFreeScope(tau) {
    var sg = S.free.stageSeg[0], tf = (sg.a + sg.w * 0.5) / S.free.total * LAP;
    var win = 5 * LAP, ramp = LAP * 0.06, dec = LAP * 0.05, per = LAP * 0.07, pts = [];
    for (var x = 0; x <= SC.W; x += 1.5) {
      var tt = tau - (SC.W - x) / SC.W * win;
      var n = Math.floor((tt - tf) / LAP) + 1;               // flips of N1 so far (may be negative)
      var level = S.stages[0].init ^ ((1 + n) & 1);
      var edgeT = tf + (n - 1) * LAP;
      pts.push([x, edge(1 - level, level, tt - edgeT, ramp, dec, per)]);
    }
    setTrace(pts);
  }

  /* ---------- camera (springs) ---------- */
  var view = { s: 1, x: 0, y: 0, vs: 0, vx: 0, vy: 0, ready: false, s0: 1, sFit: 0.3 };
  function spring(key, target, k, z, dt) {
    var c = 2 * z * Math.sqrt(k), vk = 'v' + key, steps = 4, h = dt / steps;
    for (var i = 0; i < steps; i++) {
      view[vk] += (k * (target - view[key]) - c * view[vk]) * h;
      view[key] += view[vk] * h;
    }
    var eps = key === 's' ? 0.0004 : 0.25;
    return Math.abs(target - view[key]) > eps || Math.abs(view[vk]) > eps * 4;
  }
  function applyView() {
    world.style.transform = 'translate3d(' + view.x.toFixed(2) + 'px,' + view.y.toFixed(2) + 'px,0) scale(' + view.s.toFixed(4) + ')';
    var k = clamp(0.9 / view.s, 1, 4);
    if (Math.abs(k - S.kStroke) > 0.02) { svg.style.setProperty('--geno-k', k.toFixed(3)); S.kStroke = k; }
  }

  /* ---------- layout / measuring ---------- */
  var topOff = 0, paneW = 0, paneH = 0, D = 1, reduce = false;
  function bleed() {
    // let the drawing use the full window width while the text stays in the column
    track.style.marginLeft = '0px';
    var left = track.getBoundingClientRect().left;
    track.style.width = document.documentElement.clientWidth + 'px';
    track.style.marginLeft = (-left) + 'px';
  }
  function measure() {
    var mh = document.querySelector('.masthead');
    topOff = mh ? mh.offsetHeight : 0;
    root.style.setProperty('--geno-top', topOff + 'px');
    var ft = document.querySelector('.page__footer');
    var ftH = ft && getComputedStyle(ft).position === 'fixed' ? ft.offsetHeight : 0;
    root.style.setProperty('--geno-bottom', ftH + 'px');
    bleed();
    paneW = track.clientWidth;
    view.s0 = G.wide ? Math.min(1.05, (paneW - 24) / G.W) : Math.min(1.35, (paneW - 12) / G.W);
    if (reduce) {
      pane.style.height = Math.ceil(G.H * view.s0) + 'px';
      track.style.height = '';
      return;
    }
    pane.style.height = '';
    paneH = pane.clientHeight;
    // desktop: fit the sheet's height, pan sideways
    if (G.wide) view.s0 = clamp((paneH - 12) / G.H, 0.7, 1.05);
    D = S.scrub.total * (G.wide ? clamp(paneH * 0.55, 260, 420) : clamp(paneH * 0.42, 220, 360));
    track.style.height = Math.round(D + paneH * 1.75) + 'px';
    var capH = G.wide ? 64 : 112, dock = G.wide ? 0 : 124;
    view.sFit = Math.min((paneW - 24) / G.W, (paneH - capH - dock - 12) / G.H);
    view.fitTop = G.wide ? capH : capH + Math.max(0, (paneH - capH - dock - G.H * view.sFit) / 2);
  }

  function sideX(s) { return (paneW - G.W * s) / 2; }

  /* ---------- main loop ---------- */
  var raf = 0, lastNow = 0, visible = true, replaying = false;
  function tick() { if (!raf && visible && !reduce) raf = requestAnimationFrame(frame); }
  function frame(now) {
    raf = 0;
    var dt = lastNow ? Math.min(0.05, (now - lastNow) / 1000) : 1 / 60;
    lastNow = now;
    var scrolled = topOff - track.getBoundingClientRect().top;
    var p = clamp(scrolled / D, 0, 1);

    if (replaying && scrolled < D * 0.5) replaying = false;
    if (mode === 'scrub' && scrolled >= D && !replaying) enterFinale();
    else if (mode === 'finale' && scrolled < D - 60) exitFinale();

    var pt, busy = false;
    if (mode === 'scrub') pt = renderScrub(p);
    else { finT += dt * 1000; pt = renderFinale(dt); busy = true; }

    var ts, tx, ty, k, z;
    if (mode === 'finale' && finT >= ZOOM_AT) {
      ts = view.sFit;
      tx = G.wide ? sideX(ts) : (paneW - G.W * ts) / 2;
      ty = view.fitTop;
      k = 55; z = 0.5;           // soft spring: the sheet settles with a small bounce
    } else {
      ts = view.s0;
      if (G.wide) {
        // follow the pulse sideways; centre vertically when the sheet fits
        tx = G.W * ts <= paneW ? sideX(ts) : clamp(paneW * 0.45 - pt.x * ts, paneW - G.W * ts, 0);
        ty = G.H * ts <= paneH ? (paneH - G.H * ts) / 2 : clamp(paneH * 0.5 - pt.y * ts, paneH - G.H * ts, 0);
      } else {
        tx = (paneW - G.W * ts) / 2;
        ty = clamp(paneH * 0.36 - pt.y * ts, Math.min(0, paneH - G.H * ts), 0);
      }
      k = 240; z = 1;
    }
    if (!view.ready) {
      view.s = ts; view.x = tx; view.y = ty; view.ready = true;
    } else {
      busy = spring('s', ts, k, z, dt) | busy;
      busy = spring('x', tx, k, z, dt) | busy;
      busy = spring('y', ty, k, z, dt) | busy;
    }
    applyView();
    if (busy) tick();
  }

  function renderStatic() {
    // reduced motion: the complete, closed schematic, no scrubbing or oscillation
    root.classList.add('is-closed');
    root.classList.remove('is-finale', 'is-overview', 'is-closing');
    for (var i = 0; i < N; i++) {
      setStage(i, 1 - S.stages[i].init, true, 0.45);
      setCard(i, true, false);
    }
    Object.keys(S.routes).forEach(function (key) { setLit(S.routes[key], 0, 0); });
    S.pulse.style.opacity = 0;
    hideTrail();
    view.s = view.s0;
    view.x = (paneW - G.W * view.s) / 2;
    view.y = 0;
    applyView();
    drawFreeScope(LAP * 7.3);
    setProbe('probe N1 · free-running', '500 ps/div');
    caption.textContent = CAPTION;
    replayBtn.hidden = true;
  }

  /* ---------- setup ---------- */
  function setup() {
    reduce = !!(reduceMQ && reduceMQ.matches);
    root.classList.add('geno--js');
    root.classList.toggle('geno--static', reduce);
    root.classList.remove('is-finale', 'is-overview', 'is-closing', 'is-closed');
    mode = 'scrub'; finT = 0; freeT = -1; view.ready = false;
    bleed();
    build();
    measure();
    if (reduce) renderStatic();
    else { caption.textContent = ''; replayBtn.hidden = true; tick(); }
  }

  var resizeTimer = 0, lastW = 0;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var w = document.documentElement.clientWidth;
      if (w === lastW) return;          // mobile URL-bar show/hide: nothing to relayout
      lastW = w;
      bleed();
      if ((track.clientWidth >= 960) !== G.wide) { setup(); return; }
      measure();
      if (reduce) renderStatic();
      else { view.ready = false; tick(); }
    }, 120);
  });
  window.addEventListener('scroll', tick, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) { lastNow = 0; tick(); }
    }).observe(track);
  }

  replayBtn.addEventListener('click', function () {
    var top = root.getBoundingClientRect().top + window.scrollY - topOff - 16;
    heading.focus({ preventScroll: true });
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' });
    replaying = true;
    exitFinale();
    tick();
  });

  if (reduceMQ) {
    var onChange = function () { setup(); };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onChange);
    else if (reduceMQ.addListener) reduceMQ.addListener(onChange);
  }

  // the theme script can change the header/footer height after we start
  function remeasure() {
    measure();
    if (reduce) renderStatic();
    else { view.ready = false; tick(); }
  }
  window.addEventListener('load', remeasure);
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function () { clearTimeout(ro.t); ro.t = setTimeout(remeasure, 60); });
    ['.masthead', '.page__footer'].forEach(function (sel) {
      var n = document.querySelector(sel);
      if (n) ro.observe(n);
    });
  }

  lastW = document.documentElement.clientWidth;
  setup();
})();
