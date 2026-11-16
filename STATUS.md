# STATUS

## 更新
2026-11-16

## ブランチ
claude/relaxed-bardeen-b45md3(main fa0f8d2 から。PR #24 のブランチを取り込み済み。v0.1.0 のリリース PR #23)

## ゴール
公開前の未決事項(PR #24)を入れたうえで v0.1.0 を GitHub Releases に出し、リリースの流れ(release.yml → build.yml → publish)を通しで確かめる

## 現在地
- PR #24(ライセンス表記の同梱、T-03・T-04 の決定、商標の確認)をこのブランチに取り込み済み
- PR の Windows ビルドをラベル `build` を付けたときだけに変更(build.yml、Artifacts は 7 日保存)。/pr-build・AGENTS.md・README・決定記録 20261029-windows-build を更新
- CHANGELOG に 0.1.0 の節を記入、`npm version minor` で 0.1.0 に上げた。npm run check 通過。PR #23 はマージ待ち

## 次にやること
- ユーザー: Artifacts の容量が満杯(2026-11-16)。古い Artifacts を消し、再計算(6〜12 時間)後に PR #24 → PR #23 の順にマージする。満杯のままマージすると、タグ v0.1.0 だけできて Release は作られない(#23 だけ先にマージしても #24 の中身は入るが、#24 は空の PR になる)
- マージ後: release の run が緑か、Release の本文が CHANGELOG の 0.1.0 の節と同じか、`StepCut-Setup.exe`・`StepCut-Portable.exe` が添付されているか、`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)。配布物に THIRD_PARTY_NOTICES.md・LICENSE があるかも見る
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
