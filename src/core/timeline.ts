// ステップ内の出力時刻とソース時刻の対応(docs/project-format.md 4 章)。
import { stepSpeed } from "./defaults";
import type { Hold, Step } from "./schema";

// ソースの out ちょうどは次の区間の先頭フレームになりうるので、少し手前を最終フレームとする
const LAST_FRAME_EPSILON = 0.001;

/** 明示した保持と、hold: true のズームを合わせて開始順に並べる */
export function stepHolds(step: Step): Hold[] {
  const holds: Hold[] = [...(step.holds ?? [])];
  for (const z of step.zooms ?? []) {
    if (z.hold && z.end > z.start) holds.push({ at: z.start, duration: z.end - z.start });
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

/** ステップの出力上の長さ。読み上げが長ければ最終フレームを保持して合わせる(TIM-03) */
export function stepDuration(step: Step, speechDuration = 0): number {
  return Math.max(baseDuration(step), speechDuration);
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

/** プロジェクト全体の並び。speechDurations はステップ id → 読み上げの長さ(秒) */
export function buildTimeline(steps: Step[], speechDurations: ReadonlyMap<string, number>): TimelineEntry[] {
  let start = 0;
  return steps.map((step, index) => {
    const duration = stepDuration(step, speechDurations.get(step.id) ?? 0);
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
