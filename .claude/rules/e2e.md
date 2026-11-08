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

## Windows のローカルで動かすとき

- VS Code の中のターミナル・拡張から起動すると `ELECTRON_RUN_AS_NODE=1` が引き継がれ、Electron が Node として起動して Playwright が「Process failed to launch!」で落ちる。消してから実行する(PowerShell: `Remove-Item Env:ELECTRON_RUN_AS_NODE`)
- Playwright は依存に入っていない。`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i --no-save playwright` で一時的に入れる(Electron を使うのでブラウザは不要)
- 全項目を終えてもプロセスが終わらないことがある。出力をファイルに書き出してバックグラウンドで動かし、最後の「コンソールエラーなし」が出たら止める
- ffmpeg がなければ、`test-output/ui/rec.mp4` を WSL の ffmpeg で先に作っておく(作成済みならテストは作り直さない)
- 選択欄(select)を `getByLabel(/^…$/)` で探さない。`<label>` の中の select は選択肢の文字までラベルの名前に入り、完全一致しない。`.field` を見出しの `span` で絞ってから select を取る
- 設定パネルの欄の開閉は覚えていて、要素を選ぶと選んだ欄以外が閉じる。欄の中身を確かめる前に、閉じている欄を開いておく
- タイムラインの要素のドラッグは再生ヘッドに吸着する。動かした量を確かめるときは、先に再生ヘッドを離れた所(End など)へ動かしておく
