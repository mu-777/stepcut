// 縮小フレームのキャッシュ。タイムラインのサムネイルと、シーク中の仮表示に使う。
// プレビューとは別のデコーダーで、要求された時刻を昇順にまとめてデコードする(同じパケットを 2 度デコードしない)。
import { CanvasSink } from "mediabunny";
import type { SourceMedia } from "./media";

export const THUMB_WIDTH = 160;
const MAX_ENTRIES = 3000;

type Thumb = CanvasImageSource & { width: number; height: number };

interface PerSource {
  sink: Promise<CanvasSink | null>;
  frames: Map<number, Thumb>;
  /** frames のキーを昇順に並べたもの(近い時刻を探すため) */
  sorted: number[] | null;
  wanted: Set<number>;
  running: boolean;
}

/** 時刻をサムネイルの刻み(秒)にそろえる */
export function quantize(t: number, step: number): number {
  return Math.round(Math.round(t / step) * step * 1000) / 1000;
}

export class ThumbCache {
  private sources = new Map<string, PerSource>();
  private count = 0;

  constructor(private onUpdate: () => void) {}

  private entry(m: SourceMedia): PerSource {
    let e = this.sources.get(m.path);
    if (!e) {
      e = {
        sink: m.input
          .getPrimaryVideoTrack()
          .then((track) => (track ? new CanvasSink(track, { width: THUMB_WIDTH }) : null))
          .catch(() => null),
        frames: new Map(),
        sorted: null,
        wanted: new Set(),
        running: false,
      };
      this.sources.set(m.path, e);
    }
    return e;
  }

  /** 時刻 t(そろえた値)のサムネイル。なければデコードを予約して null を返す */
  get(m: SourceMedia, t: number): Thumb | null {
    const e = this.entry(m);
    const f = e.frames.get(t);
    if (f) return f;
    e.wanted.add(t);
    if (!e.running) void this.run(e);
    return null;
  }

  /** 時刻 t にいちばん近いサムネイル(maxGap 秒以内)。デコードは予約しない */
  nearest(m: SourceMedia, t: number, maxGap: number): Thumb | null {
    const e = this.sources.get(m.path);
    if (!e || e.frames.size === 0) return null;
    if (!e.sorted) e.sorted = [...e.frames.keys()].sort((a, b) => a - b);
    const keys = e.sorted;
    let lo = 0;
    let hi = keys.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((keys[mid] as number) < t) lo = mid + 1;
      else hi = mid;
    }
    let best: number | null = null;
    for (const k of [keys[lo - 1], keys[lo]]) {
      if (
        k !== undefined &&
        Math.abs(k - t) <= maxGap &&
        (best === null || Math.abs(k - t) < Math.abs(best - t))
      )
        best = k;
    }
    return best === null ? null : (e.frames.get(best) ?? null);
  }

  private async run(e: PerSource): Promise<void> {
    e.running = true;
    try {
      const sink = await e.sink;
      while (sink && e.wanted.size > 0) {
        const times = [...e.wanted].sort((a, b) => a - b);
        e.wanted.clear();
        let i = 0;
        for await (const wc of sink.canvasesAtTimestamps(times)) {
          const t = times[i++] as number;
          if (wc && this.count < MAX_ENTRIES) {
            e.frames.set(t, wc.canvas as Thumb);
            e.sorted = null;
            this.count++;
          }
        }
        this.onUpdate();
      }
    } catch {
      // サムネイルがなくても編集はできる
    } finally {
      e.running = false;
    }
  }
}
