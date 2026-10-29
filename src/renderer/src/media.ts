// 録画ファイルの読み込み。ファイルの中身はメインプロセスから範囲指定で受け取る。
import { ALL_FORMATS, AudioBufferSink, CanvasSink, CustomSource, Input } from "mediabunny";
import { api } from "./api";

export interface SourceMedia {
  path: string;
  width: number;
  height: number;
  duration: number;
  video: CanvasSink;
  audio: AudioBufferSink | null;
  input: Input;
}

const cache = new Map<string, Promise<SourceMedia>>();

async function load(absPath: string): Promise<SourceMedia> {
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
  if (!videoTrack) throw new Error(`映像がありません / No video track: ${absPath}`);
  if (!(await videoTrack.canDecode()))
    throw new Error(`この映像は再生できません / Cannot decode: ${absPath}`);
  const audioTrack = await input.getPrimaryAudioTrack();
  const canAudio = audioTrack ? await audioTrack.canDecode() : false;
  return {
    path: absPath,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    duration: await input.computeDuration(),
    video: new CanvasSink(videoTrack, { poolSize: 4 }),
    audio: audioTrack && canAudio ? new AudioBufferSink(audioTrack) : null,
    input,
  };
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

/** 映像を別の CanvasSink で読む(書き出し中にプレビューと取り合わないため) */
export const openExclusive = load;
