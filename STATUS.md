# STATUS

## 更新
2026-11-16

## ブランチ
claude/sweet-mccarthy-mw62qq(main fa0f8d2 から。公開前の未決事項を片付ける)

## ゴール
0.1.0 の公開前に残った未決事項(T-03・T-04・他者のライセンス表記)を片付け、`/release` で 0.1.0 を出す

## 現在地
- 商標: ユーザーが確認済み、問題なし(決定記録 20261111-app-name に反映)
- 他者のライセンス表記: THIRD_PARTY_NOTICES.md(本番の依存と Electron・Chromium)を LICENSE と一緒に extraFiles で exe の隣に置く。Linux の --dir で配置を確認、Windows の配布物では未確認

## 次にやること
- ユーザー: PR のビルドで、インストール先と Portable に THIRD_PARTY_NOTICES.md・LICENSE があるか見る
- T-04: Windows の条項に記載なし(requirements T-04)。どう扱うか(現状の注意書きのまま公開/Microsoft に問い合わせ)をユーザーが決める
- T-03 の論点整理(Via LA への問い合わせの要否)のあと、0.1.0: `/release` で出す。初回の CHANGELOG は前のタグ以降の差分ではなく、手で全体をまとめる
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 公開(0.1.0)前: T-03(Electron に H.264 のエンコーダー OpenH264・デコーダー FFmpeg が同梱されていること自体が対象。Via LA への問い合わせを検討)、T-04 の扱い
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
