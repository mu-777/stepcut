# STATUS

## 更新
2026-11-16

## ブランチ
claude/windows-video-ci-github-actions-upw54p(main 4a46d3d から)

## ゴール
紹介ページの動画と画像(site/public/media/)を GitHub Actions の Windows で作り直し、PR のブランチにコミットできるようにする(決定: docs/decisions/20261116-lp-media-ci.md)

## 現在地
- .github/workflows/lp-media.yml(PR に lp-media ラベルで起動、windows-latest、日英、PR ブランチにコミット。前回の CI コミットは置き換え)を作った
- scripts/ci-azure-settings.cjs(Secrets の鍵を safeStorage で暗号化して設定に書く)、make-lp-media.cjs に --require-narration
- 確認: npm run check。コミットの置き換えの処理はローカルの仮リポジトリで確かめた。Windows での実行は未確認

## 次にやること
- ユーザー: Secrets に AZURE_SPEECH_KEY と AZURE_SPEECH_REGION を入れる
- PR を作り lp-media ラベルを付けて 1 回目を回す。失敗したらログ(解像度・フォント・Azure の設定・スクリプトの Windows での動き)を見て直す
- 成功したら、作り直したもので docs/lp-media.md の「いまのファイルについて」と STATUS の課題を直す
- main の残り: 紹介ページの英語の文面の確認、本番の `/`・`/ja/`・404 の確認、リリースのワークフロー、設定パネルの選択欄の実機確認、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03、Windows 実機での多言語のダイアログの確認

## 課題・ブロッカー
- 紹介ページの動画と画像は Linux のコンテナ製(Windows のフォントでない、読み上げが無音)。CI の 1 回目待ち
- windows-latest の解像度・Yu Gothic UI の有無・safeStorage の動きは未確認(Linux では safeStorage が使えず試せない)
- tts の単体テストがときどき 5 秒の時間切れ、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 履歴の増え方(1 回約 9 MB)が重くなったら R2 に移すかを見直す(決定記録の再検討の条件)
- メッセージ・紹介ページの英語の文面は仮(ネイティブの確認なし)。英語の声(en-US-JennyNeural)・例の人名と金額も仮
- ロゴ・名前の商標と類似は未確認。ステップの録画の選択欄の扱い
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、「StepCut について」、初回の案内、frame の --every、拡張子 .stepcut.json、読み上げのキャッシュ 500MB ほか
