// ステップ 1 つ分の音声を合成する(元の音声 + 読み上げ)。プレビューと書き出しで同じ処理を使う。
import { resolveAudio, stepSpeed } from "../../core/defaults";
import type { Project, Step } from "../../core/schema";
import { sourceSegments } from "../../core/timeline";
import type { SourceMedia } from "./media";
import { SAMPLE_RATE } from "./speech";

/**
 * 元の音声は保持の間は止め、早送りステップでは鳴らさない(速度を変えた音は聞き取れないため)。
 * 読み上げはそれぞれの開始時刻(speechTimes)から鳴らす。
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

  if (vol.sourceEnabled && stepSpeed(step) === 1 && media?.audio) {
    const gain = ctx.createGain();
    gain.gain.value = vol.sourceVolume;
    gain.connect(ctx.destination);
    for (const seg of sourceSegments(step)) {
      for await (const { buffer, timestamp } of media.audio.buffers(seg.srcStart, seg.srcEnd)) {
        const offset = Math.max(0, seg.srcStart - timestamp);
        const begin = Math.max(timestamp, seg.srcStart);
        const len = Math.min(buffer.duration - offset, seg.srcEnd - begin);
        if (len <= 0) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(gain);
        node.start(seg.outStart + (begin - seg.srcStart), offset, len);
      }
    }
  }

  if (speech.length > 0) {
    const gain = ctx.createGain();
    gain.gain.value = vol.speechVolume;
    gain.connect(ctx.destination);
    for (const s of speech) {
      const node = ctx.createBufferSource();
      node.buffer = s.buffer;
      node.connect(gain);
      node.start(s.start);
    }
  }
  return ctx.startRendering();
}
