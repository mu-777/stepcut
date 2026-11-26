---
status: accepted
date: 2026-11-16
tags: [tts, license]
---

# OS 標準の声の商用利用は利用者の確認に任せる(2026-11-16 決定)

OS 標準の音声合成(Windows は WinRT の `Windows.Media.SpeechSynthesis`)で作った読み上げを、商用の動画に使ってよいかの扱い(要件 T-04)。

## 決定

アプリとしては可否を判断しない。書き出し時に、使ったエンジンの利用条件を確認するよう知らせる今の注意書き(`osNotice`)のまま公開する。

## 理由

- Windows 11 のライセンス条項(2024-04 版、https://www.microsoft.com/en-us/useterms )に、読み上げの声やその出力についての条項がない。許可も禁止も書かれていない。商用不可と明記されているのは Word・Excel・PowerPoint・OneNote だけ(1.b.iv)
- Microsoft Q&A の回答は非公式(社員ではない)で、食い違う
  - https://learn.microsoft.com/en-us/answers/questions/326449/using-microsoft-tts-for-commercial-use
  - https://learn.microsoft.com/en-us/answers/questions/5884453/licensing-constraints-for-commercial-ai-training-a
- アプリが断定できる根拠がないので、判断は利用者に任せ、確認を促すにとどめる

## 不採用案と理由(逆戻りガード)

- **商用なら VOICEVOX や Azure を勧める一文を案内に足す** — 注意書きが重くなり、くどい
- **Microsoft に問い合わせる** — 回答が来るか・いつ来るかが分からず、公開を止める理由にならない

## 前提と再検討の条件

- Microsoft が読み上げの出力について公式に明記したら見直す
- Mac に対応するときは、macOS のライセンス条項(`say` の声)を別に確認する
