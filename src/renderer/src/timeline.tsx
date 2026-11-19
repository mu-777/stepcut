// タイムライン(UI-03, UI-04)。トラックは固定(映像・テロップ・読み上げ・ズーム)。
// 目盛りと全トラックで同じ「時刻→ピクセル」変換(x = 時刻 × pps)を使い、表示がずれないようにする。
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { captionWindow } from "../../core/captions";
import {
  DEFAULT_ZOOM_LENGTH,
  isImageSource,
  resolveLayout,
  resolveOutput,
  speechPieces,
  speechStartOffset,
  speechText,
  stepSourceEnabled,
  stepSpeed,
  withSpeechPieces,
  zoomHoldMode,
  zoomTransition,
} from "../../core/defaults";
import {
  addHold,
  canMergeSteps,
  deleteStep,
  resizeImageStepStart,
  splitStep,
  trimStep,
} from "../../core/edit";
import { computeLayout, retimeZoom, sortedKeys, zoomScale } from "../../core/layout";
import {
  type AnyObject,
  isPath,
  type ObjectKind,
  type ObjectRef,
  objectOf,
  objectWindow,
  pathSpan,
  retimeObject,
  shapeOutsideVideo,
  stepObjects,
} from "../../core/objects";
import type { Project, SpeechPiece, Step, Zoom, ZoomKey } from "../../core/schema";
import {
  baseDuration,
  sourceTimeAt,
  speechTimes,
  stepDuration,
  stepHolds,
  type TimelineEntry,
} from "../../core/timeline";
import { t } from "./i18n";
import { Icon, type IconName } from "./icons";
import { keyLabel } from "./keymap";
import type { SourceMedia } from "./media";
import {
  NEW_OBJECT_KINDS,
  type NewObjectKind,
  newKindLabel,
  objectLabel,
  objectLabels,
  objectMenu,
} from "./objects-ui";
import { quantize, type ThumbCache } from "./thumbs";

export type Selection =
  | { kind: "project" }
  /** プレビュー上の録画を選んだ(位置と大きさの編集) */
  | { kind: "video"; step: number }
  | { kind: "step" | "caption"; step: number }
  | { kind: "zoom" | "hold" | "speech"; step: number; index: number }
  /** ポインター・図形(index は種類ごとの配列の番号) */
  | { kind: ObjectKind; step: number; index: number };

export const selectedStep = (s: Selection): number | null => ("step" in s ? s.step : null);

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  /** 同じ操作のキー(メニューの右に表示する) */
  shortcut?: string;
  /** ボタンとして並べるときのアイコン(設定パネルの見出しの右) */
  icon?: IconName;
  /** メニューで、この項目の上に区切り線を引く */
  separator?: boolean;
}

type Update = (fn: (p: Project) => Project, key?: string) => void;

const VIDEO_H = 52;
/** オブジェクトのレーンの 1 行の高さ */
const OBJ_ROW_H = 20;
/** オブジェクトの種類ごとの、ステップの配列の名前 */
const OBJECT_FIELD = { pointer: "pointers", shape: "shapes" } as const;

/**
 * まとめて選んだ帯の端を dt 秒動かす(edge が left なら始まり、right なら終わり)。読み上げは長さが決まっているので変えない。
 * どれもステップの中・0.1 秒以上の長さ(ズームは選んでいないズームと重ならない範囲)に収まるよう dt を詰める
 */
function resizeGroup(
  project: Project,
  timeline: TimelineEntry[],
  items: MultiItem[],
  edge: "left" | "right",
  dtRaw: number,
): Project {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  const picked = new Set(items.map(multiKey));
  const limit = (min: number, max: number) => {
    lo = Math.max(lo, min);
    hi = Math.min(hi, max);
  };
  for (const it of items) {
    const entry = timeline[it.step];
    const st = project.steps[it.step];
    if (!entry || !st || it.kind === "speech") continue;
    if (it.kind === "zoom") {
      const z = st.zooms?.[it.index];
      if (!z) continue;
      const others = (st.zooms ?? []).filter(
        (_, j) => !picked.has(multiKey({ kind: "zoom", step: it.step, index: j })),
      );
      const a = Math.max(0, ...others.filter((o) => o.end <= z.start + 1e-6).map((o) => o.end));
      const b = Math.min(
        entry.duration,
        ...others.filter((o) => o.start >= z.end - 1e-6).map((o) => o.start),
      );
      if (edge === "left") limit(a - z.start, z.end - 0.1 - z.start);
      else limit(z.start + 0.1 - z.end, b - z.end);
    } else {
      const o = objectOf(st, { kind: it.kind, index: it.index });
      if (!o) continue;
      const w = objectWindow(o, entry.duration);
      const span = isPath(o) ? pathSpan(o) : null;
      if (edge === "left") limit(-w.start, w.end - (span ? span.end - span.start : 0) - 0.1 - w.start);
      else limit(Math.max(w.start, span ? span.end : w.start) + 0.1 - w.end, entry.duration - w.end);
    }
  }
  const dt = r3(clamp(dtRaw, Math.min(0, lo), Math.max(0, hi)));
  if (dt === 0) return project;
  const steps = project.steps.map((st, i) => {
    const entry = timeline[i];
    if (!entry || !items.some((it) => it.step === i)) return st;
    const has = (kind: MultiItem["kind"], index: number) => picked.has(multiKey({ kind, step: i, index }));
    const next: Step = { ...st };
    if (st.zooms)
      next.zooms = st.zooms.map((z, j) => {
        if (!has("zoom", j)) return z;
        return edge === "left"
          ? retimeZoom(z, r3(z.start + dt), z.end)
          : retimeZoom(z, z.start, r3(z.end + dt));
      });
    for (const kind of ["pointer", "shape"] as const) {
      const field = OBJECT_FIELD[kind];
      const list = st[field] as Parameters<typeof retimeObject>[0][] | undefined;
      if (!list) continue;
      (next as Record<string, unknown>)[field] = list.map((o, j) => {
        if (!has(kind, j)) return o;
        const w = objectWindow(o, entry.duration);
        return edge === "left"
          ? retimeObject(o, w.start + dt, o.end === undefined ? null : w.end)
          : retimeObject(o, w.start, w.end + dt);
      });
    }
    return next;
  });
  return { ...project, steps };
}

/** ステップの録画の音を鳴らす・消す。既定(等速なら鳴らす・早送りなら消す)と同じなら書かない */
function setStepSourceEnabled(s: Step, on: boolean): Step {
  const { enabled: _old, ...rest } = s.audio?.source ?? {};
  const source = on === stepSpeed(s) <= 1 ? rest : { ...rest, enabled: on };
  const audio = { ...s.audio, source: Object.keys(source).length ? source : undefined };
  if (!audio.source) delete audio.source;
  return { ...s, audio: Object.keys(audio).length ? audio : undefined };
}

/** コピー・切り取りできる要素 */
export type ClipItem = { kind: "zoom" | "speech" | ObjectKind; step: number; index: number };

/** コピーしたもの(アプリ内だけで持つ) */
export type Clip =
  | { kind: "zoom"; zoom: Zoom; srcW: number; srcH: number }
  | { kind: "speech"; piece: SpeechPiece }
  | { kind: "object"; objKind: ObjectKind; object: AnyObject; srcW: number; srcH: number };

/** Ctrl+クリックでまとめて選べる帯(読み上げ・ズーム・オブジェクト) */
type MultiItem = { kind: "speech" | "zoom" | ObjectKind; step: number; index: number };
const multiKey = (m: MultiItem) => `${m.kind}:${m.step}:${m.index}`;

/**
 * まとめて選んだ帯を dt 秒ずらす。どれもステップの中(ズームは選んでいないズームと重ならない範囲)に収まるよう
 * dt を詰める。読み上げ・ズーム・オブジェクトの時刻はステップ内の時刻なので、ステップはまたがない
 */
function shiftGroup(
  project: Project,
  timeline: TimelineEntry[],
  items: MultiItem[],
  speechDurations: ReadonlyMap<string, readonly number[]>,
  dtRaw: number,
): Project {
  let lo = Number.NEGATIVE_INFINITY;
  let hi = Number.POSITIVE_INFINITY;
  const picked = new Set(items.map(multiKey));
  const speechStart = (st: Step, k: number) =>
    speechTimes(st, speechDurations.get(st.id) ?? [], speechStartOffset(project))[k]?.start ?? 0;
  for (const it of items) {
    const entry = timeline[it.step];
    const st = project.steps[it.step];
    if (!entry || !st) continue;
    if (it.kind === "zoom") {
      const z = st.zooms?.[it.index];
      if (!z) continue;
      const others = (st.zooms ?? []).filter(
        (_, j) => !picked.has(multiKey({ kind: "zoom", step: it.step, index: j })),
      );
      const a = Math.max(0, ...others.filter((o) => o.end <= z.start + 1e-6).map((o) => o.end));
      const b = Math.min(
        entry.duration,
        ...others.filter((o) => o.start >= z.end - 1e-6).map((o) => o.start),
      );
      lo = Math.max(lo, a - z.start);
      hi = Math.min(hi, b - z.end);
    } else if (it.kind === "speech") {
      const x = speechStart(st, it.index);
      lo = Math.max(lo, -x);
      hi = Math.min(hi, baseDuration(st) - x);
    } else {
      const o = objectOf(st, { kind: it.kind, index: it.index });
      if (!o) continue;
      const w = objectWindow(o, entry.duration);
      lo = Math.max(lo, -w.start);
      hi = Math.min(hi, entry.duration - w.end);
    }
  }
  const dt = r3(clamp(dtRaw, Math.min(0, lo), Math.max(0, hi)));
  if (dt === 0) return project;
  const steps = project.steps.map((st, i) => {
    const mine = items.filter((it) => it.step === i);
    if (mine.length === 0) return st;
    const has = (kind: MultiItem["kind"], index: number) => picked.has(multiKey({ kind, step: i, index }));
    const entry = timeline[i];
    const next: Step = { ...st };
    if (st.zooms)
      next.zooms = st.zooms.map((z, j) =>
        has("zoom", j) ? retimeZoom(z, r3(z.start + dt), r3(z.end + dt)) : z,
      );
    if (mine.some((it) => it.kind === "speech")) {
      const pieces = speechPieces(st).map((p, k) => {
        if (!has("speech", k)) return p;
        const v = r3(speechStart(st, k) + dt);
        return { ...p, start: v };
      });
      Object.assign(next, withSpeechPieces(next, pieces));
    }
    for (const kind of ["pointer", "shape"] as const) {
      const field = OBJECT_FIELD[kind];
      const list = st[field] as Parameters<typeof retimeObject>[0][] | undefined;
      if (!list || !entry) continue;
      (next as Record<string, unknown>)[field] = list.map((o, j) => {
        if (!has(kind, j)) return o;
        const w = objectWindow(o, entry.duration);
        return retimeObject(o, w.start + dt, o.end === undefined ? null : w.end + dt);
      });
    }
    return next;
  });
  return { ...project, steps };
}
const TILE_W = Math.round((VIDEO_H - 4) * (16 / 9));
const SNAP_PX = 6;
/** オブジェクトの終わりをステップの終わりで止めておく幅(px)。これを越えて引くとステップを伸ばす */
const STICK_PX = 24;
/** 再生ヘッドを吸着させる距離 */
const SEEK_SNAP_PX = 8;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

let dragSeq = 0;

/** ポインターのドラッグ。移動量(ピクセル)を渡す。1 回のドラッグの変更は Undo 1 回分にまとめる */
function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, key: string) => void,
  onEnd?: () => void,
): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const x0 = e.clientX;
  const key = `drag${++dragSeq}`;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0, key);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function patchStep(update: Update, index: number, fn: (s: Step) => Step, key: string) {
  update((p) => ({ ...p, steps: p.steps.map((s, i) => (i === index ? fn(s) : s)) }), key);
}

export function ThumbTile(props: { thumb: (CanvasImageSource & { width: number; height: number }) | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (props.thumb) ctx.drawImage(props.thumb, 0, 0, c.width, c.height);
  }, [props.thumb]);
  return <canvas ref={ref} width={TILE_W * 2} height={(VIDEO_H - 4) * 2} />;
}

/** 目盛りの間隔(秒)。主目盛りが 70px 以上空くもの */
function tickInterval(pps: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * pps >= 70) ?? 600;
}

/** サムネイルの刻み(秒、ソースの時刻)。タイル 1 枚分の長さ以上で最小のもの */
function thumbQuantum(secondsPerTile: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 30, 60];
  return steps.find((s) => s >= secondsPerTile) ?? 60;
}

export function Timeline(props: {
  project: Project;
  timeline: TimelineEntry[];
  total: number;
  time: number;
  playing: boolean;
  media: Map<string, SourceMedia>;
  thumbs: ThumbCache;
  thumbsVersion: number;
  speechDurations: ReadonlyMap<string, readonly number[]>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  update: Update;
  /** クリップ端のドラッグ中に、新しい In/Out のフレームを表示する(null で解除) */
  onTrimPreview: (v: { step: number; time: number } | null) => void;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  /** 録画・画像を選んでステップとして足す(after を渡すとそのステップの後ろ、省略すると末尾) */
  onAddSource: (after?: number) => void;
  /** ズームの枠 key(時刻の順の番号。省略すると最初の枠)の編集を始める */
  onEditZoomRect: (step: number, zoom: number, key?: number) => void;
  /** 読み上げだけを鳴らす */
  onPreviewSpeech: (step: number) => void;
  /** プレビューで編集中のズームの枠 */
  editingKey: { step: number; zoom: number; key: number } | null;
  /** ステップ i と次のステップをまとめる */
  onMergeNext: (step: number) => void;
  /** ズームのコピーと貼り付け(貼り付けは全体の時刻 at に) */
  /** 最後にコピーしたものの種類(貼り付けを出すか決める) */
  clipKind: Clip["kind"] | null;
  onCopy: (item: ClipItem) => void;
  onCut: (item: ClipItem) => void;
  /** コピーしたもの(kind の種類のときだけ)を全体の時刻 at に貼る */
  onPaste: (at: number, kind: Clip["kind"]) => void;
  onRemove: (item: Selection) => void;
  /** その時刻(全体)にオブジェクトを足す */
  onAddObjectAt: (kind: NewObjectKind, at: number) => void;
  /** 再生位置のステップに、時刻 local でズームを足して範囲の編集を始める */
  onAddZoomAt: (step: number, local: number) => void;
  /** オブジェクトを選ぶ(再生位置は動かさない) */
  onSelectObject: (step: number, ref: ObjectRef) => void;
  /** ズーム step / zoom の時刻 local に枠を足して、その枠の編集を始める */
  onAddZoomKey: (step: number, zoom: number, local: number) => void;
}) {
  const { project, timeline, total, time, update, selection } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pps, setPps] = useState(50);
  const [fit, setFit] = useState(true);
  const fitPps = Math.max(1, (viewW - 24) / Math.max(total, 1));
  const scale = fit ? fitPps : pps;
  const innerW = Math.max(viewW, total * scale + 40);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Ctrl+ホイールで拡大縮小(カーソル位置の時刻を保つ)。ホイールだけなら横スクロール
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const cur = scaleRef.current;
        const tAt = (el.scrollLeft + mx) / cur;
        const next = clamp(cur * Math.exp(-e.deltaY * 0.002), 0.5, 2000);
        setFit(false);
        setPps(next);
        requestAnimationFrame(() => {
          el.scrollLeft = tAt * next - mx;
        });
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      } else if (e.deltaX !== 0) {
        // 横のホイール(チルト・タッチパッド)はその向きへ
        e.preventDefault();
        el.scrollLeft += e.deltaX;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** 左上の角のボタンからの拡大・縮小・全体表示。拡大縮小は再生ヘッドの位置を中央に保つ */
  const zoomBy = (kind: "in" | "out" | "fit") => {
    const el = scrollRef.current;
    if (kind === "fit") {
      setFit(true);
      return;
    }
    const next = clamp(scale * (kind === "in" ? 1.5 : 1 / 1.5), 0.5, 2000);
    setFit(false);
    setPps(next);
    if (el) {
      const tAt = time;
      requestAnimationFrame(() => {
        el.scrollLeft = tAt * next - el.clientWidth / 2;
      });
    }
  };

  // 再生中は再生ヘッドを画面内に保つ
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !props.playing) return;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 30) el.scrollLeft = x - 30;
  }, [time, scale, props.playing]);

  const xToTime = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left + el.scrollLeft) / scale, 0, total);
  };

  /** 再生ヘッドとステップ境界に吸着させる */
  const snap = (tm: number, offset = 0) => {
    const cands = [time - offset, ...timeline.map((e) => e.start - offset)];
    for (const c of cands) if (Math.abs(c - tm) * scale <= SNAP_PX) return c;
    return tm;
  };

  /** 再生ヘッドを吸着させる時刻: ステップの切れ目、テロップ・読み上げ・ズーム・保持の始まりと終わり */
  const seekTargets = () => {
    const ts: number[] = [total];
    for (const e of timeline) {
      const s = e.step;
      ts.push(e.start);
      const cw = captionWindow(s, e.duration);
      if (cw) ts.push(e.start + cw.start, e.start + cw.end);
      const sd = props.speechDurations.get(s.id) ?? [];
      speechTimes(s, sd, speechStartOffset(project)).forEach((x, k) => {
        if (!speechText(s, k)) return;
        ts.push(e.start + x.start);
        if (sd[k]) ts.push(e.start + x.end);
      });
      for (const z of s.zooms ?? []) ts.push(e.start + z.start, e.start + z.end);
      for (const ref of stepObjects(s)) {
        const o = objectOf(s, ref);
        if (!o) continue;
        const w = objectWindow(o, e.duration);
        ts.push(e.start + w.start, e.start + w.end);
      }
      for (const h of stepHolds(s)) ts.push(e.start + h.at, e.start + h.at + h.duration);
      const base = baseDuration(s);
      if (e.duration > base) ts.push(e.start + base);
    }
    return ts;
  };

  /** シーク位置。Shift を押している間は吸着しない */
  const seekAt = (clientX: number, free: boolean) => {
    const tm = xToTime(clientX);
    if (free) return tm;
    let best = tm;
    let gap = SEEK_SNAP_PX / scale;
    for (const c of seekTargets()) {
      if (Math.abs(c - tm) <= gap) {
        best = c;
        gap = Math.abs(c - tm);
      }
    }
    return best;
  };

  // Ctrl+クリックでまとめて選んだ帯。まとめてドラッグで動かせる
  const [multi, setMulti] = useState<MultiItem[]>([]);
  const inMulti = (m: MultiItem) => multi.length > 1 && multi.some((x) => multiKey(x) === multiKey(m));
  /** Ctrl+クリック: 帯をまとめて選ぶ・外す。最初は今選んでいる帯も入れる */
  const toggleMulti = (m: MultiItem) => {
    const cur =
      multi.length > 0
        ? multi
        : "index" in selection &&
            (selection.kind === "speech" ||
              selection.kind === "zoom" ||
              selection.kind === "pointer" ||
              selection.kind === "shape")
          ? [{ kind: selection.kind, step: selection.step, index: selection.index }]
          : [];
    const k = multiKey(m);
    setMulti(cur.some((x) => multiKey(x) === k) ? cur.filter((x) => multiKey(x) !== k) : [...cur, m]);
  };
  /**
   * 帯の押下。Ctrl なら選びに加え(ドラッグしない)、まとめて選んだ帯ならまとめてドラッグ、それ以外は 1 つを選ぶ。
   * ダブルクリックで再生位置をその始まり(全体の時刻 at)へ移す(ズームのダブルクリックは枠を足す)
   */
  const barProps = (
    m: MultiItem,
    onSelect: () => void,
    onMove: (dx: number, key: string) => void,
    at: number,
  ) => ({
    multi: inMulti(m),
    onCtrlClick: () => toggleMulti(m),
    // 選んでも再生位置は動かさない(再生位置へ要素を動かす操作のため)。ダブルクリックで始まりへ移す
    onSelect: () => {
      if (!inMulti(m)) {
        setMulti([]);
        onSelect();
      }
    },
    onDoubleClick: m.kind === "zoom" ? undefined : () => props.onSeek(at),
    onMove: inMulti(m)
      ? (dx: number, key: string) =>
          update(() => shiftGroup(project, timeline, multi, props.speechDurations, dx / scale), key)
      : onMove,
  });
  /** 帯の端のドラッグ。まとめて選んだ帯なら、選んだものすべての同じ側の端を同じだけ動かす */
  const groupEdge =
    (m: MultiItem, edge: "left" | "right", single: (dx: number, key: string) => void) =>
    (dx: number, key: string) => {
      if (inMulti(m)) update(() => resizeGroup(project, timeline, multi, edge, dx / scale), key);
      else single(dx, key);
    };
  // タイムラインの外で選び直したら、まとめた選択を解く
  useEffect(() => {
    if (!("index" in selection)) setMulti([]);
  }, [selection]);

  const scrubFrom = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setMulti([]);
    props.onSeek(seekAt(e.clientX, e.shiftKey));
    const move = (ev: PointerEvent) => props.onSeek(seekAt(ev.clientX, ev.shiftKey));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 目盛り
  const ticks: ReactNode[] = [];
  const iv = tickInterval(scale);
  const first = Math.floor(scrollLeft / scale / iv) * iv;
  for (let tk = first; tk <= Math.min(total + iv, (scrollLeft + viewW) / scale); tk += iv) {
    const v = Math.round(tk * 1000) / 1000;
    ticks.push(
      <div key={v} className="tl-tick" style={{ left: v * scale }}>
        <span>{fmtTime(v).replace(/\.00$/, "")}</span>
      </div>,
    );
  }

  const visL = scrollLeft - TILE_W;
  const visR = scrollLeft + viewW + TILE_W;
  const isSel = (kind: Selection["kind"], step: number, index?: number) =>
    selection.kind === kind &&
    "step" in selection &&
    selection.step === step &&
    (index === undefined || ("index" in selection && selection.index === index));

  /** 録画の音を全体で鳴らすか(タイムラインの映像の段の切り替え) */
  const projectSound = project.audio?.source?.enabled !== false;

  const clipMenu = (e: React.MouseEvent, entry: TimelineEntry) => {
    e.preventDefault();
    const at = xToTime(e.clientX);
    const local = at - entry.start;
    const i = entry.index;
    props.onSelect({ kind: "step", step: i });
    props.onSeek(at);
    props.openMenu(e.clientX, e.clientY, [
      {
        label: t("split"),
        shortcut: keyLabel("split"),
        action: () => update((p) => splitStep(p, i, local, true)),
      },
      { label: t("splitDiscard"), action: () => update((p) => splitStep(p, i, local, false)) },
      { label: t("addHoldHere"), action: () => update((p) => addHold(p, i, local, 1)) },
      {
        label: t("addHoldEnd"),
        action: () => update((p) => addHold(p, i, baseDuration(p.steps[i] as Step), 1)),
      },
      { label: t("mergeNext"), disabled: !canMergeSteps(project, i), action: () => props.onMergeNext(i) },
      // ステップの録画の音(全体で消しているときは、全体の切り替えが先)。画像には音がない
      ...(isImageStep(entry.step)
        ? []
        : [
            {
              label: t(stepSourceEnabled(entry.step) ? "muteStepAudio" : "unmuteStepAudio"),
              disabled: !projectSound,
              action: () =>
                patchStep(update, i, (s) => setStepSourceEnabled(s, !stepSourceEnabled(s)), "step-audio"),
            },
          ]),
      { label: t("addSourceAfter"), action: () => props.onAddSource(i) },
      { label: t("deleteStep"), shortcut: keyLabel("delete"), action: () => update((p) => deleteStep(p, i)) },
    ]);
  };

  /** ステップの素材が画像か(画像はどの時刻も同じ 1 枚。長さは自由に変えられ、音はない) */
  const isImageStep = (step: Step) =>
    isImageSource(project.sources.find((s) => s.id === step.source)?.path ?? "");

  /** ラインのダブルクリック: その時刻のステップを返す */
  const entryAt = (clientX: number) => {
    const at = xToTime(clientX);
    const entry = timeline.find((e) => at >= e.start && at < e.start + e.duration) ?? timeline.at(-1);
    return entry ? { entry, local: r3(Math.max(0, at - entry.start)) } : null;
  };

  /** テロップのラインをダブルクリック。テロップがなければその時刻から作り、あれば選ぶ */
  const captionLaneDoubleClick = (e: React.MouseEvent) => {
    const hit = entryAt(e.clientX);
    if (!hit) return;
    const i = hit.entry.index;
    if (!hit.entry.step.caption) {
      patchStep(
        update,
        i,
        (s) => ({ ...s, caption: hit.local > 0 ? { text: "", start: hit.local } : { text: "" } }),
        "caption-add",
      );
    }
    props.onSelect({ kind: "caption", step: i });
  };

  /** 読み上げのラインをダブルクリック。読み上げの上なら選び、空いているところなら新しく作る */
  const speechLaneDoubleClick = (e: React.MouseEvent) => {
    const hit = entryAt(e.clientX);
    if (!hit) return;
    const { entry, local } = hit;
    const i = entry.index;
    const times = speechTimes(
      entry.step,
      props.speechDurations.get(entry.step.id) ?? [],
      speechStartOffset(project),
    );
    const on = times.findIndex(
      (x, k) => local >= x.start && local <= Math.max(x.end, x.start + (speechText(entry.step, k) ? 0 : 1)),
    );
    if (on >= 0) {
      props.onSelect({ kind: "speech", step: i, index: on });
      return;
    }
    addSpeechAt(e.clientX);
  };

  /** 画面の x の時刻に読み上げを足す。1 つ目はテロップと同じ文を読む設定で作る。2 つ目からは文を書いてもらう */
  const addSpeechAt = (clientX: number) => {
    const hit = entryAt(clientX);
    if (!hit) return;
    const { entry, local } = hit;
    const i = entry.index;
    const pieces = speechPieces(entry.step);
    const at = Math.min(local, baseDuration(entry.step));
    const piece = pieces.length === 0 ? (at > 0 ? { start: at } : {}) : { text: "", start: at };
    patchStep(update, i, (s) => withSpeechPieces(s, [...speechPieces(s), piece]), "speech-add");
    props.onSelect({ kind: "speech", step: i, index: pieces.length });
  };

  /** 要素の右クリックのコピー・切り取り(と削除) */
  const clipMenuItems = (item: ClipItem, withRemove = true): MenuItem[] => [
    { label: t("copy"), shortcut: "Ctrl+C", action: () => props.onCopy(item) },
    { label: t("cut"), shortcut: "Ctrl+X", action: () => props.onCut(item) },
    ...(withRemove
      ? [{ label: t("remove"), shortcut: keyLabel("delete"), action: () => props.onRemove(item) }]
      : []),
  ];

  /** レーンの空いた所の右クリックの貼り付け(その種類をコピーしているときだけ) */
  const pasteItem = (kind: Clip["kind"], at: number): MenuItem => ({
    label: t("pasteHere"),
    shortcut: "Ctrl+V",
    disabled: props.clipKind !== kind,
    action: () => props.onPaste(at, kind),
  });

  /** ズームのラインをダブルクリック。空いているところならズームを作り、範囲の編集を始める */
  const zoomLaneDoubleClick = (e: React.MouseEvent) => {
    const hit = entryAt(e.clientX);
    if (!hit) return;
    const zooms = hit.entry.step.zooms ?? [];
    const on = zooms.findIndex((z) => hit.local >= z.start && hit.local <= z.end);
    // ズームの上ならその時刻に枠を足す
    if (on >= 0) props.onAddZoomKey(hit.entry.index, on, hit.local);
    else props.onAddZoomAt(hit.entry.index, hit.local);
  };

  // オブジェクトは重なる時刻ごとに行を分ける(ステップごとに、始まりの順で空いている行へ)
  const objRows = timeline.map((entry) => {
    const rowEnds: number[] = [];
    const rows = new Map<string, number>();
    const items = stepObjects(entry.step)
      .map((ref) => {
        const o = objectOf(entry.step, ref);
        return o ? { ref, w: objectWindow(o, entry.duration) } : null;
      })
      .filter((x) => x !== null)
      .sort((a, b) => a.w.start - b.w.start);
    for (const it of items) {
      let r = rowEnds.findIndex((end) => end <= it.w.start + 1e-6);
      if (r < 0) r = rowEnds.length;
      rowEnds[r] = it.w.end;
      rows.set(`${it.ref.kind}:${it.ref.index}`, r);
    }
    return { rows, count: Math.max(1, rowEnds.length) };
  });
  const objRowCount = Math.max(1, ...objRows.map((r) => r.count));
  const objLaneH = 4 + objRowCount * OBJ_ROW_H;

  return (
    <div className="timeline">
      <div className="tl-labels">
        <div className="tl-label ruler-label tl-zoom">
          {(
            [
              ["out", "zoomOut", "−"],
              ["in", "zoomIn", "+"],
              ["fit", "timelineFit", "↔"],
            ] as const
          ).map(([kind, label, text]) => (
            <button
              key={kind}
              type="button"
              className="tl-zoom-btn"
              title={kind === "fit" ? t(label) : `${t(label)} (Ctrl+Wheel)`}
              aria-label={t(label)}
              onClick={() => zoomBy(kind)}
            >
              {text}
            </button>
          ))}
        </div>
        <div className="tl-label tl-video-label" style={{ height: VIDEO_H }}>
          <span>{t("trackVideo")}</span>
          {/* 録画の音を全体で鳴らす・消す(プレビューと書き出しの両方) */}
          <button
            type="button"
            className={`tl-sound${projectSound ? "" : " off"}`}
            title={t(projectSound ? "muteSourceAll" : "unmuteSourceAll")}
            aria-label={t(projectSound ? "muteSourceAll" : "unmuteSourceAll")}
            aria-pressed={!projectSound}
            onClick={() =>
              update(
                (p) => ({
                  ...p,
                  audio: {
                    ...p.audio,
                    source: { ...p.audio?.source, enabled: projectSound ? false : undefined },
                  },
                }),
                "project-audio",
              )
            }
          >
            <Icon name={projectSound ? "volume" : "muted"} />
          </button>
        </div>
        <div className="tl-label">{t("caption")}</div>
        <div className="tl-label">{t("speech")}</div>
        <div className="tl-label">{t("zooms")}</div>
        <div className="tl-label" style={{ height: objLaneH }}>
          {t("trackObjects")}
        </div>
      </div>
      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
        onPointerDown={(e) => {
          // レーンの下の空いた所
          if (e.target === e.currentTarget) scrubFrom(e);
        }}
      >
        <div className="tl-inner" style={{ width: innerW }} onPointerDown={scrubFrom}>
          <div className="tl-ruler">{ticks}</div>

          {/* 映像。クリップの後ろの空いた所の右クリックで録画・画像を末尾に足す */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。追加はステップ一覧のボタンでもできる */}
          <div
            className="tl-lane tl-video-lane"
            style={{ height: VIDEO_H }}
            onContextMenu={(e) => {
              if (e.target !== e.currentTarget) return;
              e.preventDefault();
              props.openMenu(e.clientX, e.clientY, [
                { label: t("addSourceEnd"), action: () => props.onAddSource() },
              ]);
            }}
          >
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const x0 = entry.start * scale;
              const w = entry.duration * scale;
              const m = props.media.get(step.source);
              const tiles: ReactNode[] = [];
              if (m && x0 + w >= visL && x0 <= visR) {
                const quantum = thumbQuantum((TILE_W / scale) * stepSpeed(step));
                const k0 = Math.max(0, Math.floor((visL - x0) / TILE_W));
                const k1 = Math.min(Math.ceil(w / TILE_W), Math.ceil((visR - x0) / TILE_W));
                for (let k = k0; k < k1; k++) {
                  const local = Math.min(((k + 0.5) * TILE_W) / scale, entry.duration);
                  const src = sourceTimeAt(step, local);
                  const q = quantize(src, quantum);
                  const thumb = props.thumbs.get(m, q) ?? props.thumbs.nearest(m, src, quantum * 2);
                  tiles.push(
                    <div key={k} className="tl-tile" style={{ left: k * TILE_W }}>
                      <ThumbTile thumb={thumb} />
                    </div>,
                  );
                }
              }
              const base = baseDuration(step);
              const explicit = step.holds ?? [];
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                <div
                  key={`${i}-${step.id}`}
                  className={`tl-clip ${isSel("step", i) ? "selected" : ""}`}
                  style={{ left: x0, width: w }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    setMulti([]);
                    props.onSelect({ kind: "step", step: i });
                    // 再生位置がこのステップの外なら始まりへ(中ならそのまま)
                    if (time < entry.start || time >= entry.start + entry.duration) props.onSeek(entry.start);
                  }}
                  onContextMenu={(e) => clipMenu(e, entry)}
                >
                  <div className="tl-tiles">{tiles}</div>
                  {(!projectSound || !stepSourceEnabled(step)) && (
                    <span className="tl-clip-muted" title={t("sourceMuted")}>
                      <Icon name="muted" />
                    </span>
                  )}
                  {/* ステップのフェードイン・フェードアウト(黒から現れる・黒へ消える区間) */}
                  {step.fadeIn ? (
                    <div
                      className="tl-fade in"
                      style={{ width: Math.min(step.fadeIn, entry.duration) * scale }}
                      title={t("fadeIn")}
                    >
                      <FadeRamp dir="in" />
                    </div>
                  ) : null}
                  {step.fadeOut ? (
                    <div
                      className="tl-fade out"
                      style={{ width: Math.min(step.fadeOut, entry.duration) * scale }}
                      title={t("fadeOut")}
                    >
                      <FadeRamp dir="out" />
                    </div>
                  ) : null}
                  {stepHolds(step).map((h) => {
                    const k = explicit.findIndex((x) => x.at === h.at && x.duration === h.duration);
                    return (
                      <div
                        key={`h${h.at}`}
                        className={`tl-hold ${k < 0 ? "zoom-hold" : ""} ${k >= 0 && isSel("hold", i, k) ? "selected" : ""}`}
                        style={{ left: h.at * scale, width: h.duration * scale }}
                        title={t("holds")}
                        onPointerDown={(e) => {
                          if (k < 0 || e.button !== 0) return;
                          props.onSelect({ kind: "hold", step: i, index: k });
                          // ドラッグで位置を動かす(再生ヘッド・ステップの切れ目に始まりか終わりを吸着)。
                          // 動かさずに離したら、そこへシークする
                          const holds = stepHolds(step);
                          const prev = [...holds].reverse().find((x) => x.at < h.at);
                          const next = holds.find((x) => x.at > h.at);
                          const lo = prev ? prev.at + prev.duration : 0;
                          const hi = (next ? next.at : base) - h.duration;
                          let moved = false;
                          startDrag(e, (dx, key) => {
                            if (!moved && Math.abs(dx) < 3) return;
                            moved = true;
                            const raw = entry.start + h.at + dx / scale;
                            let tm = snap(raw);
                            if (tm === raw) tm = snap(raw, h.duration);
                            const at = r3(clamp(tm - entry.start, lo, hi));
                            patchStep(
                              update,
                              i,
                              (s) => ({
                                ...s,
                                holds: s.holds?.map((x, j) => (j === k ? { ...x, at } : x)),
                              }),
                              key,
                            );
                          });
                        }}
                      >
                        {k >= 0 && (
                          <div
                            className="tl-handle right"
                            onPointerDown={(e) => {
                              const d0 = h.duration;
                              const next = stepHolds(step).find((x) => x.at > h.at);
                              props.onSelect({ kind: "hold", step: i, index: k });
                              startDrag(e, (dx, key) => {
                                const d = r3(
                                  clamp(
                                    d0 + dx / scale,
                                    0.1,
                                    next ? next.at - h.at : Number.POSITIVE_INFINITY,
                                  ),
                                );
                                patchStep(
                                  update,
                                  i,
                                  (s) => ({
                                    ...s,
                                    holds: s.holds?.map((x, j) => (j === k ? { ...x, duration: d } : x)),
                                  }),
                                  key,
                                );
                              });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {entry.duration > base + 1e-3 && (
                    <div
                      className="tl-hold auto"
                      style={{ left: base * scale, width: (entry.duration - base) * scale }}
                      title={t("autoHold")}
                    />
                  )}
                  <span className="tl-clip-label">
                    {t("step")} {i + 1}
                    {stepSpeed(step) > 1 ? ` ×${stepSpeed(step)}` : ""}
                  </span>
                  {(["in", "out"] as const).map((edge) => (
                    <div
                      key={edge}
                      className={`tl-handle ${edge === "in" ? "left" : "right"}`}
                      title={t(edge === "in" ? "in" : "out")}
                      onPointerDown={(e) => {
                        const v0 = edge === "in" ? step.in : step.out;
                        const out0 = step.out;
                        const dur = m?.duration ?? Number.POSITIVE_INFINITY;
                        // 画像は左端を動かしても長さだけが変わる(in は 0 のまま。左へも伸ばせる)
                        const image = isImageStep(step);
                        const trim = (p: Project, v: number) =>
                          image && edge === "in"
                            ? resizeImageStepStart(p, i, out0 - v)
                            : trimStep(p, i, edge, v, dur);
                        props.onSelect({ kind: "step", step: i });
                        startDrag(
                          e,
                          (dx, key) => {
                            const v = v0 + (dx / scale) * stepSpeed(step);
                            update((p) => trim(p, v), key);
                            const s2 = trim(project, v).steps[i];
                            if (s2)
                              props.onTrimPreview({ step: i, time: edge === "in" ? s2.in : s2.out - 0.001 });
                          },
                          () => props.onTrimPreview(null),
                        );
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* テロップ。ダブルクリックで作る・選ぶ */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある */}
          <div className="tl-lane" onDoubleClick={captionLaneDoubleClick}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              // 文が空のテロップも、仮の文を出して編集できるようにする
              const w = captionWindow(step, entry.duration, true);
              if (!w) {
                return (
                  <div
                    key={i}
                    className="tl-empty"
                    style={{ left: entry.start * scale, width: entry.duration * scale }}
                  />
                );
              }
              const set = (start: number, end: number | null, key: string) =>
                patchStep(
                  update,
                  i,
                  (s) => {
                    const { start: _s, end: _e, ...rest } = s.caption ?? { text: "" };
                    const c: NonNullable<Step["caption"]> = { ...rest };
                    if (r3(start) > 0) c.start = r3(start);
                    if (end !== null) c.end = r3(end);
                    return { ...s, caption: c };
                  },
                  key,
                );
              return (
                <Bar
                  key={i}
                  className={`caption ${isSel("caption", i) ? "selected" : ""}`}
                  left={(entry.start + w.start) * scale}
                  width={(w.end - w.start) * scale}
                  label={step.caption?.text.trim() ? step.caption.text : `(${t("captionPlaceholder")})`}
                  onSelect={() => {
                    setMulti([]);
                    props.onSelect({ kind: "caption", step: i });
                  }}
                  onDoubleClick={() => props.onSeek(entry.start + w.start)}
                  onMove={(dx, key) => {
                    const len = w.end - w.start;
                    const s = clamp(
                      snap(w.start + dx / scale + entry.start, 0) - entry.start,
                      0,
                      entry.duration - len,
                    );
                    const atEnd = s + len >= entry.duration - 1e-3 && step.caption?.end == null;
                    set(s, atEnd ? null : s + len, key);
                  }}
                  onLeft={(dx, key) => {
                    const s = clamp(snap(entry.start + w.start + dx / scale) - entry.start, 0, w.end - 0.1);
                    set(s, step.caption?.end ?? null, key);
                  }}
                  onRight={(dx, key) => {
                    const e = clamp(
                      snap(entry.start + w.end + dx / scale) - entry.start,
                      w.start + 0.1,
                      entry.duration,
                    );
                    // 末尾まで伸ばしたら「ステップの終わりまで」(end 省略)にする
                    set(w.start, (entry.duration - e) * scale < SNAP_PX ? null : e, key);
                  }}
                />
              );
            })}
          </div>

          {/* 読み上げ。1 ステップに複数置ける。ダブルクリックで作る・選ぶ */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある */}
          <div
            className="tl-lane"
            onDoubleClick={speechLaneDoubleClick}
            onContextMenu={(e) => {
              e.preventDefault();
              const at = xToTime(e.clientX);
              props.openMenu(e.clientX, e.clientY, [
                { label: t("addSpeechHere"), action: () => addSpeechAt(e.clientX) },
                pasteItem("speech", at),
              ]);
            }}
          >
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const pieces = speechPieces(step);
              if (pieces.length === 0) {
                return (
                  <div
                    key={i}
                    className="tl-empty"
                    style={{ left: entry.start * scale, width: entry.duration * scale }}
                  />
                );
              }
              const durs = props.speechDurations.get(step.id) ?? [];
              const times = speechTimes(step, durs, speechStartOffset(project));
              return pieces.map((_, k) => {
                const text = speechText(step, k);
                const d = durs[k];
                const st = times[k]?.start ?? 0;
                const pending = text !== null && !d;
                return (
                  <Bar
                    // biome-ignore lint/suspicious/noArrayIndexKey: 読み上げは id を持たない
                    key={`${i}-${k}`}
                    className={`speech ${pending ? "pending" : ""} ${text === null ? "empty" : ""} ${isSel("speech", i, k) ? "selected" : ""}`}
                    left={(entry.start + st) * scale}
                    width={(d || 1) * scale}
                    label={text ?? `(${t("speechPlaceholder")})`}
                    {...barProps(
                      { kind: "speech", step: i, index: k },
                      () => props.onSelect({ kind: "speech", step: i, index: k }),
                      (dx, key) => moveSpeech(dx, key),
                      entry.start + st,
                    )}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onSelect({ kind: "speech", step: i, index: k });
                      props.openMenu(e.clientX, e.clientY, [
                        { label: t("previewSpeech"), action: () => props.onPreviewSpeech(i) },
                        ...clipMenuItems({ kind: "speech", step: i, index: k }),
                      ]);
                    }}
                  />
                );
                function moveSpeech(dx: number, key: string) {
                  const v = r3(
                    clamp(snap(entry.start + st + dx / scale) - entry.start, 0, baseDuration(step)),
                  );
                  props.onSeek(entry.start + v);
                  patchStep(
                    update,
                    i,
                    (x) =>
                      withSpeechPieces(
                        x,
                        speechPieces(x).map((p, j) => {
                          if (j !== k) return p;
                          const { start: _s, ...rest } = p;
                          // 最初の読み上げの 0 は既定値なので書かない
                          return v > 0 || k > 0 ? { ...rest, start: v } : rest;
                        }),
                      ),
                    key,
                  );
                }
              });
            })}
          </div>

          {/* ズーム。ダブルクリックで作る・範囲を編集する */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある */}
          <div className="tl-lane" onDoubleClick={zoomLaneDoubleClick}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const zooms = step.zooms ?? [];
              const zm = props.media.get(step.source);
              const out = resolveOutput(project);
              const crop = computeLayout(
                out.width,
                out.height,
                resolveLayout(project, step),
                zm?.width ?? 1920,
                zm?.height ?? 1080,
              ).crop;
              const scaleOf = (z: Zoom) => zoomScale(z, crop, zm?.width ?? 1920, zm?.height ?? 1080);
              const setZoom = (k: number, start: number, end: number, key: string) =>
                patchStep(
                  update,
                  i,
                  (s) => ({
                    ...s,
                    // ドラッグを始めたときのズームから区間を変える(枠の時刻も合わせて動かす)
                    zooms: s.zooms?.map((z, j) => (j === k ? retimeZoom(zooms[k] ?? z, start, end) : z)),
                  }),
                  key,
                );
              const bounds = (k: number) => {
                const z = zooms[k] as Zoom;
                const others = zooms.filter((_, j) => j !== k);
                const lo = Math.max(0, ...others.filter((o) => o.end <= z.start + 1e-6).map((o) => o.end));
                const hi = Math.min(
                  entry.duration,
                  ...others.filter((o) => o.start >= z.end - 1e-6).map((o) => o.start),
                );
                return { lo, hi };
              };
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                <div
                  key={i}
                  className="tl-zone"
                  style={{ left: entry.start * scale, width: entry.duration * scale }}
                  onPointerDown={(e) => {
                    // 空いているところをドラッグしてズームを作る
                    if (e.button !== 0) return;
                    const t0 = xToTime(e.clientX) - entry.start;
                    if (zooms.some((z) => t0 >= z.start && t0 <= z.end)) return;
                    props.onSeek(entry.start + t0);
                    const lo = Math.max(0, ...zooms.filter((z) => z.end <= t0).map((z) => z.end));
                    const hi = Math.min(
                      entry.duration,
                      ...zooms.filter((z) => z.start >= t0).map((z) => z.start),
                    );
                    let created = -1;
                    startDrag(e, (dx, key) => {
                      if (Math.abs(dx) < 4 && created < 0) return;
                      const a = clamp(Math.min(t0, t0 + dx / scale), lo, hi);
                      const b = clamp(Math.max(t0, t0 + dx / scale), lo, hi);
                      if (b - a < 0.1) return;
                      if (created < 0) {
                        created = zooms.length;
                        const m = props.media.get(step.source);
                        patchStep(
                          update,
                          i,
                          (s) => ({ ...s, zooms: [...(s.zooms ?? []), defaultZoom(a, b, m)] }),
                          key,
                        );
                        props.onSelect({ kind: "zoom", step: i, index: created });
                      } else setZoom(created, a, b, key);
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const t0 = xToTime(e.clientX) - entry.start;
                    const hit = zooms.findIndex((z) => t0 >= z.start && t0 <= z.end);
                    props.openMenu(
                      e.clientX,
                      e.clientY,
                      hit >= 0
                        ? [
                            { label: t("drawRect"), action: () => props.onEditZoomRect(i, hit) },
                            ...clipMenuItems({ kind: "zoom", step: i, index: hit }),
                          ]
                        : [
                            pasteItem("zoom", entry.start + t0),
                            {
                              label: t("addZoomHere"),
                              shortcut: keyLabel("addZoom"),
                              action: () => {
                                const lo = Math.max(0, ...zooms.filter((z) => z.end <= t0).map((z) => z.end));
                                const hi = Math.min(
                                  entry.duration,
                                  ...zooms.filter((z) => z.start >= t0).map((z) => z.start),
                                );
                                const a = clamp(t0, lo, hi);
                                const b = Math.min(hi, a + DEFAULT_ZOOM_LENGTH);
                                if (b - a < 0.1) return;
                                const m = props.media.get(step.source);
                                update(
                                  (p) => ({
                                    ...p,
                                    steps: p.steps.map((s, j) =>
                                      j === i
                                        ? { ...s, zooms: [...(s.zooms ?? []), defaultZoom(a, b, m)] }
                                        : s,
                                    ),
                                  }),
                                  "zoom-add",
                                );
                                props.onSelect({ kind: "zoom", step: i, index: zooms.length });
                              },
                            },
                          ],
                    );
                  }}
                >
                  {zooms.flatMap((z, k) => {
                    // 拡大の動きは帯の手前、縮小の動きは帯の後ろ(ステップの外は切り詰める)
                    const zs = scaleOf(z);
                    const tr = zoomTransition(z, zs);
                    const inFrom = Math.max(0, z.start - tr);
                    const outTo = Math.min(entry.duration, z.end + tr);
                    return [
                      tr > 0 && z.start > inFrom && (
                        <div
                          key={`ri${z.start}`}
                          className="tl-ramp in"
                          style={{ left: inFrom * scale, width: (z.start - inFrom) * scale }}
                          title={t("zoomInMotion")}
                        />
                      ),
                      tr > 0 && outTo > z.end && (
                        <div
                          key={`ro${z.start}`}
                          className="tl-ramp out"
                          style={{ left: z.end * scale, width: (outTo - z.end) * scale }}
                          title={t("zoomOutMotion")}
                        />
                      ),
                      <Bar
                        key={`z${z.start}`}
                        className={`zoom ${zoomHoldMode(z) === "zoom" ? "hold" : ""} ${isSel("zoom", i, k) ? "selected" : ""}`}
                        left={z.start * scale}
                        width={(z.end - z.start) * scale}
                        label={`${zs.toFixed(1)}×`}
                        {...barProps(
                          { kind: "zoom", step: i, index: k },
                          () => props.onSelect({ kind: "zoom", step: i, index: k }),
                          (dx, key) => {
                            const { lo, hi } = bounds(k);
                            const len = z.end - z.start;
                            const s = clamp(
                              snap(entry.start + z.start + dx / scale) - entry.start,
                              lo,
                              hi - len,
                            );
                            setZoom(k, s, s + len, key);
                            props.onSeek(entry.start + s);
                          },
                          entry.start + z.start,
                        )}
                        onLeft={groupEdge({ kind: "zoom", step: i, index: k }, "left", (dx, key) => {
                          const { lo } = bounds(k);
                          const s = clamp(
                            snap(entry.start + z.start + dx / scale) - entry.start,
                            lo,
                            z.end - 0.1,
                          );
                          setZoom(k, s, z.end, key);
                          props.onSeek(entry.start + s);
                        })}
                        onRight={groupEdge({ kind: "zoom", step: i, index: k }, "right", (dx, key) => {
                          const { hi } = bounds(k);
                          const e = clamp(
                            snap(entry.start + z.end + dx / scale) - entry.start,
                            z.start + 0.1,
                            hi,
                          );
                          setZoom(k, z.start, e, key);
                          // 映像を止めるズームは止めた所(始まり)を、それ以外は終わりを見せる
                          props.onSeek(entry.start + (zoomHoldMode(z) === "zoom" ? z.start : e));
                        })}
                      />,
                      // 枠(キーフレーム)の印。クリックでその枠を編集、ドラッグで時刻を変える、右クリックで削除
                      ...(z.keys.length > 1
                        ? sortedKeys(z).map((key, ki, keys) => (
                            // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。数値は右カラムで入力できる
                            <div
                              // biome-ignore lint/suspicious/noArrayIndexKey: 枠は時刻の順の番号で区別する
                              key={`k${z.start}-${ki}`}
                              className={`tl-key ${props.editingKey?.step === i && props.editingKey.zoom === k && props.editingKey.key === ki ? "current" : ""}`}
                              style={{ left: key.t * scale }}
                              title={`${t("zoomKey")} ${ki + 1}`}
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                props.onEditZoomRect(i, k, ki);
                                const lo = ki === 0 ? z.start : (keys[ki - 1] as ZoomKey).t + 0.01;
                                const hi =
                                  ki === keys.length - 1 ? z.end : (keys[ki + 1] as ZoomKey).t - 0.01;
                                startDrag(e, (dx, dragKey) => {
                                  const tt = r3(clamp(key.t + dx / scale, lo, hi));
                                  patchStep(
                                    update,
                                    i,
                                    (s) => ({
                                      ...s,
                                      zooms: s.zooms?.map((x, j) =>
                                        j === k
                                          ? {
                                              ...x,
                                              keys: sortedKeys(x).map((y, n) =>
                                                n === ki ? { ...y, t: tt } : y,
                                              ),
                                            }
                                          : x,
                                      ),
                                    }),
                                    dragKey,
                                  );
                                });
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                props.openMenu(e.clientX, e.clientY, [
                                  {
                                    label: t("removeZoomKey"),
                                    action: () =>
                                      patchStep(
                                        update,
                                        i,
                                        (s) => ({
                                          ...s,
                                          zooms: s.zooms?.map((x, j) =>
                                            j === k
                                              ? { ...x, keys: sortedKeys(x).filter((_, n) => n !== ki) }
                                              : x,
                                          ),
                                        }),
                                        "zoom-key-remove",
                                      ),
                                  },
                                ]);
                              }}
                            />
                          ))
                        : []),
                    ];
                  })}
                </div>
              );
            })}
          </div>

          {/* オブジェクト(ポインター・蛍光ペン・図形)。重なるものは行を分ける。右クリックでその時刻に足す */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある */}
          <div
            className="tl-lane"
            style={{ height: objLaneH }}
            onContextMenu={(e) => {
              e.preventDefault();
              const at = xToTime(e.clientX);
              props.openMenu(e.clientX, e.clientY, [
                ...NEW_OBJECT_KINDS.map((kind) => ({
                  label: `＋ ${newKindLabel(kind)}`,
                  action: () => props.onAddObjectAt(kind, at),
                })),
                pasteItem("object", at),
              ]);
            }}
          >
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const labels = objectLabels(step, entry.duration);
              const om = props.media.get(step.source);
              return stepObjects(step).map((ref) => {
                const o = objectOf(step, ref);
                if (!o) return null;
                const w = objectWindow(o, entry.duration);
                const row = objRows[i]?.rows.get(`${ref.kind}:${ref.index}`) ?? 0;
                const field = OBJECT_FIELD[ref.kind];
                // ドラッグを始めたときの値(o)から変える
                const setWin = (start: number, end: number | null, key: string) =>
                  patchStep(
                    update,
                    i,
                    (s) => ({
                      ...s,
                      [field]: (s[field] as unknown[] | undefined)?.map((x, j) =>
                        j === ref.index ? retimeObject(o, r3(start), end === null ? null : r3(end)) : x,
                      ),
                    }),
                    key,
                  );
                const span = isPath(o) ? pathSpan(o) : null;
                // このオブジェクトを除いたステップの終わり。終わりのドラッグはここで一度止まり、さらに引くとステップを伸ばす
                const restEnd = stepDuration(
                  {
                    ...step,
                    [field]: (step[field] as unknown[] | undefined)?.filter((_, j) => j !== ref.index),
                  },
                  props.speechDurations.get(step.id) ?? [],
                  speechStartOffset(project),
                );
                const stick = STICK_PX / scale;
                const outside = !!om && shapeOutsideVideo(o, om.width, om.height);
                const label = labels.get(`${ref.kind}:${ref.index}`) ?? objectLabel(o, ref.kind);
                return (
                  <Bar
                    key={`${i}-${ref.kind}-${ref.index}`}
                    className={`object ${ref.kind} ${outside ? "warn" : ""} ${isSel(ref.kind, i, ref.index) ? "selected" : ""}`}
                    left={(entry.start + w.start) * scale}
                    width={(w.end - w.start) * scale}
                    top={2 + row * OBJ_ROW_H}
                    height={OBJ_ROW_H - 2}
                    label={outside ? `⚠ ${t("outsideBadge")} | ${label}` : label}
                    title={outside ? `${label}\n${t("outsideVideoTip")}` : undefined}
                    inner={
                      span && span.end > span.start ? (
                        <div
                          className="tl-motion"
                          style={{
                            left: (span.start - w.start) * scale,
                            width: (span.end - span.start) * scale,
                          }}
                        />
                      ) : null
                    }
                    {...barProps(
                      { kind: ref.kind, step: i, index: ref.index },
                      () => props.onSelectObject(i, ref),
                      (dx, key) => {
                        const len = w.end - w.start;
                        let st = Math.max(0, snap(entry.start + w.start + dx / scale, 0) - entry.start);
                        // ステップの終わりを越えるところで一度止め、さらに引けばステップを伸ばす
                        if (st + len > restEnd && st + len < restEnd + stick) st = Math.max(0, restEnd - len);
                        const atEnd = Math.abs(st + len - restEnd) < 1e-3 && o.end === undefined;
                        setWin(st, atEnd ? null : st + len, key);
                        props.onSeek(entry.start + st);
                      },
                      entry.start + w.start,
                    )}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onSelectObject(i, ref);
                      props.openMenu(e.clientX, e.clientY, [
                        ...clipMenuItems({ kind: ref.kind, step: i, index: ref.index }, false),
                        ...objectMenu(update, i, ref, step),
                      ]);
                    }}
                    onLeft={groupEdge({ kind: ref.kind, step: i, index: ref.index }, "left", (dx, key) => {
                      // ポインターは動きごとずらすので、動きが終わりを越えないようにする
                      const motion = span ? span.end - span.start : 0;
                      const st = clamp(
                        snap(entry.start + w.start + dx / scale) - entry.start,
                        0,
                        w.end - motion - 0.1,
                      );
                      setWin(st, o.end === undefined ? null : w.end, key);
                      props.onSeek(entry.start + st);
                    })}
                    onRight={groupEdge({ kind: ref.kind, step: i, index: ref.index }, "right", (dx, key) => {
                      const lo = Math.max(w.start, span ? span.end : w.start) + 0.1;
                      const raw = Math.max(lo, snap(entry.start + w.end + dx / scale) - entry.start);
                      // ステップの終わりで一度止め(終わりの手前 SNAP_PX から越えて STICK_PX まで)、
                      // そこで離せば「ステップの終わりまで」(end 省略)。さらに引けば end を書いてステップを伸ばす
                      const atEnd = raw > restEnd - SNAP_PX / scale && raw < restEnd + stick;
                      const e = atEnd ? restEnd : raw;
                      setWin(w.start, atEnd ? null : e, key);
                      props.onSeek(entry.start + e);
                    })}
                  />
                );
              });
            })}
          </div>

          {timeline.map((e) => (
            <div key={`b${e.index}`} className="tl-boundary" style={{ left: e.start * scale }} />
          ))}
          <div className="tl-playhead" style={{ left: time * scale }} />
        </div>
      </div>
    </div>
  );
}

/**
 * ステップ i の時刻 local にズームを足す(Z キー・プレビューの右クリック)。帯の長さは既定 2 秒で、後ろのズームの手前まで。
 * 既存のズームの中なら何もしない。center を渡すと、その点(ソースの座標)を中心にする。足したズームの番号を返す
 */
export function insertZoom(
  project: Project,
  i: number,
  local: number,
  duration: number,
  m: SourceMedia | undefined,
  center?: { x: number; y: number },
): { project: Project; index: number } | null {
  const step = project.steps[i];
  if (!step) return null;
  const zooms = step.zooms ?? [];
  if (zooms.some((z) => local >= z.start && local <= z.end)) return null;
  const end = Math.min(
    duration,
    local + DEFAULT_ZOOM_LENGTH,
    ...zooms.filter((z) => z.start > local).map((z) => z.start),
  );
  if (end - local < 0.1) return null;
  const z = defaultZoom(local, end, m);
  if (center) {
    const w = m?.width ?? 1920;
    const h = m?.height ?? 1080;
    const r = (z.keys[0] as ZoomKey).rect;
    r.x = Math.round(Math.min(Math.max(0, center.x - r.w / 2), w - r.w));
    r.y = Math.round(Math.min(Math.max(0, center.y - r.h / 2), h - r.h));
  }
  return {
    project: {
      ...project,
      steps: project.steps.map((s, j) => (j === i ? { ...s, zooms: [...zooms, z] } : s)),
    },
    index: zooms.length,
  };
}

/** 新しいズームの範囲は、録画の中央を 2 倍に拡大する大きさ */
function defaultZoom(start: number, end: number, m: SourceMedia | undefined): Zoom {
  const w = m?.width ?? 1920;
  const h = m?.height ?? 1080;
  return {
    start: r3(start),
    end: r3(end),
    keys: [
      {
        t: r3(start),
        rect: { x: Math.round(w / 4), y: Math.round(h / 4), w: Math.round(w / 2), h: Math.round(h / 2) },
      },
    ],
  };
}

/**
 * フェードの区間の印。黒から現れる(in)は左下から右上へ上がる線、黒へ消える(out)は左上から右下へ下がる線で、
 * 線より上(暗い側)を黒く塗る
 */
function FadeRamp(props: { dir: "in" | "out" }) {
  const inn = props.dir === "in";
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={inn ? "0,0 1,0 0,1" : "0,0 1,0 1,1"} fill="rgb(0 0 0 / 0.7)" />
      <line
        x1="0"
        y1={inn ? 1 : 0}
        x2="1"
        y2={inn ? 0 : 1}
        stroke="#fff"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** タイムライン上の帯。本体のドラッグで移動、両端のドラッグで伸縮 */
function Bar(props: {
  className: string;
  left: number;
  width: number;
  /** 行を分けるレーンでの縦の位置(省略するとレーンいっぱい) */
  top?: number;
  height?: number;
  /** 帯の中に重ねるもの(動きの区間など) */
  inner?: ReactNode;
  label: string;
  /** ツールチップ(省略すると label) */
  title?: string;
  /** Ctrl+クリックでまとめて選んだ帯 */
  multi?: boolean;
  onCtrlClick?: () => void;
  onSelect: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onMove: (dx: number, key: string) => void;
  onLeft?: (dx: number, key: string) => void;
  onRight?: (dx: number, key: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
    <div
      className={`tl-bar ${props.className} ${props.multi ? "multi" : ""}`}
      style={{
        left: props.left,
        width: Math.max(2, props.width),
        ...(props.top !== undefined ? { top: props.top, height: props.height, bottom: "auto" } : {}),
      }}
      title={props.title ?? props.label}
      onPointerDown={(e) => {
        if (e.button === 0 && (e.ctrlKey || e.metaKey) && props.onCtrlClick) {
          e.stopPropagation();
          e.preventDefault();
          props.onCtrlClick();
          return;
        }
        props.onSelect();
        startDrag(e, props.onMove);
      }}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      {props.inner}
      <span>{props.label}</span>
      {props.onLeft && (
        <div
          className="tl-handle left"
          onPointerDown={(e) => {
            props.onSelect();
            startDrag(e, props.onLeft as (dx: number, key: string) => void);
          }}
        />
      )}
      {props.onRight && (
        <div
          className="tl-handle right"
          onPointerDown={(e) => {
            props.onSelect();
            startDrag(e, props.onRight as (dx: number, key: string) => void);
          }}
        />
      )}
    </div>
  );
}
