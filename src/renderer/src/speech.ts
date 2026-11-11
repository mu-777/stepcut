// ステップの読み上げ音声を用意する。生成はメインプロセス(キャッシュあり)、ここではデコード結果を持つ。
// 1 ステップに読み上げが複数あれば、それぞれを別に生成する。
import { resolveSpeech, speechPieces, speechText } from "../../core/defaults";
import type { Project, Step } from "../../core/schema";
import { applyDictionary } from "../../core/text";
import { speechTimes } from "../../core/timeline";
import type { TtsRequest } from "../../shared/api";
import { api } from "./api";

export const SAMPLE_RATE = 48000;

export interface SpeechAudio {
  buffer: AudioBuffer;
  duration: number;
}

export function speechRequest(project: Project, step: Step, k = 0): TtsRequest | null {
  const text = speechText(step, k);
  if (!text) return null;
  const s = resolveSpeech(project, step, k);
  return {
    engine: s.engine,
    voice: s.voice,
    params: s.params,
    text: applyDictionary(text, project.dictionary),
  };
}

export const requestKey = (req: TtsRequest): string => JSON.stringify(req);

let decoder: OfflineAudioContext | null = null;

async function decodeWav(wav: Uint8Array): Promise<AudioBuffer> {
  decoder ??= new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const copy = wav.slice().buffer;
  return decoder.decodeAudioData(copy);
}

/** project の読み上げが使う要求の鍵(重複なし)。SpeechStore.retain が残すものを決める */
export function usedSpeechKeys(project: Project, key: (req: TtsRequest) => string): Set<string> {
  const keys = new Set<string>();
  for (const step of project.steps) {
    speechPieces(step).forEach((_, k) => {
      const req = speechRequest(project, step, k);
      if (req) keys.add(key(req));
    });
  }
  return keys;
}

export class SpeechStore {
  private results = new Map<string, SpeechAudio>();
  private pending = new Map<string, Promise<SpeechAudio>>();
  private errors = new Map<string, string>();
  notices = new Set<string>();

  private key(req: TtsRequest): string {
    return requestKey(req);
  }

  /** project が使わない読み上げの結果・失敗を捨てる(入力のたびに増えるデコード済み音声を残さない。生成中のものは残す) */
  retain(project: Project): void {
    const used = usedSpeechKeys(project, requestKey);
    for (const k of [...this.results.keys()]) if (!used.has(k)) this.results.delete(k);
    for (const k of [...this.errors.keys()]) if (!used.has(k)) this.errors.delete(k);
  }

  /** k 番目の読み上げの音声。未生成・文が空なら null */
  get(project: Project, step: Step, k = 0): SpeechAudio | null {
    const req = speechRequest(project, step, k);
    return req ? (this.results.get(this.key(req)) ?? null) : null;
  }

  /** ステップの読み上げのうち、最初に見つかった生成の失敗 */
  error(project: Project, step: Step): string | null {
    for (let k = 0; k < speechPieces(step).length; k++) {
      const req = speechRequest(project, step, k);
      const e = req ? this.errors.get(this.key(req)) : undefined;
      if (e) return e;
    }
    return null;
  }

  /** ステップの読み上げのどれかを生成中か */
  isPending(project: Project, step: Step): boolean {
    return speechPieces(step).some((_, k) => {
      const req = speechRequest(project, step, k);
      return req ? this.pending.has(this.key(req)) : false;
    });
  }

  /** 読み上げごとの長さ。未生成・文が空は 0 */
  stepDurations(project: Project, step: Step): number[] {
    return speechPieces(step).map((_, k) => this.get(project, step, k)?.duration ?? 0);
  }

  /** 読み上げの長さ(ステップ id → 読み上げごとの長さ) */
  durations(project: Project): Map<string, number[]> {
    const m = new Map<string, number[]>();
    for (const step of project.steps) {
      if (speechPieces(step).length > 0) m.set(step.id, this.stepDurations(project, step));
    }
    return m;
  }

  /** 鳴らす音声と開始時刻(ステップ内の出力時刻)。用意できたものだけ */
  placed(project: Project, step: Step): { buffer: AudioBuffer; start: number }[] {
    const times = speechTimes(step, this.stepDurations(project, step));
    const out: { buffer: AudioBuffer; start: number }[] = [];
    speechPieces(step).forEach((_, k) => {
      const a = this.get(project, step, k);
      const tm = times[k];
      if (a && tm) out.push({ buffer: a.buffer, start: tm.start });
    });
    return out;
  }

  load(project: Project, step: Step, k = 0): Promise<SpeechAudio> | null {
    const req = speechRequest(project, step, k);
    if (!req) return null;
    const key = this.key(req);
    const done = this.results.get(key);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(key);
    if (!p) {
      p = api
        .ttsSynthesize(req)
        .then(async (r) => {
          if (r.notice) this.notices.add(r.notice);
          const buffer = await decodeWav(r.wav);
          const audio = { buffer, duration: buffer.duration };
          this.results.set(key, audio);
          this.errors.delete(key);
          return audio;
        })
        .catch((e: Error) => {
          this.errors.set(key, e.message);
          throw e;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  /** 全ステップの読み上げを用意する。1 件終わるごとに onProgress を呼ぶ */
  async loadAll(project: Project, onProgress?: () => void): Promise<string[]> {
    const errors: string[] = [];
    await Promise.all(
      project.steps.flatMap((step) =>
        speechPieces(step).map((_, k) =>
          this.load(project, step, k)
            ?.catch((e: Error) => {
              errors.push(`${step.id}: ${e.message}`);
            })
            .finally(() => onProgress?.()),
        ),
      ),
    );
    return errors;
  }
}
