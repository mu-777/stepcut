// 読み上げの呼び出しとキャッシュ(TTS-05)、タイムアウトと通知(TTS-09)。
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TtsRequest, TtsResult, Voice } from "../../shared/api";
import type { TtsEngine } from "./engine";
import { wavDuration } from "./wav";

const TIMEOUT_MS = 60_000;

export class TtsService {
  private engines = new Map<string, TtsEngine>();

  constructor(
    private cacheDir: string,
    engines: TtsEngine[],
  ) {
    for (const e of engines) this.engines.set(e.name, e);
  }

  private engine(name: string): TtsEngine {
    const e = this.engines.get(name);
    if (!e) throw new Error(`読み上げエンジン "${name}" がありません / Unknown speech engine "${name}"`);
    return e;
  }

  async voices(name: string): Promise<Voice[]> {
    const e = this.engine(name);
    const reason = await e.unavailable?.();
    if (reason) throw new Error(reason);
    return e.voices();
  }

  /**
   * 使うエンジン。指定したエンジンが使えない(アプリの設定で有効にしていない)ときは OS 標準で代わりに読み、
   * そのことを知らせる(ほかの人のプロジェクトを開いても書き出しが止まらないように)
   */
  private async pick(req: TtsRequest): Promise<{ e: TtsEngine; req: TtsRequest; fallback: string | null }> {
    const e = this.engine(req.engine);
    const reason = await e.unavailable?.();
    if (!reason) return { e, req, fallback: null };
    const os = this.engine("os");
    return {
      e: os,
      req: { ...req, engine: "os", voice: null },
      fallback: `${reason}。OS 標準の声で代わりに読みました / Used the OS voice instead`,
    };
  }

  cacheKey(e: TtsEngine, req: TtsRequest): string {
    const params = Object.fromEntries(Object.entries(req.params).sort(([a], [b]) => a.localeCompare(b)));
    return createHash("sha256")
      .update(JSON.stringify([e.name, e.version, req.voice, params, req.text]))
      .digest("hex");
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const { e, req, fallback } = await this.pick(request);
    const file = path.join(this.cacheDir, `${this.cacheKey(e, req)}.wav`);
    let wav: Uint8Array;
    try {
      wav = new Uint8Array(await readFile(file));
    } catch {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        wav = await e.synthesize({ text: req.text, voice: req.voice, params: req.params }, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(`読み上げがタイムアウトしました(${TIMEOUT_MS / 1000} 秒) / Speech timed out`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(file, wav);
    }
    return { wav, duration: wavDuration(wav), notice: fallback ?? e.notice };
  }
}
