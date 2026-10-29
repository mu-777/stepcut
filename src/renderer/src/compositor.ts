// 1 フレームの合成。プレビューと書き出しで同じ処理を使う(OUT-06)。
import { captionWindow } from "../../core/captions";
import {
  DEFAULT_CAPTION_POSITION,
  DEFAULT_CAPTION_WIDTH,
  type ResolvedLayout,
  resolveCaptionStyle,
  resolveLayout,
} from "../../core/defaults";
import { computeLayout, viewRectAt } from "../../core/layout";
import type { Project, Step } from "../../core/schema";
import { wrapText } from "../../core/text";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Frame = CanvasImageSource & { width: number; height: number };

export interface FrameInput {
  project: Project;
  step: Step | null;
  /** ステップ内の出力時刻 */
  local: number;
  /** ステップの出力上の長さ */
  stepDuration: number;
  frame: Frame | null;
  srcW: number;
  srcH: number;
  /** 出力サイズ(ピクセル)。プレビューは縮小した値を渡す */
  outW: number;
  outH: number;
  /** ズームを無視する(ズーム範囲の編集中) */
  ignoreZoom?: boolean;
}

export function drawFrame(ctx: Ctx, f: FrameInput): void {
  const layout: ResolvedLayout = resolveLayout(f.project);
  const scale = f.outH / 1080;
  ctx.save();
  ctx.fillStyle = layout.mode === "band" ? layout.background : "#000000";
  ctx.fillRect(0, 0, f.outW, f.outH);

  const srcW = f.srcW || 1920;
  const srcH = f.srcH || 1080;
  const geo = computeLayout(f.outW, f.outH, layout, srcW, srcH);
  const v = geo.video;

  if (layout.mode === "band" && layout.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 30 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fillStyle = "#000000";
    ctx.fillRect(v.x, v.y, v.w, v.h);
    ctx.restore();
  }

  if (f.frame) {
    const view =
      f.step && !f.ignoreZoom ? viewRectAt(f.step, f.local, srcW, srcH) : { x: 0, y: 0, w: srcW, h: srcH };
    // 素材のフレームはデコード時の大きさ(CanvasSink)なので、ソースの座標から換算する
    const kx = f.frame.width / srcW;
    const ky = f.frame.height / srcH;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f.frame, view.x * kx, view.y * ky, view.w * kx, view.h * ky, v.x, v.y, v.w, v.h);
  }

  if (f.step) drawCaption(ctx, f, layout, geo.band, scale);
  ctx.restore();
}

function drawCaption(
  ctx: Ctx,
  f: FrameInput,
  layout: ResolvedLayout,
  band: { x: number; y: number; w: number; h: number } | null,
  scale: number,
): void {
  const step = f.step as Step;
  const w = captionWindow(step, f.stepDuration);
  if (!w || f.local < w.start || f.local >= w.end || !step.caption) return;
  const style = resolveCaptionStyle(f.project, step);
  const size = style.size * scale;
  const lineH = size * style.lineHeight;
  ctx.font = `${size}px "${style.font}", "Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif`;
  ctx.textBaseline = "middle";
  const measure = (s: string) => ctx.measureText(s).width;

  if (layout.mode === "band" && band) {
    const pad = band.h * 0.12 + 16 * scale;
    const maxW = band.w - pad * 2;
    const lines = wrapText(step.caption.text, maxW, measure);
    const top = band.y + band.h / 2 - (lines.length * lineH) / 2 + lineH / 2;
    ctx.fillStyle = style.color;
    ctx.textAlign = style.align === "left" ? "left" : "center";
    const x = style.align === "left" ? band.x + pad : band.x + band.w / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, x, top + i * lineH);
    });
    return;
  }

  const pos = step.caption.position ?? DEFAULT_CAPTION_POSITION;
  const maxW = (step.caption.width ?? DEFAULT_CAPTION_WIDTH) * f.outW;
  const lines = wrapText(step.caption.text, maxW, measure);
  const textW = Math.max(...lines.map(measure), 0);
  const boxPad = size * 0.4;
  const boxW = textW + boxPad * 2;
  const boxH = lines.length * lineH + boxPad;
  const cx = pos.x * f.outW;
  const cy = pos.y * f.outH;
  ctx.fillStyle = style.background;
  ctx.fillRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align === "left" ? "left" : "center";
  const x = style.align === "left" ? cx - textW / 2 : cx;
  const top = cy - (lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, top + i * lineH);
  });
}

/** プレビュー上の点(出力のピクセル)をソースの座標に変換する。ズーム範囲の指定に使う */
export function outputToSource(
  project: Project,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const geo = computeLayout(outW, outH, resolveLayout(project), srcW, srcH);
  const v = geo.video;
  return {
    x: Math.min(srcW, Math.max(0, ((px - v.x) / v.w) * srcW)),
    y: Math.min(srcH, Math.max(0, ((py - v.y) / v.h) * srcH)),
  };
}

export function sourceToOutput(
  project: Project,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const v = computeLayout(outW, outH, resolveLayout(project), srcW, srcH).video;
  return { x: v.x + (sx / srcW) * v.w, y: v.y + (sy / srcH) * v.h };
}
