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
 *   - hour-rail  モデル : 時刻目盛りラベル（複数点）から線形回帰で
 *                         1時間あたりのpx数と原点(0:00の位置)を実測する
 *
 * v1.2.0 の変更点（「クリック位置から時刻を算出できませんでした」の修正）:
 *   - hour-rail は「当てはまりが極めて良い(r2>=0.995)」かつ「1時間あたり
 *     10〜300px」という妥当性を満たすときだけ採用する。以前は日付数字などの
 *     ノイズ点で回帰が成立してしまい、0.5px/時のような値が採用されていた。
 *   - column-span の列が24時間分の高さとして妥当（10〜300px/時）なら、
 *     実際にクリックした要素そのものの矩形なので hour-rail より優先する。
 *   - snapMinutes に 'floor' モードを追加（クリックした位置を含む枠に揃える）。
 */
'use strict';

// MV3のコンテンツスクリプトは複数ファイルを列挙しても同一の分離ワールド
// （1つのJSレルム）で実行される。ファイル全体をIIFEで包み、トップレベルの
// const/function宣言が他ファイルの同名宣言と衝突しないようにする。
(function () {

const DEFAULT_PX_PER_HOUR = 48;
const AGREEMENT_THRESHOLD_RATIO = 0.05; // 5%以内なら一致とみなす
const MIN_PX_PER_HOUR = 10;  // これ未満は「時間グリッドではない」とみなす
const MAX_PX_PER_HOUR = 300; // これ超も同様
const MIN_RAIL_R2 = 0.995;   // hour-rail の当てはまりの下限

/**
 * @typedef {Object} GridGeometry
 * @property {number} pxPerHour
 * @property {number} originY  clientY座標系での 0:00 の位置
 * @property {'agree'|'hour-rail'|'column-span'|'default'} model
 * @property {'high'|'medium'|'low'} confidence
 */

function isPlausiblePxPerHour(v) {
  return Number.isFinite(v) && v >= MIN_PX_PER_HOUR && v <= MAX_PX_PER_HOUR;
}

/**
 * 列要素の矩形（0:00〜24:00を丸ごとカバーしている前提）から
 * column-span モデルを作る。1時間あたりのpxが非現実的な場合は null。
 * @param {{top:number, height:number}} rect
 * @returns {{pxPerHour:number, originY:number} | null}
 */
function columnSpanModel(rect) {
  if (!rect || !(rect.height > 0)) return null;
  const pxPerHour = rect.height / 24;
  if (!isPlausiblePxPerHour(pxPerHour)) return null;
  return { pxPerHour, originY: rect.top };
}

/**
 * 時刻目盛りラベルの点列 [{hour, top}] から、最小二乗法で
 * 「1時間あたりのpx数」と「0:00の位置」を推定する（hour-rail モデル）。
 * 点が2つ未満、傾きが非現実的、当てはまりが悪い場合は null を返す。
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
  const intercept = (sumY - slope * sumX) / n;     // top at hour=0

  if (!isPlausiblePxPerHour(slope)) return null; // 下に行くほど時刻が進み、かつ現実的な密度

  // 決定係数 r2（当てはまりの良さ）
  const meanY = sumY / n;
  const ssTot = pts.reduce((s, p) => s + (p.top - meanY) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p.top - (slope * p.hour + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  if (r2 < MIN_RAIL_R2) return null; // ノイズ点が混ざっている

  return { pxPerHour: slope, originY: intercept, r2 };
}

/**
 * column-span モデルと hour-rail モデルを突き合わせ、最終的な
 * GridGeometry を1つ決める。
 *   - 両方あり・一致     → agree / high（値は column-span）
 *   - 両方あり・不一致   → column-span / medium（クリックした列そのものを優先）
 *   - column のみ        → column-span / medium
 *   - rail のみ          → hour-rail / medium
 *   - どちらも無い       → default / low
 * @param {{top:number, height:number} | null} columnRect
 * @param {Array<{hour:number, top:number}>} hourLabelPoints
 * @returns {GridGeometry}
 */
function buildGridGeometry(columnRect, hourLabelPoints) {
  const colModel = columnSpanModel(columnRect);
  const railModel = hourRailModel(hourLabelPoints);

  if (colModel && railModel) {
    const diffRatio = Math.abs(colModel.pxPerHour - railModel.pxPerHour) / colModel.pxPerHour;
    if (diffRatio <= AGREEMENT_THRESHOLD_RATIO) {
      return {
        pxPerHour: colModel.pxPerHour,
        originY: colModel.originY,
        model: 'agree',
        confidence: 'high'
      };
    }
    return {
      pxPerHour: colModel.pxPerHour,
      originY: colModel.originY,
      model: 'column-span',
      confidence: 'medium'
    };
  }

  if (colModel) {
    return { pxPerHour: colModel.pxPerHour, originY: colModel.originY, model: 'column-span', confidence: 'medium' };
  }

  if (railModel) {
    return { pxPerHour: railModel.pxPerHour, originY: railModel.originY, model: 'hour-rail', confidence: 'medium' };
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
 * 分を指定単位で丸める。
 *   mode 'nearest'（既定）: 最近傍（例: 15分単位）
 *   mode 'floor'          : 単位の区切りに切り捨て。
 *                           「クリックした位置を含む枠」を選ぶ用途（1時間単位など）。
 * @param {number} minutes
 * @param {number} snapTo 丸め単位（分）
 * @param {'nearest'|'floor'} [mode]
 * @returns {number}
 */
function snapMinutes(minutes, snapTo, mode) {
  const q = minutes / snapTo;
  return (mode === 'floor' ? Math.floor(q) : Math.round(q)) * snapTo;
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
 * （v1.2.0 以降は columnSpanModel が 10〜300px/時 の範囲外を弾くため、
 *   終日行（高さ数十px）は column-span モデルが null になり、default 48px/時
 *   にフォールバック → 本関数で終日行と判定される。）
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
