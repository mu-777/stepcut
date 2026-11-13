// オブジェクト(ポインター・図形)の作成・名前・右クリックのメニュー。タイムライン・プレビュー・設定パネルで共通。
import type { Rect } from "../../core/layout";
import {
  type AnyObject,
  isPath,
  type ObjectKind,
  type ObjectRef,
  objectOf,
  objectWindow,
  retimeObject,
  stepObjects,
} from "../../core/objects";
import type { Pointer, Project, Shape, Step } from "../../core/schema";
import { t } from "./i18n";
import { keyLabel } from "./keymap";
import type { MenuItem } from "./timeline";

type Update = (fn: (p: Project) => Project, key?: string) => void;

/** オブジェクトの種類ごとの、ステップの配列の名前 */
export const OBJECT_FIELD = { pointer: "pointers", shape: "shapes" } as const;

/**
 * 追加の操作で選べるもの。蛍光ペンと画像は近道で、データの種類は増やさない
 * (蛍光ペン = 見た目を蛍光ペンにしたポインター、画像 = 画像を入れた四角)
 */
export type NewObjectKind = "pointer" | "highlighter" | "rect" | "arrow" | "text" | "image";
export const NEW_OBJECT_KINDS: NewObjectKind[] = ["pointer", "highlighter", "rect", "arrow", "text", "image"];

const KIND_LABEL = {
  pointer: "objPointer",
  rect: "objRect",
  arrow: "objArrow",
  text: "objText",
} as const;

const NEW_KIND_LABEL = {
  ...KIND_LABEL,
  highlighter: "pointerHighlighter",
  image: "objImage",
} as const;

export function newKindLabel(k: NewObjectKind): string {
  return t(NEW_KIND_LABEL[k]);
}

/** 追加の操作のツールチップ(「再生位置に〜を追加」) */
export function newKindTip(k: NewObjectKind): string {
  return k === "image" ? t("addImageTip") : t("addAtPlayheadTip").replace("{0}", newKindLabel(k));
}

const paren = (base: string, inner: string) => `${base}${t("parenOpen")}${inner}${t("parenClose")}`;

/**
 * 種類の名前。蛍光ペン・画像・文字は種類が分かるよう「ポインター(蛍光ペン)」「四角(画像)」
 * 「テキスト(文の 1 行目)」にする
 */
export function objectLabel(o: AnyObject, kind: ObjectKind): string {
  if (kind === "pointer") {
    const st = (o as Pointer).style;
    if (st?.image) return paren(t("objPointer"), t("pointerImage"));
    return st?.preset === "highlighter" ? paren(t("objPointer"), t("pointerHighlighter")) : t("objPointer");
  }
  const s = o as Shape;
  if (s.type === "text") {
    const line = s.text.trim().split("\n")[0] ?? "";
    const short = line.length > 24 ? `${line.slice(0, 24)}…` : line;
    return short ? paren(t("objText"), short) : t("objText");
  }
  if (s.type === "rect" && s.image) return paren(t("objRect"), t("objImage"));
  return t(KIND_LABEL[s.type]);
}

/** オブジェクトを始まりの時刻の順に並べたもの(同じ時刻なら描く順) */
export function objectsByTime(step: Step, stepDuration: number): ObjectRef[] {
  return stepObjects(step)
    .map((ref, order) => {
      const o = objectOf(step, ref);
      return { ref, order, start: o ? objectWindow(o, stepDuration).start : 0 };
    })
    .sort((a, b) => a.start - b.start || a.order - b.order)
    .map((x) => x.ref);
}

/**
 * ステップの中のオブジェクトの名前(キーは "種類:番号")。同じ名前が 2 つ以上あれば、
 * 始まりの時刻の順に「四角 1」「四角 2」と番号を付けて見分けられるようにする
 */
export function objectLabels(step: Step, stepDuration: number): Map<string, string> {
  const refs = objectsByTime(step, stepDuration);
  const base = refs.map((ref) => {
    const o = objectOf(step, ref);
    return { key: `${ref.kind}:${ref.index}`, label: o ? objectLabel(o, ref.kind) : "" };
  });
  const total = new Map<string, number>();
  for (const b of base) total.set(b.label, (total.get(b.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const b of base) {
    const n = (seen.get(b.label) ?? 0) + 1;
    seen.set(b.label, n);
    out.set(b.key, (total.get(b.label) ?? 0) > 1 ? `${b.label} ${n}` : b.label);
  }
  return out;
}

export function listOf(step: Step, kind: ObjectKind): AnyObject[] {
  return (step[OBJECT_FIELD[kind]] ?? []) as AnyObject[];
}

/** ステップ i のオブジェクト ref を書き換える。fn が null を返したら消す */
export function patchObject(
  update: Update,
  i: number,
  ref: ObjectRef,
  fn: (o: AnyObject) => AnyObject | null,
  key: string,
): void {
  update((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? patchStepObject(s, ref, fn) : s)) }), key);
}

export function patchStepObject(s: Step, ref: ObjectRef, fn: (o: AnyObject) => AnyObject | null): Step {
  const field = OBJECT_FIELD[ref.kind];
  const list = listOf(s, ref.kind)
    .map((x, k) => (k === ref.index ? fn(x) : x))
    .filter((x): x is AnyObject => x !== null);
  const next = { ...s, [field]: list } as Step;
  if (list.length === 0) delete next[field];
  return next;
}

/** 図形の重なりの順を変える(dir = +1 で前面へ)。新しい番号を返す */
function reorder(s: Step, index: number, dir: 1 | -1): Step {
  const list = [...(s.shapes ?? [])];
  const j = index + dir;
  if (j < 0 || j >= list.length) return s;
  [list[index], list[j]] = [list[j] as Shape, list[index] as Shape];
  return { ...s, shapes: list };
}

export function objectMenu(
  update: Update,
  i: number,
  ref: ObjectRef,
  step: Step,
  onSelect?: (ref: ObjectRef | null) => void,
): MenuItem[] {
  const n = listOf(step, ref.kind).length;
  const patchStep = (fn: (s: Step) => Step, key: string) =>
    update((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? fn(s) : s)) }), key);
  const items: MenuItem[] = [
    {
      label: t("objectDuplicate"),
      icon: "duplicate",
      action: () => {
        patchStep((s) => {
          const o = listOf(s, ref.kind)[ref.index];
          if (!o) return s;
          return { ...s, [OBJECT_FIELD[ref.kind]]: [...listOf(s, ref.kind), offsetCopy(o)] } as Step;
        }, "object-dup");
        onSelect?.({ kind: ref.kind, index: n });
      },
    },
  ];
  if (ref.kind === "shape") {
    items.push(
      {
        label: t("bringForward"),
        icon: "bringForward",
        disabled: ref.index >= n - 1,
        action: () => {
          patchStep((s) => reorder(s, ref.index, 1), "object-order");
          onSelect?.({ kind: "shape", index: ref.index + 1 });
        },
      },
      {
        label: t("sendBackward"),
        icon: "sendBackward",
        disabled: ref.index <= 0,
        action: () => {
          patchStep((s) => reorder(s, ref.index, -1), "object-order");
          onSelect?.({ kind: "shape", index: ref.index - 1 });
        },
      },
    );
  }
  items.push({
    label: t("remove"),
    icon: "trash",
    shortcut: keyLabel("delete"),
    action: () => {
      patchStep((s) => patchStepObject(s, ref, () => null), "object-remove");
      onSelect?.(null);
    },
  });
  return items;
}

/** 複製は少しずらして重ならないようにする */
function offsetCopy(o: AnyObject): AnyObject {
  const d = 24;
  const c = structuredClone(o);
  if (isPath(c)) c.path = c.path.map((p) => ({ ...p, x: p.x + d, y: p.y + d }));
  else if (c.type === "arrow") {
    c.from = { x: c.from.x + d, y: c.from.y + d };
    c.to = { x: c.to.x + d, y: c.to.y + d };
  } else c.rect = { ...c.rect, x: c.rect.x + d, y: c.rect.y + d };
  return c;
}

/** 新しく作るオブジェクトが出ている長さ(秒) */
const NEW_OBJECT_LENGTH = 3;

/**
 * 時刻 local に作るオブジェクト。view はいま見えている範囲(ソースのピクセル)で、その中央付近に置く。
 * at を渡すとそこ(view と同じ座標)を中心に置く
 */
export function newObject(
  kind: NewObjectKind,
  local: number,
  stepDuration: number,
  view: Rect,
  at?: { x: number; y: number },
  opts: {
    /** 全体の設定のポインターの見た目(ポインター・蛍光ペンの見た目を決める) */
    sharedPointerPreset?: string;
    /** 画像のときの画像(パスと大きさ) */
    image?: { path: string; w: number; h: number };
  } = {},
): { kind: ObjectKind; object: AnyObject } {
  const r = (n: number) => Math.round(n);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  // 秒の切り上げで再生位置より後に始まると、作った直後に見えないので切り捨てる
  const start = Math.floor(local * 1000) / 1000;
  const endAt = start + NEW_OBJECT_LENGTH;
  const end = endAt < stepDuration - 0.05 ? { end: r3(endAt) } : {};
  const cx = at?.x ?? view.x + view.w / 2;
  const cy = at?.y ?? view.y + view.h / 2;
  const vw = view.w;
  const vh = view.h;
  if (kind === "pointer" || kind === "highlighter") {
    const move = Math.min(1, Math.max(0.1, (stepDuration - start) / 3));
    const p: Pointer = {
      mode: "line",
      path: [
        // 左から水平に動いてきて、クリックした点(真ん中)に着く
        { t: start, x: r(cx - vw * 0.15), y: r(cy) },
        { t: r3(start + move), x: r(cx), y: r(cy) },
      ],
      ...end,
    };
    // 全体の設定の見た目が求めるものと違うときだけ、そのポインターの見た目を書く
    const shared = opts.sharedPointerPreset ?? "arrow";
    if (kind === "highlighter" && shared !== "highlighter") p.style = { preset: "highlighter" };
    if (kind === "pointer" && shared === "highlighter") p.style = { preset: "arrow" };
    return { kind: "pointer", object: p };
  }
  const box = (w: number, h: number) => ({ x: r(cx - w / 2), y: r(cy - h / 2), w: r(w), h: r(h) });
  let s: Shape;
  if (kind === "rect") s = { type: "rect", start, ...end, rect: box(vw * 0.25, vh * 0.18) };
  else if (kind === "image") {
    // 画像の縦横比で、見えている範囲の幅 1/4・高さ 1/2 に収める
    // 大きさが分からない(読めない)画像は四角の既定の大きさにする
    const img = opts.image;
    const sized = img && img.w > 0 && img.h > 0 ? img : null;
    const k = sized ? Math.min((vw * 0.25) / sized.w, (vh * 0.5) / sized.h) : 0;
    s = {
      type: "rect",
      start,
      ...end,
      rect: sized ? box(sized.w * k, sized.h * k) : box(vw * 0.25, vh * 0.18),
      ...(img ? { image: img.path } : {}),
    };
  } else if (kind === "arrow")
    s = {
      type: "arrow",
      start,
      ...end,
      from: { x: r(cx - vw * 0.15), y: r(cy + vh * 0.15) },
      to: { x: r(cx), y: r(cy) },
    };
  else s = { type: "text", start, ...end, rect: box(vw * 0.3, vh * 0.1), text: t("textPlaceholder") };
  return { kind: "shape", object: s };
}

/** ステップ i にオブジェクトを足す。足した場所を返す */
export function insertObject(
  project: Project,
  i: number,
  kind: ObjectKind,
  object: AnyObject,
): { project: Project; ref: ObjectRef } {
  const step = project.steps[i] as Step;
  const list = listOf(step, kind);
  return {
    project: {
      ...project,
      steps: project.steps.map((s, j) =>
        j === i ? ({ ...s, [OBJECT_FIELD[kind]]: [...list, object] } as Step) : s,
      ),
    },
    ref: { kind, index: list.length },
  };
}

/**
 * コピーしたオブジェクトを、ステップ i の時刻 local から出るように貼る(出ている長さは保ち、ステップの終わりで切る)。
 * 録画の大きさが違えば、録画に追従する座標を kx・ky 倍する。貼った場所を返す
 */
export function pasteObject(
  project: Project,
  i: number,
  kind: ObjectKind,
  object: AnyObject,
  local: number,
  stepDuration: number,
  kx: number,
  ky: number,
): { project: Project; ref: ObjectRef } {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const c = structuredClone(object);
  if (kx !== 1 || ky !== 1) {
    const sc = <P extends { x: number; y: number }>(p: P): P => ({
      ...p,
      x: Math.round(p.x * kx),
      y: Math.round(p.y * ky),
    });
    if (isPath(c)) c.path = c.path.map(sc);
    else if (c.anchor !== "screen") {
      if (c.type === "arrow") {
        c.from = sc(c.from);
        c.to = sc(c.to);
      } else
        c.rect = {
          ...sc(c.rect),
          w: Math.max(1, Math.round(c.rect.w * kx)),
          h: Math.max(1, Math.round(c.rect.h * ky)),
        };
    }
  }
  const win = objectWindow(c, Number.POSITIVE_INFINITY);
  const end = c.end === undefined ? null : r3(local + (win.end - win.start));
  const placed = retimeObject(c, r3(local), end !== null && end < stepDuration - 0.05 ? end : null);
  return insertObject(project, i, kind, placed);
}
