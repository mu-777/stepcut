// CLI(AI-02, AI-04, AI-07)。
//   stepcut validate <project.json> [--json]
//   stepcut export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
//   stepcut frame <project.json> (--step <番号|id> [--time <秒>] | --at <秒>) [--source] [--out <file.png>] [--json] [--result <file.json>]
//   stepcut inspect <project.json> [--json] [--result <file.json>]
// --result は結果の JSON をファイルにも書く(Windows の GUI アプリは標準出力がコンソールにつながらないことがあるため)。
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { objectImages } from "../core/objects";
import type { Project } from "../core/schema";
import { type Issue, parseProjectText } from "../core/validate";
import { formatEn, type MessageCode } from "../shared/messages";
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

/**
 * コマンドがなければ null(通常の GUI 起動)。Chromium のスイッチ(--no-sandbox など)は無視する。
 * 最初の引数がコマンドでも .json でも既存のパスでもなければ、コマンドの打ち間違いとして引数の誤りにする
 * (GUI を開くと、呼んだ側(AI・スクリプト)が終わるのを待ち続けるため)。exists は既存のパスかを調べる
 */
export function parseCli(
  args: string[],
  exists: (p: string) => boolean = () => true,
): CliArgs | { error: string } | null {
  const first = args.find((a) => !a.startsWith("-"));
  if (!first || !(COMMANDS as readonly string[]).includes(first)) {
    if (args.includes("--help")) return { command: "help", json: false };
    if (first && !/\.json$/i.test(first) && !exists(first)) return { error: `Unknown command: ${first}` };
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
      if (v === null) return { error: `${a}: a value is required` };
      if (a === "--result") out.result = v;
      else if (a === "--step") out.step = v;
      else out.out = v;
    } else if (a === "--time" || a === "--at") {
      const raw = value();
      if (raw === null) return { error: `${a}: give a number of seconds (0 or more)` };
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return { error: `${a}: give a number of seconds (0 or more)` };
      if (a === "--time") out.time = v;
      else out.at = v;
    } else if (a === "--source") out.source = true;
    else if (!a.startsWith("-") && !out.project) out.project = a;
  }
  if (out.command !== "help" && !out.project) return { error: `${out.command}: give a project file` };
  if (out.command === "frame" && out.step === undefined && out.at === undefined)
    return { error: "frame: give --step or --at" };
  if (out.command === "frame" && out.step !== undefined && out.at !== undefined)
    return { error: "frame: --step and --at cannot be used together" };
  if (out.project) out.project = path.resolve(out.project);
  if (out.out) out.out = path.resolve(out.out);
  return out;
}

export const HELP = `Usage:
  stepcut validate <project.json> [--json]
  stepcut export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
  stepcut frame <project.json> (--step <number|id> [--time <sec>] | --at <sec>) [--source] [--out <file.png>] [--json] [--result <file.json>]
  stepcut inspect <project.json> [--json] [--result <file.json>]`;

/** 書き出し先を省いたときのファイル名(プロジェクトと同じ場所) */
export function defaultOutPath(args: CliArgs): string {
  const base = (args.project as string).replace(/(\.stepcut)?\.json$/i, "");
  if (args.command !== "frame") return `${base}.mp4`;
  const at = args.at !== undefined ? `at${args.at}` : `step${args.step}-${args.time ?? 0}`;
  return `${base}.${at}${args.source ? ".source" : ""}.png`;
}

/** CLI の検証の結果の 1 件。code は機械で見分ける用、message は英語の文(CLI は英語に固定) */
export interface CliIssue {
  path: string;
  code: MessageCode;
  message: string;
}

export interface ValidateOutput {
  ok: boolean;
  errors: CliIssue[];
  warnings: CliIssue[];
}

const toCli = (i: Issue): CliIssue => ({ path: i.path, code: i.code, message: formatEn(i) });

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
    return {
      ok: false,
      errors: [toCli({ path: "", code: "cannotRead", params: { detail: (e as Error).message } })],
      warnings: [],
    };
  }
  const r = parseProjectText(text);
  if (!r.ok) return { ok: false, errors: r.errors.map(toCli), warnings: r.warnings.map(toCli) };
  const errors: CliIssue[] = [];
  const dir = path.dirname(projectPath);
  for (const [i, s] of r.project.sources.entries()) {
    try {
      await access(resolveStoredPath(dir, s.path));
    } catch {
      errors.push(toCli({ path: `sources[${i}].path`, code: "fileMissing", params: { path: s.path } }));
    }
  }
  // 画像(背景・図形・ポインター)。読めなければ書き出しで失敗するので、先に知らせる
  const missing = async (stored: string, where: string) => {
    try {
      await access(resolveStoredPath(dir, stored));
    } catch {
      errors.push(toCli({ path: where, code: "fileMissing", params: { path: stored } }));
    }
  };
  const bg = r.project.layout?.background as { image?: string } | string | undefined;
  if (bg && typeof bg === "object" && typeof bg.image === "string" && !bg.image.startsWith("preset:"))
    await missing(bg.image, "layout.background.image");
  for (const img of objectImages(r.project)) await missing(img, imagePath(r.project, img));
  return { ok: errors.length === 0, errors, warnings: r.warnings.map(toCli) };
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
  lines.push("(add --json for the times of narration, captions, zooms and objects)");
  return lines.join("\n");
}
