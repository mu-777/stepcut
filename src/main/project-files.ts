// プロジェクトファイルの保存(素材パスの書き換え)と外部変更の監視(AI-05)。
import { createHash } from "node:crypto";
import { type StatsListener, unwatchFile, watchFile } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveStoredPath, toStoredPath } from "./paths";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** 素材パスを新しい保存先基準に書き換える。JSON として読めなければそのまま返す */
export function rebaseSourcePaths(text: string, fromDir: string | null, toDir: string): string {
  let data: { sources?: { path?: unknown }[]; layout?: { background?: unknown } };
  try {
    data = JSON.parse(text);
  } catch {
    return text;
  }
  const rebase = (stored: string) => {
    const abs = fromDir ? resolveStoredPath(fromDir, stored) : stored;
    return path.isAbsolute(abs) ? toStoredPath(toDir, abs) : stored;
  };
  for (const s of data.sources ?? []) {
    if (typeof s.path === "string") s.path = rebase(s.path);
  }
  // 背景の画像ファイルも素材と同じ規則で保存する(プリセットはそのまま)
  const bg = data.layout?.background as { image?: unknown } | undefined;
  if (bg && typeof bg === "object" && typeof bg.image === "string" && !bg.image.startsWith("preset:")) {
    bg.image = rebase(bg.image);
  }
  // 図形の画像とポインターの画像も同じ規則
  const styles = (data as { styles?: { pointer?: { image?: unknown } } }).styles;
  if (typeof styles?.pointer?.image === "string") styles.pointer.image = rebase(styles.pointer.image);
  const steps = (data as { steps?: { pointers?: unknown[]; shapes?: unknown[] }[] }).steps ?? [];
  for (const st of steps) {
    for (const a of (st.pointers ?? []) as { style?: { image?: unknown } }[]) {
      if (typeof a?.style?.image === "string") a.style.image = rebase(a.style.image);
    }
    for (const sh of (st.shapes ?? []) as { image?: unknown }[]) {
      if (typeof sh?.image === "string") sh.image = rebase(sh.image);
    }
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
