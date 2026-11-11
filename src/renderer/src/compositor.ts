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
import type { ObjectRef } from "../../core/objects";
import type { Project, Step } from "../../core/schema";
import { wrapText } from "../../core/text";
import { fadeLevel } from "../../core/timeline";
import { drawSimpleBackground } from "./backgrounds";
import { drawObjects, type Img } from "./objects-draw";

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
  /** テロップを描かない(プレビュー上でテロップの文を入力中。入力欄を重ねて出す) */
  hideCaption?: boolean;
  /** 図形・ポインターの画像(読み込み済みなら返す) */
  images?: (path: string) => Img | null;
  /** 出ている間ならフェード・点滅に関わらず出すオブジェクト(編集画面で選んでいるもの) */
  showObject?: ObjectRef;
}

/** 1 フレームの配置。video はズームなしの録画の領域、view は映すソースの範囲、box はそれを描く領域(出力のピクセル) */
export interface FrameGeometry {
  video: Rect;
  view: Rect;
  box: Rect;
  /** ソースの 1px が出力の何 px か */
  k: number;
}

export function frameGeometry(
  project: Project,
  step: Step | null,
  local: number,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  ignoreZoom = false,
): FrameGeometry {
  const layout = resolveLayout(project, step);
  const geo = computeLayout(outW, outH, layout, srcW, srcH);
  const view = step && !ignoreZoom ? viewRectAt(step, local, srcW, srcH, geo.crop) : geo.crop;
  // 枠どおりに映すズームでは、録画を描く領域の形が変わる
  const box = view === geo.crop ? geo.video : videoBoxFor(view, marginArea(outW, outH, layout.margin));
  return { video: geo.video, view, box, k: box.w / view.w };
}

/**
 * 画面に固定した図形の座標(出力の高さ 1080 を基準にした px)の配置。frameGeometry と同じ形で、
 * toOutput / toSource をそのまま使える。録画の領域では切らない(box は画面全体)
 */
export function screenGeometry(outW: number, outH: number, video: Rect): FrameGeometry {
  const k = outH / 1080;
  return { video, view: { x: 0, y: 0, w: outW / k, h: 1080 }, box: { x: 0, y: 0, w: outW, h: outH }, k };
}

/** ソースの座標(x, y)を出力のピクセルへ */
export function toOutput(g: FrameGeometry, x: number, y: number): { x: number; y: number } {
  return { x: g.box.x + (x - g.view.x) * g.k, y: g.box.y + (y - g.view.y) * g.k };
}

/** 出力のピクセルをソースの座標へ */
export function toSource(g: FrameGeometry, x: number, y: number): { x: number; y: number } {
  return { x: g.view.x + (x - g.box.x) / g.k, y: g.view.y + (y - g.box.y) / g.k };
}

export function drawFrame(ctx: Ctx, f: FrameInput): void {
  const layout: ResolvedLayout = resolveLayout(f.project, f.step);
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
  const g = frameGeometry(f.project, f.step, f.local, f.outW, f.outH, srcW, srcH, f.ignoreZoom);
  // テロップの置き場所はズームによらず、ズームなしの録画の位置で決める
  const v = g.video;
  const { view, box } = g;

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
    // ポインター・蛍光ペン・図形。映像側のものは録画の領域で切ってズームに追従させ、画面に固定した図形は画面全体に描く
    drawObjects(ctx, {
      project: f.project,
      step: f.step,
      local: f.local,
      stepDuration: f.stepDuration,
      video: g,
      screen: screenGeometry(f.outW, f.outH, v),
      outScale: scale,
      images: f.images,
      show: f.showObject,
    });
  }

  if (f.step && !f.hideCaption) {
    const w = captionWindow(f.step, f.stepDuration, f.captionPlaceholder !== undefined);
    if (w && f.local >= w.start && f.local < w.end) drawCaption(ctx, f, v);
  }
  if (f.step) {
    // フェードイン・フェードアウト: 背景・録画・テロップをまとめて黒へ
    const level = fadeLevel(f.step, f.local, f.stepDuration);
    if (level < 1) {
      ctx.globalAlpha = 1 - level;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, f.outW, f.outH);
      ctx.globalAlpha = 1;
    }
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

/** テロップの書体(CSS の font の書式。プレビュー上の入力欄も同じものを使う) */
export function captionFont(font: string, px: number): string {
  return `${px}px "${font}", "Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif`;
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
  ctx.font = captionFont(style.font, size);
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
  step: Step | null,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  px: number,
  py: number,
): { x: number; y: number } {
  const { video: v, crop: c } = computeLayout(outW, outH, resolveLayout(project, step), srcW, srcH);
  return {
    x: Math.min(srcW, Math.max(0, c.x + ((px - v.x) / v.w) * c.w)),
    y: Math.min(srcH, Math.max(0, c.y + ((py - v.y) / v.h) * c.h)),
  };
}

export function sourceToOutput(
  project: Project,
  step: Step | null,
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const { video: v, crop: c } = computeLayout(outW, outH, resolveLayout(project, step), srcW, srcH);
  return { x: v.x + ((sx - c.x) / c.w) * v.w, y: v.y + ((sy - c.y) / c.h) * v.h };
}
