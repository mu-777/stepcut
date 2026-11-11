import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../core/schema";

// speech.ts は読み込み時に window.api を参照するため、先に差し込む
vi.stubGlobal("window", { api: {} });
const { requestKey, usedSpeechKeys } = await import("./speech");

const project = {
  format: "stepcut.project",
  version: 1,
  sources: [{ id: "r", path: "a.mp4" }],
  steps: [
    { id: "s1", source: "r", in: 0, out: 1, caption: { text: "こんにちは" }, speech: {} },
    { id: "s2", source: "r", in: 1, out: 2, speech: [{ text: "A" }, { text: "A" }, { text: " " }] },
    { id: "s3", source: "r", in: 2, out: 3 },
  ],
} as unknown as Project;

describe("usedSpeechKeys", () => {
  it("読み上げが使う要求だけを重複なしで返す(空の文・読み上げなしは含めない)", () => {
    const keys = usedSpeechKeys(project, requestKey);
    expect(keys.size).toBe(2);
    expect([...keys].some((k) => k.includes("こんにちは"))).toBe(true);
    expect([...keys].some((k) => k.includes('"text":"A"'))).toBe(true);
  });

  it("文を書き換えると古い文の鍵は含まれない", () => {
    const edited = {
      ...project,
      steps: [{ ...project.steps[0], caption: { text: "さようなら" } }],
    } as unknown as Project;
    const keys = [...usedSpeechKeys(edited, requestKey)];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("さようなら");
  });
});
