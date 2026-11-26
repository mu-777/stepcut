# STATUS

## 更新
2026-11-26

## ブランチ
claude/windows-video-ci-github-actions-upw54p(main 709f157 を取り込み済み)

## ゴール
紹介ページの動画と画像(site/public/media/)を GitHub Actions の Windows で作り直し、PR のブランチにコミットできるようにする(決定: docs/decisions/20261116-lp-media-ci.md)

## 現在地
- .github/workflows/lp-media.yml(PR に lp-media ラベルで起動、windows-latest、日英、PR ブランチにコミット。前回の CI コミットは置き換え。確認用 Artifacts は 7 日)を作った
- scripts/ci-azure-settings.cjs(Secrets の鍵を safeStorage で暗号化して設定に書く)、make-lp-media.cjs に --require-narration
- 確認: npm run check。コミットの置き換えの処理はローカルの仮リポジトリで確かめた。CI での実行は未確認
- main の紹介ページの動画は、手元の Windows で作り直したもの(読み上げ入り)

## 次にやること
- ユーザー: Secrets に AZURE_SPEECH_KEY と AZURE_SPEECH_REGION を入れる
- PR を作り lp-media ラベルを付けて 1 回目を回す。失敗したらログ(解像度・フォント・Azure の設定・スクリプトの Windows での動き)を見て直す
- main の残りは main の STATUS.md を見る

## 課題・ブロッカー
- windows-latest の解像度・Yu Gothic UI の有無・safeStorage の動きは未確認(Linux では safeStorage が使えず試せない)
- tts の単体テストがときどき時間切れ、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認。以前から)

## 未決事項
- 履歴の増え方(1 回約 9 MB)が重くなったら R2 に移すかを見直す(決定記録の再検討の条件)
- 以前から: 英語の文面の確認、ステップの録画の選択欄の扱い、空の画面へのロゴ・初回の案内ほか(main の STATUS.md)
