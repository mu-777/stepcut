// 画面の部品: 右クリックメニュー、カラムの境界(ドラッグで幅を変える)、キー操作の一覧。
import { useEffect, useRef } from "react";
import { type MessageKey, t } from "./i18n";
import type { MenuItem } from "./timeline";

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  // 画面の外にはみ出さないようにする
  const left = Math.min(props.x, window.innerWidth - 220);
  const top = Math.min(props.y, window.innerHeight - props.items.length * 28 - 8);
  return (
    <div className="context-menu" ref={ref} style={{ left, top }} role="menu">
      {props.items.map((it) => (
        <button
          type="button"
          role="menuitem"
          key={it.label}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.action();
          }}
        >
          <span>{it.label}</span>
          {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

/** 境界のドラッグ。移動量(ピクセル)を渡す */
export function Splitter(props: { dir: "col" | "row"; onDrag: (delta: number) => void; onEnd?: () => void }) {
  return (
    <div
      className={`splitter ${props.dir}`}
      onPointerDown={(e) => {
        e.preventDefault();
        let last = props.dir === "col" ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const cur = props.dir === "col" ? ev.clientX : ev.clientY;
          props.onDrag(cur - last);
          last = cur;
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          props.onEnd?.();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
    />
  );
}

/** 幅などの画面設定を覚えておく。保存できない環境でも動くようにする */
export function loadPref(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(`pref.${key}`));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: number): void {
  try {
    localStorage.setItem(`pref.${key}`, String(Math.round(value)));
  } catch {
    // 覚えられなくても動く
  }
}

/** 文字の画面設定を覚えておく。choices にない値なら fallback */
export function loadChoice<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(`pref.${key}`);
    return choices.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveChoice(key: string, value: string): void {
  try {
    localStorage.setItem(`pref.${key}`, value);
  } catch {
    // 覚えられなくても動く
  }
}

/** キー操作の一覧(ヘルプメニュー・プレビューの下の帯の ? から開く)。外のクリックか Esc で閉じる */
export function ShortcutsDialog(props: { onClose: () => void }) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const rows: [string, MessageKey][] = [
    ["Space", "scPlay"],
    ["J / K / L", "scJkl"],
    ["← / →", "scSeek"],
    ["↑ / ↓", "scBoundary"],
    ["Home / End", "scHomeEnd"],
    ["Ctrl+K", "scSplit"],
    ["Z", "scZoom"],
    ["M", "scMute"],
    ["F", "scFullscreen"],
    ["Delete", "scDelete"],
    ["Ctrl+Z / Ctrl+Shift+Z", "scUndo"],
    ["Ctrl+C / Ctrl+V", "scCopy"],
    ["← ↑ → ↓", "scNudge"],
    ["Alt", "scAlt"],
    ["Shift", "scShiftSeek"],
    ["Esc", "scEsc"],
    ["Ctrl+Wheel", "scWheel"],
    [t("middleDrag"), "scPan"],
  ];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 背景のクリックで閉じる(Esc でも閉じられる)
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc は window で拾う
    <div className="dialog-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={t("shortcuts")}>
        <h3>{t("shortcuts")}</h3>
        <table className="shortcut-table">
          <tbody>
            {rows.map(([keys, label]) => (
              <tr key={label}>
                <td>
                  <kbd>{keys}</kbd>
                </td>
                <td>{t(label)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
