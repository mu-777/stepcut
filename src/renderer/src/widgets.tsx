// 画面の部品: 右クリックメニューと、カラムの境界(ドラッグで幅を変える)。
import { useEffect, useRef } from "react";
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
          {it.label}
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
