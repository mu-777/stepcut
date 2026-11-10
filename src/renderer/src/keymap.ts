// キー操作の割り当て。アプリの設定(shortcuts)で変えられる。メニューが受け持つ Ctrl 系(保存・元に戻す・コピーなど)は固定
import type { MessageKey } from "./i18n";

/** 割り当てを変えられる操作 */
export const KEY_ACTIONS = [
  "play",
  "back1s",
  "forward1s",
  "backFrame",
  "forwardFrame",
  "prevBoundary",
  "nextBoundary",
  "toStart",
  "toEnd",
  "split",
  "addZoom",
  "mute",
  "anchor",
  "fullscreen",
  "delete",
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  play: "Space",
  back1s: "ArrowLeft",
  forward1s: "ArrowRight",
  backFrame: "Shift+ArrowLeft",
  forwardFrame: "Shift+ArrowRight",
  prevBoundary: "ArrowUp",
  nextBoundary: "ArrowDown",
  toStart: "Home",
  toEnd: "End",
  split: "S",
  addZoom: "Z",
  mute: "M",
  anchor: "C",
  fullscreen: "F",
  delete: "Delete",
};

export const KEY_ACTION_LABEL: Record<KeyAction, MessageKey> = {
  play: "scPlay",
  back1s: "back1s",
  forward1s: "forward1s",
  backFrame: "scBackFrame",
  forwardFrame: "scForwardFrame",
  prevBoundary: "prevBoundary",
  nextBoundary: "nextBoundary",
  toStart: "toStart",
  toEnd: "toEnd",
  split: "scSplit",
  addZoom: "scZoom",
  mute: "scMute",
  anchor: "scAnchor",
  fullscreen: "scFullscreen",
  delete: "scDelete",
};

/** メニューが受け持つキー(割り当てられない) */
export const RESERVED_KEYS = [
  "Ctrl+N",
  "Ctrl+O",
  "Ctrl+S",
  "Ctrl+E",
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+X",
  "Ctrl+C",
  "Ctrl+V",
  "Ctrl+A",
  "Ctrl+/",
  "Escape",
];

let overrides: Partial<Record<KeyAction, string>> = {};

/** アプリの設定から読んだ割り当てを使う(空文字は「割り当てなし」) */
export function setKeyOverrides(o: Partial<Record<KeyAction, string>> | undefined): void {
  overrides = { ...(o ?? {}) };
}

export function keyFor(action: KeyAction): string {
  return overrides[action] ?? DEFAULT_KEYS[action];
}

/** キーの押下を「Ctrl+Shift+S」の形にする。修飾キーだけの押下は null */
export function comboOf(e: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;
  let key = e.key === " " ? "Space" : e.key;
  if (key.length === 1) key = key.toUpperCase();
  const mods = [
    e.ctrlKey || e.metaKey ? "Ctrl" : "",
    e.altKey ? "Alt" : "",
    e.shiftKey ? "Shift" : "",
  ].filter(Boolean);
  return [...mods, key].join("+");
}

/** 押されたキーに割り当てた操作 */
export function actionOf(e: KeyboardEvent): KeyAction | null {
  const combo = comboOf(e);
  if (!combo) return null;
  return KEY_ACTIONS.find((a) => keyFor(a) === combo) ?? null;
}

const ARROWS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" };

/** 画面に出すキーの名前(ツールチップ・メニュー)。割り当てがなければ空文字 */
export function keyLabel(action: KeyAction): string {
  return comboLabel(keyFor(action));
}

export function comboLabel(combo: string): string {
  if (!combo) return "";
  return combo
    .split("+")
    .map((k) => ARROWS[k] ?? k)
    .join("+");
}

/** 「名前 (キー)」。割り当てがなければ名前だけ */
export function withKey(label: string, action: KeyAction): string {
  const k = keyLabel(action);
  return k ? `${label} (${k})` : label;
}
