// CLI(AI-02, AI-04, AI-07)。
//   screen-annotator validate <project.json> [--json]
//   screen-annotator export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
//   screen-annotator frame <project.json> (--step <番号|id> [--time <秒>] | --at <秒>) [--source] [--out <file.png>] [--json] [--result <file.json>]
//   screen-annotator inspect <project.json> [--json] [--result <file.json>]
// --result は結果の JSON をファイルにも書く(Windows の GUI アプリは標準出力がコンソールにつながらないことがあるため)。
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { objectImages } from "../core/objects";
import type { Project } from "../core/schema";
import { parseProjectText } from "../core/validate";
import { resolveStoredPath } from "./paths";

export interface CliArgs {
  command: "validate" | "export" | "frame" | "inspect" | "help";
  project?: string;
  out?: string;
  json: boolean;
  result?: string;
  /** frame: ステップ(1 始まりの番号か id) */
  step?: string;
  /** frame: ステップ内の出力時刻(秒) */
  time?: number;
  /** frame: 全体の時刻(秒) */
  at?: number;
  /** frame: 素材のフレームをそのまま出す */
  source?: boolean;
}

const COMMANDS = ["validate", "export", "frame", "inspect", "help"] as const;

/** コマンドがなければ null(通常の GUI 起動)。Chromium のスイッチ(--no-sandbox など)は無視する */
export function parseCli(args: string[]): CliArgs | { error: string } | null {
  const first = args.find((a) => !a.startsWith("-"));
  if (!first || !(COMMANDS as readonly string[]).includes(first)) {
    if (args.includes("--help")) return { command: "help", json: false };
    return null;
  }
  const out: CliArgs = { command: first as CliArgs["command"], json: false };
  const rest = args.slice(args.indexOf(first) + 1);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string;
    // 値を取るオプション。値がない(末尾・次が別のオプション)ときは null
    const value = (): string | null => {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith("--")) return null;
      i++;
      return v;
    };
    if (a === "--json") out.json = true;
    else if (a === "--out" || a === "-o" || a === "--result" || a === "--step") {
      const v = value();
      if (v === null) return { error: `${a}: 値を指定してください` };
      if (a === "--result") out.result = v;
      else if (a === "--step") out.step = v;
      else out.out = v;
    } else if (a === "--time" || a === "--at") {
      const raw = value();
      if (raw === null) return { error: `${a}: 0 以上の秒数を指定してください` };
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return { error: `${a}: 0 以上の秒数を指定してください` };
      if (a === "--time") out.time = v;
      else out.at = v;
    } else if (a === "--source") out.source = true;
    else if (!a.startsWith("-") && !out.project) out.project = a;
  }
  if (out.command !== "help" && !out.project)
    return { error: `${out.command}: プロジェクトファイルを指定してください` };
  if (out.command === "frame" && out.step === undefined && out.at === undefined)
    return { error: "frame: --step か --at を指定してください" };
  if (out.command === "frame" && out.step !== undefined && out.at !== undefined)
    return { error: "frame: --step と --at は同時に指定できません" };
  if (out.project) out.project = path.resolve(out.project);
  if (out.out) out.out = path.resolve(out.out);
  return out;
}

export const HELP = `Usage:
  screen-annotator validate <project.json> [--json]
  screen-annotator export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
  screen-annotator frame <project.json> (--step <number|id> [--time <sec>] | --at <sec>) [--source] [--out <file.png>] [--json] [--result <file.json>]
  screen-annotator inspect <project.json> [--json] [--result <file.json>]`;

/** 書き出し先を省いたときのファイル名(プロジェクトと同じ場所) */
export function defaultOutPath(args: CliArgs): string {
  const base = (args.project as string).replace(/(\.sanno)?\.json$/i, "");
  if (args.command !== "frame") return `${base}.mp4`;
  const at = args.at !== undefined ? `at${args.at}` : `step${args.step}-${args.time ?? 0}`;
  return `${base}.${at}${args.source ? ".source" : ""}.png`;
}

export interface ValidateOutput {
  ok: boolean;
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
}

/** 画像のパスがプロジェクトのどこにあるか(最初に見つかった所) */
function imagePath(p: Project, image: string): string {
  if (p.styles?.pointer?.image === image) return "styles.pointer.image";
  for (const [i, s] of p.steps.entries()) {
    for (const [k, a] of (s.pointers ?? []).entries())
      if (a.style?.image === image) return `steps[${i}].pointers[${k}].style.image`;
    for (const [k, sh] of (s.shapes ?? []).entries())
      if (sh.type === "rect" && sh.image === image) return `steps[${i}].shapes[${k}].image`;
  }
  return "";
}

export async function validateFile(projectPath: string): Promise<ValidateOutput> {
  let text: string;
  try {
    text = await readFile(projectPath, "utf8");
  } catch (e) {
    return { ok: false, errors: [{ path: "", message: (e as Error).message }], warnings: [] };
  }
  const r = parseProjectText(text);
  if (!r.ok) return { ok: false, errors: r.errors, warnings: r.warnings };
  const errors = [];
  const dir = path.dirname(projectPath);
  for (const [i, s] of r.project.sources.entries()) {
    try {
      await access(resolveStoredPath(dir, s.path));
    } catch {
      errors.push({ path: `sources[${i}].path`, message: `ファイルがありません: ${s.path}` });
    }
  }
  // 画像(背景・図形・ポインター)。読めなければ書き出しで失敗するので、先に知らせる
  const missing = async (stored: string, where: string) => {
    try {
      await access(resolveStoredPath(dir, stored));
    } catch {
      errors.push({ path: where, message: `ファイルがありません: ${stored}` });
    }
  };
  const bg = r.project.layout?.background as { image?: string } | string | undefined;
  if (bg && typeof bg === "object" && typeof bg.image === "string" && !bg.image.startsWith("preset:"))
    await missing(bg.image, "layout.background.image");
  for (const img of objectImages(r.project)) await missing(img, imagePath(r.project, img));
  return { ok: errors.length === 0, errors, warnings: r.warnings };
}

export function formatValidate(r: ValidateOutput): string {
  const lines = [r.ok ? "OK" : "NG"];
  for (const e of r.errors) lines.push(`error  ${e.path || "(root)"}: ${e.message}`);
  for (const w of r.warnings) lines.push(`warn   ${w.path || "(root)"}: ${w.message}`);
  return lines.join("\n");
}

/** export・frame・inspect の結果を人が読む形にする(--json なしのとき) */
export function formatJobResult(kind: string, result: object): string {
  const r = result as { ok: boolean; error?: string; [key: string]: unknown };
  if (!r.ok) return `NG ${r.error}`;
  if (kind !== "inspect") return `OK ${String(r.outPath)}`;
  type StepRow = { step: number; id: string; start: number; end: number; duration: number; autoHold: number };
  const steps = (r.steps as StepRow[]) ?? [];
  const lines = [`OK total ${r.duration}s`];
  for (const s of steps)
    lines.push(
      `step ${s.step} (${s.id}): ${s.start}s - ${s.end}s (${s.duration}s${s.autoHold > 0 ? `, auto hold ${s.autoHold}s` : ""})`,
    );
  lines.push("(--json で読み上げ・テロップ・ズーム・オブジェクトの時刻も出す)");
  return lines.join("\n");
}
