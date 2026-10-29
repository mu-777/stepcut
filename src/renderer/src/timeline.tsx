// タイムライン(UI-03, UI-04)。トラックは固定(映像・テロップ・読み上げ・ズーム)。
// 目盛りと全トラックで同じ「時刻→ピクセル」変換(x = 時刻 × pps)を使い、表示がずれないようにする。
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { captionWindow } from "../../core/captions";
import { stepSpeed, zoomTransition } from "../../core/defaults";
import { addHold, splitStep, trimStep } from "../../core/edit";
import type { Project, Step, Zoom } from "../../core/schema";
import { baseDuration, sourceTimeAt, speechStart, stepHolds, type TimelineEntry } from "../../core/timeline";
import { t } from "./i18n";
import type { SourceMedia } from "./media";
import { quantize, type ThumbCache } from "./thumbs";

export type Selection =
  | { kind: "project" }
  /** 枠付きでプレビュー上の映像を選んだ(位置と大きさの編集) */
  | { kind: "video" }
  | { kind: "step" | "caption" | "speech"; step: number }
  | { kind: "zoom" | "hold"; step: number; index: number };

export const selectedStep = (s: Selection): number | null => ("step" in s ? s.step : null);

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
}

type Update = (fn: (p: Project) => Project, key?: string) => void;

const VIDEO_H = 52;
const TILE_W = Math.round((VIDEO_H - 4) * (16 / 9));
const SNAP_PX = 6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

let dragSeq = 0;

/** ポインターのドラッグ。移動量(ピクセル)を渡す。1 回のドラッグの変更は Undo 1 回分にまとめる */
function startDrag(
  e: React.PointerEvent,
  onMove: (dx: number, key: string) => void,
  onEnd?: () => void,
): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  const x0 = e.clientX;
  const key = `drag${++dragSeq}`;
  const move = (ev: PointerEvent) => onMove(ev.clientX - x0, key);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function patchStep(update: Update, index: number, fn: (s: Step) => Step, key: string) {
  update((p) => ({ ...p, steps: p.steps.map((s, i) => (i === index ? fn(s) : s)) }), key);
}

function ThumbTile(props: { thumb: (CanvasImageSource & { width: number; height: number }) | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (props.thumb) ctx.drawImage(props.thumb, 0, 0, c.width, c.height);
  }, [props.thumb]);
  return <canvas ref={ref} width={TILE_W * 2} height={(VIDEO_H - 4) * 2} />;
}

/** 目盛りの間隔(秒)。主目盛りが 70px 以上空くもの */
function tickInterval(pps: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s * pps >= 70) ?? 600;
}

/** サムネイルの刻み(秒、ソースの時刻)。タイル 1 枚分の長さ以上で最小のもの */
function thumbQuantum(secondsPerTile: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 30, 60];
  return steps.find((s) => s >= secondsPerTile) ?? 60;
}

export function Timeline(props: {
  project: Project;
  timeline: TimelineEntry[];
  total: number;
  time: number;
  playing: boolean;
  media: Map<string, SourceMedia>;
  thumbs: ThumbCache;
  thumbsVersion: number;
  speechDurations: ReadonlyMap<string, number>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  update: Update;
  /** クリップ端のドラッグ中に、新しい In/Out のフレームを表示する(null で解除) */
  onTrimPreview: (v: { step: number; time: number } | null) => void;
  openMenu: (x: number, y: number, items: MenuItem[]) => void;
  onEditZoomRect: (step: number, zoom: number) => void;
  /** 拡大率の操作(親のボタンから)。値が変わるたびに適用する */
  zoomCommand: { n: number; kind: "in" | "out" | "fit" };
}) {
  const { project, timeline, total, time, update, selection } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pps, setPps] = useState(50);
  const [fit, setFit] = useState(true);
  const fitPps = Math.max(1, (viewW - 24) / Math.max(total, 1));
  const scale = fit ? fitPps : pps;
  const innerW = Math.max(viewW, total * scale + 40);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Ctrl+ホイールで拡大縮小(カーソル位置の時刻を保つ)。ホイールだけなら横スクロール
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const cur = scaleRef.current;
        const tAt = (el.scrollLeft + mx) / cur;
        const next = clamp(cur * Math.exp(-e.deltaY * 0.002), 0.5, 2000);
        setFit(false);
        setPps(next);
        requestAnimationFrame(() => {
          el.scrollLeft = tAt * next - mx;
        });
      } else if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 親のボタンからの拡大・縮小・全体表示
  const lastCmd = useRef(props.zoomCommand.n);
  useEffect(() => {
    if (props.zoomCommand.n === lastCmd.current) return;
    lastCmd.current = props.zoomCommand.n;
    const el = scrollRef.current;
    if (props.zoomCommand.kind === "fit") {
      setFit(true);
      return;
    }
    const cur = scaleRef.current;
    const next = clamp(cur * (props.zoomCommand.kind === "in" ? 1.5 : 1 / 1.5), 0.5, 2000);
    setFit(false);
    setPps(next);
    if (el) {
      const tAt = time;
      requestAnimationFrame(() => {
        el.scrollLeft = tAt * next - el.clientWidth / 2;
      });
    }
  }, [props.zoomCommand, time]);

  // 再生中は再生ヘッドを画面内に保つ
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !props.playing) return;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 30) el.scrollLeft = x - 30;
  }, [time, scale, props.playing]);

  const xToTime = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((clientX - rect.left + el.scrollLeft) / scale, 0, total);
  };

  /** 再生ヘッドとステップ境界に吸着させる */
  const snap = (tm: number, offset = 0) => {
    const cands = [time - offset, ...timeline.map((e) => e.start - offset)];
    for (const c of cands) if (Math.abs(c - tm) * scale <= SNAP_PX) return c;
    return tm;
  };

  const scrubFrom = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    props.onSeek(xToTime(e.clientX));
    const move = (ev: PointerEvent) => props.onSeek(xToTime(ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // 目盛り
  const ticks: ReactNode[] = [];
  const iv = tickInterval(scale);
  const first = Math.floor(scrollLeft / scale / iv) * iv;
  for (let tk = first; tk <= Math.min(total + iv, (scrollLeft + viewW) / scale); tk += iv) {
    const v = Math.round(tk * 1000) / 1000;
    ticks.push(
      <div key={v} className="tl-tick" style={{ left: v * scale }}>
        <span>{fmtTime(v).replace(/\.00$/, "")}</span>
      </div>,
    );
  }

  const visL = scrollLeft - TILE_W;
  const visR = scrollLeft + viewW + TILE_W;
  const isSel = (kind: Selection["kind"], step: number, index?: number) =>
    selection.kind === kind &&
    "step" in selection &&
    selection.step === step &&
    (index === undefined || ("index" in selection && selection.index === index));

  const clipMenu = (e: React.MouseEvent, entry: TimelineEntry) => {
    e.preventDefault();
    const at = xToTime(e.clientX);
    const local = at - entry.start;
    const i = entry.index;
    props.onSelect({ kind: "step", step: i });
    props.onSeek(at);
    props.openMenu(e.clientX, e.clientY, [
      { label: t("split"), action: () => update((p) => splitStep(p, i, local, true)) },
      { label: t("splitDiscard"), action: () => update((p) => splitStep(p, i, local, false)) },
      { label: t("addHoldHere"), action: () => update((p) => addHold(p, i, local, 1)) },
    ]);
  };

  return (
    <div className="timeline">
      <div className="tl-labels">
        <div className="tl-label ruler-label" />
        <div className="tl-label" style={{ height: VIDEO_H }}>
          {t("trackVideo")}
        </div>
        <div className="tl-label">{t("caption")}</div>
        <div className="tl-label">{t("speech")}</div>
        <div className="tl-label">{t("zooms")}</div>
      </div>
      <div className="tl-scroll" ref={scrollRef} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}>
        <div className="tl-inner" style={{ width: innerW }}>
          <div className="tl-ruler" onPointerDown={scrubFrom}>
            {ticks}
          </div>

          {/* 映像 */}
          <div className="tl-lane" style={{ height: VIDEO_H }} onPointerDown={scrubFrom}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const x0 = entry.start * scale;
              const w = entry.duration * scale;
              const m = props.media.get(step.source);
              const tiles: ReactNode[] = [];
              if (m && x0 + w >= visL && x0 <= visR) {
                const quantum = thumbQuantum((TILE_W / scale) * stepSpeed(step));
                const k0 = Math.max(0, Math.floor((visL - x0) / TILE_W));
                const k1 = Math.min(Math.ceil(w / TILE_W), Math.ceil((visR - x0) / TILE_W));
                for (let k = k0; k < k1; k++) {
                  const local = Math.min(((k + 0.5) * TILE_W) / scale, entry.duration);
                  const src = sourceTimeAt(step, local);
                  const q = quantize(src, quantum);
                  const thumb = props.thumbs.get(m, q) ?? props.thumbs.nearest(m, src, quantum * 2);
                  tiles.push(
                    <div key={k} className="tl-tile" style={{ left: k * TILE_W }}>
                      <ThumbTile thumb={thumb} />
                    </div>,
                  );
                }
              }
              const base = baseDuration(step);
              const explicit = step.holds ?? [];
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                <div
                  key={`${i}-${step.id}`}
                  className={`tl-clip ${isSel("step", i) ? "selected" : ""}`}
                  style={{ left: x0, width: w }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    props.onSelect({ kind: "step", step: i });
                    scrubFrom(e);
                  }}
                  onContextMenu={(e) => clipMenu(e, entry)}
                >
                  <div className="tl-tiles">{tiles}</div>
                  {stepHolds(step).map((h) => {
                    const k = explicit.findIndex((x) => x.at === h.at && x.duration === h.duration);
                    return (
                      <div
                        key={`h${h.at}`}
                        className={`tl-hold ${k < 0 ? "zoom-hold" : ""} ${k >= 0 && isSel("hold", i, k) ? "selected" : ""}`}
                        style={{ left: h.at * scale, width: h.duration * scale }}
                        title={t("holds")}
                        onPointerDown={(e) => {
                          if (k < 0 || e.button !== 0) return;
                          e.stopPropagation();
                          props.onSelect({ kind: "hold", step: i, index: k });
                        }}
                      >
                        {k >= 0 && (
                          <div
                            className="tl-handle right"
                            onPointerDown={(e) => {
                              const d0 = h.duration;
                              const next = stepHolds(step).find((x) => x.at > h.at);
                              props.onSelect({ kind: "hold", step: i, index: k });
                              startDrag(e, (dx, key) => {
                                const d = r3(
                                  clamp(
                                    d0 + dx / scale,
                                    0.1,
                                    next ? next.at - h.at : Number.POSITIVE_INFINITY,
                                  ),
                                );
                                patchStep(
                                  update,
                                  i,
                                  (s) => ({
                                    ...s,
                                    holds: s.holds?.map((x, j) => (j === k ? { ...x, duration: d } : x)),
                                  }),
                                  key,
                                );
                              });
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {entry.duration > base + 1e-3 && (
                    <div
                      className="tl-hold auto"
                      style={{ left: base * scale, width: (entry.duration - base) * scale }}
                      title={t("autoHold")}
                    />
                  )}
                  <span className="tl-clip-label">
                    {i + 1}. {step.id}
                    {stepSpeed(step) > 1 ? ` ×${stepSpeed(step)}` : ""}
                  </span>
                  {(["in", "out"] as const).map((edge) => (
                    <div
                      key={edge}
                      className={`tl-handle ${edge === "in" ? "left" : "right"}`}
                      title={t(edge === "in" ? "in" : "out")}
                      onPointerDown={(e) => {
                        const v0 = edge === "in" ? step.in : step.out;
                        const dur = m?.duration ?? Number.POSITIVE_INFINITY;
                        props.onSelect({ kind: "step", step: i });
                        startDrag(
                          e,
                          (dx, key) => {
                            const v = v0 + (dx / scale) * stepSpeed(step);
                            update((p) => trimStep(p, i, edge, v, dur), key);
                            const s2 = trimStep(project, i, edge, v, dur).steps[i];
                            if (s2)
                              props.onTrimPreview({ step: i, time: edge === "in" ? s2.in : s2.out - 0.001 });
                          },
                          () => props.onTrimPreview(null),
                        );
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>

          {/* テロップ */}
          <div className="tl-lane" onPointerDown={scrubFrom}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const w = captionWindow(step, entry.duration);
              if (!w) {
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                  <div
                    key={i}
                    className="tl-empty"
                    style={{ left: entry.start * scale, width: entry.duration * scale }}
                    onDoubleClick={() => props.onSelect({ kind: "caption", step: i })}
                  />
                );
              }
              const set = (start: number, end: number | null, key: string) =>
                patchStep(
                  update,
                  i,
                  (s) => {
                    const { start: _s, end: _e, ...rest } = s.caption ?? { text: "" };
                    const c: NonNullable<Step["caption"]> = { ...rest };
                    if (r3(start) > 0) c.start = r3(start);
                    if (end !== null) c.end = r3(end);
                    return { ...s, caption: c };
                  },
                  key,
                );
              return (
                <Bar
                  key={i}
                  className={`caption ${isSel("caption", i) ? "selected" : ""}`}
                  left={(entry.start + w.start) * scale}
                  width={(w.end - w.start) * scale}
                  label={step.caption?.text ?? ""}
                  onSelect={() => props.onSelect({ kind: "caption", step: i })}
                  onMove={(dx, key) => {
                    const len = w.end - w.start;
                    const s = clamp(
                      snap(w.start + dx / scale + entry.start, 0) - entry.start,
                      0,
                      entry.duration - len,
                    );
                    const atEnd = s + len >= entry.duration - 1e-3 && step.caption?.end == null;
                    set(s, atEnd ? null : s + len, key);
                  }}
                  onLeft={(dx, key) => {
                    const s = clamp(snap(entry.start + w.start + dx / scale) - entry.start, 0, w.end - 0.1);
                    set(s, step.caption?.end ?? null, key);
                  }}
                  onRight={(dx, key) => {
                    const e = clamp(
                      snap(entry.start + w.end + dx / scale) - entry.start,
                      w.start + 0.1,
                      entry.duration,
                    );
                    // 末尾まで伸ばしたら「ステップの終わりまで」(end 省略)にする
                    set(w.start, (entry.duration - e) * scale < SNAP_PX ? null : e, key);
                  }}
                />
              );
            })}
          </div>

          {/* 読み上げ */}
          <div className="tl-lane" onPointerDown={scrubFrom}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              if (!step.speech?.text.trim()) {
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                  <div
                    key={i}
                    className="tl-empty"
                    style={{ left: entry.start * scale, width: entry.duration * scale }}
                    onDoubleClick={() => props.onSelect({ kind: "speech", step: i })}
                  />
                );
              }
              const d = props.speechDurations.get(step.id);
              const st = speechStart(step);
              return (
                <Bar
                  key={i}
                  className={`speech ${d === undefined ? "pending" : ""} ${isSel("speech", i) ? "selected" : ""}`}
                  left={(entry.start + st) * scale}
                  width={(d ?? 1) * scale}
                  label={step.speech.text}
                  onSelect={() => props.onSelect({ kind: "speech", step: i })}
                  onMove={(dx, key) => {
                    const s = r3(
                      clamp(snap(entry.start + st + dx / scale) - entry.start, 0, baseDuration(step)),
                    );
                    patchStep(
                      update,
                      i,
                      (x) => {
                        const { start: _s, ...rest } = x.speech ?? { text: "" };
                        return { ...x, speech: s > 0 ? { ...rest, start: s } : rest };
                      },
                      key,
                    );
                  }}
                />
              );
            })}
          </div>

          {/* ズーム */}
          <div className="tl-lane" onPointerDown={scrubFrom}>
            {timeline.map((entry) => {
              const { step, index: i } = entry;
              const zooms = step.zooms ?? [];
              const setZoom = (k: number, start: number, end: number, key: string) =>
                patchStep(
                  update,
                  i,
                  (s) => ({
                    ...s,
                    zooms: s.zooms?.map((z, j) => (j === k ? { ...z, start: r3(start), end: r3(end) } : z)),
                  }),
                  key,
                );
              const bounds = (k: number) => {
                const z = zooms[k] as Zoom;
                const others = zooms.filter((_, j) => j !== k);
                const lo = Math.max(0, ...others.filter((o) => o.end <= z.start + 1e-6).map((o) => o.end));
                const hi = Math.min(
                  entry.duration,
                  ...others.filter((o) => o.start >= z.end - 1e-6).map((o) => o.start),
                );
                return { lo, hi };
              };
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
                <div
                  key={i}
                  className="tl-zone"
                  style={{ left: entry.start * scale, width: entry.duration * scale }}
                  onPointerDown={(e) => {
                    // 空いているところをドラッグしてズームを作る
                    if (e.button !== 0) return;
                    const t0 = xToTime(e.clientX) - entry.start;
                    if (zooms.some((z) => t0 >= z.start && t0 <= z.end)) return;
                    props.onSeek(entry.start + t0);
                    const lo = Math.max(0, ...zooms.filter((z) => z.end <= t0).map((z) => z.end));
                    const hi = Math.min(
                      entry.duration,
                      ...zooms.filter((z) => z.start >= t0).map((z) => z.start),
                    );
                    let created = -1;
                    startDrag(e, (dx, key) => {
                      if (Math.abs(dx) < 4 && created < 0) return;
                      const a = clamp(Math.min(t0, t0 + dx / scale), lo, hi);
                      const b = clamp(Math.max(t0, t0 + dx / scale), lo, hi);
                      if (b - a < 0.1) return;
                      if (created < 0) {
                        created = zooms.length;
                        const m = props.media.get(step.source);
                        patchStep(
                          update,
                          i,
                          (s) => ({ ...s, zooms: [...(s.zooms ?? []), defaultZoom(a, b, m)] }),
                          key,
                        );
                        props.onSelect({ kind: "zoom", step: i, index: created });
                      } else setZoom(created, a, b, key);
                    });
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const t0 = xToTime(e.clientX) - entry.start;
                    const hit = zooms.findIndex((z) => t0 >= z.start && t0 <= z.end);
                    props.openMenu(
                      e.clientX,
                      e.clientY,
                      hit >= 0
                        ? [
                            { label: t("drawRect"), action: () => props.onEditZoomRect(i, hit) },
                            {
                              label: t("remove"),
                              action: () =>
                                patchStep(
                                  update,
                                  i,
                                  (s) => ({ ...s, zooms: s.zooms?.filter((_, j) => j !== hit) }),
                                  "zoom-remove",
                                ),
                            },
                          ]
                        : [
                            {
                              label: t("addZoomHere"),
                              action: () => {
                                const lo = Math.max(0, ...zooms.filter((z) => z.end <= t0).map((z) => z.end));
                                const hi = Math.min(
                                  entry.duration,
                                  ...zooms.filter((z) => z.start >= t0).map((z) => z.start),
                                );
                                const a = clamp(t0, lo, hi);
                                const b = Math.min(hi, a + 2);
                                if (b - a < 0.1) return;
                                const m = props.media.get(step.source);
                                update(
                                  (p) => ({
                                    ...p,
                                    steps: p.steps.map((s, j) =>
                                      j === i
                                        ? { ...s, zooms: [...(s.zooms ?? []), defaultZoom(a, b, m)] }
                                        : s,
                                    ),
                                  }),
                                  "zoom-add",
                                );
                                props.onSelect({ kind: "zoom", step: i, index: zooms.length });
                              },
                            },
                          ],
                    );
                  }}
                >
                  {zooms.map((z, k) => {
                    const tr = Math.min(zoomTransition(z), (z.end - z.start) / 2);
                    return (
                      <Bar
                        // biome-ignore lint/suspicious/noArrayIndexKey: ズームは id を持たない
                        key={k}
                        className={`zoom ${z.hold ? "hold" : ""} ${isSel("zoom", i, k) ? "selected" : ""}`}
                        left={z.start * scale}
                        width={(z.end - z.start) * scale}
                        ramp={tr * scale}
                        label={`${((props.media.get(step.source)?.width ?? 1920) / z.rect.w).toFixed(1)}×`}
                        onSelect={() => props.onSelect({ kind: "zoom", step: i, index: k })}
                        onDoubleClick={() => props.onEditZoomRect(i, k)}
                        onMove={(dx, key) => {
                          const { lo, hi } = bounds(k);
                          const len = z.end - z.start;
                          const s = clamp(
                            snap(entry.start + z.start + dx / scale) - entry.start,
                            lo,
                            hi - len,
                          );
                          setZoom(k, s, s + len, key);
                        }}
                        onLeft={(dx, key) => {
                          const { lo } = bounds(k);
                          setZoom(
                            k,
                            clamp(snap(entry.start + z.start + dx / scale) - entry.start, lo, z.end - 0.1),
                            z.end,
                            key,
                          );
                        }}
                        onRight={(dx, key) => {
                          const { hi } = bounds(k);
                          setZoom(
                            k,
                            z.start,
                            clamp(snap(entry.start + z.end + dx / scale) - entry.start, z.start + 0.1, hi),
                            key,
                          );
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>

          {timeline.map((e) => (
            <div key={`b${e.index}`} className="tl-boundary" style={{ left: e.start * scale }} />
          ))}
          <div className="tl-playhead" style={{ left: time * scale }} />
        </div>
      </div>
    </div>
  );
}

/** 新しいズームの範囲は、録画の中央を 2 倍に拡大する大きさ */
function defaultZoom(start: number, end: number, m: SourceMedia | undefined): Zoom {
  const w = m?.width ?? 1920;
  const h = m?.height ?? 1080;
  return {
    start: r3(start),
    end: r3(end),
    rect: { x: Math.round(w / 4), y: Math.round(h / 4), w: Math.round(w / 2), h: Math.round(h / 2) },
  };
}

/** タイムライン上の帯。本体のドラッグで移動、両端のドラッグで伸縮 */
function Bar(props: {
  className: string;
  left: number;
  width: number;
  label: string;
  ramp?: number;
  onSelect: () => void;
  onDoubleClick?: () => void;
  onMove: (dx: number, key: string) => void;
  onLeft?: (dx: number, key: string) => void;
  onRight?: (dx: number, key: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用。キー操作は別にある
    <div
      className={`tl-bar ${props.className}`}
      style={{ left: props.left, width: Math.max(2, props.width) }}
      title={props.label}
      onPointerDown={(e) => {
        props.onSelect();
        startDrag(e, props.onMove);
      }}
      onDoubleClick={props.onDoubleClick}
    >
      {props.ramp !== undefined && props.ramp > 0 && (
        <>
          <div className="tl-ramp in" style={{ width: props.ramp }} />
          <div className="tl-ramp out" style={{ width: props.ramp }} />
        </>
      )}
      <span>{props.label}</span>
      {props.onLeft && (
        <div
          className="tl-handle left"
          onPointerDown={(e) => {
            props.onSelect();
            startDrag(e, props.onLeft as (dx: number, key: string) => void);
          }}
        />
      )}
      {props.onRight && (
        <div
          className="tl-handle right"
          onPointerDown={(e) => {
            props.onSelect();
            startDrag(e, props.onRight as (dx: number, key: string) => void);
          }}
        />
      )}
    </div>
  );
}
