// ポインター(蛍光ペンを含む)・図形の描画(プレビューと書き出しで共通)。座標は映像側(ソースのピクセル)で、
// 呼び出し側が「ソースのピクセル → 出力のピクセル」の変換(ズームを含む)をかけてから呼ぶ。
import { captionBoxColor } from "../../core/defaults";
import {
  arrowPolygon,
  CLICK_RIPPLE,
  highlightPathAt,
  isScreenAnchored,
  type ObjectRef,
  objectAlpha,
  objectOf,
  objectWindow,
  pathSpan,
  pointerAt,
  type ResolvedPointerStyle,
  resolveArrowStyle,
  resolvePointerStyle,
  resolveRectStyle,
  resolveTextStyle,
  stepObjects,
} from "../../core/objects";
import type { Pointer, Project, Shape, Step } from "../../core/schema";
import { wrapText } from "../../core/text";
import type { FrameGeometry } from "./compositor";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Img = CanvasImageSource & { width: number; height: number };

export interface ObjectsInput {
  project: Project;
  step: Step;
  local: number;
  stepDuration: number;
  /** 映像側の配置(ズームを含む)と、画面に固定した図形の配置 */
  video: FrameGeometry;
  screen: FrameGeometry;
  /** 出力の高さ 1080 に対する倍率(ポインターの大きさに使う) */
  outScale: number;
  images?: (path: string) => Img | null;
  /** 出ている間ならフェード・点滅に関わらず不透明に出すオブジェクト */
  show?: ObjectRef;
  /** 文を描かない文字のオブジェクト(プレビュー上で文を入力中。入力欄を重ねて出す。枠の塗りは描く) */
  hideText?: ObjectRef;
}

/** 文字の書体(テロップと同じ代替フォントの並び) */
export function objectFont(font: string, px: number): string {
  return `${px}px "${font}", "Yu Gothic UI", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", sans-serif`;
}

export function drawObjects(ctx: Ctx, f: ObjectsInput): void {
  for (const ref of stepObjects(f.step, f.project)) {
    const o = objectOf(f.step, ref);
    if (!o) continue;
    const win = objectWindow(o, f.stepDuration);
    const shown =
      f.show?.kind === ref.kind && f.show.index === ref.index && f.local >= win.start && f.local < win.end;
    const alpha = shown ? 1 : objectAlpha(win, o.enter, o.exit, f.local);
    if (alpha <= 0) continue;
    // 座標の基準ごとに「座標 → 出力のピクセル」の変換をかけ、その領域で切る
    const g = isScreenAnchored(o) ? f.screen : f.video;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.box.x, g.box.y, g.box.w, g.box.h);
    ctx.clip();
    ctx.translate(g.box.x - g.view.x * g.k, g.box.y - g.view.y * g.k);
    ctx.scale(g.k, g.k);
    ctx.globalAlpha = alpha;
    if (ref.kind === "pointer") drawPointer(ctx, f, o as Pointer);
    else drawShape(ctx, f, o as Shape);
    ctx.restore();
  }
}

function drawHighlight(ctx: Ctx, f: ObjectsInput, a: Pointer, s: ResolvedPointerStyle): void {
  const pts = highlightPathAt(a, f.local);
  if (pts.length < 2) return;
  // 1 本の線として描く(重なった所が濃くならないように)
  ctx.globalAlpha *= s.opacity;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

/** 矢印のカーソルの形(先端が原点、高さ 1) */
const CURSOR: [number, number][] = [
  [0, 0],
  [0, 0.78],
  [0.19, 0.6],
  [0.32, 0.9],
  [0.44, 0.85],
  [0.31, 0.56],
  [0.56, 0.56],
];

function drawPointer(ctx: Ctx, f: ObjectsInput, a: Pointer): void {
  const s = resolvePointerStyle(f.project, a);
  if (s.preset === "highlighter") {
    drawHighlight(ctx, f, a, s);
    return;
  }
  const p = pointerAt(a, f.local);
  // 大きさは出力の px で決め、ズームしても変えない
  const size = (s.size * f.outScale) / f.video.k;
  // クリックの波紋(最後の点に着いてから)
  if (a.click) {
    const end = pathSpan(a).end;
    const d = f.local - end;
    if (d >= 0 && d < CLICK_RIPPLE) {
      const q = d / CLICK_RIPPLE;
      ctx.save();
      ctx.globalAlpha *= 1 - q;
      ctx.strokeStyle = "#FF3B30";
      ctx.lineWidth = size * 0.08;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * (0.15 + 0.65 * q), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
  const img = s.image ? (f.images?.(s.image) ?? null) : null;
  if (s.image) {
    // ユーザーの画像は左上を指す点にする。読み込み中は描かない
    if (img) ctx.drawImage(img, p.x, p.y, (size * img.width) / img.height, size);
    return;
  }
  if (s.preset === "dot") {
    ctx.save();
    ctx.globalAlpha *= 0.55;
    ctx.fillStyle = s.color.slice(0, 7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = size * 0.05;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (s.preset === "ring") {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = size * 0.09;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = size * 0.12 * f.video.k;
  ctx.shadowOffsetY = size * 0.04 * f.video.k;
  ctx.beginPath();
  CURSOR.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(p.x + x * size, p.y + y * size);
    else ctx.lineTo(p.x + x * size, p.y + y * size);
  });
  ctx.closePath();
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = size * 0.045;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function drawShape(ctx: Ctx, f: ObjectsInput, s: Shape): void {
  if (s.type === "rect") {
    const st = resolveRectStyle(f.project, s);
    const r = s.rect;
    roundRect(ctx, r.x, r.y, r.w, r.h, st.radius);
    if (st.fillOpacity > 0) {
      ctx.save();
      ctx.globalAlpha *= st.fillOpacity;
      ctx.fillStyle = st.fill.slice(0, 7);
      ctx.fill();
      ctx.restore();
    }
    // 画像は塗りの上・線の下に、角の丸みで切って描く(透明な所には塗りが見える)
    const img = s.image ? (f.images?.(s.image) ?? null) : null;
    if (img) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      ctx.restore();
      roundRect(ctx, r.x, r.y, r.w, r.h, st.radius);
    }
    if (st.strokeWidth > 0) {
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = st.strokeWidth;
      ctx.stroke();
    }
    return;
  }
  if (s.type === "arrow") {
    const st = resolveArrowStyle(f.project, s);
    const poly = arrowPolygon(s.from, s.to, st.width, st.head);
    if (poly.length === 0) return;
    ctx.beginPath();
    poly.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = st.color;
    ctx.lineJoin = "round";
    ctx.fill();
    return;
  }
  const index = f.step.shapes?.indexOf(s) ?? -1;
  drawTextBox(ctx, f.project, s, f.hideText?.kind === "shape" && f.hideText.index === index);
}

/** 文字の枠の左右の余白(文字の大きさに対する割合) */
export const TEXT_PAD = 0.3;
/** 文字の行の高さ(文字の大きさに対する割合) */
export const TEXT_LINE_HEIGHT = 1.3;

/** 文字の枠。枠の幅で折り返し、上下の中央に置く */
export function drawTextBox(
  ctx: Ctx,
  project: Project,
  s: Extract<Shape, { type: "text" }>,
  hideText = false,
): void {
  const st = resolveTextStyle(project, s);
  const r = s.rect;
  const bg = captionBoxColor(st.background);
  if (bg) {
    roundRect(ctx, r.x, r.y, r.w, r.h, st.size * 0.2);
    ctx.fillStyle = bg;
    ctx.fill();
  }
  if (hideText || s.text.trim() === "") return;
  const pad = st.size * TEXT_PAD;
  ctx.font = objectFont(st.font, st.size);
  const lines = wrapText(s.text, Math.max(1, r.w - pad * 2), (x) => ctx.measureText(x).width);
  const lineH = st.size * TEXT_LINE_HEIGHT;
  ctx.fillStyle = st.color;
  ctx.textBaseline = "middle";
  ctx.textAlign = st.align;
  const x = st.align === "left" ? r.x + pad : st.align === "right" ? r.x + r.w - pad : r.x + r.w / 2;
  const top = r.y + r.h / 2 - (lines.length * lineH) / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, top + i * lineH);
  });
}
