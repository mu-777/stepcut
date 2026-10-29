// ステップの読み上げ音声を用意する。生成はメインプロセス(キャッシュあり)、ここではデコード結果を持つ。
import { resolveSpeech } from "../../core/defaults";
import type { Project, Step } from "../../core/schema";
import { applyDictionary } from "../../core/text";
import type { TtsRequest } from "../../shared/api";
import { api } from "./api";

export const SAMPLE_RATE = 48000;

export interface SpeechAudio {
  buffer: AudioBuffer;
  duration: number;
}

export function speechRequest(project: Project, step: Step): TtsRequest | null {
  const text = step.speech?.text.trim();
  if (!text) return null;
  const s = resolveSpeech(project, step);
  return {
    engine: s.engine,
    voice: s.voice,
    params: s.params,
    text: applyDictionary(text, project.dictionary),
  };
}

let decoder: OfflineAudioContext | null = null;

async function decodeWav(wav: Uint8Array): Promise<AudioBuffer> {
  decoder ??= new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const copy = wav.slice().buffer;
  return decoder.decodeAudioData(copy);
}

export class SpeechStore {
  private results = new Map<string, SpeechAudio>();
  private pending = new Map<string, Promise<SpeechAudio>>();
  private errors = new Map<string, string>();
  notices = new Set<string>();

  private key(req: TtsRequest): string {
    return JSON.stringify(req);
  }

  get(project: Project, step: Step): SpeechAudio | null {
    const req = speechRequest(project, step);
    return req ? (this.results.get(this.key(req)) ?? null) : null;
  }

  error(project: Project, step: Step): string | null {
    const req = speechRequest(project, step);
    return req ? (this.errors.get(this.key(req)) ?? null) : null;
  }

  isPending(project: Project, step: Step): boolean {
    const req = speechRequest(project, step);
    return req ? this.pending.has(this.key(req)) : false;
  }

  /** 読み上げの長さ。未生成は 0 */
  durations(project: Project): Map<string, number> {
    const m = new Map<string, number>();
    for (const step of project.steps) {
      const a = this.get(project, step);
      if (a) m.set(step.id, a.duration);
    }
    return m;
  }

  load(project: Project, step: Step): Promise<SpeechAudio> | null {
    const req = speechRequest(project, step);
    if (!req) return null;
    const k = this.key(req);
    const done = this.results.get(k);
    if (done) return Promise.resolve(done);
    let p = this.pending.get(k);
    if (!p) {
      p = api
        .ttsSynthesize(req)
        .then(async (r) => {
          if (r.notice) this.notices.add(r.notice);
          const buffer = await decodeWav(r.wav);
          const audio = { buffer, duration: buffer.duration };
          this.results.set(k, audio);
          this.errors.delete(k);
          return audio;
        })
        .catch((e: Error) => {
          this.errors.set(k, e.message);
          throw e;
        })
        .finally(() => this.pending.delete(k));
      this.pending.set(k, p);
    }
    return p;
  }

  /** 全ステップの読み上げを用意する。1 件終わるごとに onProgress を呼ぶ */
  async loadAll(project: Project, onProgress?: () => void): Promise<string[]> {
    const errors: string[] = [];
    await Promise.all(
      project.steps.map((step) =>
        this.load(project, step)
          ?.catch((e: Error) => {
            errors.push(`${step.id}: ${e.message}`);
          })
          .finally(() => onProgress?.()),
      ),
    );
    return errors;
  }
}
