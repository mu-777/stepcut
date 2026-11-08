// ステップ内の出力時刻とソース時刻の対応(docs/project-format.md 4 章)。
import { HOLD_TRANSITION, speechPieces, stepSpeed, zoomHoldMode } from "./defaults";
import type { Hold, Step } from "./schema";

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

/** 保持を除いた映像部分の出力上の長さ */
export function videoDuration(step: Step): number {
  return Math.max(0, step.out - step.in) / stepSpeed(step);
}

/** 保持を含み、読み上げによる自動保持を含まない長さ */
export function baseDuration(step: Step): number {
  return videoDuration(step) + stepHolds(step).reduce((sum, h) => sum + h.duration, 0);
}

/**
 * 各読み上げを鳴らすステップ内の出力時刻。durations は読み上げの長さ(未生成は 0)。
 * start を書いていなければ、最初は 0、2 つ目からは前の読み上げの直後
 */
export function speechTimes(step: Step, durations: readonly number[] = []): { start: number; end: number }[] {
  const times: { start: number; end: number }[] = [];
  let prevEnd = 0;
  speechPieces(step).forEach((p, k) => {
    const start = p.start ?? (k === 0 ? 0 : prevEnd);
    const end = start + (durations[k] ?? 0);
    times.push({ start, end });
    prevEnd = end;
  });
  return times;
}

/** ステップの出力上の長さ。読み上げの終わりが映像より後なら最終フレームを保持して合わせる(TIM-03) */
export function stepDuration(step: Step, speechDurations: readonly number[] = []): number {
  const speechEnd = Math.max(
    0,
    ...speechTimes(step, speechDurations).map((x, k) => ((speechDurations[k] ?? 0) > 0 ? x.end : 0)),
  );
  return Math.max(baseDuration(step), speechEnd);
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
  const v = Math.min(Math.max(0, at - held), videoDuration(step));
  const src = step.in + v * stepSpeed(step);
  return Math.max(step.in, Math.min(src, step.out - LAST_FRAME_EPSILON));
}

export interface SourceSegment {
  /** ステップ内の出力時刻 */
  outStart: number;
  outEnd: number;
  /** ソースの時刻 */
  srcStart: number;
  srcEnd: number;
}

/** 映像が動いている区間(保持を除く)と、対応するソースの区間。元の音声の配置に使う */
export function sourceSegments(step: Step): SourceSegment[] {
  const speed = stepSpeed(step);
  const vDur = videoDuration(step);
  const segments: SourceSegment[] = [];
  let outCursor = 0;
  let videoCursor = 0;
  const push = (outEnd: number) => {
    const len = Math.min(outEnd - outCursor, vDur - videoCursor);
    if (len > 0) {
      segments.push({
        outStart: outCursor,
        outEnd: outCursor + len,
        srcStart: step.in + videoCursor * speed,
        srcEnd: step.in + (videoCursor + len) * speed,
      });
      videoCursor += len;
    }
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
}

/** プロジェクト全体の並び。speechDurations はステップ id → 読み上げごとの長さ(秒) */
export function buildTimeline(
  steps: Step[],
  speechDurations: ReadonlyMap<string, readonly number[]>,
): TimelineEntry[] {
  let start = 0;
  return steps.map((step, index) => {
    const duration = stepDuration(step, speechDurations.get(step.id) ?? []);
    const entry = { index, step, start, duration };
    start += duration;
    return entry;
  });
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

/**
 * from 番目のステップから後ろを「続いた区間」にまとめる(再生で 1 本のデコードで読み続ける単位)。
 * 同じ録画で、前のステップの Out と次のステップの In が同じなら続いているとみなす。start / end は全体の時刻
 */
export function continuousRuns(
  timeline: TimelineEntry[],
  from = 0,
): { from: number; to: number; start: number; end: number }[] {
  const runs: { from: number; to: number; start: number; end: number }[] = [];
  for (let i = from; i < timeline.length; i++) {
    const e = timeline[i] as TimelineEntry;
    const last = runs[runs.length - 1];
    const prev = timeline[i - 1];
    if (last && prev && prev.step.source === e.step.source && Math.abs(prev.step.out - e.step.in) < 1e-3) {
      last.to = i;
      last.end = e.start + e.duration;
    } else runs.push({ from: i, to: i, start: e.start, end: e.start + e.duration });
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
