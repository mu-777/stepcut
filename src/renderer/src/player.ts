// プレビューの再生。描画は書き出しと同じ drawFrame、音声も同じ renderStepAudio を使う(OUT-06)。
// 時計は AudioContext に合わせ、映像は間に合わなければ飛ばす。
import type { Project } from "../../core/schema";
import { locate, sourceTimeAt, type TimelineEntry, totalDuration } from "../../core/timeline";
import { renderStepAudio } from "./audio";
import { drawFrame } from "./compositor";
import type { SourceMedia } from "./media";
import { SAMPLE_RATE, type SpeechStore } from "./speech";

export interface PlayerState {
  project: Project;
  timeline: TimelineEntry[];
  media: Map<string, SourceMedia>;
  speech: SpeechStore;
  /** 録画そのものを表示する(In/Out の指定用)。ステップの番号とソースの時刻 */
  sourceView: { stepIndex: number; time: number } | null;
  /** ズーム範囲の指定中はズームを外して表示する */
  ignoreZoom: boolean;
}

type Img = CanvasImageSource & { width: number; height: number };

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

export class Player {
  time = 0;
  playing = false;
  private runId = 0;
  private drawToken = 0;
  private ac: AudioContext | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getState: () => PlayerState,
    private onTime: (t: number, playing: boolean) => void,
  ) {}

  private ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext("2d") as CanvasRenderingContext2D;
  }

  private paint(
    st: PlayerState,
    entry: TimelineEntry | null,
    local: number,
    frame: Img | null,
    m: SourceMedia | null,
  ) {
    drawFrame(this.ctx(), {
      project: st.project,
      step: entry?.step ?? null,
      local,
      stepDuration: entry?.duration ?? 0,
      frame,
      srcW: m?.width ?? 0,
      srcH: m?.height ?? 0,
      outW: this.canvas.width,
      outH: this.canvas.height,
      ignoreZoom: st.ignoreZoom,
    });
  }

  /** 停止中の表示を更新する */
  async renderStill(): Promise<void> {
    if (this.playing) return;
    const token = ++this.drawToken;
    const st = this.getState();
    if (st.sourceView) {
      const step = st.project.steps[st.sourceView.stepIndex];
      const m = step ? (st.media.get(step.source) ?? null) : null;
      const wc = m ? await m.video.getCanvas(st.sourceView.time) : null;
      if (token === this.drawToken) this.paint(st, null, 0, wc?.canvas ?? null, m);
      return;
    }
    const loc = locate(st.timeline, this.time);
    if (!loc) {
      this.paint(st, null, 0, null, null);
      return;
    }
    const m = st.media.get(loc.entry.step.source) ?? null;
    const wc = m ? await m.video.getCanvas(sourceTimeAt(loc.entry.step, loc.local)).catch(() => null) : null;
    if (token === this.drawToken) this.paint(st, loc.entry, loc.local, wc?.canvas ?? null, m);
  }

  seek(t: number): void {
    const total = totalDuration(this.getState().timeline);
    this.time = Math.min(Math.max(0, t), total);
    if (this.playing) {
      this.stop();
      this.play();
    } else {
      this.onTime(this.time, false);
      this.renderStill();
    }
  }

  stop(): void {
    this.runId++;
    this.playing = false;
    this.ac?.close();
    this.ac = null;
    this.onTime(this.time, false);
    this.renderStill();
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const st = this.getState();
    const total = totalDuration(st.timeline);
    if (total <= 0) return;
    if (this.time >= total - 0.01) this.time = 0;
    const run = ++this.runId;
    this.playing = true;
    this.onTime(this.time, true);
    const ac = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.ac = ac;
    const startT = this.time;
    const first = locate(st.timeline, startT);
    if (!first) return;
    const alive = () => run === this.runId;

    const audioFor = (entry: TimelineEntry) =>
      renderStepAudio(
        st.project,
        entry.step,
        entry.duration,
        st.media.get(entry.step.source) ?? null,
        st.speech.get(st.project, entry.step)?.buffer ?? null,
      );

    let firstAudio: AudioBuffer | null = null;
    try {
      firstAudio = await audioFor(first.entry);
    } catch {
      // 音声が用意できなくても映像は再生する
    }
    if (!alive()) return;
    const t0 = ac.currentTime + 0.05;
    const clock = () => startT + (ac.currentTime - t0);

    const schedule = (entry: TimelineEntry, buf: AudioBuffer) => {
      const playFrom = Math.max(entry.start, startT);
      let when = t0 + (playFrom - startT);
      let offset = playFrom - entry.start;
      if (when < ac.currentTime) {
        offset += ac.currentTime - when;
        when = ac.currentTime;
      }
      if (offset >= buf.duration) return;
      const node = ac.createBufferSource();
      node.buffer = buf;
      node.connect(ac.destination);
      node.start(when, offset);
    };
    if (firstAudio) schedule(first.entry, firstAudio);
    (async () => {
      for (let i = first.entry.index + 1; i < st.timeline.length && alive(); i++) {
        const entry = st.timeline[i] as TimelineEntry;
        try {
          const buf = await audioFor(entry);
          if (alive()) schedule(entry, buf);
        } catch {
          // 次のステップへ
        }
      }
    })();

    for (let i = first.entry.index; i < st.timeline.length && alive(); i++) {
      const entry = st.timeline[i] as TimelineEntry;
      const m = st.media.get(entry.step.source) ?? null;
      const locals: number[] = [];
      const self = this;
      async function* times() {
        while (alive()) {
          await nextFrame();
          const local = clock() - entry.start;
          if (local >= entry.duration) return;
          const l = Math.max(0, local);
          locals.push(l);
          self.time = entry.start + l;
          yield sourceTimeAt(entry.step, l);
        }
      }
      if (m) {
        for await (const wc of m.video.canvasesAtTimestamps(times())) {
          if (!alive()) break;
          const local = locals.shift() ?? 0;
          this.paint(st, entry, local, (wc?.canvas as Img | undefined) ?? null, m);
          this.onTime(entry.start + local, true);
        }
      } else {
        for await (const _ of times()) {
          const local = locals.shift() ?? 0;
          this.paint(st, entry, local, null, null);
          this.onTime(entry.start + local, true);
        }
      }
    }
    if (alive()) {
      this.time = total;
      this.stop();
    }
  }
}
