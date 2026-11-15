# STATUS

## 更新
2026-11-15

## ブランチ
claude/lp-design-refresh-j4toug(main 0209a60 から。紹介ページの作り直し)

## ゴール
紹介ページ(site/)の構成・見た目・文面を作り直し、動画と編集画面の画像を StepCut 自身で作ったものにする

## 現在地
- 実装済み: site/public の index.html・styles.css を作り直し(構成と決まりは docs/decisions/20261112-landing-page.md)
- 動画 5 本・字幕・編集画面の画像を scripts/make-lp-media.cjs で作り、site/public/media/ に置いた(手順は docs/lp-media.md)
- 何のツールかを「録画を、説明付きの動画に」と言う形に直した(LP と README)。機能の節は、使いみちの 3 例(操作の手順・製品のデモ・資料の解説)に置き換えた
- 使い方の動画: プレビュー上のテロップ入力、ズームの枠と再生での確認、四角の配置、8 倍の早送りを入れた。プロジェクトは test-output/lp-howto/ に出し、--howto-export で書き出し直せる
- 確認: npm run check、ページの表示(1280px・400px)、動画のシーク(範囲指定に応えるサーバーで)。アプリのコードは変えていないので ui-smoke は回していない

## 次にやること
- ユーザー: Windows で Azure の鍵を入れ、`node scripts/make-lp-media.cjs` を回す(docs/lp-media.md の「Azure の読み上げを入れる」。Windows での実行は未確認)。使い方の動画を手で直して --howto-export。本番で動画のシークができるかも確認(Range に 206 が返るか)
- main の残り: リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- いまの動画と画像は Linux のコンテナ製(文字が Windows のフォントでない、読み上げが無音、使い方の動画の最後にその知らせと Linux のパスが映る)。`wrangler dev` では使い方の動画をシークできない
- tts の単体テストが初回に 1 件落ちることがある、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- AGENTS.md と docs/requirements.md の目的は「手順書動画を作る」のまま(LP・README と言い方が違う。直すかは未決)
- ページの記述のうち、実装済みか未確認のもの: フラッシュでの場面の切り替え、「ほかにも」の 4 項目。OGP 画像(og.png)は前の書体のまま
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、ヘルプの「StepCut について」、インストーラーのヘッダー画像、初回の案内、frame の --every、拡張子 .stepcut.json ほか
