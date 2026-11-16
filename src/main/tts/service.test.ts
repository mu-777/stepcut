import { mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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

  const tmp = () => mkdtemp(path.join(os.tmpdir(), "tts-test-"));
  const req = (text: string) => ({ engine: "fake", voice: null, params: {}, text });

  it("キャッシュの使用量を数え、消せる(フォルダーがなければ 0)", async () => {
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      voices: async () => [],
      synthesize: async () => silentWav(1),
    };
    const dir = path.join(await tmp(), "cache");
    const svc = new TtsService(dir, [engine], { cacheLimitBytes: 10_000_000 });
    expect(await svc.cacheInfo()).toEqual({ bytes: 0, limitBytes: 10_000_000 });
    await svc.synthesize(req("a"));
    await svc.synthesize(req("b"));
    expect((await svc.cacheInfo()).bytes).toBeGreaterThan(0);
    expect((await svc.clearCache()).bytes).toBe(0);
    expect((await readdir(dir)).filter((n) => n.endsWith(".wav"))).toEqual([]);
  });

  it("同時数の上限を守る", async () => {
    let running = 0;
    let max = 0;
    const releases: (() => void)[] = [];
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      concurrency: 2,
      voices: async () => [],
      synthesize: async () => {
        running++;
        max = Math.max(max, running);
        await new Promise<void>((r) => releases.push(r));
        running--;
        return silentWav(1);
      },
    };
    const svc = new TtsService(await tmp(), [engine]);
    const all = Promise.all(["a", "b", "c", "d", "e"].map((t) => svc.synthesize(req(t))));
    for (let i = 0; i < 5; i++) {
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(i));
      expect(running).toBeLessThanOrEqual(2);
      releases[i]?.();
    }
    await all;
    expect(max).toBe(2);
  });

  it("タイムアウトは待ち行列で待つ間は数えない", async () => {
    const releases: (() => void)[] = [];
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      concurrency: 1,
      voices: async () => [],
      synthesize: async (_i, signal) => {
        await new Promise<void>((resolve, reject) => {
          releases.push(resolve);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        });
        return silentWav(1);
      },
    };
    // 偽の時計は setTimeout だけにし、待つのは setImmediate で行う。vi.waitFor は待つ間に偽の時計を進めるので、
    // ファイルの読み書きが遅いとタイムアウトまで進んでしまう
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const until = async (cond: () => boolean) => {
      while (!cond()) await new Promise<void>((r) => setImmediate(r));
    };
    try {
      const svc = new TtsService(await tmp(), [engine], { timeoutMs: 1000 });
      const first = svc.synthesize(req("a"));
      const second = svc.synthesize(req("b"));
      await until(() => releases.length === 1);
      await vi.advanceTimersByTimeAsync(900);
      releases[0]?.();
      await first;
      // 2 つめは待っていた 900ms を数えず、ここから 1000ms
      await until(() => releases.length === 2);
      await vi.advanceTimersByTimeAsync(900);
      releases[1]?.();
      await expect(second).resolves.toBeTruthy();
      // 実行が始まってから超えれば、タイムアウトになる
      const third = svc.synthesize(req("c"));
      const caught = third.catch((e: Error) => e);
      await until(() => releases.length === 3);
      await vi.advanceTimersByTimeAsync(1100);
      expect(await caught).toMatchObject({ code: "speechTimeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("同じ鍵の要求は 1 回の読み上げを共有する", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      voices: async () => [],
      synthesize: async () => {
        calls++;
        await new Promise<void>((r) => {
          release = r;
        });
        return silentWav(1);
      },
    };
    const svc = new TtsService(await tmp(), [engine]);
    const ps = [svc.synthesize(req("a")), svc.synthesize(req("a")), svc.synthesize(req("a"))];
    await vi.waitFor(() => expect(calls).toBe(1));
    release();
    await Promise.all(ps);
    expect(calls).toBe(1);
  });

  it("読み上げ後に版が変わるエンジンでも、書いた鍵と次の検索の鍵が一致する", async () => {
    let calls = 0;
    let learned = false;
    const engine: TtsEngine = {
      name: "fake",
      get version() {
        return learned ? "v-1.0" : "v";
      },
      cacheVersion: async () => (learned ? "v-1.0" : "v"),
      voices: async () => [],
      synthesize: async () => {
        calls++;
        learned = true;
        return silentWav(1);
      },
    };
    const dir = await tmp();
    const svc = new TtsService(dir, [engine]);
    await svc.synthesize(req("a"));
    await svc.synthesize(req("a"));
    expect(calls).toBe(1);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it("壊れたキャッシュは作り直して上書きする", async () => {
    let calls = 0;
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      voices: async () => [],
      synthesize: async () => {
        calls++;
        return silentWav(1);
      },
    };
    const dir = await tmp();
    const svc = new TtsService(dir, [engine]);
    await svc.synthesize(req("a"));
    const [name] = await readdir(dir);
    const file = path.join(dir, String(name));
    await writeFile(file, "not a wav");
    expect((await svc.synthesize(req("a"))).duration).toBeCloseTo(1);
    expect(calls).toBe(2);
    expect((await stat(file)).size).toBeGreaterThan(44);
  });

  it("上限を超えたキャッシュは古いものから消す", async () => {
    const dir = await tmp();
    const one = silentWav(1);
    const engine: TtsEngine = {
      name: "fake",
      version: "1",
      voices: async () => [],
      synthesize: async () => one,
    };
    const svc = new TtsService(dir, [engine], { cacheLimitBytes: one.byteLength * 2 });
    for (const [i, n] of ["old", "mid", "new"].entries()) {
      const f = path.join(dir, `${n}.wav`);
      await writeFile(f, one);
      await utimes(f, new Date(2020, 0, 1 + i), new Date(2020, 0, 1 + i));
    }
    await writeFile(path.join(dir, "keep.txt"), "x");
    await svc.prune();
    expect((await readdir(dir)).sort()).toEqual(["keep.txt", "mid.wav", "new.wav"]);
  });
});
