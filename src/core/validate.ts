// プロジェクトファイルの検証(AI-04)。形(schema.ts)に加え、id の参照や時刻の重なりを調べる。
import { type Msg, type MsgParam, msg } from "../shared/messages";
import { speechPieces } from "./defaults";
import { migrateProject } from "./migrate";
import { type Project, projectSchema } from "./schema";
import { baseDuration, stepHolds, videoDuration } from "./timeline";

/** 検証の問題。文は持たず、コードと値で返す(画面は画面の言語、CLI は英語で文にする。shared/messages.ts) */
export interface Issue extends Msg {
  /** JSON 内の位置。例: "steps[2].caption.text"。訳さない */
  path: string;
}

const issue = (path: string, code: Msg["code"], params?: Record<string, MsgParam>): Issue => ({
  path,
  ...msg(code, params),
});

export type ParseResult =
  | { ok: true; project: Project; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

export function parseProjectText(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [issue("", "invalidJson", { detail: (e as Error).message })],
      warnings: [],
    };
  }
  return parseProject(raw);
}

export function parseProject(raw: unknown): ParseResult {
  const result = projectSchema.safeParse(migrateProject(raw));
  if (!result.success) {
    return {
      ok: false,
      // Zod の文は z.config の言語(画面は画面の言語、CLI は英語)
      errors: result.error.issues.map((i) => issue(formatPath(i.path), "schema", { detail: i.message })),
      warnings: [],
    };
  }
  const project = result.data;
  const { errors, warnings } = checkSemantics(project);
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, project, warnings };
}

const EPS = 1e-6;

export function checkSemantics(p: Project): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const sourceIds = new Set<string>();
  p.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) errors.push(issue(`sources[${i}].id`, "duplicateId", { id: s.id }));
    sourceIds.add(s.id);
  });
  const stepIds = new Set<string>();
  p.steps.forEach((step, i) => {
    const at = (k: string) => `steps[${i}]${k}`;
    if (stepIds.has(step.id)) errors.push(issue(at(".id"), "duplicateId", { id: step.id }));
    stepIds.add(step.id);
    if (!sourceIds.has(step.source)) {
      errors.push(issue(at(".source"), "unknownSource", { id: step.source }));
    }
    if (step.out <= step.in) errors.push(issue(at(".out"), "outBeforeIn"));

    const holds = stepHolds(step);
    let base = videoDuration(step);
    for (let h = 0; h < holds.length; h++) {
      const cur = holds[h];
      if (!cur) continue;
      if (cur.at > base + EPS) {
        errors.push(issue(at(".holds"), "holdAfterVideo", { at: cur.at }));
      }
      base += cur.duration;
      const next = holds[h + 1];
      if (next && next.at < cur.at + cur.duration - EPS) {
        errors.push(issue(at(".holds"), "holdsOverlap", { a: cur.at, b: next.at }));
      }
    }

    const zooms = [...(step.zooms ?? [])].map((z, k) => ({ z, k })).sort((a, b) => a.z.start - b.z.start);
    zooms.forEach(({ z, k }, n) => {
      if (z.end <= z.start) errors.push(issue(at(`.zooms[${k}].end`), "endBeforeStart"));
      const next = zooms[n + 1];
      if (next && next.z.start < z.end - EPS) {
        errors.push(issue(at(`.zooms[${next.k}].start`), "zoomsOverlap"));
      }
    });

    const c = step.caption;
    if (c && c.end != null && c.end <= (c.start ?? 0)) {
      errors.push(issue(at(".caption.end"), "endBeforeStart"));
    }
    const pieces = speechPieces(step);
    pieces.forEach((piece, k) => {
      const where = Array.isArray(step.speech) ? `.speech[${k}]` : ".speech";
      if (piece.start !== undefined && piece.start > baseDuration(step) + EPS) {
        errors.push(issue(at(`${where}.start`), "speechAfterVideo"));
      }
      if (k > 0 && piece.text === undefined) {
        warnings.push(issue(at(`${where}.text`), "speechTextMissing"));
      }
    });
    for (const [k, z] of (step.zooms ?? []).entries()) {
      z.keys.forEach((key, j) => {
        const prev = z.keys[j - 1];
        if (key.t < z.start - EPS || key.t > z.end + EPS) {
          errors.push(
            issue(at(`.zooms[${k}].keys[${j}].t`), "zoomKeyOutside", {
              t: key.t,
              start: z.start,
              end: z.end,
            }),
          );
        }
        if (prev && key.t <= prev.t) {
          errors.push(issue(at(`.zooms[${k}].keys[${j}].t`), "zoomKeysOrder"));
        }
      });
    }
    for (const key of ["pointers"] as const) {
      (step[key] ?? []).forEach((a, k) => {
        a.path.forEach((pt, j) => {
          const prev = a.path[j - 1];
          if (prev && pt.t < prev.t) {
            errors.push(issue(at(`.${key}[${k}].path[${j}].t`), "pointsOrder"));
          }
        });
        const start = a.path[0]?.t ?? 0;
        if (a.end !== undefined && a.end <= start) {
          errors.push(issue(at(`.${key}[${k}].end`), "endBeforeFirstPoint"));
        }
      });
    }
    (step.shapes ?? []).forEach((sh, k) => {
      if (sh.end !== undefined && sh.end <= sh.start) {
        errors.push(issue(at(`.shapes[${k}].end`), "endBeforeStart"));
      }
    });
  });
  return { errors, warnings };
}

/** 保存用の JSON 文字列。人と AI が差分を読みやすいよう 2 スペースで整形する */
export function serializeProject(p: Project): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}
