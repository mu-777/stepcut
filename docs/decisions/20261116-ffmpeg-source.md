---
status: accepted
date: 2026-11-16
tags: [license]
---

# Electron 内蔵の FFmpeg のソースは入手先を示す(2026-11-16 決定)

Electron が同梱する FFmpeg(Chromium のビルド、LGPL-2.1-or-later、`ffmpeg.dll`)を配布するときの、ソースの提供(LGPL-2.1 §4)の扱い。

## 決定

THIRD_PARTY_NOTICES.md に、Electron の版 → Chromium の版 → FFmpeg のコミットと、そのソースの場所(chromium.googlesource.com)を書く。ソース自体は配らない。Electron を上げたら書き直す(`.claude/rules/dependencies.md`)。

## 理由

- FFmpeg は別の DLL として動的にリンクされ、LGPL 版でライセンス文も `LICENSES.chromium.html` に入っている。残る義務はソースの提供だけ
- 作業が小さい。同種のツール(OpenScreen の引き継ぎ版)と同じ水準。Electron のアプリの多くは何もしていない
- 妥協した点: LGPL-2.1 §4 は「バイナリと同じ場所から同等に入手できること」を求める。他者のサーバーを指すだけでは文面どおりには満たさない

## 不採用案と理由(逆戻りガード)

- **GitHub Release に FFmpeg のソースのアーカイブも置く** — §4 を満たすが、リリースの作業(CI)が増える。まず入手先の明記で公開する。満たす必要が出たらこれに進む
- **ソースを配布物に同梱する(Recordly 方式)** — インストーラーが大きくなる

## 前提と再検討の条件

- ソースの提供を求められた、または chromium.googlesource.com の入手先が使えなくなったら、GitHub Release にアーカイブを置く案に進む
- Electron 以外の FFmpeg を同梱するようになったら見直す
