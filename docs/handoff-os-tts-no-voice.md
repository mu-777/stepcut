# 引き継ぎ: Windows で、テロップの言語の OS 標準の声がないと書き出しが止まる

作成: 2026-11-26。PR #34(紹介ページの動画を CI の Windows で作る)の作業中に見つかった。このファイルは問題の提起まで。直し方は担当者が決める。直したらこのファイルは消す(経緯は git log と PR に残る)。

## 症状

読み上げ(エンジンは OS 標準)の付いたプロジェクトを Windows で書き出すと、次のエラーで止まる。

```
NG Cannot create the narration: turn-on-mail: Unable to decode audio data; open-settings: Unable to decode audio data; save: Unable to decode audio data
```

- 出る場所: `src/renderer/src/exporter.ts:49`(`speechFailed`)。もとは `src/renderer/src/speech.ts` の `decodeWav`(`OfflineAudioContext.decodeAudioData`)の例外
- `turn-on-mail` などは、読み上げの付いたステップの id

## 再現条件

| 条件 | 内容 |
|---|---|
| OS | Windows。確認できたのは GitHub Actions の `windows-latest`(Windows Server。WinRT の声は英語の David・Zira・Mark だけ) |
| 声 | 読み上げる文の言語(日本語)の WinRT の声(OneCore)が入っていない |
| プロジェクト | `speech.engine` が OS 標準(指定なしを含む)で、日本語の読み上げがある(テロップを読む `speech: {}` も含む) |
| 手順 | `electron . export <project> --out out.mp4`(CLI)。画面からの書き出しでも同じになるはず(未確認) |

手元の日本語版 Windows(日本語の声あり)では起きない。同じスクリプトで作った動画が main に入っている。

### 再現のしかた

- CI: PR #34 のブランチの `.github/workflows/lp-media.yml` から「OS 標準の声」のステップを外し、PR に `lp-media` ラベルを付ける。日本語の組の最初の書き出し(hero)で止まる。ログの例: https://github.com/mu-777/stepcut/actions/runs/45877854077
- 手元: 英語版の Windows か、日本語の声を外した Windows(設定 → 時刻と言語 → 音声 で日本語の音声を消す)で、日本語のテロップに `speech: {}` を付けたプロジェクトを書き出す

## 分かっていること

- ランナーの声(4 回目の run のログ。https://github.com/mu-777/stepcut/actions/runs/45879877950 ):
  - 最初から入っていたのは `en-US Microsoft David` / `Zira` / `Mark` だけ。`Language.TextToSpeech~~~en-US` は Installed、`~~~ja-JP` は NotPresent
  - `Add-WindowsCapability` で `Language.TextToSpeech~~~ja-JP` を入れると 15 分かかり、終わっても WinRT の `SpeechSynthesizer.AllVoices` に日本語の声は出てこなかった(再起動が要るなどの理由が考えられる。未確認)。ランナーに声を入れて避ける手は使えない
- Linux では OS 標準のエンジンが無音を返すので、この問題は起きない(`src/main/tts/os-engine.ts` の `silentEngine`。1 文字 0.15 秒、最短 0.5 秒。知らせは `osSilentNotice`)
- Windows のエンジン(`windowsEngine`)は、PowerShell 5.1 から WinRT の `SpeechSynthesizer.SynthesizeTextToStreamAsync` を呼び、出てきたバイト列をそのまま WAV として返す。中身を確かめていない

## 推定原因(未確認)

日本語の声がないため、既定の英語の声で日本語の文を読ませ、空(長さ 0、または WAV のヘッダーだけ)のストリームが返っている。`windowsEngine` はそれをそのまま返し、レンダラーの `decodeAudioData` が読めずに例外になる。

確かめ方: 上の条件の Windows で `os-engine.ts` の `WINDOWS_SCRIPT` を直接回し(`speak` モード、日本語の文)、出力の `out.wav` の大きさと先頭のバイトを見る。`$stream.Size` が 0 かどうかも見る。

## 未確認の点

- 空の音声が返っているか(上の推定)
- 画面からの書き出し・試聴でも同じになるか
- 失敗した読み上げが、読み上げのキャッシュ(`src/main/tts/service.ts`)に残るか
- 日本語以外でも、文の言語の声がなければ同じになるか

## 影響

- 文の言語の声がない Windows(英語版の Windows、Windows Server など)のユーザーは、OS 標準の読み上げを付けたプロジェクトを書き出せない。エラーの文からは原因(声がないこと)が分からない
- PR #34 の CI(`.github/workflows/lp-media.yml`)では、日本語の組の最初の書き出しで止まった。CI は読み上げをすべて Azure にして避けている(この問題そのものは残っている)

## 関係するファイル

| ファイル | 役割 |
|---|---|
| `src/main/tts/os-engine.ts` | OS 標準のエンジン(Windows・Mac・無音) |
| `src/main/tts/service.ts` | エンジンの選び方・代替・キャッシュ |
| `src/renderer/src/speech.ts` | 音声の読み込み(`decodeWav`) |
| `src/renderer/src/exporter.ts` | 書き出し。読み上げの失敗をエラーにする |
| `.github/workflows/lp-media.yml`(PR #34) | 紹介ページの動画を Windows で作る CI |
| `scripts/make-lp-media.cjs` | 紹介ページの動画を作るスクリプト。音声なしの動画も OS 標準の声で読んで長さを決める |
