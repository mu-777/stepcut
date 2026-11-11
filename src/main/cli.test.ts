import path from "node:path";
import { describe, expect, it } from "vitest";
import { type CliArgs, defaultOutPath, formatJobResult, parseCli } from "./cli";

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
