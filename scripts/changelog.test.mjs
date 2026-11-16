import { describe, expect, it } from "vitest";
import { extract, stamp } from "./changelog.mjs";

const base = `# Changelog

<!-- 案内 -->

## [Unreleased]

### Added
- 新しい機能

## [0.1.0] - 2026-11-01

### Fixed
- 直したこと

[Unreleased]: https://github.com/mu-777/stepcut/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mu-777/stepcut/releases/tag/v0.1.0
`;

describe("stamp", () => {
  it("[Unreleased] を版の節にし、空の [Unreleased] とリンクを作る", () => {
    const out = stamp(base, "0.2.0", "2026-11-16");
    expect(out).toContain("## [Unreleased]\n\n## [0.2.0] - 2026-11-16\n\n### Added\n- 新しい機能");
    expect(out).toContain(
      "[Unreleased]: https://github.com/mu-777/stepcut/compare/v0.2.0...HEAD\n" +
        "[0.2.0]: https://github.com/mu-777/stepcut/releases/tag/v0.2.0\n" +
        "[0.1.0]:",
    );
    expect(extract(out, "0.2.0")).toBe("### Added\n- 新しい機能\n");
  });

  it("同じ版の節がすでにあれば止める", () => {
    expect(() => stamp(base, "0.1.0", "2026-11-16")).toThrow();
  });
});

describe("extract", () => {
  it("次の見出しまでを、リンク定義を除いて返す", () => {
    expect(extract(base, "0.1.0")).toBe("### Fixed\n- 直したこと\n");
  });

  it("節が無いか空なら止める(空のリリースを出さない)", () => {
    expect(() => extract(base, "9.9.9")).toThrow();
    expect(() =>
      extract(stamp(base.replace("### Added\n- 新しい機能\n", ""), "0.2.0", "x"), "0.2.0"),
    ).toThrow();
  });

  it("版の . を任意の文字として扱わない", () => {
    expect(() => extract(base.replace("[0.1.0] -", "[0x1x0] -"), "0.1.0")).toThrow();
  });
});
