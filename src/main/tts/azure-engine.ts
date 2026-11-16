// Azure AI Speech(TTS-13)。ユーザーが自分の Azure の契約で取った鍵とリージョンで REST API を呼ぶ(SDK は使わない)。
// アプリの設定で有効にしたとき(規約・料金の確認と、読む文を Microsoft に送ることへの同意)だけ使う。費用はユーザーが持つ。

import type { AzureSpeechSettings, Voice } from "../../shared/api";
import { AppError, msg } from "../../shared/messages";
import type { SynthesizeInput, TtsEngine } from "./engine";

export const AZURE_NOTICE = msg("azureNotice");

/** 声を指定していないときの声 */
export const AZURE_DEFAULT_VOICE = "ja-JP-NanamiNeural";

interface AzureVoice {
  ShortName: string;
  LocalName?: string;
  DisplayName?: string;
  Locale: string;
}

const escapeXml = (s: string) =>
  s.replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
  );

/** 読み上げの SSML。速さは 1 = 等速の倍率を % に直す */
export function azureSsml(input: SynthesizeInput, voice: string): string {
  const lang = voice.split("-").slice(0, 2).join("-") || "ja-JP";
  const rate = input.params.rate;
  const pct = typeof rate === "number" && Number.isFinite(rate) ? Math.round((rate - 1) * 100) : 0;
  const text = escapeXml(input.text);
  const body = pct !== 0 ? `<prosody rate="${pct > 0 ? "+" : ""}${pct}%">${text}</prosody>` : text;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(lang)}"><voice name="${escapeXml(voice)}">${body}</voice></speak>`;
}

export function createAzureEngine(
  getSettings: () => Promise<AzureSpeechSettings>,
  getKey: () => Promise<string | null>,
  fetchFn: typeof fetch = fetch,
): TtsEngine {
  async function target(): Promise<{ host: string; key: string }> {
    const s = await getSettings();
    const key = await getKey();
    if (!s.region || !key) throw new AppError("azureNotConfigured");
    if (!/^[a-z0-9]+$/.test(s.region)) throw new AppError("azureBadRegion", { region: s.region });
    return { host: `https://${s.region}.tts.speech.microsoft.com`, key };
  }
  const fail = (r: Response, code: "azureVoicesFailed" | "azureSynthFailed") =>
    new AppError(r.status === 401 ? "azureUnauthorized" : r.status === 429 ? "azureRateLimited" : code, {
      status: r.status,
    });

  return {
    name: "azure",
    // 429(多すぎる)を避けるため少なめ
    concurrency: 3,
    version: "azure-1",
    notice: AZURE_NOTICE,
    async unavailable() {
      const s = await getSettings();
      if (!s.enabled) return msg("azureDisabled");
      return null;
    },
    async voices(): Promise<Voice[]> {
      const { host, key } = await target();
      const r = await fetchFn(`${host}/cognitiveservices/voices/list`, {
        headers: { "Ocp-Apim-Subscription-Key": key },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw fail(r, "azureVoicesFailed");
      return ((await r.json()) as AzureVoice[]).map((v) => ({
        id: v.ShortName,
        name: `${v.LocalName ?? v.DisplayName ?? v.ShortName} (${v.ShortName})`,
        language: v.Locale,
      }));
    },
    async synthesize(input: SynthesizeInput, signal: AbortSignal): Promise<Uint8Array> {
      const { host, key } = await target();
      const r = await fetchFn(`${host}/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
          "User-Agent": "stepcut",
        },
        body: azureSsml(input, input.voice ?? AZURE_DEFAULT_VOICE),
        signal,
      });
      if (!r.ok) throw fail(r, "azureSynthFailed");
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
