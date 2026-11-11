// CLI(AI-02, AI-04, AI-07)。
//   stepcut validate <project.json> [--json]
//   stepcut export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]
// --result は結果の JSON をファイルにも書く(Windows の GUI アプリは標準出力がコンソールにつながらないことがあるため)。
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parseProjectText } from "../core/validate";
import { resolveStoredPath } from "./paths";

export interface CliArgs {
  command: "validate" | "export" | "help";
  project?: string;
  out?: string;
  json: boolean;
  result?: string;
}

const COMMANDS = ["validate", "export", "help"] as const;

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
    if (a === "--json") out.json = true;
    else if (a === "--out" || a === "-o") out.out = rest[++i];
    else if (a === "--result") out.result = rest[++i];
    else if (!a.startsWith("-") && !out.project) out.project = a;
  }
  if (out.command !== "help" && !out.project)
    return { error: `${out.command}: プロジェクトファイルを指定してください` };
  if (out.project) out.project = path.resolve(out.project);
  if (out.out) out.out = path.resolve(out.out);
  return out;
}

export const HELP = `Usage:
  stepcut validate <project.json> [--json]
  stepcut export <project.json> [--out <file.mp4>] [--json] [--result <file.json>]`;

export interface ValidateOutput {
  ok: boolean;
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
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
  return { ok: errors.length === 0, errors, warnings: r.warnings };
}

export function formatValidate(r: ValidateOutput): string {
  const lines = [r.ok ? "OK" : "NG"];
  for (const e of r.errors) lines.push(`error  ${e.path || "(root)"}: ${e.message}`);
  for (const w of r.warnings) lines.push(`warn   ${w.path || "(root)"}: ${w.message}`);
  return lines.join("\n");
}
