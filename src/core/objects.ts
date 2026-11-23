// ポインター(蛍光ペンも見た目の 1 つ)・図形(四角・矢印・文字)の時刻と見た目(ANN, STY)。座標は映像側(ソースのピクセル)。
import { DEFAULT_CAPTION_STYLE } from "./defaults";
import type {
  ArrowStyle,
  Pointer,
  PointerStyle,
  Project,
  RectStyle,
  Shape,
  Step,
  TextStyle,
  Transition,
  TransitionSpec,
} from "./schema";

export const DEFAULT_POINTER_STYLE = { preset: "arrow", size: 48 } as const;
/** 見た目ごとの色の既定値(丸は半透明で描く) */
export const POINTER_COLORS: Record<string, string> = {
  dot: "#FF3B30",
  ring: "#FFD60A",
  highlighter: "#FFEB3B",
};
/** 蛍光ペンの線の太さ(ソースのピクセル)と不透明度の既定値 */
export const DEFAULT_HIGHLIGHTER_STYLE = { color: "#FFEB3B", width: 24, opacity: 0.4 } as const;
export const DEFAULT_RECT_STYLE: Required<RectStyle> = {
  stroke: "#FF3B30",
  strokeWidth: 6,
  fill: "#FF3B30",
  fillOpacity: 0,
  radius: 8,
};
export const DEFAULT_ARROW_STYLE: Required<ArrowStyle> = { color: "#FF3B30", width: 12, head: 3 };
export const DEFAULT_TEXT_STYLE: Required<TextStyle> = {
  font: DEFAULT_CAPTION_STYLE.font,
  size: 40,
  color: "#FFFFFF",
  align: "center",
  background: "#000000B3",
};

/** ポインターの見た目のプリセット(このほかにユーザーの画像) */
export const POINTER_PRESETS = ["arrow", "dot", "ring", "highlighter"] as const;

/** 現れる・消えるときのフェードの長さ(秒)の既定値 */
export const OBJECT_FADE = 0.3;
/** 点滅して現れる・消える長さ(秒)と回数の既定値 */
export const OBJECT_FLASH = 0.6;
export const OBJECT_FLASH_COUNT = 3;
/** クリックの波紋の長さ(秒) */
export const CLICK_RIPPLE = 0.5;

export interface ResolvedPointerStyle {
  /** arrow / dot / ring / highlighter、画像を選んでいれば image */
  preset: string;
  size: number;
  image: string | null;
  color: string;
  width: number;
  opacity: number;
}

export function resolvePointerStyle(p: Project, a: Pointer): ResolvedPointerStyle {
  const s: PointerStyle = { ...p.styles?.pointer, ...a.style };
  const preset = s.image ? "image" : (s.preset ?? DEFAULT_POINTER_STYLE.preset);
  return {
    preset,
    size: s.size ?? DEFAULT_POINTER_STYLE.size,
    image: s.image ?? null,
    color: s.color ?? POINTER_COLORS[preset] ?? "#FF3B30",
    width: s.width ?? DEFAULT_HIGHLIGHTER_STYLE.width,
    opacity: s.opacity ?? DEFAULT_HIGHLIGHTER_STYLE.opacity,
  };
}

/** 見た目が蛍光ペン(動きに沿って線を引く)のポインターか */
export function isHighlighter(p: Project, a: Pointer): boolean {
  return resolvePointerStyle(p, a).preset === "highlighter";
}

export function resolveRectStyle(p: Project, s: Extract<Shape, { type: "rect" }>): Required<RectStyle> {
  return { ...DEFAULT_RECT_STYLE, ...p.styles?.rect, ...s.style };
}

export function resolveArrowStyle(p: Project, s: Extract<Shape, { type: "arrow" }>): Required<ArrowStyle> {
  return { ...DEFAULT_ARROW_STYLE, ...p.styles?.arrow, ...s.style };
}

export function resolveTextStyle(p: Project, s: Extract<Shape, { type: "text" }>): Required<TextStyle> {
  return { ...DEFAULT_TEXT_STYLE, ...p.styles?.text, ...s.style };
}

/** 現れ方・消え方の種類・長さ(秒)・点滅の回数 */
export function resolveTransition(spec: TransitionSpec | undefined): {
  type: Transition;
  duration: number;
  count: number;
} {
  const type = (typeof spec === "string" ? spec : spec?.type) ?? "none";
  const obj: { duration?: number; count?: number } = typeof spec === "object" ? spec : {};
  return {
    type,
    duration: obj.duration ?? (type === "flash" ? OBJECT_FLASH : OBJECT_FADE),
    count: obj.count ?? OBJECT_FLASH_COUNT,
  };
}

/** 現れ方・消え方の書き方。既定の長さ・回数なら種類だけ、なしなら書かない */
export function transitionSpec(
  type: Transition,
  duration?: number,
  count?: number,
): TransitionSpec | undefined {
  if (type === "none") return undefined;
  const extra: { duration?: number; count?: number } = {};
  if (duration !== undefined && duration !== (type === "flash" ? OBJECT_FLASH : OBJECT_FADE))
    extra.duration = duration;
  if (type === "flash" && count !== undefined && count !== OBJECT_FLASH_COUNT) extra.count = count;
  return Object.keys(extra).length ? { type, ...extra } : type;
}

/** ステップ内の要素の種類。タイムラインと設定パネルで同じ並びにする */
export type ObjectKind = "pointer" | "shape";

export interface ObjectRef {
  kind: ObjectKind;
  index: number;
}

export type AnyObject = Pointer | Shape;

export function objectOf(step: Step, ref: ObjectRef): AnyObject | undefined {
  if (ref.kind === "pointer") return step.pointers?.[ref.index];
  return step.shapes?.[ref.index];
}

/**
 * ステップの要素を描く順(奥から): 図形(配列の順) → ポインター。project を渡すと、見た目が蛍光ペンの
 * ポインターを図形より奥にする(線が図形を隠さないように)
 */
export function stepObjects(step: Step, project?: Project): ObjectRef[] {
  const pointers = (step.pointers ?? []).map((_, index) => ({ kind: "pointer" as const, index }));
  const marker = (r: ObjectRef) => !!project && isHighlighter(project, step.pointers?.[r.index] as Pointer);
  return [
    ...pointers.filter(marker),
    ...(step.shapes ?? []).map((_, index) => ({ kind: "shape" as const, index })),
    ...pointers.filter((r) => !marker(r)),
  ];
}

/** ポインター(時刻付きの点の列を持つ)か */
export const isPath = (o: AnyObject): o is Pointer => "mode" in o;

/** 出ている間(ステップ内の出力時刻)。end を書いていなければステップの終わりまで */
export function objectWindow(o: AnyObject, stepDuration: number): { start: number; end: number } {
  const start = isPath(o) ? (o.path[0]?.t ?? 0) : o.start;
  return { start, end: Math.max(start, o.end ?? stepDuration) };
}

/** 点の列の時刻の範囲(動き・線を引く間) */
export function pathSpan(o: Pointer): { start: number; end: number } {
  return { start: o.path[0]?.t ?? 0, end: o.path[o.path.length - 1]?.t ?? 0 };
}

/**
 * 時刻 t の不透明度(0〜1)。出ている間の外は 0。
 * fade は長さ(既定 OBJECT_FADE 秒)をかけて現れる・消える、flash は長さ(既定 OBJECT_FLASH 秒)の間に回数ぶん均等に点滅する。
 * 長さは出ている間を上限にする(現れ方と消え方が重なれば、暗い方をとる)
 */
export function objectAlpha(
  win: { start: number; end: number },
  enter: TransitionSpec | undefined,
  exit: TransitionSpec | undefined,
  t: number,
): number {
  if (t < win.start || t >= win.end) return 0;
  const len = win.end - win.start;
  const edge = (spec: TransitionSpec | undefined, d: number) => {
    const tr = resolveTransition(spec);
    const span = Math.min(tr.duration, len);
    if (tr.type === "fade") return span > 0 ? Math.min(1, d / span) : 1;
    if (tr.type === "flash") {
      if (d >= span) return 1;
      // 回数 × 2 等分して 消・点 を繰り返す(最後は点いたまま本体へ続く)
      return Math.floor((d / span) * tr.count * 2) % 2 === 1 ? 1 : 0;
    }
    return 1;
  };
  return Math.min(edge(enter, t - win.start), edge(exit, win.end - t));
}

function easeInOut(p: number): number {
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/**
 * ポインターの位置。点と点の間を移る(直線モードはゆっくり動き出して止まる、フリーハンドは一定の速さ)。
 * 最初の点より前は最初の点、最後の点より後は最後の点
 */
export function pointerAt(a: Pointer, t: number): { x: number; y: number } {
  const pts = a.path;
  const first = pts[0] as { x: number; y: number; t: number };
  if (t <= first.t) return first;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1] as { x: number; y: number; t: number };
    const q = pts[i] as { x: number; y: number; t: number };
    if (t <= q.t) {
      const raw = q.t > p.t ? (t - p.t) / (q.t - p.t) : 1;
      const k = a.mode === "line" ? easeInOut(raw) : raw;
      return { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k };
    }
  }
  return pts[pts.length - 1] as { x: number; y: number; t: number };
}

/** 蛍光ペンで時刻 t までに引いた線(点の列)。最初の点より前は空 */
export function highlightPathAt(a: Pointer, t: number): { x: number; y: number }[] {
  const pts = a.path;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i] as { x: number; y: number; t: number };
    if (t >= q.t) {
      out.push(q);
      continue;
    }
    const p = pts[i - 1];
    if (p) {
      const k = q.t > p.t ? (t - p.t) / (q.t - p.t) : 1;
      out.push({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    }
    break;
  }
  return out;
}

/** 位置を dx, dy ずらす(単位は要素の座標系のまま。映像側はソースのピクセル、画面側は 1080 基準の px) */
export function moveObject<T extends AnyObject>(o: T, dx: number, dy: number): T {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (isPath(o)) return { ...o, path: o.path.map((p) => ({ ...p, x: r(p.x + dx), y: r(p.y + dy) })) };
  const s = o as Shape;
  if (s.type === "arrow")
    return {
      ...o,
      from: { x: r(s.from.x + dx), y: r(s.from.y + dy) },
      to: { x: r(s.to.x + dx), y: r(s.to.y + dy) },
    };
  return { ...o, rect: { ...s.rect, x: r(s.rect.x + dx), y: r(s.rect.y + dy) } };
}

/** 要素を時刻 dt 秒ずらす。0 より前にはみ出した分は 0 に詰める */
export function shiftObject<T extends AnyObject>(o: T, dt: number): T {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const end = o.end !== undefined ? { end: r3(Math.max(0, o.end + dt)) } : {};
  if (isPath(o)) return { ...o, ...end, path: o.path.map((p) => ({ ...p, t: r3(Math.max(0, p.t + dt)) })) };
  return { ...o, ...end, start: r3(Math.max(0, (o as Shape).start + dt)) };
}

/**
 * 出ている間を start〜end にする(end が null ならステップの終わりまで)。ポインターは点の時刻もまとめてずらし、
 * 動き・線を引く長さを保つ
 */
export function retimeObject<T extends AnyObject>(o: T, start: number, end: number | null): T {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const cur = isPath(o) ? (o.path[0]?.t ?? 0) : (o as Shape).start;
  const { end: _e, ...rest } = shiftObject(o, start - cur);
  return (end === null ? rest : { ...rest, end: r3(end) }) as T;
}

/**
 * ステップを時刻 t で切ったときの前半の要素。t より後まで出ていれば、終わりをステップの終わり(end 省略)にし、
 * ポインターの t より後の点は t に詰める
 */
export function cutObjectAt<T extends AnyObject>(o: T, t: number): T {
  const end = o.end ?? Number.POSITIVE_INFINITY;
  if (end <= t) return o;
  const { end: _e, ...rest } = o;
  if (isPath(rest as unknown as AnyObject)) {
    const p = rest as unknown as Pointer;
    return { ...p, path: p.path.map((q) => (q.t > t ? { ...q, t } : q)) } as unknown as T;
  }
  return rest as T;
}

/** ずらした結果、出ている間がなくなった(end が始まり以前になった)か */
export function objectGone(o: AnyObject): boolean {
  if (o.end === undefined) return false;
  const start = isPath(o) ? (o.path[0]?.t ?? 0) : o.start;
  return o.end <= start;
}

/** 矢印の輪郭(多角形)。軸は太さ width、矢じりは長さ width × head・幅はその 1.2 倍 */
export function arrowPolygon(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  head: number,
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const hl = Math.min(width * head, len * 0.8);
  const hw = (hl * 1.2) / 2;
  const sw = Math.min(width / 2, hw);
  const bx = to.x - ux * hl;
  const by = to.y - uy * hl;
  return [
    { x: from.x + nx * sw, y: from.y + ny * sw },
    { x: bx + nx * sw, y: by + ny * sw },
    { x: bx + nx * hw, y: by + ny * hw },
    { x: to.x, y: to.y },
    { x: bx - nx * hw, y: by - ny * hw },
    { x: bx - nx * sw, y: by - ny * sw },
    { x: from.x - nx * sw, y: from.y - ny * sw },
  ];
}

/** 図形の種類ごとの外枠(当たり判定・プレビューの選択枠)。ソースのピクセル */
export function shapeBounds(s: Shape): { x: number; y: number; w: number; h: number } {
  if (s.type === "arrow") {
    const x = Math.min(s.from.x, s.to.x);
    const y = Math.min(s.from.y, s.to.y);
    return { x, y, w: Math.abs(s.to.x - s.from.x), h: Math.abs(s.to.y - s.from.y) };
  }
  return s.rect;
}

/** 図形を画面に固定しているか(ズームに追従せず、録画の外にも置ける) */
export function isScreenAnchored(o: AnyObject): boolean {
  return !isPath(o) && o.anchor === "screen";
}

/** 録画に追従する図形が録画(w × h、ソースのピクセル)の外にはみ出しているか。はみ出た所は描かれない */
export function shapeOutsideVideo(o: AnyObject, w: number, h: number): boolean {
  if (isPath(o) || isScreenAnchored(o)) return false;
  const b = shapeBounds(o);
  return b.x < 0 || b.y < 0 || b.x + b.w > w || b.y + b.h > h;
}

/**
 * 図形の座標の基準を変える。map は今の座標から新しい座標への変換、scale は長さの倍率。
 * 見えている位置と大きさを保つため、位置と、書いてある太さ・丸み・文字の大きさを換算する
 * (書いていない値は新しい基準の既定値になる)
 */
export function reanchorShape(
  s: Shape,
  anchor: "video" | "screen",
  map: (p: { x: number; y: number }) => { x: number; y: number },
  scale: number,
): Shape {
  const r = (n: number) => Math.round(n);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const pt = (p: { x: number; y: number }) => {
    const q = map(p);
    return { x: r(q.x), y: r(q.y) };
  };
  const { anchor: _a, ...rest } = s;
  const base = (anchor === "screen" ? { ...rest, anchor: "screen" } : rest) as Shape;
  if (base.type === "arrow") {
    const style =
      base.style?.width !== undefined ? { ...base.style, width: r1(base.style.width * scale) } : base.style;
    return { ...base, from: pt(base.from), to: pt(base.to), ...(style ? { style } : {}) };
  }
  const a = pt(base.rect);
  const rect = {
    x: a.x,
    y: a.y,
    w: Math.max(1, r(base.rect.w * scale)),
    h: Math.max(1, r(base.rect.h * scale)),
  };
  if (base.type === "rect" && base.style) {
    const st = { ...base.style };
    if (st.strokeWidth !== undefined) st.strokeWidth = r1(st.strokeWidth * scale);
    if (st.radius !== undefined) st.radius = r1(st.radius * scale);
    return { ...base, rect, style: st };
  }
  if (base.type === "text" && base.style?.size !== undefined) {
    return { ...base, rect, style: { ...base.style, size: r1(base.style.size * scale) } };
  }
  return { ...base, rect };
}

/** 要素で使う画像ファイル(書き出しの前に読み込む・保存時にパスを書き換える) */
export function objectImages(p: Project): string[] {
  const set = new Set<string>();
  if (p.styles?.pointer?.image) set.add(p.styles.pointer.image);
  for (const s of p.steps) {
    for (const a of s.pointers ?? []) if (a.style?.image) set.add(a.style.image);
    for (const sh of s.shapes ?? []) if (sh.type === "rect" && sh.image) set.add(sh.image);
  }
  return [...set];
}
