# STATUS

## 更新
2026-11-16

## ブランチ
ccr-832da0d7-pwbtmy(main 0209a60 から。リリースの仕組みを入れる。PR はまだ作っていない)

## ゴール
Claude Code の `/release` から、CHANGELOG を書いて版を上げ、PR のマージで GitHub Release まで出せるようにする

## 現在地
- 実装済み: スキル `/release`、`release.yml`(main の version にタグがなければタグ → build を呼ぶ)、`build.yml` の workflow_call と publish ジョブ、PR ビルドの版に `-g<SHA>`、配布物の名前の固定、`CHANGELOG.md`・`scripts/changelog.mjs`(version フック)、紹介ページのボタンを `releases/latest/download/` に。version は 0.0.9。決定記録 20261116-release-flow
- 確認: npm run check、`npm version minor` のフックを使い捨てのリポジトリで通しで確認、紹介ページの表示(375px・1280px)。CI 上の動作は未確認

## 次にやること
- ユーザー: PR を作り(base=main)、PR のビルドで版が `0.0.9-g<SHA>`・名前が `StepCut-Setup.exe` になるか見る。マージ前に PR の先頭のコミットへタグ `v0.0.9` を手で打つ(`git tag v0.0.9 origin/<ブランチ> && git push origin v0.0.9`)。打たずにマージすると release の run が一度赤になる
- マージ後: `/release` で 0.1.0 を出す。初回の CHANGELOG は前のタグ以降の差分ではなく、手で全体をまとめる
- main の残り: 紹介ページの取り込みと画像の差し替え、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- tts の単体テストが、初回の実行(変換のキャッシュなし)で 1 件落ちることがあった(再実行で通る。原因は未確認)
- ui-smoke は全項目のあと、最後の app.close() で終わらないことがある(原因は未確認。項目はすべて通る)

## 未決事項
- 公開(0.1.0)前: 商標、T-03(Electron に H.264 のエンコーダー OpenH264・デコーダー FFmpeg が同梱されていること自体が対象。Via LA への問い合わせを検討)、T-04、他者のライセンス表記の同梱(アプリにない)
- 見送り(必要なら追加): 空の画面へのロゴ、ヘルプの「StepCut について」、インストーラーのヘッダー画像
- 保留(ユーザーが検討中): 初回の案内・チュートリアル。見送り: frame の複数時刻(--every)、録画の長さを返すコマンド
- 仮決め(以前から): 拡張子 .stepcut.json、プラグイン名 stepcut、読み上げのキャッシュ 500MB ほか、移行の判定(#17)、CI で ui-smoke(#19)、T-02・U-01・U-04・T-03・T-04・T-08
