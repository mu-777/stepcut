# STATUS

## 更新
2026-11-16

## ブランチ
main(adb2df5。v0.1.0 を公開済み)

## ゴール
v0.1.0 を公開した。次の版に向けて main の残りを片付ける

## 現在地
- v0.1.0 を GitHub Releases に公開(2026-11-16)。release の run が緑、本文は CHANGELOG の節と同じ、`StepCut-Setup.exe`・`StepCut-Portable.exe` を添付、`releases/latest/download/StepCut-Setup.exe` が v0.1.0 を指すことを確認
- PR の Windows ビルドはラベル `build` を付けたときだけ(Artifacts は 7 日保存)

## 次にやること
- ユーザー: Release の exe を Windows で入れて起動し、インストール先と Portable に THIRD_PARTY_NOTICES.md・LICENSE があるか見る。紹介ページのダウンロードのボタンで落とせるかも見る
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
