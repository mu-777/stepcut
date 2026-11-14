# LP の動画と画像の作り方

紹介ページ(`site/`)の動画と編集画面の画像は、StepCut 自身で作っている。作り直すときの手順と、中身の決まり。

## 何を作るか

| ファイル(`site/public/media/`) | 載せる場所 | 中身 |
|---|---|---|
| `hero.mp4` / `hero.jpg` | ヒーロー | 例の画面の録画に、テロップ・四角・ズーム・矢印・ポインターを付けた 3 ステップの動画 |
| `app.png` | 「機能を絞っています」 | 上のプロジェクトを開いた StepCut の画面(ステップ 2 のテロップを選んだ状態) |
| `howto.mp4` / `howto.jpg` | 「使い方」 | StepCut を操作するところの録画を、StepCut で編集した動画 |
| `zoom.mp4` / `zoom.jpg` | 「できること」のズーム | `hero` のステップ 2 だけ |
| `point.mp4` / `point.jpg` | 「できること」の指す | `hero` のステップ 3 だけ |

`.jpg` は動画が読み込まれるまで出す 1 コマ。

## 作り直す手順

1. 準備(初回だけ)
   - `npm ci` と `npm run build`
   - ffmpeg を入れて PATH を通す(Windows: `winget install Gyan.FFmpeg`)
   - Playwright とブラウザを入れる: `npm i --no-save playwright` のあと `npx playwright install chromium`
2. 実行する
   - Windows: `node scripts/make-lp-media.cjs`
   - Linux: `xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/make-lp-media.cjs`
3. 3〜4 分で終わる。`site/public/media/` の 9 ファイルが新しくなる
4. 確かめる: `cd site && npx wrangler dev` でページを開き、次を見る
   - 4 本の動画が再生され、テロップの文字が欠けていない
   - ポインターが、押す場所(「設定」、スイッチ、「保存」、「書き出し」)に重なっている
   - `app.png` の画面が日本語で、ステップが 3 つ並んでいる
5. よければ `site/public/media/` をコミットする

途中のファイル(録画、プロジェクトファイル、CLI の結果)は `test-output/lp-media/` に残る。うまくいかないときは、ここの `*.stepcut.json` を StepCut で開くと、時刻や座標のずれを目で確かめられる。

## スクリプトがしていること

1. **素材の録画**: `site/media-src/sample-app.html`(例の画面)を Playwright のブラウザで開き、「設定」→ スイッチ →「保存」の順に押して録画する。押した時刻とボタンの位置を覚える
2. **プロジェクトを書く**: 覚えた時刻からステップの区切り(押す 1.5 秒前から)、位置から四角・ズームの枠・矢印・ポインターの座標を決めて、`.stepcut.json` を書く
3. **書き出す**: StepCut の CLI(`export`)で mp4 にし、ffmpeg で Web 用に詰め直す(音声なし、先頭にメタデータ)
4. **画面を撮る**: StepCut でそのプロジェクトを開き、画面を撮る
5. **使い方の動画**: StepCut を起動し、録画の追加 → 分割 → テロップの入力 → ズームの追加 → 書き出しを操作して録画する。その録画を素材にして、2・3 と同じ流れで動画にする

## 中身を変えるとき

| 変えたいもの | 直す場所 |
|---|---|
| 例の画面の見た目・文字 | `site/media-src/sample-app.html` |
| 例の画面で押す順番・待つ長さ | `scripts/make-lp-media.cjs` の `record` |
| ヒーローの動画のテロップ・図形・ズーム | 同 `buildSteps` |
| 使い方の動画で見せる操作 | 同 `recordHowto` |
| 使い方の動画のテロップ・ズーム | 同 `buildHowtoSteps` |
| 背景の色、出力の大きさ | 同 `writeProject` |

操作を足すときは、押す直前に `mark("名前", 要素)` で時刻と位置を覚え、`buildHowtoSteps` でその時刻を使う。秒数を直接書かない(実行のたびに少しずれる)。

## 決まり

- 動画は音声なしで載せる(ページでは自動で再生するため)。プロジェクトには読み上げを入れてあり、ステップの長さには反映される
- 画面の言語は日本語に固定する(スクリプトが作業用の設定フォルダーに `language: "ja"` を書く。自分のアプリの設定は変えない)
- テロップのフォントは、Windows では既定(Yu Gothic UI)、ほかの OS では Noto Sans JP を指定する

## いまのファイルについて

いまコミットしてあるものは Linux のコンテナで作った。そのため次の違いがある。Windows で作り直すと解消する(Windows での実行は未確認)。

- 画面の文字が Windows のフォントではない
- 読み上げが無音で代替されている(使い方の動画の最後に、その知らせと Linux のパスが映る)
- 映像はソフトウェアで書き出している
