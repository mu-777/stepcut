// 出力画面上の配置(LAY)とズームの表示範囲(ZM)。座標はピクセル。
import type { ResolvedLayout } from "./defaults";
import { zoomTransition } from "./defaults";
import type { Margin, Step, Zoom } from "./schema";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameLayout {
  /** 録画を描く領域(出力のピクセル) */
  video: Rect;
  /** ズームしていないときに見せる録画の範囲(ソースのピクセル)。cover では端を切り取った範囲 */
  crop: Rect;
}

export function fitContain(srcW: number, srcH: number, area: Rect): Rect {
  const scale = Math.min(area.w / srcW, area.h / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** 余白を除いた領域(出力のピクセル) */
export function marginArea(outW: number, outH: number, m: Margin): Rect {
  const x = m.left * outW;
  const y = m.top * outH;
  return { x, y, w: Math.max(1, outW - x - m.right * outW), h: Math.max(1, outH - y - m.bottom * outH) };
}

/** 領域(出力のピクセル)をちょうど囲む余白。プレビュー上で枠を動かしたときに使う。小数 4 桁に丸める */
export function marginOf(r: Rect, outW: number, outH: number): Margin {
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    top: r4(r.y / outH),
    right: r4((outW - r.x - r.w) / outW),
    bottom: r4((outH - r.y - r.h) / outH),
    left: r4(r.x / outW),
  };
}

export function computeLayout(
  outW: number,
  outH: number,
  layout: ResolvedLayout,
  srcW: number,
  srcH: number,
): FrameLayout {
  const area = marginArea(outW, outH, layout.margin);
  const full = { x: 0, y: 0, w: srcW, h: srcH };
  if (layout.fit === "contain") return { video: fitContain(srcW, srcH, area), crop: full };
  // cover: 領域いっぱいに描き、はみ出す録画の端を切り取る
  return { video: area, crop: expandToAspect(full, area.w / area.h, srcW, srcH, true) };
}

/**
 * 矩形を縦横比 aspect にそろえる(中心を保つ)。shrink なら内側に縮め(切り取り)、そうでなければ外側に広げる。
 * ソースの範囲に収める。
 */
export function expandToAspect(rect: Rect, aspect: number, srcW: number, srcH: number, shrink = false): Rect {
  let w = rect.w;
  let h = rect.h;
  const wider = w / h > aspect;
  if (wider !== shrink) h = w / aspect;
  else w = h * aspect;
  if (w > srcW) {
    w = srcW;
    h = w / aspect;
  }
  if (h > srcH) {
    h = srcH;
    w = h * aspect;
  }
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const x = Math.min(Math.max(0, cx - w / 2), srcW - w);
  const y = Math.min(Math.max(0, cy - h / 2), srcH - h);
  return { x, y, w, h };
}

/**
 * ズームで実際に見える範囲。枠(rect)は「必ず見せる範囲」で、表示の縦横比に合うよう上下か左右を広げる。
 * aspect は表示の縦横比(録画を描く領域の幅 ÷ 高さ)。
 */
export function zoomViewRect(rect: Rect, aspect: number, srcW: number, srcH: number): Rect {
  return expandToAspect(rect, aspect, srcW, srcH);
}

/** ズームの倍率(ズームしていないときの見える範囲に対して) */
export function zoomScale(z: Zoom, base: Rect, srcW: number, srcH: number): number {
  return base.w / zoomViewRect(z.rect, base.w / base.h, srcW, srcH).w;
}

function easeInOut(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

/** 間がこれより短いズームどうしは、いったん戻らずに次の範囲へ移る(OpenScreen と同じ) */
export const CHAIN_GAP = 1.5;

/**
 * ズームの進み具合(0 = ズームなし、1 = 範囲いっぱい)。
 * start〜end は拡大したまま保つ区間で、拡大の動きは start の手前、縮小の動きは end の後ろに置く。
 */
export function zoomProgress(z: Zoom, t: number, transition: number): number {
  if (t >= z.start && t <= z.end) return 1;
  if (transition <= 0) return 0;
  if (t < z.start && t >= z.start - transition) return easeInOut(1 - (z.start - t) / transition);
  if (t > z.end && t <= z.end + transition) return easeInOut(1 - (t - z.end) / transition);
  return 0;
}

const lerpRect = (a: Rect, b: Rect, p: number): Rect => ({
  x: a.x + (b.x - a.x) * p,
  y: a.y + (b.y - a.y) * p,
  w: a.w + (b.w - a.w) * p,
  h: a.h + (b.h - a.h) * p,
});

/**
 * ステップ内の出力時刻 t に見せるソースの範囲(ソースのピクセル)。
 * base はズームしていないときに見せる範囲(computeLayout の crop)。
 */
export function viewRectAt(step: Step, t: number, srcW: number, srcH: number, base?: Rect): Rect {
  const b = base ?? { x: 0, y: 0, w: srcW, h: srcH };
  const aspect = b.w / b.h;
  const zooms = [...(step.zooms ?? [])].sort((x, y) => x.start - y.start);
  for (let i = 0; i < zooms.length; i++) {
    const z = zooms[i] as Zoom;
    const next = zooms[i + 1];
    // 続くズームの間は、前の範囲から次の範囲へ移る
    if (next && t > z.end && t < next.start && next.start - z.end < CHAIN_GAP) {
      const p = easeInOut((t - z.end) / (next.start - z.end));
      return lerpRect(
        zoomViewRect(z.rect, aspect, srcW, srcH),
        zoomViewRect(next.rect, aspect, srcW, srcH),
        p,
      );
    }
  }
  let best: { p: number; z: Zoom } | null = null;
  for (let i = 0; i < zooms.length; i++) {
    const z = zooms[i] as Zoom;
    const prev = zooms[i - 1];
    const next = zooms[i + 1];
    const chainedIn = prev && z.start - prev.end < CHAIN_GAP;
    const chainedOut = next && next.start - z.end < CHAIN_GAP;
    const tr = zoomTransition(z, zoomScale(z, b, srcW, srcH));
    if ((chainedIn && t < z.start) || (chainedOut && t > z.end)) continue;
    const p = zoomProgress(z, t, tr);
    if (p > 0 && (!best || p > best.p)) best = { p, z };
  }
  if (!best) return b;
  return lerpRect(b, zoomViewRect(best.z.rect, aspect, srcW, srcH), best.p);
}
