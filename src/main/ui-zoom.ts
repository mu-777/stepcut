// 画面全体の表示の大きさ(UI の倍率)。Ctrl+プラス / Ctrl+マイナス / Ctrl+0 で段階で変え、アプリの設定に覚える。
// 書き出し(映像の中身)には効かない。メインのウィンドウだけに当てる

/** 選べる倍率。Chromium の拡大縮小の段から、使いそうな範囲を選んだもの */
export const UI_ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

/** 設定ファイルの値を読む。段にない値は 1(等倍) */
export function sanitizeUiZoom(v: unknown): number {
  return typeof v === "number" && (UI_ZOOM_STEPS as readonly number[]).includes(v) ? v : 1;
}

/** 1 段大きく(+1)・小さく(-1)した倍率。端ではそのまま */
export function stepUiZoom(cur: number, dir: 1 | -1): number {
  const steps = UI_ZOOM_STEPS as readonly number[];
  let i = steps.indexOf(cur);
  if (i < 0) i = steps.indexOf(1);
  return steps[Math.min(steps.length - 1, Math.max(0, i + dir))] ?? 1;
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
