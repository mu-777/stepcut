---
paths:
  - "src/renderer/**"
  - "site/**"
  - "scripts/make-lp-media.cjs"
---

# 紹介ページの動画と画像

- 紹介ページ(site/)の動画と編集画面の画像は、`scripts/make-lp-media.cjs` がアプリを実際に操作して作っている。画面の見た目・クラス名・操作の流れ・書き出しの見た目を変えたら、載っているものが古くなる。作り直すときはスキル `/lp-media`
- スクリプトは要素をクラス名で探す(`.rail-thumb` `.tl-bar` `.preview-add` `.caption-input` `.draw-layer` `.transport button.play` `.tb-btn.primary` など。一覧はスキルの Phase 3)。これらの名前を変えたら、スクリプトも同じ作業で直す
- `site/public/media/` のファイルは手で作らない・手で差し替えない(スクリプトで作り直せなくなる)。中身を変えるときはスクリプトか `site/media-src/` を直す
