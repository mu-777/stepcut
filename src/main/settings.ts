// アプリの設定(プロジェクトによらない)。ユーザーデータのフォルダーの settings.json に置く。
import { readFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { type AppSettings, DEFAULT_APP_SETTINGS } from "../shared/api";
import { writeAtomic } from "./project-files";

const file = () => path.join(app.getPath("userData"), "settings.json");
let cache: AppSettings | null = null;

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Partial<AppSettings>;
    cache = {
      language: raw.language === "ja" || raw.language === "en" ? raw.language : "auto",
      projectDir: typeof raw.projectDir === "string" && raw.projectDir ? raw.projectDir : null,
      shortcuts: Object.fromEntries(
        Object.entries(raw.shortcuts && typeof raw.shortcuts === "object" ? raw.shortcuts : {}).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      ),
    };
  } catch {
    // ない・読めないときは既定値(壊れたファイルは次の保存で書き直す)
    cache = { ...DEFAULT_APP_SETTINGS };
  }
  return cache;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch };
  cache = next;
  await writeAtomic(file(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
