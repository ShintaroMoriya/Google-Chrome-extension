# Privacy Policy — Schedule Assist / 日程アシスト

_Last updated: 2026-10-04_

## English

Schedule Assist is a Chrome extension that helps you pick meeting times on Google Calendar and copy them as text.

- **What it reads.** Only while its panel is open in pick mode, it reads the date and time of the free slot or event you click or hover on calendar.google.com. It also reads the time-zone label that Google Calendar shows (for example "GMT+09") so that it can warn you about a mismatch.
- **What it stores.** It stores the times you picked (up to 3), the other person's time zone and format, your recent choices, your settings and the panel position. All of this is kept in `chrome.storage.local` on your device.
- **What it sends.** Nothing. The extension makes no network requests, has no analytics, no account and no remote code. Text is copied to your clipboard only when you press Copy or use the copy shortcut.
- **Permissions.** `storage` saves the data above. `https://calendar.google.com/*` shows the panel on Google Calendar.
- **Deleting your data.** Press the trash button in the panel, or remove the extension.

Contact: open an issue at https://github.com/ShintaroMoriya/Google-Chrome-extension

## 日本語

日程アシストは、Googleカレンダーで候補日時を選び、テキストとしてコピーするためのChrome拡張機能です。

- **読み取る情報**: パネルが開いていて取得モードの間だけ、calendar.google.com 上でクリックまたはカーソルを合わせた空き枠や予定の日付・時刻を読み取ります。食い違いを警告するために、Googleカレンダーの表示タイムゾーン（例: 「GMT+09」）も読み取ります。
- **保存する情報**: 選んだ候補（最大3件）、相手のタイムゾーンと表記、最近の相手、設定、パネルの位置です。保存先はお使いの端末の `chrome.storage.local` だけです。
- **送信する情報**: ありません。通信、解析ツール、アカウント、リモートコードはいずれもありません。クリップボードへのコピーは、コピーボタンまたはショートカットを押したときだけ行います。
- **権限**: `storage` は上記の保存に使います。`https://calendar.google.com/*` はGoogleカレンダー上にパネルを表示するために使います。
- **データの削除**: パネルのゴミ箱ボタンを押すか、拡張機能を削除してください。
