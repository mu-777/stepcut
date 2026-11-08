// ステップ 1 つ分の音声を合成する(元の音声 + 読み上げ)。プレビューと書き出しで同じ処理を使う。
import { resolveAudio, stepSpeed } from "../../core/defaults";
import type { Project, Step } from "../../core/schema";
import { timeStretch } from "../../core/stretch";
import { fadeLevel, sourceSegments } from "../../core/timeline";
import type { SourceMedia } from "./media";
import { SAMPLE_RATE } from "./speech";

/**
 * 元の音声は保持の間は止める。早送りステップでは、鳴らすと決めたときだけ鳴らす(既定は鳴らさない。U-09)。
 * そのとき音の高さを保つなら長さだけを縮め(timeStretch)、保たないなら速く再生する(高くなる)。
 * 読み上げはそれぞれの開始時刻(speechTimes)から鳴らす。フェードイン・フェードアウトは全体に掛ける
 */
export async function renderStepAudio(
  project: Project,
  step: Step,
  duration: number,
  media: SourceMedia | null,
  speech: readonly { buffer: AudioBuffer; start: number }[],
): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round(duration * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const vol = resolveAudio(project, step);
  const speed = stepSpeed(step);

  const master = ctx.createGain();
  master.connect(ctx.destination);
  if (step.fadeIn || step.fadeOut) {
    // 映像のフェード(fadeLevel)と同じ形を、細かく区切った曲線で掛ける
    const n = Math.max(2, Math.ceil(duration * 100));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = fadeLevel(step, (i / (n - 1)) * duration, duration);
    master.gain.setValueCurveAtTime(curve, 0, duration);
  }

  if (vol.sourceEnabled && media?.audio) {
    const gain = ctx.createGain();
    gain.gain.value = vol.sourceVolume;
    gain.connect(master);
    for (const seg of sourceSegments(step)) {
      if (speed === 1) {
        await placeSource(ctx, gain, media, seg.srcStart, seg.srcEnd, seg.outStart);
        continue;
      }
      // 早送り: ソースの区間をいったん等速で取り出してから縮める
      const srcLen = Math.max(1, Math.round((seg.srcEnd - seg.srcStart) * SAMPLE_RATE));
      const clipCtx = new OfflineAudioContext(2, srcLen, SAMPLE_RATE);
      await placeSource(clipCtx, clipCtx.destination, media, seg.srcStart, seg.srcEnd, 0);
      const clip = await clipCtx.startRendering();
      const node = ctx.createBufferSource();
      if (vol.keepPitch) {
        const chans = timeStretch([clip.getChannelData(0), clip.getChannelData(1)], speed);
        const out = ctx.createBuffer(2, Math.max(1, chans[0]?.length ?? 1), SAMPLE_RATE);
        chans.forEach((c, i) => {
          out.copyToChannel(c as Float32Array<ArrayBuffer>, i);
        });
        node.buffer = out;
      } else {
        node.buffer = clip;
        node.playbackRate.value = speed;
      }
      node.connect(gain);
      node.start(seg.outStart);
    }
  }

  if (speech.length > 0) {
    const gain = ctx.createGain();
    gain.gain.value = vol.speechVolume;
    gain.connect(master);
    for (const s of speech) {
      const node = ctx.createBufferSource();
      node.buffer = s.buffer;
      node.connect(gain);
      node.start(s.start);
    }
  }
  return ctx.startRendering();
}

/** ソースの srcStart〜srcEnd の音声を、ctx の at 秒から等速で置く */
async function placeSource(
  ctx: BaseAudioContext,
  dest: AudioNode,
  media: SourceMedia,
  srcStart: number,
  srcEnd: number,
  at: number,
): Promise<void> {
  if (!media.audio) return;
  for await (const { buffer, timestamp } of media.audio.buffers(srcStart, srcEnd)) {
    const offset = Math.max(0, srcStart - timestamp);
    const begin = Math.max(timestamp, srcStart);
    const len = Math.min(buffer.duration - offset, srcEnd - begin);
    if (len <= 0) continue;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(dest);
    node.start(at + (begin - srcStart), offset, len);
  }
}
