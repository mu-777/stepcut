// プレビューの再生。描画は書き出しと同じ drawFrame、音声も同じ renderStepAudio を使う(OUT-06)。
// 時計は AudioContext に合わせ、映像は間に合わなければ飛ばす。
// 停止中の表示はデコードを常に 1 本だけにし、その間の要求は最新の 1 件にまとめる
// (要求ごとにデコードを積むと、キーフレームからのデコード待ちが溜まってシークが追従しなくなる)。

import { resolveLayout } from "../../core/defaults";
import type { ObjectRef } from "../../core/objects";
import type { Project } from "../../core/schema";
import { continuousRuns, locate, sourceTimeAt, type TimelineEntry, totalDuration } from "../../core/timeline";
import { renderStepAudio } from "./audio";
import type { BackgroundStore } from "./backgrounds";
import { drawFrame } from "./compositor";
import type { ImageStore } from "./images";
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
  /** ズーム範囲の指定中はズームを外して表示する(再生中は常にズームする) */
  ignoreZoom: boolean;
  /** 選んでいるオブジェクト。停止中は、フェード・点滅で見えない時刻でも出す */
  selectedObject?: { step: number; ref: ObjectRef } | null;
  /** シーク中の仮表示に使う縮小フレーム */
  thumbs: ThumbCache | null;
  /** 画像の背景 */
  backgrounds: BackgroundStore | null;
  /** 図形・ポインターの画像 */
  images: ImageStore | null;
  /** 背景画像のパスの基準 */
  projectPath: string | null;
  /** テロップの文が空のときにプレビューにだけ出す文 */
  captionPlaceholder?: string;
  /** テロップを描かないステップの番号(プレビュー上でテロップの文を入力中) */
  hideCaptionStep?: number | null;
  /** 文を描かない文字のオブジェクト(プレビュー上で文を入力中) */
  hideObjectText?: { step: number; ref: ObjectRef } | null;
}

type Img = CanvasImageSource & { width: number; height: number };

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** フレームの写し(CanvasSink のキャンバスは使い回されて後のフレームで上書きされるため) */
function copyCanvas(frame: Img): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = frame.width;
  c.height = frame.height;
  c.getContext("2d")?.drawImage(frame, 0, 0);
  return c;
}

/** 本当に切った箇所の、何秒前から次の区間のデコードを始めるか */
const PREROLL = 2;

/** 1 本のデコードで読み続ける、続いたステップの並び(from〜to 番目)。start / end は全体の時刻 */
interface PlaybackRun {
  from: number;
  to: number;
  start: number;
  end: number;
  media: SourceMedia | null;
  latest: Img | null;
  decoding: Promise<void> | null;
  done: boolean;
}

/** from 番目のステップから後ろの、1 本のデコードで読み続ける区間 */
function playbackRuns(
  timeline: TimelineEntry[],
  from: number,
  media: Map<string, SourceMedia>,
): PlaybackRun[] {
  return continuousRuns(timeline, from).map((r) => ({
    ...r,
    media: media.get((timeline[r.from] as TimelineEntry).step.source) ?? null,
    latest: null,
    decoding: null,
    done: false,
  }));
}

/**
 * 再生の音声を作る区切り(秒)。最初は短くしてすぐ鳴らし、その後は長くして作る回数を減らす。
 * 作るのにかかる時間は区切りの長さにほぼ比例する(録画の音のデコードが大半)
 */
const AUDIO_CHUNKS = [1, 3];
const AUDIO_CHUNK_MAX = 8;
/** 音声を先に作っておく長さ(再生の実時間で何秒先まで) */
const AUDIO_LOOKAHEAD = 10;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** プレビューの再生速度。書き出しには影響しない */
export const PLAYBACK_RATES = [0.5, 1, 1.5, 2, 3] as const;

export class Player {
  time = 0;
  playing = false;
  /** 再生速度(PLAYBACK_RATES のどれか) */
  rate = 1;
  private runId = 0;
  private stillWanted = false;
  private stillRunning: Promise<void> | null = null;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  /** プレビューの音を消す(書き出しには影響しない) */
  muted = false;
  /**
   * 停止中に最後にデコードしたフレームの写し。時刻が同じなら(配置・ズーム枠・テロップの編集中)デコードし直さず
   * すぐ描き直す。デコードを待つと、編集中の枠と映像の動きがずれるため
   */
  private still: { m: SourceMedia; t: number; canvas: HTMLCanvasElement } | null = null;

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
      carry: entry?.carry,
      frame,
      srcW: m?.width ?? 0,
      srcH: m?.height ?? 0,
      outW: this.canvas.width,
      outH: this.canvas.height,
      ignoreZoom: st.ignoreZoom && !this.playing,
      showObject:
        !this.playing && entry && st.selectedObject?.step === entry.index ? st.selectedObject.ref : undefined,
      backgroundImage: this.backgroundImage(st),
      images: st.images ? (p) => st.images?.get(p, st.projectPath) ?? null : undefined,
      captionPlaceholder: st.captionPlaceholder,
      hideCaption: entry !== null && st.hideCaptionStep === entry.index,
      hideObjectText: entry && st.hideObjectText?.step === entry.index ? st.hideObjectText.ref : undefined,
    });
  }

  private backgroundImage(st: PlayerState): Img | null {
    const bg = resolveLayout(st.project).background;
    if (typeof bg === "string" || !("image" in bg) || !st.backgrounds) return null;
    return st.backgrounds.get(bg.image, this.canvas.width, this.canvas.height, st.projectPath);
  }

  /** 停止中の表示を更新する。デコード中に呼ばれたら、近い縮小フレームを仮に描き、終わってから最新の状態で描き直す */
  renderStill(): Promise<void> {
    // 同じ時刻のフレームが手元にあれば、デコードを待たずに描く
    const hit = this.paintCached();
    if (hit && !this.stillRunning) return Promise.resolve();
    this.stillWanted = true;
    if (this.stillRunning) {
      if (!hit) this.paintPlaceholder();
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

  /** 保持しているフレームが今の表示に使えれば描く */
  private paintCached(): boolean {
    if (this.playing) return false;
    const st = this.getState();
    const tg = this.target(st);
    const c = this.still;
    if (!tg?.m || !c || c.m !== tg.m || c.t !== tg.srcT) return false;
    this.paint(st, tg.entry, tg.local, c.canvas, tg.m);
    return true;
  }

  /** 保持しているフレームを捨てる(GPU のコンテキストが失われたときなど) */
  dropCache(): void {
    this.still = null;
  }

  private keepStill(m: SourceMedia, t: number, frame: Img): HTMLCanvasElement {
    const canvas = this.still?.canvas ?? document.createElement("canvas");
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width;
      canvas.height = frame.height;
    }
    canvas.getContext("2d")?.drawImage(frame, 0, 0);
    this.still = { m, t, canvas };
    return canvas;
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
      if (tg.m && this.still?.m === tg.m && this.still.t === tg.srcT) {
        this.paint(st, tg.entry, tg.local, this.still.canvas, tg.m);
        continue;
      }
      const wc = tg.m ? await tg.m.video.getCanvas(tg.srcT).catch(() => null) : null;
      // デコード中に状態が変わっていれば、最新の状態で描く
      const frame = wc && tg.m ? this.keepStill(tg.m, tg.srcT, wc.canvas as Img) : null;
      if (!this.playing) {
        const now = this.getState();
        const tg2 = this.target(now);
        if (tg2 && tg2.m === tg.m && tg2.srcT === tg.srcT) this.paint(now, tg2.entry, tg2.local, frame, tg.m);
        else this.paint(st, tg.entry, tg.local, frame, tg.m);
      }
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

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
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
    const master = ac.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ac.destination);
    this.master = master;
    const startT = this.time;
    const first = locate(st.timeline, startT);
    if (!first) {
      this.stop();
      return;
    }
    const alive = () => run === this.runId;

    // ステップ内の from〜to だけを作る。途中から再生するときに前の部分を待たず、
    // 長いステップでも全体を作り終えるまで無音にならないよう、短い区切りから順に作って鳴らす
    const audioFor = (entry: TimelineEntry, from: number, to: number) =>
      renderStepAudio(
        st.project,
        entry.step,
        entry.duration,
        st.media.get(entry.step.source) ?? null,
        st.speech.placed(st.project, entry.step),
        from,
        to,
      );

    // 音声を待たずに映像を動かし始める(シークのたびにステップ全体の音声の用意を待たないため)。
    // 音声は用意でき次第、時計に合わせて途中から鳴らす
    const t0 = ac.currentTime + 0.05;
    const clock = () => startT + (ac.currentTime - t0) * rate;

    /** buf はステップ内の from 秒からの音声 */
    const schedule = (entry: TimelineEntry, buf: AudioBuffer, from: number) => {
      const playFrom = Math.max(entry.start + from, startT);
      let when = t0 + (playFrom - startT) / rate;
      let offset = playFrom - entry.start - from;
      if (when < ac.currentTime) {
        offset += (ac.currentTime - when) * rate;
        when = ac.currentTime;
      }
      if (offset >= buf.duration) return;
      const node = ac.createBufferSource();
      node.buffer = buf;
      // 速度に合わせて音の高さも変わる(最も単純な方式)
      node.playbackRate.value = rate;
      node.connect(master);
      node.start(when, offset);
    };
    (async () => {
      let k = 0;
      for (let i = first.entry.index; i < st.timeline.length && alive(); i++) {
        const entry = st.timeline[i] as TimelineEntry;
        let from = i === first.entry.index ? Math.max(0, startT - entry.start) : 0;
        while (from < entry.duration - 1e-6 && alive()) {
          const to = Math.min(entry.duration, from + (AUDIO_CHUNKS[k] ?? AUDIO_CHUNK_MAX));
          k++;
          // 先回りしすぎない(止める・シークするたびに捨てる分を減らし、映像のデコードと取り合わない)
          while (alive() && entry.start + from - clock() > AUDIO_LOOKAHEAD * rate) await sleep(250);
          if (!alive()) break;
          try {
            const buf = await audioFor(entry, from, to);
            if (alive()) schedule(entry, buf, from);
          } catch {
            // 次の区切りへ
          }
          from = to;
        }
      }
    })();

    // デコードと描画を分ける。保持中は同じフレームが続くのでデコーダーは何も返さないが、
    // 描画は毎フレーム行い、時刻とズームの動きを進める。
    // デコードは「続いた区間」ごとに 1 本で読み続ける(同じ録画で前の区間の out = 次の区間の in なら切れ目をまたぐ)。
    // 区間ごとに作り直すと、次の区間の手前のキーフレームからデコードし直しになり、切れ目で映像が止まって飛ぶ。
    // 本当に切った箇所(録画が違う・区間が続いていない)は、切れ目の PREROLL 秒前から次の区間のデコードを始めておく
    const runs = playbackRuns(st.timeline, first.entry.index, st.media);
    const startRun = (k: number) => {
      const found = runs[k];
      if (!found || found.decoding) return;
      const run: PlaybackRun = found;
      const prev = runs[k - 2];
      run.decoding = (async () => {
        // 同じデコーダーを使う 2 つ前の区間が読み終えてから始める(キャンバスを取り合わないため)
        await prev?.decoding;
        const m = run.media;
        if (!m || !alive()) return;
        const sink = k % 2 === 0 ? m.video : m.prefetch;
        // 始まりのフレームを先に 1 枚用意する。canvasesAtTimestamps はあるフレームを次のフレームを読むまで返さないので、
        // 区間が保持で始まると保持が明けるまで何も描けない(フェードインと重ねると、その間ずっと真っ黒になる)
        const l0 = locate(st.timeline, Math.min(Math.max(clock(), run.start), run.end - 1e-6));
        if (l0) {
          const src0 = sourceTimeAt(l0.entry.step, l0.local);
          if (this.still?.m === m && this.still.t === src0) run.latest ??= this.still.canvas;
          else
            sink
              .getCanvas(src0)
              .then((wc) => {
                if (wc && !run.latest && alive()) run.latest = copyCanvas(wc.canvas as Img);
              })
              .catch(() => {});
        }
        // 区間の始まりより前(先読み中)は始まりの時刻を 1 回だけ求め、その後は時計に合わせて進める
        async function* times() {
          let last = Number.NaN;
          while (alive() && !run.done) {
            const now = clock();
            if (now >= run.end) return;
            const l = locate(st.timeline, Math.min(Math.max(now, run.start), run.end - 1e-6));
            if (l) {
              const src = sourceTimeAt(l.entry.step, l.local);
              if (src !== last) {
                last = src;
                yield src;
              }
            }
            await nextFrame();
          }
        }
        try {
          for await (const wc of sink.canvasesAtTimestamps(times())) {
            if (!alive()) break;
            if (wc) run.latest = wc.canvas as Img;
          }
        } catch {
          // 描画は続ける
        }
      })();
    };
    startRun(0);
    let ri = 0;
    while (alive()) {
      await nextFrame();
      // 待っている間に止められたら何もしない(止めた後に「再生中」と知らせないため)
      if (!alive()) break;
      const now = Math.max(startT, clock());
      if (now >= total) break;
      const l = locate(st.timeline, now);
      if (!l) break;
      // 区間はステップの途中でも切れる(まとめたステップの区間の切れ目)ので、時刻で次へ進める
      while (ri < runs.length - 1 && now >= (runs[ri] as PlaybackRun).end) {
        (runs[ri] as PlaybackRun).done = true;
        ri++;
      }
      const run = runs[ri] as PlaybackRun;
      startRun(ri);
      if (now >= run.end - PREROLL) startRun(ri + 1);
      this.time = now;
      // 区間の最初のフレームがデコードされるまでは前の表示を残す
      if (run.latest || !run.media) this.paint(st, l.entry, l.local, run.latest, run.media);
      this.onTime(this.time, true);
    }
    for (const r of runs) r.done = true;
    if (alive()) {
      this.time = total;
      this.stop();
    }
  }
}
