// アプリの設定(プロジェクトによらない)。ユーザーデータのフォルダーの settings.json に置く。
// Azure AI Speech の鍵は OS の仕組み(safeStorage)で暗号化して同じファイルの secrets に置き、画面には渡さない。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import {
  type AppSettings,
  DEFAULT_APP_SETTINGS,
  DEFAULT_ENGINE_SETTINGS,
  type SettingsPatch,
  type SpeechEngineSettings,
} from "../shared/api";
import { AppError } from "../shared/messages";
import { writeAtomic } from "./project-files";
import { sanitizeUiZoom } from "./ui-zoom";

const file = () => path.join(app.getPath("userData"), "settings.json");
let cache: AppSettings | null = null;
/** 暗号化した鍵(base64) */
let secrets: { azureKey?: string } = {};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** エンジンの設定を読む。同意の記録がなければ有効にしない */
export function sanitizeEngines(raw: unknown, hasKey: boolean): SpeechEngineSettings {
  const d = DEFAULT_ENGINE_SETTINGS;
  const vv = obj(obj(raw).voicevox);
  const az = obj(obj(raw).azure);
  const vvAgreed = strOrNull(vv.agreedAt);
  const azAgreed = strOrNull(az.agreedAt);
  return {
    voicevox: {
      enabled: bool(vv.enabled, false) && vvAgreed !== null,
      agreedAt: vvAgreed,
      url: str(vv.url, d.voicevox.url).trim() || d.voicevox.url,
      exePath: strOrNull(vv.exePath),
      autoStart: bool(vv.autoStart, false),
    },
    azure: {
      enabled: bool(az.enabled, false) && azAgreed !== null,
      agreedAt: azAgreed,
      region: str(az.region, "").trim(),
      hasKey,
    },
  };
}

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  try {
    const raw = JSON.parse(await readFile(file(), "utf8")) as Record<string, unknown>;
    const s = obj(raw.secrets);
    secrets = typeof s.azureKey === "string" && s.azureKey ? { azureKey: s.azureKey } : {};
    cache = {
      language: raw.language === "ja" || raw.language === "en" ? raw.language : "auto",
      projectDir: typeof raw.projectDir === "string" && raw.projectDir ? raw.projectDir : null,
      shortcuts: Object.fromEntries(
        Object.entries(obj(raw.shortcuts)).filter((e): e is [string, string] => typeof e[1] === "string"),
      ),
      engines: sanitizeEngines(raw.engines, !!secrets.azureKey),
      uiZoom: sanitizeUiZoom(raw.uiZoom),
    };
  } catch {
    // ない・読めないときは既定値(壊れたファイルは次の保存で書き直す)
    cache = { ...DEFAULT_APP_SETTINGS };
    secrets = {};
  }
  return cache;
}

async function write(next: AppSettings): Promise<AppSettings> {
  cache = next;
  await writeAtomic(file(), `${JSON.stringify({ ...next, secrets }, null, 2)}\n`);
  return next;
}

export async function saveSettings(patch: SettingsPatch): Promise<AppSettings> {
  const cur = await loadSettings();
  const { engines, ...rest } = patch;
  const merged = {
    voicevox: { ...cur.engines.voicevox, ...engines?.voicevox },
    azure: { ...cur.engines.azure, ...engines?.azure },
  };
  return write({
    ...cur,
    ...rest,
    engines: sanitizeEngines(merged, !!secrets.azureKey),
    uiZoom: sanitizeUiZoom(rest.uiZoom ?? cur.uiZoom),
  });
}

/** Azure AI Speech の鍵を保存する(null で消す)。暗号化できない環境では保存しない */
export async function setAzureKey(key: string | null): Promise<AppSettings> {
  const cur = await loadSettings();
  const k = key?.trim() ?? "";
  if (k) {
    if (!safeStorage.isEncryptionAvailable()) throw new AppError("secureStorageUnavailable");
    secrets = { azureKey: safeStorage.encryptString(k).toString("base64") };
  } else secrets = {};
  return write({
    ...cur,
    engines: { ...cur.engines, azure: { ...cur.engines.azure, hasKey: !!secrets.azureKey } },
  });
}

/** 保存した Azure の鍵(メインプロセスの中だけで使う) */
export async function azureKey(): Promise<string | null> {
  await loadSettings();
  if (!secrets.azureKey) return null;
  try {
    return safeStorage.decryptString(Buffer.from(secrets.azureKey, "base64"));
  } catch {
    return null;
  }
}
