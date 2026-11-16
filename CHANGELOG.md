# Changelog

StepCut の変更履歴。書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従う。

このファイルがリリースノートの正。リリース時は CI がその版の節を抜き出し、GitHub Release の本文にする。
手順は [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md)。

<!--
次のリリースの変更は下の [Unreleased] 節にだけ書く(分類は Added / Changed / Deprecated / Removed /
Fixed / Security)。`npm version` のときに scripts/changelog.mjs がこの見出しを `## [x.y.z] - 日付` に
置き換え、空の [Unreleased] を上に作る。この案内は [Unreleased] の外に置く(節の中だと本文に入る)。
-->

## [Unreleased]

## [0.1.0] - 2026-11-16

### Added
- 最初の公開版(Windows。インストーラ版と portable 版)
- 録画(mp4)と画像をステップに切り分け、テロップ・読み上げ・ズーム・オブジェクト(ポインター・蛍光ペン・四角・矢印・テキスト・画像)を付けて mp4 に書き出す
- 編集内容を JSON のプロジェクトファイルに保存する。ほかで変更されると検知して読み直す
- 読み上げは OS 標準の音声合成。アプリの設定で Azure AI Speech と VOICEVOX 互換エンジンも使える
- 書き出しは H.264(ハードウェアを優先)と AAC(使えなければ Opus)。30/60fps、画質は 3 段階、SRT 字幕も出せる
- コマンドラインで検証・書き出し・1 フレームの画像化・時間の確認ができる(validate / export / frame / inspect)
- Claude Code のプラグイン(/stepcut:edit-project)でプロジェクトを編集できる
- 画面の言語(日本語・英語)の切り替えと、キー操作の割り当ての変更
- 新しい版があれば起動時に知らせる(アプリの設定で止められる)

[Unreleased]: https://github.com/mu-777/stepcut/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mu-777/stepcut/releases/tag/v0.1.0
