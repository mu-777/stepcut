// アプリの設定(プロジェクトによらない)。左のメニューで区分(一般 / 読み上げ / キー操作)を切り替える。変えたらすぐ保存する。
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import type { AppSettings, SettingsPatch, TtsCacheInfo, UpdateCheckResult } from "../../shared/api";
import { api } from "./api";
import { EngineSettings } from "./engine-settings";
import { CheckField, Field, SegField } from "./fields";
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

/** 左のメニューの区分。並びはメニューの上から */
const SECTIONS = [
  { id: "general", label: "settingsGeneral" },
  { id: "engines", label: "settingsSpeech" },
  { id: "shortcuts", label: "keyBindings" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * focus に "shortcuts" を渡すと、キー操作の区分を選んで開く(キー操作の一覧から来たとき)。
 * "engines" なら読み上げエンジンの区分(全体の設定の読み上げから来たとき)。渡さなければ毎回「一般」から
 */
export function SettingsDialog(props: {
  onClose: () => void;
  onLanguage: () => void;
  onKeys?: () => void;
  focus?: "shortcuts" | "engines";
}) {
  const { onClose } = props;
  const [section, setSection] = useState<SectionId>(props.focus ?? "general");
  const tabRefs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
  /** キーを待っている操作 */
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [keyNote, setKeyNote] = useState("");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void api.getSettings().then(setSettings);
    // 開いている間に Ctrl+プラス/マイナスで表示の大きさを変えたら(画面の大きさが変わる)、出している値を読み直す
    const onResize = () => void api.getSettings().then(setSettings);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  /** メニューの上下キー(Home / End)で区分を移る */
  const onTabKey = (e: ReactKeyboardEvent) => {
    const i = SECTIONS.findIndex((s) => s.id === section);
    const n = SECTIONS.length;
    const next =
      e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    const id = SECTIONS[next]?.id;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    setSection(id);
    tabRefs.current[id]?.focus();
  };
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
        <div className="settings-body">
          <div className="settings-nav" role="tablist" aria-orientation="vertical" onKeyDown={onTabKey}>
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                ref={(el) => {
                  tabRefs.current[s.id] = el;
                }}
                type="button"
                role="tab"
                id={`settings-tab-${s.id}`}
                aria-selected={section === s.id}
                aria-controls="settings-panel"
                tabIndex={section === s.id ? 0 : -1}
                className="settings-tab"
                onClick={() => setSection(s.id)}
              >
                {t(s.label)}
              </button>
            ))}
          </div>
          <div
            className="settings-panel inspector"
            role="tabpanel"
            id="settings-panel"
            aria-labelledby={`settings-tab-${section}`}
            data-section={section}
          >
            <h4>{t(SECTIONS.find((s) => s.id === section)?.label ?? "settingsGeneral")}</h4>
            {settings && section === "general" && (
              <>
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
                <UiZoomField value={settings.uiZoom} onChange={(v) => void change({ uiZoom: v })} />
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
                <UpdateField
                  value={settings.checkUpdates}
                  onChange={(v) => void change({ checkUpdates: v })}
                />
              </>
            )}
            {settings && section === "engines" && (
              <>
                <EngineSettings settings={settings} onChange={change} onSettings={setSettings} />
                <TtsCacheField />
              </>
            )}
            {settings && section === "shortcuts" && (
              <div className="keys-section">
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
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 画面全体の表示の大きさ(%)。打っている間は当てず、Enter か欄を離れたときに当てる(打ちかけの「1」で 50% に縮まないように)。
 * 範囲の外は 50〜300% に収める(メインでも収める)
 */
function UiZoomField(props: { value: number; onChange: (v: number) => void }) {
  const shown = String(Math.round(props.value * 100));
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n <= 0) {
      setText(shown);
      return;
    }
    // 範囲の外は 50〜300 に収めて欄にも出す(フォーカスがあるままでも直す)
    const pct = Math.min(300, Math.max(50, Math.round(n)));
    setText(String(pct));
    if (pct !== Math.round(props.value * 100)) props.onChange(pct / 100);
  };
  return (
    <>
      <div className="row ui-zoom-row">
        <Field label={t("uiZoom")}>
          <input
            type="number"
            min={50}
            max={300}
            step={10}
            value={text}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              commit();
            }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
          />
        </Field>
        {props.value !== 1 && (
          <button type="button" className="small" onClick={() => props.onChange(1)}>
            {t("resetDefault")}
          </button>
        )}
      </div>
      <p className="hint">{t("uiZoomHint")}</p>
    </>
  );
}

/** 起動時に新しい版を確認するか(既定オン)と、今すぐ確認するボタン */
function UpdateField(props: { value: boolean; onChange: (v: boolean) => void }) {
  const [result, setResult] = useState<UpdateCheckResult | "checking" | null>(null);
  return (
    <div className="update-field">
      <p className="field-label">{t("updateSection")}</p>
      <CheckField label={t("checkUpdates")} value={props.value} onChange={props.onChange} />
      <p className="hint">{t("checkUpdatesHint")}</p>
      <div className="row">
        <button
          type="button"
          className="small"
          disabled={result === "checking"}
          onClick={async () => {
            setResult("checking");
            setResult(await api.checkUpdate());
          }}
        >
          {t("checkUpdateNow")}
        </button>
        {result && (
          <span
            className={`hint update-result${result !== "checking" && result.status === "error" ? " warn" : ""}`}
          >
            {result === "checking"
              ? t("updateChecking")
              : result.status === "latest"
                ? `${t("updateLatest")} (v${result.current})`
                : result.status === "available"
                  ? `${t("updateAvailable")}: v${result.version} (${t("currentVersion")} v${result.current})`
                  : `${t("updateError")} (${result.message})`}
          </span>
        )}
        {result && result !== "checking" && result.status === "available" && (
          <button type="button" className="small" onClick={() => void api.openExternal(result.url)}>
            {t("openDownloadPage")}
          </button>
        )}
      </div>
    </div>
  );
}

const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** 読み上げのキャッシュの使用量と、消すボタン(消す前に確認する。Azure は作り直しに料金がかかる) */
function TtsCacheField() {
  const [info, setInfo] = useState<TtsCacheInfo | null>(null);
  useEffect(() => {
    void api.ttsCacheInfo().then(setInfo);
  }, []);
  return (
    <div className="tts-cache-field">
      <p className="field-label">{t("ttsCache")}</p>
      <div className="row">
        <span className="tts-cache-usage">
          {info ? `${fmtMB(info.bytes)} / ${t("ttsCacheLimit")} ${fmtMB(info.limitBytes)}` : "…"}
        </span>
        <button
          type="button"
          className="small"
          disabled={!info || info.bytes === 0}
          onClick={async () => {
            if (!window.confirm(t("ttsCacheConfirm"))) return;
            setInfo(await api.ttsClearCache());
          }}
        >
          {t("ttsCacheClear")}
        </button>
      </div>
      <p className="hint">{t("ttsCacheHint")}</p>
    </div>
  );
}
