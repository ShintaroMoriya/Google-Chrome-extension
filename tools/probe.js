/**
 * tools/probe.js — Googleカレンダー実DOM調査用スニペット（DevToolsに貼り付けて使う）
 *
 * 目的:
 *   この拡張機能はGoogleカレンダーの非公開DOM構造（クラス名・属性・ラベル文字列）
 *   に依存する。開発環境からは実際にログインしたカレンダーを確認できないため、
 *   このスクリプトをユーザー自身のDevToolsコンソールで実行してもらい、
 *   実測値（日時ラベルの書式、時刻目盛りの座標など）を集める。
 *   結果は src/extract.js の CONFIG や test/fixtures/*.json の確定に使う。
 *
 * 使い方（README.md にも記載）:
 *   1. calendar.google.com を開き、週表示にする
 *   2. DevTools を開く（Mac: Cmd+Option+J / Windows: Ctrl+Shift+J）
 *   3. コンソールに「allow pasting」と手入力してEnter
 *      （Chromeはコンソールへの貼り付けを既定でブロックするため、
 *        これを入力しないと次の手順で貼り付けができない）
 *   4. このファイルの中身を全部貼り付けてEnter
 *   5. 案内に従って「時刻付きの既存の予定」を1つクリック
 *   6. 続けて「空いている時間帯」を1つクリック
 *   7. コンソールで GSM_PROBE.dump() を実行し、出力されたJSONをコピーして渡す
 *      （コピー用に copy(GSM_PROBE.dump()) も使える。ブラウザのクリップボードに
 *      直接コピーされる）
 *
 * 個人情報について:
 *   出力は日付・時刻の骨格だけを残し、それ以外の単語（予定タイトル・
 *   参加者名・メールアドレス等）は '#' に置換してマスクする。
 *   ただし完全ではないため、貼り戻す前に必ず中身を目視確認してください。
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // マスキング: 日付・時刻の骨格に使う文字だけを残し、それ以外の単語は '#' に置換
  // -------------------------------------------------------------------------
  const KEEP_RE = /^[\d:：時分午前後年月日曜（）()~〜～\-–—,、\s]+$/;

  function maskWords(s) {
    return String(s).replace(/[^\s、,]+/g, (tok) =>
      KEEP_RE.test(tok) ? tok : '#'.repeat(Math.min(tok.length, 12))
    );
  }

  function maskEmails(s) {
    return String(s).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');
  }

  function safeMask(s) {
    return maskWords(maskEmails(String(s || '')));
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      top: Math.round(r.top)
    };
  }

  // -------------------------------------------------------------------------
  // ① data-datekey 全数ダンプ
  // -------------------------------------------------------------------------
  function collectDatekeys() {
    const out = [];
    document.querySelectorAll('[data-datekey]').forEach((el, i) => {
      if (i > 80) return;
      const raw = el.getAttribute('data-datekey');
      const key = Number(raw);
      let decoded = null;
      if (Number.isFinite(key)) {
        const day = key & 31;
        const month = (key >> 5) & 15;
        const year = (key >> 9) + 1970;
        decoded = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
      out.push({
        key: raw, decoded,
        tag: el.tagName, role: el.getAttribute('role'),
        className: el.className ? String(el.className).slice(0, 120) : null,
        rect: rectOf(el),
        textHead: safeMask((el.textContent || '').slice(0, 40))
      });
    });
    return out;
  }

  // -------------------------------------------------------------------------
  // ② イベントチップの実サンプル
  // -------------------------------------------------------------------------
  function decodeEventIdMasked(attr) {
    if (!attr) return null;
    try {
      const b64 = attr.replace(/-/g, '+').replace(/_/g, '/');
      return maskEmails(atob(b64));
    } catch (_) {
      return '<decode-failed>';
    }
  }

  function collectChips(limit) {
    const chips = Array.from(document.querySelectorAll('[data-eventid]')).slice(0, limit || 5);
    return chips.map((chip) => {
      const attrs = {};
      Array.from(chip.attributes).forEach((a) => {
        if (a.name === 'style') return;
        attrs[a.name] = a.name.toLowerCase().includes('eventid')
          ? '<masked>'
          : safeMask(a.value).slice(0, 200);
      });

      const srCandidate = chip.querySelector('.XuJrye') || chip.querySelector('[aria-hidden]');
      const srText = srCandidate ? safeMask(srCandidate.textContent || '') : null;

      const ancestors = [];
      let cur = chip.parentElement;
      let depth = 0;
      while (cur && depth < 8) {
        if (cur.hasAttribute && cur.hasAttribute('data-datekey')) {
          ancestors.push({
            key: cur.getAttribute('data-datekey'),
            tag: cur.tagName, role: cur.getAttribute('role'),
            rect: rectOf(cur)
          });
        }
        cur = cur.parentElement;
        depth += 1;
      }

      return {
        attrs,
        eventIdDecoded: decodeEventIdMasked(chip.getAttribute('data-eventid')),
        srText,
        visibleTimeText: safeMask((chip.textContent || '').slice(0, 80)),
        inlineStyle: {
          top: chip.style.top, height: chip.style.height,
          left: chip.style.left, width: chip.style.width
        },
        rect: rectOf(chip),
        datekeyAncestors: ancestors,
        outerHTMLMasked: safeMask(chip.outerHTML.slice(0, 800))
      };
    });
  }

  // -------------------------------------------------------------------------
  // ③ 時刻目盛りレールの実測
  // -------------------------------------------------------------------------
  const HOUR_LABEL_RE = /^(午前|午後)?\s*\d{1,2}\s*(時)?$|^\d{1,2}\s*(am|pm)$/i;

  function collectHourRail() {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (out.length > 60) return;
      if (el.children && el.children.length > 0) return;
      const text = (el.textContent || '').trim();
      if (!text || text.length > 8) return;
      if (!HOUR_LABEL_RE.test(text)) return;
      out.push({ text, rect: rectOf(el) });
    });
    return out;
  }

  function fitGeometry(hourRail) {
    // 「午前n時」「n時」等から24時間表記の時を推定する。
    function toHour(text) {
      const m = /^(午前|午後)?\s*(\d{1,2})\s*(時)?$/.exec(text);
      if (!m) return null;
      const h = Number(m[2]);
      if (m[1] === '午後') return h === 12 ? 12 : h + 12;
      if (m[1] === '午前') return h === 12 ? 0 : h;
      return h; // ampm指定なしはそのまま（要確認ポイント）
    }
    const points = hourRail
      .map((p) => ({ hour: toHour(p.text), top: p.rect.top }))
      .filter((p) => p.hour != null);
    if (points.length < 2) return { note: '目盛りラベルの解釈に失敗（要手動確認）', points };

    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.hour, 0);
    const sumY = points.reduce((s, p) => s + p.top, 0);
    const sumXY = points.reduce((s, p) => s + p.hour * p.top, 0);
    const sumXX = points.reduce((s, p) => s + p.hour * p.hour, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return { note: '傾き不定', points };
    const pxPerHour = (n * sumXY - sumX * sumY) / denom;
    const originY = (sumY - pxPerHour * sumX) / n;
    return { pxPerHour, originY, pointCount: n };
  }

  // -------------------------------------------------------------------------
  // ④ クリック実測（ワンショット capture リスナ）
  // -------------------------------------------------------------------------
  const state = {
    meta: null,
    datekeys: null,
    chips: null,
    hourRail: null,
    geometryFit: null,
    clicks: [],
    startedAt: new Date().toISOString()
  };

  function describePathEl(el) {
    if (!el || !el.tagName) return null;
    const dataAttrs = {};
    if (el.attributes) {
      Array.from(el.attributes).forEach((a) => {
        if (a.name.startsWith('data-') || a.name === 'role') {
          dataAttrs[a.name] = a.name.toLowerCase().includes('eventid') ? '<masked>' : a.value;
        }
      });
    }
    return {
      tag: el.tagName,
      className: el.className ? String(el.className).slice(0, 80) : null,
      dataAttrs,
      rect: el.getBoundingClientRect ? rectOf(el) : null
    };
  }

  function onProbeClick(e) {
    const path = (typeof e.composedPath === 'function' ? e.composedPath() : [])
      .slice(0, 8)
      .map(describePathEl)
      .filter(Boolean);

    const elementsFromPoint = (document.elementsFromPoint(e.clientX, e.clientY) || [])
      .slice(0, 8)
      .map(describePathEl)
      .filter(Boolean);

    const chip = e.target.closest ? e.target.closest('[data-eventid]') : null;
    const datekeyAncestor = e.target.closest ? e.target.closest('[data-datekey]') : null;

    let resolvedDatekey = null;
    if (datekeyAncestor) {
      const raw = datekeyAncestor.getAttribute('data-datekey');
      const key = Number(raw);
      if (Number.isFinite(key)) {
        const day = key & 31, month = (key >> 5) & 15, year = (key >> 9) + 1970;
        resolvedDatekey = { key: raw, decoded: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
      }
    }

    state.clicks.push({
      kind: chip ? 'chip' : 'empty',
      clientX: e.clientX, clientY: e.clientY,
      composedPath: path,
      elementsFromPoint,
      resolvedDatekey,
      defaultPrevented: e.defaultPrevented
    });

    console.log(
      `%c[GSM_PROBE] クリックを記録しました（${state.clicks.length}件目・${chip ? '予定チップ' : '空き枠'}）`,
      'color:#1a73e8;font-weight:bold;'
    );
  }

  function collectMeta() {
    let viewGuess = 'unknown';
    if (/\/r\/week/.test(location.href)) viewGuess = 'week';
    else if (/\/r\/day/.test(location.href)) viewGuess = 'day';
    else if (/\/r\/month/.test(location.href)) viewGuess = 'month';
    else if (/\/r\/agenda/.test(location.href)) viewGuess = 'agenda';

    let resolvedOptions = {};
    try {
      resolvedOptions = Intl.DateTimeFormat().resolvedOptions();
    } catch (_) {}

    return {
      href: location.href.replace(/\?.*/, ''),
      lang: document.documentElement.lang,
      timeZone: resolvedOptions.timeZone,
      locale: resolvedOptions.locale,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      viewGuess,
      probeVersion: 1
    };
  }

  function runStaticCollection() {
    state.meta = collectMeta();
    state.datekeys = collectDatekeys();
    state.chips = collectChips(5);
    state.hourRail = collectHourRail();
    state.geometryFit = fitGeometry(state.hourRail);
  }

  function dump() {
    // クリックのたびに静的情報も取り直す（DOMは操作のたびに変わりうるため）。
    runStaticCollection();
    return JSON.stringify(state, null, 2);
  }

  // -------------------------------------------------------------------------
  // 起動
  // -------------------------------------------------------------------------
  window.addEventListener('click', onProbeClick, { capture: true });
  runStaticCollection();

  window.GSM_PROBE = {
    dump,
    state,
    stop() {
      window.removeEventListener('click', onProbeClick, { capture: true });
      console.log('%c[GSM_PROBE] クリック記録を停止しました', 'color:#1a73e8;font-weight:bold;');
    }
  };

  console.log(
    '%c[GSM_PROBE] 準備完了。' +
      '週表示で「時刻付きの予定」を1つ、続けて「空き枠」を1つクリックしてください。\n' +
      '記録が終わったら次を実行:\n' +
      '  copy(GSM_PROBE.dump())   … クリップボードにコピー\n' +
      '  GSM_PROBE.dump()          … コンソールにJSON文字列を表示',
    'color:#1a73e8;font-weight:bold;'
  );
})();
