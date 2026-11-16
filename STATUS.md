# STATUS

## 更新
2026-11-16

## ブランチ
ccr-6534948c-19zrea(main 8db2f88 から。リポジトリ名を stepcut に)

## ゴール
GitHub のリポジトリ名を mu-777/stepcut にし、リポジトリ内の参照(更新確認の URL、紹介ページ、プラグイン、README、スキル)を合わせる

## 現在地
- リポジトリ内の参照を mu-777/stepcut に書き換えた(旧名は決定記録の経緯にだけ残す)
- 確認: npm run check、ui-smoke(227 件 ok。最後の終了待ちで止まるのは既知)

## 次にやること
- ユーザー: GitHub の Settings でリポジトリ名を stepcut に変える(このブランチのマージより先に)。手元の clone は `git remote set-url origin https://github.com/mu-777/stepcut`。Cloudflare Workers Builds の接続先が新しい名前で動くかを確認
- 名前を変えたら PR を作ってマージする
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- メッセージの英語の文面は仮(ネイティブの確認なし)
- 紹介ページ: 英語の文面・英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ロゴ・名前の商標と類似は未確認。ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
