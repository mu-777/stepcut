# STATUS

## 更新
2026-11-16

## ブランチ
claude/vibrant-ritchie-66ufqa(main fa0f8d2 = PR #22 マージ後から。PR ビルドの Artifact の保持を 1 日に)

## ゴール
Claude Code の `/release` から、CHANGELOG を書いて版を上げ、PR のマージで GitHub Release まで出せるようにする

## 現在地
- 実装済み: スキル `/release`、`release.yml`(main の version にタグがなければタグ → build を呼ぶ)、`build.yml` の workflow_call と publish ジョブ、PR ビルドの版に `-g<SHA>`、配布物の名前の固定、`CHANGELOG.md`・`scripts/changelog.mjs`(version フック)、紹介ページ(英・日)のボタンを `releases/latest/download/` に。version は 0.0.9。決定記録 20261116-release-flow
- 確認: npm run check、`npm version minor` のフックを使い捨てのリポジトリで通しで確認、紹介ページの表示。CI 上の動作は未確認

## 次にやること
- ユーザー: PR #22 のビルドで版が `0.0.9-g<SHA>`・名前が `StepCut-Setup.exe` になるか見る。マージ前に PR の先頭のコミットへタグ `v0.0.9` を手で打つ(`git tag v0.0.9 origin/<ブランチ> && git push origin v0.0.9`)。打たずにマージすると release の run が一度赤になる
- マージ後: `/release` で 0.1.0 を出す。初回の CHANGELOG は前のタグ以降の差分ではなく、手で全体をまとめる
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 公開(0.1.0)前: 商標、T-03(Electron に H.264 のエンコーダー OpenH264・デコーダー FFmpeg が同梱されていること自体が対象。Via LA への問い合わせを検討)、T-04、他者のライセンス表記の同梱(アプリにない)
- メッセージの英語の文面は仮(ネイティブの確認なし)
- 紹介ページ: 英語の文面・英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
