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
 * 読み上げはそれぞれの開始時刻(speechTimes)から鳴らす。フェードイン・フェードアウトは全体に掛ける。
 * from〜to(ステップ内の出力時刻)を渡すと、その間だけを作る(プレビューは途中から、少しずつ作って鳴らす)
 */
export async function renderStepAudio(
  project: Project,
  step: Step,
  duration: number,
  media: SourceMedia | null,
  speech: readonly { buffer: AudioBuffer; start: number }[],
  from = 0,
  to = duration,
): Promise<AudioBuffer> {
  const span = Math.max(0, Math.min(to, duration) - from);
  const length = Math.max(1, Math.round(span * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const vol = resolveAudio(project, step);
  const speed = stepSpeed(step);

  const master = ctx.createGain();
  master.connect(ctx.destination);
  if ((step.fadeIn || step.fadeOut) && span > 0) {
    // 映像のフェード(fadeLevel)と同じ形を、細かく区切った曲線で掛ける
    const n = Math.max(2, Math.ceil(span * 100));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = fadeLevel(step, from + (i / (n - 1)) * span, duration);
    master.gain.setValueCurveAtTime(curve, 0, span);
  }

  if (vol.sourceEnabled && media?.audio) {
    const gain = ctx.createGain();
    gain.gain.value = vol.sourceVolume;
    gain.connect(master);
    for (const seg of sourceSegments(step)) {
      if (seg.outEnd <= from || seg.outStart >= from + span) continue;
      // from より前と to より後は切り落とす(元の音声の区間も同じだけ詰める)
      const cut = Math.max(0, from - seg.outStart);
      const srcEnd = Math.min(seg.srcEnd, seg.srcStart + (from + span - seg.outStart) * speed);
      const clip = await readSource(media, seg.srcStart + cut * speed, srcEnd);
      if (!clip) continue;
      const node = ctx.createBufferSource();
      if (speed === 1) {
        node.buffer = clip;
      } else if (vol.keepPitch) {
        const chans = timeStretch([clip.getChannelData(0), clip.getChannelData(1)], speed);
        const out = new AudioBuffer({
          numberOfChannels: 2,
          length: Math.max(1, chans[0]?.length ?? 1),
          sampleRate: clip.sampleRate,
        });
        chans.forEach((c, i) => {
          out.copyToChannel(c as Float32Array<ArrayBuffer>, i);
        });
        node.buffer = out;
      } else {
        node.buffer = clip;
        node.playbackRate.value = speed;
      }
      node.connect(gain);
      node.start(seg.outStart + cut - from);
    }
  }

  if (speech.length > 0) {
    const gain = ctx.createGain();
    gain.gain.value = vol.speechVolume;
    gain.connect(master);
    for (const s of speech) {
      const offset = Math.max(0, from - s.start);
      if (offset >= s.buffer.duration || s.start >= from + span) continue;
      const node = ctx.createBufferSource();
      node.buffer = s.buffer;
      node.connect(gain);
      node.start(Math.max(0, s.start - from), offset);
    }
  }
  return ctx.startRendering();
}

/**
 * ソースの srcStart〜srcEnd の音声を 1 本の AudioBuffer(録画の標本化周波数、2 チャンネル)につなげて返す。
 * デコードした細かい断片をそれぞれ AudioBufferSourceNode で置くと、OfflineAudioContext の合成が
 * 「断片の数 × 長さ」に比例して遅くなる(60 秒・約 2600 個で 15 秒以上)ため、先に 1 本にまとめる
 */
async function readSource(media: SourceMedia, srcStart: number, srcEnd: number): Promise<AudioBuffer | null> {
  if (!media.audio || srcEnd <= srcStart) return null;
  let out: AudioBuffer | null = null;
  for await (const { buffer, timestamp } of media.audio.buffers(srcStart, srcEnd)) {
    const rate = buffer.sampleRate;
    out ??= new AudioBuffer({
      numberOfChannels: 2,
      length: Math.max(1, Math.round((srcEnd - srcStart) * rate)),
      sampleRate: rate,
    });
    // 断片の中で srcStart〜srcEnd に入る所だけを、出力の該当位置へ写す
    const skip = Math.max(0, Math.round((srcStart - timestamp) * rate));
    const at = Math.max(0, Math.round((timestamp - srcStart) * rate));
    const len = Math.min(buffer.length - skip, out.length - at);
    if (len <= 0) continue;
    for (let c = 0; c < 2; c++) {
      const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
      out.copyToChannel(src.subarray(skip, skip + len), c, at);
    }
  }
  return out;
}
