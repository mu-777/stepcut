// 読み上げの呼び出しとキャッシュ(TTS-05)、タイムアウトと通知(TTS-09)。

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type { TtsRequest, TtsResult, Voice } from "../../shared/api";
import { AppError, type Msg, msg } from "../../shared/messages";
import { writeAtomic } from "../project-files";
import type { TtsEngine } from "./engine";
import { wavDuration } from "./wav";

const TIMEOUT_MS = 60_000;
/** エンジンが concurrency を持たないときの同時数 */
const DEFAULT_CONCURRENCY = 2;
/** キャッシュの大きさの上限。超えたら古い(mtime の小さい)ものから消す */
export const CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
/** 書き込みがこの回数ごとに掃除する(最初の読み上げでも 1 回掃除する) */
const PRUNE_EVERY_WRITES = 20;

export interface TtsServiceOptions {
  cacheLimitBytes?: number;
  /** 読み上げが始まってからのタイムアウト(待ち行列で待つ間は数えない) */
  timeoutMs?: number;
}

interface Queue {
  running: number;
  waiting: (() => void)[];
}

export class TtsService {
  private engines = new Map<string, TtsEngine>();
  private queues = new Map<string, Queue>();
  /** 同じ鍵の読み上げ(待ち・実行中)は 1 つの Promise を共有する */
  private inflight = new Map<string, Promise<{ wav: Uint8Array; duration: number }>>();
  private cacheLimit: number;
  private timeoutMs: number;
  private pruning: Promise<void> | null = null;
  private pruned = false;
  private writes = 0;

  constructor(
    private cacheDir: string,
    engines: TtsEngine[],
    options: TtsServiceOptions = {},
  ) {
    for (const e of engines) this.engines.set(e.name, e);
    this.cacheLimit = options.cacheLimitBytes ?? CACHE_LIMIT_BYTES;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  private engine(name: string): TtsEngine {
    const e = this.engines.get(name);
    if (!e) throw new AppError("unknownEngine", { name });
    return e;
  }

  async voices(name: string): Promise<Voice[]> {
    const e = this.engine(name);
    const reason = await e.unavailable?.();
    if (reason) throw new AppError(reason.code, reason.params);
    return e.voices();
  }

  /**
   * 使うエンジン。指定したエンジンが使えない(アプリの設定で有効にしていない)ときは OS 標準で代わりに読み、
   * そのことを知らせる(ほかの人のプロジェクトを開いても書き出しが止まらないように)
   */
  private async pick(req: TtsRequest): Promise<{ e: TtsEngine; req: TtsRequest; fallback: Msg | null }> {
    const e = this.engine(req.engine);
    const reason = await e.unavailable?.();
    if (!reason) return { e, req, fallback: null };
    const os = this.engine("os");
    return {
      e: os,
      req: { ...req, engine: "os", voice: null },
      fallback: msg("engineFallback", { reason }),
    };
  }

  cacheKey(e: TtsEngine, req: TtsRequest, version: string = e.version): string {
    const params = Object.fromEntries(Object.entries(req.params).sort(([a], [b]) => a.localeCompare(b)));
    return createHash("sha256")
      .update(JSON.stringify([e.name, version, req.voice, params, req.text]))
      .digest("hex");
  }

  /** エンジンごとの同時数の上限を守って実行する(先着順)。タイムアウトは実行が始まってから数える */
  private async limited<T>(e: TtsEngine, job: () => Promise<T>): Promise<T> {
    let q = this.queues.get(e.name);
    if (!q) {
      q = { running: 0, waiting: [] };
      this.queues.set(e.name, q);
    }
    const limit = Math.max(1, Math.floor(e.concurrency ?? DEFAULT_CONCURRENCY));
    if (q.running >= limit) await new Promise<void>((resolve) => q.waiting.push(resolve));
    else q.running++;
    // 待っていた場合は、前の実行が枠(running)を引き継いでくれている
    try {
      return await job();
    } finally {
      const next = q.waiting.shift();
      if (next) next();
      else q.running--;
    }
  }

  private async runEngine(e: TtsEngine, req: TtsRequest): Promise<Uint8Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await e.synthesize({ text: req.text, voice: req.voice, params: req.params }, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        throw new AppError("speechTimeout", { seconds: this.timeoutMs / 1000 });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** キャッシュの使用量(.wav の合計) */
  async cacheInfo(): Promise<{ bytes: number; limitBytes: number }> {
    let bytes = 0;
    for (const f of await this.cacheFiles()) bytes += f.size;
    return { bytes, limitBytes: this.cacheLimit };
  }

  /** キャッシュを消す(読み上げ中のものは書き終えた後に残る)。消せなかったファイルは飛ばす */
  async clearCache(): Promise<{ bytes: number; limitBytes: number }> {
    await this.pruning;
    for (const f of await this.cacheFiles()) await rm(f.file, { force: true }).catch(() => {});
    return this.cacheInfo();
  }

  private async cacheFiles(): Promise<{ file: string; size: number; mtime: number }[]> {
    const files: { file: string; size: number; mtime: number }[] = [];
    let names: string[];
    try {
      names = await readdir(this.cacheDir);
    } catch {
      return files; // まだキャッシュのフォルダーがない
    }
    for (const name of names) {
      if (!name.endsWith(".wav")) continue;
      const file = path.join(this.cacheDir, name);
      try {
        const st = await stat(file);
        files.push({ file, size: st.size, mtime: st.mtimeMs });
      } catch {
        // 消えたファイルは数えない
      }
    }
    return files;
  }

  /** キャッシュを上限以下にする。古いものから消す。失敗は無視し、同時に 2 つは走らせない */
  prune(): Promise<void> {
    this.pruning ??= this.doPrune()
      .catch(() => {})
      .finally(() => {
        this.pruning = null;
      });
    return this.pruning;
  }

  private async doPrune(): Promise<void> {
    const files = await this.cacheFiles();
    let total = files.reduce((n, f) => n + f.size, 0);
    files.sort((a, b) => a.mtime - b.mtime);
    for (const f of files) {
      if (total <= this.cacheLimit) break;
      await rm(f.file, { force: true });
      total -= f.size;
    }
  }

  private async produce(
    e: TtsEngine,
    req: TtsRequest,
    file: string,
  ): Promise<{ wav: Uint8Array; duration: number }> {
    try {
      const wav = new Uint8Array(await readFile(file));
      const duration = wavDuration(wav);
      // よく使うものを残すため、使った印に mtime を新しくする
      utimes(file, new Date(), new Date()).catch(() => {});
      return { wav, duration };
    } catch {
      // ない・壊れている(WAV として読めない)ときは作り直す
    }
    const wav = await this.limited(e, () => this.runEngine(e, req));
    const duration = wavDuration(wav);
    // 版が読み上げて初めて分かるエンジンもあるので、鍵を作り直してから書く
    const key = this.cacheKey(e, req, (await e.cacheVersion?.()) ?? e.version);
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeAtomic(path.join(this.cacheDir, `${key}.wav`), wav);
      if (++this.writes % PRUNE_EVERY_WRITES === 0) void this.prune();
    } catch {
      // キャッシュに書けなくても読み上げは成功させる
    }
    return { wav, duration };
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const { e, req, fallback } = await this.pick(request);
    if (!this.pruned) {
      this.pruned = true;
      void this.prune();
    }
    const key = this.cacheKey(e, req, (await e.cacheVersion?.()) ?? e.version);
    const id = `${e.name}:${key}`;
    let job = this.inflight.get(id);
    if (!job) {
      job = this.produce(e, req, path.join(this.cacheDir, `${key}.wav`)).finally(() => {
        this.inflight.delete(id);
      });
      this.inflight.set(id, job);
    }
    const { wav, duration } = await job;
    return { wav, duration, notice: fallback ?? e.notice };
  }
}
