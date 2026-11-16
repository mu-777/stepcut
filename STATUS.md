# STATUS

## 更新
2026-11-16

## ブランチ
claude/modest-bell-i9i81a(main adb2df5 から。PR #25。PR #23・#24 はマージ済み)

## ゴール
紹介ページの不具合を直し、言語を自動で振り分ける。v0.1.0 のリリースの結果を確かめる

## 現在地
- 英語の紹介ページの「使い方」動画の字幕のパスを直した(`/media/en/en/howto.vtt` → `/media/en/howto.vtt`)。headless ブラウザーで両言語の字幕が読み込まれる(9 キュー)ことを確認
- PR #24 → #23 はマージ済み。Release ができたかは未確認
- 紹介ページの言語の自動振り分けを入れた(`/` で日本語のブラウザーなら `/ja/` へ。言語リンクで選んだ言語を localStorage に覚える)。headless ブラウザーで 14 通りを確認、決定記録 20261112-landing-page を書き換えた

## 次にやること
- release の run が緑か、Release の本文が CHANGELOG の 0.1.0 の節と同じか、`StepCut-Setup.exe`・`StepCut-Portable.exe` が添付されているか、`releases/latest/download/StepCut-Setup.exe` が 0.1.0 を指すかを確認(スキル `/release` の Phase 5)。配布物に THIRD_PARTY_NOTICES.md・LICENSE があるかも見る
- PR #25 をマージし、本番で `/` の振り分けを日本語・英語のブラウザーで確認する
- main の残り: 紹介ページの英語の文面の確認と Windows での動画作成(docs/lp-media.md)、本番の `/`・`/ja/`・404 の確認、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)
- tts の単体テスト(タイムアウトの待ち行列)が npm run check でときどき 5 秒の時間切れで落ちる、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面(メッセージ・紹介ページ)はネイティブの確認なしで仮。紹介ページの英語の声(en-US-JennyNeural)・例の人名と金額は仮。AGENTS.md と requirements の目的の言い方(直すかは未決)
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
