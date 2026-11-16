---
name: lp-media
description: 紹介ページ(site/)の動画と編集画面の画像を、今の StepCut で作り直す。「LP の動画を作り直して」「紹介ページの画面を更新して」「使い方の動画を撮り直して」等の依頼や、画面の見た目・操作の流れ・書き出しの見た目を変えたあとに使う。録画から書き出しまでを scripts/make-lp-media.cjs が自動で行う。
---

# LP の動画と画像を作り直す

紹介ページに載せている動画(大 5 本と、「付けられるもの」の小 8 本)と編集画面の画像 4 枚は、StepCut 自身で作っている。アプリを変えたら、ここの手順で作り直す。
英語のページ(`/`)用と日本語のページ(`/ja/`)用の 2 組がある。**両方を作り直す**(英語は `--lang en` を付けて同じ手順をもう一度。出力は `site/public/media/en/`、途中のファイルは `test-output/lp-media-en/` と `test-output/lp-howto-en/`)。
何を作るか・中身の決まり・人が Windows で回す手順は [docs/lp-media.md](../../../docs/lp-media.md)。**書かれた順に実行する。**

## 先に知っておくこと

- スクリプトは **アプリを実際に操作して録画する**。画面の要素をクラス名で探すので、クラス名や操作の流れを変えると途中で止まる(Phase 3)
- **読み上げ入りの使い方の動画は Windows でしか作れない**(Azure AI Speech の鍵がそのパソコンにある。Linux は読み上げが無音)。Linux で回すと、置いてある音声付きの `howto.mp4` は上書きせず、ほかのファイルだけ新しくする。上書きしたいときだけ `--overwrite-narrated`
- 使い方の動画のプロジェクトは `test-output/lp-howto/howto.stepcut.json` に出る(git の外)。人が手で直していることがある。**引数なしで回すと録画からやり直し、手で直した内容は新しいプロジェクトに入らない**(直前のものは `backup` に残る)。手で直した内容を保ったまま動画だけ出し直すなら `--howto-export`
- 生成物は `site/public/media/`。途中のファイルは `test-output/lp-media/`(毎回消える)
- 編集画面の画像だけ撮り直すなら `--screens`(直前に作ったプロジェクトを開いて撮る。1 分ほど)

## Windows の版(読み上げ入り)が要るとき

このコンテナではなく CI で作る(`.github/workflows/lp-media.yml`、docs/lp-media.md の「GitHub Actions の Windows で作る」)。

1. 変更をコミットして push し、base=main の PR を用意する(スキル `/pr-build` の Phase 1)
2. `mcp__github__issue_write`(method=update、issue_number=PR の番号)で `labels` に `lp-media` を足す(既にあるラベルは残す)。付けられなければ、ユーザーにラベルを付けてもらう
3. `mcp__github__actions_list`(list_workflow_runs、branch=作業ブランチ)で lp-media の run を待つ(20〜30 分)。待つ間はブランチに push しない
4. 終わったら `git fetch origin <branch>` して `git merge --ff-only FETCH_HEAD`。進められなければ(先頭のコミットが置き換わった)、自分の未 push のコミットがないのを確かめて `git reset --hard FETCH_HEAD`。`site/public/media/` が衝突したら origin の側を採る
5. 中身の確認は Phase 2 と同じ。場面の一覧は Artifacts にありここからは取れないので、取り込んだ mp4 から ffmpeg で作って見る(`exportVideo` の `tiles` と同じ指定)
6. 失敗したら `mcp__github__get_job_logs` でログを読む。Windows 固有の失敗(解像度・フォント・パス)なら、スクリプトかワークフローを直してラベルを付け直す

## Phase 0: 準備

```bash
npm ci            # 済んでいれば不要
npm run build     # 必ず。古い out/ のまま撮ると、古い画面が載る
which ffmpeg ffprobe
node -e "require('playwright')"
```

Linux のコンテナでは、日本語のフォントを入れておく(入っていないと、画面とテロップの文字が別の書体になる)。

```bash
fc-list | grep -qi "Noto Sans JP" || {
  d=$(mktemp -d) && (cd "$d" && npm pack @expo-google-fonts/noto-sans-jp >/dev/null && tar xzf ./*.tgz) &&
  mkdir -p ~/.fonts ~/.config/fontconfig &&
  cp "$d"/package/400Regular/*.ttf "$d"/package/500Medium/*.ttf "$d"/package/700Bold/*.ttf ~/.fonts/ &&
  printf '%s\n' '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>' \
    '<alias><family>sans-serif</family><prefer><family>Noto Sans JP</family></prefer></alias>' \
    '<alias><family>system-ui</family><prefer><family>Noto Sans JP</family></prefer></alias>' \
    '</fontconfig>' > ~/.config/fontconfig/fonts.conf && fc-cache -f
}
```

フォントはこのコンテナに入れるだけで、リポジトリには置かない(C8)。

## Phase 1: 作り直す

8〜9 分かかる。標準出力はファイルに受ける(パイプで受けない。`.claude/rules/e2e.md`)。

```bash
# Linux
mkdir -p test-output
xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/make-lp-media.cjs > test-output/lp-media.log 2>&1; echo "exit $?"
xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/make-lp-media.cjs --lang en > test-output/lp-media-en.log 2>&1; echo "exit $?"
# Windows(PowerShell)
node scripts/make-lp-media.cjs
node scripts/make-lp-media.cjs --lang en
```

終わったらログを読む。`exit 0` で、`hero` `kind-*`(8 本)`use-steps` `use-demo` `use-slides` `howto` の動画と、`app` `use-*-app` の画像 4 枚の名前が出ていること。
Linux では「ソフトウェアで書き出し」「Opus」「無音で代替」の警告が出るのが正常。

## Phase 2: 中身を確かめる

スクリプトは動画ごとの場面の一覧を `test-output/lp-media/sheets/<名前>.png`(英語は `test-output/lp-media-en/sheets/`)に作る。**全部を Read で見て**、次を確かめる。英語の組では、文字(テロップ・例の画面・アプリの画面)が英語であることも見る。

| 見るもの | 確かめること |
|---|---|
| `sheets/hero.png` | テロップが 3 種類出る。四角が「設定」に、ポインターがスイッチと「保存」に重なる。ズームで行が大きくなる |
| `sheets/kind-*.png`(8 枚) | 名前どおりのものが 1 種類だけ付いている(テロップ・ズーム・ポインター・蛍光ペン・四角・矢印・テキスト・画像)。スイッチやボタンに重なって隠していない |
| `sheets/use-steps.png` | 四角とポインターが「申請」と「送信」に重なる。入力の場面のテロップに(早送り)がある |
| `sheets/use-demo.png` | 左上にロゴ。文字「前の月より増加」が読める。グラフが切り替わったあとズームしている |
| `sheets/use-slides.png` | 蛍光ペンの線が「ブラウザーから」の上にある。矢印が「上長に通知が届く」を指す |
| `sheets/howto.png` | 録画の追加 → 分割 → プレビュー上のテロップ入力(右の設定にも同じ文)→ ズームの枠 → 再生でズーム → 四角が「保存」の上 → 書き出し → 完了、の順に映る |
| `site/public/media/app.png` と `use-*-app.png`(英語は `media/en/`) | 画面がその言語。ステップが並び、選んだ要素(テロップ・四角・ズーム・蛍光ペン)の設定が右に出ている |

位置がずれていたら、`test-output/lp-media/*.stepcut.json`(使い方は `test-output/lp-howto/`)の座標と時刻を見て、スクリプトの該当する関数を直す(対応は docs/lp-media.md の「中身を変えるとき」)。

続けてページを確かめる。スキル `web-visual-check` の手順で `site/public` を配信し、1280px と 400px で開いて、横はみ出し・読み込み失敗・コンソールエラーがないこと、動画と画像が出ていることを見る。
`npx wrangler dev` は動画の途中からの読み込み(Range)に応えないので、使い方の動画のシークは確かめられない。

## Phase 3: 途中で止まったとき

| 症状 | 原因と直し方 |
|---|---|
| `waiting for locator(...)` で時間切れ | その要素のクラス名か、そこへ至る操作が変わった。`src/renderer/src/` で今の名前を調べ、スクリプトの該当箇所を直す。`tests/e2e/ui-smoke.cjs` に同じ操作の例がある |
| `検証エラー` | プロジェクトファイルの形が変わった。`docs/project-format.md` を見て、スクリプトが書く JSON を直す |
| `書き出しに失敗` | `test-output/lp-media/result-export-*.json` を読む |
| 画面の言語が --lang と違う | アプリの設定の読み方が変わった。スクリプトの `launchApp` が書く `settings.json` を直す |
| `getByRole(... name: "Caption")` などで時間切れ | プレビューの上のボタンの名前(i18n.ts の quickCaption・quickZoom・objRect・export)が変わった。スクリプトの `TEXT` の `ui*` を直す |
| ズームの枠や四角がプレビュー上でずれる | 録画の点をプレビューの位置に直す計算(`recordHowto` の `inLayer`)が、既定の余白と合っていない |

スクリプトが頼っているクラス名: `.preview-empty-add` `.rail-thumb` `.tl-clip` `.tl-bar.caption` / `.zoom` / `.object` `.timeline` `.preview-add` `.caption-input` `.draw-layer` `.object-layer .box-outline` `.transport button.play` `.tb-btn.primary`。

## Phase 4: 仕上げ

1. 新しくした機能・なくした機能があれば、ページの文(英語 `site/public/index.html` と日本語 `site/public/ja/index.html` の「付けられるもの」「使いみち」)と docs/lp-media.md の表も直す
2. `npm run check`
3. `site/public/media/` とスクリプトの変更をコミットする
4. 報告に書く: 作り直したファイル、Phase 2 で確かめたこと、**使い方の動画に音声が入っているか**(Linux で作ったなら入っていない。音声付きは CI の lp-media ラベルか、Windows で `node scripts/make-lp-media.cjs` を回す必要がある、と伝える)
