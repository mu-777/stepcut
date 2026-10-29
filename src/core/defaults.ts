// 省略された項目の既定値を解決する(STY-02: 個別設定がなければ共通設定、それもなければ既定値)。
import type { Background, CaptionStyle, Project, Step, VideoPlacement, Zoom } from "./schema";

export interface ResolvedOutput {
  width: number;
  height: number;
  fps: 30 | 60;
  quality: "low" | "medium" | "high";
  srt: boolean;
}

export interface ResolvedLayout {
  mode: "band" | "full";
  background: Background;
  bandHeight: number;
  margin: number;
  shadow: boolean;
  /** 枠付きでの映像の位置(中心、出力に対する割合)と幅(出力の幅に対する割合)。null なら自動で配置する */
  video: VideoPlacement | null;
}

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
  background: "#000000AA",
};

export const DEFAULT_CAPTION_POSITION = { x: 0.5, y: 0.88 };
export const DEFAULT_CAPTION_WIDTH = 0.8;
export const DEFAULT_ZOOM_TRANSITION = 0.4;

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
    mode: l.mode ?? "band",
    background: l.background ?? DEFAULT_BACKGROUND,
    bandHeight: l.bandHeight ?? 0.2,
    margin: l.margin ?? 0.04,
    shadow: l.shadow ?? true,
    video: l.video ?? null,
  };
}

export function resolveCaptionStyle(p: Project, step: Step): ResolvedCaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, ...p.styles?.caption, ...step.caption?.style };
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

export function zoomTransition(z: Zoom): number {
  return z.transition ?? DEFAULT_ZOOM_TRANSITION;
}
