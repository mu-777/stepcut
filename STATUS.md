# STATUS

## 更新
2026-11-12

## ブランチ
ccr-8e9e2e88-8odpdx(main 0012362 から。ロゴとアプリのアイコン、紹介ページ(LP)。未マージ・PR なし)

## ゴール
ロゴを決めてアプリのアイコンにし、紹介とダウンロードの LP を stepcut.mu-777.dev(Cloudflare Workers)に置く

## 現在地
- ロゴ: assets/logo/(マーク・アイコン用・白地・文字付きの SVG)。決定は docs/decisions/20261112-logo.md
- アイコン: build/icon.ico(scripts/make-icon.cjs で生成)。package.json の build.win.icon に指定
- LP: site/(静的 HTML + CSS、wrangler.toml は Custom Domain stepcut.mu-777.dev)。動画・画像は仮の絵(svg)。決定は docs/decisions/20261112-landing-page.md
- 確認: npm run check、wrangler dev で表示(PC・タブレット・スマホ幅、横スクロールなし・コンソールエラーなし)、wrangler deploy --dry-run。アプリのコード(src/)は変えていない
- 未確認: Windows でのアイコンの見え方(タスクバー・インストーラ)、本番のデプロイ

## 次にやること
- ユーザー: main にマージ後、Cloudflare の Workers & Pages でリポジトリを取り込む(Worker 名 stepcut-lp、ルート site、watch paths site/*。README の「紹介ページ」)。https://stepcut.mu-777.dev の表示を確認
- ユーザー: デモ動画・スクリーンショットを用意(ヒーロー 1、Before/After 2、できること 6、使い方 3)。届いたら site/public/index.html の .media の中身を差し替える
- リリースのワークフロー(別作業)ができたら、LP のダウンロードの先を releases/latest/download/ の固定名にする
- main の残り: 設定パネルの選択欄の実機確認、ステップの録画の選択欄の扱い、リポジトリ名、商標確認、docs/manual-test.html の実機確認、M2 の PRJ-03

## 課題・ブロッカー
- tts の単体テストが、初回の実行(変換のキャッシュなし)で 1 件落ちることがあった(再実行で通る。原因は未確認)
- ui-smoke は全項目のあと、最後の app.close() で終わらないことがある(原因は未確認。項目はすべて通る)

## 未決事項
- ロゴ・名前の商標と類似は未確認
- ステップの録画の選択欄: ファイル名だけにしてフルパスはツールチップか、画像付きの一覧か、触らないか
- 保留(ユーザーが検討中): 初回の案内・チュートリアル
- 見送り: frame の複数時刻(--every)、録画の長さを返すコマンド。設定パネルの内部の表現(0〜1 など)と操作の見つけにくさ
- 仮決め: 拡張子 .stepcut.json、プラグイン名 stepcut。以前から: 読み上げのキャッシュ 500MB ほか、移行の判定(#17)、CI で ui-smoke(#19)、T-02・U-01・U-04・T-03・T-04・T-08
