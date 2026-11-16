// 素材(録画・画像)の読み込み。ファイルの中身はメインプロセスから範囲指定で受け取る。
import { ALL_FORMATS, AudioBufferSink, CanvasSink, CustomSource, Input } from "mediabunny";
import { isImageSource } from "../../core/defaults";
import { AppError } from "../../shared/messages";
import { api } from "./api";

type FrameCanvas = HTMLCanvasElement | OffscreenCanvas;

/** 時刻を指定してフレームを読む口。録画は mediabunny の CanvasSink、画像はどの時刻でも同じ 1 枚を返す */
export interface FrameSink {
  getCanvas(t: number): Promise<{ canvas: FrameCanvas } | null>;
  canvasesAtTimestamps(
    ts: Iterable<number> | AsyncIterable<number>,
  ): AsyncGenerator<{ canvas: FrameCanvas } | null>;
}

export interface SourceMedia {
  path: string;
  kind: "video" | "image";
  width: number;
  height: number;
  /** 素材の長さ(秒)。画像は無限(ステップの長さは自由に決める) */
  duration: number;
  video: FrameSink;
  /** 再生中の先読み用(切った箇所の次の区間を、前の区間と並行してデコードする) */
  prefetch: FrameSink;
  audio: AudioBufferSink | null;
  /** サムネイル用に幅 width の縮小フレームを読む口を作る(プレビューとは別のデコーダー) */
  thumbSink: (width: number) => Promise<FrameSink | null>;
  /** 使い終わった素材の資源を手放す(録画は Input を閉じ、画像は ImageBitmap を閉じる)。2 回呼んでもよい。以後は読めない */
  dispose(): void;
}

const cache = new Map<string, Promise<SourceMedia>>();

async function readAll(absPath: string): Promise<Uint8Array> {
  const size = await api.fileSize(absPath);
  return api.readRange(absPath, 0, size);
}

/** 同じキャンバスを何度でも返す読み口 */
function stillSink(canvas: FrameCanvas): FrameSink {
  return {
    getCanvas: async () => ({ canvas }),
    async *canvasesAtTimestamps(ts) {
      for await (const _ of ts) yield { canvas };
    },
  };
}

function drawScaled(img: ImageBitmap, width: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round((img.height * c.width) / img.width));
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function loadImage(absPath: string): Promise<SourceMedia> {
  let img: ImageBitmap;
  try {
    img = await createImageBitmap(new Blob([(await readAll(absPath)) as BlobPart]));
  } catch {
    throw new AppError("cannotReadImage", { path: absPath });
  }
  const sink = stillSink(drawScaled(img, img.width));
  return {
    path: absPath,
    kind: "image",
    width: img.width,
    height: img.height,
    duration: Number.POSITIVE_INFINITY,
    video: sink,
    prefetch: sink,
    audio: null,
    thumbSink: async (width) => stillSink(drawScaled(img, width)),
    dispose: () => img.close(),
  };
}

async function loadVideo(absPath: string): Promise<SourceMedia> {
  const size = await api.fileSize(absPath);
  const input = new Input({
    formats: ALL_FORMATS,
    source: new CustomSource({
      getSize: () => size,
      read: (start, end) => api.readRange(absPath, start, end),
      prefetchProfile: "fileSystem",
      maxCacheSize: 32 * 1024 * 1024,
    }),
  });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new AppError("noVideoTrack", { path: absPath });
  if (!(await videoTrack.canDecode())) throw new AppError("cannotDecode", { path: absPath });
  const audioTrack = await input.getPrimaryAudioTrack();
  const canAudio = audioTrack ? await audioTrack.canDecode() : false;
  return {
    path: absPath,
    kind: "video",
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    duration: await input.computeDuration(),
    video: new CanvasSink(videoTrack, { poolSize: 4 }),
    prefetch: new CanvasSink(videoTrack, { poolSize: 4 }),
    audio: audioTrack && canAudio ? new AudioBufferSink(audioTrack) : null,
    thumbSink: async (width) => new CanvasSink(videoTrack, { width }),
    // 読み込み中の読み取り・デコーダーも止まる(止まった読み取りは InputDisposedError で落ちるが、呼び側が握りつぶす)
    dispose: () => {
      if (!input.disposed) input.dispose();
    },
  };
}

function load(absPath: string): Promise<SourceMedia> {
  return isImageSource(absPath) ? loadImage(absPath) : loadVideo(absPath);
}

export function openMedia(absPath: string): Promise<SourceMedia> {
  let p = cache.get(absPath);
  if (!p) {
    p = load(absPath);
    p.catch(() => cache.delete(absPath));
    cache.set(absPath, p);
  }
  return p;
}

/**
 * keep に含まれない素材を閉じてキャッシュから外す。読み込み中のものは読み終えてから閉じる。
 * 閉じた数を返す
 */
export function releaseMedia(keep: Iterable<string>): number {
  const keepSet = new Set(keep);
  let n = 0;
  for (const [path, p] of [...cache]) {
    if (keepSet.has(path)) continue;
    cache.delete(path);
    p.then(
      (m) => m.dispose(),
      () => {},
    );
    n++;
  }
  return n;
}

/** 映像を別の CanvasSink で読む(書き出し中にプレビューと取り合わないため) */
export const openExclusive = load;
