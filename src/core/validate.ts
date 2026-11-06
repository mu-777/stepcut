// プロジェクトファイルの検証(AI-04)。形(schema.ts)に加え、id の参照や時刻の重なりを調べる。
import { speechPieces } from "./defaults";
import { migrateProject } from "./migrate";
import { type Project, projectSchema } from "./schema";
import { baseDuration, stepHolds, videoDuration } from "./timeline";

export interface Issue {
  /** JSON 内の位置。例: "steps[2].caption.text" */
  path: string;
  message: string;
}

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
      errors: [{ path: "", message: `JSON として読めません: ${(e as Error).message}` }],
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
      errors: result.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message })),
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
    if (sourceIds.has(s.id))
      errors.push({ path: `sources[${i}].id`, message: `id "${s.id}" が重複しています` });
    sourceIds.add(s.id);
  });
  const stepIds = new Set<string>();
  p.steps.forEach((step, i) => {
    const at = (k: string) => `steps[${i}]${k}`;
    if (stepIds.has(step.id)) errors.push({ path: at(".id"), message: `id "${step.id}" が重複しています` });
    stepIds.add(step.id);
    if (!sourceIds.has(step.source)) {
      errors.push({ path: at(".source"), message: `sources に id "${step.source}" がありません` });
    }
    if (step.out <= step.in) errors.push({ path: at(".out"), message: "out は in より後にしてください" });

    const holds = stepHolds(step);
    let base = videoDuration(step);
    for (let h = 0; h < holds.length; h++) {
      const cur = holds[h];
      if (!cur) continue;
      if (cur.at > base + EPS) {
        errors.push({ path: at(".holds"), message: `保持の開始 ${cur.at} 秒がステップの映像より後です` });
      }
      base += cur.duration;
      const next = holds[h + 1];
      if (next && next.at < cur.at + cur.duration - EPS) {
        errors.push({
          path: at(".holds"),
          message: `保持が重なっています(${cur.at} 秒と ${next.at} 秒。hold: true のズームも保持に含みます)`,
        });
      }
    }

    const zooms = [...(step.zooms ?? [])].map((z, k) => ({ z, k })).sort((a, b) => a.z.start - b.z.start);
    zooms.forEach(({ z, k }, n) => {
      if (z.end <= z.start)
        errors.push({ path: at(`.zooms[${k}].end`), message: "end は start より後にしてください" });
      const next = zooms[n + 1];
      if (next && next.z.start < z.end - EPS) {
        errors.push({ path: at(`.zooms[${next.k}].start`), message: "ズームが重なっています" });
      }
    });

    const c = step.caption;
    if (c && c.end != null && c.end <= (c.start ?? 0)) {
      errors.push({ path: at(".caption.end"), message: "end は start より後にしてください" });
    }
    const pieces = speechPieces(step);
    pieces.forEach((piece, k) => {
      const where = Array.isArray(step.speech) ? `.speech[${k}]` : ".speech";
      if (piece.start !== undefined && piece.start > baseDuration(step) + EPS) {
        errors.push({ path: at(`${where}.start`), message: "読み上げの開始がステップの映像より後です" });
      }
      if (k > 0 && piece.text === undefined) {
        warnings.push({ path: at(`${where}.text`), message: "2 つ目以降の読み上げは text を書いてください" });
      }
    });
    for (const [k, z] of (step.zooms ?? []).entries()) {
      z.keys.forEach((key, j) => {
        const prev = z.keys[j - 1];
        if (key.t < z.start - EPS || key.t > z.end + EPS) {
          errors.push({
            path: at(`.zooms[${k}].keys[${j}].t`),
            message: `枠の時刻 ${key.t} 秒がズームの区間(${z.start}〜${z.end} 秒)の外です`,
          });
        }
        if (prev && key.t <= prev.t) {
          errors.push({
            path: at(`.zooms[${k}].keys[${j}].t`),
            message: "枠は時刻の早い順に、同じ時刻を重ねずに並べてください",
          });
        }
      });
    }
    if (step.pointers?.length) {
      warnings.push({ path: at(".pointers"), message: "ポインターはこの版では描画しません(M2 で対応)" });
    }
    if (step.highlights?.length) {
      warnings.push({ path: at(".highlights"), message: "蛍光ペンはこの版では描画しません(M2 で対応)" });
    }
  });
  return { errors, warnings };
}

/** 保存用の JSON 文字列。人と AI が差分を読みやすいよう 2 スペースで整形する */
export function serializeProject(p: Project): string {
  return `${JSON.stringify(p, null, 2)}\n`;
}
