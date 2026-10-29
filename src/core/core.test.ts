import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionCues } from "./captions";
import { addHold, duplicateStep, splitStep, trimStep, uniqueStepId } from "./edit";
import { computeLayout, normalizeZoomRect, viewRectAt, zoomProgress } from "./layout";
import type { Project, Step } from "./schema";
import { applyDictionary, toSrt, wrapText } from "./text";
import {
  baseDuration,
  buildTimeline,
  locate,
  sourceSegments,
  sourceTimeAt,
  stepDuration,
  totalDuration,
} from "./timeline";
import { parseProject, parseProjectText } from "./validate";

const step = (over: Partial<Step> = {}): Step => ({ id: "s", source: "rec", in: 10, out: 20, ...over });
const proj = (steps: Step[]): Project => ({
  format: "screen-annotator.project",
  version: 1,
  sources: [{ id: "rec", path: "a.mp4" }],
  steps,
});

describe("timeline", () => {
  it("通常ステップは出力時刻 = ソース時刻 - in", () => {
    const s = step();
    expect(baseDuration(s)).toBe(10);
    expect(sourceTimeAt(s, 0)).toBe(10);
    expect(sourceTimeAt(s, 4)).toBe(14);
  });

  it("早送りは speed 倍で進む", () => {
    const s = step({ speed: 4 });
    expect(baseDuration(s)).toBe(2.5);
    expect(sourceTimeAt(s, 1)).toBe(14);
  });

  it("保持の間は止まり、後ろはずれる", () => {
    const s = step({ holds: [{ at: 2, duration: 3 }] });
    expect(baseDuration(s)).toBe(13);
    expect(sourceTimeAt(s, 1)).toBe(11);
    expect(sourceTimeAt(s, 3)).toBe(12);
    expect(sourceTimeAt(s, 6)).toBe(13);
  });

  it("hold: true のズームは保持と同じ", () => {
    const s = step({ zooms: [{ start: 2, end: 5, rect: { x: 0, y: 0, w: 10, h: 10 }, hold: true }] });
    expect(baseDuration(s)).toBe(13);
    expect(sourceTimeAt(s, 4)).toBe(12);
  });

  it("読み上げが長いと最終フレームで保持する", () => {
    const s = step();
    expect(stepDuration(s, 15)).toBe(15);
    expect(stepDuration(s, 5)).toBe(10);
    expect(sourceTimeAt(s, 14)).toBeCloseTo(19.999);
  });

  it("元音声の区間は保持を除く", () => {
    const s = step({ holds: [{ at: 2, duration: 3 }] });
    expect(sourceSegments(s)).toEqual([
      { outStart: 0, outEnd: 2, srcStart: 10, srcEnd: 12 },
      { outStart: 5, outEnd: 13, srcStart: 12, srcEnd: 20 },
    ]);
  });

  it("全体の並びと位置", () => {
    const tl = buildTimeline([step({ id: "a" }), step({ id: "b", in: 0, out: 2 })], new Map([["b", 5]]));
    expect(totalDuration(tl)).toBe(15);
    expect(locate(tl, 12)?.entry.step.id).toBe("b");
    expect(locate(tl, 12)?.local).toBe(2);
  });
});

describe("layout", () => {
  const layout = {
    mode: "band" as const,
    background: "#000000",
    bandHeight: 0.2,
    margin: 0.04,
    shadow: true,
  };

  it("枠付きは帯の上に縦横比を保って収める", () => {
    const l = computeLayout(1920, 1080, layout, 1920, 1080);
    expect(l.band).toEqual({ x: 0, y: 864, w: 1920, h: 216 });
    expect(l.video.y).toBeCloseTo(43.2);
    expect(l.video.h).toBeCloseTo(1080 - 216 - 43.2);
    expect(l.video.w / l.video.h).toBeCloseTo(16 / 9);
  });

  it("全画面は全面", () => {
    const l = computeLayout(1920, 1080, { ...layout, mode: "full" }, 1920, 1080);
    expect(l.video).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.band).toBeNull();
  });

  it("ズーム範囲は縦横比をそろえて映像内に収める", () => {
    expect(normalizeZoomRect({ x: 1800, y: 0, w: 400, h: 100 }, 1920, 1080)).toEqual({
      x: 1520,
      y: 0,
      w: 400,
      h: 225,
    });
  });

  it("ズームは遷移時間をかけて入り、戻る", () => {
    const z = { start: 1, end: 3, rect: { x: 0, y: 0, w: 960, h: 540 }, transition: 0.5 };
    expect(zoomProgress(z, 0.5)).toBe(0);
    expect(zoomProgress(z, 1.25)).toBeCloseTo(0.5);
    expect(zoomProgress(z, 2)).toBe(1);
    expect(viewRectAt(step({ zooms: [z] }), 2, 1920, 1080)).toEqual({ x: 0, y: 0, w: 960, h: 540 });
  });
});

describe("text", () => {
  const measure = (s: string) => s.length;

  it("日本語は文字単位、英語は語単位で折り返し、改行を保つ", () => {
    expect(wrapText("あいうえおかきく", 5, measure)).toEqual(["あいうえお", "かきく"]);
    expect(wrapText("open the menu", 9, measure)).toEqual(["open the", "menu"]);
    expect(wrapText("a\nb", 9, measure)).toEqual(["a", "b"]);
  });

  it("SRT", () => {
    expect(
      toSrt([
        { start: 0, end: 1.5, text: "一" },
        { start: 61.25, end: 3700, text: "二" },
      ]),
    ).toBe("1\n00:00:00,000 --> 00:00:01,500\n一\n\n2\n00:01:01,250 --> 01:01:40,000\n二\n");
  });

  it("辞書は上から順に置き換える", () => {
    expect(applyDictionary("GUIのURL", [{ from: "GUI", to: "ジーユーアイ" }])).toBe("ジーユーアイのURL");
  });

  it("テロップの区間は既定でステップ全体", () => {
    const tl = buildTimeline(
      [step({ caption: { text: "x" } }), step({ id: "b", caption: { text: "y", start: 1, end: 2 } })],
      new Map(),
    );
    expect(captionCues(tl)).toEqual([
      { start: 0, end: 10, text: "x" },
      { start: 11, end: 12, text: "y" },
    ]);
  });
});

describe("validate", () => {
  const base: Project = {
    format: "screen-annotator.project",
    version: 1,
    sources: [{ id: "rec", path: "a.mp4" }],
    steps: [],
  };

  it("仕様書の完全な例は通る", () => {
    const doc = readFileSync(new URL("../../docs/project-format.md", import.meta.url), "utf8");
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
    const full = blocks.findLast((b) => b.includes('"format"'));
    const r = parseProjectText(full ?? "");
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("知らない項目はエラー", () => {
    const r = parseProject({ ...base, steps: [{ ...step({ source: "rec" }), captoin: {} }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.path).toBe("steps[0]");
  });

  it("参照・重複・重なりを調べる", () => {
    const r = parseProject({
      ...base,
      steps: [
        step({ id: "a", source: "nope" }),
        step({
          id: "a",
          source: "rec",
          holds: [
            { at: 1, duration: 2 },
            { at: 2, duration: 1 },
          ],
        }),
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.map((e) => e.path)).toEqual(["steps[0].source", "steps[1].id", "steps[1].holds"]);
    }
  });
});

describe("edit", () => {
  const p: Project = {
    format: "screen-annotator.project",
    version: 1,
    sources: [{ id: "rec", path: "a.mp4" }],
    steps: [
      step({
        id: "a",
        caption: { text: "c" },
        holds: [
          { at: 1, duration: 1 },
          { at: 6, duration: 1 },
        ],
      }),
    ],
  };

  it("分割すると前半に要素が残り、後半は新しい id", () => {
    const r = splitStep(p, 0, 4, true);
    expect(r.steps.map((s) => [s.id, s.in, s.out])).toEqual([
      ["a", 10, 13],
      ["a-2", 13, 20],
    ]);
    expect(r.steps[0]?.holds).toEqual([{ at: 1, duration: 1 }]);
  });

  it("後半を捨てられる", () => {
    expect(splitStep(p, 0, 4, false).steps).toHaveLength(1);
  });

  it("複製は id を変える", () => {
    const r = duplicateStep(p, 0);
    expect(r.steps.map((s) => s.id)).toEqual(["a", "a-2"]);
    expect(uniqueStepId(r, "a-2")).toBe("a-3");
  });
});

describe("speech.start", () => {
  it("読み上げの終わりが映像より後なら、その分だけ長くなる", () => {
    expect(stepDuration(step({ speech: { text: "a", start: 8 } }), 4)).toBe(12);
    expect(stepDuration(step({ speech: { text: "a", start: 2 } }), 4)).toBe(10);
  });

  it("映像より後に始まる読み上げは検証エラー", () => {
    const r = parseProject(proj([step({ speech: { text: "a", start: 11 } })]));
    expect(r.ok).toBe(false);
  });
});

describe("trim", () => {
  const p = (s: Step): Project => proj([s]);

  it("Out は録画の長さで止まる", () => {
    expect(trimStep(p(step()), 0, "out", 99, 30).steps[0]?.out).toBe(30);
  });

  it("In を前へ広げると、要素の時刻を同じ分だけ後ろへずらす", () => {
    const s = step({
      caption: { text: "c", start: 1, end: 3 },
      zooms: [{ start: 2, end: 4, rect: { x: 0, y: 0, w: 10, h: 10 } }],
      holds: [{ at: 5, duration: 1 }],
      speech: { text: "s", start: 1 },
    });
    const out = trimStep(p(s), 0, "in", 8, 30).steps[0] as Step;
    expect(out.in).toBe(8);
    expect(out.caption).toMatchObject({ start: 3, end: 5 });
    expect(out.zooms?.[0]).toMatchObject({ start: 4, end: 6 });
    expect(out.holds?.[0]?.at).toBe(7);
    expect(out.speech?.start).toBe(3);
  });

  it("In を後ろへ詰めると、要素は前へずれ、はみ出した分は切り詰める", () => {
    const s = step({ speed: 2, zooms: [{ start: 0.5, end: 3, rect: { x: 0, y: 0, w: 10, h: 10 } }] });
    const out = trimStep(p(s), 0, "in", 12, 30).steps[0] as Step;
    // ソースで 2 秒 = 出力で 1 秒(speed 2)
    expect(out.zooms?.[0]).toMatchObject({ start: 0, end: 2 });
  });

  it("In は Out を越えない", () => {
    expect(trimStep(p(step()), 0, "in", 25, 30).steps[0]?.in).toBeCloseTo(19.9);
  });
});

describe("addHold", () => {
  const p = (s: Step): Project => proj([s]);

  it("保持を追加する", () => {
    expect(addHold(p(step()), 0, 2, 1.5).steps[0]?.holds).toEqual([{ at: 2, duration: 1.5 }]);
  });

  it("後ろの保持に重なる分は縮める。保持の途中には足さない", () => {
    const s = step({ holds: [{ at: 3, duration: 1 }] });
    expect(addHold(p(s), 0, 2, 5).steps[0]?.holds).toEqual([
      { at: 2, duration: 1 },
      { at: 3, duration: 1 },
    ]);
    expect(addHold(p(s), 0, 3.5, 1).steps[0]?.holds).toHaveLength(1);
  });
});
