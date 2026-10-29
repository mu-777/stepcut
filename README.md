# 手順書動画エディタ(仮称) / screen-annotator

録画済みの画面録画から、PC アプリの手順書動画(mp4)を作るローカルデスクトップアプリ。

- 1 本の画面録画をステップ(場面)に切り分け、各ステップにテロップ・読み上げ・ズームを付ける
- 編集内容はテキスト(JSON)のプロジェクトファイルに保存し、人手でも AI でも編集できる
- ネット接続なしで全機能が動く
- 対応 OS: Windows(Mac は移植予定)

開発中(M1)。要件は [docs/requirements.md](docs/requirements.md)、決定記録は [docs/decisions/](docs/decisions/) を参照。

## 開発

Node.js 22 以降。

```bash
npm install
npm run dev        # 開発用に起動
npm run build      # out/ にビルド
npm start          # ビルド済みを起動
npm run check      # lint・型チェック・単体テスト・ビルド
```

起動時にプロジェクトファイルを渡すと、それを開く: `npx electron . path/to/project.sanno.json`

## プロジェクトファイル

仕様は [docs/project-format.md](docs/project-format.md)、JSON Schema は [docs/project.schema.json](docs/project.schema.json)。素材の録画はプロジェクトと同じフォルダかその下なら相対パスで保存する。

アプリはプロジェクトファイルの外部変更を検知して再読み込みする。未保存の変更があるときは、どちらを採用するか確認する。

## CLI

```bash
screen-annotator validate <project.json> [--json]
screen-annotator export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
```

- 開発中は `npx electron . validate ...` のように実行する(`npm run build` の後)
- 終了コード: 0 = 成功、1 = 検証エラーまたは書き出し失敗、2 = 引数の誤り
- `--json` は結果を JSON で標準出力に出す。`--result` は同じ JSON をファイルにも書く
- `export` はウィンドウを表示せずに書き出す。`--out` を省くとプロジェクトと同じ場所に `.mp4` を作る。`output.srt` が true なら SRT も書く

## 書き出し

- 映像は H.264。ハードウェアエンコーダーを優先し、使えなければソフトウェアで書き出して警告を出す
- 音声は AAC。使えない環境(Windows N エディションなど)では Opus で書き出して警告を出す
- 読み上げは OS 標準の音声合成(Windows: WinRT の SpeechSynthesizer、Mac: `say`)。対応していない OS では無音で代替する

## ライセンス

Apache-2.0([LICENSE](LICENSE))
