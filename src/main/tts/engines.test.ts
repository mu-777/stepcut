import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../../shared/api";
import { sanitizeEngines } from "../settings";
import { AZURE_DEFAULT_VOICE, azureSsml, createAzureEngine } from "./azure-engine";
import type { TtsEngine } from "./engine";
import { clampPitch, clampRate } from "./os-engine";
import { TtsService } from "./service";
import { createVoicevoxEngine } from "./voicevox-engine";
import { silentWav } from "./wav";

type Call = { url: string; init?: RequestInit };
/** 呼ばれた URL を記録し、route の返り値を返す fetch */
function fakeFetch(route: (url: string, init?: RequestInit) => Response | null) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const r = route(url, init);
    if (!r) throw new Error("connection refused");
    return r;
  }) as typeof fetch;
  return { fn, calls };
}
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

describe("VOICEVOX", () => {
  const vv = { ...DEFAULT_ENGINE_SETTINGS.voicevox, enabled: true, agreedAt: "x" };
  const speakers = [{ name: "ずんだもん", styles: [{ name: "ノーマル", id: 3 }] }];

  it("声の一覧はキャラクター(スタイル)ごと", async () => {
    const { fn } = fakeFetch((url) =>
      url.endsWith("/version") ? json("0.20.0") : url.endsWith("/speakers") ? json(speakers) : null,
    );
    const e = createVoicevoxEngine(async () => vv, fn);
    expect(await e.voices()).toEqual([{ id: "3", name: "ずんだもん(ノーマル)", language: "ja-JP" }]);
    expect(e.version).toBe("voicevox-0.20.0");
  });

  it("audio_query に速さを入れて synthesis に渡す", async () => {
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith("/version")) return json("1");
      if (url.includes("/audio_query")) return json({ speedScale: 1, accent_phrases: [] });
      if (url.includes("/synthesis")) return new Response(silentWav(1) as BodyInit, { status: 200 });
      return null;
    });
    const e = createVoicevoxEngine(async () => vv, fn);
    const wav = await e.synthesize(
      { text: "設定 & 開く", voice: "3", params: { rate: 1.5 } },
      new AbortController().signal,
    );
    expect(wav.byteLength).toBeGreaterThan(44);
    const q = calls.find((c) => c.url.includes("/audio_query"));
    expect(q?.url).toContain(`text=${encodeURIComponent("設定 & 開く")}&speaker=3`);
    const s = calls.find((c) => c.url.includes("/synthesis"));
    expect(JSON.parse(String(s?.init?.body)).speedScale).toBe(1.5);
  });

  it("つながらなければ、指定があればエンジンを起動して待つ", async () => {
    let started = false;
    const { fn } = fakeFetch((url) =>
      started && url.endsWith("/version")
        ? json("1")
        : started && url.endsWith("/speakers")
          ? json(speakers)
          : null,
    );
    const e = createVoicevoxEngine(
      async () => ({ ...vv, exePath: "C:/vv/run.exe", autoStart: true }),
      fn,
      async (exe) => {
        expect(exe).toBe("C:/vv/run.exe");
        started = true;
      },
    );
    expect(await e.voices()).toHaveLength(1);
  });

  it("起動に失敗しても例外にせず、分かる言葉で拒否する", async () => {
    const { fn } = fakeFetch(() => null);
    const e = createVoicevoxEngine(
      async () => ({ ...vv, exePath: "C:/none.exe", autoStart: true }),
      fn,
      async () => {
        throw new Error("spawn ENOENT");
      },
    );
    await expect(e.voices()).rejects.toThrow(
      /VOICEVOX のエンジンを起動できません\(C:\/none\.exe\): spawn ENOENT/,
    );
  });

  it("同時の ready() はエンジンの起動と待ちを 1 回にする", async () => {
    let started = 0;
    let up = false;
    const { fn } = fakeFetch((url) =>
      up && url.endsWith("/version") ? json("1") : up && url.endsWith("/speakers") ? json(speakers) : null,
    );
    const e = createVoicevoxEngine(
      async () => ({ ...vv, exePath: "C:/vv/run.exe", autoStart: true }),
      fn,
      async () => {
        started++;
        up = true;
      },
    );
    await Promise.all([e.voices(), e.voices(), e.voices()]);
    expect(started).toBe(1);
  });

  it("cacheVersion は起動せずに版を調べる。つながらなければ未確認のまま", async () => {
    let up = false;
    let started = 0;
    const { fn } = fakeFetch((url) => (up && url.endsWith("/version") ? json("2.0") : null));
    const e = createVoicevoxEngine(
      async () => ({ ...vv, exePath: "C:/vv/run.exe", autoStart: true }),
      fn,
      async () => {
        started++;
      },
    );
    expect(await e.cacheVersion?.()).toBe("voicevox");
    up = true;
    expect(await e.cacheVersion?.()).toBe("voicevox-2.0");
    expect(started).toBe(0);
  });

  it("つながらず起動の指定もなければ、分かる言葉で失敗する", async () => {
    const { fn } = fakeFetch(() => null);
    const e = createVoicevoxEngine(async () => vv, fn);
    await expect(e.voices()).rejects.toThrow(/VOICEVOX のエンジンにつながりません/);
  });

  it("有効にしていなければ使えない", async () => {
    const e = createVoicevoxEngine(async () => DEFAULT_ENGINE_SETTINGS.voicevox);
    expect(await e.unavailable?.()).toMatch(/有効にしていません/);
  });
});

describe("Azure AI Speech", () => {
  const az = { enabled: true, agreedAt: "x", region: "japaneast", hasKey: true };

  it("SSML は文をエスケープし、速さを % にする", () => {
    const ssml = azureSsml({ text: "A<B & 'C'", voice: null, params: { rate: 1.2 } }, "ja-JP-NanamiNeural");
    expect(ssml).toContain('xml:lang="ja-JP"');
    expect(ssml).toContain('<prosody rate="+20%">A&lt;B &amp; &apos;C&apos;</prosody>');
    expect(azureSsml({ text: "a", voice: null, params: {} }, "en-US-AriaNeural")).not.toContain("prosody");
  });

  it("鍵をヘッダーに入れ、リージョンの宛先に送る。声がなければ既定の声", async () => {
    const { fn, calls } = fakeFetch(() => new Response(silentWav(1) as BodyInit, { status: 200 }));
    const e = createAzureEngine(
      async () => az,
      async () => "secret",
      fn,
    );
    await e.synthesize({ text: "a", voice: null, params: {} }, new AbortController().signal);
    expect(calls[0]?.url).toBe("https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1");
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["Ocp-Apim-Subscription-Key"]).toBe("secret");
    expect(String(calls[0]?.init?.body)).toContain(AZURE_DEFAULT_VOICE);
  });

  it("鍵がない・鍵が違うときは分かる言葉で失敗する", async () => {
    const noKey = createAzureEngine(
      async () => az,
      async () => null,
      fakeFetch(() => null).fn,
    );
    await expect(noKey.voices()).rejects.toThrow(/鍵/);
    const bad = createAzureEngine(
      async () => az,
      async () => "k",
      fakeFetch(() => new Response("", { status: 401 })).fn,
    );
    await expect(bad.voices()).rejects.toThrow(/401。鍵かリージョンが違います/);
  });
});

describe("使えないエンジンは OS 標準で代わりに読む", () => {
  it("知らせを付けて OS 標準の声で読む", async () => {
    const used: string[] = [];
    const fake = (name: string, reason: string | null): TtsEngine => ({
      name,
      version: "1",
      notice: `${name} notice`,
      voices: async () => [],
      unavailable: async () => reason,
      synthesize: async () => {
        used.push(name);
        return silentWav(1);
      },
    });
    const svc = new TtsService(await mkdtemp(path.join(os.tmpdir(), "tts-fb-")), [
      fake("os", null),
      fake("voicevox", "VOICEVOX は無効"),
    ]);
    const r = await svc.synthesize({ engine: "voicevox", voice: "3", params: {}, text: "a" });
    expect(used).toEqual(["os"]);
    expect(r.notice).toMatch(/VOICEVOX は無効。OS 標準の声で代わりに読みました/);
    await expect(svc.voices("voicevox")).rejects.toThrow("VOICEVOX は無効");
  });
});

describe("アプリの設定のエンジン", () => {
  it("同意の記録がなければ有効にしない。URL が空なら既定", () => {
    const e = sanitizeEngines(
      { voicevox: { enabled: true, url: " " }, azure: { enabled: true, agreedAt: "t" } },
      true,
    );
    expect(e.voicevox.enabled).toBe(false);
    expect(e.voicevox.url).toBe(DEFAULT_ENGINE_SETTINGS.voicevox.url);
    expect(e.azure).toMatchObject({ enabled: true, hasKey: true });
  });
});

describe("OS エンジンの値の丸め", () => {
  it("速さは 0.5〜6.0、高さは 0.0〜2.0 に収める", () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(1.5)).toBe(1.5);
    expect(clampRate(9)).toBe(6);
    expect(clampPitch(-1)).toBe(0);
    expect(clampPitch(1)).toBe(1);
    expect(clampPitch(3)).toBe(2);
  });
});
