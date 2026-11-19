// CLI の frame・inspect(AI-03 と、計算後の時間の一覧)。非表示のウィンドウで動く。
// AI が座標と時刻を決めるための情報を返す。映像側の座標はソースのピクセルなので、--source で取った画像の座標をそのまま書ける。
import { captionWindow } from "../../core/captions";
import {
  isImageSource,
  resolveLayout,
  resolveOutput,
  speechPieces,
  speechStartOffset,
  speechText,
  stepSpeed,
} from "../../core/defaults";
import { objectImages, objectOf, objectWindow, stepObjects } from "../../core/objects";
import type { Project, Step } from "../../core/schema";
import {
  baseDuration,
  buildTimeline,
  locate,
  sourceTimeAt,
  speechTimes,
  stepHolds,
  type TimelineEntry,
  totalDuration,
} from "../../core/timeline";
import type { CliJobResult, FrameRequest } from "../../shared/api";
import { msg } from "../../shared/messages";
import { api } from "./api";
import { BackgroundStore } from "./backgrounds";
import { drawFrame, frameGeometry } from "./compositor";
import { errorText, msgText } from "./i18n";
import { ImageStore } from "./images";
import { openExclusive, type SourceMedia } from "./media";
import { SpeechStore } from "./speech";

type Img = CanvasImageSource & { width: number; height: number };
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rect = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r3(r.x),
  y: r3(r.y),
  w: r3(r.w),
  h: r3(r.h),
});

/** 読み上げを用意して並びを作る。読み上げに失敗しても止めず、警告にする(長さは 0 で数える) */
async function prepare(
  project: Project,
): Promise<{ speech: SpeechStore; timeline: TimelineEntry[]; warnings: string[] }> {
  const speech = new SpeechStore();
  const errors = await speech.loadAll(project);
  const warnings = [
    ...errors.map((e) => msgText(msg("speechFailedZero", { detail: e }))),
    ...speech.noticeTexts(),
  ];
  return {
    speech,
    timeline: buildTimeline(project.steps, speech.durations(project), speechStartOffset(project)),
    warnings,
  };
}

/** 素材を専用に開く。開いたものは opened にも入れる(呼び側が finally で閉じる) */
async function openSources(project: Project, projectPath: string, warnings: string[], opened: SourceMedia[]) {
  const media = new Map<string, SourceMedia>();
  for (const s of project.sources) {
    try {
      const m = await openExclusive(await api.resolveSource(projectPath, s.path));
      opened.push(m);
      media.set(s.id, m);
    } catch (e) {
      warnings.push(`${s.id}: ${errorText(e)}`);
    }
  }
  return media;
}

/** ステップの指定(1 始まりの番号か id)を探す */
function findEntry(timeline: TimelineEntry[], key: string): TimelineEntry | null {
  const byId = timeline.find((e) => e.step.id === key);
  if (byId) return byId;
  const n = Number(key);
  return Number.isInteger(n) ? (timeline[n - 1] ?? null) : null;
}

async function writePng(canvas: OffscreenCanvas, outPath: string): Promise<void> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  const handle = await api.openOutput(outPath);
  try {
    await api.writeOutput(handle, 0, new Uint8Array(await blob.arrayBuffer()));
  } catch (e) {
    await api.closeOutput(handle, false).catch(() => {});
    throw e;
  }
  await api.closeOutput(handle, true);
}

export async function runFrame(
  project: Project,
  projectPath: string,
  outPath: string,
  req: FrameRequest,
): Promise<CliJobResult> {
  const opened: SourceMedia[] = [];
  try {
    return await frameJob(project, projectPath, outPath, req, opened);
  } finally {
    for (const m of opened) m.dispose();
  }
}

async function frameJob(
  project: Project,
  projectPath: string,
  outPath: string,
  req: FrameRequest,
  opened: SourceMedia[],
): Promise<CliJobResult> {
  const { timeline, warnings } = await prepare(project);
  if (timeline.length === 0) return { ok: false, warnings, error: msgText(msg("noSteps")) };
  let entry: TimelineEntry | null;
  let local: number;
  if (req.at !== undefined) {
    const l = locate(timeline, req.at);
    entry = l?.entry ?? null;
    local = l?.local ?? 0;
  } else {
    entry = findEntry(timeline, req.step ?? "1");
    local = req.time ?? 0;
  }
  if (!entry) return { ok: false, warnings, error: msgText(msg("stepNotFound", { step: String(req.step) })) };
  // ステップの長さを超える時刻は末尾に丸め、丸めたことを知らせる(黙って別のフレームを返さない)
  if (req.at === undefined && local > entry.duration + 1e-6)
    warnings.push(msgText(msg("timePastEnd", { time: local, duration: r3(entry.duration) })));
  // 終わりちょうどは最後のフレーム
  local = Math.min(Math.max(0, local), Math.max(0, entry.duration - 1e-3));
  const step = entry.step;
  const media = await openSources(project, projectPath, warnings, opened);
  const m = media.get(step.source) ?? null;
  const srcT = sourceTimeAt(step, local);
  const wc = m ? await m.video.getCanvas(srcT) : null;
  const frame = (wc?.canvas as Img | undefined) ?? null;
  const out = resolveOutput(project);
  const base = {
    ok: true,
    warnings,
    outPath,
    step: entry.index + 1,
    stepId: step.id,
    time: r3(local),
    at: r3(entry.start + local),
    sourceTime: r3(srcT),
    sourceSize: m ? { w: m.width, h: m.height } : null,
  };

  if (req.source) {
    // 素材のフレームをそのままの大きさで(この画像のピクセル = 映像側の座標)
    if (!m || !frame)
      return { ok: false, warnings, error: msgText(msg("cannotReadSource", { id: step.source })) };
    const canvas = new OffscreenCanvas(m.width, m.height);
    (canvas.getContext("2d") as OffscreenCanvasRenderingContext2D).drawImage(frame, 0, 0, m.width, m.height);
    await writePng(canvas, outPath);
    return { ...base, kind: "source", imageSize: { w: m.width, h: m.height } };
  }

  // 書き出しと同じ見た目(背景・ズーム・テロップ・オブジェクト)
  const bg = resolveLayout(project).background;
  let backgroundImage: Img | null = null;
  if (typeof bg !== "string" && "image" in bg) {
    backgroundImage = await new BackgroundStore().load(bg.image, out.width, out.height, projectPath);
    if (!backgroundImage) warnings.push(msgText(msg("cannotLoadBackground", { path: bg.image })));
  }
  const images = new ImageStore();
  for (const p of objectImages(project)) await images.load(p, projectPath);
  const canvas = new OffscreenCanvas(out.width, out.height);
  const srcW = m?.width ?? 1920;
  const srcH = m?.height ?? 1080;
  drawFrame(canvas.getContext("2d") as OffscreenCanvasRenderingContext2D, {
    project,
    step,
    local,
    stepDuration: entry.duration,
    carry: entry.carry,
    frame,
    srcW: m?.width ?? 0,
    srcH: m?.height ?? 0,
    outW: out.width,
    outH: out.height,
    backgroundImage,
    images: (p) => images.get(p, projectPath),
  });
  await writePng(canvas, outPath);
  const g = frameGeometry(project, step, local, out.width, out.height, srcW, srcH, false, entry.carry);
  return {
    ...base,
    kind: "output",
    imageSize: { w: out.width, h: out.height },
    // 画像の点 (px, py) → 映像側の座標: x = view.x + (px - box.x) / scale(y も同じ)
    geometry: { videoBox: rect(g.video), box: rect(g.box), view: rect(g.view), scale: r3(g.k) },
  };
}

function stepInfo(
  project: Project,
  entry: TimelineEntry,
  speechDurations: readonly number[],
  m?: SourceMedia,
) {
  const step: Step = entry.step;
  const base = baseDuration(step);
  const times = speechTimes(step, speechDurations, speechStartOffset(project));
  const path = project.sources.find((s) => s.id === step.source)?.path ?? "";
  return {
    step: entry.index + 1,
    id: step.id,
    source: step.source,
    sourceKind: isImageSource(path) ? "image" : "video",
    sourceSize: m ? { w: m.width, h: m.height } : null,
    in: step.in,
    out: step.out,
    speed: stepSpeed(step),
    start: r3(entry.start),
    end: r3(entry.start + entry.duration),
    duration: r3(entry.duration),
    /** 保持を含む映像の長さ。duration との差は読み上げを待つ自動の保持 */
    videoDuration: r3(base),
    autoHold: r3(Math.max(0, entry.duration - base)),
    holds: stepHolds(step).map((h) => ({ at: r3(h.at), duration: r3(h.duration) })),
    caption: (() => {
      const w = captionWindow(step, entry.duration);
      return w && step.caption ? { text: step.caption.text, start: r3(w.start), end: r3(w.end) } : null;
    })(),
    speech: speechPieces(step).map((_, k) => ({
      text: speechText(step, k) ?? "",
      start: r3(times[k]?.start ?? 0),
      end: r3(times[k]?.end ?? 0),
      duration: r3(speechDurations[k] ?? 0),
    })),
    zooms: (step.zooms ?? []).map((z, k) => ({ index: k, start: z.start, end: z.end })),
    objects: stepObjects(step).map((ref) => {
      const o = objectOf(step, ref);
      const w = o ? objectWindow(o, entry.duration) : { start: 0, end: 0 };
      const type = ref.kind === "pointer" ? "pointer" : (o as { type?: string } | undefined)?.type;
      return { kind: ref.kind, index: ref.index, type, start: r3(w.start), end: r3(w.end) };
    }),
  };
}

export async function runInspect(project: Project, projectPath: string): Promise<CliJobResult> {
  const { speech, timeline, warnings } = await prepare(project);
  const opened: SourceMedia[] = [];
  const media = await openSources(project, projectPath, warnings, opened);
  const out = resolveOutput(project);
  const durations = speech.durations(project);
  const result: CliJobResult = {
    ok: true,
    warnings,
    output: { width: out.width, height: out.height, fps: out.fps },
    duration: r3(totalDuration(timeline)),
    steps: timeline.map((e) =>
      stepInfo(project, e, durations.get(e.step.id) ?? [], media.get(e.step.source)),
    ),
  };
  for (const m of opened) m.dispose();
  return result;
}
