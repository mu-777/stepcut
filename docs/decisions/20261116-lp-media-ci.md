---
status: accepted
date: 2026-11-16
updated: 2026-11-28
tags: [infra, web, ci]
---

# 紹介ページの動画は、PR のラベルで windows-latest の CI が作り直し、PR のブランチにコミットする(2026-11-16 決定)

紹介ページ(site/)の動画と画像(`site/public/media/`)を Windows で作る経路についての決定。クラウドセッション(Linux)で作ると読み上げが無音、フォントが Windows のものでない([docs/lp-media.md](../lp-media.md))ので、Windows の版を人の手元に頼らず作れるようにする。ページの構成は [20261112-landing-page.md](20261112-landing-page.md)。

## 決定

- `.github/workflows/lp-media.yml` が windows-latest で `scripts/make-lp-media.cjs` を日本語・英語の順に回す
- 起動は、PR に `lp-media` ラベルを付けたとき(同じリポジトリのブランチだけ)と、手動(`workflow_dispatch`)。終わったらラベルを外す。手動で main に対して回したときは、作るだけでコミットしない
- 読み上げは Azure AI Speech。鍵とリージョンはリポジトリの Secrets(`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`)に置き、CI のマシンの上で `scripts/ci-azure-settings.cjs` が safeStorage で暗号化してアプリの設定に書く。アプリ本体には CI 用の入口(鍵を環境変数から読むなど)を作らない
- 読み上げは、音声なしで載せる動画も含めてすべて Azure で作る(`LP_MUTED_SPEECH_ENGINE=azure`)。画面を撮る・録画するアプリにも同じ設定を写す(`LP_APP_ENGINES=default`)
- `--require-narration` で、OS 標準の声で代わりに読まれたら、また使い方の動画が Azure で読まれなかったら(無音)、失敗にしてコミットしない
- 結果は PR のブランチに `github-actions[bot]` がコミットする。ブランチの先頭が前回のこのワークフローのコミット(main に入っていないもの)なら置き換え(`--force-with-lease`)、そうでなければ新しく積む。確認用の場面の一覧・ログは Artifacts(`lp-media-check`)に置く
- Git LFS は使わない。動画はふつうの git のファイルのまま

## 理由

- エージェントのトークンでは `workflow_dispatch` を起動できない(AGENTS.md)。ラベルならエージェントからも付けられ、要るときだけ動く(1 回 20〜30 分と Azure の料金がかかるので、PR ごとに毎回は回さない)
- 結果をブランチに直接コミットすると、エージェントの作業からそのまま続けられる(Artifacts はエージェントから取り出せない)
- 鍵は safeStorage で暗号化したものしかアプリが読まない。暗号化の鍵はマシンとユーザーに結び付くので、CI の上で暗号化する。アプリに環境変数の入口を作ると、配布するアプリの鍵の扱いが広がる
- 履歴の増え方: 1 回で約 9 MB(日英の合計)。PR の中での回し直しは置き換えるので、main に残るのは PR ごとに 1 回分

- 音声なしの動画も Azure で読むのは、ランナー(Windows Server)の OS 標準の声が英語だけで、日本語の文を読ませると書き出しが止まるため([docs/handoff-os-tts-no-voice.md](../handoff-os-tts-no-voice.md))。音声を載せない動画のために文字数を使うが、無料枠の中に収まる量

## 不採用案と理由(逆戻りガード)

- **Git LFS で管理する** — 古い版も LFS の側に残り続け(消す手段がほぼない)、増え方は減らない。紹介ページを配る Cloudflare Workers Builds が LFS の実体を取るかの公式の記載が見つからず、取らなければ本番にポインタのファイルが載る。クラウドセッションで LFS の取得・push が通るかも未確認
- **Cloudflare R2 に置く** — git の履歴は増えないが、デプロイの形・URL・鍵(Cloudflare の API トークン)が増え、PR で作ったものが本番に先に出ないよう版を分ける仕組みも要る。履歴が重くなったら見直す
- **Artifacts に置き、人がコミットする** — エージェントから取り出せず、作業が人で止まる
- **site/ や src/renderer の変更がある PR で毎回動かす** — 時間と Azure の料金が毎回かかる
- **アプリが環境変数から Azure の鍵を読む** — CI のためだけに配布するアプリの入口が増える
- **ランナーに日本語の OS 標準の声を入れる** — `Add-WindowsCapability` で `Language.TextToSpeech~~~ja-JP` を入れても 15 分かかり、アプリが使う WinRT の声の一覧に出てこなかった(2026-11-26)

## 前提と再検討の条件

- GitHub のホストランナー(windows-latest)で、Electron の操作と録画、日本語のフォント(Yu Gothic UI)、画面の大きさが足りること。最初の実行で確かめる(ワークフローが解像度とフォントを表示する)
- `GITHUB_TOKEN` での push ではほかのワークフローが動かない。CI のコミットに対して build.yml は回り直さない(中身が動画と画像だけなので足りるとした)
- 履歴が重くなった(clone が遅い、リポジトリが数百 MB を超えた)ら、R2 に置く案を見直す
