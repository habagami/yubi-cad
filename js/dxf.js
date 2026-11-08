// DXF書き出し(JW-CAD向け)
// 画面・印刷と同じ図面(SVG)を、線(LINE)・円(CIRCLE)・円弧(ARC)・文字(TEXT)に変換する。
// - 形式: AutoCAD R12 の ASCII DXF(JW-CAD・AutoCAD・多くのCADで読める一番古い形式)
// - 文字コード: Shift_JIS(JW-CADの日本語が文字化けしないように)
// - 寸法: 実寸の mm(用紙の図に縮尺 S を掛ける)。JW-CADでは縮尺を 1/S にすると用紙どおりの大きさになる
// - 塗りだけの図形(壁の塗り・ハッチング・床の模様)は出さない。線のある図形と文字だけを出す
(function () {
  const NZ = (window.NZ = window.NZ || {});

  // ---------- Shift_JIS ----------
  let sjisMap = null;
  function buildSjis() {
    sjisMap = new Map();
    const dec = new TextDecoder('shift_jis');
    const leads = [];
    for (let b = 0x81; b <= 0x9f; b++) leads.push(b);
    for (let b = 0xe0; b <= 0xfc; b++) leads.push(b);
    for (const a of leads) for (let b = 0x40; b <= 0xfc; b++) {
      if (b === 0x7f) continue;
      const ch = dec.decode(new Uint8Array([a, b]));
      if (ch.length === 1 && ch !== '�' && !sjisMap.has(ch)) sjisMap.set(ch, [a, b]);
    }
    for (let b = 0xa1; b <= 0xdf; b++) { const ch = dec.decode(new Uint8Array([b])); if (!sjisMap.has(ch)) sjisMap.set(ch, [b]); }
  }
  function toSjis(str) {
    if (!sjisMap) buildSjis();
    const out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 0x80) { out.push(c); continue; }
      const m = sjisMap.get(ch) || sjisMap.get(ch.normalize('NFKC')) || [0x3f]; // 変換できない文字は ?
      out.push(...m);
    }
    return out;
  }

  // ---------- 画層(レイヤー) ----------
  // 色は AutoCAD の色番号(ACI)。JW-CADでは線色に置き換わる
  const LAYERS = {
    '壁': 7, '柱': 8, '建具': 4, '設備': 6, '家具': 9, '床': 3, '水回り': 30, '寸法': 2,
    '文字': 7, '通り芯': 1, '写真': 5, '展開図': 7, '図面枠': 7, 'その他': 7,
  };
  const OPENING_CLS = ['nz-leaf', 'nz-swing', 'nz-jamb', 'nz-panel', 'nz-win', 'nz-glass', 'nz-open', 'nz-arrow', 'nz-sill'];

  function layerForPlan(el, p) {
    if (el.closest('.nz-frame')) return '図面枠';
    const cls = el.getAttribute('class') || '';
    if (/nz-dim/.test(cls) || el.closest('[class*="nz-dim"]')) return '寸法';
    if (/nz-gridline|nz-bubble/.test(cls)) return '通り芯';
    if (el.closest('.nz-photo')) return '写真';
    if (/nz-floor/.test(cls)) return '床';
    const g = el.closest('[data-id]');
    const id = g && g.getAttribute('data-id');
    if (id) {
      const own = (c) => (p[c] || []).find((e) => e.id === id);
      if (own('walls')) return OPENING_CLS.some((c) => cls.includes(c)) ? '建具' : '壁';
      if (own('columns')) return '柱';
      const f = own('fixtures');
      if (f) return NZ.fixtureCat(f.type) === 'loose' ? '家具' : '設備';
      if (own('labels')) return '文字';
      if (own('dims')) return '寸法';
      if (own('zones')) return '水回り';
      if (own('floors')) return '床';
      if (own('photos')) return '写真';
    }
    if (OPENING_CLS.some((c) => cls.includes(c))) return '建具';
    if (/nz-wall/.test(cls)) return '壁';
    if (/nz-label/.test(cls)) return '文字';
    if (/nz-fx/.test(cls)) return '設備';
    return 'その他';
  }

  // ---------- 幾何 ----------
  function circleFrom3(a, b, c) {
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) return null;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    return { x, y, r: Math.hypot(a.x - x, a.y - y) };
  }
  // 点列が1つの円弧に乗っていれば円弧として返す(ドアの開き線など)
  function fitArc(pts) {
    if (pts.length < 4) return null;
    const a = pts[0], b = pts[Math.floor(pts.length / 2)], c = pts[pts.length - 1];
    const ci = circleFrom3(a, b, c);
    if (!ci || ci.r < 1e-6) return null;
    for (const q of pts) if (Math.abs(Math.hypot(q.x - ci.x, q.y - ci.y) - ci.r) > Math.max(0.5, ci.r * 0.01)) return null;
    // DXF の円弧は反時計回り。始点・終点の角度を、中間点を通る向きで決める
    const ang = (q) => (Math.atan2(q.y - ci.y, q.x - ci.x) * 180) / Math.PI;
    let s = ang(a), e = ang(c), m = ang(b);
    const norm = (v) => ((v % 360) + 360) % 360;
    const ccwHas = (s0, e0, x) => norm(x - s0) <= norm(e0 - s0);
    if (!ccwHas(s, e, m)) [s, e] = [e, s];
    return { x: ci.x, y: ci.y, r: ci.r, s: norm(s), e: norm(e) };
  }

  // SVG の path を、直線の点列(部分パスごと)に直す。円弧・曲線は細かい直線にする
  function pathToPolys(el) {
    const d = el.getAttribute('d') || '';
    const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
    const polys = [];
    let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
    const num = () => parseFloat(toks[i++]);
    const push = () => { if (cur && cur.pts.length > 1) polys.push(cur); };
    while (i < toks.length) {
      if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
      if (C === 'M') { push(); x = num() + (rel ? x : 0); y = num() + (rel ? y : 0); sx = x; sy = y; cur = { pts: [{ x, y }], closed: false }; cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') { x = num() + (rel ? x : 0); y = num() + (rel ? y : 0); cur.pts.push({ x, y }); }
      else if (C === 'H') { x = num() + (rel ? x : 0); cur.pts.push({ x, y }); }
      else if (C === 'V') { y = num() + (rel ? y : 0); cur.pts.push({ x, y }); }
      else if (C === 'Z') { if (cur) { cur.closed = true; x = sx; y = sy; } }
      else {
        // 円弧・曲線: その区間だけの path を作って長さで分割する
        const n = { A: 7, C: 6, S: 4, Q: 4, T: 2 }[C] || 0;
        const args = [];
        for (let k = 0; k < n; k++) args.push(num());
        const ex = args[n - 2] + (rel ? x : 0), ey = args[n - 1] + (rel ? y : 0);
        const seg = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const absArgs = args.slice();
        if (rel) { absArgs[n - 2] = ex; absArgs[n - 1] = ey; if (C === 'C') { absArgs[0] += x; absArgs[1] += y; absArgs[2] += x; absArgs[3] += y; } if (C === 'Q' || C === 'S') { absArgs[0] += x; absArgs[1] += y; } }
        seg.setAttribute('d', `M${x},${y} ${C}${absArgs.join(' ')}`);
        el.parentNode.appendChild(seg);
        const L = seg.getTotalLength(), steps = Math.max(4, Math.min(48, Math.ceil(L / 0.8)));
        for (let k = 1; k <= steps; k++) { const q = seg.getPointAtLength((L * k) / steps); cur.pts.push({ x: q.x, y: q.y }); }
        seg.remove();
        x = ex; y = ey;
      }
    }
    push();
    return polys;
  }

  // ---------- SVG → DXF ----------
  // svgText: 用紙の図(座標は用紙mm)、k: 実寸への倍率(=縮尺 S)、layerOf(el): 画層名
  NZ.svgToDxf = function (svgText, k, layerOf) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:1200px;visibility:hidden;pointer-events:none;z-index:-1';
    host.innerHTML = svgText;
    document.body.appendChild(host);
    const svg = host.querySelector('svg');
    svg.setAttribute('width', '1200'); svg.removeAttribute('height');
    const rootInv = svg.getScreenCTM().inverse();
    const ents = [];
    const used = new Set();
    const T = (el, x, y) => { const m = rootInv.multiply(el.getScreenCTM()); return { x: (m.a * x + m.c * y + m.e) * k, y: -(m.b * x + m.d * y + m.f) * k }; };
    const scaleOf = (el) => { const m = rootInv.multiply(el.getScreenCTM()); return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * k; };
    const add = (e) => { used.add(e.layer); ents.push(e); };
    const lines = (pts, closed, layer, lt) => {
      for (let i = 0; i < pts.length - 1; i++) add({ t: 'LINE', layer, lt, a: pts[i], b: pts[i + 1] });
      if (closed && pts.length > 2) add({ t: 'LINE', layer, lt, a: pts[pts.length - 1], b: pts[0] });
    };

    for (const el of svg.querySelectorAll('line,rect,circle,ellipse,polygon,polyline,path,text')) {
      if (el.closest('defs,pattern,clipPath,mask,symbol,style')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none') continue;
      const layer = layerOf(el);
      const tag = el.tagName.toLowerCase();
      if (tag === 'text') {
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        const fs = parseFloat(el.getAttribute('font-size')) || parseFloat(cs.fontSize) || 3;
        const x = parseFloat(el.getAttribute('x')) || 0, y = parseFloat(el.getAttribute('y')) || 0;
        const m = rootInv.multiply(el.getScreenCTM());
        const rot = (-Math.atan2(m.b, m.a) * 180) / Math.PI;
        const anchor = el.getAttribute('text-anchor') || cs.textAnchor || 'start';
        add({ t: 'TEXT', layer, p: T(el, x, y), h: fs * scaleOf(el) * 0.85, rot, txt, al: anchor === 'middle' ? 1 : anchor === 'end' ? 2 : 0 });
        continue;
      }
      // 塗りだけの図形は出さない(壁の塗り・ハッチング・床の模様)。ただし方位の矢印・写真の矢印は塗りだけなので輪郭を出す
      const noStroke = cs.stroke === 'none' || parseFloat(cs.strokeOpacity) === 0 || parseFloat(cs.strokeWidth) === 0;
      const fillOnlyMark = noStroke && cs.fill !== 'none' && !/url\(/.test(cs.fill) && (el.closest('.nz-frame') || el.closest('.nz-photo'));
      if (noStroke && !fillOnlyMark) continue;
      const lt = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? (/nz-gridline/.test(el.getAttribute('class') || '') ? 'CENTER' : 'DASHED') : null;
      if (tag === 'line') {
        lines([T(el, +el.getAttribute('x1') || 0, +el.getAttribute('y1') || 0), T(el, +el.getAttribute('x2') || 0, +el.getAttribute('y2') || 0)], false, layer, lt);
      } else if (tag === 'rect') {
        const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0, w = parseFloat(el.getAttribute('width')) || 0, h = parseFloat(el.getAttribute('height')) || 0;
        if (!(w > 0 && h > 0) || String(el.getAttribute('width')).includes('%')) continue;
        lines([T(el, x, y), T(el, x + w, y), T(el, x + w, y + h), T(el, x, y + h)], true, layer, lt);
      } else if (tag === 'circle') {
        const c = T(el, +el.getAttribute('cx') || 0, +el.getAttribute('cy') || 0);
        add({ t: 'CIRCLE', layer, lt, c, r: (parseFloat(el.getAttribute('r')) || 0) * scaleOf(el) });
      } else if (tag === 'ellipse') {
        const cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0, rx = +el.getAttribute('rx') || 0, ry = +el.getAttribute('ry') || 0;
        const pts = [];
        for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; pts.push(T(el, cx + rx * Math.cos(t), cy + ry * Math.sin(t))); }
        lines(pts, true, layer, lt);
      } else if (tag === 'polygon' || tag === 'polyline') {
        const nums = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) pts.push(T(el, nums[i], nums[i + 1]));
        const arc = tag === 'polyline' ? fitArc(pts) : null;
        if (arc) add({ t: 'ARC', layer, lt, c: { x: arc.x, y: arc.y }, r: arc.r, s: arc.s, e: arc.e });
        else lines(pts, tag === 'polygon', layer, lt);
      } else if (tag === 'path') {
        for (const poly of pathToPolys(el)) lines(poly.pts.map((q) => T(el, q.x, q.y)), poly.closed, layer, lt);
      }
    }
    host.remove();

    // ---------- 書き出し ----------
    const out = [];
    const g = (code, v) => { out.push(String(code), typeof v === 'number' ? fmt(v) : String(v)); };
    const fmt = (v) => (Math.abs(v) < 1e-9 ? '0' : String(Math.round(v * 1000) / 1000));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const ext = (q) => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); };
    for (const e of ents) { if (e.a) { ext(e.a); ext(e.b); } if (e.c) ext(e.c); if (e.p) ext(e.p); }
    if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1009');
    g(9, '$DWGCODEPAGE'); g(3, 'ANSI_932');
    g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$LTSCALE'); g(40, 1);
    g(9, '$EXTMIN'); g(10, x0); g(20, y0); g(30, 0);
    g(9, '$EXTMAX'); g(10, x1); g(20, y1); g(30, 0);
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    // 線種
    // 線種の長さは用紙上の mm に縮尺を掛けた実寸(実寸の図面に 1/S で印刷したとき、用紙で破線が見えるように)
    const LT = [['CONTINUOUS', 'Solid line', []], ['DASHED', 'Dashed __ __ __', [2, -1]], ['CENTER', 'Center ____ _ ____', [8, -1.5, 1, -1.5]]]
      .map(([n, d, pat]) => [n, d, pat.map((v) => v * k)]);
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, LT.length);
    for (const [name, desc, pat] of LT) {
      g(0, 'LTYPE'); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pat.length); g(40, pat.reduce((s, v) => s + Math.abs(v), 0));
      for (const v of pat) g(49, v);
    }
    g(0, 'ENDTAB');
    const layerNames = Object.keys(LAYERS).filter((n) => used.has(n));
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, layerNames.length + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    for (const n of layerNames) { g(0, 'LAYER'); g(2, n); g(70, 0); g(62, LAYERS[n]); g(6, 'CONTINUOUS'); }
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const e of ents) {
      g(0, e.t); g(8, e.layer);
      if (e.lt) g(6, e.lt);
      if (e.t === 'LINE') { g(10, e.a.x); g(20, e.a.y); g(30, 0); g(11, e.b.x); g(21, e.b.y); g(31, 0); }
      else if (e.t === 'CIRCLE') { g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r); }
      else if (e.t === 'ARC') { g(10, e.c.x); g(20, e.c.y); g(30, 0); g(40, e.r); g(50, e.s); g(51, e.e); }
      else if (e.t === 'TEXT') {
        g(10, e.p.x); g(20, e.p.y); g(30, 0); g(40, e.h); g(1, e.txt);
        if (Math.abs(e.rot) > 0.01) g(50, e.rot);
        if (e.al) { g(72, e.al); g(11, e.p.x); g(21, e.p.y); g(31, 0); }
      }
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    const bytes = toSjis(out.join('\r\n') + '\r\n');
    const counts = {};
    for (const e of ents) counts[e.layer] = (counts[e.layer] || 0) + 1;
    return { bytes: new Uint8Array(bytes), counts, total: ents.length };
  };

  // 平面図(用紙)を DXF に
  NZ.planDxf = function (p) {
    const sh = NZ.renderSheet(p);
    return Object.assign(NZ.svgToDxf(sh.svg, sh.S, (el) => layerForPlan(el, p)), { S: sh.S });
  };
  // 展開図(用紙)を DXF に
  NZ.elevDxf = function (p, room) {
    const sh = NZ.renderElevationSheet(p, room);
    return Object.assign(NZ.svgToDxf(sh.svg, sh.S, (el) => (el.closest('.nz-frame') ? '図面枠' : '展開図')), { S: sh.S });
  };
  NZ.dxfToSjisCheck = toSjis; // 確認用
})();
