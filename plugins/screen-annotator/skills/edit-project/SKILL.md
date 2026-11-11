---
name: edit-project
description: Screen Annotator のプロジェクトファイル(*.sanno.json)を読んで直す。画面録画をステップに分け、テロップ・読み上げ・ズーム・ポインター・図形を付けた手順書動画を作る・直す依頼で使う。フレーム画像(frame)と計算後の時間(inspect)を CLI で取り、座標と時刻を決めてから JSON を書き、validate で確かめる。
when_to_use: ユーザーが Screen Annotator・.sanno.json・手順書動画のテロップ / 読み上げ / ズーム / ポインター / 図形の編集・書き出しに触れたとき
allowed-tools: Bash(bash ${CLAUDE_SKILL_DIR}/scripts/find-cli.sh *)
---

# Screen Annotator のプロジェクトを編集する

Screen Annotator は、画面録画(と画像)をステップに切り分け、テロップ・読み上げ・ズーム・ポインター・図形を付けて mp4 の手順書動画を作るデスクトップアプリ。編集内容は JSON のプロジェクトファイル(`*.sanno.json`)にすべて入っていて、アプリは外部の変更を検知して読み直す。だから **JSON を直接書けば編集できる**。CLI は、JSON だけでは分からないこと(画、計算後の時刻)を知るためと、検証・書き出しのために使う。

- 書き方の全仕様: [project-format.md](project-format.md)(必ず先に、触る要素の節を読む)
- 機械向けのスキーマ: [project.schema.json](project.schema.json)

## 1. CLI を見つける

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/find-cli.sh" "${CLAUDE_PLUGIN_DATA}"
```

- パスが 1 行出たら、それが CLI(アプリの実行ファイルそのもの)。以下 `$CLI` と書く。パスに空白が入るので必ず `"$CLI"` と引用する
- 何も出ず終了コード 1 なら見つかっていない。ユーザーに Screen Annotator の実行ファイル(またはインストールしたフォルダ)の場所を聞く。インストーラの既定は Windows なら `%LOCALAPPDATA%\Programs\Screen Annotator\Screen Annotator.exe`(すべてのユーザーに入れたなら `C:\Program Files\Screen Annotator\`)、ポータブル版はユーザーが置いた場所。聞いたら覚えさせる(次から聞かずに済む):

  ```bash
  bash "${CLAUDE_SKILL_DIR}/scripts/find-cli.sh" "${CLAUDE_PLUGIN_DATA}" --save "<聞いたパス>"
  ```

- `"$CLI" help` に `frame` と `inspect` がなければアプリが古い。ユーザーに更新を頼む(validate・export だけは使える)

## 2. CLI の使い方

いつも `--json --result <一時ファイル>` を付け、標準エラーは捨て、結果は一時ファイルから読む(Windows の GUI アプリは標準出力が届かないことがあり、Chromium のログが標準エラーに出るため)。終了コードは成功 0、失敗 1、引数の誤り 2。

```bash
tmp="$(mktemp -d)"
"$CLI" inspect project.sanno.json --json --result "$tmp/inspect.json" 2>/dev/null; cat "$tmp/inspect.json"
```

| コマンド | 使いどころ | 結果 |
|---|---|---|
| `inspect <p>` | 編集の前後で、ステップの開始時刻・長さ・読み上げの実際の長さ・自動の保持・テロップ・ズーム・オブジェクトの出ている間を知る | `steps[]`(`start`/`end` は全体の時刻、ほかはステップ内の時刻) |
| `frame <p> --step <番号\|id> --time <秒> --source --out a.png` | 座標を決める。素材(録画・画像)のフレームをそのまま出す。**この画像のピクセル = 映像側の座標**なので、見た位置をそのまま書ける | `imageSize`、`sourceTime` |
| `frame <p> --step <番号\|id> --time <秒> --out b.png` | 仕上がりを確かめる(書き出しと同じ見た目) | `geometry`: 画像の点 → 映像側の座標は `x = view.x + (px − box.x) / scale` |
| `frame <p> --at <秒>` | 全体の時刻で指定する | 同上 |
| `validate <p>` | 書いたら毎回。エラーの `path` が直す場所。素材・背景・図形・ポインターの画像ファイルがなくてもエラーになる | `errors[]`、`warnings[]` |
| `export <p> --out v.mp4` | 動画にする(時間がかかる。ユーザーが望んだときだけ) | `outPath`、`duration` |

`--step` は 1 始まりの番号かステップの `id`。`--time` はステップ内の出力時刻(秒)。出した PNG は Read で見る。

## 3. 進め方

1. プロジェクトファイルを読み、`inspect` で時間の全体像をつかむ
2. 付ける要素の時刻を決める。読み上げに合わせるなら `inspect` の `speech[].start` / `end` を使う(読み上げの長さは JSON には書かれていない)
3. 座標が要る要素(ズーム・ポインター・図形)は、その時刻の `frame --source` を見て、指したい物のピクセル座標を読む
4. JSON を書く。書いたら `validate`
5. `frame`(`--source` なし)で仕上がりを見て、ずれていれば直す。読み上げを変えたら `inspect` で時刻を取り直す
6. ユーザーにどこをどう変えたか伝える。アプリを開いていれば自動で読み直される(アプリ側に保存していない変更があると、どちらを使うかユーザーに聞く)

## 4. 間違えやすいところ

- **時刻は 2 種類**: ステップの `in` / `out` だけが素材(録画)の時刻。テロップ・読み上げ・ズーム・保持・ポインター・図形の時刻はすべて**ステップ内の出力時刻**(ステップの頭が 0、保持・早送りの後)
- **ステップの長さ**: (`out` − `in`) ÷ `speed` + 保持。読み上げの方が長ければ最後のフレームで自動的に待つ(自動の保持)
- **座標は 2 種類**: ズーム・ポインター・図形は映像側(素材のピクセル、左上が原点)。テロップの位置は画面側(出力に対する割合 0〜1)。画面に固定した図形(`anchor: "screen"`)は出力の高さ 1080 を基準にした px
- **画像の素材**: `sources` の `path` が png・jpg・webp なら画像。どの時刻も同じ 1 枚で、`in` / `out` は長さだけを表す(`in: 0`, `out: 3` なら 3 秒)
- **継承**: 見た目・読み上げの声・録画の枠は「既定 ← 全体(`styles` / `speech` / `layout`)← ステップの上書き」。人が書いていない既定値を書き足さない。全体をそろえたいなら全体に書き、例外のステップだけに上書きを書く
- **書かないこと**: `format` / `version` は変えない。`sources` のパスはプロジェクトファイルからの相対パスのまま。ステップの `id` は重複させない(画面には出ない名前。差分やユーザーとの会話で使う)
- 1 つのステップに複数の読み上げを置ける(配列)。1 つ目の `text` を省くとテロップの文を読む
