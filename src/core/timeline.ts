// ステップ内の出力時刻とソース時刻の対応(docs/project-format.md 4 章)。
import { HOLD_TRANSITION, speechPieces, stepSpeed, zoomHoldMode } from "./defaults";
import { carriedZooms } from "./layout";
import type { Hold, Segment, Step, Zoom } from "./schema";

// ソースの out ちょうどは次の区間の先頭フレームになりうるので、少し手前を最終フレームとする
const LAST_FRAME_EPSILON = 0.001;

/**
 * 明示した保持と、映像を止めるズーム(hold の既定は true)を合わせて開始順に並べる。
 * 動きの間だけ止めるズームは、拡大(start の手前)と縮小(end の後)の動きの間を保持にする
 */
export function stepHolds(step: Step): Hold[] {
  const holds: Hold[] = [...(step.holds ?? [])];
  for (const z of step.zooms ?? []) {
    const mode = zoomHoldMode(z);
    if (mode === "zoom" && z.end > z.start) holds.push({ at: z.start, duration: z.end - z.start });
    if (mode === "transition") {
      const tr = z.transition ?? HOLD_TRANSITION;
      const inAt = Math.max(0, z.start - tr);
      if (z.start > inAt) holds.push({ at: inAt, duration: z.start - inAt });
      if (tr > 0) holds.push({ at: z.end, duration: tr });
    }
  }
  return holds.sort((a, b) => a.at - b.at);
}

/** ステップの最初の区間の in(録画の時刻) */
export function stepIn(step: Step): number {
  return (step.segments[0] as Segment).in;
}

/** ステップの最後の区間の out(録画の時刻) */
export function stepOut(step: Step): number {
  return (step.segments[step.segments.length - 1] as Segment).out;
}

/** 区間の長さ(録画の秒)の合計 */
export function sourceLength(step: Step): number {
  return step.segments.reduce((sum, g) => sum + Math.max(0, g.out - g.in), 0);
}

/** 保持を除いた映像部分の出力上の長さ */
export function videoDuration(step: Step): number {
  return sourceLength(step) / stepSpeed(step);
}

/**
 * 映像の時刻 v(保持を除いた出力上の時刻)を録画の時刻にする。区間の切れ目ちょうどは次の区間の始まり。
 * 区間の終わりちょうどは次の区間の先頭フレームになりうるので、少し手前を最終フレームとする
 */
function videoToSource(step: Step, v: number): number {
  const speed = stepSpeed(step);
  let rest = Math.max(0, v) * speed;
  const last = step.segments.length - 1;
  for (let k = 0; k <= last; k++) {
    const g = step.segments[k] as Segment;
    const len = Math.max(0, g.out - g.in);
    if (rest < len || k === last) return Math.max(g.in, Math.min(g.in + rest, g.out - LAST_FRAME_EPSILON));
    rest -= len;
  }
  return 0;
}

/** 映像の時刻 v(保持を除いた時刻)をステップ内の出力時刻にする(その時刻までの保持を足す) */
function videoToOutput(step: Step, v: number): number {
  let t = v;
  for (const h of stepHolds(step)) {
    if (h.at <= t) t += h.duration;
    else break;
  }
  return t;
}

/** 2 つ目以降の区間が始まる、ステップ内の出力時刻(区間の切れ目。タイムラインの印と分割に使う) */
export function segmentBoundaries(step: Step): number[] {
  const speed = stepSpeed(step);
  const out: number[] = [];
  let v = 0;
  step.segments.slice(0, -1).forEach((g) => {
    v += Math.max(0, g.out - g.in) / speed;
    out.push(videoToOutput(step, v));
  });
  return out;
}

/** 保持を含み、読み上げによる自動保持を含まない長さ */
export function baseDuration(step: Step): number {
  return videoDuration(step) + stepHolds(step).reduce((sum, h) => sum + h.duration, 0);
}

/**
 * 各読み上げを鳴らすステップ内の出力時刻。durations は読み上げの長さ(未生成は 0)。
 * start を書いていなければ、最初は offset(全体の speech.startOffset)、2 つ目からは前の読み上げの直後
 */
export function speechTimes(
  step: Step,
  durations: readonly number[] = [],
  offset = 0,
): { start: number; end: number }[] {
  const times: { start: number; end: number }[] = [];
  let prevEnd = 0;
  speechPieces(step).forEach((p, k) => {
    const start = p.start ?? (k === 0 ? offset : prevEnd);
    const end = start + (durations[k] ?? 0);
    times.push({ start, end });
    prevEnd = end;
  });
  return times;
}

/**
 * ステップの出力上の長さ。読み上げの終わりや、終わりを書いたオブジェクト(ポインター・図形)の end が映像より後なら、
 * 最終フレームを保持して合わせる(TIM-03)
 */
export function stepDuration(step: Step, speechDurations: readonly number[] = [], speechOffset = 0): number {
  const speechEnd = Math.max(
    0,
    ...speechTimes(step, speechDurations, speechOffset).map((x, k) =>
      (speechDurations[k] ?? 0) > 0 ? x.end : 0,
    ),
  );
  const objectEnd = Math.max(0, ...[...(step.pointers ?? []), ...(step.shapes ?? [])].map((o) => o.end ?? 0));
  return Math.max(baseDuration(step), speechEnd, objectEnd);
}

/** 出力時刻 t に表示する映像の時刻(保持を除いた時刻。保持の途中は保持の開始) */
export function videoTimeAt(step: Step, t: number): number {
  let held = 0;
  let at = t;
  for (const h of stepHolds(step)) {
    if (at < h.at) break;
    if (at < h.at + h.duration) {
      at = h.at;
      break;
    }
    held += h.duration;
  }
  return Math.min(Math.max(0, at - held), videoDuration(step));
}

/**
 * 区間の並びを、映像の時刻 v で前後に分ける。区間の切れ目ちょうどなら区間をそのまま分け、区間の途中ならその区間を切る。
 * 端(v が 0 以下か映像の長さ以上)なら null
 */
export function splitSegments(step: Step, v: number): { first: Segment[]; rest: Segment[] } | null {
  const speed = stepSpeed(step);
  let rest = v * speed;
  if (rest <= 1e-6 || rest >= sourceLength(step) - 1e-6) return null;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  for (let k = 0; k < step.segments.length; k++) {
    const g = step.segments[k] as Segment;
    const len = g.out - g.in;
    if (rest < len - 1e-6) {
      const before = step.segments.slice(0, k);
      const after = step.segments.slice(k + 1);
      if (rest <= 1e-6) return { first: before, rest: [g, ...after] };
      const at = r3(g.in + rest);
      return { first: [...before, { in: g.in, out: at }], rest: [{ in: at, out: g.out }, ...after] };
    }
    rest -= len;
    if (Math.abs(rest) <= 1e-6)
      return { first: step.segments.slice(0, k + 1), rest: step.segments.slice(k + 1) };
  }
  return null;
}

/** 出力時刻 t に表示するソースの時刻 */
export function sourceTimeAt(step: Step, t: number): number {
  let held = 0;
  let at = t;
  for (const h of stepHolds(step)) {
    if (at < h.at) break;
    if (at < h.at + h.duration) {
      // 保持の途中は保持の開始時刻のフレーム
      at = h.at;
      break;
    }
    held += h.duration;
  }
  return videoToSource(step, Math.min(Math.max(0, at - held), videoDuration(step)));
}

export interface SourceSegment {
  /** ステップ内の出力時刻 */
  outStart: number;
  outEnd: number;
  /** ソースの時刻 */
  srcStart: number;
  srcEnd: number;
}

/** 映像が動いている区間(保持を除く)と、対応するソースの区間。保持と区間の切れ目で分ける。元の音声の配置に使う */
export function sourceSegments(step: Step): SourceSegment[] {
  const speed = stepSpeed(step);
  const vDur = videoDuration(step);
  // 区間ごとの映像の時刻の範囲
  const ranges: { v0: number; v1: number; src: number }[] = [];
  let acc = 0;
  for (const g of step.segments) {
    const len = Math.max(0, g.out - g.in) / speed;
    ranges.push({ v0: acc, v1: acc + len, src: g.in });
    acc += len;
  }
  const segments: SourceSegment[] = [];
  let outCursor = 0;
  let videoCursor = 0;
  const push = (outEnd: number) => {
    const len = Math.min(outEnd - outCursor, vDur - videoCursor);
    if (len <= 0) return;
    const a = videoCursor;
    const b = videoCursor + len;
    for (const r of ranges) {
      const s = Math.max(a, r.v0);
      const e = Math.min(b, r.v1);
      if (e <= s) continue;
      segments.push({
        outStart: outCursor + (s - a),
        outEnd: outCursor + (e - a),
        srcStart: r.src + (s - r.v0) * speed,
        srcEnd: r.src + (e - r.v0) * speed,
      });
    }
    videoCursor = b;
  };
  for (const h of stepHolds(step)) {
    push(h.at);
    outCursor = h.at + h.duration;
  }
  push(Number.POSITIVE_INFINITY);
  return segments;
}

export interface TimelineEntry {
  index: number;
  step: Step;
  start: number;
  duration: number;
  /** 境界をまたいで続ける前後のステップのズーム(このステップの時刻。carriedZooms) */
  carry: Zoom[];
}

/** プロジェクト全体の並び。speechDurations はステップ id → 読み上げごとの長さ(秒) */
export function buildTimeline(
  steps: Step[],
  speechDurations: ReadonlyMap<string, readonly number[]>,
  speechOffset = 0,
): TimelineEntry[] {
  let start = 0;
  const entries: TimelineEntry[] = steps.map((step, index) => {
    const duration = stepDuration(step, speechDurations.get(step.id) ?? [], speechOffset);
    const entry = { index, step, start, duration, carry: [] };
    start += duration;
    return entry;
  });
  for (const e of entries) e.carry = carriedZooms(entries[e.index - 1], e, entries[e.index + 1]);
  return entries;
}

export function totalDuration(timeline: TimelineEntry[]): number {
  const last = timeline[timeline.length - 1];
  return last ? last.start + last.duration : 0;
}

/** 全体の時刻 t がどのステップの何秒目か */
export function locate(timeline: TimelineEntry[], t: number): { entry: TimelineEntry; local: number } | null {
  if (timeline.length === 0) return null;
  for (const entry of timeline) {
    if (t < entry.start + entry.duration) return { entry, local: Math.max(0, t - entry.start) };
  }
  const last = timeline[timeline.length - 1] as TimelineEntry;
  return { entry: last, local: last.duration };
}

/** 書き出しで音声を一度に作る長さ(秒)。これより長いステップは区切って作る(1 分で約 23MB) */
export const AUDIO_EXPORT_CHUNK = 60;

/** ステップ(長さ duration 秒)の音声を作る区切り [from, to]。chunk 秒以下なら全体の 1 つ */
export function audioChunkRanges(duration: number, chunk = AUDIO_EXPORT_CHUNK): [number, number][] {
  if (!(duration > chunk)) return [[0, duration]];
  const out: [number, number][] = [];
  for (let from = 0; from < duration - 1e-9; from += chunk)
    out.push([from, Math.min(duration, from + chunk)]);
  return out;
}

/**
 * from 番目のステップから後ろを「続いた区間」にまとめる(再生で 1 本のデコードで読み続ける単位)。
 * 同じ録画で、前の区間の out と次の区間の in が同じなら続いているとみなす(ステップをまたいでも、ステップの中でも)。
 * 続いていない区間の切れ目では、ステップの途中でも分ける。from / to はステップの番号、start / end は全体の時刻
 */
export function continuousRuns(
  timeline: TimelineEntry[],
  from = 0,
): { from: number; to: number; start: number; end: number }[] {
  const runs: { from: number; to: number; start: number; end: number }[] = [];
  let prev: { source: string; out: number } | null = null;
  for (let i = from; i < timeline.length; i++) {
    const e = timeline[i] as TimelineEntry;
    const cuts = segmentBoundaries(e.step);
    e.step.segments.forEach((g, k) => {
      const start = e.start + (k === 0 ? 0 : (cuts[k - 1] as number));
      const end = k === e.step.segments.length - 1 ? e.start + e.duration : e.start + (cuts[k] as number);
      const last = runs[runs.length - 1];
      if (last && prev && prev.source === e.step.source && Math.abs(prev.out - g.in) < 1e-3) {
        last.to = i;
        last.end = end;
      } else runs.push({ from: i, to: i, start, end });
      prev = { source: e.step.source, out: g.out };
    });
  }
  return runs;
}

/** フェードの明るさ(0〜1)。ステップ内の出力時刻 local での、始まりのフェードインと終わりのフェードアウトの掛け合わせ */
export function fadeLevel(step: Step, local: number, duration: number): number {
  let a = 1;
  if (step.fadeIn) a = Math.min(a, local / step.fadeIn);
  if (step.fadeOut) a = Math.min(a, (duration - local) / step.fadeOut);
  return Math.min(1, Math.max(0, a));
}
