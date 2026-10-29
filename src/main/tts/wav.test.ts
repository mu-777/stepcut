import { describe, expect, it } from "vitest";
import { silentWav, wavDuration } from "./wav";

describe("wav", () => {
  it("長さを読む", () => {
    expect(wavDuration(silentWav(1.5))).toBeCloseTo(1.5);
  });
  it("WAV でなければエラー", () => {
    expect(() => wavDuration(new Uint8Array(20))).toThrow();
  });
});
