# STATUS

## 更新
2026-11-28

## ブランチ
claude/windows-video-ci-github-actions-upw54p(main 709f157 を取り込み済み)

## ゴール
紹介ページの動画と画像(site/public/media/)を GitHub Actions の Windows で作り直し、PR のブランチにコミットできるようにする(決定: docs/decisions/20261116-lp-media-ci.md)

## 現在地
- PR #34 の lp-media の CI(windows-latest、PR に lp-media ラベルで起動)が日英とも最後まで通り、site/public/media/ をブランチにコミットした(run 46148049678、コミット 36c42c3)
- 読み上げは CI ではすべて Azure(LP_MUTED_SPEECH_ENGINE・LP_APP_ENGINES)。ランナーに日本語の OS 標準の声がないため。その不具合は別の担当者に引き継ぎ(docs/handoff-os-tts-no-voice.md)
- 確かめた: 使い方の動画に日英とも音声あり、使い方・ヒーロー・app.png の場面を目で確認

## 次にやること
- ユーザー: 作り直した動画と画像の確認(PR #34 の Artifacts の sheets、ブランチの site/public/media/)。よければ PR #34 をマージする
- 別の担当者: docs/handoff-os-tts-no-voice.md の不具合

## 課題・ブロッカー
- tts の単体テストがときどき時間切れ、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認。以前から)

## 未決事項
- 履歴の増え方(1 回約 9 MB)が重くなったら R2 に移すかを見直す(決定記録の再検討の条件)
- 以前から: 英語の文面の確認、ステップの録画の選択欄の扱い、空の画面へのロゴ・初回の案内ほか(main の STATUS.md)
