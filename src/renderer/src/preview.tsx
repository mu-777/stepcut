// プレビュー。縮小した大きさで描く(NF-04)。
// 枠の編集(ズーム範囲、録画の位置と大きさ)は共通の操作: 枠の中のドラッグで移動、四隅で中心固定の拡大縮小、四辺の中央で縦横比の変更。
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { resolveLayout } from "../../core/defaults";
import { computeLayout, type Rect, zoomViewRect } from "../../core/layout";
import type { Project, Step } from "../../core/schema";
import { captionBox, outputToSource, sourceToOutput } from "./compositor";
import { Player, type PlayerState } from "./player";

export interface DrawingZoom {
  srcW: number;
  srcH: number;
  rect: Rect | null;
  /** 範囲(ソースのピクセル)。key は 1 回のドラッグで同じ */
  onRect: (rect: Rect, key: string) => void;
}

export interface VideoEdit {
  /** 録画の枠(出力のピクセル)。key は 1 回のドラッグで同じ。shapeChanged は縦横比を変えた操作 */
  onRect: (rect: Rect, key: string, shapeChanged: boolean) => void;
}

export function Preview(props: {
  outW: number;
  outH: number;
  project: Project;
  stateRef: MutableRefObject<PlayerState>;
  playerRef: MutableRefObject<Player | null>;
  onTime: (t: number, playing: boolean) => void;
  drawing: DrawingZoom | null;
  /** 表示中の録画の大きさ(映像の位置の計算に使う) */
  srcSize: { w: number; h: number } | null;
  /** 録画を選んでいるとき。枠とハンドルを出す */
  videoEdit: VideoEdit | null;
  /** プレビューをクリックした(ほかの編集をしていないとき)。inside は録画の上か */
  onVideoClick: (inside: boolean) => void;
  /** 右クリック。点は出力のピクセル */
  onContextMenu: (clientX: number, clientY: number, out: { x: number; y: number }) => void;
  /** プレビューの上に重ねて出す操作の説明 */
  hint: string | null;
  /** いまテロップが出ているステップ。テロップをドラッグで動かせる */
  captionStep: Step | null;
  /** テロップの中心(画面側座標) */
  onCaptionMove: (pos: { x: number; y: number }, key: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const onTimeRef = useRef(props.onTime);
  onTimeRef.current = props.onTime;
  const { stateRef, playerRef, outW, outH } = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const player = new Player(
      canvas,
      () => stateRef.current,
      (t, p) => onTimeRef.current(t, p),
    );
    playerRef.current = player;
    return () => {
      player.stop();
      playerRef.current = null;
    };
  }, [stateRef, playerRef]);

  // 枠に合わせて出力の縦横比で大きさを決める。描画の解像度は出力を超えない
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const resize = () => {
      const maxW = el.clientWidth;
      const maxH = el.clientHeight;
      const scale = Math.min(maxW / outW, maxH / outH);
      setSize({ w: Math.max(1, Math.floor(outW * scale)), h: Math.max(1, Math.floor(outH * scale)) });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [outW, outH]);

  const dpr = Math.min(window.devicePixelRatio || 1, outW / Math.max(1, size.w));
  const pxW = Math.round(size.w * dpr);
  const pxH = Math.round(size.h * dpr);

  useEffect(() => {
    // 大きさが変わるとキャンバスが消えるので描き直す
    void pxW;
    void pxH;
    playerRef.current?.renderStill();
  }, [pxW, pxH, playerRef]);

  const d = props.drawing;
  const k = outW / Math.max(1, size.w);
  const toStage = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = (el.closest(".preview-stage") as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const layout = resolveLayout(props.project);
  const src = props.srcSize ?? { w: 1920, h: 1080 };
  const videoBox = computeLayout(size.w, size.h, layout, src.w, src.h).video;

  let editor: React.ReactNode = null;
  if (d) {
    // ズーム範囲: ソースの座標 ⇔ 画面上の座標(ズームなしの表示で)
    const toScreen = (r: Rect) => {
      const a = sourceToOutput(props.project, size.w, size.h, d.srcW, d.srcH, r.x, r.y);
      const b = sourceToOutput(props.project, size.w, size.h, d.srcW, d.srcH, r.x + r.w, r.y + r.h);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    const crop = computeLayout(size.w, size.h, layout, d.srcW, d.srcH).crop;
    editor = (
      <BoxEditor
        box={d.rect ? toScreen(d.rect) : null}
        // 実際に見える範囲(表示の縦横比に合わせて広げた範囲)を薄く示す
        visible={d.rect ? toScreen(zoomViewRect(d.rect, crop.w / crop.h, d.srcW, d.srcH)) : null}
        allowDraw
        bounds={videoBox}
        snapX={[]}
        snapY={[]}
        onChange={(b, key) => {
          const a = outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, b.x, b.y);
          const c = outputToSource(props.project, size.w, size.h, d.srcW, d.srcH, b.x + b.w, b.y + b.h);
          if (c.x - a.x < 4 || c.y - a.y < 4) return;
          d.onRect(
            { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(c.x - a.x), h: Math.round(c.y - a.y) },
            key,
          );
        }}
      />
    );
  } else if (props.videoEdit) {
    const ve = props.videoEdit;
    editor = (
      <BoxEditor
        box={videoBox}
        snapX={[size.w / 2]}
        snapY={[size.h / 2]}
        onChange={(b, key, shapeChanged) =>
          ve.onRect({ x: b.x * k, y: b.y * k, w: b.w * k, h: b.h * k }, key, shapeChanged)
        }
      />
    );
  }

  // テロップのドラッグ(表示中のステップのテロップ)
  let captionHandle: React.ReactNode = null;
  const cs = props.captionStep;
  if (cs && !d && !props.videoEdit) {
    const ctx = canvasRef.current?.getContext("2d");
    const c = ctx ? captionBox(ctx, props.project, cs, size.w, size.h, videoBox) : null;
    if (c) {
      captionHandle = (
        <div
          className="caption-handle"
          style={{ left: c.box.x, top: c.box.y, width: c.box.w, height: c.box.h }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            const x0 = e.clientX;
            const y0 = e.clientY;
            const key = `drag-caption-${Date.now()}`;
            const move = (ev: PointerEvent) => {
              let cx = c.cx + ev.clientX - x0;
              const cy = c.cy + ev.clientY - y0;
              // 左右の中央に吸着する
              if (!ev.altKey && Math.abs(cx - size.w / 2) <= 12) cx = size.w / 2;
              const r4 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;
              props.onCaptionMove({ x: r4(cx / size.w), y: r4(cy / size.h) }, key);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      );
    }
  }

  return (
    <div className="preview" ref={wrapRef}>
      {props.hint && <div className="preview-hint">{props.hint}</div>}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: マウス操作専用 */}
      <div
        className="preview-stage"
        style={{ width: size.w, height: size.h }}
        onPointerDown={(e) => {
          if (e.button !== 0 || d) return;
          const p = toStage(e, e.currentTarget);
          const v = videoBox;
          props.onVideoClick(p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const p = toStage(e, e.currentTarget);
          props.onContextMenu(e.clientX, e.clientY, { x: p.x * k, y: p.y * k });
        }}
      >
        <canvas ref={canvasRef} width={pxW} height={pxH} style={{ width: size.w, height: size.h }} />
        {captionHandle}
        {editor}
      </div>
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number };
type Mode = "move" | "draw" | "corner" | "n" | "s" | "e" | "w";
const SNAP = 12;
const MIN = 8;

/**
 * 画面上の枠の編集(ズームの範囲・録画の配置で共通)。
 * 枠の中のドラッグで移動(中心が変わるのはこれだけ)、四隅は中心を固定して縦横比を保ったまま拡大縮小、
 * 四辺の中央は中心を固定して縦横比を変える。snapX / snapY は枠の中心を吸着させる線。吸着中はガイド線を出す。
 */
function BoxEditor(props: {
  box: Box | null;
  /** 実際に見える範囲(ズーム)。薄い線で示す */
  visible?: Box | null;
  allowDraw?: boolean;
  /** 新しく描くときに収める範囲 */
  bounds?: Box;
  snapX: number[];
  snapY: number[];
  onChange: (b: Box, key: string, shapeChanged: boolean) => void;
}) {
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [preview, setPreview] = useState<Box | null>(null);

  const begin = (e: React.PointerEvent, mode: Mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const stage = (e.currentTarget as HTMLElement).closest(".preview-stage") as HTMLElement;
    const origin = stage.getBoundingClientRect();
    const p0 = { x: e.clientX - origin.left, y: e.clientY - origin.top };
    const b0 = props.box ?? { x: p0.x, y: p0.y, w: 0, h: 0 };
    const cx0 = b0.x + b0.w / 2;
    const cy0 = b0.y + b0.h / 2;
    const key = `drag-box-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const p = { x: ev.clientX - origin.left, y: ev.clientY - origin.top };
      let b: Box;
      let gx: number | null = null;
      let gy: number | null = null;
      if (mode === "move") {
        b = { ...b0, x: b0.x + p.x - p0.x, y: b0.y + p.y - p0.y };
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const sx = props.snapX.find((x) => Math.abs(x - cx) <= SNAP);
        const sy = props.snapY.find((y) => Math.abs(y - cy) <= SNAP);
        if (sx !== undefined && !ev.altKey) {
          b.x = sx - b.w / 2;
          gx = sx;
        }
        if (sy !== undefined && !ev.altKey) {
          b.y = sy - b.h / 2;
          gy = sy;
        }
      } else if (mode === "corner") {
        // 中心から角までの距離の比で拡大縮小する
        const k = Math.max(Math.abs(p.x - cx0) / (b0.w / 2), Math.abs(p.y - cy0) / (b0.h / 2));
        const w = Math.max(MIN, b0.w * k);
        const h = (w * b0.h) / b0.w;
        b = { x: cx0 - w / 2, y: cy0 - h / 2, w, h };
      } else if (mode === "e" || mode === "w") {
        const w = Math.max(MIN, Math.abs(p.x - cx0) * 2);
        b = { x: cx0 - w / 2, y: b0.y, w, h: b0.h };
      } else if (mode === "n" || mode === "s") {
        const h = Math.max(MIN, Math.abs(p.y - cy0) * 2);
        b = { x: b0.x, y: cy0 - h / 2, w: b0.w, h };
      } else {
        // 新しく描く: 押した点と今の点を対角にする
        b = {
          x: Math.min(p0.x, p.x),
          y: Math.min(p0.y, p.y),
          w: Math.max(MIN, Math.abs(p.x - p0.x)),
          h: Math.max(MIN, Math.abs(p.y - p0.y)),
        };
        if (props.bounds) {
          const B = props.bounds;
          b.x = Math.min(Math.max(b.x, B.x), B.x + B.w - b.w);
          b.y = Math.min(Math.max(b.y, B.y), B.y + B.h - b.h);
        }
      }
      setGuides({ x: gx, y: gy });
      if (mode === "draw") setPreview(b);
      else props.onChange(b, key, mode !== "move" && mode !== "corner");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setGuides({ x: null, y: null });
      setPreview((pv) => {
        if (pv) props.onChange(pv, key, true);
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const b = preview ?? props.box;
  const v = preview ? null : props.visible;
  return (
    <div
      className={`box-layer ${props.allowDraw ? "draw-layer" : ""}`}
      onPointerDown={props.allowDraw ? (e) => begin(e, "draw") : undefined}
    >
      {v && <div className="box-visible" style={{ left: v.x, top: v.y, width: v.w, height: v.h }} />}
      {b && (
        <div
          className="box-outline"
          style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
          onPointerDown={(e) => begin(e, "move")}
        >
          {(["nw", "ne", "sw", "se"] as const).map((c) => (
            <div key={c} className={`box-handle ${c}`} onPointerDown={(e) => begin(e, "corner")} />
          ))}
          {(["n", "s", "e", "w"] as const).map((c) => (
            <div key={c} className={`box-handle edge ${c}`} onPointerDown={(e) => begin(e, c)} />
          ))}
        </div>
      )}
      {guides.x !== null && <div className="guide v" style={{ left: guides.x }} />}
      {guides.y !== null && <div className="guide h" style={{ top: guides.y }} />}
    </div>
  );
}
