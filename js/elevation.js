// 展開図: 室名の位置から部屋を囲む壁を探し、A面(北)・B面(東)・C面(南)・D面(西)を部屋の内側から見た図にする
// 対象は水平・垂直の壁のみ(斜めの壁は対象外)。図面の上を北とする。
(function () {
  const NZ = (window.NZ = window.NZ || {});
  const r2 = (n) => Math.round(n * 100) / 100;
  const esc = NZ.esc;
  const FONT = NZ.FONT;

  const AXIS_TOL = 0.996; // 水平・垂直とみなす向き(約5°以内)
  const FACE_TOL = 60; // 同じ面とみなす壁面のずれ(mm)
  const FIX_TOL = 200; // 設備の背面と壁面の距離(mm)

  // 建具の標準的な高さ(床からの下端・上端 mm)。実測値ではなく表記用の目安
  const OPENING_V = {
    door: [0, 2000], door2: [0, 2000], oyako: [0, 2000], entrance: [0, 2100],
    sliding: [0, 2000], sliding2: [0, 2000], pocket: [0, 2000],
    fusuma: [0, 1800], shoji: [0, 1800],
    folding: [0, 2000], folding2: [0, 2000],
    opening: [0, 2000],
    window: [900, 2000], windowFixed: [900, 2000], windowSash: [1200, 1800],
  };
  NZ.ELEV_OPENING_V = OPENING_V;
  const WINDOWS = ['window', 'windowFixed', 'windowSash'];
  // 建具の標準の腰高・高さ。canBot=腰高を入力できる種類(窓・開口)
  NZ.elevOpeningDefault = function (type) {
    const v = OPENING_V[type];
    if (!v) return null;
    return { bot: v[0], ht: v[1] - v[0], canBot: WINDOWS.includes(type) || type === 'opening' };
  };
  // 入力値があればそれを、なければ標準値を使う。std=true は標準値を使った
  NZ.elevOpeningV = (it) => openingV(it); // 見積(壁面積から建具を引く)でも使う
  function openingV(it) {
    const d = NZ.elevOpeningDefault(it.type) || { bot: 0, ht: 2000, canBot: false };
    const hasBot = d.canBot && Number.isFinite(+it.bot) && it.bot !== undefined && it.bot !== '';
    const hasHt = Number.isFinite(+it.ht) && it.ht !== undefined && it.ht !== '' && +it.ht > 0;
    const bot = hasBot ? +it.bot : d.bot, ht = hasHt ? +it.ht : d.ht;
    return { bot, top: bot + ht, std: !hasHt || (d.canBot && !hasBot) };
  }
  const SLIDES = ['sliding', 'sliding2', 'pocket', 'fusuma', 'shoji'];

  const FACES = [
    { key: 'A', dir: '北' },
    { key: 'B', dir: '東' },
    { key: 'C', dir: '南' },
    { key: 'D', dir: '西' },
  ];

  // 水平・垂直の壁を、中心線の位置と範囲に直す
  function axisWalls(p) {
    const out = [];
    for (const w of p.walls || []) {
      if (w.detected) continue;
      const fr = NZ.wallFrame(w), off = NZ.wallOffset(w), t = +w.thick || 0;
      const o = { w, fr, t, H: Math.max(100, +w.height || NZ.DEFAULT_WALL_HEIGHT) };
      if (Math.abs(fr.u.x) >= AXIS_TOL) {
        o.axis = 'h';
        o.c = w.y1 + fr.n.y * off; // 中心線の y
        o.a = Math.min(w.x1, w.x2); o.b = Math.max(w.x1, w.x2);
      } else if (Math.abs(fr.u.y) >= AXIS_TOL) {
        o.axis = 'v';
        o.c = w.x1 + fr.n.x * off; // 中心線の x
        o.a = Math.min(w.y1, w.y2); o.b = Math.max(w.y1, w.y2);
      } else continue;
      out.push(o);
    }
    return out;
  }

  // 室名の一覧 = 部屋の一覧
  // 室名(文字)の一覧 = 部屋の一覧。同じ壁に囲まれた文字が複数あるとき(例: 「洋室1」と「6帖」)は1部屋にまとめる
  // ids: その部屋に含まれる文字の id、complete: 四方の壁が見つかった
  NZ.elevRooms = function (p) {
    const aw = axisWalls(p), out = [], byKey = new Map();
    for (const l of p.labels || []) {
      const name = String(l.text || '').trim();
      if (!name) continue;
      const b = roomBounds(aw, l);
      const complete = [b.x0, b.x1, b.y0, b.y1].every((v) => v !== null) && b.x1 > b.x0 && b.y1 > b.y0;
      const key = complete ? [b.x0, b.x1, b.y0, b.y1].map((v) => Math.round(v)).join(',') : null;
      if (key && byKey.has(key)) { const r = byKey.get(key); r.ids.push(l.id); r.subs.push(name); continue; }
      const r = { id: l.id, ids: [l.id], name, subs: [], x: l.x, y: l.y, complete };
      if (key) byKey.set(key, r);
      out.push(r);
    }
    for (const r of out) r.label = r.subs.length ? `${r.name}(${r.subs.join('・')})` : r.name;
    return out;
  };

  // 室名の位置から四方の壁面を探す
  function roomBounds(aw, pt) {
    let y0 = null, y1 = null, x0 = null, x1 = null;
    for (const o of aw) {
      if (o.axis === 'h' && pt.x >= o.a - 1 && pt.x <= o.b + 1) {
        if (o.c < pt.y) { const f = o.c + o.t / 2; if (f <= pt.y && (y0 === null || f > y0)) y0 = f; }
        else { const f = o.c - o.t / 2; if (f >= pt.y && (y1 === null || f < y1)) y1 = f; }
      }
      if (o.axis === 'v' && pt.y >= o.a - 1 && pt.y <= o.b + 1) {
        if (o.c < pt.x) { const f = o.c + o.t / 2; if (f <= pt.x && (x0 === null || f > x0)) x0 = f; }
        else { const f = o.c - o.t / 2; if (f >= pt.x && (x1 === null || f < x1)) x1 = f; }
      }
    }
    return { x0, x1, y0, y1 };
  }

  // 1つの面の内容(壁・建具・設備)を、面の左端からの距離に直して返す
  function buildFace(p, aw, bd, key, pt) {
    const horiz = key === 'A' || key === 'C';
    const line = { A: bd.y0, B: bd.x1, C: bd.y1, D: bd.x0 }[key];
    if (line === null) return { key, missing: true };
    // この面に並ぶ壁
    const ws = aw.filter((o) => {
      if (o.axis !== (horiz ? 'h' : 'v')) return false;
      const near = key === 'A' || key === 'D' ? o.c < (horiz ? pt.y : pt.x) && Math.abs(o.c + o.t / 2 - line) <= FACE_TOL
        : o.c > (horiz ? pt.y : pt.x) && Math.abs(o.c - o.t / 2 - line) <= FACE_TOL;
      return near;
    });
    // 面の左右の範囲
    let lo = horiz ? bd.x0 : bd.y0, hi = horiz ? bd.x1 : bd.y1;
    if (lo === null) lo = Math.min(...ws.map((o) => o.a));
    if (hi === null) hi = Math.max(...ws.map((o) => o.b));
    if (!(hi > lo)) return { key, missing: true };
    const total = hi - lo;
    // 図面の座標 → 面の左端からの距離(部屋の内側から見る)
    const toH = (v) => (key === 'A' || key === 'B' ? v - lo : hi - v);
    const items = [];
    let H = 0;
    for (const o of ws) {
      const coord = (s) => (horiz ? o.w.x1 + o.fr.u.x * s : o.w.y1 + o.fr.u.y * s);
      let used = false;
      for (const g of NZ.resolveSegments(o.w)) {
        let a = coord(g.s0), b = coord(g.s1);
        if (a > b) [a, b] = [b, a];
        a = Math.max(a, lo); b = Math.min(b, hi);
        if (b - a < 1) continue;
        let h0 = toH(a), h1 = toH(b);
        if (h0 > h1) [h0, h1] = [h1, h0];
        items.push({ type: g.type || 'wall', panels: g.panels, ht: g.ht, bot: g.bot, h0, h1, wallId: o.w.id, H: o.H });
        used = true;
      }
      if (used) H = Math.max(H, o.H);
    }
    if (!items.length) return { key, missing: true };
    // 壁のない区間
    const iv = items.map((i) => [i.h0, i.h1]).sort((x, y) => x[0] - y[0]);
    const gaps = [];
    let cur = 0;
    for (const [a, b] of iv) { if (a - cur > 5) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (total - cur > 5) gaps.push([cur, total]);
    // 壁に背を付けた設備・造作家具
    const fixtures = [];
    const want = { A: 0, B: 90, C: 180, D: 270 }[key];
    for (const f of p.fixtures || []) {
      if (f.detected || NZ.fixtureCat(f.type) === 'loose') continue;
      const rot = (((+f.rot || 0) % 360) + 360) % 360;
      if (rot !== want) continue;
      const back = key === 'A' ? f.y - f.d / 2 : key === 'B' ? f.x + f.d / 2 : key === 'C' ? f.y + f.d / 2 : f.x - f.d / 2;
      if (Math.abs(back - line) > FIX_TOL) continue;
      const c = horiz ? f.x : f.y;
      if (c < lo || c > hi) continue;
      let h0 = toH(c - f.w / 2), h1 = toH(c + f.w / 2);
      if (h0 > h1) [h0, h1] = [h1, h0];
      const def = NZ.FIXTURE_TYPES[f.type] || {};
      fixtures.push({ h0: Math.max(0, h0), h1: Math.min(total, h1), ht: +f.h || 850, label: f.label || def.label || '', id: f.id });
    }
    return { key, total, H: H || NZ.DEFAULT_WALL_HEIGHT, items, gaps, fixtures };
  }

  // 点 pt を含む部屋(室名)。見つからなければ一番近い室名
  NZ.roomAt = function (p, pt) {
    const rooms = NZ.elevRooms(p);
    if (!rooms.length) return null;
    const aw = axisWalls(p);
    for (const r of rooms) {
      const b = roomBounds(aw, r);
      if ([b.x0, b.x1, b.y0, b.y1].every((v) => v !== null) && pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1) return r;
    }
    return rooms.slice().sort((a, b) => Math.hypot(a.x - pt.x, a.y - pt.y) - Math.hypot(b.x - pt.x, b.y - pt.y))[0];
  };

  NZ.elevFaces = function (p, room) {
    const aw = axisWalls(p);
    const bd = roomBounds(aw, room);
    const faces = FACES.map((f) => Object.assign({ dir: f.dir }, buildFace(p, aw, bd, f.key, room)));
    const ok = faces.filter((f) => !f.missing);
    const CH = ok.length ? Math.max(...ok.map((f) => f.H)) : NZ.DEFAULT_WALL_HEIGHT;
    return { faces, bounds: bd, CH };
  };

  // ---------- 描画(用紙 mm 座標) ----------
  function T(x, y, txt, size, anchor = 'start', weight = 400, fill = '#111') {
    return `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(size)}" text-anchor="${anchor}" font-weight="${weight}" font-family="${FONT}" fill="${fill}">${esc(txt)}</text>`;
  }
  const L = (x1, y1, x2, y2, w = 0.18, extra = '') => `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="#111" stroke-width="${w}" ${extra}/>`;
  const R = (x, y, w, h, fill, sw = 0.25, extra = '') => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="${fill}" stroke="#111" stroke-width="${sw}" ${extra}/>`;
  // 寸法線(水平)
  function hDim(xa, xb, y, text) {
    if (xb - xa < 0.5) return '';
    const t = 0.8;
    return L(xa, y, xb, y, 0.15) + L(xa, y - t, xa, y + t, 0.15) + L(xb, y - t, xb, y + t, 0.15) +
      L(xa - 0.6, y + 0.6, xa + 0.6, y - 0.6, 0.25) + L(xb - 0.6, y + 0.6, xb + 0.6, y - 0.6, 0.25) +
      T((xa + xb) / 2, y - 0.8, text, xb - xa < 6 ? 1.6 : 2.2, 'middle');
  }
  function vDim(x, ya, yb, text) {
    const t = 0.8, my = (ya + yb) / 2;
    return L(x, ya, x, yb, 0.15) + L(x - t, ya, x + t, ya, 0.15) + L(x - t, yb, x + t, yb, 0.15) +
      L(x - 0.6, ya + 0.6, x + 0.6, ya - 0.6, 0.25) + L(x - 0.6, yb + 0.6, x + 0.6, yb - 0.6, 0.25) +
      `<text x="${r2(x - 0.9)}" y="${r2(my)}" font-size="2.2" text-anchor="middle" font-family="${FONT}" fill="#111" transform="rotate(-90 ${r2(x - 0.9)} ${r2(my)})">${esc(text)}</text>`;
  }

  // 1面を描く。ox,oy は床の左端(用紙 mm)
  function drawFace(f, CH, S, ox, oy) {
    const X = (h) => ox + h / S, Y = (v) => oy - v / S;
    let s = '';
    const wallH = CH;
    // 壁の面(白)と天井・床
    for (const it of f.items) {
      s += R(X(it.h0), Y(it.H), (it.h1 - it.h0) / S, it.H / S, '#fff', 0, `data-wall="${esc(it.wallId)}" class="ev-hit"`);
    }
    for (const [a, b] of f.gaps) {
      s += R(X(a), Y(wallH), (b - a) / S, wallH / S, 'none', 0.18, 'stroke-dasharray="1.2 0.8"');
      s += T((X(a) + X(b)) / 2, Y(wallH / 2), '(壁なし)', 2, 'middle', 400, '#777');
    }
    // 建具
    for (const it of f.items) {
      if (it.type === 'wall') continue;
      const ov = openingV(it);
      const top = Math.min(ov.top, it.H), bot = Math.max(0, Math.min(ov.bot, top - 50));
      const mark = ov.std ? '*' : '';
      if (ov.std) f.usedStd = true;
      const x0 = X(it.h0), x1 = X(it.h1), y0 = Y(top), y1 = Y(bot), w = x1 - x0, h = y1 - y0;
      const hit = `data-wall="${esc(it.wallId)}" class="ev-hit"`;
      if (it.type === 'opening') {
        s += R(x0, y0, w, h, '#fafafa', 0.25, `stroke-dasharray="1.5 1" ${hit}`);
      } else if (WINDOWS.includes(it.type)) {
        s += R(x0, y0, w, h, '#dceaf7', 0.3, hit);
        const fi = Math.min(0.9, w / 6, h / 6);
        s += R(x0 + fi, y0 + fi, w - 2 * fi, h - 2 * fi, 'none', 0.15);
        if (it.type === 'window') s += L((x0 + x1) / 2, y0 + fi, (x0 + x1) / 2, y1 - fi, 0.15);
        if (it.type === 'windowFixed') s += T((x0 + x1) / 2, (y0 + y1) / 2 + 0.8, 'FIX', 2.2, 'middle', 400, '#456');
      } else {
        s += R(x0, y0, w, h, '#f7f3ec', 0.3, hit);
        if (SLIDES.includes(it.type) || it.type === 'folding' || it.type === 'folding2') {
          const n = Math.max(2, +it.panels || (it.type === 'sliding' || it.type === 'pocket' ? 1 : 2));
          for (let i = 1; i < n; i++) s += L(x0 + (w * i) / n, y0, x0 + (w * i) / n, y1, 0.15);
        } else if (it.type === 'door2' || it.type === 'oyako') {
          const k = it.type === 'oyako' ? 0.66 : 0.5;
          s += L(x0 + w * k, y0, x0 + w * k, y1, 0.15);
        } else {
          s += `<circle cx="${r2(x1 - Math.min(2, w * 0.15))}" cy="${r2(Y((top - bot) * 0.45 + bot))}" r="0.45" fill="#111"/>`;
        }
      }
      s += T((x0 + x1) / 2, y0 - 0.8, (NZ.SEG_TYPES[it.type] || {}).label || '', 1.8, 'middle', 400, '#333');
      s += T((x0 + x1) / 2, y1 - 1, `H${Math.round(top - bot)}${mark}`, 1.7, 'middle', 400, '#555');
      if (bot > 0) s += T((x0 + x1) / 2, y1 + 2.4, `腰高${Math.round(bot)}${mark}`, 1.7, 'middle', 400, '#555');
    }
    // 設備・造作家具
    for (const fx of f.fixtures) {
      const x0 = X(fx.h0), x1 = X(fx.h1), y0 = Y(Math.min(fx.ht, wallH)), y1 = Y(0);
      s += R(x0, y0, x1 - x0, y1 - y0, 'rgba(242,166,90,.18)', 0.3, `data-fixture="${esc(fx.id)}"`);
      s += T((x0 + x1) / 2, (y0 + y1) / 2 + 0.8, fx.label, 2, 'middle', 400, '#7a4a12');
      s += T((x0 + x1) / 2, y0 - 0.8, `H${Math.round(fx.ht)}`, 1.7, 'middle', 400, '#555');
    }
    // 外形線: 天井・床・両端
    s += L(X(0), Y(wallH), X(f.total), Y(wallH), 0.4);
    s += L(X(0) - 2, Y(0), X(f.total) + 2, Y(0), 0.6);
    s += L(X(0), Y(0), X(0), Y(wallH), 0.4);
    s += L(X(f.total), Y(0), X(f.total), Y(wallH), 0.4);
    // 寸法: 分割(建具・壁)と全長、天井高
    const marks = [0, f.total];
    for (const it of f.items) if (it.type !== 'wall') marks.push(it.h0, it.h1);
    for (const [a, b] of f.gaps) marks.push(a, b);
    const ms = [...new Set(marks.map((v) => Math.round(v)))].sort((a, b) => a - b);
    if (ms.length > 2) for (let i = 0; i < ms.length - 1; i++) s += hDim(X(ms[i]), X(ms[i + 1]), oy + 5, NZ.fmtLen(ms[i + 1] - ms[i]));
    s += hDim(X(0), X(f.total), oy + (ms.length > 2 ? 10 : 5), NZ.fmtLen(f.total));
    s += vDim(X(0) - 5, Y(wallH), Y(0), `CH ${NZ.fmtLen(wallH)}`);
    return s;
  }

  // 用紙1枚に A〜D面を 2×2 で並べる
  NZ.renderElevationSheet = function (p, room) {
    const m = p.meta;
    const [W, H] = NZ.PAPERS[m.paper] || NZ.PAPERS.A3;
    const M = 10, TB = 40;
    const ef = NZ.elevFaces(p, room);
    const ok = ef.faces.filter((f) => !f.missing);
    const cellW = (W - 2 * M) / 2, cellH = (H - 2 * M - TB) / 2;
    // 余白: 左に天井高の寸法(12mm)、下に寸法2段(16mm)、上に面の名前(9mm)
    const maxLen = ok.length ? Math.max(...ok.map((f) => f.total)) : 1000;
    let S = NZ.SCALES[NZ.SCALES.length - 1];
    for (const sc of NZ.SCALES) {
      if (maxLen / sc <= cellW - 20 && ef.CH / sc <= cellH - 28) { S = sc; break; }
    }
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/>`;
    ef.faces.forEach((f, i) => {
      const cx = M + (i % 2) * cellW, cy = M + Math.floor(i / 2) * cellH;
      if (i % 2) s += L(cx, cy, cx, cy + cellH, 0.15, 'stroke-dasharray="1 1" stroke-opacity=".4"');
      if (i >= 2 && i % 2 === 0) s += L(M, cy, W - M, cy, 0.15, 'stroke-dasharray="1 1" stroke-opacity=".4"');
      s += T(cx + 4, cy + 6, `${f.key}面(${f.dir})`, 3.4, 'start', 700);
      if (f.missing) {
        s += T(cx + cellW / 2, cy + cellH / 2, 'この方向の壁が見つかりません', 2.6, 'middle', 400, '#888');
        return;
      }
      const dw = f.total / S, dh = ef.CH / S;
      const ox = cx + 12 + Math.max(0, (cellW - 20 - dw) / 2);
      const oy = cy + 9 + Math.max(0, (cellH - 28 - dh) / 2) + dh;
      s += drawFace(f, ef.CH, S, ox, oy);
    });
    s += NZ.sheetFrame(m, W, H, S, { title: `展開図 ${room.label || room.name}`, north: false });
    // 注記
    const std = ok.some((f) => f.usedStd);
    s += T(M + 4, H - M - TB - 2, `部屋の内側から見た図。${std ? '* は標準値(未入力)。実測した高さ・腰高は壁の編集画面の分割欄で入力できます。' : ''}`, 2, 'start', 400, '#555');
    return { svg: s + '</svg>', S, W, H, faces: ef.faces, CH: ef.CH, bounds: ef.bounds };
  };
})();
