---
paths:
  - "tests/e2e/**"
  - "src/renderer/**"
  - "src/main/**"
---

# Electron の動作確認(Linux コンテナ)

- root で動かすときは Electron に `--no-sandbox` を付ける(付けないと起動直後に落ちる)。アプリのコードには入れない
- 画面が要るので `xvfb-run -a` を付ける。dbus・Fontconfig のエラーログは無視してよい
- CLI 書き出しの確認: `npm run build` の後、`xvfb-run -a node_modules/.bin/electron . --no-sandbox export <project.json> --json`。結果の JSON は標準出力、Chromium のログは標準エラー
- この環境ではハードウェアエンコーダーと AAC エンコーダーがないため、映像はソフトウェア(OpenH264)、音声は Opus に代替され、警告が 2 つ出るのが正常。読み上げは無音で代替される
- Playwright からはメニューのショートカット(Ctrl+S など)が届かない。ボタンを押して操作する
- テスト用の録画は ffmpeg で作る(`tests/e2e/ui-smoke.cjs` 参照)。ffmpeg は開発環境の道具で、アプリには同梱しない
- 生成物は `test-output/`(git 管理外)に置く
- 書き出した mp4 のフレームを確かめるときは `ffmpeg -ss <秒> -i` (高速シーク)ではなく `-vf "select='eq(n\,<番号>)'"` で取り出す。高速シークで取り出したフレームには、元の動画にない帯などのずれが出ることがある
