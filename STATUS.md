# STATUS

## 更新
2026-11-23

## ブランチ
lp-media-windows

## ゴール
紹介ページの動画と画像を、今のアプリ(PR #29 の出力欄の変更後)で Windows から作り直す

## 現在地
- 日本語・英語の 2 組を Windows で作り直した(31 ファイル × 2)。使い方の動画は Azure の読み上げ入り。場面の一覧とページの読み込み(1280px・400px)は確認済み
- 紹介ページのフッター: Apache-2.0 の表記と mu-777.dev のリンクを外し、© mu-777 を mu-777.dev へのリンクに、Ko-fi の支援ボタンを追加(dayglassbar と同じ見た目)
- scripts/make-lp-media.cjs: 起動時に ELECTRON_RUN_AS_NODE を消す。Playwright の録画の始まりの遅れを、動画の長さから求めて時刻をそろえる

## 次にやること
- このブランチをコミットして PR にし、main にマージする
- 吸着の実機確認(Windows): ズームの枠を四角にそろえる、四角をテロップ・ほかの四角にそろえる。吸着が多すぎて邪魔でないか
- release の run・Release の本文・添付(`StepCut-Setup.exe`・`StepCut-Portable.exe`・THIRD_PARTY_NOTICES.md・LICENSE)・`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)
- main の残り: 紹介ページの英語の文面の確認、本番の `/`・`/ja/`・404 と言語の振り分けの確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 録画の遅れをそろえる処理は、遅れが出なかった回でしか動かしていない(遅れが出た回のずれは、回し直して解消した)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
