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
import { resolveLayout, resolveOutput, speechStartOffset } from "../../core/defaults";
import { objectImages } from "../../core/objects";
import type { Project } from "../../core/schema";
import { toSrt } from "../../core/text";
import { audioChunkRanges, buildTimeline, sourceTimeAt, totalDuration } from "../../core/timeline";
import type { ExportResult } from "../../shared/api";
import { AppError, msg } from "../../shared/messages";
import { api } from "./api";
import { renderStepAudio } from "./audio";
import { BackgroundStore } from "./backgrounds";
import { drawFrame } from "./compositor";
import { msgText } from "./i18n";
import { ImageStore } from "./images";
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
  const { project } = opts;
  const warnings: string[] = [];
  const out = resolveOutput(project);
  const speech = opts.speech ?? new SpeechStore();

  const speechErrors = await speech.loadAll(project);
  if (speechErrors.length) throw new Error(msgText(msg("speechFailed", { detail: speechErrors.join("; ") })));
  warnings.push(...speech.noticeTexts());

  const media = new Map<string, SourceMedia>();
  try {
    return await exportWith(opts, media, warnings, out, speech);
  } finally {
    // 書き出し専用に開いた素材は、成功・失敗のどちらでも閉じる
    for (const m of media.values()) m.dispose();
  }
}

async function exportWith(
  opts: ExportOptions,
  media: Map<string, SourceMedia>,
  warnings: string[],
  out: ReturnType<typeof resolveOutput>,
  speech: SpeechStore,
): Promise<ExportResult> {
  const { project, outPath } = opts;
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
        `${msgText(msg("cannotLoadBackground", { path: bg.image }))} (${store.error(bg.image, opts.projectPath)})`,
      );
  }

  // 図形・ポインターの画像も先に読む。読めなければ書き出しを止める
  const images = new ImageStore();
  for (const path of objectImages(project)) {
    if (!(await images.load(path, opts.projectPath)))
      throw new Error(
        `${msgText(msg("cannotLoadImage", { path }))} (${images.error(path, opts.projectPath)})`,
      );
  }

  const timeline = buildTimeline(project.steps, speech.durations(project), speechStartOffset(project));
  const total = totalDuration(timeline);
  if (total <= 0) throw new AppError("nothingToExport");

  const quality = QUALITY[out.quality];
  const videoBase = { width: out.width, height: out.height, frameRate: out.fps, quality };
  let hardwareAcceleration: "prefer-hardware" | "no-preference" = "prefer-hardware";
  if (!(await canEncodeVideo("avc", { ...videoBase, hardwareAcceleration }))) {
    hardwareAcceleration = "no-preference";
    if (!(await canEncodeVideo("avc", { ...videoBase, hardwareAcceleration }))) {
      throw new AppError("h264Unavailable", { width: out.width, height: out.height });
    }
    warnings.push(msgText(msg("encodedInSoftware")));
  }
  const audioOpts = { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: QUALITY_HIGH };
  const audioCodec = (await canEncodeAudio("aac", audioOpts))
    ? "aac"
    : (await canEncodeAudio("opus", audioOpts))
      ? "opus"
      : null;
  if (audioCodec === "opus") warnings.push(msgText(msg("audioOpus")));
  if (!audioCodec) warnings.push(msgText(msg("noAudioEncoder")));

  const totalFrames = Math.round(total * out.fps);
  // 一時ファイルに書き、最後まで書けたときだけ書き出し先に置き換える(失敗・中止で前のファイルを壊さない)
  const handle = await api.openOutput(outPath);
  let committed = false;
  try {
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
    const audioSource = audioCodec
      ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH })
      : null;
    if (audioSource) output.addAudioTrack(audioSource);

    let frame = 0;
    try {
      await output.start();
      for (const entry of timeline) {
        const m = media.get(entry.step.source) ?? null;
        if (audioSource) {
          const placed = speech.placed(project, entry.step);
          const ranges = audioChunkRanges(entry.duration);
          if (ranges.length === 1) {
            await audioSource.add(await renderStepAudio(project, entry.step, entry.duration, m, placed));
          } else {
            // 長いステップは 60 秒ずつ作って足す(ステップ全体の音声を一度にメモリへ持たない)
            for (const [from, to] of ranges)
              await audioSource.add(
                await renderStepAudio(project, entry.step, entry.duration, m, placed, from, to),
              );
          }
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
            carry: entry.carry,
            frame: img as (CanvasImageSource & { width: number; height: number }) | null,
            srcW: m?.width ?? 0,
            srcH: m?.height ?? 0,
            outW: out.width,
            outH: out.height,
            backgroundImage,
            images: (p) => images.get(p, opts.projectPath),
          });
          await videoSource.add(k / out.fps, 1 / out.fps);
          opts.onProgress?.(k + 1, totalFrames);
          if (opts.signal?.aborted) throw new AppError("canceled");
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
      // 後始末の失敗で元のエラーを隠さない
      await output.cancel().catch(() => {});
      throw e;
    }
    committed = true;
    await api.closeOutput(handle, true);
  } catch (e) {
    if (!committed) await api.closeOutput(handle, false).catch(() => {});
    throw e;
  }

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
