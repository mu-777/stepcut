import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import { speechPieces, speechText, withSpeechPieces } from "../../core/defaults";
import { retimeZoom } from "../../core/layout";
import { objectOf } from "../../core/objects";
import type { Project, Zoom, ZoomKey } from "../../core/schema";
import { baseDuration, locate, speechTimes, type TimelineEntry } from "../../core/timeline";
import type { SourceMedia } from "./media";
import { pasteObject } from "./objects-ui";
import type { Player } from "./player";
import type { Clip, ClipItem, Selection } from "./timeline";

type Args = {
  project: Project;
  media: Map<string, SourceMedia>;
  timeline: TimelineEntry[];
  speechDurations: Map<string, number[]>;
  update: (fn: (p: Project) => Project, key?: string) => void;
  selection: Selection;
  setSelection: Dispatch<SetStateAction<Selection>>;
  /** 要素を消す(切り取りで使う) */
  removeItem: (s: Selection) => void;
  playerRef: RefObject<Player | null>;
  time: number;
  /** 文字を入力中か(入力中は Ctrl+C / X / V をそのまま入力欄に回す) */
  isTyping: () => boolean;
};

/**
 * ズーム・読み上げ・オブジェクトのコピー・切り取り・貼り付け。メニューの copy / cut / paste イベントを受ける。
 * コピーしたものはアプリ内だけで持つ
 */
export function useClipboard({
  project,
  media,
  timeline,
  speechDurations,
  update,
  selection,
  setSelection,
  removeItem,
  playerRef,
  time,
  isTyping,
}: Args) {
  /**
   * コピー・切り取りしたもの(アプリ内だけで持つ。最後の 1 つ)。ズーム・オブジェクトは録画の大きさが違うステップへ
   * 貼るときに座標を換算する
   */
  const clipboard = useRef<Clip | null>(null);
  const [clipKind, setClipKind] = useState<Clip["kind"] | null>(null);

  /** ズーム・読み上げ・オブジェクトをコピーする */
  const copyItem = (item: ClipItem) => {
    const st = project.steps[item.step];
    if (!st) return;
    const m = media.get(st.source);
    const srcW = m?.width ?? 1920;
    const srcH = m?.height ?? 1080;
    let clip: Clip | null = null;
    if (item.kind === "zoom") {
      const z = st.zooms?.[item.index];
      if (z) clip = { kind: "zoom", zoom: structuredClone(z), srcW, srcH };
    } else if (item.kind === "speech") {
      const piece = speechPieces(st)[item.index];
      // テロップの文を読む読み上げは、今の文を書いた読み上げとして写す(貼った先のテロップの文に変わらないように)
      if (piece)
        clip = {
          kind: "speech",
          piece: { ...structuredClone(piece), text: speechText(st, item.index) ?? "" },
        };
    } else {
      const o = objectOf(st, { kind: item.kind, index: item.index });
      if (o) clip = { kind: "object", objKind: item.kind, object: structuredClone(o), srcW, srcH };
    }
    if (!clip) return;
    clipboard.current = clip;
    setClipKind(clip.kind);
  };

  /** 切り取り: コピーして消す */
  const cutItem = (item: ClipItem) => {
    copyItem(item);
    removeItem(item);
  };

  /** コピーしたもの(kind を渡したらその種類のときだけ)を全体の時刻 at に貼る */
  const pasteAt = (at: number, kind?: Clip["kind"]) => {
    const clip = clipboard.current;
    if (!clip || (kind && clip.kind !== kind)) return;
    if (clip.kind === "zoom") pasteZoom(clip, at);
    else if (clip.kind === "speech") pasteSpeech(clip, at);
    else pasteObjectAt(clip, at);
  };

  /** コピーしたオブジェクトを、全体の時刻 at を始まりにして貼る */
  const pasteObjectAt = (clip: Extract<Clip, { kind: "object" }>, at: number) => {
    const l = locate(timeline, at);
    if (!l) return;
    const m = media.get(l.entry.step.source);
    const local = Math.min(l.local, Math.max(0, l.entry.duration - 0.1));
    const r = pasteObject(
      project,
      l.entry.index,
      clip.objKind,
      clip.object,
      local,
      l.entry.duration,
      (m?.width ?? 1920) / clip.srcW,
      (m?.height ?? 1080) / clip.srcH,
    );
    update(() => r.project, "object-paste");
    setSelection({ kind: r.ref.kind, step: l.entry.index, index: r.ref.index });
  };

  /** コピーした読み上げを、全体の時刻 at から読むように貼る(読む順は始まりの時刻の順) */
  const pasteSpeech = (clip: Extract<Clip, { kind: "speech" }>, at: number) => {
    const l = locate(timeline, at);
    if (!l) return;
    const st = l.entry.step;
    const local = Math.round(Math.min(l.local, baseDuration(st)) * 1000) / 1000;
    const pieces = speechPieces(st);
    const times = speechTimes(st, speechDurations.get(st.id) ?? []);
    const k = times.findIndex((x) => x.start > local);
    const index = k < 0 ? pieces.length : k;
    const piece = { ...clip.piece, start: local };
    update(
      (p) => ({
        ...p,
        steps: p.steps.map((x, j) =>
          j === l.entry.index
            ? withSpeechPieces(x, [...pieces.slice(0, index), piece, ...pieces.slice(index)])
            : x,
        ),
      }),
      "speech-paste",
    );
    setSelection({ kind: "speech", step: l.entry.index, index });
  };

  /** コピーしたズームを全体の時刻 at に貼る。録画の大きさが違えば枠を換算し、空いている長さに収める */
  const pasteZoom = (clip: Extract<Clip, { kind: "zoom" }>, at: number) => {
    const l = locate(timeline, at);
    if (!l) return;
    const { entry, local } = l;
    const zooms = entry.step.zooms ?? [];
    if (zooms.some((z) => local >= z.start && local <= z.end)) return;
    const m = media.get(entry.step.source);
    const kx = (m?.width ?? 1920) / clip.srcW;
    const ky = (m?.height ?? 1080) / clip.srcH;
    const conv = (r: ZoomKey["rect"]) => ({
      x: Math.round(r.x * kx),
      y: Math.round(r.y * ky),
      w: Math.round(r.w * kx),
      h: Math.round(r.h * ky),
    });
    const hi = Math.min(entry.duration, ...zooms.filter((z) => z.start > local).map((z) => z.start));
    const end = Math.min(hi, local + (clip.zoom.end - clip.zoom.start));
    if (end - local < 0.1) return;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const moved = retimeZoom(clip.zoom, local, local + (clip.zoom.end - clip.zoom.start));
    const fitted = retimeZoom(moved, r3(local), r3(end));
    const z: Zoom = { ...fitted, keys: fitted.keys.map((k) => ({ ...k, rect: conv(k.rect) })) };
    update(
      (p) => ({
        ...p,
        steps: p.steps.map((s, j) => (j === entry.index ? { ...s, zooms: [...zooms, z] } : s)),
      }),
      "zoom-paste",
    );
    setSelection({ kind: "zoom", step: entry.index, index: zooms.length });
  };

  /** 選んでいる要素のうち、コピー・切り取りできるもの */
  const clipItemOf = (s: Selection): ClipItem | null =>
    s.kind === "zoom" || s.kind === "speech" || s.kind === "pointer" || s.kind === "shape"
      ? { kind: s.kind, step: s.step, index: s.index }
      : null;

  // Ctrl+C / Ctrl+X / Ctrl+V(メニューのコピー・切り取り・貼り付け)。文字の入力中はそのまま。
  // ズーム・読み上げ・オブジェクトを選んでいればコピー(切り取り)し、最後にコピーしたものを再生位置に貼る
  const clipRef = useRef<Record<"copy" | "cut" | "paste", (e: ClipboardEvent) => void>>({
    copy: () => {},
    cut: () => {},
    paste: () => {},
  });
  clipRef.current = {
    copy: (e) => {
      const item = clipItemOf(selection);
      if (isTyping() || !item) return;
      e.preventDefault();
      copyItem(item);
    },
    cut: (e) => {
      const item = clipItemOf(selection);
      if (isTyping() || !item) return;
      e.preventDefault();
      cutItem(item);
    },
    paste: (e) => {
      if (isTyping() || !clipboard.current) return;
      e.preventDefault();
      pasteAt(playerRef.current?.time ?? time);
    },
  };
  useEffect(() => {
    const on = (name: "copy" | "cut" | "paste") => (e: ClipboardEvent) => clipRef.current[name](e);
    const handlers = (["copy", "cut", "paste"] as const).map((n) => [n, on(n)] as const);
    for (const [n, h] of handlers) document.addEventListener(n, h);
    return () => {
      for (const [n, h] of handlers) document.removeEventListener(n, h);
    };
  }, []);

  return { clipKind, copyItem, cutItem, pasteAt };
}
