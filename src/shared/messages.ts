// メインプロセス・検証が利用者に出す文言(docs/decisions/20261116-message-i18n.md)。
// 文は持たずにコードと値(Msg)で返し、画面は i18n.ts の t() と同じ言語で訳す。CLI は英語(formatEn)で出す。
// 英語の文はここ、日本語の文は renderer の i18n.ts(MESSAGE_JA)。片方を足したらもう片方も足す(型で落ちる)。

export const MESSAGE_EN = {
  // プロジェクトの検証(core/validate.ts)
  invalidJson: "Not valid JSON: {detail}",
  schema: "{detail}",
  duplicateId: 'id "{id}" is used more than once',
  unknownSource: 'sources has no id "{id}"',
  outBeforeIn: "out must be after in",
  holdAfterVideo: "The hold at {at} s starts after the end of the step's video",
  holdsOverlap:
    'Holds overlap ({a} s and {b} s; zooms with hold set to true or "transition" also count as holds)',
  endBeforeStart: "end must be after start",
  zoomsOverlap: "Zooms overlap",
  speechAfterVideo: "Narration starts after the end of the step's video",
  speechTextMissing: "Write text for the second and later narrations",
  zoomKeyOutside: "The frame at {t} s is outside the zoom ({start}–{end} s)",
  zoomKeysOrder: "List frames in time order, with no two at the same time",
  pointsOrder: "List points in time order",
  endBeforeFirstPoint: "end must be after the time of the first point",
  fileMissing: "File not found: {path}",
  cannotRead: "Cannot read the file: {detail}",
  // ファイル・設定(main)
  pathDenied: "Path not allowed: {path}",
  invalidName: "This name cannot be used: {name}",
  nameExists: "A file with the same name already exists: {path}",
  secureStorageUnavailable:
    "The key cannot be stored securely here (the OS credential store is not available)",
  // 読み上げ(main/tts)
  unknownEngine: 'Unknown speech engine "{name}"',
  speechTimeout: "Speech timed out ({seconds} s)",
  engineFallback: "{reason}. Used the OS voice instead",
  osNotice: "Check the OS vendor's terms before using OS voices commercially.",
  osSilentNotice: "Speech is not supported on this OS; silence is used instead.",
  azureNotice:
    "Follow Microsoft's terms and your Azure subscription's conditions and pricing when using Azure AI Speech voices. The text to read is sent to Microsoft's servers.",
  azureDisabled: "Azure AI Speech is not enabled in the app settings",
  azureNotConfigured: "Set the Azure AI Speech region and key in the app settings",
  azureBadRegion: "Azure: invalid region: {region}",
  azureVoicesFailed: "Azure AI Speech: cannot get the voice list ({status})",
  azureSynthFailed: "Azure AI Speech: cannot create the audio ({status})",
  azureUnauthorized: "Azure AI Speech: the key or region is wrong ({status})",
  azureRateLimited: "Azure AI Speech: request limit reached ({status})",
  voicevoxNotice:
    "Follow the VOICEVOX terms and the terms of each voice (character) you use. Check each set of terms for credit requirements.",
  voicevoxDisabled: "VOICEVOX is not enabled in the app settings",
  voicevoxUnreachable:
    "Cannot reach the VOICEVOX engine ({url}). Start the engine, or set its location and auto start in the app settings",
  voicevoxStartFailed: "Cannot start the VOICEVOX engine ({path}): {reason}",
  voicevoxStartTimeout: "The VOICEVOX engine did not start (waited {seconds} s)",
  voicevoxVoicesFailed: "VOICEVOX: cannot get the voice list ({status})",
  voicevoxUnknownVoice: "VOICEVOX: unknown voice: {id}",
  voicevoxQueryFailed: "VOICEVOX: cannot create the reading ({status})",
  voicevoxSynthFailed: "VOICEVOX: cannot create the audio ({status})",
  // 素材・書き出し(renderer。CLI の書き出しは画面を英語にして同じ文を使う)
  unknownPreset: "Unknown background preset: {name}",
  cannotReadImage: "Cannot read this image: {path}",
  noVideoTrack: "No video track: {path}",
  cannotDecode: "This video cannot be played: {path}",
  cannotReadSource: "Cannot read the recording: {id}",
  cannotLoadBackground: "Cannot load the background image: {path}",
  cannotLoadImage: "Cannot load the image: {path}",
  speechFailed: "Cannot create the narration: {detail}",
  speechFailedZero: "Cannot create the narration (counted as 0 s long): {detail}",
  noSteps: "There are no steps",
  stepNotFound: "Step not found: {step}",
  timePastEnd: "--time {time} is past the end of the step ({duration} s); used the last frame",
  nothingToExport: "There are no steps to export",
  h264Unavailable: "Cannot encode H.264 ({width}x{height})",
  encodedInSoftware: "No hardware encoder is available, so the video was encoded in software",
  audioOpus: "AAC is not available, so the audio was encoded as Opus",
  noAudioEncoder: "No audio encoder is available, so the video has no audio",
  canceled: "Canceled",
} as const;

export type MessageCode = keyof typeof MESSAGE_EN;
export type MsgParam = string | number | Msg;
export interface Msg {
  code: MessageCode;
  params?: Record<string, MsgParam>;
}

export const msg = (code: MessageCode, params?: Record<string, MsgParam>): Msg =>
  params ? { code, params } : { code };

/** {name} を値で埋める。値が Msg なら同じ言語で文にする。値のない {name} はそのまま残す */
export function fillTemplate(template: string, params: Msg["params"], format: (m: Msg) => string): string {
  return template.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = params?.[name];
    if (v === undefined) return all;
    return typeof v === "object" ? format(v) : String(v);
  });
}

export function formatEn(m: Msg): string {
  return fillTemplate(MESSAGE_EN[m.code] ?? m.code, m.params, formatEn);
}

export const isMsg = (v: unknown): v is Msg =>
  typeof v === "object" && v !== null && typeof (v as Msg).code === "string" && (v as Msg).code in MESSAGE_EN;

/** 利用者に出すエラー。message は英語(ログ・CLI 用)。IPC では encodeError でコードと値を渡す */
export class AppError extends Error {
  constructor(
    readonly code: MessageCode,
    readonly params?: Record<string, MsgParam>,
  ) {
    super(formatEn(msg(code, params)));
    this.name = "AppError";
  }
  get msg(): Msg {
    return msg(this.code, this.params);
  }
}

/**
 * IPC で渡すときの印。Electron の invoke はエラーの message しか渡さないため
 * (https://www.electronjs.org/docs/latest/api/ipc-renderer#ipcrendererinvokechannel-args)、message に JSON で入れる
 */
const MARK = "stepcut-msg:";

/** メインの IPC の処理が投げたエラーを、画面で訳せる形にする。AppError 以外はそのまま */
export function encodeError(e: unknown): unknown {
  return e instanceof AppError ? new Error(MARK + JSON.stringify(e.msg)) : e;
}

/** エラーを Msg か文字列にする。IPC の印・Electron の前置き("Error invoking remote method …")を外す */
export function decodeError(e: unknown): Msg | string {
  if (e instanceof AppError) return e.msg;
  const text = e instanceof Error ? e.message : String(e);
  const i = text.indexOf(MARK);
  if (i >= 0) {
    try {
      const m = JSON.parse(text.slice(i + MARK.length)) as unknown;
      if (isMsg(m)) return m;
    } catch {
      // 印のあとが読めなければ文のまま出す
    }
  }
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** エラーを英語の文にする(CLI 用) */
export function errorTextEn(e: unknown): string {
  const d = decodeError(e);
  return typeof d === "string" ? d : formatEn(d);
}
