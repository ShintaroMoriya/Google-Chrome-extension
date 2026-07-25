# Google Chrome拡張機能

自作のGoogle Chrome拡張機能をまとめて管理するリポジトリです。拡張機能ごとに独立したディレクトリを持ち、各拡張機能はそのディレクトリ配下で完結します（依存関係・ビルド・テストを共有しません）。

プロダクト企画・ロードマップ・意思決定記録などの「プロダクトマネジメント」情報は、このリポジトリではなく [`claude-business-os`](https://github.com/ShintaroMoriya/claude-business-os) の `knowledge/product/` と `decisions/` に正本を置いています。このリポジトリは実装コードの置き場です。

## 拡張機能一覧

| ディレクトリ | 概要 | ステータス | プロダクト管理ドキュメント |
| :--- | :--- | :--- | :--- |
| [`gcal-schedule-memo/`](./gcal-schedule-memo) | Googleカレンダーの週表示・日表示で候補日時をクリックで溜めてコピーできる拡張機能 | 開発中（実機未検証） | [knowledge/product/gcal_schedule_memo.md](https://github.com/ShintaroMoriya/claude-business-os/blob/main/knowledge/product/gcal_schedule_memo.md) |

## 新しい拡張機能を追加するとき

1. リポジトリ直下に新しいディレクトリ（拡張機能名）を作成する
2. そのディレクトリの中だけで `manifest.json` ・ソース・テストを完結させる（他の拡張機能と依存関係を共有しない）
3. 上の一覧表に1行追加する
4. `claude-business-os` の `knowledge/product/` にプロダクト管理ドキュメントを作成し、`decisions/` に採用理由を記録する
