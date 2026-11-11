---
status: accepted
date: 2026-10-29
tags: [build, ci]
---

# Windows 版は electron-builder で作り、PR ごとに GitHub Actions でビルドする(2026-10-29 決定)

Windows 向け配布物の作り方と、開発中の動作確認用バイナリをどこで作るかについての決定。リリース(タグ・GitHub Releases)の手順はまだ決めていない。

## 決定

- パッケージ化は electron-builder(MIT)。Windows はインストーラ(nsis)と portable の 2 種類。コード署名はしない(NF-08)
- `.github/workflows/build.yml` が base=main の PR(と手動実行)で windows-latest 上でビルドし、Artifacts `stepcut-win` に置く。PR 本文には run のリンクを貼る(スキル `/pr-build`)
- lint・型チェック・テストは同じワークフローの Linux ジョブで回す

## 理由

- 開発環境(クラウドセッションの Linux コンテナ)から Windows の実機確認用バイナリを出す手段が要る
- 同じ作者の dayglassbar(Electron + electron-builder)で同じ仕組みが動いている実績がある
- Windows ランナーは checkout で改行が CRLF になり、Biome の format 確認が落ちるため、確認系は Linux に分けた

## 不採用案と理由(逆戻りガード)

- **コンテナ内で `electron-builder --win`** — nsis/portable の作成に Wine が要り、環境に入っていない
- **エージェントから `workflow_dispatch` でビルド** — エージェントのトークンに Actions の write が無く 403 になる。PR トリガを外すとエージェントから Windows ビルドを出す手段がなくなる
- **PR にバイナリを添付** — PR へのファイル添付は Web UI 専用で、`.exe` は許可されていない

## 前提と再検討の条件

- Mac 版を出す段階(M3)で macos ランナーのジョブを足す
- 匿名でダウンロードできるリンクが必要になったら、Artifacts ではなく GitHub Releases(プレリリース)を使う
