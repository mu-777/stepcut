import { describe, expect, it } from "vitest";
import { resolveAudio } from "./defaults";
import type { Project, Step } from "./schema";
import { timeStretch } from "./stretch";
import { fadeLevel, stepHolds } from "./timeline";

const RATE = 48000;
const step = (over: Partial<Step> = {}): Step => ({ id: "s", source: "rec", in: 0, out: 10, ...over });
const proj = (steps: Step[], over: Partial<Project> = {}): Project => ({
  format: "stepcut.project",
  version: 1,
  sources: [{ id: "rec", path: "a.mp4" }],
  steps,
  ...over,
});

/** 0 を下から上へまたぐ回数から求めた周波数 */
function frequency(x: Float32Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] ?? 0) < 0 && (x[i] ?? 0) >= 0) n++;
  return n / (x.length / RATE);
}

describe("timeStretch", () => {
  const sine = (hz: number, sec: number) => {
    const a = new Float32Array(Math.round(RATE * sec));
    for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * hz * i) / RATE);
    return a;
  };

  it("速さに合わせて短くなり、音の高さは変わらない", () => {
    const [out] = timeStretch([sine(440, 2)], 2);
    expect(out?.length).toBe(RATE);
    // 窓の始まり・終わりの端を除いて測る
    expect(frequency((out as Float32Array).subarray(4096, RATE - 4096))).toBeGreaterThan(420);
    expect(frequency((out as Float32Array).subarray(4096, RATE - 4096))).toBeLessThan(460);
  });

  it("チャンネルごとに同じ長さで返す", () => {
    const outs = timeStretch([sine(300, 1), sine(500, 1)], 3);
    expect(outs.map((o) => o.length)).toEqual([16000, 16000]);
  });
});

describe("フェードと早送りの音声", () => {
  it("フェードインとフェードアウトの明るさ", () => {
    const s = step({ fadeIn: 1, fadeOut: 2 });
    expect(fadeLevel(s, 0, 10)).toBe(0);
    expect(fadeLevel(s, 0.5, 10)).toBeCloseTo(0.5);
    expect(fadeLevel(s, 5, 10)).toBe(1);
    expect(fadeLevel(s, 9, 10)).toBeCloseTo(0.5);
    expect(fadeLevel(step(), 0, 10)).toBe(1);
  });

  it("早送りステップの元の音声は、ステップで鳴らすと決めたときだけ鳴らし、既定で音の高さを保つ", () => {
    const fast = step({ speed: 2 });
    expect(resolveAudio(proj([fast]), fast).sourceEnabled).toBe(false);
    expect(resolveAudio(proj([fast], { audio: { source: { enabled: true } } }), fast).sourceEnabled).toBe(
      false,
    );
    const on = step({ speed: 2, audio: { source: { enabled: true } } });
    expect(resolveAudio(proj([on]), on)).toMatchObject({ sourceEnabled: true, keepPitch: true });
    const follow = step({ speed: 2, audio: { source: { enabled: true, keepPitch: false } } });
    expect(resolveAudio(proj([follow]), follow).keepPitch).toBe(false);
    expect(resolveAudio(proj([step()]), step()).sourceEnabled).toBe(true);
  });
});

describe("ズーム中の映像の止め方", () => {
  const zoom = { start: 2, end: 5, keys: [{ t: 2, rect: { x: 0, y: 0, w: 10, h: 10 } }] };
  it("拡大・縮小の動きの間だけ止めるズームは、動きの前後を保持にする", () => {
    expect(stepHolds(step({ zooms: [{ ...zoom, hold: "transition", transition: 0.5 }] }))).toEqual([
      { at: 1.5, duration: 0.5 },
      { at: 5, duration: 0.5 },
    ]);
    // 書いていなければ固定の秒数。ステップの頭より前には出さない
    expect(stepHolds(step({ zooms: [{ ...zoom, start: 0.3, hold: "transition" }] }))).toEqual([
      { at: 0, duration: 0.3 },
      { at: 5, duration: 0.8 },
    ]);
    expect(stepHolds(step({ zooms: [{ ...zoom }] }))).toEqual([{ at: 2, duration: 3 }]);
    expect(stepHolds(step({ zooms: [{ ...zoom, hold: false }] }))).toEqual([]);
  });
});
