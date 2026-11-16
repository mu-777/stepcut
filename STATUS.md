# STATUS

## 更新
2026-11-16

## ブランチ
claude/relaxed-bardeen-b45md3(main fa0f8d2 から。v0.1.0 のリリース PR)

## ゴール
最初の版 v0.1.0 を GitHub Releases に出し、リリースの流れ(release.yml → build.yml → publish)を通しで確かめる(導通確認)

## 現在地
- CHANGELOG に 0.1.0 の節を記入、`npm version minor` で 0.1.0 に上げた。npm run check 通過。PR を作成済み、マージ待ち

## 次にやること
- ユーザー: PR をマージする
- マージ後: release の run が緑か、Release の本文が CHANGELOG の 0.1.0 の節と同じか、`StepCut-Setup.exe`・`StepCut-Portable.exe` が添付されているか、`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 0.1.0 は導通確認として、下記を未解決のまま公開する(ユーザー判断)。本格的な公開の前に解決する: 商標、T-03(Electron に同梱の OpenH264・FFmpeg が対象。Via LA への問い合わせを検討)、T-04、他者のライセンス表記の同梱(アプリにない)
- メッセージの英語の文面は仮(ネイティブの確認なし)
- 紹介ページ: 英語の文面・英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
