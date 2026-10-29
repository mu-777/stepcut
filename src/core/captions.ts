import type { Step } from "./schema";
import type { Cue } from "./text";
import type { TimelineEntry } from "./timeline";

/** テロップを表示するステップ内の区間(TXT-06。既定はステップの全期間) */
export function captionWindow(step: Step, duration: number): { start: number; end: number } | null {
  const c = step.caption;
  if (!c || c.text.trim() === "") return null;
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
