// 読み上げエンジンの共通インターフェース(TTS-02〜04)。内蔵エンジンもユーザーが有効にするエンジンもこの形に合わせる。
import type { Voice } from "../../shared/api";
import type { Msg } from "../../shared/messages";

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
  /** 同時に走らせる synthesize の最大数。未指定は 2(TtsService が待ち行列で守る) */
  concurrency?: number;
  /**
   * キャッシュの鍵に入れる版。版が接続してみないと分からないエンジン(VOICEVOX)用。
   * 検索時に呼ぶ。エンジンを起動してはいけない。未実装なら version を使う
   */
  cacheVersion?(): Promise<string>;
  /** WAV を返す */
  synthesize(input: SynthesizeInput, signal: AbortSignal): Promise<Uint8Array>;
  /** 書き出し・プレビューで利用者に出す案内(規約の確認など、TTS-11) */
  notice?: Msg;
  /**
   * 使えない理由(アプリの設定で有効にしていない・鍵がないなど)。使えるなら null。
   * 使えないエンジンを指定したプロジェクトは、OS 標準の声で代わりに読む(知らせを出す)
   */
  unavailable?(): Promise<Msg | null>;
}
