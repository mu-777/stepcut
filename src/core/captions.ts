import type { Step } from "./schema";
import type { Cue } from "./text";
import type { TimelineEntry } from "./timeline";

/**
 * テロップを表示するステップ内の区間(TXT-06。既定はステップの全期間)。
 * 文が空なら null(書き出さない)。allowEmpty なら空でも区間を返す(編集画面で仮の文を出すため)
 */
export function captionWindow(
  step: Step,
  duration: number,
  allowEmpty = false,
): { start: number; end: number } | null {
  const c = step.caption;
  if (!c || (!allowEmpty && c.text.trim() === "")) return null;
  const start = Math.min(c.start ?? 0, duration);
  const end = Math.min(c.end ?? duration, duration);
  return end > start ? { start, end } : null;
}

export function captionCues(timeline: TimelineEntry[]): Cue[] {
  const cues: Cue[] = [];
  for (const e of timeline) {
    const w = captionWindow(e.step, e.duration);
    if (w && e.step.caption) {
      cues.push({ start: e.start + w.start, end: e.start + w.end, text: e.step.caption.text });
    }
  }
  return cues;
}
