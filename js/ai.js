// Claude API 連携: 図面画像の解析 / 品番から寸法をネット検索
// APIキーは端末内(localStorage)に保存し、ブラウザから直接 Anthropic API を呼び出す。
(function () {
  const NZ = (window.NZ = window.NZ || {});
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm';
  let sdkPromise = null;
  const aiOff = () => NZ.EDITION && NZ.EDITION.aiEnabled === false;

  async function client() {
    if (aiOff()) throw new Error('この版ではAI機能は使えません。');
    const key = (NZ.settings && NZ.settings.apiKey) || '';
    if (!key) throw new Error('設定画面で Anthropic APIキーを入力してください。');
    if (!sdkPromise) sdkPromise = import(SDK_URL);
    const mod = await sdkPromise;
    const Anthropic = mod.default || mod.Anthropic;
    return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  const model = () => (NZ.settings && NZ.settings.model) || 'claude-opus-5-5';

  async function create(c, params) {
    const resp = await c.beta.messages.create(
      Object.assign(
        {
          model: model(),
          // 安全分類で断られた場合はサーバー側で別モデルに自動フォールバック
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        },
        params
      )
    );
    if (resp.stop_reason === 'refusal') throw new Error('リクエストが処理されませんでした(refusal)。');
    return resp;
  }

  function textOf(resp) {
    return resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  }
  function parseJSON(text) {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fence ? fence[1] : text;
    const a = body.indexOf('{'), b = body.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('AIの応答からJSONを読み取れませんでした。');
    return JSON.parse(body.slice(a, b + 1));
  }

  // 画像を長辺 maxSide px の JPEG に縮小
  function downscale(img, maxSide = 1568) {
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { data: cv.toDataURL('image/jpeg', 0.9).split(',')[1], w, h, k };
  }

  /**
   * 平面図画像を解析し、構造壁・柱・水回りのおおよその位置を返す(元画像のピクセル座標)
   */
  NZ.aiAnalyzePlan = async function (img) {
    const c = await client();
    const im = downscale(img);
    const prompt = `これは日本の住宅・マンションの平面図(間取り図)の画像です。画像サイズは幅${im.w}px × 高さ${im.h}px です。
内装リフォームの図面作成のため、以下を読み取ってください。座標はすべてこの画像のピクセル座標(左上原点、x右向き、y下向き)で答えてください。

1. structural_walls: 位置を変えられない構造壁(RC壁・戸境壁・外壁・耐力壁など、太く塗られた/ハッチングされた壁)。壁の中心線の始点・終点と厚さ(px)。水平・垂直な壁は座標を揃えてください。
2. partition_walls: 撤去・移動が可能そうな間仕切壁(細い壁)。同じ形式。
3. columns: 柱。中心座標と幅・奥行(px)。
4. rooms: キッチン(kitchen)・トイレ(toilet)・浴室(bath)・洗面脱衣(wash)・玄関(entrance)・収納(storage)・その他の部屋(other)のおおよその範囲(外接矩形)と室名。
5. scale_hint: 図中に寸法の数値(mm)が読み取れる場合、その寸法がかかっている2点のピクセル座標と寸法値。なければ null。

次のJSONだけを出力してください:
{"structural_walls":[{"x1":0,"y1":0,"x2":0,"y2":0,"thickness":0}],
 "partition_walls":[{"x1":0,"y1":0,"x2":0,"y2":0,"thickness":0}],
 "columns":[{"x":0,"y":0,"w":0,"d":0}],
 "rooms":[{"type":"kitchen","name":"キッチン","x":0,"y":0,"w":0,"h":0}],
 "scale_hint":{"x1":0,"y1":0,"x2":0,"y2":0,"mm":0}}`;
    const resp = await create(c, {
      max_tokens: 16000,
      output_config: { effort: 'high' },
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: im.data } }, { type: 'text', text: prompt }] }],
    });
    const j = parseJSON(textOf(resp));
    // 縮小画像座標 → 元画像座標
    const s = 1 / im.k;
    const sc = (o, keys) => { for (const k of keys) if (typeof o[k] === 'number') o[k] *= s; return o; };
    (j.structural_walls || []).forEach((w) => sc(w, ['x1', 'y1', 'x2', 'y2', 'thickness']));
    (j.partition_walls || []).forEach((w) => sc(w, ['x1', 'y1', 'x2', 'y2', 'thickness']));
    (j.columns || []).forEach((o) => sc(o, ['x', 'y', 'w', 'd']));
    (j.rooms || []).forEach((o) => sc(o, ['x', 'y', 'w', 'h']));
    if (j.scale_hint) sc(j.scale_hint, ['x1', 'y1', 'x2', 'y2']);
    return j;
  };

  /**
   * 品番から製品の外形寸法をウェブ検索で調べる
   * @returns {maker,name,w,d,h,source,note}
   */
  /**
   * 品番から材料・部材の価格をウェブ検索で調べる(製品版のみ。ベータ版は呼ばれない)
   * @returns {maker,name,price,price_type,unit,source,note}
   */
  NZ.aiSearchPrice = async function (code, itemName) {
    const c = await client();
    const messages = [{
      role: 'user',
      content: `内装工事の材料・部材の品番「${code}」(項目: ${itemName || '不明'})の価格を、日本国内のメーカー公式サイト(定価・希望小売価格)や建材通販サイトでウェブ検索して調べてください。
見積の材料単価に使うため、税抜の1単位あたりの価格(円)を答えてください。単位(m²・m・枚・巻・本・台・箇所など)も答えてください。定価と実売価格の両方が見つかった場合は定価を price にし、実売価格は note に書いてください。
最後に次のJSONだけを出力してください(不明な値は null):
{"maker":"","name":"","price":0,"price_type":"定価|実売|不明","unit":"","source":"参照URL","note":""}`,
    }];
    let resp;
    for (let i = 0; i < 4; i++) {
      resp = await create(c, {
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages,
      });
      if (resp.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: resp.content });
    }
    return parseJSON(textOf(resp));
  };

  NZ.aiSearchProduct = async function (code, typeLabel) {
    const c = await client();
    const messages = [{
      role: 'user',
      content: `住宅設備の品番「${code}」(種類: ${typeLabel || '不明'})の外形寸法を、メーカー公式サイトやカタログを優先してウェブ検索で調べてください。
平面図に配置するため、幅W(間口)・奥行D・高さH をmmで求めてください。ユニットバスの場合は据付に必要な外形寸法(なければ内寸)を答え、どちらかを note に書いてください。
最後に次のJSONだけを出力してください(不明な値は null):
{"maker":"","name":"","w":0,"d":0,"h":0,"source":"参照URL","note":""}`,
    }];
    let resp;
    for (let i = 0; i < 4; i++) {
      resp = await create(c, {
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages,
      });
      if (resp.stop_reason !== 'pause_turn') break;
      // 長いサーバーツール実行の途中停止 → そのまま続行させる
      messages.push({ role: 'assistant', content: resp.content });
    }
    return parseJSON(textOf(resp));
  };
})();
