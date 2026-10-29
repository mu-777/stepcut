// プレビューの再生。描画は書き出しと同じ drawFrame、音声も同じ renderStepAudio を使う(OUT-06)。
// 時計は AudioContext に合わせ、映像は間に合わなければ飛ばす。
// 停止中の表示はデコードを常に 1 本だけにし、その間の要求は最新の 1 件にまとめる
// (要求ごとにデコードを積むと、キーフレームからのデコード待ちが溜まってシークが追従しなくなる)。

import { resolveLayout } from "../../core/defaults";
import type { Project } from "../../core/schema";
import { locate, sourceTimeAt, type TimelineEntry, totalDuration } from "../../core/timeline";
import { renderStepAudio } from "./audio";
import type { BackgroundStore } from "./backgrounds";
import { drawFrame } from "./compositor";
import type { SourceMedia } from "./media";
import { SAMPLE_RATE, type SpeechStore } from "./speech";
import type { ThumbCache } from "./thumbs";

export interface PlayerState {
  project: Project;
  timeline: TimelineEntry[];
  media: Map<string, SourceMedia>;
  speech: SpeechStore;
  /** 録画そのものを表示する(In/Out の指定用)。ステップの番号とソースの時刻 */
  sourceView: { stepIndex: number; time: number } | null;
  /** ズーム範囲の指定中はズームを外して表示する */
  ignoreZoom: boolean;
  /** シーク中の仮表示に使う縮小フレーム */
  thumbs: ThumbCache | null;
  /** 画像の背景 */
  backgrounds: BackgroundStore | null;
  /** 背景画像のパスの基準 */
  projectPath: string | null;
}

type Img = CanvasImageSource & { width: number; height: number };

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** プレビューの再生速度。書き出しには影響しない */
export const PLAYBACK_RATES = [0.5, 1, 2, 3] as const;

export class Player {
  time = 0;
  playing = false;
  /** 再生速度。負の値は逆方向(音声なし) */
  rate = 1;
  private runId = 0;
  private stillWanted = false;
  private stillRunning: Promise<void> | null = null;
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
      backgroundImage: this.backgroundImage(st),
    });
  }

  private backgroundImage(st: PlayerState): Img | null {
    const bg = resolveLayout(st.project).background;
    if (typeof bg === "string" || !("image" in bg) || !st.backgrounds) return null;
    return st.backgrounds.get(bg.image, this.canvas.width, this.canvas.height, st.projectPath);
  }

  /** 停止中の表示を更新する。デコード中に呼ばれたら、近い縮小フレームを仮に描き、終わってから最新の状態で描き直す */
  renderStill(): Promise<void> {
    this.stillWanted = true;
    if (this.stillRunning) {
      this.paintPlaceholder();
      return this.stillRunning;
    }
    this.stillRunning = this.stillLoop().finally(() => {
      this.stillRunning = null;
    });
    return this.stillRunning;
  }

  /** いまの状態で表示するもの。ステップ(録画を表示中は null)、ステップ内の時刻、素材、素材の時刻 */
  private target(st: PlayerState) {
    if (st.sourceView) {
      const step = st.project.steps[st.sourceView.stepIndex];
      const m = step ? (st.media.get(step.source) ?? null) : null;
      return { entry: null, local: 0, m, srcT: st.sourceView.time };
    }
    const loc = locate(st.timeline, this.time);
    if (!loc) return null;
    const m = st.media.get(loc.entry.step.source) ?? null;
    return { entry: loc.entry, local: loc.local, m, srcT: sourceTimeAt(loc.entry.step, loc.local) };
  }

  private paintPlaceholder(): void {
    if (this.playing) return;
    const st = this.getState();
    const tg = this.target(st);
    if (!tg?.m || !st.thumbs) return;
    const thumb = st.thumbs.nearest(tg.m, tg.srcT, 2);
    if (thumb) this.paint(st, tg.entry, tg.local, thumb, tg.m);
  }

  private async stillLoop(): Promise<void> {
    while (this.stillWanted) {
      this.stillWanted = false;
      if (this.playing) return;
      const st = this.getState();
      const tg = this.target(st);
      if (!tg) {
        this.paint(st, null, 0, null, null);
        continue;
      }
      const wc = tg.m ? await tg.m.video.getCanvas(tg.srcT).catch(() => null) : null;
      if (!this.playing) this.paint(st, tg.entry, tg.local, wc?.canvas ?? null, tg.m);
    }
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

  /** 再生中なら同じ位置から速度を変えて再生し直す */
  setRate(rate: number): void {
    this.rate = rate;
    if (this.playing) {
      this.stop();
      this.play();
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
    if (this.rate < 0) return this.playReverse();
    const st = this.getState();
    const total = totalDuration(st.timeline);
    if (total <= 0) return;
    if (this.time >= total - 0.01) this.time = 0;
    const rate = this.rate;
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

    // 音声を待たずに映像を動かし始める(シークのたびにステップ全体の音声の用意を待たないため)。
    // 音声は用意でき次第、時計に合わせて途中から鳴らす
    const t0 = ac.currentTime + 0.05;
    const clock = () => startT + (ac.currentTime - t0) * rate;

    const schedule = (entry: TimelineEntry, buf: AudioBuffer) => {
      const playFrom = Math.max(entry.start, startT);
      let when = t0 + (playFrom - startT) / rate;
      let offset = playFrom - entry.start;
      if (when < ac.currentTime) {
        offset += (ac.currentTime - when) * rate;
        when = ac.currentTime;
      }
      if (offset >= buf.duration) return;
      const node = ac.createBufferSource();
      node.buffer = buf;
      // 速度に合わせて音の高さも変わる(最も単純な方式)
      node.playbackRate.value = rate;
      node.connect(ac.destination);
      node.start(when, offset);
    };
    (async () => {
      for (let i = first.entry.index; i < st.timeline.length && alive(); i++) {
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

  /** 逆方向の再生。逆向きのデコードは重いので、停止中の表示を時計に合わせて更新する(音声なし) */
  private async playReverse(): Promise<void> {
    const run = ++this.runId;
    this.playing = true;
    this.onTime(this.time, true);
    let last = performance.now();
    while (run === this.runId && this.time > 0) {
      const now = await nextFrame();
      this.time = Math.max(0, this.time + ((now - last) / 1000) * this.rate);
      last = now;
      this.onTime(this.time, true);
      this.playing = false;
      await this.renderStill();
      if (run !== this.runId) return;
      this.playing = true;
    }
    if (run === this.runId) this.stop();
  }
}
