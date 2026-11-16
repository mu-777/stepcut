---
paths:
  - "src/renderer/**"
  - "site/**"
  - "scripts/make-lp-media.cjs"
---

# 紹介ページの動画と画像

- 紹介ページ(site/)の動画と編集画面の画像は、`scripts/make-lp-media.cjs` がアプリを実際に操作して作っている。画面の見た目・クラス名・操作の流れ・書き出しの見た目を変えたら、載っているものが古くなる。作り直すときはスキル `/lp-media`
- スクリプトは要素をクラス名で探す(`.rail-thumb` `.tl-bar` `.preview-add` `.caption-input` `.draw-layer` `.transport button.play` `.tb-btn.primary` など。一覧はスキルの Phase 3)。これらの名前を変えたら、スクリプトも同じ作業で直す
- ページは英語(`site/public/index.html`、`/`)と日本語(`site/public/ja/index.html`、`/ja/`)の 2 枚。片方の文・構成・動画の参照を変えたら、もう片方も同じ作業で直す(ビルドで生成していないので、ずれを防ぐものはない)。動画は英語が `media/en/`、日本語が `media/`
- 英語のページの `<head>` に言語の振り分けの JS があり、言語リンクの `onclick` が localStorage の `stepcut-lang` に選んだ言語を保存する。言語リンクを作り直すときはこれを残す
- 例の画面(`site/media-src/*.html`)の文字は、日本語を本文に、英語を `data-en` に書く(`?lang=en` で切り替わる)。文字を足したら両方を書く
- `site/public/media/` のファイルは手で作らない・手で差し替えない(スクリプトで作り直せなくなる)。中身を変えるときはスクリプトか `site/media-src/` を直す
