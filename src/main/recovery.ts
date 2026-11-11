// クラッシュ復旧用の自動保存(PRJ-06)。プロジェクトファイルとは別に <userData>/recovery/ へ置く。
// 1 プロジェクトにつき 1 ファイル。正常に保存・終了すれば消えるので、残っているのはクラッシュ・強制終了のときだけ。
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { RecoveryData } from "../shared/api";
import { writeAtomic } from "./project-files";

/** まだ保存していないプロジェクトの復旧ファイルの名前 */
const UNTITLED_KEY = "untitled";

/** 復旧ファイルの名前(拡張子なし)。パスは絶対パスにそろえ、Windows では大文字小文字を区別しない */
export function recoveryKey(projectPath: string | null, platform: string = process.platform): string {
  if (projectPath === null) return UNTITLED_KEY;
  const api = platform === "win32" ? path.win32 : path.posix;
  const resolved = api.resolve(projectPath);
  const norm = platform === "win32" ? resolved.toLowerCase() : resolved;
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

const fileOf = (dir: string, projectPath: string | null) =>
  path.join(dir, `${recoveryKey(projectPath)}.json`);

export async function writeRecovery(
  dir: string,
  projectPath: string | null,
  name: string | null,
  text: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const data = { projectPath, name, savedAt: new Date().toISOString(), text };
  await writeAtomic(fileOf(dir, projectPath), JSON.stringify(data));
}

/** 読めない・形が違うファイルは null(消すかどうかは呼ぶ側) */
export async function readRecovery(dir: string, projectPath: string | null): Promise<RecoveryData | null> {
  try {
    const d = JSON.parse(await readFile(fileOf(dir, projectPath), "utf8"));
    if (typeof d?.text !== "string" || typeof d.savedAt !== "string") return null;
    return { text: d.text, savedAt: d.savedAt, name: typeof d.name === "string" ? d.name : null };
  } catch {
    return null;
  }
}

export async function clearRecovery(dir: string, projectPath: string | null): Promise<void> {
  await rm(fileOf(dir, projectPath), { force: true });
}

/** ウィンドウを閉じる処理の中で使う(終了までに消し終わらせる) */
export function clearRecoverySync(dir: string, projectPath: string | null): void {
  try {
    rmSync(fileOf(dir, projectPath), { force: true });
  } catch {
    // 消せなくても閉じるのは止めない
  }
}
