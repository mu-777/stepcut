// プロジェクトファイルの保存(素材パスの書き換え)と外部変更の監視(AI-05)。
import { createHash } from "node:crypto";
import { type StatsListener, unwatchFile, watchFile } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveStoredPath, toStoredPath } from "./paths";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** 素材パスを新しい保存先基準に書き換える。JSON として読めなければそのまま返す */
export function rebaseSourcePaths(text: string, fromDir: string | null, toDir: string): string {
  let data: { sources?: { path?: unknown }[] };
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  for (const s of data.sources ?? []) {
    if (typeof s.path !== "string") continue;
    const abs = fromDir ? resolveStoredPath(fromDir, s.path) : s.path;
    if (path.isAbsolute(abs)) s.path = toStoredPath(toDir, abs);
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

/** 書きかけのファイルを読まれないよう、一時ファイルに書いてから置き換える */
export async function writeAtomic(filePath: string, text: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, filePath);
}

/**
 * 1 ファイルを監視する。エディタは別名保存→置き換えで書くことが多いので、fs.watch ではなく定期的に mtime を見る。
 * 自分で保存した内容(markSaved)と同じなら通知しない。
 */
export class ProjectWatcher {
  private file: string | null = null;
  private knownHash = "";
  private listener: StatsListener | null = null;

  constructor(private onChange: (filePath: string, text: string) => void) {}

  watch(filePath: string, text: string): void {
    this.stop();
    this.file = filePath;
    this.knownHash = hash(text);
    this.listener = async (cur, prev) => {
      if (cur.mtimeMs === prev.mtimeMs || !this.file) return;
      try {
        const next = await readFile(this.file, "utf8");
        const h = hash(next);
        if (h === this.knownHash) return;
        this.knownHash = h;
        this.onChange(this.file, next);
      } catch {
        // 置き換えの途中で一瞬消えることがある。次の変化で拾う
      }
    };
    watchFile(filePath, { interval: 500 }, this.listener);
  }

  markSaved(text: string): void {
    this.knownHash = hash(text);
  }

  stop(): void {
    if (this.file && this.listener) unwatchFile(this.file, this.listener);
    this.file = null;
    this.listener = null;
  }
}
