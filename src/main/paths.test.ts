import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStoredPath, toStoredPath } from "./paths";
import { rebaseSourcePaths } from "./project-files";

describe("paths", () => {
  it("同じフォルダ以下は相対、それ以外は絶対(Windows)", () => {
    const w = nodePath.win32;
    expect(toStoredPath("C:\\proj", "C:\\proj\\rec\\a.mp4", w)).toBe("rec/a.mp4");
    expect(toStoredPath("C:\\proj", "C:\\other\\a.mp4", w)).toBe("C:\\other\\a.mp4");
    expect(toStoredPath("C:\\proj", "D:\\a.mp4", w)).toBe("D:\\a.mp4");
    expect(resolveStoredPath("C:\\proj", "rec/a.mp4", w)).toBe("C:\\proj\\rec\\a.mp4");
  });

  it("POSIX", () => {
    const p = nodePath.posix;
    expect(toStoredPath("/p", "/p/a.mp4", p)).toBe("a.mp4");
    expect(toStoredPath("/p", "/q/a.mp4", p)).toBe("/q/a.mp4");
    expect(resolveStoredPath("/p", "rec/a.mp4", p)).toBe("/p/rec/a.mp4");
    expect(resolveStoredPath("/p", "/q/a.mp4", p)).toBe("/q/a.mp4");
  });
});

describe("rebaseSourcePaths", () => {
  it("素材と背景の画像ファイルを保存先基準にする。プリセットは変えない", () => {
    const text = JSON.stringify({
      sources: [{ id: "a", path: "/p/rec/a.mp4" }],
      layout: { background: { image: "/p/bg/x.png" } },
    });
    const out = JSON.parse(rebaseSourcePaths(text, null, "/p"));
    expect(out.sources[0].path).toBe("rec/a.mp4");
    expect(out.layout.background.image).toBe("bg/x.png");
    const preset = JSON.stringify({ sources: [], layout: { background: { image: "preset:mint" } } });
    expect(JSON.parse(rebaseSourcePaths(preset, "/p", "/q")).layout.background.image).toBe("preset:mint");
  });
});
