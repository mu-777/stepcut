# STATUS

## 更新
2026-11-26

## ブランチ
claude/windows-video-ci-github-actions-upw54p(main 709f157 を取り込み済み)

## ゴール
紹介ページの動画と画像(site/public/media/)を GitHub Actions の Windows で作り直し、PR のブランチにコミットできるようにする(決定: docs/decisions/20261116-lp-media-ci.md)

## 現在地
- .github/workflows/lp-media.yml(PR #34 に lp-media ラベルで起動、windows-latest、日英、PR ブランチにコミット。前回の CI コミットは置き換え)、scripts/ci-azure-settings.cjs、make-lp-media.cjs の --require-narration を作った
- CI で確かめた: 解像度の変更(1024x768→1920x1080)、Yu Gothic UI あり、Azure の鍵の暗号化と設定の書き込み、ラベルを外す
- 止まっている: ランナーに日本語の OS 標準の声がなく、日本語の読み上げの付いた書き出しが `Unable to decode audio data` で止まる。アプリの不具合として別の担当者に引き継いだ(docs/handoff-os-tts-no-voice.md)

## 次にやること
- 別の担当者: docs/handoff-os-tts-no-voice.md の修正(Windows で声がないときの OS 標準のエンジン)
- その修正を main に取り込んだら: lp-media.yml の「OS 標準の声」のステップを一覧の表示だけにし(日本語の声を入れる処理と止める処理を外す)、PR #34 に lp-media ラベルを付けて回し直す。通ったら sheets を見て、ブランチに積まれたコミットを確かめる

## 課題・ブロッカー
- 上の OS 標準の声の不具合(引き継ぎ済み)。直るまで lp-media の CI は日本語の組で止まる
- tts の単体テストがときどき時間切れ、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認。以前から)

## 未決事項
- 履歴の増え方(1 回約 9 MB)が重くなったら R2 に移すかを見直す(決定記録の再検討の条件)
- 以前から: 英語の文面の確認、ステップの録画の選択欄の扱い、空の画面へのロゴ・初回の案内ほか(main の STATUS.md)
