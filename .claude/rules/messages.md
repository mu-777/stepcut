---
paths:
  - "src/main/**/*.ts"
  - "src/core/validate.ts"
  - "src/shared/messages.ts"
  - "src/renderer/src/i18n.ts"
  - "src/renderer/src/exporter.ts"
  - "src/renderer/src/cli-jobs.ts"
  - "src/renderer/src/media.ts"
---

# 利用者に出すエラー・警告の文言

(docs/decisions/20261116-message-i18n.md)

- 日英を併記した文、日本語だけの文を直書きしない。`src/shared/messages.ts` の `MESSAGE_EN` にコードと英語の文を足し、`src/renderer/src/i18n.ts` の `MESSAGE_JA` に日本語を足す(抜けると型チェックで落ちる)
- メインで投げるエラーは `new AppError(code, params)`。IPC は `index.ts` の `handle()` で登録する(`ipcMain.handle` を直接使うとコードが画面に届かない)
- 画面でエラーを文にするときは `errorText(e)`(`(e as Error).message` を出さない)。`Msg` は `msgText(m)`
- メインのダイアログ・メニューの文字は `src/main/i18n.ts` の `mt()`
- CLI の出力は英語。メインの CLI は `formatEn`、書き出しの非表示の画面は言語が en なので `msgText` のままでよい
- `path`(`steps[0].zooms[1].end` など)は訳さない
