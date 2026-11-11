import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../../shared/api";
import { sanitizeEngines } from "../settings";
import { AZURE_DEFAULT_VOICE, azureSsml, createAzureEngine } from "./azure-engine";
import type { TtsEngine } from "./engine";
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
      (exe) => {
        expect(exe).toBe("C:/vv/run.exe");
        started = true;
      },
    );
    expect(await e.voices()).toHaveLength(1);
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
