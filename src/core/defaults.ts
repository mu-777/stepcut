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
/**
 * 背景を「単色」に切り替えたときの色。黒だと録画の影が見えないため、影が分かり、白いテロップが読める
 * 中くらいの暗さの青みの灰色(白い文字とのコントラスト比 約 7.6)
 */
export const DEFAULT_SOLID_BACKGROUND = "#475569";

/** 素材にできる画像の拡張子。画像の素材はどの時刻でも同じ 1 枚で、ステップの in / out は長さだけを表す */
export const IMAGE_SOURCE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const;
/** 画像の素材を足したときのステップの長さ(秒) */
export const DEFAULT_IMAGE_STEP_SECONDS = 3;

/** 素材のパスが画像か(拡張子で決める) */
export function isImageSource(path: string): boolean {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  return (IMAGE_SOURCE_EXTENSIONS as readonly string[]).includes(ext);
}

export type ResolvedCaptionStyle = Required<CaptionStyle>;

export interface ResolvedAudio {
  sourceEnabled: boolean;
  sourceVolume: number;
  speechVolume: number;
  /** 早送りで音の高さを保つ */
  keepPitch: boolean;
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

/**
 * 録画の置き方(継承: ステップの layout → 全体の layout → 既定)。背景は全体だけ。
 * step を省くと全体の設定(全体の設定パネル・ステップのないとき)
 */
export function resolveLayout(p: Project, step?: Step | null): ResolvedLayout {
  const l = p.layout ?? {};
  const s = step?.layout ?? {};
  return {
    background: l.background ?? DEFAULT_BACKGROUND,
    margin: s.margin ?? l.margin ?? DEFAULT_MARGIN,
    fit: s.fit ?? l.fit ?? "contain",
    shadow: s.shadow ?? l.shadow ?? true,
  };
}

/** ステップが録画の枠を上書きしているか */
export function hasStepLayout(step: Step): boolean {
  return !!step.layout && Object.keys(step.layout).length > 0;
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
    // 全体で消すと、どのステップも鳴らさない(タイムラインの映像の段の切り替え)。
    // 全体で消していなければステップの設定に従う。早送りステップは、ステップで鳴らすと決めたときだけ鳴らす(U-09)
    sourceEnabled: p.audio?.source?.enabled !== false && stepSourceEnabled(step),
    sourceVolume: step.audio?.source?.volume ?? p.audio?.source?.volume ?? 1,
    speechVolume: step.audio?.speech?.volume ?? p.audio?.speech?.volume ?? 1,
    keepPitch: step.audio?.source?.keepPitch ?? p.audio?.source?.keepPitch ?? true,
  };
}

/** ステップの録画の音を鳴らすか(全体の切り替えは見ない) */
export function stepSourceEnabled(step: Step): boolean {
  return step.audio?.source?.enabled ?? stepSpeed(step) <= 1;
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
  if (z.transition !== undefined) return z.transition;
  // 動きの間だけ止めるズームは、止める長さ(stepHolds)を録画の大きさによらず決めるため固定の秒数にする
  if (z.hold === "transition") return HOLD_TRANSITION;
  return 0.6 + 0.55 * Math.log(Math.max(1, scale));
}

/** 動きの間だけ止めるズームで transition を書いていないときの動きの秒数 */
export const HOLD_TRANSITION = 0.8;

/** ズーム中に映像を止める範囲。zoom: ズームしている間ずっと(既定)、transition: 拡大・縮小の動きの間だけ、none: 止めない */
export type ZoomHoldMode = "zoom" | "transition" | "none";

export function zoomHoldMode(z: Zoom): ZoomHoldMode {
  const h = z.hold ?? true;
  return h === "transition" ? "transition" : h ? "zoom" : "none";
}
