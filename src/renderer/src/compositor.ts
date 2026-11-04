// 1 フレームの合成。プレビューと書き出しで同じ処理を使う(OUT-06)。
import { captionWindow } from "../../core/captions";
import {
  captionBoxColor,
  type ResolvedLayout,
  resolveCaptionPlacement,
  resolveCaptionStyle,
  resolveLayout,
} from "../../core/defaults";
import { computeLayout, marginArea, type Rect, videoBoxFor, viewRectAt } from "../../core/layout";
import type { Project, Step } from "../../core/schema";
import { wrapText } from "../../core/text";
import { drawSimpleBackground } from "./backgrounds";

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
  /** 画像の背景(出力の大きさで用意したもの)。色・グラデーションの背景なら使わない */
  backgroundImage?: Frame | null;
  /** テロップの文が空のときに薄く出す文(編集画面のプレビューだけ。書き出しでは渡さない) */
  captionPlaceholder?: string;
}

export function drawFrame(ctx: Ctx, f: FrameInput): void {
  const layout: ResolvedLayout = resolveLayout(f.project);
  const scale = f.outH / 1080;
  ctx.save();
  if (!drawSimpleBackground(ctx, f.outW, f.outH, layout.background)) {
    // 画像の読み込み中・失敗時は暗い灰色
    ctx.fillStyle = "#202024";
    ctx.fillRect(0, 0, f.outW, f.outH);
    if (f.backgroundImage) ctx.drawImage(f.backgroundImage, 0, 0, f.outW, f.outH);
  }

  const srcW = f.srcW || 1920;
  const srcH = f.srcH || 1080;
  const geo = computeLayout(f.outW, f.outH, layout, srcW, srcH);
  // テロップの置き場所はズームによらず、ズームなしの録画の位置で決める
  const v = geo.video;
  const view = f.step && !f.ignoreZoom ? viewRectAt(f.step, f.local, srcW, srcH, geo.crop) : geo.crop;
  // 枠どおりに映すズームでは、録画を描く領域の形が変わる
  const box = view === geo.crop ? v : videoBoxFor(view, marginArea(f.outW, f.outH, layout.margin));

  if (layout.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 30 * scale;
    ctx.shadowOffsetY = 8 * scale;
    ctx.fillStyle = "#000000";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  } else if (!f.frame) {
    // 録画がない・読み込み中でも、録画を置く場所は黒で示す(影の有無によらない)
    ctx.fillStyle = "#000000";
    ctx.fillRect(box.x, box.y, box.w, box.h);
  }

  if (f.frame) {
    // 素材のフレームはデコード時の大きさ(CanvasSink)なので、ソースの座標から換算する
    const kx = f.frame.width / srcW;
    const ky = f.frame.height / srcH;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(f.frame, view.x * kx, view.y * ky, view.w * kx, view.h * ky, box.x, box.y, box.w, box.h);
  }

  if (f.step) {
    const w = captionWindow(f.step, f.stepDuration, f.captionPlaceholder !== undefined);
    if (w && f.local >= w.start && f.local < w.end) drawCaption(ctx, f, v);
  }
  ctx.restore();
}

export interface CaptionBox {
  lines: string[];
  /** 中心(出力のピクセル) */
  cx: number;
  cy: number;
  /** 文字の背景の箱 */
  box: Rect;
  /** 箱の色。null なら箱を描かない */
  boxColor: string | null;
  textW: number;
  lineH: number;
}

/**
 * テロップの置き場所と折り返し。位置の指定がなければ、録画の下の余白に収まるならその中央、
 * 収まらなければ画面の下寄り(88%)に置く。背景の箱は色を指定したときだけ付ける。
 */
export function captionBox(
  ctx: Ctx,
  project: Project,
  step: Step,
  outW: number,
  outH: number,
  video: Rect,
  placeholder?: string,
): CaptionBox | null {
  if (!step.caption) return null;
  const text = step.caption.text.trim() === "" ? placeholder : step.caption.text;
  if (!text) return null;
  const scale = outH / 1080;
  const style = resolveCaptionStyle(project, step);
  const place = resolveCaptionPlacement(project, step);
  const size = style.size * scale;
  const lineH = size * style.lineHeight;
  ctx.font = `${size}px "${style.font}", "Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif`;
  const measure = (s: string) => ctx.measureText(s).width;
  const lines = wrapText(text, place.width * outW, measure);
  const textW = Math.max(...lines.map(measure), 0);
  const boxPad = size * 0.4;
  const boxW = textW + boxPad * 2;
  const boxH = lines.length * lineH + boxPad;
  let cx = outW / 2;
  let cy = outH * 0.88;
  if (place.position) {
    cx = place.position.x * outW;
    cy = place.position.y * outH;
  } else {
    const below = outH - (video.y + video.h);
    if (below >= boxH) cy = video.y + video.h + below / 2;
  }
  const box = { x: cx - boxW / 2, y: cy - boxH / 2, w: boxW, h: boxH };
  return { lines, cx, cy, box, boxColor: captionBoxColor(style.background), textW, lineH };
}

function drawCaption(ctx: Ctx, f: FrameInput, video: Rect): void {
  const step = f.step as Step;
  const c = captionBox(ctx, f.project, step, f.outW, f.outH, video, f.captionPlaceholder);
  if (!c) return;
  const style = resolveCaptionStyle(f.project, step);
  const isPlaceholder = (step.caption?.text.trim() ?? "") === "";
  if (isPlaceholder) ctx.globalAlpha = 0.45;
  if (c.boxColor) {
    ctx.fillStyle = c.boxColor;
    ctx.fillRect(c.box.x, c.box.y, c.box.w, c.box.h);
  }
  ctx.textBaseline = "middle";
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align === "left" ? "left" : "center";
  const x = style.align === "left" ? c.cx - c.textW / 2 : c.cx;
  const top = c.cy - (c.lines.length * c.lineH) / 2 + c.lineH / 2;
  c.lines.forEach((line, i) => {
    ctx.fillText(line, x, top + i * c.lineH);
  });
}

/** プレビュー上の点(出力のピクセル)をソースの座標に変換する(ズームなしの表示で)。ズーム範囲の指定に使う */
export function outputToSource(
  project: Project,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const { video: v, crop: c } = computeLayout(outW, outH, resolveLayout(project), srcW, srcH);
  return {
    x: Math.min(srcW, Math.max(0, c.x + ((px - v.x) / v.w) * c.w)),
    y: Math.min(srcH, Math.max(0, c.y + ((py - v.y) / v.h) * c.h)),
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
  const { video: v, crop: c } = computeLayout(outW, outH, resolveLayout(project), srcW, srcH);
  return { x: v.x + ((sx - c.x) / c.w) * v.w, y: v.y + ((sy - c.y) / c.h) * v.h };
}
