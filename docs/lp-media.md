# LP の動画と画像の作り方

紹介ページ(`site/`)の動画と編集画面の画像は、StepCut 自身で作っている。作り直すときの手順と、中身の決まり。エージェントに頼むときはスキル `/lp-media`(`.claude/skills/lp-media/SKILL.md`)。

## 何を作るか

英語のページ(`/`)用と日本語のページ(`/ja/`)用の 2 組を作る。中身は同じで、文字(テロップ・読み上げ・例の画面・アプリの画面)の言語だけが違う。

| 組 | 実行 | 出力 | 途中のファイル |
|---|---|---|---|
| 日本語 | `node scripts/make-lp-media.cjs` | `site/public/media/` | `test-output/lp-media/`、`test-output/lp-howto/` |
| 英語 | `node scripts/make-lp-media.cjs --lang en` | `site/public/media/en/` | `test-output/lp-media-en/`、`test-output/lp-howto-en/` |

下の表は日本語の組のファイル名。英語の組も同じ名前で `media/en/` に置く。

| ファイル(`site/public/media/`) | 載せる場所 | 中身 |
|---|---|---|
| `hero.mp4` / `hero.jpg` | ヒーロー | 例の画面の録画に、テロップ・四角・ズーム・矢印・ポインターを付けた 3 ステップの動画 |
| `app.png` | 「機能を絞っています」 | 上のプロジェクトを開いた StepCut の画面(ステップ 2 のテロップを選んだ状態) |
| `howto.mp4` / `howto.jpg` / `howto.vtt` | 「使い方」 | StepCut を操作するところの録画を、StepCut で編集した動画。Windows で作ると読み上げの音声が入る。`.vtt` は StepCut が書き出した字幕(SRT)を変換したもの |
| `kind-*.mp4` / `.jpg`(8 組) | 「付けられるもの」 | 同じ場面に 1 種類ずつ付けた小さな動画(640×360)。caption・zoom・pointer・pen・rect・arrow・text・image |
| `use-steps.mp4` / `.jpg` | 「使いみち」の操作の手順 | 申請の画面で入力して送る。ポインター・四角・早送り |
| `use-demo.mp4` / `.jpg` | 「使いみち」の製品のデモ | グラフの画面を紹介する。動くズーム・止めて見せるズーム・テキスト・画像(ロゴ)・フェード |
| `use-slides.mp4` / `.jpg` | 「使いみち」の資料の解説 | スライドの画像 2 枚をステップにする。蛍光ペン・矢印 |
| `use-steps-app.png` / `use-demo-app.png` / `use-slides-app.png` | 「使いみち」の各例の右 | その例のプロジェクトを開いた StepCut の画面(四角・ズームの枠・蛍光ペンを選んだ状態) |

`.jpg` は動画が読み込まれるまで出す 1 コマ。

## 作り直す手順

1. 準備(初回だけ)
   - `npm ci` と `npm run build`
   - ffmpeg を入れて PATH を通す(Windows: `winget install Gyan.FFmpeg`)
   - Playwright とブラウザを入れる: `npm i --no-save playwright` のあと `npx playwright install chromium`
2. 実行する
   - Windows: `node scripts/make-lp-media.cjs`
   - Linux: `xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/make-lp-media.cjs`
   - 英語の組は、どちらも最後に `--lang en` を付けてもう一度回す
3. 1 組 8〜9 分で終わる。出力先の 31 ファイルが新しくなる。動画ごとの場面の一覧が `test-output/lp-media/sheets/` にできるので、中身はそれで確かめられる
4. 確かめる: `cd site && npx wrangler dev` でページを開き、次を見る
   - 動画(大 5 本と小 8 本)が再生され、テロップの文字が欠けていない
   - ポインターが、押す場所(「設定」、スイッチ、「保存」、「書き出し」)に重なっている
   - `app.png` と `use-*-app.png` の画面がその組の言語で、プレビューに録画が映っている
5. よければ `site/public/media/` をコミットする

`howto.mp4` のシーク(再生位置の移動)は `npx wrangler dev` では確かめられない(手元のサーバーが範囲指定の読み込みに応えず、ブラウザーがシークできない動画として扱う)。本番で確かめるか、範囲指定に応えるサーバーで開く。本番が応えるかは `curl -sI -H "Range: bytes=0-99" https://stepcut.mu-777.dev/media/howto.mp4` が `206` を返すかで分かる。

途中のファイル(録画、プロジェクトファイル、CLI の結果)は `test-output/lp-media/` に残る。うまくいかないときは、ここの `*.stepcut.json` を StepCut で開くと、時刻や座標のずれを目で確かめられる。

## 使い方の動画に Azure の読み上げを入れる(Windows)

1. Azure の側で用意するもの(ポータル https://portal.azure.com )
   - 「音声サービス」(Speech)のリソースを作る。リージョンは `japaneast` など
   - リソースの「キーとエンドポイント」から、**キー 1** と**場所/地域**(例: `japaneast`)を控える
   - 料金と無料枠は [価格のページ](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) で確かめる
2. StepCut に入れる
   - このリポジトリで `npm start` を実行してアプリを開く(スクリプトが使う CLI と同じ設定フォルダーを読むため。インストールした StepCut ではなく、ここから開く)
   - 右上の歯車 →「読み上げエンジン」→ Azure AI Speech を有効にする(規約・料金の確認が出る)
   - 「リージョン」に控えた地域、「鍵」にキー 1 を貼る。鍵はこのパソコンで暗号化して保存され、プロジェクトファイルには書かれない
   - アプリを閉じる
3. スクリプトを実行する(PowerShell)。使い方の動画の読み上げは、既定で Azure AI Speech の `ja-JP-NanamiNeural`(英語の組は `en-US-JennyNeural`)

```powershell
node scripts/make-lp-media.cjs
node scripts/make-lp-media.cjs --lang en
# 声を変えるとき
$env:LP_SPEECH_VOICE = "ja-JP-KeitaNeural"; node scripts/make-lp-media.cjs
```

- 読み上げる文は Microsoft に送られ、料金は自分の契約に請求される
- Azure を有効にしていないと、Windows 標準の声で代わりに読む(書き出しの警告に出る)
- 読み上げが無音になる環境(Linux)で回したときは、置いてある音声付きの `howto.mp4` を上書きしない。上書きするなら `--overwrite-narrated`
- 音声が入るのは `howto.mp4` だけ。ほかの動画は自動で再生するので、音声を外して載せる
- 読み上げが映像より長いステップは、最後の画面で待つ分だけ長くなる(動画の長さが Linux で作ったものと変わる)

## 使い方の動画を手で直す

スクリプトは、使い方の動画のプロジェクトと素材を `test-output/lp-howto/` に置く(git には入らない)。

| ファイル | 中身 |
|---|---|
| `howto.stepcut.json` | 使い方の動画のプロジェクト。StepCut で開いて直せる |
| `stepcut-app.mp4` | 素材(StepCut を操作するところの録画) |
| `howto.<数字>.backup.json` | スクリプトを回し直す前のプロジェクトの写し |

1. `test-output/lp-howto/howto.stepcut.json` を StepCut で開き、テロップ・読み上げの文・ズーム・区切りを直して保存する
2. 直したプロジェクトから動画だけを書き出し直す: `node scripts/make-lp-media.cjs --howto-export`(英語の組は `test-output/lp-howto-en/` を直し、`--howto-export --lang en`)(Linux は `xvfb-run -a` を付ける)。録画はやり直さず、`site/public/media/howto.*` だけが新しくなる

スクリプトを引数なしで回すと録画からやり直し、プロジェクトも作り直す(直した内容は `backup` に残るだけで、新しいプロジェクトには入らない)。

## スクリプトがしていること

1. **素材の録画**: `site/media-src/sample-app.html`(例の画面)を Playwright のブラウザで開き、「設定」→ スイッチ →「保存」の順に押して録画する。押した時刻とボタンの位置を覚える
2. **プロジェクトを書く**: 覚えた時刻からステップの区切り(押す 1.5 秒前から)、位置から四角・ズームの枠・矢印・ポインターの座標を決めて、`.stepcut.json` を書く
3. **書き出す**: StepCut の CLI(`export`)で mp4 にし、ffmpeg で Web 用に詰め直す(音声なし、先頭にメタデータ)
4. **画面を撮る**: StepCut でそのプロジェクトを開き、画面を撮る
5. **使い方の動画**: StepCut を起動し、録画の追加 → 分割 → プレビューの上でテロップを入力 → ズームの範囲を囲む → 再生して確かめる → 四角を置く → 書き出し、を操作して録画する。その録画を素材にして、2・3 と同じ流れで動画にする。書き出しを待つ間は 8 倍の早送りにする

## 中身を変えるとき

| 変えたいもの | 直す場所 |
|---|---|
| 例の画面の見た目・文字 | `site/media-src/sample-app.html`(設定・申請)、`sample-dashboard.html`(グラフ)、`sample-slides.html`(スライド) |
| 例の画面で押す順番・待つ長さ | `scripts/make-lp-media.cjs` の `record` |
| ヒーローの動画のテロップ・図形・ズーム | 同 `buildSteps` |
| 「付けられるもの」の 8 本(付ける位置・大きさ) | 同 `makeKinds` |
| 使いみちの 3 例(押す操作、テロップ、使う機能) | 同 `makeProcedure` / `makeDemo` / `makeSlides` |
| 編集画面の画像で選んでおくもの | 同 `screenshots`(画像だけ撮り直すなら `--screens`) |
| 使い方の動画で見せる操作 | 同 `recordHowto` |
| 使い方の動画のテロップ・ズーム | 同 `buildHowtoSteps` |
| 背景の色、出力の大きさ | 同 `writeProject` |

操作を足すときは、押す直前に `mark("名前", 要素)` で時刻と位置を覚え、`buildHowtoSteps` でその時刻を使う。秒数を直接書かない(実行のたびに少しずれる)。

## 決まり

- 自動で再生する動画(ヒーロー、付けられるものの 8 本、使いみちの 3 例)は音声なしで載せる。使い方の動画は操作の付いた動画で、Windows で作ると読み上げが入る。字幕のトラック(`howto.vtt`)も付ける
- 動画は 1 秒ごとにキーフレームを入れる(シークしたときにすぐ絵が出るように)
- アプリの画面の言語は `--lang` のもの(既定は日本語)にする(スクリプトが作業用の設定フォルダーに `language` を書く。自分のアプリの設定は変えない)
- 例の画面(`site/media-src/*.html`)は、`?lang=en` を付けて開くと英語になる。英語の文字は各要素の `data-en` に書く
- テロップ・読み上げ・画面に置く文字と、アプリで押すボタンの名前は、スクリプトの `TEXT` に言語ごとに書く
- テロップのフォントは、Windows では既定(Yu Gothic UI)、ほかの OS では Noto Sans JP を指定する(英語の組も同じ)

## いまのファイルについて

いまコミットしてあるものは、日本語・英語の組とも Windows で作った。使い方の動画には Azure AI Speech の読み上げ(`ja-JP-NanamiNeural` / `en-US-JennyNeural`)が入っている。ほかの動画は音声なし。

## Windows で回すときの注意

- VS Code の中のターミナルから起動すると `ELECTRON_RUN_AS_NODE=1` が引き継がれる。スクリプトは起動時にこれを消すので、そのまま回してよい
- ffmpeg・ffprobe と node に PATH が通っていること(fnm などで node を入れている場合、エディターの外のシェルでは通っていないことがある)
- Playwright の録画は、ページを開いた時刻より 1〜2 秒遅れて始まることがある。スクリプトは動画の長さから遅れを求めて時刻をそろえ、そろえたときはログに「録画の始まりが … 秒遅れていた」と出す。それでも四角・ポインターが押す場所とずれていたら、その組を回し直す
