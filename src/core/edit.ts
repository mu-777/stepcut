// ステップの編集操作(STP-05, STP-06)。プロジェクトは書き換えず、新しいオブジェクトを返す。
import type { Project, Step } from "./schema";
import { sourceTimeAt } from "./timeline";

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
    const rest: Step = { id: uniqueStepId(project, step.id), source: step.source, in: at, out: step.out };
    if (step.speed !== undefined) rest.speed = step.speed;
    steps.splice(index + 1, 0, rest);
  }
  return replaceSteps(project, steps);
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
