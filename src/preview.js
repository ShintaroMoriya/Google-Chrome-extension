/**
 * src/preview.js — ホバー時の「これから追加される時間帯」の枠プレビュー
 *
 * 目的:
 *   取得モード中にカーソルを動かすと、クリックした場合に追加される時間帯を
 *   枠とラベルでリアルタイムに可視化する。「クリックしたら意図と違う時刻
 *   だった」という不安をなくすため、クリック前に結果を見せる。
 *
 * 設計上の制約:
 *   - パネル本体（panel.js）とは別の軽量なオーバーレイとして実装する。
 *     `pointer-events: none` を必ず指定し、クリックを一切妨げない
 *     （このファイルは横取りロジックを一切持たない）。
 *   - 枠の座標計算はここでは行わない。extract.js の resolveSlotPreview /
 *     extractFromChip が実際にクリック確定時に使うのと同じ計算結果を
 *     受け取って描画するだけにする（表示と結果が食い違うことを防ぐ＝WYSIWYG）。
 *   - requireされた時点では何もDOMを触らない。createPreview() を呼ぶまで
 *     document には触れない（Node環境でのrequire自体は安全）。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const Z_INDEX = 2147483000;

const PREVIEW_CSS = `
  :host { all: initial; }
  .box {
    position: fixed;
    box-sizing: border-box;
    border: 2px solid #1a73e8;
    background: rgba(26,115,232,.16);
    border-radius: 4px;
    display: none;
    pointer-events: none;
  }
  .box.conf-medium { border-color: #f9ab00; background: rgba(249,171,0,.16); }
  .box.conf-low { border-color: #d93025; background: rgba(217,48,37,.14); }
  .label {
    position: fixed;
    display: none;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #202124;
    color: #fff;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,0,0,.3);
  }
`;

/**
 * ビューポート内に収まるようラベルの左位置をクランプする。
 * @param {number} left @param {number} approxWidth
 * @returns {number}
 */
function clampLabelLeft(left, approxWidth) {
  const maxLeft = Math.max(8, window.innerWidth - approxWidth - 8);
  return Math.min(Math.max(8, left), maxLeft);
}

/**
 * プレビューのオーバーレイを作る。DOMへの追加はこの呼び出し時点で行う。
 * パネルとは独立したShadow DOMホストなので、パネルの表示/非表示や
 * ドラッグ位置とは無関係に動く。
 * @returns {object} プレビュー操作用API
 */
function createPreview() {
  const host = document.createElement('div');
  host.id = 'gcal-schedule-memo-preview-host';
  // pointer-events: none をホスト自体にも指定し、万一 Shadow 内の要素設定が
  // 漏れても後続イベントを妨げないようにする（多重の安全策）。
  host.style.cssText = `all: initial; position: fixed; top:0; left:0; z-index: ${Z_INDEX}; pointer-events: none;`;
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PREVIEW_CSS;
  root.appendChild(style);

  const box = document.createElement('div');
  box.className = 'box';
  const label = document.createElement('div');
  label.className = 'label';
  root.appendChild(box);
  root.appendChild(label);
  document.documentElement.appendChild(host);

  let visible = false;

  /**
   * プレビューを隠す。
   */
  function hide() {
    if (!visible) return;
    visible = false;
    box.style.display = 'none';
    label.style.display = 'none';
  }

  /**
   * 指定した矩形に枠を表示し、その付近にラベルを追従表示する。
   * @param {{top:number, left:number, width:number, height:number}} rect
   * @param {string} text 一覧に追加される文言と完全一致させること（呼び出し側の責務）
   * @param {'high'|'medium'|'low'} confidence
   */
  function showAt(rect, text, confidence) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hide();
      return;
    }
    visible = true;

    box.className = `box conf-${confidence}`;
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    label.textContent = text;
    label.style.display = 'block';
    // ラベルは枠の左上のやや上に追従する。画面上端では枠の下側に出す。
    const approxWidth = Math.max(80, text.length * 8);
    const left = clampLabelLeft(rect.left, approxWidth);
    const above = rect.top - 28;
    const top = above >= 4 ? above : rect.top + rect.height + 6;
    label.style.left = `${left}px`;
    label.style.top = `${top}px`;
  }

  return {
    host,
    showAt,
    hide,
    destroy() {
      host.remove();
    }
  };
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.preview / Node: module.exports）
// ---------------------------------------------------------------------------
const api = { createPreview, clampLabelLeft, Z_INDEX };
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.preview = api;
}

})();
