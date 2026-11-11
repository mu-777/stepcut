---
paths:
  - "src/main/tts/**"
  - "src/main/settings.ts"
  - "src/renderer/src/engine-settings.tsx"
---

# 読み上げエンジン(VOICEVOX・Azure AI Speech)

決定: [docs/decisions/20261111-external-tts.md](../../docs/decisions/20261111-external-tts.md)。使い方の責任はユーザー側に置く。

- OS 標準以外のエンジンは既定で使えない。アプリの設定で同意した記録(`agreedAt`)がなければ `enabled` にしない(`sanitizeEngines`)。同意の確認を省く経路を作らない
- 知らせ(`notice`)・確認の文には「規約・料金を確認して従ってください」だけを書く。クレジット表記の例など、相手の規約の中身を書かない(相手が変えるとアプリも直すことになる)。規約のページへ直接つながず、サービスのトップを開く
- Azure の鍵は `settings.ts` の `secrets` に safeStorage で暗号化して置き、メインプロセスの中だけで使う。`getSettings` の結果・IPC・ログ・プロジェクトファイルに出さない(画面には `hasKey` だけ)
- 指定したエンジンを有効にしていなければ OS 標準で代わりに読む(`TtsService.pick`)。有効なのにつながらないのは失敗として返す(黙って OS の声にしない)
- E2E はアプリの設定を `test-output/ui/user-data` に置く(`--user-data-dir`)。開発者の設定にエンジンの同意を書き込まない
