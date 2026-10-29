// 読み上げエンジンの共通インターフェース(TTS-02〜04)。内蔵エンジンも外部プラグインもこの形に合わせる。
import type { Voice } from "../../shared/api";

export interface SynthesizeInput {
  text: string;
  voice: string | null;
  params: Record<string, number | string | boolean>;
}

export interface TtsEngine {
  name: string;
  /** キャッシュの鍵に入れる。OS の更新で声が変わりうるので OS の版を含める */
  version: string;
  voices(): Promise<Voice[]>;
  /** WAV を返す */
  synthesize(input: SynthesizeInput, signal: AbortSignal): Promise<Uint8Array>;
  notice?: string;
}
