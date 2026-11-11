// Azure AI Speech(TTS-13)。ユーザーが自分の Azure の契約で取った鍵とリージョンで REST API を呼ぶ(SDK は使わない)。
// アプリの設定で有効にしたとき(規約・料金の確認と、読む文を Microsoft に送ることへの同意)だけ使う。費用はユーザーが持つ。
import type { AzureSpeechSettings, Voice } from "../../shared/api";
import type { SynthesizeInput, TtsEngine } from "./engine";

export const AZURE_NOTICE =
  "Azure AI Speech を使った音声は、Microsoft の利用規約と、ご自身の Azure の契約の条件・料金に従って使ってください。読み上げる文は Microsoft のサーバーに送られます。/ Follow Microsoft's terms and your Azure subscription's conditions and pricing. The text is sent to Microsoft's servers.";

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
    if (!s.region || !key)
      throw new Error(
        "Azure AI Speech のリージョンと鍵をアプリの設定で入れてください / Set the Azure region and key in the app settings",
      );
    if (!/^[a-z0-9]+$/.test(s.region)) throw new Error(`Azure: リージョンの書き方が違います: ${s.region}`);
    return { host: `https://${s.region}.tts.speech.microsoft.com`, key };
  }
  const fail = async (r: Response, what: string) =>
    new Error(
      `Azure AI Speech: ${what}(${r.status}${r.status === 401 ? "。鍵かリージョンが違います" : r.status === 429 ? "。回数の上限です" : ""})`,
    );

  return {
    name: "azure",
    version: "azure-1",
    notice: AZURE_NOTICE,
    async unavailable() {
      const s = await getSettings();
      if (!s.enabled)
        return "Azure AI Speech はアプリの設定で有効にしていません / Azure AI Speech is not enabled in the app settings";
      return null;
    },
    async voices(): Promise<Voice[]> {
      const { host, key } = await target();
      const r = await fetchFn(`${host}/cognitiveservices/voices/list`, {
        headers: { "Ocp-Apim-Subscription-Key": key },
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw await fail(r, "声の一覧を取れません");
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
          "User-Agent": "screen-annotator",
        },
        body: azureSsml(input, input.voice ?? AZURE_DEFAULT_VOICE),
        signal,
      });
      if (!r.ok) throw await fail(r, "音声を作れません");
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
