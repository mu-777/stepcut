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
  background: color.optional(),
});

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

const pointSchema = z.strictObject({ t: time, x: z.number(), y: z.number() });
const transitionKind = z.enum(["none", "fade", "flash"]);

const annotationBase = {
  mode: z.enum(["line", "freehand"]),
  path: z.array(pointSchema).min(2),
  end: time.optional(),
  enter: transitionKind.optional(),
  exit: transitionKind.optional(),
};

export const zoomSchema = z.strictObject({
  start: time,
  end: time,
  rect: z.strictObject({
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
  }),
  hold: z.boolean().optional(),
  transition: time.optional(),
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
      position: z.strictObject({ x: ratio, y: ratio }).optional(),
      width: ratio.optional(),
      style: captionStyleSchema.optional(),
    })
    .optional(),
  speech: z
    .strictObject({
      text: z.string(),
      start: time.optional(),
      voice: z.string().nullable().optional(),
      params: speechParams.optional(),
    })
    .optional(),
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
      mode: z.enum(["band", "full"]).optional(),
      background: color.optional(),
      bandHeight: ratio.optional(),
      margin: ratio.optional(),
      shadow: z.boolean().optional(),
    })
    .optional(),
  styles: z
    .strictObject({
      caption: captionStyleSchema.optional(),
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
export type Hold = z.infer<typeof holdSchema>;
export type CaptionStyle = z.infer<typeof captionStyleSchema>;
