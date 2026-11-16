# STATUS

## 更新
2026-11-16

## ブランチ
claude/determined-brahmagupta-mofz3d(main d3a6886 から。PR #23〜#25 はマージ済み)

## ゴール
紹介ページで StepCut の名前を目立たせる(ヒーローにロゴ + ヘッダー固定)。v0.1.0 のリリースの結果を確かめる

## 現在地
- 試作: ヒーローの見出しの上にロゴ(PC 320px・文字の高さを h1 の字面にそろえ h1 を 44→40px、スマホ幅 236px)、ヘッダーを sticky に(日英とも)。headless ブラウザーで PC・スマホ幅を確認。ユーザーの採否待ち
- 紹介ページの言語の自動振り分け(PR #25)はマージ済み。本番の確認は未

## 次にやること
- ロゴの試作の採否を聞き、採用なら決定記録 20261112-landing-page を書き換える(ロゴが 2 つ並ぶのは可とユーザー確認済み)
- release の run が緑か、Release の本文が CHANGELOG の 0.1.0 の節と同じか、`StepCut-Setup.exe`・`StepCut-Portable.exe` が添付されているか、`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)。配布物に THIRD_PARTY_NOTICES.md・LICENSE があるかも見る
- 本番で `/` の振り分けを日本語・英語のブラウザーで確認する
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- ヒーローのロゴ: 採否(大きさの最終確認)
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
