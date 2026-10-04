# Schedule Assist / 日程アシスト (Chrome extension)

Pick up to **3 meeting times** on Google Calendar and copy them in **the other person's time zone, language and format** — in a few clicks.

Googleカレンダーで候補日時を**最大3件**選び、**相手のタイムゾーン・言語・表記**に合わせてコピーできるChrome拡張機能です。日本語の説明は[後半](#日本語)にあります。

> Everything stays in your browser. Nothing about your calendar is sent anywhere. Permissions: `storage` and `https://calendar.google.com/*` only.

## What it does

| | |
| --- | --- |
| **Pick from your calendar** | Hover a free time or an event in week/day view and you see exactly what will be added. Click to add it. Works whatever language Google Calendar is in. |
| **Their time, their format** | Choose the other person's city (e.g. New York) and format (English 12h / English 24h / 日本語). The copied text uses their time zone, language and date style: `Mon, Aug 31 · 9:00 – 10:00 PM EDT`. |
| **See their day at a glance** | Each time shows their local time with ☀ (working hours), 🌅 (early/late) or 🌙 (night), and a `+1` / `−1` badge if it falls on a different day for them. |
| **One tap to copy** | Pick a style with an icon — times only, propose times, ask to reschedule, suggest a video call — then press Copy. |
| **Fast** | `Alt+Shift+S` opens or closes the panel. `Alt+Shift+C` copies. Recent people are one tap away. You can change the shortcuts at `chrome://extensions/shortcuts`. |
| **Safe by design** | Clicks on the calendar are only captured while the panel is open in pick mode. `Esc` steps back: it closes a sheet first, then stops picking. |

## How to use

1. Open Google Calendar in week or day view, then click the toolbar icon (or press `Alt+Shift+S`).
2. Click free times or events. The three slots fill up, and the dots below show how many are left.
3. Tap the 🌐 chip to choose the other person's city. Tap the language chip to choose the format.
4. Choose a message style with the icons, then press **Copy** and paste the text into Gmail, Outlook, Slack and so on.

Times that Google Calendar does not show can be added with **＋** on an empty slot.

### What the shapes and colours mean

| Visual | Meaning |
| --- | --- |
| Dashed slot | Still free. Click on the calendar to fill it. |
| Slots shake | You already have 3 times, or that time is already added. |
| Green ✓ on the Copy button | Copied. |
| Blue / yellow / red frame while hovering | Time is certain / estimated from the position / needs checking. |
| Grey dashed frame while hovering | The 3 slots are full. |
| ⚠ next to a time | Estimated. Hover the icon to see why. |

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `gcal-schedule-memo` folder.
3. Pin **Schedule Assist** to the toolbar.

To build the zip for the Chrome Web Store:

```bash
cd gcal-schedule-memo
zip -r ../schedule-assist-2.0.0.zip manifest.json background.js src icons _locales
```

Listing text, the privacy policy and the checklist for the Featured badge are in [`store/`](./store).

## Tests

Unit tests need no dependencies:

```bash
node gcal-schedule-memo/test/run.js
```

The browser test loads the extension into Chromium against a calendar-like fixture. It covers picking, manual entry, the 3-slot limit, copying in New York time and Japanese, the copy shortcut, the time-zone mismatch warning and the absence of long tasks on a heavy page.

```bash
cd gcal-schedule-memo/test/e2e
npm install
CHROMIUM_PATH=/path/to/chrome xvfb-run -a node picker.spec.js
# Add SHOT_DIR=/some/dir to save panel screenshots (light and dark).
```

### Check on the real Google Calendar

- [ ] Hovering a free time in week view shows the same time that is added on click.
- [ ] Clicking an event adds the right date and time, also with Google Calendar set to English or another language.
- [ ] With the other person set to New York, the copied text shows New York time with `EDT`/`EST`.
- [ ] A 4th time cannot be added, and the slots shake.
- [ ] `Alt+Shift+S` opens and closes the panel, and `Alt+Shift+C` copies.
- [ ] If Google Calendar's time zone (top-left `GMT±hh`) differs from "My time zone", a warning appears in settings.
- [ ] After `Esc` or closing the panel, Google Calendar works as usual.
- [ ] Times, the other person and the chosen style survive a reload.

## Technical notes

Manifest V3 and plain JavaScript, with no build step and no libraries. Time zones are handled by the browser's own `Intl` (ICU), so daylight saving time is correct. Times are stored as calendar wall-clock values plus the time zone they were picked in.

| File | Role |
| --- | --- |
| `src/extract.js` | Reads date and time from Google Calendar events and free slots. If the event text cannot be read in any language, it falls back to the event's position on the grid. |
| `src/tz.js` | Converts between wall-clock time and instants, labels like `GMT-4`, city search, and day/early-late/night bands. |
| `src/format.js` | One line per time, in `ja` / `en-US` / `en-GB`. Japanese output in the same time zone is byte-for-byte identical to v1. |
| `src/templates.js` | Message templates in Japanese and English. |
| `src/panel.js` / `src/icons.js` / `src/preview.js` | iOS-style panel in Shadow DOM, SF Symbols-style inline SVG icons, and the hover preview. |
| `src/store.js` | Saved state (schema v3) with safe migration from v1/v2. |
| `src/i18n.js` + `_locales/` | UI strings in English and Japanese. Adding a language only needs a new `messages.json`. |
| `src/content.js` / `background.js` | Wiring, keyboard shortcuts and the toolbar icon. |

If Google Calendar changes its page structure, use `tools/probe.js` to inspect the live DOM and update `src/extract.js`.

## Changelog

### 2.0.0

- Redesigned in an iPhone-like style. The UI uses icons, colour and motion instead of text, and shows 3 slots, date tiles and a green ✓ on copy.
- Copies in the other person's time zone, language and format (English 12h, English 24h, Japanese), and shows their local time with ☀/🌅/🌙.
- Added English UI and English message templates (`_locales`, English by default, Japanese automatically).
- Added keyboard shortcuts (`Alt+Shift+S` opens or closes the panel, `Alt+Shift+C` copies) and a list of recent people.
- Event times are read whatever language Google Calendar is in, with the event's position as a fallback.
- Hover is faster: the time-label scan uses a TreeWalker and a cache.
- Warns when Google Calendar's time zone and yours do not match.
- New icon.

### 1.2.0

Fixed misreading of the hour labels. Added settings for snap, length and how event clicks are cut.

### 1.1.0

Limited the list to 3 times, and added manual entry and 3 Japanese email templates.

### 1.0.0

First release.

---

## 日本語

### できること

| 機能 | 内容 |
| --- | --- |
| カレンダーから選ぶ | 週表示・日表示で空き時間や予定にカーソルを合わせると、追加される時間帯が枠で表示されます。クリックすると追加されます。Googleカレンダーの表示言語は問いません。 |
| 相手の時刻・表記でコピー | 相手の都市（例: New York）と表記（English 12h / English 24h / 日本語）を選ぶと、相手の時刻・言語・書式でコピーされます。 |
| 相手の1日がひと目で分かる | 各候補に相手の時刻を ☀（業務時間）・🌅（早朝/夜）・🌙（深夜）付きで表示します。相手にとって日付がずれる場合は `+1` / `−1` も表示します。 |
| ワンタップでコピー | アイコンで文面（候補のみ / 候補日を送る / 再調整 / オンライン）を選び、コピーボタンを押します。 |
| スピード | `Alt+Shift+S` でパネルを開閉し、`Alt+Shift+C` でコピーします。最近の相手はワンタップで呼び出せます。 |

### 使い方

1. Googleカレンダーを週表示または日表示で開き、ツールバーのアイコンをクリックします（または `Alt+Shift+S`）。
2. 空き時間か予定をクリックします。3つの枠が埋まっていき、下の点で残りの数が分かります。
3. 🌐のボタンで相手の都市を、言語のボタンで表記を選びます。
4. アイコンで文面を選び、**コピー**を押して、メールやチャットに貼り付けます。

カレンダーにない日時は、空き枠の **＋** から入力できます。`Esc` を押すと、シートを閉じてから取得モードを止めます。

### 注意事項

- 終日の予定と、日をまたぐ予定は候補にできません（誤った日時を作らないため）。
- Googleカレンダーの表示タイムゾーン（左上の `GMT±hh`）と「自分のタイムゾーン」が違う場合は、設定に警告が出ます。設定で自分のタイムゾーンを合わせてください。
- 予定の内容は外部へ送信しません。保存先はブラウザ内（`chrome.storage.local`）だけです。
