/* ==========================================================================
   Deeper genealogy: a vertical delay line of buffer stages.
   Vanilla JS + SVG. Data is embedded by _includes/delay-line.html from
   _data/genealogy.yml (me + both branches) and _data/delay_line.json (chain).

   Layout, top to bottom (the signal flows down, back in time):
     X1 (me) ── splits ──> my MS advisor's branch (left) and PhD advisor's branch (right)
                           both merge into D1 = Paul R. Gray
     D1 → D2 → … → D18 (Friedrich Leibniz, 1622) → end of the recorded line
   A proportional year axis on the left (1969 at the top, 1622 at the bottom)
   maps each chain stage to its year.

   Scrolling down moves the pulse front down: every stage above the front is lit.
   Fully reversible. Reduced motion: everything lit, no pulse, no scope.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.querySelector('.dl');
  if (!root || !window.SVGElement) return;
  var data;
  try { data = JSON.parse(root.querySelector('.dl-data').textContent); } catch (e) { return; }
  if (!data.chain || !data.chain.length) return;

  var NS = 'http://www.w3.org/2000/svg';
  var q = function (s) { return root.querySelector(s); };
  var stageEl = q('.dl-stage'), svg = q('.dl-svg'), rowsEl = q('.dl-rows'), card = q('.dl-card'),
      cardBody = q('.dl-card__body'), scope = q('.dl-scope'), scopeSvg = q('.dl-scope__svg'),
      sProbe = q('.dl-scope__probe'), sYear = q('.dl-scope__year'), sName = q('.dl-scope__name');
  var reduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduce = false;

  var ME = (data.me || [])[0] || { name: 'Me' };
  var MS = data.ms || [], PHD = data.phd || [], CHAIN = data.chain;
  var Y0 = CHAIN[CHAIN.length - 1].year, Y1 = CHAIN[0].year;     // 1622 … 1969

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function el(tag, attrs, parent, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function h(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function initials(name) {
    return name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(function (w) { return !/^[A-Z]\.$/.test(w) && !/^(von|van|de)$/.test(w); })
      .map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase();
  }

  /* ---------- geometry (rebuilt on resize) ---------- */
  var G, stages = [], wiresBase, wiresLit, clipRect, pulses = [], curOpen = null;

  function geom() {
    var w = stageEl.clientWidth, narrow = w < 520;
    var g = {
      w: w, narrow: narrow,
      R: narrow ? 92 : 100,          // row pitch
      HW: narrow ? 26 : 30,          // triangle half width
      TH: narrow ? 46 : 52,          // triangle height
      AX: narrow ? 34 : 52,          // year axis
      SX: narrow ? 104 : 156,        // main spine
      SA: narrow ? 30 : 48           // M.S. branch spine (left edge, names to its right)
    };
    g.SB = w - g.SA;                 // Ph.D. branch spine (right edge, names to its left)
    g.cyMe = 54;                                        // X1 (me), top
    g.split = g.cyMe + g.TH / 2 + 30;
    // branch rows are interleaved (longer branch first, nearest me at the top) so every name gets a full row
    g.slots = {};
    var longer = PHD.length >= MS.length ? ['phd', PHD, 'ms', MS] : ['ms', MS, 'phd', PHD];
    var order = [], i;
    for (i = 0; i < Math.max(MS.length, PHD.length); i++) {
      if (i < longer[1].length) order.push(longer[0] + i);
      if (i < longer[3].length) order.push(longer[2] + i);
    }
    order.forEach(function (key, n) { g.slots[key] = n; });   // 0 = top
    g.nB = Math.max(order.length, 1);
    g.bTop = g.split + 62;                              // centre of the first branch row
    g.span = (g.nB - 1) * g.R;
    g.merge = g.bTop + g.span + g.TH / 2 + 30;
    g.cyD1 = g.merge + 28 + g.TH / 2;
    g.cyChain = function (k) { return g.cyD1 + k * g.R; };   // k = 0 is D1, last is the oldest
    g.cyEnd = g.cyChain(CHAIN.length - 1);
    g.term = g.cyEnd + g.TH / 2 + 34;                   // end-of-line terminal
    g.H = g.term + 40;
    return g;
  }
  // centre of branch stage j (j = 0 is nearest me, at the top)
  function branchY(list, j) {
    var key = (list === MS ? 'ms' : 'phd') + j;
    return G.bTop + G.slots[key] * G.R;
  }
  // year axis: newest (1969) at D1, oldest (1622) at the last stage
  function yearY(y) {
    return G.cyD1 + (Y1 - y) / (Y1 - Y0) * (G.cyEnd - G.cyD1);
  }

  /* ---------- build ---------- */
  function build() {
    G = geom();
    svg.textContent = '';
    rowsEl.textContent = '';
    stages = [];
    pulses = [];
    closeCard(true);
    svg.setAttribute('viewBox', '0 0 ' + G.w + ' ' + G.H);
    svg.setAttribute('width', G.w);
    svg.setAttribute('height', G.H);
    stageEl.style.height = G.H + 'px';

    var defs = el('defs', {}, svg);
    var gray = el('filter', { id: 'dl-gray' }, defs);
    el('feColorMatrix', { type: 'saturate', values: '0' }, gray);
    var glow = el('filter', { id: 'dl-glow', x: '-200%', y: '-200%', width: '500%', height: '500%' }, defs);
    el('feGaussianBlur', { stdDeviation: 3.5, result: 'b' }, glow);
    var m = el('feMerge', {}, glow);
    el('feMergeNode', { 'in': 'b' }, m);
    el('feMergeNode', { 'in': 'SourceGraphic' }, m);
    var clip = el('clipPath', { id: 'dl-litclip' }, defs);
    clipRect = el('rect', { x: 0, y: 0, width: G.w, height: G.H }, clip);

    drawAxis();
    wiresBase = el('g', { 'class': 'dl-w' }, svg);
    var litG = el('g', { 'class': 'dl-lit', 'clip-path': 'url(#dl-litclip)' }, svg);
    wiresLit = litG;

    // me -> split -> both branches
    wire('M' + G.SX + ' ' + (G.cyMe + G.TH / 2) + ' V' + G.split);
    wire('M' + G.SA + ' ' + G.split + ' H' + G.SB);
    dot(G.SX, G.split);
    branchWires(MS, G.SA);
    branchWires(PHD, G.SB);
    // merge -> D1 -> … -> oldest -> terminal
    wire('M' + G.SA + ' ' + G.merge + ' H' + G.SB);
    dot(G.SX, G.merge);
    wire('M' + G.SX + ' ' + G.merge + ' V' + (G.cyD1 - G.TH / 2));
    for (var k = 0; k < CHAIN.length - 1; k++) {
      wire('M' + G.SX + ' ' + (G.cyChain(k) + G.TH / 2) + ' V' + (G.cyChain(k + 1) - G.TH / 2));
    }
    wire('M' + G.SX + ' ' + (G.cyEnd + G.TH / 2) + ' V' + (G.term - 13));

    // end of the recorded line (bottom)
    var sg = el('g', { 'class': 'dl-src' }, svg);
    el('circle', { cx: G.SX, cy: G.term, r: 13, 'class': 'dl-s' }, sg);
    el('path', { d: 'M' + (G.SX - 8) + ' ' + G.term + ' q4 -9 8 0 t8 0', 'class': 'dl-s' }, sg);
    el('text', { x: G.SX + 22, y: G.term - 2, 'class': 'dl-t dl-t--src' }, sg, 'END OF THE RECORDED LINE');
    el('text', { x: G.SX + 22, y: G.term + 11, 'class': 'dl-t dl-t--muted' }, sg, 'advisor unknown before ' + Y0);

    el('text', { x: G.SX + 8, y: G.merge - 8, 'class': 'dl-t dl-t--tag' }, svg, 'MERGE · X5');

    // stages
    CHAIN.forEach(function (p, k) {
      addStage({ key: p.id, p: p, x: G.SX, cy: G.cyChain(k), kind: 'chain', idx: k,
                 tag: p.id + (p.degreeYear ? ' · ' + p.degreeYear : ''), anchor: k === 0 ? 'dl-paul' : null });
    });
    MS.forEach(function (p, j) {
      addStage({ key: 'ms' + j, p: p, x: G.SA, cy: branchY(MS, j), kind: 'ms', tag: ownRole(p), rel: relOf(p) });
    });
    PHD.forEach(function (p, j) {
      addStage({ key: 'phd' + j, p: p, x: G.SB, cy: branchY(PHD, j), kind: 'phd', tag: ownRole(p), rel: relOf(p) });
    });
    addStage({ key: 'me', p: ME, x: G.SX, cy: G.cyMe, kind: 'me', tag: 'X1 · me' });

    // pulses (two in the branch region)
    for (var i = 0; i < 2; i++) {
      var pg = el('g', { 'class': 'dl-pulse' }, svg);
      el('circle', { r: 8, 'class': 'dl-pulse__glow', filter: 'url(#dl-glow)' }, pg);
      el('circle', { r: 3.5, 'class': 'dl-pulse__core' }, pg);
      pulses.push(pg);
    }
    buildScope();
  }

  // row tag: the person's own role only when it is "MS advisor" / "PhD advisor"
  function ownRole(p) { return /^(advisor|student) of/i.test(p.role || '') ? '' : (p.role || ''); }
  function relOf(p) { return /^(advisor|student) of/i.test(p.role || '') ? p.role.charAt(0).toUpperCase() + p.role.slice(1) : ''; }

  function wire(d) {
    el('path', { d: d }, wiresBase);
    el('path', { d: d }, wiresLit);
  }
  function dot(x, y) {
    el('circle', { cx: x, cy: y, r: 3, 'class': 'dl-jn' }, svg);
  }
  function branchWires(list, x) {
    if (!list.length) { wire('M' + x + ' ' + G.split + ' V' + G.merge); return; }
    // split -> nearest-me stage; between stages; last stage -> merge
    wire('M' + x + ' ' + G.split + ' V' + (branchY(list, 0) - G.TH / 2));
    for (var j = 0; j < list.length - 1; j++) {
      wire('M' + x + ' ' + (branchY(list, j) + G.TH / 2) + ' V' + (branchY(list, j + 1) - G.TH / 2));
    }
    wire('M' + x + ' ' + (branchY(list, list.length - 1) + G.TH / 2) + ' V' + G.merge);
  }

  function drawAxis() {
    var g = el('g', { 'class': 'dl-axis' }, svg), AX = G.AX;
    el('line', { x1: AX, y1: G.cyD1, x2: AX, y2: G.cyEnd, 'class': 'dl-s' }, g);
    el('text', { x: AX, y: G.cyD1 - 22, 'class': 'dl-t dl-t--tag', 'text-anchor': 'middle' }, g, 'YEAR');
    var first = Math.ceil(Y0 / 25) * 25;
    for (var y = first; y <= Y1; y += 25) {
      var yy = yearY(y), major = y % 50 === 0;
      el('line', { x1: AX - (major ? 6 : 3), y1: yy, x2: AX, y2: yy, 'class': 'dl-s' }, g);
      if (major && Math.abs(y - Y1) > 12 && Math.abs(y - Y0) > 12) {
        el('text', { x: AX - 9, y: yy + 3.5, 'class': 'dl-t dl-t--axis', 'text-anchor': 'end' }, g, String(y));
      }
    }
    [Y0, Y1].forEach(function (y) {
      el('text', { x: AX - 9, y: yearY(y) + 3.5, 'class': 'dl-t dl-t--axis dl-t--end', 'text-anchor': 'end' }, g, String(y));
    });
    // leaders: each chain stage to its year on the axis
    CHAIN.forEach(function (p, k) {
      var yy = yearY(p.year), cy = G.cyChain(k);
      el('line', { x1: AX, y1: yy, x2: G.SX - G.HW - 8, y2: cy, 'class': 'dl-leader' + (p.yearApprox ? ' dl-leader--approx' : '') }, g);
      el('circle', { cx: AX, cy: yy, r: 2, 'class': 'dl-jn' }, g);
    });
  }

  function addStage(o) {
    var x = o.x, cy = o.cy, HW = G.HW, TH = G.TH, p = o.p;
    var top = cy - TH / 2, bot = cy + TH / 2;
    var pts = (x - HW) + ',' + top + ' ' + (x + HW) + ',' + top + ' ' + x + ',' + bot;   // buffer pointing down
    var g = el('g', { 'class': 'dl-stg' }, svg);
    el('polygon', { points: pts, 'class': 'dl-tri' }, g);    // plain buffer symbol
    // lit outline (clipped by the pulse front)
    el('polygon', { points: pts, 'class': 'dl-tri' }, wiresLit);

    // clickable row (real button, keyboard accessible)
    var b = h('button', 'dl-row dl-row--' + o.kind, null, rowsEl);
    b.type = 'button';
    var left, right;
    if (o.kind === 'phd') {                          // mirrored: triangle on the right, text to its left
      left = G.SA + HW + 10;
      right = x + HW + 6;
      b.style.paddingRight = (2 * HW + 16) + 'px';
    } else {
      left = Math.max(0, x - HW - 6);
      right = o.kind === 'ms' ? G.SB - HW - 10 : G.w;
      b.style.paddingLeft = (x + HW + 10 - left) + 'px';
    }
    b.style.left = left + 'px';
    b.style.top = (cy - G.R / 2 + 4) + 'px';
    b.style.width = (right - left) + 'px';
    b.style.height = (G.R - 8) + 'px';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-label', 'Details: ' + p.name);
    // square portrait beside the buffer (initials when there is no photo)
    var ph = h('span', 'dl-row__ph' + (p.photo ? '' : ' dl-row__ph--none'), null, b);
    if (p.photo) {
      var im = h('img', null, null, ph);
      im.src = p.photo; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async';
      im.onerror = function () { ph.textContent = initials(p.name); ph.classList.add('dl-row__ph--none'); };
    } else {
      ph.textContent = initials(p.name);
    }
    var tx = h('span', 'dl-row__txt', null, b);
    if (o.tag) h('span', 'dl-row__tag', o.tag, tx);
    h('span', 'dl-row__name', p.name, tx);
    h('span', 'dl-row__org', p.institution || '', tx);
    if (o.anchor) { var a = h('span', 'dl-anchor'); a.id = o.anchor; b.appendChild(a); }
    var st = { o: o, g: g, btn: b, lit: null };
    b.addEventListener('click', function () { toggleCard(st); });
    stages.push(st);
  }

  /* ---------- details card ---------- */
  function toggleCard(st) {
    if (curOpen === st) { closeCard(); return; }
    openCard(st);
  }
  function openCard(st) {
    closeCard(true);
    var o = st.o, p = o.p;
    cardBody.textContent = '';
    if (p.photo) {
      var fig = h('figure', 'dl-card__fig', null, cardBody);
      var im = h('img', null, null, fig);
      im.src = p.photo; im.alt = ''; im.loading = 'lazy';
      if (p.credit) {
        var cap = h('figcaption', null, 'Photo: ', fig);
        link(cap, p.credit.author || 'Unknown', p.credit.authorUrl || p.credit.sourcePage);
        cap.appendChild(document.createTextNode(', '));
        link(cap, p.credit.license || 'license', p.credit.licenseUrl || p.credit.sourcePage);
        cap.appendChild(document.createTextNode(', via '));
        link(cap, 'Wikimedia Commons', p.credit.sourcePage);
      }
    }
    var txt = h('div', 'dl-card__txt', null, cardBody);
    if (o.tag) h('div', 'dl-card__tag', o.tag, txt);
    var nm = h('h3', 'dl-card__name', p.name, txt);
    nm.id = 'dl-card-name';
    nm.tabIndex = -1;
    if (p.institution) h('div', 'dl-card__org', p.institution + (p.degreeYear ? ' · ' + p.degreeYear : ''), txt);
    if (p.note || o.rel) h('p', 'dl-card__note', p.note || o.rel, txt);
    var links = h('div', 'dl-card__links', null, txt);
    if (p.mgpUrl) link(links, 'Mathematics Genealogy Project ↗', p.mgpUrl);
    if (p.link) link(links, 'IEEE Xplore ↗', p.link);
    if (o.kind === 'chain' && o.idx === 0) link(links, '↩ X5 in the ring oscillator', data.ringUrl + '#academic-genealogy', true);
    if (o.kind === 'me') link(links, '↩ The ring oscillator', data.ringUrl, true);
    if (!links.childNodes.length) links.remove();

    // position: under the row, as wide as the space allows
    var top = o.cy + G.R / 2 - 6;
    var cw = Math.min(G.w, 420);
    var left = clamp(o.x - G.HW - 6 - (o.kind === 'phd' ? cw - 2 * G.HW - 12 : 0), 0, G.w - cw);
    card.style.top = top + 'px';
    card.style.left = left + 'px';
    card.style.width = cw + 'px';
    card.hidden = false;
    st.btn.setAttribute('aria-expanded', 'true');
    st.btn.classList.add('is-open');
    curOpen = st;
    nm.focus({ preventScroll: true });
  }
  function closeCard(silent) {
    if (!curOpen) { card.hidden = true; return; }
    var st = curOpen;
    curOpen = null;
    card.hidden = true;
    st.btn.setAttribute('aria-expanded', 'false');
    st.btn.classList.remove('is-open');
    if (!silent) st.btn.focus({ preventScroll: true });
  }
  function link(parent, text, href, same) {
    if (!href) { parent.appendChild(document.createTextNode(text)); return; }
    var a = h('a', null, text, parent);
    a.href = href;
    if (!same) { a.target = '_blank'; a.rel = 'noopener'; }
    return a;
  }
  q('.dl-card__close').addEventListener('click', function () { closeCard(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && curOpen) closeCard(); });
  document.addEventListener('click', function (e) {
    if (curOpen && !card.contains(e.target) && !curOpen.btn.contains(e.target)) closeCard(true);
  });

  /* ---------- scope: year of the newest lit stage ---------- */
  function buildScope() {
    scopeSvg.textContent = '';
    var g = el('g', {}, scopeSvg);
    for (var x = 0; x <= 10; x++) el('line', { x1: x * 22, y1: 0, x2: x * 22, y2: 56, 'class': 'dl-sc-div' }, g);
    for (var y = 0; y <= 4; y++) el('line', { x1: 0, y1: y * 14, x2: 220, y2: y * 14, 'class': 'dl-sc-div' }, g);
    G.scTrace = el('path', { 'class': 'dl-sc-trace', d: '' }, scopeSvg);
    G.scHead = el('circle', { r: 2.4, 'class': 'dl-sc-head' }, scopeSvg);
  }
  function scopeY(year) { return (4 + (Y1 - year) / (Y1 - Y0) * 48).toFixed(1); }   // newer = higher, like the page
  function drawScope(litChain) {
    // x = chain stage (D1 left … D18 right), y = year
    var n = CHAIN.length, d = '', last = null;
    for (var k = 0; k < litChain; k++) {
      var x = (8 + k / (n - 1) * 204).toFixed(1), y = scopeY(CHAIN[k].year);
      d += (k ? 'L' : 'M') + x + ' ' + y;
      last = [x, y];
    }
    G.scTrace.setAttribute('d', d);
    if (last) { G.scHead.setAttribute('cx', last[0]); G.scHead.setAttribute('cy', last[1]); G.scHead.style.opacity = 1; }
    else G.scHead.style.opacity = 0;
  }

  /* ---------- scroll → pulse front ---------- */
  var lastFront = null;
  function render() {
    raf = 0;
    var rect = stageEl.getBoundingClientRect();
    var line = window.innerHeight * 0.6;
    var front = reduce ? G.H : clamp(line - rect.top, G.cyMe, G.term);
    if (front === lastFront) return;
    lastFront = front;
    clipRect.setAttribute('y', 0);
    clipRect.setAttribute('height', Math.max(0, front));

    // pulses: two in the branch region, one elsewhere
    var inBranches = front > G.split && front < G.merge;
    pulses[0].setAttribute('transform', 'translate(' + (inBranches ? G.SA : G.SX) + ' ' + front + ')');
    pulses[1].setAttribute('transform', 'translate(' + G.SB + ' ' + front + ')');
    pulses[0].style.opacity = reduce ? 0 : 1;
    pulses[1].style.opacity = !reduce && inBranches ? 1 : 0;

    // stage states; newest lit = the lit stage nearest the front
    var newest = null, litChain = 0;
    stages.forEach(function (st) {
      var lit = st.o.cy <= front;
      if (lit !== st.lit) {
        st.lit = lit;
        st.g.classList.toggle('is-lit', lit);
        st.btn.classList.toggle('is-lit', lit);
      }
      if (lit && (!newest || st.o.cy > newest.o.cy)) newest = st;
      if (lit && st.o.kind === 'chain') litChain++;
    });
    if (newest) {
      var p = newest.o.p, o = newest.o;
      sProbe.textContent = 'probe ' + (o.kind === 'chain' ? p.id : o.kind === 'me' ? 'X1' : p.name.split(/\s+/).pop());
      sYear.textContent = o.kind === 'chain' ? (p.yearApprox ? '~' : '') + p.year : o.kind === 'me' ? 'now' : '—';
      sName.textContent = o.kind === 'ms' || o.kind === 'phd' ? 'branches → ' + CHAIN[0].name : p.name;
    }
    drawScope(litChain);
  }
  var raf = 0;
  function tick() { if (!raf) raf = requestAnimationFrame(render); }

  /* ---------- scope visibility + fixed-footer offset ---------- */
  function placeScope() {
    var ft = document.querySelector('.page__footer');
    var fh = ft && getComputedStyle(ft).position === 'fixed' ? ft.offsetHeight : 0;
    root.style.setProperty('--dl-bottom', fh + 'px');
  }

  /* ---------- setup ---------- */
  function setup() {
    reduce = !!(reduceMQ && reduceMQ.matches);
    root.classList.add('dl--js');
    root.classList.toggle('dl--static', reduce);
    lastFront = null;
    build();
    placeScope();
    render();
  }
  var lastW = 0, rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      placeScope();
      if (stageEl.clientWidth !== lastW) { lastW = stageEl.clientWidth; setup(); } else tick();
    }, 120);
  });
  window.addEventListener('scroll', tick, { passive: true });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      scope.hidden = reduce || !en[0].isIntersecting;
    }, { rootMargin: '-30% 0px -30% 0px' }).observe(stageEl);
  }
  if (reduceMQ) {
    var onChange = function () { setup(); };
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onChange);
    else if (reduceMQ.addListener) reduceMQ.addListener(onChange);
  }
  window.addEventListener('load', function () {
    placeScope();
    // honour #dl-paul links once the diagram exists
    var t = location.hash && document.getElementById(location.hash.slice(1));
    if (t && t.classList.contains('dl-anchor')) t.parentNode.scrollIntoView({ block: 'center' });
  });

  lastW = stageEl.clientWidth;
  setup();
})();
