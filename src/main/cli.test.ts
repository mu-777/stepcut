import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type CliArgs, defaultOutPath, formatJobResult, parseCli, validateFile } from "./cli";

describe("CLI の引数", () => {
  it("コマンドがなければ GUI の起動", () => {
    expect(parseCli([])).toBeNull();
    expect(parseCli(["a.json"])).toBeNull();
  });

  it("frame: ステップと時刻、素材のフレーム", () => {
    const a = parseCli([
      "frame",
      "p.sanno.json",
      "--step",
      "intro",
      "--time",
      "1.5",
      "--source",
      "--json",
    ]) as CliArgs;
    expect(a).toMatchObject({ command: "frame", step: "intro", time: 1.5, source: true, json: true });
    expect(a.project).toBe(path.resolve("p.sanno.json"));
  });

  it("frame: --step か --at が要る。両方は不可。時刻は 0 以上", () => {
    expect(parseCli(["frame", "p.json"])).toHaveProperty("error");
    expect(parseCli(["frame", "p.json", "--step", "1", "--at", "2"])).toHaveProperty("error");
    expect(parseCli(["frame", "p.json", "--at", "-1"])).toHaveProperty("error");
    expect(parseCli(["frame", "p.json", "--at", "abc"])).toHaveProperty("error");
  });

  it("書き出し先の既定はプロジェクトの隣", () => {
    const p = path.resolve("dir/p.sanno.json");
    const base = path.resolve("dir/p");
    expect(defaultOutPath({ command: "export", project: p, json: false })).toBe(`${base}.mp4`);
    expect(defaultOutPath({ command: "frame", project: p, json: false, step: "2", time: 1 })).toBe(
      `${base}.step2-1.png`,
    );
    expect(defaultOutPath({ command: "frame", project: p, json: false, at: 3, source: true })).toBe(
      `${base}.at3.source.png`,
    );
  });

  it("inspect の結果を人が読む形にする", () => {
    const text = formatJobResult("inspect", {
      ok: true,
      duration: 5,
      steps: [{ step: 1, id: "a", start: 0, end: 5, duration: 5, autoHold: 1.2 }],
    });
    expect(text).toContain("step 1 (a): 0s - 5s (5s, auto hold 1.2s)");
    expect(formatJobResult("frame", { ok: false, error: "x" })).toBe("NG x");
  });
});

describe("CLI の引数: 値の欠け", () => {
  it("値を取るオプションに値がなければエラー", () => {
    for (const opt of ["--out", "-o", "--result", "--step", "--time", "--at"]) {
      expect(parseCli(["frame", "p.json", "--step", "1", opt]), `${opt} 末尾`).toHaveProperty("error");
      expect(parseCli(["frame", "p.json", opt, "--json"]), `${opt} 次がオプション`).toHaveProperty("error");
    }
    expect(parseCli(["export", "p.json", "-o", "x.mp4"])).toMatchObject({ out: path.resolve("x.mp4") });
  });
});

describe("validateFile: 画像の存在", () => {
  const project = (extra: object) =>
    JSON.stringify({
      format: "screen-annotator.project",
      version: 1,
      sources: [{ id: "rec1", path: "rec.mp4" }],
      steps: [{ id: "s1", source: "rec1", in: 0, out: 1 }],
      ...extra,
    });

  it("背景・図形・ポインターの画像がなければエラーにする", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cli-validate-"));
    try {
      writeFileSync(path.join(dir, "rec.mp4"), "x");
      writeFileSync(path.join(dir, "ok.png"), "x");
      const file = path.join(dir, "p.sanno.json");
      writeFileSync(
        file,
        project({
          layout: { background: { image: "bg-missing.png" } },
          styles: { pointer: { image: "ok.png" } },
          steps: [
            {
              id: "s1",
              source: "rec1",
              in: 0,
              out: 1,
              shapes: [
                { type: "rect", image: "shape-missing.png", start: 0, rect: { x: 0, y: 0, w: 10, h: 10 } },
              ],
            },
          ],
        }),
      );
      const r = await validateFile(file);
      expect(r.errors.map((e) => e.message)).toEqual(
        expect.arrayContaining([
          "ファイルがありません: bg-missing.png",
          "ファイルがありません: shape-missing.png",
        ]),
      );
      expect(r.errors.find((e) => e.path === "layout.background.image")).toBeTruthy();
      expect(r.errors.some((e) => e.message.includes("ok.png"))).toBe(false);
      expect(r.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
