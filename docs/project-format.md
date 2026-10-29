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
| `mode` | `"band"` | `"band"`(枠付き)または `"full"`(全画面) |
| `background` | `"#000000"` | 背景色(枠付きのみ) |
| `bandHeight` | `0.2` | 帯の高さ。出力の高さに対する割合(枠付きのみ) |
| `margin` | `0.04` | 映像の上・左・右の余白。出力の高さに対する割合(枠付きのみ) |
| `shadow` | `true` | 映像のドロップシャドウ(枠付きのみ) |

枠付きでは、帯と余白を除いた領域に映像を縦横比を保って最大の大きさで収め、左右中央に置く。全画面では、出力画面いっぱいに縦横比を保って収める。

### 3.3 styles

プロジェクト共通の見た目。各要素の `style` に同名のキーを書くと、その要素だけ上書きする。

| キー | 内容 |
|---|---|
| `caption` | `font`(既定 `"Yu Gothic UI"`)、`size`(48)、`color`(`"#FFFFFF"`)、`lineHeight`(1.4)、`align`(`"center"` / `"left"`)、`background`(全画面時の文字の背景。既定 `"#000000AA"`) |
| `pointer` | `preset`(既定 `"arrow"`)、`size`(48) |
| `highlighter` | `color`(`"#FFEB3B"`)、`width`(ソースのピクセル。24)、`opacity`(0.4) |

### 3.4 speech と audio

```json
"speech": { "engine": "os", "voice": null, "params": { "rate": 1.0 } },
"audio":  { "source": { "enabled": true, "volume": 1.0 }, "speech": { "volume": 1.0 } }
```

- `engine`: 読み上げエンジンの名前。`"os"` が内蔵の OS 標準音声
- `voice`: エンジンが返す声の ID。`null` は OS の既定の声
- `params`: エンジンが返すパラメータ一覧(TTS-04)のうち、変える項目だけを書く
- `volume`: 0〜2(1 が等倍)
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
| `id` | ○ | ステップの名前。プロジェクト内で重複不可。AI への指示や差分で使う |
| `source` | ○ | `sources` の `id` |
| `in` / `out` | ○ | ソースの区間(ソースの時刻) |
| `speed` | | `1` なら通常ステップ、`1` より大きいと早送りステップ(STP-07)。既定 1 |
| `caption` | | テロップ。`text`(改行は `\n`)、`start`(既定 0)、`end`(既定 `null` = ステップの終わりまで)、`position`(全画面時の中心位置。画面側座標。既定 `{ "x": 0.5, "y": 0.88 }`)、`width`(全画面時の折り返し幅。画面側の割合。既定 0.8)、`style` |
| `speech` | | 読み上げ。`text`(1 文、STP-08)、`voice`、`params`。ステップの先頭(出力時刻 0)から読み上げる |
| `audio` | | 音量の上書き。形は 3.4 と同じ |
| `holds` | | 保持(TIM-02)。`at` の出力時刻で映像を止め、`duration` 秒保持する |
| `zooms` | | ズーム(ZM) |
| `pointers` | | 擬似ポインター(ANN) |
| `highlights` | | 蛍光ペン(ANN) |

#### ズーム

```json
{ "start": 1.0, "end": 4.0, "rect": { "x": 640, "y": 300, "w": 800, "h": 450 }, "hold": false, "transition": 0.4 }
```

- `rect` は映像側座標。映像の表示領域と同じ縦横比にそろえて描画する
- `hold: true` のとき、`start` から `end` まで映像を止める。`holds` に `{ "at": start, "duration": end - start }` を書いたのと同じ扱いになる(保持とズーム中の静止は同じ機能)
- `transition` はズームイン・アウトにかける秒数(U-05 の既定値は未決。仮に 0.4)

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
2. 保持の合計を足す(`holds` と `hold: true` のズーム)
3. 読み上げの長さがそれより長ければ、差の分だけ最終フレームを保持する(TIM-03)。短ければそのまま(TIM-04)

出力時刻 t に表示するソースのフレーム: t より前に終わった保持の長さを t から引き、保持の途中ならその保持の開始時刻にそろえ、`speed` を掛けて `in` に足す。その時刻の直前のフレームを使う(フレームレートが一定でないソースでも同じ規則で扱う。U-07)。

保持どうし、ズームどうしは重ねられない(検証エラー)。

## 5. 音声

- 元の音声は、映像が動いている区間だけ鳴らす。保持の間は止まる
- 早送りステップ(`speed` > 1)では元の音声を鳴らさない(速度を変えた音は聞き取りにくいため。仮決め)
- 読み上げはステップの先頭から鳴らし、元の音声と重ねる

## 6. 完全な例

```json
{
  "format": "screen-annotator.project",
  "version": 1,
  "output": { "width": 1920, "height": 1080, "fps": 30, "quality": "high", "srt": true },
  "layout": { "mode": "band" },
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
      "zooms": [ { "start": 0.5, "end": 3.5, "rect": { "x": 400, "y": 200, "w": 960, "h": 540 }, "hold": true } ],
      "highlights": [ { "mode": "line", "path": [ { "t": 1.0, "x": 520, "y": 410 }, { "t": 1.6, "x": 1100, "y": 410 } ] } ]
    }
  ]
}
```
