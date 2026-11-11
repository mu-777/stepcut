import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { captionCues } from "./captions";
import {
  captionBoxColor,
  isImageSource,
  type ResolvedLayout,
  resolveCaptionPlacement,
  resolveLayout,
  resolveSpeech,
  speechText,
  zoomTransition,
} from "./defaults";
import {
  addHold,
  canMergeSteps,
  clearStepLayout,
  duplicateStep,
  followCaptions,
  makeStepLayoutCommon,
  mergeSteps,
  resizeImageStepStart,
  setStepLayout,
  splitStep,
  trimStep,
  uniqueStepId,
} from "./edit";
import {
  computeLayout,
  marginOf,
  rectScale,
  resetRectAspect,
  retimeZoom,
  setZoomKeyRect,
  videoBoxFor,
  viewRectAt,
  zoomProgress,
  zoomRectAt,
  zoomScale,
  zoomViewRect,
} from "./layout";
import { migrateProject } from "./migrate";
import type { Project, Step } from "./schema";
import { applyDictionary, toSrt, wrapText } from "./text";
import {
  baseDuration,
  buildTimeline,
  continuousRuns,
  locate,
  sourceSegments,
  sourceTimeAt,
  speechTimes,
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
    const s = step({
      zooms: [{ start: 2, end: 5, keys: [{ t: 2, rect: { x: 0, y: 0, w: 10, h: 10 } }], hold: true }],
    });
    expect(baseDuration(s)).toBe(13);
    expect(sourceTimeAt(s, 4)).toBe(12);
  });

  it("読み上げが長いと最終フレームで保持する", () => {
    const s = step();
    expect(stepDuration(step({ speech: { text: "a" } }), [15])).toBe(15);
    expect(stepDuration(step({ speech: { text: "a" } }), [5])).toBe(10);
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
    const tl = buildTimeline(
      [step({ id: "a" }), step({ id: "b", in: 0, out: 2, speech: { text: "x" } })],
      new Map([["b", [5]]]),
    );
    expect(totalDuration(tl)).toBe(15);
    expect(locate(tl, 12)?.entry.step.id).toBe("b");
    expect(locate(tl, 12)?.local).toBe(2);
  });
});

describe("layout", () => {
  const layout: ResolvedLayout = {
    background: "#000000",
    margin: { top: 0.04, right: 0.0225, bottom: 0.2, left: 0.0225 },
    fit: "contain",
    shadow: true,
  };

  it("余白を除いた領域に、縦横比を保って収める", () => {
    const l = computeLayout(1920, 1080, layout, 1920, 1080);
    expect(l.video.y).toBeCloseTo(43.2);
    expect(l.video.h).toBeCloseTo(1080 - 216 - 43.2);
    expect(l.video.w / l.video.h).toBeCloseTo(16 / 9);
    expect(l.crop).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("余白なしは全面", () => {
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(computeLayout(1920, 1080, { ...layout, margin: zero }, 1920, 1080).video).toEqual({
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
    });
  });

  it("cover は領域いっぱいに描き、録画の端を切り取る", () => {
    const m = { top: 0, right: 0.25, bottom: 0, left: 0.25 };
    const l = computeLayout(1920, 1080, { ...layout, margin: m, fit: "cover" }, 1920, 1080);
    expect(l.video).toEqual({ x: 480, y: 0, w: 960, h: 1080 });
    expect(l.crop.w / l.crop.h).toBeCloseTo(960 / 1080);
    expect(l.crop.h).toBe(1080);
    expect(marginOf(l.video, 1920, 1080)).toEqual(m);
  });

  it("旧い書き方(帯あり・全画面)を余白に直す", () => {
    const band = migrateProject({ layout: { mode: "band", margin: 0.04, bandHeight: 0.2 } }) as Project;
    expect(band.layout?.margin).toEqual({ top: 0.04, right: 0.0225, bottom: 0.2, left: 0.0225 });
    const full = migrateProject({ layout: { mode: "full" } }) as Project;
    expect(full.layout?.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(parseProject({ ...proj([]), layout: { mode: "band", shadow: true } }).ok).toBe(true);
  });

  it("背景は色・グラデーション・画像を受け付け、既定はプリセット画像", () => {
    const ok = (background: unknown) => parseProject({ ...proj([]), layout: { background } }).ok;
    expect(ok("#112233")).toBe(true);
    expect(ok({ gradient: { angle: 135, colors: ["#000000", "#FFFFFF"] } })).toBe(true);
    expect(ok({ gradient: { colors: ["#000000"] } })).toBe(false);
    expect(ok({ image: "preset:mist" })).toBe(true);
    expect(resolveLayout(proj([])).background).toEqual({ image: "preset:default" });
  });

  it("ズームの枠は必ず見せる範囲。表示の縦横比に合わせて広げ、録画の中に収める", () => {
    expect(zoomViewRect({ x: 1800, y: 0, w: 400, h: 100 }, 16 / 9, 1920, 1080)).toEqual({
      x: 1520,
      y: 0,
      w: 400,
      h: 225,
    });
    expect(zoomViewRect({ x: 900, y: 0, w: 100, h: 900 }, 16 / 9, 1920, 1080).w).toBeCloseTo(1600);
  });

  it("帯の区間は拡大したまま。拡大は start の手前、縮小は end の後ろで動く", () => {
    const z = { start: 1, end: 3, keys: [{ t: 1, rect: { x: 0, y: 0, w: 960, h: 540 } }] };
    expect(zoomProgress(z, 0.4, 0.5)).toBe(0);
    expect(zoomProgress(z, 0.75, 0.5)).toBeCloseTo(0.5);
    expect(zoomProgress(z, 1, 0.5)).toBe(1);
    expect(zoomProgress(z, 3.25, 0.5)).toBeCloseTo(0.5);
    expect(viewRectAt(step({ zooms: [z] }), 2, 1920, 1080)).toEqual({ x: 0, y: 0, w: 960, h: 540 });
  });

  it("動きの秒数は倍率から決まる。transition: 0 なら瞬時", () => {
    const z = { start: 1, end: 3, keys: [{ t: 1, rect: { x: 0, y: 0, w: 960, h: 540 } }] };
    expect(zoomTransition(z, 2)).toBeCloseTo(0.6 + 0.55 * Math.log(2));
    const v = viewRectAt(step({ zooms: [{ ...z, transition: 0 }] }), 0.99, 1920, 1080);
    expect(v.w).toBe(1920);
  });

  it("間が 1.5 秒未満のズームは戻らずに次の範囲へ移る", () => {
    const a = { start: 0, end: 1, keys: [{ t: 0, rect: { x: 0, y: 0, w: 960, h: 540 } }] };
    const b = { start: 2, end: 3, keys: [{ t: 2, rect: { x: 960, y: 540, w: 960, h: 540 } }] };
    const mid = viewRectAt(step({ zooms: [a, b] }), 1.5, 1920, 1080);
    expect(mid.w).toBe(960);
    expect(mid.x).toBeCloseTo(480);
  });

  it("ズーム中は既定で映像を止める", () => {
    const z = { start: 1, end: 3, keys: [{ t: 1, rect: { x: 0, y: 0, w: 960, h: 540 } }] };
    expect(baseDuration(step({ zooms: [z] }))).toBe(12);
    expect(baseDuration(step({ zooms: [{ ...z, hold: false }] }))).toBe(10);
  });
});

describe("caption and speech", () => {
  it("テロップの位置はステップ → プロジェクト → 既定の順で決まる", () => {
    const p = { ...proj([]), styles: { caption: { position: { x: 0.5, y: 0.1 } } } };
    expect(resolveCaptionPlacement(p, step({ caption: { text: "a" } })).position).toEqual({ x: 0.5, y: 0.1 });
    const own = step({ caption: { text: "a", position: { x: 0.2, y: 0.3 } } });
    expect(resolveCaptionPlacement(p, own).position).toEqual({ x: 0.2, y: 0.3 });
    expect(resolveCaptionPlacement(proj([]), own).width).toBe(0.8);
  });

  it("speech.text がなければテロップの文を読む。speech がなければ読まない", () => {
    expect(speechText(step({ caption: { text: "保存します" }, speech: {} }))).toBe("保存します");
    expect(speechText(step({ caption: { text: "保存" }, speech: { text: "ほぞん" } }))).toBe("ほぞん");
    expect(speechText(step({ caption: { text: "保存" } }))).toBeNull();
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
    // 後半には空のテロップを付ける(プレビューに仮の文を出す)
    expect(r.steps[1]?.caption).toEqual({ text: "" });
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
    expect(stepDuration(step({ speech: { text: "a", start: 8 } }), [4])).toBe(12);
    expect(stepDuration(step({ speech: { text: "a", start: 2 } }), [4])).toBe(10);
  });

  it("映像より後に始まる読み上げは検証エラー", () => {
    const r = parseProject(proj([step({ speech: { text: "a", start: 11 } })]));
    expect(r.ok).toBe(false);
  });
});

describe("trim", () => {
  const p = (s: Step): Project => proj([s]);

  it("素材が画像かは拡張子で決める", () => {
    expect(isImageSource("shots/a.PNG")).toBe(true);
    expect(isImageSource("C:\\x\\b.jpeg")).toBe(true);
    expect(isImageSource("rec.mp4")).toBe(false);
    expect(isImageSource("png")).toBe(false);
  });

  it("画像のステップは左端で長さを変え、in は 0 のまま、要素は伸びた分だけ後ろへずれる", () => {
    const s = step({ in: 0, out: 3, caption: { text: "c", start: 1 } });
    const longer = resizeImageStepStart(p(s), 0, 5).steps[0] as Step;
    expect(longer).toMatchObject({ in: 0, out: 5, caption: { start: 3 } });
    const shorter = resizeImageStepStart(p(longer), 0, 0.01).steps[0] as Step;
    expect(shorter.out).toBe(0.1);
  });

  it("Out は録画の長さで止まる", () => {
    expect(trimStep(p(step()), 0, "out", 99, 30).steps[0]?.out).toBe(30);
  });

  it("In を前へ広げると、要素の時刻を同じ分だけ後ろへずらす", () => {
    const s = step({
      caption: { text: "c", start: 1, end: 3 },
      zooms: [{ start: 2, end: 4, keys: [{ t: 2, rect: { x: 0, y: 0, w: 10, h: 10 } }] }],
      holds: [{ at: 5, duration: 1 }],
      speech: { text: "s", start: 1 },
    });
    const out = trimStep(p(s), 0, "in", 8, 30).steps[0] as Step;
    expect(out.in).toBe(8);
    expect(out.caption).toMatchObject({ start: 3, end: 5 });
    expect(out.zooms?.[0]).toMatchObject({ start: 4, end: 6 });
    expect(out.holds?.[0]?.at).toBe(7);
    expect(out.speech).toMatchObject({ start: 3 });
  });

  it("In を後ろへ詰めると、要素は前へずれ、はみ出した分は切り詰める", () => {
    const s = step({
      speed: 2,
      zooms: [{ start: 0.5, end: 3, keys: [{ t: 0.5, rect: { x: 0, y: 0, w: 10, h: 10 } }] }],
    });
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

describe("複数の読み上げ", () => {
  const s = step({
    caption: { text: "前半と後半" },
    speech: [{}, { text: "後半", start: 6 }, { text: "続き" }],
  });

  it("最初はテロップの文、2 つ目からは書いた文を読む", () => {
    expect(speechText(s, 0)).toBe("前半と後半");
    expect(speechText(s, 1)).toBe("後半");
    expect(speechText(step({ speech: [{ text: "a" }, {}] }), 1)).toBeNull();
  });

  it("開始を書かなければ前の読み上げの直後。ステップは最後の読み上げの終わりまで伸びる", () => {
    expect(speechTimes(s, [2, 3, 4])).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 9 },
      { start: 9, end: 13 },
    ]);
    expect(stepDuration(s, [2, 3, 4])).toBe(13);
  });

  it("2 つ目以降の声は最初の読み上げに合わせる", () => {
    const v = step({ speech: [{ voice: "A", params: { rate: 1.2 } }, { text: "b" }] });
    expect(resolveSpeech(proj([v]), v, 1)).toMatchObject({ voice: "A", params: { rate: 1.2 } });
  });

  it("配置を検証する", () => {
    expect(parseProject(proj([s])).ok).toBe(true);
    expect(parseProject(proj([step({ speech: [] as never })])).ok).toBe(false);
  });
});

describe("ステップをまとめる", () => {
  const a = step({ id: "a", in: 0, out: 4, caption: { text: "同じ" }, speech: {} });
  const b = step({
    id: "b",
    in: 4,
    out: 10,
    caption: { text: "同じ" },
    speech: {},
    zooms: [{ start: 1, end: 2, keys: [{ t: 1, rect: { x: 0, y: 0, w: 10, h: 10 } }] }],
  });

  it("同じ録画の続いた区間だけまとめられる", () => {
    expect(canMergeSteps(proj([a, b]), 0)).toBe(true);
    expect(canMergeSteps(proj([a, { ...b, in: 5 }]), 0)).toBe(false);
    expect(canMergeSteps(proj([a, { ...b, speed: 2 }]), 0)).toBe(false);
  });

  it("後ろの要素は前の長さ(自動保持を含む)だけずらし、自動保持は明示した保持にする", () => {
    const r = mergeSteps(proj([a, b]), 0, 5);
    expect(r.steps).toHaveLength(1);
    const m = r.steps[0] as Step;
    expect(m).toMatchObject({ id: "a", in: 0, out: 10, caption: { text: "同じ" } });
    expect(m.holds).toEqual([{ at: 4, duration: 1 }]);
    // hold が既定(true)のズームも保持になる
    expect(m.zooms?.[0]).toMatchObject({ start: 6, end: 7 });
    expect(m.speech).toEqual([{}, { text: "同じ", start: 5 }]);
    expect(parseProject(r).ok).toBe(true);
  });

  it("違う文のテロップは改行でつなぎ、テロップと一致の読み上げは元の文を書き出す", () => {
    const r = mergeSteps(proj([a, { ...b, caption: { text: "別" } }]), 0);
    const m = r.steps[0] as Step;
    expect(m.caption?.text).toBe("同じ\n別");
    expect(m.speech).toEqual([{ text: "同じ" }, { text: "別", start: 4 }]);
  });
});

describe("ズームの枠(キーフレーム)と表示", () => {
  const r0 = { x: 0, y: 0, w: 960, h: 540 };
  const r1 = { x: 960, y: 0, w: 960, h: 540 };
  const r2 = { x: 960, y: 540, w: 960, h: 540 };
  const z = {
    start: 2,
    end: 6,
    keys: [
      { t: 2, rect: r0 },
      { t: 3, rect: r1 },
      { t: 6, rect: r2 },
    ],
  };

  it("枠と枠の間を一定の速さで移り、最初の枠より前・最後の枠より後は止まる", () => {
    expect(zoomRectAt(z, 1)).toEqual(r0);
    expect(zoomRectAt(z, 2.5)).toEqual({ x: 480, y: 0, w: 960, h: 540 });
    expect(zoomRectAt(z, 4.5)).toEqual({ x: 960, y: 270, w: 960, h: 540 });
    expect(zoomRectAt(z, 7)).toEqual(r2);
    const s = step({ zooms: [{ ...z, transition: 0 }] });
    expect(viewRectAt(s, 2.5, 1920, 1080)).toEqual({ x: 480, y: 0, w: 960, h: 540 });
  });

  it("区間を動かすと枠の時刻もずれ、長さを変えると端の枠は端へ、間の枠は区間に収める", () => {
    expect(retimeZoom(z, 3, 7).keys.map((k) => k.t)).toEqual([3, 4, 7]);
    expect(retimeZoom(z, 2, 8).keys.map((k) => k.t)).toEqual([2, 3, 8]);
    expect(retimeZoom(z, 4, 6).keys.map((k) => k.t)).toEqual([4, 4, 6]);
  });

  it("サイズをそろえると、ほかの枠も同じ大きさになり中心は保つ", () => {
    const big = { x: 0, y: 0, w: 1200, h: 600 };
    const out = setZoomKeyRect(z, 0, big, true, 1920, 1080);
    // 中心(1440)を保つと右へはみ出すので、録画の範囲に収める
    expect(out.keys[1]?.rect).toEqual({ x: 720, y: 0, w: 1200, h: 600 });
    expect(setZoomKeyRect(z, 0, big, false, 1920, 1080).keys[1]?.rect).toEqual(r1);
  });

  it("既定は枠どおりの範囲を映し、描く領域を枠の縦横比で余白の内側に収める", () => {
    const e = { start: 0, end: 1, keys: [{ t: 0, rect: { x: 100, y: 100, w: 400, h: 400 } }], transition: 0 };
    const view = viewRectAt(step({ zooms: [e] }), 0.5, 1920, 1080);
    expect(view).toEqual({ x: 100, y: 100, w: 400, h: 400 });
    expect(videoBoxFor(view, { x: 0, y: 0, w: 1920, h: 1080 })).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
    expect(zoomScale(e, { x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080)).toBeCloseTo(2.7);
    // keepAspect なら録画の縦横比に広げる
    const k = viewRectAt(step({ zooms: [{ ...e, keepAspect: true }] }), 0.5, 1920, 1080);
    expect(k.w / k.h).toBeCloseTo(16 / 9);
  });

  it("縦横比を戻すと倍率と中心を保つ", () => {
    const base = { x: 0, y: 0, w: 1920, h: 1080 };
    const sq = { x: 760, y: 340, w: 400, h: 400 };
    const r = resetRectAspect(sq, false, base, 1920, 1080);
    expect(r.w / r.h).toBeCloseTo(16 / 9, 2);
    expect(Math.abs(r.x + r.w / 2 - 960)).toBeLessThanOrEqual(1);
    expect(rectScale(r, false, base, 1920, 1080)).toBeCloseTo(rectScale(sq, false, base, 1920, 1080), 2);
  });

  it("枠の時刻は区間の中で、早い順に並べる", () => {
    expect(parseProject(proj([step({ zooms: [z] })])).ok).toBe(true);
    const bad = {
      ...z,
      keys: [
        { t: 3, rect: r1 },
        { t: 2, rect: r0 },
      ],
    };
    expect(parseProject(proj([step({ zooms: [bad] })])).ok).toBe(false);
    expect(parseProject(proj([step({ zooms: [{ ...z, keys: [{ t: 9, rect: r0 }] }] })])).ok).toBe(false);
  });
});

describe("テロップの背景", () => {
  it("透明と旧い auto は箱なし", () => {
    expect(captionBoxColor("auto")).toBeNull();
    expect(captionBoxColor("#00000000")).toBeNull();
    expect(captionBoxColor("#000000AA")).toBe("#000000AA");
  });
});

describe("再生で読み続ける区間", () => {
  it("同じ録画で Out = In なら 1 つにまとめ、飛んだ箇所や別の録画で分ける", () => {
    const tl = buildTimeline(
      [
        step({ id: "a", in: 0, out: 4 }),
        step({ id: "b", in: 4, out: 6 }),
        step({ id: "c", in: 7, out: 8 }),
        step({ id: "d", source: "rec2", in: 8, out: 9 }),
      ],
      new Map(),
    );
    expect(continuousRuns(tl)).toEqual([
      { from: 0, to: 1, start: 0, end: 6 },
      { from: 2, to: 2, start: 6, end: 7 },
      { from: 3, to: 3, start: 7, end: 8 },
    ]);
    expect(continuousRuns(tl, 1)[0]).toEqual({ from: 1, to: 1, start: 4, end: 6 });
  });
});

describe("ステップごとの録画の枠", () => {
  const p = proj([step(), step({ id: "b" })]);
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };

  it("書いた項目だけ全体の枠を上書きする", () => {
    const q = setStepLayout({ ...p, layout: { shadow: false, fit: "cover" } }, 0, { margin: zero });
    expect(resolveLayout(q, q.steps[0])).toMatchObject({ margin: zero, fit: "cover", shadow: false });
    expect(resolveLayout(q, q.steps[1]).margin).toEqual(resolveLayout(q).margin);
  });

  it("undefined を渡した項目は消え、何も残らなければ layout ごと消す", () => {
    const q = setStepLayout(p, 0, { margin: zero });
    expect(setStepLayout(q, 0, { margin: undefined }).steps[0]?.layout).toBeUndefined();
    expect(clearStepLayout(q, 0).steps[0]?.layout).toBeUndefined();
  });

  it("この枠を共通にする: 全体の枠にして、そのステップの上書きを消す", () => {
    const q = makeStepLayoutCommon(setStepLayout(p, 0, { margin: zero, fit: "contain" }), 0);
    expect(q.layout?.margin).toEqual(zero);
    expect(q.layout?.fit).toBeUndefined();
    expect(q.steps[0]?.layout).toBeUndefined();
  });
});

describe("録画の枠に合わせてテロップを動かす(followCaptions)", () => {
  const base = (margin: { top: number; right: number; bottom: number; left: number }) =>
    ({
      format: "screen-annotator.project",
      version: 1,
      sources: [{ id: "r", path: "a.mp4" }],
      layout: { margin },
      styles: { caption: { position: { x: 0.5, y: 0.9 } } },
      steps: [
        { id: "a", source: "r", in: 0, out: 1, caption: { text: "x", position: { x: 0.25, y: 0.5 } } },
        { id: "b", source: "r", in: 1, out: 2, caption: { text: "y" } },
      ],
    }) as unknown as Project;

  it("下の余白にあるテロップは、余白の中の同じ割合の位置へ", () => {
    const prev = base({ top: 0.1, right: 0.1, bottom: 0.2, left: 0.1 });
    const next = followCaptions(prev, base({ top: 0.1, right: 0.1, bottom: 0.4, left: 0.1 }));
    // 下の余白 0.8〜1 の真ん中(0.9) → 0.6〜1 の真ん中(0.8)
    expect(next.styles?.caption?.position).toEqual({ x: 0.5, y: 0.8 });
  });

  it("録画の中にあるテロップは、録画の中の同じ割合の位置へ。位置を書いていないステップは変えない", () => {
    const prev = base({ top: 0, right: 0, bottom: 0, left: 0 });
    const next = followCaptions(prev, base({ top: 0, right: 0.5, bottom: 0, left: 0 }));
    expect(next.steps[0]?.caption?.position).toEqual({ x: 0.125, y: 0.5 });
    expect(next.steps[1]?.caption?.position).toBeUndefined();
  });

  it("ステップだけの枠を変えると、そのステップのテロップだけが動く(全体の位置を使っていれば自分の位置として書く)", () => {
    const prev = base({ top: 0.1, right: 0.1, bottom: 0.2, left: 0.1 });
    const next = followCaptions(
      prev,
      setStepLayout(prev, 1, { margin: { top: 0.1, right: 0.1, bottom: 0.4, left: 0.1 } }),
    );
    expect(next.styles?.caption?.position).toEqual({ x: 0.5, y: 0.9 });
    expect(next.steps[1]?.caption?.position).toEqual({ x: 0.5, y: 0.8 });
    expect(next.steps[0]?.caption?.position).toEqual({ x: 0.25, y: 0.5 });
  });

  it("全体の枠を変えても、自分の枠を持つステップのテロップは動かない", () => {
    const own = setStepLayout(base({ top: 0.1, right: 0.1, bottom: 0.2, left: 0.1 }), 1, { fit: "cover" });
    const prev = setStepLayout(own, 1, { margin: { top: 0.1, right: 0.1, bottom: 0.2, left: 0.1 } });
    const next = followCaptions(prev, {
      ...prev,
      layout: { margin: { top: 0.1, right: 0.1, bottom: 0.4, left: 0.1 } },
    });
    expect(next.styles?.caption?.position).toEqual({ x: 0.5, y: 0.8 });
    expect(next.steps[1]?.caption?.position).toEqual({ x: 0.5, y: 0.9 });
  });

  it("枠が変わらなければそのまま", () => {
    const p = base({ top: 0.1, right: 0.1, bottom: 0.2, left: 0.1 });
    const q = { ...p, steps: [...p.steps] };
    expect(followCaptions(p, q)).toBe(q);
  });
});
