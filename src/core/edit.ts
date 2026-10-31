// ステップの編集操作(STP-05, STP-06)。プロジェクトは書き換えず、新しいオブジェクトを返す。

import { stepSpeed } from "./defaults";
import type { Project, Step } from "./schema";
import { baseDuration, sourceTimeAt, stepHolds, videoDuration } from "./timeline";

export function uniqueStepId(project: Project, base: string): string {
  const ids = new Set(project.steps.map((s) => s.id));
  const stem = base.replace(/-\d+$/, "") || "step";
  if (!ids.has(stem)) return stem;
  for (let n = 2; ; n++) {
    const id = `${stem}-${n}`;
    if (!ids.has(id)) return id;
  }
}

function replaceSteps(project: Project, steps: Step[]): Project {
  return { ...project, steps };
}

/**
 * ステップ内の出力時刻 t で分割する。後半は新しいステップにするか捨てる(STP-05)。
 * 前半には t より前に始まる要素を残し、後半は区間だけを持つ。
 */
export function splitStep(project: Project, index: number, t: number, keepRest: boolean): Project {
  const step = project.steps[index];
  if (!step) return project;
  const at = sourceTimeAt(step, t);
  if (at <= step.in || at >= step.out) return project;
  const first: Step = {
    ...step,
    out: at,
    holds: step.holds?.filter((h) => h.at < t),
    zooms: step.zooms?.filter((z) => z.start < t),
  };
  if (!first.holds?.length) delete first.holds;
  if (!first.zooms?.length) delete first.zooms;
  const steps = [...project.steps];
  steps[index] = first;
  if (keepRest) {
    // 後半はテロップと同じ文を読む設定(既定でオン)で始める
    const rest: Step = {
      id: uniqueStepId(project, step.id),
      source: step.source,
      in: at,
      out: step.out,
      speech: {},
    };
    if (step.speed !== undefined) rest.speed = step.speed;
    steps.splice(index + 1, 0, rest);
  }
  return replaceSteps(project, steps);
}

/** ステップの最短の長さ(ソースの秒) */
export const MIN_STEP_SOURCE = 0.1;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * ステップ内の要素の時刻を dt 秒ずらす(In を動かしたとき、映像の中身との対応を保つため)。
 * 0 より前にはみ出した要素は切り詰め、なくなったものは消す。
 */
export function shiftStepElements(step: Step, dt: number): Step {
  if (dt === 0) return step;
  const next: Step = { ...step };
  if (step.holds) {
    next.holds = step.holds.filter((h) => h.at + dt >= 0).map((h) => ({ ...h, at: r3(h.at + dt) }));
    if (!next.holds.length) delete next.holds;
  }
  if (step.zooms) {
    next.zooms = step.zooms
      .map((z) => ({ ...z, start: r3(Math.max(0, z.start + dt)), end: r3(z.end + dt) }))
      .filter((z) => z.end > z.start);
    if (!next.zooms.length) delete next.zooms;
  }
  if (step.caption) {
    const c = { ...step.caption };
    if (c.start !== undefined) c.start = r3(Math.max(0, c.start + dt));
    if (c.end != null) c.end = r3(Math.max(0, c.end + dt));
    if (c.start === 0) delete c.start;
    next.caption = c;
  }
  if (step.speech?.start !== undefined) {
    const start = r3(Math.max(0, step.speech.start + dt));
    next.speech = { ...step.speech, start };
    if (start === 0) delete next.speech.start;
  }
  for (const key of ["pointers", "highlights"] as const) {
    const list = step[key];
    if (!list) continue;
    const moved = list
      .map((a) => ({
        ...a,
        path: a.path.map((pt) => ({ ...pt, t: r3(pt.t + dt) })),
        ...(a.end !== undefined ? { end: r3(a.end + dt) } : {}),
      }))
      .filter((a) => a.path.every((pt) => pt.t >= 0));
    if (moved.length) next[key] = moved as never;
    else delete next[key];
  }
  return next;
}

/**
 * クリップ端のドラッグ(In/Out の変更)。値はソースの時刻。録画の範囲 [0, sourceDuration] と最短の長さに収める。
 * In を動かしたときは要素の時刻をずらして、映像の中身との対応を保つ。
 */
export function trimStep(
  project: Project,
  index: number,
  edge: "in" | "out",
  value: number,
  sourceDuration: number,
): Project {
  const step = project.steps[index];
  if (!step) return project;
  if (edge === "out") {
    const out = r3(Math.min(Math.max(value, step.in + MIN_STEP_SOURCE), sourceDuration));
    return updateStep(project, index, (s) => ({ ...s, out }));
  }
  const newIn = r3(Math.max(0, Math.min(value, step.out - MIN_STEP_SOURCE)));
  const dt = (step.in - newIn) / stepSpeed(step);
  return updateStep(project, index, (s) => ({ ...shiftStepElements(s, dt), in: newIn }));
}

/** 保持を追加する。既存の保持(ズーム中の静止を含む)と重なる場合や、映像の外なら何もしない */
export function addHold(project: Project, index: number, at: number, duration: number): Project {
  const step = project.steps[index];
  if (!step) return project;
  const a = r3(at);
  if (a < 0 || a > baseDuration(step)) return project;
  // 保持を除いた映像の範囲に収まっているかは、保持の前までの映像の長さで判断する
  let videoBefore = a;
  for (const h of stepHolds(step)) {
    if (a > h.at && a < h.at + h.duration) return project;
    if (h.at < a) videoBefore -= h.duration;
  }
  if (videoBefore > videoDuration(step)) return project;
  const end = a + duration;
  const clash = stepHolds(step).some((h) => h.at >= a && h.at < end);
  const d = clash
    ? Math.min(
        ...stepHolds(step)
          .filter((h) => h.at >= a)
          .map((h) => h.at),
      ) - a
    : duration;
  if (d <= 0) return project;
  return updateStep(project, index, (s) => ({
    ...s,
    holds: [...(s.holds ?? []), { at: a, duration: r3(d) }].sort((x, y) => x.at - y.at),
  }));
}

export function duplicateStep(project: Project, index: number): Project {
  const step = project.steps[index];
  if (!step) return project;
  const copy: Step = { ...structuredClone(step), id: uniqueStepId(project, step.id) };
  const steps = [...project.steps];
  steps.splice(index + 1, 0, copy);
  return replaceSteps(project, steps);
}

export function deleteStep(project: Project, index: number): Project {
  return replaceSteps(
    project,
    project.steps.filter((_, i) => i !== index),
  );
}

export function moveStep(project: Project, from: number, to: number): Project {
  if (to < 0 || to >= project.steps.length || from === to) return project;
  const steps = [...project.steps];
  const [s] = steps.splice(from, 1);
  if (s) steps.splice(to, 0, s);
  return replaceSteps(project, steps);
}

export function updateStep(project: Project, index: number, patch: (s: Step) => Step): Project {
  const steps = project.steps.map((s, i) => (i === index ? patch(s) : s));
  return replaceSteps(project, steps);
}

export function newProject(): Project {
  return { format: "screen-annotator.project", version: 1, sources: [], steps: [] };
}
