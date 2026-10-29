// 出力画面上の配置(LAY)とズームの表示範囲(ZM)。座標はピクセル。
import type { ResolvedLayout } from "./defaults";
import { zoomTransition } from "./defaults";
import type { Step, Zoom } from "./schema";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameLayout {
  /** 映像を描く領域(出力のピクセル) */
  video: Rect;
  /** テロップの帯。全画面では null */
  band: Rect | null;
}

export function fitContain(srcW: number, srcH: number, area: Rect): Rect {
  const scale = Math.min(area.w / srcW, area.h / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

export function computeLayout(
  outW: number,
  outH: number,
  layout: ResolvedLayout,
  srcW: number,
  srcH: number,
): FrameLayout {
  if (layout.mode === "full") {
    return { video: fitContain(srcW, srcH, { x: 0, y: 0, w: outW, h: outH }), band: null };
  }
  const bandH = outH * layout.bandHeight;
  const band = { x: 0, y: outH - bandH, w: outW, h: bandH };
  if (layout.video) return { video: placeVideo(layout.video, outW, outH, srcW, srcH), band };
  return { video: fitContain(srcW, srcH, autoVideoArea(outW, outH, layout)), band };
}

/** 枠付きで自動配置するときの、映像を収める領域(帯と余白を除いたところ) */
export function autoVideoArea(outW: number, outH: number, layout: ResolvedLayout): Rect {
  const bandH = outH * layout.bandHeight;
  const m = outH * layout.margin;
  return { x: m, y: m, w: Math.max(1, outW - 2 * m), h: Math.max(1, outH - bandH - m) };
}

/** 位置と幅の指定(割合)から映像の矩形を出す。高さはソースの縦横比で決まる */
export function placeVideo(
  v: { x: number; y: number; width: number },
  outW: number,
  outH: number,
  srcW: number,
  srcH: number,
): Rect {
  const w = v.width * outW;
  const h = (w * srcH) / srcW;
  return { x: v.x * outW - w / 2, y: v.y * outH - h / 2, w, h };
}

/** 映像の矩形から位置と幅の指定(割合)に戻す。小数 4 桁に丸める */
export function videoPlacementOf(
  r: Rect,
  outW: number,
  outH: number,
): { x: number; y: number; width: number } {
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r4((r.x + r.w / 2) / outW), y: r4((r.y + r.h / 2) / outH), width: r4(r.w / outW) };
}

/** ズーム範囲をソースの縦横比にそろえ(中心を保って広げる)、映像内に収める */
export function normalizeZoomRect(rect: Rect, srcW: number, srcH: number): Rect {
  const aspect = srcW / srcH;
  let w = rect.w;
  let h = rect.h;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  if (w > srcW) {
    w = srcW;
    h = srcH;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = Math.min(Math.max(0, cx - w / 2), srcW - w);
  const y = Math.min(Math.max(0, cy - h / 2), srcH - h);
  return { x, y, w, h };
}

function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

/** ズームの進み具合(0 = ズームなし、1 = 範囲いっぱい)。start から transition 秒で入り、end の transition 秒前から戻る */
export function zoomProgress(z: Zoom, t: number): number {
  if (t < z.start || t > z.end) return 0;
  const len = z.end - z.start;
  const tr = Math.min(zoomTransition(z), len / 2);
  if (tr <= 0) return 1;
  if (t < z.start + tr) return easeInOut((t - z.start) / tr);
  if (t > z.end - tr) return easeInOut((z.end - t) / tr);
  return 1;
}

/** 出力時刻 t に表示するソースの範囲(ソースのピクセル) */
export function viewRectAt(step: Step, t: number, srcW: number, srcH: number): Rect {
  const full = { x: 0, y: 0, w: srcW, h: srcH };
  for (const z of step.zooms ?? []) {
    const p = zoomProgress(z, t);
    if (p <= 0) continue;
    const target = normalizeZoomRect(z.rect, srcW, srcH);
    return {
      x: full.x + (target.x - full.x) * p,
      y: full.y + (target.y - full.y) * p,
      w: full.w + (target.w - full.w) * p,
      h: full.h + (target.h - full.h) * p,
    };
  }
  return full;
}
