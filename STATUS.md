# STATUS

## 更新
2026-11-14

## ブランチ
claude/lp-design-refresh-j4toug(main 0209a60 から。紹介ページの作り直し)

## ゴール
紹介ページ(site/)の構成・見た目・文面を作り直し、動画と編集画面の画像を StepCut 自身で作ったものにする

## 現在地
- 実装済み: site/public の index.html・styles.css を作り直し(構成と決まりは docs/decisions/20261112-landing-page.md)
- 動画 4 本と編集画面の画像を scripts/make-lp-media.cjs で作り、site/public/media/ に置いた(手順は docs/lp-media.md)
- 確認: npm run check、ページの表示(1280px・400px。横はみ出し・読み込み失敗なし)。アプリのコードは変えていないので ui-smoke は回していない

## 次にやること
- ユーザー: ページの見た目と文面を確認(`cd site && npm install && npx wrangler dev`)。よければ main に入れる
- ユーザー: Windows で `node scripts/make-lp-media.cjs` を回し、動画と画像を差し替える(Windows での実行は未確認)
- main の残り: リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- いまの動画と画像は Linux のコンテナ製(文字が Windows のフォントでない、読み上げが無音、使い方の動画の最後にその知らせと Linux のパスが映る)
- tts の単体テストが初回の実行で 1 件落ちることがあった、ui-smoke が最後の app.close() で終わらないことがある(どちらも原因は未確認)

## 未決事項
- ページの記述のうち、実装済みか未確認のもの: フラッシュでの場面の切り替え、「ほかにも」の 4 項目。OGP 画像(og.png)は前の書体のまま
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、ヘルプの「StepCut について」、インストーラーのヘッダー画像、初回の案内、frame の --every、拡張子 .stepcut.json ほか
