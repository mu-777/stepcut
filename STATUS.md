# STATUS

## 更新
2026-11-15

## ブランチ
ccr-3af7821f-jucw34(main 1757b6a から。紹介ページの英語対応)

## ゴール
紹介ページ(site/)を英語と日本語の 2 言語にする(英語が `/`、日本語が `/ja/`)

## 現在地
- 実装済み: 英語のページ `site/public/index.html`、日本語のページを `site/public/ja/index.html` に移動、相互リンク・hreflang・og:locale、404 を 2 言語併記、OGP 画像を言語別(`og.png` 英語 / `og-ja.png` 日本語)
- `scripts/make-lp-media.cjs --lang en` で英語の動画・画像を `site/public/media/en/` に作る。例の画面(`site/media-src/`)は `?lang=en` で英語になる
- 英語の動画・画像は Linux のコンテナで作成済み(使い方の動画は無音)。日本語の動画は作り直していない
- 決定記録・docs/lp-media.md・スキル lp-media・.claude/rules/lp-media.md・README を更新
- 確認: npm run check、ページの表示(1280px・400px、英日とも横はみ出しなし)、英語の動画の場面の一覧

## 次にやること
- ユーザー: 英語の文面の確認。Windows で `node scripts/make-lp-media.cjs` と `--lang en` を回し、音声付きの使い方の動画を作る(docs/lp-media.md)
- 本番で `/`・`/ja/`・存在しない URL(404)を開き、動画のシーク(Range に 206)を確かめる
- main の残り: リリースのワークフロー、設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- いまの動画と画像は Linux のコンテナ製(文字が Windows のフォントでない、読み上げが無音、使い方の動画の最後にその知らせと Linux のパスが映る)
- tts の単体テストが初回に 1 件落ちることがある、ui-smoke が最後の app.close() で終わらないことがある(原因は未確認)

## 未決事項
- 英語の文面は仮(ネイティブの確認なし)。英語の読み上げの声は仮に en-US-JennyNeural
- 例の画面の英語版の人名(Alex Kim)・金額(USD)は仮
- AGENTS.md と docs/requirements.md の目的は「手順書動画を作る」のまま(LP・README と言い方が違う。直すかは未決)
- ページの記述のうち、実装済みか未確認のもの: フラッシュでの場面の切り替え、「ほかにも」の 4 項目
- 見送り・保留・仮決め(以前から): 空の画面へのロゴ、ヘルプの「StepCut について」、インストーラーのヘッダー画像、初回の案内、frame の --every、拡張子 .stepcut.json ほか
