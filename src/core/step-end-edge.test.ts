// ステップの終わりの境界で起きる、利用者から報告された 2 つの現象の再現。
// どちらも直し方(仕様)が未決なので、今の挙動をそのまま固定している。
// 仕様を決めて直すときは、ここの期待値を新しい仕様に書き換える。
import { describe, expect, it } from "vitest";
import { viewRectAt } from "./layout";
import type { Project, Step, Zoom } from "./schema";
import { baseDuration, sourceTimeAt, stepDuration } from "./timeline";
import { parseProject } from "./validate";

const W = 1920;
const H = 1080;
const FULL = { x: 0, y: 0, w: W, h: H };
const RECT = { x: 800, y: 160, w: 570, h: 540 };
const zoom = (over: Partial<Zoom> = {}): Zoom => ({
  start: 0,
  end: 5,
  transition: 0,
  keys: [{ t: 0, rect: RECT }],
  ...over,
});
const step = (over: Partial<Step> = {}): Step => ({ id: "a", source: "rec1", in: 10, out: 10.1, ...over });
const proj = (steps: Step[]): Project => ({
  format: "stepcut.project",
  version: 1,
  sources: [{ id: "rec1", path: "a.mp4" }],
  steps,
});

describe("ズームの保持の後、ステップの末尾にズームなしの映像が残る", () => {
  it("保持するズーム(既定)を先頭から置くと、保持の後に残りの映像がズームなしで流れる", () => {
    const a = step({ zooms: [zoom()] });
    // ステップの長さ = 映像 0.1 秒 + 保持 5 秒
    expect(stepDuration(a)).toBeCloseTo(5.1);
    // ズームの終わりまでは拡大したまま、映像は止まっている
    expect(viewRectAt(a, 5, W, H)).toEqual(RECT);
    expect(sourceTimeAt(a, 5)).toBe(10);
    // 終わりから後の 0.1 秒(3 フレーム)はズームが外れ、映像が進む
    for (const t of [5.01, 5.05, 5.09]) {
      expect(viewRectAt(a, t, W, H)).toEqual(FULL);
      expect(sourceTimeAt(a, t)).toBeGreaterThan(10);
    }
  });

  it("保持するズームを先頭から置くと、ズームの終わりがステップの終わりに届くことはない", () => {
    // ズームの終わりを延ばすと保持も同じだけ延び、ステップの終わりも同じだけ後ろへずれる
    for (const end of [1, 5, 10]) {
      const a = step({ zooms: [zoom({ end })] });
      expect(stepDuration(a) - end).toBeCloseTo(0.1);
    }
  });

  it("映像の終わりからズームを始めれば末尾はそろうが、ズームなしの映像が先頭に移る", () => {
    const a = step({ zooms: [zoom({ start: 0.1, end: 5.1, keys: [{ t: 0.1, rect: RECT }] })] });
    expect(stepDuration(a)).toBeCloseTo(5.1);
    expect(viewRectAt(a, 5.1, W, H)).toEqual(RECT);
    expect(viewRectAt(a, 0.05, W, H)).toEqual(FULL);
  });

  it("止めないズームの終わりをステップの終わりに合わせても、読み上げの自動保持で末尾が外れる", () => {
    const a = step({
      holds: [{ at: 0, duration: 5 }],
      zooms: [zoom({ hold: false, end: 5.1 })],
      speech: { text: "x" },
    });
    expect(baseDuration(a)).toBeCloseTo(5.1);
    expect(viewRectAt(a, 5.1, W, H)).toEqual(RECT);
    // 読み上げが 7 秒あると、最終フレームを 5.1〜7 秒まで保持する。その間はズームなし
    expect(stepDuration(a, [7])).toBe(7);
    expect(viewRectAt(a, 6, W, H)).toEqual(FULL);
  });
});

describe("映像が短いステップで読み上げの開始を遅らせると speechAfterVideo になる", () => {
  it("映像 0.1 秒のステップで読み上げを 1 秒から始めるとエラー", () => {
    const r = parseProject(proj([step({ speech: { start: 1 } })]));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => [e.path, e.code])).toEqual([["steps[0].speech.start", "speechAfterVideo"]]);
    }
  });

  it("開始が映像の終わりちょうどならエラーにならない", () => {
    expect(parseProject(proj([step({ speech: { start: 0.1 } })])).ok).toBe(true);
  });

  it("冒頭に保持を足して映像を開始時刻より長くすると通る(今の回避策)", () => {
    const s = step({ holds: [{ at: 0, duration: 1 }], speech: { start: 1 } });
    expect(parseProject(proj([s])).ok).toBe(true);
  });
});
