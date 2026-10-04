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
    border: 2px solid #0a84ff;
    background: rgba(10,132,255,.14);
    border-radius: 8px;
    display: none;
    pointer-events: none;
    transition: top .08s ease-out, height .08s ease-out;
  }
  .box.conf-medium { border-color: #ff9f0a; background: rgba(255,159,10,.15); }
  .box.conf-low { border-color: #ff453a; background: rgba(255,69,58,.13); }
  .box.full { border-color: rgba(142,142,147,.9); border-style: dashed; background: rgba(142,142,147,.12); }
  .label {
    position: fixed;
    display: none;
    pointer-events: none;
    align-items: center;
    gap: 6px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, Roboto, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(28,28,30,.88);
    -webkit-backdrop-filter: blur(12px);
    backdrop-filter: blur(12px);
    color: #fff;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0,0,0,.28);
  }
  .label.full { opacity: .7; }
  .label .their { display: inline-flex; align-items: center; gap: 4px; font-weight: 500; color: rgba(235,235,245,.78); }
  .label .arrow { opacity: .5; font-weight: 400; }
  .label svg { display: block; }
  .band-day { color: #30d158; }
  .band-edge { color: #ff9f0a; }
  .band-night { color: #a5a3ff; }
  .count { font-size: 10px; padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,.18); }
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
   * @param {{their?:{text:string, band:string, iconSvg:string}, full?:boolean, countText?:string}} [extra]
   *   their: 相手の時刻（相手のタイムゾーンが自分と異なる場合のみ）
   *   full : 候補が上限に達している（追加できないことをグレーで示す）
   */
  function showAt(rect, text, confidence, extra) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hide();
      return;
    }
    visible = true;
    const opts = extra || {};

    box.className = `box conf-${confidence}${opts.full ? ' full' : ''}`;
    box.style.display = 'block';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    label.className = `label${opts.full ? ' full' : ''}`;
    label.textContent = '';
    const main = document.createElement('span');
    main.textContent = text;
    label.appendChild(main);
    let extraLen = 0;
    if (opts.their && opts.their.text) {
      const their = document.createElement('span');
      their.className = 'their';
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '→';
      const bandIcon = document.createElement('span');
      bandIcon.className = `band-${opts.their.band}`;
      // アイコンは icons.js が生成する固定のSVG文字列（外部入力を含まない）
      bandIcon.innerHTML = opts.their.iconSvg || '';
      const theirText = document.createElement('span');
      theirText.textContent = opts.their.text;
      their.append(arrow, bandIcon, theirText);
      label.appendChild(their);
      extraLen += opts.their.text.length + 4;
    }
    if (opts.full && opts.countText) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = opts.countText;
      label.appendChild(count);
      extraLen += 5;
    }
    label.style.display = 'inline-flex';
    // ラベルは枠の左上のやや上に追従する。画面上端では枠の下側に出す。
    const approxWidth = Math.max(80, (text.length + extraLen) * 7.5);
    const left = clampLabelLeft(rect.left, approxWidth);
    const above = rect.top - 30;
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
