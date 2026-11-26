---
status: accepted
date: 2026-10-29
updated: 2026-11-16
tags: [build, ci]
---

# Windows 版は electron-builder で作り、PR にラベルを付けたときに GitHub Actions でビルドする(2026-10-29 決定)

Windows 向け配布物の作り方と、開発中の動作確認用バイナリをどこで作るかについての決定。リリース(タグ・GitHub Releases)の経路は [20261116-release-flow.md](20261116-release-flow.md)。

## 決定

- パッケージ化は electron-builder(MIT)。Windows はインストーラ(nsis)と portable の 2 種類。コード署名はしない(NF-08)
- `.github/workflows/build.yml` が base=main の PR にラベル `build` を付けたとき(と手動実行)に windows-latest 上でビルドし、Artifacts `stepcut-win`(保存 7 日)に置く。作り直すにはラベルを外して付け直す。push のたびには作り直さない。lint・型チェック・テストの `check` は PR の作成・push のたびに回す。PR 本文には run のリンクを貼る(スキル `/pr-build`)。このビルドの version には短い SHA を足す(`0.1.0-g1a2b3c4`)
- 配布物の名前は `StepCut-Setup.exe` / `StepCut-Portable.exe` に固定する(版は含めない)
- lint・型チェック・テストは同じワークフローの Linux ジョブで回す

## 理由

- 開発環境(クラウドセッションの Linux コンテナ)から Windows の実機確認用バイナリを出す手段が要る
- PR ごと・push ごとにビルドすると、Artifacts(exe 2 本、既定 90 日保存)がアカウントの容量(Free プランで 500MB、Packages と共用)をすぐ使い切る。2026-11-16 に満杯になり、Artifacts を経由するリリースの publish も通らなくなった
- 同じ作者の dayglassbar(Electron + electron-builder)で同じ仕組みが動いている実績がある
- Windows ランナーは checkout で改行が CRLF になり、Biome の format 確認が落ちるため、確認系は Linux に分けた

## 不採用案と理由(逆戻りガード)

- **コンテナ内で `electron-builder --win`** — nsis/portable の作成に Wine が要り、環境に入っていない
- **エージェントから `workflow_dispatch` でビルド** — エージェントのトークンに Actions の write が無く 403 になる。PR トリガを外すとエージェントから Windows ビルドを出す手段がなくなる
- **PR の作成・push のたびにビルド**(2026-11-16 まで)— 頼んでいないビルドで Artifacts の容量が満杯になる。上の理由を参照
- **PR のコメント(`/build`)で起動** — issue_comment は既定ブランチの workflow で動くので、PR の head の取り出しと、誰のコメントで走らせるかの確認が要り、複雑になる
- **PR にバイナリを添付** — PR へのファイル添付は Web UI 専用で、`.exe` は許可されていない

## 前提と再検討の条件

- Mac 版を出す段階(M3)で macos ランナーのジョブを足す
