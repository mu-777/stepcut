// 素材ファイルの読み込み。ファイルは読んでいる間だけ開いておき、使われなくなったら閉じる
// (開きっぱなしだと、Windows では録画を削除・移動・置き換えできない)。
import { type FileHandle, open } from "node:fs/promises";

/** 読み込みがこの時間なければ閉じる */
export const IDLE_CLOSE_MS = 10_000;

interface Entry {
  handle: Promise<FileHandle>;
  /** 読み込み中の数。0 のときだけ閉じられる */
  inflight: number;
  timer: NodeJS.Timeout | null;
}

export class FileReaders {
  private entries = new Map<string, Entry>();

  constructor(
    private idleMs = IDLE_CLOSE_MS,
    private openFile: (p: string) => Promise<FileHandle> = (p) => open(p, "r"),
  ) {}

  /** いま開いているファイルの数(テスト用) */
  get openCount(): number {
    return this.entries.size;
  }

  async read(p: string, start: number, end: number): Promise<Uint8Array> {
    let entry = this.entries.get(p);
    if (!entry) {
      entry = { handle: this.openFile(p), inflight: 0, timer: null };
      this.entries.set(p, entry);
    }
    const e = entry;
    if (e.timer) clearTimeout(e.timer);
    e.timer = null;
    e.inflight++;
    try {
      let fh: FileHandle;
      try {
        fh = await e.handle;
      } catch (err) {
        // 開けなかったときは失敗を覚えない(次の読み込みで開き直す)
        if (this.entries.get(p) === e) this.entries.delete(p);
        throw err;
      }
      const buf = Buffer.alloc(end - start);
      const { bytesRead } = await fh.read(buf, 0, end - start, start);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally {
      e.inflight--;
      if (e.inflight === 0 && this.entries.get(p) === e) this.scheduleClose(p, e);
    }
  }

  private scheduleClose(p: string, e: Entry): void {
    e.timer = setTimeout(() => {
      // 読み込み中でなければ、先に一覧から外してから閉じる(閉じている途中のハンドルは誰も使わない)
      if (e.inflight > 0 || this.entries.get(p) !== e) return;
      this.entries.delete(p);
      e.handle.then(
        (fh) => fh.close().catch(() => {}),
        () => {},
      );
    }, this.idleMs);
    e.timer.unref();
  }

  /** すべて閉じる(テスト・終了時) */
  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    for (const e of all) {
      if (e.timer) clearTimeout(e.timer);
      await e.handle.then(
        (fh) => fh.close().catch(() => {}),
        () => {},
      );
    }
  }
}
