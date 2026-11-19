import { describe, expect, it } from "vitest";
import { shiftStepElements, splitStep } from "./edit";
import {
  arrowPolygon,
  highlightPathAt,
  isPath,
  isScreenAnchored,
  moveObject,
  objectAlpha,
  objectImages,
  objectWindow,
  pointerAt,
  reanchorShape,
  resolveRectStyle,
  resolveTransition,
  retimeObject,
  shapeOutsideVideo,
  stepObjects,
  transitionSpec,
} from "./objects";
import type { Pointer, Project, Shape, Step } from "./schema";
import { parseProject } from "./validate";

const base: Project = {
  format: "stepcut.project",
  version: 1,
  sources: [{ id: "a", path: "a.mp4" }],
  steps: [],
};
const pointer: Pointer = {
  mode: "line",
  path: [
    { t: 1, x: 0, y: 0 },
    { t: 2, x: 100, y: 50 },
  ],
  end: 4,
};
const highlight: Pointer = {
  mode: "line",
  path: [
    { t: 1, x: 0, y: 10 },
    { t: 3, x: 200, y: 10 },
  ],
  style: { preset: "highlighter" },
};
const image: Shape = { type: "rect", start: 2, rect: { x: 0, y: 0, w: 10, h: 10 }, image: "img/logo.png" };

describe("オブジェクト", () => {
  it("出ている間: 最初の点か start から、end(なければステップの終わり)まで", () => {
    expect(objectWindow(pointer, 10)).toEqual({ start: 1, end: 4 });
    expect(objectWindow(highlight, 10)).toEqual({ start: 1, end: 10 });
    expect(objectWindow(image, 8)).toEqual({ start: 2, end: 8 });
  });

  it("点の列を持つのはポインターだけ", () => {
    expect(isPath(image)).toBe(false);
    expect(isPath(pointer)).toBe(true);
  });

  it("ポインターは点の間をゆっくり動き出して止まり、前後は端の点にいる", () => {
    expect(pointerAt(pointer, 0)).toMatchObject({ x: 0, y: 0 });
    expect(pointerAt(pointer, 1.5)).toEqual({ x: 50, y: 25 });
    expect(pointerAt(pointer, 1.25).x).toBeLessThan(25);
    expect(pointerAt(pointer, 9)).toMatchObject({ x: 100, y: 50 });
  });

  it("蛍光ペンは時刻までの線を引く", () => {
    expect(highlightPathAt(highlight, 0.5)).toEqual([]);
    expect(highlightPathAt(highlight, 2)).toEqual([
      { t: 1, x: 0, y: 10 },
      { x: 100, y: 10 },
    ]);
    expect(highlightPathAt(highlight, 5)).toHaveLength(2);
  });

  it("フェードと点滅", () => {
    const w = { start: 1, end: 5 };
    expect(objectAlpha(w, undefined, undefined, 0.5)).toBe(0);
    expect(objectAlpha(w, undefined, undefined, 1)).toBe(1);
    expect(objectAlpha(w, "fade", undefined, 1.15)).toBeCloseTo(0.5);
    expect(objectAlpha(w, undefined, "fade", 4.85)).toBeCloseTo(0.5);
    // 点滅は 0.6 秒を 6 つに分け、消・点 を繰り返す
    expect(objectAlpha(w, "flash", undefined, 1.05)).toBe(0);
    expect(objectAlpha(w, "flash", undefined, 1.15)).toBe(1);
    expect(objectAlpha(w, "flash", undefined, 2)).toBe(1);
    expect(objectAlpha(w, undefined, undefined, 5)).toBe(0);
    // 長さと回数を書ける: 1 秒で 2 回なら 0.25 秒ごとに 消・点
    const flash2 = { type: "flash" as const, duration: 1, count: 2 };
    expect(objectAlpha(w, flash2, undefined, 1.2)).toBe(0);
    expect(objectAlpha(w, flash2, undefined, 1.3)).toBe(1);
    expect(objectAlpha(w, flash2, undefined, 1.6)).toBe(0);
    expect(objectAlpha(w, flash2, undefined, 1.8)).toBe(1);
    expect(objectAlpha(w, { type: "fade", duration: 1 }, undefined, 1.5)).toBeCloseTo(0.5);
    // 長さを出ている間と同じにすると、出ている間ずっと均等に点滅する(0〜3 秒に 3 回なら 0.5 秒ごとに 消・点)
    const whole = { start: 0, end: 3 };
    const flash3 = { type: "flash" as const, duration: 3, count: 3 };
    expect([0.25, 0.75, 1.25, 1.75, 2.25, 2.75].map((t) => objectAlpha(whole, flash3, undefined, t))).toEqual(
      [0, 1, 0, 1, 0, 1],
    );
  });

  it("現れ方は既定の長さ・回数なら種類だけを書く", () => {
    expect(transitionSpec("none", 1)).toBeUndefined();
    expect(transitionSpec("fade", 0.3)).toBe("fade");
    expect(transitionSpec("fade", 1)).toEqual({ type: "fade", duration: 1 });
    expect(transitionSpec("flash", undefined, 5)).toEqual({ type: "flash", count: 5 });
    expect(resolveTransition("flash")).toEqual({ type: "flash", duration: 0.6, count: 3 });
  });

  it("出ている間を変えると、ポインターは動きごとずれる", () => {
    const p = retimeObject(pointer, 2, null);
    expect(p.path.map((x) => x.t)).toEqual([2, 3]);
    expect(p.end).toBeUndefined();
    expect(retimeObject(image, 1, 3)).toMatchObject({ start: 1, end: 3 });
  });

  it("描く順は 蛍光ペンのポインター → 図形 → ほかのポインター", () => {
    const step = { pointers: [pointer, highlight], shapes: [image] } as unknown as Step;
    expect(stepObjects(step, base)).toEqual([
      { kind: "pointer", index: 1 },
      { kind: "shape", index: 0 },
      { kind: "pointer", index: 0 },
    ]);
  });

  it("録画に追従する図形が録画の外にはみ出しているか", () => {
    const r = (x: number): Shape => ({ type: "rect", start: 0, rect: { x, y: 0, w: 100, h: 100 } });
    expect(shapeOutsideVideo(r(0), 1920, 1080)).toBe(false);
    expect(shapeOutsideVideo(r(1900), 1920, 1080)).toBe(true);
    expect(shapeOutsideVideo({ ...r(-10), anchor: "screen" }, 1920, 1080)).toBe(false);
    expect(shapeOutsideVideo(pointer, 10, 10)).toBe(false);
  });

  it("旧い蛍光ペン(highlights)は見た目が蛍光ペンのポインターとして読む", () => {
    const r = parseProject({
      ...base,
      styles: { highlighter: { color: "#00FF00" } },
      steps: [{ id: "s", source: "a", in: 0, out: 5, highlights: [{ mode: "line", path: highlight.path }] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.project.styles).toEqual({});
      expect(r.project.steps[0]?.pointers?.[0]?.style).toEqual({ preset: "highlighter", color: "#00FF00" });
    }
  });

  it("矢印の輪郭は先端を通る 7 点", () => {
    const poly = arrowPolygon({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 3);
    expect(poly).toHaveLength(7);
    expect(poly[3]).toEqual({ x: 100, y: 0 });
    expect(poly[2]?.x).toBeCloseTo(70);
  });

  it("見た目は 個別 → 共通 → 既定 の順に決まる", () => {
    const rect: Shape = {
      type: "rect",
      start: 0,
      rect: { x: 0, y: 0, w: 1, h: 1 },
      style: { fillOpacity: 0.5 },
    };
    const p: Project = { ...base, styles: { rect: { stroke: "#00FF00", fillOpacity: 0.2 } } };
    expect(resolveRectStyle(p, rect)).toMatchObject({ stroke: "#00FF00", fillOpacity: 0.5, strokeWidth: 6 });
  });

  it("座標の基準を変えると、位置と書いてある太さ・文字の大きさを換算する", () => {
    const rect: Shape = {
      type: "rect",
      start: 0,
      rect: { x: 100, y: 50, w: 200, h: 100 },
      style: { strokeWidth: 4 },
    };
    // 映像側 → 画面側: 0.5 倍して (10, 20) ずらす
    const s = reanchorShape(rect, "screen", (p) => ({ x: p.x * 0.5 + 10, y: p.y * 0.5 + 20 }), 0.5);
    expect(isScreenAnchored(s)).toBe(true);
    expect(s).toMatchObject({ rect: { x: 60, y: 45, w: 100, h: 50 }, style: { strokeWidth: 2 } });
    const back = reanchorShape(s, "video", (p) => ({ x: (p.x - 10) * 2, y: (p.y - 20) * 2 }), 2);
    expect(back).toEqual(rect);
    const text: Shape = {
      type: "text",
      start: 0,
      rect: { x: 0, y: 0, w: 10, h: 10 },
      text: "a",
      style: { size: 40 },
    };
    expect(reanchorShape(text, "screen", (p) => p, 0.5)).toMatchObject({ style: { size: 20 } });
    const arrow: Shape = { type: "arrow", start: 0, from: { x: 0, y: 0 }, to: { x: 10, y: 0 } };
    expect(reanchorShape(arrow, "screen", (p) => ({ x: p.x * 2, y: p.y }), 2)).toMatchObject({
      to: { x: 20, y: 0 },
    });
    expect(parseProject({ ...base, steps: [{ id: "s", source: "a", in: 0, out: 5, shapes: [s] }] }).ok).toBe(
      true,
    );
  });

  it("使う画像の一覧", () => {
    const p: Project = {
      ...base,
      styles: { pointer: { image: "cur.png" } },
      steps: [
        {
          id: "s",
          source: "a",
          in: 0,
          out: 5,
          shapes: [image],
          pointers: [{ ...pointer, style: { image: "h.png" } }],
        },
      ],
    };
    expect(objectImages(p).sort()).toEqual(["cur.png", "h.png", "img/logo.png"]);
  });

  it("In を動かすと要素の時刻をずらし、0 より前は 0 に詰める(消さない)", () => {
    const step: Step = { id: "s", source: "a", in: 0, out: 10, pointers: [pointer], shapes: [image] };
    const shifted = shiftStepElements(step, -1.5);
    expect(shifted.pointers?.[0]?.path.map((x) => x.t)).toEqual([0, 0.5]);
    expect(shifted.shapes?.[0]).toMatchObject({ start: 0.5 });
    // 出ている間が丸ごと前にはみ出したものは消す
    expect(shiftStepElements(step, -5).pointers).toBeUndefined();
  });

  it("分割すると、前半には分割点より前に始まる要素だけを残す", () => {
    const p: Project = {
      ...base,
      steps: [
        { id: "s", source: "a", in: 0, out: 10, pointers: [pointer], shapes: [{ ...image, start: 6 }] },
      ],
    };
    const r = splitStep(p, 0, 5, true);
    expect(r.steps[0]?.pointers).toHaveLength(1);
    expect(r.steps[0]?.shapes).toBeUndefined();
  });

  it("分割点をまたいで出ている要素は、前半のステップの終わりまで出す", () => {
    const p: Project = {
      ...base,
      steps: [{ id: "s", source: "a", in: 0, out: 10, pointers: [{ ...pointer, end: 8 }], shapes: [image] }],
    };
    const r = splitStep(p, 0, 1.5, true);
    const ptr = r.steps[0]?.pointers?.[0];
    expect(ptr?.end).toBeUndefined();
    expect(ptr?.path.map((x) => x.t)).toEqual([1, 1.5]);
    expect(splitStep(p, 0, 3, true).steps[0]?.shapes?.[0]?.end).toBeUndefined();
  });

  it("検証: 図形の種類ごとの形と、時刻の順", () => {
    const ok = parseProject({
      ...base,
      steps: [
        {
          id: "s",
          source: "a",
          in: 0,
          out: 5,
          shapes: [
            { type: "rect", start: 0, rect: { x: 0, y: 0, w: 10, h: 10 }, style: { fillOpacity: 0.3 } },
            { type: "arrow", start: 1, end: 3, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } },
            {
              type: "text",
              start: 0,
              rect: { x: 0, y: 0, w: 10, h: 10 },
              text: "a",
              style: { align: "left" },
            },
            image,
          ],
          pointers: [{ ...pointer, click: true }],
        },
      ],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.warnings).toEqual([]);
    const bad = parseProject({
      ...base,
      steps: [
        {
          id: "s",
          source: "a",
          in: 0,
          out: 5,
          shapes: [{ type: "arrow", start: 2, end: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }],
          pointers: [
            {
              mode: "line",
              path: [
                { t: 2, x: 0, y: 0 },
                { t: 1, x: 1, y: 0 },
              ],
            },
          ],
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.errors.map((e) => e.path).sort()).toEqual([
        "steps[0].pointers[0].path[1].t",
        "steps[0].shapes[0].end",
      ]);
    const unknown = parseProject({
      ...base,
      steps: [{ id: "s", source: "a", in: 0, out: 5, shapes: [{ type: "star", start: 0 }] }],
    });
    expect(unknown.ok).toBe(false);
  });
});

describe("位置をずらす", () => {
  it("ポインターは軌跡ごと、図形は枠・両端を動かす", () => {
    expect(moveObject(pointer, 10, -1).path.map((p) => [p.x, p.y])).toEqual(
      pointer.path.map((p) => [p.x + 10, p.y - 1]),
    );
    expect(moveObject(image, 1, 2)).toMatchObject({ rect: { x: 1, y: 2, w: 10, h: 10 } });
    const arrow: Shape = { type: "arrow", start: 0, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } };
    expect(moveObject(arrow, -1, 1)).toMatchObject({ from: { x: -1, y: 1 }, to: { x: 4, y: 6 } });
  });
});
