// プロジェクトファイルの形。仕様は docs/project-format.md。
// 既定値はここでは埋めない(保存時に人や AI が書いていない項目を増やさないため)。既定値の解決は defaults.ts。
import { z } from "zod";

// レンダラーの CSP は eval を許さない。zod が eval の可否を試して CSP 違反を出さないようにする
z.config({ jitless: true });

export const PROJECT_FORMAT = "screen-annotator.project";
export const PROJECT_VERSION = 1;

const time = z.number().min(0);
const color = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "#RRGGBB または #RRGGBBAA");
const ratio = z.number().min(0).max(1);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/, "英数字・-・_ のみ");
const volume = z.number().min(0).max(2);

export const captionStyleSchema = z.strictObject({
  font: z.string().min(1).optional(),
  size: z.number().positive().optional(),
  color: color.optional(),
  lineHeight: z.number().positive().optional(),
  align: z.enum(["center", "left"]).optional(),
  /** 文字の背景の箱の色。"auto" は旧い書き方で、箱なしとして扱う */
  background: z.union([color, z.literal("auto")]).optional(),
});

/** テロップの置き方。中心の位置(画面側座標)と折り返し幅(出力の幅に対する割合) */
const captionPlacement = {
  position: z.strictObject({ x: ratio, y: ratio }).optional(),
  width: ratio.optional(),
};

export const pointerStyleSchema = z.strictObject({
  preset: z.string().min(1).optional(),
  size: z.number().positive().optional(),
});

export const highlighterStyleSchema = z.strictObject({
  color: color.optional(),
  width: z.number().positive().optional(),
  opacity: ratio.optional(),
});

const audioSchema = z.strictObject({
  source: z.strictObject({ enabled: z.boolean().optional(), volume: volume.optional() }).optional(),
  speech: z.strictObject({ volume: volume.optional() }).optional(),
});

const speechParams = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

/** 背景。色・グラデーション・画像のどれか(LAY-04)。画像は "preset:<名前>" か画像ファイルのパス */
export const backgroundSchema = z.union([
  color,
  z.strictObject({
    gradient: z.strictObject({
      angle: z.number().optional(),
      colors: z.array(color).min(2).max(4),
    }),
  }),
  z.strictObject({ image: z.string().min(1) }),
]);

const pointSchema = z.strictObject({ t: time, x: z.number(), y: z.number() });
const transitionKind = z.enum(["none", "fade", "flash"]);

const annotationBase = {
  mode: z.enum(["line", "freehand"]),
  path: z.array(pointSchema).min(2),
  end: time.optional(),
  enter: transitionKind.optional(),
  exit: transitionKind.optional(),
};

const rectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

/** ズームの枠(キーフレーム)。t はステップ内の出力時刻 */
export const zoomKeySchema = z.strictObject({ t: time, rect: rectSchema });

export const zoomSchema = z.strictObject({
  start: time,
  end: time,
  /**
   * 枠を時刻の順に並べたもの。1 つなら動かない。2 つ以上なら、枠と枠の間を一定の速さで移る
   * (最初の枠より前は最初の枠、最後の枠より後は最後の枠)
   */
  keys: z.array(zoomKeySchema).min(1),
  /** true なら録画の縦横比を保つ(枠を広げて表示する)。既定は枠どおりの範囲だけを映す */
  keepAspect: z.boolean().optional(),
  hold: z.boolean().optional(),
  transition: time.optional(),
});

export const speechPieceSchema = z.strictObject({
  /** 省略すると(最初の 1 つだけ)テロップの文を読む */
  text: z.string().optional(),
  /** 読み始めるステップ内の出力時刻。省略すると、最初は 0、2 つ目からは前の読み上げの直後 */
  start: time.optional(),
  voice: z.string().nullable().optional(),
  params: speechParams.optional(),
});

export const holdSchema = z.strictObject({ at: time, duration: z.number().positive() });

export const stepSchema = z.strictObject({
  id,
  source: id,
  in: time,
  out: time,
  speed: z.number().min(1).optional(),
  caption: z
    .strictObject({
      text: z.string(),
      start: time.optional(),
      end: time.nullable().optional(),
      ...captionPlacement,
      style: captionStyleSchema.optional(),
    })
    .optional(),
  /** 読み上げ。1 つならオブジェクト、複数なら配列(順に読む) */
  speech: z.union([speechPieceSchema, z.array(speechPieceSchema).min(1)]).optional(),
  audio: audioSchema.optional(),
  holds: z.array(holdSchema).optional(),
  zooms: z.array(zoomSchema).optional(),
  pointers: z.array(z.strictObject({ ...annotationBase, style: pointerStyleSchema.optional() })).optional(),
  highlights: z
    .array(z.strictObject({ ...annotationBase, style: highlighterStyleSchema.optional() }))
    .optional(),
});

export const projectSchema = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  output: z
    .strictObject({
      width: z.number().int().min(16).multipleOf(2).optional(),
      height: z.number().int().min(16).multipleOf(2).optional(),
      fps: z.union([z.literal(30), z.literal(60)]).optional(),
      quality: z.enum(["low", "medium", "high"]).optional(),
      srt: z.boolean().optional(),
    })
    .optional(),
  layout: z
    .strictObject({
      background: backgroundSchema.optional(),
      /** 録画の周りの余白。上下は出力の高さ、左右は出力の幅に対する割合 */
      margin: z
        .strictObject({
          top: z.number().min(-1).max(1),
          right: z.number().min(-1).max(1),
          bottom: z.number().min(-1).max(1),
          left: z.number().min(-1).max(1),
        })
        .optional(),
      /** 余白の内側への録画の置き方。contain = 全体を収める、cover = 枠に合わせて端を切り取る */
      fit: z.enum(["contain", "cover"]).optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
  styles: z
    .strictObject({
      caption: captionStyleSchema.extend(captionPlacement).optional(),
      pointer: pointerStyleSchema.optional(),
      highlighter: highlighterStyleSchema.optional(),
    })
    .optional(),
  speech: z
    .strictObject({
      engine: z.string().min(1).optional(),
      voice: z.string().nullable().optional(),
      params: speechParams.optional(),
    })
    .optional(),
  audio: audioSchema.optional(),
  dictionary: z.array(z.strictObject({ from: z.string().min(1), to: z.string() })).optional(),
  sources: z.array(z.strictObject({ id, path: z.string().min(1) })),
  steps: z.array(stepSchema),
});

export type Project = z.infer<typeof projectSchema>;
export type Step = z.infer<typeof stepSchema>;
export type Zoom = z.infer<typeof zoomSchema>;
export type ZoomKey = z.infer<typeof zoomKeySchema>;
export type Hold = z.infer<typeof holdSchema>;
export type SpeechPiece = z.infer<typeof speechPieceSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
export type Background = z.infer<typeof backgroundSchema>;
export type Margin = NonNullable<NonNullable<Project["layout"]>["margin"]>;
