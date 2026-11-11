import { describe, expect, it } from "vitest";
import type { FrameSink, SourceMedia } from "./media";
import { ThumbCache } from "./thumbs";

// DOM なしで動かすため、キャンバスは中身のない目印にする
const fakeCanvas = () => ({ width: 160, height: 90 }) as unknown as OffscreenCanvas;

function fakeMedia(path: string): SourceMedia {
  const sink: FrameSink = {
    getCanvas: async () => ({ canvas: fakeCanvas() }),
    async *canvasesAtTimestamps(ts) {
      for await (const _ of ts) {
        await new Promise((r) => setTimeout(r, 5));
        yield { canvas: fakeCanvas() };
      }
    },
  };
  return { path, thumbSink: async () => sink } as unknown as SourceMedia;
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe("ThumbCache", () => {
  it("同じ時刻を 2 度デコードしても枚数を二重に数えない", async () => {
    const c = new ThumbCache(() => {});
    const m = fakeMedia("a");
    c.get(m, 1);
    // デコード中(予約は空になっている)に、まだ置かれていない同じ時刻がもう一度予約される
    await new Promise((r) => setTimeout(r, 1));
    c.get(m, 1);
    await settle();
    expect(c.size).toBe(1);
  });

  it("上限に達したら、いちばん多く持つ素材の古いものから捨てる", async () => {
    const c = new ThumbCache(() => {}, 4);
    const a = fakeMedia("a");
    const b = fakeMedia("b");
    for (const t of [1, 2, 3]) c.get(a, t);
    await settle();
    c.get(b, 1);
    await settle();
    expect(c.size).toBe(4);
    c.get(b, 2);
    await settle();
    expect(c.size).toBe(4);
    // a が多いので a の最古(1)が消え、b は残る
    expect(c.nearest(a, 1, 0.1)).toBeNull();
    expect(c.nearest(a, 2, 0.1)).not.toBeNull();
    expect(c.nearest(b, 1, 0.1)).not.toBeNull();
    expect(c.nearest(b, 2, 0.1)).not.toBeNull();
  });

  it("retain は他の素材の分を捨てて枚数を直す", async () => {
    const c = new ThumbCache(() => {});
    const a = fakeMedia("a");
    const b = fakeMedia("b");
    c.get(a, 1);
    c.get(a, 2);
    c.get(b, 1);
    await settle();
    expect(c.size).toBe(3);
    c.retain(["b"]);
    expect(c.size).toBe(1);
    expect(c.nearest(a, 1, 10)).toBeNull();
    expect(c.nearest(b, 1, 10)).not.toBeNull();
  });
});
