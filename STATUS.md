# STATUS

## 更新
2026-11-16

## ブランチ
ccr-f872cbd0-hbsov1(main 7b87e5b を取り込み済み。メッセージの多言語化)

## ゴール
メインプロセスのエラー・ダイアログ・メニュー、プロジェクトの検証、書き出しの警告を画面の言語(英語・日本語)で出す。日英の併記をなくす。CLI の出力は英語に固定する(docs/decisions/20261116-message-i18n.md)

## 現在地
- 実装済み: `src/shared/messages.ts`(コードと英語の文、AppError、IPC の印)、画面の `msgText` / `errorText` と日本語の辞書、メインの `src/main/i18n.ts`(ダイアログ・メニュー)、検証の `{ path, code, params }`、Zod の言語の切り替え、CLI の英語化と `validate --json` の `code`
- main の新しい版の確認・読み上げのキャッシュの IPC も `handle()` に載せた
- 決定記録・.claude/rules/messages.md・要件 NF-07・README・スキル edit-project を更新
- 確認: npm run check、ui-smoke、CLI の validate・export(設定が日本語でも英語)、日本語・英語の画面で開けないプロジェクトのバナー(test-output/cli/banner-*.png)

## 次にやること
- ユーザー: Windows 実機で、日本語・英語の設定ごとに閉じるときのダイアログ、VOICEVOX・Azure のエラー、書き出しの警告の文を見る
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- メッセージの英語の文面は仮(ネイティブの確認なし)
- リポジトリ名を変えたら src/main/update-check.ts の URL を直す
- 紹介ページ: 英語の文面・英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ロゴ・名前の商標と類似は未確認。ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
