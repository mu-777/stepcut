---
status: accepted
date: 2026-11-12
updated: 2026-11-16
tags: [infra, web]
---

# 紹介ページは site/ の静的ページを Cloudflare Workers で stepcut.mu-777.dev に置く(2026-11-12 決定)

エンドユーザー向けの紹介とダウンロードのページ(LP)の、置き場所・配り方・作り方の決定。アプリ本体のビルドとは独立。

## 決定

- ソースはこのリポジトリの `site/`。静的な HTML と CSS だけ(フレームワーク・JavaScript なし)
- 配信は Cloudflare Workers の静的アセット。Worker 名 `stepcut-lp`、Custom Domain `stepcut.mu-777.dev`(`site/wrangler.toml`)
- デプロイは Cloudflare の Workers Builds(Git 連携)。main への push で、`site/` に変更があれば `npx wrangler deploy` が走る。ルートディレクトリ・watch paths は Cloudflare のダッシュボード側の設定
- 見た目はアプリの配色(`#1e1f22` の地、青 `#4f8cff`)に合わせ、ブラウザの設定によらず暗い地で固定する。オレンジ `#ffb44d` は「使い方」の番号と蛍光ペンの絵だけ
- 構成: ヒーロー(大きなデモ動画)→ Before/After → できること(6 項目を絵で)→ 特徴 → 使い方(3 ステップを絵で)→ ダウンロード。「できること」「使い方」に操作のキーは書かない
- ダウンロードのボタンは `releases/latest/download/StepCut-Setup.exe`(portable 版は `StepCut-Portable.exe`)で最新のリリースを直接指す([20261116-release-flow.md](20261116-release-flow.md))
- 見出し・本文のフォントは Google Fonts の Zen Kaku Gothic New

## 理由

- ランニングコストゼロ(C1)。Workers の静的アセットと Workers Builds は無料の範囲で足りる。ドメインは既に Cloudflare にある
- サブドメインにすると、同じドメインのポートフォリオ(Worker `my-portfolio`)と経路が重ならず、設定は Custom Domain の 1 行で済む(DNS と証明書は Cloudflare が作る)
- Workers Builds は GitHub に API トークンを置かずに済む
- 1 ページで動きもないので、ビルドの要る仕組みは持たない。アプリの依存(package.json)にも足さない(wrangler は `site/package.json` だけ)

## 不採用案と理由(逆戻りガード)

- **`mu-777.dev/stepcut`(パスで分ける)** — Worker のルートと `assets.base_path` で実現でき、ルートは同じホストの Custom Domain より優先されるので共存もできる。ただしポートフォリオ側の割り当て方に依存し、設定が増える。ユーザーがサブドメインを選んだ
- **GitHub Actions + wrangler deploy** — `paths:` で条件を書けるが、Cloudflare の API トークンを GitHub Secrets に置く必要がある
- **GitHub Pages** — 独自ドメインを Cloudflare から向ける設定が別に要る。ほかのページと同じ Cloudflare にそろえた
- **案 B(アプリの画面を主役に、機能を 1 つずつ左右に並べる)/ 案 C(ページ全体を手順書の形に)** — ユーザーが案 A を選んだ。B・C は要る動画の本数が多い
- **OS のテーマに合わせた明るい配色** — アプリが暗い地だけなので、スクリーンショットと地をそろえる
- **OS 標準のフォントだけ** — 見出しの印象が OS で変わる。ポートフォリオも Google Fonts を使っている

## 前提と再検討の条件

- 動画・スクリーンショットは仮の絵(svg)。実物ができたら `.media` の中身を差し替える
- 最初のリリースを出すまで、ダウンロードのリンクは 404 になる
- コード署名をしていない(NF-08)ので、SmartScreen の警告の手順をページに書いている。署名をしたら消す
- 英語のページは作っていない。海外向けに出すなら足す
