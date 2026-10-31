// 省略された項目の既定値を解決する(STY-02: 個別設定がなければ共通設定、それもなければ既定値)。
import type { Background, CaptionStyle, Margin, Project, Step, Zoom } from "./schema";

export interface ResolvedOutput {
  width: number;
  height: number;
  fps: 30 | 60;
  quality: "low" | "medium" | "high";
  srt: boolean;
}

export interface ResolvedLayout {
  background: Background;
  margin: Margin;
  fit: "contain" | "cover";
  shadow: boolean;
}

/** 余白の既定値。上 4%・下 20%(テロップを置く場所)、左右は上と同じ幅(16:9 の出力で) */
export const DEFAULT_MARGIN: Margin = { top: 0.04, right: 0.0225, bottom: 0.2, left: 0.0225 };

/** 背景の既定値。黒ではドロップシャドウが見えないため、同梱のプリセット画像にする */
export const DEFAULT_BACKGROUND: Background = { image: "preset:default" };

export type ResolvedCaptionStyle = Required<CaptionStyle>;

export interface ResolvedAudio {
  sourceEnabled: boolean;
  sourceVolume: number;
  speechVolume: number;
}

export interface ResolvedSpeech {
  engine: string;
  voice: string | null;
  params: Record<string, number | string | boolean>;
}

export const DEFAULT_CAPTION_STYLE: ResolvedCaptionStyle = {
  font: "Yu Gothic UI",
  size: 48,
  color: "#FFFFFF",
  lineHeight: 1.4,
  align: "center",
  background: "auto",
};

/** background が "auto" で、テロップが録画に重なるときの箱の色 */
export const AUTO_CAPTION_BOX = "#000000AA";
export const DEFAULT_CAPTION_WIDTH = 0.8;
/** 新しく作るズームの、拡大したまま保つ長さ(秒) */
export const DEFAULT_ZOOM_LENGTH = 2;

export function resolveOutput(p: Project): ResolvedOutput {
  const o = p.output ?? {};
  return {
    width: o.width ?? 1920,
    height: o.height ?? 1080,
    fps: o.fps ?? 30,
    quality: o.quality ?? "high",
    srt: o.srt ?? false,
  };
}

export function resolveLayout(p: Project): ResolvedLayout {
  const l = p.layout ?? {};
  return {
    background: l.background ?? DEFAULT_BACKGROUND,
    margin: l.margin ?? DEFAULT_MARGIN,
    fit: l.fit ?? "contain",
    shadow: l.shadow ?? true,
  };
}

export function resolveCaptionStyle(p: Project, step: Step): ResolvedCaptionStyle {
  const { position: _p, width: _w, ...project } = p.styles?.caption ?? {};
  return { ...DEFAULT_CAPTION_STYLE, ...project, ...step.caption?.style };
}

/**
 * テロップの置き方(継承: ステップの上書き → プロジェクトの設定 → 既定)。
 * position が null なら既定の位置(録画の下の余白の中央など)を描画側で決める。
 */
export function resolveCaptionPlacement(
  p: Project,
  step: Step,
): { position: { x: number; y: number } | null; width: number } {
  return {
    position: step.caption?.position ?? p.styles?.caption?.position ?? null,
    width: step.caption?.width ?? p.styles?.caption?.width ?? DEFAULT_CAPTION_WIDTH,
  };
}

/** 読み上げる文。speech.text がなければテロップの文を読む(テロップと一致) */
export function speechText(step: Step): string | null {
  if (!step.speech) return null;
  const text = (step.speech.text ?? step.caption?.text ?? "").trim();
  return text === "" ? null : text;
}

export function resolveAudio(p: Project, step: Step): ResolvedAudio {
  return {
    sourceEnabled: step.audio?.source?.enabled ?? p.audio?.source?.enabled ?? true,
    sourceVolume: step.audio?.source?.volume ?? p.audio?.source?.volume ?? 1,
    speechVolume: step.audio?.speech?.volume ?? p.audio?.speech?.volume ?? 1,
  };
}

export function resolveSpeech(p: Project, step: Step): ResolvedSpeech {
  return {
    engine: p.speech?.engine ?? "os",
    voice: step.speech?.voice ?? p.speech?.voice ?? null,
    params: { ...p.speech?.params, ...step.speech?.params },
  };
}

export function stepSpeed(step: Step): number {
  return step.speed ?? 1;
}

/**
 * ズームの動き(拡大・縮小)にかける秒数。省略時は倍率から決める(OpenScreen と同じ式: 0.6 + 0.55 × ln(倍率))。
 * 0 なら動きなしで切り替える。
 */
export function zoomTransition(z: Zoom, scale: number): number {
  return z.transition ?? 0.6 + 0.55 * Math.log(Math.max(1, scale));
}

/** ズーム中に映像を止めるか。既定は止める */
export function zoomHolds(z: Zoom): boolean {
  return z.hold ?? true;
}
