// 出力画面上の配置(LAY)とズームの表示範囲(ZM)。座標はピクセル。
import type { ResolvedLayout } from "./defaults";
import { zoomTransition } from "./defaults";
import type { Margin, Step, Zoom, ZoomKey } from "./schema";

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

/** 領域(出力のピクセル)をちょうど囲む余白。プレビュー上で枠を動かしたときに使う。小数 6 桁に丸める(1px 単位の移動がずれないように) */
export function marginOf(r: Rect, outW: number, outH: number): Margin {
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    top: r6(r.y / outH),
    right: r6((outW - r.x - r.w) / outW),
    bottom: r6((outH - r.y - r.h) / outH),
    left: r6(r.x / outW),
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

/** 枠をソースの範囲に収める(大きさは変えず位置をずらす。大きすぎれば縮める) */
export function clampRect(r: Rect, srcW: number, srcH: number): Rect {
  const w = Math.min(r.w, srcW);
  const h = Math.min(r.h, srcH);
  return { x: Math.min(Math.max(0, r.x), srcW - w), y: Math.min(Math.max(0, r.y), srcH - h), w, h };
}

/** ズームの枠を時刻の順に並べたもの */
export function sortedKeys(z: Zoom): ZoomKey[] {
  return [...z.keys].sort((a, b) => a.t - b.t);
}

/**
 * ズームの枠(ソースのピクセル)。枠と枠の間は一定の速さで移る。
 * 最初の枠より前は最初の枠、最後の枠より後は最後の枠
 */
export function zoomRectAt(z: Zoom, t: number): Rect {
  const keys = sortedKeys(z);
  const first = keys[0] as ZoomKey;
  if (t <= first.t || keys.length === 1) return first.rect;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] as ZoomKey;
    const b = keys[i] as ZoomKey;
    if (t <= b.t) return lerpRect(a.rect, b.rect, b.t > a.t ? (t - a.t) / (b.t - a.t) : 1);
  }
  return (keys[keys.length - 1] as ZoomKey).rect;
}

/** ズームで映す範囲。既定は枠そのもの、keepAspect なら表示の縦横比に合わせて広げた範囲 */
function zoomView(z: Zoom, r: Rect, aspect: number, srcW: number, srcH: number): Rect {
  return z.keepAspect ? zoomViewRect(r, aspect, srcW, srcH) : clampRect(r, srcW, srcH);
}

/** 枠 r で映したときの倍率(ズームしていないときの見える範囲に対して) */
export function rectScale(r: Rect, keepAspect: boolean, base: Rect, srcW: number, srcH: number): number {
  if (keepAspect) return base.w / zoomViewRect(r, base.w / base.h, srcW, srcH).w;
  const c = clampRect(r, srcW, srcH);
  return Math.max(1, Math.min(base.w / c.w, base.h / c.h));
}

/** ズームの倍率。最初の枠で決める(動きの時間の計算とタイムラインの表示に使う) */
export function zoomScale(z: Zoom, base: Rect, srcW: number, srcH: number): number {
  return rectScale(sortedKeys(z)[0]?.rect ?? base, z.keepAspect ?? false, base, srcW, srcH);
}

/** 倍率と中心を保ったまま、枠を表示の縦横比(base)に戻す */
export function resetRectAspect(r: Rect, keepAspect: boolean, base: Rect, srcW: number, srcH: number): Rect {
  const s = rectScale(r, keepAspect, base, srcW, srcH);
  const w = base.w / s;
  const h = base.h / s;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const c = clampRect({ x: cx - w / 2, y: cy - h / 2, w, h }, srcW, srcH);
  return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
}

/** 枠 r の大きさを w × h にする(中心は保ち、ソースの範囲に収める) */
export function resizeRect(r: Rect, w: number, h: number, srcW: number, srcH: number): Rect {
  const c = clampRect({ x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h }, srcW, srcH);
  return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
}

/**
 * i 番目(時刻の順)の枠を rect にする。syncSize なら、ほかの枠も同じ大きさにする(それぞれの中心は保つ)
 */
export function setZoomKeyRect(
  z: Zoom,
  i: number,
  rect: Rect,
  syncSize: boolean,
  srcW: number,
  srcH: number,
): Zoom {
  const keys = sortedKeys(z).map((k, j) => {
    if (j === i) return { ...k, rect };
    if (!syncSize || (k.rect.w === rect.w && k.rect.h === rect.h)) return k;
    return { ...k, rect: resizeRect(k.rect, rect.w, rect.h, srcW, srcH) };
  });
  return { ...z, keys };
}

/**
 * ズームの区間を start〜end に変える。区間ごと動かしたときは枠の時刻も同じだけずらす。
 * 長さを変えたときは、元の始まり・終わりにあった枠を新しい始まり・終わりへ移し、間の枠は区間の中に収める
 */
export function retimeZoom(z: Zoom, start: number, end: number): Zoom {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const moved = Math.abs(end - start - (z.end - z.start)) < 1e-6;
  const d = start - z.start;
  const keys = sortedKeys(z).map((k) => {
    let t: number;
    if (moved) t = k.t + d;
    else if (k.t <= z.start + 1e-6) t = start;
    else if (k.t >= z.end - 1e-6) t = end;
    else t = Math.min(Math.max(k.t, start), end);
    return { ...k, t: r3(t) };
  });
  return { ...z, start: r3(start), end: r3(end), keys };
}

/**
 * 録画を描く領域(出力のピクセル)。映す範囲(view)の縦横比で、余白の内側(area)に収めて中央に置く。
 * ズームなし・枠を広げるズームでは view の縦横比が変わらないので、computeLayout の video と同じになる
 */
export function videoBoxFor(view: Rect, area: Rect): Rect {
  return fitContain(view.w, view.h, area);
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
        zoomView(z, zoomRectAt(z, z.end), aspect, srcW, srcH),
        zoomView(next, zoomRectAt(next, next.start), aspect, srcW, srcH),
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
  return lerpRect(b, zoomView(best.z, zoomRectAt(best.z, t), aspect, srcW, srcH), best.p);
}
