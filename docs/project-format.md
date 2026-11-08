# プロジェクトファイル仕様(version 1)

決定記録は [decisions/20261029-project-format.md](decisions/20261029-project-format.md)。機械向けの JSON Schema は [project.schema.json](project.schema.json)(`src/core/schema.ts` から生成)。検証は `screen-annotator validate <file> [--json]`(AI-04)。

この版ではポインター(`pointers`)と蛍光ペン(`highlights`)は書けるが描画しない(M2 で対応。検証で警告を出す)。

人と AI の両方が直接編集する前提の仕様。この文書だけを読めば、ステップの追加・変更ができることを目標にする(要件 9 章)。

## 1. 基本ルール

| 項目 | ルール |
|---|---|
| 形式 | UTF-8 の JSON。拡張子は `.sanno.json`(仮) |
| 時間の単位 | 秒(小数可、ミリ秒まで有効) |
| ステップ内の時刻 | **ステップ内の出力時刻**。ステップの先頭が 0。保持や早送りを反映した後の時刻 |
| ソース内の時刻 | `in` / `out` だけはソース(録画ファイル)の時刻 |
| 映像側の座標 | ソース映像のピクセル。左上が原点。ズーム・ポインター・蛍光ペンが使う |
| 画面側の座標 | 出力画面に対する割合(0〜1)。左上が原点。出力解像度を変えても位置が変わらない |
| 文字サイズ | 出力の高さ 1080 を基準にした px。720p で出力すると 2/3 倍で描画する |
| 色 | `#RRGGBB` または `#RRGGBBAA` |
| 省略 | 省略できる項目は既定値またはプロジェクト共通設定を使う(STY-02) |
| 知らない項目 | 検証エラーにする(打ち間違いを見逃さないため) |
| 配列の順序 | `steps` の順が出力順 |

## 2. 全体構造

```json
{
  "format": "screen-annotator.project",
  "version": 1,
  "output": { ... },
  "layout": { ... },
  "styles": { ... },
  "speech": { ... },
  "audio": { ... },
  "dictionary": [ ... ],
  "sources": [ ... ],
  "steps": [ ... ]
}
```

| キー | 必須 | 内容 |
|---|---|---|
| `format` | ○ | 固定値 `"screen-annotator.project"` |
| `version` | ○ | 仕様の版。この文書は `1` |
| `output` | | 出力設定(OUT) |
| `layout` | | レイアウト(LAY) |
| `styles` | | 見た目の共通設定(STY) |
| `speech` | | 読み上げの共通設定(TTS) |
| `audio` | | 音量の共通設定(AUD) |
| `dictionary` | | 読みの辞書(TTS-06、プロジェクト単位) |
| `sources` | ○ | 録画ファイル(PRJ) |
| `steps` | ○ | ステップの並び(STP) |

## 3. 各項目

### 3.1 output

| キー | 既定 | 内容 |
|---|---|---|
| `width` / `height` | 1920 / 1080 | 出力解像度(偶数) |
| `fps` | 30 | `30` または `60` |
| `quality` | `"high"` | `"low"` / `"medium"` / `"high"` |
| `srt` | `false` | mp4 と同時に SRT を書き出す |

### 3.2 layout

| キー | 既定 | 内容 |
|---|---|---|
| `background` | `{ "image": "preset:default" }` | 背景。下の 3 種類のどれか |
| `margin` | `{ "top": 0.04, "right": 0.0225, "bottom": 0.2, "left": 0.0225 }` | 録画の周りの余白。`top` / `bottom` は出力の高さ、`left` / `right` は出力の幅に対する割合。すべて 0 なら全画面 |
| `fit` | `"contain"` | 余白の内側への録画の置き方。`"contain"` は縦横比を保って全体を収める(すき間には背景が見える)、`"cover"` は余白の内側いっぱいに描き、はみ出す録画の端を切り取る |
| `shadow` | `true` | 録画のドロップシャドウ |

旧い書き方(`mode` / `bandHeight` / 数値の `margin` / `video`)は読み込み時に `margin` へ直す。`"mode": "full"` は余白 0、`"band"` は上・左・右に旧 `margin`、下に `bandHeight` の余白になる。

`background` の書き方:

| 種類 | 例 | 内容 |
|---|---|---|
| 単色 | `"#1E1F22"` | 色 |
| グラデーション | `{ "gradient": { "angle": 135, "colors": ["#1E2A5A", "#6A3093"] } }` | 線形。`angle` は CSS と同じ向き(0 = 下から上、90 = 左から右。既定 180)。`colors` は 2〜4 色を等間隔に置く |
| 画像 | `{ "image": "preset:mint" }` / `{ "image": "bg/back.png" }` | `preset:` で始まれば同梱のプリセット(`default` `sunset` `mint` `ocean` `graphite` `paper`)。それ以外は画像ファイルのパス(素材と同じ規則で相対・絶対。PRJ-05)。出力いっぱいに縦横比を保って敷き詰め、はみ出しは切る |

### 3.3 styles

プロジェクト共通の見た目。各要素の `style` に同名のキーを書くと、その要素だけ上書きする。

テロップの位置は、ステップの `caption.position` / `width` → `styles.caption.position` / `width` → 既定の順に決まる。どこにも書かなければ、録画の下の余白にテロップが収まるならその中央、収まらなければ画面の高さ 88% の位置に置く。

| キー | 内容 |
|---|---|
| `caption` | `font`(既定 `"Yu Gothic UI"`)、`size`(48)、`color`(`"#FFFFFF"`)、`lineHeight`(1.4)、`align`(`"center"` / `"left"`)、`background`(文字の背景の箱の色。既定 `"#00000000"` = 箱なし。箱を付けるときは `"#000000AA"` など。旧い書き方の `"auto"` は箱なしとして扱う)。プロジェクト共通の `styles.caption` には、テロップの置き方の既定 `position`(中心、画面側座標)と `width`(テロップの幅。出力の幅に対する割合で、文はこの幅で折り返す。既定 0.8)も書ける |
| `pointer` | `preset`(既定 `"arrow"`)、`size`(48) |
| `highlighter` | `color`(`"#FFEB3B"`)、`width`(ソースのピクセル。24)、`opacity`(0.4) |

### 3.4 speech と audio

```json
"speech": { "engine": "os", "voice": null, "params": { "rate": 1.0 } },
"audio":  { "source": { "enabled": true, "volume": 1.0, "keepPitch": true }, "speech": { "volume": 1.0 } }
```

- `engine`: 読み上げエンジンの名前。`"os"` が内蔵の OS 標準音声
- `voice`: エンジンが返す声の ID。`null` は OS の既定の声
- `params`: エンジンが返すパラメータ一覧(TTS-04)のうち、変える項目だけを書く
- `volume`: 0〜2(1 が等倍)
- `source.enabled`: 元の音声を鳴らすか。既定は通常ステップで `true`、早送りステップで `false`(早送りステップはステップ側で `true` にしたときだけ鳴る。全体の `true` は早送りステップに効かない)
- `source.keepPitch`: 早送りステップで音の高さを保つか。既定 `true`。`false` なら速度に合わせて高くなる
- どれもステップ側で上書きできる

### 3.5 dictionary

```json
"dictionary": [ { "from": "GUI", "to": "ジーユーアイ" } ]
```

読み上げ文だけに適用し、テロップは変えない。上から順に置き換える。

### 3.6 sources

```json
"sources": [ { "id": "rec1", "path": "rec/2026-10-29.mp4" } ]
```

| キー | 必須 | 内容 |
|---|---|---|
| `id` | ○ | ステップから参照する名前。英数字・`-`・`_` |
| `path` | ○ | プロジェクトファイルと同じフォルダかその下なら相対パス、それ以外は絶対パス(PRJ-05) |

### 3.7 steps

```json
{
  "id": "login",
  "source": "rec1",
  "in": 12.0,
  "out": 18.5,
  "speed": 1,
  "caption": { "text": "右上の「ログイン」を押します" },
  "speech": { "text": "右上のログインを押します。" },
  "audio": { "source": { "enabled": false } },
  "holds": [ { "at": 2.0, "duration": 1.5 } ],
  "zooms": [],
  "pointers": [],
  "highlights": []
}
```

| キー | 必須 | 内容 |
|---|---|---|
| `id` | ○ | ステップの名前。プロジェクト内で重複不可。AI への指示や差分で使う。画面には出さず、画面ではステップを時間の順の番号(ステップ N)で呼ぶ |
| `source` | ○ | `sources` の `id` |
| `in` / `out` | ○ | ソースの区間(ソースの時刻) |
| `speed` | | `1` なら通常ステップ、`1` より大きいと早送りステップ(STP-07)。既定 1 |
| `fadeIn` / `fadeOut` | | ステップの始まりで黒から現れる・終わりで黒へ消える長さ(秒、0 より大)。背景・録画・テロップと音声(元の音声・読み上げ)をまとめて掛ける。省略するとフェードなし(STP-11) |
| `caption` | | テロップ。`text`(改行は `\n`)、`start`(既定 0)、`end`(既定 `null` = ステップの終わりまで)、`position`(中心の位置。画面側座標。`styles.caption.position` を上書きする)、`width`(テロップの幅。出力の幅に対する割合。`styles.caption.width` を上書きする)、`style` |
| `speech` | | 読み上げ。書かなければ読まない。1 つならオブジェクト、複数なら配列(STP-08)。各項目は `text`(読む文。最初の 1 つだけ、省略するとテロップの文を読む)、`start`(読み始めるステップ内の出力時刻。省略すると最初は 0、2 つ目からは前の読み上げの直後。保持を除いた映像の長さを超えられない)、`voice`、`params`(2 つ目からは省略すると最初の読み上げに合わせる) |
| `audio` | | 音量の上書き。形は 3.4 と同じ |
| `holds` | | 保持(TIM-02)。`at` の出力時刻で映像を止め、`duration` 秒保持する |
| `zooms` | | ズーム(ZM) |
| `pointers` | | 擬似ポインター(ANN) |
| `highlights` | | 蛍光ペン(ANN) |

#### ズーム

```json
{ "start": 1.0, "end": 4.0, "keys": [ { "t": 1.0, "rect": { "x": 640, "y": 300, "w": 800, "h": 450 } } ] }
{ "start": 1.0, "end": 4.0, "hold": false, "keys": [
  { "t": 1.0, "rect": { "x": 640, "y": 0,   "w": 800, "h": 450 } },
  { "t": 2.0, "rect": { "x": 640, "y": 300, "w": 800, "h": 450 } },
  { "t": 4.0, "rect": { "x": 640, "y": 600, "w": 800, "h": 450 } } ] }
```

- `start` 〜 `end` は拡大したまま保つ区間。拡大の動きは `start` の手前、縮小の動きは `end` の後ろで行う(ステップの外にはみ出す分は切り詰める)
- `keys` はズームの枠(キーフレーム)。`t` はステップ内の出力時刻で、`start` 〜 `end` の中に、早い順に同じ時刻を重ねずに並べる。`rect` は映像側座標の範囲。枠が 1 つなら動かない。2 つ以上なら枠と枠の間を一定の速さで移る(文字を追うなど)。最初の枠より前は最初の枠、最後の枠より後は最後の枠のまま
- 既定では枠どおりの範囲だけを映す。録画を描く領域は枠の縦横比になり、余白の内側に収めて中央に置く。テロップの位置はズームの影響を受けない
- `keepAspect`(既定 `false`)が `true` なら録画の縦横比を保つ。枠と縦横比が違うときは、中心を保って上下か左右を広げて表示する
- `hold`(既定 `true`)のとき、`start` から `end` まで映像を止める。`holds` に `{ "at": start, "duration": end - start }` を書いたのと同じ扱いになる(保持とズーム中の静止は同じ機能)。`false` なら映像を流し続ける。`"transition"` なら拡大・縮小の動きの間だけ止める: `{ "at": start - transition, "duration": transition }`(ステップの頭より前には出さない)と `{ "at": end, "duration": transition }` の 2 つの保持と同じ扱い。このとき `transition` を省略すると 0.8 秒(倍率から決める既定の式は使わない)
- `transition` は拡大・縮小の動きにかける秒数。省略すると倍率から決める(0.6 + 0.55 × ln(倍率) 秒。2 倍で約 1 秒)。`0` なら動きなしで切り替える
- 前のズームの `end` から次のズームの `start` まで 1.5 秒未満なら、いったん戻らずに次の範囲へ移る

#### ポインターと蛍光ペン

```json
{ "mode": "line", "path": [ { "t": 1.0, "x": 300, "y": 520 }, { "t": 1.8, "x": 900, "y": 520 } ],
  "end": 3.0, "enter": "fade", "exit": "fade", "style": { "preset": "hand" } }
```

| キー | 内容 |
|---|---|
| `mode` | `"line"`(直線。点は 2 つ)または `"freehand"`(点は 2 つ以上) |
| `path` | 時刻付きの点(映像側座標)。ポインターは点の間を移動し、蛍光ペンは点に沿って線を引く |
| `end` | 消える時刻。既定はステップの終わり。表示開始は `path` の最初の点の時刻 |
| `enter` / `exit` | `"none"` / `"fade"` / `"flash"`(ANN-09)。既定 `"none"` |
| `style` | `styles.pointer` / `styles.highlighter` の上書き |

## 4. ステップの長さと時刻の対応

ステップの出力上の長さは次で決まる。

1. 映像の長さ = (`out` − `in`) ÷ `speed`
2. 保持の合計を足す(`holds` と、`hold` が `true` か `"transition"` のズーム)
3. 読み上げの終わり(最後に終わる読み上げの開始 + 長さ)がそれより後なら、差の分だけ最終フレームを保持する(TIM-03)。前ならそのまま(TIM-04)

出力時刻 t に表示するソースのフレーム: t より前に終わった保持の長さを t から引き、保持の途中ならその保持の開始時刻にそろえ、`speed` を掛けて `in` に足す。その時刻の直前のフレームを使う(フレームレートが一定でないソースでも同じ規則で扱う。U-07)。

保持どうし、ズームどうしは重ねられない(検証エラー)。

## 5. 音声

- 元の音声は、映像が動いている区間だけ鳴らす。保持の間は止まる
- 早送りステップ(`speed` > 1)では、既定で元の音声を鳴らさない(速度を変えた音は聞き取りにくいため。仮決め)。ステップの `audio.source.enabled` を `true` にすると鳴らし、`audio.source.keepPitch`(既定 `true`)なら音の高さを保ったまま縮め、`false` なら速く再生する(高くなる)
- `fadeIn` / `fadeOut` のある区間は、元の音声と読み上げをまとめて映像と同じ割合で小さくする
- 読み上げはそれぞれの `start`(省略時は 3.4 の `speech` の規則)から鳴らし、元の音声と重ねる

## 6. 完全な例

```json
{
  "format": "screen-annotator.project",
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30, "quality": "high", "srt": true },
  "layout": { "background": { "image": "preset:default" } },
  "speech": { "engine": "os" },
  "dictionary": [ { "from": "URL", "to": "ユーアールエル" } ],
  "sources": [ { "id": "rec1", "path": "rec/setup.mp4" } ],
  "steps": [
    {
      "id": "open-settings",
      "source": "rec1", "in": 3.2, "out": 7.0,
      "caption": { "text": "歯車アイコンから設定を開きます" },
      "speech": { "text": "歯車アイコンから、設定を開きます。" }
    },
    {
      "id": "wait-install",
      "source": "rec1", "in": 7.0, "out": 37.0, "speed": 8,
      "caption": { "text": "インストールが終わるまで待ちます" },
      "speech": { "text": "インストールが終わるまで待ちます。" },
      "audio": { "source": { "enabled": false } }
    },
    {
      "id": "copy-url",
      "source": "rec1", "in": 37.0, "out": 42.5,
      "caption": { "text": "表示された URL をコピーします" },
      "speech": { "text": "表示されたURLをコピーします。" },
      "zooms": [ { "start": 0.5, "end": 3.5, "keys": [ { "t": 0.5, "rect": { "x": 400, "y": 200, "w": 960, "h": 540 } } ] } ],
      "highlights": [ { "mode": "line", "path": [ { "t": 1.0, "x": 520, "y": 410 }, { "t": 1.6, "x": 1100, "y": 410 } ] } ]
    }
  ]
}
```
