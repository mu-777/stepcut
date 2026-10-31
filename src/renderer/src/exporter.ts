// mp4 書き出し(OUT)。映像は WebCodecs の H.264、音声は AAC(使えなければ Opus)。
import {
  AudioBufferSource,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  QUALITY_LOW,
  QUALITY_MEDIUM,
  StreamTarget,
} from "mediabunny";
import { captionCues } from "../../core/captions";
import { resolveLayout, resolveOutput } from "../../core/defaults";
import type { Project } from "../../core/schema";
import { toSrt } from "../../core/text";
import { buildTimeline, sourceTimeAt, totalDuration } from "../../core/timeline";
import type { ExportResult } from "../../shared/api";
import { api } from "./api";
import { renderStepAudio } from "./audio";
import { BackgroundStore } from "./backgrounds";
import { drawFrame } from "./compositor";
import { openExclusive, type SourceMedia } from "./media";
import { SAMPLE_RATE, SpeechStore } from "./speech";

const QUALITY = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH };

export interface ExportOptions {
  project: Project;
  projectPath: string | null;
  outPath: string;
  speech?: SpeechStore;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export async function exportProject(opts: ExportOptions): Promise<ExportResult> {
  const { project, outPath } = opts;
  const warnings: string[] = [];
  const out = resolveOutput(project);
  const speech = opts.speech ?? new SpeechStore();

  const speechErrors = await speech.loadAll(project);
  if (speechErrors.length)
    throw new Error(`読み上げを生成できません / Speech failed: ${speechErrors.join("; ")}`);
  warnings.push(...speech.notices);

  const media = new Map<string, SourceMedia>();
  for (const s of project.sources) {
    if (project.steps.some((st) => st.source === s.id)) {
      media.set(s.id, await openExclusive(await api.resolveSource(opts.projectPath, s.path)));
    }
  }

  // 画像の背景は先に用意する。読めなければ書き出しを止める(黙って灰色で書き出さない)
  const bg = resolveLayout(project).background;
  let backgroundImage: (CanvasImageSource & { width: number; height: number }) | null = null;
  if (typeof bg !== "string" && "image" in bg) {
    const store = new BackgroundStore();
    backgroundImage = await store.load(bg.image, out.width, out.height, opts.projectPath);
    if (!backgroundImage)
      throw new Error(
        `背景の画像を読めません / Cannot load background: ${bg.image} (${store.error(bg.image, opts.projectPath)})`,
      );
  }

  const timeline = buildTimeline(project.steps, speech.durations(project));
  const total = totalDuration(timeline);
  if (total <= 0) throw new Error("書き出すステップがありません / Nothing to export");

  const quality = QUALITY[out.quality];
  const videoBase = { width: out.width, height: out.height, frameRate: out.fps, quality };
  let hardwareAcceleration: "prefer-hardware" | "no-preference" = "prefer-hardware";
  if (!(await canEncodeVideo("avc", { ...videoBase, hardwareAcceleration }))) {
    hardwareAcceleration = "no-preference";
    if (!(await canEncodeVideo("avc", { ...videoBase, hardwareAcceleration }))) {
      throw new Error(`H.264 で書き出せません(${out.width}x${out.height}) / H.264 encoding is not available`);
    }
    warnings.push(
      "ハードウェアエンコーダーが使えないため、ソフトウェアで書き出しました / Encoded in software",
    );
  }
  const audioOpts = { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH };
  const audioCodec = (await canEncodeAudio("aac", audioOpts))
    ? "aac"
    : (await canEncodeAudio("opus", audioOpts))
      ? "opus"
      : null;
  if (audioCodec === "opus")
    warnings.push("AAC が使えないため、音声を Opus で書き出しました / Audio encoded as Opus");
  if (!audioCodec)
    warnings.push("音声を書き出せる形式がないため、音声なしで書き出しました / No audio encoder");

  const handle = await api.openOutput(outPath);
  const target = new StreamTarget(
    new WritableStream({ write: (chunk) => api.writeOutput(handle, chunk.position, chunk.data) }),
    { chunked: true, chunkSize: 4 * 1024 * 1024 },
  );
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target });
  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  const videoSource = new CanvasSource(canvas, {
    codec: "avc",
    quality,
    hardwareAcceleration,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: out.fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  const totalFrames = Math.round(total * out.fps);
  let frame = 0;
  try {
    await output.start();
    for (const entry of timeline) {
      const m = media.get(entry.step.source) ?? null;
      const speechAudio = speech.get(project, entry.step);
      if (audioSource) {
        await audioSource.add(
          await renderStepAudio(project, entry.step, entry.duration, m, speechAudio?.buffer ?? null),
        );
      }
      const endFrame = Math.round((entry.start + entry.duration) * out.fps);
      const frames: number[] = [];
      for (let k = frame; k < endFrame; k++) frames.push(k);
      const locals = frames.map((k) => k / out.fps - entry.start);
      const draw = async (k: number, local: number, img: CanvasImageSource | null) => {
        drawFrame(ctx, {
          project,
          step: entry.step,
          local,
          stepDuration: entry.duration,
          frame: img as (CanvasImageSource & { width: number; height: number }) | null,
          srcW: m?.width ?? 0,
          srcH: m?.height ?? 0,
          outW: out.width,
          outH: out.height,
          backgroundImage,
        });
        await videoSource.add(k / out.fps, 1 / out.fps);
        opts.onProgress?.(k + 1, totalFrames);
        if (opts.signal?.aborted) throw new Error("中止しました / Canceled");
      };
      if (m) {
        let i = 0;
        let last: CanvasImageSource | null = null;
        const ts = locals.map((t) => sourceTimeAt(entry.step, t));
        for await (const wc of m.video.canvasesAtTimestamps(ts)) {
          // プールのキャンバスは次の取得で上書きされるので、描いてから次へ進む
          if (wc) last = wc.canvas;
          await draw(frames[i] as number, locals[i] as number, last);
          i++;
        }
      } else {
        for (let i = 0; i < frames.length; i++) await draw(frames[i] as number, locals[i] as number, null);
      }
      frame = endFrame;
    }
    await output.finalize();
  } catch (e) {
    await output.cancel();
    await api.closeOutput(handle);
    throw e;
  }
  await api.closeOutput(handle);

  let srtPath: string | undefined;
  if (out.srt) {
    srtPath = outPath.replace(/\.mp4$/i, "") + ".srt";
    await api.writeText(srtPath, toSrt(captionCues(timeline)));
  }
  return {
    ok: true,
    outPath,
    srtPath,
    duration: total,
    frames: totalFrames,
    videoCodec: `avc (${hardwareAcceleration})`,
    audioCodec,
    warnings,
  };
}
