# STATUS

## 更新
2026-11-17

## ブランチ
claude/right-panel-output-options-tam1qb

## ゴール
右パネルの出力・余白の欄の使い勝手を直し、アプリの版を見られるようにする

## 現在地
- 出力に「録画に合わせる」を足した(幅はそのまま、高さを最初の録画の比に。保存しない)。横に並べた欄は同じ幅で分ける(.row > .field を flex: 1 1 0)
- 「余白なし(中央に置く)」を「録画を画面全体に表示」に改名
- アプリの設定に「アプリ情報」の区分(版・ライセンス・GitHub・更新の確認)。更新の確認は「一般」から移した

## 次にやること
- PR https://github.com/mu-777/stepcut/pull/29 をマージする(紹介ページの画面の画像は、出力欄の見た目が変わったので古い。必要なら /lp-media)
- 吸着の実機確認(Windows): ズームの枠を四角にそろえる、四角をテロップ・ほかの四角にそろえる。吸着が多すぎて邪魔でないか
- release の run・Release の本文・添付(`StepCut-Setup.exe`・`StepCut-Portable.exe`・THIRD_PARTY_NOTICES.md・LICENSE)・`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 と言語の振り分けの確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
