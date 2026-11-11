import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileReaders } from "./file-readers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "readers-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const text = (b: Uint8Array) => Buffer.from(b).toString("utf8");

describe("FileReaders", () => {
  it("使っている間は開いたままで、使われなくなったら閉じ、次の読み込みで開き直す", async () => {
    vi.useFakeTimers();
    const f = path.join(dir, "a.bin");
    writeFileSync(f, "hello world");
    let opens = 0;
    const r = new FileReaders(1000, (p) => {
      opens++;
      return open(p, "r");
    });
    expect(text(await r.read(f, 0, 5))).toBe("hello");
    await vi.advanceTimersByTimeAsync(900);
    expect(text(await r.read(f, 6, 11))).toBe("world");
    expect(opens).toBe(1);
    // 読むたびに待ち時間が延びる
    await vi.advanceTimersByTimeAsync(900);
    expect(r.openCount).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(r.openCount).toBe(0);
    expect(text(await r.read(f, 0, 5))).toBe("hello");
    expect(opens).toBe(2);
    await r.closeAll();
  });

  it("閉じた後は、ファイルを置き換えても新しい中身が読める・削除もできる", async () => {
    vi.useFakeTimers();
    const f = path.join(dir, "b.bin");
    writeFileSync(f, "old");
    const r = new FileReaders(1000);
    expect(text(await r.read(f, 0, 3))).toBe("old");
    await vi.advanceTimersByTimeAsync(1100);
    await vi.waitFor(() => expect(r.openCount).toBe(0));
    rmSync(f);
    writeFileSync(f, "new");
    expect(text(await r.read(f, 0, 3))).toBe("new");
    await r.closeAll();
  });

  it("同時の読み込みは 1 つのハンドルを共有し、読み込み中に閉じない", async () => {
    const f = path.join(dir, "c.bin");
    writeFileSync(f, "0123456789");
    let opens = 0;
    const r = new FileReaders(0, (p) => {
      opens++;
      return open(p, "r");
    });
    const parts = await Promise.all([r.read(f, 0, 3), r.read(f, 3, 6), r.read(f, 6, 10)]);
    expect(parts.map(text)).toEqual(["012", "345", "6789"]);
    expect(opens).toBe(1);
    await r.closeAll();
  });

  it("開けなかった失敗は覚えず、次は開き直す", async () => {
    const f = path.join(dir, "d.bin");
    const r = new FileReaders(1000);
    await expect(r.read(f, 0, 1)).rejects.toThrow();
    expect(r.openCount).toBe(0);
    writeFileSync(f, "x");
    expect(text(await r.read(f, 0, 1))).toBe("x");
    await r.closeAll();
  });
});
