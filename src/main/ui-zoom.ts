// 画面全体の表示の大きさ(UI の倍率)。Ctrl+プラス / Ctrl+マイナス / Ctrl+0 で段階で変え、アプリの設定に覚える。
// アプリの設定では % の数字で入れられる(段にない値も可。範囲は UI_ZOOM_MIN〜UI_ZOOM_MAX)。
// 書き出し(映像の中身)には効かない。メインのウィンドウだけに当てる

/** 選べる倍率。Chromium の拡大縮小の段から、使いそうな範囲を選んだもの */
export const UI_ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** 数字で入れられる範囲(50〜300%) */
export const UI_ZOOM_MIN = 0.5;
export const UI_ZOOM_MAX = 3;

/** 設定の値を読む。1% 単位に丸めて範囲に収める。数でなければ 1(等倍) */
export function sanitizeUiZoom(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return 1;
  return Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, Math.round(v * 100) / 100));
}

/** 1 段大きく(+1)・小さく(-1)した倍率。段にない値からは、その向きのいちばん近い段へ。段の外へは進まない */
export function stepUiZoom(cur: number, dir: 1 | -1): number {
  const steps = UI_ZOOM_STEPS as readonly number[];
  const next = dir > 0 ? steps.find((s) => s > cur + 1e-9) : [...steps].reverse().find((s) => s < cur - 1e-9);
  return next ?? cur;
}

export type UiZoomCommand = "in" | "out" | "reset";

/**
 * キーの押下を倍率の操作にする。Ctrl(Mac は Cmd)と、プラス・マイナス・0 のキー。
 * 「+」は配列で押し方が違うので広く受ける: 英語配列の = と Shift+=(+)、日本語配列の ;(+ のキー)と Shift+-(=)、テンキーの +
 */
export function uiZoomCommand(input: {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}): UiZoomCommand | null {
  if (input.type !== "keyDown" || input.alt || !(input.control || input.meta)) return null;
  if (input.key === "+" || input.key === "=" || input.key === ";") return "in";
  if (input.key === "-") return "out";
  if (input.key === "0") return "reset";
  return null;
}
