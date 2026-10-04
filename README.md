# Google Chrome拡張機能

自作のGoogle Chrome拡張機能をまとめて管理するリポジトリです。各拡張機能は独立したディレクトリで完結し、依存関係・ビルド・テストを共有しません。

プロダクト企画・ロードマップ・意思決定記録などのプロダクト管理情報は、このリポジトリではなく [`claude-business-os`](https://github.com/ShintaroMoriya/claude-business-os) の `knowledge/product/` と `decisions/` に正本を置いています。このリポジトリは実装コードの置き場です。

## 拡張機能一覧

| ディレクトリ | 概要 | ステータス | プロダクト管理ドキュメント |
| :--- | :--- | :--- | :--- |
| [`gcal-schedule-memo/`](./gcal-schedule-memo) | **日程アシスト / Schedule Assist**（v2.0.0）。Googleカレンダーから候補日時を3件まで集め、相手のタイムゾーン・言語・表記に合わせてコピーする日程調整支援拡張機能。iPhone風UI・英日対応・ショートカット付き | ストア公開中（v2.0.0は単体・E2Eテスト済み、実機確認待ち） | [knowledge/product/gcal_schedule_memo.md](https://github.com/ShintaroMoriya/claude-business-os/blob/main/knowledge/product/gcal_schedule_memo.md) |
| [`sales-desk/`](./sales-desk) | サイドパネルによく使うツール・メールテンプレ・メモ・TODOを集約する営業向け作業台 | 導入済み（購入済みテンプレート） | - |
| [`kigen-alert/`](./kigen-alert) | 見積・提出・フォローの期限をアイコンバッジの色と数字で知らせる期限アラート | 導入済み（購入済みテンプレート） | - |
| [`keyword-highlighter/`](./keyword-highlighter) | 登録したキーワードをページ上で自動的に色付けするハイライター | 導入済み（購入済みテンプレート） | - |
| [`task-briefly/`](./task-briefly) | 長い依頼文を担当者・期限・短い作業に整理し、コピーできる仕事向けタスク要約ツール | 開発中（ローカル要約・スモークテスト済み） | [README](./task-briefly/README.md) |

## 新しい拡張機能を追加するとき

1. リポジトリ直下に新しいディレクトリ（拡張機能名）を作成します。
2. そのディレクトリの中だけで `manifest.json` ・ソース・テストを完結させます。他の拡張機能と依存関係を共有しません。
3. 上の一覧表に1行追加します。
4. `claude-business-os` の `knowledge/product/` にプロダクト管理ドキュメントを作成し、`decisions/` に採用理由を記録します。

### UI/UXは既存の型に従う

拡張機能のUI/UXは、`gcal-schedule-memo` で確立した設計を型として固定しています。ゼロから設計し直さず、[`claude-business-os/skills/chrome_extension_ui/SKILL.md`](https://github.com/ShintaroMoriya/claude-business-os/blob/main/skills/chrome_extension_ui/SKILL.md) の **Design System 14項目**に従ってください。要点は次のとおりです。

- ブラウザアクションのポップアップではなく、**Shadow DOMで隔離したページ内フローティングパネル**を使います。
- 「取得モード」を明示的な状態として持ち、**パネル非表示中はクリック横取りを一切行いません**。`Esc`はモードだけを解除します。
- ホバー時に「クリックしたら何が起きるか」を枠でプレビューし、プレビューと確定は同じ計算関数を呼びます。
- 確度（high/medium/low）を持たせ、確実に取得できない値は作り出しません。
- 破壊的操作は2度押しとし、すべての操作に即時フィードバックを表示します。
- 状態は`schemaVersion`付きで永続化し、状態更新は純粋関数に分離してNodeからテスト可能にします。
- 外部依存を避け、権限は最小限にします。

コピペで使えるプロンプトは [`docs/new-extension-prompt.md`](./docs/new-extension-prompt.md) にあります。`claude-business-os` 側の [`assets/prompt_template.md`](https://github.com/ShintaroMoriya/claude-business-os/blob/main/skills/chrome_extension_ui/assets/prompt_template.md) も同じ趣旨のものです。
