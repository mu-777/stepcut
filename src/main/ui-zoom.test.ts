import { describe, expect, it } from "vitest";
import { sanitizeUiZoom, stepUiZoom, uiZoomCommand } from "./ui-zoom";

const key = (
  k: string,
  mods: Partial<{ control: boolean; meta: boolean; alt: boolean }> = { control: true },
) => ({
  type: "keyDown",
  key: k,
  control: false,
  meta: false,
  alt: false,
  ...mods,
});

describe("ui zoom", () => {
  it("steps within the range and stops at the ends", () => {
    expect(stepUiZoom(1, 1)).toBe(1.1);
    expect(stepUiZoom(1, -1)).toBe(0.9);
    expect(stepUiZoom(2, 1)).toBe(2);
    expect(stepUiZoom(0.8, -1)).toBe(0.8);
    // 段にない値は等倍から動かす
    expect(stepUiZoom(1.3, 1)).toBe(1.1);
  });

  it("reads only known steps from the settings file", () => {
    expect(sanitizeUiZoom(1.25)).toBe(1.25);
    expect(sanitizeUiZoom(1.3)).toBe(1);
    expect(sanitizeUiZoom("1.25")).toBe(1);
    expect(sanitizeUiZoom(undefined)).toBe(1);
  });

  it("maps Ctrl/Cmd with plus, minus and 0 on US and JIS layouts", () => {
    for (const k of ["=", "+", ";"]) expect(uiZoomCommand(key(k))).toBe("in");
    expect(uiZoomCommand(key("-"))).toBe("out");
    expect(uiZoomCommand(key("0"))).toBe("reset");
    expect(uiZoomCommand(key("=", { meta: true }))).toBe("in");
  });

  it("ignores other keys, missing Ctrl, Alt and key releases", () => {
    expect(uiZoomCommand(key("1"))).toBeNull();
    expect(uiZoomCommand(key("-", {}))).toBeNull();
    expect(uiZoomCommand(key("-", { control: true, alt: true }))).toBeNull();
    expect(uiZoomCommand({ ...key("-"), type: "keyUp" })).toBeNull();
  });
});
