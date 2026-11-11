// ステップの編集操作(STP-05, STP-06)。プロジェクトは書き換えず、新しいオブジェクトを返す。

import { resolveLayout, speechPieces, stepSpeed, withSpeechPieces } from "./defaults";
import { cutObjectAt, objectGone, objectWindow, shiftObject } from "./objects";
import type { Margin, Project, SpeechPiece, Step, StepLayout } from "./schema";
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
    // 切る時刻をまたいで出ているものは、前半のステップの終わりまで出す
    pointers: step.pointers?.filter((a) => objectWindow(a, t).start < t).map((a) => cutObjectAt(a, t)),
    shapes: step.shapes?.filter((a) => a.start < t).map((a) => cutObjectAt(a, t)),
  };
  for (const key of ["holds", "zooms", "pointers", "shapes"] as const) {
    if (!first[key]?.length) delete first[key];
  }
  const steps = [...project.steps];
  steps[index] = first;
  if (keepRest) {
    // 後半は空のテロップ(プレビューには仮の文を出す)と、書き換えるまでテロップの文を読む読み上げで始める
    const rest: Step = {
      id: uniqueStepId(project, step.id),
      source: step.source,
      in: at,
      out: step.out,
      caption: { text: "" },
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
      .map((z) => ({
        ...z,
        start: r3(Math.max(0, z.start + dt)),
        end: r3(z.end + dt),
        keys: z.keys.map((k) => ({ ...k, t: r3(Math.max(0, k.t + dt)) })),
      }))
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
  if (step.speech) {
    const pieces = speechPieces(step).map((p, k) => {
      if (p.start === undefined) return p;
      const start = r3(Math.max(0, p.start + dt));
      const { start: _s, ...rest } = p;
      // 最初の読み上げの 0 は既定値なので書かない
      return start === 0 && k === 0 ? rest : { ...rest, start };
    });
    Object.assign(next, withSpeechPieces(next, pieces));
  }
  for (const key of ["pointers", "shapes"] as const) {
    const list = step[key];
    if (!list) continue;
    const moved = (list as Parameters<typeof shiftObject>[0][])
      .map((a) => shiftObject(a, dt))
      .filter((a) => !objectGone(a));
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

/**
 * 画像の素材のステップの長さを変える(クリップの左端のドラッグ)。画像はどの時刻も同じなので in を 0 にそろえ、
 * 伸び縮みした分だけ後ろの要素を動かす(左端を動かしたのと同じ見え方にする)
 */
export function resizeImageStepStart(project: Project, index: number, length: number): Project {
  const step = project.steps[index];
  if (!step) return project;
  const len = r3(Math.max(MIN_STEP_SOURCE, length));
  const dt = (len - (step.out - step.in)) / stepSpeed(step);
  return updateStep(project, index, (s) => ({ ...shiftStepElements(s, dt), in: 0, out: len }));
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

/**
 * ステップ index と次のステップを 1 つにまとめられるか。同じ録画の続いた区間で、速度が同じなら可
 */
export function canMergeSteps(project: Project, index: number): boolean {
  const a = project.steps[index];
  const b = project.steps[index + 1];
  return (
    !!a && !!b && a.source === b.source && Math.abs(a.out - b.in) < 1e-3 && stepSpeed(a) === stepSpeed(b)
  );
}

/**
 * ステップ index と次のステップを 1 つにまとめる。firstDuration は前のステップの出力上の長さ
 * (読み上げによる自動保持を含む)。自動保持の分は明示した保持にして、後ろの要素の時刻を保つ。
 * テロップは同じ文なら 1 つに、違えば改行でつなぐ。読み上げは順に並べ、テロップと一致の読み上げは文を書き出して保つ
 */
export function mergeSteps(project: Project, index: number, firstDuration?: number): Project {
  if (!canMergeSteps(project, index)) return project;
  const a = project.steps[index] as Step;
  const b = project.steps[index + 1] as Step;
  const baseA = baseDuration(a);
  const offset = Math.max(baseA, firstDuration ?? baseA);
  const autoHold = r3(offset - baseA);
  const shiftedB = shiftStepElements(b, offset);
  const merged: Step = { ...a, out: b.out };

  const holds = [
    ...(a.holds ?? []),
    ...(autoHold > 0 ? [{ at: r3(baseA), duration: autoHold }] : []),
    ...(shiftedB.holds ?? []),
  ];
  if (holds.length) merged.holds = holds;
  const zooms = [...(a.zooms ?? []), ...(shiftedB.zooms ?? [])];
  if (zooms.length) merged.zooms = zooms;
  for (const key of ["pointers", "shapes"] as const) {
    const list = [...(a[key] ?? []), ...(shiftedB[key] ?? [])];
    if (list.length) merged[key] = list as never;
  }

  // テロップ
  const ca = a.caption;
  const cb = shiftedB.caption;
  if (ca || cb) {
    const ta = ca?.text.trim() ?? "";
    const tb = cb?.text.trim() ?? "";
    const text =
      ta === tb || tb === "" ? (ca?.text ?? "") : ta === "" ? (cb?.text ?? "") : `${ca?.text}\n${cb?.text}`;
    const caption: NonNullable<Step["caption"]> = ca
      ? { ...ca, text }
      : { ...(cb as NonNullable<Step["caption"]>), text, start: cb?.start ?? r3(offset) };
    // 前のテロップが途中で終わる指定でも、後ろのテロップの終わりまで出す。後ろになければ前の区間のまま
    if (cb) {
      if (cb.end != null) caption.end = cb.end;
      else delete caption.end;
    } else if (ca?.end == null) caption.end = r3(offset);
    merged.caption = caption;
  }

  // 読み上げ。テロップと一致の読み上げは、まとめた後のテロップと文が変わるので文を書き出す
  const fix = (st: Step, pieces: SpeechPiece[], keep: boolean) =>
    pieces.map((p, k) =>
      k === 0 && p.text === undefined && !keep ? { ...p, text: st.caption?.text ?? "" } : p,
    );
  const mergedText = merged.caption?.text;
  const piecesA = fix(a, speechPieces(a), mergedText === a.caption?.text);
  const piecesB = fix(b, speechPieces(shiftedB), piecesA.length === 0 && mergedText === b.caption?.text).map(
    (p, k) => (k === 0 && p.start === undefined ? { ...p, start: r3(offset) } : p),
  );
  const result = withSpeechPieces(merged, [...piecesA, ...piecesB]);
  if (b.audio && !a.audio) result.audio = b.audio;

  const steps = [...project.steps];
  steps.splice(index, 2, result);
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
  return { format: "stepcut.project", version: 1, sources: [], steps: [] };
}

/**
 * 1 つの軸で、枠(lo〜hi)が a から b へ変わったときに点 p を移す。枠の中なら枠の中の同じ割合の位置、
 * 枠の外(余白)なら余白の中の同じ割合の位置にする(下の余白の真ん中にあれば、余白が変わっても真ん中)
 */
function followAxis(p: number, a: { lo: number; hi: number }, b: { lo: number; hi: number }): number {
  const map = (v: number, s0: number, s1: number, d0: number, d1: number) =>
    s1 - s0 > 1e-9 ? d0 + ((v - s0) / (s1 - s0)) * (d1 - d0) : d0 + (d1 - d0) / 2;
  if (p < a.lo) return map(p, 0, a.lo, 0, b.lo);
  if (p > a.hi) return map(p, a.hi, 1, b.hi, 1);
  return map(p, a.lo, a.hi, b.lo, b.hi);
}

/**
 * 録画の枠(余白)が変わったら、位置を書いたテロップ(全体の設定とステップの上書き)を枠に合わせて動かす。
 * 位置を書いていないテロップは描画のときに録画の下の余白へ置くので、もとから枠についていく
 */
export function followCaptions(prev: Project, next: Project): Project {
  // 枠に関わる値が変わっていなければ何もしない(ふだんの編集で毎回ステップを見直さない)
  if (prev.layout?.margin === next.layout?.margin && prev.steps === next.steps) return next;
  const same = (a: Margin, b: Margin) =>
    a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
  const r4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
  type Pos = { x: number; y: number };
  const eq = (p?: Pos, q?: Pos) => (!p && !q) || (!!p && !!q && p.x === q.x && p.y === q.y);
  const move = (pos: Pos, a: Margin, b: Margin) =>
    same(a, b)
      ? pos
      : {
          x: r4(followAxis(pos.x, { lo: a.left, hi: 1 - a.right }, { lo: b.left, hi: 1 - b.right })),
          y: r4(followAxis(pos.y, { lo: a.top, hi: 1 - a.bottom }, { lo: b.top, hi: 1 - b.bottom })),
        };
  const pa = resolveLayout(prev).margin;
  const pb = resolveLayout(next).margin;
  // 全体の位置は全体の枠に合わせて動かす
  const sharedPrev = prev.styles?.caption?.position;
  const sharedNext = next.styles?.caption?.position;
  const sharedMoved = sharedNext && eq(sharedNext, sharedPrev) ? move(sharedNext, pa, pb) : sharedNext;
  const prevById = new Map(prev.steps.map((s) => [s.id, s]));
  const steps = next.steps.map((s) => {
    const before = prevById.get(s.id);
    if (!before || !s.caption) return s;
    const a = resolveLayout(prev, before).margin;
    const b = resolveLayout(next, s).margin;
    const own = s.caption.position;
    if (own) {
      // 自分の位置: 自分の枠の変わり方に合わせる(位置そのものを直したときは動かさない)
      if (!eq(own, before.caption?.position) || same(a, b)) return s;
      return { ...s, caption: { ...s.caption, position: move(own, a, b) } };
    }
    // 全体の位置を使っている: 全体の位置の動きと自分の枠の動きが違えば、自分の位置として書く
    if (!sharedPrev || !sharedMoved || !eq(sharedNext, sharedPrev)) return s;
    const want = move(sharedPrev, a, b);
    if (want.x === sharedMoved.x && want.y === sharedMoved.y) return s;
    return { ...s, caption: { ...s.caption, position: want } };
  });
  const stepsChanged = steps.some((s, i) => s !== next.steps[i]);
  if (!stepsChanged && eq(sharedMoved, sharedNext)) return next;
  return {
    ...next,
    styles:
      sharedMoved && !eq(sharedMoved, sharedNext)
        ? { ...next.styles, caption: { ...next.styles?.caption, position: sharedMoved } }
        : next.styles,
    steps: stepsChanged ? steps : next.steps,
  };
}

/** ステップの録画の枠を上書きする(patch の項目を書き足す。undefined は消す) */
export function setStepLayout(project: Project, index: number, patch: Partial<StepLayout>): Project {
  return updateStep(project, index, (s) => {
    const merged: StepLayout = { ...s.layout, ...patch };
    for (const k of Object.keys(merged) as (keyof StepLayout)[])
      if (merged[k] === undefined) delete merged[k];
    const { layout: _l, ...rest } = s;
    return Object.keys(merged).length ? { ...rest, layout: merged } : rest;
  });
}

/** ステップの枠の上書きを消し、全体の枠に戻す */
export function clearStepLayout(project: Project, index: number): Project {
  return updateStep(project, index, (s) => {
    const { layout: _l, ...rest } = s;
    return rest;
  });
}

/** ステップの枠を全体の枠にし、このステップの上書きを消す(ほかのステップの上書きはそのまま) */
export function makeStepLayoutCommon(project: Project, index: number): Project {
  const step = project.steps[index];
  if (!step?.layout) return project;
  const l = resolveLayout(project, step);
  const p: Project = {
    ...project,
    layout: {
      ...project.layout,
      margin: l.margin,
      fit: l.fit === "contain" ? undefined : l.fit,
      shadow: l.shadow,
    },
  };
  if (p.layout && p.layout.fit === undefined) delete p.layout.fit;
  return clearStepLayout(p, index);
}
