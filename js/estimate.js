// 仕上表と概算見積
// 数量は図面から自動計算(室名を置いた部屋の四角い範囲として計算)。配管・解体・養生・諸経費は自動計算しない(行を追加して入力)。
// 単価(材料・工賃)は空欄から。入力した単価は端末の「単価表」に記憶し、次の図面でも使う。
(function () {
  const NZ = (window.NZ = window.NZ || {});
  const esc = NZ.esc;
  const PRICES_KEY = 'naiso-zumen.prices';
  const r2 = (n) => Math.round(n * 100) / 100;
  const r1 = (n) => Math.round(n * 10) / 10;
  const yen = (n) => Math.round(n).toLocaleString('ja-JP');
  const m2 = (mm2) => r2(mm2 / 1e6);
  const m = (mm) => r1(mm / 1000);

  // ---------- 数量 ----------
  function clipArea(f, b) {
    const x0 = Math.max(f.x, b.x0), x1 = Math.min(f.x + f.w, b.x1), y0 = Math.max(f.y, b.y0), y1 = Math.min(f.y + f.h, b.y1);
    return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
  }
  NZ.estQuantities = function (p) {
    const rooms = [];
    const floorsByType = {};
    const usedFloor = new Set();
    for (const room of NZ.elevRooms(p)) {
      const ef = NZ.elevFaces(p, room), b = ef.bounds;
      const complete = [b.x0, b.x1, b.y0, b.y1].every((v) => v !== null) && b.x1 > b.x0 && b.y1 > b.y0;
      const missing = ef.faces.filter((f) => f.missing).map((f) => f.key + '面');
      const floorArea = complete ? (b.x1 - b.x0) * (b.y1 - b.y0) : 0;
      let wallArea = 0, perimeter = 0, doorW = 0;
      // 四方の壁が見つからないもの(建物の外の注記・部屋の外の文字など)は数量に入れない
      if (complete) for (const f of ef.faces) {
        if (f.missing) continue;
        perimeter += f.total;
        for (const it of f.items) {
          const w = it.h1 - it.h0;
          if (it.type === 'wall') { wallArea += w * it.H; continue; }
          const ov = NZ.elevOpeningV(it);
          const top = Math.min(ov.top, it.H), bot = Math.max(0, Math.min(ov.bot, top));
          wallArea += w * (it.H - (top - bot));
          if (bot === 0) doorW += w;
        }
      }
      const floors = {};
      if (complete) for (const fl of p.floors || []) {
        const a = clipArea(fl, b);
        if (a <= 0) continue;
        floors[fl.type] = (floors[fl.type] || 0) + a;
        floorsByType[fl.type] = (floorsByType[fl.type] || 0) + a;
        usedFloor.add(fl.id);
      }
      rooms.push({ id: room.id, name: room.label || room.name, complete, missing, floorArea, ceilArea: floorArea, wallArea, perimeter, baseboard: Math.max(0, perimeter - doorW), crown: perimeter, CH: ef.CH, floors });
    }
    // 部屋に入っていない床の範囲は、囲んだ範囲そのままの面積(壁芯までの範囲のため、やや大きめ)
    let floorOutside = 0;
    for (const fl of p.floors || []) {
      if (usedFloor.has(fl.id)) continue;
      floorsByType[fl.type] = (floorsByType[fl.type] || 0) + fl.w * fl.h;
      floorOutside += fl.w * fl.h;
    }
    // 建具・設備の個数
    const segs = {}, fixtures = {};
    for (const w of p.walls || []) {
      if (w.detected) continue;
      for (const g of w.segments || []) if (g.type && g.type !== 'wall' && +g.len > 0) segs[g.type] = (segs[g.type] || 0) + 1;
    }
    for (const f of p.fixtures || []) {
      if (f.detected || NZ.fixtureCat(f.type) === 'loose') continue;
      fixtures[f.type] = (fixtures[f.type] || 0) + 1;
    }
    return { rooms, floorsByType, floorOutside, segs, fixtures };
  };

  // 図面から作る行(数量は自動)
  function autoRows(q) {
    const rows = [];
    for (const [t, a] of Object.entries(q.floorsByType)) rows.push({ key: 'floor:' + t, cat: '床', name: (NZ.FLOOR_TYPES[t] || {}).label || t, unit: 'm²', qty: m2(a) });
    const sum = (k) => q.rooms.reduce((s, r) => s + r[k], 0);
    if (sum('wallArea') > 0) rows.push({ key: 'wall', cat: '壁', name: '壁仕上げ(クロス等)', unit: 'm²', qty: m2(sum('wallArea')) });
    if (sum('ceilArea') > 0) rows.push({ key: 'ceil', cat: '天井', name: '天井仕上げ(クロス等)', unit: 'm²', qty: m2(sum('ceilArea')) });
    if (sum('baseboard') > 0) rows.push({ key: 'baseboard', cat: '造作', name: '巾木', unit: 'm', qty: m(sum('baseboard')) });
    if (sum('crown') > 0) rows.push({ key: 'crown', cat: '造作', name: '廻り縁', unit: 'm', qty: m(sum('crown')) });
    for (const [t, n] of Object.entries(q.segs)) rows.push({ key: 'seg:' + t, cat: '建具', name: (NZ.SEG_TYPES[t] || {}).label || t, unit: '箇所', qty: n });
    for (const [t, n] of Object.entries(q.fixtures)) rows.push({ key: 'fix:' + t, cat: NZ.fixtureCat(t) === 'built' ? '造作家具' : '設備', name: (NZ.FIXTURE_TYPES[t] || {}).label || t, unit: '台', qty: n });
    return rows;
  }

  // ---------- 単価表(端末に記憶) ----------
  function loadPrices() { try { return JSON.parse(localStorage.getItem(PRICES_KEY) || '{}'); } catch (e) { return {}; } }
  function savePrice(key, rec) {
    try {
      const all = loadPrices(), cur = Object.assign({}, all[key] || {});
      for (const [k, v] of Object.entries(rec)) { if (v === null || v === undefined || v === '') delete cur[k]; else cur[k] = v; }
      cur.at = Date.now();
      all[key] = cur;
      localStorage.setItem(PRICES_KEY, JSON.stringify(all));
    } catch (e) { /* 保存できない環境 */ }
  }
  NZ.estPrices = loadPrices;

  const est = (p) => { if (!p.est) p.est = { items: {}, extra: [], taxRate: 10 }; return p.est; };
  const numOr = (v) => (v === undefined || v === null || v === '' || !isFinite(+v) ? null : +v);

  // 行の値をまとめる(図面の行は items の上書き、なければ単価表)
  function lines(p) {
    const q = NZ.estQuantities(p), E = est(p), prices = loadPrices();
    const out = [];
    for (const a of autoRows(q)) {
      const it = E.items[a.key] || {}, pr = prices[a.key] || {};
      const qtyOv = numOr(it.qty);
      const mat = numOr(it.mat) ?? numOr(pr.mat), labor = numOr(it.labor) ?? numOr(pr.labor);
      out.push({
        auto: true, key: a.key, cat: a.cat, unit: a.unit, autoQty: a.qty,
        name: it.name || pr.name || a.name, defName: a.name, model: it.model ?? pr.model ?? '',
        qty: qtyOv ?? a.qty, qtyOv, mat, labor,
        matFromMaster: numOr(it.mat) === null && numOr(pr.mat) !== null, laborFromMaster: numOr(it.labor) === null && numOr(pr.labor) !== null,
        off: !!it.off,
      });
    }
    for (const x of E.extra) out.push({ auto: false, key: x.id, cat: x.cat || '', unit: x.unit || '式', name: x.name || '', model: x.model || '', qty: numOr(x.qty) ?? 0, mat: numOr(x.mat), labor: numOr(x.labor), off: !!x.off });
    for (const l of out) {
      l.matCost = l.off ? 0 : l.qty * (l.mat || 0);
      l.laborCost = l.off ? 0 : l.qty * (l.labor || 0);
      l.amount = l.matCost + l.laborCost;
    }
    const matSum = out.reduce((s, l) => s + Math.round(l.matCost), 0), laborSum = out.reduce((s, l) => s + Math.round(l.laborCost), 0);
    const sub = matSum + laborSum, rate = numOr(E.taxRate) ?? 10, tax = Math.floor((sub * rate) / 100);
    return { q, lines: out, matSum, laborSum, sub, rate, tax, total: sub + tax, unpriced: out.filter((l) => !l.off && l.mat === null && l.labor === null).length };
  }
  NZ.estLines = lines;

  // ---------- 画面 ----------
  const fmtQ = (v, unit) => (unit === 'm²' ? r2(v).toFixed(2) : unit === 'm' ? r1(v).toFixed(1) : String(r2(v)));
  function finishTable(q, forPrint) {
    if (!q.rooms.length) return `<p class="note">部屋がありません。平面図で「室名」ツールを使い、部屋の中に室名を置くと、部屋ごとの面積が出ます。</p>`;
    const rows = q.rooms.map((r) => {
      const fl = Object.entries(r.floors).map(([t, a]) => `${esc((NZ.FLOOR_TYPES[t] || {}).label || t)} ${m2(a).toFixed(2)}m²`).join('<br>') || '<span class="est-muted">未設定</span>';
      const warn = !r.complete ? '四方の壁が見つからないため数量に入れていません' : r.missing.length ? `${r.missing.join('・')}の壁なし` : '';
      return `<tr><td>${esc(r.name)}</td><td>${fl}</td><td class="n">${m2(r.floorArea).toFixed(2)}</td><td class="n">${m2(r.wallArea).toFixed(2)}</td><td class="n">${m2(r.ceilArea).toFixed(2)}</td><td class="n">${Math.round(r.CH)}</td><td class="n">${m(r.baseboard).toFixed(1)}</td><td class="n">${m(r.crown).toFixed(1)}</td>${forPrint ? '' : `<td class="est-warn">${esc(warn)}</td>`}</tr>`;
    }).join('');
    return `<table class="est-tbl"><thead><tr><th>室名</th><th>床仕上げ</th><th>床面積<br>m²</th><th>壁面積<br>m²</th><th>天井面積<br>m²</th><th>天井高<br>mm</th><th>巾木<br>m</th><th>廻り縁<br>m</th>${forPrint ? '' : '<th>注意</th>'}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  NZ.renderEstimate = function () {
    const A = NZ.app, p = A.st.project, box = document.querySelector('#est-body');
    if (!box) return;
    const r = lines(p);
    const aiOn = !(NZ.EDITION && NZ.EDITION.aiEnabled === false);
    const inp = (f, v, cls = '', ph = '') => `<input data-f="${f}" class="${cls}" value="${v === null || v === undefined ? '' : esc(v)}" placeholder="${esc(ph)}" ${['qty', 'mat', 'labor'].includes(f) ? 'inputmode="decimal"' : ''}>`;
    const rowHTML = (l) => `<tr data-key="${esc(l.key)}" data-auto="${l.auto ? 1 : 0}" class="${l.off ? 'off' : ''}">
      <td>${l.auto ? esc(l.cat) : inp('cat', l.cat, 'w-cat', '区分')}</td>
      <td>${inp('name', l.name, 'w-name', l.defName || '項目')}</td>
      <td class="nowrap">${inp('model', l.model, 'w-model', '品番')}${aiOn ? `<button data-a="search" title="品番から価格をネット検索">🔍</button>` : ''}</td>
      <td>${l.auto ? inp('qty', l.qtyOv, 'w-num', fmtQ(l.autoQty, l.unit)) : inp('qty', l.qty, 'w-num')}</td>
      <td>${l.auto ? esc(l.unit) : inp('unit', l.unit, 'w-unit')}</td>
      <td>${inp('mat', l.mat, 'w-num' + (l.matFromMaster ? ' master' : ''))}</td>
      <td>${inp('labor', l.labor, 'w-num' + (l.laborFromMaster ? ' master' : ''))}</td>
      <td class="n" data-c="mat">${yen(l.matCost)}</td><td class="n" data-c="labor">${yen(l.laborCost)}</td><td class="n" data-c="amt"><b>${yen(l.amount)}</b></td>
      <td class="nowrap">${l.auto ? `<label class="est-off" title="見積に含めない"><input type="checkbox" data-f="off" ${l.off ? 'checked' : ''}>除外</label>` : `<button data-a="del" class="danger" title="行を削除">×</button>`}</td></tr>`;
    box.innerHTML = `
      <section><h3>仕上表(部屋ごと)</h3>${finishTable(r.q, false)}
        <p class="note">面積は、室名の位置から見つけた四方の壁の内法で計算します(四角い部屋として計算。L字の部屋は大きめ・小さめになります)。壁面積は建具の開口(高さ・腰高)を引いた面積です。${r.q.floorOutside > 0 ? ' 部屋に入っていない床の範囲は、囲んだ範囲そのままの面積で数えています。' : ''}</p></section>
      <section><h3>概算見積</h3>
        <div class="est-scroll"><table class="est-tbl est-lines"><thead><tr><th>区分</th><th>項目・材料</th><th>品番</th><th>数量</th><th>単位</th><th>材料単価<br>円</th><th>工賃単価<br>円</th><th>材料費</th><th>工賃</th><th>金額</th><th></th></tr></thead>
        <tbody>${r.lines.map(rowHTML).join('') || '<tr><td colspan="11" class="note">図面に床・壁・建具・設備がありません。「＋行を追加」で手入力もできます。</td></tr>'}</tbody></table></div>
        <div class="est-foot"><button data-a="add">＋行を追加</button><span class="note">数量欄の薄い数字は図面からの自動計算です。数字を入れると上書きします(空欄に戻すと自動に戻る)。単価はこの端末の単価表に記憶され、次の図面でも使われます(薄い字)。</span></div>
        <table class="est-sum"><tr><th>材料費 計</th><td data-s="mat">${yen(r.matSum)}</td></tr><tr><th>工賃 計</th><td data-s="labor">${yen(r.laborSum)}</td></tr><tr><th>小計</th><td data-s="sub">${yen(r.sub)}</td></tr>
          <tr><th>消費税 <input data-f="taxRate" class="w-tax" inputmode="decimal" value="${r.rate}">%</th><td data-s="tax">${yen(r.tax)}</td></tr><tr class="tot"><th>合計(税込)</th><td data-s="total">${yen(r.total)}</td></tr></table>
        <p class="note">概算です。配管・解体・養生・運搬・諸経費は自動計算に含みません。必要なら「＋行を追加」で入れてください。${r.unpriced ? ` <b>単価が未入力の行が ${r.unpriced} 行あります。</b>` : ''}</p></section>`;
  };

  // 合計だけ更新(入力中にフォーカスを失わないよう、表全体は描き直さない)
  function refreshNumbers() {
    const p = NZ.app.st.project, r = lines(p), box = document.querySelector('#est-body');
    for (const l of r.lines) {
      const tr = box.querySelector(`tr[data-key="${CSS.escape(l.key)}"]`);
      if (!tr) continue;
      tr.querySelector('[data-c=mat]').textContent = yen(l.matCost);
      tr.querySelector('[data-c=labor]').textContent = yen(l.laborCost);
      tr.querySelector('[data-c=amt]').innerHTML = `<b>${yen(l.amount)}</b>`;
      tr.classList.toggle('off', l.off);
    }
    for (const [k, v] of Object.entries({ mat: r.matSum, labor: r.laborSum, sub: r.sub, tax: r.tax, total: r.total })) box.querySelector(`[data-s=${k}]`).textContent = yen(v);
  }

  function setField(tr, f, v) {
    const p = NZ.app.st.project, E = est(p), key = tr.dataset.key, auto = tr.dataset.auto === '1';
    const val = f === 'off' ? v : ['qty', 'mat', 'labor'].includes(f) ? (String(v).trim() === '' ? null : NZ.app.num(String(v))) : v;
    if (['qty', 'mat', 'labor'].includes(f) && val !== null && !(val >= 0)) return false;
    if (auto) {
      const it = (E.items[key] = E.items[key] || {});
      if (val === null || val === '') delete it[f]; else it[f] = val;
      if (['mat', 'labor', 'name', 'model'].includes(f)) savePrice(key, { [f]: val });
    } else {
      const x = E.extra.find((e) => e.id === key);
      if (x) x[f] = val;
    }
    return true;
  }

  function bind() {
    const root = document.querySelector('#est');
    if (!root || root.dataset.bound) return;
    root.dataset.bound = '1';
    root.addEventListener('input', (ev) => {
      const t = ev.target, f = t.dataset.f;
      if (!f) return;
      if (f === 'taxRate') { const v = NZ.app.num(t.value); if (v >= 0) est(NZ.app.st.project).taxRate = v; refreshNumbers(); return; }
      const tr = t.closest('tr[data-key]');
      if (!tr) return;
      t.classList.remove('master');
      t.classList.toggle('bad', !setField(tr, f, f === 'off' ? t.checked : t.value));
      refreshNumbers();
    });
    root.addEventListener('change', () => NZ.app.commitData());
    root.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const p = NZ.app.st.project, E = est(p);
      if (a === 'add') { E.extra.push({ id: NZ.uid(), cat: '', name: '', model: '', qty: 1, unit: '式', mat: null, labor: null }); NZ.app.commitData(); NZ.renderEstimate(); return; }
      const tr = ev.target.closest('tr[data-key]');
      if (a === 'del' && tr) { E.extra = E.extra.filter((x) => x.id !== tr.dataset.key); NZ.app.commitData(); NZ.renderEstimate(); return; }
      if (a === 'print') return printEstimate();
      if (a === 'csv') return exportCSV();
      if (a === 'search' && tr) {
        const model = tr.querySelector('[data-f=model]').value.trim(), name = tr.querySelector('[data-f=name]').value.trim() || tr.querySelector('[data-f=name]').placeholder;
        if (!model) { NZ.app.toast('品番を入力してください'); return; }
        const b = NZ.app.busy('価格をネットで検索しています(30秒〜1分ほど)…');
        try {
          const res = await NZ.aiSearchPrice(model, name);
          b.close();
          if (!(res && res.price > 0)) { NZ.app.toast('価格が見つかりませんでした' + (res && res.note ? ': ' + res.note : ''), 5000); return; }
          setField(tr, 'mat', res.price);
          NZ.app.commitData();
          NZ.renderEstimate();
          NZ.app.toast(`材料単価に ${yen(res.price)}円(${res.price_type || '価格'}${res.unit ? '/' + res.unit : ''})を入れました。${res.source ? '出典: ' + res.source : ''} 必ず確認してください`, 7000);
        } catch (err) { b.close(); NZ.app.toast('検索できませんでした: ' + (err.message || err), 5000); }
      }
    });
  }
  NZ.bindEstimate = bind;

  // ---------- 出力 ----------
  function printEstimate() {
    const p = NZ.app.st.project, r = lines(p), mt = p.meta;
    const body = r.lines.filter((l) => !l.off).map((l) => `<tr><td>${esc(l.cat)}</td><td>${esc(l.name)}</td><td>${esc(l.model)}</td><td class="n">${fmtQ(l.qty, l.unit)}</td><td>${esc(l.unit)}</td><td class="n">${l.mat === null ? '' : yen(l.mat)}</td><td class="n">${l.labor === null ? '' : yen(l.labor)}</td><td class="n">${yen(l.amount)}</td></tr>`).join('');
    document.querySelector('#print-area').innerHTML = `<style>@page{size:210mm 297mm;margin:0}
      .ep{width:210mm;box-sizing:border-box;padding:12mm 12mm;font-family:${NZ.FONT};font-size:9pt;color:#111}
      .ep h1{font-size:16pt;text-align:center;letter-spacing:.3em;margin:0 0 4mm}.ep h2{font-size:11pt;margin:5mm 0 2mm}
      .ep .hd{display:flex;justify-content:space-between;margin-bottom:3mm}.ep .tot{font-size:13pt;border-bottom:0.5mm solid #111;padding:1mm 0;margin:2mm 0 3mm;display:inline-block}
      .ep table{border-collapse:collapse;width:100%}.ep th,.ep td{border:0.25mm solid #333;padding:1.2mm 1.6mm;vertical-align:top}.ep th{background:#eee;font-weight:400}.ep .n{text-align:right;white-space:nowrap}
      .ep .sum{width:70mm;margin-left:auto;margin-top:3mm}.ep .note{font-size:8pt;color:#444;margin-top:3mm}.est-muted{color:#888}.est-tbl{width:100%}</style>
      <div class="ep"><h1>概算見積書</h1>
      <div class="hd"><div>物件名: ${esc(mt.name || '')}<br>図面: ${esc(mt.title || '')} ${esc(mt.drawingNo || '')}</div><div style="text-align:right">${esc((mt.date || '').replace(/-/g, '.'))}<br>${esc(mt.company || '')}<br>${esc(mt.companySub || '')}</div></div>
      <div class="tot">概算金額(税込) ${yen(r.total)} 円</div>
      <h2>概算見積</h2><table><thead><tr><th>区分</th><th>項目・材料</th><th>品番</th><th>数量</th><th>単位</th><th>材料単価</th><th>工賃単価</th><th>金額</th></tr></thead><tbody>${body}</tbody></table>
      <table class="sum"><tr><th>材料費 計</th><td class="n">${yen(r.matSum)}</td></tr><tr><th>工賃 計</th><td class="n">${yen(r.laborSum)}</td></tr><tr><th>小計</th><td class="n">${yen(r.sub)}</td></tr><tr><th>消費税(${r.rate}%)</th><td class="n">${yen(r.tax)}</td></tr><tr><th>合計(税込)</th><td class="n"><b>${yen(r.total)}</b></td></tr></table>
      <h2>仕上表</h2>${finishTable(r.q, true)}
      <p class="note">本書は図面から自動計算した概算です。数量は部屋を四角い範囲として計算しています。配管・解体・養生・運搬・諸経費は、明記したもの以外は含みません。正式な見積は現地確認のうえ作成します。</p></div>`;
    setTimeout(() => window.print(), 200);
  }
  function exportCSV() {
    const p = NZ.app.st.project, r = lines(p);
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['区分', '項目・材料', '品番', '数量', '単位', '材料単価', '工賃単価', '材料費', '工賃', '金額', '除外']];
    for (const l of r.lines) rows.push([l.cat, l.name, l.model, fmtQ(l.qty, l.unit), l.unit, l.mat ?? '', l.labor ?? '', Math.round(l.matCost), Math.round(l.laborCost), Math.round(l.amount), l.off ? '除外' : '']);
    rows.push([], ['', '材料費 計', '', '', '', '', '', r.matSum], ['', '工賃 計', '', '', '', '', '', '', r.laborSum], ['', '小計', '', '', '', '', '', '', '', r.sub], ['', `消費税(${r.rate}%)`, '', '', '', '', '', '', '', r.tax], ['', '合計(税込)', '', '', '', '', '', '', '', r.total]);
    rows.push([], ['室名', '床面積m²', '壁面積m²', '天井面積m²', '天井高mm', '巾木m', '廻り縁m']);
    for (const q of r.q.rooms) rows.push([q.name, m2(q.floorArea), m2(q.wallArea), m2(q.ceilArea), Math.round(q.CH), m(q.baseboard), m(q.crown)]);
    const csv = '﻿' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
    NZ.app.download(new Blob([csv], { type: 'text/csv' }), `${NZ.app.fileBase()}_概算見積.csv`);
  }
})();
