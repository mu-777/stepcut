// アプリの設定(プロジェクトによらない): 画面の言語、プロジェクトの保存先、読み上げエンジン、キー操作。変えたらすぐ保存する。
import { useEffect, useRef, useState } from "react";
import type { AppSettings, SettingsPatch } from "../../shared/api";
import { api } from "./api";
import { EngineSettings } from "./engine-settings";
import { SegField } from "./fields";
import { setLanguage, t } from "./i18n";
import {
  comboLabel,
  comboOf,
  DEFAULT_KEYS,
  KEY_ACTION_LABEL,
  KEY_ACTIONS,
  type KeyAction,
  keyFor,
  RESERVED_KEYS,
  setKeyOverrides,
} from "./keymap";

/**
 * focus に "shortcuts" を渡すと、キー操作の欄まで送って開く(キー操作の一覧から来たとき)。
 * "engines" なら読み上げエンジンの欄まで送る(全体の設定の読み上げから来たとき)
 */
export function SettingsDialog(props: {
  onClose: () => void;
  onLanguage: () => void;
  onKeys?: () => void;
  focus?: "shortcuts" | "engines";
}) {
  const { onClose } = props;
  const keysRef = useRef<HTMLDivElement>(null);
  const enginesRef = useRef<HTMLDivElement>(null);
  /** キーを待っている操作 */
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [keyNote, setKeyNote] = useState("");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);
  useEffect(() => {
    if (settings && props.focus === "shortcuts") keysRef.current?.scrollIntoView({ block: "start" });
    if (settings && props.focus === "engines") enginesRef.current?.scrollIntoView({ block: "start" });
  }, [settings, props.focus]);
  const setKey = async (action: KeyAction, combo: string) => {
    const cur = settings?.shortcuts ?? {};
    const next: Record<string, string> = { ...cur, [action]: combo };
    // ほかの操作に同じキーがあれば、そちらの割り当てを外す
    let moved: KeyAction | null = null;
    for (const a of KEY_ACTIONS) {
      if (a !== action && combo && keyFor(a) === combo) {
        next[a] = "";
        moved = a;
      }
    }
    for (const a of KEY_ACTIONS) if (next[a] === DEFAULT_KEYS[a]) delete next[a];
    const saved = await api.setSettings({ shortcuts: next });
    setSettings(saved);
    setKeyOverrides(saved.shortcuts);
    setKeyNote(moved ? `${t("keyMovedFrom")}: ${t(KEY_ACTION_LABEL[moved])}` : "");
    props.onKeys?.();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (capturing) {
        // キーの割り当てを待っている間は、押したキーを割り当てる(Esc でやめる)
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setCapturing(null);
          return;
        }
        const combo = comboOf(e);
        if (!combo) return;
        if (RESERVED_KEYS.includes(combo)) {
          setKeyNote(`${comboLabel(combo)}: ${t("keyReserved")}`);
          return;
        }
        setCapturing(null);
        void setKey(capturing, combo);
        return;
      }
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const change = async (patch: SettingsPatch) => {
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
            <SegField<AppSettings["language"]>
              label={t("language")}
              value={settings.language}
              options={[
                { value: "auto", label: t("languageAuto") },
                { value: "ja", label: "日本語" },
                { value: "en", label: "English" },
              ]}
              onChange={(v) => void change({ language: v })}
            />
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
            <div ref={enginesRef}>
              <EngineSettings settings={settings} onChange={change} onSettings={setSettings} />
            </div>
            <div ref={keysRef} className="keys-section">
              <p className="field-label">{t("keyBindings")}</p>
              <table className="shortcut-table keys-table">
                <tbody>
                  {KEY_ACTIONS.map((a) => {
                    const combo = keyFor(a);
                    return (
                      <tr key={a}>
                        <td>{t(KEY_ACTION_LABEL[a])}</td>
                        <td>
                          <button
                            type="button"
                            className={`key-capture${capturing === a ? " capturing" : ""}`}
                            aria-label={`${t(KEY_ACTION_LABEL[a])}: ${combo ? comboLabel(combo) : t("keyNone")}`}
                            onClick={() => {
                              setKeyNote("");
                              setCapturing(capturing === a ? null : a);
                            }}
                          >
                            {capturing === a ? (
                              t("keyPress")
                            ) : combo ? (
                              <kbd>{comboLabel(combo)}</kbd>
                            ) : (
                              t("keyNone")
                            )}
                          </button>
                        </td>
                        <td>
                          {combo !== DEFAULT_KEYS[a] && (
                            <button
                              type="button"
                              className="small"
                              title={`${t("resetDefault")} (${comboLabel(DEFAULT_KEYS[a])})`}
                              onClick={() => void setKey(a, DEFAULT_KEYS[a])}
                            >
                              {t("resetDefault")}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {keyNote && <p className="hint warn">{keyNote}</p>}
              <p className="hint">{t("keyHint")}</p>
              {Object.keys(settings.shortcuts).length > 0 && (
                <button
                  type="button"
                  className="small"
                  onClick={async () => {
                    const saved = await api.setSettings({ shortcuts: {} });
                    setSettings(saved);
                    setKeyOverrides(saved.shortcuts);
                    setKeyNote("");
                    props.onKeys?.();
                  }}
                >
                  {t("keyResetAll")}
                </button>
              )}
            </div>
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
