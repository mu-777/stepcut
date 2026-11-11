import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRecovery, readRecovery, recoveryKey, writeRecovery } from "./recovery";

describe("recoveryKey", () => {
  it("同じパスは同じ名前、16 桁の 16 進数", () => {
    const k = recoveryKey("/p/a.sanno.json", "linux");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(recoveryKey("/p/./a.sanno.json", "linux")).toBe(k);
    expect(recoveryKey("/p/b.sanno.json", "linux")).not.toBe(k);
  });
  it("Windows では大文字小文字を区別しない。POSIX では区別する", () => {
    expect(recoveryKey("C:\\Proj\\A.json", "win32")).toBe(recoveryKey("c:\\proj\\a.JSON", "win32"));
    expect(recoveryKey("/p/A.json", "linux")).not.toBe(recoveryKey("/p/a.json", "linux"));
  });
  it("未保存のプロジェクトは固定の名前", () => {
    expect(recoveryKey(null)).toBe("untitled");
  });
});

describe("recovery files", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), "recovery-")), "recovery");
  });
  afterEach(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  it("書いて読んで消せる(フォルダーがなくても作る)", async () => {
    await writeRecovery(dir, "/p/a.sanno.json", null, "TEXT");
    const r = await readRecovery(dir, "/p/a.sanno.json");
    expect(r).toMatchObject({ text: "TEXT", name: null });
    expect(Number.isNaN(Date.parse(r?.savedAt ?? ""))).toBe(false);
    await clearRecovery(dir, "/p/a.sanno.json");
    expect(await readRecovery(dir, "/p/a.sanno.json")).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("未保存のプロジェクトは名前も残る。別のプロジェクトとは混ざらない", async () => {
    await writeRecovery(dir, null, "手順書", "U");
    await writeRecovery(dir, "/p/a.sanno.json", null, "A");
    expect(await readRecovery(dir, null)).toMatchObject({ text: "U", name: "手順書" });
    expect((await readRecovery(dir, "/p/a.sanno.json"))?.text).toBe("A");
  });

  it("壊れたファイル・ないファイル・形の違うファイルは null、消すのも失敗しない", async () => {
    expect(await readRecovery(dir, null)).toBeNull();
    await writeRecovery(dir, null, null, "x");
    writeFileSync(path.join(dir, "untitled.json"), "{broken");
    expect(await readRecovery(dir, null)).toBeNull();
    writeFileSync(path.join(dir, "untitled.json"), JSON.stringify({ text: 1 }));
    expect(await readRecovery(dir, null)).toBeNull();
    await clearRecovery(dir, null);
    await clearRecovery(dir, null);
  });
});
