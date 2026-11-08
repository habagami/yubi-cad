// 画面操作・ツール・ダイアログ
(function () {
  const NZ = window.NZ;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = NZ.esc;
  const AI_ON = !(NZ.EDITION && NZ.EDITION.aiEnabled === false); // js/config.js で切り替え
  const r2 = (n) => Math.round(n * 100) / 100;

  const st = {
    view: 'plan', // plan=平面図 / elev=展開図
    elevRoom: null,
    project: null,
    settings: NZ.loadSettings(),
    views: { draw: { cx: 5000, cy: 3500, zoom: 0.08 }, sheet: { cx: 210, cy: 148, zoom: 2 } },
    mode: 'draw',
    tool: 'select',
    sel: null,
    temp: null,
    S: 50,
    hist: [],
    hi: -1,
    underSrc: null,
    issues: [],
    issueSel: null,
    last: { kind: 'existing', thick: 120, just: 'center', fixtureType: 'kitchen' },
  };
  NZ.settings = st.settings;
  const P = () => st.project;
  const view = () => st.views[st.mode];

  // ---------- 数値入力(全角・四則演算可) ----------
  function num(v) {
    if (typeof v === 'number') return v;
    let s = String(v || '').replace(/[０-９．＋－ー×＊÷／（）]/g, (c) => ({ '．': '.', '＋': '+', '－': '-', 'ー': '-', '×': '*', '＊': '*', '÷': '/', '／': '/', '（': '(', '）': ')' }[c] || String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
    s = s.replace(/[,\s]/g, '');
    if (!s) return NaN;
    if (!/^[0-9+\-*/().]+$/.test(s)) return NaN;
    try { const r = Function('"use strict";return (' + s + ')')(); return isFinite(r) ? r : NaN; } catch (e) { return NaN; }
  }
  const roundTo = (v) => { const r = +st.settings.round || 1; return Math.round(v / r) * r; };

  // ---------- 履歴・保存 ----------
  const snap = () => JSON.stringify(P(), (k, v) => (k === 'src' ? undefined : v));
  function resetHistory() { st.hist = [snap()]; st.hi = 0; }
  function commit() {
    // 内法(実測値)と接続する壁の厚みから壁の長さを決め直す
    NZ.solveWalls(P());
    st.hist = st.hist.slice(0, st.hi + 1);
    st.hist.push(snap());
    if (st.hist.length > 80) st.hist.shift();
    st.hi = st.hist.length - 1;
    const before = new Set(st.issues.map((i) => i.key));
    renderAll();
    const added = st.issues.filter((i) => i.level !== 'info' && !before.has(i.key));
    if (added.length) toast(`⚠ 辻褄の合わない寸法があります: ${added[0].msg}${added.length > 1 ? ` ほか${added.length - 1}件` : ''}`, 5000);
    scheduleSave();
  }
  // 図面の形が変わらない変更(見積の入力など): 履歴に積んで保存するだけで、画面は描き直さない
  function commitData() {
    st.hist = st.hist.slice(0, st.hi + 1);
    st.hist.push(snap());
    if (st.hist.length > 80) st.hist.shift();
    st.hi = st.hist.length - 1;
    scheduleSave();
  }
  function restore(i) {
    const p = JSON.parse(st.hist[i]);
    if (p.underlay) p.underlay.src = st.underSrc;
    st.project = p;
    st.hi = i;
    if (st.sel && !findEl(st.sel)) st.sel = null;
    renderUnderlay();
    renderAll();
    scheduleSave();
  }
  let saveTimer = null;
  function scheduleSave() {
    $('#save-state').textContent = '未保存';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 700);
  }
  async function saveNow() {
    try {
      await NZ.db.saveProject(P());
      localStorage.setItem('naiso-zumen.last', P().id);
      $('#save-state').textContent = '保存済み';
    } catch (e) {
      $('#save-state').textContent = '保存失敗';
    }
  }

  // ---------- 要素検索 ----------
  const COLLS = ['walls', 'columns', 'fixtures', 'labels', 'photos', 'dims', 'zones', 'floors'];
  function findEl(id) {
    for (const c of COLLS) {
      const el = P()[c].find((e) => e.id === id);
      if (el) return { coll: c, el };
    }
    return null;
  }
  function removeEl(id) {
    for (const c of COLLS) P()[c] = P()[c].filter((e) => e.id !== id);
  }

  // ---------- 座標変換 ----------
  const cv = $('#cv');
  function screenToWorld(cx, cy) {
    const r = cv.getBoundingClientRect(), v = view();
    return { x: (cx - r.left - r.width / 2) / v.zoom + v.cx, y: (cy - r.top - r.height / 2) / v.zoom + v.cy };
  }
  function worldToScreen(x, y) {
    const r = cv.getBoundingClientRect(), v = view();
    return { x: (x - v.cx) * v.zoom + r.left + r.width / 2, y: (y - v.cy) * v.zoom + r.top + r.height / 2 };
  }
  function updateView() {
    const r = cv.getBoundingClientRect(), v = view();
    $('#vp').setAttribute('transform', `translate(${r2(r.width / 2 - v.cx * v.zoom)} ${r2(r.height / 2 - v.cy * v.zoom)}) scale(${v.zoom})`);
    updateInfo();
  }
  function updateInfo() {
    const v = view();
    if (st.mode === 'draw') {
      const u = P().underlay;
      $('#info').textContent = `縮尺 1/${st.S}${P().meta.scale === 'auto' ? '(自動)' : ''}  表示 ${Math.round(v.zoom * 1000) / 10}%${u ? (u.calibrated ? '  下図:縮尺合せ済' : '  下図:縮尺未設定') : ''}`;
    } else {
      $('#info').textContent = `用紙 ${P().meta.paper}  縮尺 1/${st.S}`;
    }
  }
  function fitView() {
    const r = cv.getBoundingClientRect();
    const v = view();
    let b;
    if (st.mode === 'sheet') {
      const [W, H] = NZ.PAPERS[P().meta.paper] || NZ.PAPERS.A3;
      b = { x0: 0, y0: 0, x1: W, y1: H };
    } else {
      b = NZ.annotatedBBox(P(), st.S);
      const u = P().underlay;
      if (u && u.visible && !P().walls.length) b = { x0: u.x, y0: u.y, x1: u.x + u.w * u.mmPerPx, y1: u.y + u.h * u.mmPerPx };
    }
    v.cx = (b.x0 + b.x1) / 2; v.cy = (b.y0 + b.y1) / 2;
    v.zoom = Math.min((r.width - 40) / (b.x1 - b.x0), (r.height - 40) / (b.y1 - b.y0));
    updateView();
  }

  // ---------- 描画 ----------
  function renderUnderlay() {
    const g = $('#g-under'), u = P().underlay;
    if (st.mode !== 'draw' || !u || !u.src || !u.visible || !$('#lay-under').checked) { g.innerHTML = ''; return; }
    g.innerHTML = `<image href="${u.src}" x="${u.x}" y="${u.y}" width="${u.w * u.mmPerPx}" height="${u.h * u.mmPerPx}" opacity="${u.opacity}" preserveAspectRatio="none"/>`;
  }
  function renderAll() {
    st.S = NZ.sheetScale(P());
    $('#proj-name').textContent = P().meta.name || '(無題の図面)';
    if (st.mode === 'draw') {
      $('#g-model').innerHTML = NZ.svgDefs(st.S, 'ed') + NZ.renderModel(P(), st.S, {
        prefix: 'ed',
        zones: $('#lay-zones').checked,
        photos: $('#lay-photos').checked,
        grid: $('#lay-grid').checked,
        dims: $('#lay-dims').checked,
      });
    } else {
      const sh = NZ.renderSheet(P());
      $('#g-model').innerHTML = `<rect x="2" y="2" width="${sh.W}" height="${sh.H}" fill="rgba(0,0,0,.18)"/>` + sh.svg.replace('<svg ', `<svg x="0" y="0" width="${sh.W}" height="${sh.H}" `).replace(/ width="\d+mm" height="\d+mm"/, '');
    }
    runCheck();
    renderOverlay();
    renderSelbar();
    updateInfo();
    updateWelcome();
    if (st.view === 'elev') renderElev();
    if (st.view === 'est') NZ.renderEstimate();
  }

  function renderOverlay() {
    const g = $('#g-over');
    if (st.mode !== 'draw') { g.innerHTML = ''; return; }
    const z = view().zoom, px = (n) => r2(n / z);
    let s = '';
    if (st.sel) {
      const f = findEl(st.sel);
      if (f) {
        const e = f.el;
        const sty = `fill="none" stroke="#E2552D" stroke-width="${px(2)}"`;
        if (f.coll === 'walls') {
          const fr = NZ.wallFrame(e), off = NZ.wallOffset(e), t = e.thick;
          const q = (s0, k) => ({ x: e.x1 + fr.u.x * s0 + fr.n.x * k, y: e.y1 + fr.u.y * s0 + fr.n.y * k });
          const pts = [q(0, off - t / 2), q(fr.L, off - t / 2), q(fr.L, off + t / 2), q(0, off + t / 2)];
          s += `<polygon points="${pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ')}" ${sty} fill-opacity=".1"/>`;
          s += `<circle cx="${e.x1}" cy="${e.y1}" r="${px(11)}" fill="#fff" stroke="#E2552D" stroke-width="${px(2.5)}"/>`;
          s += `<circle cx="${e.x2}" cy="${e.y2}" r="${px(11)}" fill="#E2552D" stroke="#fff" stroke-width="${px(2)}"/>`;
          s += `<text x="${e.x1}" y="${e.y1 - 16 / z}" font-size="${px(12)}" text-anchor="middle" fill="#E2552D">始点</text>`;
        } else {
          const b = elBBox(f);
          s += `<rect x="${r2(b.x0)}" y="${r2(b.y0)}" width="${r2(b.x1 - b.x0)}" height="${r2(b.y1 - b.y0)}" ${sty} stroke-dasharray="${px(6)} ${px(4)}"/>`;
        }
      }
    }
    if ($('#lay-check').checked) s += issueMarkers(px);
    const t = st.temp;
    if (t) {
      if (t.pts && t.pts.length > 1) s += `<polyline points="${t.pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ')}" fill="none" stroke="#E2552D" stroke-width="${px(3)}" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>`;
      if (t.wall) s += `<g opacity=".75">${NZ.renderModel({ walls: [t.wall], columns: [], fixtures: [], labels: [], dims: [], zones: [], grid: { xs: [], ys: [], visible: false } }, st.S, { prefix: 'tw' })}</g>`;
      if (t.line) s += `<line x1="${t.line.a.x}" y1="${t.line.a.y}" x2="${t.line.b.x}" y2="${t.line.b.y}" stroke="#E2552D" stroke-width="${px(3)}"/>` + [t.line.a, t.line.b].map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${px(6)}" fill="#E2552D"/>`).join('');
      if (t.rect) s += `<rect x="${Math.min(t.rect.a.x, t.rect.b.x)}" y="${Math.min(t.rect.a.y, t.rect.b.y)}" width="${Math.abs(t.rect.b.x - t.rect.a.x)}" height="${Math.abs(t.rect.b.y - t.rect.a.y)}" fill="rgba(226,85,45,.10)" stroke="#E2552D" stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`;
      if (t.snap) s += `<circle cx="${t.snap.x}" cy="${t.snap.y}" r="${px(9)}" fill="none" stroke="#E2552D" stroke-width="${px(2.5)}"/>`;
      if (t.label) s += `<text x="${t.label.x}" y="${t.label.y}" font-size="${px(15)}" fill="#E2552D" font-weight="700" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="${px(4)}">${esc(t.label.text)}</text>`;
    }
    g.innerHTML = s;
  }

  function elBBox(f) {
    const e = f.el;
    switch (f.coll) {
      case 'columns': return { x0: e.x - e.w / 2, y0: e.y - e.d / 2, x1: e.x + e.w / 2, y1: e.y + e.d / 2 };
      case 'fixtures': {
        const a = ((e.rot || 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        const hw = (e.w * c + e.d * s) / 2, hd = (e.w * s + e.d * c) / 2;
        return { x0: e.x - hw, y0: e.y - hd, x1: e.x + hw, y1: e.y + hd };
      }
      case 'photos': { const r = NZ.PHOTO_R * st.S; return { x0: e.x - r, y0: e.y - r, x1: e.x + r, y1: e.y + r }; }
      case 'labels': { const fs = (e.size || 3.5) * st.S, w = Math.max(2, e.text.length) * fs * 0.55; return { x0: e.x - w, y0: e.y - fs, x1: e.x + w, y1: e.y + (e.sub ? fs * 1.2 : fs * 0.3) }; }
      case 'dims': return { x0: Math.min(e.x1, e.x2) - 50, y0: Math.min(e.y1, e.y2) - 50, x1: Math.max(e.x1, e.x2) + 50, y1: Math.max(e.y1, e.y2) + 50 };
      case 'zones':
      case 'floors': return { x0: e.x, y0: e.y, x1: e.x + e.w, y1: e.y + e.h };
    }
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  // ---------- ヒットテスト ----------
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function wallFaceDist(w, p) {
    const fr = NZ.wallFrame(w), off = NZ.wallOffset(w);
    const c = { x: fr.n.x * off, y: fr.n.y * off };
    return distToSeg(p, { x: w.x1 + c.x, y: w.y1 + c.y }, { x: w.x2 + c.x, y: w.y2 + c.y }) - w.thick / 2;
  }
  function hitTest(p) {
    const tol = 14 / view().zoom;
    const pr = P();
    if ($('#lay-photos').checked) for (const ph of [...(pr.photos || [])].reverse()) if (Math.hypot(p.x - ph.x, p.y - ph.y) <= NZ.PHOTO_R * st.S + tol) return ph.id;
    for (const l of [...pr.labels].reverse()) { const b = elBBox({ coll: 'labels', el: l }); if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return l.id; }
    for (const f of [...pr.fixtures].reverse()) {
      const a = (-(f.rot || 0) * Math.PI) / 180, dx = p.x - f.x, dy = p.y - f.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= f.w / 2 + tol / 2 && Math.abs(ly) <= f.d / 2 + tol / 2) return f.id;
    }
    for (const d of pr.dims) if (distToSeg(p, { x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }) < tol + Math.abs(d.offset || 0) * st.S) {
      // オフセット線上も判定
      const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1) || 1, nx = -(d.y2 - d.y1) / L, ny = (d.x2 - d.x1) / L, o = (d.offset || 0) * st.S;
      if (distToSeg(p, { x: d.x1 + nx * o, y: d.y1 + ny * o }, { x: d.x2 + nx * o, y: d.y2 + ny * o }) < tol) return d.id;
    }
    for (const c of pr.columns) if (Math.abs(p.x - c.x) <= c.w / 2 + tol / 2 && Math.abs(p.y - c.y) <= c.d / 2 + tol / 2) return c.id;
    let best = null, bd = Infinity;
    for (const w of pr.walls) { const d = wallFaceDist(w, p); if (d < tol && d < bd) { bd = d; best = w.id; } }
    if (best) return best;
    for (const z of [...pr.zones].reverse()) if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) return z.id;
    for (const z of [...pr.floors].reverse()) if (p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h) return z.id;
    return null;
  }

  // ---------- スナップ ----------
  function snapPoint(p, exclude, forWall) {
    if (!$('#opt-snap').checked) return null;
    const tol = 12 / view().zoom;
    let best = null, bd = tol;
    const cand = (x, y) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { x, y }; } };
    for (const w of P().walls) { if (w.id === exclude) continue; cand(w.x1, w.y1); cand(w.x2, w.y2); }
    // 壁の端点は柱の角に吸着させない(壁の芯が柱の角に来て、壁の半分の厚みだけずれるため)。柱の面には snapEndToColumn で合わせる
    if (!forWall) for (const c of P().columns) {
      cand(c.x, c.y);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) cand(c.x + (sx * c.w) / 2, c.y + (sy * c.d) / 2);
    }
    const g = P().grid;
    if (g.visible) for (const x of g.xs) for (const y of g.ys) cand(x, y);
    return best;
  }
  // ---------- 面の吸着 ----------
  // 壁・柱の「面」の線の一覧。h: 水平な線(y = v、x は a〜b の範囲) / v: 垂直な線(x = v、y は a〜b)
  // kind: face=面、end=壁の端、center=壁の芯
  function faceLines(excludeId) {
    const H = [], V = [];
    for (const w of P().walls) {
      if (w.id === excludeId) continue;
      const fr = NZ.wallFrame(w), off = NZ.wallOffset(w), t = +w.thick || 0;
      // 角でつながる壁があると、描画では相手の厚みの半分だけ伸びて角が閉じる(render.js の endExtensions と同じ)
      let e0 = 0, e1 = 0;
      for (const o of P().walls) {
        if (o === w) continue;
        for (const q of [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }]) {
          if (Math.hypot(q.x - w.x1, q.y - w.y1) < 2) e0 = Math.max(e0, o.thick / 2);
          if (Math.hypot(q.x - w.x2, q.y - w.y2) < 2) e1 = Math.max(e1, o.thick / 2);
        }
      }
      if (Math.abs(fr.u.x) >= 0.996) {
        const c = w.y1 + fr.n.y * off, x0 = Math.min(w.x1, w.x2), x1 = Math.max(w.x1, w.x2);
        const ext0 = w.x1 <= w.x2 ? e0 : e1, ext1 = w.x1 <= w.x2 ? e1 : e0;
        const a = x0 - ext0, b = x1 + ext1;
        H.push({ v: c - t / 2, a, b, kind: 'face' }, { v: c + t / 2, a, b, kind: 'face' }, { v: c, a, b, kind: 'center' });
        V.push({ v: a, a: c - t / 2, b: c + t / 2, kind: 'end' }, { v: b, a: c - t / 2, b: c + t / 2, kind: 'end' });
      } else if (Math.abs(fr.u.y) >= 0.996) {
        const c = w.x1 + fr.n.x * off, y0 = Math.min(w.y1, w.y2), y1 = Math.max(w.y1, w.y2);
        const ext0 = w.y1 <= w.y2 ? e0 : e1, ext1 = w.y1 <= w.y2 ? e1 : e0;
        const a = y0 - ext0, b = y1 + ext1;
        V.push({ v: c - t / 2, a, b, kind: 'face' }, { v: c + t / 2, a, b, kind: 'face' }, { v: c, a, b, kind: 'center' });
        H.push({ v: a, a: c - t / 2, b: c + t / 2, kind: 'end' }, { v: b, a: c - t / 2, b: c + t / 2, kind: 'end' });
      }
    }
    for (const c of P().columns) {
      if (c.id === excludeId) continue;
      V.push({ v: c.x - c.w / 2, a: c.y - c.d / 2, b: c.y + c.d / 2, kind: 'face' }, { v: c.x + c.w / 2, a: c.y - c.d / 2, b: c.y + c.d / 2, kind: 'face' });
      H.push({ v: c.y - c.d / 2, a: c.x - c.w / 2, b: c.x + c.w / 2, kind: 'face' }, { v: c.y + c.d / 2, a: c.x - c.w / 2, b: c.x + c.w / 2, kind: 'face' });
    }
    return { H, V };
  }
  // 四角(中心 x,y、半幅 hw、半奥行 hd)の辺を、近くの壁・柱の面にそろえる。centers=true なら柱の中心を壁の芯にも合わせる
  function snapRect(x, y, hw, hd, excludeId, centers) {
    if (!$('#opt-snap').checked) return { x, y, sx: false, sy: false };
    const tol = 16 / view().zoom, L = faceLines(excludeId);
    const best = (lines, pos, half, lo, hi) => {
      let d = null;
      for (const l of lines) {
        if (l.b < lo - tol || l.a > hi + tol) continue; // 横の範囲が離れている線は使わない
        const cand = l.kind === 'center' ? (centers ? [l.v - pos] : []) : [l.v - (pos - half), l.v - (pos + half)];
        for (const c of cand) if (Math.abs(c) <= tol && (d === null || Math.abs(c) < Math.abs(d))) d = c;
      }
      return d;
    };
    const dx = best(L.V, x, hw, y - hd, y + hd);
    const nx = x + (dx || 0);
    const dy = best(L.H, y, hd, nx - hw, nx + hw);
    return { x: nx, y: y + (dy || 0), sx: dx !== null, sy: dy !== null };
  }
  // 設備の向き(0/90/180/270)に応じた半幅・半奥行
  const fixHalf = (f) => { const r = (((+f.rot || 0) % 180) + 180) % 180; return r === 90 ? [f.d / 2, f.w / 2] : r === 0 ? [f.w / 2, f.d / 2] : null; };
  function snapElement(f) {
    if (f.coll === 'columns') { const e = f.el, r = snapRect(e.x, e.y, e.w / 2, e.d / 2, e.id, true); e.x = r.x; e.y = r.y; return r.sx || r.sy; }
    if (f.coll === 'fixtures') { const e = f.el, h = fixHalf(e); if (!h) return false; const r = snapRect(e.x, e.y, h[0], h[1], e.id, false); e.x = r.x; e.y = r.y; return r.sx || r.sy; }
    return false;
  }
  // 壁の端点 np(向き dir で伸びる壁の先端)を、柱の面に合わせる
  function snapEndToColumn(np, dir, excludeId) {
    if (!$('#opt-snap').checked) return null;
    const tol = 16 / view().zoom;
    let best = null;
    for (const c of P().columns) {
      if (c.id === excludeId) continue;
      if (Math.abs(dir.x) >= 0.996) {
        if (np.y < c.y - c.d / 2 - 1 || np.y > c.y + c.d / 2 + 1) continue;
        for (const fx of [c.x - c.w / 2, c.x + c.w / 2]) { const d = Math.abs(fx - np.x); if (d <= tol && (!best || d < best.d)) best = { d, p: { x: fx, y: np.y } }; }
      } else if (Math.abs(dir.y) >= 0.996) {
        if (np.x < c.x - c.w / 2 - 1 || np.x > c.x + c.w / 2 + 1) continue;
        for (const fy of [c.y - c.d / 2, c.y + c.d / 2]) { const d = Math.abs(fy - np.y); if (d <= tol && (!best || d < best.d)) best = { d, p: { x: np.x, y: fy } }; }
      }
    }
    return best ? best.p : null;
  }

  function orthoDir(dir) {
    if (!$('#opt-ortho').checked) return dir;
    const ang = Math.atan2(dir.y, dir.x);
    const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    if (Math.abs(ang - q) < (10 * Math.PI) / 180) return { x: Math.round(Math.cos(q)), y: Math.round(Math.sin(q)) };
    const q45 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    if (Math.abs(ang - q45) < (4 * Math.PI) / 180) return { x: Math.cos(q45), y: Math.sin(q45) };
    return dir;
  }
  // なぞった点列を直線に当てはめ(主成分方向)
  function fitStroke(pts) {
    const a = pts[0], b = pts[pts.length - 1];
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let dir = { x: Math.cos(th), y: Math.sin(th) };
    if ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y < 0) dir = { x: -dir.x, y: -dir.y };
    const proj = (p) => { const t = (p.x - mx) * dir.x + (p.y - my) * dir.y; return { x: mx + dir.x * t, y: my + dir.y * t }; };
    const A = proj(a), B = proj(b);
    return { A, B, dir, len: Math.hypot(B.x - A.x, B.y - A.y) };
  }

  // 壁端点を移動(接続している他の壁の端点も追従)
  function moveWallEnd(w, which, np) {
    const ox = which === 1 ? w.x1 : w.x2, oy = which === 1 ? w.y1 : w.y2;
    for (const o of P().walls) {
      if (o === w) continue;
      if (Math.hypot(o.x1 - ox, o.y1 - oy) < 2) { o.x1 = np.x; o.y1 = np.y; }
      if (Math.hypot(o.x2 - ox, o.y2 - oy) < 2) { o.x2 = np.x; o.y2 = np.y; }
    }
    if (which === 1) { w.x1 = np.x; w.y1 = np.y; } else { w.x2 = np.x; w.y2 = np.y; }
  }

  // ---------- 入力(ペン/指) ----------
  const pointers = new Map();
  let gesture = null, action = null, lastTap = { t: 0, id: null };
  let spaceDown = false;

  cv.addEventListener('pointerdown', (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベント等 */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    const isTouch = e.pointerType === 'touch';
    if (pointers.size >= 2 || e.button === 1 || e.button === 2 || spaceDown || st.mode === 'sheet' || (isTouch && !$('#opt-finger').checked)) {
      if (action) { action = null; st.temp = null; renderOverlay(); }
      startGesture();
      return;
    }
    const p = screenToWorld(e.clientX, e.clientY);
    action = { id: e.pointerId, start: p, startScr: { x: e.clientX, y: e.clientY }, pts: [p], moved: false };
    toolDown(p, e);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, Object.assign(pointers.get(e.pointerId), { x: e.clientX, y: e.clientY }));
    if (gesture) { moveGesture(); return; }
    if (action && action.id === e.pointerId) {
      const p = screenToWorld(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - action.startScr.x, e.clientY - action.startScr.y) > 6) action.moved = true;
      action.pts.push(p);
      toolMove(p, e);
    }
  });
  const endPointer = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture) { if (pointers.size === 0) gesture = null; else startGesture(); return; }
    if (action && action.id === e.pointerId) {
      const a = action;
      action = null;
      if (e.type === 'pointercancel') { st.temp = null; renderOverlay(); return; }
      toolUp(screenToWorld(e.clientX, e.clientY), a, e);
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = view(), before = screenToWorld(e.clientX, e.clientY);
    v.zoom *= Math.exp(-e.deltaY * 0.0015);
    const after = screenToWorld(e.clientX, e.clientY);
    v.cx += before.x - after.x; v.cy += before.y - after.y;
    updateView(); renderOverlay();
  }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  function startGesture() {
    const pts = [...pointers.values()];
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture = { c, d, world: screenToWorld(c.x, c.y), zoom: view().zoom };
  }
  function moveGesture() {
    const pts = [...pointers.values()];
    const c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
    const v = view();
    if (pts.length > 1 && gesture.d > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      v.zoom = gesture.zoom * (d / gesture.d);
    }
    const r = cv.getBoundingClientRect();
    v.cx = gesture.world.x - (c.x - r.left - r.width / 2) / v.zoom;
    v.cy = gesture.world.y - (c.y - r.top - r.height / 2) / v.zoom;
    updateView(); renderOverlay();
  }

  // ---------- ツール ----------
  const HINTS = {
    select: 'タップで選ぶ ・ ドラッグで動かす ・ 2回タップで直す',
    wall: '測った壁をなぞる → 長さを入れる',
    column: '柱の位置をタップ',
    fixture: '設備を置く所をタップ',
    furniture: '家具を置く所をタップ',
    floor: '床の範囲を指で囲む',
    dim: '測った2点の間をなぞる',
    text: '部屋名を入れる所をタップ',
    photo: '写真を撮った所をタップ',
    zone: 'キッチン・トイレ・浴室の範囲を囲む',
    calib: '長さの分かる所をなぞる → 実寸を入れる',
  };
  function setTool(t) {
    st.tool = t;
    st.temp = null;
    if (t !== 'select') st.welcomeOff = true;
    $$('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    $('#hint').textContent = HINTS[t] || '';
    renderOverlay();
    updateWelcome();
  }

  function toolDown(p) {
    const t = st.tool;
    if (t === 'select') {
      // 選択中の壁の端点を優先
      const z = view().zoom;
      if (st.sel) {
        const f = findEl(st.sel);
        if (f && f.coll === 'walls') {
          const w = f.el;
          if (Math.hypot(p.x - w.x1, p.y - w.y1) < 22 / z) { action.drag = { kind: 'end', which: 1, w }; return; }
          if (Math.hypot(p.x - w.x2, p.y - w.y2) < 22 / z) { action.drag = { kind: 'end', which: 2, w }; return; }
        }
      }
      const id = hitTest(p);
      if (id) {
        const f = findEl(id);
        action.drag = { kind: 'move', f, orig: JSON.parse(JSON.stringify(f.el)), attached: f.coll === 'walls' ? attachedEnds(f.el) : [] };
      }
      action.hit = id;
    } else if (t === 'wall' || t === 'dim' || t === 'calib') {
      st.temp = { pts: [p] };
    } else if (t === 'zone' || t === 'floor') {
      st.temp = { rect: { a: snapPoint(p) || p, b: p } };
    }
    renderOverlay();
  }
  function attachedEnds(w) {
    const r = [];
    for (const o of P().walls) {
      if (o === w) continue;
      for (const k of [1, 2]) {
        const ox = k === 1 ? o.x1 : o.x2, oy = k === 1 ? o.y1 : o.y2;
        if (Math.hypot(ox - w.x1, oy - w.y1) < 2 || Math.hypot(ox - w.x2, oy - w.y2) < 2) r.push({ o, k, x: ox, y: oy });
      }
    }
    return r;
  }
  function toolMove(p) {
    const t = st.tool;
    if (t === 'select' && action.drag && action.moved) {
      const d = action.drag;
      if (d.kind === 'end') {
        let sp = snapPoint(p, d.w.id, true);
        let np = sp || p;
        const other = d.which === 1 ? { x: d.w.x2, y: d.w.y2 } : { x: d.w.x1, y: d.w.y1 };
        if (!sp && $('#opt-ortho').checked) {
          const L = Math.hypot(np.x - other.x, np.y - other.y);
          const dir = orthoDir({ x: (np.x - other.x) / L, y: (np.y - other.y) / L });
          np = { x: other.x + dir.x * L, y: other.y + dir.y * L };
        }
        if (!sp) {
          // 柱の面、または他の壁(T字につながる位置)に合わせる
          const L = Math.hypot(np.x - other.x, np.y - other.y) || 1, dir = { x: (np.x - other.x) / L, y: (np.y - other.y) / L };
          const cp = snapEndToColumn(np, dir, null);
          if (cp) { np = cp; sp = cp; }
          else {
            const h = rayToWall(other, dir, L, 16 / view().zoom, L * 0.5, d.w.id);
            if (h) { np = { x: other.x + dir.x * h.t, y: other.y + dir.y * h.t }; sp = np; }
          }
        }
        moveWallEnd(d.w, d.which, np);
        const L = Math.hypot(d.w.x2 - d.w.x1, d.w.y2 - d.w.y1);
        st.temp = { snap: sp, label: { x: np.x, y: np.y - 30 / view().zoom, text: `${Math.round(L)}` } };
      } else {
        const dx = p.x - action.start.x, dy = p.y - action.start.y;
        const e = d.f.el, o = d.orig;
        let ddx = dx, ddy = dy, snapped = null;
        if ('x1' in o) {
          // 壁: どちらかの端点が他の壁の端点・柱の面に近ければ、そこへ合わせる(つながっている壁は除く)
          if (d.f.coll === 'walls' && !d.attached.length) {
            const L = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) || 1, u = { x: (o.x2 - o.x1) / L, y: (o.y2 - o.y1) / L };
            for (const [px, py, dir] of [[o.x1 + dx, o.y1 + dy, { x: -u.x, y: -u.y }], [o.x2 + dx, o.y2 + dy, u]]) {
              const q = { x: px, y: py };
              const sp = snapPoint(q, e.id, true) || snapEndToColumn(q, dir, null);
              if (sp) { ddx += sp.x - px; ddy += sp.y - py; snapped = sp; break; }
            }
          }
          e.x1 = o.x1 + ddx; e.y1 = o.y1 + ddy; e.x2 = o.x2 + ddx; e.y2 = o.y2 + ddy;
        } else {
          e.x = o.x + dx; e.y = o.y + dy;
          if (snapElement(d.f)) snapped = { x: e.x, y: e.y };
        }
        for (const a of d.attached) { if (a.k === 1) { a.o.x1 = a.x + ddx; a.o.y1 = a.y + ddy; } else { a.o.x2 = a.x + ddx; a.o.y2 = a.y + ddy; } }
        st.temp = snapped ? { snap: snapped } : null;
      }
      $('#g-model').innerHTML = NZ.svgDefs(st.S, 'ed') + NZ.renderModel(P(), st.S, { prefix: 'ed', zones: $('#lay-zones').checked, grid: $('#lay-grid').checked, dims: $('#lay-dims').checked, photos: $('#lay-photos').checked });
      renderOverlay();
    } else if (t === 'wall' || t === 'dim' || t === 'calib') {
      st.temp.pts.push(p);
      const a = st.temp.pts[0];
      st.temp.label = { x: p.x, y: p.y - 30 / view().zoom, text: `≈${Math.round(Math.hypot(p.x - a.x, p.y - a.y))}` };
      renderOverlay();
    } else if (t === 'zone' || t === 'floor') {
      st.temp.rect.b = t === 'floor' ? snapPoint(p) || p : p;
      const r = st.temp.rect;
      st.temp.label = { x: (r.a.x + r.b.x) / 2, y: Math.min(r.a.y, r.b.y) - 20 / view().zoom, text: `${Math.round(Math.abs(r.b.x - r.a.x))} × ${Math.round(Math.abs(r.b.y - r.a.y))}` };
      renderOverlay();
    }
  }
  function toolUp(p, a, e) {
    const t = st.tool;
    const scrLen = Math.hypot(e.clientX - a.startScr.x, e.clientY - a.startScr.y);
    if (t === 'select') {
      if (a.drag && a.moved) {
        st.temp = null; // 吸着の印を消す
        // 手で壁を動かした場合は、動かした形を正として内法を取り直す
        if (a.drag.kind === 'end' || a.drag.f.coll === 'walls') NZ.syncInner(P());
        commit();
        return;
      }
      const now = Date.now();
      if (a.hit && lastTap.id === a.hit && now - lastTap.t < 400) { editEl(a.hit); lastTap = { t: 0, id: null }; return; }
      lastTap = { t: now, id: a.hit };
      st.sel = a.hit;
      st.temp = null;
      renderOverlay(); renderSelbar();
      return;
    }
    if (t === 'wall') {
      if (scrLen < 14 && a.pts.length < 4) { st.temp = null; selectAt(p); return; }
      handleWallStroke(a.pts, e);
      return;
    }
    if (t === 'dim') {
      if (scrLen < 14) { st.temp = null; renderOverlay(); return; }
      handleDimStroke(a.pts, e);
      return;
    }
    if (t === 'calib') {
      if (scrLen < 14) { st.temp = null; renderOverlay(); return; }
      handleCalib(a.pts, e);
      return;
    }
    if (t === 'zone' || t === 'floor') {
      const r = st.temp.rect;
      if (Math.abs(r.b.x - r.a.x) < 50 || Math.abs(r.b.y - r.a.y) < 50) { st.temp = null; renderOverlay(); return; }
      const rect = { x: Math.min(r.a.x, r.b.x), y: Math.min(r.a.y, r.b.y), w: Math.abs(r.b.x - r.a.x), h: Math.abs(r.b.y - r.a.y) };
      if (t === 'zone') zoneDialog(null, rect, e);
      else floorDialog(null, rect, e);
      return;
    }
    if (t === 'column') { columnDialog(null, snapPoint(p, null, true) || p, e); return; }
    if (t === 'fixture') { fixtureDialog(null, p, e, 'equip'); return; }
    if (t === 'furniture') { fixtureDialog(null, p, e, 'furniture'); return; }
    if (t === 'text') { labelDialog(null, p, e); return; }
    if (t === 'photo') { photoDialog(null, p); return; }
  }
  function selectAt(p) {
    st.sel = hitTest(p);
    renderOverlay(); renderSelbar();
  }

  // ---------- 壁なぞり ----------
  function handleWallStroke(pts, e) {
    const fit = fitStroke(pts);
    // 既存の壁をなぞった場合 → その壁の実寸修正
    for (const w of P().walls) {
      const fr = NZ.wallFrame(w);
      if (Math.abs(fr.u.x * fit.dir.x + fr.u.y * fit.dir.y) < 0.97) continue;
      // 壁の面の上を、壁の長さの6割以上なぞったときだけ「既存壁の修正」とみなす
      const tol = w.thick / 2 + 10 / view().zoom;
      const mid = { x: (fit.A.x + fit.B.x) / 2, y: (fit.A.y + fit.B.y) / 2 };
      if (wallFaceDist(w, fit.A) < tol && wallFaceDist(w, fit.B) < tol && wallFaceDist(w, mid) < tol && fit.len > fr.L * 0.6) {
        const fixStart = Math.hypot(fit.A.x - w.x1, fit.A.y - w.y1) <= Math.hypot(fit.A.x - w.x2, fit.A.y - w.y2);
        st.sel = w.id;
        st.temp = null;
        renderOverlay();
        wallDialog(w, { measured: Math.round(fit.len), fixStart, anchor: e, altNew: () => newWallFromFit(fit, e) });
        return;
      }
    }
    newWallFromFit(fit, e);
  }

  // なぞった線の位置をそのまま使う(近くの端点にだけ小さく吸着)
  function newWallFromFit(fit, e) {
    const dir = orthoDir(fit.dir);
    const tol = 15 / view().zoom;
    let A = snapPoint(fit.A, null, true);
    let len = fit.len;
    // 始点・終点が既存の壁に掛かっていれば、その壁の芯までつなぐ(内法はあとで壁厚分を差し引く)
    if (!A) {
      const h = rayToWall(fit.A, dir, 0, tol, -Infinity);
      const cA = snapEndToColumn(fit.A, { x: -dir.x, y: -dir.y }, null);
      if (cA) { const t = (cA.x - fit.A.x) * dir.x + (cA.y - fit.A.y) * dir.y; A = cA; len -= t; }
      else if (h) { A = { x: fit.A.x + dir.x * h.t, y: fit.A.y + dir.y * h.t }; len -= h.t; } else A = fit.A;
    }
    const Bfree = { x: A.x + dir.x * len, y: A.y + dir.y * len };
    const sB = snapPoint(Bfree, null, true);
    const cB = sB ? null : snapEndToColumn(Bfree, dir, null);
    const hEnd = sB || cB ? null : rayToWall(A, dir, len, tol, len * 0.5);
    if (sB) { const t = (sB.x - A.x) * dir.x + (sB.y - A.y) * dir.y; if (t > 0 && Math.hypot(A.x + dir.x * t - sB.x, A.y + dir.y * t - sB.y) < 1) len = t; }
    else if (cB) len = (cB.x - A.x) * dir.x + (cB.y - A.y) * dir.y;
    else if (hEnd) len = hEnd.t;
    // 寸法の表示側: 図形の外側
    const bb = NZ.modelBBox(P(), false);
    const c = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
    const n = { x: -dir.y, y: dir.x };
    const mid = { x: A.x + (dir.x * len) / 2, y: A.y + (dir.y * len) / 2 };
    const dimSide = P().walls.length && n.x * (c.x - mid.x) + n.y * (c.y - mid.y) > 0 ? 'left' : 'right';
    const w = {
      id: NZ.uid(), x1: A.x, y1: A.y, x2: A.x + dir.x * len, y2: A.y + dir.y * len,
      thick: st.last.thick, kind: st.last.kind, just: st.last.just, dim: dimSide, segments: [],
    };
    // 縮尺合せ済みの下図上でなぞった長さを記録(入力ミスの検出に使う)
    if (P().underlay && P().underlay.calibrated) w.traced = Math.round(len);
    st.sel = null;
    st.temp = { wall: w, snap: A !== fit.A ? A : null };
    renderOverlay();
    wallDialog(w, { isNew: true, measured: Math.round(len), anchor: e });
  }

  // 点 A から dir 方向の直線が、t≈tAt の位置で既存の壁の芯線と交わるか
  function rayToWall(A, dir, tAt, tol, tMin, excludeId) {
    let best = null;
    for (const o of P().walls) {
      if (o.id === excludeId) continue;
      const fo = NZ.wallFrame(o);
      const den = dir.x * fo.u.y - dir.y * fo.u.x;
      if (Math.abs(den) < 0.1) continue;
      const dx = o.x1 - A.x, dy = o.y1 - A.y;
      const t = (dx * fo.u.y - dy * fo.u.x) / den;
      const s = (dx * dir.y - dy * dir.x) / den;
      if (s < -o.thick || s > fo.L + o.thick || t <= tMin) continue;
      const d = Math.abs(t - tAt);
      if (d < o.thick / 2 + tol && (!best || d < best.d)) best = { t, d, o };
    }
    return best;
  }

  function segRowHTML(g, i) {
    const def = NZ.SEG_TYPES[g.type] || NZ.SEG_TYPES.wall;
    const opts = Object.entries(NZ.SEG_TYPES).map(([k, v]) => `<option value="${k}" ${k === g.type ? 'selected' : ''}>${v.label}</option>`).join('');
    const hl = def.hingeLabel || ['吊元:始点側', '吊元:終点側'];
    let o = '';
    if (def.opts.includes('hinge')) o += `<select data-k="hinge"><option value="start" ${g.hinge !== 'end' ? 'selected' : ''}>${hl[0]}</option><option value="end" ${g.hinge === 'end' ? 'selected' : ''}>${hl[1]}</option></select>`;
    if (def.opts.includes('side')) o += `<select data-k="side"><option value="right" ${g.side !== 'left' ? 'selected' : ''}>右側へ開く</option><option value="left" ${g.side === 'left' ? 'selected' : ''}>左側へ開く</option></select>`;
    if (def.opts.includes('panels')) o += `<select data-k="panels">${def.panels.map((n) => `<option value="${n}" ${+(g.panels || def.panels[0]) === n ? 'selected' : ''}>${n}枚</option>`).join('')}</select>`;
    if (def.opts.includes('sill')) {
      const on = g.sill === undefined ? !!def.sillDef : g.sill;
      o += `<label class="sill-chk"><input type="checkbox" data-k="sill" ${on ? 'checked' : ''}>敷居</label>`;
    }
    // 展開図用の高さ(空欄=標準値)
    const v0 = NZ.elevOpeningDefault && NZ.elevOpeningDefault(g.type);
    if (v0) {
      const val = (x) => (x === undefined || x === null || x === '' ? '' : esc(x));
      if (v0.canBot) o += `<label class="seg-num">腰高<input data-k="bot" inputmode="decimal" value="${val(g.bot)}" placeholder="${v0.bot}"></label>`;
      o += `<label class="seg-num">高さH<input data-k="ht" inputmode="decimal" value="${val(g.ht)}" placeholder="${v0.ht}"></label>`;
    }
    return `<div class="seg-row" data-i="${i}"><select data-k="type">${opts}</select><input data-k="len" inputmode="decimal" value="${g.len}" placeholder="mm"><div class="seg-opts">${o}</div><button class="del" data-del="${i}" aria-label="削除">×</button></div>`;
  }

  function wallDialog(w, o = {}) {
    const segs = JSON.parse(JSON.stringify(w.segments || []));
    const L0 = NZ.wallFrame(w).L;
    // 両端で接続する壁の厚み分(内法 → 壁芯の長さへの加算量)
    const others = P().walls.filter((x) => x !== w);
    const ex = NZ.wallEndExt(others, w);
    // 新しい壁・検出した壁・以前の壁は設定の入力方法(既定は内法)、内法/芯々を選んだ壁はその方法
    let inner = o.isNew || w.innerMode === undefined ? st.settings.innerMode !== false : !!w.innerMode;
    const initVal = inner ? (o.isNew ? roundTo(L0 - ex.e0 - ex.e1) : Math.round(w.inner || L0 - ex.e0 - ex.e1)) : o.isNew ? roundTo(L0) : Math.round(L0);
    const kinds = Object.entries(NZ.WALL_KINDS).map(([k, v]) => `<option value="${k}" ${k === w.kind ? 'selected' : ''}>${v.label}</option>`).join('');
    const html = `
      <div class="row"><label class="f"><span class="len-label">${inner ? '内法・実測値 (mm)' : '壁芯の長さ (mm)'}</span><input name="len" class="big" inputmode="decimal" value="${initVal}"></label></div>
      <label class="chk"><input type="checkbox" name="innerMode" ${inner ? 'checked' : ''}>内法(壁の面から面)で入力する</label>
      <div class="note inner-info"></div>
      <div class="note">${o.measured ? `なぞった長さ ≈ ${o.measured} mm(下図換算)。` : ''}${!o.isNew ? (o.fixStart === false ? '終点側を固定して長さを変更します。' : '始点側を固定して長さを変更します。') : ''} 「1820+910」のような計算式も入力できます。</div>
      <div class="row">
        <label class="f">種別<select name="kind">${kinds}</select></label>
        <label class="f">壁厚 (mm)<input name="thick" inputmode="decimal" value="${w.thick}"></label>
        <label class="f">壁高 (mm)<input name="height" inputmode="decimal" value="${Math.round(w.height || NZ.DEFAULT_WALL_HEIGHT)}"></label>
      </div>
      <div class="row">
        <label class="f">なぞった線の位置<select name="just">
          <option value="center" ${w.just === 'center' ? 'selected' : ''}>壁の中心(芯)</option>
          <option value="right" ${w.just === 'right' ? 'selected' : ''}>壁の左面(壁は右側へ)</option>
          <option value="left" ${w.just === 'left' ? 'selected' : ''}>壁の右面(壁は左側へ)</option></select></label>
        <label class="f">寸法線<select name="dim">
          <option value="left" ${w.dim === 'left' ? 'selected' : ''}>左側に表示</option>
          <option value="right" ${w.dim === 'right' ? 'selected' : ''}>右側に表示</option>
          <option value="none" ${w.dim === 'none' ? 'selected' : ''}>表示しない</option></select></label>
      </div>
      <div class="seg-head">分割(始点から順に。ドア・引き戸・折れ戸・ガラス窓などを入れる)</div>
      <div class="segs"></div>
      <div class="seg-add">${['wall', 'door', 'entrance', 'sliding', 'sliding2', 'fusuma', 'folding', 'window', 'windowFixed', 'windowSash', 'opening'].map((k) => `<button data-add="${k}">＋${NZ.SEG_TYPES[k].label}</button>`).join('')}</div>
      <div class="seg-rest"></div>
      <svg class="preview"></svg>
      <div class="note">左右は「始点→終点」に向かって見た方向です。</div>`;
    const dlg = openDialog({
      title: o.isNew ? '壁の寸法入力' : '壁の編集',
      html, wide: true, anchor: o.anchor,
      buttons: [
        ...(o.isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(w.id); st.sel = null; commit(); } }]),
        ...(o.altNew ? [{ label: '新しい壁として追加', onClick: () => { setTimeout(o.altNew, 0); } }] : []),
        { label: 'キャンセル', onClick: () => { st.temp = null; renderAll(); } },
        { label: 'OK', cls: 'primary', onClick: (d) => apply(d) },
      ],
    });
    const body = dlg.dlg;
    const fv = (n) => body.querySelector(`[name="${n}"]`).value;
    // 入力欄の値 → 壁芯の長さ
    const centerLen = (v) => (inner ? v + ex.e0 + ex.e1 : v);
    const tmpWall = () => {
      const len = centerLen(num(fv('len')) || (inner ? L0 - ex.e0 - ex.e1 : L0));
      return Object.assign({}, w, { x1: 0, y1: 0, x2: len, y2: 0, thick: num(fv('thick')) || w.thick, kind: fv('kind'), just: fv('just'), dim: fv('dim'), segments: segs, detected: false, innerMode: inner, ext0: ex.e0, ext1: ex.e1 });
    };
    const showInner = () => {
      const v = num(fv('len'));
      const end = (c, e) => (c ? `+${Math.round(e)}` : '未接続');
      body.querySelector('.inner-info').innerHTML = inner
        ? `壁芯の長さ = 内法 ${isFinite(v) ? Math.round(v) : '?'} + 始点側 ${end(ex.c0, ex.e0)} + 終点側 ${end(ex.c1, ex.e1)} = <b>${isFinite(v) ? Math.round(centerLen(v)) : '?'}</b> mm。` +
          `<br>図面上の位置は仮置きです。${!ex.c0 || !ex.c1 ? '未接続の端に壁をつなぐと、その壁厚分を自動で調整します。' : '接続する壁の厚みが変わると自動で調整します。'}`
        : '壁の芯から芯までの長さとして作図します。';
    };
    const drawSegs = () => {
      body.querySelector('.segs').innerHTML = segs.map(segRowHTML).join('') || '<div class="note">分割なし(全長が壁)</div>';
      update();
    };
    const update = () => {
      const tw = tmpWall();
      const len = num(fv('len'));
      const sum = segs.reduce((a, g) => a + (num(g.len) || 0), 0);
      const rest = body.querySelector('.seg-rest');
      if (!isFinite(len)) rest.innerHTML = '<span class="note warn">長さを数値で入力してください</span>';
      else if (sum > len + 0.5) rest.innerHTML = `<span class="note warn">分割の合計 ${Math.round(sum)} mm が全長を ${Math.round(sum - len)} mm 超えています</span>`;
      else rest.innerHTML = segs.length ? `分割合計 ${Math.round(sum)} mm / 残り(壁) <b>${Math.round(len - sum)}</b> mm` : '';
      // プレビュー
      const S = Math.max(5, (tw.x2 + 1500) / 110);
      const leafMax = segs.reduce((a, g) => (g.type === 'wall' ? a : Math.max(a, num(g.len) || 0)), 0);
      const m = Math.max(16 * S + tw.thick, leafMax + tw.thick + 2 * S);
      const pv = body.querySelector('.preview');
      pv.setAttribute('viewBox', `${-m} ${-m} ${tw.x2 + 2 * m} ${2 * m}`);
      const pj = { walls: [Object.assign({}, tw, { segments: segs.map((g) => Object.assign({}, g, { len: num(g.len) || 0 })) })], columns: [], fixtures: [], labels: [], dims: [], zones: [], grid: { xs: [], ys: [], visible: false } };
      pv.innerHTML = NZ.svgDefs(S, 'pv') + NZ.renderModel(pj, S, { prefix: 'pv' }) +
        `<text x="0" y="${-tw.thick / 2 - 1.5 * S}" font-size="${2.6 * S}" text-anchor="middle" fill="#E2552D">始点</text><text x="${tw.x2}" y="${-tw.thick / 2 - 1.5 * S}" font-size="${2.6 * S}" text-anchor="middle" fill="#E2552D">終点</text>` +
        `<path d="M${tw.x2 * 0.4},${-m * 0.75} L${tw.x2 * 0.6},${-m * 0.75}" stroke="#E2552D" stroke-width="${0.4 * S}"/><path d="M${tw.x2 * 0.6 - 1.5 * S},${-m * 0.75 - S} L${tw.x2 * 0.6},${-m * 0.75} L${tw.x2 * 0.6 - 1.5 * S},${-m * 0.75 + S}" fill="none" stroke="#E2552D" stroke-width="${0.4 * S}"/>`;
      showInner();
      if (o.isNew && st.temp && st.temp.wall && isFinite(len) && len > 0) {
        const fr = NZ.wallFrame(w), cl = centerLen(len);
        Object.assign(st.temp.wall, { x2: w.x1 + fr.u.x * cl, y2: w.y1 + fr.u.y * cl, thick: tw.thick, kind: tw.kind, just: tw.just, dim: tw.dim, segments: pj.walls[0].segments, innerMode: inner, ext0: ex.e0, ext1: ex.e1 });
        renderOverlay();
      }
    };
    body.querySelector('[name="innerMode"]').addEventListener('change', (ev) => {
      const v = num(fv('len'));
      inner = ev.target.checked;
      if (isFinite(v)) body.querySelector('[name="len"]').value = Math.round(inner ? v - ex.e0 - ex.e1 : v + ex.e0 + ex.e1);
      body.querySelector('.len-label').textContent = inner ? '内法・実測値 (mm)' : '壁芯の長さ (mm)';
      update();
    });
    body.addEventListener('input', (ev) => {
      const row = ev.target.closest('.seg-row');
      if (row) {
        const i = +row.dataset.i, k = ev.target.dataset.k;
        segs[i][k] = k === 'sill' ? ev.target.checked : k === 'panels' ? +ev.target.value : ev.target.value;
        if (k === 'type') {
          const d = NZ.SEG_TYPES[segs[i].type];
          if (d.def && !num(segs[i].len)) segs[i].len = d.def;
          segs[i].panels = d.panels ? d.panels[0] : undefined;
          delete segs[i].sill;
          delete segs[i].ht;
          delete segs[i].bot;
          drawSegs();
          return;
        }
      }
      update();
    });
    body.addEventListener('change', (ev) => { if (ev.target.closest('.seg-row') && ev.target.dataset.k === 'type') drawSegs(); });
    body.addEventListener('click', (ev) => {
      const add = ev.target.dataset.add;
      if (add) {
        const def = NZ.SEG_TYPES[add];
        const len = num(fv('len')) || 0;
        const sum = segs.reduce((a, g) => a + (num(g.len) || 0), 0);
        segs.push({ type: add, len: def.def ? Math.min(def.def, Math.max(0, len - sum)) || def.def : Math.max(0, Math.round(len - sum)), hinge: 'start', side: 'right', panels: def.panels ? def.panels[0] : undefined });
        drawSegs();
        const inputs = body.querySelectorAll('.seg-row input[data-k="len"]');
        if (inputs.length) inputs[inputs.length - 1].select();
      }
      if (ev.target.dataset.del !== undefined) { segs.splice(+ev.target.dataset.del, 1); drawSegs(); }
    });
    drawSegs();
    const li = body.querySelector('[name="len"]');
    setTimeout(() => { li.focus(); li.select(); }, 50);

    function apply(d) {
      const len = num(fv('len')), thick = num(fv('thick')), height = num(fv('height'));
      if (!(len > 0) || !(thick > 0) || !(height > 0)) { toast('長さ・壁厚・壁高を正しく入力してください'); return false; }
      const segsOut = segs.map((g) => Object.assign({}, g, { len: num(g.len) || 0 })).filter((g) => g.len > 0);
      if (segsOut.reduce((a, g) => a + g.len, 0) > len + 0.5) { toast('分割の合計が全長を超えています'); return false; }
      // 建具の高さ・腰高(空欄=標準値)
      for (const g of segsOut) {
        for (const k of ['ht', 'bot']) {
          if (g[k] === undefined || String(g[k]).trim() === '') { delete g[k]; continue; }
          const v = num(g[k]);
          if (!(v >= 0) || (k === 'ht' && !(v > 0))) { toast(`${NZ.SEG_TYPES[g.type].label}の${k === 'ht' ? '高さ' : '腰高'}を正しく入力してください`); return false; }
          g[k] = Math.round(v);
        }
        const v0 = NZ.elevOpeningDefault && NZ.elevOpeningDefault(g.type);
        if (v0 && (g.ht !== undefined || g.bot !== undefined)) {
          const top = (g.bot ?? v0.bot) + (g.ht ?? v0.ht);
          if (top > height) { toast(`${NZ.SEG_TYPES[g.type].label}の上端(${v0.canBot ? '腰高+高さ' : '高さ'}=${top}mm)が壁高 ${height}mm を超えています`); return false; }
        }
      }
      const fr = NZ.wallFrame(w);
      Object.assign(st.last, { kind: fv('kind'), thick, just: fv('just') });
      const props = { thick, height, kind: fv('kind'), just: fv('just'), dim: fv('dim'), segments: segsOut, innerMode: inner };
      if (inner) props.inner = len; else delete w.inner;
      const cl = centerLen(len);
      if (o.isNew) {
        Object.assign(w, props, { anchor: 'start', x2: w.x1 + fr.u.x * cl, y2: w.y1 + fr.u.y * cl });
        P().walls.push(w);
        st.temp = null;
        st.sel = null;
      } else {
        Object.assign(w, props);
        delete w.detected;
        if (o.fixStart !== undefined) w.anchor = o.fixStart === false ? 'end' : 'start';
        if (o.measured && P().underlay && P().underlay.calibrated) w.traced = o.measured;
        // 内法入力の壁は commit 時の solveWalls で長さとつながる壁の位置を決める
        if (!inner && Math.abs(cl - fr.L) > 0.01) {
          if (w.anchor === 'end') moveWallEnd(w, 1, { x: w.x2 - fr.u.x * cl, y: w.y2 - fr.u.y * cl });
          else moveWallEnd(w, 2, { x: w.x1 + fr.u.x * cl, y: w.y1 + fr.u.y * cl });
        }
      }
      commit();
    }
  }

  // ---------- 寸法 ----------
  function handleDimStroke(pts, e) {
    const fit = fitStroke(pts);
    const A = snapPoint(fit.A) || fit.A;
    const B0 = snapPoint(fit.B);
    let dir = B0 ? null : orthoDir(fit.dir);
    const B = B0 || { x: A.x + dir.x * fit.len, y: A.y + dir.y * fit.len };
    st.temp = { line: { a: A, b: B } };
    renderOverlay();
    dimDialog(null, { x1: A.x, y1: A.y, x2: B.x, y2: B.y, offset: -8 }, e);
  }
  function dimDialog(d, init, anchor) {
    const isNew = !d;
    const e = d || Object.assign({ id: NZ.uid(), text: '' }, init);
    const L = Math.round(Math.hypot(e.x2 - e.x1, e.y2 - e.y1));
    const dlg = openDialog({
      title: isNew ? '寸法の入力' : '寸法の編集', anchor,
      html: `<div class="row"><label class="f">実測値 (mm)<input name="val" class="big" inputmode="decimal" value="${isNew ? roundTo(L) : L}"></label></div>
        <label class="chk"><input type="checkbox" name="fit" checked>線の長さを実測値に合わせる(始点固定)</label>
        <div class="row"><label class="f">寸法線の離れ(紙面mm、+/-で反対側)<input name="off" inputmode="decimal" value="${e.offset}"></label>
        <label class="f">表示文字(空欄=数値)<input name="text" value="${esc(e.text || '')}"></label></div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル', onClick: () => { st.temp = null; renderOverlay(); } },
        {
          label: 'OK', cls: 'primary', onClick: (dd) => {
            const v = num(dd.querySelector('[name=val]').value);
            if (!(v > 0)) { toast('数値を入力してください'); return false; }
            if (dd.querySelector('[name=fit]').checked) {
              const l = Math.hypot(e.x2 - e.x1, e.y2 - e.y1) || 1;
              e.x2 = e.x1 + ((e.x2 - e.x1) / l) * v; e.y2 = e.y1 + ((e.y2 - e.y1) / l) * v;
            }
            e.offset = num(dd.querySelector('[name=off]').value) || 0;
            e.text = dd.querySelector('[name=text]').value.trim();
            if (isNew) P().dims.push(e);
            st.temp = null;
            commit();
          },
        },
      ],
    });
    focusFirst(dlg.dlg);
  }

  // ---------- 縮尺合わせ ----------
  function handleCalib(pts, e) {
    const u = P().underlay;
    if (!u) { st.temp = null; renderOverlay(); toast('先に下図画像を読み込んでください'); return; }
    const fit = fitStroke(pts);
    st.temp = { line: { a: fit.A, b: fit.B } };
    renderOverlay();
    const dlg = openDialog({
      title: '下図の縮尺合わせ', anchor: e,
      html: `<div class="note">なぞった部分の実際の長さを入力してください(図面に記載の寸法や実測値)。</div>
        <div class="row"><label class="f">実寸 (mm)<input name="val" class="big" inputmode="decimal" value=""></label></div>
        <label class="chk"><input type="checkbox" name="scaleAll" checked>下図に合わせて置いた要素も一緒に拡大縮小する</label>
        <div class="note">寸法を入力して描いた壁(実測値)は、長さ・位置とも動かしません。自動検出した壁・柱、設備・文字・写真などの位置が対象です。</div>`,
      buttons: [
        { label: 'キャンセル', onClick: () => { st.temp = null; renderOverlay(); } },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const v = num(d.querySelector('[name=val]').value);
            if (!(v > 0)) { toast('数値を入力してください'); return false; }
            const k = v / fit.len;
            calibrate(k, d.querySelector('[name=scaleAll]').checked);
            st.temp = null;
            toast(`下図の縮尺を設定しました(1px = ${r2(u.mmPerPx)} mm)`);
          },
        },
      ],
    });
    focusFirst(dlg.dlg);
  }
  function calibrate(k, scaleAll) {
    const u = P().underlay;
    const ox = u.x, oy = u.y;
    u.mmPerPx *= k;
    u.calibrated = true;
    if (scaleAll) scaleModel(ox, oy, k);
    renderUnderlay();
    commit();
    fitView();
  }
  function scaleModel(ox, oy, k) {
    const sx = (x) => ox + (x - ox) * k, sy = (y) => oy + (y - oy) * k;
    const p = P();
    // 寸法を入力して描いた壁(実測値)は対象外。下図から自動検出した(未確定の)壁だけを拡大縮小する
    for (const w of p.walls) {
      if (!w.detected) continue;
      w.x1 = sx(w.x1); w.y1 = sy(w.y1); w.x2 = sx(w.x2); w.y2 = sy(w.y2);
      w.thick = Math.max(50, Math.round((w.thick * k) / 5) * 5);
      (w.segments || []).forEach((g) => (g.len *= k));
    }
    for (const c of p.columns) { c.x = sx(c.x); c.y = sy(c.y); if (c.detected) { c.w *= k; c.d *= k; } }
    for (const f of p.fixtures) { f.x = sx(f.x); f.y = sy(f.y); }
    for (const l of p.labels) { l.x = sx(l.x); l.y = sy(l.y); }
    for (const ph of p.photos || []) { ph.x = sx(ph.x); ph.y = sy(ph.y); }
    for (const d of p.dims) { d.x1 = sx(d.x1); d.y1 = sy(d.y1); d.x2 = sx(d.x2); d.y2 = sy(d.y2); }
    for (const z of [...p.zones, ...p.floors]) { z.x = sx(z.x); z.y = sy(z.y); z.w *= k; z.h *= k; }
    p.grid.xs = p.grid.xs.map(sx); p.grid.ys = p.grid.ys.map(sy);
  }

  // ---------- 柱 ----------
  function columnDialog(c, p, anchor) {
    const isNew = !c;
    const e = c || { id: NZ.uid(), x: p.x, y: p.y, w: 600, d: 600, kind: 'structure' };
    const dlg = openDialog({
      title: isNew ? '柱の配置' : '柱の編集', anchor,
      html: `<div class="row"><label class="f">幅 X (mm)<input name="w" class="big" inputmode="decimal" value="${Math.round(e.w)}"></label><label class="f">奥行 Y (mm)<input name="d" class="big" inputmode="decimal" value="${Math.round(e.d)}"></label></div>
        <div class="row"><label class="f">種別<select name="kind"><option value="structure" ${e.kind === 'structure' ? 'selected' : ''}>構造柱(変更不可)</option><option value="existing" ${e.kind === 'existing' ? 'selected' : ''}>既存柱・PS等</option></select></label></div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const w = num(d.querySelector('[name=w]').value), dd = num(d.querySelector('[name=d]').value);
            if (!(w > 0 && dd > 0)) { toast('サイズを入力してください'); return false; }
            Object.assign(e, { w, d: dd, kind: d.querySelector('[name=kind]').value });
            delete e.detected;
            snapElement({ coll: 'columns', el: e });
            if (isNew) P().columns.push(e);
            commit();
          },
        },
      ],
    });
    focusFirst(dlg.dlg);
  }

  // ---------- 設備 ----------
  function fixtureDialog(f, p, anchor, mode) {
    const isNew = !f;
    const furn = mode ? mode === 'furniture' : NZ.fixtureCat(f.type) !== 'equip';
    const type0 = f ? f.type : furn ? st.last.furnitureType || 'table' : st.last.fixtureType;
    const pre0 = NZ.FIXTURE_TYPES[type0].presets[0];
    const e = f || { id: NZ.uid(), x: p.x, y: p.y, type: type0, w: pre0.w, d: pre0.d, h: pre0.h, rot: 0, model: '', label: '', shape: pre0.shape };
    const cats = furn ? ['loose', 'built'] : ['equip', 'loose', 'built'];
    const typeOpts = cats.map((c) => `<optgroup label="${NZ.FIXTURE_CATS[c]}">` + Object.entries(NZ.FIXTURE_TYPES).filter(([k]) => NZ.fixtureCat(k) === c).map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${v.label}</option>`).join('') + '</optgroup>').join('');
    let shape = e.shape;
    const dlg = openDialog({
      title: (isNew ? (furn ? '家具の配置' : '設備の配置') : furn ? '家具の編集' : '設備の編集'), anchor, wide: true,
      html: `<div class="row"><label class="f">種類<select name="type">${typeOpts}</select></label><label class="f">サイズ選択<select name="preset"></select></label></div>
        <div class="row"><label class="f">品番<input name="model" value="${esc(e.model || '')}" placeholder="例: TOTO CES9151 / LIXIL BKW-1616"></label></div>
        ${AI_ON ? `<div class="row" style="align-items:center"><button class="btn-search" style="border:0;border-radius:9px;padding:10px 14px;background:var(--accent);color:#fff;cursor:pointer">品番の寸法をネット検索</button><span class="note">AI(Claude)がメーカー情報を検索します。結果は端末に保存され次回から再利用されます。</span></div>
        <div class="search-res"></div>` : ''}
        <div class="row"><label class="f">幅 W (mm)<input name="w" inputmode="decimal" value="${Math.round(e.w)}"></label><label class="f">奥行 D (mm)<input name="d" inputmode="decimal" value="${Math.round(e.d)}"></label><label class="f">高さ H (mm)<input name="h" inputmode="decimal" value="${Math.round(e.h || 0)}"></label></div>
        <div class="row"><label class="f">向き(背面の方向)<select name="rot">${[[0, '上(背面が上)'], [90, '右'], [180, '下'], [270, '左']].map(([v, l]) => `<option value="${v}" ${+e.rot === v ? 'selected' : ''}>${l}</option>`).join('')}${[0, 90, 180, 270].includes(+e.rot) ? '' : `<option value="${e.rot}" selected>${e.rot}°</option>`}</select></label><label class="f">表示名(空欄=種類名)<input name="label" value="${esc(e.label || '')}"></label></div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const g = (n) => d.querySelector(`[name=${n}]`).value;
            const w = num(g('w')), dd = num(g('d'));
            if (!(w > 0 && dd > 0)) { toast('幅と奥行を入力してください'); return false; }
            Object.assign(e, { type: g('type'), w, d: dd, h: num(g('h')) || 0, rot: +g('rot') || 0, model: g('model').trim(), label: g('label').trim() });
            if (shape === 'round' && e.type === 'table') e.shape = 'round'; else delete e.shape;
            delete e.detected;
            if (NZ.fixtureCat(e.type) === 'equip') st.last.fixtureType = e.type; else st.last.furnitureType = e.type;
            snapElement({ coll: 'fixtures', el: e });
            if (isNew) P().fixtures.push(e);
            commit();
          },
        },
      ],
    });
    const d = dlg.dlg;
    const fillPresets = () => {
      const t = d.querySelector('[name=type]').value;
      d.querySelector('[name=preset]').innerHTML = '<option value="">— 選択 —</option>' + NZ.FIXTURE_TYPES[t].presets.map((p, i) => `<option value="${i}">${p.name} (${p.w}×${p.d})</option>`).join('');
    };
    fillPresets();
    d.querySelector('[name=type]').addEventListener('change', () => {
      fillPresets();
      const p0 = NZ.FIXTURE_TYPES[d.querySelector('[name=type]').value].presets[0];
      d.querySelector('[name=w]').value = p0.w; d.querySelector('[name=d]').value = p0.d; d.querySelector('[name=h]').value = p0.h;
      shape = p0.shape;
    });
    d.querySelector('[name=preset]').addEventListener('change', (ev) => {
      if (ev.target.value === '') return;
      const p0 = NZ.FIXTURE_TYPES[d.querySelector('[name=type]').value].presets[+ev.target.value];
      d.querySelector('[name=w]').value = p0.w; d.querySelector('[name=d]').value = p0.d; d.querySelector('[name=h]').value = p0.h;
      shape = p0.shape;
    });
    if (AI_ON) d.querySelector('.btn-search').addEventListener('click', async () => {
      const code = d.querySelector('[name=model]').value.trim();
      const res = d.querySelector('.search-res');
      if (!code) { res.innerHTML = '<span class="note warn">品番を入力してください</span>'; return; }
      const key = code.toUpperCase().replace(/\s+/g, '');
      res.innerHTML = '<span class="spinner"></span>検索中…(30秒〜1分ほどかかることがあります)';
      try {
        let r = await NZ.db.getProduct(key);
        let cached = !!r;
        if (!r) {
          const typeLabel = NZ.FIXTURE_TYPES[d.querySelector('[name=type]').value].label;
          r = await NZ.aiSearchProduct(code, typeLabel);
          r.key = key;
          if (r.w && r.d) await NZ.db.putProduct(r);
        }
        if (r.w) d.querySelector('[name=w]').value = Math.round(r.w);
        if (r.d) d.querySelector('[name=d]').value = Math.round(r.d);
        if (r.h) d.querySelector('[name=h]').value = Math.round(r.h);
        const src = r.source && /^https?:\/\//.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source)}</a>` : esc(r.source || '');
        res.innerHTML = `<b>${esc(r.maker || '')} ${esc(r.name || '')}</b> W${r.w ?? '?'} × D${r.d ?? '?'} × H${r.h ?? '?'} mm${cached ? '(保存済みの結果)' : ''}<br>${esc(r.note || '')}<br>${src}<br><span class="note">※必ずメーカー資料で確認してください。</span>`;
      } catch (err) {
        res.innerHTML = `<span class="note warn">検索できませんでした: ${esc(err.message || err)}</span>`;
      }
    });
  }

  // ---------- 室名 ----------
  function labelDialog(l, p, anchor) {
    const isNew = !l;
    const e = l || { id: NZ.uid(), x: p.x, y: p.y, text: '', sub: '', size: 3.5 };
    const dlg = openDialog({
      title: isNew ? '室名・文字' : '文字の編集', anchor,
      html: `<div class="row"><label class="f">室名<input name="text" value="${esc(e.text)}" list="room-names"></label></div>
        <datalist id="room-names">${['LDK', 'リビング', 'ダイニング', 'キッチン', '洋室', '和室', '寝室', '子供室', '浴室', '洗面脱衣室', 'トイレ', '玄関', 'ホール', '廊下', 'WIC', '収納', 'クローゼット', 'バルコニー', 'PS', 'MB'].map((s) => `<option value="${s}">`).join('')}</datalist>
        <div class="row"><label class="f">2行目(広さ・仕上など)<input name="sub" value="${esc(e.sub || '')}" placeholder="例: 12.5帖"></label><label class="f">文字の大きさ(紙面mm)<input name="size" inputmode="decimal" value="${e.size}"></label></div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const t = d.querySelector('[name=text]').value.trim();
            if (!t) { toast('文字を入力してください'); return false; }
            Object.assign(e, { text: t, sub: d.querySelector('[name=sub]').value.trim(), size: num(d.querySelector('[name=size]').value) || 3.5 });
            if (isNew) P().labels.push(e);
            commit();
          },
        },
      ],
    });
    focusFirst(dlg.dlg);
  }

  // ---------- 水回り範囲 ----------
  function zoneDialog(z, rect, anchor) {
    const isNew = !z;
    const e = z || Object.assign({ id: NZ.uid(), type: 'kitchen', label: '' }, rect);
    openDialog({
      title: isNew ? '範囲の種類' : '範囲の編集', anchor,
      html: `<div class="row"><label class="f">種類<select name="type">${Object.entries(NZ.ZONE_TYPES).map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label><label class="f">表示名(空欄=種類名)<input name="label" value="${esc(e.label || '')}"></label></div>
        <div class="row"><label class="f">幅 (mm)<input name="w" inputmode="decimal" value="${Math.round(e.w)}"></label><label class="f">奥行 (mm)<input name="h" inputmode="decimal" value="${Math.round(e.h)}"></label></div>
        <div class="note">おおよその位置の目安です。印刷には含まれません(図面情報で変更可)。</div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル', onClick: () => { st.temp = null; renderOverlay(); } },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            Object.assign(e, { type: d.querySelector('[name=type]').value, label: d.querySelector('[name=label]').value.trim(), w: num(d.querySelector('[name=w]').value) || e.w, h: num(d.querySelector('[name=h]').value) || e.h });
            delete e.detected;
            if (isNew) P().zones.push(e);
            st.temp = null;
            commit();
          },
        },
      ],
    });
  }

  // ---------- 床仕上げ ----------
  function floorDialog(fl, rect, anchor) {
    const isNew = !fl;
    const e = fl || Object.assign({ id: NZ.uid(), type: st.last.floorType || 'flooring', size: 0, dir: 'h', showName: false }, rect);
    const dlg = openDialog({
      title: isNew ? '床仕上げ' : '床仕上げの編集', anchor,
      html: `<div class="row"><label class="f">仕上げ<select name="type">${Object.entries(NZ.FLOOR_TYPES).map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label></div>
        <div class="row"><label class="f fl-size">サイズ<select name="size"></select></label><label class="f fl-dir">向き<select name="dir"><option value="h" ${e.dir !== 'v' ? 'selected' : ''}>横方向</option><option value="v" ${e.dir === 'v' ? 'selected' : ''}>縦方向</option></select></label></div>
        <div class="row"><label class="f">幅 (mm)<input name="w" inputmode="decimal" value="${Math.round(e.w)}"></label><label class="f">奥行 (mm)<input name="h" inputmode="decimal" value="${Math.round(e.h)}"></label></div>
        <label class="chk"><input type="checkbox" name="showName" ${e.showName ? 'checked' : ''}>仕上げ名を図面に表示</label>
        <div class="note">L字の部屋は範囲を2つに分けて作成してください。壁の下に隠れる部分は気にせず、壁芯まで囲んで大丈夫です。</div>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル', onClick: () => { st.temp = null; renderOverlay(); } },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const g = (n) => d.querySelector(`[name=${n}]`);
            Object.assign(e, { type: g('type').value, size: +g('size').value || 0, dir: g('dir').value, showName: g('showName').checked, w: num(g('w').value) || e.w, h: num(g('h').value) || e.h });
            st.last.floorType = e.type;
            if (isNew) P().floors.push(e);
            st.temp = null;
            commit();
          },
        },
      ],
    });
    const d = dlg.dlg;
    const sync = () => {
      const ft = NZ.FLOOR_TYPES[d.querySelector('[name=type]').value];
      const sel = d.querySelector('[name=size]');
      const cur = +e.size || (ft.sizes[1] || ft.sizes[0] || [0])[0];
      sel.innerHTML = ft.sizes.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${l}</option>`).join('');
      d.querySelector('.fl-size').style.display = ft.sizes.length ? '' : 'none';
      d.querySelector('.fl-size').firstChild.textContent = ft.sizeLabel || 'サイズ';
      d.querySelector('.fl-dir').style.display = ft.dir ? '' : 'none';
    };
    d.querySelector('[name=type]').addEventListener('change', () => { e.size = 0; sync(); });
    sync();
  }

  function editEl(id) {
    const f = findEl(id);
    if (!f) return;
    st.sel = id;
    renderOverlay();
    const e = f.el;
    if (f.coll === 'walls') wallDialog(e, {});
    else if (f.coll === 'columns') columnDialog(e);
    else if (f.coll === 'fixtures') fixtureDialog(e);
    else if (f.coll === 'labels') labelDialog(e);
    else if (f.coll === 'photos') photoDialog(e);
    else if (f.coll === 'dims') dimDialog(e);
    else if (f.coll === 'zones') zoneDialog(e);
    else if (f.coll === 'floors') floorDialog(e);
  }

  // ---------- 選択バー ----------
  const COLL_LABEL = { walls: '壁', columns: '柱', fixtures: '設備・家具', labels: '文字', photos: '写真', dims: '寸法', zones: '範囲', floors: '床' };
  function renderSelbar() {
    const bar = $('#selbar');
    const f = st.sel && st.mode === 'draw' ? findEl(st.sel) : null;
    if (!f) { bar.classList.add('hidden'); return; }
    const e = f.el;
    let title = COLL_LABEL[f.coll];
    if (f.coll === 'walls') title = `${(NZ.WALL_KINDS[e.kind] || {}).label || '壁'} ${Math.round(NZ.wallFrame(e).L)}mm`;
    if (f.coll === 'fixtures') title = `${(NZ.FIXTURE_TYPES[e.type] || {}).label} ${Math.round(e.w)}×${Math.round(e.d)}`;
    if (f.coll === 'floors') title = `床: ${(NZ.FLOOR_TYPES[e.type] || {}).label}`;
    const btns = [['edit', '編集']];
    if (e.detected) btns.unshift(['confirm', '確定']);
    if (f.coll === 'fixtures') btns.push(['rot', '回転90°']);
    if (f.coll === 'photos') { title = `写真 No.${e.no}${e.note ? ' ' + e.note : ''}`; btns.unshift(['view', '写真を見る']); btns.push(['rot', '向き45°']); }
    if (f.coll === 'walls' && e.innerMode) title = `${(NZ.WALL_KINDS[e.kind] || {}).label || '壁'} 内法${Math.round(e.inner)}mm`;
    if (f.coll === 'walls') btns.push(['flip', '向き反転'], ['measure', '写真で測る']);
    if (['fixtures', 'columns', 'walls', 'labels', 'floors'].includes(f.coll)) btns.push(['dup', '複製']);
    btns.push(['del', '削除']);
    bar.innerHTML = `<span class="sel-title">${esc(title)}${e.detected ? '(未確定)' : ''}</span>` + btns.map(([k, l]) => `<button data-sa="${k}" class="${k === 'del' ? 'danger' : ''}">${l}</button>`).join('');
    bar.classList.remove('hidden');
  }
  $('#selbar').addEventListener('click', (ev) => {
    const a = ev.target.dataset.sa;
    if (!a) return;
    const f = findEl(st.sel);
    if (!f) return;
    const e = f.el;
    if (a === 'edit') editEl(e.id);
    if (a === 'confirm') { delete e.detected; commit(); }
    if (a === 'rot') { e.rot = ((e.rot || 0) + (f.coll === 'photos' ? 45 : 90)) % 360; commit(); }
    if (a === 'view') viewPhoto(e);
    if (a === 'measure') NZ.photoMeasure(e);
    if (a === 'flip') {
      [e.x1, e.y1, e.x2, e.y2] = [e.x2, e.y2, e.x1, e.y1];
      e.segments = (e.segments || []).slice().reverse().map((g) => Object.assign({}, g, { hinge: g.hinge === 'end' ? 'start' : 'end', side: g.side === 'left' ? 'right' : 'left' }));
      const [i0, i1] = NZ.wallInset(e);
      const total = NZ.wallFrame(e).L - i0 - i1, sum = e.segments.reduce((s, g) => s + g.len, 0);
      if (total - sum > 0.5 && e.segments.length) e.segments.unshift({ type: 'wall', len: total - sum });
      [e.ext0, e.ext1] = [e.ext1, e.ext0];
      e.anchor = e.anchor === 'end' ? 'start' : 'end';
      e.dim = e.dim === 'left' ? 'right' : e.dim === 'right' ? 'left' : e.dim;
      e.just = e.just === 'left' ? 'right' : e.just === 'right' ? 'left' : e.just;
      commit();
    }
    if (a === 'dup') {
      const c = JSON.parse(JSON.stringify(e));
      c.id = NZ.uid();
      const dd = 300;
      if ('x1' in c) { c.x1 += dd; c.y1 += dd; c.x2 += dd; c.y2 += dd; } else { c.x += dd; c.y += dd; }
      P()[f.coll].push(c);
      st.sel = c.id;
      commit();
    }
    if (a === 'del') { removeEl(e.id); st.sel = null; commit(); }
  });

  // ---------- 寸法チェック(コーション) ----------
  function runCheck() {
    st.issues = NZ.checkDrawing(P(), { tol: +st.settings.checkTol || 10 });
    const real = st.issues.filter((i) => i.level !== 'info');
    const b = $('#check-badge');
    b.textContent = real.length ? String(real.length) : '✓';
    b.className = 'badge' + (real.some((i) => i.level === 'error') ? ' error' : real.length ? ' warn' : '');
    if (st.issueSel && !st.issues.some((i) => i.key === st.issueSel)) st.issueSel = null;
    if (!$('#issues').classList.contains('hidden')) renderIssues();
  }
  function issueMarkers(px) {
    if (st.mode !== 'draw') return '';
    let s = '';
    st.issues.forEach((it, i) => {
      if (it.level === 'info') return;
      const col = it.level === 'error' ? '#d23c3c' : '#e08a00';
      const on = it.key === st.issueSel;
      if (on) {
        if (it.area) s += `<polygon points="${it.area.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' ')}" fill="${col}" fill-opacity=".18" stroke="${col}" stroke-width="${px(2)}"/>`;
        if (it.line) s += `<line x1="${it.line.a.x}" y1="${it.line.a.y}" x2="${it.line.b.x}" y2="${it.line.b.y}" stroke="${col}" stroke-width="${px(3)}" stroke-dasharray="${px(6)} ${px(4)}"/>`;
        s += `<circle cx="${it.x}" cy="${it.y}" r="${px(26)}" fill="none" stroke="${col}" stroke-width="${px(3)}"/>`;
      } else if (it.line) {
        s += `<line x1="${it.line.a.x}" y1="${it.line.a.y}" x2="${it.line.b.x}" y2="${it.line.b.y}" stroke="${col}" stroke-width="${px(2)}" stroke-dasharray="${px(4)} ${px(4)}" opacity=".7"/>`;
      }
      const h = 22, x = it.x, y = it.y;
      s += `<g data-issue="${i}"><path d="M${x},${y - px(h * 0.62)} L${x + px(h * 0.58)},${y + px(h * 0.42)} L${x - px(h * 0.58)},${y + px(h * 0.42)}Z" fill="${col}" stroke="#fff" stroke-width="${px(2)}"/>`;
      s += `<text x="${x}" y="${y + px(h * 0.3)}" font-size="${px(12)}" font-weight="800" text-anchor="middle" fill="#fff">${i + 1}</text></g>`;
    });
    return s;
  }
  const LV = { error: '要再測', warn: '要確認', info: 'お知らせ' };
  function renderIssues() {
    const list = $('#issues-list');
    const real = st.issues.filter((i) => i.level !== 'info');
    const ne = real.filter((i) => i.level === 'error').length;
    $('#issues-sum').textContent = real.length ? `要再測 ${ne}件 / 要確認 ${real.length - ne}件` : '';
    if (!st.issues.length) { list.innerHTML = '<div class="issues-ok">✓ 辻褄の合わない寸法は見つかりません</div>'; return; }
    list.innerHTML = st.issues.map((it, i) => {
      const targets = [...new Set(it.ids)].map((id) => findEl(id)).filter(Boolean).slice(0, 3);
      const btns = targets.map((f, k) => {
        let name = COLL_LABEL[f.coll];
        if (f.coll === 'walls') name = `壁 ${Math.round(NZ.wallFrame(f.el).L)}`;
        if (f.coll === 'fixtures') name = (NZ.FIXTURE_TYPES[f.el.type] || {}).label || name;
        return `<button data-fix="${f.el.id}" class="${k === 0 ? 'primary' : ''}">測り直す: ${esc(name)}</button>`;
      }).join('');
      return `<div class="issue ${it.level} ${it.key === st.issueSel ? 'on' : ''}" data-key="${esc(it.key)}"><div class="msg"><span class="lv">${it.level === 'info' ? '' : `${i + 1}. `}${LV[it.level]}</span>${esc(it.msg)}</div>
        <div class="acts">${btns}${it.level === 'info' ? '' : `<button data-ign="${esc(it.key)}">無視</button>`}</div></div>`;
    }).join('');
  }
  function focusIssue(key) {
    const it = st.issues.find((i) => i.key === key);
    if (!it) return;
    st.issueSel = key;
    const v = st.views.draw;
    v.cx = it.x; v.cy = it.y;
    v.zoom = Math.max(v.zoom, 0.12);
    updateView();
    renderOverlay();
    renderIssues();
  }
  function toggleIssues(open) {
    const el = $('#issues');
    const show = open ?? el.classList.contains('hidden');
    el.classList.toggle('hidden', !show);
    if (show) {
      if (st.mode !== 'draw') $('#mode-switch [data-mode=draw]').click();
      renderIssues();
    } else { st.issueSel = null; renderOverlay(); }
  }
  $('#btn-check').onclick = () => toggleIssues();
  $('#issues-close').onclick = () => toggleIssues(false);
  $('#issues-list').addEventListener('click', (ev) => {
    const fix = ev.target.dataset.fix, ign = ev.target.dataset.ign;
    if (fix) { editEl(fix); return; }
    if (ign) { (P().ignoredIssues = P().ignoredIssues || []).push(ign); commit(); return; }
    const card = ev.target.closest('.issue');
    if (card) focusIssue(card.dataset.key);
  });
  $('#issues-unignore').onclick = () => { P().ignoredIssues = []; commit(); };
  $('#issues-print').onclick = printIssues;
  $('#lay-check').addEventListener('change', renderOverlay);

  // 要再測リスト(図面に番号を付けたもの+一覧)を印刷
  function printIssues() {
    const real = st.issues.filter((i) => i.level !== 'info');
    if (!real.length) { toast('要再測・要確認の項目はありません'); return; }
    const sh = NZ.renderSheet(P());
    let marks = '';
    st.issues.forEach((it, i) => {
      if (it.level === 'info') return;
      const x = sh.tx + it.x / sh.S, y = sh.ty + it.y / sh.S, col = it.level === 'error' ? '#d23c3c' : '#e08a00';
      marks += `<circle cx="${r2(x)}" cy="${r2(y)}" r="3.2" fill="${col}" stroke="#fff" stroke-width="0.4"/><text x="${r2(x)}" y="${r2(y + 1.2)}" font-size="3.2" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">${i + 1}</text>`;
    });
    const svg = sh.svg.replace(/<\/svg>$/, marks + '</svg>');
    const rows = st.issues.map((it, i) => (it.level === 'info' ? '' : `<tr><td>${i + 1}</td><td>${LV[it.level]}</td><td>${esc(it.msg)}</td><td style="width:40mm"></td></tr>`)).join('');
    $('#print-area').innerHTML = `<style>@page{size:${sh.W}mm ${sh.H}mm;margin:0}.ip{page-break-before:always;padding:12mm;font-family:${NZ.FONT};font-size:10pt}.ip table{border-collapse:collapse;width:100%}.ip td,.ip th{border:0.3mm solid #333;padding:2mm;vertical-align:top}.ip th{background:#eee}</style>${svg}
      <div class="ip"><h2 style="margin:0 0 4mm">要再測リスト ${esc(P().meta.name || '')}</h2><p>作成 ${new Date().toLocaleString('ja-JP')} / 許容差 ${+st.settings.checkTol || 10}mm</p>
      <table><tr><th style="width:10mm">No</th><th style="width:18mm">区分</th><th>内容</th><th>再測結果メモ</th></tr>${rows}</table></div>`;
    setTimeout(() => window.print(), 100);
  }

  // ---------- ダイアログ基盤 ----------
  function openDialog({ title, html, buttons = [], wide, anchor }) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    const dlg = document.createElement('div');
    dlg.className = 'dialog' + (wide ? ' wide' : '');
    dlg.innerHTML = `<h3>${esc(title)}</h3><div class="dlg-body">${html}</div><div class="dlg-btns"></div>`;
    back.appendChild(dlg);
    $('#modal-root').appendChild(back);
    const close = () => back.remove();
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.cls) btn.className = b.cls;
      btn.onclick = async () => {
        if (b.onClick) { const r = await b.onClick(dlg); if (r === false) return; }
        close();
      };
      dlg.querySelector('.dlg-btns').appendChild(btn);
    });
    // なぞった位置の近くに表示(画面に収まるよう調整)
    if (anchor && anchor.clientX !== undefined && window.innerWidth > 700) {
      back.classList.add('anchored');
      const r = dlg.getBoundingClientRect();
      let x = anchor.clientX + 24, y = anchor.clientY - 40;
      if (x + r.width > window.innerWidth - 8) x = anchor.clientX - r.width - 24;
      x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
      y = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
      dlg.style.position = 'absolute'; dlg.style.left = x + 'px'; dlg.style.top = y + 'px';
    }
    dlg.addEventListener('keydown', (ev) => {
      // 日本語変換中(未確定)の Enter/スペースは無視し、変換確定後の Enter でだけ OK にする
      if (ev.isComposing || ev.keyCode === 229) return;
      if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); const p = dlg.querySelector('.dlg-btns .primary'); if (p) p.click(); }
      if (ev.key === 'Escape') { const btns = dlg.querySelectorAll('.dlg-btns button'); [...btns].find((b) => b.textContent === 'キャンセル' || b.textContent === '閉じる')?.click(); }
    });
    return { dlg, close };
  }
  function focusFirst(d) {
    const i = d.querySelector('input.big, input');
    if (i) setTimeout(() => { i.focus(); i.select && i.select(); }, 50);
  }
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }
  function busy(msg) {
    return openDialog({ title: '処理中', html: `<p><span class="spinner"></span>${esc(msg)}</p>` });
  }

  // ---------- 下図 ----------
  function loadImageFile(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 大きすぎる画像は縮小して保存
        const k = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
        let src = fr.result, w = img.naturalWidth, h = img.naturalHeight;
        if (k < 1) {
          const c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          src = c.toDataURL('image/jpeg', 0.88);
          w = c.width; h = c.height;
        }
        // 未校正時の仮縮尺: 画像幅 = 12m
        P().underlay = { src, w, h, x: 0, y: 0, mmPerPx: 12000 / w, opacity: 0.5, visible: true, calibrated: false };
        st.underSrc = src;
        renderUnderlay();
        commit();
        st.mode = 'draw';
        fitView();
        openDialog({
          title: '下図を読み込みました',
          html: `<p class="note">次に「縮尺合せ」ツールで、図面上の長さが分かっている部分(例: 記載寸法のある壁)をなぞって実寸を入力してください。<br>その後、メニューの「構造壁・柱を自動検出」${AI_ON ? 'または「AIで図面を解析」' : ''}を実行すると、構造壁・柱・水回りの位置を取り込めます。</p>`,
          buttons: [{ label: '閉じる' }, { label: '縮尺合せへ', cls: 'primary', onClick: () => setTool('calib') }],
        });
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  const underImg = () => new Promise((res, rej) => {
    const u = P().underlay;
    if (!u || !u.src) return rej(new Error('下図がありません'));
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('下図画像を読み込めません'));
    img.src = u.src;
  });

  function underlayDialog() {
    const u = P().underlay;
    if (!u) { toast('下図がありません。メニューから読み込んでください'); return; }
    openDialog({
      title: '下図の表示設定',
      html: `<label class="chk"><input type="checkbox" name="vis" ${u.visible ? 'checked' : ''}>下図を表示する</label>
        <div class="row"><label class="f">濃さ<input type="range" name="op" min="0.1" max="1" step="0.05" value="${u.opacity}"></label></div>
        <div class="row"><label class="f">縮尺(1px あたり mm)<input name="mpp" inputmode="decimal" value="${r2(u.mmPerPx)}"></label></div>
        <div class="note">${u.calibrated ? '縮尺合せ済み' : '縮尺未設定(仮に画像幅=12m)。「縮尺合せ」ツールで合わせてください。'}</div>`,
      buttons: [
        { label: '下図を削除', cls: 'danger', onClick: () => { P().underlay = null; st.underSrc = null; renderUnderlay(); commit(); } },
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            u.visible = d.querySelector('[name=vis]').checked;
            u.opacity = +d.querySelector('[name=op]').value;
            const m = num(d.querySelector('[name=mpp]').value);
            if (m > 0 && Math.abs(m - u.mmPerPx) > 1e-6) { u.mmPerPx = m; u.calibrated = true; }
            renderUnderlay();
            commit();
          },
        },
      ],
    });
  }

  // ---------- 検出結果の取り込み ----------
  const pxToMm = (u, x, y) => ({ x: u.x + x * u.mmPerPx, y: u.y + y * u.mmPerPx });
  const r5 = (v) => Math.max(50, Math.round(v / 5) * 5);

  // 検出した壁の端点を、交差する壁の中心線に合わせて角をつなぐ
  function joinWalls(walls) {
    for (const w of walls) {
      for (const which of [1, 2]) {
        const e = which === 1 ? { x: w.x1, y: w.y1 } : { x: w.x2, y: w.y2 };
        for (const o of walls) {
          if (o === w) continue;
          const fo = NZ.wallFrame(o), fw = NZ.wallFrame(w);
          if (Math.abs(fo.u.x * fw.u.x + fo.u.y * fw.u.y) > 0.2) continue;
          const t = (e.x - o.x1) * fo.u.x + (e.y - o.y1) * fo.u.y;
          const q = { x: o.x1 + fo.u.x * t, y: o.y1 + fo.u.y * t };
          const dist = Math.hypot(q.x - e.x, q.y - e.y);
          if (dist > o.thick * 0.75 + w.thick) continue;
          if (t < -w.thick * 1.5 || t > fo.L + w.thick * 1.5) continue;
          if (which === 1) { w.x1 = q.x; w.y1 = q.y; } else { w.x2 = q.x; w.y2 = q.y; }
          // 相手の端が足りなければ延ばす
          if (t < 0) { o.x1 = q.x; o.y1 = q.y; } else if (t > fo.L) { o.x2 = q.x; o.y2 = q.y; }
          break;
        }
      }
    }
    // 端点の微小なずれを統合
    const ends = [];
    for (const w of walls) for (const k of [1, 2]) ends.push({ w, k });
    for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i], b = ends[j];
      const ax = a.k === 1 ? a.w.x1 : a.w.x2, ay = a.k === 1 ? a.w.y1 : a.w.y2;
      const bx = b.k === 1 ? b.w.x1 : b.w.x2, by = b.k === 1 ? b.w.y1 : b.w.y2;
      if (a.w !== b.w && Math.hypot(ax - bx, ay - by) < Math.max(a.w.thick, b.w.thick) * 0.6) {
        if (b.k === 1) { b.w.x1 = ax; b.w.y1 = ay; } else { b.w.x2 = ax; b.w.y2 = ay; }
      }
    }
    return walls.filter((w) => NZ.wallFrame(w).L > w.thick);
  }
  function straighten(w) {
    const dx = Math.abs(w.x2 - w.x1), dy = Math.abs(w.y2 - w.y1);
    if (dy < dx * 0.08) { const y = (w.y1 + w.y2) / 2; w.y1 = w.y2 = y; }
    else if (dx < dy * 0.08) { const x = (w.x1 + w.x2) / 2; w.x1 = w.x2 = x; }
    return w;
  }
  function addDetected({ walls = [], columns = [], zones = [] }, replace) {
    const p = P();
    if (replace) for (const c of COLLS) p[c] = p[c].filter((e) => !e.detected);
    const ws = joinWalls(walls.map(straighten));
    p.walls.push(...ws);
    p.columns.push(...columns);
    p.zones.push(...zones);
    commit();
    fitView();
  }

  function detectDialog() {
    const u = P().underlay;
    if (!u) { toast('先に下図画像を読み込んでください'); return; }
    openDialog({
      title: '構造壁・柱の自動検出(オフライン)',
      html: `<p class="note">下図の中で、黒く太く塗られた(またはハッチングされた)壁・柱を検出します。検出結果はオレンジの破線で表示され、「確定」するまで未確定扱いです。${u.calibrated ? '' : '<br><b class="note warn">下図の縮尺が未設定です。先に縮尺合せをすると精度が上がります。</b>'}</p>
        <div class="row"><label class="f">構造壁の最小厚 (mm)<input name="tmin" inputmode="decimal" value="120"></label><label class="f">構造壁の最大厚 (mm)<input name="tmax" inputmode="decimal" value="450"></label></div>
        <div class="row"><label class="f">黒さのしきい値 (0-255)<input name="thr" inputmode="decimal" value="120"></label><label class="f">ハッチ埋め (px)<input name="close" inputmode="decimal" value="2"></label></div>
        <label class="chk"><input type="checkbox" name="replace" checked>前回の未確定の検出結果を置き換える</label>`,
      buttons: [
        { label: 'キャンセル' },
        {
          label: '検出する', cls: 'primary', onClick: async (d) => {
            const g = (n) => num(d.querySelector(`[name=${n}]`).value);
            const replace = d.querySelector('[name=replace]').checked;
            try {
              const img = await underImg();
              const res = NZ.detectStructure(img, { minThickPx: g('tmin') / u.mmPerPx, maxThickPx: g('tmax') / u.mmPerPx, threshold: g('thr') || 120, close: g('close') || 0 });
              const walls = res.walls.map((w) => {
                const a = pxToMm(u, w.x1, w.y1), b = pxToMm(u, w.x2, w.y2);
                return { id: NZ.uid(), x1: a.x, y1: a.y, x2: b.x, y2: b.y, thick: r5(w.thick * u.mmPerPx), kind: 'structure', just: 'center', dim: 'none', segments: [], detected: true };
              });
              const columns = res.columns.map((c) => { const a = pxToMm(u, c.x, c.y); return { id: NZ.uid(), x: a.x, y: a.y, w: r5(c.w * u.mmPerPx), d: r5(c.d * u.mmPerPx), kind: 'structure', detected: true }; });
              addDetected({ walls, columns }, replace);
              toast(`構造壁 ${walls.length} 本、柱 ${columns.length} 本を検出しました。確認して「確定」してください。`, 4000);
            } catch (err) { toast('検出に失敗しました: ' + err.message); }
          },
        },
      ],
    });
  }

  async function aiAnalyze() {
    const u = P().underlay;
    if (!AI_ON) { toast('この版ではAI機能は使えません'); return; }
    if (!u) { toast('先に下図画像を読み込んでください'); return; }
    if (!st.settings.apiKey) { toast('設定で Anthropic APIキーを入力してください'); settingsDialog(); return; }
    openDialog({
      title: 'AIで図面を解析',
      html: `<p class="note">下図画像を Claude(Anthropic)に送信し、構造壁・間仕切壁・柱・キッチン/トイレ/浴室などのおおよその位置を読み取ります。結果は未確定(オレンジ破線)として取り込みます。<br>画像は Anthropic のサーバーに送信されます。1回あたり数十円程度のAPI利用料がかかります。</p>
        <label class="chk"><input type="checkbox" name="replace" checked>前回の未確定の検出結果を置き換える</label>
        <label class="chk"><input type="checkbox" name="partition" checked>間仕切壁(撤去可能な壁)も取り込む</label>`,
      buttons: [
        { label: 'キャンセル' },
        {
          label: '解析する', cls: 'primary', onClick: async (d) => {
            const replace = d.querySelector('[name=replace]').checked, part = d.querySelector('[name=partition]').checked;
            const b = busy('AIが図面を解析しています(1〜2分かかることがあります)…');
            try {
              const img = await underImg();
              const j = await NZ.aiAnalyzePlan(img);
              b.close();
              if (j.scale_hint && j.scale_hint.mm > 0 && !u.calibrated) {
                const h = j.scale_hint, pxLen = Math.hypot(h.x2 - h.x1, h.y2 - h.y1);
                if (pxLen > 10) { u.mmPerPx = h.mm / pxLen; u.calibrated = true; renderUnderlay(); toast(`図中の寸法(${h.mm}mm)から下図の縮尺を設定しました`); }
              }
              const mkWall = (w, kind) => {
                const a = pxToMm(u, w.x1, w.y1), bb = pxToMm(u, w.x2, w.y2);
                return { id: NZ.uid(), x1: a.x, y1: a.y, x2: bb.x, y2: bb.y, thick: r5((w.thickness || 10) * u.mmPerPx), kind, just: 'center', dim: 'none', segments: [], detected: true };
              };
              const walls = (j.structural_walls || []).map((w) => mkWall(w, 'structure'));
              if (part) walls.push(...(j.partition_walls || []).map((w) => mkWall(w, 'existing')));
              const columns = (j.columns || []).map((c) => { const a = pxToMm(u, c.x, c.y); return { id: NZ.uid(), x: a.x, y: a.y, w: r5(c.w * u.mmPerPx), d: r5(c.d * u.mmPerPx), kind: 'structure', detected: true }; });
              const zones = (j.rooms || []).filter((r) => r.w > 0 && r.h > 0).map((r) => {
                const a = pxToMm(u, r.x, r.y);
                return { id: NZ.uid(), type: NZ.ZONE_TYPES[r.type] ? r.type : 'other', label: r.name || '', x: a.x, y: a.y, w: r.w * u.mmPerPx, h: r.h * u.mmPerPx, detected: true };
              });
              addDetected({ walls, columns, zones }, replace);
              toast(`壁 ${walls.length}、柱 ${columns.length}、範囲 ${zones.length} を取り込みました。実測しながら確定してください。`, 5000);
            } catch (err) {
              b.close();
              toast('解析に失敗しました: ' + (err.message || err), 5000);
            }
          },
        },
      ],
    });
  }

  // ---------- 通り芯 ----------
  function gridDialog() {
    const g = P().grid;
    const toSpec = (arr) => { const a = [...arr].sort((x, y) => x - y); return { o: a.length ? Math.round(a[0]) : '', s: a.slice(1).map((v, i) => Math.round(v - a[i])).join(', ') }; };
    const sx = toSpec(g.xs), sy = toSpec(g.ys);
    openDialog({
      title: '通り芯の設定', wide: true,
      html: `<p class="note">縦の通り芯に 1, 2, 3…、横の通り芯に A, B, C… の符号が付きます。間隔はカンマ区切りで入力(例: 3640, 2730, 3640)。</p>
        <label class="chk"><input type="checkbox" name="vis" ${g.visible ? 'checked' : ''}>通り芯を表示する</label>
        <div class="row"><label class="f">縦の通り芯(1,2,3…) 起点X (mm)<input name="ox" inputmode="decimal" value="${sx.o}"></label><label class="f">間隔 (mm)<input name="sx" value="${sx.s}"></label></div>
        <div class="row"><label class="f">横の通り芯(A,B,C…) 起点Y (mm)<input name="oy" inputmode="decimal" value="${sy.o}"></label><label class="f">間隔 (mm)<input name="sy" value="${sy.s}"></label></div>`,
      buttons: [
        { label: '構造体から自動生成', onClick: (d) => { autoGrid(); const n = toSpec(P().grid.xs), m = toSpec(P().grid.ys); d.querySelector('[name=ox]').value = n.o; d.querySelector('[name=sx]').value = n.s; d.querySelector('[name=oy]').value = m.o; d.querySelector('[name=sy]').value = m.s; return false; } },
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const build = (o, s) => {
              const ov = num(o);
              if (!isFinite(ov)) return [];
              const out = [ov];
              for (const t of String(s).split(/[,、\s]+/).filter(Boolean)) { const v = num(t); if (v > 0) out.push(out[out.length - 1] + v); }
              return out;
            };
            g.xs = build(d.querySelector('[name=ox]').value, d.querySelector('[name=sx]').value);
            g.ys = build(d.querySelector('[name=oy]').value, d.querySelector('[name=sy]').value);
            g.visible = d.querySelector('[name=vis]').checked;
            commit();
          },
        },
      ],
    });
  }
  function autoGrid() {
    const xs = [], ys = [];
    for (const w of P().walls) {
      if (w.kind !== 'structure') continue;
      const fr = NZ.wallFrame(w), off = NZ.wallOffset(w);
      if (Math.abs(fr.u.y) > 0.99) xs.push(w.x1 + fr.n.x * off);
      if (Math.abs(fr.u.x) > 0.99) ys.push(w.y1 + fr.n.y * off);
    }
    for (const c of P().columns) { xs.push(c.x); ys.push(c.y); }
    const cluster = (arr) => {
      arr.sort((a, b) => a - b);
      const out = [];
      for (const v of arr) { if (out.length && v - out[out.length - 1].v < 300) { const o = out[out.length - 1]; o.v = (o.v * o.n + v) / (o.n + 1); o.n++; } else out.push({ v, n: 1 }); }
      return out.map((o) => Math.round(o.v / 5) * 5);
    };
    P().grid.xs = cluster(xs);
    P().grid.ys = cluster(ys);
    P().grid.visible = true;
    commit();
    if (!xs.length && !ys.length) toast('構造壁・柱がないため自動生成できませんでした');
  }

  // ---------- 図面情報・設定 ----------
  function titleDialog() {
    const m = P().meta;
    const f = (name, label, val, attrs = '') => `<label class="f">${label}<input name="${name}" value="${esc(val ?? '')}" ${attrs}></label>`;
    openDialog({
      title: '図面情報(表題欄)', wide: true,
      html: `<div class="row">${f('name', '物件名', m.name)}</div>
        <div class="row">${f('title', '図面名', m.title)}${f('drawingNo', '図面番号', m.drawingNo)}</div>
        <div class="row"><label class="f">縮尺<select name="scale"><option value="auto" ${m.scale === 'auto' ? 'selected' : ''}>自動(用紙に収まる縮尺)</option>${NZ.SCALES.map((s) => `<option value="${s}" ${+m.scale === s ? 'selected' : ''}>1/${s}</option>`).join('')}</select></label>
          <label class="f">用紙<select name="paper">${Object.keys(NZ.PAPERS).map((k) => `<option ${m.paper === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
          ${f('date', '作成日', m.date, 'type="date"')}</div>
        <div class="row">${f('author', '図面作成者', m.author)}${f('license', '許認可番号(建築士登録・建設業許可など)', m.license)}</div>
        <div class="row">${f('company', '会社名', m.company)}${f('companySub', '会社住所・TEL など', m.companySub)}</div>
        <div class="row"><label class="f">備考(図面下部に記載)<textarea name="note" rows="3">${esc(m.note || '')}</textarea></label></div>
        <div class="row">${f('north', '方位(北の向き:上から時計回りの角度)', m.north, 'inputmode="decimal"')}<label class="chk"><input type="checkbox" name="printZones" ${m.printZones ? 'checked' : ''}>水回り範囲も印刷する</label></div>
        <label class="chk"><input type="checkbox" name="saveDefault">会社名・作成者・許認可番号を今後の既定値として保存</label>`,
      buttons: [
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: (d) => {
            const g = (n) => d.querySelector(`[name=${n}]`);
            for (const k of ['name', 'title', 'drawingNo', 'scale', 'paper', 'date', 'author', 'license', 'company', 'companySub', 'note']) m[k] = g(k).value;
            m.north = num(g('north').value) || 0;
            m.printZones = g('printZones').checked;
            if (g('saveDefault').checked) {
              Object.assign(st.settings, { company: m.company, companySub: m.companySub, author: m.author, license: m.license });
              NZ.saveSettings(st.settings);
            }
            commit();
            if (st.mode === 'sheet') fitView();
          },
        },
      ],
    });
  }
  function settingsDialog() {
    const s = st.settings;
    openDialog({
      title: '設定', wide: true,
      html: `<div class="seg-head">新規図面の既定値</div>
        <div class="row"><label class="f">会社名<input name="company" value="${esc(s.company)}"></label><label class="f">会社住所・TEL など<input name="companySub" value="${esc(s.companySub)}"></label></div>
        <div class="row"><label class="f">図面作成者<input name="author" value="${esc(s.author)}"></label><label class="f">許認可番号<input name="license" value="${esc(s.license)}" placeholder="例: 一級建築士 第000000号"></label></div>
        <div class="row"><label class="f">寸法の丸め (mm)<select name="round">${[1, 5, 10].map((v) => `<option ${+s.round === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f">寸法チェックの許容差 (mm)<select name="checkTol">${[3, 5, 10, 20, 30].map((v) => `<option ${+(s.checkTol || 10) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
        <div class="row"><label class="f">壁の寸法の入力方法(新しく描く壁)<select name="innerMode"><option value="1" ${s.innerMode !== false ? 'selected' : ''}>内法(実測値)… 接続する壁の厚み分を自動で加算</option><option value="0" ${s.innerMode === false ? 'selected' : ''}>壁芯(芯々)</option></select></label></div>
        <label class="chk"><input type="checkbox" name="applyCur">今開いている図面の表題欄にも反映する</label>
        ${AI_ON ? `<div class="seg-head">AI機能(図面解析・品番検索)</div>
        <div class="row"><label class="f">Anthropic APIキー<input name="apiKey" type="password" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off"></label></div>
        <div class="row"><label class="f">モデル<select name="model">${['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'].map((m) => `<option ${s.model === m ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
        <p class="note">APIキーはこの端末のブラウザ内にのみ保存されます。共用端末では入力しないでください。キーは console.anthropic.com で発行できます。</p>` : ''}`,
      buttons: [
        { label: 'キャンセル' },
        {
          label: '保存', cls: 'primary', onClick: (d) => {
            const g = (n) => d.querySelector(`[name=${n}]`).value;
            Object.assign(s, { company: g('company'), companySub: g('companySub'), author: g('author'), license: g('license'), round: +g('round'), checkTol: +g('checkTol'), innerMode: g('innerMode') === '1' });
            if (AI_ON) Object.assign(s, { apiKey: g('apiKey').trim(), model: g('model') });
            NZ.saveSettings(s);
            if (d.querySelector('[name=applyCur]').checked) { Object.assign(P().meta, { company: s.company, companySub: s.companySub, author: s.author, license: s.license }); commit(); }
            renderAll();
            toast('設定を保存しました');
          },
        },
      ],
    });
  }

  // ---------- 図面一覧 ----------
  // ---------- 現場写真 ----------
  const PHOTO_DIRS = [[0, '上'], [45, '右上'], [90, '右'], [135, '右下'], [180, '下'], [225, '左下'], [270, '左'], [315, '左上']];
  const dirLabel = (rot) => { const r = (((+rot || 0) % 360) + 360) % 360; const d = PHOTO_DIRS.find(([v]) => v === r); return d ? d[1] : `${r}°`; };
  // 撮った写真を長辺 1600px の JPEG に縮小(端末の容量を節約)
  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ data: c.toDataURL('image/jpeg', 0.8), w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }
  function photoDialog(ph, p) {
    const isNew = !ph;
    const nextNo = Math.max(0, ...(P().photos || []).map((x) => +x.no || 0)) + 1;
    const e = ph || { id: NZ.uid(), no: nextNo, x: p.x, y: p.y, rot: 0, note: '', img: null };
    let picked = null; // 新しく選んだ写真
    const dlg = openDialog({
      title: isNew ? '写真を追加' : `写真 No.${e.no}`, wide: true,
      html: `<label class="photo-pick"><input type="file" name="file" accept="image/*" hidden>📷 ${isNew ? '撮影する / 写真を選ぶ' : '写真を撮り直す / 選び直す'}</label>
        <img class="photo-prev ${isNew ? 'hidden' : ''}" alt="写真">
        <div class="row"><label class="f">番号<input name="no" inputmode="numeric" value="${esc(e.no)}"></label>
          <label class="f">撮影した向き(図面上)<select name="rot">${PHOTO_DIRS.map(([v, l]) => `<option value="${v}" ${+e.rot === v ? 'selected' : ''}>${l}</option>`).join('')}${PHOTO_DIRS.some(([v]) => v === +e.rot) ? '' : `<option value="${e.rot}" selected>${e.rot}°</option>`}</select></label></div>
        <div class="row"><label class="f">メモ(場所・内容)<input name="note" value="${esc(e.note || '')}" placeholder="例: 洋室1 北側の窓まわり"></label></div>
        <p class="note">写真はこの端末の中にだけ保存されます(縮小して保存)。別の端末へは「データ書き出し(.json)」で写真ごと移せます。</p>`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', cls: 'danger', onClick: () => { removeEl(e.id); st.sel = null; commit(); } }]),
        { label: 'キャンセル' },
        {
          label: 'OK', cls: 'primary', onClick: async (d) => {
            if (isNew && !picked) { toast('写真を撮影するか選んでください'); return false; }
            const no = d.querySelector('[name=no]').value.trim();
            if (!no) { toast('番号を入力してください'); return false; }
            if (picked) {
              const img = NZ.uid();
              try { await NZ.db.putPhoto({ id: img, projectId: P().id, data: picked.data, w: picked.w, h: picked.h, createdAt: Date.now() }); }
              catch (err) { toast('写真を保存できませんでした(端末の空き容量を確認してください)'); return false; }
              e.img = img;
            }
            Object.assign(e, { no, rot: +d.querySelector('[name=rot]').value || 0, note: d.querySelector('[name=note]').value.trim() });
            if (isNew) P().photos.push(e);
            st.sel = e.id;
            commit();
          },
        },
      ],
    });
    const d = dlg.dlg, prev = d.querySelector('.photo-prev');
    if (!isNew && e.img) NZ.db.getPhoto(e.img).then((r) => { if (r) prev.src = r.data; else prev.alt = '写真が見つかりません(この端末にありません)'; });
    prev.addEventListener('click', () => { if (prev.src) viewPhoto(e, prev.src); });
    d.querySelector('[name=file]').addEventListener('change', async (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const b = busy('写真を読み込んでいます…');
      try { picked = await shrinkPhoto(f); prev.src = picked.data; prev.classList.remove('hidden'); }
      catch (err) { toast(err.message); }
      b.close();
      ev.target.value = '';
    });
  }
  async function viewPhoto(ph, src) {
    if (!src) { const r = ph.img && (await NZ.db.getPhoto(ph.img)); if (!r) { toast('写真が見つかりません(この端末にありません)'); return; } src = r.data; }
    const wrap = document.createElement('div');
    wrap.className = 'preview-wrap';
    wrap.innerHTML = `<div class="preview-bar"><span class="title">写真 No.${esc(ph.no)} 向き:${esc(dirLabel(ph.rot))}${ph.note ? ' ' + esc(ph.note) : ''}</span><button data-pv="close">閉じる</button></div><div class="preview-scroll"><img class="photo-view" alt="写真"></div>`;
    wrap.querySelector('img').src = src;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (ev) => { if (ev.target.dataset.pv === 'close') wrap.remove(); });
  }
  // 写真台帳: A4縦に3枚ずつ。番号・場所(室名)・向き・メモ
  async function printPhotoList() {
    const list = (P().photos || []).slice().sort((a, b) => (+a.no || 0) - (+b.no || 0) || String(a.no).localeCompare(String(b.no)));
    if (!list.length) { toast('写真がありません。左の「写真」ツールで追加してください'); return; }
    const m = P().meta, rows = [];
    for (const ph of list) {
      const r = ph.img && (await NZ.db.getPhoto(ph.img));
      const room = NZ.roomAt ? NZ.roomAt(P(), ph) : null;
      rows.push(`<div class="pr"><div class="pi">${r ? `<img src="${r.data}">` : '<span>写真なし(この端末にありません)</span>'}</div>
        <table><tr><th>No.</th><td>${esc(ph.no)}</td></tr><tr><th>場所</th><td>${esc(room ? room.name : '')}</td></tr><tr><th>向き</th><td>図面の${esc(dirLabel(ph.rot))}方向</td></tr><tr><th>メモ</th><td>${esc(ph.note || '')}</td></tr></table></div>`);
    }
    const pages = [];
    for (let i = 0; i < rows.length; i += 3) pages.push(rows.slice(i, i + 3).join(''));
    const head = (i) => `<div class="ph"><b>写真一覧</b><span>${esc(m.name || '')}</span><span>${esc((m.date || '').replace(/-/g, '.'))}</span><span>${esc(m.company || '')}</span><span>${i + 1}/${pages.length}</span></div>`;
    $('#print-area').innerHTML = `<style>@page{size:210mm 297mm;margin:0}
      .pp{width:210mm;height:297mm;box-sizing:border-box;padding:12mm;page-break-after:always;font-family:${NZ.FONT};font-size:10pt;color:#111}
      .ph{display:flex;gap:6mm;align-items:baseline;border-bottom:0.4mm solid #111;padding-bottom:2mm;margin-bottom:4mm}.ph b{font-size:13pt;margin-right:auto}
      .pr{display:flex;gap:4mm;height:83mm;margin-bottom:4mm}.pi{width:115mm;height:83mm;display:flex;align-items:center;justify-content:center;background:#f3f3f3}
      .pi img{max-width:115mm;max-height:83mm}.pr table{flex:1;border-collapse:collapse;align-self:flex-start}.pr th,.pr td{border:0.3mm solid #333;padding:1.6mm;text-align:left;vertical-align:top}.pr th{width:14mm;background:#eee;font-weight:400}</style>` +
      pages.map((pg, i) => `<div class="pp">${head(i)}${pg}</div>`).join('');
    setTimeout(() => window.print(), 300);
  }

  async function projectsDialog() {
    const list = await NZ.db.listProjects();
    const fmt = (t) => { const d = new Date(t); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const dlg = openDialog({
      title: '図面一覧',
      html: `<div class="list">${list.map((p) => `<div class="item"><div class="grow"><b>${esc(p.name)}</b>${p.id === P().id ? '(編集中)' : ''}<small>${fmt(p.updatedAt)}</small></div><button data-open="${p.id}">開く</button><button class="danger" data-delp="${p.id}">削除</button></div>`).join('') || '<p class="note">保存された図面はありません</p>'}</div>`,
      buttons: [{ label: '閉じる' }, { label: '＋ 新規図面', cls: 'primary', onClick: async () => { await saveNow(); openProject(NZ.newProject(st.settings)); titleDialog(); } }],
    });
    dlg.dlg.addEventListener('click', async (ev) => {
      const o = ev.target.dataset.open, del = ev.target.dataset.delp;
      if (o) { await saveNow(); const p = await NZ.db.getProject(o); if (p) openProject(p); dlg.close(); }
      if (del) {
        if (!confirm('この図面を削除しますか?(元に戻せません)')) return;
        await NZ.db.deleteProject(del);
        await NZ.db.deletePhotosOf(del);
        ev.target.closest('.item').remove();
        if (del === P().id) openProject(NZ.newProject(st.settings));
      }
    });
  }
  function openProject(p) {
    // 古いデータとの互換
    const base = NZ.newProject(st.settings);
    for (const k of Object.keys(base)) if (p[k] === undefined) p[k] = base[k];
    p.meta = Object.assign({}, base.meta, p.meta);
    st.project = p;
    st.sel = null;
    st.welcomeOff = false;
    st.temp = null;
    st.underSrc = p.underlay ? p.underlay.src : null;
    NZ.solveWalls(p);
    resetHistory();
    // 元に戻す履歴はここで空になるので、図面から消した写真の画像を片付けてよい
    NZ.db.deletePhotosOf(p.id, new Set((p.photos || []).map((ph) => ph.img).filter(Boolean))).catch(() => {});
    renderUnderlay();
    renderAll();
    fitView();
    scheduleSave();
  }

  // ---------- 出力 ----------
  const fileBase = () => `${P().meta.name || '図面'}_${P().meta.drawingNo || ''}`.replace(/[\\/:*?"<>|]/g, '_');
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function exportSVG() {
    const sh = NZ.renderSheet(P());
    download(new Blob([sh.svg], { type: 'image/svg+xml' }), fileBase() + '.svg');
  }
  // DXF(JW-CAD・CAD用)。実寸mm、Shift_JIS、R12形式
  function exportDXF() {
    try {
      const r = NZ.planDxf(P());
      download(new Blob([r.bytes], { type: 'application/dxf' }), fileBase() + '_平面図.dxf');
      toast(`DXFを保存しました(線・文字 ${r.total} 個)。JW-CADでは縮尺を 1/${r.S} にすると用紙どおりの大きさになります`, 6000);
    } catch (e) { toast('DXFを作成できませんでした: ' + e.message, 5000); }
  }
  function exportPNG() {
    svgToPng(NZ.renderSheet(P()), fileBase() + '.png');
  }
  function svgToPng(sh, filename) {
    const pxPerMm = 8; // 約200dpi
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(sh.W * pxPerMm); c.height = Math.round(sh.H * pxPerMm);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => download(b, filename), 'image/png');
    };
    img.onerror = () => toast('PNGの作成に失敗しました');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sh.svg);
  }
  function printSheet() {
    const sh = NZ.renderSheet(P());
    const area = $('#print-area');
    area.innerHTML = `<style>@page{size:${sh.W}mm ${sh.H}mm;margin:0}</style>` + sh.svg;
    setTimeout(() => window.print(), 100);
  }
  // 印刷プレビュー(出力されるSVGそのものを表示)
  function previewDialog() {
    const sh = NZ.renderSheet(P());
    const wrap = document.createElement('div');
    wrap.className = 'preview-wrap';
    wrap.innerHTML = `<div class="preview-bar"><span class="title">印刷プレビュー ${esc(P().meta.paper)} 1/${sh.S}</span>
      <select class="pv-zoom"><option value="fit">全体</option><option value="1">実寸(100%)</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select>
      <button data-pv="title">図面情報</button><button data-pv="png">PNG保存</button><button data-pv="print" class="primary">印刷 / PDF</button><button data-pv="close">閉じる</button></div>
      <div class="preview-scroll"><img alt="図面プレビュー"></div>`;
    document.body.appendChild(wrap);
    const img = wrap.querySelector('img'), sc = wrap.querySelector('.preview-scroll');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(sh.svg);
    const pxPerMm = 96 / 25.4;
    const zoom = () => {
      const v = wrap.querySelector('.pv-zoom').value;
      if (v === 'fit') {
        const k = Math.min((sc.clientWidth - 40) / sh.W, (sc.clientHeight - 40) / sh.H);
        img.style.width = sh.W * k + 'px';
      } else img.style.width = sh.W * pxPerMm * +v + 'px';
    };
    wrap.querySelector('.pv-zoom').addEventListener('change', zoom);
    zoom();
    wrap.addEventListener('click', (ev) => {
      const a = ev.target.dataset.pv;
      if (a === 'close') wrap.remove();
      if (a === 'print') printSheet();
      if (a === 'png') exportPNG();
      if (a === 'title') { wrap.remove(); titleDialog(); }
    });
  }

  async function exportJSON() {
    // 写真は別に保存しているので、書き出すファイルに含める(別の端末でも見られるように)
    const photoData = {};
    for (const ph of P().photos || []) {
      const rec = ph.img && (await NZ.db.getPhoto(ph.img));
      if (rec) photoData[ph.img] = { data: rec.data, w: rec.w, h: rec.h };
    }
    const out = Object.assign({}, P(), Object.keys(photoData).length ? { photoData } : {});
    download(new Blob([JSON.stringify(out)], { type: 'application/json' }), fileBase() + '.json');
  }
  // ---------- 展開図 ----------
  function elevSheet() {
    const rooms = NZ.elevRooms(P());
    const room = rooms.find((r) => r.ids.includes(st.elevRoom)) || rooms[0];
    if (!room) return null;
    st.elevRoom = room.id;
    return { rooms, room, sh: NZ.renderElevationSheet(P(), room) };
  }
  function renderElev() {
    const box = $('#elev-sheet'), selR = $('#elev-room');
    // 平面図で室名を選んでいれば、その部屋
    const sl = st.sel && findEl(st.sel);
    if (sl && sl.coll === 'labels') st.elevRoom = sl.el.id;
    const r = elevSheet();
    if (!r) {
      selR.innerHTML = ''; selR.disabled = true;
      $('#elev-info').textContent = '';
      box.innerHTML = `<div class="elev-empty"><b>展開図にする部屋がありません。</b><br>平面図で「室名」ツールを使い、部屋の中に室名(例: 洋室1)を置いてください。室名の位置から、部屋を囲む壁を探して A面(北)・B面(東)・C面(南)・D面(西)の展開図を作ります。</div>`;
      return;
    }
    selR.disabled = false;
    selR.innerHTML = r.rooms.map((x) => `<option value="${esc(x.id)}" ${x.id === r.room.id ? 'selected' : ''}>${esc(x.label)}${x.complete ? '' : '(壁が不足)'}</option>`).join('');
    const bd = r.sh.bounds, miss = r.sh.faces.filter((f) => f.missing).map((f) => f.key + '面');
    const size = bd.x0 !== null && bd.x1 !== null && bd.y0 !== null && bd.y1 !== null ? `内法 ${Math.round(bd.x1 - bd.x0)}×${Math.round(bd.y1 - bd.y0)}mm  ` : '';
    $('#elev-info').textContent = `${size}CH ${Math.round(r.sh.CH)}mm  縮尺 1/${r.sh.S}${miss.length ? `  ※${miss.join('・')}の壁が見つかりません` : ''}`;
    box.innerHTML = r.sh.svg.replace(/ width="\d+mm" height="\d+mm"/, '');
  }
  function setView(v) {
    st.view = v;
    $$('#view-switch button').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
    $('#mode-switch').classList.toggle('hidden', v !== 'plan');
    $('#tools').classList.toggle('disabled', v !== 'plan' || st.mode === 'sheet');
    $('#elev').classList.toggle('hidden', v !== 'elev');
    $('#est').classList.toggle('hidden', v !== 'est');
    if (v === 'elev') { st.temp = null; renderElev(); }
    else if (v === 'est') { st.temp = null; NZ.bindEstimate(); NZ.renderEstimate(); }
    else { renderAll(); fitView(); }
  }
  $$('#view-switch button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#elev-room').addEventListener('change', (ev) => { st.elevRoom = ev.target.value; st.sel = null; renderElev(); });
  $('#elev').addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-ev]')?.dataset.ev;
    if (act) {
      const r = elevSheet();
      if (!r) { toast('展開図にする部屋がありません'); return; }
      const name = `${fileBase()}_展開図_${r.room.name}`;
      if (act === 'svg') download(new Blob([r.sh.svg], { type: 'image/svg+xml' }), name + '.svg');
      if (act === 'dxf') {
        try {
          const d = NZ.elevDxf(P(), r.room);
          download(new Blob([d.bytes], { type: 'application/dxf' }), name + '.dxf');
          toast(`DXFを保存しました。JW-CADでは縮尺を 1/${d.S} にすると用紙どおりの大きさになります`, 6000);
        } catch (e) { toast('DXFを作成できませんでした: ' + e.message, 5000); }
      }
      if (act === 'png') svgToPng(r.sh, name + '.png');
      if (act === 'print') {
        $('#print-area').innerHTML = `<style>@page{size:${r.sh.W}mm ${r.sh.H}mm;margin:0}</style>` + r.sh.svg;
        setTimeout(() => window.print(), 100);
      }
      return;
    }
    // 壁・建具をタップ → 平面図でその壁を編集
    const hit = ev.target.closest('[data-wall]');
    if (hit) {
      const id = hit.getAttribute('data-wall');
      setView('plan');
      if (st.mode !== 'draw') $('#mode-switch [data-mode=draw]').click();
      st.sel = id; renderAll(); editEl(id);
    }
  });

  // ---------- メニュー ----------
  const menu = $('#menu');
  $('#btn-menu').onclick = () => menu.classList.remove('hidden');
  menu.addEventListener('click', (ev) => {
    if (ev.target === menu) { menu.classList.add('hidden'); return; }
    const a = ev.target.dataset.act;
    if (!a) return;
    menu.classList.add('hidden');
    ({
      projects: projectsDialog,
      title: titleDialog,
      'load-image': () => $('#file-img').click(),
      underlay: underlayDialog,
      detect: detectDialog,
      ai: aiAnalyze,
      'confirm-all': () => { for (const c of COLLS) P()[c].forEach((e) => delete e.detected); commit(); toast('検出結果を確定しました'); },
      'delete-detected': () => { for (const c of COLLS) P()[c] = P()[c].filter((e) => !e.detected); st.sel = null; commit(); },
      grid: gridDialog,
      print: printSheet,
      preview: previewDialog,
      png: exportPNG,
      svg: exportSVG,
      dxf: exportDXF,
      'json-save': exportJSON,
      'json-load': () => $('#file-json').click(),
      'photo-list': printPhotoList,
      elevation: () => setView('elev'),
      settings: settingsDialog,
      help: helpDialog,
    }[a] || (() => {}))();
  });
  $('#file-img').addEventListener('change', (ev) => { const f = ev.target.files[0]; if (f) loadImageFile(f); ev.target.value = ''; });
  $('#file-json').addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      try {
        const p = JSON.parse(fr.result);
        if (!p.meta || !p.walls) throw new Error('形式が違います');
        await saveNow();
        if (p.photoData) {
          for (const [id, r] of Object.entries(p.photoData)) await NZ.db.putPhoto({ id, projectId: p.id, data: r.data, w: r.w, h: r.h, createdAt: Date.now() });
          delete p.photoData;
        }
        openProject(p);
        toast('読み込みました');
      } catch (e) { toast('読み込めませんでした: ' + e.message); }
    };
    fr.readAsText(f);
    ev.target.value = '';
  });

  function helpDialog() {
    openDialog({
      title: '使い方', wide: true,
      html: `<div class="help">
        <h4>1. 準備</h4><p>メニュー →「設定」で会社名・作成者・許認可番号を登録します(表題欄の既定値)。</p>
        <h4>2. 下図を読み込む</h4><p>メニュー →「下図画像を読み込む」で間取り図の画像を読み込むか撮影します。「縮尺合せ」ツールで寸法の分かっている箇所をなぞり、実寸を入力します。</p>
        <h4>3. 構造体・水回りを取り込む</h4><p>「構造壁・柱を自動検出」(端末内で処理)${AI_ON ? 'または「AIで図面を解析」(構造壁・柱・キッチン/トイレ/浴室の位置)' : ''}を実行します。オレンジ破線は未確定です。確認後「確定」してください。</p>
        <h4>4. 実測値を入力</h4><p>「壁なぞり」ツールで、実測した壁をペンでなぞると寸法入力ウインドウが開きます。既存の壁をなぞると、その壁を実寸に修正します。壁の途中にドア・引き戸・折れ戸・窓を入れるときは「分割」に追加します(始点からの順)。吊元・開く方向も指定できます。</p>
        <h4>内法(実測値)の扱い</h4><p>入力する長さは壁の面から面までの内法です。図面上の壁の長さは「内法+両端でつながる壁の厚み分」で自動計算します。なぞった時点の位置は仮置きで、あとから端に壁をつないだり壁厚を変えたりすると自動で調整されます。一周して辻褄が合わない分は、寸法チェックで「ずれ」として表示されます。壁芯で入力したい場合は、入力ウインドウのチェックを外すか設定で変更します。</p>
        <h4>5. 設備・家具・床</h4><p>「設備」ツールで位置をタップし、種類・サイズを選ぶか${AI_ON ? '、品番を入力して「ネット検索」で寸法を取得します' : '、寸法を入力します'}。「家具」ツールでテーブル・椅子などの置き家具や、棚・収納などの造作家具を置けます。「床」ツールで範囲を囲み、フローリング・カーペット・タイル・畳などを選びます。</p>
        <h4>6. 通り芯・寸法・室名</h4><p>メニュー →「通り芯の設定」で A,B,C / 1,2,3 の通り芯を作ります(構造体から自動生成も可)。「寸法」ツールで任意の寸法、「室名」で部屋名を入れます。</p>
        <h4>7. 出力</h4><p>上部の「プレビュー」で印刷される図面そのものを確認し、印刷/PDF・PNGで保存します(SVGはメニューから)。「用紙」では用紙の上で図面を確認できます。</p>
        <h4>8. 寸法チェック(コーション)</h4><p>上部の「チェック」ボタンの数字は、辻褄の合わない寸法の件数です。壁のずれ、向かい合う壁の長さの違い、建具・設備が収まらない、ドアの開閉が当たる、下図との大きな差(入力ミスの疑い)などを図面上の⚠番号で示します。一覧の「測り直す」でその場で修正でき、「要再測リストを印刷」で現場用のチェックシートを出せます。許容差は設定で変更できます。</p>
        <h4>展開図</h4><p>部屋の中に「室名」を置き、画面上部の「展開図」を押すと、その部屋の A面(北)・B面(東)・C面(南)・D面(西)が1枚に並びます。壁や建具をタップすると平面図に戻って編集できます。建具の高さ・窓の腰高は、壁の編集画面の分割欄で入力します(空欄は標準値で「*」付き)。</p>
        <h4>現場写真</h4><p>「写真」ツールで撮影した位置をタップし、撮影または写真を選んで、撮影した向きとメモを入れます。図面に番号と撮影方向の記号が付き、記号から写真を開けます。メニューの「写真一覧(写真台帳)を印刷」でA4に印刷できます。写真はこの端末の中にだけ保存されます。</p>
        <h4>仕上表・概算見積</h4><p>画面上部の「見積」で、部屋ごとの床・壁・天井面積、巾木・廻り縁の長さ、建具・設備の個数が図面から自動で出ます。材料単価・工賃単価を入れると金額・消費税・合計を計算します。入れた単価はこの端末に記憶され、次の図面でも使われます。配管・解体・諸経費などは「＋行を追加」で入れます。</p>
        <h4>写真で建具を測る</h4><p>壁を選んで「写真で測る」を押し、四隅が写るように壁を撮ります。四隅に○を合わせて実測した壁の幅・高さを入れると、写真の歪みを補正します。補正した画像でドア・窓を囲むと、位置・幅・腰高・高さを計算して壁に反映します。値は目安なので、実測できる箇所は実測値に直してください。</p>
        <h4>操作</h4><ul><li>ペン: 作図 / 指1本: 画面移動 / 指2本: 拡大縮小(「指で描く」をONにすると指でも作図)</li><li>長さ欄は「1820+910」のような計算式も使えます</li><li>データは端末内に自動保存されます。別端末へは「データ書き出し(.json)」で移せます</li></ul>
      </div>`,
      buttons: [{ label: '閉じる', cls: 'primary' }],
    });
  }

  // ---------- その他UI ----------
  $$('#tools button').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $$('#mode-switch button').forEach((b) => (b.onclick = () => {
    st.mode = b.dataset.mode;
    $$('#mode-switch button').forEach((x) => x.classList.toggle('on', x === b));
    $('#tools').classList.toggle('disabled', st.mode === 'sheet' || st.view !== 'plan');
    $('#hint').textContent = st.mode === 'sheet' ? '印刷したときの見え方です' : HINTS[st.tool];
    renderUnderlay();
    renderAll();
    fitView();
  }));
  $('#btn-undo').onclick = () => { if (st.hi > 0) restore(st.hi - 1); };
  $('#btn-redo').onclick = () => { if (st.hi < st.hist.length - 1) restore(st.hi + 1); };
  $('#btn-fit').onclick = fitView;
  $('#btn-preview').onclick = previewDialog;
  $('#proj-name').onclick = titleDialog;
  ['#lay-grid', '#lay-dims', '#lay-zones', '#lay-photos'].forEach((s) => $(s).addEventListener('change', renderAll));
  $('#lay-under').addEventListener('change', renderUnderlay);
  window.addEventListener('resize', updateView);
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input,textarea,select') || $('#modal-root').children.length) return;
    if (st.view !== 'plan' && !(e.metaKey || e.ctrlKey)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? $('#btn-redo').click() : $('#btn-undo').click(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && st.sel) { removeEl(st.sel); st.sel = null; commit(); }
    else if (e.key === 'Escape') { st.sel = null; st.temp = null; renderOverlay(); renderSelbar(); }
    else if (e.key === ' ') { spaceDown = true; }
    else if (e.key === 'e') editEl(st.sel);
  });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

  // ---------- はじめての図面 ----------
  function updateWelcome() {
    const pr = P(), u = pr.underlay;
    const empty = !['walls', 'columns', 'fixtures', 'labels', 'dims', 'floors', 'zones', 'photos'].some((c) => (pr[c] || []).length) && !(u && u.src);
    const show = empty && !st.welcomeOff && st.view === 'plan' && st.mode === 'draw';
    $('#welcome').classList.toggle('hidden', !show);
    $('#hint').style.visibility = show ? 'hidden' : '';
  }
  $('#welcome').addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-wc]')?.dataset.wc;
    if (!a) return;
    if (a === 'wall') { st.welcomeOff = true; setTool('wall'); updateWelcome(); }
    if (a === 'image') $('#file-img').click();
    if (a === 'projects') projectsDialog();
    if (a === 'help') helpDialog();
  });
  // ---------- 表示の切り替え ----------
  const layers = $('#layers'), layBtn = $('#btn-layers');
  layBtn.onclick = (ev) => { ev.stopPropagation(); layers.classList.toggle('hidden'); layBtn.classList.toggle('on', !layers.classList.contains('hidden')); };
  document.addEventListener('pointerdown', (ev) => {
    if (layers.classList.contains('hidden') || ev.target.closest('#layers, #btn-layers')) return;
    layers.classList.add('hidden'); layBtn.classList.remove('on');
  });

  // ---------- 起動 ----------
  (async function init() {
    if (!AI_ON) document.querySelectorAll('[data-ai]').forEach((el) => el.remove());
    const ed = $('#edition');
    if (ed && NZ.EDITION && NZ.EDITION.label) { ed.textContent = NZ.EDITION.label; ed.hidden = false; }
    let p = null;
    try {
      const last = localStorage.getItem('naiso-zumen.last');
      if (last) p = await NZ.db.getProject(last);
    } catch (e) { /* noop */ }
    openProject(p || NZ.newProject(st.settings));
    setTool('select');
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  })();
  NZ.app = { st, commit, commitData, renderAll, fitView, openProject, toast, busy, editEl, num, download, fileBase };
})();
