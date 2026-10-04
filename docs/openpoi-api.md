# OpenPOI API を拡張機能で使う

日本全国の施設データ（約337万件）をキーワード・位置で検索できる無料API「[OpenPOI API](https://docs.openpoiapi.com)」を、拡張機能に組み込むための手順です。APIキーは不要で、CORSは全オリジン許可です。

正本は [`claude-business-os`](https://github.com/ShintaroMoriya/claude-business-os) 側にあります。このページは拡張機能に持ち込むときの手順だけを扱います。

| 知りたいこと | 正本 |
| :--- | :--- |
| APIの仕様・実測したハマりどころ・ライセンス義務 | `knowledge/tech/openpoi_api.md` |
| 使い方（MCP・CLI・クライアント）と開発手順 | `skills/openpoi_api/SKILL.md` |
| クライアント本体（依存ゼロ） | `skills/openpoi_api/assets/openpoi.js` |

## 1. クライアントを拡張機能にコピーする

このリポジトリは「拡張機能ごとに依存を共有しない」方針なので、クライアントは各拡張機能にコピーして同梱します。

```bash
# 2つのリポジトリが同じ親ディレクトリにcloneされている前提
cp ../claude-business-os/skills/openpoi_api/assets/openpoi.js <拡張機能名>/src/openpoi.js
```

`openpoi.js` はIIFEで包まれていて、ブラウザでは `globalThis.OpenPOI`、Node（テスト）では `require('./openpoi.js')` で読めます（`gcal-schedule-memo/src/*.js` と同じ形）。正本を更新したら、使っている拡張機能へコピーし直してください。

## 2. manifest.json

```json
{
  "host_permissions": ["https://api.openpoiapi.com/*"],
  "background": { "service_worker": "background.js" }
}
```

## 3. 通信はバックグラウンドに寄せる

コンテンツスクリプトから直接 `fetch` してもCORS上は通りますが、通信はサービスワーカーにまとめます。再試行・キャッシュを1か所で持てて、閲覧中のページの事情に左右されないためです。

```js
// background.js（classic service worker）
importScripts('src/openpoi.js');
const api = OpenPOI.createClient();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'openpoi:search') return false;
  api.search(msg.params)
    .then((res) => sendResponse({ ok: true, res }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // 非同期で sendResponse する
});
```

```js
// コンテンツスクリプト側
const reply = await chrome.runtime.sendMessage({
  type: 'openpoi:search',
  params: { q: 'スーパー', center: { lng: 139.767, lat: 35.681 }, radius: 800, limit: 20 },
});
if (!reply.ok) showError(reply.error); // 失敗も必ず画面に出す（Design System: 即時フィードバック）
```

## 4. 実装時のチェックリスト

- [ ] 座標は `{ lng, lat }` で扱う（APIは**経度が先**。逆だと400）
- [ ] 結果の `lat` / `lng` / `level` は `null` がありうる前提で描画する（クライアントが空文字を `null` に正規化済み）
- [ ] 1回の検索は最大200件でページングがない。範囲内を網羅したいときは `api.searchArea()` を使い、`truncated` を画面に出す
- [ ] パネルのフッターなど見える場所に出典を表示する: `OpenPOI.ATTRIBUTION.html`（`<a href="https://openpoiapi.com/attribution.html">OpenPOI API</a>`）
- [ ] `chrome.storage` に保存するときは `licenses` / `attributions` を配列のまま一緒に保存する
- [ ] カテゴリの約55%は `unknown`、位置ずれ・閉業施設の残存がある。件数や「最寄り」を断定する表示にせず、確度を添える（Design System: 確度表示と捏造禁止）
- [ ] 純粋関数（結果の整形・フィルタ）は `test/run.js` から `require('../src/openpoi.js')` でテストする

## 5. 動作確認の前に手触りを見る

作り始める前に、対象エリアのデータが用途に耐えるかをCLIで確認します（`claude-business-os` 直下で実行）。

```bash
node skills/openpoi_api/assets/cli.js search スーパー --area 川崎市宮前区 --radius 1500
node skills/openpoi_api/assets/cli.js survey --center 139.767,35.681 --radius 500   # カテゴリ別件数つき
```
