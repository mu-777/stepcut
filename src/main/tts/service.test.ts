import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TtsEngine } from "./engine";
import { TtsService } from "./service";
import { silentWav } from "./wav";

describe("TtsService", () => {
  it("同じ入力はキャッシュから返す", async () => {
    let calls = 0;
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      voices: async () => [],
      synthesize: async () => {
        calls++;
        return silentWav(2);
      },
    };
    const svc = new TtsService(await mkdtemp(path.join(os.tmpdir(), "tts-test-")), [engine]);
    const req = { engine: "fake", voice: null, params: { rate: 1 }, text: "こんにちは" };
    expect((await svc.synthesize(req)).duration).toBeCloseTo(2);
    await svc.synthesize(req);
    expect(calls).toBe(1);
    await svc.synthesize({ ...req, text: "別の文" });
    expect(calls).toBe(2);
  });

  it("知らないエンジンはエラー", async () => {
    const svc = new TtsService(os.tmpdir(), []);
    await expect(svc.synthesize({ engine: "x", voice: null, params: {}, text: "a" })).rejects.toThrow();
  });
});
