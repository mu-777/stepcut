// 省略された項目の既定値を解決する(STY-02: 個別設定がなければ共通設定、それもなければ既定値)。
import type { Background, CaptionStyle, Margin, Project, SpeechPiece, Step, Zoom } from "./schema";

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
  background: "#00000000",
};

/** テロップの背景の箱を付けるときの既定の色 */
export const CAPTION_BOX_COLOR = "#000000AA";

/** テロップの背景の箱の色。なし(透明・旧い "auto")なら null */
export function captionBoxColor(background: string): string | null {
  if (background === "auto" || /^#[0-9a-fA-F]{6}00$/.test(background)) return null;
  return background;
}
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

/** ステップの読み上げを並べたもの。書かれていなければ空 */
export function speechPieces(step: Step): SpeechPiece[] {
  if (!step.speech) return [];
  return Array.isArray(step.speech) ? step.speech : [step.speech];
}

/** 読み上げを書き戻す。1 つならオブジェクト、なければ省略、複数なら配列にする */
export function withSpeechPieces(step: Step, pieces: SpeechPiece[]): Step {
  const { speech: _s, ...rest } = step;
  if (pieces.length === 0) return rest;
  return { ...rest, speech: pieces.length === 1 ? (pieces[0] as SpeechPiece) : pieces };
}

/** k 番目の読み上げがテロップの文を読むか(最初の 1 つで text を書いていないとき) */
export function speechSynced(step: Step, k = 0): boolean {
  const p = speechPieces(step)[k];
  return k === 0 && p !== undefined && p.text === undefined;
}

/** k 番目に読む文。最初の 1 つは text がなければテロップの文を読む(テロップと一致) */
export function speechText(step: Step, k = 0): string | null {
  const p = speechPieces(step)[k];
  if (!p) return null;
  const text = (p.text ?? (k === 0 ? step.caption?.text : "") ?? "").trim();
  return text === "" ? null : text;
}

export function resolveAudio(p: Project, step: Step): ResolvedAudio {
  return {
    sourceEnabled: step.audio?.source?.enabled ?? p.audio?.source?.enabled ?? true,
    sourceVolume: step.audio?.source?.volume ?? p.audio?.source?.volume ?? 1,
    speechVolume: step.audio?.speech?.volume ?? p.audio?.speech?.volume ?? 1,
  };
}

/** k 番目の読み上げの声。2 つ目以降は書いていなければ最初の読み上げに合わせる */
export function resolveSpeech(p: Project, step: Step, k = 0): ResolvedSpeech {
  const pieces = speechPieces(step);
  const first = pieces[0];
  const piece = pieces[k];
  return {
    engine: p.speech?.engine ?? "os",
    voice: piece?.voice ?? first?.voice ?? p.speech?.voice ?? null,
    params: { ...p.speech?.params, ...first?.params, ...piece?.params },
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
