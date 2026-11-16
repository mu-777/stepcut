---
status: accepted
date: 2026-10-29
updated: 2026-11-16
tags: [platform, export]
---

# UI 基盤は Electron(2026-10-29 決定)

デスクトップアプリの土台を Electron と Tauri のどちらにするかについての決定(要件 T-01)。描画・プレビュー・mp4 書き出しを WebCodecs で行う前提(エンコーダーの決定: [20261026-encoder.md](20261026-encoder.md))で、Windows と Mac の両方で同じ経路が使えるかを主な判断材料にした。

## 決定

Electron を使う。開発言語は TypeScript。描画はレンダラー(Chromium)上の WebGL / Canvas、エンコードは WebCodecs、mp4 の分解・組み立ては mediabunny(MPL-2.0。改変せずに使う限り Apache-2.0 の配布と両立する)で行う。OS 依存の処理(読み上げ、ファイル監視など)はメインプロセス側の差し替え可能な層に置く。

## 理由

| 観点 | Electron | Tauri |
|---|---|---|
| 表示部品 | Windows・Mac とも同梱の Chromium | Windows: WebView2(Chromium 系)、Mac: WKWebView(Safari 系) |
| 映像エンコード(VideoEncoder) | Chrome 94 相当以降で対応 | Windows は対応。Mac は Safari 16.4 以降 |
| 音声エンコード(AudioEncoder、AAC) | 対応。Windows は Media Foundation、Mac は OS のエンコーダーを使う | Mac は Safari 26 以降だけ。それより古い OS では AAC を Rust 側で別に実装する必要がある |
| H.264 のソフトウェア代替(T-02) | Chromium に OpenH264(BSD)が入っており、`proprietary_codecs` 有効のビルドで使われる。Electron はこれを有効にしてビルドしている | WebView2・WKWebView の挙動に依存し、制御できない |
| Win / Mac で見た目をそろえる(OUT-06、C2) | 同じエンジンなので差が出にくい | エンジンが違うため、描画差・対応差の検証が 2 系統になる |
| OS の読み上げ(TTS-01) | Node から別プロセスを呼ぶ(Windows: PowerShell 経由で WinRT、Mac: `say -o`) | Rust から WinRT を直接呼べる |
| 配布サイズ | 大きい(100MB 前後) | 小さい(数 MB〜) |
| 前例 | OpenScreen が Electron + WebCodecs で同じ構成(要件 10 章) | Cap は Tauri だが、描画・エンコードは Rust 側で行っており WebCodecs 前提ではない |

- 中核機能(プレビューと書き出しを同じ描画処理で行う、OUT-06)が、両 OS で同じエンジンに乗ることを最優先にした
- 妥協した点: 配布サイズとメモリ使用量。GitHub Releases での配布(NF-08)には支障がないと判断した
- 読み上げ(TTS-01)は Electron だと別プロセスを挟む。プラグインも別プロセスで動かす方針(NF-09)なので、内蔵エンジンも同じ形にすれば構造は統一できる

## 不採用案と理由(逆戻りガード)

- **Tauri** — Mac の WKWebView では AudioEncoder が Safari 26 からで、古い macOS では AAC エンコードを別に実装する必要がある。Windows と Mac でエンジンが異なり、OUT-06(見た目の一致)と C2(Mac 移植)の検証が二重になる
- **ネイティブ UI(Qt など)+ 独自の描画・エンコード** — Qt は LGPL/GPL・商用の選択になり、エンコードも自前で組む必要がある。C3・C7 に対して重い

## 前提と再検討の条件

- H.264/AAC の特許(T-03)は Electron でも解消しない。Chromium に入っている OpenH264 は Chromium が自前でビルドしたもので、Cisco がバイナリ配布に付けている特許ライセンスの対象外。Electron も同様。ハードウェアエンコーダーを優先し(`hardwareAcceleration: "prefer-hardware"`)、ソフトウェア代替も使う。特許は利用者の責任と明記して配布する([20261116-codec-patents.md](20261116-codec-patents.md))
- 実機確認待ち: Windows で `VideoEncoder.isConfigSupported()`(H.264)と `AudioEncoder.isConfigSupported()`(AAC)が true になること。Windows N エディションは Media Foundation が入っておらず、AAC が使えない
- 配布サイズやメモリが問題になった場合、または WKWebView の WebCodecs 対応が広がった場合は Tauri を再検討する

## 出典

- Web API の対応版(MDN browser-compat-data): VideoEncoder https://github.com/mdn/browser-compat-data/blob/main/api/VideoEncoder.json 、AudioEncoder https://github.com/mdn/browser-compat-data/blob/main/api/AudioEncoder.json(Chrome 94、Safari はそれぞれ 16.4 / 26)
- WebKit の AudioEncoder/AudioDecoder 実装(Cocoa): https://bugs.webkit.org/show_bug.cgi?id=265451
- Tauri の表示部品(Windows: WebView2、macOS: WKWebView): https://v2.tauri.app/reference/webview-versions/
- Electron のビルド設定(proprietary codecs を有効にした ffmpeg): https://github.com/electron/electron/blob/main/build/args/release.gn
- Chromium の OpenH264 有効条件(`media_use_openh264`): https://chromium.googlesource.com/chromium/src/+/main/media/media_options.gni
- Chromium の Media Foundation AAC エンコーダー: https://chromium.googlesource.com/chromium/src/+/705e9082e97f3ad583223a17a09a0fb865238851(Windows N では AAC 不可)
- Media Foundation AAC エンコーダーの仕様(LC のみ、44.1/48kHz): https://learn.microsoft.com/en-us/windows/win32/medfound/aac-encoder
- 組み込みブラウザでのコーデック特許の扱い(TeamDev): https://teamdev.com/dotnetbrowser/docs/guides/gs/media/
- MPL-2.0 のファイル単位の条件と、他ライセンスのコードとの組み合わせ(Larger Work): https://www.mozilla.org/en-US/MPL/2.0/FAQ/
- Windows の音声合成 API: https://learn.microsoft.com/en-us/uwp/api/windows.media.speechsynthesis.speechsynthesizer.synthesizetexttostreamasync
