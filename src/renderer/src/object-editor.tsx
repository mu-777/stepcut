// プレビュー上のオブジェクトの編集。クリックで選び、四角・文字は枠の取っ手、ポインター・矢印は両端の取っ手で直す。
// 座標の変換は描画と同じ frameGeometry を使う(ズーム中でも見えている位置で直せる)。
import { useEffect, useRef, useState } from "react";
import { sortedKeys } from "../../core/layout";
import {
  type AnyObject,
  isPath,
  isScreenAnchored,
  type ObjectRef,
  objectOf,
  objectWindow,
  pointerAt,
  resolveArrowStyle,
  resolvePointerStyle,
  resolveTextStyle,
  stepObjects,
} from "../../core/objects";
import type { Pointer, Project, Shape, Step } from "../../core/schema";
import { type FrameGeometry, toOutput, toSource } from "./compositor";
import { t } from "./i18n";
import { objectFont, TEXT_LINE_HEIGHT, TEXT_PAD } from "./objects-draw";
import { type Anchor, type Box, BoxEditor } from "./preview";

type Pt = { x: number; y: number };

/** 線分 a-b と点 p の距離 */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const k = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

/** 当たりの余裕(px) */
const HIT_PAD = 5;

/**
 * プレビュー上の点(ステージのピクセル)にあるオブジェクト。手前に描くものから調べる。
 * 出ている間のものだけを対象にする(現れる前・消えた後は選べない)
 */
export function hitObject(
  project: Project,
  step: Step,
  local: number,
  stepDuration: number,
  g: FrameGeometry,
  /** 画面に固定した図形の配置 */
  sg: FrameGeometry,
  stageH: number,
  p: Pt,
): ObjectRef | null {
  const refs = stepObjects(step, project).reverse();
  for (const ref of refs) {
    const o = objectOf(step, ref);
    if (!o) continue;
    const w = objectWindow(o, stepDuration);
    // 点滅の消えている瞬間も選べるよう、不透明度ではなく出ている間で見る
    if (local < w.start || local >= w.end) continue;
    if (hitOne(project, o, ref, local, isScreenAnchored(o) ? sg : g, stageH, p)) return ref;
  }
  return null;
}

function hitOne(
  project: Project,
  o: AnyObject,
  ref: ObjectRef,
  local: number,
  g: FrameGeometry,
  stageH: number,
  p: Pt,
): boolean {
  const out = (q: Pt) => toOutput(g, q.x, q.y);
  if (ref.kind === "pointer" && isPath(o)) {
    const s = resolvePointerStyle(project, o as Pointer);
    if (s.preset === "highlighter") {
      const half = (s.width * g.k) / 2 + HIT_PAD;
      for (let i = 1; i < o.path.length; i++) {
        if (segDist(p, out(o.path[i - 1] as Pt), out(o.path[i] as Pt)) <= half) return true;
      }
      return false;
    }
    const size = (s.size * stageH) / 1080;
    const c = out(pointerAt(o as Pointer, local));
    // 矢印のカーソルと画像は先端(左上)から右下へ伸びる。丸・輪は中心
    const center =
      s.preset === "arrow" || s.preset === "image" ? { x: c.x + size * 0.25, y: c.y + size * 0.4 } : c;
    return Math.hypot(p.x - center.x, p.y - center.y) <= size * 0.5 + HIT_PAD;
  }
  const s = o as Shape;
  if (s.type === "arrow") {
    const half = (resolveArrowStyle(project, s).width * g.k) / 2 + HIT_PAD;
    return segDist(p, out(s.from), out(s.to)) <= Math.max(half, 8);
  }
  const a = out(s.rect);
  const b = out({ x: s.rect.x + s.rect.w, y: s.rect.y + s.rect.h });
  return p.x >= a.x - HIT_PAD && p.x <= b.x + HIT_PAD && p.y >= a.y - HIT_PAD && p.y <= b.y + HIT_PAD;
}

/**
 * 吸着先にするオブジェクトの枠(ステージのピクセル)。再生位置に出ている四角・文字の枠と、矢印の両端(大きさ 0 の枠)。
 * exclude(編集中のもの)は除く。ポインター・蛍光ペンは動く・線なので対象にしない
 */
export function objectSnapBoxes(
  step: Step,
  local: number,
  stepDuration: number,
  g: FrameGeometry,
  /** 画面に固定した図形の配置 */
  sg: FrameGeometry,
  exclude: ObjectRef | null,
): Box[] {
  const boxes: Box[] = [];
  (step.shapes ?? []).forEach((s, index) => {
    if (exclude?.kind === "shape" && exclude.index === index) return;
    const w = objectWindow(s, stepDuration);
    if (local < w.start || local >= w.end) return;
    const geo = isScreenAnchored(s) ? sg : g;
    if (s.type === "arrow") {
      for (const q of [s.from, s.to]) boxes.push({ ...toOutput(geo, q.x, q.y), w: 0, h: 0 });
      return;
    }
    boxes.push({ ...toOutput(geo, s.rect.x, s.rect.y), w: s.rect.w * geo.k, h: s.rect.h * geo.k });
  });
  return boxes;
}

/** 吸着先にするズームの枠(ステージのピクセル)。ステップのすべてのズームのすべての枠。exclude(編集中の枠)は除く */
export function zoomSnapBoxes(
  step: Step,
  g: FrameGeometry,
  exclude: { zoom: number; key: number } | null,
): Box[] {
  return (step.zooms ?? []).flatMap((z, zi) =>
    sortedKeys(z)
      .filter((_, ki) => !(exclude && exclude.zoom === zi && exclude.key === ki))
      .map((k) => ({ ...toOutput(g, k.rect.x, k.rect.y), w: k.rect.w * g.k, h: k.rect.h * g.k })),
  );
}

/** 選んだオブジェクトの取っ手 */
export function ObjectEditor(props: {
  project: Project;
  object: AnyObject;
  ref_: ObjectRef;
  g: FrameGeometry;
  anchor: Anchor;
  onChange: (o: AnyObject, key: string) => void;
  /** 文字の枠をクリック(ドラッグなし)・ダブルクリックした(その場で文の入力を始める) */
  onEditText: () => void;
  /** 文字の文をその場で入力中(selectAll なら始めに文をすべて選ぶ) */
  editingText?: { selectAll: boolean } | null;
  onText?: (text: string) => void;
  onEditTextEnd?: () => void;
  /** 録画に追従する図形が録画の外にはみ出している(枠を赤で示す) */
  outside?: boolean;
  /** 四角・文字の枠を吸着させるほかの要素の枠(ステージのピクセル) */
  targets?: Box[];
}) {
  const { g, object: o } = props;
  const out = (q: Pt) => toOutput(g, q.x, q.y);
  const src = (q: Pt) => {
    const s = toSource(g, q.x, q.y);
    return { x: Math.round(s.x), y: Math.round(s.y) };
  };
  if (isPath(o)) {
    const first = o.path[0] as Pt;
    const last = o.path[o.path.length - 1] as Pt;
    return (
      <LineEditor
        a={out(first)}
        b={out(last)}
        labels={["1", "2"]}
        snap="horizontal"
        onChange={(a, b, key, move) => {
          const sa = src(a);
          const sb = src(b);
          if (move) {
            // 動かしたぶんを全部の点に足す(フリーハンドの形を保つ)
            const dx = sa.x - first.x;
            const dy = sa.y - first.y;
            props.onChange({ ...o, path: o.path.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) }, key);
            return;
          }
          const path = o.path.map((p, i) =>
            i === 0 ? { ...p, ...sa } : i === o.path.length - 1 ? { ...p, ...sb } : p,
          );
          props.onChange({ ...o, path }, key);
        }}
      />
    );
  }
  const s = o as Shape;
  if (s.type === "arrow") {
    return (
      <LineEditor
        a={out(s.from)}
        b={out(s.to)}
        labels={null}
        snap="angle"
        warn={props.outside}
        onChange={(a, b, key) => props.onChange({ ...s, from: src(a), to: src(b) }, key)}
      />
    );
  }
  const a = out(s.rect);
  const box = { x: a.x, y: a.y, w: s.rect.w * g.k, h: s.rect.h * g.k };
  if (s.type === "text" && props.editingText) {
    // 入力中は取っ手を出さず、描画と同じ書体・大きさ・揃えの入力欄を枠に重ねる(行のまとまりは枠の上下の中央)
    const st = resolveTextStyle(props.project, s);
    const px = st.size * g.k;
    return (
      <div className="object-text-edit" style={{ left: box.x, top: box.y, width: box.w, height: box.h }}>
        <ObjectTextInput
          value={s.text}
          selectAll={props.editingText.selectAll}
          style={{
            font: objectFont(st.font, px),
            lineHeight: `${px * TEXT_LINE_HEIGHT}px`,
            color: st.color,
            textAlign: st.align,
            padding: `0 ${px * TEXT_PAD}px`,
            caretColor: st.color,
          }}
          onChange={(v) => props.onText?.(v)}
          onEnd={() => props.onEditTextEnd?.()}
        />
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。文は設定パネルでも直せる
    <div
      className={`object-layer${props.outside ? " warn" : ""}`}
      title={props.outside ? t("outsideVideoTip") : undefined}
      onDoubleClick={s.type === "text" ? props.onEditText : undefined}
    >
      <BoxEditor
        box={box}
        onClick={s.type === "text" ? props.onEditText : undefined}
        anchor={props.anchor}
        snapX={[g.box.x + g.box.w / 2]}
        snapY={[g.box.y + g.box.h / 2]}
        // 画面に固定した図形は、画面の辺に加えて録画の辺にも吸着する
        edgeX={[
          g.box.x,
          g.box.x + g.box.w,
          ...(isScreenAnchored(s) ? [g.video.x, g.video.x + g.video.w] : []),
        ]}
        edgeY={[
          g.box.y,
          g.box.y + g.box.h,
          ...(isScreenAnchored(s) ? [g.video.y, g.video.y + g.video.h] : []),
        ]}
        targets={props.targets}
        onChange={(b, key, _shape, move) => {
          const p = src(b);
          if (move) {
            props.onChange({ ...s, rect: { ...s.rect, x: p.x, y: p.y } }, key);
            return;
          }
          const q = src({ x: b.x + b.w, y: b.y + b.h });
          if (q.x - p.x < 4 || q.y - p.y < 4) return;
          props.onChange({ ...s, rect: { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y } }, key);
        }}
      />
    </div>
  );
}

const SNAP_PX = 10;
/** 角度の吸着(度)。矢印は 45 度ごとに吸着する */
const SNAP_DEG = 6;

/**
 * 線の編集(ポインターの動き・蛍光ペン・矢印)。両端の取っ手で端を、線のドラッグで全体を動かす。
 * horizontal は水平に、angle は 45 度ごとに吸着する(Alt で吸着しない)
 */
function LineEditor(props: {
  a: Pt;
  b: Pt;
  labels: [string, string] | null;
  snap: "horizontal" | "angle" | "none";
  onChange: (a: Pt, b: Pt, key: string, move: boolean) => void;
  warn?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const begin = (e: React.PointerEvent, mode: "a" | "b" | "move") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const a0 = props.a;
    const b0 = props.b;
    const key = `drag-line-${Date.now()}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      setDragging(true);
      if (mode === "move") {
        props.onChange({ x: a0.x + dx, y: a0.y + dy }, { x: b0.x + dx, y: b0.y + dy }, key, true);
        return;
      }
      const fixed = mode === "a" ? b0 : a0;
      const start = mode === "a" ? a0 : b0;
      let p = { x: start.x + dx, y: start.y + dy };
      if (!ev.altKey) p = snapPoint(p, fixed, props.snap);
      if (mode === "a") props.onChange(p, b0, key, false);
      else props.onChange(a0, p, key, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const { a, b } = props;
  return (
    <div className={`line-layer ${dragging ? "dragging" : ""} ${props.warn ? "warn" : ""}`}>
      <svg className="line-svg" aria-hidden="true">
        <line className="line-guide" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line
          className="line-hit"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          onPointerDown={(e) => begin(e, "move")}
        >
          <title>{t("tipLineBody")}</title>
        </line>
      </svg>
      {(["a", "b"] as const).map((k, i) => {
        const p = k === "a" ? a : b;
        return (
          <div
            key={k}
            className={`line-handle ${k}`}
            style={{ left: p.x, top: p.y }}
            title={t("tipLineEnd")}
            onPointerDown={(e) => begin(e, k)}
          >
            {props.labels?.[i]}
          </div>
        );
      })}
    </div>
  );
}

function snapPoint(p: Pt, fixed: Pt, mode: "horizontal" | "angle" | "none"): Pt {
  if (mode === "horizontal") return Math.abs(p.y - fixed.y) <= SNAP_PX * 2 ? { x: p.x, y: fixed.y } : p;
  if (mode === "angle") {
    const dx = p.x - fixed.x;
    const dy = p.y - fixed.y;
    const len = Math.hypot(dx, dy);
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const near = Math.round(deg / 45) * 45;
    if (Math.abs(deg - near) <= SNAP_DEG) {
      const r = (near * Math.PI) / 180;
      return { x: fixed.x + Math.cos(r) * len, y: fixed.y + Math.sin(r) * len };
    }
  }
  return p;
}

/** プレビュー上の文字のオブジェクトの文の入力欄。出したときにフォーカスし、文の末尾にカーソルを置く(selectAll なら全体を選ぶ) */
function ObjectTextInput(props: {
  value: string;
  selectAll: boolean;
  style: React.CSSProperties;
  onChange: (text: string) => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 出したときだけ
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (props.selectAll) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="object-text-input"
      aria-label={t("textPlaceholder")}
      value={props.value}
      placeholder={t("textPlaceholder")}
      style={props.style}
      // 入力欄の中のドラッグは文字の選択にする(枠の移動・ほかの要素の選択にしない)
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
      onBlur={props.onEnd}
    />
  );
}
