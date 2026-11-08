// アプリの設定(プロジェクトによらない): 画面の言語、プロジェクトの保存先。変えたらすぐ保存する。
import { useEffect, useState } from "react";
import type { AppSettings } from "../../shared/api";
import { api } from "./api";
import { Field } from "./fields";
import { setLanguage, t } from "./i18n";

export function SettingsDialog(props: { onClose: () => void; onLanguage: () => void }) {
  const { onClose } = props;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const change = async (patch: Partial<AppSettings>) => {
    const next = await api.setSettings(patch);
    setSettings(next);
    if (patch.language) {
      setLanguage(next.language);
      props.onLanguage();
    }
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背景のクリックで閉じる(Esc でも閉じられる)
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc は window で拾う
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog settings-dialog" role="dialog" aria-label={t("appSettings")}>
        <h3>{t("appSettings")}</h3>
        {settings && (
          <div className="inspector">
            <Field label={t("language")}>
              <select
                value={settings.language}
                onChange={(e) => void change({ language: e.target.value as AppSettings["language"] })}
              >
                <option value="auto">{t("languageAuto")}</option>
                <option value="ja">日本語</option>
                <option value="en">English</option>
              </select>
            </Field>
            <p className="field-label">{t("projectDir")}</p>
            <div className="dir-row">
              <span className="dir-path" title={settings.projectDir ?? ""}>
                {settings.projectDir ?? t("projectDirDefault")}
              </span>
              <button
                type="button"
                className="small"
                onClick={async () => {
                  const dir = await api.pickDirectory(settings.projectDir);
                  if (dir) await change({ projectDir: dir });
                }}
              >
                {t("chooseFolder")}
              </button>
              {settings.projectDir && (
                <button type="button" className="small" onClick={() => void change({ projectDir: null })}>
                  {t("resetDefault")}
                </button>
              )}
            </div>
            <p className="hint">{t("projectDirHint")}</p>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
