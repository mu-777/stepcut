# STATUS

## 更新
2026-11-16

## ブランチ
ccr-f872cbd0-hbsov1(main b036870 から。メッセージの多言語化)

## ゴール
メインプロセスのエラー・ダイアログ・メニュー、プロジェクトの検証、書き出しの警告を画面の言語(英語・日本語)で出す。日英の併記をなくす。CLI の出力は英語に固定する(docs/decisions/20261116-message-i18n.md)

## 現在地
- 実装済み: `src/shared/messages.ts`(コードと英語の文、AppError、IPC の印)、画面の `msgText` / `errorText` と日本語の辞書、メインの `src/main/i18n.ts`(ダイアログ・メニュー)、検証の `{ path, code, params }`、Zod の言語の切り替え、CLI の英語化と `validate --json` の `code`
- 決定記録・.claude/rules/messages.md・要件 NF-07・README・スキル edit-project を更新
- 確認: npm run check、ui-smoke(214 件 ok)、CLI の validate・export(設定が日本語でも英語)、日本語の画面で開けないプロジェクトのバナーが日本語

## 次にやること
- ユーザー: Windows 実機で、日本語・英語の設定ごとに閉じるときのダイアログ、VOICEVOX・Azure のエラー、書き出しの警告の文を見る
- main の残り: リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- いまの動画と画像は Linux のコンテナ製(文字が Windows のフォントでない、読み上げが無音、使い方の動画の最後にその知らせと Linux のパスが映る)
- tts の単体テストが初回に 1 件落ちることがある、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面は仮(ネイティブの確認なし。紹介ページとメッセージ)。英語の読み上げの声は仮に en-US-JennyNeural
- 例の画面の英語版の人名(Alex Kim)・金額(USD)は仮
- AGENTS.md と docs/requirements.md の目的は「手順書動画を作る」のまま(LP・README と言い方が違う。直すかは未決)
- ページの記述のうち、実装済みか未確認のもの: フラッシュでの場面の切り替え、「ほかにも」の 4 項目
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、ヘルプの「StepCut について」、インストーラーのヘッダー画像、初回の案内、frame の --every、拡張子 .stepcut.json ほか
