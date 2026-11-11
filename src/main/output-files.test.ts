import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutputFiles } from "./output-files";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "outputs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("OutputFiles", () => {
  it("commit するまで書き出し先に触れず、commit で置き換える", async () => {
    const final = path.join(dir, "o.mp4");
    writeFileSync(final, "old");
    const o = new OutputFiles();
    const h = await o.open(final, 1);
    await o.write(h, 0, new Uint8Array([97, 98]));
    expect(readFileSync(final, "utf8")).toBe("old");
    await o.close(h, true);
    expect(readFileSync(final, "utf8")).toBe("ab");
    expect(readdirSync(dir)).toEqual(["o.mp4"]);
  });

  it("commit しなければ一時ファイルを消し、元のファイルを残す", async () => {
    const final = path.join(dir, "o.mp4");
    writeFileSync(final, "old");
    const o = new OutputFiles();
    const h = await o.open(final, 1);
    await o.write(h, 0, new Uint8Array([1]));
    await o.close(h, false);
    expect(readFileSync(final, "utf8")).toBe("old");
    expect(readdirSync(dir)).toEqual(["o.mp4"]);
    await o.close(h, false); // 知らないハンドルは何もしない
  });

  it("closeOwner はそのウィンドウの出力だけ捨てる", async () => {
    const o = new OutputFiles();
    const a = await o.open(path.join(dir, "a.mp4"), 1);
    const b = await o.open(path.join(dir, "b.mp4"), 2);
    await o.closeOwner(1);
    expect(o.openCount).toBe(1);
    expect(readdirSync(dir).filter((n) => n.startsWith("a.mp4"))).toEqual([]);
    await o.close(b, true);
    expect(existsSync(path.join(dir, "b.mp4"))).toBe(true);
    void a;
  });
});
