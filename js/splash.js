// 起動アニメーション:白地で、朱の点が部屋の線をなぞり、YUBI CAD のロゴができあがる
// 画面をタップすると飛ばせる。「動きを減らす」設定の端末では、完成したロゴを短く見せるだけにする。
(function () {
  const sp = document.getElementById('splash');
  if (!sp) return;
  const line = sp.querySelector('.sp-line');
  const rest = sp.querySelector('.sp-rest');
  const ring = sp.querySelector('.sp-ring');
  const dot = sp.querySelector('.sp-dot');
  const words = sp.querySelector('.sp-words');
  const L = line.getTotalLength();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const T_DRAW = 1150;   // 点が線をなぞる時間
  const T_RING = 420;    // 指先の輪が広がる時間
  const T_WORD = 520;    // 文字が出る時間
  const T_HOLD = 650;    // できあがりを見せる時間
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const out = (t) => 1 - Math.pow(1 - t, 3);
  const clamp = (t) => Math.max(0, Math.min(1, t));

  line.style.strokeDasharray = `${L} ${L}`;
  line.style.strokeDashoffset = String(L);

  let done = false;
  function finish() {
    if (done) return;
    done = true;
    sp.classList.add('sp-out');
    setTimeout(() => sp.remove(), 450);
  }
  sp.addEventListener('pointerdown', finish);

  function frame(ms) {
    // 線と点
    const k = ease(clamp(ms / T_DRAW));
    const p = line.getPointAtLength(L * k);
    line.style.strokeDashoffset = String(L * (1 - k));
    dot.setAttribute('cx', p.x.toFixed(2));
    dot.setAttribute('cy', p.y.toFixed(2));
    // 止まったところで指先の輪が広がり、これから描く点線が出る
    const r = out(clamp((ms - T_DRAW + 80) / T_RING));
    ring.setAttribute('r', (8.5 + 7.5 * r).toFixed(2));
    ring.setAttribute('opacity', (0.5 * r).toFixed(3));
    rest.setAttribute('opacity', (0.75 * r).toFixed(3));
    // 文字
    const w = out(clamp((ms - T_DRAW - 120) / T_WORD));
    words.style.opacity = w.toFixed(3);
    words.style.transform = `translateX(${(-14 * (1 - w)).toFixed(2)}px)`;
  }

  if (reduce) {
    frame(T_DRAW + T_RING + T_WORD + 200);
    setTimeout(finish, 900);
    return;
  }
  frame(0);
  let t0 = null;
  function tick(now) {
    if (done) return;
    if (t0 === null) t0 = now;
    const ms = now - t0;
    frame(ms);
    if (ms < T_DRAW + T_RING + T_WORD + T_HOLD) requestAnimationFrame(tick);
    else finish();
  }
  // 最初の描画が済んでから動かす(読み込み中のカクつきを避ける)
  requestAnimationFrame(() => requestAnimationFrame(tick));
  // 万一止まっても4秒で閉じる
  setTimeout(finish, 4000);
})();
