// アプリの設定の「読み上げエンジン」(TTS-12, TTS-13)。Azure AI Speech・VOICEVOX は既定で使えず、
// 有効にするときに規約・費用・送るデータの確認に同意してもらう。エンジン・声・鍵はユーザーが用意する。
import { useState } from "react";
import type { AppSettings, SettingsPatch } from "../../shared/api";
import { api } from "./api";
import { CheckField, Field } from "./fields";
import { t } from "./i18n";

/** 規約を確かめる入口(各サービスのトップ。規約の場所が変わってもアプリを直さずに済むように) */
const SITES = {
  voicevox: "https://voicevox.hiroshiba.jp/",
  azure: "https://azure.microsoft.com/products/ai-services/ai-speech",
} as const;

export function EngineSettings(props: {
  settings: AppSettings;
  onChange: (patch: SettingsPatch) => Promise<void>;
  onSettings: (s: AppSettings) => void;
}) {
  const { voicevox, azure } = props.settings.engines;
  const [keyText, setKeyText] = useState("");
  const [test, setTest] = useState<{ engine: string; text: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enable = (engine: "voicevox" | "azure", on: boolean) => {
    // 有効にするときだけ確認する。同意した日時を残す
    if (on && !window.confirm(t(engine === "voicevox" ? "voicevoxConfirm" : "azureConfirm"))) return;
    void props.onChange({
      engines: { [engine]: { enabled: on, agreedAt: on ? new Date().toISOString() : null } },
    });
  };
  const runTest = async (engine: "voicevox" | "azure") => {
    setTest({ engine, text: "…", ok: true });
    try {
      const v = await api.ttsVoices(engine);
      setTest({ engine, text: t("connectionOk").replace("{n}", String(v.length)), ok: true });
    } catch (e) {
      setTest({
        engine,
        text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
        ok: false,
      });
    }
  };
  const testLine = (engine: string) =>
    test?.engine === engine && <p className={`hint${test.ok ? "" : " warn"}`}>{test.text}</p>;

  return (
    <div className="engine-settings">
      <p className="field-label">{t("speechEngines")}</p>
      <p className="hint">{t("speechEnginesHint")}</p>

      <div className="engine-block" data-engine="azure">
        <div className="engine-head">
          <CheckField
            label={`${t("engineAzure")}: ${t("enableEngine")}`}
            value={azure.enabled}
            onChange={(v) => enable("azure", v)}
          />
          <button type="button" className="small" onClick={() => void api.openExternal(SITES.azure)}>
            {t("openTerms")}
          </button>
        </div>
        {azure.enabled && (
          <>
            <p className="hint">{t("azureTermsHint")}</p>
            <Field label={t("azureRegion")}>
              <input
                type="text"
                defaultValue={azure.region}
                onBlur={(e) => void props.onChange({ engines: { azure: { region: e.target.value } } })}
              />
            </Field>
            <p className="field-label">{t("azureKey")}</p>
            {azure.hasKey ? (
              <div className="dir-row">
                <span className="dir-path">{t("azureKeySaved")}</span>
                <button
                  type="button"
                  className="small"
                  onClick={async () => props.onSettings(await api.setAzureKey(null))}
                >
                  {t("removeKey")}
                </button>
              </div>
            ) : (
              <div className="dir-row">
                <input
                  type="password"
                  aria-label={t("azureKey")}
                  placeholder={t("azureKeyPlaceholder")}
                  value={keyText}
                  onChange={(e) => setKeyText(e.target.value)}
                />
                <button
                  type="button"
                  className="small"
                  disabled={!keyText.trim()}
                  onClick={async () => {
                    try {
                      props.onSettings(await api.setAzureKey(keyText));
                      setKeyText("");
                      setError(null);
                    } catch (e) {
                      setError(
                        (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
                      );
                    }
                  }}
                >
                  {t("saveKey")}
                </button>
              </div>
            )}
            {error && <p className="hint warn">{error}</p>}
            <button type="button" className="small" onClick={() => void runTest("azure")}>
              {t("testConnection")}
            </button>
            {testLine("azure")}
          </>
        )}
      </div>

      <div className="engine-block" data-engine="voicevox">
        <div className="engine-head">
          <CheckField
            label={`${t("engineVoicevox")}: ${t("enableEngine")}`}
            value={voicevox.enabled}
            onChange={(v) => enable("voicevox", v)}
          />
          <button type="button" className="small" onClick={() => void api.openExternal(SITES.voicevox)}>
            {t("openTerms")}
          </button>
        </div>
        {voicevox.enabled && (
          <>
            <p className="hint">{t("voicevoxTermsHint")}</p>
            <Field label={t("engineUrl")}>
              <input
                type="text"
                defaultValue={voicevox.url}
                onBlur={(e) => void props.onChange({ engines: { voicevox: { url: e.target.value } } })}
              />
            </Field>
            <p className="field-label">{t("engineExe")}</p>
            <div className="dir-row">
              <span className="dir-path" title={voicevox.exePath ?? ""}>
                {voicevox.exePath ?? t("engineExeNone")}
              </span>
              <button
                type="button"
                className="small"
                onClick={async () => {
                  const exe = await api.pickExecutable();
                  if (exe) await props.onChange({ engines: { voicevox: { exePath: exe } } });
                }}
              >
                {t("chooseFile")}
              </button>
            </div>
            <CheckField
              label={t("engineAutoStart")}
              value={voicevox.autoStart}
              onChange={(v) => void props.onChange({ engines: { voicevox: { autoStart: v } } })}
            />
            <button type="button" className="small" onClick={() => void runTest("voicevox")}>
              {t("testConnection")}
            </button>
            {testLine("voicevox")}
          </>
        )}
      </div>
    </div>
  );
}
