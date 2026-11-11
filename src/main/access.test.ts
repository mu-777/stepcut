import { describe, expect, it } from "vitest";
import { AccessList, isValidProjectName, srtPathOf } from "./access";

describe("AccessList", () => {
  it("許可していないパスは読み書きできない。書けるパスは読める", () => {
    const a = new AccessList("linux");
    expect(a.canRead("/a/b.mp4")).toBe(false);
    a.allowRead("/a/b.mp4");
    expect(a.canRead("/a/x/../b.mp4")).toBe(true);
    expect(a.canWrite("/a/b.mp4")).toBe(false);
    a.allowWrite("/o/out.png");
    expect(a.canRead("/o/out.png")).toBe(true);
    expect(() => a.assertWrite("/a/b.mp4")).toThrow(/Path not allowed/);
    expect(a.canRead(42)).toBe(false);
  });

  it("書き出し先は .srt も書ける", () => {
    const a = new AccessList("linux");
    a.allowExport("/o/out.MP4");
    expect(a.canWrite("/o/out.srt")).toBe(true);
    expect(a.canWrite("/o/out.MP4")).toBe(true);
    expect(a.canWrite("/o/other.srt")).toBe(false);
    expect(srtPathOf("/o/a.mp4")).toBe("/o/a.srt");
  });

  it("Windows では大文字小文字を区別しない", () => {
    const a = new AccessList("win32");
    a.allowRead("C:\\Rec\\A.mp4");
    expect(a.canRead("c:\\rec\\sub\\..\\a.MP4")).toBe(true);
    const l = new AccessList("linux");
    l.allowRead("/Rec/A.mp4");
    expect(l.canRead("/rec/a.mp4")).toBe(false);
  });

  it("プロジェクトのパスと、素材の解決結果の許可", () => {
    const a = new AccessList("linux");
    expect(() => a.assertProject("/p/x.json")).toThrow();
    a.allowProject("/p/x.json");
    expect(a.assertProject("/p/x.json")).toBe("/p/x.json");
    a.allowResolved("/p/y.json", "/p/rec.mp4");
    expect(a.canRead("/p/rec.mp4")).toBe(false);
    a.allowResolved(null, "/etc/passwd");
    expect(a.canRead("/etc/passwd")).toBe(false);
    a.allowResolved("/p/x.json", "/p/rec.mp4");
    expect(a.canRead("/p/rec.mp4")).toBe(true);
    expect(a.assertReveal("/p/x.json")).toBe("/p/x.json");
    expect(() => a.assertReveal("/etc/passwd")).toThrow();
  });

  it("実行ファイルは選んだものか今の設定と同じものだけ", () => {
    const a = new AccessList("linux");
    expect(() => a.assertExe("/bin/sh", null)).toThrow();
    expect(() => a.assertExe("/bin/sh", "/bin/sh")).not.toThrow();
    expect(() => a.assertExe(null, "/bin/sh")).not.toThrow();
    expect(() => a.assertExe(undefined, null)).not.toThrow();
    a.allowExe("/opt/vv/run");
    expect(() => a.assertExe("/opt/vv/run", null)).not.toThrow();
  });
});

describe("isValidProjectName", () => {
  it("フォルダーを抜ける名前・使えない文字を断る", () => {
    for (const bad of ["", ".", "..", "a/b", "a\\b", "../x", "a:b", "a*", 'a"', "a<b", "a|b", "a?"])
      expect(isValidProjectName(bad)).toBe(false);
    expect(isValidProjectName(42)).toBe(false);
    expect(isValidProjectName("手順書 1")).toBe(true);
    expect(isValidProjectName("a.b")).toBe(true);
  });
});
