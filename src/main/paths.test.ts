import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStoredPath, toStoredPath } from "./paths";

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
