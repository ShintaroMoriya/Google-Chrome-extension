/**
 * src/geometry.js — 空きスロットのクリック位置(clientY)を時刻に変換する（準純粋関数）
 *
 * 目的:
 *   週/日ビューの空きマスをクリックしたとき、そのY座標がグリッド内の
 *   何時何分に相当するかを求める。DOM要素は直接触らず、呼び出し側が
 *   矩形(rect)や時刻目盛りラベルの座標を渡す設計にすることで、
 *   Node上でも合成データによる完全なテストができるようにしている。
 *
 * 2つのモデルを独立に構築し、互いにクロスチェックする:
 *   - column-span モデル: 列要素の矩形が0:00〜24:00をカバーしていると仮定
 *   - hour-rail モデル : 時刻目盛りラベル（複数点）から線形回帰で
 *                        1時間あたりのpx数と原点(0:00の位置)を実測する
 *   両者が近ければ confidence を上げ、乖離していれば hour-rail を優先し
 *   confidence を下げる（実測の方が仮定が少ないため）。
 *   目盛りラベルが取れない場合は column-span 単独、それも無ければ
 *   既定値（48px/時）にフォールバックする。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const DEFAULT_PX_PER_HOUR = 48;
const AGREEMENT_THRESHOLD_RATIO = 0.05; // 5%以内なら一致とみなす

/**
 * @typedef {Object} GridGeometry
 * @property {number} pxPerHour
 * @property {number} originY  clientY座標系での 0:00 の位置
 * @property {'agree'|'hour-rail'|'column-span'|'default'} model
 * @property {'high'|'medium'|'low'} confidence
 */

/**
 * 列要素の矩形（0:00〜24:00を丸ごとカバーしている前提）から
 * column-span モデルを作る。
 * @param {{top:number, height:number}} rect
 * @returns {{pxPerHour:number, originY:number} | null}
 */
function columnSpanModel(rect) {
  if (!rect || !(rect.height > 0)) return null;
  return { pxPerHour: rect.height / 24, originY: rect.top };
}

/**
 * 時刻目盛りラベルの点列 [{hour, top}] から、最小二乗法で
 * 「1時間あたりのpx数」と「0:00の位置」を推定する（hour-rail モデル）。
 * 点が2つ未満なら推定不能として null を返す。
 * @param {Array<{hour:number, top:number}>} points
 * @returns {{pxPerHour:number, originY:number, r2:number} | null}
 */
function hourRailModel(points) {
  const pts = (points || []).filter(
    (p) => Number.isFinite(p.hour) && Number.isFinite(p.top)
  );
  if (pts.length < 2) return null;

  const n = pts.length;
  const sumX = pts.reduce((s, p) => s + p.hour, 0);
  const sumY = pts.reduce((s, p) => s + p.top, 0);
  const sumXY = pts.reduce((s, p) => s + p.hour * p.top, 0);
  const sumXX = pts.reduce((s, p) => s + p.hour * p.hour, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null; // 全点が同じ時刻（傾き不定）

  const slope = (n * sumXY - sumX * sumY) / denom; // px per hour
  const intercept = (sumY - slope * sumX) / n; // top at hour=0

  if (!(slope > 0)) return null; // 下に行くほど時刻が進む前提が崩れている

  // 決定係数 r2（当てはまりの良さ）
  const meanY = sumY / n;
  const ssTot = pts.reduce((s, p) => s + (p.top - meanY) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.top - (slope * p.hour + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { pxPerHour: slope, originY: intercept, r2 };
}

/**
 * column-span モデルと hour-rail モデルを突き合わせ、最終的な
 * GridGeometry を1つ決める。
 * @param {{top:number, height:number} | null} columnRect
 * @param {Array<{hour:number, top:number}>} hourLabelPoints
 * @returns {GridGeometry}
 */
function buildGridGeometry(columnRect, hourLabelPoints) {
  const colModel = columnSpanModel(columnRect);
  const railModel = hourRailModel(hourLabelPoints);

  if (colModel && railModel) {
    const diffRatio = Math.abs(colModel.pxPerHour - railModel.pxPerHour) / railModel.pxPerHour;
    if (diffRatio <= AGREEMENT_THRESHOLD_RATIO) {
      // 独立2系統が一致 → 高信頼。値は実測(hour-rail)を採用する。
      return {
        pxPerHour: railModel.pxPerHour,
        originY: railModel.originY,
        model: 'agree',
        confidence: 'high'
      };
    }
    // 不一致 → 実測(hour-rail)の方が仮定が少ないためそちらを優先。
    return {
      pxPerHour: railModel.pxPerHour,
      originY: railModel.originY,
      model: 'hour-rail',
      confidence: 'medium'
    };
  }

  if (railModel) {
    return { pxPerHour: railModel.pxPerHour, originY: railModel.originY, model: 'hour-rail', confidence: 'medium' };
  }

  if (colModel) {
    return { pxPerHour: colModel.pxPerHour, originY: colModel.originY, model: 'column-span', confidence: 'medium' };
  }

  return { pxPerHour: DEFAULT_PX_PER_HOUR, originY: 0, model: 'default', confidence: 'low' };
}

/**
 * clientY座標を、0:00からの経過分に変換する。
 * @param {number} clientY
 * @param {GridGeometry} geometry
 * @returns {number} 分（負値・1440超もありうる。呼び出し側で範囲検証する）
 */
function yToMinutes(clientY, geometry) {
  return ((clientY - geometry.originY) / geometry.pxPerHour) * 60;
}

/**
 * 分を指定単位で最近傍丸めする（例: 15分単位）。
 * @param {number} minutes
 * @param {number} snapTo 丸め単位（分）
 * @returns {number}
 */
function snapMinutes(minutes, snapTo) {
  return Math.round(minutes / snapTo) * snapTo;
}

/**
 * 0:00からの経過分を { h, m } に変換する（0-23時、0-59分に正規化）。
 * 範囲外（負・1440以上）は null を返す。
 * @param {number} minutes
 * @returns {{h:number, m:number} | null}
 */
function minutesToHm(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { h, m };
}

/**
 * 列の矩形の高さから、その列が「終日行」かどうかを判定する。
 * 終日行は通常の時刻グリッド行に比べて明らかに低い（20時間相当未満）。
 *
 * 注意: pxPerHour は判定対象の rect 自身から逆算した値（column-spanモデル）
 * ではなく、時刻目盛りラベルなど独立した情報源（hour-railモデル）由来で
 * あることが前提。rect自身から算出したpxPerHourを渡すと
 * 「height < (height/24)*20」は数学的に常に偽になり判定が機能しない。
 * collectHourLabelPoints は通常のグリッド全体を走査するため、実運用では
 * hour-railモデルが得られるケースが大半だが、目盛りが1つも見つからない
 * 場合（既定値フォールバック）はこの判定が効かない点は既知の限界とする。
 * @param {{height:number}} rect
 * @param {number} pxPerHour
 * @returns {boolean}
 */
function looksLikeAllDayRow(rect, pxPerHour) {
  if (!rect || !(pxPerHour > 0)) return false;
  return rect.height < pxPerHour * 20;
}

// ---------------------------------------------------------------------------
// エクスポート（ブラウザ: globalThis.GSM.geometry / Node: module.exports）
// ---------------------------------------------------------------------------
const api = {
  DEFAULT_PX_PER_HOUR,
  columnSpanModel,
  hourRailModel,
  buildGridGeometry,
  yToMinutes,
  snapMinutes,
  minutesToHm,
  looksLikeAllDayRow
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  globalThis.GSM = globalThis.GSM || {};
  globalThis.GSM.geometry = api;
}

})();
