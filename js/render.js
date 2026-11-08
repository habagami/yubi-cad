// 図面の描画 (SVG文字列を生成)
// 座標はすべて実寸 mm、y は下向き。注記(文字・寸法・線幅)は縮尺 S を掛けて「印刷時の紙面mm」になるようにする。
(function () {
  const NZ = (window.NZ = window.NZ || {});
  const r2 = (n) => Math.round(n * 100) / 100;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  NZ.esc = esc;
  const FONT = "'Noto Sans JP','Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,sans-serif";
  NZ.FONT = FONT;

  // ---------- 幾何 ----------
  function frame(w) {
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1;
    const L = Math.hypot(dx, dy) || 1;
    const u = { x: dx / L, y: dy / L };
    // n は進行方向の右手側(画面座標 y下向き)
    const n = { x: -u.y, y: u.x };
    return { L, u, n };
  }
  NZ.wallFrame = frame;
  const sideSign = (v) => (v === 'left' ? -1 : 1);
  NZ.sideSign = sideSign;

  function wallOffset(w) {
    const t = w.thick || 0;
    return w.just === 'right' ? t / 2 : w.just === 'left' ? -t / 2 : 0;
  }
  NZ.wallOffset = wallOffset;

  // 内法入力の壁で、両端の接続壁に隠れる長さ
  NZ.wallInset = (w) => (w.innerMode ? [w.ext0 || 0, w.ext1 || 0] : [0, 0]);

  // 分割要素を始点からの距離に展開。内法入力の壁は始点側の壁の面から数える。
  // 合計が足りなければ残りを壁として追加
  function resolveSegments(w) {
    const { L } = frame(w);
    const [e0, e1] = NZ.wallInset(w);
    const end = Math.max(e0, L - e1);
    const out = [];
    if (e0 > 0.5) out.push({ type: 'wall', s0: 0, s1: e0, len: e0, auto: true, hidden: true });
    let s = e0;
    for (const g of w.segments || []) {
      if (s >= end - 0.01) break;
      const len = Math.min(Math.max(0, +g.len || 0), end - s);
      if (len <= 0) continue;
      out.push(Object.assign({}, g, { s0: s, s1: s + len, len }));
      s += len;
    }
    if (end - s > 0.5) out.push({ type: 'wall', s0: s, s1: end, len: end - s, auto: true });
    if (L - end > 0.5) out.push({ type: 'wall', s0: end, s1: L, len: L - end, auto: true, hidden: true });
    return out;
  }
  NZ.resolveSegments = resolveSegments;

  function P(w, fr, s, k) {
    return { x: w.x1 + fr.u.x * s + fr.n.x * k, y: w.y1 + fr.u.y * s + fr.n.y * k };
  }
  const pt = (p) => `${r2(p.x)},${r2(p.y)}`;
  const quad = (w, fr, s0, s1, k0, k1) =>
    `M${pt(P(w, fr, s0, k0))}L${pt(P(w, fr, s1, k0))}L${pt(P(w, fr, s1, k1))}L${pt(P(w, fr, s0, k1))}Z`;
  const line = (a, b, cls, extra = '') => `<line x1="${r2(a.x)}" y1="${r2(a.y)}" x2="${r2(b.x)}" y2="${r2(b.y)}" class="${cls}" ${extra}/>`;
  const poly = (pts, cls) => `<polyline points="${pts.map(pt).join(' ')}" class="${cls}"/>`;

  // 壁端部の延長量(他の壁と接続している端点は相手の厚さ/2だけ伸ばして角を閉じる)
  function endExtensions(p) {
    const ext = new Map();
    for (const w of p.walls) {
      let e0 = 0, e1 = 0;
      for (const o of p.walls) {
        if (o === w) continue;
        for (const q of [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }]) {
          if (Math.hypot(q.x - w.x1, q.y - w.y1) < 2) e0 = Math.max(e0, o.thick / 2);
          if (Math.hypot(q.x - w.x2, q.y - w.y2) < 2) e1 = Math.max(e1, o.thick / 2);
        }
      }
      ext.set(w.id, [e0, e1]);
    }
    return ext;
  }

  // ---------- 寸法線 ----------
  function dimLine(p1, p2, d, text, S, cls = 'nz-dim') {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const L = Math.hypot(dx, dy);
    if (L < 1) return '';
    const u = { x: dx / L, y: dy / L };
    const nn = { x: -u.y, y: u.x };
    const sg = d >= 0 ? 1 : -1;
    const a = { x: p1.x + nn.x * d, y: p1.y + nn.y * d };
    const b = { x: p2.x + nn.x * d, y: p2.y + nn.y * d };
    const gap = 1 * S, over = 1.2 * S;
    let s = '';
    if (Math.abs(d) > gap) {
      const e1 = { x: p1.x + nn.x * sg * gap, y: p1.y + nn.y * sg * gap };
      const e2 = { x: p2.x + nn.x * sg * gap, y: p2.y + nn.y * sg * gap };
      s += line(e1, { x: a.x + nn.x * sg * over, y: a.y + nn.y * sg * over }, cls + '-ext');
      s += line(e2, { x: b.x + nn.x * sg * over, y: b.y + nn.y * sg * over }, cls + '-ext');
    }
    s += line(a, b, cls + '-line');
    const tk = { x: ((u.x + nn.x) / Math.SQRT2) * 1.1 * S, y: ((u.y + nn.y) / Math.SQRT2) * 1.1 * S };
    for (const c of [a, b]) s += line({ x: c.x - tk.x, y: c.y - tk.y }, { x: c.x + tk.x, y: c.y + tk.y }, cls + '-tick');
    let ang = (Math.atan2(u.y, u.x) * 180) / Math.PI;
    if (ang > 90.01 || ang <= -89.99) ang += 180;
    const rad = (ang * Math.PI) / 180;
    const up = { x: Math.sin(rad), y: -Math.cos(rad) };
    const m = { x: (a.x + b.x) / 2 + up.x * 0.7 * S, y: (a.y + b.y) / 2 + up.y * 0.7 * S };
    s += `<text x="${r2(m.x)}" y="${r2(m.y)}" transform="rotate(${r2(ang)} ${r2(m.x)} ${r2(m.y)})" class="${cls}-text" font-size="${r2(2.5 * S)}">${esc(text)}</text>`;
    return s;
  }
  NZ.dimLine = dimLine;
  NZ.fmtLen = (v) => String(Math.round(v));

  // ---------- 建具記号 ----------
  function openingSymbol(w, fr, g, off, S) {
    const t = w.thick, len = g.len, sg = sideSign(g.side);
    const atStart = g.hinge !== 'end';
    const hs = atStart ? g.s0 : g.s1;
    const a = atStart ? 1 : -1; // 吊元から反対側への向き(u方向の符号)
    const kf = off + sg * t / 2; // 開く側の壁面
    let s = '';
    const leaf = (hsx, ax, wlen) => {
      const H = P(w, fr, hsx, kf);
      const pos = (th) => P(w, fr, hsx + ax * wlen * Math.cos(th), kf + sg * wlen * Math.sin(th));
      const arc = [];
      for (let i = 0; i <= 16; i++) arc.push(pos((Math.PI / 2) * (i / 16)));
      return line(H, pos(Math.PI / 2), 'nz-leaf') + poly(arc, 'nz-swing');
    };
    const jambs = () => line(P(w, fr, g.s0, off - t / 2), P(w, fr, g.s0, off + t / 2), 'nz-jamb') + line(P(w, fr, g.s1, off - t / 2), P(w, fr, g.s1, off + t / 2), 'nz-jamb');
    const panel = (sa, sb, kc, pt2) => `<path d="${quad(w, fr, Math.min(sa, sb), Math.max(sa, sb), kc - pt2 / 2, kc + pt2 / 2)}" class="nz-panel"/>`;
    const arrow = (sa, sb, k) => {
      const A = P(w, fr, sa, k), B = P(w, fr, sb, k);
      const dir = Math.sign(sb - sa) || 1;
      const h1 = P(w, fr, sb - dir * 1.2 * S, k + 0.6 * S), h2 = P(w, fr, sb - dir * 1.2 * S, k - 0.6 * S);
      return line(A, B, 'nz-arrow') + poly([h1, B, h2], 'nz-arrow');
    };
    const ptk = Math.min(40, t * 0.3);
    // 敷居・沓摺(開口部の床の見切り材)
    const sill = () => `<path d="${quad(w, fr, g.s0, g.s1, off - t / 2, off + t / 2)}" class="nz-sill"/>`;
    switch (g.type) {
      case 'door':
        s += leaf(hs, a, len);
        break;
      case 'oyako': {
        const big = len * 2 / 3;
        s += leaf(hs, a, big) + leaf(atStart ? g.s1 : g.s0, -a, len - big);
        break;
      }
      case 'door2':
        s += leaf(g.s0, 1, len / 2) + leaf(g.s1, -1, len / 2);
        break;
      case 'entrance': {
        // 玄関ドア: 厚みのある扉+沓摺
        s += sill();
        const H = P(w, fr, hs, kf);
        const tip = P(w, fr, hs, kf + sg * len);
        const dt = 45;
        s += `<path d="${quad(w, fr, Math.min(hs, hs + a * dt), Math.max(hs, hs + a * dt), kf, kf + sg * len)}" class="nz-panel"/>`;
        const arc = [];
        for (let i = 0; i <= 16; i++) { const th = (Math.PI / 2) * (i / 16); arc.push(P(w, fr, hs + a * len * Math.cos(th), kf + sg * len * Math.sin(th))); }
        s += poly(arc, 'nz-swing') + line(H, tip, 'nz-leaf');
        break;
      }
      case 'sliding': {
        // 片引き: 戸は開口の前面、引込み側の壁に重なる
        if (g.sill) s += sill();
        const kc = off + sg * (t / 2 + ptk * 0.6);
        s += panel(g.s0 - 20, g.s1 + 20, kc, ptk);
        const toward = atStart ? -1 : 1;
        const mid = (g.s0 + g.s1) / 2;
        s += arrow(mid - toward * len * 0.2, mid + toward * len * 0.25, off - sg * (t / 2 + 1.6 * S));
        break;
      }
      case 'sliding2':
      case 'fusuma':
      case 'shoji': {
        // 引違い(2〜4枚)。4枚は外側2枚と内側2枚で別レール
        const n = Math.max(2, +g.panels || 2);
        const tracks = n === 4 ? [0, 1, 1, 0] : Array.from({ length: n }, (_, i) => i % 2);
        const thin = g.type !== 'sliding2';
        const pk = thin ? Math.min(30, t * 0.22) : ptk;
        const kt = t * (thin ? 0.13 : 0.17);
        if (g.sill || (g.sill === undefined && thin)) s += sill();
        const pw = len / n, ov = Math.min(40, pw * 0.08);
        for (let i = 0; i < n; i++) {
          const sa = Math.max(g.s0 - 15, g.s0 + i * pw - ov / 2), sb = Math.min(g.s1 + 15, g.s0 + (i + 1) * pw + ov / 2);
          const kc = off + (tracks[i] ? kt : -kt);
          s += panel(sa, sb, kc, pk);
          if (g.type === 'shoji') s += line(P(w, fr, sa, kc), P(w, fr, sb, kc), 'nz-glass');
        }
        break;
      }
      case 'pocket': {
        // 引込み戸: 開いた状態(戸袋内)を破線、閉じた位置を実線
        const toward = atStart ? -1 : 1;
        s += panel(g.s0, g.s1, off, ptk);
        const ps = toward < 0 ? g.s0 - len : g.s1, pe = toward < 0 ? g.s0 : g.s1 + len;
        s += `<path d="${quad(w, fr, ps, pe, off - ptk / 2, off + ptk / 2)}" class="nz-panel nz-dashed"/>`;
        s += arrow((g.s0 + g.s1) / 2, (g.s0 + g.s1) / 2 + toward * len * 0.35, off + 1.8 * S);
        break;
      }
      case 'folding':
      case 'folding2': {
        // 折れ戸: 枚数分の扉を60°に折った状態でジグザグに描く
        const n = Math.max(2, +g.panels || (g.type === 'folding' ? 2 : 4));
        const l = len / n;
        const fold = (hsx, ax, cnt) => {
          const pts = [];
          for (let i = 0; i <= cnt; i++) pts.push(P(w, fr, hsx + ax * i * l * 0.5, kf + (i % 2 ? sg * l * 0.866 : 0)));
          return poly(pts, 'nz-leaf');
        };
        s += g.type === 'folding' ? fold(hs, a, n) : fold(g.s0, 1, Math.ceil(n / 2)) + fold(g.s1, -1, Math.floor(n / 2));
        break;
      }
      case 'window':
      case 'windowFixed': {
        s += line(P(w, fr, g.s0, off - t / 2), P(w, fr, g.s1, off - t / 2), 'nz-win');
        s += line(P(w, fr, g.s0, off + t / 2), P(w, fr, g.s1, off + t / 2), 'nz-win');
        s += line(P(w, fr, g.s0, off - t * 0.08), P(w, fr, g.s1, off - t * 0.08), 'nz-glass');
        s += line(P(w, fr, g.s0, off + t * 0.08), P(w, fr, g.s1, off + t * 0.08), 'nz-glass');
        if (g.type === 'windowFixed') s += line(P(w, fr, g.s0, off), P(w, fr, g.s1, off), 'nz-glass');
        break;
      }
      case 'windowSash': {
        s += line(P(w, fr, g.s0, off - t / 2), P(w, fr, g.s1, off - t / 2), 'nz-win');
        s += line(P(w, fr, g.s0, off + t / 2), P(w, fr, g.s1, off + t / 2), 'nz-win');
        if (g.sill) s += sill();
        const hs = g.hinge !== 'end' ? g.s0 : g.s1;
        const a = g.hinge !== 'end' ? 1 : -1;
        const H = P(w, fr, hs, off + sg * t / 2);
        const pos = (th) => P(w, fr, hs + a * len * Math.cos(th), off + sg * t / 2 + len * Math.sin(th));
        const arc = [];
        for (let i = 0; i <= 16; i++) arc.push(pos((Math.PI / 2) * (i / 16)));
        s += line(H, pos(Math.PI / 2), 'nz-leaf') + poly(arc, 'nz-swing');
        break;
      }
      case 'opening':
        if (g.sill) s += sill();
        s += line(P(w, fr, g.s0, off - t / 2), P(w, fr, g.s1, off - t / 2), 'nz-open');
        s += line(P(w, fr, g.s0, off + t / 2), P(w, fr, g.s1, off + t / 2), 'nz-open');
        break;
    }
    return s + jambs();
  }

  // ---------- 設備 ----------
  function fixtureSymbol(f, S) {
    const w = f.w, d = f.d, x0 = -w / 2, y0 = -d / 2;
    const cat = NZ.fixtureCat(f.type);
    // 置き家具は細線、吊戸棚は破線
    const base = cat === 'loose' ? 'nz-fx-loose' : f.type === 'wallcab' ? 'nz-fx nz-fx-hidden' : 'nz-fx';
    const inner = cat === 'loose' ? 'nz-fx-loose-in' : f.type === 'wallcab' ? 'nz-fx-in nz-fx-hidden' : 'nz-fx-in';
    const rect = (x, y, ww, hh, cls, rx = 0) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(ww)}" height="${r2(hh)}" ${rx ? `rx="${r2(rx)}"` : ''} class="${cls}"/>`;
    let s = f.shape === 'round' ? `<ellipse cx="0" cy="0" rx="${r2(w / 2)}" ry="${r2(d / 2)}" class="${base}"/>` : rect(x0, y0, w, d, base);
    switch (f.type) {
      case 'chair':
        s = rect(x0, y0 + d * 0.15, w, d * 0.85, base, 30) + rect(x0, y0, w, d * 0.15, base, 20);
        break;
      case 'sofa': {
        const bk = Math.min(220, d * 0.25), arm = Math.min(200, w * 0.12);
        s += rect(x0, y0, w, bk, inner) + rect(x0, y0 + bk, arm, d - bk, inner) + rect(-x0 - arm, y0 + bk, arm, d - bk, inner);
        const seats = Math.max(1, Math.round((w - 2 * arm) / 650));
        for (let i = 1; i < seats; i++) { const x = x0 + arm + ((w - 2 * arm) * i) / seats; s += line({ x, y: y0 + bk }, { x, y: -y0 }, inner); }
        break;
      }
      case 'bed': {
        const pil = Math.min(350, d * 0.17);
        const np = w >= 1200 ? 2 : 1, pw = (w - 120) / np;
        for (let i = 0; i < np; i++) s += rect(x0 + 60 + i * pw + 20, y0 + 60, pw - 40, pil - 60, inner, 40);
        s += line({ x: x0, y: y0 + d * 0.3 }, { x: -x0, y: y0 + d * 0.3 }, inner);
        s += `<path d="M${r2(-x0)},${r2(y0 + d * 0.3)} L${r2(-x0 - w * 0.3)},${r2(y0 + d * 0.45)}" class="${inner}"/>`;
        break;
      }
      case 'desk':
        s += line({ x: x0, y: y0 + d * 0.12 }, { x: -x0, y: y0 + d * 0.12 }, inner);
        break;
      case 'tvboard':
        s += rect(-w * 0.35, y0 + d * 0.2, w * 0.7, d * 0.12, inner);
        break;
      case 'shelf': {
        // 造作棚: 棚板を示す斜線
        s += line({ x: x0, y: -y0 }, { x: -x0, y: y0 }, inner);
        break;
      }
      case 'counter':
        s += line({ x: x0, y: -y0 - 30 }, { x: -x0, y: -y0 - 30 }, inner);
        break;
      case 'wallcab':
      case 'shoebox':
        s += line({ x: x0, y: y0 }, { x: -x0, y: -y0 }, inner) + line({ x: -x0, y: y0 }, { x: x0, y: -y0 }, inner);
        break;
      case 'kitchen': {
        const sw = Math.min(800, w * 0.3), sd = d * 0.55;
        s += `<rect x="${r2(-w * 0.18 - sw / 2)}" y="${r2(y0 + d * 0.2)}" width="${r2(sw)}" height="${r2(sd)}" rx="40" class="nz-fx-in"/>`;
        const cx = w * 0.28, r = Math.min(110, d * 0.16);
        s += `<circle cx="${r2(cx - r * 1.3)}" cy="${r2(y0 + d * 0.62)}" r="${r2(r)}" class="nz-fx-in"/><circle cx="${r2(cx + r * 1.3)}" cy="${r2(y0 + d * 0.62)}" r="${r2(r)}" class="nz-fx-in"/><circle cx="${r2(cx)}" cy="${r2(y0 + d * 0.3)}" r="${r2(r * 0.8)}" class="nz-fx-in"/>`;
        break;
      }
      case 'bath': {
        const m = 50;
        const tubD = Math.min(d * 0.45, 800);
        s += `<rect x="${r2(x0 + m)}" y="${r2(y0 + m)}" width="${r2(w - 2 * m)}" height="${r2(tubD)}" rx="120" class="nz-fx-in"/>`;
        s += `<circle cx="0" cy="${r2(y0 + d * 0.78)}" r="40" class="nz-fx-in"/>`;
        break;
      }
      case 'toilet': {
        const tank = Math.min(220, d * 0.3);
        s = `<rect x="${r2(x0)}" y="${r2(y0)}" width="${r2(w)}" height="${r2(tank)}" rx="30" class="nz-fx"/>`;
        s += `<ellipse cx="0" cy="${r2(y0 + tank + (d - tank) / 2)}" rx="${r2(w * 0.45)}" ry="${r2((d - tank) / 2)}" class="nz-fx"/>`;
        s += `<ellipse cx="0" cy="${r2(y0 + tank + (d - tank) * 0.55)}" rx="${r2(w * 0.28)}" ry="${r2((d - tank) * 0.32)}" class="nz-fx-in"/>`;
        break;
      }
      case 'vanity':
        s += `<ellipse cx="0" cy="${r2(d * 0.05)}" rx="${r2(w * 0.3)}" ry="${r2(d * 0.28)}" class="nz-fx-in"/>`;
        break;
      case 'washpan':
        s += `<rect x="${r2(x0 + 50)}" y="${r2(y0 + 50)}" width="${r2(w - 100)}" height="${r2(d - 100)}" rx="40" class="nz-fx-in"/><circle cx="${r2(w / 2 - 130)}" cy="${r2(d / 2 - 130)}" r="45" class="nz-fx-in"/>`;
        break;
      case 'storage':
        s += line({ x: x0, y: y0 }, { x: -x0, y: -y0 }, 'nz-fx-in') + line({ x: -x0, y: y0 }, { x: x0, y: -y0 }, 'nz-fx-in');
        break;
    }
    if (f.type === 'chair') return s;
    const lbl = f.label || (NZ.FIXTURE_TYPES[f.type] || {}).label || '';
    const sub = f.model ? f.model : `${Math.round(w)}×${Math.round(d)}`;
    const fs = Math.min(2.2 * S, d * 0.22, w * 0.18);
    s += `<g transform="rotate(${-(f.rot || 0)})"><text x="0" y="${r2(-fs * 0.1)}" class="nz-fx-text" font-size="${r2(fs)}">${esc(lbl)}</text>`;
    s += `<text x="0" y="${r2(fs * 1.05)}" class="nz-fx-text" font-size="${r2(fs * 0.75)}">${esc(sub)}</text></g>`;
    return s;
  }

  // ---------- 床仕上げのパターン ----------
  function floorPattern(fl, id, S) {
    const ft = NZ.FLOOR_TYPES[fl.type] || NZ.FLOOR_TYPES.flooring;
    const size = +fl.size || (ft.sizes[1] || ft.sizes[0] || [0])[0];
    const rot = ft.dir && fl.dir === 'v' ? 90 : 0;
    const lw = (mm) => r2(mm * S);
    const pat = (w, h, body) => `<pattern id="${id}" patternUnits="userSpaceOnUse" x="0" y="0" width="${r2(w)}" height="${r2(h)}" patternTransform="translate(${r2(fl.x)} ${r2(fl.y)}) rotate(${rot})"><rect width="${r2(w)}" height="${r2(h)}" fill="${ft.fill}"/>${body}</pattern>`;
    const ln = (x1, y1, x2, y2, c, wd) => `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${c}" stroke-width="${lw(wd)}"/>`;
    switch (fl.type) {
      case 'carpet':
        return pat(80, 80, `<circle cx="20" cy="20" r="${lw(0.12)}" fill="#8a83a0"/><circle cx="60" cy="60" r="${lw(0.12)}" fill="#8a83a0"/>`);
      case 'tile':
      case 'doma':
        return pat(size, size, ln(0, 0, size, 0, '#8d8d86', 0.1) + ln(0, 0, 0, size, '#8d8d86', 0.1));
      case 'tatami': {
        const m = size, L = 2 * m, c = '#6d7a3c';
        const mat = (x, y, w, h) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="none" stroke="${c}" stroke-width="${lw(0.18)}"/>`;
        return pat(2 * L, L, mat(0, 0, L, m) + mat(0, m, L, m) + mat(L, 0, m, L) + mat(L + m, 0, m, L));
      }
      case 'cf':
        return pat(200, 200, ln(0, 200, 200, 0, '#9fb4c0', 0.06));
      default: {
        // フローリング: 板幅ごとの線と、乱尺の継ぎ目
        const pw = size, L = 1820, c = '#a68b66';
        return pat(L, 2 * pw, ln(0, 0, L, 0, c, 0.08) + ln(0, pw, L, pw, c, 0.08) + ln(0, 0, 0, pw, c, 0.08) + ln(L / 2, pw, L / 2, 2 * pw, c, 0.08));
      }
    }
  }

  // ---------- 範囲 ----------
  NZ.modelBBox = function (p, includeZones = true) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y, m = 0) => {
      x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m);
      x1 = Math.max(x1, x + m); y1 = Math.max(y1, y + m);
    };
    for (const w of p.walls) { add(w.x1, w.y1, w.thick); add(w.x2, w.y2, w.thick); }
    for (const c of p.columns) { add(c.x - c.w / 2, c.y - c.d / 2); add(c.x + c.w / 2, c.y + c.d / 2); }
    for (const f of p.fixtures) { const r = Math.hypot(f.w, f.d) / 2; add(f.x, f.y, r); }
    for (const l of p.labels) add(l.x, l.y, 300);
    for (const ph of p.photos || []) add(ph.x, ph.y, 300);
    for (const d of p.dims) { add(d.x1, d.y1); add(d.x2, d.y2); }
    if (includeZones) for (const z of p.zones) { add(z.x, z.y); add(z.x + z.w, z.y + z.h); }
    for (const z of p.floors || []) { add(z.x, z.y); add(z.x + z.w, z.y + z.h); }
    if (p.grid && p.grid.visible) { for (const x of p.grid.xs) add(x, isFinite(y0) ? y0 : 0); for (const y of p.grid.ys) add(isFinite(x0) ? x0 : 0, y); }
    if (!isFinite(x0)) {
      const u = p.underlay;
      if (u) return { x0: u.x, y0: u.y, x1: u.x + u.w * u.mmPerPx, y1: u.y + u.h * u.mmPerPx };
      return { x0: 0, y0: 0, x1: 10000, y1: 7000 };
    }
    return { x0, y0, x1, y1 };
  };

  // 通り芯・寸法などの注記まで含めた範囲
  NZ.annotatedBBox = function (p, S) {
    const b = NZ.modelBBox(p, false);
    const m = p.grid && p.grid.visible && (p.grid.xs.length || p.grid.ys.length) ? 34 * S : 16 * S;
    return { x0: b.x0 - m, y0: b.y0 - m, x1: b.x1 + m, y1: b.y1 + m };
  };

  // ---------- 通り芯 ----------
  NZ.gridLabelX = (i) => String(i + 1);
  NZ.gridLabelY = (i) => {
    let s = '', n = i;
    do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
    return s;
  };
  function renderGrid(p, S) {
    const g = p.grid;
    if (!g || !g.visible || (!g.xs.length && !g.ys.length)) return '';
    const b = NZ.modelBBox(p, false);
    const m = 16 * S, R = 3.5 * S;
    const xs = [...g.xs].sort((a, c) => a - c), ys = [...g.ys].sort((a, c) => a - c);
    const top = b.y0 - m, bot = b.y1 + m, left = b.x0 - m, right = b.x1 + m;
    let s = '<g class="nz-grid">';
    xs.forEach((x, i) => {
      s += line({ x, y: top }, { x, y: bot }, 'nz-gridline');
      for (const cy of [top - R, bot + R]) s += `<circle cx="${r2(x)}" cy="${r2(cy)}" r="${r2(R)}" class="nz-bubble"/><text x="${r2(x)}" y="${r2(cy + R * 0.38)}" class="nz-bubble-text" font-size="${r2(R * 1.05)}">${NZ.gridLabelX(i)}</text>`;
    });
    ys.forEach((y, i) => {
      s += line({ x: left, y }, { x: right, y }, 'nz-gridline');
      for (const cx of [left - R, right + R]) s += `<circle cx="${r2(cx)}" cy="${r2(y)}" r="${r2(R)}" class="nz-bubble"/><text x="${r2(cx)}" y="${r2(y + R * 0.38)}" class="nz-bubble-text" font-size="${r2(R * 1.05)}">${NZ.gridLabelY(i)}</text>`;
    });
    // 通り芯間寸法(上・左)と全体寸法
    for (let i = 0; i + 1 < xs.length; i++) s += dimLine({ x: xs[i], y: top }, { x: xs[i + 1], y: top }, -(2 * R + 4 * S), NZ.fmtLen(xs[i + 1] - xs[i]), S);
    if (xs.length > 2) s += dimLine({ x: xs[0], y: top }, { x: xs[xs.length - 1], y: top }, -(2 * R + 10 * S), NZ.fmtLen(xs[xs.length - 1] - xs[0]), S);
    for (let i = 0; i + 1 < ys.length; i++) s += dimLine({ x: left, y: ys[i + 1] }, { x: left, y: ys[i] }, -(2 * R + 4 * S), NZ.fmtLen(ys[i + 1] - ys[i]), S);
    if (ys.length > 2) s += dimLine({ x: left, y: ys[ys.length - 1] }, { x: left, y: ys[0] }, -(2 * R + 10 * S), NZ.fmtLen(ys[ys.length - 1] - ys[0]), S);
    return s + '</g>';
  }

  // ---------- 本体 ----------
  NZ.svgDefs = function (S, prefix) {
    const hs = 1.2 * S;
    return `<defs><pattern id="${prefix}-hatch" patternUnits="userSpaceOnUse" width="${r2(hs)}" height="${r2(hs)}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${r2(hs)}" stroke="#222" stroke-width="${r2(0.13 * S)}"/></pattern></defs>`;
  };

  NZ.styleBlock = function (S, prefix) {
    const lw = (mm) => r2(mm * S);
    const css = `
      .nz-wall-o{stroke:#111;stroke-width:${lw(0.7)};stroke-linejoin:miter}
      .nz-wall-f{stroke:none}
      .nz-wall-rm{fill:none;stroke:#c33;stroke-width:${lw(0.3)};stroke-dasharray:${lw(1.5)} ${lw(0.8)}}
      .nz-leaf{fill:none;stroke:#111;stroke-width:${lw(0.35)}}
      .nz-swing{fill:none;stroke:#111;stroke-width:${lw(0.18)}}
      .nz-jamb{stroke:#111;stroke-width:${lw(0.25)}}
      .nz-panel{fill:#fff;stroke:#111;stroke-width:${lw(0.25)}}
      .nz-dashed{stroke-dasharray:${lw(1)} ${lw(0.6)};fill:none}
      .nz-arrow{fill:none;stroke:#111;stroke-width:${lw(0.18)}}
      .nz-win{stroke:#111;stroke-width:${lw(0.3)}}
      .nz-glass{stroke:#111;stroke-width:${lw(0.15)}}
      .nz-open{stroke:#111;stroke-width:${lw(0.18)};stroke-dasharray:${lw(1.2)} ${lw(0.7)}}
      .nz-fx{fill:#fff;stroke:#111;stroke-width:${lw(0.3)}}
      .nz-fx-in{fill:none;stroke:#111;stroke-width:${lw(0.2)}}
      .nz-fx-loose{fill:#fff;fill-opacity:.85;stroke:#555;stroke-width:${lw(0.18)}}
      .nz-fx-loose-in{fill:none;stroke:#555;stroke-width:${lw(0.13)}}
      .nz-fx-hidden{stroke-dasharray:${lw(1.2)} ${lw(0.8)};fill:none}
      .nz-sill{fill:#efe6d2;stroke:#111;stroke-width:${lw(0.15)}}
      .nz-floor-text{text-anchor:middle;fill:#666;font-family:${FONT}}
      .nz-fx-text{text-anchor:middle;fill:#111;font-family:${FONT}}
      .nz-dim-line,.nz-dim-ext,.nz-dim-tick{stroke:#1a1a1a;stroke-width:${lw(0.15)}}
      .nz-dim-tick{stroke-width:${lw(0.3)}}
      .nz-dim-text{text-anchor:middle;fill:#111;font-family:${FONT}}
      .nz-gridline{stroke:#555;stroke-width:${lw(0.15)};stroke-dasharray:${lw(6)} ${lw(1)} ${lw(1)} ${lw(1)}}
      .nz-bubble{fill:#fff;stroke:#333;stroke-width:${lw(0.2)}}
      .nz-bubble-text{text-anchor:middle;fill:#111;font-family:${FONT};font-weight:600}
      .nz-label{text-anchor:middle;fill:#111;font-family:${FONT}}
      .nz-zone{stroke-width:${lw(0.3)};stroke-dasharray:${lw(2)} ${lw(1)};fill-opacity:.18}
      .nz-zone-text{text-anchor:middle;font-family:${FONT};font-weight:600}
      .nz-det{fill:none;stroke:#ff8a00;stroke-width:${lw(0.5)};stroke-dasharray:${lw(1)} ${lw(0.7)}}`;
    // 同じページに複数の図(編集画面・プレビュー)があっても干渉しないようにスコープを付ける
    const scoped = css.replace(/([^{}]+)\{/g, (m0, sel) => sel.split(',').map((x) => `.${prefix}-root ${x.trim()}`).join(',') + '{');
    return `<style>${scoped}</style>`;
  };

  // 写真の記号: 番号入りの丸 + 撮影方向の扇形。大きさは紙面mm × S
  NZ.PHOTO_R = 3.2; // 丸の半径(紙面mm)
  function photoSymbol(ph, S) {
    const r = NZ.PHOTO_R * S, R = r * 3.2, half = (28 * Math.PI) / 180;
    const a = ((+ph.rot || 0) * Math.PI) / 180;
    const pt = (ang, rr) => `${r2(ph.x + Math.sin(ang) * rr)},${r2(ph.y - Math.cos(ang) * rr)}`;
    const fan = `M${pt(a - half, r * 0.9)}L${pt(a - half, R)}A${r2(R)},${r2(R)} 0 0 1 ${pt(a + half, R)}L${pt(a + half, r * 0.9)}Z`;
    const tip = `M${pt(a, R + r * 0.9)}L${pt(a - 0.16, R - r * 0.1)}L${pt(a + 0.16, R - r * 0.1)}Z`;
    return `<g data-id="${ph.id}" class="nz-photo">` +
      `<path d="${fan}" fill="rgba(30,111,217,.16)" stroke="#1e6fd9" stroke-width="${r2(0.18 * S)}"/>` +
      `<path d="${tip}" fill="#1e6fd9"/>` +
      `<circle cx="${r2(ph.x)}" cy="${r2(ph.y)}" r="${r2(r)}" fill="#1e6fd9" stroke="#fff" stroke-width="${r2(0.35 * S)}"/>` +
      `<text x="${r2(ph.x)}" y="${r2(ph.y + r * 0.36)}" font-size="${r2(r * 1.05)}" font-weight="700" text-anchor="middle" fill="#fff" font-family="${FONT}">${esc(ph.no)}</text></g>`;
  }
  NZ.photoSymbol = photoSymbol;

  NZ.renderModel = function (p, S, opts = {}) {
    const o = Object.assign({ zones: true, grid: true, dims: true, detected: true, prefix: 'nz' }, opts);
    const ext = endExtensions(p);
    let floors = '';
    for (const fl of p.floors || []) {
      const pid = `${o.prefix}-fl-${fl.id}`;
      floors += `<g data-id="${fl.id}"><defs>${floorPattern(fl, pid, S)}</defs><rect x="${r2(fl.x)}" y="${r2(fl.y)}" width="${r2(fl.w)}" height="${r2(fl.h)}" fill="url(#${pid})"/>`;
      if (fl.showName) floors += `<text x="${r2(fl.x + fl.w / 2)}" y="${r2(fl.y + fl.h - 2 * S)}" class="nz-floor-text" font-size="${r2(2.3 * S)}">${esc((NZ.FLOOR_TYPES[fl.type] || {}).label || '')}</text>`;
      floors += '</g>';
    }
    let zones = '', grid = '', outl = '', fill = '', hatch = '', sym = '', det = '', dims = '', fx = '', labels = '';

    if (o.zones) for (const z of p.zones) {
      const zt = NZ.ZONE_TYPES[z.type] || NZ.ZONE_TYPES.other;
      zones += `<g data-id="${z.id}"><rect x="${r2(z.x)}" y="${r2(z.y)}" width="${r2(z.w)}" height="${r2(z.h)}" class="nz-zone" fill="${zt.color}" stroke="${zt.color}"/>`;
      zones += `<text x="${r2(z.x + z.w / 2)}" y="${r2(z.y + z.h / 2)}" class="nz-zone-text" fill="${zt.color}" font-size="${r2(3 * S)}">${esc(z.label || zt.label)}</text></g>`;
    }
    if (o.grid) grid = renderGrid(p, S);

    for (const w of p.walls) {
      const fr = frame(w), off = wallOffset(w), t = w.thick;
      const kind = NZ.WALL_KINDS[w.kind] || NZ.WALL_KINDS.existing;
      const [e0, e1] = ext.get(w.id) || [0, 0];
      const segs = resolveSegments(w);
      segs.forEach((g, i) => {
        if (g.type === 'wall') {
          const s0 = g.s0 - (i === 0 ? e0 : 0), s1 = g.s1 + (i === segs.length - 1 ? e1 : 0);
          const d = quad(w, fr, s0, s1, off - t / 2, off + t / 2);
          if (kind.dashed) { outl += `<path d="${d}" class="nz-wall-rm" data-id="${w.id}"/>`; return; }
          outl += `<path d="${d}" class="nz-wall-o" fill="#111" data-id="${w.id}"/>`;
          fill += `<path d="${d}" class="nz-wall-f" fill="${kind.fill}" data-id="${w.id}"/>`;
          if (kind.hatch) hatch += `<path d="${d}" fill="url(#${o.prefix}-hatch)" data-id="${w.id}"/>`;
        } else {
          sym += openingSymbol(w, fr, g, off, S);
        }
      });
      if (o.detected && w.detected) det += `<path d="${quad(w, fr, -e0, fr.L + e1, off - t / 2, off + t / 2)}" class="nz-det"/>`;
      if (o.dims && w.dim && w.dim !== 'none') {
        const sg = sideSign(w.dim);
        const face = sg > 0 ? off + t / 2 : -(off - t / 2);
        // 内法入力の壁は面から面(内法)、それ以外は端点間の寸法
        const [i0, i1] = NZ.wallInset(w);
        const a = P(w, fr, i0, 0), b = P(w, fr, fr.L - i1, 0);
        const span = fr.L - i0 - i1;
        const real = segs.filter((g) => !g.hidden && !(g.auto && g.len < 0.5));
        if (real.length > 1) {
          for (const g of real) dims += dimLine(P(w, fr, g.s0, 0), P(w, fr, g.s1, 0), sg * (face + 5 * S), NZ.fmtLen(g.len), S);
          dims += dimLine(a, b, sg * (face + 10 * S), NZ.fmtLen(span), S);
        } else {
          dims += dimLine(a, b, sg * (face + 5 * S), NZ.fmtLen(span), S);
        }
      }
    }
    for (const c of p.columns) {
      const kind = NZ.WALL_KINDS[c.kind] || NZ.WALL_KINDS.structure;
      const r = `x="${r2(c.x - c.w / 2)}" y="${r2(c.y - c.d / 2)}" width="${r2(c.w)}" height="${r2(c.d)}"`;
      outl += `<rect ${r} class="nz-wall-o" fill="#111" data-id="${c.id}"/>`;
      fill += `<rect ${r} class="nz-wall-f" fill="${kind.fill}" data-id="${c.id}"/>`;
      if (kind.hatch) hatch += `<rect ${r} fill="url(#${o.prefix}-hatch)"/>`;
      // 柱は×印で区別
      sym += line({ x: c.x - c.w / 2, y: c.y - c.d / 2 }, { x: c.x + c.w / 2, y: c.y + c.d / 2 }, 'nz-jamb') + line({ x: c.x + c.w / 2, y: c.y - c.d / 2 }, { x: c.x - c.w / 2, y: c.y + c.d / 2 }, 'nz-jamb');
      if (o.detected && c.detected) det += `<rect ${r} class="nz-det"/>`;
    }
    for (const f of p.fixtures) {
      fx += `<g transform="translate(${r2(f.x)} ${r2(f.y)}) rotate(${r2(f.rot || 0)})" data-id="${f.id}">${fixtureSymbol(f, S)}</g>`;
      if (o.detected && f.detected) det += `<g transform="translate(${r2(f.x)} ${r2(f.y)}) rotate(${r2(f.rot || 0)})"><rect x="${r2(-f.w / 2)}" y="${r2(-f.d / 2)}" width="${r2(f.w)}" height="${r2(f.d)}" class="nz-det"/></g>`;
    }
    if (o.dims) for (const d of p.dims) {
      const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      dims += `<g data-id="${d.id}">${dimLine({ x: d.x1, y: d.y1 }, { x: d.x2, y: d.y2 }, (d.offset || 0) * S, d.text || NZ.fmtLen(L), S)}</g>`;
    }
    for (const l of p.labels) {
      const fs = (l.size || 3.5) * S;
      labels += `<g data-id="${l.id}"><text x="${r2(l.x)}" y="${r2(l.y)}" class="nz-label" font-size="${r2(fs)}">${esc(l.text)}</text>`;
      if (l.sub) labels += `<text x="${r2(l.x)}" y="${r2(l.y + fs * 1.15)}" class="nz-label" font-size="${r2(fs * 0.7)}">${esc(l.sub)}</text>`;
      labels += '</g>';
    }
    let photos = '';
    if (o.photos !== false) for (const ph of p.photos || []) photos += photoSymbol(ph, S);
    return `<g class="${o.prefix}-root">` + NZ.styleBlock(S, o.prefix) + floors + zones + grid + `<g>${outl}</g><g>${fill}</g><g>${hatch}</g>` + sym + fx + dims + labels + photos + det + '</g>';
  };

  // ---------- 用紙(図面枠・表題欄・スケールバー) ----------
  function fitSize(text, maxW, size) {
    let units = 0;
    for (const ch of String(text || '')) units += ch.charCodeAt(0) > 255 ? 1 : 0.58;
    return units * size > maxW ? Math.max(1.2, maxW / units) : size;
  }

  NZ.sheetScale = function (p) {
    const [W, H] = NZ.PAPERS[p.meta.paper] || NZ.PAPERS.A3;
    if (p.meta.scale !== 'auto' && +p.meta.scale) return +p.meta.scale;
    const aw = W - 20 - 6, ah = H - 20 - 40 - 6;
    for (const S of NZ.SCALES) {
      const b = NZ.annotatedBBox(p, S);
      if ((b.x1 - b.x0) / S <= aw && (b.y1 - b.y0) / S <= ah) return S;
    }
    return NZ.SCALES[NZ.SCALES.length - 1];
  };

  // 用紙の枠・表題欄・スケールバー・方位・備考(平面図と展開図で共用)
  NZ.sheetFrame = function (m, W, H, S, opts = {}) {
    const TB = 40, TW = 190, M = 10;
    const T = (x, y, txt, size, anchor = 'start', weight = 400, maxW = 0) => {
      const fs = maxW ? fitSize(txt, maxW, size) : size;
      return `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(fs)}" text-anchor="${anchor}" font-weight="${weight}" font-family="${FONT}" fill="#111">${esc(txt)}</text>`;
    };
    m = Object.assign({}, m, opts.title !== undefined ? { title: opts.title } : {});
    let s = '<g class="nz-frame">';
    // 枠
    s += `<rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="#111" stroke-width="0.5"/>`;
    const sy = H - M - TB;
    s += `<rect x="${M}" y="${r2(sy)}" width="${W - 2 * M}" height="${TB}" fill="#fff" stroke="#111" stroke-width="0.35"/>`;
    // 表題欄
    const x0 = W - M - TW;
    const rows = [12, 7, 7, 7, 7];
    let y = sy;
    s += `<line x1="${x0}" y1="${sy}" x2="${x0}" y2="${H - M}" stroke="#111" stroke-width="0.35"/>`;
    const ln = (xa, ya, xb, yb) => `<line x1="${r2(xa)}" y1="${r2(ya)}" x2="${r2(xb)}" y2="${r2(yb)}" stroke="#111" stroke-width="0.2"/>`;
    // 1段目: 会社名
    s += T(x0 + 3, y + 6.3, m.company || '', 4.6, 'start', 700, TW - 6);
    if (m.companySub) s += T(x0 + 3, y + 10.4, m.companySub, 2.2, 'start', 400, TW - 6);
    y += rows[0];
    const L1 = 18, V1 = 62, L2 = 22, V2 = TW - L1 - V1 - L2;
    const cell = (label, value, xs, lw, vw, yy) => ln(xs + lw, yy, xs + lw, yy + 7) + T(xs + lw / 2, yy + 4.6, label, 2.2, 'middle') + T(xs + lw + 2, yy + 4.9, value, 3, 'start', 400, vw - 4);
    s += ln(x0, y, W - M, y) + cell('物件名', m.name, x0, L1, TW - L1, y);
    y += 7;
    const pair = (la, va, lb, vb) => {
      let r = ln(x0, y, W - M, y) + cell(la, va, x0, L1, V1, y) + ln(x0 + L1 + V1, y, x0 + L1 + V1, y + 7) + cell(lb, vb, x0 + L1 + V1, L2, V2, y);
      y += 7;
      return r;
    };
    s += pair('図面名', m.title, '図面番号', m.drawingNo);
    s += pair('縮尺', `1/${S} (${m.paper})`, '作成日', (m.date || '').replace(/-/g, '.'));
    s += pair('作成者', m.author, '許認可番号', m.license);
    // スケールバー
    const leftW = x0 - M;
    const maxBar = Math.min(100, leftW - 50);
    const cands = [500, 1000, 2000, 3000, 5000, 10000, 20000];
    let Lm = cands[0];
    for (const c of cands) if (c / S <= maxBar) Lm = c;
    const bx = M + 6, by = sy + 18, bl = Lm / S, seg = bl / 5;
    s += T(bx, sy + 8, `SCALE 1/${S}`, 3, 'start', 600);
    for (let i = 0; i < 5; i++) s += `<rect x="${r2(bx + i * seg)}" y="${r2(by)}" width="${r2(seg)}" height="2.2" fill="${i % 2 ? '#fff' : '#111'}" stroke="#111" stroke-width="0.2"/>`;
    for (let i = 0; i <= 5; i++) {
      const v = (Lm / 5) * i;
      const lbl = i === 5 ? (Lm >= 1000 ? `${Lm / 1000}m` : `${Lm}mm`) : Lm >= 1000 ? String(+(v / 1000).toFixed(1)) : String(v);
      s += T(bx + i * seg, by + 6, lbl, 2.2, 'middle');
    }
    // 方位
    const nx = bx + bl + 18, ny = sy + 20;
    if (opts.north !== false && nx + 10 < x0) {
      s += `<g transform="translate(${r2(nx)} ${r2(ny)}) rotate(${+m.north || 0})"><circle r="7" fill="none" stroke="#111" stroke-width="0.25"/><path d="M0,-6.5 L2.6,4 L0,2.4 L-2.6,4Z" fill="#111"/>${T(0, -8.2, 'N', 3, 'middle', 700)}</g>`;
    }
    // 備考
    if (m.note) {
      const nxs = nx + 14;
      const avail = x0 - nxs - 3;
      if (avail > 20) {
        const per = Math.max(6, Math.floor(avail / 2.4));
        const lines = [];
        for (const para of String(m.note).split(/\n/)) for (let i = 0; i < para.length; i += per) lines.push(para.slice(i, i + per));
        lines.slice(0, 11).forEach((l, i) => (s += T(nxs, sy + 5 + i * 3.2, l, 2.3)));
      }
    }
    return s + '</g>';
  };

  NZ.renderSheet = function (p, opts = {}) {
    const m = p.meta;
    const [W, H] = NZ.PAPERS[m.paper] || NZ.PAPERS.A3;
    const S = NZ.sheetScale(p);
    const TB = 40, M = 10;
    const area = { x: M, y: M, w: W - 2 * M, h: H - 2 * M - TB };
    const b = NZ.annotatedBBox(p, S);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const tx = area.x + area.w / 2 - cx / S, ty = area.y + area.h / 2 - cy / S;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
    s += `<g transform="translate(${r2(tx)} ${r2(ty)}) scale(${1 / S})">${NZ.svgDefs(S, 'sh')}${NZ.renderModel(p, S, { zones: !!m.printZones, detected: false, prefix: 'sh' })}</g>`;
    s += NZ.sheetFrame(m, W, H, S);
    return { svg: s + '</svg>', S, W, H, tx, ty };
  };
})();
