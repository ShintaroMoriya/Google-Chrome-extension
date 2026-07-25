/**
 * background.js — サービスワーカー
 *
 * 目的:
 *   拡張機能アイコンのクリックを受け取り、Googleカレンダーのタブに
 *   「パネルの表示/非表示を切り替えて」というメッセージを送るだけ。
 *
 * 設計上の制約:
 *   - manifest.json は action.default_popup を持たない。
 *     持たせるとポップアップがクリック時に開いてしまい、
 *     「パネルを開いたままカレンダーをポチポチ押す」という
 *     中核体験が成立しなくなる（ポップアップはページクリックで閉じる）。
 *     default_popup が無いことで chrome.action.onClicked が発火する。
 *   - Googleカレンダー以外のタブでアイコンを押された場合は、
 *     カレンダーの新規タブを開く（迷わせない）。
 */
'use strict';

const CALENDAR_URL_PREFIX = 'https://calendar.google.com/';

chrome.action.onClicked.addListener(async (tab) => {
  const onCalendar = !!(tab && tab.url && tab.url.startsWith(CALENDAR_URL_PREFIX));

  if (!onCalendar) {
    await chrome.tabs.create({ url: 'https://calendar.google.com/calendar/r/week' });
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'GSM_TOGGLE_PANEL' });
  } catch (err) {
    // コンテンツスクリプトが未注入（拡張の再読み込み直後など）。
    // タブを再読み込みして注入をやり直す。
    try {
      await chrome.tabs.reload(tab.id);
    } catch (_) {
      // タブが既に閉じられている等、これ以上できることはない。
    }
  }
});
