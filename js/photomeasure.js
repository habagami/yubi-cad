// 壁の写真で建具を測る
// 1) 壁を正面寄りから撮った写真で、壁の四隅(床の左右・天井の左右)をタップで合わせ、実測した壁の幅・高さを入れる
// 2) 写真の歪み(遠近)を補正した「正面から見た壁」の画像を作る(射影変換)
// 3) 補正した画像の上で建具を四角く囲むと、左端からの位置・幅・腰高・高さ(mm)が出る
// 4) 壁の分割欄に反映(展開図にも反映される)
// AIは使わない。基準は実測した壁の幅・高さ。壁が平らで四隅が写っていることが前提。
(function () {
  const NZ = (window.NZ = window.NZ || {});
  const esc = NZ.esc;
  const R5 = (v) => Math.round(v / 5) * 5;

  // ---------- 射影変換 ----------
  // 壁の座標(u: 左から mm, v: 床から mm) → 写真のピクセル(x, y) の変換行列を4組の対応点から求める
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i], [x, y] = dst[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    const h = solve(A, b);
    if (!h) return null;
    return (u, v) => {
      const w = h[6] * u + h[7] * v + 1;
      return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
    };
  }
  NZ.pmHomography = homography; // 確認用

  // 補正画像を作る(k = 1mm あたりのピクセル)
  function rectify(srcData, sw, sh, H, W, Hh, k) {
    const cw = Math.max(1, Math.round(W * k)), ch = Math.max(1, Math.round(Hh * k));
    const out = new ImageData(cw, ch), d = out.data, s = srcData.data;
    for (let j = 0; j < ch; j++) {
      const v = Hh - (j + 0.5) / k;
      for (let i = 0; i < cw; i++) {
        const [x, y] = H((i + 0.5) / k, v);
        const o = (j * cw + i) * 4;
        if (!(x >= 0 && y >= 0 && x < sw - 1 && y < sh - 1)) { d[o] = d[o + 1] = d[o + 2] = 235; d[o + 3] = 255; continue; }
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
        for (let c = 0; c < 3; c++) {
          d[o + c] = (s[p00 + c] * (1 - fx) + s[p10 + c] * fx) * (1 - fy) + (s[p01 + c] * (1 - fx) + s[p11 + c] * fx) * fy;
        }
        d[o + 3] = 255;
      }
    }
    return out;
  }

  // ---------- 画面 ----------
  NZ.photoMeasure = function (wall) {
    const A = NZ.app;
    const OPEN_TYPES = Object.entries(NZ.SEG_TYPES).filter(([k]) => k !== 'wall');
    // 内法(壁の面から面)の長さ。写真の四隅は壁の面の角なので、内法を基準にする
    const innerLen = () => Math.round(wall.innerMode && wall.inner ? wall.inner : NZ.wallFrame(wall).L - (wall.ext0 || 0) - (wall.ext1 || 0));
    const st = {
      stage: 'pick', img: null, srcData: null,
      corners: null, // 写真上の [左下, 右下, 右上, 左上]
      W: innerLen(), Hh: Math.round(+wall.height || NZ.DEFAULT_WALL_HEIGHT), leftIsStart: true,
      H: null, k: 1, rects: [], sel: -1, drag: null,
    };
    const wrap = document.createElement('div');
    wrap.className = 'preview-wrap pm';
    document.body.appendChild(wrap);
    const close = () => wrap.remove();

    function render() {
      if (st.stage === 'pick') {
        wrap.innerHTML = `<div class="preview-bar"><span class="title">壁の写真で建具を測る</span><button data-pm="cancel">キャンセル</button></div>
          <div class="pm-body"><div class="pm-intro">
            <p><b>撮り方</b>: 壁の正面寄りから、<b>壁の四隅(床の左右・天井の左右)がすべて写る</b>ように撮ります。広角で端が曲がる場合は少し離れて撮ってください。</p>
            <p>次に、写真の上で四隅を合わせ、<b>実測した壁の幅と高さ</b>を入れます。その寸法を基準に、写真の歪みを補正して建具の位置・大きさを計算します。</p>
            <label class="photo-pick"><input type="file" accept="image/*" hidden data-pm-file>📷 壁を撮影する / 写真を選ぶ</label>
            <p class="note">対象の壁: ${esc((NZ.WALL_KINDS[wall.kind] || {}).label || '壁')} ${innerLen()}mm、壁高 ${st.Hh}mm。写真はこの画面の中だけで使い、保存しません。</p>
          </div></div>`;
        wrap.querySelector('[data-pm-file]').addEventListener('change', onFile);
        return;
      }
      if (st.stage === 'corners') {
        wrap.innerHTML = `<div class="preview-bar"><span class="title">① 四隅を合わせる</span>
          <label>壁の幅(mm)<input data-pm-k="W" inputmode="decimal" value="${st.W}"></label>
          <label>壁の高さ(mm)<input data-pm-k="Hh" inputmode="decimal" value="${st.Hh}"></label>
          <label>写真の左端は<select data-pm-k="left"><option value="start" ${st.leftIsStart ? 'selected' : ''}>壁の始点側</option><option value="end" ${st.leftIsStart ? '' : 'selected'}>壁の終点側</option></select></label>
          <button data-pm="repick">写真を選び直す</button><button data-pm="cancel">キャンセル</button><button data-pm="next" class="primary">次へ(歪みを補正)</button></div>
          <div class="pm-hint">○ を、壁の <b>床の左端・床の右端・天井の右端・天井の左端</b> にドラッグして合わせてください。壁の幅・高さは実測値(内法)を入れます。</div>
          <div class="pm-body"><canvas class="pm-cv"></canvas></div>`;
      } else {
        wrap.innerHTML = `<div class="preview-bar"><span class="title">② 建具を囲む</span>
          <span class="pm-info">壁 ${st.W}×${st.Hh}mm</span>
          <button data-pm="back">戻る</button><button data-pm="cancel">キャンセル</button><button data-pm="apply" class="primary">壁に反映</button></div>
          <div class="pm-hint">補正した壁の上で、ドア・窓などを <b>対角にドラッグして四角く囲む</b> と追加されます。数値は下の一覧で直せます(左端からの位置・幅・床からの腰高・高さ)。</div>
          <div class="pm-body pm-split"><canvas class="pm-cv"></canvas><div class="pm-list"></div></div>`;
        renderList();
      }
      bindCanvas();
      draw();
    }

    function onFile(ev) {
      const f = ev.target.files[0];
      if (!f) return;
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        const kk = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * kk); c.height = Math.round(img.naturalHeight * kk);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        st.img = c;
        st.srcData = g.getImageData(0, 0, c.width, c.height);
        const w = c.width, h = c.height;
        st.corners = [[w * 0.15, h * 0.85], [w * 0.85, h * 0.85], [w * 0.85, h * 0.15], [w * 0.15, h * 0.15]];
        st.stage = 'corners';
        render();
      };
      img.onerror = () => { URL.revokeObjectURL(url); A.toast('画像を読み込めませんでした'); };
      img.src = url;
    }

    // 画面上の点 → キャンバスのピクセル
    const cv = () => wrap.querySelector('.pm-cv');
    function toCanvas(e) {
      const c = cv(), r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
    }
    const pxScale = () => { const c = cv(); return c.width / c.getBoundingClientRect().width; };

    function bindCanvas() {
      const c = cv();
      if (!c) return;
      if (st.stage === 'corners') { c.width = st.img.width; c.height = st.img.height; }
      else { c.width = st.rect.width; c.height = st.rect.height; }
      c.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const p = toCanvas(e), tol = 26 * pxScale();
        if (st.stage === 'corners') {
          let best = -1, bd = tol;
          st.corners.forEach((q, i) => { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = i; } });
          if (best >= 0) { st.drag = { kind: 'corner', i: best }; try { c.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど */ } }
        } else {
          const m = toMm(p);
          const hit = st.rects.findIndex((r) => m[0] >= r.x && m[0] <= r.x + r.w && m[1] >= r.bot && m[1] <= r.bot + r.ht);
          if (hit >= 0) { st.sel = hit; renderList(); draw(); return; }
          st.drag = { kind: 'new', a: m, b: m };
          try { c.setPointerCapture(e.pointerId); } catch (err) { /* 合成イベントなど */ }
        }
      });
      c.addEventListener('pointermove', (e) => {
        if (!st.drag) return;
        const p = toCanvas(e);
        if (st.drag.kind === 'corner') { st.corners[st.drag.i] = [Math.max(0, Math.min(c.width, p[0])), Math.max(0, Math.min(c.height, p[1]))]; }
        else st.drag.b = toMm(p);
        draw();
      });
      const up = () => {
        const d = st.drag;
        st.drag = null;
        if (d && d.kind === 'new') {
          const x0 = Math.max(0, Math.min(d.a[0], d.b[0])), x1 = Math.min(st.W, Math.max(d.a[0], d.b[0]));
          const v0 = Math.max(0, Math.min(d.a[1], d.b[1])), v1 = Math.min(st.Hh, Math.max(d.a[1], d.b[1]));
          if (x1 - x0 >= 100 && v1 - v0 >= 100) {
            const bot = v0 < 150 ? 0 : R5(v0);
            st.rects.push({ type: bot === 0 ? 'door' : 'window', x: R5(x0), w: R5(x1) - R5(x0), bot, ht: R5(v1) - bot });
            st.sel = st.rects.length - 1;
            renderList();
          }
        }
        draw();
      };
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    }

    // 補正画像のピクセル → 壁の mm(左から, 床から)
    const toMm = (p) => [Math.max(0, Math.min(st.W, p[0] / st.k)), Math.max(0, Math.min(st.Hh, st.Hh - p[1] / st.k))];
    const toPx = (u, v) => [u * st.k, (st.Hh - v) * st.k];

    function draw() {
      const c = cv();
      if (!c) return;
      const g = c.getContext('2d'), s = pxScale();
      if (st.stage === 'corners') {
        g.drawImage(st.img, 0, 0);
        g.lineWidth = 2.5 * s; g.strokeStyle = '#ff6a00'; g.fillStyle = 'rgba(255,106,0,.12)';
        g.beginPath(); st.corners.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill(); g.stroke();
        const names = ['床・左', '床・右', '天井・右', '天井・左'];
        st.corners.forEach((q, i) => {
          g.beginPath(); g.arc(q[0], q[1], 13 * s, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill(); g.lineWidth = 3 * s; g.strokeStyle = '#ff6a00'; g.stroke();
          g.beginPath(); g.arc(q[0], q[1], 2.5 * s, 0, Math.PI * 2); g.fillStyle = '#ff6a00'; g.fill();
          g.font = `700 ${14 * s}px sans-serif`; g.textAlign = 'center'; g.lineWidth = 4 * s; g.strokeStyle = '#fff';
          const ty = q[1] + (i < 2 ? 30 : -20) * s;
          g.strokeText(names[i], q[0], ty); g.fillStyle = '#c24d00'; g.fillText(names[i], q[0], ty);
        });
        return;
      }
      g.putImageData(st.rect, 0, 0);
      const rect = (r, i) => {
        const [x0, y0] = toPx(r.x, r.bot + r.ht), [x1, y1] = toPx(r.x + r.w, r.bot);
        g.lineWidth = (i === st.sel ? 3.5 : 2.5) * s; g.strokeStyle = i === st.sel ? '#1e6fd9' : '#ff6a00';
        g.fillStyle = i === st.sel ? 'rgba(30,111,217,.15)' : 'rgba(255,106,0,.12)';
        g.fillRect(x0, y0, x1 - x0, y1 - y0); g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        g.font = `700 ${15 * s}px sans-serif`; g.textAlign = 'center'; g.lineWidth = 4 * s; g.strokeStyle = '#fff';
        const t = `${i + 1}`; g.strokeText(t, (x0 + x1) / 2, (y0 + y1) / 2); g.fillStyle = '#111'; g.fillText(t, (x0 + x1) / 2, (y0 + y1) / 2);
      };
      st.rects.forEach(rect);
      if (st.drag && st.drag.kind === 'new') {
        const a = st.drag.a, b = st.drag.b;
        rect({ x: Math.min(a[0], b[0]), w: Math.abs(b[0] - a[0]), bot: Math.min(a[1], b[1]), ht: Math.abs(b[1] - a[1]) }, -2);
      }
    }

    function renderList() {
      const box = wrap.querySelector('.pm-list');
      if (!box) return;
      if (!st.rects.length) { box.innerHTML = '<p class="note">まだ建具がありません。左の画像の上で、ドアや窓を対角にドラッグして囲んでください。</p>'; return; }
      box.innerHTML = st.rects.map((r, i) => {
        const v0 = NZ.elevOpeningDefault(r.type) || {};
        return `<div class="pm-item ${i === st.sel ? 'on' : ''}" data-i="${i}">
          <div class="pm-row"><b>${i + 1}</b><select data-f="type">${OPEN_TYPES.map(([k, v]) => `<option value="${k}" ${k === r.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select><button data-del="${i}" class="pm-del" aria-label="削除">×</button></div>
          <div class="pm-row"><label>左端から<input data-f="x" inputmode="decimal" value="${r.x}"></label><label>幅<input data-f="w" inputmode="decimal" value="${r.w}"></label></div>
          <div class="pm-row">${v0.canBot ? `<label>腰高<input data-f="bot" inputmode="decimal" value="${r.bot}"></label>` : '<label class="pm-muted">腰高 0(床から)</label>'}<label>高さ<input data-f="ht" inputmode="decimal" value="${r.ht}"></label></div></div>`;
      }).join('') + `<p class="note">写真から読み取った値は目安です(数cm程度の誤差が出ることがあります)。実測できる箇所は実測値に直してください。</p>`;
    }

    function next() {
      const W = A.num(String(st.W)), Hh = A.num(String(st.Hh));
      if (!(W > 100) || !(Hh > 100)) { A.toast('壁の幅と高さ(mm)を入れてください'); return; }
      const H = homography([[0, 0], [W, 0], [W, Hh], [0, Hh]], st.corners);
      if (!H) { A.toast('四隅の位置を確認してください(3点が一直線に並んでいます)'); return; }
      st.W = Math.round(W); st.Hh = Math.round(Hh); st.H = H;
      st.k = Math.min(1400 / W, 1000 / Hh);
      st.rect = rectify(st.srcData, st.img.width, st.img.height, H, W, Hh, st.k);
      st.stage = 'rects';
      render();
    }

    function apply() {
      if (!st.rects.length) { A.toast('建具がありません。画像の上で囲んでください'); return; }
      const L = innerLen(), wallH = st.Hh;
      // 写真の左端が壁の終点側なら、左右を入れ替える
      const list = st.rects.map((r) => {
        const v0 = NZ.elevOpeningDefault(r.type) || {};
        const x = st.leftIsStart ? r.x : st.W - r.x - r.w;
        return { type: r.type, x: Math.round(x), w: Math.round(r.w), bot: v0.canBot ? Math.round(r.bot) : 0, ht: Math.round(r.ht), canBot: v0.canBot };
      }).sort((a, b) => a.x - b.x);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (!(o.w > 0 && o.ht > 0) || o.x < 0) { A.toast(`${i + 1}番目の建具の数値を確認してください`); return; }
        if (i && o.x < list[i - 1].x + list[i - 1].w - 1) { A.toast('建具どうしが重なっています。位置・幅を確認してください'); return; }
        if (o.bot + o.ht > wallH) { A.toast(`${NZ.SEG_TYPES[o.type].label}の上端(${o.bot + o.ht}mm)が壁の高さ ${wallH}mm を超えています`); return; }
      }
      const end = list[list.length - 1].x + list[list.length - 1].w;
      if (end > L + 1) { A.toast(`建具の右端(${end}mm)が壁の長さ ${L}mm を超えています。壁の幅の入力や「写真の左端」を確認してください`); return; }
      const hasSegs = (wall.segments || []).some((g) => g.type !== 'wall');
      if (hasSegs && !confirm('この壁の今の分割(ドア・窓など)を、写真から測った内容に置き換えます。よろしいですか?')) return;
      const segs = [];
      // 壁芯入力の壁は分割を壁芯の始点から数えるので、始点側の壁の厚み分をずらす
      let cur = wall.innerMode ? 0 : -(wall.ext0 || 0);
      for (const o of list) {
        if (o.x - cur > 0.5) segs.push({ type: 'wall', len: o.x - cur });
        const def = NZ.SEG_TYPES[o.type];
        const g = { type: o.type, len: o.w, ht: o.ht, hinge: 'start', side: 'right' };
        if (o.canBot) g.bot = o.bot;
        if (def.panels) g.panels = def.panels[0];
        segs.push(g);
        cur = o.x + o.w;
      }
      wall.segments = segs;
      const changedH = Math.abs((+wall.height || NZ.DEFAULT_WALL_HEIGHT) - wallH) > 0.5;
      wall.height = wallH;
      if (Math.abs(st.W - L) > 50) A.toast(`入力した壁の幅(${st.W}mm)と図面の壁の長さ(${L}mm)が50mm以上違います。位置は左端からの実寸で反映しました`, 6000);
      A.commit();
      close();
      A.toast(`建具 ${list.length} か所を壁に反映しました${changedH ? `(壁高を ${wallH}mm に更新)` : ''}。壁の編集画面で確認してください`, 5000);
      A.editEl(wall.id);
    }

    wrap.addEventListener('click', (ev) => {
      const a = ev.target.dataset.pm;
      if (a === 'cancel') close();
      if (a === 'repick') { st.stage = 'pick'; render(); }
      if (a === 'next') next();
      if (a === 'back') { st.stage = 'corners'; render(); }
      if (a === 'apply') apply();
      const del = ev.target.dataset.del;
      if (del !== undefined) { st.rects.splice(+del, 1); st.sel = -1; renderList(); draw(); return; }
      const item = ev.target.closest('.pm-item');
      if (item && !ev.target.closest('input,select')) { st.sel = +item.dataset.i; renderList(); draw(); }
    });
    wrap.addEventListener('input', (ev) => {
      const k = ev.target.dataset.pmK;
      if (k === 'W') st.W = ev.target.value;
      if (k === 'Hh') st.Hh = ev.target.value;
      if (k === 'left') st.leftIsStart = ev.target.value === 'start';
      const f = ev.target.dataset.f, item = ev.target.closest('.pm-item');
      if (f && item) {
        const r = st.rects[+item.dataset.i];
        if (f === 'type') {
          r.type = ev.target.value;
          if (!(NZ.elevOpeningDefault(r.type) || {}).canBot && r.bot > 0) { r.ht += r.bot; r.bot = 0; }
          renderList();
        } else {
          const v = A.num(ev.target.value);
          if (v >= 0) r[f] = v;
        }
        draw();
      }
    });
    wrap.addEventListener('change', (ev) => { if (ev.target.dataset.pmK === 'left') st.leftIsStart = ev.target.value === 'start'; });
    render();
  };
})();
