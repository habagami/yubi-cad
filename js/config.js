// 配布版の切り替え(ここだけ書き換えれば、ベータ版/製品版を切り替えられる)
//   aiEnabled: false … AI機能(AIで図面を解析・品番の寸法をネット検索・APIキー設定)を画面から消し、呼び出しも止める
//   label       … 画面上部に出す版の表示(空欄なら出さない)
(function () {
  const NZ = (window.NZ = window.NZ || {});
  NZ.EDITION = {
    name: 'beta',
    label: 'β版',
    aiEnabled: false,
  };
})();
