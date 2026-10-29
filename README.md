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
npm run dist:win   # Windows 用のインストーラと portable 版を dist/ に作る(Windows 上で実行)
```

main への PR では GitHub Actions が Windows 版をビルドし、run の Artifacts(`screen-annotator-win`)に置く。

起動時にプロジェクトファイルを渡すと、それを開く: `npx electron . path/to/project.sanno.json`

## 操作

画面は左にプロジェクトとステップ一覧、中央にプレビューとタイムライン、右に選んだものの設定。カラムの境界はドラッグで幅を変えられる。

| 操作 | 内容 |
|---|---|
| Space | 再生/停止 |
| J / K / L | 逆方向/停止/再生(連打で ×2、×3) |
| ← / → | 1 秒移動 |
| Shift+← / → | 1 フレーム移動 |
| ↑ / ↓ | 前/次のステップ境界へ |
| Home / End | 先頭/末尾 |
| Ctrl+K | 再生ヘッドの位置でステップを分割 |
| Delete | タイムラインで選んだ要素(ステップ・ズーム・保持・テロップ・読み上げ)を削除 |
| Ctrl+ホイール | タイムラインの拡大縮小 |

タイムラインでは、クリップ端のドラッグで In/Out、テロップ・読み上げ・ズームの帯のドラッグで時刻を変える。ズームのレーンを空いているところからドラッグするとズームを作る。右クリックで分割・静止(保持)・ズームの追加ができる。プレビューの右クリックでも、クリックした点を中心にズームを作れる。ステップの並び替えはステップ一覧の右クリックから。

枠付きのレイアウトでは、プレビューの映像をクリックすると、ドラッグで移動(中心線に吸着、Alt で解除)、角のドラッグで拡大縮小できる。

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
